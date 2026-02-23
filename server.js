import { basename, extname, join, normalize } from "node:path";
import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { gunzipSync } from "node:zlib";
import { Database } from "bun:sqlite";

const ROOT_DIR = process.cwd();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5173);
const MAX_UPLOAD_BYTES = Math.max(
  50 * 1024 * 1024,
  Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024 * 1024),
);

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const REAL_DEBRID_API_BASE = "https://api.real-debrid.com/rest/1.0";
const TORRENTIO_BASE_URL =
  process.env.TORRENTIO_BASE_URL || "https://torrentio.strem.fun";
const OPENSUBTITLES_REST_BASE =
  process.env.OPENSUBTITLES_REST_BASE || "https://rest.opensubtitles.org";
const OPENSUBTITLES_USER_AGENT =
  process.env.OPENSUBTITLES_USER_AGENT || "TemporaryUserAgent";

const TMDB_API_KEY = (process.env.TMDB_API_KEY || "").trim();
const REAL_DEBRID_TOKEN = (process.env.REAL_DEBRID_TOKEN || "").trim();
const CODEX_AUTH_FILE = (
  process.env.CODEX_AUTH_FILE || join(homedir(), ".codex", "auth.json")
).trim();
const CODEX_URL = (
  process.env.CODEX_URL || "https://chatgpt.com/backend-api/codex/responses"
).trim();
const CODEX_MODEL = (process.env.CODEX_MODEL || "gpt-5.2-codex").trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_RESPONSES_MODEL = (
  process.env.OPENAI_RESPONSES_MODEL || "gpt-5-mini"
).trim();

const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://explodie.org:6969/announce",
];

const TORRENT_FATAL_STATUSES = new Set([
  "error",
  "magnet_error",
  "virus",
  "dead",
  "invalid_magnet",
]);

const VIDEO_FILE_REGEX = /\.mp4$/i;
const ASSETS_DIR = join(ROOT_DIR, "assets");
const VIDEOS_DIR = join(ASSETS_DIR, "videos");
const LOCAL_LIBRARY_PATH = join(ASSETS_DIR, "library.json");
const UPLOAD_TEMP_DIR = join(ROOT_DIR, "cache", "uploads");
const UPLOAD_SESSION_STALE_MS = 6 * 60 * 60 * 1000;
const uploadSessions = new Map();
const RESOLVED_STREAM_CACHE_TTL_MS = 20 * 60 * 1000;
const RESOLVED_STREAM_CACHE_EPHEMERAL_TTL_MS = 12 * 60 * 60 * 1000;
const RESOLVED_STREAM_CACHE_EPHEMERAL_REVALIDATE_MS = 90 * 1000;
const RESOLVED_STREAM_CACHE_MAX_ENTRIES = 800;
const CACHE_DIR = join(ROOT_DIR, "cache");
const PERSISTENT_CACHE_DB_PATH = join(CACHE_DIR, "resolver-cache.sqlite");
const HLS_CACHE_DIR = join(CACHE_DIR, "hls");
const RESOLVED_STREAM_PERSIST_MAX_ENTRIES = 6000;
const resolvedStreamCache = new Map();
const MOVIE_QUICK_START_CACHE_TTL_MS = 60 * 60 * 1000;
const MOVIE_QUICK_START_CACHE_MAX_ENTRIES = 160;
const MOVIE_QUICK_START_PERSIST_MAX_ENTRIES = 1200;
const movieQuickStartCache = new Map();
const RD_TORRENT_LOOKUP_CACHE_TTL_MS = 2 * 60 * 1000;
const RD_TORRENT_LOOKUP_CACHE_MAX_ENTRIES = 1500;
const rdTorrentLookupCache = new Map();
const TMDB_RESPONSE_CACHE_TTL_DEFAULT_MS = 6 * 60 * 60 * 1000;
const TMDB_RESPONSE_CACHE_TTL_POPULAR_MS = 30 * 60 * 1000;
const TMDB_RESPONSE_CACHE_TTL_GENRE_MS = 24 * 60 * 60 * 1000;
const TMDB_RESPONSE_CACHE_MAX_ENTRIES = 1200;
const TMDB_RESPONSE_PERSIST_MAX_ENTRIES = 6000;
const tmdbResponseCache = new Map();
const PLAYBACK_SESSION_VALIDATE_INTERVAL_MS = 90 * 1000;
const PLAYBACK_SESSION_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const PLAYBACK_SESSION_PERSIST_MAX_ENTRIES = 2500;
const SOURCE_HEALTH_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const MEDIA_PROBE_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const TITLE_PREFERENCES_STALE_MS = 90 * 24 * 60 * 60 * 1000;
const HLS_SEGMENT_DURATION_SECONDS = 6;
const HLS_SEGMENT_STALE_MS = 6 * 60 * 60 * 1000;
const HLS_SEGMENT_MAX_FILES = 3000;
const HLS_TRANSCODE_IDLE_MS = 8 * 60 * 1000;
const HLS_SEGMENT_WAIT_TIMEOUT_MS = 30000;
const HLS_SEGMENT_WAIT_POLL_MS = 180;
const SUBTITLE_EXTRACT_TIMEOUT_MS = 3 * 60 * 1000;
const EXTERNAL_SUBTITLE_LOOKUP_TTL_MS = 30 * 60 * 1000;
const EXTERNAL_SUBTITLE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const EXTERNAL_SUBTITLE_MAX_TRACKS = 1;
const EXTERNAL_SUBTITLE_STREAM_INDEX_BASE = 2_000_000;
const HLS_HWACCEL_MODE = normalizeHlsHwaccelMode(
  process.env.HLS_HWACCEL || "none",
);
const AUTO_AUDIO_SYNC_ENABLED = normalizeAutoAudioSyncEnabled(
  process.env.AUTO_AUDIO_SYNC || "1",
);
const PLAYBACK_SESSIONS_ENABLED = normalizeAutoAudioSyncEnabled(
  process.env.PLAYBACK_SESSIONS || "0",
);
const REMUX_VIDEO_MODE = normalizeRemuxVideoMode(
  process.env.REMUX_VIDEO_MODE || "auto",
);
const NATIVE_PLAYBACK_MODE = normalizeNativePlaybackMode(
  process.env.NATIVE_PLAYBACK || process.env.NATIVE_PLAYER_MODE || "auto",
);
const MPV_BINARY = String(process.env.MPV_BINARY || "mpv").trim() || "mpv";
const inFlightMovieResolves = new Map();
const inFlightMediaProbeRequests = new Map();
const inFlightSubtitleVttBuilds = new Map();
const inFlightExternalSubtitleLookups = new Map();
const inFlightExternalSubtitleBuilds = new Map();
const hlsTranscodeJobs = new Map();
const externalSubtitleLookupCache = new Map();
const CACHE_SWEEP_INTERVAL_MS = 60 * 1000;
const SERVER_IDLE_TIMEOUT_SECONDS = 240;
const SERVER_STARTED_AT = Date.now();
const FFMPEG_CAPABILITY_REFRESH_MS = 5 * 60 * 1000;
const NATIVE_PLAYER_STATUS_REFRESH_MS = 5 * 60 * 1000;
let persistentCacheDb = null;
let loggedHlsHwaccelFallback = false;
let ffmpegCapabilityTask = null;
let nativePlayerStatusTask = null;
let ffmpegCapabilitySnapshot = {
  checkedAt: 0,
  ffmpegAvailable: false,
  ffprobeAvailable: false,
  ffmpegVersion: "",
  ffprobeVersion: "",
  requestedHlsHwaccel: HLS_HWACCEL_MODE,
  effectiveHlsHwaccel: "none",
  hwaccels: [],
  encoders: {
    h264_videotoolbox: false,
    h264_nvenc: false,
    h264_qsv: false,
  },
  notes: [],
};
let nativePlayerStatusSnapshot = {
  checkedAt: 0,
  mode: NATIVE_PLAYBACK_MODE,
  mpvBinary: MPV_BINARY,
  available: false,
  version: "",
  notes: [],
};
const cacheStats = {
  resolvedStreamHits: 0,
  resolvedStreamMisses: 0,
  resolvedStreamExpired: 0,
  resolvedStreamInvalidated: 0,
  movieQuickStartHits: 0,
  movieQuickStartMisses: 0,
  movieQuickStartExpired: 0,
  rdLookupHits: 0,
  rdLookupMisses: 0,
  rdLookupExpired: 0,
  rdLookupApiPagesScanned: 0,
  tmdbHits: 0,
  tmdbMisses: 0,
  tmdbExpired: 0,
  playbackSessionHits: 0,
  playbackSessionMisses: 0,
  playbackSessionInvalidated: 0,
  movieResolveDedupHits: 0,
  movieResolveDedupMisses: 0,
};
const AUDIO_LANGUAGE_TOKENS = {
  en: [
    "english",
    " eng ",
    "eng-",
    "eng]",
    "eng)",
    "en audio",
    "dubbed english",
  ],
  fr: ["french", " fran", "fra ", " fr ", "vf", "vff"],
  es: ["spanish", "espanol", "castellano", " spa ", "esp "],
  de: ["german", " deutsch", " ger ", "deu "],
  it: ["italian", " italiano", " ita "],
  pt: ["portuguese", " portugues", " por ", "pt-br", "brazilian"],
};
const SOURCE_LANGUAGE_FILTER_DEFAULT = "en";
const SUPPORTED_SOURCE_LANGUAGE_FILTERS = new Set([
  "any",
  ...Object.keys(AUDIO_LANGUAGE_TOKENS),
]);
const ISO2_TO_OPENSUBTITLES_LANG = {
  en: "eng",
  fr: "fre",
  es: "spa",
  de: "ger",
  it: "ita",
  pt: "por",
  ja: "jpn",
  ko: "kor",
  zh: "chi",
  nl: "dut",
  ro: "rum",
  pl: "pol",
  tr: "tur",
  ru: "rus",
  ar: "ara",
};
const STREAM_QUALITY_TARGETS = {
  auto: 0,
  "2160p": 2160,
  "1080p": 1080,
  "720p": 720,
};
const TITLE_MATCH_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "in",
  "on",
  "to",
  "for",
  "vs",
  "v",
  "movie",
  "film",
]);
const SUBTITLE_RELEASE_NOISE_TOKENS = new Set([
  "web",
  "webrip",
  "webdl",
  "webdlt",
  "bluray",
  "bdrip",
  "brrip",
  "dvdrip",
  "dvdr",
  "x264",
  "x265",
  "h264",
  "h265",
  "hevc",
  "av1",
  "xvid",
  "aac",
  "ac3",
  "eac3",
  "dd",
  "ddp",
  "dts",
  "atmos",
  "sdr",
  "hdr",
  "hdr10",
  "dv",
  "dolby",
  "vision",
  "proper",
  "repack",
  "remux",
  "extended",
  "complete",
  "internal",
  "multi",
  "subs",
  "sub",
  "subtitles",
  "eng",
  "english",
  "ita",
  "italian",
  "es",
  "spa",
  "fr",
  "de",
  "nf",
  "amzn",
  "hmax",
  "dsnp",
  "hulu",
  "pcok",
  "10bit",
  "8bit",
]);

function initializePersistentCacheDb() {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const db = new Database(PERSISTENT_CACHE_DB_PATH, { create: true });
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS resolved_stream_cache (
        cache_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        is_ephemeral INTEGER NOT NULL DEFAULT 0,
        next_validation_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_resolved_stream_cache_expires ON resolved_stream_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_resolved_stream_cache_updated ON resolved_stream_cache(updated_at);
      CREATE TABLE IF NOT EXISTS movie_quick_start_cache (
        cache_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_movie_quick_start_cache_expires ON movie_quick_start_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_movie_quick_start_cache_updated ON movie_quick_start_cache(updated_at);
      CREATE TABLE IF NOT EXISTS tmdb_response_cache (
        cache_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tmdb_response_cache_expires ON tmdb_response_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_tmdb_response_cache_updated ON tmdb_response_cache(updated_at);
      CREATE TABLE IF NOT EXISTS playback_sessions (
        session_key TEXT PRIMARY KEY,
        tmdb_id TEXT NOT NULL,
        audio_lang TEXT NOT NULL,
        source_hash TEXT NOT NULL DEFAULT '',
        selected_file TEXT NOT NULL DEFAULT '',
        filename TEXT NOT NULL DEFAULT '',
        playable_url TEXT NOT NULL,
        fallback_urls_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        last_position_seconds REAL NOT NULL DEFAULT 0,
        health_state TEXT NOT NULL DEFAULT 'unknown',
        health_fail_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        last_verified_at INTEGER NOT NULL DEFAULT 0,
        next_validation_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_playback_sessions_tmdb_lang ON playback_sessions(tmdb_id, audio_lang);
      CREATE INDEX IF NOT EXISTS idx_playback_sessions_updated ON playback_sessions(updated_at);
      CREATE INDEX IF NOT EXISTS idx_playback_sessions_last_accessed ON playback_sessions(last_accessed_at);
      CREATE TABLE IF NOT EXISTS source_health_stats (
        source_key TEXT PRIMARY KEY,
        total_success_count INTEGER NOT NULL DEFAULT 0,
        total_failure_count INTEGER NOT NULL DEFAULT 0,
        decode_failure_count INTEGER NOT NULL DEFAULT 0,
        ended_early_count INTEGER NOT NULL DEFAULT 0,
        playback_error_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_source_health_updated ON source_health_stats(updated_at);
      CREATE TABLE IF NOT EXISTS media_probe_cache (
        probe_key TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_media_probe_updated ON media_probe_cache(updated_at);
      CREATE TABLE IF NOT EXISTS title_track_preferences (
        tmdb_id TEXT PRIMARY KEY,
        preferred_audio_lang TEXT NOT NULL DEFAULT '',
        preferred_subtitle_lang TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_title_track_preferences_updated ON title_track_preferences(updated_at);
    `);
    persistentCacheDb = db;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[cache] Persistent SQLite cache disabled: ${message}`);
    persistentCacheDb = null;
  }
}

initializePersistentCacheDb();
void getFfmpegCapabilities().catch(() => {
  // Health endpoint can still probe lazily on demand.
});
void getNativePlayerStatus().catch(() => {
  // Native player endpoint can still probe lazily on demand.
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function classifyErrorStatus(message) {
  if (/missing|invalid|required/i.test(message)) {
    return 400;
  }

  if (/not configured/i.test(message)) {
    return 500;
  }

  if (
    /timed out|request failed|failed|no stream|all stream candidates/i.test(
      message,
    )
  ) {
    return 502;
  }

  return 500;
}

function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function toLocalPath(pathname) {
  const decoded = decodePathname(pathname);
  if (!decoded) {
    return null;
  }

  let requested = decoded === "/" ? "/index.html" : decoded;
  if (requested.length > 1 && requested.endsWith("/")) {
    requested = requested.slice(0, -1);
  }
  if (!basename(requested).includes(".")) {
    requested = `${requested}.html`;
  }
  const normalized = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const trimmed = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const filePath = join(ROOT_DIR, trimmed);

  if (!isPathInsideRootDir(filePath)) {
    return null;
  }

  return filePath;
}

function createEmptyLocalLibrary() {
  return {
    movies: [],
    series: [],
  };
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value, fallback = "title") {
  const base = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || fallback;
}

function normalizeYear(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}$/.test(text)) {
    return "";
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 1888 || numeric > 2100) {
    return "";
  }
  return text;
}

function normalizeUploadContentType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "episode" ? "episode" : "movie";
}

function normalizeUploadEpisodeOrdinal(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(999, Math.floor(parsed)));
}

function normalizeLocalMovieEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const title = normalizeWhitespace(entry.title || "");
  const src = normalizeWhitespace(entry.src || "");
  if (!title || !src) {
    return null;
  }
  return {
    id: normalizeWhitespace(entry.id || slugify(title)),
    title,
    tmdbId: /^\d+$/.test(String(entry.tmdbId || "").trim())
      ? String(entry.tmdbId).trim()
      : "",
    year: normalizeYear(entry.year || ""),
    src,
    thumb: normalizeWhitespace(entry.thumb || "assets/images/thumbnail.jpg"),
    description: normalizeWhitespace(entry.description || ""),
    uploadedAt: Number.isFinite(Number(entry.uploadedAt))
      ? Math.floor(Number(entry.uploadedAt))
      : Date.now(),
  };
}

function normalizeLocalSeriesEpisodeEntry(entry, fallbackIndex = 0) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const src = normalizeWhitespace(entry.src || "");
  if (!src) {
    return null;
  }
  const episodeNumber = normalizeUploadEpisodeOrdinal(
    entry.episodeNumber || fallbackIndex + 1,
    fallbackIndex + 1,
  );
  return {
    title: normalizeWhitespace(entry.title || `Episode ${episodeNumber}`),
    description: normalizeWhitespace(entry.description || ""),
    thumb: normalizeWhitespace(entry.thumb || "assets/images/thumbnail.jpg"),
    src,
    seasonNumber: normalizeUploadEpisodeOrdinal(entry.seasonNumber || 1, 1),
    episodeNumber,
    uploadedAt: Number.isFinite(Number(entry.uploadedAt))
      ? Math.floor(Number(entry.uploadedAt))
      : Date.now(),
  };
}

function normalizeLocalSeriesEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const id = slugify(entry.id || entry.title || "");
  const title = normalizeWhitespace(entry.title || "");
  if (!id || !title) {
    return null;
  }
  const episodes = Array.isArray(entry.episodes)
    ? entry.episodes
        .map((episode, index) =>
          normalizeLocalSeriesEpisodeEntry(episode, index),
        )
        .filter(Boolean)
    : [];
  if (!episodes.length) {
    return null;
  }

  episodes.sort((left, right) => {
    const seasonDelta = left.seasonNumber - right.seasonNumber;
    if (seasonDelta !== 0) {
      return seasonDelta;
    }
    return left.episodeNumber - right.episodeNumber;
  });

  return {
    id,
    title,
    tmdbId: /^\d+$/.test(String(entry.tmdbId || "").trim())
      ? String(entry.tmdbId).trim()
      : "",
    year: normalizeYear(entry.year || ""),
    preferredContainer: "mp4",
    requiresLocalEpisodeSources: true,
    episodes,
  };
}

function normalizeLocalLibrary(rawValue) {
  const source =
    rawValue && typeof rawValue === "object"
      ? rawValue
      : createEmptyLocalLibrary();
  const movies = Array.isArray(source.movies)
    ? source.movies
        .map((entry) => normalizeLocalMovieEntry(entry))
        .filter(Boolean)
    : [];
  const series = Array.isArray(source.series)
    ? source.series
        .map((entry) => normalizeLocalSeriesEntry(entry))
        .filter(Boolean)
    : [];
  return { movies, series };
}

async function readLocalLibrary() {
  try {
    const raw = await Bun.file(LOCAL_LIBRARY_PATH).text();
    return normalizeLocalLibrary(JSON.parse(raw));
  } catch {
    return createEmptyLocalLibrary();
  }
}

async function writeLocalLibrary(value) {
  const normalized = normalizeLocalLibrary(value);
  await Bun.write(
    LOCAL_LIBRARY_PATH,
    `${JSON.stringify(normalized, null, 2)}\n`,
  );
  return normalized;
}

function stripKnownVideoExtensions(value) {
  const normalized = String(value || "").trim();
  return normalized.replace(/\.(mp4|mkv)$/i, "");
}

function buildAssetVideoSource(fileName) {
  const safeName = String(fileName || "").trim();
  return `assets/videos/${safeName}`;
}

function stripFileExtension(value) {
  return String(value || "").replace(/\.[^./\\]+$/, "");
}

function titleFromFilenameToken(token) {
  return normalizeWhitespace(
    String(token || "")
      .replace(/[._]+/g, " ")
      .replace(
        /\b(2160p|1080p|720p|480p|x264|x265|h264|h265|hevc|web[- ]?dl|webrip|bluray|brrip|dvdrip|aac|ac3|ddp|proper|repack)\b/gi,
        " ",
      )
      .replace(/\s+/g, " "),
  );
}

function inferUploadMetadataFromFilenameHeuristic(fileName) {
  const rawBase = stripFileExtension(String(fileName || "").trim());
  const cleaned = normalizeWhitespace(rawBase);
  const episodeMatch =
    /\bS(\d{1,2})E(\d{1,3})\b/i.exec(rawBase) ||
    /\b(\d{1,2})x(\d{1,3})\b/i.exec(rawBase);
  const yearMatch = /\b(19\d{2}|20\d{2})\b/.exec(rawBase);
  const year = normalizeYear(yearMatch?.[1] || "");

  if (episodeMatch) {
    const seasonNumber = normalizeUploadEpisodeOrdinal(episodeMatch[1], 1);
    const episodeNumber = normalizeUploadEpisodeOrdinal(episodeMatch[2], 1);
    const leftSide = rawBase.slice(0, Math.max(0, episodeMatch.index || 0));
    const seriesTitle =
      titleFromFilenameToken(leftSide) || titleFromFilenameToken(rawBase);
    return normalizeInferredUploadMetadata({
      contentType: "episode",
      title: seriesTitle,
      seriesTitle,
      seasonNumber,
      episodeNumber,
      year,
      confidence: 0.6,
      reason: "Heuristic SxxExx filename match.",
    });
  }

  return normalizeInferredUploadMetadata({
    contentType: "movie",
    title: titleFromFilenameToken(rawBase) || cleaned,
    year,
    confidence: 0.4,
    reason: "Heuristic filename inference.",
  });
}

function extractEpisodePatternFromFilename(fileName) {
  const rawBase = stripFileExtension(String(fileName || "").trim());
  if (!rawBase) {
    return null;
  }
  const match =
    /\bS(\d{1,2})E(\d{1,3})\b/i.exec(rawBase) ||
    /\b(\d{1,2})x(\d{1,3})\b/i.exec(rawBase);
  if (!match) {
    return null;
  }
  const seasonNumber = normalizeUploadEpisodeOrdinal(match[1], 1);
  const episodeNumber = normalizeUploadEpisodeOrdinal(match[2], 1);
  const leftSide = rawBase.slice(0, Math.max(0, match.index || 0));
  const seriesTitle =
    titleFromFilenameToken(leftSide) || titleFromFilenameToken(rawBase);
  return {
    seriesTitle,
    seasonNumber,
    episodeNumber,
  };
}

function extractSourceFilename(sourcePath) {
  const raw = String(sourcePath || "").trim();
  if (!raw) {
    return "";
  }
  const withoutQuery = raw.split("?")[0] || "";
  return basename(withoutQuery);
}

async function convertMkvToMp4Lossless(inputPath, outputPath) {
  await runProcessAndCapture(
    [
      "ffmpeg",
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v",
      "-map",
      "0:a?",
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { timeoutMs: 2 * 60 * 60 * 1000, binary: false },
  );
}

async function convertMediaAudioToAacKeepingVideo(inputPath, outputPath) {
  await runProcessAndCapture(
    [
      "ffmpeg",
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v",
      "-map",
      "0:a?",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "256k",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { timeoutMs: 2 * 60 * 60 * 1000, binary: false },
  );
}

function normalizeInferredUploadMetadata(value = {}) {
  const contentType = normalizeUploadContentType(value.contentType);
  const inferred = {
    contentType,
    confidence: Number.isFinite(Number(value.confidence))
      ? Math.max(0, Math.min(1, Number(value.confidence)))
      : 0,
    title: normalizeWhitespace(value.title || ""),
    year: normalizeYear(value.year || ""),
    seriesTitle: "",
    seasonNumber: 1,
    episodeNumber: 1,
    episodeTitle: "",
    tmdbId: /^\d+$/.test(String(value.tmdbId || "").trim())
      ? String(value.tmdbId).trim()
      : "",
    reason: normalizeWhitespace(value.reason || ""),
  };

  if (contentType === "episode") {
    inferred.seriesTitle = normalizeWhitespace(value.seriesTitle || "");
    inferred.seasonNumber = normalizeUploadEpisodeOrdinal(
      value.seasonNumber || 1,
      1,
    );
    inferred.episodeNumber = normalizeUploadEpisodeOrdinal(
      value.episodeNumber || 1,
      1,
    );
    inferred.episodeTitle = normalizeWhitespace(value.episodeTitle || "");
  }

  return inferred;
}

function tokenizeTmdbTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreTmdbTitleCandidate(candidateTitle, queryTitle) {
  const candidateTokens = tokenizeTmdbTitle(candidateTitle);
  const queryTokens = tokenizeTmdbTitle(queryTitle);
  if (!candidateTokens.length || !queryTokens.length) {
    return 0;
  }
  const candidateSet = new Set(candidateTokens);
  let overlap = 0;
  queryTokens.forEach((token) => {
    if (candidateSet.has(token)) {
      overlap += 1;
    }
  });
  return overlap / Math.max(1, queryTokens.length);
}

function chooseBestTmdbResult(results, queryTitle, queryYear = "") {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) {
    return null;
  }
  const safeQueryTitle = normalizeWhitespace(queryTitle);
  const safeQueryYear = normalizeYear(queryYear);
  let best = null;
  let bestScore = -1;

  list.forEach((entry) => {
    const title = normalizeWhitespace(entry?.name || entry?.title || "");
    if (!title) {
      return;
    }
    let score = scoreTmdbTitleCandidate(title, safeQueryTitle);
    const candidateDate = String(
      entry?.first_air_date || entry?.release_date || "",
    ).trim();
    const candidateYear = normalizeYear(candidateDate.slice(0, 4));
    if (safeQueryYear && candidateYear && safeQueryYear === candidateYear) {
      score += 0.3;
    }
    if (title.toLowerCase() === safeQueryTitle.toLowerCase()) {
      score += 0.2;
    }
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  });

  return best;
}

async function enrichInferenceWithTmdb(baseInference, fileName = "") {
  const inferred = normalizeInferredUploadMetadata(baseInference);
  const episodePattern = extractEpisodePatternFromFilename(fileName);
  if (episodePattern) {
    inferred.contentType = "episode";
    inferred.seriesTitle =
      normalizeWhitespace(inferred.seriesTitle || inferred.title || "") ||
      episodePattern.seriesTitle;
    inferred.seasonNumber = episodePattern.seasonNumber;
    inferred.episodeNumber = episodePattern.episodeNumber;
  }

  if (!TMDB_API_KEY) {
    inferred.reason = `TMDB_API_KEY missing. ${inferred.reason}`.trim();
    return inferred;
  }

  try {
    if (inferred.contentType === "episode") {
      const seriesQuery =
        normalizeWhitespace(inferred.seriesTitle || inferred.title || "") ||
        normalizeWhitespace(stripFileExtension(fileName));
      if (!seriesQuery) {
        return inferred;
      }
      const tvSearch = await tmdbFetch("/search/tv", {
        query: seriesQuery,
        include_adult: "false",
      });
      const bestMatch = chooseBestTmdbResult(
        tvSearch?.results,
        seriesQuery,
        inferred.year,
      );
      if (!bestMatch?.id) {
        return inferred;
      }

      const tmdbId = String(bestMatch.id).trim();
      const [seriesDetails, episodeDetails] = await Promise.all([
        tmdbFetch(`/tv/${tmdbId}`).catch(() => null),
        tmdbFetch(
          `/tv/${tmdbId}/season/${inferred.seasonNumber}/episode/${inferred.episodeNumber}`,
        ).catch(() => null),
      ]);

      const resolvedSeriesTitle = normalizeWhitespace(
        seriesDetails?.name || bestMatch?.name || seriesQuery,
      );
      inferred.tmdbId = tmdbId;
      inferred.seriesTitle = resolvedSeriesTitle || inferred.seriesTitle;
      inferred.title = resolvedSeriesTitle || inferred.title;
      inferred.year =
        normalizeYear(
          String(
            seriesDetails?.first_air_date || bestMatch?.first_air_date || "",
          ).slice(0, 4),
        ) || inferred.year;
      inferred.episodeTitle =
        normalizeWhitespace(
          episodeDetails?.name || inferred.episodeTitle || "",
        ) || inferred.episodeTitle;
      inferred.confidence = Math.max(inferred.confidence, 0.9);
      inferred.reason = `TMDB TV match (${tmdbId}). ${inferred.reason}`.trim();
      return inferred;
    }

    const movieQuery =
      normalizeWhitespace(inferred.title || "") ||
      normalizeWhitespace(stripFileExtension(fileName));
    if (!movieQuery) {
      return inferred;
    }
    const movieSearch = await tmdbFetch("/search/movie", {
      query: movieQuery,
      include_adult: "false",
    });
    const bestMatch = chooseBestTmdbResult(
      movieSearch?.results,
      movieQuery,
      inferred.year,
    );
    if (!bestMatch?.id) {
      return inferred;
    }

    const tmdbId = String(bestMatch.id).trim();
    const movieDetails = await tmdbFetch(`/movie/${tmdbId}`).catch(() => null);
    inferred.tmdbId = tmdbId;
    inferred.title = normalizeWhitespace(
      movieDetails?.title || bestMatch?.title || movieQuery,
    );
    inferred.year =
      normalizeYear(
        String(
          movieDetails?.release_date || bestMatch?.release_date || "",
        ).slice(0, 4),
      ) || inferred.year;
    inferred.confidence = Math.max(inferred.confidence, 0.9);
    inferred.reason = `TMDB Movie match (${tmdbId}). ${inferred.reason}`.trim();
    return inferred;
  } catch {
    return inferred;
  }
}

function extractResponseOutputText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const text = String(part?.text || part?.value || "").trim();
      if (text) {
        return text;
      }
    }
  }

  return "";
}

async function readLocalCodexAccessToken() {
  const authFile = String(CODEX_AUTH_FILE || "").trim();
  if (!authFile) {
    return "";
  }
  try {
    const raw = await Bun.file(authFile).text();
    const parsed = JSON.parse(raw);
    const token = normalizeWhitespace(
      parsed?.access_token || parsed?.tokens?.access_token || "",
    );
    return token;
  } catch {
    return "";
  }
}

function extractFirstJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("{") && raw.endsWith("}")) {
    return raw;
  }
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    const fenced = String(fenceMatch[1]).trim();
    if (fenced.startsWith("{") && fenced.endsWith("}")) {
      return fenced;
    }
  }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return "";
}

function extractOutputTextFromCodexSse(rawSseText) {
  const text = String(rawSseText || "");
  if (!text.trim()) {
    return "";
  }

  let deltaText = "";
  let doneText = "";
  let completedText = "";

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") {
      continue;
    }

    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }

    const type = String(payload?.type || "").trim();
    if (type === "response.output_text.delta") {
      const delta = String(payload?.delta || "");
      if (delta) {
        deltaText += delta;
      }
      continue;
    }

    if (type === "response.output_text.done") {
      const nextDoneText = String(payload?.text || "").trim();
      if (nextDoneText) {
        doneText = nextDoneText;
      }
      continue;
    }

    if (type === "response.completed") {
      const maybeText = extractResponseOutputText(payload?.response);
      if (maybeText) {
        completedText = maybeText;
      }
    }
  }

  return completedText || doneText || deltaText;
}

async function requestCodexResponsesInference(prompt) {
  const token = await readLocalCodexAccessToken();
  if (!token) {
    throw new Error("Codex OAuth access token was not found.");
  }

  const response = await fetch(CODEX_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CODEX_MODEL,
      instructions:
        "Return only one JSON object with no markdown and no surrounding text.",
      stream: true,
      store: false,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
    }),
  });
  const rawText = await response.text();
  if (!response.ok) {
    let message = "";
    try {
      const parsed = JSON.parse(rawText);
      message = normalizeWhitespace(parsed?.error?.message || parsed?.detail);
    } catch {
      message = normalizeWhitespace(rawText);
    }
    if (!message) {
      message = `Codex backend request failed (${response.status}).`;
    }
    throw new Error(message || "Codex backend request failed.");
  }

  const contentType = String(response.headers.get("content-type") || "")
    .trim()
    .toLowerCase();
  const looksLikeSse = /^\s*(event:|data:)/i.test(String(rawText || ""));
  const outputText =
    contentType.includes("text/event-stream") || looksLikeSse
      ? extractOutputTextFromCodexSse(rawText)
      : (() => {
          try {
            const payload = JSON.parse(rawText);
            return extractResponseOutputText(payload);
          } catch {
            return "";
          }
        })();
  if (!outputText) {
    throw new Error("Codex backend returned no textual output.");
  }
  return outputText;
}

async function requestOpenAiResponsesInference(prompt, schema) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_RESPONSES_MODEL,
      input: [
        {
          role: "system",
          content:
            "You infer movie/episode metadata from filenames and respond in strict JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "upload_filename_metadata",
          schema,
          strict: true,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = normalizeWhitespace(
      payload?.error?.message ||
        `OpenAI Responses request failed (${response.status}).`,
    );
    throw new Error(message || "OpenAI Responses request failed.");
  }
  const outputText = extractResponseOutputText(payload);
  if (!outputText) {
    throw new Error("OpenAI Responses returned no textual output.");
  }
  return outputText;
}

async function inferUploadMetadataWithCodex(fileName) {
  const prompt = `Infer media metadata from this filename only: "${String(fileName || "").trim()}".
Return JSON with:
- contentType: "movie" or "episode"
- title
- year (4 digits or empty string)
- seriesTitle (for episode)
- seasonNumber (for episode)
- episodeNumber (for episode)
- episodeTitle (for episode)
- confidence (0 to 1)
- reason (short)
Rules:
- If SxxExx pattern exists, classify as episode.
- If uncertain, prefer movie.
- Keep fields empty instead of guessing hard.`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      contentType: {
        type: "string",
        enum: ["movie", "episode"],
      },
      title: { type: "string" },
      year: { type: "string" },
      seriesTitle: { type: "string" },
      seasonNumber: { type: "integer" },
      episodeNumber: { type: "integer" },
      episodeTitle: { type: "string" },
      confidence: { type: "number" },
      reason: { type: "string" },
    },
    required: ["contentType", "title", "confidence", "reason"],
  };
  let outputText = "";
  let sourceUsed = "";

  try {
    outputText = await requestCodexResponsesInference(prompt);
    sourceUsed = "Codex OAuth";
  } catch {
    try {
      outputText = await requestOpenAiResponsesInference(prompt, schema);
      sourceUsed = "OpenAI API";
    } catch {
      const fallback = inferUploadMetadataFromFilenameHeuristic(fileName);
      fallback.reason = `Codex/OpenAI unavailable. ${fallback.reason}`.trim();
      return enrichInferenceWithTmdb(fallback, fileName);
    }
  }

  let parsed = null;
  try {
    parsed = JSON.parse(extractFirstJsonObject(outputText) || outputText);
  } catch {
    const fallback = inferUploadMetadataFromFilenameHeuristic(fileName);
    fallback.reason =
      `${sourceUsed} returned invalid JSON. ${fallback.reason}`.trim();
    return enrichInferenceWithTmdb(fallback, fileName);
  }

  const normalized = normalizeInferredUploadMetadata(parsed);
  const episodePattern = extractEpisodePatternFromFilename(fileName);
  if (episodePattern) {
    normalized.contentType = "episode";
    normalized.seriesTitle =
      normalizeWhitespace(normalized.seriesTitle || normalized.title || "") ||
      episodePattern.seriesTitle;
    normalized.seasonNumber = episodePattern.seasonNumber;
    normalized.episodeNumber = episodePattern.episodeNumber;
  }
  normalized.reason = `${sourceUsed}. ${normalized.reason || ""}`.trim();
  return enrichInferenceWithTmdb(normalized, fileName);
}

function buildUploadMovieId(title) {
  return `local-movie-${slugify(title, "movie")}`;
}

function buildUploadSeriesId(value) {
  return `local-series-${slugify(value, "series")}`;
}

function buildUniqueMp4Filename(baseLabel) {
  const safeBase = slugify(stripKnownVideoExtensions(baseLabel), "upload");
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 8);
  return `${safeBase}-${stamp}-${random}.mp4`;
}

async function ensureUploadDirectories() {
  await Promise.all([
    mkdir(VIDEOS_DIR, { recursive: true }),
    mkdir(UPLOAD_TEMP_DIR, { recursive: true }),
  ]);
}

