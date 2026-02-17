# Netflix App Architecture and Playback README

This document explains how the current app works end-to-end: UI pages, APIs, resolver pipeline, transcoding, subtitle handling, sync logic, and caching/persistence.

## 1. Project Overview

This repository is a Bun server with static frontend pages (no frontend framework runtime in the main app):

- `server.js`: API + static file server + Real-Debrid/TMDB/Torrentio resolver + ffmpeg/ffprobe integration
- `index.html` + `script.js`: browse/home experience
- `player.html` + `player.js`: playback UI and stream orchestration
- `settings.html` + `settings.js`: quality preference UI
- `style.css`, `player.css`, `settings.css`: page styling

The app is designed around TMDB movie playback via Real-Debrid links, with server-side compatibility handling (remux/HLS).

## 2. Runtime Model

## 2.1 Single Bun Server

`bun run dev` runs `server.js`, which:

- serves static files (with byte-range support)
- exposes all `/api/*` endpoints
- spawns ffmpeg/ffprobe processes for probing/transcoding/subtitles

Default bind:

- host: `127.0.0.1`
- port: `5173`

## 2.2 Frontend Pages

- `/index.html`: browse page (hero trailer + cards + TMDB details modal)
- `/player.html`: full player page
- `/settings.html`: quality filter settings

## 2.3 External Services Used

- TMDB API (`api.themoviedb.org`) for metadata/details
- Torrentio stream catalog
- Real-Debrid API for torrent resolution + unrestricted download links

## 3. Local Setup

## 3.1 Prerequisites

- Bun
- `ffmpeg` and `ffprobe` in `PATH`
- TMDB API key
- Real-Debrid token

## 3.2 Install and Run

```bash
cp .env.example .env
bun install
bun run dev
```

Open: `http://127.0.0.1:5173`

Note:

- `bun run dev:vite` serves frontend via Vite only and is not the primary full-stack runtime path for APIs in `server.js`.

## 4. Configuration (`.env`)

Current environment variables:

- `TMDB_API_KEY`
- `REAL_DEBRID_TOKEN`
- `TORRENTIO_BASE_URL` (default: `https://torrentio.strem.fun`)
- `HOST` (default: `127.0.0.1`)
- `PORT` (default: `5173`)
- `HLS_HWACCEL`:
  - `none | auto | videotoolbox | cuda | qsv`
  - `auto` maps to `videotoolbox` on macOS, else `none`
- `AUTO_AUDIO_SYNC` (`0/1` style)
- `PLAYBACK_SESSIONS` (`0/1` style)

Operational notes:

- Auto A/V correction in `/api/remux` is controlled by `AUTO_AUDIO_SYNC`.
- Playback session persistence can be enabled server-side via `PLAYBACK_SESSIONS`, but the current player client currently does not send session progress updates (see section 13).

## 5. Frontend Behavior

## 5.1 Browse Page (`index.html`, `script.js`)

Main behavior:

- hero trailer (`intro.mp4`) with mute/play controls
- account menu with link to `settings.html`
- “Continue watching” card(s)
- “Popular on Netflix” section populated via backend TMDB endpoints
- details modal hydrated with `/api/tmdb/details`

Movie launch behavior:

- clicking hero/card/details-play navigates to `player.html` with query params
- for TMDB movies, stored preferences are injected into URL:
  - `audioLang` (if not `auto`)
  - `quality` (if not `auto`)

Current pinned popular fetch pattern:

- fetches metadata for TMDB IDs `155` (The Dark Knight) and `27205` (Inception), then renders those cards

## 5.2 Settings Page (`settings.html`, `settings.js`)

Current settings scope: **quality only**.

LocalStorage key:

- `netflix-stream-quality-pref`

Accepted values:

- `auto`, `2160p`, `1080p`, `720p`

## 5.3 Player Page (`player.html`, `player.js`)

Accepted query params:

- `title`
- `episode`
- `src` (explicit direct source path/url)
- `tmdbId`
- `mediaType` (movie/tv, but TMDB playback flow here is movie-oriented)
- `year`
- `audioLang`
- `quality`
- `subtitleLang`

