"""Téléchargement automatique des playlists ListenBrainz générées pour l'utilisateur."""

import json
import logging
import os
import re
import tempfile
import threading
import time
import unicodedata
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import requests

import navidrome
from catalog import build_song_meta, song_from_search, ytmusic
from downloader import MUSIC_DIR, jobs, sanitize, start_job


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


LISTENBRAINZ_USER = os.environ.get("LISTENBRAINZ_USER", "")
LISTENBRAINZ_TOKEN = os.environ.get("LISTENBRAINZ_TOKEN", "")
LISTENBRAINZ_RETENTION_DAYS = _env_int("LISTENBRAINZ_RETENTION_DAYS", 0)
LISTENBRAINZ_CHECK_HOURS = max(1, _env_int("LISTENBRAINZ_CHECK_HOURS", 6))
LISTENBRAINZ_PLAYLIST_NAME = os.environ.get("LISTENBRAINZ_PLAYLIST_NAME", "") or "Weekly Exploration"

API_URL = "https://api.listenbrainz.org"
JSPF_PLAYLIST_EXTENSION = "https://musicbrainz.org/doc/jspf#playlist"
WEEKLY_EXPLORATION = "weekly-exploration"
SOURCES = (WEEKLY_EXPLORATION,)
QUALITY = "best"
REQUEST_TIMEOUT = 15
FIRST_PASS_DELAY = 10

STATE_FILE = MUSIC_DIR / ".tunedig" / "listenbrainz.json"
LEGACY_STATE_FILE = MUSIC_DIR / ".yt-get" / "listenbrainz.json"
PLAYLISTS_DIR = MUSIC_DIR / "Playlists"

DECISIONS = ("keep", "discard")
PLAYLIST_STATUSES = ("downloaded", "existing")
RETRYABLE_STATUSES = ("error", "unmatched")

logger = logging.getLogger(__name__)
_state_lock = threading.RLock()
_background_started = False


class ListenBrainzError(Exception):
    pass


class TrackNotFound(Exception):
    pass


class DecisionError(Exception):
    pass


def enabled() -> bool:
    return bool(LISTENBRAINZ_USER and LISTENBRAINZ_TOKEN)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _api_get(path: str) -> dict:
    try:
        resp = requests.get(
            f"{API_URL}{path}",
            headers={"Authorization": f"Token {LISTENBRAINZ_TOKEN}"},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        raise ListenBrainzError(f"ListenBrainz inaccessible ({path}) : {exc}") from exc
    except ValueError as exc:
        raise ListenBrainzError(f"Réponse ListenBrainz invalide ({path})") from exc


def _playlist_source(playlist: dict) -> str | None:
    extension = (playlist.get("extension") or {}).get(JSPF_PLAYLIST_EXTENSION) or {}
    algorithm = (extension.get("additional_metadata") or {}).get("algorithm_metadata") or {}
    return algorithm.get("source_patch")


def _mbid_from_url(url: str) -> str:
    return url.rstrip("/").rsplit("/", 1)[-1]


def fetch_latest_playlist(source: str = WEEKLY_EXPLORATION) -> dict | None:
    data = _api_get(f"/1/user/{quote(LISTENBRAINZ_USER)}/playlists/createdfor")
    candidates = [
        item.get("playlist") or {}
        for item in data.get("playlists", [])
        if _playlist_source(item.get("playlist") or {}) == source
    ]
    if not candidates:
        return None
    latest = max(candidates, key=lambda p: p.get("date") or "")
    return {
        "mbid": _mbid_from_url(latest.get("identifier", "")),
        "title": latest.get("title") or source,
        "date": latest.get("date") or "",
        "source": source,
    }


def _recording_mbid(identifier: str | list | None) -> str | None:
    urls = identifier if isinstance(identifier, list) else [identifier or ""]
    for url in urls:
        found = re.search(r"recording/([0-9a-fA-F-]{36})", str(url))
        if found:
            return found.group(1).lower()
    return None


def fetch_playlist_tracks(playlist_mbid: str) -> list[dict]:
    data = _api_get(f"/1/playlist/{quote(playlist_mbid)}")
    tracks = []
    for track in (data.get("playlist") or {}).get("track", []):
        mbid = _recording_mbid(track.get("identifier"))
        if not mbid or not track.get("title"):
            continue
        tracks.append({
            "mbid": mbid,
            "title": track["title"],
            "artist": track.get("creator") or "",
            "album": track.get("album"),
        })
    return tracks


_TITLE_SUFFIXES = re.compile(
    r"\s*[\(\[][^\)\]]*\b(feat|ft|featuring|with|remaster(ed)?|version|edit|mono|stereo)\b"
    r"[^\)\]]*[\)\]]"
    r"|\s+-\s+.*\b(remaster(ed)?|version|edit|mono|stereo|mix)\b.*$"
    r"|\s+(feat|ft|featuring)\b.*$"
)


def normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in decomposed if not unicodedata.combining(c))
    text = _TITLE_SUFFIXES.sub("", text)
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.split())