async function removeFileIfPresent(path) {
  try {
    await rm(path, { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function buildUploadTempFilename(originalName = "upload.bin") {
  const base = slugify(stripKnownVideoExtensions(originalName), "upload");
  const ext = extname(String(originalName || "").trim()).toLowerCase();
  const safeExt = ext === ".mp4" || ext === ".mkv" ? ext : ".bin";
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${base}-${stamp}-${random}${safeExt}`;
}

function sweepUploadSessions() {
  const now = Date.now();
  for (const [sessionId, session] of uploadSessions.entries()) {
    const createdAt = Number(session?.createdAt || 0);
    if (!createdAt || createdAt + UPLOAD_SESSION_STALE_MS <= now) {
      const tempPath = String(session?.tempPath || "").trim();
      if (tempPath) {
        void removeFileIfPresent(tempPath);
      }
      uploadSessions.delete(sessionId);
    }
  }
}

function buildUploadMetadataFromObject(payload = {}) {
  const transcodeAudioToAacValue = payload?.transcodeAudioToAac;
  const transcodeAudioToAac =
    transcodeAudioToAacValue === true ||
    transcodeAudioToAacValue === 1 ||
    String(transcodeAudioToAacValue || "")
      .trim()
      .toLowerCase() === "true" ||
    String(transcodeAudioToAacValue || "")
      .trim()
      .toLowerCase() === "1" ||
    String(transcodeAudioToAacValue || "")
      .trim()
      .toLowerCase() === "yes" ||
    String(transcodeAudioToAacValue || "")
      .trim()
      .toLowerCase() === "on";
  return {
    contentType: String(payload?.contentType || "movie")
      .trim()
      .toLowerCase(),
    title: normalizeWhitespace(payload?.title || ""),
    year: normalizeYear(payload?.year || ""),
    description: normalizeWhitespace(payload?.description || ""),
    thumb: normalizeWhitespace(payload?.thumb || "assets/images/thumbnail.jpg"),
    tmdbId: String(payload?.tmdbId || "")
      .trim()
      .replace(/[^\d]/g, ""),
    seasonNumber: normalizeUploadEpisodeOrdinal(payload?.seasonNumber || 1, 1),
    episodeNumber: normalizeUploadEpisodeOrdinal(
      payload?.episodeNumber || 1,
      1,
    ),
    episodeTitle: normalizeWhitespace(payload?.episodeTitle || ""),
    seriesTitle: normalizeWhitespace(payload?.seriesTitle || ""),
    seriesId: normalizeWhitespace(payload?.seriesId || ""),
    transcodeAudioToAac,
  };
}

function normalizeProbeCodecName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

const CHROME_SUPPORTED_VIDEO_CODECS = new Set([
  "h264",
  "avc1",
  "hevc",
  "h265",
  "hev1",
  "hvc1",
  "vp8",
  "vp9",
  "av1",
  "mpeg4",
  "theora",
]);

const CHROME_SUPPORTED_AUDIO_CODECS = new Set([
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "pcm_s16le",
  "pcm_s24le",
]);

function shouldAttemptAudioOnlyUploadTranscode(compatibility) {
  if (!compatibility || compatibility.checked === false) {
    return false;
  }

  const container = String(compatibility.container || "")
    .trim()
    .toLowerCase();
  if (!container.includes("mp4")) {
    return false;
  }

  const videoCodec = normalizeProbeCodecName(compatibility.videoCodec || "");
  if (!videoCodec || !CHROME_SUPPORTED_VIDEO_CODECS.has(videoCodec)) {
    return false;
  }

  const audioCodecs = Array.isArray(compatibility.audioCodecs)
    ? compatibility.audioCodecs.map((codec) => normalizeProbeCodecName(codec))
    : [];
  return audioCodecs.some(
    (codec) => codec && !CHROME_SUPPORTED_AUDIO_CODECS.has(codec),
  );
}

function detectChromeCompatibilityFromProbe(probe) {
  const formatName = String(probe?.formatName || "")
    .trim()
    .toLowerCase();
  const videoCodec = normalizeProbeCodecName(probe?.videoCodec || "");
  const audioTracks = Array.isArray(probe?.audioTracks)
    ? probe.audioTracks
    : [];
  const audioCodecs = [
    ...new Set(
      audioTracks
        .map((track) => normalizeProbeCodecName(track?.codec || ""))
        .filter(Boolean),
    ),
  ];

  const compatibility = {
    checked: true,
    isLikelyCompatible: true,
    container: formatName,
    videoCodec,
    audioCodecs,
    reasons: [],
    warning: "",
  };

  if (!formatName.includes("mp4")) {
    compatibility.isLikelyCompatible = false;
    compatibility.reasons.push(
      `Container '${formatName || "unknown"}' may not be broadly supported in Chrome for this app.`,
    );
  }

  if (videoCodec && !CHROME_SUPPORTED_VIDEO_CODECS.has(videoCodec)) {
    compatibility.isLikelyCompatible = false;
    compatibility.reasons.push(
      `Video codec '${videoCodec}' is likely not Chrome-compatible.`,
    );
  }

  if (!videoCodec) {
    compatibility.isLikelyCompatible = false;
    compatibility.reasons.push("Could not determine video codec.");
  }

  const unsupportedAudioCodecs = audioCodecs.filter(
    (codec) => !CHROME_SUPPORTED_AUDIO_CODECS.has(codec),
  );
  if (unsupportedAudioCodecs.length) {
    compatibility.isLikelyCompatible = false;
    compatibility.reasons.push(
      `Audio codec(s) ${unsupportedAudioCodecs.map((codec) => `'${codec}'`).join(", ")} are likely not Chrome-compatible.`,
    );
  }

  if (compatibility.reasons.length) {
    compatibility.warning = compatibility.reasons.join(" ");
  }

  return compatibility;
}

async function detectChromeCompatibilityForSource(source) {
  try {
    const probe = await probeMediaTracks(source);
    return detectChromeCompatibilityFromProbe(probe);
  } catch (error) {
    return {
      checked: false,
      isLikelyCompatible: true,
      container: "",
      videoCodec: "",
      audioCodecs: [],
      reasons: [],
      warning:
        error instanceof Error
          ? `Compatibility check failed: ${error.message}`
          : "Compatibility check failed.",
    };
  }
}

async function processUploadedMediaIntoLibrary({
  inputPath,
  originalName,
  metadata,
}) {
  const sourcePathInput = String(inputPath || "").trim();
  const sourceName = String(originalName || "upload").trim() || "upload";
  const detectedExt = extname(sourceName).toLowerCase();
  if (!sourcePathInput) {
    throw new Error("Missing input path for upload processing.");
  }
  if (detectedExt !== ".mp4" && detectedExt !== ".mkv") {
    throw new Error("Only .mp4 and .mkv files are supported.");
  }

  const contentType = String(metadata?.contentType || "movie")
    .trim()
    .toLowerCase();
  if (contentType !== "movie" && contentType !== "episode") {
    throw new Error("Invalid contentType. Use movie or episode.");
  }

  const movieTitle =
    metadata?.title ||
    normalizeWhitespace(stripKnownVideoExtensions(sourceName));
  const year = normalizeYear(metadata?.year || "");
  const description = normalizeWhitespace(metadata?.description || "");
  const thumb = normalizeWhitespace(
    metadata?.thumb || "assets/images/thumbnail.jpg",
  );
  const tmdbId = String(metadata?.tmdbId || "")
    .trim()
    .replace(/[^\d]/g, "");
  const seasonNumber = normalizeUploadEpisodeOrdinal(
    metadata?.seasonNumber || 1,
    1,
  );
  const episodeNumber = normalizeUploadEpisodeOrdinal(
    metadata?.episodeNumber || 1,
    1,
  );
  const episodeTitle =
    normalizeWhitespace(metadata?.episodeTitle || "") ||
    `Episode ${episodeNumber}`;
  const seriesTitle = normalizeWhitespace(metadata?.seriesTitle || "");
  const rawSeriesId = normalizeWhitespace(metadata?.seriesId || "");
  const seriesId = rawSeriesId || seriesTitle || movieTitle;

  await ensureUploadDirectories();
  const uploadBaseName = contentType === "movie" ? movieTitle : episodeTitle;
  let outputFileName = buildUniqueMp4Filename(uploadBaseName || sourceName);
  let outputPath = join(VIDEOS_DIR, outputFileName);
  let convertedFromMkv = false;
  let audioTranscodedToAac = false;

  try {
    if (detectedExt === ".mp4") {
      await rename(sourcePathInput, outputPath);
    } else {
      convertedFromMkv = true;
      await convertMkvToMp4Lossless(sourcePathInput, outputPath);
      await removeFileIfPresent(sourcePathInput);
    }
  } catch (error) {
    await removeFileIfPresent(sourcePathInput);
    await removeFileIfPresent(outputPath);
    throw error;
  }

  let sourcePath = buildAssetVideoSource(outputFileName);
  let chromeCompatibility =
    await detectChromeCompatibilityForSource(sourcePath);

  const shouldTranscodeAudioToAac =
    metadata?.transcodeAudioToAac === true &&
    shouldAttemptAudioOnlyUploadTranscode(chromeCompatibility);
  if (shouldTranscodeAudioToAac) {
    const aacFileName = buildUniqueMp4Filename(
      `${uploadBaseName || sourceName}-aac`,
    );
    const aacPath = join(VIDEOS_DIR, aacFileName);
    try {
      await convertMediaAudioToAacKeepingVideo(outputPath, aacPath);
      await removeFileIfPresent(outputPath);
      outputFileName = aacFileName;
      outputPath = aacPath;
      sourcePath = buildAssetVideoSource(outputFileName);
      chromeCompatibility =
        await detectChromeCompatibilityForSource(sourcePath);
      audioTranscodedToAac = true;
    } catch {
      await removeFileIfPresent(aacPath);
    }
  }

  const library = await readLocalLibrary();

  if (contentType === "movie") {
    const entry = normalizeLocalMovieEntry({
      id: buildUploadMovieId(movieTitle),
      title: movieTitle || "Untitled Movie",
      tmdbId,
      year,
      src: sourcePath,
      thumb,
      description,
      uploadedAt: Date.now(),
    });
    if (!entry) {
      await removeFileIfPresent(outputPath);
      throw new Error("Unable to build movie metadata.");
    }

    const withoutSameSrc = library.movies.filter(
      (candidate) => String(candidate?.src || "").trim() !== entry.src,
    );
    withoutSameSrc.unshift(entry);
    library.movies = withoutSameSrc;
    await writeLocalLibrary(library);
    return {
      ok: true,
      contentType: "movie",
      movie: entry,
      convertedFromMkv,
      audioTranscodedToAac,
      chromeCompatibility,
    };
  }

  const safeSeriesTitle = seriesTitle || "Untitled Series";
  const normalizedSeriesId = buildUploadSeriesId(seriesId || safeSeriesTitle);
  const nextSeries = normalizeLocalSeriesEntry({
    id: normalizedSeriesId,
    title: safeSeriesTitle,
    tmdbId,
    year,
    episodes: [],
  });
  const seriesRecord = nextSeries || {
    id: normalizedSeriesId,
    title: safeSeriesTitle,
    tmdbId: /^\d+$/.test(tmdbId) ? tmdbId : "",
    year,
    preferredContainer: "mp4",
    requiresLocalEpisodeSources: true,
    episodes: [],
  };

  const episodeEntry = normalizeLocalSeriesEpisodeEntry(
    {
      title: episodeTitle,
      description,
      thumb,
      src: sourcePath,
      seasonNumber,
      episodeNumber,
      uploadedAt: Date.now(),
    },
    episodeNumber - 1,
  );
  if (!episodeEntry) {
    await removeFileIfPresent(outputPath);
    throw new Error("Unable to build episode metadata.");
  }

  const seriesList = Array.isArray(library.series) ? [...library.series] : [];
  const existingIndex = seriesList.findIndex(
    (entry) =>
      String(entry?.id || "")
        .trim()
        .toLowerCase() === normalizedSeriesId.toLowerCase(),
  );
  const targetSeries =
    existingIndex >= 0
      ? seriesList[existingIndex]
      : {
          id: normalizedSeriesId,
          title: safeSeriesTitle,
          tmdbId: seriesRecord.tmdbId || "",
          year: seriesRecord.year || "",
          preferredContainer: "mp4",
          requiresLocalEpisodeSources: true,
          episodes: [],
        };
  targetSeries.title = normalizeWhitespace(
    targetSeries.title || safeSeriesTitle,
  );
  targetSeries.tmdbId =
    /^\d+$/.test(String(targetSeries.tmdbId || "").trim()) &&
    String(targetSeries.tmdbId || "").trim()
      ? String(targetSeries.tmdbId || "").trim()
      : seriesRecord.tmdbId || "";
  targetSeries.year = normalizeYear(targetSeries.year || year);
  targetSeries.preferredContainer = "mp4";
  targetSeries.requiresLocalEpisodeSources = true;

  const baseEpisodes = Array.isArray(targetSeries.episodes)
    ? targetSeries.episodes
    : [];
  const filteredEpisodes = baseEpisodes.filter((entry) => {
    const safeSeason = normalizeUploadEpisodeOrdinal(
      entry?.seasonNumber || 1,
      1,
    );
    const safeEpisode = normalizeUploadEpisodeOrdinal(
      entry?.episodeNumber || 1,
      1,
    );
    return !(safeSeason === seasonNumber && safeEpisode === episodeNumber);
  });
  filteredEpisodes.push(episodeEntry);
  filteredEpisodes.sort((left, right) => {
    const seasonDelta =
      normalizeUploadEpisodeOrdinal(left?.seasonNumber || 1, 1) -
      normalizeUploadEpisodeOrdinal(right?.seasonNumber || 1, 1);
    if (seasonDelta !== 0) {
      return seasonDelta;
    }
    return (
      normalizeUploadEpisodeOrdinal(left?.episodeNumber || 1, 1) -
      normalizeUploadEpisodeOrdinal(right?.episodeNumber || 1, 1)
    );
  });
  targetSeries.episodes = filteredEpisodes
    .map((entry, index) => normalizeLocalSeriesEpisodeEntry(entry, index))
    .filter(Boolean);

  if (existingIndex >= 0) {
    seriesList[existingIndex] = targetSeries;
  } else {
    seriesList.unshift(targetSeries);
  }
  library.series = seriesList;
  await writeLocalLibrary(library);

  return {
    ok: true,
    contentType: "episode",
    series: targetSeries,
    episode: episodeEntry,
    convertedFromMkv,
    audioTranscodedToAac,
    chromeCompatibility,
  };
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isPathInsideRootDir(value) {
  const candidate = String(value || "");
  if (!candidate) {
    return false;
  }
  if (candidate === ROOT_DIR) {
    return true;
  }
  const rootWithSlash = ROOT_DIR.endsWith("/") ? ROOT_DIR : `${ROOT_DIR}/`;
  return candidate.startsWith(rootWithSlash);
}

function isPlaybackProxyUrl(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  return (
    raw.startsWith("/api/remux?") || raw.startsWith("/api/hls/master.m3u8?")
  );
}

function parsePlaybackProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw, "http://localhost");
    if (
      url.pathname !== "/api/remux" &&
      url.pathname !== "/api/hls/master.m3u8"
    ) {
      return null;
    }

    const input = decodeURIComponent(
      url.searchParams.get("input") || "",
    ).trim();
    if (!input) {
      return null;
    }

    return {
      mode: url.pathname === "/api/remux" ? "remux" : "hls",
      input,
      audioStreamIndex: Number(url.searchParams.get("audioStream") || -1),
      subtitleStreamIndex: Number(url.searchParams.get("subtitleStream") || -1),
    };
  } catch {
    return null;
  }
}

function buildRemuxProxyUrl(
  input,
  { audioStreamIndex = -1, subtitleStreamIndex = -1 } = {},
) {
  const normalizedInput = String(input || "").trim();
  if (!normalizedInput) {
    return "";
  }
  const existingMeta = parsePlaybackProxyUrl(normalizedInput);
  const resolvedAudioStreamIndex =
    Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0
      ? Math.floor(audioStreamIndex)
      : Number.isFinite(existingMeta?.audioStreamIndex) &&
          existingMeta.audioStreamIndex >= 0
        ? Math.floor(existingMeta.audioStreamIndex)
        : -1;
  const resolvedSubtitleStreamIndex =
    Number.isFinite(subtitleStreamIndex) && subtitleStreamIndex >= 0
      ? Math.floor(subtitleStreamIndex)
      : Number.isFinite(existingMeta?.subtitleStreamIndex) &&
          existingMeta.subtitleStreamIndex >= 0
        ? Math.floor(existingMeta.subtitleStreamIndex)
        : -1;
  const query = new URLSearchParams({
    input: existingMeta?.input || normalizedInput,
  });
  if (resolvedAudioStreamIndex >= 0) {
    query.set("audioStream", String(resolvedAudioStreamIndex));
  }
  if (resolvedSubtitleStreamIndex >= 0) {
    query.set("subtitleStream", String(resolvedSubtitleStreamIndex));
  }
  return `/api/remux?${query.toString()}`;
}

function buildHlsMasterUrl(
  input,
  { audioStreamIndex = -1, subtitleStreamIndex = -1 } = {},
) {
  const normalizedInput = String(input || "").trim();
  if (!normalizedInput) {
    return "";
  }

  const query = new URLSearchParams({ input: normalizedInput });
  if (Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0) {
    query.set("audioStream", String(Math.floor(audioStreamIndex)));
  }
  if (Number.isFinite(subtitleStreamIndex) && subtitleStreamIndex >= 0) {
    query.set("subtitleStream", String(Math.floor(subtitleStreamIndex)));
  }
  return `/api/hls/master.m3u8?${query.toString()}`;
}

function extractPlayableSourceInput(sourceUrl) {
  const proxyMeta = parsePlaybackProxyUrl(sourceUrl);
  if (proxyMeta?.input) {
    return proxyMeta.input;
  }
  return String(sourceUrl || "").trim();
}

function hashStableString(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function shouldPreferSoftwareDecode(source) {
  const value = String(source || "").toLowerCase();
  return (
    value.includes(".mkv") ||
    value.includes(".avi") ||
    value.includes(".wmv") ||
    value.includes(".ts") ||
    value.includes(".m3u8")
  );
}

function shouldPreferSoftwareDecodeSource(source, filename = "") {
  const normalizedSource = String(source || "").toLowerCase();
  if (normalizedSource.includes("download.real-debrid.com")) {
    if (isLikelyHtml5PlayableUrl(source, filename)) {
      return false;
    }
    return true;
  }

  if (shouldPreferSoftwareDecode(source)) {
    return true;
  }

  const normalizedFilename = String(filename || "").toLowerCase();
  if (isLikelyHtml5PlayableUrl(source, normalizedFilename)) {
    return false;
  }
  return (
    normalizedFilename.endsWith(".mkv") ||
    normalizedFilename.endsWith(".avi") ||
    normalizedFilename.endsWith(".wmv") ||
    normalizedFilename.endsWith(".ts") ||
    normalizedFilename.endsWith(".m3u8")
  );
}

function resolveTranscodeInput(rawInput) {
  const input = String(rawInput || "").trim();
  if (!input) {
    throw new Error("Missing playback input.");
  }

  if (isHttpUrl(input)) {
    return input;
  }

  if (input.startsWith("/") && isPathInsideRootDir(input)) {
    return input;
  }

  const normalizedPath = input.startsWith("/") ? input : `/${input}`;
  const filePath = toLocalPath(normalizedPath);
  if (!filePath) {
    throw new Error("Invalid local playback path.");
  }

  return filePath;
}

function normalizeIsoLanguage(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return "";
  }

  const normalized = raw.replace(/[^a-z]/g, "");
  const aliasMap = {
    eng: "en",
    fre: "fr",
    fra: "fr",
    spa: "es",
    ger: "de",
    deu: "de",
    ita: "it",
    por: "pt",
    jpn: "ja",
    kor: "ko",
    zho: "zh",
    chi: "zh",
    dut: "nl",
    nld: "nl",
    rum: "ro",
    ron: "ro",
  };

  if (normalized.length === 2) {
    return normalized;
  }
  if (normalized in aliasMap) {
    return aliasMap[normalized];
  }
  return normalized.slice(0, 2);
}

function normalizeSubtitlePreference(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "auto") {
    return "";
  }
  if (raw === "off" || raw === "none" || raw === "disabled") {
    return "off";
  }
  return normalizeIsoLanguage(raw);
}

function normalizeImdbIdForLookup(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return "";
  }
  const digits = raw.replace(/^tt/, "").replace(/[^0-9]/g, "");
  return digits;
}

function toOpenSubtitlesLanguageCode(value) {
  const normalized = normalizeIsoLanguage(value);
  if (!normalized) {
    return "";
  }
  return ISO2_TO_OPENSUBTITLES_LANG[normalized] || "";
}

function buildExternalSubtitleLookupLanguages(preferredSubtitleLang = "") {
  const preferred = normalizeSubtitlePreference(preferredSubtitleLang);
  const fallbackOrder = [];
  if (preferred && preferred !== "off") {
    fallbackOrder.push(preferred);
  }
  fallbackOrder.push("en");

  const uniqueIso = [...new Set(fallbackOrder)];
  const normalized = uniqueIso
    .map((iso2) => ({
      iso2,
      openSubtitlesCode: toOpenSubtitlesLanguageCode(iso2),
    }))
    .filter((entry) => entry.openSubtitlesCode);
  return normalized;
}

function stripKnownVideoExtension(value) {
  return String(value || "").replace(
    /\.(mkv|mp4|avi|mov|wmv|m4v|webm|mpg|mpeg|ts)$/i,
    "",
  );
}

function extractTailPathSegment(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const parts = raw.split(/[/\\]+/).filter(Boolean);
  if (!parts.length) {
    return raw;
  }
  return String(parts[parts.length - 1] || "");
}

function buildSubtitleTargetName(metadata = {}) {
  const candidates = [
    metadata?.subtitleTargetName,
    metadata?.subtitleTargetFilePath,
    metadata?.subtitleTargetFilename,
    metadata?.selectedFilePath,
    metadata?.filename,
    metadata?.selectedFile,
  ];
  for (const candidate of candidates) {
    const tail = extractTailPathSegment(candidate);
    const cleaned = String(tail || candidate || "").trim();
    if (cleaned) {
      return cleaned;
    }
  }

  const displayTitle = String(metadata?.displayTitle || "").trim();
  if (!displayTitle) {
    return "";
  }

  const seasonNumber = Number(metadata?.seasonNumber);
  const episodeNumber = Number(metadata?.episodeNumber);
  if (
    Number.isFinite(seasonNumber) &&
    seasonNumber >= 1 &&
    Number.isFinite(episodeNumber) &&
    episodeNumber >= 1
  ) {
    return `${displayTitle} S${String(Math.floor(seasonNumber)).padStart(2, "0")}E${String(Math.floor(episodeNumber)).padStart(2, "0")}`;
  }

  const displayYear = String(metadata?.displayYear || "").trim();
  if (displayYear) {
    return `${displayTitle} ${displayYear}`;
  }
  return displayTitle;
}

function tokenizeSubtitleReleaseForMatch(value) {
  const normalized = normalizeTextForMatch(
    stripKnownVideoExtension(extractTailPathSegment(value)),
  );
  if (!normalized) {
    return [];
  }

  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      if (SUBTITLE_RELEASE_NOISE_TOKENS.has(token)) {
        return false;
      }
      if (/^s\d{1,2}e\d{1,3}$/.test(token)) {
        return true;
      }
      if (/^\d{1,2}x\d{1,3}$/.test(token)) {
        return true;
      }
      if (/^\d{3,4}p$/.test(token)) {
        return true;
      }
      if (/^(19|20)\d{2}$/.test(token)) {
        return true;
      }
      if (/^\d+$/.test(token)) {
        return false;
      }
      return token.length >= 3;
    });

  return [...new Set(tokens)];
}

function getSubtitleReleaseTokenWeight(token) {
  if (/^s\d{1,2}e\d{1,3}$/.test(token) || /^\d{1,2}x\d{1,3}$/.test(token)) {
    return 6;
  }
  if (/^(19|20)\d{2}$/.test(token)) {
    return 4;
  }
  if (/^\d{3,4}p$/.test(token)) {
    return 3;
  }
  if (token.length >= 8) {
    return 3;
  }
  if (token.length >= 5) {
    return 2;
  }
  return 1;
}

function extractLikelyReleaseGroupToken(value) {
  const tail = stripKnownVideoExtension(extractTailPathSegment(value));
  if (!tail) {
    return "";
  }

  const bracketMatch = tail.match(/\[([a-z0-9]{2,18})\]\s*$/i);
  const dashMatch = tail.match(/-([a-z0-9]{2,18})\s*$/i);
  const token = String(bracketMatch?.[1] || dashMatch?.[1] || "").toLowerCase();
  if (!token || SUBTITLE_RELEASE_NOISE_TOKENS.has(token)) {
    return "";
  }
  return token;
}

function buildExternalSubtitleReleaseText(entry) {
  return [
    entry?.MovieReleaseName,
    entry?.SubFileName,
    entry?.InfoReleaseGroup,
    entry?.MovieName,
    entry?.MovieNameEng,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function scoreExternalSubtitleCandidate(
  entry,
  metadata = {},
  subtitleTargetName = "",
) {
  const releaseText = buildExternalSubtitleReleaseText(entry);
  if (!releaseText) {
    return 0;
  }

  const releaseTokens = tokenizeSubtitleReleaseForMatch(releaseText);
  const releaseTokenSet = new Set(releaseTokens);
  let score = 0;

  const targetName = String(
    subtitleTargetName || buildSubtitleTargetName(metadata),
  ).trim();
  const targetTokens = tokenizeSubtitleReleaseForMatch(targetName);
  if (targetTokens.length && releaseTokens.length) {
    let overlapCount = 0;
    let weightedOverlap = 0;
    targetTokens.forEach((token) => {
      if (!releaseTokenSet.has(token)) {
        return;
      }
      overlapCount += 1;
      weightedOverlap += getSubtitleReleaseTokenWeight(token);
    });

    if (overlapCount > 0) {
      score += weightedOverlap * 14;
      score += Math.round((overlapCount / targetTokens.length) * 60);
    } else {
      score -= 30;
    }
  }

  const targetGroup = extractLikelyReleaseGroupToken(targetName);
  if (targetGroup && releaseTokenSet.has(targetGroup)) {
    score += 90;
  }

  const targetSeasonNumber = Number(metadata?.seasonNumber);
  const targetEpisodeNumber = Number(metadata?.episodeNumber);
  const hasTargetEpisode =
    Number.isFinite(targetSeasonNumber) &&
    Number.isFinite(targetEpisodeNumber) &&
    targetSeasonNumber >= 1 &&
    targetEpisodeNumber >= 1;
  if (hasTargetEpisode) {
    const targetSignature = buildEpisodeSignature(
      targetSeasonNumber,
      targetEpisodeNumber,
    );
    const releaseSignatures = collectEpisodeSignatures(
      releaseText,
      targetSeasonNumber,
    );
    if (releaseSignatures.length) {
      score += releaseSignatures.includes(targetSignature) ? 140 : -260;
    }
  }

  return score;
}

function buildExternalSubtitleLookupKey(metadata, preferredSubtitleLang = "") {
  const imdbDigits = normalizeImdbIdForLookup(
    metadata?.subtitleLookupImdbId || metadata?.imdbId || "",
  );
  if (!imdbDigits) {
    return "";
  }
  const preferred = normalizeSubtitlePreference(preferredSubtitleLang);
  const seasonNumber = Number(metadata?.seasonNumber);
  const episodeNumber = Number(metadata?.episodeNumber);
  const episodeScope =
    Number.isFinite(seasonNumber) &&
    Number.isFinite(episodeNumber) &&
    seasonNumber >= 1 &&
    episodeNumber >= 1
      ? `s${Math.floor(seasonNumber)}e${Math.floor(episodeNumber)}`
      : "single";
  const subtitleTargetName = buildSubtitleTargetName(metadata);
  const subtitleTargetTokens =
    tokenizeSubtitleReleaseForMatch(subtitleTargetName);
  const subtitleTargetFingerprint = subtitleTargetTokens.length
    ? hashStableString(
        `subtitle-target:${subtitleTargetTokens.join(" ")}`,
      ).slice(0, 14)
    : "generic";
  return `${imdbDigits}|${preferred || "auto"}|${episodeScope}|${subtitleTargetFingerprint}|v3`;
}

function isExternalSubtitleTrack(track) {
  return Boolean(
    track?.isExternal ||
    String(track?.vttUrl || "").includes("/api/subtitles.external.vtt") ||
    Number(track?.streamIndex) >= EXTERNAL_SUBTITLE_STREAM_INDEX_BASE,
  );
}

function getSubtitleLanguageDisplayName(value) {
  const normalized = normalizeIsoLanguage(value);
  const nameMap = {
    en: "English",
    fr: "French",
    es: "Spanish",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    nl: "Dutch",
    ro: "Romanian",
    pl: "Polish",
    tr: "Turkish",
    ru: "Russian",
    ar: "Arabic",
  };
  return nameMap[normalized] || "English";
}

function normalizeExternalSubtitleDownloadUrl(value) {
  const raw = String(value || "")
    .replace(/\\\//g, "/")
    .trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function isAllowedExternalSubtitleDownloadUrl(downloadUrl) {
  try {
    const parsed = new URL(downloadUrl);
    const hostname = String(parsed.hostname || "").toLowerCase();
    if (parsed.protocol !== "https:") {
      return false;
    }
    return (
      hostname === "dl.opensubtitles.org" ||
      hostname.endsWith(".opensubtitles.org")
    );
  } catch {
    return false;
  }
}

function buildExternalSubtitleVttUrl(downloadUrl) {
  const query = new URLSearchParams({ download: downloadUrl });
  return `/api/subtitles.external.vtt?${query.toString()}`;
}

function buildExternalSubtitleCachePath(downloadUrl) {
  const safeUrl = String(downloadUrl || "").trim();
  return join(
    HLS_CACHE_DIR,
    `${hashStableString(`external-subtitle:${safeUrl}`)}.vtt`,
  );
}

function decodeSubtitleBytes(rawBytes) {
  const bytes =
    rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes || 0);
  if (!bytes.length) {
    return "";
  }

  const decodeAttempts = ["utf-8", "windows-1252", "iso-8859-1"];
  for (const encoding of decodeAttempts) {
    try {
      const decoded = new TextDecoder(encoding).decode(bytes);
      if (decoded) {
        return decoded;
      }
    } catch {
      // Try next decoder.
    }
  }

  return "";
}

function normalizeSubtitleTextToVtt(rawText) {
  const sanitizeVttBody = (input) => {
    const lines = String(input || "").split("\n");
    const output = [];
    let inStyleBlock = false;

    const stripCueMarkup = (line) =>
      String(line || "")
        .replace(/\{\\[^}]*\}/g, "") // ASS override blocks
        .replace(/<c(\.[^>]*)?>/gi, "")
        .replace(/<\/c>/gi, "")
        .replace(/<v(?:\s+[^>]*)?>/gi, "")
        .replace(/<\/v>/gi, "")
        .replace(/<ruby>/gi, "")
        .replace(/<\/ruby>/gi, "")
        .replace(/<rt>/gi, "")
        .replace(/<\/rt>/gi, "")
        .replace(/<font[^>]*>/gi, "")
        .replace(/<\/font>/gi, "")
        .replace(/<span[^>]*>/gi, "")
        .replace(/<\/span>/gi, "");

    for (let index = 0; index < lines.length; index += 1) {
      const line = String(lines[index] || "");
      const trimmed = line.trim();

      if (inStyleBlock) {
        if (!trimmed) {
          inStyleBlock = false;
        }
        continue;
      }

      if (/^STYLE\b/i.test(trimmed)) {
        inStyleBlock = true;
        continue;
      }

      if (!trimmed) {
        output.push("");
        continue;
      }

      if (
        /^WEBVTT\b/i.test(trimmed) ||
        /^NOTE\b/i.test(trimmed) ||
        /^REGION\b/i.test(trimmed) ||
        /^X-TIMESTAMP-MAP=/i.test(trimmed) ||
        trimmed.includes("-->")
      ) {
        output.push(line);
        continue;
      }

      output.push(stripCueMarkup(line));
    }

    return output.join("\n");
  };

  const normalized = String(rawText || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!normalized) {
    return "WEBVTT\n\n";
  }

  if (/^WEBVTT\b/i.test(normalized)) {
    return `${sanitizeVttBody(normalized).trim()}\n`;
  }

  const vttBody = sanitizeVttBody(
    normalized.replace(/(\d{2}:\d{2}(?::\d{2})?),(\d{3})/g, "$1.$2"),
  );
  return `WEBVTT\n\n${vttBody}\n`;
}

function buildExternalSubtitleLabel(entry) {
  return getSubtitleLanguageDisplayName(
    entry?.ISO639 || entry?.SubLanguageID || "en",
  );
}

async function fetchOpenSubtitlesRows(imdbDigits, language) {
  const searchUrl = `${OPENSUBTITLES_REST_BASE}/search/imdbid-${encodeURIComponent(imdbDigits)}/sublanguageid-${encodeURIComponent(language)}`;
  try {
    const payload = await requestJson(
      searchUrl,
      {
        headers: {
          "User-Agent": OPENSUBTITLES_USER_AGENT,
        },
      },
      12000,
    );
    return Array.isArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

async function fetchExternalSubtitleTracksForMovie(
  metadata,
  preferredSubtitleLang = "",
) {
  const imdbDigits = normalizeImdbIdForLookup(
    metadata?.subtitleLookupImdbId || metadata?.imdbId || "",
  );
  if (!imdbDigits) {
    return [];
  }

  const lookupKey = buildExternalSubtitleLookupKey(
    metadata,
    preferredSubtitleLang,
  );
  if (!lookupKey) {
    return [];
  }

  const now = Date.now();
  const cached = externalSubtitleLookupCache.get(lookupKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inFlight = inFlightExternalSubtitleLookups.get(lookupKey);
  if (inFlight) {
    return inFlight;
  }

  const lookupTask = (async () => {
    const requestedLanguages = buildExternalSubtitleLookupLanguages(
      preferredSubtitleLang,
    );
    if (!requestedLanguages.length) {
      return [];
    }
    const subtitleTargetName = buildSubtitleTargetName(metadata);
    const targetSeasonNumber = Number(metadata?.seasonNumber);
    const targetEpisodeNumber = Number(metadata?.episodeNumber);
    const hasTargetEpisode =
      Number.isFinite(targetSeasonNumber) &&
      Number.isFinite(targetEpisodeNumber) &&
      targetSeasonNumber >= 1 &&
      targetEpisodeNumber >= 1;

    const allRows = [];
    for (const language of requestedLanguages) {
      const rows = await fetchOpenSubtitlesRows(
        imdbDigits,
        language.openSubtitlesCode,
      );
      rows.forEach((row) => {
        allRows.push({
          ...row,
          requestedIso2: language.iso2,
        });
      });
    }

    const dedupedByFile = new Map();
    allRows.forEach((entry) => {
      const downloadUrl = normalizeExternalSubtitleDownloadUrl(
        entry?.SubDownloadLink || entry?.ZipDownloadLink || "",
      );
      if (!downloadUrl || !isAllowedExternalSubtitleDownloadUrl(downloadUrl)) {
        return;
      }

      const providerId = String(
        entry?.IDSubtitleFile || entry?.IDSubtitle || "",
      ).trim();
      const dedupeKey = providerId || downloadUrl;
      if (!dedupeKey) {
        return;
      }
      if (hasTargetEpisode) {
        const rawSeason = Number(
          entry?.SeriesSeason ||
            entry?.seriesSeason ||
            entry?.series_season ||
            0,
        );
        const rawEpisode = Number(
          entry?.SeriesEpisode ||
            entry?.seriesEpisode ||
            entry?.series_episode ||
            0,
        );
        const entrySeason =
          Number.isFinite(rawSeason) && rawSeason > 0
            ? Math.floor(rawSeason)
            : 0;
        const entryEpisode =
          Number.isFinite(rawEpisode) && rawEpisode > 0
            ? Math.floor(rawEpisode)
            : 0;
        if (
          (entrySeason > 0 && entrySeason !== Math.floor(targetSeasonNumber)) ||
          (entryEpisode > 0 && entryEpisode !== Math.floor(targetEpisodeNumber))
        ) {
          return;
        }
      }

      const downloads = Number(entry?.SubDownloadsCnt || 0) || 0;
      const rating = Number(entry?.SubRating || 0) || 0;
      const language = normalizeIsoLanguage(
        entry?.ISO639 || entry?.SubLanguageID || entry?.requestedIso2 || "",
      );
      const matchScore = scoreExternalSubtitleCandidate(
        entry,
        metadata,
        subtitleTargetName,
      );
      const normalizedEntry = {
        providerId,
        provider: "opensubtitles",
        providerDownloadUrl: downloadUrl,
        downloads,
        rating,
        matchScore,
        language,
        label: buildExternalSubtitleLabel(entry),
      };

      const existing = dedupedByFile.get(dedupeKey);
      if (
        !existing ||
        normalizedEntry.matchScore > existing.matchScore ||
        (normalizedEntry.matchScore === existing.matchScore &&
          (normalizedEntry.downloads > existing.downloads ||
            (normalizedEntry.downloads === existing.downloads &&
              normalizedEntry.rating > existing.rating)))
      ) {
        dedupedByFile.set(dedupeKey, normalizedEntry);
      }
    });

    const preferredIso = normalizeSubtitlePreference(preferredSubtitleLang);
    const sorted = Array.from(dedupedByFile.values())
      .sort((left, right) => {
        const leftPreferred =
          preferredIso && left.language === preferredIso ? 1 : 0;
        const rightPreferred =
          preferredIso && right.language === preferredIso ? 1 : 0;
        if (leftPreferred !== rightPreferred) {
          return rightPreferred - leftPreferred;
        }
        if (left.matchScore !== right.matchScore) {
          return right.matchScore - left.matchScore;
        }
        if (left.downloads !== right.downloads) {
          return right.downloads - left.downloads;
        }
        return right.rating - left.rating;
      })
      .slice(0, EXTERNAL_SUBTITLE_MAX_TRACKS)
      .map((entry) => ({
        streamIndex: -1,
        language: entry.language || "en",
        title: "",
        codec: "webvtt",
        isDefault: false,
        isTextBased: true,
        isExternal: true,
        provider: entry.provider,
        providerId: entry.providerId,
        label: getSubtitleLanguageDisplayName(entry.language || "en"),
        vttUrl: buildExternalSubtitleVttUrl(entry.providerDownloadUrl),
      }));

    externalSubtitleLookupCache.set(lookupKey, {
      value: sorted,
      expiresAt: Date.now() + EXTERNAL_SUBTITLE_LOOKUP_TTL_MS,
    });
    trimCacheEntries(externalSubtitleLookupCache, 500);
    return sorted;
  })()
    .catch(() => [])
    .finally(() => {
      inFlightExternalSubtitleLookups.delete(lookupKey);
    });

  inFlightExternalSubtitleLookups.set(lookupKey, lookupTask);
  return lookupTask;
}

function mergeSubtitleTracksWithExternal(
  baseSubtitleTracks,
  externalSubtitleTracks,
) {
  const merged = Array.isArray(baseSubtitleTracks)
    ? baseSubtitleTracks
        .filter((track) => !isExternalSubtitleTrack(track))
        .map((track) => ({
          ...track,
          isExternal: false,
        }))
    : [];
  if (
    !Array.isArray(externalSubtitleTracks) ||
    externalSubtitleTracks.length === 0
  ) {
    return merged;
  }

  const usedIndices = new Set(
    merged
      .map((track) => Number(track?.streamIndex))
      .filter((value) => Number.isInteger(value) && value >= 0),
  );
  const existingExternalKeys = new Set(
    merged
      .filter((track) => isExternalSubtitleTrack(track))
      .map(
        (track) =>
          `${track?.provider || "external"}|${track?.providerId || ""}|${track?.vttUrl || ""}`,
      ),
  );
  let nextExternalStreamIndex = EXTERNAL_SUBTITLE_STREAM_INDEX_BASE;

  externalSubtitleTracks.forEach((track) => {
    const externalKey = `${track?.provider || "external"}|${track?.providerId || ""}|${track?.vttUrl || ""}`;
    if (existingExternalKeys.has(externalKey)) {
      return;
    }

    while (usedIndices.has(nextExternalStreamIndex)) {
      nextExternalStreamIndex += 1;
    }
    merged.push({
      ...track,
      streamIndex: nextExternalStreamIndex,
      isExternal: true,
    });
    usedIndices.add(nextExternalStreamIndex);
    existingExternalKeys.add(externalKey);
    nextExternalStreamIndex += 1;
  });

  return merged;
}

async function augmentTracksWithExternalSubtitles(
  tracks,
  metadata,
  preferredSubtitleLang = "",
) {
  const safeTracks =
    tracks && typeof tracks === "object"
      ? {
          ...tracks,
          subtitleTracks: Array.isArray(tracks.subtitleTracks)
            ? tracks.subtitleTracks
            : [],
        }
      : {
          durationSeconds: 0,
          audioTracks: [],
          subtitleTracks: [],
        };

  if (!metadata?.imdbId) {
    return safeTracks;
  }
  const normalizedPreferred = normalizeSubtitlePreference(
    preferredSubtitleLang,
  );
  if (normalizedPreferred === "off") {
    return safeTracks;
  }
  const hasEpisodeMetadata =
    Number.isFinite(Number(metadata?.seasonNumber)) &&
    Number(metadata?.seasonNumber) >= 1 &&
    Number.isFinite(Number(metadata?.episodeNumber)) &&
    Number(metadata?.episodeNumber) >= 1;
  const internalTextTracks = safeTracks.subtitleTracks.filter(
    (track) =>
      track &&
      track.isTextBased &&
      !isExternalSubtitleTrack(track) &&
      String(track.vttUrl || "").trim(),
  );
  if (!hasEpisodeMetadata) {
    if (!normalizedPreferred && internalTextTracks.length) {
      return safeTracks;
    }
    if (normalizedPreferred) {
      const hasPreferredInternal = internalTextTracks.some(
        (track) =>
          normalizeIsoLanguage(track?.language || "") === normalizedPreferred,
      );
      if (hasPreferredInternal) {
        return safeTracks;
      }
    }
  }
  try {
    const externalTracks = await fetchExternalSubtitleTracksForMovie(
      metadata,
      preferredSubtitleLang,
    );
    if (!externalTracks.length) {
      return safeTracks;
    }
    return {
      ...safeTracks,
      subtitleTracks: mergeSubtitleTracksWithExternal(
        safeTracks.subtitleTracks,
        externalTracks,
      ),
    };
  } catch {
    return safeTracks;
  }
}

function normalizeAudioSyncMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const rounded = Math.round(parsed);
  return Math.max(-1500, Math.min(1500, rounded));
}

function normalizeAutoAudioSyncEnabled(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function normalizeNativePlaybackMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    !normalized ||
    normalized === "auto" ||
    normalized === "on" ||
    normalized === "enabled" ||
    normalized === "1"
  ) {
    return "auto";
  }
  if (
    normalized === "off" ||
    normalized === "disabled" ||
    normalized === "0" ||
    normalized === "false"
  ) {
    return "off";
  }
  return "auto";
}

function normalizeRemuxVideoMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "auto" || normalized === "default") {
    return "auto";
  }
  if (
    normalized === "copy" ||
    normalized === "passthrough" ||
    normalized === "direct" ||
    normalized === "streamcopy"
  ) {
    return "copy";
  }
  if (
    normalized === "normalize" ||
    normalized === "transcode" ||
    normalized === "aggressive" ||
    normalized === "rebuild"
  ) {
    return "normalize";
  }
  return "auto";
}

function normalizeHlsHwaccelMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    !normalized ||
    normalized === "none" ||
    normalized === "off" ||
    normalized === "false" ||
    normalized === "0"
  ) {
    return "none";
  }
  if (normalized === "auto") {
    return process.platform === "darwin" ? "videotoolbox" : "none";
  }
  if (normalized === "videotoolbox" || normalized === "vt") {
    return "videotoolbox";
  }
  if (normalized === "cuda" || normalized === "nvenc") {
    return "cuda";
  }
  if (normalized === "qsv" || normalized === "intel") {
    return "qsv";
  }
  return "none";
}

function buildHlsVideoEncodeConfig(hwaccelMode = HLS_HWACCEL_MODE) {
  if (hwaccelMode === "videotoolbox") {
    return {
      mode: "videotoolbox",
      preInputArgs: ["-hwaccel", "videotoolbox"],
      videoEncodeArgs: [
        "-c:v",
        "h264_videotoolbox",
        "-b:v",
        "4500k",
        "-maxrate",
        "5500k",
        "-bufsize",
        "9000k",
      ],
    };
  }
  if (hwaccelMode === "cuda") {
    return {
      mode: "cuda",
      preInputArgs: ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"],
      videoEncodeArgs: [
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p5",
        "-cq",
        "23",
        "-b:v",
        "0",
      ],
    };
  }
  if (hwaccelMode === "qsv") {
    return {
      mode: "qsv",
      preInputArgs: ["-hwaccel", "qsv"],
      videoEncodeArgs: [
        "-c:v",
        "h264_qsv",
        "-global_quality",
        "23",
        "-look_ahead",
        "0",
      ],
    };
  }
  return {
    mode: "none",
    preInputArgs: [],
    videoEncodeArgs: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"],
  };
}

function buildMediaProbeCacheKey(
  source,
  { sourceHash = "", selectedFile = "" } = {},
) {
  const normalizedHash = String(sourceHash || "")
    .trim()
    .toLowerCase();
  const normalizedFile = String(selectedFile || "").trim();
  if (normalizedHash) {
    return `hash:${normalizedHash}:${normalizedFile}`;
  }

  const sourceInput = extractPlayableSourceInput(source);
  return `source:${sourceInput}`;
}

function getPersistedMediaProbeEntry(probeKey) {
  if (!persistentCacheDb || !probeKey) {
    return null;
  }

  let row = null;
  try {
    row = persistentCacheDb
      .query(
        `
      SELECT payload_json, updated_at
      FROM media_probe_cache
      WHERE probe_key = ?
    `,
      )
      .get(probeKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const updatedAt = Number(row.updated_at || 0);
  if (!updatedAt || updatedAt + MEDIA_PROBE_STALE_MS <= Date.now()) {
    try {
      persistentCacheDb
        .query("DELETE FROM media_probe_cache WHERE probe_key = ?")
        .run(probeKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  try {
    const payload = JSON.parse(String(row.payload_json || "{}"));
    if (!payload || typeof payload !== "object") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function setPersistedMediaProbeEntry(probeKey, payload) {
  if (!persistentCacheDb || !probeKey || !payload) {
    return;
  }

  try {
    persistentCacheDb
      .query(
        `
      INSERT INTO media_probe_cache (
        probe_key,
        payload_json,
        updated_at
      )
      VALUES (?, ?, ?)
      ON CONFLICT(probe_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `,
      )
      .run(probeKey, JSON.stringify(payload), Date.now());
  } catch {
    // Ignore persistent cache write failures.
  }
}

async function runProcessAndCapture(
  command,
  { timeoutMs = 15000, binary = false } = {},
) {
  const proc = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(
    () => {
      try {
        proc.kill();
      } catch {
        // Ignore kill errors.
      }
    },
    Math.max(1000, timeoutMs),
  );

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      binary
        ? new Response(proc.stdout).arrayBuffer()
        : new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      const message = String(
        stderr || `Process exited with code ${exitCode}`,
      ).trim();
      throw new Error(message || "Process execution failed.");
    }

    return binary ? new Uint8Array(stdout) : String(stdout || "");
  } finally {
    clearTimeout(timer);
  }
}

function parseFfmpegVersionLine(rawOutput) {
  const text = String(rawOutput || "");
  const line = text
    .split(/\r?\n/)
    .find((item) => item.toLowerCase().startsWith("ffmpeg version"));
  return String(line || "").trim();
}

function parseFfprobeVersionLine(rawOutput) {
  const text = String(rawOutput || "");
  const line = text
    .split(/\r?\n/)
    .find((item) => item.toLowerCase().startsWith("ffprobe version"));
  return String(line || "").trim();
}

function parseHwaccelList(rawOutput) {
  const lines = String(rawOutput || "")
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(
      (line) =>
        line &&
        line !== "hardware acceleration methods:" &&
        !line.startsWith("ffmpeg version"),
    );
  return [...new Set(lines)];
}

function hasFfmpegEncoder(rawOutput, encoderName) {
  const pattern = new RegExp(
    `\\b${String(encoderName || "").toLowerCase()}\\b`,
  );
  return pattern.test(String(rawOutput || "").toLowerCase());
}

function canUseRequestedHlsHwaccel(snapshot) {
  const mode = String(snapshot?.requestedHlsHwaccel || "none");
  if (mode === "none") {
    return true;
  }
  if (!snapshot?.ffmpegAvailable) {
    return false;
  }

  const hwaccels = Array.isArray(snapshot.hwaccels) ? snapshot.hwaccels : [];
  const encoders = snapshot?.encoders || {};
  if (mode === "videotoolbox") {
    return (
      Boolean(encoders.h264_videotoolbox) && hwaccels.includes("videotoolbox")
    );
  }
  if (mode === "cuda") {
    return Boolean(encoders.h264_nvenc) && hwaccels.includes("cuda");
  }
  if (mode === "qsv") {
    return Boolean(encoders.h264_qsv) && hwaccels.includes("qsv");
  }
  return false;
}

async function probeFfmpegCapabilities() {
  const snapshot = {
    checkedAt: Date.now(),
    ffmpegAvailable: false,
    ffprobeAvailable: false,
    ffmpegVersion: "",
    ffprobeVersion: "",
    requestedHlsHwaccel: HLS_HWACCEL_MODE,
    effectiveHlsHwaccel: "none",
    hwaccels: [],
    encoders: {
      h264_videotoolbox: false,
      h264_nvenc: false,
      h264_qsv: false,
    },
    notes: [],
  };

  try {
    const version = await runProcessAndCapture(
      ["ffmpeg", "-hide_banner", "-version"],
      { timeoutMs: 5000, binary: false },
    );
    snapshot.ffmpegAvailable = true;
    snapshot.ffmpegVersion = parseFfmpegVersionLine(version);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "unknown error");
    snapshot.notes.push(`ffmpeg unavailable: ${message}`);
  }

  try {
    const version = await runProcessAndCapture(
      ["ffprobe", "-hide_banner", "-version"],
      { timeoutMs: 5000, binary: false },
    );
    snapshot.ffprobeAvailable = true;
    snapshot.ffprobeVersion = parseFfprobeVersionLine(version);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "unknown error");
    snapshot.notes.push(`ffprobe unavailable: ${message}`);
  }

  if (snapshot.ffmpegAvailable) {
    try {
      const hwaccels = await runProcessAndCapture(
        ["ffmpeg", "-hide_banner", "-hwaccels"],
        { timeoutMs: 5000, binary: false },
      );
      snapshot.hwaccels = parseHwaccelList(hwaccels);
    } catch {
      snapshot.notes.push("Unable to read ffmpeg hwaccels.");
    }

    try {
      const encoders = await runProcessAndCapture(
        ["ffmpeg", "-hide_banner", "-encoders"],
        { timeoutMs: 8000, binary: false },
      );
      snapshot.encoders.h264_videotoolbox = hasFfmpegEncoder(
        encoders,
        "h264_videotoolbox",
      );
      snapshot.encoders.h264_nvenc = hasFfmpegEncoder(encoders, "h264_nvenc");
      snapshot.encoders.h264_qsv = hasFfmpegEncoder(encoders, "h264_qsv");
    } catch {
      snapshot.notes.push("Unable to read ffmpeg encoders.");
    }
  }

  if (canUseRequestedHlsHwaccel(snapshot)) {
    snapshot.effectiveHlsHwaccel = snapshot.requestedHlsHwaccel;
  } else {
    if (snapshot.requestedHlsHwaccel !== "none") {
      snapshot.notes.push(
        `Requested HLS hwaccel (${snapshot.requestedHlsHwaccel}) is not supported; software fallback will be used.`,
      );
    }
    snapshot.effectiveHlsHwaccel = "none";
  }

  return snapshot;
}

async function getFfmpegCapabilities(forceRefresh = false) {
  const isFresh =
    ffmpegCapabilitySnapshot.checkedAt > 0 &&
    Date.now() - ffmpegCapabilitySnapshot.checkedAt <
      FFMPEG_CAPABILITY_REFRESH_MS;
  if (!forceRefresh && isFresh) {
    return ffmpegCapabilitySnapshot;
  }

  if (ffmpegCapabilityTask) {
    return ffmpegCapabilityTask;
  }

  ffmpegCapabilityTask = probeFfmpegCapabilities()
    .then((snapshot) => {
      ffmpegCapabilitySnapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      ffmpegCapabilityTask = null;
    });

  return ffmpegCapabilityTask;
}

function parseMpvVersionLine(rawOutput) {
  const text = String(rawOutput || "");
  const line = text
    .split(/\r?\n/)
    .find((item) => item.toLowerCase().startsWith("mpv "));
  return String(line || "").trim();
}

async function probeNativePlayerStatus() {
  const snapshot = {
    checkedAt: Date.now(),
    mode: NATIVE_PLAYBACK_MODE,
    mpvBinary: MPV_BINARY,
    available: false,
    version: "",
    notes: [],
  };

  if (NATIVE_PLAYBACK_MODE === "off") {
    snapshot.notes.push("Native playback is disabled by configuration.");
    return snapshot;
  }

  try {
    const output = await runProcessAndCapture([MPV_BINARY, "--version"], {
      timeoutMs: 5000,
      binary: false,
    });
    const versionLine = parseMpvVersionLine(output);
    if (!versionLine) {
      snapshot.notes.push("mpv was found but version output was unexpected.");
      return snapshot;
    }
    snapshot.available = true;
    snapshot.version = versionLine;
    return snapshot;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "unknown error");
    snapshot.notes.push(`mpv unavailable: ${message}`);
    return snapshot;
  }
}

async function getNativePlayerStatus(forceRefresh = false) {
  const isFresh =
    nativePlayerStatusSnapshot.checkedAt > 0 &&
    Date.now() - nativePlayerStatusSnapshot.checkedAt <
      NATIVE_PLAYER_STATUS_REFRESH_MS;
  if (!forceRefresh && isFresh) {
    return nativePlayerStatusSnapshot;
  }

  if (nativePlayerStatusTask) {
    return nativePlayerStatusTask;
  }

  nativePlayerStatusTask = probeNativePlayerStatus()
    .then((snapshot) => {
      nativePlayerStatusSnapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      nativePlayerStatusTask = null;
    });

  return nativePlayerStatusTask;
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function toAbsolutePlaybackUrl(value, requestUrl) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    return new URL(raw, requestUrl).toString();
  } catch {
    return "";
  }
}

function isLoopbackHostname(value) {
  const hostname = String(value || "")
    .trim()
    .toLowerCase();
  return (
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "localhost"
  );
}

async function launchMpvPlayback({
  sourceUrl,
  subtitleUrl = "",
  title = "",
  startSeconds = 0,
  audioSyncMs = 0,
} = {}) {
  const normalizedSource = String(sourceUrl || "").trim();
  if (!normalizedSource) {
    throw new Error("Missing source URL.");
  }

  const safeStartSeconds =
    Number.isFinite(startSeconds) && startSeconds > 0
      ? Math.floor(startSeconds)
      : 0;
  const safeAudioSyncMs = normalizeAudioSyncMs(audioSyncMs);
  const safeSubtitleUrl = String(subtitleUrl || "").trim();
  const safeTitle = String(title || "").trim();
  const args = [
    MPV_BINARY,
    "--force-window=yes",
    "--idle=no",
    "--keep-open=no",
  ];
  if (safeTitle) {
    args.push(`--title=${safeTitle}`);
  }
  if (safeStartSeconds > 0) {
    args.push(`--start=${safeStartSeconds}`);
  }
  if (safeAudioSyncMs !== 0) {
    args.push(`--audio-delay=${(safeAudioSyncMs / 1000).toFixed(3)}`);
  }
  if (safeSubtitleUrl) {
    args.push(`--sub-file=${safeSubtitleUrl}`);
  }
  args.push(normalizedSource);

  const command = `nohup ${args.map(shellQuote).join(" ")} >/dev/null 2>&1 &`;
  const shell = Bun.spawn(["/bin/sh", "-lc", command], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const exitCode = await shell.exited;
  if (exitCode !== 0) {
    throw new Error("Failed to launch mpv.");
  }
}

function parseRuntimeFromLabelSeconds(value) {
  const text = String(value || "").toLowerCase();
  if (!text) {
    return 0;
  }

  const hmsMatch = text.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (hmsMatch) {
    const first = Number(hmsMatch[1] || 0);
    const second = Number(hmsMatch[2] || 0);
    const third = Number(hmsMatch[3] || 0);
    if (hmsMatch[3]) {
      return first * 3600 + second * 60 + third;
    }
    return first * 60 + second;
  }

  const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?\b/);
  const minutesMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?\b/);
  if (hoursMatch || minutesMatch) {
    const hours = Number(hoursMatch?.[1] || 0);
    const minutes = Number(minutesMatch?.[1] || 0);
    return Math.round(hours * 3600 + minutes * 60);
  }

  const compactMatch = text.match(/\b(\d{1,2})h(?:\s*|)(\d{1,2})m\b/);
  if (compactMatch) {
    const hours = Number(compactMatch[1] || 0);
    const minutes = Number(compactMatch[2] || 0);
    return hours * 3600 + minutes * 60;
  }

  return 0;
}

function parseFrameRateToFps(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return 0;
  }
  if (raw.includes("/")) {
    const [numRaw, denRaw] = raw.split("/", 2);
    const num = Number(numRaw);
    const den = Number(denRaw);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return num / den;
    }
    return 0;
  }
  const fps = Number(raw);
  return Number.isFinite(fps) && fps > 0 ? fps : 0;
}

function parseProbeTracksFromFfprobePayload(payload, sourceInput) {
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const formatDuration = Number(payload?.format?.duration);
  const durationSeconds =
    Number.isFinite(formatDuration) && formatDuration > 0
      ? Math.round(formatDuration)
      : 0;
  const formatName = String(payload?.format?.format_name || "")
    .trim()
    .toLowerCase();
  const formatLongName = String(payload?.format?.format_long_name || "").trim();

  const audioTracks = [];
  const subtitleTracks = [];
  let videoStartTimeSeconds = 0;
  let hasVideoStartTime = false;
  let videoBFrameLeadSeconds = 0;
  let videoFrameRateFps = 0;
  let videoBFrames = 0;
  let videoCodec = "";

  streams.forEach((stream) => {
    const streamIndex = Number(stream?.index);
    if (!Number.isInteger(streamIndex) || streamIndex < 0) {
      return;
    }

    const codecType = String(stream?.codec_type || "").toLowerCase();
    const codec = String(stream?.codec_name || "").toLowerCase();
    const tags =
      stream?.tags && typeof stream.tags === "object" ? stream.tags : {};
    const language = normalizeIsoLanguage(tags.language || tags.LANGUAGE || "");
    const title = String(tags.title || tags.handler_name || "").trim();
    const disposition =
      stream?.disposition && typeof stream.disposition === "object"
        ? stream.disposition
        : {};
    const isDefault = disposition.default === 1;
    const channels = Number(stream?.channels || 0) || 0;
    const parsedStartTime = Number(stream?.start_time);
    const startTimeSeconds =
      Number.isFinite(parsedStartTime) && parsedStartTime >= 0
        ? parsedStartTime
        : 0;

    if (codecType === "video" && !hasVideoStartTime) {
      videoStartTimeSeconds = startTimeSeconds;
      hasVideoStartTime = true;
      videoCodec = codec;
      const fps = parseFrameRateToFps(
        stream?.avg_frame_rate || stream?.r_frame_rate,
      );
      videoFrameRateFps = fps > 0 ? fps : 0;

      const bFrames = Number(stream?.has_b_frames || 0);
      if (Number.isFinite(bFrames) && bFrames > 0) {
        videoBFrames = Math.floor(bFrames);
      }
      if (videoBFrames > 0 && videoFrameRateFps > 0) {
        const leadSeconds = bFrames / fps;
        if (leadSeconds > 0 && leadSeconds < 1) {
          videoBFrameLeadSeconds = leadSeconds;
        }
      }
    }

    if (codecType === "audio") {
      audioTracks.push({
        streamIndex,
        language,
        title,
        codec,
        channels,
        isDefault,
        startTimeSeconds,
        label:
          title ||
          `${(language || "und").toUpperCase()}${channels ? ` ${channels}ch` : ""}`.trim(),
      });
      return;
    }

    if (codecType === "subtitle") {
      const textCodecSet = new Set([
        "subrip",
        "srt",
        "ass",
        "ssa",
        "webvtt",
        "mov_text",
        "text",
      ]);
      subtitleTracks.push({
        streamIndex,
        language,
        title,
        codec,
        isDefault,
        isTextBased: textCodecSet.has(codec),
        isExternal: false,
        label: title || `${(language || "und").toUpperCase()} subtitles`,
        vttUrl: textCodecSet.has(codec)
          ? `/api/subtitles.vtt?${new URLSearchParams({
              input: sourceInput,
              subtitleStream: String(streamIndex),
            }).toString()}`
          : "",
      });
    }
  });

  return {
    durationSeconds,
    formatName,
    formatLongName,
    videoStartTimeSeconds,
    videoBFrameLeadSeconds,
    videoFrameRateFps,
    videoBFrames,
    videoCodec,
    audioTracks,
    subtitleTracks,
  };
}

async function probeMediaTracks(source, options = {}) {
  const sourceInput = resolveTranscodeInput(source);
  const probeKey = buildMediaProbeCacheKey(sourceInput, options);
  const cached = getPersistedMediaProbeEntry(probeKey);
  if (cached) {
    return cached;
  }

  const inFlight = inFlightMediaProbeRequests.get(probeKey);
  if (inFlight) {
    return inFlight;
  }

  const task = runProcessAndCapture(
    [
      "ffprobe",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      sourceInput,
    ],
    { timeoutMs: 15000, binary: false },
  )
    .then((raw) => {
      let payload = null;
      try {
        payload = JSON.parse(String(raw || "{}"));
      } catch {
        payload = {};
      }
      const parsed = parseProbeTracksFromFfprobePayload(payload, sourceInput);
      setPersistedMediaProbeEntry(probeKey, parsed);
      return parsed;
    })
    .finally(() => {
      inFlightMediaProbeRequests.delete(probeKey);
    });

  inFlightMediaProbeRequests.set(probeKey, task);
  return task;
}

function chooseAudioTrackFromProbe(probe, preferredLang) {
  const audioTracks = Array.isArray(probe?.audioTracks)
    ? probe.audioTracks
    : [];
  if (!audioTracks.length) {
    return null;
  }

  const normalizedPreferred = normalizePreferredAudioLang(preferredLang);
  if (normalizedPreferred !== "auto") {
    const exact = audioTracks.find(
      (track) => track.language === normalizedPreferred,
    );
    if (exact) {
      return exact;
    }
  }

  return audioTracks.find((track) => track.isDefault) || audioTracks[0];
}

function isLikelyForcedSubtitleTrack(track) {
  const labelText = String(track?.label || "").toLowerCase();
  const titleText = String(track?.title || "").toLowerCase();
  const combined = `${labelText} ${titleText}`;
  return (
    combined.includes("forced") ||
    combined.includes("foreign") ||
    combined.includes("sign")
  );
}

function isPlayableSubtitleTrack(track) {
  return Boolean(
    track && track.isTextBased && String(track.vttUrl || "").trim(),
  );
}

function sortSubtitleTracksByPlaybackPreference(tracks = []) {
  return [...tracks].sort((left, right) => {
    const leftForced = isLikelyForcedSubtitleTrack(left) ? 1 : 0;
    const rightForced = isLikelyForcedSubtitleTrack(right) ? 1 : 0;
    if (leftForced !== rightForced) {
      return leftForced - rightForced;
    }

    const leftExternal = isExternalSubtitleTrack(left) ? 1 : 0;
    const rightExternal = isExternalSubtitleTrack(right) ? 1 : 0;
    if (leftExternal !== rightExternal) {
      return leftExternal - rightExternal;
    }

    const leftDefault = left?.isDefault ? 0 : 1;
    const rightDefault = right?.isDefault ? 0 : 1;
    if (leftDefault !== rightDefault) {
      return leftDefault - rightDefault;
    }

    return Number(left?.streamIndex || 0) - Number(right?.streamIndex || 0);
  });
}

function chooseSubtitleTrackFromProbe(probe, preferredSubtitleLang) {
  const subtitles = Array.isArray(probe?.subtitleTracks)
    ? probe.subtitleTracks.filter((track) => isPlayableSubtitleTrack(track))
    : [];
  if (!subtitles.length) {
    return null;
  }

  const normalized = normalizeSubtitlePreference(preferredSubtitleLang);
  if (!normalized || normalized === "off") {
    return null;
  }

  const languageMatches = subtitles.filter(
    (track) => track.language === normalized,
  );
  if (languageMatches.length) {
    return sortSubtitleTracksByPlaybackPreference(languageMatches)[0] || null;
  }

  const defaultMatches = subtitles.filter((track) => track.isDefault);
  if (defaultMatches.length) {
    return sortSubtitleTracksByPlaybackPreference(defaultMatches)[0] || null;
  }

  return sortSubtitleTracksByPlaybackPreference(subtitles)[0] || null;
}

function getPersistedTitleTrackPreference(tmdbId) {
  if (!persistentCacheDb) {
    return null;
  }

  const normalizedTmdbId = String(tmdbId || "").trim();
  if (!normalizedTmdbId) {
    return null;
  }

  let row = null;
  try {
    row = persistentCacheDb
      .query(
        `
      SELECT preferred_audio_lang, preferred_subtitle_lang, updated_at
      FROM title_track_preferences
      WHERE tmdb_id = ?
    `,
      )
      .get(normalizedTmdbId);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const updatedAt = Number(row.updated_at || 0);
  if (!updatedAt || updatedAt + TITLE_PREFERENCES_STALE_MS <= Date.now()) {
    try {
      persistentCacheDb
        .query("DELETE FROM title_track_preferences WHERE tmdb_id = ?")
        .run(normalizedTmdbId);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  return {
    audioLang: normalizePreferredAudioLang(row.preferred_audio_lang),
    subtitleLang: normalizeSubtitlePreference(row.preferred_subtitle_lang),
  };
}

function persistTitleTrackPreference(
  tmdbId,
  { audioLang = "", subtitleLang = "" } = {},
) {
  if (!persistentCacheDb) {
    return;
  }

  const normalizedTmdbId = String(tmdbId || "").trim();
  if (!normalizedTmdbId) {
    return;
  }

  const normalizedAudioLang = normalizePreferredAudioLang(audioLang);
  const normalizedSubtitleLang = normalizeSubtitlePreference(subtitleLang);

  try {
    persistentCacheDb
      .query(
        `
      INSERT INTO title_track_preferences (
        tmdb_id,
        preferred_audio_lang,
        preferred_subtitle_lang,
        updated_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tmdb_id) DO UPDATE SET
        preferred_audio_lang = CASE
          WHEN excluded.preferred_audio_lang != '' THEN excluded.preferred_audio_lang
          ELSE title_track_preferences.preferred_audio_lang
        END,
        preferred_subtitle_lang = CASE
          WHEN excluded.preferred_subtitle_lang != '' THEN excluded.preferred_subtitle_lang
          ELSE title_track_preferences.preferred_subtitle_lang
        END,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        normalizedTmdbId,
        normalizedAudioLang === "auto" ? "" : normalizedAudioLang,
        normalizedSubtitleLang,
        Date.now(),
      );
    if (normalizedAudioLang && normalizedAudioLang !== "auto") {
      Object.keys(STREAM_QUALITY_TARGETS).forEach((quality) => {
        deletePersistedPlaybackSession(
          buildPlaybackSessionKey(normalizedTmdbId, "auto", quality),
        );
      });
    }
  } catch {
    // Ignore persistent cache write failures.
  }
}

function deletePersistedTitleTrackPreference(tmdbId) {
  if (!persistentCacheDb) {
    return;
  }

  const normalizedTmdbId = String(tmdbId || "").trim();
  if (!normalizedTmdbId) {
    return;
  }

  try {
    persistentCacheDb
      .query("DELETE FROM title_track_preferences WHERE tmdb_id = ?")
      .run(normalizedTmdbId);
  } catch {
    // Ignore persistent cache delete failures.
  }
}

function deletePersistedPlaybackSessionsForTmdb(tmdbId) {
  if (!persistentCacheDb) {
    return;
  }

  const normalizedTmdbId = String(tmdbId || "").trim();
  if (!normalizedTmdbId) {
    return;
  }

  try {
    persistentCacheDb
      .query("DELETE FROM playback_sessions WHERE tmdb_id = ?")
      .run(normalizedTmdbId);
  } catch {
    // Ignore persistent cache delete failures.
  }
}

function getPersistedSourceHealthStats(sourceKey) {
  if (!persistentCacheDb) {
    return null;
  }

  const normalizedKey = String(sourceKey || "")
    .trim()
    .toLowerCase();
  if (!normalizedKey) {
    return null;
  }

  let row = null;
  try {
    row = persistentCacheDb
      .query(
        `
      SELECT
        total_success_count,
        total_failure_count,
        decode_failure_count,
        ended_early_count,
        playback_error_count,
        last_error,
        updated_at
      FROM source_health_stats
      WHERE source_key = ?
    `,
      )
      .get(normalizedKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const updatedAt = Number(row.updated_at || 0);
  if (!updatedAt || updatedAt + SOURCE_HEALTH_STALE_MS <= Date.now()) {
    try {
      persistentCacheDb
        .query("DELETE FROM source_health_stats WHERE source_key = ?")
        .run(normalizedKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  return {
    successCount: Math.max(0, Number(row.total_success_count || 0) || 0),
    failureCount: Math.max(0, Number(row.total_failure_count || 0) || 0),
    decodeFailureCount: Math.max(0, Number(row.decode_failure_count || 0) || 0),
    endedEarlyCount: Math.max(0, Number(row.ended_early_count || 0) || 0),
    playbackErrorCount: Math.max(0, Number(row.playback_error_count || 0) || 0),
    lastError: String(row.last_error || ""),
    updatedAt,
  };
}

function recordSourceHealthEvent(sourceKey, eventType, errorMessage = "") {
  if (!persistentCacheDb) {
    return;
  }

  const normalizedKey = String(sourceKey || "")
    .trim()
    .toLowerCase();
  if (!normalizedKey) {
    return;
  }

  const normalizedEventType = String(eventType || "")
    .trim()
    .toLowerCase();
  const isSuccess = normalizedEventType === "success";
  const isDecodeFailure = normalizedEventType === "decode_failure";
  const isEndedEarly = normalizedEventType === "ended_early";
  const isPlaybackError = normalizedEventType === "playback_error";
  const isFailure = isDecodeFailure || isEndedEarly || isPlaybackError;
  if (!isSuccess && !isFailure) {
    return;
  }

  try {
    persistentCacheDb
      .query(
        `
      INSERT INTO source_health_stats (
        source_key,
        total_success_count,
        total_failure_count,
        decode_failure_count,
        ended_early_count,
        playback_error_count,
        last_error,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        total_success_count = source_health_stats.total_success_count + excluded.total_success_count,
        total_failure_count = source_health_stats.total_failure_count + excluded.total_failure_count,
        decode_failure_count = source_health_stats.decode_failure_count + excluded.decode_failure_count,
        ended_early_count = source_health_stats.ended_early_count + excluded.ended_early_count,
        playback_error_count = source_health_stats.playback_error_count + excluded.playback_error_count,
        last_error = CASE
          WHEN excluded.last_error != '' THEN excluded.last_error
          ELSE source_health_stats.last_error
        END,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        normalizedKey,
        isSuccess ? 1 : 0,
        isFailure ? 1 : 0,
        isDecodeFailure ? 1 : 0,
        isEndedEarly ? 1 : 0,
        isPlaybackError ? 1 : 0,
        String(errorMessage || "").slice(0, 500),
        Date.now(),
      );
  } catch {
    // Ignore persistent cache write failures.
  }
}

function computeSourceHealthScore(sourceKey) {
  const stats = getPersistedSourceHealthStats(sourceKey);
  if (!stats) {
    return 0;
  }

  const attempts = stats.successCount + stats.failureCount;
  if (attempts <= 0) {
    return 0;
  }

  const successRate = stats.successCount / attempts;
  const confidenceFactor = Math.min(1, attempts / 6);
  let score = Math.round((successRate - 0.55) * 2800 * confidenceFactor);
  score -= Math.min(2400, stats.decodeFailureCount * 800);
  score -= Math.min(2000, stats.endedEarlyCount * 550);
  score -= Math.min(1200, stats.playbackErrorCount * 260);
  return score;
}

function buildHlsTranscodeJobKey(sourceInput, audioStreamIndex) {
  return `${sourceInput}|a:${Number.isFinite(audioStreamIndex) ? audioStreamIndex : -1}`;
}

function buildHlsTranscodeOutputPrefix(jobKey) {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return join(HLS_CACHE_DIR, `${hashStableString(jobKey)}-${stamp}`);
}

function buildHlsTranscodeSegmentPathFromPrefix(outputPrefix, segmentIndex) {
  return `${outputPrefix}-${String(Math.max(0, Math.floor(segmentIndex))).padStart(6, "0")}.ts`;
}

function buildHlsTranscodeSegmentPattern(outputPrefix) {
  return `${outputPrefix}-%06d.ts`;
}

function buildHlsTranscodePlaylistPath(outputPrefix) {
  return `${outputPrefix}.m3u8`;
}

function buildSubtitleCachePath(sourceInput, subtitleStreamIndex) {
  return join(
    HLS_CACHE_DIR,
    `${hashStableString(`${sourceInput}|s:${subtitleStreamIndex}`)}.vtt`,
  );
}

async function ensureHlsCacheDirectory() {
  try {
    await mkdir(HLS_CACHE_DIR, { recursive: true });
  } catch {
    // Ignore directory errors; later writes may still fail explicitly.
  }
}

function buildHlsTranscodeArgs(
  sourceInput,
  audioStreamIndex,
  encodeConfig,
  outputPrefix,
) {
  const safeAudioStreamIndex =
    Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0
      ? Math.floor(audioStreamIndex)
      : -1;
  return [
    "ffmpeg",
    "-v",
    "error",
    "-y",
    ...encodeConfig.preInputArgs,
    "-i",
    sourceInput,
    "-map",
    "0:v:0",
    "-map",
    safeAudioStreamIndex >= 0 ? `0:${safeAudioStreamIndex}?` : "0:a:0?",
    "-sn",
    ...encodeConfig.videoEncodeArgs,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-f",
    "segment",
    "-segment_time",
    String(HLS_SEGMENT_DURATION_SECONDS),
    "-segment_format",
    "mpegts",
    "-segment_list_type",
    "m3u8",
    "-segment_list_size",
    "0",
    "-segment_list",
    buildHlsTranscodePlaylistPath(outputPrefix),
    "-reset_timestamps",
    "1",
    buildHlsTranscodeSegmentPattern(outputPrefix),
  ];
}

function terminateHlsTranscodeJob(job) {
  if (!job?.process) {
    return;
  }
  try {
    job.process.kill();
  } catch {
    // Ignore kill errors for stale jobs.
  }
}

function startHlsTranscodeJob(
  sourceInput,
  audioStreamIndex,
  encodeMode = HLS_HWACCEL_MODE,
  allowSoftwareFallback = true,
) {
  const safeAudioStreamIndex =
    Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0
      ? Math.floor(audioStreamIndex)
      : -1;
  const jobKey = buildHlsTranscodeJobKey(sourceInput, safeAudioStreamIndex);
  const outputPrefix = buildHlsTranscodeOutputPrefix(jobKey);
  const encodeConfig = buildHlsVideoEncodeConfig(encodeMode);
  const args = buildHlsTranscodeArgs(
    sourceInput,
    safeAudioStreamIndex,
    encodeConfig,
    outputPrefix,
  );
  const process = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderrTask = new Response(process.stderr).text().catch(() => "");
  const now = Date.now();
  const job = {
    key: jobKey,
    sourceInput,
    audioStreamIndex: safeAudioStreamIndex,
    encodeMode: encodeConfig.mode,
    allowSoftwareFallback: Boolean(allowSoftwareFallback),
    outputPrefix,
    playlistPath: buildHlsTranscodePlaylistPath(outputPrefix),
    process,
    stderrTask,
    startedAt: now,
    lastAccessedAt: now,
    finishedAt: 0,
    exited: false,
    completed: false,
    exitCode: null,
    lastError: "",
  };
  job.exitTask = process.exited
    .then(async (code) => {
      job.exited = true;
      job.exitCode = Number(code || 0);
      job.completed = job.exitCode === 0;
      job.finishedAt = Date.now();
      job.lastError = String((await stderrTask) || "").trim();
      return job.exitCode;
    })
    .catch((error) => {
      job.exited = true;
      job.completed = false;
      job.exitCode = 1;
      job.finishedAt = Date.now();
      job.lastError =
        error instanceof Error ? error.message : String(error || "");
      return 1;
    });

  hlsTranscodeJobs.set(jobKey, job);
  return job;
}

async function ensureHlsTranscodeJob(sourceInput, audioStreamIndex = -1) {
  const safeAudioStreamIndex =
    Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0
      ? Math.floor(audioStreamIndex)
      : -1;
  const jobKey = buildHlsTranscodeJobKey(sourceInput, safeAudioStreamIndex);
  const existing = hlsTranscodeJobs.get(jobKey);
  if (existing) {
    existing.lastAccessedAt = Date.now();
    if (!existing.exited || existing.exitCode === 0) {
      return existing;
    }

    if (existing.allowSoftwareFallback && existing.encodeMode !== "none") {
      if (!loggedHlsHwaccelFallback) {
        loggedHlsHwaccelFallback = true;
        const message = existing.lastError || `exit code ${existing.exitCode}`;
        console.warn(
          `[transcode] HLS hardware acceleration (${existing.encodeMode}) failed, falling back to software encode: ${message}`,
        );
      }
      hlsTranscodeJobs.delete(jobKey);
      return startHlsTranscodeJob(
        sourceInput,
        safeAudioStreamIndex,
        "none",
        false,
      );
    }

    hlsTranscodeJobs.delete(jobKey);
  }

  await ensureHlsCacheDirectory();
  const preferredMode =
    ffmpegCapabilitySnapshot.checkedAt > 0
      ? ffmpegCapabilitySnapshot.effectiveHlsHwaccel
      : HLS_HWACCEL_MODE;
  const allowSoftwareFallback = preferredMode !== "none";
  return startHlsTranscodeJob(
    sourceInput,
    safeAudioStreamIndex,
    preferredMode,
    allowSoftwareFallback,
  );
}

async function waitForHlsSegmentFromJob(
  job,
  segmentIndex,
  timeoutMs = HLS_SEGMENT_WAIT_TIMEOUT_MS,
) {
  const safeSegmentIndex = Math.max(0, Math.floor(segmentIndex));
  const startedAt = Date.now();
  let activeJob = job;

  while (Date.now() - startedAt < Math.max(1000, timeoutMs)) {
    if (!activeJob) {
      throw new Error("HLS transcode job is unavailable.");
    }

    activeJob.lastAccessedAt = Date.now();
    const segmentPath = buildHlsTranscodeSegmentPathFromPrefix(
      activeJob.outputPrefix,
      safeSegmentIndex,
    );
    try {
      const segmentStat = await stat(segmentPath);
      if (segmentStat.isFile() && segmentStat.size > 0) {
        return segmentPath;
      }
    } catch {
      // Segment file not available yet.
    }

    if (activeJob.exited) {
      if (activeJob.exitCode === 0) {
        const segmentPath = buildHlsTranscodeSegmentPathFromPrefix(
          activeJob.outputPrefix,
          safeSegmentIndex,
        );
        return renderHlsSegmentOnDemand(
          activeJob.sourceInput,
          safeSegmentIndex,
          activeJob.audioStreamIndex,
          segmentPath,
        );
      }

      if (activeJob.allowSoftwareFallback && activeJob.encodeMode !== "none") {
        if (!loggedHlsHwaccelFallback) {
          loggedHlsHwaccelFallback = true;
          const message =
            activeJob.lastError || `exit code ${activeJob.exitCode}`;
          console.warn(
            `[transcode] HLS hardware acceleration (${activeJob.encodeMode}) failed, falling back to software encode: ${message}`,
          );
        }
        hlsTranscodeJobs.delete(activeJob.key);
        activeJob = startHlsTranscodeJob(
          activeJob.sourceInput,
          activeJob.audioStreamIndex,
          "none",
          false,
        );
        continue;
      }

      const detail = activeJob.lastError || `exit code ${activeJob.exitCode}`;
      throw new Error(`HLS transcode failed: ${detail}`);
    }

    await sleep(HLS_SEGMENT_WAIT_POLL_MS);
  }

  const timeoutSegmentPath = activeJob?.outputPrefix
    ? buildHlsTranscodeSegmentPathFromPrefix(
        activeJob.outputPrefix,
        safeSegmentIndex,
      )
    : "";
  return renderHlsSegmentOnDemand(
    activeJob?.sourceInput || "",
    safeSegmentIndex,
    activeJob?.audioStreamIndex ?? -1,
    timeoutSegmentPath,
  );
}

async function renderHlsSegmentOnDemand(
  sourceInput,
  segmentIndex,
  audioStreamIndex = -1,
  outputPath = "",
) {
  const safeSourceInput = String(sourceInput || "").trim();
  if (!safeSourceInput) {
    throw new Error("Missing playback input.");
  }

  await ensureHlsCacheDirectory();
  const safeSegmentIndex = Math.max(0, Math.floor(segmentIndex));
  const safeAudioStreamIndex =
    Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0
      ? Math.floor(audioStreamIndex)
      : -1;
  const segmentPath =
    String(outputPath || "").trim() ||
    buildHlsTranscodeSegmentPathFromPrefix(
      buildHlsTranscodeOutputPrefix(
        buildHlsTranscodeJobKey(safeSourceInput, safeAudioStreamIndex),
      ),
      safeSegmentIndex,
    );
  const segmentStartSeconds = safeSegmentIndex * HLS_SEGMENT_DURATION_SECONDS;
  const buildSegmentArgs = (encodeConfig) => [
    "ffmpeg",
    "-v",
    "error",
    ...encodeConfig.preInputArgs,
    "-ss",
    String(segmentStartSeconds),
    "-i",
    safeSourceInput,
    "-t",
    String(HLS_SEGMENT_DURATION_SECONDS),
    "-map",
    "0:v:0",
    "-map",
    safeAudioStreamIndex >= 0 ? `0:${safeAudioStreamIndex}?` : "0:a:0?",
    "-sn",
    ...encodeConfig.videoEncodeArgs,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-f",
    "mpegts",
    "pipe:1",
  ];

  const preferredMode =
    ffmpegCapabilitySnapshot.checkedAt > 0
      ? ffmpegCapabilitySnapshot.effectiveHlsHwaccel
      : HLS_HWACCEL_MODE;
  const primaryEncodeConfig = buildHlsVideoEncodeConfig(preferredMode);
  let segmentBytes = null;
  try {
    segmentBytes = await runProcessAndCapture(
      buildSegmentArgs(primaryEncodeConfig),
      {
        timeoutMs: 20000,
        binary: true,
      },
    );
  } catch (error) {
    if (primaryEncodeConfig.mode !== "none") {
      if (!loggedHlsHwaccelFallback) {
        loggedHlsHwaccelFallback = true;
        const message =
          error instanceof Error
            ? error.message
            : String(error || "Unknown FFmpeg error");
        console.warn(
          `[transcode] HLS hardware acceleration (${primaryEncodeConfig.mode}) failed, falling back to software encode: ${message}`,
        );
      }
      segmentBytes = await runProcessAndCapture(
        buildSegmentArgs(buildHlsVideoEncodeConfig("none")),
        { timeoutMs: 20000, binary: true },
      );
    } else {
      throw error;
    }
  }

  if (!segmentBytes?.length) {
    throw new Error(`Unable to create HLS segment ${safeSegmentIndex}.`);
  }
  await Bun.write(segmentPath, segmentBytes);
  return segmentPath;
}

async function getOrCreateHlsSegment(
  sourceInput,
  segmentIndex,
  audioStreamIndex = -1,
) {
  const safeSegmentIndex = Math.max(0, Math.floor(segmentIndex));
  const job = await ensureHlsTranscodeJob(sourceInput, audioStreamIndex);
  return waitForHlsSegmentFromJob(job, safeSegmentIndex);
}

async function createHlsPlaylistResponse(input, audioStreamIndex = -1) {
  const sourceInput = resolveTranscodeInput(input);
  const probe = await probeMediaTracks(sourceInput);
  const mediaDurationSeconds = Math.max(
    1,
    Number(probe?.durationSeconds || 0) || 0,
  );
  const segmentCount = Math.max(
    1,
    Math.ceil(mediaDurationSeconds / HLS_SEGMENT_DURATION_SECONDS),
  );
  const safeAudioStream =
    Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0
      ? Math.floor(audioStreamIndex)
      : -1;

  void ensureHlsTranscodeJob(sourceInput, safeAudioStream).catch(() => {
    // Segment requests will surface any transcode startup failure.
  });

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${HLS_SEGMENT_DURATION_SECONDS}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
  ];

  for (let index = 0; index < segmentCount; index += 1) {
    const remaining =
      mediaDurationSeconds - index * HLS_SEGMENT_DURATION_SECONDS;
    const segmentDuration = Math.max(
      0.5,
      Math.min(HLS_SEGMENT_DURATION_SECONDS, remaining),
    );
    const segmentUrl = `/api/hls/segment.ts?${new URLSearchParams({
      input: sourceInput,
      index: String(index),
      audioStream: String(safeAudioStream),
    }).toString()}`;
    lines.push(`#EXTINF:${segmentDuration.toFixed(3)},`);
    lines.push(segmentUrl);
  }

  lines.push("#EXT-X-ENDLIST");
  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function createHlsSegmentResponse(input, segmentIndex, audioStreamIndex) {
  const sourceInput = resolveTranscodeInput(input);
  const segmentPath = await getOrCreateHlsSegment(
    sourceInput,
    segmentIndex,
    audioStreamIndex,
  );
  const segmentFile = Bun.file(segmentPath);
  return new Response(segmentFile, {
    status: 200,
    headers: {
      "Content-Type": "video/mp2t",
      "Cache-Control": "public, max-age=60",
    },
  });
}

function buildSubtitleCacheKey(sourceInput, subtitleStreamIndex) {
  return `${sourceInput}|s:${subtitleStreamIndex}`;
}

async function hasFreshSubtitleCacheFile(sourceInput, subtitleStreamIndex) {
  const subtitlePath = buildSubtitleCachePath(sourceInput, subtitleStreamIndex);
  try {
    const subtitleStat = await stat(subtitlePath);
    return (
      subtitleStat.isFile() &&
      Date.now() - subtitleStat.mtimeMs < HLS_SEGMENT_STALE_MS
    );
  } catch {
    return false;
  }
}

function buildExternalSubtitleCacheKey(downloadUrl) {
  return String(downloadUrl || "").trim();
}

async function hasFreshExternalSubtitleCacheFile(downloadUrl) {
  const subtitlePath = buildExternalSubtitleCachePath(downloadUrl);
  try {
    const subtitleStat = await stat(subtitlePath);
    return (
      subtitleStat.isFile() &&
      Date.now() - subtitleStat.mtimeMs < EXTERNAL_SUBTITLE_CACHE_TTL_MS
    );
  } catch {
    return false;
  }
}

function isLikelyGzipPayload(downloadUrl, bytes, responseHeaders) {
  if (bytes?.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return true;
  }

  const contentEncoding = String(
    responseHeaders?.get?.("content-encoding") || "",
  ).toLowerCase();
  if (contentEncoding.includes("gzip")) {
    return true;
  }

  const contentType = String(
    responseHeaders?.get?.("content-type") || "",
  ).toLowerCase();
  if (contentType.includes("gzip")) {
    return true;
  }

  return String(downloadUrl || "")
    .toLowerCase()
    .endsWith(".gz");
}

async function fetchExternalSubtitlePayload(downloadUrl) {
  const safeUrl = normalizeExternalSubtitleDownloadUrl(downloadUrl);
  if (!safeUrl || !isAllowedExternalSubtitleDownloadUrl(safeUrl)) {
    throw new Error("Unsupported external subtitle URL.");
  }

  const response = await fetch(safeUrl, {
    headers: {
      "User-Agent": OPENSUBTITLES_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`External subtitle request failed (${response.status}).`);
  }

  const rawBytes = new Uint8Array(await response.arrayBuffer());
  if (!rawBytes.length) {
    return "";
  }

  let textBytes = rawBytes;
  if (isLikelyGzipPayload(safeUrl, rawBytes, response.headers)) {
    try {
      textBytes = new Uint8Array(gunzipSync(Buffer.from(rawBytes)));
    } catch {
      textBytes = rawBytes;
    }
  }

  const subtitleText = decodeSubtitleBytes(textBytes);
  return normalizeSubtitleTextToVtt(subtitleText);
}

function queueExternalSubtitleVttBuild(downloadUrl) {
  const safeUrl = normalizeExternalSubtitleDownloadUrl(downloadUrl);
  if (!safeUrl || !isAllowedExternalSubtitleDownloadUrl(safeUrl)) {
    return Promise.resolve("WEBVTT\n\n");
  }

  const cacheKey = buildExternalSubtitleCacheKey(safeUrl);
  const inFlight = inFlightExternalSubtitleBuilds.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const buildTask = (async () => {
    await ensureHlsCacheDirectory();
    const subtitleText = await fetchExternalSubtitlePayload(safeUrl);
    if (String(subtitleText || "").trim()) {
      await Bun.write(buildExternalSubtitleCachePath(safeUrl), subtitleText);
    }
    return subtitleText;
  })()
    .catch(() => "WEBVTT\n\n")
    .finally(() => {
      inFlightExternalSubtitleBuilds.delete(cacheKey);
    });

  inFlightExternalSubtitleBuilds.set(cacheKey, buildTask);
  return buildTask;
}

async function extractSubtitleVttText(sourceInput, subtitleStreamIndex) {
  const safeStreamIndex =
    Number.isFinite(subtitleStreamIndex) && subtitleStreamIndex >= 0
      ? Math.floor(subtitleStreamIndex)
      : -1;
  if (safeStreamIndex < 0) {
    return "";
  }

  const tryExtractSubtitle = async (mapSpecifier) => {
    return runProcessAndCapture(
      [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        sourceInput,
        "-map",
        mapSpecifier,
        "-c:s",
        "webvtt",
        "-f",
        "webvtt",
        "pipe:1",
      ],
      { timeoutMs: SUBTITLE_EXTRACT_TIMEOUT_MS, binary: false },
    );
  };

  let subtitleText = "";
  try {
    subtitleText = await tryExtractSubtitle(`0:${safeStreamIndex}`);
  } catch {
    subtitleText = "";
  }
  if (String(subtitleText || "").trim()) {
    return subtitleText;
  }

  try {
    const probe = await probeMediaTracks(sourceInput);
    const subtitleTracks = Array.isArray(probe?.subtitleTracks)
      ? probe.subtitleTracks
      : [];
    const subtitleOrdinal = subtitleTracks.findIndex(
      (track) => Number(track?.streamIndex) === safeStreamIndex,
    );
    if (subtitleOrdinal >= 0) {
      subtitleText = await tryExtractSubtitle(`0:s:${subtitleOrdinal}`);
    }
  } catch {
    subtitleText = "";
  }

  return subtitleText;
}

async function createExternalSubtitleVttResponse(downloadUrl) {
  const safeUrl = normalizeExternalSubtitleDownloadUrl(downloadUrl);
  if (!safeUrl || !isAllowedExternalSubtitleDownloadUrl(safeUrl)) {
    throw new Error("Missing or invalid external subtitle URL.");
  }

  if (await hasFreshExternalSubtitleCacheFile(safeUrl)) {
    return new Response(Bun.file(buildExternalSubtitleCachePath(safeUrl)), {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  const subtitleText = await queueExternalSubtitleVttBuild(safeUrl);
  return new Response(subtitleText || "WEBVTT\n\n", {
    status: 200,
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "public, max-age=120",
    },
  });
}

function queueSubtitleVttBuild(sourceInput, subtitleStreamIndex) {
  const safeStreamIndex =
    Number.isFinite(subtitleStreamIndex) && subtitleStreamIndex >= 0
      ? Math.floor(subtitleStreamIndex)
      : -1;
  if (safeStreamIndex < 0) {
    return Promise.resolve("");
  }

  const cacheKey = buildSubtitleCacheKey(sourceInput, safeStreamIndex);
  const inFlight = inFlightSubtitleVttBuilds.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const buildTask = (async () => {
    await ensureHlsCacheDirectory();
    const subtitleText = await extractSubtitleVttText(
      sourceInput,
      safeStreamIndex,
    );
    if (String(subtitleText || "").trim()) {
      await Bun.write(
        buildSubtitleCachePath(sourceInput, safeStreamIndex),
        subtitleText,
      );
    }
    return subtitleText;
  })()
    .catch(() => "")
    .finally(() => {
      inFlightSubtitleVttBuilds.delete(cacheKey);
    });

  inFlightSubtitleVttBuilds.set(cacheKey, buildTask);
  return buildTask;
}

function prewarmSubtitleVttBuild(input, subtitleStreamIndex) {
  const safeStreamIndex =
    Number.isFinite(subtitleStreamIndex) && subtitleStreamIndex >= 0
      ? Math.floor(subtitleStreamIndex)
      : -1;
  if (safeStreamIndex < 0) {
    return;
  }

  const sourceInput = resolveTranscodeInput(input);
  void (async () => {
    if (await hasFreshSubtitleCacheFile(sourceInput, safeStreamIndex)) {
      return;
    }
    await queueSubtitleVttBuild(sourceInput, safeStreamIndex);
  })().catch(() => {
    // Subtitle prewarm is best-effort.
  });
}

async function createSubtitleVttResponse(input, subtitleStreamIndex) {
  const sourceInput = resolveTranscodeInput(input);
  const safeStreamIndex =
    Number.isFinite(subtitleStreamIndex) && subtitleStreamIndex >= 0
      ? Math.floor(subtitleStreamIndex)
      : -1;
  if (safeStreamIndex < 0) {
    throw new Error("Missing or invalid subtitle stream index.");
  }

  if (await hasFreshSubtitleCacheFile(sourceInput, safeStreamIndex)) {
    return new Response(
      Bun.file(buildSubtitleCachePath(sourceInput, safeStreamIndex)),
      {
        status: 200,
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Cache-Control": "public, max-age=120",
        },
      },
    );
  }

  const subtitleText = await queueSubtitleVttBuild(
    sourceInput,
    safeStreamIndex,
  );
  if (!String(subtitleText || "").trim()) {
    return new Response("WEBVTT\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=30",
      },
    });
  }

  return new Response(subtitleText, {
    status: 200,
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "public, max-age=120",
    },
  });
}

async function createFfmpegProxyResponse(
  input,
  request,
  startSeconds = 0,
  audioStreamIndex = -1,
  subtitleStreamIndex = -1,
  manualAudioSyncMs = 0,
  preferredVideoMode = REMUX_VIDEO_MODE,
) {
  const source = resolveTranscodeInput(input);
  const safeStartSeconds =
    Number.isFinite(startSeconds) && startSeconds > 0
      ? Math.floor(startSeconds)
      : 0;
  const safeAudioStreamIndex =
    Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0
      ? Math.floor(audioStreamIndex)
      : -1;
  const safeSubtitleStreamIndex =
    Number.isFinite(subtitleStreamIndex) && subtitleStreamIndex >= 0
      ? Math.floor(subtitleStreamIndex)
      : -1;
  const safeManualAudioSyncMs = normalizeAudioSyncMs(manualAudioSyncMs);
  const requestedVideoMode = normalizeRemuxVideoMode(preferredVideoMode);
  let resolvedVideoMode = requestedVideoMode;
  const sourceLower = String(source || "")
    .trim()
    .toLowerCase();
  const sourcePathLower = sourceLower.replace(/[?#].*$/, "");
  const looksLikeMatroskaSource =
    sourcePathLower.includes(".mkv") ||
    sourcePathLower.includes(".mk3d") ||
    sourcePathLower.includes(".mka") ||
    sourcePathLower.includes(".webm");
  if (requestedVideoMode === "auto" && looksLikeMatroskaSource) {
    resolvedVideoMode = "normalize";
  } else if (requestedVideoMode === "auto") {
    resolvedVideoMode = "copy";
  }

  let probe = null;
  const shouldProbe = AUTO_AUDIO_SYNC_ENABLED || requestedVideoMode === "auto";
  if (shouldProbe) {
    try {
      probe = await probeMediaTracks(source);
    } catch {
      probe = null;
    }
  }

  if (requestedVideoMode === "auto" && resolvedVideoMode !== "normalize") {
    const probeFormat = String(probe?.formatName || "").toLowerCase();
    if (probeFormat.includes("matroska") || probeFormat.includes("webm")) {
      resolvedVideoMode = "normalize";
    }
  }

  const probeFormat = String(probe?.formatName || "").toLowerCase();
  const probeLooksLikeMatroska =
    probeFormat.includes("matroska") || probeFormat.includes("webm");
  const shouldApplyAutoAudioDelay =
    AUTO_AUDIO_SYNC_ENABLED &&
    probe &&
    (looksLikeMatroskaSource ||
      probeLooksLikeMatroska ||
      resolvedVideoMode === "normalize");
  let autoAudioDelayMs = 0;
  if (shouldApplyAutoAudioDelay) {
    try {
      const videoStart = Number(probe?.videoStartTimeSeconds || 0);
      const audioTracks = Array.isArray(probe?.audioTracks)
        ? probe.audioTracks
        : [];
      const selectedAudioTrack =
        audioTracks.find(
          (track) => Number(track?.streamIndex) === safeAudioStreamIndex,
        ) ||
        audioTracks[0] ||
        null;
      const audioStart = Number(selectedAudioTrack?.startTimeSeconds || 0);
      const timestampOffsetSeconds = videoStart - audioStart;
      if (
        Number.isFinite(timestampOffsetSeconds) &&
        timestampOffsetSeconds > 0.04 &&
        timestampOffsetSeconds < 1.5
      ) {
        autoAudioDelayMs = Math.round(timestampOffsetSeconds * 1000);
      }
    } catch {
      autoAudioDelayMs = 0;
    }
  }
  const totalAudioSyncMs = Math.max(
    -2500,
    Math.min(2500, autoAudioDelayMs + safeManualAudioSyncMs),
  );

  const ffmpegArgs = [
    "ffmpeg",
    "-v",
    "error",
    "-fflags",
    "+genpts+igndts+discardcorrupt",
    "-analyzeduration",
    "100M",
    "-probesize",
    "100M",
  ];

  if (safeStartSeconds > 0) {
    ffmpegArgs.push("-ss", String(safeStartSeconds));
  }

  const proxyArgs = [
    "-i",
    source,
    "-map",
    "0:v:0",
    "-map",
    safeAudioStreamIndex >= 0 ? `0:${safeAudioStreamIndex}?` : "0:a:0?",
  ];
  if (safeSubtitleStreamIndex >= 0) {
    proxyArgs.push("-map", `0:${safeSubtitleStreamIndex}?`);
  } else {
    proxyArgs.push("-sn");
  }
  const audioFilters = [];
  if (totalAudioSyncMs > 0) {
    audioFilters.push(`adelay=${totalAudioSyncMs}:all=1`);
  } else if (totalAudioSyncMs < 0) {
    const advanceSeconds = (Math.abs(totalAudioSyncMs) / 1000)
      .toFixed(3)
      .replace(/\.?0+$/, "");
    audioFilters.push(`atrim=start=${advanceSeconds}`);
    audioFilters.push("asetpts=PTS-STARTPTS");
  }
  audioFilters.push("aresample=async=1000:first_pts=0");
  proxyArgs.push("-af", audioFilters.join(","));
  if (resolvedVideoMode === "normalize") {
    proxyArgs.push(
      "-vf",
      "setpts=PTS-STARTPTS",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "high",
      "-level:v",
      "4.1",
      "-g",
      "48",
    );
  } else {
    proxyArgs.push("-c:v", "copy");
  }
  proxyArgs.push("-c:a", "aac", "-b:a", "192k");
  if (safeSubtitleStreamIndex >= 0) {
    proxyArgs.push("-c:s", "mov_text", "-disposition:s:0", "default");
  }
  proxyArgs.push(
    "-max_interleave_delta",
    "0",
    "-muxpreload",
    "0",
    "-muxdelay",
    "0",
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "frag_keyframe+empty_moov+faststart",
    "-f",
    "mp4",
    "pipe:1",
  );

  const ffmpeg = Bun.spawn([...ffmpegArgs, ...proxyArgs], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const killProcess = () => {
    try {
      ffmpeg.kill();
    } catch {
      // Ignore kill errors.
    }
  };

  request.signal.addEventListener("abort", killProcess, { once: true });
  ffmpeg.exited.finally(() => {
    request.signal.removeEventListener("abort", killProcess);
  });

  return new Response(ffmpeg.stdout, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "no-store",
      "X-Audio-Shift-Ms": String(totalAudioSyncMs),
      "X-Audio-Delay-Ms": String(Math.max(0, totalAudioSyncMs)),
      "X-Audio-Advance-Ms": String(Math.max(0, -totalAudioSyncMs)),
      "X-Auto-Audio-Delay-Ms": String(autoAudioDelayMs),
      "X-Manual-Audio-Sync-Ms": String(safeManualAudioSyncMs),
      "X-Subtitle-Stream-Index": String(safeSubtitleStreamIndex),
      "X-Auto-Audio-Sync-Enabled": AUTO_AUDIO_SYNC_ENABLED ? "1" : "0",
      "X-Remux-Video-Mode-Requested": requestedVideoMode,
      "X-Remux-Video-Mode-Resolved": resolvedVideoMode,
    },
  });
}

async function createRemuxResponse(
  input,
  request,
  startSeconds = 0,
  audioStreamIndex = -1,
  subtitleStreamIndex = -1,
  manualAudioSyncMs = 0,
  preferredVideoMode = REMUX_VIDEO_MODE,
) {
  return createFfmpegProxyResponse(
    input,
    request,
    startSeconds,
    audioStreamIndex,
    subtitleStreamIndex,
    manualAudioSyncMs,
    preferredVideoMode,
  );
}

async function serveStatic(pathname, request) {
  const filePath = toLocalPath(pathname);
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(filePath);
    const contentType = file.type || "application/octet-stream";
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type": contentType,
    });
    if (
      contentType.startsWith("text/") ||
      contentType.includes("javascript") ||
      contentType.includes("json")
    ) {
      headers.set("Cache-Control", "no-store");
    }

    const rangeHeader = request.headers.get("range") || "";
    const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (rangeMatch) {
      const [, rawStart, rawEnd] = rangeMatch;
      const size = fileStat.size;
      let start = rawStart ? Number(rawStart) : NaN;
      let end = rawEnd ? Number(rawEnd) : NaN;

      if (!Number.isFinite(start) && Number.isFinite(end)) {
        const suffixLength = Math.max(0, Math.floor(end));
        start = Math.max(0, size - suffixLength);
        end = size - 1;
      } else {
        start = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
        end = Number.isFinite(end)
          ? Math.min(size - 1, Math.floor(end))
          : size - 1;
      }

      if (start >= size || end < start) {
        headers.set("Content-Range", `bytes */${size}`);
        return new Response("Requested range not satisfiable", {
          status: 416,
          headers,
        });
      }

      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
      headers.set("Content-Length", String(end - start + 1));

      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers,
      });
    }

    headers.set("Content-Length", String(fileStat.size));
    return new Response(file, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function requestJson(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("Request timed out."));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(url, {
        ...options,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);

    if (response.status === 204) {
      return null;
    }

    const rawText = await response.text();
    let payload = null;

    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = { message: rawText };
      }
    }

    if (!response.ok) {
      const message =
        payload?.error ||
        payload?.message ||
        `Request failed (${response.status})`;
      throw new Error(message);
    }

    return payload;
  } catch (error) {
    if (
      error?.name === "AbortError" ||
      error?.message === "Request timed out."
    ) {
      throw new Error("Request timed out.");
    }

    throw error;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function ensureTmdbConfigured() {
  if (!TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY is not configured on the server.");
  }
}

function ensureRealDebridConfigured() {
  if (!REAL_DEBRID_TOKEN) {
    throw new Error("REAL_DEBRID_TOKEN is not configured on the server.");
  }
}

async function tmdbFetch(path, paramsObj = {}, timeoutMs = 20000) {
  ensureTmdbConfigured();

  const queryParams = {
    language: "en-US",
    ...paramsObj,
  };
  const cacheKey = buildTmdbResponseCacheKey(path, queryParams);
  const cached = getCachedTmdbResponse(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const query = new URLSearchParams(queryParams);
  query.set("api_key", TMDB_API_KEY);

  const payload = await requestJson(
    `${TMDB_BASE_URL}${path}?${query.toString()}`,
    {},
    timeoutMs,
  );
  setCachedTmdbResponse(cacheKey, payload, getTmdbCacheTtlMs(path));
  return cloneTmdbResponsePayload(payload);
}

async function rdFetch(
  path,
  { method = "GET", form = null, timeoutMs = 20000 } = {},
) {
  ensureRealDebridConfigured();

  const headers = {
    Authorization: `Bearer ${REAL_DEBRID_TOKEN}`,
  };

  let body;
  if (form) {
    const payload = new URLSearchParams();
    Object.entries(form).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        payload.append(key, String(value));
      }
    });

    body = payload.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  }

  return requestJson(
    `${REAL_DEBRID_API_BASE}${path}`,
    {
      method,
      headers,
      body,
    },
    timeoutMs,
  );
}

function parseSeedCount(streamTitle) {
  const match = String(streamTitle || "").match(/\u{1F464}\s*([0-9.,]+)/u);
  if (!match) {
    return 0;
  }

  return Number(match[1].replace(/[^0-9]/g, "")) || 0;
}

const SUPPORTED_SOURCE_FORMATS = new Set(["mp4"]);

function normalizeSourceHash(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return /^[a-f0-9]{40}$/.test(normalized) ? normalized : "";
}

function getStreamInfoHash(stream) {
  return normalizeSourceHash(stream?.infoHash);
}

function prioritizeCandidatesBySourceHash(
  candidates,
  rankedPool,
  sourceHash,
  limit = 10,
) {
  const normalizedHash = normalizeSourceHash(sourceHash);
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));
  if (!normalizedHash) {
    return candidates.slice(0, safeLimit);
  }

  const dedupByHash = (list = []) => {
    const seen = new Set();
    const output = [];
    list.forEach((item) => {
      const hash = getStreamInfoHash(item);
      if (!hash || seen.has(hash)) {
        return;
      }
      seen.add(hash);
      output.push(item);
    });
    return output;
  };

  const baseList = dedupByHash(candidates);
  const selectedFromBase =
    baseList.find((item) => getStreamInfoHash(item) === normalizedHash) || null;
  if (selectedFromBase) {
    return [
      selectedFromBase,
      ...baseList.filter((item) => item !== selectedFromBase),
    ].slice(0, safeLimit);
  }

  const selectedFromPool =
    dedupByHash(rankedPool).find(
      (item) => getStreamInfoHash(item) === normalizedHash,
    ) || null;
  if (!selectedFromPool) {
    return baseList.slice(0, safeLimit);
  }

  return [selectedFromPool, ...baseList].slice(0, safeLimit);
}

function normalizePreferredAudioLang(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized in AUDIO_LANGUAGE_TOKENS) return normalized;
  return "auto";
}

function normalizePreferredStreamQuality(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized === "4k" || normalized === "uhd" || normalized === "2160")
    return "2160p";
  if (normalized === "1080") return "1080p";
  if (normalized === "720") return "720p";
  return normalized in STREAM_QUALITY_TARGETS ? normalized : "auto";
}

function normalizePreferredContainer(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized === "mp4") return "mp4";
  return "auto";
}

