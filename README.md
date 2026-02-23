# Netflix Clone (Bun + Vanilla JS)

This project is a local Netflix-style streaming app with:

- A browse/home UI (`index.html`)
- A full custom player (`player.html`)
- A settings UI (`settings.html`)
- A local upload workflow (`upload.html`)
- A Bun backend (`server.js`) that handles metadata, stream resolving, remux/HLS/subtitles, caching, and local library management

## Table of Contents

1. Overview
2. Architecture
3. Features
4. Page-by-Page Behavior
5. API Reference
6. Environment Variables
7. Data, Cache, and Persistence
8. Local Development
9. Operational Notes
10. Troubleshooting

## 1) Overview

The app combines two media paths:

- Remote resolver path:
  - TMDB metadata + Torrentio stream candidates + Real-Debrid unrestricted links
  - Server selects candidates, probes tracks, and returns a playable source
- Local media path:
  - You upload `.mp4` / `.mkv`
  - Server processes files into `assets/videos` and updates `assets/library.json`
  - Home and player can play those local sources

## 2) Architecture

### Runtime

- Backend: Bun server in `server.js`
- Frontend: static HTML/CSS/JS in repository root
- External tools: `ffmpeg`, `ffprobe`, optional `mpv`
- Caching: in-memory + persistent SQLite-backed cache data (managed inside `server.js`)

### Main files

- `server.js`: API, static serving, resolving, remux/HLS/subtitles, upload processing, caching, health/debug
- `index.html` + `script.js`: home screen, hero, continue watching, details modal, account menu
- `player.html` + `player.js`: video playback UI, source selection, subtitles/audio handling, fallback logic
- `settings.html` + `settings.js`: quality/source/profile/native-playback/remux preferences
- `upload.html` + `upload.js`: upload and metadata inference flow
- `assets/library.json`: local media catalog

## 3) Features

### Playback and streaming

- Custom HTML5 player controls (play/pause, seek ±10s, volume/mute, speed, captions, fullscreen)
- Multiple playback modes:
  - direct `src`
  - TMDB resolve flow (`/api/resolve/movie`, `/api/resolve/tv`)
  - fallback asset playback
- Server remux endpoint (`/api/remux`) with selectable audio/subtitle stream indexes
- HLS endpoints for playlist + segment serving
- Subtitle extraction to VTT from embedded streams and external subtitle providers
- Automatic subtitle prewarm for selected subtitle streams on resolve responses

### Metadata and discovery

- TMDB popular movies
- TMDB details (movie/tv + credits)
- TMDB TV season episode metadata helper
- Details modal on home cards

### Source selection and quality filters

- Stored stream quality preference (`auto`, `2160p`, `1080p`, `720p`)
- Source filter settings:
  - minimum seeders
  - results limit (1-20)
  - language filter (`en`, `any`, `fr`, `es`, `de`, `it`, `pt`)
  - allowed container formats (currently MP4)
- Preference-aware resolving (language/quality/filter params passed to resolve endpoints)

### Upload and local library

- Drag/drop upload UI
- Supported input: `.mp4`, `.mkv`
- Chunked upload session flow (start/chunk/finish)
- Post-upload compatibility probe using `ffprobe`
- Optional audio-only transcode to AAC (video stream copied) for browser-audio compatibility
- Upload metadata inference endpoint (`/api/upload/infer`) for movie/episode autofill
- Local catalog endpoint (`/api/library`) feeds uploaded media into browse/player flows

### Continue watching and resume

- Local resume storage (`netflix-resume:*`)
- Continue watching metadata store (`netflix-continue-watching-meta`)
- Server-side playback sessions supported via `/api/session/progress` when enabled

### User preferences

- Subtitle color preference
- Profile avatar preset or custom uploaded image
- Native playback mode preference (`auto`/`off`)
- Remux video mode preference (`auto`/`copy`/`normalize`)
- Per-title language preference persistence (`/api/title/preferences`)

### Operations and debugging