def _similar(a: str, b: str) -> bool:
    return bool(a and b) and (a in b or b in a)


def _artist_matches(result: dict, artist: str) -> bool:
    wanted = normalize(artist)
    return any(_similar(normalize(a.get("name") or ""), wanted) for a in result.get("artists") or [])


def match_track(title: str, artist: str) -> dict | None:
    results = [
        r for r in ytmusic.search(f"{artist} {title}", filter="songs", limit=5)
        if r.get("videoId")
    ]
    wanted_title = normalize(title)
    for result in results:
        if _similar(normalize(result.get("title") or ""), wanted_title) and _artist_matches(result, artist):
            return song_from_search(result)
    if results and normalize(results[0].get("title") or "") == wanted_title:
        return song_from_search(results[0])
    return None


def _empty_state() -> dict:
    return {"playlists": {}, "tracks": {}, "navidrome_playlist_id": None}


def _load_state() -> dict:
    path = STATE_FILE if STATE_FILE.exists() else LEGACY_STATE_FILE
    if not path.exists():
        return _empty_state()
    with path.open(encoding="utf-8") as fh:
        state = json.load(fh)
    return {**_empty_state(), **state}


def _save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=STATE_FILE.parent, suffix=".tmp", delete=False
    ) as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(fh.name, STATE_FILE)


@contextmanager
def _editing_state():
    with _state_lock:
        state = _load_state()
        yield state
        _save_state(state)


def _read_state() -> dict:
    with _state_lock:
        return _load_state()


def _is_under_music_dir(path: Path) -> bool:
    return MUSIC_DIR.resolve() in path.resolve().parents


def _relative_path(path: str | None) -> str | None:
    if not path:
        return None
    try:
        return str(Path(path).resolve().relative_to(MUSIC_DIR.resolve()))
    except ValueError:
        return path


def _m3u_file(playlist: dict) -> Path:
    return PLAYLISTS_DIR / f"{sanitize(playlist['title'])} {playlist['date'][:10]}.m3u"


def _in_m3u(entry: dict) -> bool:
    return (
        entry["status"] in PLAYLIST_STATUSES
        and entry.get("decision") != "discard"
        and bool(entry.get("path"))
        and Path(entry["path"]).exists()
    )


def _write_m3u(state: dict, playlist_mbid: str) -> None:
    if navidrome.enabled():
        return
    playlist = state["playlists"].get(playlist_mbid)
    if not playlist:
        return
    m3u = _m3u_file(playlist)
    paths = [
        entry["path"] for entry in state["tracks"].values()
        if entry["playlist"] == playlist_mbid and _in_m3u(entry)
    ]
    if not paths:
        m3u.unlink(missing_ok=True)
        return
    PLAYLISTS_DIR.mkdir(parents=True, exist_ok=True)
    # Navidrome, comme la plupart des lecteurs, résout les chemins relatifs par rapport au fichier m3u.
    lines = ["#EXTM3U", *(os.path.relpath(p, m3u.parent) for p in paths)]
    m3u.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _new_track_entry(playlist_mbid: str, track: dict) -> dict:
    return {
        "playlist": playlist_mbid,
        "title": track["title"],
        "artist": track["artist"],
        "album": track["album"],
        "videoId": None,
        "albumId": None,
        "thumbnail": None,
        "path": None,
        "status": "unmatched",
        "decision": None,
        "downloaded_at": None,
        "decided_at": None,
        "error": None,
        "navidromeSongId": None,
        "movedTo": None,
    }