function normalizeMinimumSeeders(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(50000, Math.floor(parsed)));
}

function normalizeAllowedFormats(value) {
  const sourceValues = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,\s]+/g)
        .filter(Boolean);
  const normalized = sourceValues
    .map((item) =>
      String(item || "")
        .trim()
        .toLowerCase(),
    )
    .filter((item) => SUPPORTED_SOURCE_FORMATS.has(item));
  const unique = [...new Set(normalized)];
  if (unique.length && !unique.includes("mp4")) {
    unique.unshift("mp4");
  }
  return unique;
}

function isMp4OnlyAllowedFormats(formats = []) {
  return Array.isArray(formats) && formats.length === 1 && formats[0] === "mp4";
}

function normalizeSourceLanguageFilter(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    !normalized ||
    normalized === "en" ||
    normalized === "eng" ||
    normalized === "english"
  ) {
    return SOURCE_LANGUAGE_FILTER_DEFAULT;
  }
  if (
    normalized === "any" ||
    normalized === "all" ||
    normalized === "auto" ||
    normalized === "*"
  ) {
    return "any";
  }
  if (SUPPORTED_SOURCE_LANGUAGE_FILTERS.has(normalized)) {
    return normalized;
  }
  return SOURCE_LANGUAGE_FILTER_DEFAULT;
}

