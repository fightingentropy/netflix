const video = document.getElementById("playerVideo");
const goBack = document.getElementById("goBack");
const seekBar = document.getElementById("seekBar");
const durationText = document.getElementById("durationText");
const togglePlay = document.getElementById("togglePlay");
const rewind10 = document.getElementById("rewind10");
const forward10 = document.getElementById("forward10");
const toggleMutePlayer = document.getElementById("toggleMutePlayer");
const toggleFullscreen = document.getElementById("toggleFullscreen");
const toggleSpeed = document.getElementById("toggleSpeed");
const speedControl = document.getElementById("speedControl");
const speedOptions = Array.from(document.querySelectorAll(".speed-option"));
const nextEpisode = document.getElementById("nextEpisode");
const toggleEpisodes = document.getElementById("toggleEpisodes");
const episodesControl = document.getElementById("episodesControl");
const episodesList = document.getElementById("episodesList");
const episodesPopoverTitle = document.getElementById("episodesPopoverTitle");
const toggleAudio = document.getElementById("toggleAudio");
const audioControl = document.getElementById("audioControl");
const audioOptionsContainer = document.getElementById("audioOptions");
const subtitleOptionsContainer = document.getElementById("subtitleOptions");
const sourcePanel = document.getElementById("sourcePanel");
const sourceOptionsContainer = document.getElementById("sourceOptions");
const episodeLabel = document.getElementById("episodeLabel");
const resolverOverlay = document.getElementById("resolverOverlay");
const resolverStatus = document.getElementById("resolverStatus");
const resolverLoader = document.getElementById("resolverLoader");
const seekLoadingOverlay = document.getElementById("seekLoadingOverlay");
const playerShell = document.querySelector(".player-shell");

const playbackRates = [0.5, 0.75, 1, 1.25, 1.5];
const controlsHideDelayMs = 3000;
const sessionProgressSyncIntervalMs = 10000;
const sessionProgressMinimumDeltaSeconds = 2;
const singleClickToggleDelayMs = 220;
const seekLoadingTimeoutMs = 9000;

let isDraggingSeek = false;
let speedPopoverCloseTimeout = null;
let episodesPopoverCloseTimeout = null;
let audioPopoverCloseTimeout = null;
let streamStallRecoveryTimeout = null;
let controlsHideTimeout = null;
let singleClickPlaybackToggleTimeout = null;
let seekLoadingTimeout = null;
let tmdbSourceQueue = [];
let tmdbSourceAttemptIndex = 0;
let tmdbResolveRetries = 0;
let knownDurationSeconds = 0;
let tmdbExpectedDurationSeconds = 0;
const maxTmdbResolveRetries = 2;
let isRecoveringTmdbStream = false;
let activeTranscodeInput = "";
let activeAudioStreamIndex = -1;
let activeAudioSyncMs = 0;
let transcodeBaseOffsetSeconds = 0;
let hasAppliedInitialResume = false;
let pendingTranscodeSeekRatio = null;
let pendingStandardSeekRatio = null;
let activePlaybackSession = null;
let isSyncingSessionProgress = false;
let lastSessionProgressSyncAt = 0;
let lastSessionProgressSyncedPosition = -1;
let hlsInstance = null;
let hasReportedSourceSuccess = false;
let activeTrackSourceInput = "";
let selectedAudioStreamIndex = -1;
let selectedSubtitleStreamIndex = -1;
let availableAudioTracks = [];
let availableSubtitleTracks = [];
let availablePlaybackSources = [];
let subtitleTrackElement = null;
let resolvedTrackPreferenceAudio = "auto";
let preferredSubtitleLang = "";
let audioOptions = [];
let subtitleOptions = [];
let sourceOptions = [];

const params = new URLSearchParams(window.location.search);
const DEFAULT_TRAILER_SOURCE = "assets/videos/intro.mp4";
const LOCAL_TATE_LEGACY_SOURCE = "assets/videos/tate-full.mp4";
const LOCAL_TATE_SOURCE = "assets/videos/local/tate-part-1/video.mp4";
const LOCAL_TATE_THUMBNAIL = "assets/videos/local/tate-part-1/thumbnail.jpg";
const SERIES_LIBRARY = Object.freeze({
  "jeffrey-epstein-filthy-rich": {
    id: "jeffrey-epstein-filthy-rich",
    title: "Jeffrey Epstein: Filthy Rich",
    tmdbId: "103506",
    year: "2020",
    preferredContainer: "mp4",
    episodes: [
      {
        title: "Hunting Grounds",
        description: "Survivors recount how Epstein abused, manipulated and silenced them as he ran a so-called molestation \"pyramid scheme\" out of his Palm Beach mansion.",
        thumb: "assets/images/thumbnail-top10-h.jpg",
        seasonNumber: 1,
        episodeNumber: 1,
      },
      {
        title: "Follow the Money",
        description: "The survivors and journalists retrace how Epstein built influence, money and legal insulation for years.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 2,
      },
      {
        title: "The Island",
        description: "Victims and insiders detail what happened at Epstein's private island and who enabled access.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 3,
      },
      {
        title: "Finding Their Voice",
        description: "Women who were silenced for years step forward publicly and push for accountability.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 4,
      },
    ],
  },
});
const requestedSeriesId = String(params.get("seriesId") || "").trim().toLowerCase();
const requestedEpisodeIndex = Number(params.get("episodeIndex") || 0);
const activeSeries = Object.prototype.hasOwnProperty.call(SERIES_LIBRARY, requestedSeriesId)
  ? SERIES_LIBRARY[requestedSeriesId]
  : null;
const seriesEpisodes = Array.isArray(activeSeries?.episodes) ? activeSeries.episodes : [];
const seriesEpisodeIndex = seriesEpisodes.length
  ? Math.max(0, Math.min(
    seriesEpisodes.length - 1,
    Number.isFinite(requestedEpisodeIndex) ? Math.floor(requestedEpisodeIndex) : 0,
  ))
  : -1;
const activeSeriesEpisode = seriesEpisodeIndex >= 0 ? seriesEpisodes[seriesEpisodeIndex] : null;
const isSeriesPlayback = Boolean(activeSeriesEpisode);
const hasSeriesEpisodeControls = Boolean(activeSeries && seriesEpisodes.length > 1);
const rawSourceParam = String(params.get("src") || "").trim();
const src = isSeriesPlayback
  ? String(activeSeriesEpisode?.src || "").trim()
  : rawSourceParam;
const fallbackSeasonNumber = Number(params.get("seasonNumber") || params.get("season") || 1);
const fallbackEpisodeNumber = Number(params.get("episodeNumber") || params.get("episodeOrdinal") || 1);
const rawTitle = isSeriesPlayback
  ? String(activeSeries.title || "")
  : (params.get("title") || "Jeffrey Epstein: Filthy Rich");
const rawEpisode = isSeriesPlayback
  ? `E${seriesEpisodeIndex + 1} ${activeSeriesEpisode.title}`
  : (params.get("episode") || "Official Trailer");
const isLocalTatePlayback = src === LOCAL_TATE_LEGACY_SOURCE || src === LOCAL_TATE_SOURCE;
const title = isLocalTatePlayback ? "Tate - Part 1" : rawTitle;
const episode = isLocalTatePlayback ? "" : rawEpisode;
const tmdbId = String(activeSeries?.tmdbId || params.get("tmdbId") || "").trim();
const mediaType = isSeriesPlayback ? "tv" : String(params.get("mediaType") || "").trim().toLowerCase();
const year = String(activeSeries?.year || params.get("year") || "").trim();
const seasonNumber = isSeriesPlayback
  ? Math.max(1, Math.floor(Number(activeSeriesEpisode?.seasonNumber || 1)))
  : (Number.isFinite(fallbackSeasonNumber) ? Math.max(1, Math.floor(fallbackSeasonNumber)) : 1);
const episodeNumber = isSeriesPlayback
  ? Math.max(1, Math.floor(Number(activeSeriesEpisode?.episodeNumber || (seriesEpisodeIndex + 1))))
  : (Number.isFinite(fallbackEpisodeNumber) ? Math.max(1, Math.floor(fallbackEpisodeNumber)) : 1);
const hasAudioLangParam = params.has("audioLang");
const audioLangParam = (params.get("audioLang") || "auto").trim().toLowerCase();
const hasQualityParam = params.has("quality");
const qualityParam = (params.get("quality") || "auto").trim().toLowerCase();
const preferredContainerParam = String(activeSeries?.preferredContainer || params.get("preferredContainer") || "")
  .trim()
  .toLowerCase();
const preferredContainer = preferredContainerParam === "mp4" ? "mp4" : "";
const hasSubtitleLangParam = params.has("subtitleLang");
const subtitleLangParam = (params.get("subtitleLang") || "").trim().toLowerCase();
const sourceHashParam = (params.get("sourceHash") || "").trim().toLowerCase();
const hasExplicitSource = Boolean(src);
const isTmdbMoviePlayback = Boolean(!hasExplicitSource && tmdbId && mediaType === "movie");
const isTmdbTvPlayback = Boolean(!hasExplicitSource && tmdbId && mediaType === "tv");
const isTmdbResolvedPlayback = Boolean(isTmdbMoviePlayback || isTmdbTvPlayback);
const supportedAudioLangs = new Set(["auto", "en", "fr", "es", "de", "it", "pt", "ja", "ko", "zh", "nl", "ro"]);
const AUDIO_LANG_PREF_KEY_PREFIX = "netflix-audio-lang:movie:";
const SUBTITLE_LANG_PREF_KEY_PREFIX = "netflix-subtitle-lang:movie:";
const SUBTITLE_STREAM_PREF_KEY_PREFIX = "netflix-subtitle-stream:movie:";
const STREAM_QUALITY_PREF_KEY = "netflix-stream-quality-pref";
const SOURCE_MIN_SEEDERS_PREF_KEY = "netflix-source-filter-min-seeders";
const SOURCE_ALLOWED_FORMATS_PREF_KEY = "netflix-source-filter-allowed-formats";
const SUBTITLE_COLOR_PREF_KEY = "netflix-subtitle-color-pref";
const DEFAULT_SUBTITLE_COLOR = "#b8bcc3";
const supportedQualityPreferences = new Set(["auto", "2160p", "1080p", "720p"]);
const supportedSourceFormats = ["mp4", "mkv", "m3u8", "ts", "avi", "wmv"];
const supportedSourceFormatSet = new Set(supportedSourceFormats);
const AUDIO_SYNC_MIN_MS = -1500;
const AUDIO_SYNC_MAX_MS = 1500;
const RESUME_SAVE_MIN_INTERVAL_MS = 3000;
const RESUME_SAVE_MIN_DELTA_SECONDS = 1.5;
const RESUME_CLEAR_AT_END_THRESHOLD_SECONDS = 8;
const CONTINUE_WATCHING_META_KEY = "netflix-continue-watching-meta";
const SUBTITLE_LINE_FROM_BOTTOM = -2;
const SUBTITLE_MATTE_MIN_HEIGHT_PX = 18;
const SUBTITLE_MATTE_TOP_PADDING_PX = 6;
const SUBTITLE_MATTE_BOTTOM_PADDING_PX = 14;
const SUBTITLE_MATTE_BOTTOM_TARGET_OFFSET_PX = 38;
const SUBTITLE_MATTE_TOP_GUARD_RATIO = 0.35;
const subtitleLanguageNames = {
  off: "Off",
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
};

let selectedSourceHash = normalizeSourceHash(sourceHashParam);

function getAudioLangPreferenceStorageKey(movieTmdbId) {
  return `${AUDIO_LANG_PREF_KEY_PREFIX}${String(movieTmdbId || "").trim()}`;
}

function normalizePreferredQuality(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "auto";
  if (normalized === "4k" || normalized === "uhd") return "2160p";
  if (normalized === "2160") return "2160p";
  if (normalized === "1080") return "1080p";
  if (normalized === "720") return "720p";
  if (supportedQualityPreferences.has(normalized)) {
    return normalized;
  }
  return "auto";
}

function getStoredPreferredQuality() {
  try {
    return normalizePreferredQuality(localStorage.getItem(STREAM_QUALITY_PREF_KEY));
  } catch {
    return "auto";
  }
}

function normalizeSourceMinSeeders(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(50000, Math.floor(parsed)));
}

function normalizeSourceFormats(value) {
  const sourceValues = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[,\s]+/g)
      .filter(Boolean);

  const normalized = sourceValues
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => supportedSourceFormatSet.has(item));
  return [...new Set(normalized)];
}

function getStoredSourceMinSeeders() {
  try {
    return normalizeSourceMinSeeders(localStorage.getItem(SOURCE_MIN_SEEDERS_PREF_KEY));
  } catch {
    return 0;
  }
}

function getStoredSourceFormats() {
  try {
    const raw = localStorage.getItem(SOURCE_ALLOWED_FORMATS_PREF_KEY);
    if (!raw) {
      return [...supportedSourceFormats];
    }

    let parsed = raw;
    if (raw.trim().startsWith("[")) {
      parsed = JSON.parse(raw);
    }
    const normalized = normalizeSourceFormats(parsed);
    if (!normalized.length) {
      return [...supportedSourceFormats];
    }
    return normalized;
  } catch {
    return [...supportedSourceFormats];
  }
}

function normalizeSubtitleColor(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) {
    return raw;
  }
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return DEFAULT_SUBTITLE_COLOR;
}

function getStoredSubtitleColorPreference() {
  try {
    return normalizeSubtitleColor(localStorage.getItem(SUBTITLE_COLOR_PREF_KEY));
  } catch {
    return DEFAULT_SUBTITLE_COLOR;
  }
}