def _safe_match(track: dict) -> dict | None:
    try:
        return match_track(track["title"], track["artist"])
    except Exception:  # noqa: BLE001 — une recherche en échec ne bloque pas les autres pistes
        logger.exception("Recherche YouTube Music impossible pour %s", track["title"])
        return None


def _job_track(song: dict) -> dict:
    meta, cover_url = build_song_meta(
        song["videoId"], song["title"], song["artist"],
        song.get("album"), song.get("albumId"), song.get("thumbnail"),
    )
    return {"video_id": song["videoId"], "title": song["title"], "meta": meta, "cover_url": cover_url}


def _apply_job_track(entry: dict, job_track: dict) -> None:
    if job_track["status"] == "done":
        entry["path"] = job_track["path"]
        entry["status"] = "existing" if job_track.get("existed") else "downloaded"
        entry["downloaded_at"] = _now()
        if job_track.get("songId"):
            entry["navidromeSongId"] = job_track["songId"]
    else:
        entry["status"] = "error"
        entry["error"] = job_track.get("error") or "échec du téléchargement"


def _job_done_callback(playlist_mbid: str, recording_mbids: list[str]):
    def on_done(job: dict) -> None:
        with _editing_state() as state:
            for mbid, job_track in zip(recording_mbids, job["tracks"]):
                entry = state["tracks"].get(mbid)
                if entry is not None:
                    _apply_job_track(entry, job_track)
            _write_m3u(state, playlist_mbid)
    return on_done


def _claim_playlist(playlist: dict) -> bool:
    with _editing_state() as state:
        if playlist["mbid"] in state["playlists"]:
            return False
        state["playlists"][playlist["mbid"]] = {
            "title": playlist["title"],
            "date": playlist["date"],
            "source": playlist["source"],
            "job_id": None,
            "processed_at": None,
        }
        return True


def _release_playlist(playlist_mbid: str) -> None:
    with _editing_state() as state:
        state["playlists"].pop(playlist_mbid, None)


def _match_new_tracks(playlist_mbid: str, tracks: list[dict]) -> tuple[dict, list]:
    known = set(_read_state()["tracks"])
    entries: dict[str, dict] = {}
    matched: list[tuple[str, dict]] = []
    for track in tracks:
        if track["mbid"] in known or track["mbid"] in entries:
            continue
        entry = _new_track_entry(playlist_mbid, track)
        song = _safe_match(track)
        if song is not None:
            entry.update(
                status="pending", videoId=song["videoId"],
                albumId=song.get("albumId"), thumbnail=song["thumbnail"],
            )
            matched.append((track["mbid"], song))
        entries[track["mbid"]] = entry
    return entries, matched


def _known_navidrome_playlist_id() -> str | None:
    playlist_id = _read_state().get("navidrome_playlist_id")
    if playlist_id and any(p["id"] == playlist_id for p in navidrome.list_playlists()):
        return playlist_id
    return None


def _find_or_create_navidrome_playlist() -> str:
    playlist = navidrome.find_playlist_by_name(LISTENBRAINZ_PLAYLIST_NAME)
    return (playlist or navidrome.create_playlist(LISTENBRAINZ_PLAYLIST_NAME))["id"]


def _navidrome_playlist_id() -> str | None:
    if not navidrome.enabled():
        return None
    try:
        playlist_id = _known_navidrome_playlist_id() or _find_or_create_navidrome_playlist()
    except Exception:  # noqa: BLE001 — la playlist Navidrome ne doit pas bloquer le téléchargement
        logger.warning("Playlist Navidrome « %s » indisponible", LISTENBRAINZ_PLAYLIST_NAME, exc_info=True)
        return None
    with _editing_state() as state:
        state["navidrome_playlist_id"] = playlist_id
    return playlist_id


