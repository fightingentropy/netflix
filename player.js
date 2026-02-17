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
const toggleAudio = document.getElementById("toggleAudio");
const audioControl = document.getElementById("audioControl");
const audioOptionsContainer = document.getElementById("audioOptions");
const subtitleOptionsContainer = document.getElementById("subtitleOptions");
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
let subtitleTrackElement = null;
let resolvedTrackPreferenceAudio = "auto";
let preferredSubtitleLang = "";
let audioOptions = [];
let subtitleOptions = [];

const params = new URLSearchParams(window.location.search);
const title = params.get("title") || "Jeffrey Epstein: Filthy Rich";
const episode = params.get("episode") || "Official Trailer";
const src = (params.get("src") || "").trim();
const tmdbId = (params.get("tmdbId") || "").trim();
const mediaType = (params.get("mediaType") || "").trim();
const year = (params.get("year") || "").trim();
const hasAudioLangParam = params.has("audioLang");
const audioLangParam = (params.get("audioLang") || "auto").trim().toLowerCase();
const hasQualityParam = params.has("quality");
const qualityParam = (params.get("quality") || "auto").trim().toLowerCase();
const hasSubtitleLangParam = params.has("subtitleLang");
const subtitleLangParam = (params.get("subtitleLang") || "").trim().toLowerCase();
const hasExplicitSource = Boolean(src);
const isTmdbMoviePlayback = Boolean(!hasExplicitSource && tmdbId && mediaType === "movie");
const supportedAudioLangs = new Set(["auto", "en", "fr", "es", "de", "it", "pt", "ja", "ko", "zh", "nl", "ro"]);
const AUDIO_LANG_PREF_KEY_PREFIX = "netflix-audio-lang:movie:";
const SUBTITLE_LANG_PREF_KEY_PREFIX = "netflix-subtitle-lang:movie:";
const SUBTITLE_STREAM_PREF_KEY_PREFIX = "netflix-subtitle-stream:movie:";
const STREAM_QUALITY_PREF_KEY = "netflix-stream-quality-pref";
const SUBTITLE_COLOR_PREF_KEY = "netflix-subtitle-color-pref";
const DEFAULT_SUBTITLE_COLOR = "#b8bcc3";
const supportedQualityPreferences = new Set(["auto", "2160p", "1080p", "720p"]);
const AUDIO_SYNC_MIN_MS = -1500;
const AUDIO_SYNC_MAX_MS = 1500;
const RESUME_SAVE_MIN_INTERVAL_MS = 3000;
const RESUME_SAVE_MIN_DELTA_SECONDS = 1.5;
const RESUME_CLEAR_AT_END_THRESHOLD_SECONDS = 8;
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
let preferredAudioSyncMs = 0;
preferredSubtitleLang = normalizeSubtitlePreference(subtitleLangParam);
if (isTmdbMoviePlayback && !hasSubtitleLangParam) {
  preferredSubtitleLang = getStoredSubtitleLangForTmdbMovie(tmdbId) || preferredSubtitleLang;
}
if (isTmdbMoviePlayback && hasSubtitleLangParam) {
  persistSubtitleLangPreference(preferredSubtitleLang);
}
const sourceIdentity = src || (isTmdbMoviePlayback ? `tmdb:${tmdbId}` : "intro.mp4");
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

  const selectedTrack = availableSubtitleTracks.find((track) => Number(track?.streamIndex) === safeStreamIndex);
  if (!selectedTrack) {
    selectedSubtitleStreamIndex = -1;
    return;
  }

  if (!selectedTrack.vttUrl) {
    selectedSubtitleStreamIndex = -1;
    return;
  }

  selectedSubtitleStreamIndex = safeStreamIndex;
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
  showSubtitleTrackElement(trackElement);
  window.setTimeout(() => {
    showSubtitleTrackElement(trackElement);
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

  availableSubtitleTracks.forEach((track) => {
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
  if (!isTmdbMoviePlayback || tmdbSourceAttemptIndex >= tmdbSourceQueue.length) {
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
  const resolved = await resolveTmdbMovieViaBackend(tmdbId);
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
  setTmdbSourceQueue(resolved.playableUrl, resolved.fallbackUrls);
  setVideoSource(tmdbSourceQueue[0] || resolved.playableUrl);
  applySubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  syncAudioState();
  hideResolver();
  const runtimeSeconds = Number(resolved.metadata?.runtimeSeconds || 0);
  tmdbExpectedDurationSeconds = Number.isFinite(runtimeSeconds) && runtimeSeconds > 0 ? runtimeSeconds : 0;

  if (resolved.metadata?.displayTitle) {
    const releaseYear = String(resolved.metadata.displayYear || "").trim();
    setEpisodeLabel(resolved.metadata.displayTitle, releaseYear ? `(${releaseYear})` : "");
  }

  await tryPlay();
}

function attemptTmdbRecovery(message) {
  if (!isTmdbMoviePlayback || isRecoveringTmdbStream) {
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
  const formattedEpisode = String(currentEpisode || "").replace(/^(E\d+)\s+/i, "$1: ");
  episodeLabel.textContent = "";

  const strong = document.createElement("b");
  strong.textContent = currentTitle;
  episodeLabel.appendChild(strong);

  if (formattedEpisode) {
    episodeLabel.append(` ${formattedEpisode}`);
  }
}

setEpisodeLabel(title, episode);

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
}

function getTimelineDurationSeconds() {
  const duration = Number(video.duration);
  if (Number.isFinite(duration) && duration > 0) {
    knownDurationSeconds = Math.max(knownDurationSeconds, duration);
  }
  return knownDurationSeconds;
}

function getDisplayDurationSeconds() {
  if (isTmdbMoviePlayback && tmdbExpectedDurationSeconds > 0) {
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

  window.clearTimeout(audioPopoverCloseTimeout);
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
  if (!isTmdbMoviePlayback || video.paused) {
    return;
  }

  const checkpointTime = getEffectiveCurrentTime();
  clearStreamStallRecovery();

  streamStallRecoveryTimeout = window.setTimeout(() => {
    if (!isTmdbMoviePlayback || video.paused) {
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
      resumeTime = 0;
      lastPersistedResumeTime = 0;
      lastPersistedResumeAt = 0;
      return;
    }

    if (effectiveCurrentTime < 1) {
      if (force) {
        localStorage.removeItem(resumeStorageKey);
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

  return requestJson(`/api/resolve/movie?${query.toString()}`, {}, 95000);
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

goBack.addEventListener("click", () => {
  persistResumeTime(true);
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

    if (!isTmdbMoviePlayback) {
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

  if (!isTmdbMoviePlayback || !activeTrackSourceInput) {
    return;
  }

  const resumeFrom = getEffectiveCurrentTime();
  const wasPaused = video.paused;
  hasReportedSourceSuccess = false;
  showResolver("Switching audio track...");
  setVideoSource(buildHlsPlaybackUrl(activeTrackSourceInput, selectedAudioStreamIndex, selectedSubtitleStreamIndex));
  applySubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  hideResolver();
  if (!wasPaused) {
    await tryPlay();
  }
  if (resumeFrom > 1) {
    seekToAbsoluteTime(resumeFrom);
  }
});

subtitleOptionsContainer?.addEventListener("click", (event) => {
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

  if (streamIndex === selectedSubtitleStreamIndex || (streamIndex < 0 && selectedSubtitleStreamIndex < 0)) {
    closeAudioPopover();
    return;
  }

  selectedSubtitleStreamIndex = streamIndex >= 0 ? streamIndex : -1;
  preferredSubtitleLang = selectedSubtitleStreamIndex >= 0
    ? String(option.dataset.subtitleLang || "")
    : "off";
  preferredSubtitleLang = normalizeSubtitlePreference(preferredSubtitleLang);
  persistSubtitleLangPreference(preferredSubtitleLang);
  persistSubtitleStreamPreference(selectedSubtitleStreamIndex);
  void persistTrackPreferencesOnServer({
    subtitleLang: preferredSubtitleLang,
  });
  applySubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  syncAudioState();
  closeAudioPopover();
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
  refreshActiveSubtitlePlacement();
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
  const endedTooEarly = isTmdbMoviePlayback
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
  if (isTmdbMoviePlayback) {
    hideResolver();
  }
});
video.addEventListener("error", () => {
  hideSeekLoadingIndicator();
  if (!isTmdbMoviePlayback) {
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
  if (event.key && event.key !== SUBTITLE_COLOR_PREF_KEY) {
    return;
  }
  applySubtitleCueColor(event.newValue);
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

  if (!isTmdbMoviePlayback) {
    tmdbExpectedDurationSeconds = 0;
    setVideoSource(src || "intro.mp4");
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
rebuildTrackOptionButtons();
syncAudioState();
applySubtitleCueColor();
stripAudioSyncFromPageUrl();
if (isTmdbMoviePlayback && !hasAudioLangParam && preferredAudioLang !== "auto") {
  persistAudioLangInUrl();
}
if (isTmdbMoviePlayback && !hasQualityParam && preferredQuality !== "auto") {
  persistQualityInUrl();
}
showControls();
paintSeekProgress(seekBar.value);
scheduleControlsHide();
initPlaybackSource();

playerShell.focus();