function applySubtitleCueColor(colorValue = getStoredSubtitleColorPreference()) {
  const normalizedColor = normalizeSubtitleColor(colorValue);
  let styleElement = document.getElementById("subtitleCueColorStyle");
  if (!(styleElement instanceof HTMLStyleElement)) {
    styleElement = document.createElement("style");
    styleElement.id = "subtitleCueColorStyle";
    document.head.appendChild(styleElement);
  }

  styleElement.textContent = `
    #playerVideo::cue {
      color: ${normalizedColor};
      background: transparent;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.82);
    }
  `;
}

function normalizeAudioSyncMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const clamped = Math.max(AUDIO_SYNC_MIN_MS, Math.min(AUDIO_SYNC_MAX_MS, Math.round(parsed)));
  return clamped;
}

function isRecognizedAudioLang(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "auto" || /^[a-z]{2}$/.test(normalized);
}

function normalizeSubtitlePreference(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "auto") {
    return "";
  }
  if (raw === "off" || raw === "none" || raw === "disabled") {
    return "off";
  }
  if (/^[a-z]{2}$/.test(raw)) {
    return raw;
  }
  return raw.slice(0, 2);
}

function getSubtitleLangPreferenceStorageKey(movieTmdbId) {
  return `${SUBTITLE_LANG_PREF_KEY_PREFIX}${String(movieTmdbId || "").trim()}`;
}

function getSubtitleStreamPreferenceStorageKey(movieTmdbId) {
  return `${SUBTITLE_STREAM_PREF_KEY_PREFIX}${String(movieTmdbId || "").trim()}`;
}

function getStoredSubtitleStreamPreferenceForTmdbMovie(movieTmdbId) {
  const normalizedTmdbId = String(movieTmdbId || "").trim();
  if (!normalizedTmdbId) {
    return { mode: "unset", streamIndex: -1 };
  }

  try {
    const raw = String(localStorage.getItem(getSubtitleStreamPreferenceStorageKey(normalizedTmdbId)) || "")
      .trim()
      .toLowerCase();
    if (!raw) {
      return { mode: "unset", streamIndex: -1 };
    }
    if (raw === "off" || raw === "-1") {
      return { mode: "off", streamIndex: -1 };
    }
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return { mode: "on", streamIndex: parsed };
    }
  } catch {
    // Ignore storage access issues.
  }
  return { mode: "unset", streamIndex: -1 };
}

function getStoredSubtitleLangForTmdbMovie(movieTmdbId) {
  const normalizedTmdbId = String(movieTmdbId || "").trim();
  if (!normalizedTmdbId) {
    return "";
  }

  try {
    return normalizeSubtitlePreference(localStorage.getItem(getSubtitleLangPreferenceStorageKey(normalizedTmdbId)));
  } catch {
    // Ignore storage access issues.
  }
  return "";
}

function persistSubtitleLangPreference(lang) {
  if (!isTmdbMoviePlayback || !tmdbId) {
    return;
  }

  const normalizedLang = normalizeSubtitlePreference(lang);
  const key = getSubtitleLangPreferenceStorageKey(tmdbId);
  try {
    if (!normalizedLang) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, normalizedLang);
  } catch {
    // Ignore storage access issues.
  }
}

function persistSubtitleStreamPreference(streamIndex) {
  if (!isTmdbMoviePlayback || !tmdbId) {
    return;
  }

  const key = getSubtitleStreamPreferenceStorageKey(tmdbId);
  const normalizedStreamIndex = Number.isInteger(Number(streamIndex))
    ? Number(streamIndex)
    : -1;
  try {
    if (normalizedStreamIndex < 0) {
      localStorage.setItem(key, "off");
      return;
    }
    localStorage.setItem(key, String(normalizedStreamIndex));
  } catch {
    // Ignore storage access issues.
  }
}

function getStoredAudioLangForTmdbMovie(movieTmdbId) {
  const normalizedTmdbId = String(movieTmdbId || "").trim();
  if (!normalizedTmdbId) {
    return "auto";
  }

  try {
    const raw = String(localStorage.getItem(getAudioLangPreferenceStorageKey(normalizedTmdbId)) || "")
      .trim()
      .toLowerCase();
    if (isRecognizedAudioLang(raw)) {
      return raw;
    }
  } catch {
    // Ignore storage access issues.
  }

  return "auto";
}

function persistAudioLangPreference(lang) {
  if (!isTmdbMoviePlayback || !tmdbId) {
    return;
  }

  const normalizedLang = isRecognizedAudioLang(String(lang || "").toLowerCase())
    ? String(lang).toLowerCase()
    : "auto";
  const key = getAudioLangPreferenceStorageKey(tmdbId);

  try {
    if (normalizedLang === "auto") {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, normalizedLang);
  } catch {
    // Ignore storage access issues.
  }
}

let preferredAudioLang = isRecognizedAudioLang(audioLangParam) ? audioLangParam : "auto";
if (isTmdbMoviePlayback && !hasAudioLangParam) {
  const storedAudioLang = getStoredAudioLangForTmdbMovie(tmdbId);
  if (isRecognizedAudioLang(storedAudioLang)) {
    preferredAudioLang = storedAudioLang;
  }
}
if (isTmdbMoviePlayback && hasAudioLangParam) {
  persistAudioLangPreference(preferredAudioLang);
}
let preferredQuality = normalizePreferredQuality(qualityParam);
if (isTmdbMoviePlayback && !hasQualityParam) {
  preferredQuality = getStoredPreferredQuality();
}
let preferredSourceMinSeeders = getStoredSourceMinSeeders();
let preferredSourceFormats = getStoredSourceFormats();
let preferredAudioSyncMs = 0;
preferredSubtitleLang = normalizeSubtitlePreference(subtitleLangParam);
if (isTmdbMoviePlayback && !hasSubtitleLangParam) {
  preferredSubtitleLang = getStoredSubtitleLangForTmdbMovie(tmdbId) || preferredSubtitleLang;
}
if (isTmdbMoviePlayback && hasSubtitleLangParam) {
  persistSubtitleLangPreference(preferredSubtitleLang);
}
const sourceIdentity = isSeriesPlayback
  ? `series:${activeSeries.id}:episode:${seriesEpisodeIndex}`
  : (src || (
    isTmdbResolvedPlayback
      ? `tmdb:${mediaType}:${tmdbId}${isTmdbTvPlayback ? `:s${seasonNumber}:e${episodeNumber}` : ""}`
      : DEFAULT_TRAILER_SOURCE
  ));
const resumeStorageKey = `netflix-resume:${sourceIdentity}`;
let resumeTime = 0;
let lastPersistedResumeTime = 0;
let lastPersistedResumeAt = 0;
try {
  const storedResume = Number(localStorage.getItem(resumeStorageKey));
  if (Number.isFinite(storedResume) && storedResume > 0) {
    resumeTime = storedResume;
    lastPersistedResumeTime = storedResume;
  }
} catch {
  // Ignore storage access issues.
}

function readContinueWatchingMetaMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONTINUE_WATCHING_META_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isLocalTateSource(sourceValue) {
  const normalizedSource = String(sourceValue || "").trim();
  return normalizedSource === LOCAL_TATE_LEGACY_SOURCE || normalizedSource === LOCAL_TATE_SOURCE;
}

function getCanonicalContinueWatchingMetadata() {
  if (!isLocalTateSource(sourceIdentity)) {
    return {
      title: String(title || "Title"),
      episode: String(episode || "Now Playing"),
      src: String(src || ""),
      tmdbId: String(tmdbId || ""),
      mediaType: String(mediaType || ""),
      seriesId: isSeriesPlayback ? String(activeSeries.id || "") : "",
      episodeIndex: isSeriesPlayback ? seriesEpisodeIndex : -1,
      year: String(year || ""),
      thumb: isSeriesPlayback
        ? String(activeSeriesEpisode?.thumb || "assets/images/thumbnail.jpg")
        : "",
    };
  }

  return {
    title: "Tate - Part 1",
    episode: "",
    src: LOCAL_TATE_SOURCE,
    tmdbId: "",
    mediaType: "",
    seriesId: "",
    episodeIndex: -1,
    year: "2023",
    thumb: LOCAL_TATE_THUMBNAIL,
  };
}

function persistContinueWatchingEntry(resumeSeconds) {
  const normalizedSource = String(sourceIdentity || "").trim();
  if (!normalizedSource || !Number.isFinite(resumeSeconds) || resumeSeconds < 1) {
    return;
  }

  try {
    const metadata = getCanonicalContinueWatchingMetadata();
    const metaMap = readContinueWatchingMetaMap();
    metaMap[normalizedSource] = {
      sourceIdentity: normalizedSource,
      title: metadata.title,
      episode: metadata.episode,
      src: metadata.src,
      tmdbId: metadata.tmdbId,
      mediaType: metadata.mediaType,
      seriesId: metadata.seriesId,
      episodeIndex: metadata.episodeIndex,
      year: metadata.year,
      thumb: metadata.thumb,
      resumeSeconds: Number(resumeSeconds),
      updatedAt: Date.now(),
    };
    localStorage.setItem(CONTINUE_WATCHING_META_KEY, JSON.stringify(metaMap));
  } catch {
    // Ignore storage access issues.
  }
}

function removeContinueWatchingEntry() {
  const normalizedSource = String(sourceIdentity || "").trim();
  if (!normalizedSource) {
    return;
  }

  try {
    const metaMap = readContinueWatchingMetaMap();
    if (metaMap && typeof metaMap === "object") {
      delete metaMap[normalizedSource];
      const hasEntries = Object.keys(metaMap).length > 0;
      if (hasEntries) {
        localStorage.setItem(CONTINUE_WATCHING_META_KEY, JSON.stringify(metaMap));
      } else {
        localStorage.removeItem(CONTINUE_WATCHING_META_KEY);
      }
    }
  } catch {
    // Ignore storage access issues.
  }
}

if (resumeTime > 1) {
  persistContinueWatchingEntry(resumeTime);
}