Playback source modes:

1. explicit `src`
2. TMDB movie resolve via `/api/resolve/movie`
3. fallback static source (`intro.mp4`) when no source/tmdb

UI/interaction highlights:

- custom controls: play/pause, ±10s seek, mute, speed, subtitles, fullscreen
- stalled stream recovery + fallback source queue
- HLS.js support path with remux fallback
- external subtitle track attachment through `<track>` + `video.textTracks`

Important current UI state:

- captions popover is currently subtitles-focused
- audio track selection column is hidden in the current UI (DOM exists but is hidden by CSS class `subtitles-only`)
- manual audio-sync controls are removed from the UI

Preferences handled by player:

- audio language preference stored in localStorage per TMDB movie (`netflix-audio-lang:movie:<tmdbId>`)
- stream quality preference read from settings key
- subtitle preference persisted server-side via `/api/title/preferences`

Resume/session behavior:

- local resume storage is effectively disabled in current player implementation
- client session sync (`/api/session/progress`) is currently disabled by `canSyncPlaybackSession() => false`

## 6. API Surface

All API routes are implemented in `server.js`.

## 6.1 Metadata and Resolve APIs

- `GET /api/tmdb/popular-movies?page=<n>`
  - returns TMDB popular movie list + genre list + image base
- `GET /api/tmdb/details?tmdbId=<id>&mediaType=movie|tv`
  - returns detailed TMDB payload (with credits)
- `GET /api/resolve/movie?tmdbId=<id>&audioLang=<lang>&quality=<q>&subtitleLang=<lang>`
  - resolves a playable source via Real-Debrid flow
  - includes selected track indices + probe tracks + fallback URLs
  - prewarms subtitle VTT extraction for selected subtitle stream

## 6.2 Title Preference APIs

- `GET /api/title/preferences?tmdbId=<id>`
  - fetches stored audio/subtitle preference
- `POST /api/title/preferences`
  - body: `{ tmdbId, audioLang?, subtitleLang? }`
  - updates per-title track preferences
  - invalidates related resolve caches

## 6.3 Playback APIs

- `GET /api/remux?input=<url|path>&start=<sec>&audioStream=<idx>&subtitleStream=<idx>&audioSyncMs=<ms>`
  - ffmpeg remux stream to fMP4
- `GET /api/hls/master.m3u8?input=<url|path>&audioStream=<idx>`
  - HLS playlist generation
- `GET /api/hls/segment.ts?input=<url|path>&index=<i>&audioStream=<idx>`
  - HLS segment serving
- `GET /api/subtitles.vtt?input=<url|path>&subtitleStream=<idx>`
  - subtitle extraction to VTT + caching

## 6.4 Ops/Debug APIs

- `GET /api/config`
  - returns high-level config flags and effective HLS hwaccel mode
- `GET /api/health[?refresh=1]`
  - ffmpeg/ffprobe capability snapshot + uptime
- `GET /api/debug/cache`
  - cache statistics and sizing
- `GET /api/debug/cache?clear=1`
  - clears in-memory caches, persistent cache tables, HLS artifacts/jobs

## 6.5 Session API

- `POST /api/session/progress`
  - server supports it
  - current client path does not actively use it because session sync is disabled client-side

## 7. Static File Serving

Non-API requests are served by `serveStatic()` in `server.js`.

Features:

- path normalization with root containment check
- byte-range support (`Accept-Ranges: bytes`, partial `206` responses)

This matters for local large media playback and seek behavior.

## 8. Resolver Pipeline (TMDB -> Torrentio -> Real-Debrid)

Core flow (`resolveTmdbMovieViaRealDebrid`):

1. Fetch TMDB movie metadata (`imdb_id`, title/year/runtime)
2. Pull candidate streams from Torrentio by IMDb ID
3. Filter and rank candidates by:
   - requested quality preference
   - language heuristics
   - title/year match
   - runtime similarity
   - seed count
   - persisted source health score
