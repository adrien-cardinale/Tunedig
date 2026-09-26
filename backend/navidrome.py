"""Accès à Navidrome via l'API Subsonic : scan de bibliothèque et playlists."""

import hashlib
import os
import re
import secrets
import time
import unicodedata
from pathlib import PurePosixPath

import requests


def _with_scheme(url: str) -> str:
    if not url or "://" in url:
        return url
    return f"https://{url}"


NAVIDROME_URL = _with_scheme(os.environ.get("NAVIDROME_URL", "").strip().rstrip("/"))
NAVIDROME_USER = os.environ.get("NAVIDROME_USER", "")
NAVIDROME_PASS = os.environ.get("NAVIDROME_PASS", "")

SCAN_POLL_INTERVAL = 2.0
SEARCH_SONG_COUNT = 500
SUBSONIC_NOT_AUTHORIZED = 50

PLAYLIST_NOT_EDITABLE = (
    "playlist non modifiable : auto-import activé, smart playlist "
    "ou playlist d'un autre utilisateur"
)


class NavidromeError(RuntimeError):
    def __init__(self, message: str, code: int | None = None):
        super().__init__(f"Navidrome : {message}")
        self.code = code


def enabled() -> bool:
    return bool(NAVIDROME_URL and NAVIDROME_USER and NAVIDROME_PASS)


def _auth_params() -> dict:
    salt = secrets.token_hex(8)
    token = hashlib.md5((NAVIDROME_PASS + salt).encode()).hexdigest()
    return {
        "u": NAVIDROME_USER,
        "t": token,
        "s": salt,
        "v": "1.16.1",
        "c": "tunedig",
        "f": "json",
    }


def _call(endpoint: str, params: dict | None = None) -> dict:
    if not enabled():
        raise RuntimeError(
            "Navidrome non configuré (NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASS)"
        )
    resp = requests.get(
        f"{NAVIDROME_URL}/rest/{endpoint}",
        params={**_auth_params(), **(params or {})},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json().get("subsonic-response", {})
    if data.get("status") != "ok":
        error = data.get("error", {})
        raise NavidromeError(error.get("message", "réponse inattendue"), error.get("code"))
    return data


def trigger_scan() -> None:
    """Lance un scan de la bibliothèque. Lève une exception en cas d'échec."""
    _call("startScan")


def _playlist_summary(playlist: dict) -> dict:
    return {
        "id": playlist["id"],
        "name": playlist.get("name", ""),
        "songCount": playlist.get("songCount", 0),
    }


def list_playlists() -> list[dict]:
    data = _call("getPlaylists")
    playlists = data.get("playlists", {}).get("playlist", [])
    return [_playlist_summary(p) for p in playlists]


def create_playlist(name: str) -> dict:
    data = _call("createPlaylist", {"name": name})
    return {**_playlist_summary(data["playlist"]), "songCount": 0}


def wait_for_scan(timeout: float = 90.0) -> None:
    deadline = time.monotonic() + timeout
    # startScan démarre le scan en asynchrone : sans ce délai, getScanStatus peut encore répondre « pas de scan ».
    time.sleep(SCAN_POLL_INTERVAL)
    while _call("getScanStatus").get("scanStatus", {}).get("scanning"):
        if time.monotonic() >= deadline:
            raise RuntimeError("scan trop long")
        time.sleep(SCAN_POLL_INTERVAL)


def _normalize(path: str) -> str:
    return unicodedata.normalize("NFC", path).replace("\\", "/").casefold()


def _same_path(candidate: str, target: str) -> bool:
    candidate, target = _normalize(candidate), _normalize(target)
    return candidate == target or candidate.endswith("/" + target)


def _search_song_id(query: str, relative_path: str) -> str | None:
    if len(query.strip()) < 2:
        return None
    data = _call(
        "search3",
        {"query": query, "songCount": SEARCH_SONG_COUNT, "artistCount": 0, "albumCount": 0},
    )
    for song in data.get("searchResult3", {}).get("song", []):
        if _same_path(song.get("path", ""), relative_path):
            return song["id"]
    return None


def _file_stem(relative_path: str) -> str:
    stem = PurePosixPath(relative_path.replace("\\", "/")).stem
    return re.sub(r"^\d+\s*-\s*", "", stem)


def _search_queries(relative_path: str, title: str, artist: str) -> list[str]:
    folders = PurePosixPath(relative_path.replace("\\", "/")).parent.parts
    album = folders[-1] if folders else ""
    album_artist = folders[-2] if len(folders) >= 2 else ""
    stem = _file_stem(relative_path)
    queries = [f"{title} {artist}", title, f"{stem} {album_artist}", stem, album, album_artist]
    unique: dict[str, str] = {}
    for query in queries:
        query = query.strip()
        unique.setdefault(query.casefold(), query)
    return [q for q in unique.values() if q]


def find_song_id(relative_path: str, title: str, artist: str) -> str | None:
    for query in _search_queries(relative_path, title, artist):
        song_id = _search_song_id(query, relative_path)
        if song_id:
            return song_id
    return None


def _update_playlist(params: dict) -> None:
    try:
        _call("updatePlaylist", params)
    except NavidromeError as exc:
        if exc.code == SUBSONIC_NOT_AUTHORIZED:
            raise NavidromeError(PLAYLIST_NOT_EDITABLE, exc.code) from exc
        raise


def add_to_playlist(playlist_id: str, song_ids: list[str]) -> None:
    _update_playlist({"playlistId": playlist_id, "songIdToAdd": song_ids})


def find_playlist_by_name(name: str) -> dict | None:
    wanted = name.casefold()
    return next((p for p in list_playlists() if p["name"].casefold() == wanted), None)


def get_playlist_entries(playlist_id: str) -> list[dict]:
    data = _call("getPlaylist", {"id": playlist_id})
    return data.get("playlist", {}).get("entry", [])


def remove_from_playlist(playlist_id: str, song_ids: list[str]) -> None:
    unwanted = set(song_ids)
    indexes = [
        index for index, entry in enumerate(get_playlist_entries(playlist_id))
        if entry.get("id") in unwanted
    ]
    if indexes:
        _update_playlist({"playlistId": playlist_id, "songIndexToRemove": indexes})