function stripAudioSyncFromPageUrl() {
  const nextParams = new URLSearchParams(window.location.search);
  if (!nextParams.has("audioSyncMs")) {
    return;
  }
  nextParams.delete("audioSyncMs");
  const nextQuery = nextParams.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

function isResolvingSource() {
  return Boolean(resolverOverlay && !resolverOverlay.hidden);
}

function clearSeekLoadingTimeout() {
  if (seekLoadingTimeout !== null) {
    window.clearTimeout(seekLoadingTimeout);
    seekLoadingTimeout = null;
  }
}

function showSeekLoadingIndicator() {
  if (!seekLoadingOverlay || isResolvingSource()) {
    return;
  }
  seekLoadingOverlay.hidden = false;
  clearSeekLoadingTimeout();
  seekLoadingTimeout = window.setTimeout(() => {
    seekLoadingTimeout = null;
    hideSeekLoadingIndicator();
  }, seekLoadingTimeoutMs);
}

function hideSeekLoadingIndicator() {
  if (!seekLoadingOverlay) {
    return;
  }
  clearSeekLoadingTimeout();
  seekLoadingOverlay.hidden = true;
}

function showResolver(message, { isError = false } = {}) {
  if (hasExplicitSource) {
    hideResolver();
    return;
  }

  if (!resolverOverlay) {
    return;
  }

  if (resolverStatus) {
    resolverStatus.textContent = String(message || "").trim() || "Unable to load this video.";
    resolverStatus.hidden = !isError;
  }
  if (resolverLoader) {
    resolverLoader.hidden = isError;
  }
  hideSeekLoadingIndicator();
  resolverOverlay.hidden = false;
  resolverOverlay.classList.toggle("is-error", isError);
}

function hideResolver() {
  if (!resolverOverlay) {
    return;
  }

  resolverOverlay.hidden = true;
  resolverOverlay.classList.remove("is-error");
  if (resolverLoader) {
    resolverLoader.hidden = false;
  }
  if (resolverStatus) {
    resolverStatus.hidden = true;
  }
}

function hasActiveSource() {
  return Boolean(video.currentSrc || video.getAttribute("src"));
}

function canSyncPlaybackSession() {
  return false;
}

function resetPlaybackSessionState() {
  activePlaybackSession = null;
  isSyncingSessionProgress = false;
  lastSessionProgressSyncAt = 0;
  lastSessionProgressSyncedPosition = -1;
  hasReportedSourceSuccess = false;
}

function getLanguageDisplayLabel(langCode) {
  const normalized = String(langCode || "").trim().toLowerCase();
  if (!normalized) {
    return "Unknown";
  }
  if (normalized in subtitleLanguageNames) {
    return subtitleLanguageNames[normalized];
  }
  return normalized.toUpperCase();
}

function normalizeSourceHash(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{40}$/.test(normalized) ? normalized : "";
}

function getSourceDisplayName(option = {}) {
  const primary = String(option.primary || "").trim();
  if (primary) {
    return primary;
  }

  const fallback = String(option.filename || "").trim();
  if (fallback) {
    return fallback;
  }

  return "Stream source";
}

function getSourceDisplayHint(option = {}) {
  const hintParts = [];
  const provider = String(option.provider || "").trim();
  const quality = String(option.qualityLabel || "").trim();
  const container = String(option.container || "").trim().toUpperCase();

  if (provider) {
    hintParts.push(provider);
  }
  if (quality) {
    hintParts.push(quality);
  }
  if (container) {
    hintParts.push(container);
  }

  return hintParts.join(" • ");
}

function getSourceDisplayMeta(option = {}) {
  const meta = [];
  const seeders = Number(option.seeders || 0);
  const size = String(option.size || "").trim();
  const releaseGroup = String(option.releaseGroup || "").trim();

  if (Number.isFinite(seeders) && seeders > 0) {
    meta.push(`👤 ${seeders}`);
  }
  if (size) {
    meta.push(`💾 ${size}`);
  }
  if (releaseGroup) {
    meta.push(`⚙ ${releaseGroup}`);
  }

  return meta.join(" ");
}

function syncSourcePanelVisibility() {
  if (!sourcePanel) {
    return;
  }
  sourcePanel.hidden = !isTmdbResolvedPlayback;
}

function renderSourceOptionButtons() {
  if (!sourceOptionsContainer) {
    return;
  }

  sourceOptionsContainer.innerHTML = "";

  if (!availablePlaybackSources.length) {
    const empty = document.createElement("p");
    empty.className = "source-option-empty";
    empty.textContent = "No alternate sources available yet.";
    sourceOptionsContainer.appendChild(empty);
    sourceOptions = [];
    return;
  }

  const fragment = document.createDocumentFragment();
  availablePlaybackSources.forEach((option) => {
    const sourceHash = normalizeSourceHash(option?.sourceHash || option?.infoHash || "");
    if (!sourceHash) {
      return;
    }

    const button = document.createElement("button");
    button.className = "audio-option source-option";
    button.type = "button";
    button.setAttribute("role", "option");
    button.dataset.optionType = "source";
    button.dataset.sourceHash = sourceHash;
    button.setAttribute("aria-selected", sourceHash === selectedSourceHash ? "true" : "false");

    const nameLine = document.createElement("span");
    nameLine.className = "source-option-name";
    nameLine.textContent = getSourceDisplayName(option);

    const hintLine = document.createElement("span");
    hintLine.className = "source-option-hint";
    hintLine.textContent = getSourceDisplayHint(option);

    const metaLine = document.createElement("span");
    metaLine.className = "source-option-meta";
    metaLine.textContent = getSourceDisplayMeta(option);

    button.append(nameLine);
    if (hintLine.textContent) {
      button.append(hintLine);
    }
    if (metaLine.textContent) {
      button.append(metaLine);
    }
    fragment.appendChild(button);
  });

  sourceOptionsContainer.appendChild(fragment);
  sourceOptions = Array.from(sourceOptionsContainer.querySelectorAll(".source-option"));
}

function parseHlsMasterSource(source) {
  if (!source) {
    return null;
  }

  try {
    const url = new URL(source, window.location.origin);
    if (url.pathname !== "/api/hls/master.m3u8") {
      return null;
    }
    const input = url.searchParams.get("input");
    if (!input) {
      return null;
    }

    const rawAudio = Number(url.searchParams.get("audioStream") || -1);
    const rawSubtitle = Number(url.searchParams.get("subtitleStream") || -1);
    return {
      input,
      audioStreamIndex: Number.isFinite(rawAudio) ? rawAudio : -1,
      subtitleStreamIndex: Number.isFinite(rawSubtitle) ? rawSubtitle : -1,
    };
  } catch {
    return null;
  }
}

function shouldMapSubtitleStreamIndex(streamIndex) {
  const safeStreamIndex = Number.isFinite(streamIndex) ? Math.floor(streamIndex) : -1;
  if (safeStreamIndex < 0) {
    return false;
  }

  const selectedTrack = availableSubtitleTracks.find((track) => Number(track?.streamIndex) === safeStreamIndex);
  if (!selectedTrack) {
    return true;
  }

  return !selectedTrack.isExternal;
}

function buildHlsPlaybackUrl(input, audioStreamIndex = -1, subtitleStreamIndex = -1) {
  const query = new URLSearchParams({ input: String(input || "") });
  if (Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0) {
    query.set("audioStream", String(Math.floor(audioStreamIndex)));
  }
  if (shouldMapSubtitleStreamIndex(subtitleStreamIndex)) {
    query.set("subtitleStream", String(Math.floor(subtitleStreamIndex)));
  }
  return `/api/hls/master.m3u8?${query.toString()}`;
}

function destroyHlsInstance() {
  if (!hlsInstance) {
    return;
  }

  try {
    hlsInstance.destroy();
  } catch {
    // Ignore HLS teardown errors.
  }
  hlsInstance = null;
}

function clearSubtitleTrack() {
  if (!subtitleTrackElement) {
    return;
  }
  try {
    subtitleTrackElement.remove();
  } catch {
    // Ignore DOM remove issues.
  }
  subtitleTrackElement = null;
}

function hideAllSubtitleTracks() {
  Array.from(video.textTracks || []).forEach((textTrack) => {
    textTrack.mode = "disabled";
  });
}

function computeSubtitleLinePercentInBottomMatte() {
  const viewportWidth = Number(video.clientWidth || 0);
  const viewportHeight = Number(video.clientHeight || 0);
  const mediaWidth = Number(video.videoWidth || 0);
  const mediaHeight = Number(video.videoHeight || 0);
  if (viewportWidth <= 0 || viewportHeight <= 0 || mediaWidth <= 0 || mediaHeight <= 0) {
    return null;
  }

  const scale = Math.min(viewportWidth / mediaWidth, viewportHeight / mediaHeight);
  if (!Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  const renderedHeight = mediaHeight * scale;
  const matteHeight = Math.max(0, (viewportHeight - renderedHeight) / 2);
  if (!Number.isFinite(matteHeight) || matteHeight < SUBTITLE_MATTE_MIN_HEIGHT_PX) {
    return null;
  }

  const bottomMatteTop = viewportHeight - matteHeight;
  const matteTopBoundary = bottomMatteTop + SUBTITLE_MATTE_TOP_PADDING_PX;
  const matteBottomBoundary = viewportHeight - SUBTITLE_MATTE_BOTTOM_PADDING_PX;
  if (matteBottomBoundary <= matteTopBoundary) {
    return null;
  }

  const guardedTopTarget = matteTopBoundary + (matteHeight * SUBTITLE_MATTE_TOP_GUARD_RATIO);
  const preferredBottomTarget = viewportHeight - SUBTITLE_MATTE_BOTTOM_TARGET_OFFSET_PX;
  const targetY = Math.min(
    matteBottomBoundary,
    Math.max(matteTopBoundary, Math.max(guardedTopTarget, preferredBottomTarget)),
  );
  const linePercent = (targetY / viewportHeight) * 100;
  return Math.max(0, Math.min(100, Number(linePercent.toFixed(2))));
}

function nudgeSubtitleTrackPlacementUp(textTrack) {
  if (!textTrack || !textTrack.cues) {
    return;
  }
  const matteCenteredLinePercent = computeSubtitleLinePercentInBottomMatte();

  Array.from(textTrack.cues).forEach((cue) => {
    if (!cue || !("line" in cue)) {
      return;
    }

    try {
      if (matteCenteredLinePercent !== null) {
        if ("snapToLines" in cue) {
          cue.snapToLines = false;
        }
        cue.line = matteCenteredLinePercent;
      } else {
        if ("snapToLines" in cue) {
          cue.snapToLines = true;
        }
        cue.line = SUBTITLE_LINE_FROM_BOTTOM;
      }
    } catch {
      // Ignore cue positioning failures for unsupported cue types.
    }
  });
}

function refreshActiveSubtitlePlacement() {
  const activeTrack = subtitleTrackElement?.track
    || Array.from(video.textTracks || []).find((track) => track.mode === "showing")
    || null;
  if (activeTrack) {
    nudgeSubtitleTrackPlacementUp(activeTrack);
  }
}

function showSubtitleTrackElement(trackElement) {
  if (!trackElement) {
    return;
  }
  hideAllSubtitleTracks();
  const directTrack = trackElement.track;
  if (directTrack) {
    nudgeSubtitleTrackPlacementUp(directTrack);
    directTrack.mode = "showing";
    return;
  }
  const fallbackTrack = Array.from(video.textTracks || []).find((textTrack) => textTrack.label === trackElement.label);
  if (fallbackTrack) {
    nudgeSubtitleTrackPlacementUp(fallbackTrack);
    fallbackTrack.mode = "showing";
  }
}

function syncSubtitleTrackVisibility() {
  if (subtitleTrackElement) {
    showSubtitleTrackElement(subtitleTrackElement);
    return;
  }
  const selectedTrack = getSubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  if (shouldUseNativeEmbeddedSubtitleTrack(selectedTrack)) {
    ensureNativeSubtitleTrackVisible();
    return;
  }
  hideAllSubtitleTracks();
}

function isLikelyForcedSubtitleTrack(track) {
  const labelText = String(track?.label || "").toLowerCase();
  const titleText = String(track?.title || "").toLowerCase();
  const combined = `${labelText} ${titleText}`;
  return (
    combined.includes("forced")
    || combined.includes("foreign")
    || combined.includes("sign")
  );
}

function getSubtitleTrackByStreamIndex(streamIndex) {
  const safeStreamIndex = Number.isFinite(streamIndex) ? Math.floor(streamIndex) : -1;
  if (safeStreamIndex < 0) {
    return null;
  }
  return availableSubtitleTracks.find((track) => Number(track?.streamIndex) === safeStreamIndex) || null;
}

function shouldUseNativeEmbeddedSubtitleTrack(track) {
  // Chromium in this app shell is inconsistent with in-band MP4 subtitle rendering.
  // Keep external VTT path as the reliable default.
  return false;
}

function ensureNativeSubtitleTrackVisible() {
  if (subtitleTrackElement) {
    return;
  }
  const selectedTrack = getSubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  if (!shouldUseNativeEmbeddedSubtitleTrack(selectedTrack)) {
    return;
  }
  const nativeTracks = Array.from(video.textTracks || []);
  if (!nativeTracks.length) {
    return;
  }

  nativeTracks.forEach((textTrack, index) => {
    textTrack.mode = index === 0 ? "showing" : "disabled";
  });
  nudgeSubtitleTrackPlacementUp(nativeTracks[0]);
}

async function persistTrackPreferencesOnServer({
  audioLang = null,
  subtitleLang = null,
} = {}) {
  if (!isTmdbMoviePlayback || !tmdbId) {
    return;
  }

  const payload = { tmdbId };
  if (audioLang !== null && audioLang !== undefined) {
    payload.audioLang = String(audioLang || "");
  }
  if (subtitleLang !== null && subtitleLang !== undefined) {
    payload.subtitleLang = String(subtitleLang || "");
  }

  try {
    await requestJson("/api/title/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, 10000);
  } catch {
    // Ignore preference persistence failures.
  }
}

function applySubtitleTrackByStreamIndex(streamIndex) {
  clearSubtitleTrack();
  hideAllSubtitleTracks();

  const safeStreamIndex = Number.isFinite(streamIndex) ? Math.floor(streamIndex) : -1;
  if (safeStreamIndex < 0) {
    selectedSubtitleStreamIndex = -1;
    return;
  }

  const selectedTrack = getSubtitleTrackByStreamIndex(safeStreamIndex);
  if (!selectedTrack) {
    selectedSubtitleStreamIndex = -1;
    return;
  }

  selectedSubtitleStreamIndex = safeStreamIndex;
  if (shouldUseNativeEmbeddedSubtitleTrack(selectedTrack)) {
    ensureNativeSubtitleTrackVisible();
    return;
  }

  if (!selectedTrack.vttUrl) {
    selectedSubtitleStreamIndex = -1;
    return;
  }

  const trackElement = document.createElement("track");
  trackElement.kind = "subtitles";
  trackElement.label = selectedTrack.label || `${getLanguageDisplayLabel(selectedTrack.language)} subtitles`;
  trackElement.srclang = selectedTrack.language || "und";
  trackElement.src = `${selectedTrack.vttUrl}${selectedTrack.vttUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`;
  trackElement.default = true;
  trackElement.addEventListener("load", () => {
    nudgeSubtitleTrackPlacementUp(trackElement.track);
    showSubtitleTrackElement(trackElement);
  });
  video.appendChild(trackElement);
  subtitleTrackElement = trackElement;
  syncSubtitleTrackVisibility();
  window.setTimeout(() => {
    syncSubtitleTrackVisibility();
  }, 220);
}

function rebuildTrackOptionButtons() {
  if (!audioOptionsContainer || !subtitleOptionsContainer) {
    return;
  }

  audioOptionsContainer.innerHTML = "";
  subtitleOptionsContainer.innerHTML = "";

  if (availableAudioTracks.length > 0) {
    availableAudioTracks.forEach((track) => {
      const button = document.createElement("button");
      button.className = "audio-option";
      button.type = "button";
      button.setAttribute("role", "option");
      button.dataset.streamIndex = String(track.streamIndex);
      button.dataset.trackLanguage = String(track.language || "");
      button.dataset.optionType = "audio-track";
      const languageLabel = getLanguageDisplayLabel(track.language);
      const titleSuffix = track.title ? ` - ${track.title}` : "";
      const codecSuffix = track.codec ? ` (${String(track.codec).toUpperCase()})` : "";
      button.textContent = `${languageLabel}${titleSuffix}${codecSuffix}`;
      button.setAttribute("aria-selected", Number(track.streamIndex) === selectedAudioStreamIndex ? "true" : "false");
      audioOptionsContainer.appendChild(button);
    });
  } else {
    ["auto", "en", "fr", "es", "de"].forEach((lang) => {
      const button = document.createElement("button");
      button.className = "audio-option";
      button.type = "button";
      button.setAttribute("role", "option");
      button.dataset.lang = lang;
      button.dataset.optionType = "audio-lang";
      button.textContent = getLanguageDisplayLabel(lang);
      button.setAttribute("aria-selected", lang === preferredAudioLang ? "true" : "false");
      audioOptionsContainer.appendChild(button);
    });
  }

  const subtitlesOffButton = document.createElement("button");
  subtitlesOffButton.className = "audio-option subtitle-option";
  subtitlesOffButton.type = "button";
  subtitlesOffButton.setAttribute("role", "option");
  subtitlesOffButton.dataset.optionType = "subtitle";
  subtitlesOffButton.dataset.subtitleStream = "-1";
  subtitlesOffButton.textContent = "Off";
  subtitlesOffButton.setAttribute("aria-selected", selectedSubtitleStreamIndex < 0 ? "true" : "false");
  subtitleOptionsContainer.appendChild(subtitlesOffButton);

  const orderedSubtitleTracks = [...availableSubtitleTracks].sort((left, right) => {
    const leftForced = isLikelyForcedSubtitleTrack(left) ? 1 : 0;
    const rightForced = isLikelyForcedSubtitleTrack(right) ? 1 : 0;
    if (leftForced !== rightForced) {
      return leftForced - rightForced;
    }
    const leftExternal = left?.isExternal ? 1 : 0;
    const rightExternal = right?.isExternal ? 1 : 0;
    if (leftExternal !== rightExternal) {
      return leftExternal - rightExternal;
    }
    return Number(left?.streamIndex || 0) - Number(right?.streamIndex || 0);
  });

  orderedSubtitleTracks.forEach((track) => {
    const button = document.createElement("button");
    button.className = "audio-option subtitle-option";
    button.type = "button";
    button.setAttribute("role", "option");
    button.dataset.optionType = "subtitle";
    button.dataset.subtitleStream = String(track.streamIndex);
    button.dataset.subtitleLang = String(track.language || "");
    const cleanLabel = track.isExternal
      ? getLanguageDisplayLabel(track.language)
      : (track.label || `${getLanguageDisplayLabel(track.language)} subtitles`);
    button.textContent = cleanLabel;
    if (!track.isTextBased || !track.vttUrl) {
      button.disabled = true;
      button.textContent = `${button.textContent} (Unsupported)`;
    }
    button.setAttribute("aria-selected", Number(track.streamIndex) === selectedSubtitleStreamIndex ? "true" : "false");
    subtitleOptionsContainer.appendChild(button);
  });

  audioOptions = Array.from(audioOptionsContainer.querySelectorAll(".audio-option"));
  subtitleOptions = Array.from(subtitleOptionsContainer.querySelectorAll(".subtitle-option"));
  renderSourceOptionButtons();
}

function shouldUseSoftwareDecode(source) {
  const value = String(source || "").toLowerCase();
  return (
    value.includes(".mkv") ||
    value.includes(".avi") ||
    value.includes(".wmv") ||
    value.includes(".ts") ||
    value.includes(".m3u8")
  );
}

function withPreferredAudioSyncForRemuxSource(source, audioSyncMs = preferredAudioSyncMs) {
  try {
    const url = new URL(source, window.location.origin);
    if (url.pathname !== "/api/remux") {
      return source;
    }
    const normalizedSync = normalizeAudioSyncMs(audioSyncMs);
    if (normalizedSync === 0) {
      url.searchParams.delete("audioSyncMs");
    } else {
      url.searchParams.set("audioSyncMs", String(normalizedSync));
    }
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return source;
  }
}

function buildSoftwareDecodeUrl(
  source,
  startSeconds = 0,
  audioStreamIndex = -1,
  audioSyncMs = preferredAudioSyncMs,
  subtitleStreamIndex = selectedSubtitleStreamIndex,
) {
  const params = new URLSearchParams({ input: String(source || "") });
  if (Number.isFinite(startSeconds) && startSeconds > 0) {
    params.set("start", String(Math.floor(startSeconds)));
  }
  if (Number.isFinite(audioStreamIndex) && audioStreamIndex >= 0) {
    params.set("audioStream", String(Math.floor(audioStreamIndex)));
  }
  if (shouldMapSubtitleStreamIndex(subtitleStreamIndex)) {
    params.set("subtitleStream", String(Math.floor(subtitleStreamIndex)));
  }
  const normalizedSync = normalizeAudioSyncMs(audioSyncMs);
  if (normalizedSync !== 0) {
    params.set("audioSyncMs", String(normalizedSync));
  }
  return `/api/remux?${params.toString()}`;
}

function parseTranscodeSource(source) {
  if (!source) {
    return null;
  }

  try {
    const url = new URL(source, window.location.origin);
    if (url.pathname !== "/api/remux") {
      return null;
    }

    const input = url.searchParams.get("input");
    if (!input) {
      return null;
    }

    const rawStart = Number(url.searchParams.get("start") || 0);
    const startSeconds = Number.isFinite(rawStart) && rawStart > 0 ? rawStart : 0;
    const rawAudioStreamIndex = Number(url.searchParams.get("audioStream") || -1);
    const audioStreamIndex = Number.isFinite(rawAudioStreamIndex) && rawAudioStreamIndex >= 0
      ? Math.floor(rawAudioStreamIndex)
      : -1;
    const rawSubtitleStreamIndex = Number(url.searchParams.get("subtitleStream") || -1);
    const subtitleStreamIndex = Number.isFinite(rawSubtitleStreamIndex) && rawSubtitleStreamIndex >= 0
      ? Math.floor(rawSubtitleStreamIndex)
      : -1;
    const rawAudioSyncMs = Number(url.searchParams.get("audioSyncMs") || 0);
    const audioSyncMs = normalizeAudioSyncMs(rawAudioSyncMs);
    return { input, startSeconds, audioStreamIndex, subtitleStreamIndex, audioSyncMs };
  } catch {
    return null;
  }
}

function isTranscodeSourceActive() {
  return Boolean(activeTranscodeInput);
}

function getEffectiveCurrentTime() {
  if (isTranscodeSourceActive()) {
    return transcodeBaseOffsetSeconds + (Number(video.currentTime) || 0);
  }
  return Number(video.currentTime) || 0;
}

function setVideoSource(nextSource) {
  if (!nextSource) {
    return;
  }
  const sourceWithAudioSync = withPreferredAudioSyncForRemuxSource(nextSource, preferredAudioSyncMs);

  clearStreamStallRecovery();
  destroyHlsInstance();
  clearSubtitleTrack();

  const transcodeMeta = parseTranscodeSource(sourceWithAudioSync);
  if (transcodeMeta) {
    activeTranscodeInput = transcodeMeta.input;
    transcodeBaseOffsetSeconds = transcodeMeta.startSeconds;
    activeAudioStreamIndex = transcodeMeta.audioStreamIndex;
    activeAudioSyncMs = transcodeMeta.audioSyncMs;
  } else {
    activeTranscodeInput = "";
    transcodeBaseOffsetSeconds = 0;
    activeAudioStreamIndex = -1;
    activeAudioSyncMs = 0;
  }

  const hlsMeta = parseHlsMasterSource(sourceWithAudioSync);
  if (hlsMeta?.input) {
    activeTrackSourceInput = hlsMeta.input;
  }

  knownDurationSeconds = 0;
  const absoluteSource = new URL(sourceWithAudioSync, window.location.origin).toString();
  const isHlsSource = absoluteSource.includes("/api/hls/master.m3u8");
  if (isHlsSource && window.Hls?.isSupported?.()) {
    const hlsSourceMeta = parseHlsMasterSource(sourceWithAudioSync);
    hlsInstance = new window.Hls({
      enableWorker: true,
      lowLatencyMode: false,
    });
    hlsInstance.loadSource(absoluteSource);
    hlsInstance.attachMedia(video);
    hlsInstance.on(window.Hls.Events.ERROR, (_, event) => {
      if (!event?.fatal) {
        if (event?.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          try {
            hlsInstance?.startLoad();
          } catch {
            // Ignore HLS restart errors.
          }
          scheduleStreamStallRecovery("Network stalled, trying another source...");
        } else if (event?.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hlsInstance?.recoverMediaError();
          } catch {
            // Ignore HLS media recovery errors.
          }
        }
        return;
      }
      try {
        hlsInstance?.destroy();
      } catch {
        // Ignore HLS teardown errors.
      }
      hlsInstance = null;

      // Native playback of m3u8 is unreliable in Chromium; fallback to server remux.
      if (hlsSourceMeta?.input) {
        const resumeAt = Math.max(0, Math.floor(getEffectiveCurrentTime()));
        const remuxFallback = buildSoftwareDecodeUrl(
          hlsSourceMeta.input,
          resumeAt,
          hlsSourceMeta.audioStreamIndex,
          preferredAudioSyncMs,
          hlsSourceMeta.subtitleStreamIndex,
        );
        video.setAttribute("src", new URL(remuxFallback, window.location.origin).toString());
      } else {
        video.setAttribute("src", absoluteSource);
      }
      video.load();
      void tryPlay();
      scheduleStreamStallRecovery("Stream stalled, trying another source...");
    });
    return;
  }

  if (isHlsSource) {
    const hlsMeta = parseHlsMasterSource(sourceWithAudioSync);
    if (hlsMeta?.input) {
      const remuxFallback = buildSoftwareDecodeUrl(
        hlsMeta.input,
        0,
        hlsMeta.audioStreamIndex,
        preferredAudioSyncMs,
        hlsMeta.subtitleStreamIndex,
      );
      video.setAttribute("src", new URL(remuxFallback, window.location.origin).toString());
      video.load();
      scheduleStreamStallRecovery("Stream stalled, trying another source...");
      return;
    }
  }

  video.setAttribute("src", absoluteSource);
  video.load();
  scheduleStreamStallRecovery("Stream stalled, trying another source...");
}

function setTmdbSourceQueue(primaryUrl, fallbackUrls = []) {
  const queue = [primaryUrl, ...(Array.isArray(fallbackUrls) ? fallbackUrls : [])]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);

  tmdbSourceQueue = queue;
  tmdbSourceAttemptIndex = queue.length > 0 ? 1 : 0;
}

async function tryNextTmdbSource() {
  if (!isTmdbResolvedPlayback || tmdbSourceAttemptIndex >= tmdbSourceQueue.length) {
    return false;
  }

  const nextSource = tmdbSourceQueue[tmdbSourceAttemptIndex];
  tmdbSourceAttemptIndex += 1;
  showResolver(`Trying alternate source (${tmdbSourceAttemptIndex}/${tmdbSourceQueue.length})...`);
  setVideoSource(nextSource);
  await tryPlay();
  return true;
}

function applyStoredSubtitleSelectionPreference() {
  if (!isTmdbMoviePlayback || hasSubtitleLangParam) {
    return;
  }

  const storedSubtitleStreamPreference = getStoredSubtitleStreamPreferenceForTmdbMovie(tmdbId);

  if (storedSubtitleStreamPreference.mode === "off") {
    selectedSubtitleStreamIndex = -1;
    preferredSubtitleLang = "off";
    return;
  }

  if (storedSubtitleStreamPreference.mode !== "on") {
    return;
  }

  const exactTrack = availableSubtitleTracks.find(
    (track) => Number(track?.streamIndex) === storedSubtitleStreamPreference.streamIndex,
  );
  if (exactTrack) {
    selectedSubtitleStreamIndex = Number(exactTrack.streamIndex);
    const exactLanguage = normalizeSubtitlePreference(exactTrack.language || preferredSubtitleLang);
    if (exactLanguage) {
      preferredSubtitleLang = exactLanguage;
    }
    return;
  }

  const preferredLanguage = normalizeSubtitlePreference(preferredSubtitleLang);
  const fallbackTrack = availableSubtitleTracks.find((track) => (
    preferredLanguage
    && preferredLanguage !== "off"
    && normalizeSubtitlePreference(track?.language || "") === preferredLanguage
  )) || availableSubtitleTracks[0] || null;
  if (!fallbackTrack) {
    selectedSubtitleStreamIndex = -1;
    return;
  }

  const fallbackStreamIndex = Number(fallbackTrack.streamIndex);
  if (Number.isInteger(fallbackStreamIndex) && fallbackStreamIndex >= 0) {
    selectedSubtitleStreamIndex = fallbackStreamIndex;
  }
  const fallbackLanguage = normalizeSubtitlePreference(fallbackTrack.language || preferredLanguage);
  if (fallbackLanguage) {
    preferredSubtitleLang = fallbackLanguage;
  }
}

async function resolveTmdbSourcesAndPlay() {
  if (!availablePlaybackSources.length) {
    void fetchTmdbSourceOptionsViaBackend();
  }

  const resolved = isTmdbTvPlayback
    ? await resolveTmdbTvEpisodeViaBackend(tmdbId, seasonNumber, episodeNumber)
    : await resolveTmdbMovieViaBackend(tmdbId);
  activePlaybackSession = resolved?.session || null;
  activeTrackSourceInput = String(resolved?.sourceInput || "").trim();
  availableAudioTracks = Array.isArray(resolved?.tracks?.audioTracks) ? resolved.tracks.audioTracks : [];
  availableSubtitleTracks = Array.isArray(resolved?.tracks?.subtitleTracks) ? resolved.tracks.subtitleTracks : [];
  selectedAudioStreamIndex = Number.isFinite(Number(resolved?.selectedAudioStreamIndex))
    ? Number(resolved.selectedAudioStreamIndex)
    : -1;
  selectedSubtitleStreamIndex = Number.isFinite(Number(resolved?.selectedSubtitleStreamIndex))
    ? Number(resolved.selectedSubtitleStreamIndex)
    : -1;
  resolvedTrackPreferenceAudio = String(resolved?.preferences?.audioLang || preferredAudioLang || "auto")
    .trim()
    .toLowerCase();
  preferredSubtitleLang = String(resolved?.preferences?.subtitleLang || preferredSubtitleLang || "")
    .trim();
  preferredSubtitleLang = normalizeSubtitlePreference(preferredSubtitleLang);
  selectedSourceHash = normalizeSourceHash(resolved?.sourceHash || selectedSourceHash);
  persistSourceHashInUrl();

  if (resolvedTrackPreferenceAudio && resolvedTrackPreferenceAudio !== "auto") {
    preferredAudioLang = resolvedTrackPreferenceAudio;
    persistAudioLangPreference(preferredAudioLang);
  }
  const subtitleStreamPreferenceBeforeResolve = getStoredSubtitleStreamPreferenceForTmdbMovie(tmdbId);
  applyStoredSubtitleSelectionPreference();
  persistSubtitleLangPreference(preferredSubtitleLang);
  if (
    subtitleStreamPreferenceBeforeResolve.mode !== "unset"
    || selectedSubtitleStreamIndex >= 0
    || preferredSubtitleLang === "off"
  ) {
    persistSubtitleStreamPreference(selectedSubtitleStreamIndex);
  }

  rebuildTrackOptionButtons();
  if (!availablePlaybackSources.some((option) => option.sourceHash === selectedSourceHash) && selectedSourceHash) {
    availablePlaybackSources = [
      {
        sourceHash: selectedSourceHash,
        primary: String(resolved?.filename || "Current source"),
        filename: String(resolved?.filename || ""),
        provider: "Current",
        qualityLabel: "",
        container: "",
        seeders: 0,
        size: "",
        releaseGroup: "",
      },
      ...availablePlaybackSources,
    ];
    renderSourceOptionButtons();
  }
  setTmdbSourceQueue(resolved.playableUrl, resolved.fallbackUrls);
  setVideoSource(tmdbSourceQueue[0] || resolved.playableUrl);
  applySubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  syncAudioState();
  hideResolver();
  const runtimeSeconds = Number(resolved.metadata?.runtimeSeconds || 0);
  tmdbExpectedDurationSeconds = Number.isFinite(runtimeSeconds) && runtimeSeconds > 0 ? runtimeSeconds : 0;

  if (isTmdbTvPlayback && resolved.metadata?.displayTitle) {
    const resolvedEpisodeNumber = Number(resolved?.metadata?.episodeNumber || episodeNumber);
    const safeEpisodeNumber = Number.isFinite(resolvedEpisodeNumber) && resolvedEpisodeNumber > 0
      ? Math.floor(resolvedEpisodeNumber)
      : episodeNumber;
    const resolvedEpisodeTitle = String(resolved?.metadata?.episodeTitle || activeSeriesEpisode?.title || "").trim();
    setEpisodeLabel(
      resolved.metadata.displayTitle,
      resolvedEpisodeTitle ? `E${safeEpisodeNumber} ${resolvedEpisodeTitle}` : `E${safeEpisodeNumber}`,
    );
  } else if (resolved.metadata?.displayTitle) {
    const releaseYear = String(resolved.metadata.displayYear || "").trim();
    setEpisodeLabel(resolved.metadata.displayTitle, releaseYear ? `(${releaseYear})` : "");
  }

  await tryPlay();
}

function attemptTmdbRecovery(message) {
  if (!isTmdbResolvedPlayback || isRecoveringTmdbStream) {
    return false;
  }

  isRecoveringTmdbStream = true;
  showResolver(message);

  if (tmdbSourceAttemptIndex < tmdbSourceQueue.length) {
    void tryNextTmdbSource()
      .finally(() => {
        isRecoveringTmdbStream = false;
      });
    return true;
  }

  if (tmdbResolveRetries < maxTmdbResolveRetries) {
    tmdbResolveRetries += 1;
    showResolver(`Refreshing source (${tmdbResolveRetries}/${maxTmdbResolveRetries})...`);
    void resolveTmdbSourcesAndPlay()
      .catch((error) => {
        console.error("Failed to refresh TMDB playback source:", error);
        const fallbackMessage = error?.message || "Resolved stream could not be played. Try again.";
        showResolver(fallbackMessage, { isError: true });
      })
      .finally(() => {
        isRecoveringTmdbStream = false;
      });
    return true;
  }

  isRecoveringTmdbStream = false;
  return false;
}

function setEpisodeLabel(currentTitle, currentEpisode) {
  const formattedEpisode = String(currentEpisode || "").trim();
  episodeLabel.textContent = "";

  const strong = document.createElement("b");
  strong.textContent = currentTitle;
  episodeLabel.appendChild(strong);

  if (formattedEpisode) {
    episodeLabel.append(` ${formattedEpisode}`);
  }
}

function getSeriesEpisodeLabel(index, episodeTitle) {
  return `E${index + 1} ${String(episodeTitle || "").trim()}`;
}

function navigateToSeriesEpisode(nextIndex) {
  if (!isSeriesPlayback || !activeSeries || !seriesEpisodes.length) {
    return;
  }

  const parsedIndex = Number(nextIndex);
  if (!Number.isFinite(parsedIndex)) {
    return;
  }

  const safeIndex = Math.max(0, Math.min(seriesEpisodes.length - 1, Math.floor(parsedIndex)));
  if (safeIndex === seriesEpisodeIndex) {
    closeEpisodesPopover();
    return;
  }

  const targetEpisode = seriesEpisodes[safeIndex];
  if (!targetEpisode) {
    return;
  }

  persistResumeTime(true);

  const nextParams = new URLSearchParams(window.location.search);
  nextParams.set("seriesId", activeSeries.id);
  nextParams.set("episodeIndex", String(safeIndex));
  nextParams.set("title", String(activeSeries.title || title || "Title"));
  nextParams.set("episode", getSeriesEpisodeLabel(safeIndex, targetEpisode.title));
  nextParams.delete("src");
  nextParams.set("mediaType", "tv");
  if (activeSeries.tmdbId) {
    nextParams.set("tmdbId", String(activeSeries.tmdbId));
  } else {
    nextParams.delete("tmdbId");
  }
  if (activeSeries.year) {
    nextParams.set("year", String(activeSeries.year));
  } else {
    nextParams.delete("year");
  }
  const targetSeasonNumber = Math.max(1, Math.floor(Number(targetEpisode?.seasonNumber || seasonNumber)));
  const targetEpisodeNumber = Math.max(1, Math.floor(Number(targetEpisode?.episodeNumber || (safeIndex + 1))));
  nextParams.set("seasonNumber", String(targetSeasonNumber));
  nextParams.set("episodeNumber", String(targetEpisodeNumber));
  const nextPreferredContainer = String(activeSeries?.preferredContainer || preferredContainer || "").trim().toLowerCase();
  if (nextPreferredContainer === "mp4") {
    nextParams.set("preferredContainer", "mp4");
  } else {
    nextParams.delete("preferredContainer");
  }
  nextParams.delete("sourceHash");

  const nextQuery = nextParams.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
  window.location.href = nextUrl;
}

function renderSeriesEpisodePreview() {
  if (!episodesList) {
    return;
  }

  episodesList.innerHTML = "";
  if (!hasSeriesEpisodeControls || !activeSeries) {
    return;
  }

  if (episodesPopoverTitle) {
    episodesPopoverTitle.textContent = activeSeries.title;
  }

  seriesEpisodes.forEach((episodeEntry, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "episode-preview-item";
    item.dataset.episodeIndex = String(index);
    item.setAttribute("role", "listitem");
    item.setAttribute("aria-label", `Episode ${index + 1}: ${episodeEntry.title}`);
    if (index === seriesEpisodeIndex) {
      item.classList.add("is-active");
      item.setAttribute("aria-current", "true");
    }

    const number = document.createElement("p");
    number.className = "episode-preview-number";
    number.textContent = String(index + 1);

    const main = document.createElement("div");
    main.className = "episode-preview-main";

    const heading = document.createElement("p");
    heading.className = "episode-preview-title";
    heading.textContent = episodeEntry.title;
    main.appendChild(heading);

    const thumb = document.createElement("img");
    thumb.className = "episode-preview-thumb";
    thumb.src = String(episodeEntry.thumb || "assets/images/thumbnail.jpg");
    thumb.alt = `Episode ${index + 1} preview`;
    thumb.loading = "lazy";
    main.appendChild(thumb);

    const description = document.createElement("p");
    description.className = "episode-preview-desc";
    description.textContent = String(episodeEntry.description || "");

    item.append(number, main, description);
    episodesList.appendChild(item);
  });
}

function openEpisodesPopover() {
  if (!episodesControl || !hasSeriesEpisodeControls || isResolvingSource()) {
    return;
  }

  closeSpeedPopover(false);
  closeAudioPopover();
  window.clearTimeout(episodesPopoverCloseTimeout);
  episodesControl.classList.add("is-open");
  toggleEpisodes?.setAttribute("aria-expanded", "true");
}

function closeEpisodesPopover(withDelay = false) {
  if (!episodesControl) {
    return;
  }

  window.clearTimeout(episodesPopoverCloseTimeout);

  const close = () => {
    if (episodesControl.matches(":hover, :focus-within")) {
      return;
    }
    episodesControl.classList.remove("is-open");
    toggleEpisodes?.setAttribute("aria-expanded", "false");
  };

  if (!withDelay) {
    close();
    return;
  }

  episodesPopoverCloseTimeout = window.setTimeout(close, 140);
}

function syncSeriesControls() {
  const shouldShowControls = hasSeriesEpisodeControls;
  const hasNextEpisode = shouldShowControls && seriesEpisodeIndex >= 0 && seriesEpisodeIndex < seriesEpisodes.length - 1;
  const nextTitle = hasNextEpisode ? seriesEpisodes[seriesEpisodeIndex + 1]?.title : "";

  if (nextEpisode) {
    nextEpisode.hidden = !shouldShowControls;
    nextEpisode.disabled = !hasNextEpisode;
    nextEpisode.setAttribute(
      "aria-label",
      hasNextEpisode ? `Next episode (${nextTitle})` : "Next episode unavailable",
    );
  }

  if (episodesControl) {
    episodesControl.hidden = !shouldShowControls;
    if (!shouldShowControls) {
      episodesControl.classList.remove("is-open");
      toggleEpisodes?.setAttribute("aria-expanded", "false");
    }
  }

  if (toggleEpisodes && shouldShowControls) {
    toggleEpisodes.setAttribute("aria-label", `Episodes (${seriesEpisodeIndex + 1} of ${seriesEpisodes.length})`);
  }
}

setEpisodeLabel(title, episode);
renderSeriesEpisodePreview();
syncSeriesControls();

function formatTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "00:00";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function syncPlayState() {
  togglePlay.classList.toggle("paused", video.paused);
  togglePlay.setAttribute("aria-label", video.paused ? "Play" : "Pause");
}

function syncMuteState() {
  const muted = video.muted || video.volume === 0;
  toggleMutePlayer.classList.toggle("muted", muted);
  toggleMutePlayer.setAttribute("aria-label", muted ? "Unmute" : "Mute");
}

function syncSpeedState() {
  const speedLabel = `${video.playbackRate}x`;
  const accessibleLabel = `Playback speed (${speedLabel})`;
  toggleSpeed.setAttribute("aria-label", accessibleLabel);

  speedOptions.forEach((option) => {
    const optionRate = Number(option.dataset.rate);
    const isSelected = optionRate === video.playbackRate;
    option.setAttribute("aria-selected", isSelected ? "true" : "false");
  });
}

function syncAudioState() {
  const selectedSubtitleTrack = selectedSubtitleStreamIndex >= 0
    ? availableSubtitleTracks.find((track) => Number(track?.streamIndex) === selectedSubtitleStreamIndex)
    : null;
  const selectedSubtitleLabel = selectedSubtitleStreamIndex >= 0
    ? (selectedSubtitleTrack?.isExternal
      ? getLanguageDisplayLabel(selectedSubtitleTrack?.language)
      : (selectedSubtitleTrack?.label || getLanguageDisplayLabel(preferredSubtitleLang)))
    : "Off";
  toggleAudio?.setAttribute(
    "aria-label",
    `Subtitles (${selectedSubtitleLabel})`,
  );

  audioOptions.forEach((option) => {
    if (option.dataset.optionType === "audio-track") {
      const streamIndex = Number(option.dataset.streamIndex || -1);
      option.setAttribute("aria-selected", streamIndex === selectedAudioStreamIndex ? "true" : "false");
      return;
    }
    if (option.dataset.optionType === "audio-lang") {
      option.setAttribute("aria-selected", option.dataset.lang === preferredAudioLang ? "true" : "false");
    }
  });

  subtitleOptions.forEach((option) => {
    const streamIndex = Number(option.dataset.subtitleStream || -1);
    const isOffOption = streamIndex < 0;
    const isSelected = isOffOption ? selectedSubtitleStreamIndex < 0 : streamIndex === selectedSubtitleStreamIndex;
    option.setAttribute("aria-selected", isSelected ? "true" : "false");
  });

  sourceOptions.forEach((option) => {
    const sourceHash = normalizeSourceHash(option.dataset.sourceHash || "");
    option.setAttribute("aria-selected", sourceHash && sourceHash === selectedSourceHash ? "true" : "false");
  });
}

function getTimelineDurationSeconds() {
  const duration = Number(video.duration);
  if (Number.isFinite(duration) && duration > 0) {
    knownDurationSeconds = Math.max(knownDurationSeconds, duration);
  }
  return knownDurationSeconds;
}

function getDisplayDurationSeconds() {
  if (isTmdbResolvedPlayback && tmdbExpectedDurationSeconds > 0) {
    return tmdbExpectedDurationSeconds;
  }
  return getTimelineDurationSeconds();
}

function getSeekScaleDurationSeconds() {
  const displayDuration = getDisplayDurationSeconds();
  if (Number.isFinite(displayDuration) && displayDuration > 0) {
    return displayDuration;
  }
  return getTimelineDurationSeconds();
}

function getBufferedSeekValue(totalDurationSeconds) {
  if (!Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0 || !video.buffered?.length) {
    return null;
  }

  const current = Math.max(0, getEffectiveCurrentTime());
  let bufferedEnd = current;

  for (let index = 0; index < video.buffered.length; index += 1) {
    const start = video.buffered.start(index) + transcodeBaseOffsetSeconds;
    const end = video.buffered.end(index) + transcodeBaseOffsetSeconds;
    const containsCurrent = current >= start - 0.25 && current <= end + 0.25;
    if (containsCurrent) {
      bufferedEnd = Math.max(bufferedEnd, end);
    }
  }

  const clampedBuffered = Math.min(totalDurationSeconds, Math.max(current, bufferedEnd));
  const max = Number(seekBar.max) || 1000;
  return Math.round((clampedBuffered / totalDurationSeconds) * max);
}

function paintSeekProgress(progressValue, bufferedValue = null) {
  const max = Number(seekBar.max) || 1000;
  const clamped = Math.max(0, Math.min(max, Number(progressValue) || 0));
  const bufferedClamped = Math.max(
    clamped,
    Math.min(max, Number.isFinite(Number(bufferedValue)) ? Number(bufferedValue) : clamped),
  );
  const playedPercent = (clamped / max) * 100;
  const bufferedPercent = (bufferedClamped / max) * 100;
  seekBar.style.background = `linear-gradient(to right, var(--ui-accent) 0%, var(--ui-accent) ${playedPercent}%, var(--ui-buffered) ${playedPercent}%, var(--ui-buffered) ${bufferedPercent}%, var(--ui-line) ${bufferedPercent}%, var(--ui-line) 100%)`;
}

function openSpeedPopover() {
  if (!speedControl) {
    return;
  }

  closeEpisodesPopover(false);
  window.clearTimeout(speedPopoverCloseTimeout);
  speedControl.classList.add("is-open");
  toggleSpeed.setAttribute("aria-expanded", "true");
}

function closeSpeedPopover(withDelay = true) {
  if (!speedControl) {
    return;
  }

  window.clearTimeout(speedPopoverCloseTimeout);

  const close = () => {
    if (speedControl.matches(":hover, :focus-within")) {
      return;
    }

    speedControl.classList.remove("is-open");
    toggleSpeed.setAttribute("aria-expanded", "false");
  };

  if (!withDelay) {
    close();
    return;
  }

  speedPopoverCloseTimeout = window.setTimeout(close, 140);
}

function openAudioPopover() {
  if (!audioControl) {
    return;
  }

  if (isResolvingSource()) {
    return;
  }

  closeEpisodesPopover(false);
  window.clearTimeout(audioPopoverCloseTimeout);
  if (isTmdbResolvedPlayback && !availablePlaybackSources.length) {
    void fetchTmdbSourceOptionsViaBackend();
  }
  audioControl.classList.add("is-open");
  toggleAudio?.setAttribute("aria-expanded", "true");
}

function closeAudioPopover(withDelay = false) {
  if (!audioControl) {
    return;
  }

  window.clearTimeout(audioPopoverCloseTimeout);

  const close = () => {
    if (audioControl.matches(":hover, :focus-within")) {
      return;
    }

    audioControl.classList.remove("is-open");
    toggleAudio?.setAttribute("aria-expanded", "false");
  };

  if (!withDelay) {
    close();
    return;
  }

  audioPopoverCloseTimeout = window.setTimeout(close, 140);
}

function clearStreamStallRecovery() {
  window.clearTimeout(streamStallRecoveryTimeout);
  streamStallRecoveryTimeout = null;
}

function scheduleStreamStallRecovery(message = "Stream stalled, trying another source...") {
  if (!isTmdbResolvedPlayback || video.paused) {
    return;
  }

  const checkpointTime = getEffectiveCurrentTime();
  clearStreamStallRecovery();

  streamStallRecoveryTimeout = window.setTimeout(() => {
    if (!isTmdbResolvedPlayback || video.paused) {
      return;
    }

    const nowTime = getEffectiveCurrentTime();
    if (nowTime > checkpointTime + 0.8 || video.readyState >= 3) {
      return;
    }

    attemptTmdbRecovery(message);
  }, 8000);
}

function clearControlsHideTimer() {
  window.clearTimeout(controlsHideTimeout);
}

function clearSingleClickPlaybackToggle() {
  if (singleClickPlaybackToggleTimeout !== null) {
    window.clearTimeout(singleClickPlaybackToggleTimeout);
    singleClickPlaybackToggleTimeout = null;
  }
}

function hideControls() {
  if (video.paused) {
    return;
  }

  closeSpeedPopover(false);
  closeEpisodesPopover(false);
  closeAudioPopover();
  playerShell.classList.add("controls-hidden");
}

function showControls() {
  playerShell.classList.remove("controls-hidden");
}

function scheduleControlsHide() {
  clearControlsHideTimer();
  if (video.paused || isResolvingSource()) {
    return;
  }

  controlsHideTimeout = window.setTimeout(hideControls, controlsHideDelayMs);
}

function handleUserActivity() {
  showControls();
  scheduleControlsHide();
}

function syncSeekState() {
  const seekScaleDurationSeconds = getSeekScaleDurationSeconds();
  if (isDraggingSeek || seekScaleDurationSeconds <= 0) {
    return;
  }

  const effectiveCurrent = getEffectiveCurrentTime();
  const seekValue = Math.round((effectiveCurrent / seekScaleDurationSeconds) * 1000);
  seekBar.value = Math.max(0, Math.min(1000, seekValue));
  paintSeekProgress(seekBar.value, getBufferedSeekValue(seekScaleDurationSeconds));
  durationText.textContent = formatTime(Math.max(0, seekScaleDurationSeconds - effectiveCurrent));
}

function persistResumeTime(force = false) {
  const effectiveCurrentTime = Math.max(0, getEffectiveCurrentTime());
  if (!Number.isFinite(effectiveCurrentTime)) {
    return;
  }

  const seekScaleDurationSeconds = getSeekScaleDurationSeconds();
  const isNearEnd = Number.isFinite(seekScaleDurationSeconds)
    && seekScaleDurationSeconds > 0
    && effectiveCurrentTime >= Math.max(0, seekScaleDurationSeconds - RESUME_CLEAR_AT_END_THRESHOLD_SECONDS);

  try {
    if (isNearEnd) {
      localStorage.removeItem(resumeStorageKey);
      removeContinueWatchingEntry();
      resumeTime = 0;
      lastPersistedResumeTime = 0;
      lastPersistedResumeAt = 0;
      return;
    }

    if (effectiveCurrentTime < 1) {
      if (force) {
        localStorage.removeItem(resumeStorageKey);
        removeContinueWatchingEntry();
        resumeTime = 0;
        lastPersistedResumeTime = 0;
        lastPersistedResumeAt = 0;
      }
      return;
    }

    const now = Date.now();
    if (!force) {
      if (now - lastPersistedResumeAt < RESUME_SAVE_MIN_INTERVAL_MS) {
        return;
      }
      if (Math.abs(effectiveCurrentTime - lastPersistedResumeTime) < RESUME_SAVE_MIN_DELTA_SECONDS) {
        return;
      }
    }

    const nextResumeTime = Number(effectiveCurrentTime.toFixed(2));
    localStorage.setItem(resumeStorageKey, String(nextResumeTime));
    persistContinueWatchingEntry(nextResumeTime);
    resumeTime = nextResumeTime;
    lastPersistedResumeTime = nextResumeTime;
    lastPersistedResumeAt = now;
  } catch {
    // Ignore storage access issues.
  }
}

function buildPlaybackSessionProgressPayload(positionSeconds, healthState = "healthy", lastError = "", eventType = "") {
  const sourceHash = String(activePlaybackSession?.sourceHash || "").trim();
  return {
    tmdbId,
    audioLang: preferredAudioLang,
    quality: preferredQuality,
    positionSeconds: Math.max(0, Number(positionSeconds) || 0),
    healthState,
    lastError: String(lastError || ""),
    sourceHash,
    eventType: String(eventType || ""),
  };
}

function sendPlaybackSessionProgressBeacon(positionSeconds, healthState = "healthy", lastError = "", eventType = "") {
  if (!canSyncPlaybackSession() || typeof navigator.sendBeacon !== "function") {
    return;
  }

  const payload = buildPlaybackSessionProgressPayload(positionSeconds, healthState, lastError, eventType);
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  navigator.sendBeacon("/api/session/progress", blob);
}

async function syncPlaybackSessionProgress({
  force = false,
  healthState = "healthy",
  lastError = "",
  positionSeconds = null,
  eventType = "",
} = {}) {
  if (!canSyncPlaybackSession()) {
    return;
  }

  if (!force && isResolvingSource()) {
    return;
  }

  if (isSyncingSessionProgress) {
    return;
  }

  const now = Date.now();
  const nextPosition = Number.isFinite(Number(positionSeconds))
    ? Math.max(0, Number(positionSeconds))
    : Math.max(0, getEffectiveCurrentTime());
  const healthyUpdate = healthState === "healthy";

  if (!force && healthyUpdate) {
    if (now - lastSessionProgressSyncAt < sessionProgressSyncIntervalMs) {
      return;
    }
    if (Math.abs(nextPosition - lastSessionProgressSyncedPosition) < sessionProgressMinimumDeltaSeconds) {
      return;
    }
  }

  isSyncingSessionProgress = true;
  try {
    const payload = buildPlaybackSessionProgressPayload(nextPosition, healthState, lastError, eventType);
    const response = await requestJson("/api/session/progress", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, 10000);
    if (response?.session) {
      activePlaybackSession = response.session;
    }
    lastSessionProgressSyncAt = now;
    lastSessionProgressSyncedPosition = nextPosition;
  } catch {
    // Ignore sync errors; playback should continue using local state.
  } finally {
    isSyncingSessionProgress = false;
  }
}

async function tryPlay() {
  if (!hasActiveSource()) {
    return;
  }

  try {
    await video.play();
  } catch (error) {
    syncPlayState();
  }
}

async function togglePlayback() {
  if (!hasActiveSource() || isResolvingSource()) {
    return;
  }

  if (video.paused) {
    await tryPlay();
  } else {
    video.pause();
  }

  syncPlayState();
}

function seekToAbsoluteTime(targetSeconds, { showLoading = false } = {}) {
  const clampedTarget = Math.max(0, Number(targetSeconds) || 0);
  if (showLoading) {
    showSeekLoadingIndicator();
  }
  if (!isTranscodeSourceActive()) {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.min(video.duration, clampedTarget);
    } else {
      video.currentTime = clampedTarget;
    }
    return;
  }

  if (!activeTranscodeInput) {
    return;
  }

  const shouldResumePlayback = !video.paused;
  setVideoSource(buildSoftwareDecodeUrl(
    activeTranscodeInput,
    clampedTarget,
    activeAudioStreamIndex,
    activeAudioSyncMs || preferredAudioSyncMs,
    selectedSubtitleStreamIndex,
  ));
  if (shouldResumePlayback) {
    void tryPlay();
  }
}