4. For each candidate:
   - resolve through Real-Debrid (`addMagnet` / reusable torrent)
   - select video files
   - wait for RD cached/downloaded ready state
   - unrestrict links
   - verify candidate URLs
5. Build `playableUrl` + `fallbackUrls`
6. Probe media tracks with ffprobe
7. Pick preferred audio/subtitle streams
8. Normalize final source for software decode/remux preference

Safety filters:

- filename/title-year mismatch checks for resolved candidates
- stream verification with timeout and uncertain-status handling
- source health penalty weighting from persisted history

## 9. Media Probing and Track Selection

`probeMediaTracks()` uses `ffprobe` and persists parsed results in SQLite.

Parsed track model includes:

- video metadata (start time, frame rate, B-frames, codec)
- audio tracks (stream index, language, title, codec, channels, default)
- subtitle tracks (stream index, language, codec, text-based flag, generated VTT URL)

Subtitle text codec set considered VTT-convertible:

- `subrip`, `srt`, `ass`, `ssa`, `webvtt`, `mov_text`, `text`

Selection rules:

- audio:
  - exact preferred lang if provided
  - else default audio
  - else first audio
- subtitles:
  - if preference is empty/off -> none
  - else matching text-based language
  - else default text-based subtitle

## 10. Playback Adaptation and Transcoding

## 10.1 `/api/remux` (FFmpeg proxy)

Purpose:

- browser compatibility for problematic source containers/codecs
- server-side start offset seeks
- auto audio delay compensation
- optional subtitle stream mapping into MP4 (`mov_text`)

Current ffmpeg remux behavior:

- input: resolved source URL/path
- mapping:
  - video: `0:v:0` (copy)
  - audio: selected stream or default (`aac` transcode at `192k`)
  - subtitle: optional selected subtitle stream mapped and transcoded to `mov_text`
- output:
  - fragmented MP4 (`frag_keyframe+empty_moov+faststart`)

Response headers expose sync/debug metadata:

- `X-Audio-Shift-Ms`
- `X-Audio-Delay-Ms`
- `X-Audio-Advance-Ms`
- `X-Auto-Audio-Delay-Ms`
- `X-Manual-Audio-Sync-Ms`
- `X-Subtitle-Stream-Index`
- `X-Auto-Audio-Sync-Enabled`

## 10.2 `/api/hls/*` Job Model

HLS is job-based:

- one transcode job per `(input, audioStreamIndex)` key
- ffmpeg segmenter writes `.ts` files and playlist in `.hls-cache`
- segment requests wait for segment file availability
- job fallback path from hwaccel to software if needed
- idle jobs are pruned

HLS encode behavior:

- video transcode (`h264_videotoolbox` / `h264_nvenc` / `h264_qsv` / `libx264`)
- audio transcode to AAC (`160k`)
- subtitles are not embedded in HLS segment output in current path

## 10.3 Hardware Acceleration

On startup/refresh, server probes ffmpeg capabilities:

- available hwaccels
- encoder availability (`h264_videotoolbox`, `h264_nvenc`, `h264_qsv`)

Effective mode can differ from requested env mode and is visible via:

- `/api/config`
- `/api/health`

## 11. Subtitle Pipeline

Player subtitle rendering path:

- external VTT tracks attached in player (`<track kind="subtitles">`)
- selected track is forced to `showing` via `video.textTracks` control

Server subtitle extraction path (`/api/subtitles.vtt`):

1. check cached VTT file freshness
2. dedupe concurrent builds by `(source, subtitleStream)` key
3. run ffmpeg extraction to WebVTT
4. fallback map strategy (`0:<streamIndex>` then `0:s:<ordinal>`)
5. write cache if non-empty
6. if extraction fails/empty -> returns minimal empty `WEBVTT` response

Prewarm behavior:

- after `/api/resolve/movie`, selected subtitle stream extraction is prewarmed in background

## 12. A/V Sync Logic

Manual sync UI:

- removed from player UI
- player keeps manual offset effectively at `0`
- `audioSyncMs` is stripped from player URL

