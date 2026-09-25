"""Accès à Navidrome via l'API Subsonic : scan de bibliothèque et playlists."""

import hashlib
import os
import secrets
import time
import unicodedata

import requests


def _with_scheme(url: str) -> str:
    if not url or "://" in url:
        return url
    return f"https://{url}"


NAVIDROME_URL = _with_scheme(os.environ.get("NAVIDROME_URL", "").strip().rstrip("/"))
NAVIDROME_USER = os.environ.get("NAVIDROME_USER", "")
NAVIDROME_PASS = os.environ.get("NAVIDROME_PASS", "")

SCAN_POLL_INTERVAL = 2.0


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
        message = data.get("error", {}).get("message", "réponse inattendue")
        raise RuntimeError(f"Navidrome : {message}")
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
    return unicodedata.normalize("NFC", path)


def _search_song_id(query: str, relative_path: str) -> str | None:
    data = _call(
        "search3",
        {"query": query, "songCount": 50, "artistCount": 0, "albumCount": 0},
    )
    target = _normalize(relative_path)
    for song in data.get("searchResult3", {}).get("song", []):
        if _normalize(song.get("path", "")) == target:
            return song["id"]
    return None


def find_song_id(relative_path: str, title: str, artist: str) -> str | None:
    return _search_song_id(f"{title} {artist}", relative_path) or _search_song_id(
        title, relative_path
    )


def add_to_playlist(playlist_id: str, song_ids: list[str]) -> None:
    _call("updatePlaylist", {"playlistId": playlist_id, "songIdToAdd": song_ids})


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
        _call("updatePlaylist", {"playlistId": playlist_id, "songIndexToRemove": indexes})