async function requestJson(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
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
    if (error.name === "AbortError" || error.message === "Request timed out.") {
      throw new Error("Request timed out.");
    }
    throw error;
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function resolveTmdbMovieViaBackend(tmdbMovieId) {
  const query = new URLSearchParams({
    tmdbId: tmdbMovieId,
    title,
    year,
    audioLang: preferredAudioLang,
    quality: preferredQuality,
  });
  if (preferredSubtitleLang) {
    query.set("subtitleLang", preferredSubtitleLang);
  }
  if (selectedSourceHash) {
    query.set("sourceHash", selectedSourceHash);
  }
  if (preferredSourceMinSeeders > 0) {
    query.set("minSeeders", String(preferredSourceMinSeeders));
  }
  if (
    preferredSourceFormats.length > 0
    && preferredSourceFormats.length < supportedSourceFormats.length
  ) {
    query.set("allowedFormats", preferredSourceFormats.join(","));
  }

  try {
    return await requestJson(`/api/resolve/movie?${query.toString()}`, {}, 95000);
  } catch (error) {
    if (!selectedSourceHash) {
      throw error;
    }
    query.delete("sourceHash");
    return requestJson(`/api/resolve/movie?${query.toString()}`, {}, 95000);
  }
}

async function resolveTmdbTvEpisodeViaBackend(tmdbSeriesId, season, episodeOrdinal) {
  const buildQuery = (containerPreference = "", sourceHash = "") => {
    const query = new URLSearchParams({
      tmdbId: tmdbSeriesId,
      title,
      year,
      seasonNumber: String(Math.max(1, Math.floor(Number(season) || 1))),
      episodeNumber: String(Math.max(1, Math.floor(Number(episodeOrdinal) || 1))),
      audioLang: preferredAudioLang,
      quality: preferredQuality,
    });
    if (preferredSubtitleLang) {
      query.set("subtitleLang", preferredSubtitleLang);
    }
    if (containerPreference) {
      query.set("preferredContainer", containerPreference);
    }
    if (sourceHash) {
      query.set("sourceHash", sourceHash);
    }
    if (preferredSourceMinSeeders > 0) {
      query.set("minSeeders", String(preferredSourceMinSeeders));
    }
    if (
      preferredSourceFormats.length > 0
      && preferredSourceFormats.length < supportedSourceFormats.length
    ) {
      query.set("allowedFormats", preferredSourceFormats.join(","));
    }
    return query;
  };

  try {
    return await requestJson(`/api/resolve/tv?${buildQuery(preferredContainer, selectedSourceHash).toString()}`, {}, 95000);
  } catch (error) {
    const shouldFallbackContainer = Boolean(preferredContainer);
    const shouldFallbackSource = Boolean(selectedSourceHash);
    if (!shouldFallbackContainer && !shouldFallbackSource) {
      throw error;
    }
    const fallbackContainer = shouldFallbackContainer ? "" : preferredContainer;
    const fallbackSource = shouldFallbackSource ? "" : selectedSourceHash;
    return requestJson(`/api/resolve/tv?${buildQuery(fallbackContainer, fallbackSource).toString()}`, {}, 95000);
  }
}

async function fetchTmdbSourceOptionsViaBackend() {
  if (!isTmdbResolvedPlayback || !tmdbId) {
    availablePlaybackSources = [];
    renderSourceOptionButtons();
    return;
  }

  const query = new URLSearchParams({
    tmdbId,
    mediaType: isTmdbTvPlayback ? "tv" : "movie",
    title,
    year,
    audioLang: preferredAudioLang,
    quality: preferredQuality,
    limit: "12",
  });
  if (isTmdbTvPlayback) {
    query.set("seasonNumber", String(seasonNumber));
    query.set("episodeNumber", String(episodeNumber));
    if (preferredContainer) {
      query.set("preferredContainer", preferredContainer);
    }
  }
  if (selectedSourceHash) {
    query.set("sourceHash", selectedSourceHash);
  }
  if (preferredSourceMinSeeders > 0) {
    query.set("minSeeders", String(preferredSourceMinSeeders));
  }
  if (
    preferredSourceFormats.length > 0
    && preferredSourceFormats.length < supportedSourceFormats.length
  ) {
    query.set("allowedFormats", preferredSourceFormats.join(","));
  }

  try {
    const payload = await requestJson(`/api/resolve/sources?${query.toString()}`, {}, 45000);
    const options = Array.isArray(payload?.sources) ? payload.sources : [];
    availablePlaybackSources = options
      .map((item) => ({
        ...item,
        sourceHash: normalizeSourceHash(item?.sourceHash || item?.infoHash || ""),
      }))
      .filter((item) => Boolean(item.sourceHash));

    if (selectedSourceHash && !availablePlaybackSources.some((item) => item.sourceHash === selectedSourceHash)) {
      selectedSourceHash = "";
      persistSourceHashInUrl();
    }
    renderSourceOptionButtons();
    syncAudioState();
  } catch {
    availablePlaybackSources = [];
    renderSourceOptionButtons();
  }
}

function persistAudioLangInUrl() {
  const nextParams = new URLSearchParams(window.location.search);
  if (preferredAudioLang === "auto") {
    nextParams.delete("audioLang");
  } else {
    nextParams.set("audioLang", preferredAudioLang);
  }

  const nextQuery = nextParams.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

function persistQualityInUrl() {
  const nextParams = new URLSearchParams(window.location.search);
  if (preferredQuality === "auto") {
    nextParams.delete("quality");
  } else {
    nextParams.set("quality", preferredQuality);
  }

  const nextQuery = nextParams.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

function persistSourceHashInUrl() {
  const nextParams = new URLSearchParams(window.location.search);
  if (selectedSourceHash) {
    nextParams.set("sourceHash", selectedSourceHash);
  } else {
    nextParams.delete("sourceHash");
  }

  const nextQuery = nextParams.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

goBack.addEventListener("click", () => {
  persistResumeTime(true);
  if (isSeriesPlayback) {
    window.location.href = "index.html";
    return;
  }

  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  window.location.href = "index.html";
});

togglePlay.addEventListener("click", togglePlayback);

rewind10.addEventListener("click", () => {
  if (!hasActiveSource() || isResolvingSource()) {
    return;
  }

  seekToAbsoluteTime(getEffectiveCurrentTime() - 10);
});

forward10.addEventListener("click", () => {
  if (!hasActiveSource() || isResolvingSource()) {
    return;
  }

  seekToAbsoluteTime(getEffectiveCurrentTime() + 10);
});

toggleMutePlayer.addEventListener("click", () => {
  if (!hasActiveSource() || isResolvingSource()) {
    return;
  }

  video.muted = !video.muted;
  syncMuteState();
});

async function toggleFullscreenMode() {
  if (!document.fullscreenElement) {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Ignore fullscreen errors in restricted environments.
    }
    return;
  }

  try {
    await document.exitFullscreen();
  } catch {
    // Ignore fullscreen errors in restricted environments.
  }
}

toggleFullscreen.addEventListener("click", async () => {
  await toggleFullscreenMode();
});

nextEpisode?.addEventListener("click", () => {
  if (!hasSeriesEpisodeControls || isResolvingSource()) {
    return;
  }
  navigateToSeriesEpisode(seriesEpisodeIndex + 1);
});

toggleSpeed.addEventListener("click", (event) => {
  event.preventDefault();
  if (!speedControl || isResolvingSource()) {
    return;
  }

  const shouldOpen = !speedControl.classList.contains("is-open");
  if (shouldOpen) {
    openSpeedPopover();
  } else {
    closeSpeedPopover(false);
  }
});

toggleEpisodes?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!episodesControl || isResolvingSource()) {
    return;
  }

  const shouldOpen = !episodesControl.classList.contains("is-open");
  if (shouldOpen) {
    openEpisodesPopover();
  } else {
    closeEpisodesPopover();
  }
});