def _start_download(playlist_mbid: str, title: str, matched: list[tuple[str, dict]]) -> dict:
    return start_job(
        kind="playlist",
        title=title,
        artist="ListenBrainz",
        thumbnail=matched[0][1]["thumbnail"],
        tracks=[_job_track(song) for _, song in matched],
        cover_url=None,
        quality=QUALITY,
        on_done=_job_done_callback(playlist_mbid, [mbid for mbid, _ in matched]),
        playlist_id=_navidrome_playlist_id(),
    )


def process_playlist(playlist: dict) -> dict | None:
    tracks = fetch_playlist_tracks(playlist["mbid"])
    entries, matched = _match_new_tracks(playlist["mbid"], tracks)
    with _editing_state() as state:
        state["tracks"].update(entries)
        state["playlists"][playlist["mbid"]]["processed_at"] = _now()
    if not matched:
        return None
    job = _start_download(playlist["mbid"], playlist["title"], matched)
    with _editing_state() as state:
        state["playlists"][playlist["mbid"]]["job_id"] = job["id"]
    return job


def _process_claimed(playlist: dict) -> None:
    try:
        process_playlist(playlist)
    except Exception:  # noqa: BLE001 — la playlist sera retentée au prochain passage
        logger.exception("Traitement de la playlist %s en échec", playlist["title"])
        if _read_state()["playlists"].get(playlist["mbid"], {}).get("processed_at") is None:
            _release_playlist(playlist["mbid"])


def _playlist_job(playlist_mbid: str) -> dict | None:
    job_id = _read_state()["playlists"].get(playlist_mbid, {}).get("job_id")
    return jobs.get(job_id) if job_id else None


def sync_latest(source: str = WEEKLY_EXPLORATION, background: bool = False) -> dict:
    playlist = fetch_latest_playlist(source)
    if playlist is None:
        return {"playlist": None, "mbid": None, "new": False, "job": None}
    new = _claim_playlist(playlist)
    if new and background:
        threading.Thread(target=_process_claimed, args=(playlist,), daemon=True).start()
    elif new:
        _process_claimed(playlist)
    return {
        "playlist": playlist["title"],
        "mbid": playlist["mbid"],
        "new": new,
        "job": _playlist_job(playlist["mbid"]),
    }


def _select_retryable(tracks: dict, mbids: list[str] | None) -> list[str]:
    if mbids is None:
        return [mbid for mbid, entry in tracks.items() if entry["status"] in RETRYABLE_STATUSES]
    for mbid in mbids:
        entry = tracks.get(mbid)
        if entry is None:
            raise TrackNotFound(f"Piste inconnue : {mbid}")
        if entry["status"] not in RETRYABLE_STATUSES:
            raise DecisionError("Cette piste n'est pas en échec")
    return list(dict.fromkeys(mbids))


def _known_album_id(entry: dict) -> str | None:
    if "albumId" in entry:
        return entry["albumId"]
    found = _safe_match(entry)
    return found.get("albumId") if found else None


def _song_from_entry(entry: dict) -> dict:
    return {
        "videoId": entry["videoId"],
        "title": entry["title"],
        "artist": entry["artist"],
        "album": entry.get("album"),
        "albumId": _known_album_id(entry),
        "thumbnail": entry.get("thumbnail"),
    }


def _retry_song(entry: dict) -> dict | None:
    if entry["status"] == "error" and entry.get("videoId"):
        return _song_from_entry(entry)
    return _safe_match(entry)


def _prepare_retry(originals: dict[str, dict]) -> dict[str, list[tuple[str, dict]]]:
    songs = {mbid: _retry_song(entry) for mbid, entry in originals.items()}
    groups: dict[str, list[tuple[str, dict]]] = {}
    with _editing_state() as state:
        for mbid, song in songs.items():
            entry = state["tracks"][mbid]
            if song is None:
                entry["status"] = "unmatched"
                continue
            entry.update(
                videoId=song["videoId"], albumId=song.get("albumId"),
                thumbnail=song.get("thumbnail") or entry.get("thumbnail"),
            )
            groups.setdefault(entry["playlist"], []).append((mbid, song))
    return groups