- Health endpoint with ffmpeg/ffprobe capability info
- Native player capability endpoint
- Cache stats endpoint + cache clear action
- Settings page button to clear all server caches

## 4) Page-by-Page Behavior

### Home (`index.html` + `script.js`)

- Hero trailer section with:
  - play button -> opens player
  - info button -> scrolls to rows/details context
  - mute toggle
- Continue watching row built from resume metadata
- Popular/content rows hydrated from backend + local library items
- Uploaded local `/media/...` launches include `audioLang=en` by default
- Details modal for richer metadata and playback launch
- Account menu links to Upload and Settings

### Player (`player.html` + `player.js`)

- Accepts URL params including `tmdbId`, `mediaType`, `title`, `src`, `audioLang`, `quality`, `subtitleLang`
- Chooses source path based on params and resolver results
- Attaches subtitles/audio tracks and keeps selected preferences
- Explicit/local `src` playback can probe media tracks via `/api/media/tracks` and preselect audio/subtitle streams
- For uploaded local media, English audio is preferred when an English track exists
- Handles stream fallback and recovery behavior
- Uses remux/HLS/subtitle endpoints when needed

Keyboard controls:

- `Space`: play/pause
- `ArrowLeft` / `ArrowRight`: seek -10s / +10s
- `M`: mute
- `F`: fullscreen
- `[` / `]`: adjust audio sync (remux path)
- `Escape`: close overlays or exit flow/fullscreen state

### Settings (`settings.html` + `settings.js`)

- Stream quality preference
- Subtitle color picker/reset
- Source filters (seeders, result limit, language, formats)
- Native playback mode and remux mode preferences
- Avatar style presets + custom image crop/resize pipeline
- Cache clear action hitting `/api/debug/cache?clear=1`

### Upload (`upload.html` + `upload.js`)

- Drag/drop or file picker
- Content type: movie or episode
- Filename inference call to `/api/upload/infer`
- Chunked transfer to:
  - `POST /api/upload/session/start`
  - `POST /api/upload/session/chunk`
  - `POST /api/upload/session/finish`

## 5) API Reference

All API routes are served by `server.js`.

### Config, health, debug

- `GET /api/config`
- `GET /api/health[?refresh=1]`
- `GET /api/debug/cache`
- `GET /api/debug/cache?clear=1`

### Native player

- `GET /api/native/player[?refresh=1]`
- `POST /api/native/play`

`/api/native/play` is loopback-restricted and launches `mpv` when available and enabled.

### Library and uploads

- `GET /api/library`
- `POST /api/upload`
- `POST /api/upload/infer`
- `POST /api/upload/session/start`
- `POST /api/upload/session/chunk?sessionId=...`
- `POST /api/upload/session/finish`

### TMDB

- `GET /api/tmdb/popular-movies?page=...`
- `GET /api/tmdb/details?tmdbId=...&mediaType=movie|tv`
- `GET /api/tmdb/tv/season?tmdbId=...&seasonNumber=...`

### Resolver

- `GET /api/resolve/sources?...` (candidate list)
- `GET /api/resolve/movie?...`
- `GET /api/resolve/tv?...`

Common resolver query params include:

- `tmdbId`
- `audioLang`
- `quality`
- `subtitleLang`
- `sourceHash`
- `minSeeders`
- `allowedFormats`
- `sourceLang`

TV-specific params:

- `seasonNumber` / `season`
- `episodeNumber` / `episodeOrdinal`

### Playback, subtitles, preferences, sessions

- `GET /api/media/tracks?input=...&audioLang=...&subtitleLang=...`
- `GET /api/remux?input=...&start=...&audioStream=...&subtitleStream=...&audioSyncMs=...&videoMode=...`
- `GET /api/hls/master.m3u8?input=...&audioStream=...`
- `GET /api/hls/segment.ts?input=...&index=...&audioStream=...`
- `GET /api/subtitles.vtt?input=...&subtitleStream=...`
- `GET /api/subtitles.external.vtt?download=...`
- `GET|POST|DELETE /api/title/preferences`
- `POST /api/session/progress`

