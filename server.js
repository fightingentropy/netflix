import { join, normalize } from "node:path";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { Database } from "bun:sqlite";

const ROOT_DIR = process.cwd();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5173);

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const REAL_DEBRID_API_BASE = "https://api.real-debrid.com/rest/1.0";
const TORRENTIO_BASE_URL = process.env.TORRENTIO_BASE_URL || "https://torrentio.strem.fun";

const TMDB_API_KEY = (process.env.TMDB_API_KEY || "").trim();
const REAL_DEBRID_TOKEN = (process.env.REAL_DEBRID_TOKEN || "").trim();

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

const VIDEO_FILE_REGEX = /\.(mkv|mp4|avi|mov|wmv|m4v|webm|mpg|mpeg|ts)$/i;
const RESOLVED_STREAM_CACHE_TTL_MS = 20 * 60 * 1000;
const RESOLVED_STREAM_CACHE_EPHEMERAL_TTL_MS = 12 * 60 * 60 * 1000;
const RESOLVED_STREAM_CACHE_EPHEMERAL_REVALIDATE_MS = 90 * 1000;
const RESOLVED_STREAM_CACHE_MAX_ENTRIES = 800;
const PERSISTENT_CACHE_DB_PATH = join(ROOT_DIR, ".resolver-cache.sqlite");
const HLS_CACHE_DIR = join(ROOT_DIR, ".hls-cache");
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
const inFlightMovieResolves = new Map();
const inFlightMediaProbeRequests = new Map();
const hlsSegmentBuilds = new Map();
const CACHE_SWEEP_INTERVAL_MS = 60 * 1000;
const SERVER_STARTED_AT = Date.now();
let persistentCacheDb = null;
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
  en: ["english", " eng ", "eng-", "eng]", "eng)", "en audio", "dubbed english"],
  fr: ["french", " fran", "fra ", " fr ", "vf", "vff"],
  es: ["spanish", "espanol", "castellano", " spa ", "esp "],
  de: ["german", " deutsch", " ger ", "deu "],
  it: ["italian", " italiano", " ita "],
  pt: ["portuguese", " portugues", " por ", "pt-br", "brazilian"],
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

function initializePersistentCacheDb() {
  try {
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

  if (/timed out|request failed|failed|no stream|all stream candidates/i.test(message)) {
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

  const requested = decoded === "/" ? "/index.html" : decoded;
  const normalized = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const trimmed = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const filePath = join(ROOT_DIR, trimmed);

  if (!filePath.startsWith(ROOT_DIR)) {
    return null;
  }

  return filePath;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isPlaybackProxyUrl(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw.startsWith("/api/remux?")
    || raw.startsWith("/api/hls/master.m3u8?");
}

function parsePlaybackProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw, "http://localhost");
    if (url.pathname !== "/api/remux" && url.pathname !== "/api/hls/master.m3u8") {
      return null;
    }

    const input = decodeURIComponent(url.searchParams.get("input") || "").trim();
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

function buildRemuxProxyUrl(input, {
  audioStreamIndex = -1,
} = {}) {
  const normalizedInput = String(input || "").trim();
  if (!normalizedInput) {
    return "";
  }
  const existingMeta = parsePlaybackProxyUrl(normalizedInput);
  if (existingMeta?.mode === "remux" && existingMeta.input) {
    if (Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0) {
      const query = new URLSearchParams({
        input: existingMeta.input,
        audioStream: String(Math.floor(audioStreamIndex)),
      });
      return `/api/remux?${query.toString()}`;
    }
    return normalizedInput;
  }
  const query = new URLSearchParams({ input: existingMeta?.input || normalizedInput });
  if (Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0) {
    query.set("audioStream", String(Math.floor(audioStreamIndex)));
  }
  return `/api/remux?${query.toString()}`;
}

function buildHlsMasterUrl(input, {
  audioStreamIndex = -1,
  subtitleStreamIndex = -1,
} = {}) {
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
    return true;
  }

  if (shouldPreferSoftwareDecode(source)) {
    return true;
  }

  const normalizedFilename = String(filename || "").toLowerCase();
  return (
    normalizedFilename.endsWith(".mkv")
    || normalizedFilename.endsWith(".avi")
    || normalizedFilename.endsWith(".wmv")
    || normalizedFilename.endsWith(".ts")
    || normalizedFilename.endsWith(".m3u8")
  );
}

function shouldAttemptRemuxSource(source, filename = "") {
  const normalizedSource = String(source || "").toLowerCase();
  const normalizedFilename = String(filename || "").toLowerCase();
  const combined = `${normalizedSource} ${normalizedFilename}`;

  if (!combined.trim()) {
    return false;
  }

  if (combined.includes(".m3u8")) {
    return false;
  }

  return (
    combined.includes(".mkv")
    || combined.includes(".avi")
    || combined.includes(".wmv")
    || combined.includes(".mov")
    || combined.includes(".ts")
    || combined.includes(".m2ts")
    || combined.includes(".mpg")
    || combined.includes(".mpeg")
  );
}

function shouldWrapWithRemuxFallback(source) {
  const value = String(source || "").toLowerCase();
  if (!value || isPlaybackProxyUrl(value)) {
    return false;
  }

  // Wrapping transient RD stream MP4 URLs often leads to FFmpeg open-context hangs.
  if (value.includes("stream.real-debrid.com") && value.includes(".mp4")) {
    return false;
  }

  return true;
}

function resolveTranscodeInput(rawInput) {
  const input = String(rawInput || "").trim();
  if (!input) {
    throw new Error("Missing playback input.");
  }

  if (isHttpUrl(input)) {
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
  const raw = String(value || "").trim().toLowerCase();
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
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "auto") {
    return "";
  }
  if (raw === "off" || raw === "none" || raw === "disabled") {
    return "off";
  }
  return normalizeIsoLanguage(raw);
}

function normalizeAudioSyncMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const rounded = Math.round(parsed);
  return Math.max(0, Math.min(1500, rounded));
}

