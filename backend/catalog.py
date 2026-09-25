"""Accès partagé à YouTube Music : client, mise en forme des résultats, métadonnées."""

from ytmusicapi import YTMusic

from downloader import best_thumbnail

ytmusic = YTMusic()


def artists_str(artists: list[dict] | None) -> str:
    return ", ".join(a["name"] for a in (artists or []) if a.get("name")) or "Inconnu"


def song_from_search(result: dict) -> dict:
    album = result.get("album") or {}
    return {
        "videoId": result["videoId"],
        "title": result.get("title", ""),
        "artist": artists_str(result.get("artists")),
        "album": album.get("name"),
        "albumId": album.get("id"),
        "duration": result.get("duration"),
        "thumbnail": best_thumbnail(result.get("thumbnails")),
    }


def _enrich_from_album(meta: dict, video_id: str, album_id: str) -> str | None:
    album = ytmusic.get_album(album_id)
    meta["album"] = album.get("title") or meta["album"]
    meta["album_artist"] = artists_str(album.get("artists"))
    meta["year"] = album.get("year")
    album_tracks = album.get("tracks", [])
    meta["track_total"] = len(album_tracks) or None
    for i, track in enumerate(album_tracks):
        if track.get("videoId") == video_id:
            meta["track"] = track.get("trackNumber") or i + 1
            break
    return best_thumbnail(album.get("thumbnails"))


def build_song_meta(video_id: str, title: str, artist: str, album: str | None = None,
                    album_id: str | None = None,
                    thumbnail: str | None = None) -> tuple[dict, str | None]:
    meta = {
        "title": title,
        "artist": artist,
        "album_artist": artist,
        "album": album,
        "year": None,
        "track": None,
        "track_total": None,
    }
    cover_url = thumbnail
    if album_id:
        try:
            cover_url = _enrich_from_album(meta, video_id, album_id) or cover_url
        except Exception:  # noqa: BLE001 — tagging minimal si l'album est inaccessible
            pass
    return meta, cover_url