def _start_retry(playlist_mbid: str, matched: list[tuple[str, dict]]) -> dict:
    title = _read_state()["playlists"][playlist_mbid]["title"]
    job = _start_download(playlist_mbid, f"{title} · nouvel essai", matched)
    with _editing_state() as state:
        state["playlists"][playlist_mbid]["job_id"] = job["id"]
    return job


def _restore_statuses(originals: dict[str, dict]) -> None:
    with _editing_state() as state:
        for mbid, original in originals.items():
            state["tracks"][mbid].update(status=original["status"], error=original.get("error"))


def _run_retry(originals: dict[str, dict]) -> None:
    launched: set[str] = set()
    try:
        for playlist_mbid, matched in _prepare_retry(originals).items():
            _start_retry(playlist_mbid, matched)
            launched.update(mbid for mbid, _ in matched)
    except Exception:  # noqa: BLE001 — les pistes non relancées retrouvent leur statut d'origine
        logger.exception("Relance des pistes ListenBrainz en échec")
        _restore_statuses({m: e for m, e in originals.items() if m not in launched})


def retry_tracks(mbids: list[str] | None = None) -> int:
    with _editing_state() as state:
        selected = _select_retryable(state["tracks"], mbids)
        originals = {mbid: dict(state["tracks"][mbid]) for mbid in selected}
        for mbid in selected:
            state["tracks"][mbid].update(status="pending", error=None)
    if originals:
        threading.Thread(target=_run_retry, args=(originals,), daemon=True).start()
    return len(originals)


def _remove_empty_dirs(file_path: Path) -> None:
    music_dir = MUSIC_DIR.resolve()
    for directory in (file_path.parent, file_path.parent.parent):
        if directory == music_dir or not _is_under_music_dir(directory):
            return
        if any(directory.iterdir()):
            return
        directory.rmdir()


def _delete_track_file(entry: dict) -> None:
    path = Path(entry["path"]).resolve()
    if not _is_under_music_dir(path):
        raise DecisionError(f"Chemin hors de la bibliothèque : {path}")
    path.unlink(missing_ok=True)
    _remove_empty_dirs(path)
    entry["status"] = "deleted"


def _discard(entry: dict) -> tuple[str | None, str | None]:
    in_playlist = entry["status"] in PLAYLIST_STATUSES
    moved_to_id = (entry.get("movedTo") or {}).get("id")
    entry["decision"] = "discard"
    entry["decided_at"] = _now()
    entry["movedTo"] = None
    if entry["status"] == "downloaded" and entry.get("path"):
        _delete_track_file(entry)
    if not in_playlist:
        return None, None
    return entry.get("navidromeSongId"), moved_to_id


def _keep(entry: dict) -> None:
    if entry["status"] == "deleted" or not entry.get("path") or not Path(entry["path"]).exists():
        raise DecisionError("Le fichier n'existe plus")
    entry["decision"] = "keep"
    entry["decided_at"] = _now()


def _scan_library() -> None:
    if not navidrome.enabled():
        return
    try:
        navidrome.trigger_scan()
    except Exception:  # noqa: BLE001 — le scan est facultatif
        logger.warning("Scan Navidrome impossible après suppression", exc_info=True)


def _remove_from_playlist(playlist_id: str | None, song_ids: list[str]) -> None:
    if not song_ids or not playlist_id or not navidrome.enabled():
        return
    try:
        navidrome.remove_from_playlist(playlist_id, song_ids)
    except Exception:  # noqa: BLE001 — le retrait de la playlist est facultatif
        logger.warning("Retrait de la playlist Navidrome impossible", exc_info=True)


def _remove_from_navidrome_playlist(song_ids: list[str]) -> None:
    _remove_from_playlist(_read_state().get("navidrome_playlist_id"), song_ids)


