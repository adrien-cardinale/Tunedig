"""API tunedig : recherche YouTube Music, téléchargement et tagging pour Navidrome."""

import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import listenbrainz
import navidrome
from catalog import artists_str, build_song_meta, song_from_search, ytmusic
from downloader import (
    MUSIC_DIR,
    QUALITIES,
    best_thumbnail,
    jobs,
    list_formats,
    start_job,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    listenbrainz.start_background()
    yield


app = FastAPI(title="tunedig", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/search")
def search(q: str, type: str = "songs"):
    if type not in ("songs", "albums"):
        raise HTTPException(400, "type doit être 'songs' ou 'albums'")
    results = ytmusic.search(q, filter=type, limit=20)
    out = []
    for r in results:
        if type == "songs":
            if not r.get("videoId"):
                continue
            out.append(song_from_search(r))
        else:
            if not r.get("browseId"):
                continue
            out.append({
                "browseId": r["browseId"],
                "title": r.get("title", ""),
                "artist": artists_str(r.get("artists")),
                "year": r.get("year"),
                "type": r.get("type"),
                "thumbnail": best_thumbnail(r.get("thumbnails")),
            })
    return out


@app.get("/api/album/{browse_id}")
def album(browse_id: str):
    try:
        a = ytmusic.get_album(browse_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(404, f"Album introuvable : {exc}") from exc
    return {
        "browseId": browse_id,
        "title": a.get("title", ""),
        "artist": artists_str(a.get("artists")),
        "year": a.get("year"),
        "thumbnail": best_thumbnail(a.get("thumbnails")),
        "tracks": [
            {
                "videoId": t.get("videoId"),
                "title": t.get("title", ""),
                "artist": artists_str(t.get("artists")) if t.get("artists") else None,
                "duration": t.get("duration"),
                "track": t.get("trackNumber") or i + 1,
            }
            for i, t in enumerate(a.get("tracks", []))
        ],
    }


@app.get("/api/formats/{video_id}")
def formats(video_id: str):
    try:
        return list_formats(video_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Formats indisponibles : {exc}") from exc


class SongRequest(BaseModel):
    videoId: str
    title: str
    artist: str
    album: str | None = None
    albumId: str | None = None
    thumbnail: str | None = None
    quality: str = "best"
    formatId: str | None = None
    playlistId: str | None = None


class AlbumRequest(BaseModel):
    browseId: str
    quality: str = "best"
    playlistId: str | None = None


class PlaylistCreateRequest(BaseModel):
    name: str


def _check_quality(quality: str) -> None:
    if quality not in QUALITIES:
        raise HTTPException(400, f"Qualité inconnue : {quality}")


@app.post("/api/download/song")
def download_song(req: SongRequest):
    _check_quality(req.quality)
    meta, cover_url = build_song_meta(
        req.videoId, req.title, req.artist, req.album, req.albumId, req.thumbnail
    )
    tracks = [{
        "video_id": req.videoId,
        "title": req.title,
        "meta": meta,
        "format_id": req.formatId,
    }]
    return start_job(
        "song", req.title, req.artist, req.thumbnail, tracks, cover_url, req.quality,
        playlist_id=req.playlistId,
    )


@app.post("/api/download/album")
def download_album(req: AlbumRequest):
    _check_quality(req.quality)
    a = album(req.browseId)
    playable = [t for t in a["tracks"] if t["videoId"]]
    if not playable:
        raise HTTPException(422, "Aucune piste téléchargeable dans cet album")
    tracks = [
        {
            "video_id": t["videoId"],
            "title": t["title"],
            "meta": {
                "title": t["title"],
                "artist": t["artist"] or a["artist"],
                "album_artist": a["artist"],
                "album": a["title"],
                "year": a["year"],
                "track": t["track"],
                "track_total": len(a["tracks"]),
            },
        }
        for t in playable
    ]
    return start_job(
        "album", a["title"], a["artist"], a["thumbnail"], tracks,
        a["thumbnail"], req.quality, playlist_id=req.playlistId,
    )


@app.get("/api/jobs")
def list_jobs():
    return list(reversed(list(jobs.values())))


@app.get("/api/config")
def config():
    return {
        "musicDir": str(MUSIC_DIR),
        "navidrome": navidrome.enabled(),
        "listenbrainz": listenbrainz.enabled(),
        "listenbrainzPlaylist": (
            listenbrainz.LISTENBRAINZ_PLAYLIST_NAME if navidrome.enabled() else None
        ),
    }


@app.post("/api/scan")
def scan():
    try:
        navidrome.trigger_scan()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Scan impossible : {exc}") from exc
    return {"ok": True}


def _require_navidrome() -> None:
    if not navidrome.enabled():
        raise HTTPException(400, "Navidrome non configuré")


@app.get("/api/navidrome/playlists")
def navidrome_playlists():
    _require_navidrome()
    try:
        return navidrome.list_playlists()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Playlists indisponibles : {exc}") from exc


@app.post("/api/navidrome/playlists")
def navidrome_create_playlist(req: PlaylistCreateRequest):
    _require_navidrome()
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "Nom de playlist vide")
    try:
        return navidrome.create_playlist(name)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Création de la playlist impossible : {exc}") from exc


class DecisionRequest(BaseModel):
    decision: str


@app.get("/api/listenbrainz/tracks")
def listenbrainz_tracks():
    return listenbrainz.playlists_with_tracks()


@app.post("/api/listenbrainz/sync")
def listenbrainz_sync():
    if not listenbrainz.enabled():
        raise HTTPException(400, "ListenBrainz non configuré")
    try:
        result = listenbrainz.sync_latest(background=True)
    except listenbrainz.ListenBrainzError as exc:
        raise HTTPException(502, str(exc)) from exc
    threading.Thread(target=listenbrainz.sync_navidrome_playlist, daemon=True).start()
    return result


@app.post("/api/listenbrainz/tracks/{mbid}/decision")
def listenbrainz_decision(mbid: str, req: DecisionRequest):
    try:
        return listenbrainz.decide(mbid, req.decision)
    except listenbrainz.TrackNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except listenbrainz.DecisionError as exc:
        raise HTTPException(400, str(exc)) from exc


class MoveRequest(BaseModel):
    playlistId: str


@app.post("/api/listenbrainz/tracks/{mbid}/move")
def listenbrainz_move(mbid: str, req: MoveRequest):
    try:
        return listenbrainz.move_to_playlist(mbid, req.playlistId)
    except listenbrainz.TrackNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except listenbrainz.DecisionError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/listenbrainz/retry")
def listenbrainz_retry():
    return {"count": listenbrainz.retry_tracks()}


@app.post("/api/listenbrainz/tracks/{mbid}/retry")
def listenbrainz_retry_track(mbid: str):
    try:
        return {"count": listenbrainz.retry_tracks([mbid])}
    except listenbrainz.TrackNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except listenbrainz.DecisionError as exc:
        raise HTTPException(400, str(exc)) from exc


# En production : sert le frontend compilé (frontend/dist)
_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