function getDetectedStreamLanguages(stream) {
  const streamTextRaw = [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const streamText = ` ${streamTextRaw
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")} `;
  const matchedLanguages = new Set();
  if (!streamText.trim()) {
    return matchedLanguages;
  }

  Object.entries(AUDIO_LANGUAGE_TOKENS).forEach(([lang, tokens]) => {
    if (
      tokens.some((token) => {
        const normalizedToken = String(token || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
          .replace(/\s+/g, " ");
        if (!normalizedToken) {
          return false;
        }
        return streamText.includes(` ${normalizedToken} `);
      })
    ) {
      matchedLanguages.add(lang);
    }
  });

  return matchedLanguages;
}

function matchesSourceLanguageFilter(stream, sourceLanguage) {
  const safeSourceLanguage = normalizeSourceLanguageFilter(sourceLanguage);
  if (safeSourceLanguage === "any") {
    return true;
  }

  const matchedLanguages = getDetectedStreamLanguages(stream);
  if (matchedLanguages.has(safeSourceLanguage)) {
    // "English only" (and other explicit language filters) should reject mixed-language releases.
    return matchedLanguages.size === 1;
  }

  if (
    safeSourceLanguage === SOURCE_LANGUAGE_FILTER_DEFAULT &&
    matchedLanguages.size === 0
  ) {
    return true;
  }

  return false;
}

function applySourceStreamFilters(
  streams = [],
  {
    minSeeders = 0,
    allowedFormats = [],
    sourceLanguage = SOURCE_LANGUAGE_FILTER_DEFAULT,
  } = {},
) {
  const safeMinSeeders = normalizeMinimumSeeders(minSeeders);
  const safeAllowedFormats = normalizeAllowedFormats(allowedFormats);
  const effectiveAllowedFormats = safeAllowedFormats.length
    ? safeAllowedFormats
    : ["mp4"];
  const safeSourceLanguage = normalizeSourceLanguageFilter(sourceLanguage);
  const hasSeedFilter = safeMinSeeders > 0;
  const hasFormatFilter = effectiveAllowedFormats.length > 0;
  const hasLanguageFilter = safeSourceLanguage !== "any";

  if (!hasSeedFilter && !hasFormatFilter && !hasLanguageFilter) {
    return streams;
  }

  const allowedFormatSet = new Set(effectiveAllowedFormats);
  return streams.filter((stream) => {
    if (
      hasSeedFilter &&
      parseSeedCount(stream?.title || stream?.name || "") < safeMinSeeders
    ) {
      return false;
    }
    if (hasFormatFilter) {
      const container = inferStreamContainerLabel(stream);
      if (!container || !allowedFormatSet.has(container)) {
        return false;
      }
    }
    if (
      hasLanguageFilter &&
      !matchesSourceLanguageFilter(stream, safeSourceLanguage)
    ) {
      return false;
    }
    return true;
  });
}

function scoreStreamLanguagePreference(stream, preferredAudioLang) {
  const preferred = normalizePreferredAudioLang(preferredAudioLang);
  if (preferred === "auto") {
    return 0;
  }

  const streamText = [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!streamText) {
    return 0;
  }

  let score = 0;
  const preferredTokens = AUDIO_LANGUAGE_TOKENS[preferred] || [];
  if (preferredTokens.some((token) => streamText.includes(token))) {
    score += 2500;
  }

  Object.entries(AUDIO_LANGUAGE_TOKENS).forEach(([lang, tokens]) => {
    if (lang === preferred) return;
    if (tokens.some((token) => streamText.includes(token))) {
      score -= 1400;
    }
  });

  return score;
}

function scoreStreamTitleYearMatch(stream, metadata = {}) {
  const streamText = [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!streamText) {
    return 0;
  }

  const movieTitle = String(metadata.displayTitle || "").trim();
  const movieYear = String(metadata.displayYear || "").trim();
  const titleTokens = tokenizeTitleForMatch(movieTitle);
  if (!titleTokens.length) {
    return 0;
  }

  const matchedTokenCount = titleTokens.reduce((count, token) => {
    return count + (streamText.includes(token) ? 1 : 0);
  }, 0);
  const hasYear = movieYear ? streamText.includes(movieYear) : false;
  const requiredMatches = Math.min(2, titleTokens.length);

  if (matchedTokenCount >= requiredMatches && hasYear) {
    return 1800;
  }
  if (matchedTokenCount >= requiredMatches) {
    return 1100;
  }
  if (matchedTokenCount >= 1 && hasYear) {
    return 420;
  }
  if (matchedTokenCount === 0 && hasYear) {
    return -900;
  }
  return -600;
}

function scoreStreamRuntimeMatch(stream, metadata = {}) {
  const targetRuntimeSeconds = Math.max(
    0,
    Number(metadata.runtimeSeconds || 0) || 0,
  );
  if (targetRuntimeSeconds < 1800) {
    return 0;
  }

  const streamText = [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
  ]
    .filter(Boolean)
    .join(" ");

  const candidateRuntimeSeconds = parseRuntimeFromLabelSeconds(streamText);
  if (candidateRuntimeSeconds <= 0) {
    return 0;
  }

  const deltaRatio =
    Math.abs(candidateRuntimeSeconds - targetRuntimeSeconds) /
    targetRuntimeSeconds;
  if (deltaRatio <= 0.06) {
    return 420;
  }
  if (deltaRatio <= 0.12) {
    return 220;
  }
  if (deltaRatio <= 0.2) {
    return 60;
  }
  return -360;
}

function scoreStreamSeeders(stream) {
  const seedCount = parseSeedCount(stream?.title || stream?.name || "");
  if (seedCount <= 0) {
    return 0;
  }

  // Saturated seed score to avoid over-favoring huge swarms.
  return Math.min(900, Math.round(Math.log10(seedCount + 1) * 320));
}

function parseStreamVerticalResolution(stream) {
  const streamText = [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!streamText) {
    return 0;
  }

  if (/\b(2160p|4k|uhd)\b/.test(streamText)) {
    return 2160;
  }
  if (/\b(1080p|full\s*hd)\b/.test(streamText)) {
    return 1080;
  }
  if (/\b720p\b/.test(streamText)) {
    return 720;
  }
  if (/\b(480p|sd)\b/.test(streamText)) {
    return 480;
  }

  return 0;
}

function filterStreamsByQualityPreference(
  streams = [],
  preferredQuality = "auto",
) {
  const normalizedQuality = normalizePreferredStreamQuality(preferredQuality);
  if (normalizedQuality === "auto") {
    return streams;
  }

  const targetHeight = STREAM_QUALITY_TARGETS[normalizedQuality] || 0;
  if (!targetHeight) {
    return streams;
  }

  const exactMatches = streams.filter(
    (stream) => parseStreamVerticalResolution(stream) === targetHeight,
  );
  if (exactMatches.length) {
    return exactMatches;
  }

  const lowerOrEqualMatches = streams.filter((stream) => {
    const height = parseStreamVerticalResolution(stream);
    return height > 0 && height <= targetHeight;
  });
  if (lowerOrEqualMatches.length) {
    return lowerOrEqualMatches;
  }

  const higherMatches = streams.filter(
    (stream) => parseStreamVerticalResolution(stream) > targetHeight,
  );
  if (higherMatches.length) {
    return higherMatches;
  }

  return streams;
}

function scoreStreamQualityPreference(stream, preferredQuality = "auto") {
  const normalizedQuality = normalizePreferredStreamQuality(preferredQuality);
  if (normalizedQuality === "auto") {
    return 0;
  }

  const targetHeight = STREAM_QUALITY_TARGETS[normalizedQuality] || 0;
  const candidateHeight = parseStreamVerticalResolution(stream);
  if (!targetHeight || !candidateHeight) {
    return 0;
  }

  if (candidateHeight === targetHeight) {
    return 1400;
  }

  if (candidateHeight > targetHeight) {
    return -700 - Math.min(900, candidateHeight - targetHeight);
  }

  return -300 - Math.min(700, targetHeight - candidateHeight);
}

function scoreStreamQuality(
  stream,
  metadata = {},
  preferredAudioLang = "auto",
  preferredQuality = "auto",
) {
  const infoHash = String(stream?.infoHash || "")
    .trim()
    .toLowerCase();
  return (
    scoreStreamLanguagePreference(stream, preferredAudioLang) +
    scoreStreamQualityPreference(stream, preferredQuality) +
    scoreStreamTitleYearMatch(stream, metadata) +
    scoreStreamRuntimeMatch(stream, metadata) +
    scoreStreamSeeders(stream) +
    computeSourceHealthScore(infoHash)
  );
}

function sortMovieCandidates(
  streams,
  metadata,
  preferredAudioLang,
  preferredQuality,
) {
  return [...streams].sort((left, right) => {
    const rightScore = scoreStreamQuality(
      right,
      metadata,
      preferredAudioLang,
      preferredQuality,
    );
    const leftScore = scoreStreamQuality(
      left,
      metadata,
      preferredAudioLang,
      preferredQuality,
    );
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return parseSeedCount(right.title) - parseSeedCount(left.title);
  });
}

function sortEpisodeCandidates(
  streams,
  metadata,
  preferredAudioLang,
  preferredQuality,
) {
  return [...streams].sort((left, right) => {
    const rightScore =
      scoreStreamQuality(
        right,
        metadata,
        preferredAudioLang,
        preferredQuality,
      ) +
      scoreStreamEpisodeMatch(
        right,
        metadata.seasonNumber,
        metadata.episodeNumber,
      );
    const leftScore =
      scoreStreamQuality(left, metadata, preferredAudioLang, preferredQuality) +
      scoreStreamEpisodeMatch(
        left,
        metadata.seasonNumber,
        metadata.episodeNumber,
      );
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return parseSeedCount(right.title) - parseSeedCount(left.title);
  });
}

function moveContainerCandidatesToFront(candidates = [], container = "mp4") {
  const preferred = [];
  const rest = [];
  candidates.forEach((candidate) => {
    if (isStreamLikelyContainer(candidate, container)) {
      preferred.push(candidate);
      return;
    }
    rest.push(candidate);
  });
  return [...preferred, ...rest];
}

function scoreContainerDefaultLanguage(
  stream,
  sourceLanguage = SOURCE_LANGUAGE_FILTER_DEFAULT,
) {
  const normalizedSourceLanguage =
    normalizeSourceLanguageFilter(sourceLanguage);
  if (normalizedSourceLanguage === "any") {
    return 0;
  }

  const detected = getDetectedStreamLanguages(stream);
  if (detected.has(normalizedSourceLanguage)) {
    return detected.size === 1 ? 4 : 2;
  }
  if (
    detected.size === 0 &&
    normalizedSourceLanguage === SOURCE_LANGUAGE_FILTER_DEFAULT
  ) {
    return 1;
  }
  return -5;
}

function compareContainerDefaultCandidates(
  left,
  right,
  { sourceLanguage = SOURCE_LANGUAGE_FILTER_DEFAULT } = {},
) {
  const leftLanguageScore = scoreContainerDefaultLanguage(left, sourceLanguage);
  const rightLanguageScore = scoreContainerDefaultLanguage(
    right,
    sourceLanguage,
  );
  if (leftLanguageScore !== rightLanguageScore) {
    return rightLanguageScore - leftLanguageScore;
  }

  const leftResolution = parseStreamVerticalResolution(left);
  const rightResolution = parseStreamVerticalResolution(right);
  if (leftResolution !== rightResolution) {
    return rightResolution - leftResolution;
  }

  const leftSeeders = parseSeedCount(left?.title || left?.name || "");
  const rightSeeders = parseSeedCount(right?.title || right?.name || "");
  if (leftSeeders !== rightSeeders) {
    return rightSeeders - leftSeeders;
  }

  return 0;
}

function pickBestContainerCandidate(
  rankedPool = [],
  container = "mp4",
  { sourceLanguage = SOURCE_LANGUAGE_FILTER_DEFAULT } = {},
) {
  const containerCandidates = rankedPool.filter((candidate) =>
    isStreamLikelyContainer(candidate, container),
  );
  if (!containerCandidates.length) {
    return null;
  }

  const sorted = [...containerCandidates].sort((left, right) =>
    compareContainerDefaultCandidates(left, right, {
      sourceLanguage,
    }),
  );
  return sorted[0] || null;
}

function ensureAtLeastOneContainerCandidate(
  candidates = [],
  rankedPool = [],
  container = "mp4",
  limit = 10,
  { sourceLanguage = SOURCE_LANGUAGE_FILTER_DEFAULT } = {},
) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));
  const current = candidates.slice(0, safeLimit);
  if (!current.length) {
    return [];
  }
  if (
    current.some((candidate) => isStreamLikelyContainer(candidate, container))
  ) {
    return current;
  }

  const currentHashes = new Set(
    current.map((candidate) => getStreamInfoHash(candidate)).filter(Boolean),
  );
  const fallback = pickBestContainerCandidate(rankedPool, container, {
    sourceLanguage,
  });
  if (!fallback) {
    return current;
  }
  const fallbackHash = getStreamInfoHash(fallback);
  if (fallbackHash && currentHashes.has(fallbackHash)) {
    return current;
  }

  const next = [...current];
  next[next.length - 1] = fallback;
  return next;
}