def decide(recording_mbid: str, decision: str) -> dict:
    if decision not in DECISIONS:
        raise DecisionError(f"Décision inconnue : {decision}")
    with _editing_state() as state:
        entry = state["tracks"].get(recording_mbid)
        if entry is None:
            raise TrackNotFound(f"Piste inconnue : {recording_mbid}")
        if entry["status"] not in (*PLAYLIST_STATUSES, "deleted"):
            raise DecisionError("Cette piste n'a pas été téléchargée")
        status_before = entry["status"]
        song_to_remove, moved_to_id = None, None
        if decision == "keep":
            _keep(entry)
        else:
            song_to_remove, moved_to_id = _discard(entry)
        _write_m3u(state, entry["playlist"])
        result = _serialize_track(recording_mbid, entry)
    if song_to_remove:
        _remove_from_navidrome_playlist([song_to_remove])
        _remove_from_playlist(moved_to_id, [song_to_remove])
    if status_before != "deleted" and entry["status"] == "deleted":
        _scan_library()
    return result


def _movable_entry(recording_mbid: str) -> dict:
    entry = _read_state()["tracks"].get(recording_mbid)
    if entry is None:
        raise TrackNotFound(f"Piste inconnue : {recording_mbid}")
    if entry["status"] not in PLAYLIST_STATUSES:
        raise DecisionError("Cette piste n'est pas dans la bibliothèque")
    return entry


def _navidrome_song_id(entry: dict) -> str:
    song_id = entry.get("navidromeSongId") or navidrome.find_song_id(
        _relative_path(entry.get("path")), entry["title"], entry["artist"]
    )
    if not song_id:
        raise DecisionError("Piste introuvable dans Navidrome, lance un scan puis réessaie")
    return song_id


def _navidrome_playlist_name(playlist_id: str) -> str:
    playlist = next((p for p in navidrome.list_playlists() if p["id"] == playlist_id), None)
    if playlist is None:
        raise DecisionError("Playlist inconnue")
    return playlist["name"]


def _add_to_target_playlist(entry: dict, playlist_id: str) -> tuple[str, str]:
    try:
        song_id = _navidrome_song_id(entry)
        name = _navidrome_playlist_name(playlist_id)
        navidrome.add_to_playlist(playlist_id, [song_id])
    except navidrome.NavidromeError as exc:
        raise DecisionError(str(exc)) from exc
    except (RuntimeError, requests.RequestException) as exc:
        raise DecisionError(f"Navidrome : {exc}") from exc
    return song_id, name


def _record_move(recording_mbid: str, song_id: str, playlist_id: str, name: str) -> dict:
    with _editing_state() as state:
        entry = state["tracks"][recording_mbid]
        entry.update(
            decision="keep",
            decided_at=_now(),
            movedTo={"id": playlist_id, "name": name},
            navidromeSongId=song_id,
        )
        return _serialize_track(recording_mbid, entry)


def move_to_playlist(recording_mbid: str, playlist_id: str) -> dict:
    if not navidrome.enabled():
        raise DecisionError("Navidrome non configuré")
    entry = _movable_entry(recording_mbid)
    song_id, name = _add_to_target_playlist(entry, playlist_id)
    weekly_id = _read_state().get("navidrome_playlist_id")
    previous_id = (entry.get("movedTo") or {}).get("id")
    for source_id in {weekly_id, previous_id} - {None, playlist_id}:
        _remove_from_playlist(source_id, [song_id])
    return _record_move(recording_mbid, song_id, playlist_id, name)


def _is_expired(entry: dict, cutoff: datetime) -> bool:
    if entry["status"] != "downloaded" or entry.get("decision") or not entry.get("downloaded_at"):
        return False
    return datetime.fromisoformat(entry["downloaded_at"]) < cutoff