## 6) Environment Variables

Copy `.env.example` to `.env` and fill required keys.

Required integrations:

- `TMDB_API_KEY`
- `REAL_DEBRID_TOKEN`

Codex/OpenAI-assisted metadata inference:

- `CODEX_AUTH_FILE`
- `CODEX_URL`
- `CODEX_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_RESPONSES_MODEL`

Runtime:

- `TORRENTIO_BASE_URL`
- `HOST`
- `PORT`
- `MAX_UPLOAD_BYTES`
- `HLS_HWACCEL` (`none|auto|videotoolbox|cuda|qsv`)
- `AUTO_AUDIO_SYNC` (`0|1`)
- `REMUX_VIDEO_MODE` (`auto|copy|normalize`)
- `PLAYBACK_SESSIONS` (`0|1`)
- `NATIVE_PLAYBACK` (`auto|off`)
- `MPV_BINARY`

## 7) Data, Cache, and Persistence

### LocalStorage keys

- `netflix-stream-quality-pref`
- `netflix-subtitle-color-pref`
- `netflix-source-filter-min-seeders`
- `netflix-source-filter-allowed-formats`
- `netflix-source-filter-language`
- `netflix-source-filter-results-limit`
- `netflix-native-playback-mode`
- `netflix-remux-video-mode`
- `netflix-profile-avatar-style`
- `netflix-profile-avatar-mode`
- `netflix-profile-avatar-image`
- `netflix-audio-lang:movie:<tmdbId>`
- `netflix-subtitle-lang:movie:<tmdbId>`
- `netflix-subtitle-stream:movie:<tmdbId>`
- `netflix-resume:<sourceIdentity>`
- `netflix-continue-watching-meta`

### Server-managed persistence/caching

- In-memory TTL caches for TMDB responses, resolved streams, quick-start and lookup data
- Persistent cache tables used for resolved data/session/probe/source-health/title-preference retention
- Periodic cache sweeping and stale HLS/upload-session cleanup

### Local media files

- Upload temp files under `cache/uploads`
- Final media files under `assets/videos`
- Catalog metadata in `assets/library.json`

## 8) Local Development

Prerequisites:

- Bun
- `ffmpeg` and `ffprobe` on `PATH`
- Optional: `mpv` on `PATH` for native handoff

Setup:

```bash
cp .env.example .env
bun install
bun run dev
```

Open:

- `http://127.0.0.1:5173`

Scripts:

- `bun run dev` -> Bun server (`server.js`)
- `bun run dev:vite` -> frontend-only Vite dev server
- `bun run build` / `bun run preview` -> Vite build/preview flow

## 9) Operational Notes

- `bun run dev` is the full-stack runtime path for `/api/*`.
- `bun run dev:vite` does not replace backend APIs in `server.js`.
- Native playback launch is intentionally loopback-only.
- Upload processing depends on ffmpeg availability.
- Upload compatibility handling:
  - media is probed after upload
  - audio-only AAC transcode can be applied when enabled and needed
- Cache clear from Settings applies globally (all titles/sources).

## 10) Troubleshooting

- `TMDB`/resolver errors:
  - verify `TMDB_API_KEY`, `REAL_DEBRID_TOKEN`, network access
- Upload fails:
  - ensure file is `.mp4`/`.mkv`
  - check `MAX_UPLOAD_BYTES`
  - ensure ffmpeg is installed
- Subtitles unavailable:
  - stream may not include text subtitle track
  - external subtitle provider may not have matching data
- Native playback does not launch:
  - ensure `NATIVE_PLAYBACK=auto` (or Settings equivalent)
  - ensure `mpv` is installed or `MPV_BINARY` points correctly
- Playback stutter/compatibility issues:
  - use remux mode `normalize` for toughest sources
  - check `/api/health` and `/api/config` for ffmpeg/hwaccel status