function buildMediaProbeCacheKey(source, { sourceHash = "", selectedFile = "" } = {}) {
  const normalizedHash = String(sourceHash || "").trim().toLowerCase();
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
    row = persistentCacheDb.query(`
      SELECT payload_json, updated_at
      FROM media_probe_cache
      WHERE probe_key = ?
    `).get(probeKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const updatedAt = Number(row.updated_at || 0);
  if (!updatedAt || updatedAt + MEDIA_PROBE_STALE_MS <= Date.now()) {
    try {
      persistentCacheDb.query("DELETE FROM media_probe_cache WHERE probe_key = ?").run(probeKey);
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
    persistentCacheDb.query(`
      INSERT INTO media_probe_cache (
        probe_key,
        payload_json,
        updated_at
      )
      VALUES (?, ?, ?)
      ON CONFLICT(probe_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(
      probeKey,
      JSON.stringify(payload),
      Date.now(),
    );
  } catch {
    // Ignore persistent cache write failures.
  }
}

async function runProcessAndCapture(command, {
  timeoutMs = 15000,
  binary = false,
} = {}) {
  const proc = Bun.spawn(command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // Ignore kill errors.
    }
  }, Math.max(1000, timeoutMs));

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      binary
        ? new Response(proc.stdout).arrayBuffer()
        : new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      const message = String(stderr || `Process exited with code ${exitCode}`).trim();
      throw new Error(message || "Process execution failed.");
    }

    return binary ? new Uint8Array(stdout) : String(stdout || "");
  } finally {
    clearTimeout(timer);
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
      return (first * 3600) + (second * 60) + third;
    }
    return (first * 60) + second;
  }

  const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?\b/);
  const minutesMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?\b/);
  if (hoursMatch || minutesMatch) {
    const hours = Number(hoursMatch?.[1] || 0);
    const minutes = Number(minutesMatch?.[1] || 0);
    return Math.round((hours * 3600) + (minutes * 60));
  }

  const compactMatch = text.match(/\b(\d{1,2})h(?:\s*|)(\d{1,2})m\b/);
  if (compactMatch) {
    const hours = Number(compactMatch[1] || 0);
    const minutes = Number(compactMatch[2] || 0);
    return (hours * 3600) + (minutes * 60);
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
  const durationSeconds = Number.isFinite(formatDuration) && formatDuration > 0
    ? Math.round(formatDuration)
    : 0;

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
    const tags = stream?.tags && typeof stream.tags === "object" ? stream.tags : {};
    const language = normalizeIsoLanguage(tags.language || tags.LANGUAGE || "");
    const title = String(tags.title || tags.handler_name || "").trim();
    const disposition = stream?.disposition && typeof stream.disposition === "object"
      ? stream.disposition
      : {};
    const isDefault = disposition.default === 1;
    const channels = Number(stream?.channels || 0) || 0;
    const parsedStartTime = Number(stream?.start_time);
    const startTimeSeconds = Number.isFinite(parsedStartTime) && parsedStartTime >= 0
      ? parsedStartTime
      : 0;

    if (codecType === "video" && !hasVideoStartTime) {
      videoStartTimeSeconds = startTimeSeconds;
      hasVideoStartTime = true;
      videoCodec = codec;
      const fps = parseFrameRateToFps(stream?.avg_frame_rate || stream?.r_frame_rate);
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
        label: title || `${(language || "und").toUpperCase()}${channels ? ` ${channels}ch` : ""}`.trim(),
      });
      return;
    }

    if (codecType === "subtitle") {
      const textCodecSet = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);
      subtitleTracks.push({
        streamIndex,
        language,
        title,
        codec,
        isDefault,
        isTextBased: textCodecSet.has(codec),
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
  const audioTracks = Array.isArray(probe?.audioTracks) ? probe.audioTracks : [];
  if (!audioTracks.length) {
    return null;
  }

  const normalizedPreferred = normalizePreferredAudioLang(preferredLang);
  if (normalizedPreferred !== "auto") {
    const exact = audioTracks.find((track) => track.language === normalizedPreferred);
    if (exact) {
      return exact;
    }
  }

  return audioTracks.find((track) => track.isDefault) || audioTracks[0];
}

function chooseSubtitleTrackFromProbe(probe, preferredSubtitleLang) {
  const subtitles = Array.isArray(probe?.subtitleTracks) ? probe.subtitleTracks : [];
  if (!subtitles.length) {
    return null;
  }

  const normalized = normalizeSubtitlePreference(preferredSubtitleLang);
  if (!normalized || normalized === "off") {
    return null;
  }

  const match = subtitles.find((track) => track.language === normalized && track.isTextBased);
  if (match) {
    return match;
  }

  return subtitles.find((track) => track.isDefault && track.isTextBased) || null;
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
    row = persistentCacheDb.query(`
      SELECT preferred_audio_lang, preferred_subtitle_lang, updated_at
      FROM title_track_preferences
      WHERE tmdb_id = ?
    `).get(normalizedTmdbId);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const updatedAt = Number(row.updated_at || 0);
  if (!updatedAt || updatedAt + TITLE_PREFERENCES_STALE_MS <= Date.now()) {
    try {
      persistentCacheDb.query("DELETE FROM title_track_preferences WHERE tmdb_id = ?").run(normalizedTmdbId);
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

function persistTitleTrackPreference(tmdbId, {
  audioLang = "",
  subtitleLang = "",
} = {}) {
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
    persistentCacheDb.query(`
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
    `).run(
      normalizedTmdbId,
      normalizedAudioLang === "auto" ? "" : normalizedAudioLang,
      normalizedSubtitleLang,
      Date.now(),
    );
    if (normalizedAudioLang && normalizedAudioLang !== "auto") {
      Object.keys(STREAM_QUALITY_TARGETS).forEach((quality) => {
        deletePersistedPlaybackSession(buildPlaybackSessionKey(normalizedTmdbId, "auto", quality));
      });
    }
  } catch {
    // Ignore persistent cache write failures.
  }
}

function getPersistedSourceHealthStats(sourceKey) {
  if (!persistentCacheDb) {
    return null;
  }

  const normalizedKey = String(sourceKey || "").trim().toLowerCase();
  if (!normalizedKey) {
    return null;
  }

  let row = null;
  try {
    row = persistentCacheDb.query(`
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
    `).get(normalizedKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const updatedAt = Number(row.updated_at || 0);
  if (!updatedAt || updatedAt + SOURCE_HEALTH_STALE_MS <= Date.now()) {
    try {
      persistentCacheDb.query("DELETE FROM source_health_stats WHERE source_key = ?").run(normalizedKey);
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

  const normalizedKey = String(sourceKey || "").trim().toLowerCase();
  if (!normalizedKey) {
    return;
  }

  const normalizedEventType = String(eventType || "").trim().toLowerCase();
  const isSuccess = normalizedEventType === "success";
  const isDecodeFailure = normalizedEventType === "decode_failure";
  const isEndedEarly = normalizedEventType === "ended_early";
  const isPlaybackError = normalizedEventType === "playback_error";
  const isFailure = isDecodeFailure || isEndedEarly || isPlaybackError;
  if (!isSuccess && !isFailure) {
    return;
  }

  try {
    persistentCacheDb.query(`
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
    `).run(
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

function buildHlsSegmentCacheKey(sourceInput, audioStreamIndex, segmentIndex) {
  return `${sourceInput}|a:${Number.isFinite(audioStreamIndex) ? audioStreamIndex : -1}|i:${segmentIndex}`;
}

function buildHlsSegmentCachePath(segmentKey) {
  return join(HLS_CACHE_DIR, `${hashStableString(segmentKey)}.ts`);
}

function buildSubtitleCachePath(sourceInput, subtitleStreamIndex) {
  return join(HLS_CACHE_DIR, `${hashStableString(`${sourceInput}|s:${subtitleStreamIndex}`)}.vtt`);
}

async function ensureHlsCacheDirectory() {
  try {
    await mkdir(HLS_CACHE_DIR, { recursive: true });
  } catch {
    // Ignore directory errors; later writes may still fail explicitly.
  }
}

async function getOrCreateHlsSegment(sourceInput, segmentIndex, audioStreamIndex = -1) {
  const safeSegmentIndex = Math.max(0, Math.floor(segmentIndex));
  const safeAudioStreamIndex = Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0
    ? Math.floor(audioStreamIndex)
    : -1;

  const cacheKey = buildHlsSegmentCacheKey(sourceInput, safeAudioStreamIndex, safeSegmentIndex);
  const segmentPath = buildHlsSegmentCachePath(cacheKey);

  try {
    const segmentStat = await stat(segmentPath);
    if (segmentStat.isFile() && (Date.now() - segmentStat.mtimeMs) < HLS_SEGMENT_STALE_MS) {
      return segmentPath;
    }
  } catch {
    // Build segment on cache miss.
  }

  const existingBuild = hlsSegmentBuilds.get(cacheKey);
  if (existingBuild) {
    return existingBuild;
  }

  const buildTask = (async () => {
    await ensureHlsCacheDirectory();
    const segmentStartSeconds = safeSegmentIndex * HLS_SEGMENT_DURATION_SECONDS;
    const ffmpegArgs = [
      "ffmpeg",
      "-v",
      "error",
      "-ss",
      String(segmentStartSeconds),
      "-i",
      sourceInput,
      "-t",
      String(HLS_SEGMENT_DURATION_SECONDS),
      "-map",
      "0:v:0",
      "-map",
      safeAudioStreamIndex >= 0 ? `0:${safeAudioStreamIndex}?` : "0:a:0?",
      "-sn",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-f",
      "mpegts",
      "pipe:1",
    ];

    const segmentBytes = await runProcessAndCapture(ffmpegArgs, {
      timeoutMs: 20000,
      binary: true,
    });
    if (!segmentBytes?.length) {
      throw new Error("FFmpeg produced an empty HLS segment.");
    }

    await Bun.write(segmentPath, segmentBytes);
    return segmentPath;
  })()
    .finally(() => {
      hlsSegmentBuilds.delete(cacheKey);
    });

  hlsSegmentBuilds.set(cacheKey, buildTask);
  return buildTask;
}

async function createHlsPlaylistResponse(input, audioStreamIndex = -1) {
  const sourceInput = resolveTranscodeInput(input);
  const probe = await probeMediaTracks(sourceInput);
  const mediaDurationSeconds = Math.max(1, Number(probe?.durationSeconds || 0) || 0);
  const segmentCount = Math.max(1, Math.ceil(mediaDurationSeconds / HLS_SEGMENT_DURATION_SECONDS));
  const safeAudioStream = Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0
    ? Math.floor(audioStreamIndex)
    : -1;

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${HLS_SEGMENT_DURATION_SECONDS}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
  ];

  for (let index = 0; index < segmentCount; index += 1) {
    const remaining = mediaDurationSeconds - (index * HLS_SEGMENT_DURATION_SECONDS);
    const segmentDuration = Math.max(0.5, Math.min(HLS_SEGMENT_DURATION_SECONDS, remaining));
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
  const segmentPath = await getOrCreateHlsSegment(sourceInput, segmentIndex, audioStreamIndex);
  const segmentFile = Bun.file(segmentPath);
  return new Response(segmentFile, {
    status: 200,
    headers: {
      "Content-Type": "video/mp2t",
      "Cache-Control": "public, max-age=60",
    },
  });
}

async function createSubtitleVttResponse(input, subtitleStreamIndex) {
  const sourceInput = resolveTranscodeInput(input);
  const safeStreamIndex = Number.isFinite(subtitleStreamIndex) && subtitleStreamIndex >= 0
    ? Math.floor(subtitleStreamIndex)
    : -1;
  if (safeStreamIndex < 0) {
    throw new Error("Missing or invalid subtitle stream index.");
  }

  await ensureHlsCacheDirectory();
  const subtitlePath = buildSubtitleCachePath(sourceInput, safeStreamIndex);

  try {
    const subtitleStat = await stat(subtitlePath);
    if (subtitleStat.isFile() && (Date.now() - subtitleStat.mtimeMs) < HLS_SEGMENT_STALE_MS) {
      return new Response(Bun.file(subtitlePath), {
        status: 200,
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Cache-Control": "public, max-age=120",
        },
      });
    }
  } catch {
    // Build subtitle file when cache is absent.
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
      { timeoutMs: 25000, binary: false },
    );
  };

  let subtitleText = "";
  try {
    subtitleText = await tryExtractSubtitle(`0:${safeStreamIndex}?`);
  } catch {
    try {
      const probe = await probeMediaTracks(sourceInput);
      const subtitleTracks = Array.isArray(probe?.subtitleTracks) ? probe.subtitleTracks : [];
      const subtitleOrdinal = subtitleTracks.findIndex((track) => Number(track?.streamIndex) === safeStreamIndex);
      if (subtitleOrdinal >= 0) {
        subtitleText = await tryExtractSubtitle(`0:s:${subtitleOrdinal}`);
      }
    } catch {
      subtitleText = "";
    }
  }

  if (!String(subtitleText || "").trim()) {
    return new Response("WEBVTT\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=30",
      },
    });
  }

  await Bun.write(subtitlePath, subtitleText);
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
  manualAudioSyncMs = 0,
) {
  const source = resolveTranscodeInput(input);
  const safeStartSeconds = Number.isFinite(startSeconds) && startSeconds > 0
    ? Math.floor(startSeconds)
    : 0;
  const safeAudioStreamIndex = Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0
    ? Math.floor(audioStreamIndex)
    : -1;
  const safeManualAudioSyncMs = normalizeAudioSyncMs(manualAudioSyncMs);
  let audioDelayMs = 0;
  try {
    const probe = await probeMediaTracks(source);
    const videoStart = Number(probe?.videoStartTimeSeconds || 0);
    const videoBFrameLead = Number(probe?.videoBFrameLeadSeconds || 0);
    const videoFrameRateFps = Number(probe?.videoFrameRateFps || 0);
    const videoBFrames = Number(probe?.videoBFrames || 0);
    const videoCodec = String(probe?.videoCodec || "").toLowerCase();
    const audioTracks = Array.isArray(probe?.audioTracks) ? probe.audioTracks : [];
    const selectedAudioTrack = audioTracks.find((track) => Number(track?.streamIndex) === safeAudioStreamIndex)
      || audioTracks[0]
      || null;
    const audioStart = Number(selectedAudioTrack?.startTimeSeconds || 0);
    const timestampOffsetSeconds = videoStart - audioStart;
    let offsetSeconds = Math.max(timestampOffsetSeconds, videoBFrameLead);
    if (videoBFrames > 0 && videoFrameRateFps > 0) {
      const safetyOffset = (videoBFrames + 1) / videoFrameRateFps;
      offsetSeconds = Math.max(offsetSeconds, safetyOffset);
    }
    if (Number.isFinite(offsetSeconds) && offsetSeconds > 0.01 && offsetSeconds < 1.5) {
      audioDelayMs = Math.round((offsetSeconds + 0.22) * 1000);
    }
  } catch {
    audioDelayMs = 0;
  }
  audioDelayMs = Math.max(0, Math.min(2500, audioDelayMs + safeManualAudioSyncMs));

  const ffmpegArgs = [
    "ffmpeg",
    "-v",
    "error",
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
    "-sn",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "frag_keyframe+empty_moov+faststart",
    "-f",
    "mp4",
    "pipe:1",
  ];
  if (audioDelayMs > 0) {
    proxyArgs.splice(9, 0, "-af", `adelay=${audioDelayMs}:all=1`);
  }

  const ffmpeg = Bun.spawn(
    [
      ...ffmpegArgs,
      ...proxyArgs,
    ],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );

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
      "X-Audio-Delay-Ms": String(audioDelayMs),
      "X-Manual-Audio-Sync-Ms": String(safeManualAudioSyncMs),
    },
  });
}

async function createRemuxResponse(
  input,
  request,
  startSeconds = 0,
  audioStreamIndex = -1,
  manualAudioSyncMs = 0,
) {
  return createFfmpegProxyResponse(
    input,
    request,
    startSeconds,
    audioStreamIndex,
    manualAudioSyncMs,
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
        end = Number.isFinite(end) ? Math.min(size - 1, Math.floor(end)) : size - 1;
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
      const message = payload?.error || payload?.message || `Request failed (${response.status})`;
      throw new Error(message);
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError" || error?.message === "Request timed out.") {
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

  const payload = await requestJson(`${TMDB_BASE_URL}${path}?${query.toString()}`, {}, timeoutMs);
  setCachedTmdbResponse(cacheKey, payload, getTmdbCacheTtlMs(path));
  return cloneTmdbResponsePayload(payload);
}

async function rdFetch(path, { method = "GET", form = null, timeoutMs = 20000 } = {}) {
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

function normalizePreferredAudioLang(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized in AUDIO_LANGUAGE_TOKENS) return normalized;
  return "auto";
}

function normalizePreferredStreamQuality(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized === "4k" || normalized === "uhd" || normalized === "2160") return "2160p";
  if (normalized === "1080") return "1080p";
  if (normalized === "720") return "720p";
  return normalized in STREAM_QUALITY_TARGETS ? normalized : "auto";
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
  const targetRuntimeSeconds = Math.max(0, Number(metadata.runtimeSeconds || 0) || 0);
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

  const deltaRatio = Math.abs(candidateRuntimeSeconds - targetRuntimeSeconds) / targetRuntimeSeconds;
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

function filterStreamsByQualityPreference(streams = [], preferredQuality = "auto") {
  const normalizedQuality = normalizePreferredStreamQuality(preferredQuality);
  if (normalizedQuality === "auto") {
    return streams;
  }

  const targetHeight = STREAM_QUALITY_TARGETS[normalizedQuality] || 0;
  if (!targetHeight) {
    return streams;
  }

  const exactMatches = streams.filter((stream) => parseStreamVerticalResolution(stream) === targetHeight);
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

  const higherMatches = streams.filter((stream) => parseStreamVerticalResolution(stream) > targetHeight);
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

function scoreStreamQuality(stream, metadata = {}, preferredAudioLang = "auto", preferredQuality = "auto") {
  const infoHash = String(stream?.infoHash || "").trim().toLowerCase();
  return (
    scoreStreamLanguagePreference(stream, preferredAudioLang)
    + scoreStreamQualityPreference(stream, preferredQuality)
    + scoreStreamTitleYearMatch(stream, metadata)
    + scoreStreamRuntimeMatch(stream, metadata)
    + scoreStreamSeeders(stream)
    + computeSourceHealthScore(infoHash)
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
  const yearMatchesInFilename = normalizedFilename.match(/\b(?:19|20)\d{2}\b/g) || [];
  const hasExpectedYear = expectedYear && yearMatchesInFilename.includes(expectedYear);
  const hasConflictingYear = Boolean(
    expectedYear
    && yearMatchesInFilename.length
    && !hasExpectedYear,
  );

  const matchedTokenCount = titleTokens.reduce((count, token) => {
    return count + (normalizedFilename.includes(token) ? 1 : 0);
  }, 0);
  const requiredTokenMatches = titleTokens.length === 1 ? 1 : Math.min(2, titleTokens.length);

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
  const infoHash = String(stream?.infoHash || "").trim().toLowerCase();
  if (!infoHash) {
    throw new Error("Missing torrent info hash.");
  }

  const sourceTrackers = Array.isArray(stream?.sources)
    ? stream.sources
      .filter((source) => typeof source === "string" && source.startsWith("tracker:"))
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

function pickVideoFileIds(files, preferredFilename) {
  const list = Array.isArray(files) ? files.filter((file) => Number.isInteger(file?.id)) : [];
  if (!list.length) {
    return [];
  }

  const videoFiles = list.filter((file) => VIDEO_FILE_REGEX.test(String(file.path || "")));
  if (!videoFiles.length) {
    const largestAny = list.reduce((largest, file) => {
      if (!largest) return file;
      return Number(file.bytes || 0) > Number(largest.bytes || 0) ? file : largest;
    }, null);

    return largestAny ? [largestAny.id] : [];
  }

  const preferredNeedle = String(preferredFilename || "").trim().toLowerCase();
  if (preferredNeedle) {
    const preferredFile = videoFiles.find((file) => String(file.path || "").toLowerCase().includes(preferredNeedle));
    if (preferredFile) {
      return [preferredFile.id];
    }
  }

  const largestVideo = videoFiles.reduce((largest, file) => {
    if (!largest) return file;
    return Number(file.bytes || 0) > Number(largest.bytes || 0) ? file : largest;
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

    if (status === "downloaded" && Array.isArray(info?.links) && info.links.length) {
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
      const unavailableError = new Error(`Resolved stream is unavailable (${response.status}).`);
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

function normalizeResolvedSourceForSoftwareDecode(source, {
  audioStreamIndex = -1,
  subtitleStreamIndex = -1,
} = {}) {
  const normalized = cloneResolvedSource(source);
  const currentPlayable = String(normalized.playableUrl || "").trim();
  if (!currentPlayable) {
    return normalized;
  }

  if (!shouldPreferSoftwareDecodeSource(currentPlayable, normalized.filename)) {
    return normalized;
  }

  const proxyMeta = isPlaybackProxyUrl(currentPlayable)
    ? parsePlaybackProxyUrl(currentPlayable)
    : null;
  const sourceInput = proxyMeta?.input || currentPlayable;
  const existingFallbacks = Array.isArray(normalized.fallbackUrls) ? [...normalized.fallbackUrls] : [];
  const preferredRemux = buildRemuxProxyUrl(sourceInput, {
    audioStreamIndex,
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
  const infoHash = String(stream?.infoHash || "").trim().toLowerCase();
  const filenameHint = String(stream?.behaviorHints?.filename || "").trim().toLowerCase();
  if (!infoHash) {
    return "";
  }
  return `${infoHash}:${filenameHint}`;
}

function cloneResolvedSource(source) {
  return {
    playableUrl: String(source?.playableUrl || ""),
    fallbackUrls: Array.isArray(source?.fallbackUrls) ? [...source.fallbackUrls] : [],
    filename: String(source?.filename || ""),
    sourceHash: String(source?.sourceHash || ""),
    selectedFile: String(source?.selectedFile || ""),
  };
}

function cloneResolvedMovieResult(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    playableUrl: String(value.playableUrl || ""),
    fallbackUrls: Array.isArray(value.fallbackUrls) ? [...value.fallbackUrls] : [],
    filename: String(value.filename || ""),
    sourceHash: String(value.sourceHash || ""),
    selectedFile: String(value.selectedFile || ""),
    sourceInput: String(value.sourceInput || ""),
    selectedAudioStreamIndex: Number.isFinite(Number(value.selectedAudioStreamIndex))
      ? Math.max(-1, Math.floor(Number(value.selectedAudioStreamIndex)))
      : -1,
    selectedSubtitleStreamIndex: Number.isFinite(Number(value.selectedSubtitleStreamIndex))
      ? Math.max(-1, Math.floor(Number(value.selectedSubtitleStreamIndex)))
      : -1,
    metadata: value.metadata && typeof value.metadata === "object"
      ? {
        tmdbId: String(value.metadata.tmdbId || ""),
        imdbId: String(value.metadata.imdbId || ""),
        displayTitle: String(value.metadata.displayTitle || ""),
        displayYear: String(value.metadata.displayYear || ""),
        runtimeSeconds: Number(value.metadata.runtimeSeconds || 0) || 0,
      }
      : {},
    tracks: value.tracks && typeof value.tracks === "object"
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
    preferences: value.preferences && typeof value.preferences === "object"
      ? {
        audioLang: normalizePreferredAudioLang(value.preferences.audioLang),
        subtitleLang: normalizeSubtitlePreference(value.preferences.subtitleLang),
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
    const row = persistentCacheDb.query("SELECT COUNT(*) AS count FROM resolved_stream_cache").get();
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
    const row = persistentCacheDb.query("SELECT COUNT(*) AS count FROM movie_quick_start_cache").get();
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
    const row = persistentCacheDb.query("SELECT COUNT(*) AS count FROM tmdb_response_cache").get();
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
    const row = persistentCacheDb.query("SELECT COUNT(*) AS count FROM playback_sessions").get();
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
    const row = persistentCacheDb.query("SELECT COUNT(*) AS count FROM source_health_stats").get();
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
    const row = persistentCacheDb.query("SELECT COUNT(*) AS count FROM media_probe_cache").get();
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
    const row = persistentCacheDb.query("SELECT COUNT(*) AS count FROM title_track_preferences").get();
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
    persistentCacheDb.query(`
      DELETE FROM resolved_stream_cache
      WHERE rowid IN (
        SELECT rowid
        FROM resolved_stream_cache
        ORDER BY updated_at ASC
        LIMIT ?
      )
    `).run(overflow);
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
    persistentCacheDb.query(`
      DELETE FROM movie_quick_start_cache
      WHERE rowid IN (
        SELECT rowid
        FROM movie_quick_start_cache
        ORDER BY updated_at ASC
        LIMIT ?
      )
    `).run(overflow);
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
    persistentCacheDb.query(`
      DELETE FROM tmdb_response_cache
      WHERE rowid IN (
        SELECT rowid
        FROM tmdb_response_cache
        ORDER BY updated_at ASC
        LIMIT ?
      )
    `).run(overflow);
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
    persistentCacheDb.query(`
      DELETE FROM playback_sessions
      WHERE rowid IN (
        SELECT rowid
        FROM playback_sessions
        ORDER BY updated_at ASC
        LIMIT ?
      )
    `).run(overflow);
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
    persistentCacheDb.query("DELETE FROM resolved_stream_cache WHERE expires_at <= ?").run(now);
    persistentCacheDb.query("DELETE FROM movie_quick_start_cache WHERE expires_at <= ?").run(now);
    persistentCacheDb.query("DELETE FROM tmdb_response_cache WHERE expires_at <= ?").run(now);
    persistentCacheDb.query("DELETE FROM playback_sessions WHERE last_accessed_at <= ?").run(staleThreshold);
    persistentCacheDb.query("DELETE FROM source_health_stats WHERE updated_at <= ?").run(now - SOURCE_HEALTH_STALE_MS);
    persistentCacheDb.query("DELETE FROM media_probe_cache WHERE updated_at <= ?").run(now - MEDIA_PROBE_STALE_MS);
    persistentCacheDb.query("DELETE FROM title_track_preferences WHERE updated_at <= ?").run(now - TITLE_PREFERENCES_STALE_MS);
    trimPersistentResolvedStreamEntries(RESOLVED_STREAM_PERSIST_MAX_ENTRIES);
    trimPersistentMovieQuickStartEntries(MOVIE_QUICK_START_PERSIST_MAX_ENTRIES);
    trimPersistentTmdbResponseEntries(TMDB_RESPONSE_PERSIST_MAX_ENTRIES);
    trimPersistentPlaybackSessionEntries(PLAYBACK_SESSION_PERSIST_MAX_ENTRIES);
  } catch {
    // Ignore persistent cache prune failures.
  }
}

function clearPersistentCaches() {
  if (!persistentCacheDb) {
    return;
  }

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

  void rm(HLS_CACHE_DIR, { recursive: true, force: true }).catch(() => {
    // Ignore HLS cache cleanup failures.
  });
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
    const stale = candidates.filter((item) => now - item.mtimeMs > HLS_SEGMENT_STALE_MS);
    await Promise.all(stale.map(async (item) => {
      try {
        await rm(item.path, { force: true });
      } catch {
        // Ignore individual file cleanup errors.
      }
    }));

    const remaining = candidates
      .filter((item) => now - item.mtimeMs <= HLS_SEGMENT_STALE_MS)
      .sort((left, right) => left.mtimeMs - right.mtimeMs);

    const overflow = remaining.length - HLS_SEGMENT_MAX_FILES;
    if (overflow > 0) {
      const toDelete = remaining.slice(0, overflow);
      await Promise.all(toDelete.map(async (item) => {
        try {
          await rm(item.path, { force: true });
        } catch {
          // Ignore individual file cleanup errors.
        }
      }));
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
    row = persistentCacheDb.query(`
      SELECT payload_json, expires_at, is_ephemeral, next_validation_at
      FROM resolved_stream_cache
      WHERE cache_key = ?
    `).get(cacheKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const expiresAt = Number(row.expires_at || 0);
  if (expiresAt <= Date.now()) {
    try {
      persistentCacheDb.query("DELETE FROM resolved_stream_cache WHERE cache_key = ?").run(cacheKey);
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
      persistentCacheDb.query("DELETE FROM resolved_stream_cache WHERE cache_key = ?").run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  const value = cloneResolvedSource(parsed);
  if (!value.playableUrl) {
    try {
      persistentCacheDb.query("DELETE FROM resolved_stream_cache WHERE cache_key = ?").run(cacheKey);
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
    persistentCacheDb.query(`
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
    `).run(
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
    persistentCacheDb.query("DELETE FROM resolved_stream_cache WHERE cache_key = ?").run(cacheKey);
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
    row = persistentCacheDb.query(`
      SELECT payload_json, expires_at
      FROM movie_quick_start_cache
      WHERE cache_key = ?
    `).get(cacheKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const expiresAt = Number(row.expires_at || 0);
  if (expiresAt <= Date.now()) {
    try {
      persistentCacheDb.query("DELETE FROM movie_quick_start_cache WHERE cache_key = ?").run(cacheKey);
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
      persistentCacheDb.query("DELETE FROM movie_quick_start_cache WHERE cache_key = ?").run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  const value = cloneResolvedMovieResult(parsed);
  if (!value?.playableUrl) {
    try {
      persistentCacheDb.query("DELETE FROM movie_quick_start_cache WHERE cache_key = ?").run(cacheKey);
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
    persistentCacheDb.query(`
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
    `).run(
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
    persistentCacheDb.query("DELETE FROM movie_quick_start_cache WHERE cache_key = ?").run(cacheKey);
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
    row = persistentCacheDb.query(`
      SELECT payload_json, expires_at
      FROM tmdb_response_cache
      WHERE cache_key = ?
    `).get(cacheKey);
  } catch {
    return null;
  }

  if (!row) {
    return null;
  }

  const expiresAt = Number(row.expires_at || 0);
  if (expiresAt <= Date.now()) {
    try {
      persistentCacheDb.query("DELETE FROM tmdb_response_cache WHERE cache_key = ?").run(cacheKey);
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
      persistentCacheDb.query("DELETE FROM tmdb_response_cache WHERE cache_key = ?").run(cacheKey);
    } catch {
      // Ignore delete failures.
    }
    return null;
  }

  const payload = cloneTmdbResponsePayload(parsed);
  if (payload === null) {
    try {
      persistentCacheDb.query("DELETE FROM tmdb_response_cache WHERE cache_key = ?").run(cacheKey);
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
    persistentCacheDb.query(`
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
    `).run(
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
    persistentCacheDb.query("DELETE FROM tmdb_response_cache WHERE cache_key = ?").run(cacheKey);
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
  trimCacheEntries(tmdbResponseCache, TMDB_RESPONSE_CACHE_MAX_ENTRIES);
  trimCacheEntries(movieQuickStartCache, MOVIE_QUICK_START_CACHE_MAX_ENTRIES);
  trimCacheEntries(resolvedStreamCache, RESOLVED_STREAM_CACHE_MAX_ENTRIES);
  trimCacheEntries(rdTorrentLookupCache, RD_TORRENT_LOOKUP_CACHE_MAX_ENTRIES);
  prunePersistentCaches();
  void pruneHlsCacheFiles();
}

function getCacheDebugStats() {
  const tmdbRequests = cacheStats.tmdbHits + cacheStats.tmdbMisses;
  const playbackSessionRequests = cacheStats.playbackSessionHits + cacheStats.playbackSessionMisses;
  const movieQuickStartRequests = cacheStats.movieQuickStartHits + cacheStats.movieQuickStartMisses;
  const resolvedRequests = cacheStats.resolvedStreamHits + cacheStats.resolvedStreamMisses;
  const rdLookupRequests = cacheStats.rdLookupHits + cacheStats.rdLookupMisses;
  const dedupRequests = cacheStats.movieResolveDedupHits + cacheStats.movieResolveDedupMisses;

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
    },
    stats: {
      tmdbResponse: {
        hits: cacheStats.tmdbHits,
        misses: cacheStats.tmdbMisses,
        expired: cacheStats.tmdbExpired,
        hitRate: tmdbRequests > 0 ? Number((cacheStats.tmdbHits / tmdbRequests).toFixed(3)) : 0,
      },
      playbackSession: {
        hits: cacheStats.playbackSessionHits,
        misses: cacheStats.playbackSessionMisses,
        invalidated: cacheStats.playbackSessionInvalidated,
        hitRate: playbackSessionRequests > 0
          ? Number((cacheStats.playbackSessionHits / playbackSessionRequests).toFixed(3))
          : 0,
      },
      movieQuickStart: {
        hits: cacheStats.movieQuickStartHits,
        misses: cacheStats.movieQuickStartMisses,
        expired: cacheStats.movieQuickStartExpired,
        hitRate: movieQuickStartRequests > 0 ? Number((cacheStats.movieQuickStartHits / movieQuickStartRequests).toFixed(3)) : 0,
      },
      resolvedStream: {
        hits: cacheStats.resolvedStreamHits,
        misses: cacheStats.resolvedStreamMisses,
        expired: cacheStats.resolvedStreamExpired,
        invalidated: cacheStats.resolvedStreamInvalidated,
        hitRate: resolvedRequests > 0 ? Number((cacheStats.resolvedStreamHits / resolvedRequests).toFixed(3)) : 0,
      },
      rdLookup: {
        hits: cacheStats.rdLookupHits,
        misses: cacheStats.rdLookupMisses,
        expired: cacheStats.rdLookupExpired,
        apiPagesScanned: cacheStats.rdLookupApiPagesScanned,
        hitRate: rdLookupRequests > 0 ? Number((cacheStats.rdLookupHits / rdLookupRequests).toFixed(3)) : 0,
      },
      movieResolveDedup: {
        hits: cacheStats.movieResolveDedupHits,
        misses: cacheStats.movieResolveDedupMisses,
        hitRate: dedupRequests > 0 ? Number((cacheStats.movieResolveDedupHits / dedupRequests).toFixed(3)) : 0,
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
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .map(([key, value]) => [String(key), String(value)]);

  entries.sort(([left], [right]) => left.localeCompare(right));
  const query = new URLSearchParams(entries);
  return `${normalizedPath}?${query.toString()}`;
}

function getTmdbCacheTtlMs(path) {
  const normalizedPath = String(path || "").trim().toLowerCase();
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

function setCachedTmdbResponse(cacheKey, value, ttlMs = TMDB_RESPONSE_CACHE_TTL_DEFAULT_MS) {
  if (!cacheKey) {
    return;
  }

  const payload = cloneTmdbResponsePayload(value);
  if (payload === null) {
    return;
  }

  const expiresAt = Date.now() + Math.max(1000, Number(ttlMs) || TMDB_RESPONSE_CACHE_TTL_DEFAULT_MS);
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

    cached.nextValidationAt = Date.now() + RESOLVED_STREAM_CACHE_EPHEMERAL_REVALIDATE_MS;
    setPersistedResolvedStreamEntry(cacheKey, cached);
  }

  const normalizedResolved = normalizeResolvedSourceForSoftwareDecode(cached.value);
  if (
    normalizedResolved.playableUrl !== cached.value.playableUrl
    || JSON.stringify(normalizedResolved.fallbackUrls) !== JSON.stringify(cached.value.fallbackUrls)
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
      trimCacheEntries(movieQuickStartCache, MOVIE_QUICK_START_CACHE_MAX_ENTRIES);
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
  const expectedTmdbId = separatorIndex > 0 ? String(cacheKey).slice(0, separatorIndex).trim() : "";
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

  const normalizedPlayable = normalizeResolvedSourceForSoftwareDecode(cached.value, {
    audioStreamIndex: cached?.value?.selectedAudioStreamIndex,
    subtitleStreamIndex: cached?.value?.selectedSubtitleStreamIndex,
  });
  if (
    normalizedPlayable.playableUrl !== cached.value.playableUrl
    || JSON.stringify(normalizedPlayable.fallbackUrls) !== JSON.stringify(cached.value.fallbackUrls)
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

  const autoKey = buildMovieResolveKey(parsedKey.tmdbId, "auto", parsedKey.quality);
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
  const allUrls = [
    normalizedValue.playableUrl,
    ...(Array.isArray(normalizedValue.fallbackUrls) ? normalizedValue.fallbackUrls : []),
  ];
  const isEphemeral = allUrls.some(isLikelyEphemeralResolvedUrl);
  const now = Date.now();
  const ttlMs = isEphemeral ? RESOLVED_STREAM_CACHE_EPHEMERAL_TTL_MS : RESOLVED_STREAM_CACHE_TTL_MS;

  const entry = {
    expiresAt: now + ttlMs,
    isEphemeral,
    nextValidationAt: isEphemeral ? now + RESOLVED_STREAM_CACHE_EPHEMERAL_REVALIDATE_MS : Number.POSITIVE_INFINITY,
    value: normalizedValue,
  };

  resolvedStreamCache.set(cacheKey, entry);
  trimCacheEntries(resolvedStreamCache, RESOLVED_STREAM_CACHE_MAX_ENTRIES);
  setPersistedResolvedStreamEntry(cacheKey, entry);
}

function getCachedRdTorrentLookup(infoHash) {
  const normalizedHash = String(infoHash || "").trim().toLowerCase();
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
  const normalizedHash = String(infoHash || "").trim().toLowerCase();
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
  const normalizedHash = String(infoHash || "").trim().toLowerCase();
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

    const found = list.find((item) => String(item?.hash || "").trim().toLowerCase() === normalizedHash) || null;
    if (found) {
      setCachedRdTorrentLookup(normalizedHash, found);
      return found;
    }
  }

  setCachedRdTorrentLookup(normalizedHash, null);
  return null;
}

function buildMovieResolveKey(tmdbMovieId, preferredAudioLang, preferredQuality = "auto") {
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
  const preferredFromStorage = normalizePreferredAudioLang(preference?.audioLang || "");
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

function invalidateMovieResolveCacheForSession(tmdbMovieId, preferredAudioLang, preferredQuality = "auto", { includeAutoSibling = false } = {}) {
  const normalizedTmdbId = String(tmdbMovieId || "").trim();
  if (!normalizedTmdbId) {
    return;
  }

  const normalizedLang = normalizePreferredAudioLang(preferredAudioLang);
  const normalizedQuality = normalizePreferredStreamQuality(preferredQuality);
  deleteMovieQuickStartCacheEntry(buildMovieResolveKey(normalizedTmdbId, normalizedLang, normalizedQuality));

  if (!includeAutoSibling || normalizedLang === "auto") {
    return;
  }

  deleteMovieQuickStartCacheEntry(buildMovieResolveKey(normalizedTmdbId, "auto", normalizedQuality));
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
    persistentCacheDb.query("DELETE FROM movie_quick_start_cache WHERE cache_key LIKE ?").run(`${prefix}%`);
  } catch {
    // Ignore persistent cache delete failures.
  }
}

function normalizeSessionHealthState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }

  if (normalized === "healthy" || normalized === "degraded" || normalized === "invalid") {
    return normalized;
  }

  return "unknown";
}

function buildPlaybackSessionKey(tmdbMovieId, preferredAudioLang, preferredQuality = "auto") {
  return buildMovieResolveKey(tmdbMovieId, preferredAudioLang, preferredQuality);
}

function parseJsonArrayField(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter(Boolean).map((item) => String(item)) : [];
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
    quality: normalizePreferredStreamQuality(session.preferredQuality || "auto"),
    lastPositionSeconds: session.lastPositionSeconds,
    health: {
      state: session.healthState,
      failCount: session.healthFailCount,
      lastError: session.lastError,
    },
  };
}

function attachPlaybackSessionToResolvedMovie(result, tmdbMovieId, preferredAudioLang, preferredQuality = "auto") {
  const cloned = cloneResolvedMovieResult(result);
  if (!cloned) {
    return null;
  }

  const normalizedTmdbId = String(tmdbMovieId || cloned.metadata?.tmdbId || "").trim();
  const normalizedQuality = normalizePreferredStreamQuality(preferredQuality);
  const sessionKey = normalizedTmdbId
    ? buildPlaybackSessionKey(normalizedTmdbId, preferredAudioLang, normalizedQuality)
    : "";

  const session = normalizedTmdbId ? getPersistedPlaybackSession(sessionKey) : null;
  const validSession = session && session.tmdbId === normalizedTmdbId ? session : null;

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
    row = persistentCacheDb.query(`
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
    `).get(sessionKey);
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
    preferredQuality: normalizePreferredStreamQuality(parsedSessionKey?.quality || "auto"),
    sourceHash: String(row.source_hash || "").trim().toLowerCase(),
    selectedFile: String(row.selected_file || ""),
    filename: String(row.filename || ""),
    playableUrl: String(row.playable_url || ""),
    fallbackUrls,
    metadata: {
      ...metadata,
      tmdbId: String(metadata?.tmdbId || row.tmdb_id || ""),
    },
    lastPositionSeconds: Math.max(0, Number(row.last_position_seconds || 0) || 0),
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
    row = persistentCacheDb.query(`
      SELECT session_key
      FROM playback_sessions
      WHERE tmdb_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(normalizedTmdbId);
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
    persistentCacheDb.query("DELETE FROM playback_sessions WHERE session_key = ?").run(sessionKey);
  } catch {
    // Ignore persistent cache delete failures.
  }
}

function persistPlaybackSession(sessionKey, resolvedValue, context = {}) {
  if (!persistentCacheDb || !sessionKey || !resolvedValue?.playableUrl) {
    return;
  }

  const metadata = cloneResolvedMovieResult({ ...resolvedValue, metadata: resolvedValue.metadata || {} })?.metadata || {};
  const tmdbId = String(context.tmdbId || metadata.tmdbId || "").trim();
  if (!tmdbId) {
    return;
  }

  const audioLang = normalizePreferredAudioLang(context.preferredAudioLang);
  const preferredQuality = normalizePreferredStreamQuality(context.preferredQuality);
  const sourceHash = String(resolvedValue.sourceHash || "").trim().toLowerCase();
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
    persistedPosition = Math.max(0, Number(existingSession.lastPositionSeconds || 0) || 0);
  }

  const autoSessionKey = audioLang !== "auto"
    ? buildPlaybackSessionKey(tmdbId, "auto", preferredQuality)
    : "";
  if (!persistedPosition && autoSessionKey && autoSessionKey !== sessionKey) {
    const autoSession = getPersistedPlaybackSession(autoSessionKey);
    if (autoSession?.tmdbId === tmdbId) {
      persistedPosition = Math.max(0, Number(autoSession.lastPositionSeconds || 0) || 0);
    }
  }

  const now = Date.now();
  const metadataPayload = {
    ...metadata,
    tmdbId,
  };

  try {
    persistentCacheDb.query(`
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
    `).run(
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
    persistentCacheDb.query(`
      UPDATE playback_sessions
      SET
        health_state = 'invalid',
        health_fail_count = health_fail_count + 1,
        last_error = ?,
        updated_at = ?,
        next_validation_at = ?,
        last_accessed_at = ?
      WHERE session_key = ?
    `).run(
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
    persistentCacheDb.query(`
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
    `).run(
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

function updatePersistedPlaybackSessionProgress(sessionKey, {
  positionSeconds = 0,
  healthState = "unknown",
  lastError = "",
} = {}) {
  if (!persistentCacheDb || !sessionKey) {
    return false;
  }

  const existing = getPersistedPlaybackSession(sessionKey);
  if (!existing) {
    return false;
  }

  const normalizedHealthState = normalizeSessionHealthState(healthState || existing.healthState);
  const clampedPosition = Math.max(0, Number(positionSeconds) || 0);
  const now = Date.now();
  const nextFailCount = normalizedHealthState === "invalid"
    ? existing.healthFailCount + 1
    : normalizedHealthState === "healthy"
      ? 0
      : existing.healthFailCount;
  const nextError = normalizedHealthState === "healthy"
    ? ""
    : String(lastError || existing.lastError || "").slice(0, 500);

  try {
    persistentCacheDb.query(`
      UPDATE playback_sessions
      SET
        last_position_seconds = ?,
        health_state = ?,
        health_fail_count = ?,
        last_error = ?,
        updated_at = ?,
        last_accessed_at = ?
      WHERE session_key = ?
    `).run(
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
  const normalizedTmdbId = String(tmdbMovieId || "").trim();
  const normalizedLang = normalizePreferredAudioLang(context.preferredAudioLang);
  const preferredQuality = normalizePreferredStreamQuality(context.preferredQuality);
  const sessionKey = buildPlaybackSessionKey(normalizedTmdbId, normalizedLang, preferredQuality);
  const session = getPersistedPlaybackSession(sessionKey);
  if (!session) {
    cacheStats.playbackSessionMisses += 1;
    return null;
  }

  const expectedTmdbId = normalizedTmdbId;
  if (!expectedTmdbId || session.tmdbId !== expectedTmdbId) {
    deletePersistedPlaybackSession(sessionKey);
    invalidateMovieResolveCacheForSession(expectedTmdbId, normalizedLang, preferredQuality);
    cacheStats.playbackSessionInvalidated += 1;
    cacheStats.playbackSessionMisses += 1;
    return null;
  }

  if (!session.playableUrl || session.healthState === "invalid") {
    invalidateMovieResolveCacheForSession(expectedTmdbId, normalizedLang, preferredQuality);
    if (session.healthState === "invalid") {
      cacheStats.playbackSessionInvalidated += 1;
    }
    cacheStats.playbackSessionMisses += 1;
    return null;
  }

  const displayTitle = String(session.metadata?.displayTitle || context.titleFallback || "").trim();
  const displayYear = String(session.metadata?.displayYear || context.yearFallback || "").trim();
  if (!doesFilenameLikelyMatchMovie(session.filename, displayTitle, displayYear)) {
    markPersistedPlaybackSessionInvalid(sessionKey, "Session filename mismatched requested title.");
    invalidateMovieResolveCacheForSession(expectedTmdbId, normalizedLang, preferredQuality);
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
        markPersistedPlaybackSessionInvalid(sessionKey, error instanceof Error ? error.message : "Session validation failed.");
        invalidateMovieResolveCacheForSession(expectedTmdbId, normalizedLang, preferredQuality);
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
  const preferredSubtitleLang = normalizeSubtitlePreference(preference?.subtitleLang || "");
  const sourceInput = extractPlayableSourceInput(session.playableUrl);
  let tracks = {
    durationSeconds: Number(session.metadata?.runtimeSeconds || 0) || 0,
    audioTracks: [],
    subtitleTracks: [],
  };
  let selectedAudioStreamIndex = -1;
  let selectedSubtitleStreamIndex = -1;
  try {
    tracks = await probeMediaTracks(sourceInput, {
      sourceHash: session.sourceHash,
      selectedFile: session.selectedFile,
    });
    const audioTrack = chooseAudioTrackFromProbe(tracks, normalizedLang);
    const subtitleTrack = chooseSubtitleTrackFromProbe(tracks, preferredSubtitleLang);
    selectedAudioStreamIndex = Number.isInteger(audioTrack?.streamIndex) ? audioTrack.streamIndex : -1;
    selectedSubtitleStreamIndex = Number.isInteger(subtitleTrack?.streamIndex) ? subtitleTrack.streamIndex : -1;
  } catch {
    // Probe data is optional for session reuse.
  }

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
    metadata: session.metadata,
    session: buildPlaybackSessionPayload(session),
  };
}

async function resolveMovieWithDedup(tmdbMovieId, context = {}) {
  const effectivePreferredAudioLang = resolveEffectivePreferredAudioLang(tmdbMovieId, context.preferredAudioLang);
  const effectivePreferredQuality = normalizePreferredStreamQuality(context.preferredQuality);
  const effectiveContext = {
    ...context,
    preferredAudioLang: effectivePreferredAudioLang,
    preferredQuality: effectivePreferredQuality,
  };
  const dedupKey = buildMovieResolveKey(tmdbMovieId, effectivePreferredAudioLang, effectivePreferredQuality);
  const reusableSession = await getReusablePlaybackSession(tmdbMovieId, effectiveContext);
  if (reusableSession) {
    setCachedMovieQuickStart(dedupKey, reusableSession);
    return attachPlaybackSessionToResolvedMovie(
      reusableSession,
      tmdbMovieId,
      effectivePreferredAudioLang,
      effectivePreferredQuality,
    ) || reusableSession;
  }

  const cached = getCachedMovieQuickStart(dedupKey);
  if (cached) {
    return attachPlaybackSessionToResolvedMovie(
      cached,
      tmdbMovieId,
      effectivePreferredAudioLang,
      effectivePreferredQuality,
    ) || cached;
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
      return attachPlaybackSessionToResolvedMovie(
        resolved,
        tmdbMovieId,
        effectivePreferredAudioLang,
        effectivePreferredQuality,
      ) || resolved;
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

  const infoHash = String(stream?.infoHash || "").trim().toLowerCase();
  const preferredFilename = stream?.behaviorHints?.filename;
  let torrentId = "";
  let createdTorrent = false;

  const resolveFromTorrentId = async (candidateTorrentId) => {
    const info = await rdFetch(`/torrents/info/${candidateTorrentId}`);
    const fileIds = pickVideoFileIds(info?.files || [], preferredFilename);
    const selectedFile = fileIds.length ? String(fileIds[0]) : "";

    await rdFetch(`/torrents/selectFiles/${candidateTorrentId}`, {
      method: "POST",
      form: {
        files: fileIds.length ? fileIds.join(",") : "all",
      },
    });

    const readyInfo = await waitForTorrentToBeReady(candidateTorrentId);
    const downloadLinks = Array.isArray(readyInfo?.links) ? readyInfo.links.filter(Boolean) : [];
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

        const candidateUrls = Array.isArray(resolved.playableUrls) ? resolved.playableUrls : [];
        const html5Candidates = candidateUrls.filter((url) => isLikelyHtml5PlayableUrl(url, filename));
        const nonHtml5Candidates = candidateUrls
          .filter((url) => !isLikelyHtml5PlayableUrl(url, filename))
          .sort((left, right) => {
            const leftStable = String(left).includes("download.real-debrid.com");
            const rightStable = String(right).includes("download.real-debrid.com");
            return Number(rightStable) - Number(leftStable);
          });

        for (let urlIndex = 0; urlIndex < html5Candidates.length; urlIndex += 1) {
          const playableUrl = html5Candidates[urlIndex];
          if (verifiedCandidates.includes(playableUrl) || uncertainCandidates.includes(playableUrl)) {
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

        nonHtml5Candidates.forEach((sourceUrl) => {
          if (shouldAttemptRemuxSource(sourceUrl, filename)) {
            pushUniqueUrl(uncertainCandidates, buildRemuxProxyUrl(sourceUrl));
          }
        });
      } catch (error) {
        lastError = error;
      }
    }

    const rankedCandidates = [
      ...verifiedCandidates,
      ...uncertainCandidates,
    ];

    if (rankedCandidates.length) {
      const expanded = [];
      rankedCandidates.forEach((url) => {
        if (isPlaybackProxyUrl(url)) {
          pushUniqueUrl(expanded, url);
          return;
        }
        if (shouldPreferSoftwareDecodeSource(url, filename)) {
          if (shouldAttemptRemuxSource(url, filename)) {
            pushUniqueUrl(expanded, buildRemuxProxyUrl(url));
          }
          pushUniqueUrl(expanded, url);
          return;
        }
        pushUniqueUrl(expanded, url);
        if (shouldWrapWithRemuxFallback(url)) {
          pushUniqueUrl(expanded, buildRemuxProxyUrl(url));
        }
      });
      const playableUrl = expanded[0];
      const resolvedSource = {
        playableUrl,
        fallbackUrls: expanded.slice(1),
        filename,
        sourceHash: infoHash,
        selectedFile,
      };
      setCachedResolvedStream(cacheKey, resolvedSource);
      return resolvedSource;
    }

    throw lastError || new Error("No playable Real-Debrid stream URL was available.");
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

async function fetchMovieMetadata(tmdbMovieId, { titleFallback = "", yearFallback = "" } = {}) {
  const details = await tmdbFetch(`/movie/${tmdbMovieId}`);
  if (!details?.imdb_id) {
    throw new Error("This TMDB movie does not expose an IMDb id.");
  }

  const runtimeMinutes = Number(details.runtime);
  const runtimeSeconds = Number.isFinite(runtimeMinutes) && runtimeMinutes > 0
    ? Math.round(runtimeMinutes * 60)
    : 0;

  return {
    tmdbId: String(tmdbMovieId || "").trim(),
    imdbId: details.imdb_id,
    displayTitle: details.title || titleFallback || "Movie",
    displayYear: details.release_date ? details.release_date.slice(0, 4) : yearFallback,
    runtimeSeconds,
  };
}

async function fetchTorrentioMovieStreams(imdbId) {
  const payload = await requestJson(`${TORRENTIO_BASE_URL}/stream/movie/${imdbId}.json`);
  return Array.isArray(payload?.streams) ? payload.streams : [];
}

async function resolveTmdbMovieViaRealDebrid(tmdbMovieId, context = {}) {
  const resolutionStartedAt = Date.now();
  const maxResolutionMs = 90000;
  const metadata = await fetchMovieMetadata(tmdbMovieId, context);
  const persistedPreference = getPersistedTitleTrackPreference(metadata.tmdbId) || null;
  const preferredAudioLang = context.preferredAudioLang === "auto" && persistedPreference?.audioLang
    ? persistedPreference.audioLang
    : normalizePreferredAudioLang(context.preferredAudioLang);
  const preferredSubtitleLang = normalizeSubtitlePreference(
    context.preferredSubtitleLang || persistedPreference?.subtitleLang || "",
  );
  const preferredStreamQuality = normalizePreferredStreamQuality(context.preferredQuality);

  const streams = await fetchTorrentioMovieStreams(metadata.imdbId);
  const rankedPool = streams
    .filter((stream) => stream && stream.infoHash);
  const qualityFilteredCandidates = filterStreamsByQualityPreference(rankedPool, preferredStreamQuality);
  const candidates = qualityFilteredCandidates
    .sort((left, right) => {
      const rightScore = scoreStreamQuality(right, metadata, preferredAudioLang, preferredStreamQuality);
      const leftScore = scoreStreamQuality(left, metadata, preferredAudioLang, preferredStreamQuality);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return parseSeedCount(right.title) - parseSeedCount(left.title);
    })
    .slice(0, 10);

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
      const fallbackName = `${metadata.displayTitle} ${metadata.displayYear || ""}`.trim();
      const resolved = await resolveCandidateStream(candidate, fallbackName);
      const filenameMatchesMovie = doesFilenameLikelyMatchMovie(
        resolved?.filename,
        metadata.displayTitle,
        metadata.displayYear,
      );
      if (!filenameMatchesMovie) {
        lastError = new Error("Resolved stream filename did not match requested title.");
        continue;
      }

      const sourceInput = extractPlayableSourceInput(resolved.playableUrl);
      let tracks = {
        durationSeconds: metadata.runtimeSeconds || 0,
        audioTracks: [],
        subtitleTracks: [],
      };
      let selectedAudioStreamIndex = -1;
      let selectedSubtitleStreamIndex = -1;
      try {
        tracks = await probeMediaTracks(sourceInput, {
          sourceHash: resolved.sourceHash,
          selectedFile: resolved.selectedFile,
        });
        const audioTrack = chooseAudioTrackFromProbe(tracks, preferredAudioLang);
        const subtitleTrack = chooseSubtitleTrackFromProbe(tracks, preferredSubtitleLang);
        selectedAudioStreamIndex = Number.isInteger(audioTrack?.streamIndex)
          ? audioTrack.streamIndex
          : -1;
        selectedSubtitleStreamIndex = Number.isInteger(subtitleTrack?.streamIndex)
          ? subtitleTrack.streamIndex
          : -1;
      } catch {
        // Track probing is optional; continue playback with best-effort defaults.
      }

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
        metadata,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("All stream candidates failed.");
}

async function handleApi(url, request) {
  if (url.pathname === "/api/debug/cache") {
    if (url.searchParams.get("clear") === "1") {
      tmdbResponseCache.clear();
      movieQuickStartCache.clear();
      resolvedStreamCache.clear();
      rdTorrentLookupCache.clear();
      inFlightMovieResolves.clear();
      clearPersistentCaches();
    }
    sweepCaches();
    return json(getCacheDebugStats());
  }

  if (url.pathname === "/api/config") {
    return json({
      realDebridConfigured: Boolean(REAL_DEBRID_TOKEN),
      tmdbConfigured: Boolean(TMDB_API_KEY),
    });
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
    const mediaType = (url.searchParams.get("mediaType") || "movie").trim().toLowerCase();

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

  if (url.pathname === "/api/resolve/movie") {
    const tmdbId = (url.searchParams.get("tmdbId") || "").trim();
    const titleFallback = (url.searchParams.get("title") || "").trim();
    const yearFallback = (url.searchParams.get("year") || "").trim();
    const preferredAudioLang = normalizePreferredAudioLang(url.searchParams.get("audioLang"));
    const preferredQuality = normalizePreferredStreamQuality(url.searchParams.get("quality"));
    const preferredSubtitleLang = normalizeSubtitlePreference(url.searchParams.get("subtitleLang"));

    if (!/^\d+$/.test(tmdbId)) {
      return json({ error: "Missing or invalid tmdbId query parameter." }, 400);
    }

    const resolved = await resolveMovieWithDedup(tmdbId, {
      titleFallback,
      yearFallback,
      preferredAudioLang,
      preferredQuality,
      preferredSubtitleLang,
    });

    return json(resolved);
  }

  if (url.pathname === "/api/title/preferences") {
    if (request.method === "GET") {
      const tmdbId = String(url.searchParams.get("tmdbId") || "").trim();
      if (!/^\d+$/.test(tmdbId)) {
        return json({ error: "Missing or invalid tmdbId query parameter." }, 400);
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

    if (request.method !== "POST") {
      return json({ error: "Method not allowed. Use GET or POST." }, 405);
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

    let sessionKey = buildPlaybackSessionKey(tmdbId, preferredAudioLang, preferredQuality);
    let existing = getPersistedPlaybackSession(sessionKey);
    if (!existing && preferredAudioLang === "auto") {
      const effectiveAudioLang = resolveEffectivePreferredAudioLang(tmdbId, preferredAudioLang);
      sessionKey = buildPlaybackSessionKey(tmdbId, effectiveAudioLang, preferredQuality);
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
      return json({ error: "Playback session not found for this title/language." }, 404);
    }

    const rawPosition = Number(payload?.positionSeconds);
    const positionSeconds = Number.isFinite(rawPosition) && rawPosition >= 0
      ? rawPosition
      : existing.lastPositionSeconds;
    const healthState = normalizeSessionHealthState(payload?.healthState || existing.healthState);
    const lastError = String(payload?.lastError || "");
    const sourceHash = String(payload?.sourceHash || existing.sourceHash || "").trim().toLowerCase();
    const eventType = String(payload?.eventType || "").trim().toLowerCase();

    const updated = updatePersistedPlaybackSessionProgress(sessionKey, {
      positionSeconds,
      healthState,
      lastError,
    });
    if (!updated) {
      return json({ error: "Unable to persist playback session progress." }, 500);
    }

    const sessionAudioLang = normalizePreferredAudioLang(existing.audioLang || preferredAudioLang);
    const sessionQuality = normalizePreferredStreamQuality(existing.preferredQuality || preferredQuality);
    if (healthState === "invalid") {
      invalidateMovieResolveCacheForSession(tmdbId, sessionAudioLang, sessionQuality);
      cacheStats.playbackSessionInvalidated += 1;
    }

    if (sourceHash) {
      if (eventType === "success") {
        recordSourceHealthEvent(sourceHash, "success");
      } else if (eventType === "decode_failure" || eventType === "ended_early" || eventType === "playback_error") {
        recordSourceHealthEvent(sourceHash, eventType, lastError);
      } else if (healthState === "invalid") {
        const inferredDecodeFailure = /decode|demuxer|ffmpeg|format error/i.test(lastError);
        recordSourceHealthEvent(sourceHash, inferredDecodeFailure ? "decode_failure" : "playback_error", lastError);
      }
    }

    const nextSession = getPersistedPlaybackSession(sessionKey);
    return json({
      ok: true,
      session: buildPlaybackSessionPayload(nextSession || existing),
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
    const subtitleStreamIndex = Number(url.searchParams.get("subtitleStream") || -1);
    if (!input) {
      return json({ error: "Missing input query parameter." }, 400);
    }
    return createSubtitleVttResponse(input, subtitleStreamIndex);
  }

  if (url.pathname === "/api/remux") {
    const input = (url.searchParams.get("input") || "").trim();
    const rawStart = Number(url.searchParams.get("start") || 0);
    const rawAudioStream = Number(url.searchParams.get("audioStream") || -1);
    const rawAudioSyncMs = Number(url.searchParams.get("audioSyncMs") || 0);
    const startSeconds = Number.isFinite(rawStart) && rawStart > 0 ? rawStart : 0;
    const audioStreamIndex = Number.isFinite(rawAudioStream) && rawAudioStream >= 0
      ? Math.floor(rawAudioStream)
      : -1;
    const audioSyncMs = normalizeAudioSyncMs(rawAudioSyncMs);
    if (!input) {
      return json({ error: "Missing input query parameter." }, 400);
    }
    return createRemuxResponse(input, request, startSeconds, audioStreamIndex, audioSyncMs);
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
  idleTimeout: 120,
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
        const message = error instanceof Error ? error.message : "Unexpected server error.";
        return json({ error: message }, classifyErrorStatus(message));
      }
    }

    return serveStatic(url.pathname, request);
  },
});

console.log(`Server running at http://${HOST}:${server.port}`);