def apply_retention() -> None:
    if LISTENBRAINZ_RETENTION_DAYS <= 0:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(days=LISTENBRAINZ_RETENTION_DAYS)
    with _editing_state() as state:
        expired = [e for e in state["tracks"].values() if _is_expired(e, cutoff)]
        songs_to_remove = [song_id for song_id, _ in map(_discard, expired) if song_id]
        for playlist_mbid in {e["playlist"] for e in expired}:
            _write_m3u(state, playlist_mbid)
    if expired:
        logger.info("Rétention : %d piste(s) non triée(s) supprimée(s)", len(expired))
        _remove_from_navidrome_playlist(songs_to_remove)
        _scan_library()


def _tracks_missing_from_playlist(state: dict) -> list[tuple[str, dict]]:
    return [
        (mbid, entry) for mbid, entry in state["tracks"].items()
        if entry["status"] in PLAYLIST_STATUSES
        and entry.get("decision") != "discard"
        and entry.get("path")
        and not entry.get("navidromeSongId")
    ]


def sync_navidrome_playlist() -> None:
    if not navidrome.enabled():
        return
    missing = _tracks_missing_from_playlist(_read_state())
    if not missing:
        return
    playlist_id = _navidrome_playlist_id()
    if not playlist_id:
        return
    found = {}
    for mbid, entry in missing:
        song_id = navidrome.find_song_id(_relative_path(entry["path"]), entry["title"], entry["artist"])
        if song_id:
            found[mbid] = song_id
    if not found:
        return
    try:
        navidrome.add_to_playlist(playlist_id, list(found.values()))
    except Exception:  # noqa: BLE001 — l'ajout sera retenté au prochain passage
        logger.warning("Ajout a posteriori à la playlist Navidrome impossible", exc_info=True)
        return
    with _editing_state() as state:
        for mbid, song_id in found.items():
            state["tracks"][mbid]["navidromeSongId"] = song_id
    logger.info("Playlist Navidrome : %d piste(s) ajoutée(s) a posteriori", len(found))


def fail_interrupted_tracks() -> None:
    with _editing_state() as state:
        for entry in state["tracks"].values():
            job_id = state["playlists"].get(entry["playlist"], {}).get("job_id")
            if entry["status"] == "pending" and job_id and job_id not in jobs:
                entry["status"] = "error"
                entry["error"] = "Téléchargement interrompu"


def _serialize_track(mbid: str, entry: dict) -> dict:
    return {
        "mbid": mbid,
        "title": entry["title"],
        "artist": entry["artist"],
        "album": entry.get("album"),
        "thumbnail": entry.get("thumbnail"),
        "videoId": entry.get("videoId"),
        "status": entry["status"],
        "decision": entry.get("decision"),
        "path": _relative_path(entry.get("path")) if entry["status"] != "deleted" else None,
        "error": entry.get("error"),
        "movedTo": entry.get("movedTo"),
    }


def playlists_with_tracks() -> list[dict]:
    state = _read_state()
    playlists = [
        {
            "mbid": mbid,
            "title": playlist["title"],
            "date": playlist["date"],
            "source": playlist["source"],
            "jobId": playlist.get("job_id"),
            "processedAt": playlist.get("processed_at"),
            "tracks": [
                _serialize_track(track_mbid, entry)
                for track_mbid, entry in state["tracks"].items()
                if entry["playlist"] == mbid
            ],
        }
        for mbid, playlist in state["playlists"].items()
    ]
    return sorted(playlists, key=lambda p: p["date"], reverse=True)


def _sync_all_sources() -> None:
    for source in SOURCES:
        sync_latest(source)


def _run_pass() -> None:
    for step in (_sync_all_sources, fail_interrupted_tracks, apply_retention, sync_navidrome_playlist):
        try:
            step()
        except Exception:  # noqa: BLE001 — le thread de fond ne doit jamais s'arrêter
            logger.exception("Passage ListenBrainz en échec")


def _background_loop() -> None:
    time.sleep(FIRST_PASS_DELAY)
    while True:
        _run_pass()
        time.sleep(LISTENBRAINZ_CHECK_HOURS * 3600)


def start_background() -> None:
    global _background_started
    if _background_started or not enabled():
        return
    _background_started = True
    threading.Thread(target=_background_loop, name="listenbrainz", daemon=True).start()