function applyMp4DefaultCandidateRule(
  candidates = [],
  rankedPool = [],
  sourceHash = "",
  limit = 10,
  { sourceLanguage = SOURCE_LANGUAGE_FILTER_DEFAULT } = {},
) {
  const withMp4Candidate = ensureAtLeastOneContainerCandidate(
    candidates,
    rankedPool,
    "mp4",
    limit,
    { sourceLanguage },
  );
  if (!withMp4Candidate.length) {
    return withMp4Candidate;
  }
  if (normalizeSourceHash(sourceHash)) {
    return withMp4Candidate;
  }

  const bestMp4 = pickBestContainerCandidate(withMp4Candidate, "mp4", {
    sourceLanguage,
  });
  if (!bestMp4) {
    return moveContainerCandidatesToFront(withMp4Candidate, "mp4");
  }

  return [
    bestMp4,
    ...withMp4Candidate.filter((candidate) => candidate !== bestMp4),
  ];
}

function selectTopMovieCandidates(
  streams,
  metadata,
  preferredAudioLang,
  preferredQuality,
  sourceHash = "",
  limit = 10,
  sourceFilters = {},
) {
  const rankedPool = streams.filter(
    (stream) => stream && getStreamInfoHash(stream),
  );
  const filteredPool = applySourceStreamFilters(rankedPool, sourceFilters);
  if (!filteredPool.length) {
    return [];
  }
  const qualityFilteredCandidates = filterStreamsByQualityPreference(
    filteredPool,
    preferredQuality,
  );
  const sorted = sortMovieCandidates(
    qualityFilteredCandidates,
    metadata,
    preferredAudioLang,
    preferredQuality,
  );
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));
  const capped = sorted.slice(0, safeLimit);
  const selectedTop = prioritizeCandidatesBySourceHash(
    capped,
    sorted,
    sourceHash,
    safeLimit,
  );
  return applyMp4DefaultCandidateRule(
    selectedTop,
    sorted,
    sourceHash,
    safeLimit,
    {
      sourceLanguage: sourceFilters?.sourceLanguage,
    },
  );
}

function selectTopEpisodeCandidates(
  streams,
  metadata,
  preferredAudioLang,
  preferredQuality,
  preferredContainer = "auto",
  sourceHash = "",
  limit = 10,
  sourceFilters = {},
) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));
  const rankedPool = streams.filter(
    (stream) => stream && getStreamInfoHash(stream),
  );
  const filteredPool = applySourceStreamFilters(rankedPool, sourceFilters);
  if (!filteredPool.length) {
    return [];
  }
  const qualityFilteredCandidates = filterStreamsByQualityPreference(
    filteredPool,
    preferredQuality,
  );
  const sorted = sortEpisodeCandidates(
    qualityFilteredCandidates,
    metadata,
    preferredAudioLang,
    preferredQuality,
  );
  const selectedTop = prioritizeCandidatesBySourceHash(
    sorted.slice(0, safeLimit),
    sorted,
    sourceHash,
    safeLimit,
  );
  return applyMp4DefaultCandidateRule(
    selectedTop,
    sorted,
    sourceHash,
    safeLimit,
    {
      sourceLanguage: sourceFilters?.sourceLanguage,
    },
  );
}