toggleAudio?.addEventListener("click", (event) => {
  event.preventDefault();
  if (!audioControl || isResolvingSource()) {
    return;
  }

  const shouldOpen = !audioControl.classList.contains("is-open");
  if (shouldOpen) {
    openAudioPopover();
  } else {
    closeAudioPopover();
  }
});

if (speedControl) {
  speedControl.addEventListener("mouseenter", openSpeedPopover);
  speedControl.addEventListener("mouseleave", () => closeSpeedPopover(true));
  speedControl.addEventListener("focusin", openSpeedPopover);
  speedControl.addEventListener("focusout", () => closeSpeedPopover(true));
}

if (episodesControl) {
  episodesControl.addEventListener("mouseenter", openEpisodesPopover);
  episodesControl.addEventListener("mouseleave", () => closeEpisodesPopover(true));
  episodesControl.addEventListener("focusin", openEpisodesPopover);
  episodesControl.addEventListener("focusout", () => closeEpisodesPopover(true));
}

if (audioControl) {
  audioControl.addEventListener("mouseenter", () => {
    if (isResolvingSource()) {
      return;
    }
    openAudioPopover();
  });
  audioControl.addEventListener("mouseleave", () => closeAudioPopover(true));
  audioControl.addEventListener("focusin", () => {
    if (isResolvingSource()) {
      return;
    }
    openAudioPopover();
  });
  audioControl.addEventListener("focusout", () => closeAudioPopover(true));
}

