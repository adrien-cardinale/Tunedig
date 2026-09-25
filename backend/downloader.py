"""Téléchargement yt-dlp + tagging (ID3/Vorbis/MP4) pour Navidrome."""

import base64
import logging
import os
import re
import shutil
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Callable

import requests
import yt_dlp

import navidrome
from mutagen.flac import Picture
from mutagen.id3 import APIC, ID3, TALB, TDRC, TIT2, TPE1, TPE2, TRCK
from mutagen.mp4 import MP4, MP4Cover
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis

MUSIC_DIR = Path(os.environ.get("MUSIC_DIR", str(Path.home() / "music")))

# Formats de sortie proposés à l'utilisateur.
# "best" = extraction sans réencodage (Opus/M4A selon la source).
QUALITIES = {
    "best": {"preferredcodec": "best"},
    "mp3-320": {"preferredcodec": "mp3", "preferredquality": "320"},
    "mp3-v0": {"preferredcodec": "mp3", "preferredquality": "0"},
    "mp3-192": {"preferredcodec": "mp3", "preferredquality": "192"},
    "mp3-128": {"preferredcodec": "mp3", "preferredquality": "128"},
}

AUDIO_EXTS = {".mp3", ".opus", ".ogg", ".m4a", ".aac", ".flac", ".wav"}

logger = logging.getLogger(__name__)

jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def sanitize(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    return name.strip().rstrip(".") or "Inconnu"


def best_thumbnail(thumbnails: list[dict] | None) -> str | None:
    if not thumbnails:
        return None
    url = max(thumbnails, key=lambda t: t.get("width", 0))["url"]
    # Les pochettes YouTube Music acceptent une taille arbitraire dans l'URL
    return re.sub(r"=w\d+-h\d+.*$", "=w600-h600-l90-rj", url)


def fetch_cover(url: str | None) -> bytes | None:
    if not url:
        return None
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        return resp.content
    except requests.RequestException:
        return None


def list_formats(video_id: str) -> list[dict]:
    """Formats audio disponibles à la source, du meilleur au moins bon."""
    opts = {"quiet": True, "no_warnings": True, "noplaylist": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(
            f"https://music.youtube.com/watch?v={video_id}", download=False
        )
    out = []
    for f in info.get("formats", []):
        if f.get("acodec") in (None, "none"):
            continue
        if f.get("vcodec") not in (None, "none"):
            continue
        out.append({
            "formatId": f["format_id"],
            "ext": f.get("ext"),
            "codec": f.get("acodec"),
            "abr": f.get("abr"),
            "filesize": f.get("filesize") or f.get("filesize_approx"),
        })
    out.sort(key=lambda x: x["abr"] or 0, reverse=True)
    return out


# ---------------------------------------------------------------- tagging

def _cover_mime(cover: bytes) -> str:
    return "image/png" if cover[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"


def _tag_id3(path: Path, meta: dict, cover: bytes | None) -> None:
    tags = ID3()
    tags.add(TIT2(encoding=3, text=meta["title"]))
    tags.add(TPE1(encoding=3, text=meta["artist"]))
    tags.add(TPE2(encoding=3, text=meta.get("album_artist") or meta["artist"]))
    tags.add(TALB(encoding=3, text=meta.get("album") or meta["title"]))
    if meta.get("year"):
        tags.add(TDRC(encoding=3, text=str(meta["year"])))
    if meta.get("track"):
        total = meta.get("track_total")
        trck = f"{meta['track']}/{total}" if total else str(meta["track"])
        tags.add(TRCK(encoding=3, text=trck))
    if cover:
        tags.add(APIC(encoding=3, mime=_cover_mime(cover), type=3, desc="Cover", data=cover))
    tags.save(path, v2_version=3)


def _tag_vorbis(path: Path, meta: dict, cover: bytes | None) -> None:
    audio = OggOpus(path) if path.suffix.lower() == ".opus" else OggVorbis(path)
    audio["title"] = [meta["title"]]
    audio["artist"] = [meta["artist"]]
    audio["albumartist"] = [meta.get("album_artist") or meta["artist"]]
    audio["album"] = [meta.get("album") or meta["title"]]
    if meta.get("year"):
        audio["date"] = [str(meta["year"])]
    if meta.get("track"):
        audio["tracknumber"] = [str(meta["track"])]
        if meta.get("track_total"):
            audio["tracktotal"] = [str(meta["track_total"])]
    if cover:
        pic = Picture()
        pic.type = 3
        pic.mime = _cover_mime(cover)
        pic.data = cover
        audio["metadata_block_picture"] = [base64.b64encode(pic.write()).decode()]
    audio.save()


def _tag_mp4(path: Path, meta: dict, cover: bytes | None) -> None:
    audio = MP4(path)
    audio["\xa9nam"] = [meta["title"]]
    audio["\xa9ART"] = [meta["artist"]]
    audio["aART"] = [meta.get("album_artist") or meta["artist"]]
    audio["\xa9alb"] = [meta.get("album") or meta["title"]]
    if meta.get("year"):
        audio["\xa9day"] = [str(meta["year"])]
    if meta.get("track"):
        audio["trkn"] = [(int(meta["track"]), int(meta.get("track_total") or 0))]
    if cover:
        fmt = MP4Cover.FORMAT_PNG if _cover_mime(cover) == "image/png" else MP4Cover.FORMAT_JPEG
        audio["covr"] = [MP4Cover(cover, imageformat=fmt)]
    audio.save()


def tag_file(path: Path, meta: dict, cover: bytes | None) -> None:
    ext = path.suffix.lower()
    if ext == ".mp3":
        _tag_id3(path, meta, cover)
    elif ext in (".opus", ".ogg"):
        _tag_vorbis(path, meta, cover)
    elif ext == ".m4a":
        _tag_mp4(path, meta, cover)
    # autres extensions : fichier livré sans tags plutôt que d'échouer


# ---------------------------------------------------------------- download

def _download_audio(video_id: str, dest_dir: Path, progress_cb,
                    quality: str, format_id: str | None = None) -> Path:
    """Télécharge une vidéo en audio dans dest_dir, renvoie le chemin du fichier."""

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                progress_cb(d.get("downloaded_bytes", 0) / total)
        elif d["status"] == "finished":
            progress_cb(1.0)

    opts = {
        "format": format_id or "bestaudio/best",
        "outtmpl": str(dest_dir / "%(id)s.%(ext)s"),
        "postprocessors": [
            {"key": "FFmpegExtractAudio", **QUALITIES.get(quality, QUALITIES["best"])}
        ],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "progress_hooks": [hook],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([f"https://music.youtube.com/watch?v={video_id}"])

    candidates = [
        p for p in dest_dir.glob(f"{video_id}.*") if p.suffix.lower() in AUDIO_EXTS
    ]
    if not candidates:
        raise RuntimeError("fichier audio introuvable après téléchargement")
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _finalize_track(tmp_file: Path, meta: dict,
                    cover: bytes | None) -> tuple[Path, bool]:
    artist_dir = MUSIC_DIR / sanitize(meta.get("album_artist") or meta["artist"])
    album_dir = artist_dir / sanitize(meta.get("album") or meta["title"])
    album_dir.mkdir(parents=True, exist_ok=True)
    ext = tmp_file.suffix
    if meta.get("track"):
        filename = f"{int(meta['track']):02d} - {sanitize(meta['title'])}{ext}"
    else:
        filename = f"{sanitize(meta['title'])}{ext}"
    final = album_dir / filename
    if final.exists():
        tmp_file.unlink(missing_ok=True)
        return final, True
    tag_file(tmp_file, meta, cover)
    shutil.move(str(tmp_file), final)
    return final, False


def create_job(kind: str, title: str, artist: str, thumbnail: str | None,
               tracks: list[dict], quality: str,
               playlist_id: str | None = None) -> dict:
    job = {
        "id": uuid.uuid4().hex[:12],
        "kind": kind,  # "song" | "album" | "playlist"
        "title": title,
        "artist": artist,
        "thumbnail": thumbnail,
        "quality": quality,
        "status": "queued",  # queued | downloading | done | error
        "progress": 0.0,
        "error": None,
        "scan": None,  # "ok" | "échec : …" une fois le scan Navidrome tenté
        "playlistId": playlist_id,
        "playlist": None,
        "tracks": [
            {"title": t["title"], "status": "queued", "progress": 0.0} for t in tracks
        ],
    }
    with _jobs_lock:
        jobs[job["id"]] = job
    return job


def _track_cover(track: dict, job_cover: bytes | None,
                 cache: dict[str, bytes | None]) -> bytes | None:
    url = track.get("cover_url")
    if not url:
        return job_cover
    if url not in cache:
        cache[url] = fetch_cover(url)
    return cache[url] or job_cover


def _finish_job(job: dict, errors: list[str]) -> None:
    if errors and all(t["status"] == "error" for t in job["tracks"]):
        job["status"] = "error"
        job["error"] = "; ".join(errors)
        return
    job["status"] = "done"
    job["error"] = "; ".join(errors) or None
    if navidrome.enabled():
        try:
            navidrome.trigger_scan()
            job["scan"] = "ok"
        except Exception as exc:  # noqa: BLE001 — le scan ne doit pas faire échouer le job
            job["scan"] = f"échec : {exc}"


def _playlist_song_ids(job: dict, tracks: list[dict]) -> tuple[list[str], int]:
    song_ids = []
    done = [
        (jt, track) for jt, track in zip(job["tracks"], tracks)
        if jt["status"] == "done" and jt.get("path")
    ]
    for jt, track in done:
        relative = Path(jt["path"]).relative_to(MUSIC_DIR).as_posix()
        meta = track["meta"]
        song_id = navidrome.find_song_id(relative, meta["title"], meta["artist"])
        if song_id:
            song_ids.append(song_id)
    return song_ids, len(done)


def _add_to_playlist(job: dict, tracks: list[dict], playlist_id: str) -> None:
    if not navidrome.enabled():
        job["playlist"] = "échec : Navidrome non configuré"
        return
    try:
        navidrome.wait_for_scan()
        song_ids, expected = _playlist_song_ids(job, tracks)
        if song_ids:
            navidrome.add_to_playlist(playlist_id, song_ids)
        found = len(song_ids)
        job["playlist"] = "ok" if found == expected else f"partiel : {found}/{expected}"
    except Exception as exc:  # noqa: BLE001 — l'ajout en playlist ne doit pas faire échouer le job
        job["playlist"] = f"échec : {exc}"


def run_job(job: dict, tracks: list[dict], cover_url: str | None, quality: str,
            on_done: Callable[[dict], None] | None = None,
            playlist_id: str | None = None) -> None:
    """Exécuté dans un thread. tracks: [{video_id, title, meta{...}, format_id?, cover_url?}]."""
    job["status"] = "downloading"
    cover = fetch_cover(cover_url)
    covers: dict[str, bytes | None] = {}
    errors = []
    with tempfile.TemporaryDirectory(prefix="tunedig-") as tmp:
        tmp_dir = Path(tmp)
        for i, track in enumerate(tracks):
            jt = job["tracks"][i]
            jt["status"] = "downloading"

            def cb(p, jt=jt, i=i):
                jt["progress"] = p
                job["progress"] = (i + p) / len(tracks)

            try:
                audio = _download_audio(
                    track["video_id"], tmp_dir, cb, quality, track.get("format_id")
                )
                final, existed = _finalize_track(
                    audio, track["meta"], _track_cover(track, cover, covers)
                )
                jt["path"] = str(final)
                jt["existed"] = existed
                jt["status"] = "done"
                jt["progress"] = 1.0
            except Exception as exc:  # noqa: BLE001 — un échec de piste ne stoppe pas l'album
                jt["status"] = "error"
                jt["error"] = str(exc)
                errors.append(f"{track['title']}: {exc}")
            job["progress"] = (i + 1) / len(tracks)

    _finish_job(job, errors)
    if playlist_id and job["status"] != "error":
        _add_to_playlist(job, tracks, playlist_id)
    if on_done is not None:
        try:
            on_done(job)
        except Exception:  # noqa: BLE001 — un callback défaillant ne doit pas tuer le thread
            logger.exception("Callback de fin du job %s en échec", job["id"])


def start_job(kind: str, title: str, artist: str, thumbnail: str | None,
              tracks: list[dict], cover_url: str | None, quality: str = "best",
              on_done: Callable[[dict], None] | None = None,
              playlist_id: str | None = None) -> dict:
    job = create_job(kind, title, artist, thumbnail, tracks, quality, playlist_id)
    threading.Thread(
        target=run_job,
        args=(job, tracks, cover_url, quality, on_done, playlist_id),
        daemon=True,
    ).start()
    return job