function hasUrlLikeContainerExtension(value, container = "mp4") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }

  if (container === "mp4") {
    return /\.mp4(?:$|[?#&/])/i.test(normalized);
  }

  return false;
}

function isStreamLikelyContainer(stream, container = "mp4") {
  const inferredContainer = inferStreamContainerLabel(stream);
  if (inferredContainer) {
    return inferredContainer === container;
  }

  const streamText = [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!streamText) {
    return false;
  }

  if (container === "mp4") {
    if (/\.mp4\b/.test(streamText)) {
      return true;
    }
    if (/\.(mkv|avi|wmv|ts|m3u8)\b/.test(streamText)) {
      return false;
    }
  }

  if (container === "mkv") {
    if (/\.mkv\b/.test(streamText)) {
      return true;
    }
    if (/\.(mp4|avi|wmv|ts|m3u8)\b/.test(streamText)) {
      return false;
    }
  }

  return false;
}

function inferStreamContainerLabel(stream) {
  const streamText = [
    stream?.behaviorHints?.filename,
    stream?.title,
    stream?.name,
    stream?.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!streamText) {
    return "";
  }
  if (/\.mp4\b/.test(streamText)) return "mp4";
  if (/\.mkv\b/.test(streamText)) return "mkv";
  if (/\.avi\b/.test(streamText)) return "avi";
  if (/\.wmv\b/.test(streamText)) return "wmv";
  if (/\.m3u8\b/.test(streamText)) return "m3u8";
  if (/\.ts\b/.test(streamText)) return "ts";
  return "";
}

function extractStreamTitleLines(stream) {
  return String(stream?.title || "")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

function extractStreamSizeLabel(stream) {
  const streamText = String(stream?.title || "");
  const match = streamText.match(/💾\s*([^\n⚙👤]+)/u);
  return String(match?.[1] || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStreamReleaseGroup(stream) {
  const streamText = String(stream?.title || "");
  const match = streamText.match(/⚙\s*([^\n👤]+)/u);
  return String(match?.[1] || "")
    .replace(/\s+/g, " ")
    .replace(/^[^a-z0-9]+/i, "")
    .trim();
}

function summarizeStreamCandidateForClient(
  stream,
  metadata = {},
  preferredAudioLang = "auto",
  preferredQuality = "auto",
) {
  const infoHash = getStreamInfoHash(stream);
  if (!infoHash) {
    return null;
  }

  const titleLines = extractStreamTitleLines(stream);
  const filename = String(stream?.behaviorHints?.filename || "").trim();
  const primary =
    filename || titleLines[0] || String(stream?.name || "").trim() || "Source";
  const provider = String(stream?.name || "")
    .replace(/\s+/g, " ")
    .trim();
  const seeders = parseSeedCount(stream?.title || stream?.name || "");
  const resolution = parseStreamVerticalResolution(stream);
  const container = inferStreamContainerLabel(stream);
  const score = scoreStreamQuality(
    stream,
    metadata,
    preferredAudioLang,
    preferredQuality,
  );
  const episodeMatchBonus = metadata?.episodeNumber
    ? scoreStreamEpisodeMatch(
        stream,
        metadata.seasonNumber,
        metadata.episodeNumber,
      )
    : 0;

  return {
    sourceHash: infoHash,
    infoHash,
    provider,
    primary,
    filename,
    qualityLabel: resolution > 0 ? `${resolution}p` : "",
    container,
    seeders,
    size: extractStreamSizeLabel(stream),
    releaseGroup: extractStreamReleaseGroup(stream),
    score: score + episodeMatchBonus,
  };
}

function isResolvedSourceLikelyContainer(resolvedSource, container = "mp4") {
  const playableUrl = String(resolvedSource?.playableUrl || "").trim();
  const sourceInput = extractPlayableSourceInput(playableUrl);
  const candidates = [
    String(resolvedSource?.filename || "").trim(),
    playableUrl,
    sourceInput,
    ...(Array.isArray(resolvedSource?.fallbackUrls)
      ? resolvedSource.fallbackUrls
      : []),
  ];

  return candidates.some((candidate) =>
    hasUrlLikeContainerExtension(candidate, container),
  );
}

function normalizeTextForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenizeTitleForMatch(title) {
  const normalized = normalizeTextForMatch(title);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !TITLE_MATCH_STOPWORDS.has(token));
}

function doesFilenameLikelyMatchMovie(filename, movieTitle, movieYear) {
  const normalizedFilename = normalizeTextForMatch(filename);
  if (!normalizedFilename) {
    return true;
  }

  const titleTokens = tokenizeTitleForMatch(movieTitle);
  if (!titleTokens.length) {
    return true;
  }

  const expectedYear = String(movieYear || "").trim();
  const yearMatchesInFilename =
    normalizedFilename.match(/\b(?:19|20)\d{2}\b/g) || [];
  const hasExpectedYear =
    expectedYear && yearMatchesInFilename.includes(expectedYear);
  const hasConflictingYear = Boolean(
    expectedYear && yearMatchesInFilename.length && !hasExpectedYear,
  );

  const matchedTokenCount = titleTokens.reduce((count, token) => {
    return count + (normalizedFilename.includes(token) ? 1 : 0);
  }, 0);
  const requiredTokenMatches =
    titleTokens.length === 1 ? 1 : Math.min(2, titleTokens.length);

  if (matchedTokenCount >= requiredTokenMatches) {
    if (!expectedYear) {
      return true;
    }
    if (hasExpectedYear) {
      return true;
    }
    return !hasConflictingYear;
  }

  if (matchedTokenCount >= 1 && hasExpectedYear) {
    return true;
  }

  return false;
}

function buildMagnetUri(stream, fallbackName) {
  const infoHash = String(stream?.infoHash || "")
    .trim()
    .toLowerCase();
  if (!infoHash) {
    throw new Error("Missing torrent info hash.");
  }

  const sourceTrackers = Array.isArray(stream?.sources)
    ? stream.sources
        .filter(
          (source) =>
            typeof source === "string" && source.startsWith("tracker:"),
        )
        .map((source) => source.slice("tracker:".length))
        .filter(Boolean)
    : [];

  const trackers = [...new Set([...sourceTrackers, ...DEFAULT_TRACKERS])];

  const parts = [`xt=urn:btih:${infoHash}`];
  if (fallbackName) {
    parts.push(`dn=${encodeURIComponent(fallbackName)}`);
  }

  trackers.forEach((tracker) => {
    parts.push(`tr=${encodeURIComponent(tracker)}`);
  });

  return `magnet:?${parts.join("&")}`;
}

function pickVideoFileIds(files, preferredFilename, fallbackName = "") {
  const list = Array.isArray(files)
    ? files.filter((file) => Number.isInteger(file?.id))
    : [];
  if (!list.length) {
    return [];
  }

  const mp4Files = list.filter((file) =>
    VIDEO_FILE_REGEX.test(String(file.path || "")),
  );
  if (!mp4Files.length) {
    return [];
  }

  const preferredNeedle = String(preferredFilename || "")
    .trim()
    .toLowerCase();
  if (preferredNeedle) {
    const preferredFile = mp4Files.find((file) =>
      String(file.path || "")
        .toLowerCase()
        .includes(preferredNeedle),
    );
    if (preferredFile) {
      return [preferredFile.id];
    }
  }

  const fallbackEpisodeSignatures = collectEpisodeSignatures(fallbackName);
  const fallbackSeasonHint = Number(
    fallbackEpisodeSignatures[0]?.split("x")?.[0] || 0,
  );
  if (fallbackEpisodeSignatures.length) {
    const episodeMatchedFile = mp4Files.find((file) => {
      const fileSignatures = collectEpisodeSignatures(
        String(file.path || ""),
        fallbackSeasonHint || null,
      );
      if (!fileSignatures.length) {
        return false;
      }
      return fallbackEpisodeSignatures.some((signature) =>
        fileSignatures.includes(signature),
      );
    });
    if (episodeMatchedFile) {
      return [episodeMatchedFile.id];
    }
  }

  const largestVideo = mp4Files.reduce((largest, file) => {
    if (!largest) return file;
    return Number(file.bytes || 0) > Number(largest.bytes || 0)
      ? file
      : largest;
  }, null);

  return largestVideo ? [largestVideo.id] : [];
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function safeDeleteTorrent(torrentId, timeoutMs = 5000) {
  if (!torrentId) {
    return;
  }

  try {
    await rdFetch(`/torrents/delete/${torrentId}`, {
      method: "DELETE",
      timeoutMs,
    });
  } catch {
    // Ignore cleanup errors.
  }
}

async function waitForTorrentToBeReady(torrentId, timeoutMs = 18000) {
  const start = Date.now();
  let lastStatus = "pending";

  while (Date.now() - start < timeoutMs) {
    const info = await rdFetch(`/torrents/info/${torrentId}`);
    const status = String(info?.status || "").toLowerCase();

    if (status) {
      lastStatus = status;
    }

    if (
      status === "downloaded" &&
      Array.isArray(info?.links) &&
      info.links.length
    ) {
      return info;
    }

    if (TORRENT_FATAL_STATUSES.has(status)) {
      throw new Error(`Real-Debrid torrent failed (${status}).`);
    }

    await sleep(1200);
  }

  throw new Error(`Timed out waiting for cached source (${lastStatus}).`);
}

async function resolvePlayableUrlFromRdLink(rdLink) {
  const unrestricted = await rdFetch("/unrestrict/link", {
    method: "POST",
    form: { link: rdLink },
    timeoutMs: 12000,
  });

  if (!unrestricted?.download) {
    throw new Error("Real-Debrid returned no downloadable link.");
  }

  const playableUrls = [unrestricted.download];

  return {
    playableUrls,
    filename: unrestricted.filename || "",
  };
}

async function verifyPlayableUrl(playableUrl, timeoutMs = 8000) {
  if (!playableUrl) {
    throw new Error("Resolved stream URL is empty.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const unavailableStatusErrorName = "ResolvedStreamUnavailableError";

  try {
    const response = await fetch(playableUrl, {
      method: "HEAD",
      signal: controller.signal,
    });

    if (response.ok) {
      return { ok: true, uncertain: false };
    }

    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404 ||
      response.status >= 500
    ) {
      const unavailableError = new Error(
        `Resolved stream is unavailable (${response.status}).`,
      );
      unavailableError.name = unavailableStatusErrorName;
      throw unavailableError;
    }

    // Some hosts reject HEAD but still allow GET playback (for example 405).
    return { ok: false, uncertain: true };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ok: false, uncertain: true };
    }

    if (error?.name === unavailableStatusErrorName) {
      throw error;
    }

    return { ok: false, uncertain: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isLikelyHtml5PlayableUrl(playableUrl, filename = "") {
  const value = String(playableUrl || "").toLowerCase();
  const normalizedFilename = String(filename || "").toLowerCase();
  if (!value) return false;
  if (normalizedFilename.endsWith(".mkv")) return false;
  if (normalizedFilename.endsWith(".avi")) return false;
  if (normalizedFilename.endsWith(".wmv")) return false;
  if (normalizedFilename.endsWith(".ts")) return false;
  if (normalizedFilename.endsWith(".m3u8")) return false;
  if (value.includes(".m3u8")) return false;
  if (value.includes(".mkv")) return false;
  if (value.includes(".avi")) return false;
  if (value.includes(".wmv")) return false;
  if (value.includes(".ts")) return false;
  return true;
}

function pushUniqueUrl(target, value) {
  if (!value || target.includes(value)) {
    return;
  }
  target.push(value);
}

function normalizeResolvedSourceForSoftwareDecode(
  source,
  { audioStreamIndex = -1, subtitleStreamIndex = -1 } = {},
) {
  const normalized = cloneResolvedSource(source);
  const currentPlayable = String(normalized.playableUrl || "").trim();
  if (!currentPlayable) {
    return normalized;
  }

  const hasExplicitAudioSelection =
    Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0;
  const hasExplicitSubtitleSelection =
    Number.isFinite(subtitleStreamIndex) && subtitleStreamIndex >= 0;
  if (
    !hasExplicitAudioSelection &&
    !hasExplicitSubtitleSelection &&
    !shouldPreferSoftwareDecodeSource(currentPlayable, normalized.filename)
  ) {
    return normalized;
  }

  const proxyMeta = isPlaybackProxyUrl(currentPlayable)
    ? parsePlaybackProxyUrl(currentPlayable)
    : null;
  const sourceInput = proxyMeta?.input || currentPlayable;
  const existingFallbacks = Array.isArray(normalized.fallbackUrls)
    ? [...normalized.fallbackUrls]
    : [];
  const preferredRemux = buildRemuxProxyUrl(sourceInput, {
    audioStreamIndex,
    subtitleStreamIndex,
  });
  const preferredPrimary = preferredRemux;
  if (!preferredPrimary) {
    return normalized;
  }

  const nextFallbacks = [];
  pushUniqueUrl(nextFallbacks, currentPlayable);
  if (sourceInput !== currentPlayable) {
    pushUniqueUrl(nextFallbacks, sourceInput);
  }
  existingFallbacks.forEach((url) => {
    if (url === preferredPrimary) {
      return;
    }
    pushUniqueUrl(nextFallbacks, url);
  });

  normalized.playableUrl = preferredPrimary;
  normalized.fallbackUrls = nextFallbacks;
  return normalized;
}

function buildResolvedStreamCacheKey(stream) {
  const infoHash = String(stream?.infoHash || "")
    .trim()
    .toLowerCase();
  const filenameHint = String(stream?.behaviorHints?.filename || "")
    .trim()
    .toLowerCase();
  if (!infoHash) {
    return "";
  }
  return `${infoHash}:${filenameHint}`;
}

function cloneResolvedSource(source) {
  return {
    playableUrl: String(source?.playableUrl || ""),
    fallbackUrls: Array.isArray(source?.fallbackUrls)
      ? [...source.fallbackUrls]
      : [],
    filename: String(source?.filename || ""),
    sourceHash: String(source?.sourceHash || ""),
    selectedFile: String(source?.selectedFile || ""),
    selectedFilePath: String(source?.selectedFilePath || ""),
  };
}

function cloneResolvedMovieResult(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    playableUrl: String(value.playableUrl || ""),
    fallbackUrls: Array.isArray(value.fallbackUrls)
      ? [...value.fallbackUrls]
      : [],
    filename: String(value.filename || ""),
    sourceHash: String(value.sourceHash || ""),
    selectedFile: String(value.selectedFile || ""),
    selectedFilePath: String(value.selectedFilePath || ""),
    sourceInput: String(value.sourceInput || ""),
    selectedAudioStreamIndex: Number.isFinite(
      Number(value.selectedAudioStreamIndex),
    )
      ? Math.max(-1, Math.floor(Number(value.selectedAudioStreamIndex)))
      : -1,
    selectedSubtitleStreamIndex: Number.isFinite(
      Number(value.selectedSubtitleStreamIndex),
    )
      ? Math.max(-1, Math.floor(Number(value.selectedSubtitleStreamIndex)))
      : -1,
    metadata:
      value.metadata && typeof value.metadata === "object"
        ? {
            tmdbId: String(value.metadata.tmdbId || ""),
            imdbId: String(value.metadata.imdbId || ""),
            subtitleLookupImdbId: String(
              value.metadata.subtitleLookupImdbId || "",
            ),
            displayTitle: String(value.metadata.displayTitle || ""),
            displayYear: String(value.metadata.displayYear || ""),
            runtimeSeconds: Number(value.metadata.runtimeSeconds || 0) || 0,
            seasonNumber: Number.isFinite(Number(value.metadata.seasonNumber))
              ? Math.max(0, Math.floor(Number(value.metadata.seasonNumber)))
              : 0,
            episodeNumber: Number.isFinite(Number(value.metadata.episodeNumber))
              ? Math.max(0, Math.floor(Number(value.metadata.episodeNumber)))
              : 0,
            episodeTitle: String(value.metadata.episodeTitle || ""),
            subtitleTargetName: String(value.metadata.subtitleTargetName || ""),
            subtitleTargetFilename: String(
              value.metadata.subtitleTargetFilename || "",
            ),
            subtitleTargetFilePath: String(
              value.metadata.subtitleTargetFilePath || "",
            ),
          }
        : {},
    tracks:
      value.tracks && typeof value.tracks === "object"
        ? {
            durationSeconds: Number(value.tracks.durationSeconds || 0) || 0,
            audioTracks: Array.isArray(value.tracks.audioTracks)
              ? value.tracks.audioTracks.map((track) => ({
                  streamIndex: Number(track?.streamIndex || 0) || 0,
                  language: String(track?.language || ""),
                  title: String(track?.title || ""),
                  codec: String(track?.codec || ""),
                  channels: Number(track?.channels || 0) || 0,
                  isDefault: Boolean(track?.isDefault),
                  label: String(track?.label || ""),
                }))
              : [],
            subtitleTracks: Array.isArray(value.tracks.subtitleTracks)
              ? value.tracks.subtitleTracks.map((track) => ({
                  streamIndex: Number(track?.streamIndex || 0) || 0,
                  language: String(track?.language || ""),
                  title: String(track?.title || ""),
                  codec: String(track?.codec || ""),
                  isDefault: Boolean(track?.isDefault),
                  isTextBased: Boolean(track?.isTextBased),
                  isExternal: Boolean(track?.isExternal),
                  provider: String(track?.provider || ""),
                  providerId: String(track?.providerId || ""),
                  label: String(track?.label || ""),
                  vttUrl: String(track?.vttUrl || ""),
                }))
              : [],
          }
        : {
            durationSeconds: 0,
            audioTracks: [],
            subtitleTracks: [],
          },
    preferences:
      value.preferences && typeof value.preferences === "object"
        ? {
            audioLang: normalizePreferredAudioLang(value.preferences.audioLang),
            subtitleLang: normalizeSubtitlePreference(
              value.preferences.subtitleLang,
            ),
            quality: normalizePreferredStreamQuality(value.preferences.quality),
          }
        : {
            audioLang: "auto",
            subtitleLang: "",
            quality: "auto",
          },
  };
}

function getPersistentResolvedStreamCount() {
  if (!persistentCacheDb) {
    return 0;
  }

  try {
    const row = persistentCacheDb
      .query("SELECT COUNT(*) AS count FROM resolved_stream_cache")
      .get();
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

function getPersistentMovieQuickStartCount() {
  if (!persistentCacheDb) {
    return 0;
  }

  try {
    const row = persistentCacheDb
      .query("SELECT COUNT(*) AS count FROM movie_quick_start_cache")
      .get();
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

function getPersistentTmdbResponseCount() {
  if (!persistentCacheDb) {
    return 0;
  }

  try {
    const row = persistentCacheDb
      .query("SELECT COUNT(*) AS count FROM tmdb_response_cache")
      .get();
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

function getPersistentPlaybackSessionCount() {
  if (!persistentCacheDb) {
    return 0;
  }

  try {
    const row = persistentCacheDb
      .query("SELECT COUNT(*) AS count FROM playback_sessions")
      .get();
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

function getPersistentSourceHealthCount() {
  if (!persistentCacheDb) {
    return 0;
  }

  try {
    const row = persistentCacheDb
      .query("SELECT COUNT(*) AS count FROM source_health_stats")
      .get();
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

function getPersistentMediaProbeCount() {
  if (!persistentCacheDb) {
    return 0;
  }

  try {
    const row = persistentCacheDb
      .query("SELECT COUNT(*) AS count FROM media_probe_cache")
      .get();
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

function getPersistentTitlePreferenceCount() {
  if (!persistentCacheDb) {
    return 0;
  }

  try {
    const row = persistentCacheDb
      .query("SELECT COUNT(*) AS count FROM title_track_preferences")
      .get();
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

function trimPersistentResolvedStreamEntries(maxEntries) {
  if (!persistentCacheDb) {
    return;
  }

  const overflow = getPersistentResolvedStreamCount() - maxEntries;
  if (overflow <= 0) {
    return;
  }

  try {
    persistentCacheDb
      .query(
        `
      DELETE FROM resolved_stream_cache
      WHERE rowid IN (
        SELECT rowid
        FROM resolved_stream_cache
        ORDER BY updated_at ASC
        LIMIT ?
      )
    `,
      )
      .run(overflow);
  } catch {
    // Ignore persistent cache trim failures.
  }
}

function trimPersistentMovieQuickStartEntries(maxEntries) {
  if (!persistentCacheDb) {
    return;
  }

  const overflow = getPersistentMovieQuickStartCount() - maxEntries;
  if (overflow <= 0) {
    return;
  }

  try {
    persistentCacheDb
      .query(
        `
      DELETE FROM movie_quick_start_cache
      WHERE rowid IN (
        SELECT rowid
        FROM movie_quick_start_cache
        ORDER BY updated_at ASC
        LIMIT ?
      )
    `,
      )
      .run(overflow);
  } catch {
    // Ignore persistent cache trim failures.
  }
}

function trimPersistentTmdbResponseEntries(maxEntries) {
  if (!persistentCacheDb) {
    return;
  }

  const overflow = getPersistentTmdbResponseCount() - maxEntries;
  if (overflow <= 0) {
    return;
  }

  try {
    persistentCacheDb
      .query(
        `
      DELETE FROM tmdb_response_cache
      WHERE rowid IN (
        SELECT rowid
        FROM tmdb_response_cache
        ORDER BY updated_at ASC
        LIMIT ?
      )
    `,
      )
      .run(overflow);
  } catch {
    // Ignore persistent cache trim failures.
  }
}

function trimPersistentPlaybackSessionEntries(maxEntries) {
  if (!persistentCacheDb) {
    return;
  }

  const overflow = getPersistentPlaybackSessionCount() - maxEntries;
  if (overflow <= 0) {
    return;
  }

  try {
    persistentCacheDb
      .query(
        `
      DELETE FROM playback_sessions
      WHERE rowid IN (
        SELECT rowid
        FROM playback_sessions
        ORDER BY updated_at ASC
        LIMIT ?
      )
    `,
      )
      .run(overflow);
  } catch {
    // Ignore persistent cache trim failures.
  }
}

function prunePersistentCaches() {
  if (!persistentCacheDb) {
    return;
  }

  const now = Date.now();
  const staleThreshold = now - PLAYBACK_SESSION_STALE_MS;
  try {
    persistentCacheDb
      .query("DELETE FROM resolved_stream_cache WHERE expires_at <= ?")
      .run(now);
    persistentCacheDb
      .query("DELETE FROM movie_quick_start_cache WHERE expires_at <= ?")
      .run(now);
    persistentCacheDb
      .query("DELETE FROM tmdb_response_cache WHERE expires_at <= ?")
      .run(now);
    persistentCacheDb
      .query("DELETE FROM playback_sessions WHERE last_accessed_at <= ?")
      .run(staleThreshold);
    persistentCacheDb
      .query("DELETE FROM source_health_stats WHERE updated_at <= ?")
      .run(now - SOURCE_HEALTH_STALE_MS);
    persistentCacheDb
      .query("DELETE FROM media_probe_cache WHERE updated_at <= ?")
      .run(now - MEDIA_PROBE_STALE_MS);
    persistentCacheDb
      .query("DELETE FROM title_track_preferences WHERE updated_at <= ?")
      .run(now - TITLE_PREFERENCES_STALE_MS);
    trimPersistentResolvedStreamEntries(RESOLVED_STREAM_PERSIST_MAX_ENTRIES);
    trimPersistentMovieQuickStartEntries(MOVIE_QUICK_START_PERSIST_MAX_ENTRIES);
    trimPersistentTmdbResponseEntries(TMDB_RESPONSE_PERSIST_MAX_ENTRIES);
    trimPersistentPlaybackSessionEntries(PLAYBACK_SESSION_PERSIST_MAX_ENTRIES);
  } catch {
    // Ignore persistent cache prune failures.
  }
}

function clearPersistentCaches() {
  if (persistentCacheDb) {
    try {
      persistentCacheDb.exec(`
        DELETE FROM resolved_stream_cache;
        DELETE FROM movie_quick_start_cache;
        DELETE FROM tmdb_response_cache;
        DELETE FROM playback_sessions;
        DELETE FROM source_health_stats;
        DELETE FROM media_probe_cache;
        DELETE FROM title_track_preferences;
      `);
    } catch {
      // Ignore persistent cache clear failures.
    }
  }

  for (const job of hlsTranscodeJobs.values()) {
    terminateHlsTranscodeJob(job);
  }
  hlsTranscodeJobs.clear();

  void rm(HLS_CACHE_DIR, { recursive: true, force: true }).catch(() => {
    // Ignore HLS cache cleanup failures.
  });
}

function pruneIdleHlsTranscodeJobs(now = Date.now()) {
  for (const [jobKey, job] of hlsTranscodeJobs.entries()) {
    const inactiveForMs = now - Number(job?.lastAccessedAt || 0);
    const finishedForMs = job?.finishedAt ? now - Number(job.finishedAt) : 0;
    if (
      inactiveForMs > HLS_TRANSCODE_IDLE_MS ||
      (job?.exited && finishedForMs > HLS_SEGMENT_STALE_MS)
    ) {
      terminateHlsTranscodeJob(job);
      hlsTranscodeJobs.delete(jobKey);
    }
  }
}

async function pruneHlsCacheFiles() {
  try {
    const entries = await readdir(HLS_CACHE_DIR, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const absolutePath = join(HLS_CACHE_DIR, entry.name);
      try {
        const fileStat = await stat(absolutePath);
        candidates.push({
          path: absolutePath,
          mtimeMs: Number(fileStat.mtimeMs || 0),
        });
      } catch {
        // Ignore stat failures for stale entries.
      }
    }

    const now = Date.now();
    const stale = candidates.filter(
      (item) => now - item.mtimeMs > HLS_SEGMENT_STALE_MS,
    );
    await Promise.all(
      stale.map(async (item) => {
        try {
          await rm(item.path, { force: true });
        } catch {
          // Ignore individual file cleanup errors.
        }
      }),
    );

    const remaining = candidates
      .filter((item) => now - item.mtimeMs <= HLS_SEGMENT_STALE_MS)
      .sort((left, right) => left.mtimeMs - right.mtimeMs);

    const overflow = remaining.length - HLS_SEGMENT_MAX_FILES;
    if (overflow > 0) {
      const toDelete = remaining.slice(0, overflow);
      await Promise.all(
        toDelete.map(async (item) => {
          try {
            await rm(item.path, { force: true });
          } catch {
            // Ignore individual file cleanup errors.
          }
        }),
      );
    }
  } catch {
    // Ignore cache directory cleanup failures.
  }
}

function getPersistedResolvedStreamEntry(cacheKey) {
  if (!persistentCacheDb || !cacheKey) {
    return null;
  }

  let row = null;
  try {
    row = persistentCacheDb
      .query(
        `
      SELECT payload_json, expires_at, is_ephemeral, next_validation_at
      FROM resolved_stream_cache
      WHERE cache_key = ?
    `,
      )
      .get(cacheKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const expiresAt = Number(row.expires_at || 0);
  if (expiresAt <= Date.now()) {
    try {
      persistentCacheDb
        .query("DELETE FROM resolved_stream_cache WHERE cache_key = ?")
        .run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(String(row.payload_json || "{}"));
  } catch {
    try {
      persistentCacheDb
        .query("DELETE FROM resolved_stream_cache WHERE cache_key = ?")
        .run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  const value = cloneResolvedSource(parsed);
  if (!value.playableUrl) {
    try {
      persistentCacheDb
        .query("DELETE FROM resolved_stream_cache WHERE cache_key = ?")
        .run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  return {
    expiresAt,
    isEphemeral: Boolean(row.is_ephemeral),
    nextValidationAt: Number(row.next_validation_at || 0),
    value,
  };
}

function setPersistedResolvedStreamEntry(cacheKey, entry) {
  if (!persistentCacheDb || !cacheKey || !entry?.value?.playableUrl) {
    return;
  }

  try {
    persistentCacheDb
      .query(
        `
      INSERT INTO resolved_stream_cache (
        cache_key,
        payload_json,
        expires_at,
        is_ephemeral,
        next_validation_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        expires_at = excluded.expires_at,
        is_ephemeral = excluded.is_ephemeral,
        next_validation_at = excluded.next_validation_at,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        cacheKey,
        JSON.stringify(cloneResolvedSource(entry.value)),
        Number(entry.expiresAt || 0),
        entry.isEphemeral ? 1 : 0,
        Number(entry.nextValidationAt || 0),
        Date.now(),
      );
    trimPersistentResolvedStreamEntries(RESOLVED_STREAM_PERSIST_MAX_ENTRIES);
  } catch {
    // Ignore persistent cache write failures.
  }
}

function deletePersistedResolvedStreamEntry(cacheKey) {
  if (!persistentCacheDb || !cacheKey) {
    return;
  }

  try {
    persistentCacheDb
      .query("DELETE FROM resolved_stream_cache WHERE cache_key = ?")
      .run(cacheKey);
  } catch {
    // Ignore persistent cache delete failures.
  }
}

function getPersistedMovieQuickStartEntry(cacheKey) {
  if (!persistentCacheDb || !cacheKey) {
    return null;
  }

  let row = null;
  try {
    row = persistentCacheDb
      .query(
        `
      SELECT payload_json, expires_at
      FROM movie_quick_start_cache
      WHERE cache_key = ?
    `,
      )
      .get(cacheKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const expiresAt = Number(row.expires_at || 0);
  if (expiresAt <= Date.now()) {
    try {
      persistentCacheDb
        .query("DELETE FROM movie_quick_start_cache WHERE cache_key = ?")
        .run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(String(row.payload_json || "{}"));
  } catch {
    try {
      persistentCacheDb
        .query("DELETE FROM movie_quick_start_cache WHERE cache_key = ?")
        .run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  const value = cloneResolvedMovieResult(parsed);
  if (!value?.playableUrl) {
    try {
      persistentCacheDb
        .query("DELETE FROM movie_quick_start_cache WHERE cache_key = ?")
        .run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  return {
    expiresAt,
    value,
  };
}

function setPersistedMovieQuickStartEntry(cacheKey, value, expiresAt) {
  if (!persistentCacheDb || !cacheKey) {
    return;
  }

  const clonedValue = cloneResolvedMovieResult(value);
  if (!clonedValue?.playableUrl) {
    return;
  }

  try {
    persistentCacheDb
      .query(
        `
      INSERT INTO movie_quick_start_cache (
        cache_key,
        payload_json,
        expires_at,
        updated_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        cacheKey,
        JSON.stringify(clonedValue),
        Number(expiresAt || 0),
        Date.now(),
      );
    trimPersistentMovieQuickStartEntries(MOVIE_QUICK_START_PERSIST_MAX_ENTRIES);
  } catch {
    // Ignore persistent cache write failures.
  }
}

function deletePersistedMovieQuickStartEntry(cacheKey) {
  if (!persistentCacheDb || !cacheKey) {
    return;
  }

  try {
    persistentCacheDb
      .query("DELETE FROM movie_quick_start_cache WHERE cache_key = ?")
      .run(cacheKey);
  } catch {
    // Ignore persistent cache delete failures.
  }
}

function cloneTmdbResponsePayload(value) {
  if (value === null || value === undefined) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function getPersistedTmdbResponseEntry(cacheKey) {
  if (!persistentCacheDb || !cacheKey) {
    return null;
  }

  let row = null;
  try {
    row = persistentCacheDb
      .query(
        `
      SELECT payload_json, expires_at
      FROM tmdb_response_cache
      WHERE cache_key = ?
    `,
      )
      .get(cacheKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const expiresAt = Number(row.expires_at || 0);
  if (expiresAt <= Date.now()) {
    try {
      persistentCacheDb
        .query("DELETE FROM tmdb_response_cache WHERE cache_key = ?")
        .run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(String(row.payload_json || "null"));
  } catch {
    try {
      persistentCacheDb
        .query("DELETE FROM tmdb_response_cache WHERE cache_key = ?")
        .run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  const payload = cloneTmdbResponsePayload(parsed);
  if (payload === null) {
    try {
      persistentCacheDb
        .query("DELETE FROM tmdb_response_cache WHERE cache_key = ?")
        .run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  return {
    expiresAt,
    value: payload,
  };
}

function setPersistedTmdbResponseEntry(cacheKey, value, expiresAt) {
  if (!persistentCacheDb || !cacheKey) {
    return;
  }

  const payload = cloneTmdbResponsePayload(value);
  if (payload === null) {
    return;
  }

  try {
    persistentCacheDb
      .query(
        `
      INSERT INTO tmdb_response_cache (
        cache_key,
        payload_json,
        expires_at,
        updated_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `,
      )
      .run(
        cacheKey,
        JSON.stringify(payload),
        Number(expiresAt || 0),
        Date.now(),
      );
    trimPersistentTmdbResponseEntries(TMDB_RESPONSE_PERSIST_MAX_ENTRIES);
  } catch {
    // Ignore persistent cache write failures.
  }
}

function deletePersistedTmdbResponseEntry(cacheKey) {
  if (!persistentCacheDb || !cacheKey) {
    return;
  }

  try {
    persistentCacheDb
      .query("DELETE FROM tmdb_response_cache WHERE cache_key = ?")
      .run(cacheKey);
  } catch {
    // Ignore persistent cache delete failures.
  }
}

function isLikelyEphemeralResolvedUrl(value) {
  const raw = String(value || "").toLowerCase();
  if (!raw) {
    return false;
  }

  if (raw.includes("real-debrid.com")) {
    return true;
  }

  if (isPlaybackProxyUrl(raw)) {
    try {
      const params = new URLSearchParams(raw.split("?")[1] || "");
      const input = decodeURIComponent(params.get("input") || "").toLowerCase();
      return input.includes("real-debrid.com");
    } catch {
      return false;
    }
  }

  return false;
}

function pruneExpiredEntries(cache) {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (!entry || entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function trimCacheEntries(cache, maxEntries) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}

function sweepCaches() {
  pruneExpiredEntries(tmdbResponseCache);
  pruneExpiredEntries(movieQuickStartCache);
  pruneExpiredEntries(resolvedStreamCache);
  pruneExpiredEntries(rdTorrentLookupCache);
  pruneExpiredEntries(externalSubtitleLookupCache);
  trimCacheEntries(tmdbResponseCache, TMDB_RESPONSE_CACHE_MAX_ENTRIES);
  trimCacheEntries(movieQuickStartCache, MOVIE_QUICK_START_CACHE_MAX_ENTRIES);
  trimCacheEntries(resolvedStreamCache, RESOLVED_STREAM_CACHE_MAX_ENTRIES);
  trimCacheEntries(rdTorrentLookupCache, RD_TORRENT_LOOKUP_CACHE_MAX_ENTRIES);
  trimCacheEntries(externalSubtitleLookupCache, 500);
  prunePersistentCaches();
  pruneIdleHlsTranscodeJobs();
  void pruneHlsCacheFiles();
}

function getCacheDebugStats() {
  const tmdbRequests = cacheStats.tmdbHits + cacheStats.tmdbMisses;
  const playbackSessionRequests =
    cacheStats.playbackSessionHits + cacheStats.playbackSessionMisses;
  const movieQuickStartRequests =
    cacheStats.movieQuickStartHits + cacheStats.movieQuickStartMisses;
  const resolvedRequests =
    cacheStats.resolvedStreamHits + cacheStats.resolvedStreamMisses;
  const rdLookupRequests = cacheStats.rdLookupHits + cacheStats.rdLookupMisses;
  const dedupRequests =
    cacheStats.movieResolveDedupHits + cacheStats.movieResolveDedupMisses;

  return {
    uptimeSeconds: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
    caches: {
      tmdbResponse: {
        size: tmdbResponseCache.size,
        ttlDefaultMs: TMDB_RESPONSE_CACHE_TTL_DEFAULT_MS,
        ttlPopularMs: TMDB_RESPONSE_CACHE_TTL_POPULAR_MS,
        ttlGenreMs: TMDB_RESPONSE_CACHE_TTL_GENRE_MS,
        maxEntries: TMDB_RESPONSE_CACHE_MAX_ENTRIES,
      },
      movieQuickStart: {
        size: movieQuickStartCache.size,
        ttlMs: MOVIE_QUICK_START_CACHE_TTL_MS,
        maxEntries: MOVIE_QUICK_START_CACHE_MAX_ENTRIES,
      },
      resolvedStream: {
        size: resolvedStreamCache.size,
        ttlMs: RESOLVED_STREAM_CACHE_TTL_MS,
        ephemeralTtlMs: RESOLVED_STREAM_CACHE_EPHEMERAL_TTL_MS,
        ephemeralRevalidateMs: RESOLVED_STREAM_CACHE_EPHEMERAL_REVALIDATE_MS,
        maxEntries: RESOLVED_STREAM_CACHE_MAX_ENTRIES,
      },
      rdTorrentLookup: {
        size: rdTorrentLookupCache.size,
        ttlMs: RD_TORRENT_LOOKUP_CACHE_TTL_MS,
        maxEntries: RD_TORRENT_LOOKUP_CACHE_MAX_ENTRIES,
      },
      externalSubtitleLookup: {
        size: externalSubtitleLookupCache.size,
        ttlMs: EXTERNAL_SUBTITLE_LOOKUP_TTL_MS,
        maxEntries: 500,
      },
      playbackSession: {
        validateIntervalMs: PLAYBACK_SESSION_VALIDATE_INTERVAL_MS,
        staleMs: PLAYBACK_SESSION_STALE_MS,
      },
      persistentDb: {
        enabled: Boolean(persistentCacheDb),
        path: PERSISTENT_CACHE_DB_PATH,
        tmdbResponseSize: getPersistentTmdbResponseCount(),
        playbackSessionSize: getPersistentPlaybackSessionCount(),
        resolvedStreamSize: getPersistentResolvedStreamCount(),
        movieQuickStartSize: getPersistentMovieQuickStartCount(),
        sourceHealthSize: getPersistentSourceHealthCount(),
        mediaProbeSize: getPersistentMediaProbeCount(),
        titlePreferenceSize: getPersistentTitlePreferenceCount(),
        tmdbResponseMaxEntries: TMDB_RESPONSE_PERSIST_MAX_ENTRIES,
        playbackSessionMaxEntries: PLAYBACK_SESSION_PERSIST_MAX_ENTRIES,
        resolvedStreamMaxEntries: RESOLVED_STREAM_PERSIST_MAX_ENTRIES,
        movieQuickStartMaxEntries: MOVIE_QUICK_START_PERSIST_MAX_ENTRIES,
      },
      inFlightMovieResolves: inFlightMovieResolves.size,
      hlsTranscodeJobs: hlsTranscodeJobs.size,
    },
    stats: {
      tmdbResponse: {
        hits: cacheStats.tmdbHits,
        misses: cacheStats.tmdbMisses,
        expired: cacheStats.tmdbExpired,
        hitRate:
          tmdbRequests > 0
            ? Number((cacheStats.tmdbHits / tmdbRequests).toFixed(3))
            : 0,
      },
      playbackSession: {
        hits: cacheStats.playbackSessionHits,
        misses: cacheStats.playbackSessionMisses,
        invalidated: cacheStats.playbackSessionInvalidated,
        hitRate:
          playbackSessionRequests > 0
            ? Number(
                (
                  cacheStats.playbackSessionHits / playbackSessionRequests
                ).toFixed(3),
              )
            : 0,
      },
      movieQuickStart: {
        hits: cacheStats.movieQuickStartHits,
        misses: cacheStats.movieQuickStartMisses,
        expired: cacheStats.movieQuickStartExpired,
        hitRate:
          movieQuickStartRequests > 0
            ? Number(
                (
                  cacheStats.movieQuickStartHits / movieQuickStartRequests
                ).toFixed(3),
              )
            : 0,
      },
      resolvedStream: {
        hits: cacheStats.resolvedStreamHits,
        misses: cacheStats.resolvedStreamMisses,
        expired: cacheStats.resolvedStreamExpired,
        invalidated: cacheStats.resolvedStreamInvalidated,
        hitRate:
          resolvedRequests > 0
            ? Number(
                (cacheStats.resolvedStreamHits / resolvedRequests).toFixed(3),
              )
            : 0,
      },
      rdLookup: {
        hits: cacheStats.rdLookupHits,
        misses: cacheStats.rdLookupMisses,
        expired: cacheStats.rdLookupExpired,
        apiPagesScanned: cacheStats.rdLookupApiPagesScanned,
        hitRate:
          rdLookupRequests > 0
            ? Number((cacheStats.rdLookupHits / rdLookupRequests).toFixed(3))
            : 0,
      },
      movieResolveDedup: {
        hits: cacheStats.movieResolveDedupHits,
        misses: cacheStats.movieResolveDedupMisses,
        hitRate:
          dedupRequests > 0
            ? Number(
                (cacheStats.movieResolveDedupHits / dedupRequests).toFixed(3),
              )
            : 0,
      },
    },
  };
}

function buildTmdbResponseCacheKey(path, paramsObj = {}) {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    return "";
  }

  const entries = Object.entries({
    language: "en-US",
    ...paramsObj,
  })
    .filter(
      ([, value]) =>
        value !== undefined && value !== null && String(value) !== "",
    )
    .map(([key, value]) => [String(key), String(value)]);

  entries.sort(([left], [right]) => left.localeCompare(right));
  const query = new URLSearchParams(entries);
  return `${normalizedPath}?${query.toString()}`;
}

function getTmdbCacheTtlMs(path) {
  const normalizedPath = String(path || "")
    .trim()
    .toLowerCase();
  if (!normalizedPath) {
    return TMDB_RESPONSE_CACHE_TTL_DEFAULT_MS;
  }

  if (normalizedPath.startsWith("/movie/popular")) {
    return TMDB_RESPONSE_CACHE_TTL_POPULAR_MS;
  }

  if (normalizedPath.startsWith("/genre/")) {
    return TMDB_RESPONSE_CACHE_TTL_GENRE_MS;
  }

  return TMDB_RESPONSE_CACHE_TTL_DEFAULT_MS;
}

function getCachedTmdbResponse(cacheKey) {
  if (!cacheKey) {
    return null;
  }

  let cached = tmdbResponseCache.get(cacheKey);
  if (!cached) {
    const persistedEntry = getPersistedTmdbResponseEntry(cacheKey);
    if (persistedEntry) {
      tmdbResponseCache.set(cacheKey, persistedEntry);
      trimCacheEntries(tmdbResponseCache, TMDB_RESPONSE_CACHE_MAX_ENTRIES);
      cached = persistedEntry;
    }
  }

  if (!cached) {
    cacheStats.tmdbMisses += 1;
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    tmdbResponseCache.delete(cacheKey);
    deletePersistedTmdbResponseEntry(cacheKey);
    cacheStats.tmdbExpired += 1;
    cacheStats.tmdbMisses += 1;
    return null;
  }

  cacheStats.tmdbHits += 1;
  return cloneTmdbResponsePayload(cached.value);
}

function setCachedTmdbResponse(
  cacheKey,
  value,
  ttlMs = TMDB_RESPONSE_CACHE_TTL_DEFAULT_MS,
) {
  if (!cacheKey) {
    return;
  }

  const payload = cloneTmdbResponsePayload(value);
  if (payload === null) {
    return;
  }

  const expiresAt =
    Date.now() +
    Math.max(1000, Number(ttlMs) || TMDB_RESPONSE_CACHE_TTL_DEFAULT_MS);
  const entry = {
    expiresAt,
    value: payload,
  };
  tmdbResponseCache.set(cacheKey, entry);
  trimCacheEntries(tmdbResponseCache, TMDB_RESPONSE_CACHE_MAX_ENTRIES);
  setPersistedTmdbResponseEntry(cacheKey, payload, expiresAt);
}

function getVerifiableSourceUrl(playableUrl) {
  const raw = String(playableUrl || "").trim();
  if (!raw) {
    return "";
  }

  if (isPlaybackProxyUrl(raw)) {
    try {
      const params = new URLSearchParams(raw.split("?")[1] || "");
      const input = decodeURIComponent(params.get("input") || "").trim();
      return isHttpUrl(input) ? input : "";
    } catch {
      return "";
    }
  }

  return raw;
}

async function getCachedResolvedStream(cacheKey) {
  if (!cacheKey) {
    return null;
  }

  let cached = resolvedStreamCache.get(cacheKey);
  if (!cached) {
    const persistedEntry = getPersistedResolvedStreamEntry(cacheKey);
    if (persistedEntry) {
      resolvedStreamCache.set(cacheKey, persistedEntry);
      trimCacheEntries(resolvedStreamCache, RESOLVED_STREAM_CACHE_MAX_ENTRIES);
      cached = persistedEntry;
    }
  }

  if (!cached) {
    cacheStats.resolvedStreamMisses += 1;
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    resolvedStreamCache.delete(cacheKey);
    deletePersistedResolvedStreamEntry(cacheKey);
    cacheStats.resolvedStreamExpired += 1;
    cacheStats.resolvedStreamMisses += 1;
    return null;
  }

  if (!isResolvedSourceLikelyContainer(cached.value, "mp4")) {
    resolvedStreamCache.delete(cacheKey);
    deletePersistedResolvedStreamEntry(cacheKey);
    cacheStats.resolvedStreamInvalidated += 1;
    cacheStats.resolvedStreamMisses += 1;
    return null;
  }

  if (cached.isEphemeral && cached.nextValidationAt <= Date.now()) {
    const verifiableUrl = getVerifiableSourceUrl(cached.value?.playableUrl);
    if (verifiableUrl) {
      try {
        await verifyPlayableUrl(verifiableUrl, 2500);
      } catch {
        resolvedStreamCache.delete(cacheKey);
        deletePersistedResolvedStreamEntry(cacheKey);
        cacheStats.resolvedStreamInvalidated += 1;
        cacheStats.resolvedStreamMisses += 1;
        return null;
      }
    }

    cached.nextValidationAt =
      Date.now() + RESOLVED_STREAM_CACHE_EPHEMERAL_REVALIDATE_MS;
    setPersistedResolvedStreamEntry(cacheKey, cached);
  }

  const normalizedResolved = normalizeResolvedSourceForSoftwareDecode(
    cached.value,
  );
  if (
    normalizedResolved.playableUrl !== cached.value.playableUrl ||
    JSON.stringify(normalizedResolved.fallbackUrls) !==
      JSON.stringify(cached.value.fallbackUrls)
  ) {
    cached.value = normalizedResolved;
    setPersistedResolvedStreamEntry(cacheKey, cached);
  }

  cacheStats.resolvedStreamHits += 1;
  return cloneResolvedSource(cached.value);
}

function getCachedMovieQuickStart(cacheKey) {
  if (!cacheKey) {
    return null;
  }

  let cached = movieQuickStartCache.get(cacheKey);
  if (!cached) {
    const persistedEntry = getPersistedMovieQuickStartEntry(cacheKey);
    if (persistedEntry) {
      movieQuickStartCache.set(cacheKey, persistedEntry);
      trimCacheEntries(
        movieQuickStartCache,
        MOVIE_QUICK_START_CACHE_MAX_ENTRIES,
      );
      cached = persistedEntry;
    }
  }

  if (!cached) {
    cacheStats.movieQuickStartMisses += 1;
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    movieQuickStartCache.delete(cacheKey);
    deletePersistedMovieQuickStartEntry(cacheKey);
    cacheStats.movieQuickStartExpired += 1;
    cacheStats.movieQuickStartMisses += 1;
    return null;
  }

  const separatorIndex = String(cacheKey).lastIndexOf(":");
  const expectedTmdbId =
    separatorIndex > 0 ? String(cacheKey).slice(0, separatorIndex).trim() : "";
  const cachedTmdbId = String(cached?.value?.metadata?.tmdbId || "").trim();
  if (expectedTmdbId && (!cachedTmdbId || cachedTmdbId !== expectedTmdbId)) {
    movieQuickStartCache.delete(cacheKey);
    deletePersistedMovieQuickStartEntry(cacheKey);
    cacheStats.movieQuickStartMisses += 1;
    return null;
  }

  if (
    !doesFilenameLikelyMatchMovie(
      cached?.value?.filename,
      cached?.value?.metadata?.displayTitle,
      cached?.value?.metadata?.displayYear,
    )
  ) {
    movieQuickStartCache.delete(cacheKey);
    deletePersistedMovieQuickStartEntry(cacheKey);
    cacheStats.movieQuickStartMisses += 1;
    return null;
  }

  if (!isResolvedSourceLikelyContainer(cached.value, "mp4")) {
    movieQuickStartCache.delete(cacheKey);
    deletePersistedMovieQuickStartEntry(cacheKey);
    cacheStats.movieQuickStartMisses += 1;
    return null;
  }

  const normalizedPlayable = normalizeResolvedSourceForSoftwareDecode(
    cached.value,
    {
      audioStreamIndex: cached?.value?.selectedAudioStreamIndex,
      subtitleStreamIndex: cached?.value?.selectedSubtitleStreamIndex,
    },
  );
  if (
    normalizedPlayable.playableUrl !== cached.value.playableUrl ||
    JSON.stringify(normalizedPlayable.fallbackUrls) !==
      JSON.stringify(cached.value.fallbackUrls)
  ) {
    cached.value = cloneResolvedMovieResult({
      ...cached.value,
      playableUrl: normalizedPlayable.playableUrl,
      fallbackUrls: normalizedPlayable.fallbackUrls,
      filename: normalizedPlayable.filename || cached.value.filename,
    });
    setPersistedMovieQuickStartEntry(cacheKey, cached.value, cached.expiresAt);
  }

  cacheStats.movieQuickStartHits += 1;
  return cloneResolvedMovieResult(cached.value);
}

function setCachedMovieQuickStart(cacheKey, value) {
  if (!cacheKey || !value?.playableUrl) {
    return;
  }

  const normalizedPlayable = normalizeResolvedSourceForSoftwareDecode(value, {
    audioStreamIndex: value?.selectedAudioStreamIndex,
    subtitleStreamIndex: value?.selectedSubtitleStreamIndex,
  });
  const normalizedResult = cloneResolvedMovieResult({
    ...value,
    playableUrl: normalizedPlayable.playableUrl,
    fallbackUrls: normalizedPlayable.fallbackUrls,
    filename: normalizedPlayable.filename || value.filename,
  });
  if (!normalizedResult?.playableUrl) {
    return;
  }
  if (!isResolvedSourceLikelyContainer(normalizedResult, "mp4")) {
    return;
  }

  const expiresAt = Date.now() + MOVIE_QUICK_START_CACHE_TTL_MS;
  const entry = {
    expiresAt,
    value: normalizedResult,
  };
  movieQuickStartCache.set(cacheKey, entry);
  trimCacheEntries(movieQuickStartCache, MOVIE_QUICK_START_CACHE_MAX_ENTRIES);
  setPersistedMovieQuickStartEntry(cacheKey, entry.value, expiresAt);

  const parsedKey = parseMovieResolveKey(cacheKey);
  if (!parsedKey?.tmdbId) {
    return;
  }

  if (parsedKey.audioLang === "auto") {
    return;
  }

  const autoKey = buildMovieResolveKey(
    parsedKey.tmdbId,
    "auto",
    parsedKey.quality,
  );
  if (autoKey === cacheKey) {
    return;
  }

  movieQuickStartCache.delete(autoKey);
  deletePersistedMovieQuickStartEntry(autoKey);
}

function setCachedResolvedStream(cacheKey, value) {
  if (!cacheKey || !value?.playableUrl) {
    return;
  }

  const normalizedValue = normalizeResolvedSourceForSoftwareDecode(value);
  if (!isResolvedSourceLikelyContainer(normalizedValue, "mp4")) {
    return;
  }
  const allUrls = [
    normalizedValue.playableUrl,
    ...(Array.isArray(normalizedValue.fallbackUrls)
      ? normalizedValue.fallbackUrls
      : []),
  ];
  const isEphemeral = allUrls.some(isLikelyEphemeralResolvedUrl);
  const now = Date.now();
  const ttlMs = isEphemeral
    ? RESOLVED_STREAM_CACHE_EPHEMERAL_TTL_MS
    : RESOLVED_STREAM_CACHE_TTL_MS;

  const entry = {
    expiresAt: now + ttlMs,
    isEphemeral,
    nextValidationAt: isEphemeral
      ? now + RESOLVED_STREAM_CACHE_EPHEMERAL_REVALIDATE_MS
      : Number.POSITIVE_INFINITY,
    value: normalizedValue,
  };

  resolvedStreamCache.set(cacheKey, entry);
  trimCacheEntries(resolvedStreamCache, RESOLVED_STREAM_CACHE_MAX_ENTRIES);
  setPersistedResolvedStreamEntry(cacheKey, entry);
}

function invalidateCachedResolvedStream(cacheKey) {
  if (!cacheKey) {
    return;
  }
  resolvedStreamCache.delete(cacheKey);
  deletePersistedResolvedStreamEntry(cacheKey);
  cacheStats.resolvedStreamInvalidated += 1;
}

function getCachedRdTorrentLookup(infoHash) {
  const normalizedHash = String(infoHash || "")
    .trim()
    .toLowerCase();
  if (!normalizedHash) {
    return undefined;
  }

  const cached = rdTorrentLookupCache.get(normalizedHash);
  if (!cached) {
    cacheStats.rdLookupMisses += 1;
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    rdTorrentLookupCache.delete(normalizedHash);
    cacheStats.rdLookupExpired += 1;
    cacheStats.rdLookupMisses += 1;
    return undefined;
  }

  cacheStats.rdLookupHits += 1;
  return cached.value;
}

function setCachedRdTorrentLookup(infoHash, value) {
  const normalizedHash = String(infoHash || "")
    .trim()
    .toLowerCase();
  if (!normalizedHash) {
    return;
  }

  rdTorrentLookupCache.set(normalizedHash, {
    expiresAt: Date.now() + RD_TORRENT_LOOKUP_CACHE_TTL_MS,
    value: value || null,
  });
  trimCacheEntries(rdTorrentLookupCache, RD_TORRENT_LOOKUP_CACHE_MAX_ENTRIES);
}

async function findReusableRdTorrentByHash(infoHash, maxPages = 4) {
  const normalizedHash = String(infoHash || "")
    .trim()
    .toLowerCase();
  if (!normalizedHash) {
    return null;
  }

  const cached = getCachedRdTorrentLookup(normalizedHash);
  if (cached !== undefined) {
    return cached;
  }

  for (let page = 1; page <= maxPages; page += 1) {
    cacheStats.rdLookupApiPagesScanned += 1;
    const list = await rdFetch(`/torrents?page=${page}`, {
      timeoutMs: 10000,
    });

    if (!Array.isArray(list) || !list.length) {
      break;
    }

    const found =
      list.find(
        (item) =>
          String(item?.hash || "")
            .trim()
            .toLowerCase() === normalizedHash,
      ) || null;
    if (found) {
      setCachedRdTorrentLookup(normalizedHash, found);
      return found;
    }
  }

  setCachedRdTorrentLookup(normalizedHash, null);
  return null;
}

function buildMovieResolveKey(
  tmdbMovieId,
  preferredAudioLang,
  preferredQuality = "auto",
) {
  return [
    String(tmdbMovieId || "").trim(),
    normalizePreferredAudioLang(preferredAudioLang),
    normalizePreferredStreamQuality(preferredQuality),
  ].join(":");
}

function parseMovieResolveKey(cacheKey) {
  const parts = String(cacheKey || "").split(":");
  if (parts.length < 2) {
    return null;
  }

  return {
    tmdbId: String(parts[0] || "").trim(),
    audioLang: normalizePreferredAudioLang(parts[1]),
    quality: normalizePreferredStreamQuality(parts[2] || "auto"),
  };
}

function resolveEffectivePreferredAudioLang(tmdbMovieId, preferredAudioLang) {
  const normalized = normalizePreferredAudioLang(preferredAudioLang);
  if (normalized !== "auto") {
    return normalized;
  }

  const preference = getPersistedTitleTrackPreference(tmdbMovieId);
  const preferredFromStorage = normalizePreferredAudioLang(
    preference?.audioLang || "",
  );
  if (preferredFromStorage !== "auto") {
    return preferredFromStorage;
  }

  return "auto";
}

function deleteMovieQuickStartCacheEntry(cacheKey) {
  if (!cacheKey) {
    return;
  }

  movieQuickStartCache.delete(cacheKey);
  deletePersistedMovieQuickStartEntry(cacheKey);
}

function invalidateMovieResolveCacheForSession(
  tmdbMovieId,
  preferredAudioLang,
  preferredQuality = "auto",
  { includeAutoSibling = false } = {},
) {
  const normalizedTmdbId = String(tmdbMovieId || "").trim();
  if (!normalizedTmdbId) {
    return;
  }

  const normalizedLang = normalizePreferredAudioLang(preferredAudioLang);
  const normalizedQuality = normalizePreferredStreamQuality(preferredQuality);
  deleteMovieQuickStartCacheEntry(
    buildMovieResolveKey(normalizedTmdbId, normalizedLang, normalizedQuality),
  );

  if (!includeAutoSibling || normalizedLang === "auto") {
    return;
  }

  deleteMovieQuickStartCacheEntry(
    buildMovieResolveKey(normalizedTmdbId, "auto", normalizedQuality),
  );
}

function invalidateAllMovieResolveCachesForTmdb(tmdbMovieId) {
  const normalizedTmdbId = String(tmdbMovieId || "").trim();
  if (!normalizedTmdbId) {
    return;
  }

  const prefix = `${normalizedTmdbId}:`;
  for (const key of movieQuickStartCache.keys()) {
    if (String(key || "").startsWith(prefix)) {
      movieQuickStartCache.delete(key);
    }
  }

  if (!persistentCacheDb) {
    return;
  }

  try {
    persistentCacheDb
      .query("DELETE FROM movie_quick_start_cache WHERE cache_key LIKE ?")
      .run(`${prefix}%`);
  } catch {
    // Ignore persistent cache delete failures.
  }
}

function normalizeSessionHealthState(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "unknown";
  }

  if (
    normalized === "healthy" ||
    normalized === "degraded" ||
    normalized === "invalid"
  ) {
    return normalized;
  }

  return "unknown";
}

function buildPlaybackSessionKey(
  tmdbMovieId,
  preferredAudioLang,
  preferredQuality = "auto",
) {
  return buildMovieResolveKey(
    tmdbMovieId,
    preferredAudioLang,
    preferredQuality,
  );
}

function parseJsonArrayField(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed)
      ? parsed.filter(Boolean).map((item) => String(item))
      : [];
  } catch {
    return [];
  }
}

function parseJsonObjectField(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function buildPlaybackSessionPayload(session) {
  if (!session) {
    return null;
  }

  return {
    key: session.sessionKey,
    sourceHash: session.sourceHash,
    selectedFile: session.selectedFile,
    quality: normalizePreferredStreamQuality(
      session.preferredQuality || "auto",
    ),
    lastPositionSeconds: session.lastPositionSeconds,
    health: {
      state: session.healthState,
      failCount: session.healthFailCount,
      lastError: session.lastError,
    },
  };
}

function attachPlaybackSessionToResolvedMovie(
  result,
  tmdbMovieId,
  preferredAudioLang,
  preferredQuality = "auto",
) {
  const cloned = cloneResolvedMovieResult(result);
  if (!cloned) {
    return null;
  }

  if (!PLAYBACK_SESSIONS_ENABLED) {
    return {
      ...cloned,
      session: null,
    };
  }

  const normalizedTmdbId = String(
    tmdbMovieId || cloned.metadata?.tmdbId || "",
  ).trim();
  const normalizedQuality = normalizePreferredStreamQuality(preferredQuality);
  const sessionKey = normalizedTmdbId
    ? buildPlaybackSessionKey(
        normalizedTmdbId,
        preferredAudioLang,
        normalizedQuality,
      )
    : "";

  const session = normalizedTmdbId
    ? getPersistedPlaybackSession(sessionKey)
    : null;
  const validSession =
    session && session.tmdbId === normalizedTmdbId ? session : null;

  return {
    ...cloned,
    session: validSession
      ? buildPlaybackSessionPayload(validSession)
      : {
          key: sessionKey,
          sourceHash: cloned.sourceHash,
          selectedFile: cloned.selectedFile,
          quality: normalizedQuality,
          lastPositionSeconds: 0,
          health: {
            state: "unknown",
            failCount: 0,
            lastError: "",
          },
        },
  };
}

function getPersistedPlaybackSession(sessionKey) {
  if (!persistentCacheDb || !sessionKey) {
    return null;
  }

  let row = null;
  try {
    row = persistentCacheDb
      .query(
        `
      SELECT
        session_key,
        tmdb_id,
        audio_lang,
        source_hash,
        selected_file,
        filename,
        playable_url,
        fallback_urls_json,
        metadata_json,
        last_position_seconds,
        health_state,
        health_fail_count,
        last_error,
        last_verified_at,
        next_validation_at,
        updated_at,
        last_accessed_at
      FROM playback_sessions
      WHERE session_key = ?
    `,
      )
      .get(sessionKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const metadata = parseJsonObjectField(row.metadata_json);
  const fallbackUrls = parseJsonArrayField(row.fallback_urls_json);
  const parsedSessionKey = parseMovieResolveKey(row.session_key);

  return {
    sessionKey: String(row.session_key || ""),
    tmdbId: String(row.tmdb_id || ""),
    audioLang: normalizePreferredAudioLang(row.audio_lang),
    preferredQuality: normalizePreferredStreamQuality(
      parsedSessionKey?.quality || "auto",
    ),
    sourceHash: String(row.source_hash || "")
      .trim()
      .toLowerCase(),
    selectedFile: String(row.selected_file || ""),
    filename: String(row.filename || ""),
    playableUrl: String(row.playable_url || ""),
    fallbackUrls,
    metadata: {
      ...metadata,
      tmdbId: String(metadata?.tmdbId || row.tmdb_id || ""),
    },
    lastPositionSeconds: Math.max(
      0,
      Number(row.last_position_seconds || 0) || 0,
    ),
    healthState: normalizeSessionHealthState(row.health_state),
    healthFailCount: Math.max(0, Number(row.health_fail_count || 0) || 0),
    lastError: String(row.last_error || ""),
    lastVerifiedAt: Number(row.last_verified_at || 0) || 0,
    nextValidationAt: Number(row.next_validation_at || 0) || 0,
    updatedAt: Number(row.updated_at || 0) || 0,
    lastAccessedAt: Number(row.last_accessed_at || 0) || 0,
  };
}

function getLatestPersistedPlaybackSessionForTmdb(tmdbId) {
  if (!persistentCacheDb) {
    return null;
  }

  const normalizedTmdbId = String(tmdbId || "").trim();
  if (!normalizedTmdbId) {
    return null;
  }

  let row = null;
  try {
    row = persistentCacheDb
      .query(
        `
      SELECT session_key
      FROM playback_sessions
      WHERE tmdb_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `,
      )
      .get(normalizedTmdbId);
  } catch {
    return null;
  }

  if (!row?.session_key) {
    return null;
  }

  return getPersistedPlaybackSession(String(row.session_key));
}

function deletePersistedPlaybackSession(sessionKey) {
  if (!persistentCacheDb || !sessionKey) {
    return;
  }

  try {
    persistentCacheDb
      .query("DELETE FROM playback_sessions WHERE session_key = ?")
      .run(sessionKey);
  } catch {
    // Ignore persistent cache delete failures.
  }
}

function persistPlaybackSession(sessionKey, resolvedValue, context = {}) {
  if (!PLAYBACK_SESSIONS_ENABLED) {
    return;
  }
  if (!persistentCacheDb || !sessionKey || !resolvedValue?.playableUrl) {
    return;
  }

  const metadata =
    cloneResolvedMovieResult({
      ...resolvedValue,
      metadata: resolvedValue.metadata || {},
    })?.metadata || {};
  const tmdbId = String(context.tmdbId || metadata.tmdbId || "").trim();
  if (!tmdbId) {
    return;
  }

  const audioLang = normalizePreferredAudioLang(context.preferredAudioLang);
  const preferredQuality = normalizePreferredStreamQuality(
    context.preferredQuality,
  );
  const sourceHash = String(resolvedValue.sourceHash || "")
    .trim()
    .toLowerCase();
  const selectedFile = String(resolvedValue.selectedFile || "").trim();
  const filename = String(resolvedValue.filename || "").trim();
  const fallbackUrls = Array.isArray(resolvedValue.fallbackUrls)
    ? resolvedValue.fallbackUrls.filter(Boolean).map((value) => String(value))
    : [];
  const playableUrl = String(resolvedValue.playableUrl || "").trim();
  if (!playableUrl) {
    return;
  }

  let persistedPosition = 0;
  const existingSession = getPersistedPlaybackSession(sessionKey);
  if (existingSession?.tmdbId === tmdbId) {
    persistedPosition = Math.max(
      0,
      Number(existingSession.lastPositionSeconds || 0) || 0,
    );
  }

  const autoSessionKey =
    audioLang !== "auto"
      ? buildPlaybackSessionKey(tmdbId, "auto", preferredQuality)
      : "";
  if (!persistedPosition && autoSessionKey && autoSessionKey !== sessionKey) {
    const autoSession = getPersistedPlaybackSession(autoSessionKey);
    if (autoSession?.tmdbId === tmdbId) {
      persistedPosition = Math.max(
        0,
        Number(autoSession.lastPositionSeconds || 0) || 0,
      );
    }
  }

  const now = Date.now();
  const metadataPayload = {
    ...metadata,
    tmdbId,
  };

  try {
    persistentCacheDb
      .query(
        `
      INSERT INTO playback_sessions (
        session_key,
        tmdb_id,
        audio_lang,
        source_hash,
        selected_file,
        filename,
        playable_url,
        fallback_urls_json,
        metadata_json,
        last_position_seconds,
        health_state,
        health_fail_count,
        last_error,
        last_verified_at,
        next_validation_at,
        updated_at,
        last_accessed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        tmdb_id = excluded.tmdb_id,
        audio_lang = excluded.audio_lang,
        source_hash = excluded.source_hash,
        selected_file = excluded.selected_file,
        filename = excluded.filename,
        playable_url = excluded.playable_url,
        fallback_urls_json = excluded.fallback_urls_json,
        metadata_json = excluded.metadata_json,
        health_state = excluded.health_state,
        health_fail_count = excluded.health_fail_count,
        last_error = excluded.last_error,
        last_verified_at = excluded.last_verified_at,
        next_validation_at = excluded.next_validation_at,
        updated_at = excluded.updated_at,
        last_accessed_at = excluded.last_accessed_at
    `,
      )
      .run(
        sessionKey,
        tmdbId,
        audioLang,
        sourceHash,
        selectedFile,
        filename,
        playableUrl,
        JSON.stringify(fallbackUrls),
        JSON.stringify(metadataPayload),
        persistedPosition,
        "healthy",
        0,
        "",
        now,
        now + PLAYBACK_SESSION_VALIDATE_INTERVAL_MS,
        now,
        now,
      );
    trimPersistentPlaybackSessionEntries(PLAYBACK_SESSION_PERSIST_MAX_ENTRIES);
    if (autoSessionKey && autoSessionKey !== sessionKey) {
      deletePersistedPlaybackSession(autoSessionKey);
      invalidateMovieResolveCacheForSession(tmdbId, "auto", preferredQuality);
    }
  } catch {
    // Ignore persistent cache write failures.
  }
}

function markPersistedPlaybackSessionInvalid(sessionKey, errorMessage = "") {
  if (!persistentCacheDb || !sessionKey) {
    return;
  }

  const now = Date.now();
  try {
    persistentCacheDb
      .query(
        `
      UPDATE playback_sessions
      SET
        health_state = 'invalid',
        health_fail_count = health_fail_count + 1,
        last_error = ?,
        updated_at = ?,
        next_validation_at = ?,
        last_accessed_at = ?
      WHERE session_key = ?
    `,
      )
      .run(
        String(errorMessage || "").slice(0, 500),
        now,
        now + PLAYBACK_SESSION_VALIDATE_INTERVAL_MS,
        now,
        sessionKey,
      );
  } catch {
    // Ignore persistent cache update failures.
  }
}

function setPersistedPlaybackSessionHealthy(sessionKey) {
  if (!persistentCacheDb || !sessionKey) {
    return;
  }

  const now = Date.now();
  try {
    persistentCacheDb
      .query(
        `
      UPDATE playback_sessions
      SET
        health_state = 'healthy',
        health_fail_count = 0,
        last_error = '',
        last_verified_at = ?,
        next_validation_at = ?,
        updated_at = ?,
        last_accessed_at = ?
      WHERE session_key = ?
    `,
      )
      .run(
        now,
        now + PLAYBACK_SESSION_VALIDATE_INTERVAL_MS,
        now,
        now,
        sessionKey,
      );
  } catch {
    // Ignore persistent cache update failures.
  }
}

function updatePersistedPlaybackSessionProgress(
  sessionKey,
  { positionSeconds = 0, healthState = "unknown", lastError = "" } = {},
) {
  if (!persistentCacheDb || !sessionKey) {
    return false;
  }

  const existing = getPersistedPlaybackSession(sessionKey);
  if (!existing) {
    return false;
  }

  const normalizedHealthState = normalizeSessionHealthState(
    healthState || existing.healthState,
  );
  const clampedPosition = Math.max(0, Number(positionSeconds) || 0);
  const now = Date.now();
  const nextFailCount =
    normalizedHealthState === "invalid"
      ? existing.healthFailCount + 1
      : normalizedHealthState === "healthy"
        ? 0
        : existing.healthFailCount;
  const nextError =
    normalizedHealthState === "healthy"
      ? ""
      : String(lastError || existing.lastError || "").slice(0, 500);

  try {
    persistentCacheDb
      .query(
        `
      UPDATE playback_sessions
      SET
        last_position_seconds = ?,
        health_state = ?,
        health_fail_count = ?,
        last_error = ?,
        updated_at = ?,
        last_accessed_at = ?
      WHERE session_key = ?
    `,
      )
      .run(
        clampedPosition,
        normalizedHealthState,
        nextFailCount,
        nextError,
        now,
        now,
        sessionKey,
      );
    return true;
  } catch {
    return false;
  }
}

async function getReusablePlaybackSession(tmdbMovieId, context = {}) {
  if (!PLAYBACK_SESSIONS_ENABLED) {
    cacheStats.playbackSessionMisses += 1;
    return null;
  }
  const normalizedTmdbId = String(tmdbMovieId || "").trim();
  const normalizedLang = normalizePreferredAudioLang(
    context.preferredAudioLang,
  );
  const preferredQuality = normalizePreferredStreamQuality(
    context.preferredQuality,
  );
  const sessionKey = buildPlaybackSessionKey(
    normalizedTmdbId,
    normalizedLang,
    preferredQuality,
  );
  const session = getPersistedPlaybackSession(sessionKey);
  if (!session) {
    cacheStats.playbackSessionMisses += 1;
    return null;
  }

  const expectedTmdbId = normalizedTmdbId;
  if (!expectedTmdbId || session.tmdbId !== expectedTmdbId) {
    deletePersistedPlaybackSession(sessionKey);
    invalidateMovieResolveCacheForSession(
      expectedTmdbId,
      normalizedLang,
      preferredQuality,
    );
    cacheStats.playbackSessionInvalidated += 1;
    cacheStats.playbackSessionMisses += 1;
    return null;
  }

  if (!session.playableUrl || session.healthState === "invalid") {
    invalidateMovieResolveCacheForSession(
      expectedTmdbId,
      normalizedLang,
      preferredQuality,
    );
    if (session.healthState === "invalid") {
      cacheStats.playbackSessionInvalidated += 1;
    }
    cacheStats.playbackSessionMisses += 1;
    return null;
  }
  if (!isResolvedSourceLikelyContainer(session, "mp4")) {
    markPersistedPlaybackSessionInvalid(
      sessionKey,
      "Session source was not MP4.",
    );
    invalidateMovieResolveCacheForSession(
      expectedTmdbId,
      normalizedLang,
      preferredQuality,
    );
    cacheStats.playbackSessionInvalidated += 1;
    cacheStats.playbackSessionMisses += 1;
    return null;
  }

  const displayTitle = String(
    session.metadata?.displayTitle || context.titleFallback || "",
  ).trim();
  const displayYear = String(
    session.metadata?.displayYear || context.yearFallback || "",
  ).trim();
  if (
    !doesFilenameLikelyMatchMovie(session.filename, displayTitle, displayYear)
  ) {
    markPersistedPlaybackSessionInvalid(
      sessionKey,
      "Session filename mismatched requested title.",
    );
    invalidateMovieResolveCacheForSession(
      expectedTmdbId,
      normalizedLang,
      preferredQuality,
    );
    cacheStats.playbackSessionInvalidated += 1;
    cacheStats.playbackSessionMisses += 1;
    return null;
  }

  if (session.nextValidationAt <= Date.now()) {
    const verifiableUrl = getVerifiableSourceUrl(session.playableUrl);
    if (verifiableUrl) {
      try {
        await verifyPlayableUrl(verifiableUrl, 3000);
      } catch (error) {
        markPersistedPlaybackSessionInvalid(
          sessionKey,
          error instanceof Error ? error.message : "Session validation failed.",
        );
        invalidateMovieResolveCacheForSession(
          expectedTmdbId,
          normalizedLang,
          preferredQuality,
        );
        cacheStats.playbackSessionInvalidated += 1;
        cacheStats.playbackSessionMisses += 1;
        return null;
      }
    }

    setPersistedPlaybackSessionHealthy(sessionKey);
  } else {
    updatePersistedPlaybackSessionProgress(sessionKey, {
      positionSeconds: session.lastPositionSeconds,
      healthState: session.healthState,
      lastError: session.lastError,
    });
  }

  cacheStats.playbackSessionHits += 1;
  const preference = getPersistedTitleTrackPreference(expectedTmdbId) || null;
  const preferredSubtitleLang = normalizeSubtitlePreference(
    preference?.subtitleLang || "",
  );
  const sourceInput = extractPlayableSourceInput(session.playableUrl);
  let tracks = {
    durationSeconds: Number(session.metadata?.runtimeSeconds || 0) || 0,
    audioTracks: [],
    subtitleTracks: [],
  };
  let selectedAudioStreamIndex = -1;
  let selectedSubtitleStreamIndex = -1;
  const forceAudioStreamMapping = normalizedLang !== "auto";
  try {
    tracks = await probeMediaTracks(sourceInput, {
      sourceHash: session.sourceHash,
      selectedFile: session.selectedFile,
    });
    const audioTrack = chooseAudioTrackFromProbe(tracks, normalizedLang);
    const subtitleTrack = chooseSubtitleTrackFromProbe(
      tracks,
      preferredSubtitleLang,
    );
    selectedAudioStreamIndex =
      forceAudioStreamMapping && Number.isInteger(audioTrack?.streamIndex)
        ? audioTrack.streamIndex
        : -1;
    selectedSubtitleStreamIndex = Number.isInteger(subtitleTrack?.streamIndex)
      ? subtitleTrack.streamIndex
      : -1;
  } catch {
    // Probe data is optional for session reuse.
  }
  const subtitleMetadata = {
    ...(session.metadata || {}),
    subtitleTargetName: String(
      session.metadata?.subtitleTargetName || session.filename || "",
    ).trim(),
    subtitleTargetFilename: String(
      session.metadata?.subtitleTargetFilename || session.filename || "",
    ).trim(),
    subtitleTargetFilePath: String(
      session.metadata?.subtitleTargetFilePath || "",
    ).trim(),
  };
  tracks = await augmentTracksWithExternalSubtitles(
    tracks,
    subtitleMetadata,
    preferredSubtitleLang,
  );
  const preferredSubtitleTrack = chooseSubtitleTrackFromProbe(
    tracks,
    preferredSubtitleLang,
  );
  selectedSubtitleStreamIndex = Number.isInteger(
    preferredSubtitleTrack?.streamIndex,
  )
    ? preferredSubtitleTrack.streamIndex
    : -1;

  const normalizedPlayable = normalizeResolvedSourceForSoftwareDecode(
    {
      playableUrl: session.playableUrl,
      fallbackUrls: session.fallbackUrls,
      filename: session.filename,
      sourceHash: session.sourceHash,
      selectedFile: session.selectedFile,
    },
    {
      audioStreamIndex: selectedAudioStreamIndex,
      subtitleStreamIndex: selectedSubtitleStreamIndex,
    },
  );
  return {
    playableUrl: normalizedPlayable.playableUrl,
    fallbackUrls: normalizedPlayable.fallbackUrls,
    filename: session.filename,
    sourceHash: session.sourceHash,
    selectedFile: session.selectedFile,
    sourceInput,
    tracks,
    selectedAudioStreamIndex,
    selectedSubtitleStreamIndex,
    preferences: {
      audioLang: normalizedLang,
      subtitleLang: preferredSubtitleLang,
      quality: preferredQuality,
    },
    metadata: subtitleMetadata,
    session: buildPlaybackSessionPayload(session),
  };
}

async function withExternalSubtitleTracksOnResolvedMovie(
  result,
  preferredSubtitleLang = "",
) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const cloned = cloneResolvedMovieResult(result) || {
    ...result,
    tracks: result?.tracks || {},
  };
  const metadata =
    cloned?.metadata && typeof cloned.metadata === "object"
      ? cloned.metadata
      : {};
  const subtitleMetadata = {
    ...metadata,
    subtitleTargetName: String(
      metadata?.subtitleTargetName ||
        cloned?.selectedFilePath ||
        cloned?.filename ||
        "",
    ).trim(),
    subtitleTargetFilename: String(
      metadata?.subtitleTargetFilename || cloned?.filename || "",
    ).trim(),
    subtitleTargetFilePath: String(
      metadata?.subtitleTargetFilePath || cloned?.selectedFilePath || "",
    ).trim(),
  };
  const tracks =
    cloned?.tracks && typeof cloned.tracks === "object" ? cloned.tracks : {};
  cloned.metadata = subtitleMetadata;
  cloned.tracks = await augmentTracksWithExternalSubtitles(
    tracks,
    subtitleMetadata,
    preferredSubtitleLang,
  );
  const preferredSubtitleTrack = chooseSubtitleTrackFromProbe(
    cloned.tracks,
    preferredSubtitleLang,
  );
  cloned.selectedSubtitleStreamIndex = Number.isInteger(
    preferredSubtitleTrack?.streamIndex,
  )
    ? preferredSubtitleTrack.streamIndex
    : -1;
  return cloned;
}

async function resolveMovieWithDedup(tmdbMovieId, context = {}) {
  const effectivePreferredAudioLang = resolveEffectivePreferredAudioLang(
    tmdbMovieId,
    context.preferredAudioLang,
  );
  const effectivePreferredQuality = normalizePreferredStreamQuality(
    context.preferredQuality,
  );
  const effectivePreferredSubtitleLang = normalizeSubtitlePreference(
    context.preferredSubtitleLang || "",
  );
  const forcedSourceHash = normalizeSourceHash(context.sourceHash);
  const effectiveMinSeeders = normalizeMinimumSeeders(context.minSeeders);
  const effectiveAllowedFormats = normalizeAllowedFormats(
    context.allowedFormats,
  );
  const effectiveSourceLanguage = normalizeSourceLanguageFilter(
    context.sourceLanguage,
  );
  const effectiveContext = {
    ...context,
    preferredAudioLang: effectivePreferredAudioLang,
    preferredQuality: effectivePreferredQuality,
    preferredSubtitleLang: effectivePreferredSubtitleLang,
    sourceHash: forcedSourceHash,
    minSeeders: effectiveMinSeeders,
    allowedFormats: effectiveAllowedFormats,
    sourceLanguage: effectiveSourceLanguage,
  };

  if (
    forcedSourceHash ||
    effectiveMinSeeders > 0 ||
    (effectiveAllowedFormats.length &&
      !isMp4OnlyAllowedFormats(effectiveAllowedFormats)) ||
    effectiveSourceLanguage !== SOURCE_LANGUAGE_FILTER_DEFAULT
  ) {
    return resolveTmdbMovieViaRealDebrid(tmdbMovieId, effectiveContext);
  }

  const dedupKey = buildMovieResolveKey(
    tmdbMovieId,
    effectivePreferredAudioLang,
    effectivePreferredQuality,
  );
  const reusableSession = await getReusablePlaybackSession(
    tmdbMovieId,
    effectiveContext,
  );
  if (reusableSession) {
    setCachedMovieQuickStart(dedupKey, reusableSession);
    return (
      attachPlaybackSessionToResolvedMovie(
        reusableSession,
        tmdbMovieId,
        effectivePreferredAudioLang,
        effectivePreferredQuality,
      ) || reusableSession
    );
  }

  const cached = getCachedMovieQuickStart(dedupKey);
  if (cached) {
    const hydratedCached = await withExternalSubtitleTracksOnResolvedMovie(
      cached,
      effectivePreferredSubtitleLang,
    );
    setCachedMovieQuickStart(dedupKey, hydratedCached);
    return (
      attachPlaybackSessionToResolvedMovie(
        hydratedCached,
        tmdbMovieId,
        effectivePreferredAudioLang,
        effectivePreferredQuality,
      ) || hydratedCached
    );
  }

  const existing = inFlightMovieResolves.get(dedupKey);
  if (existing) {
    cacheStats.movieResolveDedupHits += 1;
    return existing;
  }
  cacheStats.movieResolveDedupMisses += 1;

  const task = resolveTmdbMovieViaRealDebrid(tmdbMovieId, effectiveContext)
    .then((resolved) => {
      setCachedMovieQuickStart(dedupKey, resolved);
      persistPlaybackSession(dedupKey, resolved, {
        tmdbId: String(tmdbMovieId || "").trim(),
        preferredAudioLang: effectivePreferredAudioLang,
        preferredQuality: effectivePreferredQuality,
      });
      return (
        attachPlaybackSessionToResolvedMovie(
          resolved,
          tmdbMovieId,
          effectivePreferredAudioLang,
          effectivePreferredQuality,
        ) || resolved
      );
    })
    .finally(() => {
      inFlightMovieResolves.delete(dedupKey);
    });

  inFlightMovieResolves.set(dedupKey, task);
  return task;
}

async function resolveCandidateStream(stream, fallbackName) {
  const magnet = buildMagnetUri(stream, fallbackName);
  const cacheKey = buildResolvedStreamCacheKey(stream);
  const cachedSource = await getCachedResolvedStream(cacheKey);
  if (cachedSource) {
    return cachedSource;
  }

  const infoHash = String(stream?.infoHash || "")
    .trim()
    .toLowerCase();
  const preferredFilename = stream?.behaviorHints?.filename;
  let torrentId = "";
  let createdTorrent = false;

  const resolveFromTorrentId = async (candidateTorrentId) => {
    const info = await rdFetch(`/torrents/info/${candidateTorrentId}`);
    const fileIds = pickVideoFileIds(
      info?.files || [],
      preferredFilename,
      fallbackName,
    );
    if (!fileIds.length) {
      throw new Error("No MP4 video file was found in this torrent.");
    }
    const selectedFile = fileIds.length ? String(fileIds[0]) : "";
    const selectedFilePath = fileIds.length
      ? String(
          (Array.isArray(info?.files) ? info.files : []).find(
            (file) => Number(file?.id) === Number(fileIds[0]),
          )?.path || "",
        )
      : "";

    await rdFetch(`/torrents/selectFiles/${candidateTorrentId}`, {
      method: "POST",
      form: {
        files: fileIds.join(","),
      },
    });

    const readyInfo = await waitForTorrentToBeReady(candidateTorrentId);
    const downloadLinks = Array.isArray(readyInfo?.links)
      ? readyInfo.links.filter(Boolean)
      : [];
    if (!downloadLinks.length) {
      throw new Error("No Real-Debrid download link was generated.");
    }

    let lastError = null;
    const verifiedCandidates = [];
    const uncertainCandidates = [];
    let filename = "";

    for (let linkIndex = 0; linkIndex < downloadLinks.length; linkIndex += 1) {
      const downloadLink = downloadLinks[linkIndex];

      try {
        const resolved = await resolvePlayableUrlFromRdLink(downloadLink);
        if (!filename && resolved.filename) {
          filename = resolved.filename;
        }

        const candidateUrls = Array.isArray(resolved.playableUrls)
          ? resolved.playableUrls
          : [];
        const mp4FilenameHint = String(
          filename || resolved.filename || selectedFilePath || "",
        ).trim();
        const mp4Candidates = candidateUrls
          .filter(
            (url) =>
              hasUrlLikeContainerExtension(url, "mp4") ||
              VIDEO_FILE_REGEX.test(mp4FilenameHint),
          )
          .sort((left, right) => {
            const leftStable = String(left).includes(
              "download.real-debrid.com",
            );
            const rightStable = String(right).includes(
              "download.real-debrid.com",
            );
            return Number(rightStable) - Number(leftStable);
          });

        for (let urlIndex = 0; urlIndex < mp4Candidates.length; urlIndex += 1) {
          const playableUrl = mp4Candidates[urlIndex];
          if (
            verifiedCandidates.includes(playableUrl) ||
            uncertainCandidates.includes(playableUrl)
          ) {
            continue;
          }

          let check = null;
          try {
            check = await verifyPlayableUrl(playableUrl);
          } catch (error) {
            lastError = error;
            continue;
          }

          if (check.ok) {
            pushUniqueUrl(verifiedCandidates, playableUrl);
            continue;
          }

          if (check.uncertain) {
            pushUniqueUrl(uncertainCandidates, playableUrl);
          }
        }
      } catch (error) {
        lastError = error;
      }
    }

    const rankedCandidates = [...verifiedCandidates, ...uncertainCandidates];

    if (rankedCandidates.length) {
      const playableUrl = rankedCandidates[0];
      const resolvedSource = {
        playableUrl,
        fallbackUrls: rankedCandidates.slice(1),
        filename: filename || selectedFilePath,
        sourceHash: infoHash,
        selectedFile,
        selectedFilePath,
      };
      if (!isResolvedSourceLikelyContainer(resolvedSource, "mp4")) {
        throw new Error(
          "Resolved stream did not match required MP4 container.",
        );
      }
      setCachedResolvedStream(cacheKey, resolvedSource);
      return resolvedSource;
    }

    throw (
      lastError ||
      new Error("No playable Real-Debrid stream URL was available.")
    );
  };

  try {
    let reusable = null;
    try {
      reusable = await findReusableRdTorrentByHash(infoHash);
    } catch {
      reusable = null;
    }

    if (reusable?.id) {
      try {
        return await resolveFromTorrentId(reusable.id);
      } catch {
        // Fall back to addMagnet if existing torrent cannot be reused.
      }
    }

    const added = await rdFetch("/torrents/addMagnet", {
      method: "POST",
      form: { magnet },
    });

    torrentId = added?.id;
    createdTorrent = true;
    if (!torrentId) {
      throw new Error("Real-Debrid did not return a torrent id.");
    }

    const resolvedSource = await resolveFromTorrentId(torrentId);
    setCachedRdTorrentLookup(infoHash, {
      id: torrentId,
      hash: infoHash,
      status: "downloaded",
    });
    return resolvedSource;
  } catch (error) {
    if (createdTorrent) {
      void safeDeleteTorrent(torrentId);
    }
    throw error;
  }
}

async function fetchMovieMetadata(
  tmdbMovieId,
  { titleFallback = "", yearFallback = "" } = {},
) {
  const details = await tmdbFetch(`/movie/${tmdbMovieId}`);
  if (!details?.imdb_id) {
    throw new Error("This TMDB movie does not expose an IMDb id.");
  }

  const runtimeMinutes = Number(details.runtime);
  const runtimeSeconds =
    Number.isFinite(runtimeMinutes) && runtimeMinutes > 0
      ? Math.round(runtimeMinutes * 60)
      : 0;

  return {
    tmdbId: String(tmdbMovieId || "").trim(),
    imdbId: details.imdb_id,
    subtitleLookupImdbId: details.imdb_id,
    displayTitle: details.title || titleFallback || "Movie",
    displayYear: details.release_date
      ? details.release_date.slice(0, 4)
      : yearFallback,
    runtimeSeconds,
  };
}

async function fetchTorrentioMovieStreams(imdbId) {
  const payload = await requestJson(
    `${TORRENTIO_BASE_URL}/stream/movie/${imdbId}.json`,
  );
  return Array.isArray(payload?.streams) ? payload.streams : [];
}

function normalizeEpisodeOrdinal(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const floored = Math.floor(parsed);
  return floored >= 1 ? floored : fallback;
}

function buildEpisodeSignature(seasonNumber, episodeNumber) {
  const safeSeason = normalizeEpisodeOrdinal(seasonNumber, 1);
  const safeEpisode = normalizeEpisodeOrdinal(episodeNumber, 1);
  return `${safeSeason}x${safeEpisode}`;
}

function collectEpisodeSignatures(rawText, seasonHint = null) {
  const text = String(rawText || "").toLowerCase();
  if (!text) {
    return [];
  }
  const safeSeasonHint = Number.isFinite(Number(seasonHint))
    ? Math.max(1, Math.min(99, Math.floor(Number(seasonHint))))
    : 0;

  const signatures = [];
  const pushSignature = (season, episode) => {
    const safeSeason = Number(season);
    const safeEpisode = Number(episode);
    if (!Number.isFinite(safeSeason) || !Number.isFinite(safeEpisode)) {
      return;
    }
    if (
      safeSeason < 1 ||
      safeSeason > 99 ||
      safeEpisode < 1 ||
      safeEpisode > 999
    ) {
      return;
    }
    signatures.push(`${safeSeason}x${safeEpisode}`);
  };

  const sxePattern =
    /\bs(?:eason\s*)?0*(\d{1,2})\s*[-_. ]?e(?:pisode\s*)?0*(\d{1,3})\b/g;
  for (const match of text.matchAll(sxePattern)) {
    pushSignature(match[1], match[2]);
  }

  const xPattern = /\b0*(\d{1,2})x0*(\d{1,3})\b/g;
  for (const match of text.matchAll(xPattern)) {
    pushSignature(match[1], match[2]);
  }

  if (safeSeasonHint > 0) {
    const episodeOnlyPattern = /\b(?:e|ep|episode)\s*[-_. ]?0*(\d{1,3})\b/g;
    for (const match of text.matchAll(episodeOnlyPattern)) {
      pushSignature(safeSeasonHint, match[1]);
    }
  }

  return [...new Set(signatures)];
}

function buildEpisodeMatchText(stream) {
  return [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreStreamEpisodeMatch(stream, seasonNumber, episodeNumber) {
  const streamText = buildEpisodeMatchText(stream);
  if (!streamText) {
    return 0;
  }

  const targetSignature = buildEpisodeSignature(seasonNumber, episodeNumber);
  const signatures = collectEpisodeSignatures(streamText, seasonNumber);
  if (!signatures.length) {
    return 0;
  }

  if (signatures.includes(targetSignature)) {
    return 2800;
  }

  return -3400;
}

function doesFilenameLikelyMatchTvEpisode(
  filename,
  showTitle,
  showYear,
  seasonNumber,
  episodeNumber,
) {
  const normalizedFilename = normalizeTextForMatch(filename);
  if (!normalizedFilename) {
    return true;
  }

  const targetSignature = buildEpisodeSignature(seasonNumber, episodeNumber);
  const episodeSignatures = collectEpisodeSignatures(
    normalizedFilename,
    seasonNumber,
  );
  if (episodeSignatures.length) {
    return episodeSignatures.includes(targetSignature);
  }

  const titleTokens = tokenizeTitleForMatch(showTitle);
  if (!titleTokens.length) {
    return true;
  }

  const expectedYear = String(showYear || "").trim();
  const yearMatchesInFilename =
    normalizedFilename.match(/\b(?:19|20)\d{2}\b/g) || [];
  const hasExpectedYear =
    expectedYear && yearMatchesInFilename.includes(expectedYear);
  const hasConflictingYear = Boolean(
    expectedYear && yearMatchesInFilename.length && !hasExpectedYear,
  );

  const matchedTokenCount = titleTokens.reduce((count, token) => {
    return count + (normalizedFilename.includes(token) ? 1 : 0);
  }, 0);
  const requiredTokenMatches =
    titleTokens.length === 1 ? 1 : Math.min(2, titleTokens.length);

  if (matchedTokenCount >= requiredTokenMatches) {
    if (!expectedYear) {
      return true;
    }
    if (hasExpectedYear) {
      return true;
    }
    return !hasConflictingYear;
  }

  if (matchedTokenCount >= 1 && hasExpectedYear) {
    return true;
  }

  return false;
}

async function fetchTvEpisodeMetadata(
  tmdbTvId,
  {
    seasonNumber = 1,
    episodeNumber = 1,
    titleFallback = "",
    yearFallback = "",
  } = {},
) {
  const safeSeasonNumber = normalizeEpisodeOrdinal(seasonNumber, 1);
  const safeEpisodeNumber = normalizeEpisodeOrdinal(episodeNumber, 1);
  const [seriesDetails, episodeDetails, externalIds, episodeExternalIds] =
    await Promise.all([
      tmdbFetch(`/tv/${tmdbTvId}`),
      tmdbFetch(
        `/tv/${tmdbTvId}/season/${safeSeasonNumber}/episode/${safeEpisodeNumber}`,
      ),
      tmdbFetch(`/tv/${tmdbTvId}/external_ids`).catch(() => ({})),
      tmdbFetch(
        `/tv/${tmdbTvId}/season/${safeSeasonNumber}/episode/${safeEpisodeNumber}/external_ids`,
      ).catch(() => ({})),
    ]);
  const seriesImdbId = String(externalIds?.imdb_id || "").trim();
  if (!seriesImdbId) {
    throw new Error("This TMDB series does not expose an IMDb id.");
  }
  const episodeImdbId = String(episodeExternalIds?.imdb_id || "").trim();
  const subtitleLookupImdbId = episodeImdbId || seriesImdbId;

  const runtimeMinutes = Number(
    episodeDetails?.runtime || seriesDetails?.episode_run_time?.[0],
  );
  const runtimeSeconds =
    Number.isFinite(runtimeMinutes) && runtimeMinutes > 0
      ? Math.round(runtimeMinutes * 60)
      : 0;

  return {
    tmdbId: String(tmdbTvId || "").trim(),
    imdbId: seriesImdbId,
    subtitleLookupImdbId,
    displayTitle: String(seriesDetails?.name || titleFallback || "Series"),
    displayYear: seriesDetails?.first_air_date
      ? String(seriesDetails.first_air_date).slice(0, 4)
      : String(yearFallback || ""),
    runtimeSeconds,
    seasonNumber: safeSeasonNumber,
    episodeNumber: safeEpisodeNumber,
    episodeTitle: String(
      episodeDetails?.name || `Episode ${safeEpisodeNumber}`,
    ),
  };
}

async function fetchTorrentioEpisodeStreams(
  imdbId,
  seasonNumber,
  episodeNumber,
) {
  const payload = await requestJson(
    `${TORRENTIO_BASE_URL}/stream/series/${encodeURIComponent(imdbId)}:${encodeURIComponent(String(seasonNumber))}:${encodeURIComponent(String(episodeNumber))}.json`,
  );
  return Array.isArray(payload?.streams) ? payload.streams : [];
}

async function resolveTmdbTvEpisodeViaRealDebrid(tmdbTvId, context = {}) {
  const resolutionStartedAt = Date.now();
  const maxResolutionMs = 90000;
  const metadata = await fetchTvEpisodeMetadata(tmdbTvId, context);
  const preferredAudioLang = normalizePreferredAudioLang(
    context.preferredAudioLang,
  );
  const preferredSubtitleLang = normalizeSubtitlePreference(
    context.preferredSubtitleLang || "",
  );
  const preferredStreamQuality = normalizePreferredStreamQuality(
    context.preferredQuality,
  );
  const preferredContainer = normalizePreferredContainer(
    context.preferredContainer,
  );
  const sourceHash = normalizeSourceHash(context.sourceHash);
  const minSeeders = normalizeMinimumSeeders(context.minSeeders);
  const allowedFormats = normalizeAllowedFormats(context.allowedFormats);
  const sourceLanguage = normalizeSourceLanguageFilter(context.sourceLanguage);

  const streams = await fetchTorrentioEpisodeStreams(
    metadata.imdbId,
    metadata.seasonNumber,
    metadata.episodeNumber,
  );
  const candidates = selectTopEpisodeCandidates(
    streams,
    metadata,
    preferredAudioLang,
    preferredStreamQuality,
    preferredContainer,
    sourceHash,
    10,
    {
      minSeeders,
      allowedFormats,
      sourceLanguage,
    },
  );

  if (!candidates.length) {
    throw new Error("No stream candidates were returned for this episode.");
  }

  const orderedCandidates = candidates;

  const finalizeResolvedCandidate = async (resolved) => {
    const sourceInput = extractPlayableSourceInput(resolved.playableUrl);
    const subtitleMetadata = {
      ...metadata,
      subtitleTargetName: String(
        resolved?.selectedFilePath || resolved?.filename || "",
      ).trim(),
      subtitleTargetFilename: String(resolved?.filename || "").trim(),
      subtitleTargetFilePath: String(resolved?.selectedFilePath || "").trim(),
    };
    let tracks = {
      durationSeconds: metadata.runtimeSeconds || 0,
      audioTracks: [],
      subtitleTracks: [],
    };
    let selectedAudioStreamIndex = -1;
    let selectedSubtitleStreamIndex = -1;
    const forceAudioStreamMapping = preferredAudioLang !== "auto";
    try {
      tracks = await probeMediaTracks(sourceInput, {
        sourceHash: resolved.sourceHash,
        selectedFile: resolved.selectedFile,
      });
      const audioTrack = chooseAudioTrackFromProbe(tracks, preferredAudioLang);
      const subtitleTrack = chooseSubtitleTrackFromProbe(
        tracks,
        preferredSubtitleLang,
      );
      selectedAudioStreamIndex =
        forceAudioStreamMapping && Number.isInteger(audioTrack?.streamIndex)
          ? audioTrack.streamIndex
          : -1;
      selectedSubtitleStreamIndex = Number.isInteger(subtitleTrack?.streamIndex)
        ? subtitleTrack.streamIndex
        : -1;
    } catch {
      // Track probing is optional; continue playback with best-effort defaults.
    }
    tracks = await augmentTracksWithExternalSubtitles(
      tracks,
      subtitleMetadata,
      preferredSubtitleLang,
    );
    const preferredSubtitleTrack = chooseSubtitleTrackFromProbe(
      tracks,
      preferredSubtitleLang,
    );
    selectedSubtitleStreamIndex = Number.isInteger(
      preferredSubtitleTrack?.streamIndex,
    )
      ? preferredSubtitleTrack.streamIndex
      : -1;

    const normalizedPlayable = normalizeResolvedSourceForSoftwareDecode(
      {
        ...resolved,
        sourceInput,
      },
      {
        audioStreamIndex: selectedAudioStreamIndex,
        subtitleStreamIndex: selectedSubtitleStreamIndex,
      },
    );

    return {
      playableUrl: normalizedPlayable.playableUrl,
      fallbackUrls: normalizedPlayable.fallbackUrls,
      filename: normalizedPlayable.filename || resolved.filename,
      sourceHash: resolved.sourceHash,
      selectedFile: resolved.selectedFile,
      selectedFilePath: resolved.selectedFilePath,
      sourceInput,
      tracks,
      selectedAudioStreamIndex,
      selectedSubtitleStreamIndex,
      preferences: {
        audioLang: preferredAudioLang,
        subtitleLang: preferredSubtitleLang,
        quality: preferredStreamQuality,
      },
      metadata: subtitleMetadata,
    };
  };

  let lastError = null;
  for (let index = 0; index < orderedCandidates.length; index += 1) {
    if (Date.now() - resolutionStartedAt > maxResolutionMs) {
      throw lastError || new Error("Timed out resolving a playable source.");
    }

    const candidate = orderedCandidates[index];

    try {
      const fallbackEpisodeTitle = String(metadata.episodeTitle || "").trim();
      const fallbackName = fallbackEpisodeTitle
        ? `${metadata.displayTitle} S${String(metadata.seasonNumber).padStart(2, "0")}E${String(metadata.episodeNumber).padStart(2, "0")} ${fallbackEpisodeTitle}`
        : `${metadata.displayTitle} S${String(metadata.seasonNumber).padStart(2, "0")}E${String(metadata.episodeNumber).padStart(2, "0")}`;
      const cacheKey = buildResolvedStreamCacheKey(candidate);
      const candidateSourceHash = normalizeSourceHash(candidate?.infoHash);
      const isForcedCandidate = Boolean(
        sourceHash && candidateSourceHash && candidateSourceHash === sourceHash,
      );
      let resolved = await resolveCandidateStream(candidate, fallbackName);
      let episodeMatchName = String(
        resolved?.selectedFilePath || resolved?.filename || "",
      ).trim();
      let resolvedEpisodeSignatures = collectEpisodeSignatures(
        episodeMatchName,
        metadata.seasonNumber,
      );
      let filenameMatchesEpisode = doesFilenameLikelyMatchTvEpisode(
        episodeMatchName,
        metadata.displayTitle,
        metadata.displayYear,
        metadata.seasonNumber,
        metadata.episodeNumber,
      );
      const candidateConfirmsEpisode =
        scoreStreamEpisodeMatch(
          candidate,
          metadata.seasonNumber,
          metadata.episodeNumber,
        ) > 0;
      if (
        !filenameMatchesEpisode &&
        candidateConfirmsEpisode &&
        isForcedCandidate
      ) {
        filenameMatchesEpisode = true;
      }
      if (
        !filenameMatchesEpisode &&
        candidateConfirmsEpisode &&
        !resolvedEpisodeSignatures.length
      ) {
        filenameMatchesEpisode = true;
      }

      if (!filenameMatchesEpisode && cacheKey) {
        invalidateCachedResolvedStream(cacheKey);
        resolved = await resolveCandidateStream(candidate, fallbackName);
        episodeMatchName = String(
          resolved?.selectedFilePath || resolved?.filename || "",
        ).trim();
        resolvedEpisodeSignatures = collectEpisodeSignatures(
          episodeMatchName,
          metadata.seasonNumber,
        );
        filenameMatchesEpisode = doesFilenameLikelyMatchTvEpisode(
          episodeMatchName,
          metadata.displayTitle,
          metadata.displayYear,
          metadata.seasonNumber,
          metadata.episodeNumber,
        );
        if (
          !filenameMatchesEpisode &&
          candidateConfirmsEpisode &&
          isForcedCandidate
        ) {
          filenameMatchesEpisode = true;
        }
        if (
          !filenameMatchesEpisode &&
          candidateConfirmsEpisode &&
          !resolvedEpisodeSignatures.length
        ) {
          filenameMatchesEpisode = true;
        }
      }

      if (!filenameMatchesEpisode) {
        lastError = new Error(
          "Resolved stream filename did not match requested episode.",
        );
        continue;
      }

      if (!isResolvedSourceLikelyContainer(resolved, "mp4")) {
        lastError = new Error(
          "Resolved stream did not match required MP4 container.",
        );
        continue;
      }

      return await finalizeResolvedCandidate(resolved);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("All stream candidates failed.");
}

async function resolveTmdbMovieViaRealDebrid(tmdbMovieId, context = {}) {
  const resolutionStartedAt = Date.now();
  const maxResolutionMs = 90000;
  const metadata = await fetchMovieMetadata(tmdbMovieId, context);
  const persistedPreference =
    getPersistedTitleTrackPreference(metadata.tmdbId) || null;
  const preferredAudioLang =
    context.preferredAudioLang === "auto" && persistedPreference?.audioLang
      ? persistedPreference.audioLang
      : normalizePreferredAudioLang(context.preferredAudioLang);
  const preferredSubtitleLang = normalizeSubtitlePreference(
    context.preferredSubtitleLang || persistedPreference?.subtitleLang || "",
  );
  const preferredStreamQuality = normalizePreferredStreamQuality(
    context.preferredQuality,
  );
  const sourceHash = normalizeSourceHash(context.sourceHash);
  const minSeeders = normalizeMinimumSeeders(context.minSeeders);
  const allowedFormats = normalizeAllowedFormats(context.allowedFormats);
  const sourceLanguage = normalizeSourceLanguageFilter(context.sourceLanguage);

  const streams = await fetchTorrentioMovieStreams(metadata.imdbId);
  const candidates = selectTopMovieCandidates(
    streams,
    metadata,
    preferredAudioLang,
    preferredStreamQuality,
    sourceHash,
    10,
    {
      minSeeders,
      allowedFormats,
      sourceLanguage,
    },
  );

  if (!candidates.length) {
    throw new Error("No stream candidates were returned for this movie.");
  }

  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    if (Date.now() - resolutionStartedAt > maxResolutionMs) {
      throw lastError || new Error("Timed out resolving a playable source.");
    }

    const candidate = candidates[index];

    try {
      const fallbackName =
        `${metadata.displayTitle} ${metadata.displayYear || ""}`.trim();
      const resolved = await resolveCandidateStream(candidate, fallbackName);
      const filenameMatchesMovie = doesFilenameLikelyMatchMovie(
        resolved?.filename,
        metadata.displayTitle,
        metadata.displayYear,
      );
      if (!filenameMatchesMovie) {
        lastError = new Error(
          "Resolved stream filename did not match requested title.",
        );
        continue;
      }
      if (!isResolvedSourceLikelyContainer(resolved, "mp4")) {
        lastError = new Error(
          "Resolved stream did not match required MP4 container.",
        );
        continue;
      }

      const sourceInput = extractPlayableSourceInput(resolved.playableUrl);
      const subtitleMetadata = {
        ...metadata,
        subtitleTargetName: String(
          resolved?.selectedFilePath || resolved?.filename || "",
        ).trim(),
        subtitleTargetFilename: String(resolved?.filename || "").trim(),
        subtitleTargetFilePath: String(resolved?.selectedFilePath || "").trim(),
      };
      let tracks = {
        durationSeconds: metadata.runtimeSeconds || 0,
        audioTracks: [],
        subtitleTracks: [],
      };
      let selectedAudioStreamIndex = -1;
      let selectedSubtitleStreamIndex = -1;
      const forceAudioStreamMapping = preferredAudioLang !== "auto";
      try {
        tracks = await probeMediaTracks(sourceInput, {
          sourceHash: resolved.sourceHash,
          selectedFile: resolved.selectedFile,
        });
        const audioTrack = chooseAudioTrackFromProbe(
          tracks,
          preferredAudioLang,
        );
        const subtitleTrack = chooseSubtitleTrackFromProbe(
          tracks,
          preferredSubtitleLang,
        );
        selectedAudioStreamIndex =
          forceAudioStreamMapping && Number.isInteger(audioTrack?.streamIndex)
            ? audioTrack.streamIndex
            : -1;
        selectedSubtitleStreamIndex = Number.isInteger(
          subtitleTrack?.streamIndex,
        )
          ? subtitleTrack.streamIndex
          : -1;
      } catch {
        // Track probing is optional; continue playback with best-effort defaults.
      }
      tracks = await augmentTracksWithExternalSubtitles(
        tracks,
        subtitleMetadata,
        preferredSubtitleLang,
      );
      const preferredSubtitleTrack = chooseSubtitleTrackFromProbe(
        tracks,
        preferredSubtitleLang,
      );
      selectedSubtitleStreamIndex = Number.isInteger(
        preferredSubtitleTrack?.streamIndex,
      )
        ? preferredSubtitleTrack.streamIndex
        : -1;

      const normalizedPlayable = normalizeResolvedSourceForSoftwareDecode(
        {
          ...resolved,
          sourceInput,
        },
        {
          audioStreamIndex: selectedAudioStreamIndex,
          subtitleStreamIndex: selectedSubtitleStreamIndex,
        },
      );

      return {
        ...resolved,
        playableUrl: normalizedPlayable.playableUrl,
        fallbackUrls: normalizedPlayable.fallbackUrls,
        sourceInput,
        tracks,
        selectedAudioStreamIndex,
        selectedSubtitleStreamIndex,
        preferences: {
          audioLang: preferredAudioLang,
          subtitleLang: preferredSubtitleLang,
          quality: preferredStreamQuality,
        },
        metadata: subtitleMetadata,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("All stream candidates failed.");
}

async function handleApi(url, request) {
  sweepUploadSessions();
  if (url.pathname === "/api/debug/cache") {
    if (url.searchParams.get("clear") === "1") {
      tmdbResponseCache.clear();
      movieQuickStartCache.clear();
      resolvedStreamCache.clear();
      rdTorrentLookupCache.clear();
      externalSubtitleLookupCache.clear();
      inFlightMovieResolves.clear();
      inFlightExternalSubtitleLookups.clear();
      inFlightExternalSubtitleBuilds.clear();
      clearPersistentCaches();
    }
    sweepCaches();
    return json(getCacheDebugStats());
  }

  if (url.pathname === "/api/config") {
    const [ffmpeg, nativePlayer] = await Promise.all([
      getFfmpegCapabilities(),
      getNativePlayerStatus(),
    ]);
    return json({
      realDebridConfigured: Boolean(REAL_DEBRID_TOKEN),
      tmdbConfigured: Boolean(TMDB_API_KEY),
      playbackSessionsEnabled: PLAYBACK_SESSIONS_ENABLED,
      autoAudioSyncEnabled: AUTO_AUDIO_SYNC_ENABLED,
      remuxVideoMode: REMUX_VIDEO_MODE,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      hlsHwaccel: {
        requested: HLS_HWACCEL_MODE,
        effective: ffmpeg.effectiveHlsHwaccel,
      },
      nativePlayback: {
        mode: NATIVE_PLAYBACK_MODE,
        available: nativePlayer.available,
        mpvBinary: nativePlayer.mpvBinary,
        version: nativePlayer.version,
        notes: nativePlayer.notes,
      },
    });
  }

  if (url.pathname === "/api/library") {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed. Use GET." }, 405);
    }
    return json(await readLocalLibrary());
  }

  if (url.pathname === "/api/upload/infer") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }
    let payload = null;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const fileName = normalizeWhitespace(payload?.fileName || "");
    if (!fileName) {
      return json({ error: "Missing fileName." }, 400);
    }

    try {
      const inferred = await inferUploadMetadataWithCodex(fileName);
      return json({
        ok: true,
        inferred,
      });
    } catch (error) {
      const inferred = inferUploadMetadataFromFilenameHeuristic(fileName);
      inferred.reason =
        `Responses API failed; used heuristic fallback. ${inferred.reason}`.trim();
      return json({
        ok: true,
        inferred,
        warning:
          error instanceof Error ? error.message : "Inference fallback used.",
      });
    }
  }

  if (url.pathname === "/api/upload") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }

    const ffmpeg = await getFfmpegCapabilities();
    if (!ffmpeg.ffmpegAvailable) {
      return json(
        {
          error:
            "ffmpeg is required for uploads and container conversion but is unavailable on this machine.",
        },
        500,
      );
    }

    let formData = null;
    try {
      formData = await request.formData();
    } catch {
      return json({ error: "Invalid multipart form payload." }, 400);
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return json({ error: "Missing file upload." }, 400);
    }
    if (file.size <= 0) {
      return json({ error: "Uploaded file is empty." }, 400);
    }

    const originalName = String(file.name || "upload").trim() || "upload";
    const detectedExt = extname(originalName).toLowerCase();
    if (detectedExt !== ".mp4" && detectedExt !== ".mkv") {
      return json({ error: "Only .mp4 and .mkv files are supported." }, 400);
    }
    await ensureUploadDirectories();
    const tempInputPath = join(
      UPLOAD_TEMP_DIR,
      buildUploadTempFilename(originalName),
    );
    try {
      await Bun.write(tempInputPath, file);
      const metadata = buildUploadMetadataFromObject(
        Object.fromEntries(formData.entries()),
      );
      return json(
        await processUploadedMediaIntoLibrary({
          inputPath: tempInputPath,
          originalName,
          metadata,
        }),
      );
    } catch (error) {
      await removeFileIfPresent(tempInputPath);
      const message =
        error instanceof Error ? error.message : "Upload processing failed.";
      return json({ error: message }, 500);
    }
  }

  if (url.pathname === "/api/upload/session/start") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }
    let payload = null;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const fileName = normalizeWhitespace(payload?.fileName || "");
    if (!fileName) {
      return json({ error: "Missing fileName." }, 400);
    }
    const detectedExt = extname(fileName).toLowerCase();
    if (detectedExt !== ".mp4" && detectedExt !== ".mkv") {
      return json({ error: "Only .mp4 and .mkv files are supported." }, 400);
    }

    const ffmpeg = await getFfmpegCapabilities();
    if (!ffmpeg.ffmpegAvailable) {
      return json(
        {
          error:
            "ffmpeg is required for uploads and container conversion but is unavailable on this machine.",
        },
        500,
      );
    }

    await ensureUploadDirectories();
    const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const tempPath = join(UPLOAD_TEMP_DIR, buildUploadTempFilename(fileName));
    uploadSessions.set(sessionId, {
      id: sessionId,
      tempPath,
      fileName,
      metadata: buildUploadMetadataFromObject(payload),
      receivedBytes: 0,
      createdAt: Date.now(),
    });

    return json({
      ok: true,
      sessionId,
    });
  }

  if (url.pathname === "/api/upload/session/chunk") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }
    const sessionId = String(url.searchParams.get("sessionId") || "").trim();
    if (!sessionId) {
      return json({ error: "Missing sessionId." }, 400);
    }
    const session = uploadSessions.get(sessionId);
    if (!session) {
      return json({ error: "Upload session not found." }, 404);
    }
    let chunkBytes = null;
    try {
      const buffer = await request.arrayBuffer();
      chunkBytes = new Uint8Array(buffer);
    } catch {
      return json({ error: "Invalid chunk payload." }, 400);
    }
    if (!chunkBytes || chunkBytes.length === 0) {
      return json({ error: "Empty chunk payload." }, 400);
    }
    try {
      await appendFile(session.tempPath, chunkBytes);
      session.receivedBytes += chunkBytes.length;
      return json({ ok: true, receivedBytes: session.receivedBytes });
    } catch (error) {
      return json(
        {
          error:
            error instanceof Error ? error.message : "Failed to append chunk.",
        },
        500,
      );
    }
  }

  if (url.pathname === "/api/upload/session/finish") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }
    let payload = null;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }
    const sessionId = String(payload?.sessionId || "").trim();
    if (!sessionId) {
      return json({ error: "Missing sessionId." }, 400);
    }
    const session = uploadSessions.get(sessionId);
    if (!session) {
      return json({ error: "Upload session not found." }, 404);
    }
    uploadSessions.delete(sessionId);
    try {
      if (payload && typeof payload === "object") {
        session.metadata = buildUploadMetadataFromObject({
          ...session.metadata,
          ...payload,
        });
      }
      const result = await processUploadedMediaIntoLibrary({
        inputPath: session.tempPath,
        originalName: session.fileName,
        metadata: session.metadata,
      });
      return json(result);
    } catch (error) {
      await removeFileIfPresent(session.tempPath);
      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to finalize upload session.",
        },
        500,
      );
    }
  }

  if (url.pathname === "/api/health") {
    const ffmpeg = await getFfmpegCapabilities(
      url.searchParams.get("refresh") === "1",
    );
    return json({
      ok: true,
      uptimeSeconds: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
      ffmpeg,
    });
  }

  if (url.pathname === "/api/native/player") {
    const nativePlayer = await getNativePlayerStatus(
      url.searchParams.get("refresh") === "1",
    );
    return json({
      mode: NATIVE_PLAYBACK_MODE,
      player: "mpv",
      available: nativePlayer.available,
      mpvBinary: nativePlayer.mpvBinary,
      version: nativePlayer.version,
      notes: nativePlayer.notes,
    });
  }

  if (url.pathname === "/api/native/play") {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }
    if (!isLoopbackHostname(url.hostname)) {
      return json(
        {
          error:
            "Native playback requests are restricted to local loopback access.",
        },
        403,
      );
    }

    const nativePlayer = await getNativePlayerStatus();
    if (NATIVE_PLAYBACK_MODE === "off") {
      return json({
        ok: true,
        launched: false,
        reason: "disabled",
        player: "mpv",
      });
    }
    if (!nativePlayer.available) {
      return json({
        ok: true,
        launched: false,
        reason: "unavailable",
        player: "mpv",
      });
    }

    let payload = null;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const sourceUrl = toAbsolutePlaybackUrl(
      payload?.sourceUrl || payload?.source || payload?.url || "",
      url,
    );
    if (!sourceUrl) {
      return json({ error: "Missing or invalid sourceUrl." }, 400);
    }
    const subtitleUrl = toAbsolutePlaybackUrl(payload?.subtitleUrl || "", url);
    const titleParts = [
      String(payload?.title || "").trim(),
      String(payload?.episode || "").trim(),
    ].filter(Boolean);
    const displayTitle = titleParts.join(" - ");
    const startSeconds = Number(payload?.startSeconds || 0);
    const audioSyncMs = normalizeAudioSyncMs(payload?.audioSyncMs || 0);

    try {
      await launchMpvPlayback({
        sourceUrl,
        subtitleUrl,
        title: displayTitle,
        startSeconds,
        audioSyncMs,
      });
      return json({
        ok: true,
        launched: true,
        player: "mpv",
        sourceUrl,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to launch native player.";
      return json(
        {
          ok: false,
          launched: false,
          player: "mpv",
          error: message,
        },
        500,
      );
    }
  }

  if (url.pathname === "/api/tmdb/popular-movies") {
    const page = url.searchParams.get("page") || "1";
    const [moviePopular, movieGenres] = await Promise.all([
      tmdbFetch("/movie/popular", { page }),
      tmdbFetch("/genre/movie/list"),
    ]);

    return json({
      results: Array.isArray(moviePopular?.results) ? moviePopular.results : [],
      genres: Array.isArray(movieGenres?.genres) ? movieGenres.genres : [],
      imageBase: TMDB_IMAGE_BASE,
    });
  }

  if (url.pathname === "/api/tmdb/details") {
    const tmdbId = (url.searchParams.get("tmdbId") || "").trim();
    const mediaType = (url.searchParams.get("mediaType") || "movie")
      .trim()
      .toLowerCase();

    if (!/^\d+$/.test(tmdbId)) {
      return json({ error: "Missing or invalid tmdbId query parameter." }, 400);
    }

    if (mediaType !== "movie" && mediaType !== "tv") {
      return json({ error: "Unsupported mediaType. Use movie or tv." }, 400);
    }

    const details = await tmdbFetch(`/${mediaType}/${tmdbId}`, {
      append_to_response: "credits",
    });

    return json(details);
  }

  if (url.pathname === "/api/tmdb/tv/season") {
    const tmdbId = (url.searchParams.get("tmdbId") || "").trim();
    const seasonNumber = normalizeEpisodeOrdinal(
      url.searchParams.get("seasonNumber") || url.searchParams.get("season"),
      1,
    );

    if (!/^\d+$/.test(tmdbId)) {
      return json({ error: "Missing or invalid tmdbId query parameter." }, 400);
    }

    const season = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`);
    const episodes = Array.isArray(season?.episodes)
      ? season.episodes.map((entry) => ({
          episodeNumber: Number(entry?.episode_number || 0),
          seasonNumber: Number(entry?.season_number || seasonNumber || 1),
          stillPath: String(entry?.still_path || "").trim(),
          stillUrl: String(entry?.still_path || "").trim()
            ? `${TMDB_IMAGE_BASE}/w780${String(entry.still_path).trim()}`
            : "",
          name: String(entry?.name || "").trim(),
        }))
      : [];

    return json({
      tmdbId,
      seasonNumber,
      episodes,
      imageBase: TMDB_IMAGE_BASE,
    });
  }

  if (url.pathname === "/api/resolve/sources") {
    const tmdbId = (url.searchParams.get("tmdbId") || "").trim();
    const mediaType = String(url.searchParams.get("mediaType") || "movie")
      .trim()
      .toLowerCase();
    const titleFallback = (url.searchParams.get("title") || "").trim();
    const yearFallback = (url.searchParams.get("year") || "").trim();
    const preferredAudioLang = normalizePreferredAudioLang(
      url.searchParams.get("audioLang"),
    );
    const preferredQuality = normalizePreferredStreamQuality(
      url.searchParams.get("quality"),
    );
    const preferredContainer = normalizePreferredContainer(
      url.searchParams.get("preferredContainer"),
    );
    const sourceHash = normalizeSourceHash(url.searchParams.get("sourceHash"));
    const minSeeders = normalizeMinimumSeeders(
      url.searchParams.get("minSeeders"),
    );
    const allowedFormats = normalizeAllowedFormats(
      url.searchParams.get("allowedFormats"),
    );
    const sourceLanguage = normalizeSourceLanguageFilter(
      url.searchParams.get("sourceLang"),
    );
    const requestedLimit = Number(url.searchParams.get("limit") || 10);
    const limit = Math.max(
      1,
      Math.min(
        20,
        Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 10,
      ),
    );

    if (!/^\d+$/.test(tmdbId)) {
      return json({ error: "Missing or invalid tmdbId query parameter." }, 400);
    }

    if (mediaType !== "movie" && mediaType !== "tv") {
      return json({ error: "Unsupported mediaType. Use movie or tv." }, 400);
    }

    if (mediaType === "tv") {
      const seasonNumber = normalizeEpisodeOrdinal(
        url.searchParams.get("seasonNumber") || url.searchParams.get("season"),
        1,
      );
      const episodeNumber = normalizeEpisodeOrdinal(
        url.searchParams.get("episodeNumber") ||
          url.searchParams.get("episodeOrdinal"),
        1,
      );
      const metadata = await fetchTvEpisodeMetadata(tmdbId, {
        titleFallback,
        yearFallback,
        seasonNumber,
        episodeNumber,
      });
      const streams = await fetchTorrentioEpisodeStreams(
        metadata.imdbId,
        metadata.seasonNumber,
        metadata.episodeNumber,
      );
      const candidates = selectTopEpisodeCandidates(
        streams,
        metadata,
        preferredAudioLang,
        preferredQuality,
        preferredContainer,
        sourceHash,
        limit,
        {
          minSeeders,
          allowedFormats,
          sourceLanguage,
        },
      );
      const sources = candidates
        .map((candidate) =>
          summarizeStreamCandidateForClient(
            candidate,
            metadata,
            preferredAudioLang,
            preferredQuality,
          ),
        )
        .filter(Boolean);
      return json({
        mediaType: "tv",
        tmdbId,
        seasonNumber: metadata.seasonNumber,
        episodeNumber: metadata.episodeNumber,
        sources,
      });
    }

    const metadata = await fetchMovieMetadata(tmdbId, {
      titleFallback,
      yearFallback,
    });
    const streams = await fetchTorrentioMovieStreams(metadata.imdbId);
    const candidates = selectTopMovieCandidates(
      streams,
      metadata,
      preferredAudioLang,
      preferredQuality,
      sourceHash,
      limit,
      {
        minSeeders,
        allowedFormats,
        sourceLanguage,
      },
    );
    const sources = candidates
      .map((candidate) =>
        summarizeStreamCandidateForClient(
          candidate,
          metadata,
          preferredAudioLang,
          preferredQuality,
        ),
      )
      .filter(Boolean);
    return json({
      mediaType: "movie",
      tmdbId,
      sources,
    });
  }

  if (url.pathname === "/api/resolve/tv") {
    const tmdbId = (url.searchParams.get("tmdbId") || "").trim();
    const titleFallback = (url.searchParams.get("title") || "").trim();
    const yearFallback = (url.searchParams.get("year") || "").trim();
    const seasonNumber = normalizeEpisodeOrdinal(
      url.searchParams.get("seasonNumber") || url.searchParams.get("season"),
      1,
    );
    const episodeNumber = normalizeEpisodeOrdinal(
      url.searchParams.get("episodeNumber") ||
        url.searchParams.get("episodeOrdinal"),
      1,
    );
    const preferredAudioLang = normalizePreferredAudioLang(
      url.searchParams.get("audioLang"),
    );
    const preferredQuality = normalizePreferredStreamQuality(
      url.searchParams.get("quality"),
    );
    const preferredSubtitleLang = normalizeSubtitlePreference(
      url.searchParams.get("subtitleLang"),
    );
    const preferredContainer = normalizePreferredContainer(
      url.searchParams.get("preferredContainer"),
    );
    const sourceHash = normalizeSourceHash(url.searchParams.get("sourceHash"));
    const minSeeders = normalizeMinimumSeeders(
      url.searchParams.get("minSeeders"),
    );
    const allowedFormats = normalizeAllowedFormats(
      url.searchParams.get("allowedFormats"),
    );
    const sourceLanguage = normalizeSourceLanguageFilter(
      url.searchParams.get("sourceLang"),
    );

    if (!/^\d+$/.test(tmdbId)) {
      return json({ error: "Missing or invalid tmdbId query parameter." }, 400);
    }

    const resolved = await resolveTmdbTvEpisodeViaRealDebrid(tmdbId, {
      titleFallback,
      yearFallback,
      seasonNumber,
      episodeNumber,
      preferredAudioLang,
      preferredQuality,
      preferredSubtitleLang,
      preferredContainer,
      sourceHash,
      minSeeders,
      allowedFormats,
      sourceLanguage,
    });
    const resolvedSourceInput = String(
      resolved?.sourceInput ||
        extractPlayableSourceInput(resolved?.playableUrl || ""),
    ).trim();
    const selectedSubtitleStreamIndex = Number(
      resolved?.selectedSubtitleStreamIndex || -1,
    );
    if (resolvedSourceInput) {
      const prewarmIndices = new Set();
      if (
        Number.isFinite(selectedSubtitleStreamIndex) &&
        selectedSubtitleStreamIndex >= 0
      ) {
        prewarmIndices.add(Math.floor(selectedSubtitleStreamIndex));
      }
      const subtitleTracks = Array.isArray(resolved?.tracks?.subtitleTracks)
        ? resolved.tracks.subtitleTracks
        : [];
      const englishTextCandidates = subtitleTracks.filter(
        (track) =>
          track &&
          track.isTextBased &&
          !track.isExternal &&
          normalizeIsoLanguage(track.language || "") === "en",
      );
      const preferredEnglishTrack =
        englishTextCandidates.find(
          (track) => !isLikelyForcedSubtitleTrack(track),
        ) ||
        englishTextCandidates[0] ||
        null;
      const preferredEnglishStreamIndex = Number(
        preferredEnglishTrack?.streamIndex ?? -1,
      );
      if (
        Number.isFinite(preferredEnglishStreamIndex) &&
        preferredEnglishStreamIndex >= 0
      ) {
        prewarmIndices.add(Math.floor(preferredEnglishStreamIndex));
      }
      prewarmIndices.forEach((streamIndex) => {
        prewarmSubtitleVttBuild(resolvedSourceInput, streamIndex);
      });
    }

    return json(resolved);
  }

  if (url.pathname === "/api/resolve/movie") {
    const tmdbId = (url.searchParams.get("tmdbId") || "").trim();
    const titleFallback = (url.searchParams.get("title") || "").trim();
    const yearFallback = (url.searchParams.get("year") || "").trim();
    const preferredAudioLang = normalizePreferredAudioLang(
      url.searchParams.get("audioLang"),
    );
    const preferredQuality = normalizePreferredStreamQuality(
      url.searchParams.get("quality"),
    );
    const preferredSubtitleLang = normalizeSubtitlePreference(
      url.searchParams.get("subtitleLang"),
    );
    const sourceHash = normalizeSourceHash(url.searchParams.get("sourceHash"));
    const minSeeders = normalizeMinimumSeeders(
      url.searchParams.get("minSeeders"),
    );
    const allowedFormats = normalizeAllowedFormats(
      url.searchParams.get("allowedFormats"),
    );
    const sourceLanguage = normalizeSourceLanguageFilter(
      url.searchParams.get("sourceLang"),
    );

    if (!/^\d+$/.test(tmdbId)) {
      return json({ error: "Missing or invalid tmdbId query parameter." }, 400);
    }

    const resolved = await resolveMovieWithDedup(tmdbId, {
      titleFallback,
      yearFallback,
      preferredAudioLang,
      preferredQuality,
      preferredSubtitleLang,
      sourceHash,
      minSeeders,
      allowedFormats,
      sourceLanguage,
    });
    const resolvedSourceInput = String(
      resolved?.sourceInput ||
        extractPlayableSourceInput(resolved?.playableUrl || ""),
    ).trim();
    const selectedSubtitleStreamIndex = Number(
      resolved?.selectedSubtitleStreamIndex || -1,
    );
    if (
      resolvedSourceInput &&
      Number.isFinite(selectedSubtitleStreamIndex) &&
      selectedSubtitleStreamIndex >= 0
    ) {
      prewarmSubtitleVttBuild(resolvedSourceInput, selectedSubtitleStreamIndex);
    }

    return json(resolved);
  }

  if (url.pathname === "/api/title/preferences") {
    if (request.method === "GET") {
      const tmdbId = String(url.searchParams.get("tmdbId") || "").trim();
      if (!/^\d+$/.test(tmdbId)) {
        return json(
          { error: "Missing or invalid tmdbId query parameter." },
          400,
        );
      }

      const preference = getPersistedTitleTrackPreference(tmdbId) || {
        audioLang: "auto",
        subtitleLang: "",
      };
      return json({
        tmdbId,
        preference,
      });
    }

    if (request.method === "DELETE") {
      const tmdbId = String(url.searchParams.get("tmdbId") || "").trim();
      if (!/^\d+$/.test(tmdbId)) {
        return json(
          { error: "Missing or invalid tmdbId query parameter." },
          400,
        );
      }

      deletePersistedTitleTrackPreference(tmdbId);
      deletePersistedPlaybackSessionsForTmdb(tmdbId);
      invalidateAllMovieResolveCachesForTmdb(tmdbId);

      return json({
        ok: true,
        tmdbId,
        cleared: {
          titlePreferences: true,
          playbackSessions: true,
          movieResolveCaches: true,
        },
      });
    }

    if (request.method !== "POST") {
      return json(
        { error: "Method not allowed. Use GET, POST, or DELETE." },
        405,
      );
    }

    let payload = null;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const tmdbId = String(payload?.tmdbId || "").trim();
    if (!/^\d+$/.test(tmdbId)) {
      return json({ error: "Missing or invalid tmdbId." }, 400);
    }

    const audioLang = normalizePreferredAudioLang(payload?.audioLang);
    const subtitleLang = normalizeSubtitlePreference(payload?.subtitleLang);
    persistTitleTrackPreference(tmdbId, {
      audioLang,
      subtitleLang,
    });

    const nextPreference = getPersistedTitleTrackPreference(tmdbId) || {
      audioLang: "auto",
      subtitleLang: "",
    };
    invalidateAllMovieResolveCachesForTmdb(tmdbId);

    return json({
      ok: true,
      tmdbId,
      preference: nextPreference,
    });
  }

  if (url.pathname === "/api/session/progress") {
    if (!PLAYBACK_SESSIONS_ENABLED) {
      return json({
        ok: true,
        disabled: true,
        session: null,
      });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use POST." }, 405);
    }

    let payload = null;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const tmdbId = String(payload?.tmdbId || "").trim();
    const preferredAudioLang = normalizePreferredAudioLang(payload?.audioLang);
    const preferredQuality = normalizePreferredStreamQuality(payload?.quality);
    if (!/^\d+$/.test(tmdbId)) {
      return json({ error: "Missing or invalid tmdbId." }, 400);
    }

    let sessionKey = buildPlaybackSessionKey(
      tmdbId,
      preferredAudioLang,
      preferredQuality,
    );
    let existing = getPersistedPlaybackSession(sessionKey);
    if (!existing && preferredAudioLang === "auto") {
      const effectiveAudioLang = resolveEffectivePreferredAudioLang(
        tmdbId,
        preferredAudioLang,
      );
      sessionKey = buildPlaybackSessionKey(
        tmdbId,
        effectiveAudioLang,
        preferredQuality,
      );
      existing = getPersistedPlaybackSession(sessionKey);
    }
    if (!existing) {
      const latestSession = getLatestPersistedPlaybackSessionForTmdb(tmdbId);
      if (latestSession) {
        sessionKey = latestSession.sessionKey;
        existing = latestSession;
      }
    }
    if (!existing) {
      return json(
        { error: "Playback session not found for this title/language." },
        404,
      );
    }

    const rawPosition = Number(payload?.positionSeconds);
    const positionSeconds =
      Number.isFinite(rawPosition) && rawPosition >= 0
        ? rawPosition
        : existing.lastPositionSeconds;
    const healthState = normalizeSessionHealthState(
      payload?.healthState || existing.healthState,
    );
    const lastError = String(payload?.lastError || "");
    const sourceHash = String(payload?.sourceHash || existing.sourceHash || "")
      .trim()
      .toLowerCase();
    const eventType = String(payload?.eventType || "")
      .trim()
      .toLowerCase();

    const updated = updatePersistedPlaybackSessionProgress(sessionKey, {
      positionSeconds,
      healthState,
      lastError,
    });
    if (!updated) {
      return json(
        { error: "Unable to persist playback session progress." },
        500,
      );
    }

    const sessionAudioLang = normalizePreferredAudioLang(
      existing.audioLang || preferredAudioLang,
    );
    const sessionQuality = normalizePreferredStreamQuality(
      existing.preferredQuality || preferredQuality,
    );
    if (healthState === "invalid") {
      invalidateMovieResolveCacheForSession(
        tmdbId,
        sessionAudioLang,
        sessionQuality,
      );
      cacheStats.playbackSessionInvalidated += 1;
    }

    if (sourceHash) {
      if (eventType === "success") {
        recordSourceHealthEvent(sourceHash, "success");
      } else if (
        eventType === "decode_failure" ||
        eventType === "ended_early" ||
        eventType === "playback_error"
      ) {
        recordSourceHealthEvent(sourceHash, eventType, lastError);
      } else if (healthState === "invalid") {
        const inferredDecodeFailure =
          /decode|demuxer|ffmpeg|format error/i.test(lastError);
        recordSourceHealthEvent(
          sourceHash,
          inferredDecodeFailure ? "decode_failure" : "playback_error",
          lastError,
        );
      }
    }

    const nextSession = getPersistedPlaybackSession(sessionKey);
    return json({
      ok: true,
      session: buildPlaybackSessionPayload(nextSession || existing),
    });
  }

  if (url.pathname === "/api/media/tracks") {
    const sourceInput = toAbsolutePlaybackUrl(
      url.searchParams.get("input") || "",
      url,
    );
    if (!sourceInput) {
      return json({ error: "Missing input query parameter." }, 400);
    }

    const preferredAudioLang = normalizePreferredAudioLang(
      url.searchParams.get("audioLang"),
    );
    const preferredSubtitleLang = normalizeSubtitlePreference(
      url.searchParams.get("subtitleLang"),
    );

    let tracks = {
      durationSeconds: 0,
      audioTracks: [],
      subtitleTracks: [],
    };
    let selectedAudioStreamIndex = -1;
    let selectedSubtitleStreamIndex = -1;

    try {
      tracks = await probeMediaTracks(sourceInput);
      const audioTrack = chooseAudioTrackFromProbe(tracks, preferredAudioLang);
      const subtitleTrack = chooseSubtitleTrackFromProbe(
        tracks,
        preferredSubtitleLang,
      );
      selectedAudioStreamIndex = Number.isInteger(audioTrack?.streamIndex)
        ? audioTrack.streamIndex
        : -1;
      selectedSubtitleStreamIndex = Number.isInteger(subtitleTrack?.streamIndex)
        ? subtitleTrack.streamIndex
        : -1;
    } catch {
      // Track probing is optional; clients fall back to direct playback.
    }

    return json({
      tracks,
      selectedAudioStreamIndex,
      selectedSubtitleStreamIndex,
      preferences: {
        audioLang: preferredAudioLang,
        subtitleLang: preferredSubtitleLang,
      },
      sourceInput,
    });
  }

  if (url.pathname === "/api/hls/master.m3u8") {
    const input = (url.searchParams.get("input") || "").trim();
    const audioStreamIndex = Number(url.searchParams.get("audioStream") || -1);
    if (!input) {
      return json({ error: "Missing input query parameter." }, 400);
    }
    return createHlsPlaylistResponse(input, audioStreamIndex);
  }

  if (url.pathname === "/api/hls/segment.ts") {
    const input = (url.searchParams.get("input") || "").trim();
    const segmentIndex = Number(url.searchParams.get("index") || 0);
    const audioStreamIndex = Number(url.searchParams.get("audioStream") || -1);
    if (!input) {
      return json({ error: "Missing input query parameter." }, 400);
    }
    return createHlsSegmentResponse(input, segmentIndex, audioStreamIndex);
  }

  if (url.pathname === "/api/subtitles.vtt") {
    const input = (url.searchParams.get("input") || "").trim();
    const subtitleStreamIndex = Number(
      url.searchParams.get("subtitleStream") || -1,
    );
    if (!input) {
      return json({ error: "Missing input query parameter." }, 400);
    }
    return createSubtitleVttResponse(input, subtitleStreamIndex);
  }

  if (url.pathname === "/api/subtitles.external.vtt") {
    const downloadUrl = (url.searchParams.get("download") || "").trim();
    if (!downloadUrl) {
      return json({ error: "Missing download query parameter." }, 400);
    }
    return createExternalSubtitleVttResponse(downloadUrl);
  }

  if (url.pathname === "/api/remux") {
    const input = (url.searchParams.get("input") || "").trim();
    const rawStart = Number(url.searchParams.get("start") || 0);
    const rawAudioStream = Number(url.searchParams.get("audioStream") || -1);
    const rawSubtitleStream = Number(
      url.searchParams.get("subtitleStream") || -1,
    );
    const rawAudioSyncMs = Number(url.searchParams.get("audioSyncMs") || 0);
    const requestedVideoMode = normalizeRemuxVideoMode(
      url.searchParams.get("videoMode") || REMUX_VIDEO_MODE,
    );
    const startSeconds =
      Number.isFinite(rawStart) && rawStart > 0 ? rawStart : 0;
    const audioStreamIndex =
      Number.isFinite(rawAudioStream) && rawAudioStream >= 0
        ? Math.floor(rawAudioStream)
        : -1;
    const subtitleStreamIndex =
      Number.isFinite(rawSubtitleStream) && rawSubtitleStream >= 0
        ? Math.floor(rawSubtitleStream)
        : -1;
    const audioSyncMs = normalizeAudioSyncMs(rawAudioSyncMs);
    if (!input) {
      return json({ error: "Missing input query parameter." }, 400);
    }
    return createRemuxResponse(
      input,
      request,
      startSeconds,
      audioStreamIndex,
      subtitleStreamIndex,
      audioSyncMs,
      requestedVideoMode,
    );
  }

  return null;
}

sweepCaches();
const cacheSweepTimer = setInterval(sweepCaches, CACHE_SWEEP_INTERVAL_MS);
if (typeof cacheSweepTimer?.unref === "function") {
  cacheSweepTimer.unref();
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
  maxRequestBodySize: MAX_UPLOAD_BYTES,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        const apiResponse = await handleApi(url, request);
        if (apiResponse) {
          return apiResponse;
        }

        return json({ error: "Not found" }, 404);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected server error.";
        return json({ error: message }, classifyErrorStatus(message));
      }
    }

    return serveStatic(url.pathname, request);
  },
});

const DISPLAY_HOST = isLoopbackHostname(HOST) ? "localhost" : HOST;
console.log(`Server running at http://${DISPLAY_HOST}:${server.port}`);