speedOptions.forEach((option) => {
  option.addEventListener("click", () => {
    if (isResolvingSource()) {
      return;
    }

    const selectedRate = Number(option.dataset.rate);
    if (!Number.isFinite(selectedRate)) {
      return;
    }

    video.playbackRate = selectedRate;
    syncSpeedState();
    closeSpeedPopover(false);
  });
});

episodesList?.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const option = event.target.closest(".episode-preview-item");
  if (!option) {
    return;
  }

  const nextIndex = Number(option.dataset.episodeIndex || -1);
  if (!Number.isFinite(nextIndex)) {
    return;
  }

  navigateToSeriesEpisode(nextIndex);
});

audioOptionsContainer?.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const option = event.target.closest(".audio-option");
  if (!option || option.disabled) {
    return;
  }

  const optionType = String(option.dataset.optionType || "");
  if (optionType !== "audio-lang" && optionType !== "audio-track") {
    return;
  }

  if (optionType === "audio-lang") {
    const nextLang = String(option.dataset.lang || "auto").toLowerCase();
    if (!supportedAudioLangs.has(nextLang) || nextLang === preferredAudioLang) {
      closeAudioPopover();
      return;
    }

    preferredAudioLang = nextLang;
    resolvedTrackPreferenceAudio = nextLang;
    selectedAudioStreamIndex = -1;
    persistAudioLangPreference(preferredAudioLang);
    void persistTrackPreferencesOnServer({
      audioLang: preferredAudioLang,
    });
    syncAudioState();
    persistAudioLangInUrl();
    closeAudioPopover();

    if (!isTmdbResolvedPlayback) {
      return;
    }

    const resumeFrom = getEffectiveCurrentTime();
    tmdbResolveRetries = 0;
    hasReportedSourceSuccess = false;
    showResolver("Switching audio language...");
    try {
      await resolveTmdbSourcesAndPlay();
      if (resumeFrom > 1) {
        seekToAbsoluteTime(resumeFrom);
      }
    } catch (error) {
      console.error("Failed to switch audio language:", error);
      showResolver(error?.message || "Unable to switch language.", { isError: true });
    }
    return;
  }

  const streamIndex = Number(option.dataset.streamIndex || -1);
  const trackLang = String(option.dataset.trackLanguage || "").toLowerCase();
  if (!Number.isFinite(streamIndex) || streamIndex < 0 || streamIndex === selectedAudioStreamIndex) {
    closeAudioPopover();
    return;
  }

  selectedAudioStreamIndex = streamIndex;
  if (trackLang) {
    preferredAudioLang = trackLang;
    resolvedTrackPreferenceAudio = trackLang;
    persistAudioLangPreference(preferredAudioLang);
    persistAudioLangInUrl();
  }
  void persistTrackPreferencesOnServer({
    audioLang: trackLang || preferredAudioLang,
  });
  syncAudioState();
  closeAudioPopover();

  if (!isTmdbResolvedPlayback || !activeTrackSourceInput) {
    return;
  }

  const resumeFrom = getEffectiveCurrentTime();
  const wasPaused = video.paused;
  const selectedSubtitleTrack = getSubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  const shouldKeepEmbeddedSubtitle = shouldUseNativeEmbeddedSubtitleTrack(selectedSubtitleTrack);
  hasReportedSourceSuccess = false;
  showResolver("Switching audio track...");
  if (shouldKeepEmbeddedSubtitle) {
    setVideoSource(buildSoftwareDecodeUrl(
      activeTrackSourceInput,
      0,
      selectedAudioStreamIndex,
      activeAudioSyncMs || preferredAudioSyncMs,
      selectedSubtitleStreamIndex,
    ));
  } else {
    setVideoSource(buildHlsPlaybackUrl(activeTrackSourceInput, selectedAudioStreamIndex, -1));
  }
  applySubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  hideResolver();
  if (!wasPaused) {
    await tryPlay();
  }
  if (resumeFrom > 1) {
    seekToAbsoluteTime(resumeFrom);
  }
});