Server auto-sync (`/api/remux` only):

Inputs:

- video start timestamp
- selected audio start timestamp
- B-frame lead/frame-rate derived safety offset

Heuristic:

- compute effective offset
- if in expected range, apply delay correction
- clamp final shift to `[-2500, 2500]` ms

FFmpeg filter application:

- positive shift: `adelay=<ms>:all=1`
- negative shift: `atrim=start=<sec>,asetpts=PTS-STARTPTS`

## 13. Caching and Persistence (SQLite + Memory)

DB file:

- `.resolver-cache.sqlite`

Primary persistent tables:

- `resolved_stream_cache`
- `movie_quick_start_cache`
- `tmdb_response_cache`
- `playback_sessions`
- `source_health_stats`
- `media_probe_cache`
- `title_track_preferences`

Major in-memory maps:

- `resolvedStreamCache`
- `movieQuickStartCache`
- `tmdbResponseCache`
- `rdTorrentLookupCache`
- `inFlightMovieResolves`
- `inFlightMediaProbeRequests`
- `inFlightSubtitleVttBuilds`
- `hlsTranscodeJobs`

Key TTL / limits (current constants):

- resolved stream cache TTL: `20m`
- ephemeral resolved stream TTL: `12h`, revalidate every `90s`
- movie quick-start cache TTL: `1h`
- RD lookup cache TTL: `2m`
- TMDB cache TTLs:
  - default: `6h`
  - popular list: `30m`
  - genres: `24h`
- media probe stale: `30d`
- source health stale: `30d`
- title preference stale: `90d`
- playback session stale: `30d`
- HLS segment duration: `6s`
- HLS segment stale: `6h`
- HLS transcode idle prune: `8m`

## 14. Preference Model

Currently persisted:

- quality preference: localStorage (`netflix-stream-quality-pref`)
- audio language preference: localStorage per movie (`netflix-audio-lang:movie:<tmdbId>`)
- subtitle preference per title: SQLite (`title_track_preferences`) via `/api/title/preferences`

Currently not actively used by player:

- playback resume/session progress sync (client disabled)
- manual sync preference persistence (UI removed)

## 15. Recovery and Resilience

Player-side:

- source queue fallback attempts
- re-resolve attempts for TMDB playback failures
- HLS fatal error fallback to remux source
- stalled/waiting watchdog recovery scheduling

Server-side:

- in-flight dedupe for expensive calls (resolve/probe/subtitle build)
- stream verification + invalidation
- source health scoring to prefer historically stable sources
- hwaccel fallback to software transcode

## 16. Known Current Behaviors / Limitations

- Subtitles UI is primary in popover; audio selection UI is hidden.
- HLS path does not currently embed or emit subtitle segments; subtitle rendering is via external VTT track path.
- Client-side playback session syncing is disabled (`canSyncPlaybackSession()` returns false), even if server session support is enabled.
- `dev:vite` is not equivalent to the Bun API server runtime.

## 17. Troubleshooting Checklist

If playback fails to resolve:

1. verify `.env` has valid `TMDB_API_KEY` and `REAL_DEBRID_TOKEN`
2. check `/api/config`
3. inspect `/api/health?refresh=1`
4. clear caches: `/api/debug/cache?clear=1`

If subtitles do not appear:

1. ensure subtitle track is selected in player
2. verify subtitle stream exists in `/api/resolve/movie` response
3. request `/api/subtitles.vtt?...` directly and confirm non-empty VTT
4. allow first extraction/prewarm window for uncached streams

If A/V sync feels off:

1. verify playback is using `/api/remux` path (auto-sync applied there)
2. check remux response headers (`X-Audio-*`)
3. refresh source and clear stale cache entries when needed

If HLS is unstable on machine:

1. inspect `/api/health` for effective hwaccel mode
2. set `HLS_HWACCEL=none` to force software path
3. restart server and retest

---

If you change resolver/transcode/subtitle/sync behavior, update this file in the same PR so operations and debugging stay aligned with code.
