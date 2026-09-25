# yt-get

Web UI to search YouTube Music (tracks or albums), download them as audio
files via **yt-dlp** and tag them automatically (ID3v2.3: title, artist, album,
album artist, track number, year, cover art) so they are correctly recognized
by **Navidrome**.

Files are stored as `Artist/Album/NN - Title.mp3` in the music folder
(defaults to `~/music`, configurable through the `MUSIC_DIR` environment
variable).

## Docker (recommended)

```bash
docker compose up -d --build
```

Open <http://localhost:8000>. Music is written to the volume mounted on
`/music` — edit `docker-compose.yml` to point it at the library scanned by
Navidrome (and uncomment `user:` so the files are owned by your user rather
than root).

## Manual installation

Requirements: Python ≥ 3.10, Node ≥ 18, `ffmpeg` in the PATH. yt-dlp needs a
JavaScript runtime to solve YouTube's challenges: the `deno` pip package pulled
by `requirements.txt` provides one, as long as the virtualenv's `bin` is in the
PATH (activate it, or run through `.venv/bin/uvicorn` with `PATH=.venv/bin:$PATH`).

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cd ../frontend
npm install
```

### Development

```bash
# Terminal 1 — API (port 8000)
cd backend
MUSIC_DIR=~/music .venv/bin/uvicorn main:app --reload

# Terminal 2 — Frontend (port 5173, proxies /api to :8000)
cd frontend
npm run dev
```

Open <http://localhost:5173>.

### Production (without Docker)

```bash
cd frontend && npm run build
cd ../backend && MUSIC_DIR=/path/to/music .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```

The backend then serves the built frontend (`frontend/dist`) directly on
<http://localhost:8000>.

## How it works

- **Search**: `ytmusicapi` queries YouTube Music (cleaner results than
  YouTube: real titles, artists, albums, years, cover art).
- **Quality**: clicking a thumbnail opens its detail view (track or album);
  that is where the quality dropdown lives — **Original** (Opus/M4A extracted
  without re-encoding, recommended) or MP3 320 / V0 / 192 / 128 kbps — along
  with the download button. The choice is shared and remembered. (The API also
  exposes `GET /api/formats/{videoId}` to list the streams available at the
  source.)
- **Download**: `yt-dlp` fetches the selected audio stream and converts it
  with ffmpeg if needed. An album is a single job that downloads each track
  sequentially; a failed track does not stop the others.
- **Tagging**: `mutagen` writes tags according to the container — ID3v2.3 for
  MP3, Vorbis comments for Opus/Ogg, MP4 atoms for M4A — with embedded 600×600
  cover art. For a single, the original album is looked up to retrieve the
  year and track number. Navidrome reads all three formats.
- **Progress**: the side panel shows real-time progress (polled every
  second).

## Navidrome scan

If the `NAVIDROME_URL`, `NAVIDROME_USER` and `NAVIDROME_PASS` environment
variables are set (see `.env.example`), a library scan is triggered
automatically through the Subsonic API (`/rest/startScan`) after each
successful download, and a ⟳ button in the Downloads panel lets you start one
manually. Otherwise, run a scan from Navidrome or wait for its automatic scan.

## ListenBrainz Weekly Exploration

Every week, ListenBrainz generates a "Weekly Exploration" playlist of tracks
you have never listened to. yt-get can download it automatically so you can
try the tracks in Navidrome, then decide track by track what to keep.

Set these environment variables (with Docker: copy `.env.example` to `.env`):

| Variable | Default | Description |
| --- | --- | --- |
| `LISTENBRAINZ_USER` | | Your ListenBrainz user name |
| `LISTENBRAINZ_TOKEN` | | Your user token: ListenBrainz profile page → *User token* |
| `LISTENBRAINZ_RETENTION_DAYS` | `0` | Delete undecided tracks after this many days (`0` = never) |
| `LISTENBRAINZ_CHECK_HOURS` | `6` | Interval between two checks for a new playlist |

When both the user and the token are set:

- A background task checks ListenBrainz 10 seconds after startup, then every
  `LISTENBRAINZ_CHECK_HOURS` hours. When a new Weekly Exploration playlist
  is available, each track is matched on YouTube Music and downloaded in the
  best quality, as a single job visible in the Downloads panel. A track that
  already appeared in a previous week is skipped.
- Tracks are stored in the regular `Artist/Album/NN - Title.ext` tree. A file
  that already existed in the library is left untouched and marked as
  "already present".
- The **Découverte** tab lists the playlists with their tracks. Click the
  heart to keep a track, or the bin to delete it: the file is removed
  immediately (no confirmation), along with its album and artist folders
  when they become empty, and a Navidrome scan is triggered. Tracks that
  were already present are never deleted; the bin only marks them as not
  kept. The **Synchroniser** button forces a check.
- Tracks in error or not found on YouTube Music show a retry button, and
  **Relancer les échecs** retries all of them at once.
- Undecided tracks stay until you decide, unless
  `LISTENBRAINZ_RETENTION_DAYS` is greater than 0: undecided tracks older
  than that are then deleted automatically.
- An `.m3u` playlist is written to `Playlists/<title> <YYYY-MM-DD>.m3u` in
  the music folder, so Navidrome imports it. Deleted tracks are removed from
  it.
- The state (processed playlists, decisions) is stored in
  `.yt-get/listenbrainz.json` inside the music folder.

## Disclaimer

This tool is intended for **personal, private use** (building your own
self-hosted music library). It is neither affiliated with nor endorsed by
YouTube, Google or Navidrome.

Downloading content may violate YouTube's Terms of Service and the copyright
law applicable in your country. You are solely responsible for how you use
this software and the files obtained with it; do not host a publicly
accessible instance and do not redistribute downloaded content. The software
is provided "as is", without warranty of any kind.

## License

[MIT](LICENSE)