subtitleOptionsContainer?.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const option = event.target.closest(".subtitle-option");
  if (!option || option.disabled) {
    return;
  }

  const streamIndex = Number(option.dataset.subtitleStream || -1);
  if (!Number.isFinite(streamIndex)) {
    return;
  }

  const previousSubtitleTrack = getSubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  if (streamIndex === selectedSubtitleStreamIndex || (streamIndex < 0 && selectedSubtitleStreamIndex < 0)) {
    closeAudioPopover();
    return;
  }

  selectedSubtitleStreamIndex = streamIndex >= 0 ? streamIndex : -1;
  const selectedTrack = getSubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  const useNativeEmbeddedSubtitle = shouldUseNativeEmbeddedSubtitleTrack(selectedTrack);
  const usedNativeEmbeddedBefore = shouldUseNativeEmbeddedSubtitleTrack(previousSubtitleTrack);
  preferredSubtitleLang = selectedSubtitleStreamIndex >= 0
    ? String(option.dataset.subtitleLang || "")
    : "off";
  preferredSubtitleLang = normalizeSubtitlePreference(preferredSubtitleLang);
  persistSubtitleLangPreference(preferredSubtitleLang);
  persistSubtitleStreamPreference(selectedSubtitleStreamIndex);
  void persistTrackPreferencesOnServer({
    subtitleLang: preferredSubtitleLang,
  });

  if (
    isTmdbResolvedPlayback
    && activeTrackSourceInput
    && (useNativeEmbeddedSubtitle || usedNativeEmbeddedBefore)
  ) {
    const resumeFrom = getEffectiveCurrentTime();
    const wasPaused = video.paused;
    hasReportedSourceSuccess = false;
    showResolver(selectedSubtitleStreamIndex >= 0 ? "Switching subtitles..." : "Turning subtitles off...");
    const remuxSubtitleStreamIndex = useNativeEmbeddedSubtitle ? selectedSubtitleStreamIndex : -1;
    setVideoSource(buildSoftwareDecodeUrl(
      activeTrackSourceInput,
      0,
      selectedAudioStreamIndex,
      activeAudioSyncMs || preferredAudioSyncMs,
      remuxSubtitleStreamIndex,
    ));
    applySubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
    hideResolver();
    if (!wasPaused) {
      await tryPlay();
    }
    if (resumeFrom > 1) {
      seekToAbsoluteTime(resumeFrom);
    }
  } else {
    applySubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  }

  syncAudioState();
  closeAudioPopover();
});

sourceOptionsContainer?.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const option = event.target.closest(".source-option");
  if (!option || option.disabled || isResolvingSource()) {
    return;
  }

  const nextSourceHash = normalizeSourceHash(option.dataset.sourceHash || "");
  if (!nextSourceHash) {
    return;
  }

  if (nextSourceHash === selectedSourceHash) {
    closeAudioPopover();
    return;
  }

  const previousSourceHash = selectedSourceHash;
  selectedSourceHash = nextSourceHash;
  persistSourceHashInUrl();
  syncAudioState();
  closeAudioPopover();

  if (!isTmdbResolvedPlayback) {
    return;
  }

  const resumeFrom = getEffectiveCurrentTime();
  const wasPaused = video.paused;
  tmdbResolveRetries = 0;
  hasReportedSourceSuccess = false;
  showResolver("Switching source...");
  try {
    await resolveTmdbSourcesAndPlay();
    if (!wasPaused) {
      await tryPlay();
    }
    if (resumeFrom > 1) {
      seekToAbsoluteTime(resumeFrom);
    }
  } catch (error) {
    selectedSourceHash = previousSourceHash;
    persistSourceHashInUrl();
    syncAudioState();
    const fallbackMessage = error?.message || "Unable to switch source.";
    showResolver(fallbackMessage, { isError: true });
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!speedControl) {
    return;
  }

  if (speedControl.contains(event.target)) {
    return;
  }

  closeSpeedPopover(false);
});

document.addEventListener("pointerdown", (event) => {
  if (!episodesControl) {
    return;
  }

  if (episodesControl.contains(event.target)) {
    return;
  }

  closeEpisodesPopover();
});

document.addEventListener("pointerdown", (event) => {
  if (!audioControl) {
    return;
  }

  if (audioControl.contains(event.target)) {
    return;
  }

  closeAudioPopover();
});

video.addEventListener("ratechange", () => {
  if (!playbackRates.includes(video.playbackRate)) {
    const nearestRate = playbackRates.reduce((closest, rate) => {
      return Math.abs(rate - video.playbackRate) < Math.abs(closest - video.playbackRate) ? rate : closest;
    }, playbackRates[0]);
    video.playbackRate = nearestRate;
  }
  syncSpeedState();
});

seekBar.addEventListener("pointerdown", () => {
  isDraggingSeek = true;
  pendingStandardSeekRatio = null;
});

function handleSeekPointerUp() {
  if (!isDraggingSeek) {
    return;
  }
  isDraggingSeek = false;
  const seekScaleDurationSeconds = getSeekScaleDurationSeconds();
  if (seekScaleDurationSeconds <= 0) {
    pendingTranscodeSeekRatio = null;
    pendingStandardSeekRatio = null;
    return;
  }

  if (pendingTranscodeSeekRatio !== null && isTranscodeSourceActive()) {
    seekToAbsoluteTime(pendingTranscodeSeekRatio * seekScaleDurationSeconds, { showLoading: true });
  } else if (pendingStandardSeekRatio !== null && !isTranscodeSourceActive()) {
    seekToAbsoluteTime(pendingStandardSeekRatio * seekScaleDurationSeconds, { showLoading: true });
  }

  pendingTranscodeSeekRatio = null;
  pendingStandardSeekRatio = null;
}

seekBar.addEventListener("pointerup", handleSeekPointerUp);
seekBar.addEventListener("pointercancel", handleSeekPointerUp);
document.addEventListener("pointerup", handleSeekPointerUp);

seekBar.addEventListener("input", () => {
  const seekScaleDurationSeconds = getSeekScaleDurationSeconds();
  if (!hasActiveSource() || isResolvingSource() || seekScaleDurationSeconds <= 0) {
    return;
  }

  const ratio = Number(seekBar.value) / 1000;
  if (isTranscodeSourceActive()) {
    pendingTranscodeSeekRatio = ratio;
    paintSeekProgress(seekBar.value, getBufferedSeekValue(seekScaleDurationSeconds));
    return;
  }

  paintSeekProgress(seekBar.value, getBufferedSeekValue(seekScaleDurationSeconds));
  if (isDraggingSeek) {
    pendingStandardSeekRatio = ratio;
    return;
  }
  seekToAbsoluteTime(ratio * seekScaleDurationSeconds, { showLoading: true });
});

video.addEventListener("loadedmetadata", () => {
  syncSubtitleTrackVisibility();
  refreshActiveSubtitlePlacement();
  window.setTimeout(() => {
    syncSubtitleTrackVisibility();
    refreshActiveSubtitlePlacement();
  }, 200);
  const timelineDurationSeconds = getTimelineDurationSeconds();
  const seekScaleDurationSeconds = getSeekScaleDurationSeconds();
  if (!hasAppliedInitialResume && Number.isFinite(resumeTime) && resumeTime > 1 && resumeTime < seekScaleDurationSeconds - 8) {
    if (isTranscodeSourceActive()) {
      const relativeResume = resumeTime - transcodeBaseOffsetSeconds;
      if (relativeResume >= 0 && Number.isFinite(video.duration) && relativeResume < video.duration - 3) {
        video.currentTime = relativeResume;
      } else {
        seekToAbsoluteTime(resumeTime);
      }
    } else if (resumeTime < timelineDurationSeconds - 8) {
      video.currentTime = resumeTime;
    }
    hasAppliedInitialResume = true;
  }
  if (!hasAppliedInitialResume) {
    hasAppliedInitialResume = true;
  }

  if (seekScaleDurationSeconds > 0) {
    durationText.textContent = formatTime(Math.max(0, seekScaleDurationSeconds - getEffectiveCurrentTime()));
  }
  syncSeekState();
  paintSeekProgress(seekBar.value, getBufferedSeekValue(seekScaleDurationSeconds));
});
if (video.textTracks && typeof video.textTracks.addEventListener === "function") {
  video.textTracks.addEventListener("addtrack", () => {
    syncSubtitleTrackVisibility();
    refreshActiveSubtitlePlacement();
  });
}
window.addEventListener("resize", refreshActiveSubtitlePlacement);
document.addEventListener("fullscreenchange", refreshActiveSubtitlePlacement);

video.addEventListener("timeupdate", syncSeekState);
video.addEventListener("progress", syncSeekState);
video.addEventListener("durationchange", syncSeekState);
video.addEventListener("waiting", () => {
  scheduleStreamStallRecovery("Stream stalled, trying another source...");
});
video.addEventListener("stalled", () => {
  scheduleStreamStallRecovery("Stream stalled, trying another source...");
});
video.addEventListener("seeked", () => {
  if (video.paused || video.readyState >= 2) {
    hideSeekLoadingIndicator();
  }
});
video.addEventListener("canplay", () => {
  clearStreamStallRecovery();
  hideSeekLoadingIndicator();
});
video.addEventListener("playing", () => {
  clearStreamStallRecovery();
  hideSeekLoadingIndicator();
});
video.addEventListener("timeupdate", () => {
  if (getEffectiveCurrentTime() > 0.5) {
    clearStreamStallRecovery();
  }
  persistResumeTime(false);
  void syncPlaybackSessionProgress();
  if (!hasReportedSourceSuccess && getEffectiveCurrentTime() >= 45) {
    hasReportedSourceSuccess = true;
    void syncPlaybackSessionProgress({
      force: true,
      eventType: "success",
    });
  }
});
video.addEventListener("play", syncPlayState);
video.addEventListener("play", () => {
  scheduleStreamStallRecovery("Stream stalled, trying another source...");
  showControls();
  scheduleControlsHide();
});
video.addEventListener("pause", syncPlayState);
video.addEventListener("pause", () => {
  clearControlsHideTimer();
  showControls();
});
video.addEventListener("pause", () => {
  clearStreamStallRecovery();
  persistResumeTime(true);
  void syncPlaybackSessionProgress({ force: true });
});
video.addEventListener("ended", () => {
  const expectedDuration = getDisplayDurationSeconds();
  const effectiveCurrent = getEffectiveCurrentTime();
  const endedTooEarly = isTmdbResolvedPlayback
    && Number.isFinite(expectedDuration)
    && expectedDuration > 120
    && effectiveCurrent < expectedDuration - 45;

  if (endedTooEarly) {
    void syncPlaybackSessionProgress({
      force: true,
      healthState: "invalid",
      lastError: "Stream ended early.",
      eventType: "ended_early",
    });
    const recovered = attemptTmdbRecovery("Stream ended early, trying another source...");
    if (recovered) {
      return;
    }
  }

  try {
    localStorage.removeItem(resumeStorageKey);
    removeContinueWatchingEntry();
  } catch {
    // Ignore storage access issues.
  }
  resumeTime = 0;
  lastPersistedResumeTime = 0;
  lastPersistedResumeAt = 0;
  void syncPlaybackSessionProgress({
    force: true,
    positionSeconds: 0,
    healthState: "healthy",
    eventType: "success",
  });
});
video.addEventListener("volumechange", syncMuteState);
video.addEventListener("canplay", () => {
  if (isTmdbResolvedPlayback) {
    hideResolver();
  }
});
video.addEventListener("error", () => {
  hideSeekLoadingIndicator();
  if (!isTmdbResolvedPlayback) {
    return;
  }

  const mediaError = video.error;
  const message = mediaError?.message || "Resolved stream could not be played. Try again.";
  const inferredDecodeFailure = /decode|demuxer|ffmpeg|format/i.test(message);
  void syncPlaybackSessionProgress({
    force: true,
    healthState: "invalid",
    lastError: message,
    eventType: inferredDecodeFailure ? "decode_failure" : "playback_error",
  });

  if (attemptTmdbRecovery("Trying alternate source...")) {
    return;
  }

  showResolver(message, { isError: true });
});

function isInteractiveTarget(target) {
  if (!target || !(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest("button, input, textarea, select, [contenteditable='true']"));
}

playerShell.addEventListener("click", (event) => {
  showControls();
  scheduleControlsHide();
  playerShell.focus();
  if (isInteractiveTarget(event.target)) {
    return;
  }

  clearSingleClickPlaybackToggle();
  singleClickPlaybackToggleTimeout = window.setTimeout(() => {
    singleClickPlaybackToggleTimeout = null;
    void togglePlayback();
  }, singleClickToggleDelayMs);
});

playerShell.addEventListener("dblclick", (event) => {
  if (isInteractiveTarget(event.target)) {
    return;
  }
  event.preventDefault();
  clearSingleClickPlaybackToggle();
  void toggleFullscreenMode();
});

playerShell.addEventListener("mousemove", handleUserActivity);
playerShell.addEventListener("touchstart", handleUserActivity, { passive: true });
playerShell.addEventListener("pointerdown", handleUserActivity);

async function handleKeydown(event) {
  handleUserActivity();

  if (event.key === " " || event.key === "Spacebar" || event.code === "Space") {
    if (isInteractiveTarget(event.target) || isResolvingSource()) {
      return;
    }

    if (event.repeat) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    await togglePlayback();
    return;
  }

  if (event.key === "ArrowLeft") {
    if (isInteractiveTarget(event.target)) {
      return;
    }
    if (hasActiveSource() && !isResolvingSource()) {
      seekToAbsoluteTime(getEffectiveCurrentTime() - 10);
    }
  }

  if (event.key === "ArrowRight") {
    if (isInteractiveTarget(event.target)) {
      return;
    }
    if (!hasActiveSource() || isResolvingSource()) {
      return;
    }

    seekToAbsoluteTime(getEffectiveCurrentTime() + 10);
  }

  if (event.key.toLowerCase() === "m") {
    if (isInteractiveTarget(event.target)) {
      return;
    }
    if (!hasActiveSource() || isResolvingSource()) {
      return;
    }

    video.muted = !video.muted;
    syncMuteState();
  }

  if (event.key.toLowerCase() === "f") {
    if (isInteractiveTarget(event.target)) {
      return;
    }
    await toggleFullscreenMode();
  }

  if (event.key === "Escape" && !document.fullscreenElement) {
    if (audioControl?.classList.contains("is-open")) {
      closeAudioPopover();
      return;
    }

    if (episodesControl?.classList.contains("is-open")) {
      closeEpisodesPopover();
      return;
    }

    if (speedControl?.classList.contains("is-open")) {
      closeSpeedPopover(false);
      return;
    }
    persistResumeTime(true);
    window.location.href = "index.html";
  }
}

window.addEventListener("keydown", handleKeydown, { capture: true });
window.addEventListener("storage", (event) => {
  if (!event.key || event.key === SUBTITLE_COLOR_PREF_KEY) {
    applySubtitleCueColor(event.newValue);
  }

  if (event.key === SOURCE_MIN_SEEDERS_PREF_KEY || event.key === SOURCE_ALLOWED_FORMATS_PREF_KEY) {
    preferredSourceMinSeeders = getStoredSourceMinSeeders();
    preferredSourceFormats = getStoredSourceFormats();
    if (isTmdbResolvedPlayback && audioControl?.classList.contains("is-open")) {
      void fetchTmdbSourceOptionsViaBackend();
    }
  }
});
window.addEventListener("beforeunload", () => {
  clearSingleClickPlaybackToggle();
  hideSeekLoadingIndicator();
  clearControlsHideTimer();
  clearStreamStallRecovery();
  persistResumeTime(true);
  sendPlaybackSessionProgressBeacon(
    getEffectiveCurrentTime(),
    "healthy",
    "",
    hasReportedSourceSuccess ? "success" : "",
  );
  destroyHlsInstance();
});

async function initPlaybackSource() {
  hasAppliedInitialResume = false;
  pendingTranscodeSeekRatio = null;
  resetPlaybackSessionState();
  availableAudioTracks = [];
  availableSubtitleTracks = [];
  selectedAudioStreamIndex = -1;
  selectedSubtitleStreamIndex = -1;
  activeTrackSourceInput = "";
  rebuildTrackOptionButtons();

  if (hasExplicitSource) {
    tmdbExpectedDurationSeconds = 0;
    hideResolver();
    const nextSource = shouldUseSoftwareDecode(src)
      ? buildSoftwareDecodeUrl(src, 0, -1, preferredAudioSyncMs)
      : src;
    setVideoSource(nextSource);
    await tryPlay();
    return;
  }

  if (!isTmdbResolvedPlayback) {
    tmdbExpectedDurationSeconds = 0;
    setVideoSource(src || DEFAULT_TRAILER_SOURCE);
    hideResolver();
    await tryPlay();
    return;
  }

  try {
    showResolver("Loading video...");
    await resolveTmdbSourcesAndPlay();
  } catch (error) {
    console.error("Failed to resolve TMDB playback via Real-Debrid:", error);
    showResolver(error.message || "Unable to resolve this stream.", { isError: true });
  }
}

syncMuteState();
syncPlayState();
syncSpeedState();
syncSourcePanelVisibility();
rebuildTrackOptionButtons();
syncAudioState();
applySubtitleCueColor();
stripAudioSyncFromPageUrl();
if (isTmdbResolvedPlayback && !hasAudioLangParam && preferredAudioLang !== "auto") {
  persistAudioLangInUrl();
}
if (isTmdbResolvedPlayback && !hasQualityParam && preferredQuality !== "auto") {
  persistQualityInUrl();
}
showControls();
paintSeekProgress(seekBar.value);
scheduleControlsHide();
initPlaybackSource();

playerShell.focus();
