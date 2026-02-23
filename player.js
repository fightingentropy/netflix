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
const subtitlePanel = document.getElementById("subtitlePanel");
const audioTabSubtitles = document.getElementById("audioTabSubtitles");
const audioTabSources = document.getElementById("audioTabSources");
const sourcePanel = document.getElementById("sourcePanel");
const sourceOptionsContainer = document.getElementById("sourceOptions");
const sourceOptionDetails = document.getElementById("sourceOptionDetails");
const episodeLabel = document.getElementById("episodeLabel");
const resolverOverlay = document.getElementById("resolverOverlay");
const resolverStatus = document.getElementById("resolverStatus");
const resolverLoader = document.getElementById("resolverLoader");
const seekLoadingOverlay = document.getElementById("seekLoadingOverlay");
const playerShell = document.querySelector(".player-shell");

const playbackRates = [0.5, 0.75, 1, 1.25, 1.5];
const controlsHideDelayMs = 3000;
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
let hlsInstance = null;
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
let nativePlaybackLaunched = false;
let activeAudioTab = "subtitles";
let seriesEpisodeThumbHydrationTask = null;
let hasHydratedSeriesEpisodeThumbs = false;

const params = new URLSearchParams(window.location.search);
const DEFAULT_TRAILER_SOURCE = "assets/videos/intro.mp4";
const DEFAULT_EPISODE_THUMBNAIL = "assets/images/thumbnail.jpg";
const JEFFREY_EPSTEIN_EPISODE_1_SOURCE =
  "assets/videos/Jeffrey.Epstein.Filthy.Rich.S01E01.2160p.NF.WEB-DL.DDP5.1.SDR.HEVC-DiSGUSTiNG.mp4";
const STATIC_SERIES_LIBRARY = {
  "jeffrey-epstein-filthy-rich": {
    id: "jeffrey-epstein-filthy-rich",
    title: "Jeffrey Epstein: Filthy Rich",
    tmdbId: "103506",
    year: "2020",
    preferredContainer: "mp4",
    requiresLocalEpisodeSources: true,
    episodes: [
      {
        title: "Hunting Grounds",
        description:
          'Survivors recount how Epstein abused, manipulated and silenced them as he ran a so-called molestation "pyramid scheme" out of his Palm Beach mansion.',
        thumb: "assets/images/jeffrey-epstein-s01e01-thumb.jpg",
        src: JEFFREY_EPSTEIN_EPISODE_1_SOURCE,
        seasonNumber: 1,
        episodeNumber: 1,
      },
      {
        title: "Follow the Money",
        description:
          "The survivors and journalists retrace how Epstein built influence, money and legal insulation for years.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 2,
      },
      {
        title: "The Island",
        description:
          "Victims and insiders detail what happened at Epstein's private island and who enabled access.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 3,
      },
      {
        title: "Finding Their Voice",
        description:
          "Women who were silenced for years step forward publicly and push for accountability.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 4,
      },
    ],
  },
  "breaking-bad": {
    id: "breaking-bad",
    title: "Breaking Bad",
    tmdbId: "1396",
    year: "2008",
    episodes: [
      {
        title: "Pilot",
        description:
          "A chemistry teacher facing a life-changing diagnosis is pushed toward a dangerous new plan.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 1,
      },
      {
        title: "Cat's in the Bag...",
        description:
          "Walt and Jesse scramble to cover their tracks while pressure builds at home and at work.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 2,
      },
      {
        title: "...And the Bag's in the River",
        description:
          "A difficult decision tests Walt's limits as Jesse struggles with the fallout.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 3,
      },
      {
        title: "Cancer Man",
        description:
          "Family tension grows as Walt keeps secrets and Jesse tries to steady his life.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 4,
      },
      {
        title: "Gray Matter",
        description:
          "A job offer from Walt's past creates a conflict between pride, money and survival.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 5,
      },
      {
        title: "Crazy Handful of Nothin'",
        description:
          "Walt adopts a new identity to send a message while family and law pressure increase.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 6,
      },
      {
        title: "A No-Rough-Stuff-Type Deal",
        description:
          "A risky theft and a bigger distribution push leave Walt and Jesse in over their heads.",
        thumb: "assets/images/thumbnail.jpg",
        seasonNumber: 1,
        episodeNumber: 7,
      },
    ],
  },
};

function cloneSeriesEpisode(entry = {}) {
  return {
    title: String(entry?.title || "").trim(),
    description: String(entry?.description || "").trim(),
    thumb: String(entry?.thumb || "").trim() || DEFAULT_EPISODE_THUMBNAIL,
    src: String(entry?.src || "").trim(),
    seasonNumber: Math.max(1, Math.floor(Number(entry?.seasonNumber || 1))),
    episodeNumber: Math.max(1, Math.floor(Number(entry?.episodeNumber || 1))),
  };
}

function mergeSeriesLibraries(staticLibrary = {}, localLibrary = {}) {
  const merged = {};
  const staticEntries = Object.entries(staticLibrary || {});
  const staticTmdbToSeriesId = new Map();

  staticEntries.forEach(([seriesId, series]) => {
    const tmdbId = String(series?.tmdbId || "").trim();
    if (tmdbId) {
      staticTmdbToSeriesId.set(tmdbId, seriesId);
    }
    merged[seriesId] = {
      ...series,
      episodes: Array.isArray(series?.episodes)
        ? series.episodes.map((episode) => cloneSeriesEpisode(episode))
        : [],
    };
  });

  const localEntries = Object.values(localLibrary || {});
  localEntries.forEach((series) => {
    const localTmdbId = String(series?.tmdbId || "").trim();
    const localId = String(series?.id || "")
      .trim()
      .toLowerCase();
    const mappedStaticId =
      localTmdbId && staticTmdbToSeriesId.has(localTmdbId)
        ? staticTmdbToSeriesId.get(localTmdbId)
        : "";
    const targetId = mappedStaticId || localId;
    if (!targetId) {
      return;
    }

    if (!merged[targetId]) {
      merged[targetId] = {
        id: targetId,
        title: String(series?.title || "Series").trim() || "Series",
        tmdbId: localTmdbId,
        year: String(series?.year || "").trim(),
        preferredContainer: "mp4",
        requiresLocalEpisodeSources: true,
        episodes: [],
      };
    }

    const targetSeries = merged[targetId];
    const targetEpisodes = Array.isArray(targetSeries.episodes)
      ? targetSeries.episodes
      : [];
    const localEpisodes = Array.isArray(series?.episodes)
      ? series.episodes
      : [];

    localEpisodes.forEach((episode) => {
      const nextEpisode = cloneSeriesEpisode(episode);
      if (!nextEpisode.src) {
        return;
      }
      const existingIndex = targetEpisodes.findIndex(
        (entry) =>
          Number(entry?.seasonNumber || 1) === nextEpisode.seasonNumber &&
          Number(entry?.episodeNumber || 1) === nextEpisode.episodeNumber,
      );

      if (existingIndex >= 0) {
        targetEpisodes[existingIndex] = {
          ...targetEpisodes[existingIndex],
          src: nextEpisode.src,
          thumb:
            String(nextEpisode.thumb || "").trim() ||
            String(targetEpisodes[existingIndex]?.thumb || "").trim() ||
            DEFAULT_EPISODE_THUMBNAIL,
          title:
            String(targetEpisodes[existingIndex]?.title || "").trim() ||
            nextEpisode.title,
          description:
            String(targetEpisodes[existingIndex]?.description || "").trim() ||
            nextEpisode.description,
        };
      } else {
        targetEpisodes.push(nextEpisode);
      }
    });

    targetEpisodes.sort((left, right) => {
      const seasonDelta =
        Number(left?.seasonNumber || 1) - Number(right?.seasonNumber || 1);
      if (seasonDelta !== 0) {
        return seasonDelta;
      }
      return (
        Number(left?.episodeNumber || 1) - Number(right?.episodeNumber || 1)
      );
    });

    targetSeries.episodes = targetEpisodes;
    targetSeries.requiresLocalEpisodeSources =
      Boolean(targetSeries.requiresLocalEpisodeSources) ||
      Boolean(series?.requiresLocalEpisodeSources);
    if (!String(targetSeries.tmdbId || "").trim() && localTmdbId) {
      targetSeries.tmdbId = localTmdbId;
    }
  });

  return merged;
}

function normalizeLocalSeriesLibrary(payload) {
  const list = Array.isArray(payload?.series) ? payload.series : [];
  const nextLibrary = {};

  list.forEach((entry) => {
    const id = String(entry?.id || "")
      .trim()
      .toLowerCase();
    const title = String(entry?.title || "").trim();
    if (!id || !title) {
      return;
    }
    const episodes = Array.isArray(entry?.episodes)
      ? entry.episodes
          .map((episode, index) => {
            const src = String(episode?.src || "").trim();
            if (!src) {
              return null;
            }
            const seasonNumber = Number(episode?.seasonNumber || 1);
            const episodeNumber = Number(episode?.episodeNumber || index + 1);
            return {
              title:
                String(episode?.title || "").trim() || `Episode ${index + 1}`,
              description: String(episode?.description || "").trim(),
              thumb:
                String(episode?.thumb || "").trim() ||
                DEFAULT_EPISODE_THUMBNAIL,
              src,
              seasonNumber:
                Number.isFinite(seasonNumber) && seasonNumber > 0
                  ? Math.floor(seasonNumber)
                  : 1,
              episodeNumber:
                Number.isFinite(episodeNumber) && episodeNumber > 0
                  ? Math.floor(episodeNumber)
                  : index + 1,
            };
          })
          .filter(Boolean)
      : [];
    if (!episodes.length) {
      return;
    }
    episodes.sort((left, right) => {
      const seasonDelta = left.seasonNumber - right.seasonNumber;
      if (seasonDelta !== 0) {
        return seasonDelta;
      }
      return left.episodeNumber - right.episodeNumber;
    });

    nextLibrary[id] = {
      id,
      title,
      tmdbId: /^\d+$/.test(String(entry?.tmdbId || "").trim())
        ? String(entry.tmdbId).trim()
        : "",
      year: String(entry?.year || "").trim(),
      preferredContainer: "mp4",
      requiresLocalEpisodeSources: true,
      episodes,
    };
  });

  return nextLibrary;
}

async function fetchLocalSeriesLibrary() {
  try {
    const response = await fetch("/api/library");
    if (!response.ok) {
      return {};
    }
    const payload = await response.json().catch(() => null);
    return normalizeLocalSeriesLibrary(payload || {});
  } catch {
    return {};
  }
}

const SERIES_LIBRARY = Object.freeze({
  ...mergeSeriesLibraries(
    STATIC_SERIES_LIBRARY,
    await fetchLocalSeriesLibrary(),
  ),
});
const mediaTypeParam = String(params.get("mediaType") || "")
  .trim()
  .toLowerCase();
const isExplicitTvPlayback = mediaTypeParam === "tv";
const requestedSeriesId = String(params.get("seriesId") || "")
  .trim()
  .toLowerCase();
const hasRequestedEpisodeIndexParam = params.has("episodeIndex");
const requestedEpisodeIndex = Number(params.get("episodeIndex") || 0);
const activeSeries =
  isExplicitTvPlayback &&
  Object.prototype.hasOwnProperty.call(SERIES_LIBRARY, requestedSeriesId)
    ? SERIES_LIBRARY[requestedSeriesId]
    : null;
const seriesEpisodes = Array.isArray(activeSeries?.episodes)
  ? activeSeries.episodes
  : [];
const seriesEpisodeIndex = seriesEpisodes.length
  ? Math.max(
      0,
      Math.min(
        seriesEpisodes.length - 1,
        Number.isFinite(requestedEpisodeIndex)
          ? Math.floor(requestedEpisodeIndex)
          : 0,
      ),
    )
  : -1;
const activeSeriesEpisode =
  seriesEpisodeIndex >= 0 ? seriesEpisodes[seriesEpisodeIndex] : null;
const isSeriesPlayback = isExplicitTvPlayback && Boolean(activeSeriesEpisode);
const hasSeriesEpisodeControls =
  isExplicitTvPlayback &&
  hasRequestedEpisodeIndexParam &&
  Boolean(activeSeries && seriesEpisodes.length > 1);
const rawSourceParam = String(params.get("src") || "").trim();
const thumbParam = String(params.get("thumb") || "").trim();
const src = isSeriesPlayback
  ? String(activeSeriesEpisode?.src || "").trim()
  : rawSourceParam;
const fallbackSeasonNumber = Number(
  params.get("seasonNumber") || params.get("season") || 1,
);
const fallbackEpisodeNumber = Number(
  params.get("episodeNumber") || params.get("episodeOrdinal") || 1,
);
const rawTitle = isSeriesPlayback
  ? String(activeSeries.title || "")
  : params.get("title") || "Jeffrey Epstein: Filthy Rich";
const rawEpisode = isSeriesPlayback
  ? `E${seriesEpisodeIndex + 1} ${activeSeriesEpisode.title}`
  : params.get("episode") || "";
const title = rawTitle;
const episode = rawEpisode;
const tmdbId = String(
  activeSeries?.tmdbId || params.get("tmdbId") || "",
).trim();
const mediaType = isSeriesPlayback ? "tv" : mediaTypeParam;
const year = String(activeSeries?.year || params.get("year") || "").trim();
const seasonNumber = isSeriesPlayback
  ? Math.max(1, Math.floor(Number(activeSeriesEpisode?.seasonNumber || 1)))
  : Number.isFinite(fallbackSeasonNumber)
    ? Math.max(1, Math.floor(fallbackSeasonNumber))
    : 1;
const episodeNumber = isSeriesPlayback
  ? Math.max(
      1,
      Math.floor(
        Number(activeSeriesEpisode?.episodeNumber || seriesEpisodeIndex + 1),
      ),
    )
  : Number.isFinite(fallbackEpisodeNumber)
    ? Math.max(1, Math.floor(fallbackEpisodeNumber))
    : 1;
const hasAudioLangParam = params.has("audioLang");
const audioLangParam = (params.get("audioLang") || "auto").trim().toLowerCase();
const hasQualityParam = params.has("quality");
const qualityParam = (params.get("quality") || "auto").trim().toLowerCase();
const preferredContainerParam = String(
  activeSeries?.preferredContainer || params.get("preferredContainer") || "",
)
  .trim()
  .toLowerCase();
const preferredContainer = preferredContainerParam === "mp4" ? "mp4" : "";
const hasSubtitleLangParam = params.has("subtitleLang");
const subtitleLangParam = (params.get("subtitleLang") || "")
  .trim()
  .toLowerCase();
const sourceHashParam = (params.get("sourceHash") || "").trim().toLowerCase();
const hasExplicitSource = Boolean(src);
const isTmdbMoviePlayback = Boolean(
  !hasExplicitSource && tmdbId && mediaType === "movie",
);
const isTmdbTvPlayback = Boolean(
  !hasExplicitSource && tmdbId && mediaType === "tv",
);
const isTmdbResolvedPlayback = Boolean(isTmdbMoviePlayback || isTmdbTvPlayback);
const supportedAudioLangs = new Set([
  "auto",
  "en",
  "fr",
  "es",
  "de",
  "it",
  "pt",
  "ja",
  "ko",
  "zh",
  "nl",
  "ro",
]);
const AUDIO_LANG_PREF_KEY_PREFIX = "netflix-audio-lang:movie:";
const SUBTITLE_LANG_PREF_KEY_PREFIX = "netflix-subtitle-lang:movie:";
const SUBTITLE_STREAM_PREF_KEY_PREFIX = "netflix-subtitle-stream:movie:";
const STREAM_QUALITY_PREF_KEY = "netflix-stream-quality-pref";
const SOURCE_MIN_SEEDERS_PREF_KEY = "netflix-source-filter-min-seeders";
const SOURCE_ALLOWED_FORMATS_PREF_KEY = "netflix-source-filter-allowed-formats";
const SOURCE_LANGUAGE_PREF_KEY = "netflix-source-filter-language";
const SOURCE_RESULTS_LIMIT_PREF_KEY = "netflix-source-filter-results-limit";
const SOURCE_AUDIO_SYNC_PREF_KEY_PREFIX = "netflix-source-audio-sync:";
const NATIVE_PLAYBACK_MODE_PREF_KEY = "netflix-native-playback-mode";
const REMUX_VIDEO_MODE_PREF_KEY = "netflix-remux-video-mode";
const SUBTITLE_COLOR_PREF_KEY = "netflix-subtitle-color-pref";
const DEFAULT_SUBTITLE_COLOR = "#b8bcc3";
const DEFAULT_SOURCE_RESULTS_LIMIT = 5;
const MAX_SOURCE_RESULTS_LIMIT = 20;
const SOURCE_FETCH_BATCH_LIMIT = 20;
const supportedQualityPreferences = new Set(["auto", "2160p", "1080p", "720p"]);
const supportedSourceFormats = ["mp4"];
const supportedSourceFormatSet = new Set(supportedSourceFormats);
const supportedSourceLanguages = new Set([
  "en",
  "any",
  "fr",
  "es",
  "de",
  "it",
  "pt",
]);
const SOURCE_LANGUAGE_TOKENS = {
  en: ["english", " eng ", "en audio", "dubbed english", " dual audio eng"],
  fr: ["french", " fran", "vf", "vff", " fra "],
  es: ["spanish", "espanol", "castellano", " spa ", " esp "],
  de: ["german", " deutsch", " ger ", " deu "],
  it: ["italian", " italiano", " ita "],
  pt: ["portuguese", " portugues", " por ", " pt-br ", " brazilian "],
};
const AUDIO_SYNC_MIN_MS = -1500;
const AUDIO_SYNC_MAX_MS = 1500;
const AUDIO_SYNC_STEP_MS = 50;
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
let sourceSelectionPinned = false;

function getPinnedSourceHashForRequests() {
  if (!sourceSelectionPinned) {
    return "";
  }
  return normalizeSourceHash(selectedSourceHash);
}

function getAudioLangPreferenceStorageKey(movieTmdbId) {
  return `${AUDIO_LANG_PREF_KEY_PREFIX}${String(movieTmdbId || "").trim()}`;
}

function normalizePreferredQuality(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
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
    return normalizePreferredQuality(
      localStorage.getItem(STREAM_QUALITY_PREF_KEY),
    );
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

function normalizeSourceResultsLimit(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return DEFAULT_SOURCE_RESULTS_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SOURCE_RESULTS_LIMIT;
  }
  return Math.max(1, Math.min(MAX_SOURCE_RESULTS_LIMIT, Math.floor(parsed)));
}

function normalizeSourceFormats(value) {
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
    .filter((item) => supportedSourceFormatSet.has(item));
  const unique = [...new Set(normalized)];
  if (unique.length && !unique.includes("mp4")) {
    unique.unshift("mp4");
  }
  return unique;
}

function normalizeSourceLanguage(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    !normalized ||
    normalized === "en" ||
    normalized === "eng" ||
    normalized === "english"
  ) {
    return "en";
  }
  if (
    normalized === "any" ||
    normalized === "all" ||
    normalized === "auto" ||
    normalized === "*"
  ) {
    return "any";
  }
  if (supportedSourceLanguages.has(normalized)) {
    return normalized;
  }
  return "en";
}

function getStoredSourceMinSeeders() {
  try {
    return normalizeSourceMinSeeders(
      localStorage.getItem(SOURCE_MIN_SEEDERS_PREF_KEY),
    );
  } catch {
    return 0;
  }
}

function getStoredSourceResultsLimit() {
  try {
    return normalizeSourceResultsLimit(
      localStorage.getItem(SOURCE_RESULTS_LIMIT_PREF_KEY),
    );
  } catch {
    return DEFAULT_SOURCE_RESULTS_LIMIT;
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

function getStoredSourceLanguage() {
  try {
    return normalizeSourceLanguage(
      localStorage.getItem(SOURCE_LANGUAGE_PREF_KEY),
    );
  } catch {
    return "en";
  }
}

function normalizeSubtitleColor(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
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
    return normalizeSubtitleColor(
      localStorage.getItem(SUBTITLE_COLOR_PREF_KEY),
    );
  } catch {
    return DEFAULT_SUBTITLE_COLOR;
  }
}

function applySubtitleCueColor(
  colorValue = getStoredSubtitleColorPreference(),
) {
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
      background: transparent !important;
      background-color: transparent !important;
      text-shadow: none !important;
    }
    #playerVideo::cue(*) {
      background: transparent !important;
      background-color: transparent !important;
      text-shadow: none !important;
    }
    #playerVideo::-webkit-media-text-track-display,
    #playerVideo::-webkit-media-text-track-container,
    #playerVideo::-webkit-media-text-track-background,
    #playerVideo::-webkit-media-text-track-region {
      background: transparent !important;
      background-color: transparent !important;
    }
    #playerVideo::-webkit-media-text-track-cue {
      background: transparent !important;
      background-color: transparent !important;
      text-shadow: none !important;
    }
  `;
}

function normalizeAudioSyncMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const clamped = Math.max(
    AUDIO_SYNC_MIN_MS,
    Math.min(AUDIO_SYNC_MAX_MS, Math.round(parsed)),
  );
  return clamped;
}

function normalizeNativePlaybackMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    !normalized ||
    normalized === "auto" ||
    normalized === "on" ||
    normalized === "1" ||
    normalized === "enabled"
  ) {
    return "auto";
  }
  if (
    normalized === "off" ||
    normalized === "0" ||
    normalized === "disabled" ||
    normalized === "browser"
  ) {
    return "off";
  }
  return "auto";
}

function getStoredNativePlaybackMode() {
  try {
    return normalizeNativePlaybackMode(
      localStorage.getItem(NATIVE_PLAYBACK_MODE_PREF_KEY),
    );
  } catch {
    return "auto";
  }
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

function getStoredRemuxVideoMode() {
  try {
    return normalizeRemuxVideoMode(
      localStorage.getItem(REMUX_VIDEO_MODE_PREF_KEY),
    );
  } catch {
    return "auto";
  }
}

function isRecognizedAudioLang(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "auto" || /^[a-z]{2}$/.test(normalized);
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
    const raw = String(
      localStorage.getItem(
        getSubtitleStreamPreferenceStorageKey(normalizedTmdbId),
      ) || "",
    )
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
    return normalizeSubtitlePreference(
      localStorage.getItem(
        getSubtitleLangPreferenceStorageKey(normalizedTmdbId),
      ),
    );
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
    const raw = String(
      localStorage.getItem(
        getAudioLangPreferenceStorageKey(normalizedTmdbId),
      ) || "",
    )
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

let preferredAudioLang = isRecognizedAudioLang(audioLangParam)
  ? audioLangParam
  : "auto";
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
let preferredSourceResultsLimit = getStoredSourceResultsLimit();
let preferredSourceFormats = getStoredSourceFormats();
let preferredSourceLanguage = getStoredSourceLanguage();
let preferredAudioSyncMs = 0;
let preferredNativePlaybackMode = getStoredNativePlaybackMode();
let preferredRemuxVideoMode = getStoredRemuxVideoMode();
preferredSubtitleLang = normalizeSubtitlePreference(subtitleLangParam);
if (isTmdbMoviePlayback && !hasSubtitleLangParam) {
  preferredSubtitleLang =
    getStoredSubtitleLangForTmdbMovie(tmdbId) || preferredSubtitleLang;
}
if (isTmdbMoviePlayback && hasSubtitleLangParam) {
  persistSubtitleLangPreference(preferredSubtitleLang);
}
applyPreferredSourceAudioSync(selectedSourceHash);
const sourceIdentity = isSeriesPlayback
  ? `series:${activeSeries.id}:episode:${seriesEpisodeIndex}`
  : src ||
    (isTmdbResolvedPlayback
      ? `tmdb:${mediaType}:${tmdbId}${isTmdbTvPlayback ? `:s${seasonNumber}:e${episodeNumber}` : ""}`
      : DEFAULT_TRAILER_SOURCE);
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
    const parsed = JSON.parse(
      localStorage.getItem(CONTINUE_WATCHING_META_KEY) || "{}",
    );
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getCanonicalContinueWatchingMetadata() {
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
      ? String(activeSeriesEpisode?.thumb || DEFAULT_EPISODE_THUMBNAIL)
      : thumbParam,
  };
}

function persistContinueWatchingEntry(resumeSeconds) {
  const normalizedSource = String(sourceIdentity || "").trim();
  if (
    !normalizedSource ||
    !Number.isFinite(resumeSeconds) ||
    resumeSeconds < 1
  ) {
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
        localStorage.setItem(
          CONTINUE_WATCHING_META_KEY,
          JSON.stringify(metaMap),
        );
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
  return Boolean(
    resolverOverlay &&
    !resolverOverlay.hidden &&
    !resolverOverlay.classList.contains("is-error"),
  );
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

function showResolver(message, { isError = false, showStatus = isError } = {}) {
  if (hasExplicitSource && !showStatus && !isError) {
    hideResolver();
    return;
  }

  if (!resolverOverlay) {
    return;
  }

  if (resolverStatus) {
    resolverStatus.textContent =
      String(message || "").trim() || "Unable to load this video.";
    resolverStatus.hidden = !showStatus;
  }
  if (resolverLoader) {
    resolverLoader.hidden = showStatus || isError;
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

function getLanguageDisplayLabel(langCode) {
  const normalized = String(langCode || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "Unknown";
  }
  if (normalized in subtitleLanguageNames) {
    return subtitleLanguageNames[normalized];
  }
  return normalized.toUpperCase();
}

function normalizeSourceHash(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return /^[a-f0-9]{40}$/.test(normalized) ? normalized : "";
}

function getSourceAudioSyncStorageKey(sourceHash) {
  return `${SOURCE_AUDIO_SYNC_PREF_KEY_PREFIX}${normalizeSourceHash(sourceHash)}`;
}

function getStoredSourceAudioSyncMs(sourceHash) {
  const normalizedHash = normalizeSourceHash(sourceHash);
  if (!normalizedHash) {
    return 0;
  }
  try {
    return normalizeAudioSyncMs(
      localStorage.getItem(getSourceAudioSyncStorageKey(normalizedHash)),
    );
  } catch {
    return 0;
  }
}

function persistSourceAudioSyncMs(sourceHash, audioSyncMs) {
  const normalizedHash = normalizeSourceHash(sourceHash);
  if (!normalizedHash) {
    return;
  }
  const normalizedSync = normalizeAudioSyncMs(audioSyncMs);
  try {
    if (normalizedSync === 0) {
      localStorage.removeItem(getSourceAudioSyncStorageKey(normalizedHash));
      return;
    }
    localStorage.setItem(
      getSourceAudioSyncStorageKey(normalizedHash),
      String(normalizedSync),
    );
  } catch {
    // Ignore storage access issues.
  }
}

function applyPreferredSourceAudioSync(sourceHash = selectedSourceHash) {
  const normalizedHash = normalizeSourceHash(sourceHash);
  preferredAudioSyncMs = normalizedHash
    ? getStoredSourceAudioSyncMs(normalizedHash)
    : 0;
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
  const container = String(option.container || "")
    .trim()
    .toUpperCase();

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
  const seeders = Number.isFinite(Number(option.seeders))
    ? Math.max(0, Math.floor(Number(option.seeders)))
    : 0;
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

function isSourceOptionLikelyContainer(option = {}, container = "") {
  const safeContainer = String(container || "")
    .trim()
    .toLowerCase();
  if (!safeContainer) {
    return false;
  }
  const explicitContainer = String(option?.container || "")
    .trim()
    .toLowerCase();
  if (explicitContainer) {
    return explicitContainer === safeContainer;
  }

  const sourceText = [
    option?.filename,
    option?.primary,
    option?.title,
    option?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!sourceText) {
    return false;
  }
  if (safeContainer === "mkv") {
    return /\.mkv\b/.test(sourceText);
  }
  if (safeContainer === "mp4") {
    return /\.mp4\b/.test(sourceText);
  }
  return false;
}

function sortSourcesBySeeders(sources = [], { preferContainer = "" } = {}) {
  const normalizedPreferredContainer = String(preferContainer || "")
    .trim()
    .toLowerCase();
  return [...sources].sort((left, right) => {
    if (normalizedPreferredContainer) {
      const rightPreferred = isSourceOptionLikelyContainer(
        right,
        normalizedPreferredContainer,
      );
      const leftPreferred = isSourceOptionLikelyContainer(
        left,
        normalizedPreferredContainer,
      );
      if (rightPreferred !== leftPreferred) {
        return Number(rightPreferred) - Number(leftPreferred);
      }
    }

    const rightSeeders = Number.isFinite(Number(right?.seeders))
      ? Math.max(0, Math.floor(Number(right.seeders)))
      : 0;
    const leftSeeders = Number.isFinite(Number(left?.seeders))
      ? Math.max(0, Math.floor(Number(left.seeders)))
      : 0;
    if (rightSeeders !== leftSeeders) {
      return rightSeeders - leftSeeders;
    }
    return getSourceDisplayName(left).localeCompare(
      getSourceDisplayName(right),
      undefined,
      { sensitivity: "base" },
    );
  });
}

function getSourceOptionByHash(sourceHash) {
  const normalizedHash = normalizeSourceHash(sourceHash);
  if (!normalizedHash) {
    return null;
  }
  return (
    availablePlaybackSources.find(
      (option) =>
        normalizeSourceHash(option?.sourceHash || "") === normalizedHash,
    ) || null
  );
}

function parseSourceOptionVerticalResolution(option = {}) {
  const labelMatch = String(option?.qualityLabel || "")
    .toLowerCase()
    .match(/(\d{3,4})p/);
  if (labelMatch) {
    const parsed = Number(labelMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const text = [
    option?.filename,
    option?.primary,
    option?.title,
    option?.name,
    option?.qualityLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!text) {
    return 0;
  }
  if (/\b(2160p|4k|uhd)\b/.test(text)) return 2160;
  if (/\b1080p\b/.test(text)) return 1080;
  if (/\b720p\b/.test(text)) return 720;
  if (/\b480p\b/.test(text)) return 480;
  return 0;
}

function getDetectedSourceOptionLanguages(option = {}) {
  const text = ` ${[
    option?.filename,
    option?.primary,
    option?.title,
    option?.name,
    option?.provider,
    option?.releaseGroup,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")} `;

  const matched = new Set();
  if (!text.trim()) {
    return matched;
  }

  Object.entries(SOURCE_LANGUAGE_TOKENS).forEach(([lang, tokens]) => {
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
        return text.includes(` ${normalizedToken} `);
      })
    ) {
      matched.add(lang);
    }
  });

  return matched;
}

function scoreSourceOptionLanguageForDefault(
  option = {},
  preferredLanguage = preferredSourceLanguage,
) {
  const normalizedPreferred = normalizeSourceLanguage(preferredLanguage);
  if (normalizedPreferred === "any") {
    return 0;
  }

  const detected = getDetectedSourceOptionLanguages(option);
  if (detected.has(normalizedPreferred)) {
    return detected.size === 1 ? 4 : 2;
  }
  if (detected.size === 0 && normalizedPreferred === "en") {
    return 1;
  }
  return -5;
}

function compareSourceOptionsForDefault(left = {}, right = {}) {
  const leftLangScore = scoreSourceOptionLanguageForDefault(left);
  const rightLangScore = scoreSourceOptionLanguageForDefault(right);
  if (leftLangScore !== rightLangScore) {
    return rightLangScore - leftLangScore;
  }

  const leftResolution = parseSourceOptionVerticalResolution(left);
  const rightResolution = parseSourceOptionVerticalResolution(right);
  if (leftResolution !== rightResolution) {
    return rightResolution - leftResolution;
  }

  const leftSeeders = Number.isFinite(Number(left?.seeders))
    ? Math.max(0, Math.floor(Number(left.seeders)))
    : 0;
  const rightSeeders = Number.isFinite(Number(right?.seeders))
    ? Math.max(0, Math.floor(Number(right.seeders)))
    : 0;
  if (leftSeeders !== rightSeeders) {
    return rightSeeders - leftSeeders;
  }

  return getSourceDisplayName(left).localeCompare(
    getSourceDisplayName(right),
    undefined,
    { sensitivity: "base" },
  );
}

function getPreferredDefaultSourceHash(options = []) {
  const mp4Option =
    [...options]
      .filter((option) => isSourceOptionLikelyContainer(option, "mp4"))
      .sort(compareSourceOptionsForDefault)[0] || null;
  const defaultOption = mp4Option || options[0] || null;
  return normalizeSourceHash(
    defaultOption?.sourceHash || defaultOption?.infoHash || "",
  );
}

function getSourceSelectLabel(option = {}) {
  const name = getSourceDisplayName(option);
  const hint = getSourceDisplayHint(option);
  if (hint) {
    return `${name} — ${hint}`;
  }
  return name;
}

function renderSelectedSourceDetails() {
  if (!sourceOptionDetails) {
    return;
  }
  const selectedOption =
    getSourceOptionByHash(selectedSourceHash) ||
    availablePlaybackSources[0] ||
    null;
  if (!selectedOption) {
    sourceOptionDetails.hidden = true;
    sourceOptionDetails.textContent = "";
    return;
  }
  const details = [
    getSourceDisplayMeta(selectedOption),
    getSourceDisplayName(selectedOption),
  ]
    .filter(Boolean)
    .join("  ");
  sourceOptionDetails.hidden = !details;
  sourceOptionDetails.textContent = details;
}

function syncSourcePanelVisibility() {
  const sourceTabVisible = isTmdbResolvedPlayback;
  if (!sourceTabVisible && activeAudioTab === "sources") {
    activeAudioTab = "subtitles";
  }

  if (audioTabSources) {
    const isSourcesActive = activeAudioTab === "sources" && sourceTabVisible;
    audioTabSources.hidden = !sourceTabVisible;
    audioTabSources.disabled = !sourceTabVisible;
    audioTabSources.classList.toggle("is-active", isSourcesActive);
    audioTabSources.setAttribute(
      "aria-selected",
      isSourcesActive ? "true" : "false",
    );
    audioTabSources.tabIndex = isSourcesActive ? 0 : -1;
  }

  if (audioTabSubtitles) {
    const isSubtitlesActive =
      activeAudioTab === "subtitles" || !sourceTabVisible;
    audioTabSubtitles.classList.toggle("is-active", isSubtitlesActive);
    audioTabSubtitles.setAttribute(
      "aria-selected",
      isSubtitlesActive ? "true" : "false",
    );
    audioTabSubtitles.tabIndex = isSubtitlesActive ? 0 : -1;
  }

  if (subtitlePanel) {
    subtitlePanel.hidden = activeAudioTab !== "subtitles" && sourceTabVisible;
  }

  if (sourcePanel) {
    sourcePanel.hidden = !sourceTabVisible || activeAudioTab !== "sources";
  }
}

function setActiveAudioTab(nextTab = "subtitles") {
  const normalizedTab = nextTab === "sources" ? "sources" : "subtitles";
  const sourceTabVisible = isTmdbResolvedPlayback;
  activeAudioTab =
    normalizedTab === "sources" && sourceTabVisible ? "sources" : "subtitles";
  syncSourcePanelVisibility();
}

function syncSourceSelectionState() {
  if (!(sourceOptionsContainer instanceof HTMLElement)) {
    return;
  }

  const normalizedHash = normalizeSourceHash(selectedSourceHash);
  const optionButtons = Array.from(
    sourceOptionsContainer.querySelectorAll(".source-option"),
  );
  optionButtons.forEach((optionButton) => {
    const optionHash = normalizeSourceHash(
      optionButton.dataset.sourceHash || "",
    );
    optionButton.setAttribute(
      "aria-selected",
      optionHash && normalizedHash && optionHash === normalizedHash
        ? "true"
        : "false",
    );
  });
}

function renderSourceOptionButtons() {
  if (!(sourceOptionsContainer instanceof HTMLElement)) {
    return;
  }

  sourceOptionsContainer.innerHTML = "";

  if (!availablePlaybackSources.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "source-option-empty";
    emptyState.textContent = "No alternate sources available yet.";
    sourceOptionsContainer.appendChild(emptyState);
    if (sourceOptionDetails) {
      sourceOptionDetails.hidden = true;
      sourceOptionDetails.textContent = "";
    }
    return;
  }

  const seenHashes = new Set();
  const displayedSources = [];
  const fragment = document.createDocumentFragment();
  const rankedSources = sortSourcesBySeeders(availablePlaybackSources, {
    preferContainer: "mp4",
  });
  for (const option of rankedSources) {
    if (seenHashes.size >= preferredSourceResultsLimit) {
      break;
    }
    const sourceHash = normalizeSourceHash(
      option?.sourceHash || option?.infoHash || "",
    );
    if (!sourceHash || seenHashes.has(sourceHash)) {
      continue;
    }
    seenHashes.add(sourceHash);

    const sourceOptionButton = document.createElement("button");
    sourceOptionButton.className = "audio-option source-option";
    sourceOptionButton.type = "button";
    sourceOptionButton.setAttribute("role", "option");
    sourceOptionButton.dataset.sourceHash = sourceHash;
    sourceOptionButton.setAttribute(
      "aria-selected",
      sourceHash === selectedSourceHash ? "true" : "false",
    );

    const nameLine = document.createElement("span");
    nameLine.className = "source-option-name";
    nameLine.textContent = getSourceDisplayName(option);

    const hintText = getSourceDisplayHint(option);
    const metaText = getSourceDisplayMeta(option);

    if (hintText) {
      const hintLine = document.createElement("span");
      hintLine.className = "source-option-hint";
      hintLine.textContent = hintText;
      sourceOptionButton.appendChild(hintLine);
    }

    if (metaText) {
      const metaLine = document.createElement("span");
      metaLine.className = "source-option-meta";
      metaLine.textContent = metaText;
      sourceOptionButton.appendChild(metaLine);
    }

    sourceOptionButton.prepend(nameLine);
    fragment.appendChild(sourceOptionButton);
    displayedSources.push(option);
  }

  sourceOptionsContainer.appendChild(fragment);
  if (!seenHashes.size) {
    const emptyState = document.createElement("p");
    emptyState.className = "source-option-empty";
    emptyState.textContent = "No alternate sources available yet.";
    sourceOptionsContainer.appendChild(emptyState);
    if (sourceOptionDetails) {
      sourceOptionDetails.hidden = true;
      sourceOptionDetails.textContent = "";
    }
    return;
  }

  const preferredDefaultSourceHash =
    getPreferredDefaultSourceHash(displayedSources);
  const normalizedSelectedSourceHash = normalizeSourceHash(selectedSourceHash);
  const hasSelectedInOptions =
    normalizedSelectedSourceHash &&
    seenHashes.has(normalizedSelectedSourceHash);
  if (sourceSelectionPinned && !hasSelectedInOptions) {
    sourceSelectionPinned = false;
  }
  if (
    preferredDefaultSourceHash &&
    (!sourceSelectionPinned || !hasSelectedInOptions)
  ) {
    selectedSourceHash = preferredDefaultSourceHash;
    applyPreferredSourceAudioSync(selectedSourceHash);
    persistSourceHashInUrl();
  }

  syncSourceSelectionState();
  renderSelectedSourceDetails();
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
  const safeStreamIndex = Number.isFinite(streamIndex)
    ? Math.floor(streamIndex)
    : -1;
  if (safeStreamIndex < 0) {
    return false;
  }

  const selectedTrack = availableSubtitleTracks.find(
    (track) => Number(track?.streamIndex) === safeStreamIndex,
  );
  if (!selectedTrack) {
    return true;
  }

  return !selectedTrack.isExternal;
}

function buildHlsPlaybackUrl(
  input,
  audioStreamIndex = -1,
  subtitleStreamIndex = -1,
) {
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
  if (
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    mediaWidth <= 0 ||
    mediaHeight <= 0
  ) {
    return null;
  }

  const scale = Math.min(
    viewportWidth / mediaWidth,
    viewportHeight / mediaHeight,
  );
  if (!Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  const renderedHeight = mediaHeight * scale;
  const matteHeight = Math.max(0, (viewportHeight - renderedHeight) / 2);
  if (
    !Number.isFinite(matteHeight) ||
    matteHeight < SUBTITLE_MATTE_MIN_HEIGHT_PX
  ) {
    return null;
  }

  const bottomMatteTop = viewportHeight - matteHeight;
  const matteTopBoundary = bottomMatteTop + SUBTITLE_MATTE_TOP_PADDING_PX;
  const matteBottomBoundary = viewportHeight - SUBTITLE_MATTE_BOTTOM_PADDING_PX;
  if (matteBottomBoundary <= matteTopBoundary) {
    return null;
  }

  const guardedTopTarget =
    matteTopBoundary + matteHeight * SUBTITLE_MATTE_TOP_GUARD_RATIO;
  const preferredBottomTarget =
    viewportHeight - SUBTITLE_MATTE_BOTTOM_TARGET_OFFSET_PX;
  const targetY = Math.min(
    matteBottomBoundary,
    Math.max(
      matteTopBoundary,
      Math.max(guardedTopTarget, preferredBottomTarget),
    ),
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
  const activeTrack =
    subtitleTrackElement?.track ||
    Array.from(video.textTracks || []).find(
      (track) => track.mode === "showing",
    ) ||
    null;
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
  const fallbackTrack = Array.from(video.textTracks || []).find(
    (textTrack) => textTrack.label === trackElement.label,
  );
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
  const selectedTrack = getSubtitleTrackByStreamIndex(
    selectedSubtitleStreamIndex,
  );
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

function getSubtitleTrackByStreamIndex(streamIndex) {
  const safeStreamIndex = Number.isFinite(streamIndex)
    ? Math.floor(streamIndex)
    : -1;
  if (safeStreamIndex < 0) {
    return null;
  }
  return (
    availableSubtitleTracks.find(
      (track) => Number(track?.streamIndex) === safeStreamIndex,
    ) || null
  );
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
  const selectedTrack = getSubtitleTrackByStreamIndex(
    selectedSubtitleStreamIndex,
  );
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
    await requestJson(
      "/api/title/preferences",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      10000,
    );
  } catch {
    // Ignore preference persistence failures.
  }
}

function applySubtitleTrackByStreamIndex(streamIndex) {
  clearSubtitleTrack();
  hideAllSubtitleTracks();

  const safeStreamIndex = Number.isFinite(streamIndex)
    ? Math.floor(streamIndex)
    : -1;
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

  if (!isPlayableSubtitleTrack(selectedTrack)) {
    selectedSubtitleStreamIndex = -1;
    return;
  }

  const trackElement = document.createElement("track");
  trackElement.kind = "subtitles";
  trackElement.label =
    selectedTrack.label ||
    `${getLanguageDisplayLabel(selectedTrack.language)} subtitles`;
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
      const codecSuffix = track.codec
        ? ` (${String(track.codec).toUpperCase()})`
        : "";
      button.textContent = `${languageLabel}${titleSuffix}${codecSuffix}`;
      button.setAttribute(
        "aria-selected",
        Number(track.streamIndex) === selectedAudioStreamIndex
          ? "true"
          : "false",
      );
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
      button.setAttribute(
        "aria-selected",
        lang === preferredAudioLang ? "true" : "false",
      );
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
  const currentSubtitleTrack = getSubtitleTrackByStreamIndex(
    selectedSubtitleStreamIndex,
  );
  if (
    selectedSubtitleStreamIndex >= 0 &&
    !isPlayableSubtitleTrack(currentSubtitleTrack)
  ) {
    selectedSubtitleStreamIndex = -1;
  }
  subtitlesOffButton.setAttribute(
    "aria-selected",
    selectedSubtitleStreamIndex < 0 ? "true" : "false",
  );
  subtitleOptionsContainer.appendChild(subtitlesOffButton);

  const orderedSubtitleTracks = [...availableSubtitleTracks]
    .filter((track) => isPlayableSubtitleTrack(track))
    .sort((left, right) => {
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
      : track.label || `${getLanguageDisplayLabel(track.language)} subtitles`;
    button.textContent = cleanLabel;
    button.setAttribute(
      "aria-selected",
      Number(track.streamIndex) === selectedSubtitleStreamIndex
        ? "true"
        : "false",
    );
    subtitleOptionsContainer.appendChild(button);
  });

  audioOptions = Array.from(
    audioOptionsContainer.querySelectorAll(".audio-option"),
  );
  subtitleOptions = Array.from(
    subtitleOptionsContainer.querySelectorAll(".subtitle-option"),
  );
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

function withPreferredAudioSyncForRemuxSource(
  source,
  audioSyncMs = preferredAudioSyncMs,
  remuxVideoMode = preferredRemuxVideoMode,
) {
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
    const normalizedSourceHash = normalizeSourceHash(selectedSourceHash);
    if (normalizedSourceHash) {
      url.searchParams.set("sourceHash", normalizedSourceHash);
    } else {
      url.searchParams.delete("sourceHash");
    }
    url.searchParams.set("videoMode", normalizeRemuxVideoMode(remuxVideoMode));
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
  sourceHash = selectedSourceHash,
  remuxVideoMode = preferredRemuxVideoMode,
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
  const normalizedSourceHash = normalizeSourceHash(sourceHash);
  if (normalizedSourceHash) {
    params.set("sourceHash", normalizedSourceHash);
  }
  params.set("videoMode", normalizeRemuxVideoMode(remuxVideoMode));
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
    const startSeconds =
      Number.isFinite(rawStart) && rawStart > 0 ? rawStart : 0;
    const rawAudioStreamIndex = Number(
      url.searchParams.get("audioStream") || -1,
    );
    const audioStreamIndex =
      Number.isFinite(rawAudioStreamIndex) && rawAudioStreamIndex >= 0
        ? Math.floor(rawAudioStreamIndex)
        : -1;
    const rawSubtitleStreamIndex = Number(
      url.searchParams.get("subtitleStream") || -1,
    );
    const subtitleStreamIndex =
      Number.isFinite(rawSubtitleStreamIndex) && rawSubtitleStreamIndex >= 0
        ? Math.floor(rawSubtitleStreamIndex)
        : -1;
    const rawAudioSyncMs = Number(url.searchParams.get("audioSyncMs") || 0);
    const audioSyncMs = normalizeAudioSyncMs(rawAudioSyncMs);
    const sourceHash = normalizeSourceHash(
      url.searchParams.get("sourceHash") || "",
    );
    const remuxVideoMode = normalizeRemuxVideoMode(
      url.searchParams.get("videoMode") || "auto",
    );
    return {
      input,
      startSeconds,
      audioStreamIndex,
      subtitleStreamIndex,
      audioSyncMs,
      sourceHash,
      remuxVideoMode,
    };
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
  const sourceWithAudioSync = withPreferredAudioSyncForRemuxSource(
    nextSource,
    preferredAudioSyncMs,
  );

  clearStreamStallRecovery();
  destroyHlsInstance();
  clearSubtitleTrack();

  const transcodeMeta = parseTranscodeSource(sourceWithAudioSync);
  if (transcodeMeta) {
    activeTranscodeInput = transcodeMeta.input;
    transcodeBaseOffsetSeconds = transcodeMeta.startSeconds;
    activeAudioStreamIndex = transcodeMeta.audioStreamIndex;
    activeAudioSyncMs = transcodeMeta.audioSyncMs;
    if (
      isTmdbResolvedPlayback &&
      transcodeMeta.sourceHash &&
      transcodeMeta.sourceHash !== selectedSourceHash
    ) {
      selectedSourceHash = transcodeMeta.sourceHash;
      persistSourceHashInUrl();
    }
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
  const absoluteSource = new URL(
    sourceWithAudioSync,
    window.location.origin,
  ).toString();
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
          scheduleStreamStallRecovery(
            "Network stalled, trying another source...",
          );
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
        video.setAttribute(
          "src",
          new URL(remuxFallback, window.location.origin).toString(),
        );
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
      video.setAttribute(
        "src",
        new URL(remuxFallback, window.location.origin).toString(),
      );
      video.load();
      scheduleStreamStallRecovery("Stream stalled, trying another source...");
      return;
    }
  }

  video.setAttribute("src", absoluteSource);
  video.load();
  scheduleStreamStallRecovery("Stream stalled, trying another source...");
}

function shouldAttemptNativePlayback(source) {
  if (preferredNativePlaybackMode === "off" || nativePlaybackLaunched) {
    return false;
  }
  try {
    const url = new URL(String(source || ""), window.location.origin);
    return url.pathname === "/api/remux";
  } catch {
    return false;
  }
}

function getActiveSubtitleVttUrl() {
  if (selectedSubtitleStreamIndex < 0) {
    return "";
  }
  const selectedTrack = availableSubtitleTracks.find(
    (track) => Number(track?.streamIndex) === selectedSubtitleStreamIndex,
  );
  return String(selectedTrack?.vttUrl || "").trim();
}

function tearDownBrowserPlaybackForNative() {
  clearStreamStallRecovery();
  destroyHlsInstance();
  clearSubtitleTrack();
  try {
    video.pause();
  } catch {
    // Ignore pause errors.
  }
  video.removeAttribute("src");
  video.load();
}

async function tryLaunchNativePlayback(source, startSeconds = 0) {
  if (!shouldAttemptNativePlayback(source)) {
    return false;
  }
  const sourceUrl = withPreferredAudioSyncForRemuxSource(
    source,
    preferredAudioSyncMs,
  );
  const safeStartSeconds =
    Number.isFinite(startSeconds) && startSeconds > 0
      ? Math.floor(startSeconds)
      : 0;
  const payload = {
    sourceUrl,
    subtitleUrl: getActiveSubtitleVttUrl(),
    title,
    episode,
    startSeconds: safeStartSeconds,
    audioSyncMs: preferredAudioSyncMs,
    sourceHash: selectedSourceHash,
  };
  try {
    const response = await requestJson(
      "/api/native/play",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      12000,
    );
    if (!response?.launched) {
      return false;
    }

    nativePlaybackLaunched = true;
    tearDownBrowserPlaybackForNative();
    if (!hasExplicitSource) {
      showResolver("Playing in mpv (native player).", { showStatus: true });
    }
    return true;
  } catch {
    return false;
  }
}

function setTmdbSourceQueue(primaryUrl, fallbackUrls = []) {
  const queue = [
    primaryUrl,
    ...(Array.isArray(fallbackUrls) ? fallbackUrls : []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);

  tmdbSourceQueue = queue;
  tmdbSourceAttemptIndex = queue.length > 0 ? 1 : 0;
}

async function tryNextTmdbSource() {
  if (
    !isTmdbResolvedPlayback ||
    tmdbSourceAttemptIndex >= tmdbSourceQueue.length
  ) {
    return false;
  }

  const nextSource = tmdbSourceQueue[tmdbSourceAttemptIndex];
  tmdbSourceAttemptIndex += 1;
  showResolver(
    `Trying alternate source (${tmdbSourceAttemptIndex}/${tmdbSourceQueue.length})...`,
  );
  setVideoSource(nextSource);
  await tryPlay();
  return true;
}

function applyStoredSubtitleSelectionPreference() {
  if (!isTmdbMoviePlayback || hasSubtitleLangParam) {
    return;
  }

  const storedSubtitleStreamPreference =
    getStoredSubtitleStreamPreferenceForTmdbMovie(tmdbId);

  if (storedSubtitleStreamPreference.mode === "off") {
    selectedSubtitleStreamIndex = -1;
    preferredSubtitleLang = "off";
    return;
  }

  if (storedSubtitleStreamPreference.mode !== "on") {
    return;
  }

  const exactTrack = availableSubtitleTracks.find(
    (track) =>
      Number(track?.streamIndex) ===
        storedSubtitleStreamPreference.streamIndex &&
      isPlayableSubtitleTrack(track),
  );
  if (exactTrack) {
    selectedSubtitleStreamIndex = Number(exactTrack.streamIndex);
    const exactLanguage = normalizeSubtitlePreference(
      exactTrack.language || preferredSubtitleLang,
    );
    if (exactLanguage) {
      preferredSubtitleLang = exactLanguage;
    }
    return;
  }

  const playableSubtitleTracks = availableSubtitleTracks.filter((track) =>
    isPlayableSubtitleTrack(track),
  );
  const preferredLanguage = normalizeSubtitlePreference(preferredSubtitleLang);
  const fallbackTrack =
    playableSubtitleTracks.find(
      (track) =>
        preferredLanguage &&
        preferredLanguage !== "off" &&
        normalizeSubtitlePreference(track?.language || "") ===
          preferredLanguage,
    ) ||
    playableSubtitleTracks.find(
      (track) => !isLikelyForcedSubtitleTrack(track),
    ) ||
    playableSubtitleTracks[0] ||
    null;
  if (!fallbackTrack) {
    selectedSubtitleStreamIndex = -1;
    return;
  }

  const fallbackStreamIndex = Number(fallbackTrack.streamIndex);
  if (Number.isInteger(fallbackStreamIndex) && fallbackStreamIndex >= 0) {
    selectedSubtitleStreamIndex = fallbackStreamIndex;
  }
  const fallbackLanguage = normalizeSubtitlePreference(
    fallbackTrack.language || preferredLanguage,
  );
  if (fallbackLanguage) {
    preferredSubtitleLang = fallbackLanguage;
  }
}

async function resolveTmdbSourcesAndPlay({
  allowContainerFallback = true,
  allowSourceFallback = true,
  requiredSourceHash = "",
} = {}) {
  if (!availablePlaybackSources.length) {
    void fetchTmdbSourceOptionsViaBackend();
  }

  const normalizedRequiredSourceHash = normalizeSourceHash(requiredSourceHash);
  const resolved = isTmdbTvPlayback
    ? await resolveTmdbTvEpisodeViaBackend(
        tmdbId,
        seasonNumber,
        episodeNumber,
        {
          allowContainerFallback,
          allowSourceFallback,
        },
      )
    : await resolveTmdbMovieViaBackend(tmdbId, {
        allowSourceFallback,
      });
  const resolvedSourceHash = normalizeSourceHash(
    resolved?.sourceHash || selectedSourceHash,
  );
  if (
    normalizedRequiredSourceHash &&
    resolvedSourceHash !== normalizedRequiredSourceHash
  ) {
    throw new Error(
      "Selected source is unavailable right now. Try another source.",
    );
  }
  activeTrackSourceInput = String(resolved?.sourceInput || "").trim();
  availableAudioTracks = Array.isArray(resolved?.tracks?.audioTracks)
    ? resolved.tracks.audioTracks
    : [];
  availableSubtitleTracks = Array.isArray(resolved?.tracks?.subtitleTracks)
    ? resolved.tracks.subtitleTracks
    : [];
  selectedAudioStreamIndex = Number.isFinite(
    Number(resolved?.selectedAudioStreamIndex),
  )
    ? Number(resolved.selectedAudioStreamIndex)
    : -1;
  selectedSubtitleStreamIndex = Number.isFinite(
    Number(resolved?.selectedSubtitleStreamIndex),
  )
    ? Number(resolved.selectedSubtitleStreamIndex)
    : -1;
  resolvedTrackPreferenceAudio = String(
    resolved?.preferences?.audioLang || preferredAudioLang || "auto",
  )
    .trim()
    .toLowerCase();
  preferredSubtitleLang = String(
    resolved?.preferences?.subtitleLang || preferredSubtitleLang || "",
  ).trim();
  preferredSubtitleLang = normalizeSubtitlePreference(preferredSubtitleLang);
  selectedSourceHash = resolvedSourceHash;
  applyPreferredSourceAudioSync(selectedSourceHash);
  persistSourceHashInUrl();

  if (resolvedTrackPreferenceAudio && resolvedTrackPreferenceAudio !== "auto") {
    preferredAudioLang = resolvedTrackPreferenceAudio;
    persistAudioLangPreference(preferredAudioLang);
  }
  const subtitleStreamPreferenceBeforeResolve =
    getStoredSubtitleStreamPreferenceForTmdbMovie(tmdbId);
  applyStoredSubtitleSelectionPreference();
  persistSubtitleLangPreference(preferredSubtitleLang);
  if (
    subtitleStreamPreferenceBeforeResolve.mode !== "unset" ||
    selectedSubtitleStreamIndex >= 0 ||
    preferredSubtitleLang === "off"
  ) {
    persistSubtitleStreamPreference(selectedSubtitleStreamIndex);
  }

  rebuildTrackOptionButtons();
  if (
    !availablePlaybackSources.some(
      (option) => option.sourceHash === selectedSourceHash,
    ) &&
    selectedSourceHash
  ) {
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
  const preferredSource = tmdbSourceQueue[0] || resolved.playableUrl;
  if (await tryLaunchNativePlayback(preferredSource, resumeTime)) {
    syncAudioState();
    return { nativeLaunched: true, resolved };
  }
  setVideoSource(preferredSource);
  applySubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  syncAudioState();
  hideResolver();
  const runtimeSeconds = Number(resolved.metadata?.runtimeSeconds || 0);
  tmdbExpectedDurationSeconds =
    Number.isFinite(runtimeSeconds) && runtimeSeconds > 0 ? runtimeSeconds : 0;

  if (isTmdbTvPlayback && resolved.metadata?.displayTitle) {
    const resolvedEpisodeNumber = Number(
      resolved?.metadata?.episodeNumber || episodeNumber,
    );
    const safeEpisodeNumber =
      Number.isFinite(resolvedEpisodeNumber) && resolvedEpisodeNumber > 0
        ? Math.floor(resolvedEpisodeNumber)
        : episodeNumber;
    const resolvedEpisodeTitle = String(
      resolved?.metadata?.episodeTitle || activeSeriesEpisode?.title || "",
    ).trim();
    setEpisodeLabel(
      resolved.metadata.displayTitle,
      resolvedEpisodeTitle
        ? `E${safeEpisodeNumber} ${resolvedEpisodeTitle}`
        : `E${safeEpisodeNumber}`,
    );
  } else if (resolved.metadata?.displayTitle) {
    const releaseYear = String(resolved.metadata.displayYear || "").trim();
    setEpisodeLabel(
      resolved.metadata.displayTitle,
      releaseYear ? `(${releaseYear})` : "",
    );
  }

  await tryPlay();
  return { nativeLaunched: false, resolved };
}

function attemptTmdbRecovery(message) {
  if (!isTmdbResolvedPlayback || isRecoveringTmdbStream) {
    return false;
  }

  isRecoveringTmdbStream = true;
  showResolver(message);

  if (tmdbSourceAttemptIndex < tmdbSourceQueue.length) {
    void tryNextTmdbSource().finally(() => {
      isRecoveringTmdbStream = false;
    });
    return true;
  }

  if (tmdbResolveRetries < maxTmdbResolveRetries) {
    tmdbResolveRetries += 1;
    showResolver(
      `Refreshing source (${tmdbResolveRetries}/${maxTmdbResolveRetries})...`,
    );
    void resolveTmdbSourcesAndPlay()
      .catch((error) => {
        console.error("Failed to refresh TMDB playback source:", error);
        const fallbackMessage =
          error?.message || "Resolved stream could not be played. Try again.";
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

function seriesRequiresLocalEpisodeSources(seriesEntry = activeSeries) {
  return Boolean(seriesEntry?.requiresLocalEpisodeSources);
}

function isSeriesEpisodePlayable(episodeEntry, seriesEntry = activeSeries) {
  if (!episodeEntry) {
    return false;
  }
  if (!seriesRequiresLocalEpisodeSources(seriesEntry)) {
    return true;
  }
  return Boolean(String(episodeEntry?.src || "").trim());
}

function getSeriesEpisodeSeasonNumber(episodeEntry) {
  const parsed = Number(episodeEntry?.seasonNumber || 1);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
}

function getSeriesEpisodeOrdinalNumber(episodeEntry, index) {
  const parsed = Number(episodeEntry?.episodeNumber || index + 1);
  if (!Number.isFinite(parsed)) {
    return index + 1;
  }
  return Math.max(1, Math.floor(parsed));
}

function buildSeriesEpisodeIdentityKey(season, episode) {
  return `s${Math.max(1, Math.floor(Number(season) || 1))}e${Math.max(1, Math.floor(Number(episode) || 1))}`;
}

function isFallbackEpisodeThumbnail(thumbValue) {
  const normalized = String(thumbValue || "").trim();
  return !normalized || normalized === DEFAULT_EPISODE_THUMBNAIL;
}

async function fetchSeriesEpisodeStillMap() {
  const seriesTmdbId = String(activeSeries?.tmdbId || "").trim();
  if (!seriesTmdbId || !seriesEpisodes.length) {
    return new Map();
  }

  const uniqueSeasons = [
    ...new Set(
      seriesEpisodes.map((episodeEntry) =>
        getSeriesEpisodeSeasonNumber(episodeEntry),
      ),
    ),
  ];
  if (!uniqueSeasons.length) {
    return new Map();
  }

  const seasonPayloads = await Promise.all(
    uniqueSeasons.map(async (season) => {
      const query = new URLSearchParams({
        tmdbId: seriesTmdbId,
        seasonNumber: String(season),
      });
      try {
        return await requestJson(
          `/api/tmdb/tv/season?${query.toString()}`,
          {},
          25000,
        );
      } catch {
        return null;
      }
    }),
  );

  const stillMap = new Map();
  seasonPayloads.forEach((payload) => {
    const imageBase = String(payload?.imageBase || "").trim();
    const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];
    episodes.forEach((episode) => {
      const season = Math.max(
        1,
        Math.floor(Number(episode?.seasonNumber || payload?.seasonNumber || 1)),
      );
      const episodeNumber = Math.max(
        1,
        Math.floor(Number(episode?.episodeNumber || 0)),
      );
      if (!episodeNumber) {
        return;
      }
      const stillPath = String(episode?.stillPath || "").trim();
      const stillUrl =
        String(episode?.stillUrl || "").trim() ||
        (stillPath && imageBase ? `${imageBase}/w780${stillPath}` : "");
      if (!stillUrl) {
        return;
      }
      stillMap.set(
        buildSeriesEpisodeIdentityKey(season, episodeNumber),
        stillUrl,
      );
    });
  });

  return stillMap;
}

async function hydrateSeriesEpisodeThumbnails() {
  if (!isSeriesPlayback || !activeSeries || !seriesEpisodes.length) {
    return;
  }
  if (hasHydratedSeriesEpisodeThumbs) {
    return;
  }
  if (seriesEpisodeThumbHydrationTask) {
    return;
  }

  seriesEpisodeThumbHydrationTask = (async () => {
    const stillMap = await fetchSeriesEpisodeStillMap();
    if (!stillMap.size) {
      return;
    }

    let hasChanges = false;
    seriesEpisodes.forEach((episodeEntry, index) => {
      if (!episodeEntry || !isFallbackEpisodeThumbnail(episodeEntry.thumb)) {
        return;
      }

      const season = getSeriesEpisodeSeasonNumber(episodeEntry);
      const episodeNumber = getSeriesEpisodeOrdinalNumber(episodeEntry, index);
      const stillUrl = stillMap.get(
        buildSeriesEpisodeIdentityKey(season, episodeNumber),
      );
      if (!stillUrl || stillUrl === episodeEntry.thumb) {
        return;
      }

      episodeEntry.thumb = stillUrl;
      hasChanges = true;
    });

    if (hasChanges) {
      renderSeriesEpisodePreview();
    }
  })()
    .catch(() => {
      // Ignore thumbnail hydration failures and keep static fallbacks.
    })
    .finally(() => {
      hasHydratedSeriesEpisodeThumbs = true;
      seriesEpisodeThumbHydrationTask = null;
    });
}

function navigateToSeriesEpisode(nextIndex) {
  if (!isSeriesPlayback || !activeSeries || !seriesEpisodes.length) {
    return;
  }

  const parsedIndex = Number(nextIndex);
  if (!Number.isFinite(parsedIndex)) {
    return;
  }

  const safeIndex = Math.max(
    0,
    Math.min(seriesEpisodes.length - 1, Math.floor(parsedIndex)),
  );
  if (safeIndex === seriesEpisodeIndex) {
    closeEpisodesPopover();
    return;
  }

  const targetEpisode = seriesEpisodes[safeIndex];
  if (!targetEpisode) {
    return;
  }
  if (!isSeriesEpisodePlayable(targetEpisode)) {
    showResolver("This episode is unavailable until its MP4 source is added.", {
      showStatus: true,
      isError: true,
    });
    window.setTimeout(() => {
      hideResolver();
    }, 2200);
    closeEpisodesPopover();
    return;
  }

  persistResumeTime(true);

  const nextParams = new URLSearchParams(window.location.search);
  nextParams.set("seriesId", activeSeries.id);
  nextParams.set("episodeIndex", String(safeIndex));
  nextParams.set("title", String(activeSeries.title || title || "Title"));
  nextParams.set(
    "episode",
    getSeriesEpisodeLabel(safeIndex, targetEpisode.title),
  );
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
  const targetSeasonNumber = Math.max(
    1,
    Math.floor(Number(targetEpisode?.seasonNumber || seasonNumber)),
  );
  const targetEpisodeNumber = Math.max(
    1,
    Math.floor(Number(targetEpisode?.episodeNumber || safeIndex + 1)),
  );
  nextParams.set("seasonNumber", String(targetSeasonNumber));
  nextParams.set("episodeNumber", String(targetEpisodeNumber));
  const nextPreferredContainer = String(
    activeSeries?.preferredContainer || preferredContainer || "",
  )
    .trim()
    .toLowerCase();
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
    const isPlayable = isSeriesEpisodePlayable(episodeEntry);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "episode-preview-item";
    if (!isPlayable) {
      item.classList.add("is-unavailable");
      item.disabled = true;
    }
    item.dataset.episodeIndex = String(index);
    item.setAttribute("role", "listitem");
    item.setAttribute(
      "aria-label",
      isPlayable
        ? `Episode ${index + 1}: ${episodeEntry.title}`
        : `Episode ${index + 1}: ${episodeEntry.title} (Unavailable)`,
    );
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
    heading.textContent = isPlayable
      ? episodeEntry.title
      : `${episodeEntry.title} (Unavailable)`;
    main.appendChild(heading);

    const thumb = document.createElement("img");
    thumb.className = "episode-preview-thumb";
    thumb.src = String(episodeEntry.thumb || DEFAULT_EPISODE_THUMBNAIL);
    thumb.alt = `Episode ${index + 1} preview`;
    thumb.loading = "lazy";
    main.appendChild(thumb);

    const description = document.createElement("p");
    description.className = "episode-preview-desc";
    description.textContent = isPlayable
      ? String(episodeEntry.description || "")
      : "Unavailable until MP4 source is added.";

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
  const nextEpisodeEntry =
    shouldShowControls &&
    seriesEpisodeIndex >= 0 &&
    seriesEpisodeIndex < seriesEpisodes.length - 1
      ? seriesEpisodes[seriesEpisodeIndex + 1]
      : null;
  const hasNextEpisode = Boolean(
    nextEpisodeEntry && isSeriesEpisodePlayable(nextEpisodeEntry),
  );
  const nextTitle = String(nextEpisodeEntry?.title || "").trim();

  if (nextEpisode) {
    nextEpisode.hidden = !shouldShowControls;
    nextEpisode.disabled = !hasNextEpisode;
    nextEpisode.setAttribute(
      "aria-label",
      hasNextEpisode
        ? `Next episode (${nextTitle})`
        : nextEpisodeEntry
          ? `Next episode (${nextTitle}) unavailable`
          : "Next episode unavailable",
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
    toggleEpisodes.setAttribute(
      "aria-label",
      `Episodes (${seriesEpisodeIndex + 1} of ${seriesEpisodes.length})`,
    );
  }
}

setEpisodeLabel(title, episode);
renderSeriesEpisodePreview();
syncSeriesControls();
void hydrateSeriesEpisodeThumbnails();

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
  const selectedSubtitleTrack =
    selectedSubtitleStreamIndex >= 0
      ? availableSubtitleTracks.find(
          (track) => Number(track?.streamIndex) === selectedSubtitleStreamIndex,
        )
      : null;
  const selectedSubtitleLabel =
    selectedSubtitleStreamIndex >= 0
      ? selectedSubtitleTrack?.isExternal
        ? getLanguageDisplayLabel(selectedSubtitleTrack?.language)
        : selectedSubtitleTrack?.label ||
          getLanguageDisplayLabel(preferredSubtitleLang)
      : "Off";
  const syncHint = preferredAudioSyncMs
    ? `, A/V ${preferredAudioSyncMs > 0 ? "+" : ""}${preferredAudioSyncMs}ms`
    : "";
  toggleAudio?.setAttribute(
    "aria-label",
    `Subtitles (${selectedSubtitleLabel}${syncHint})`,
  );

  audioOptions.forEach((option) => {
    if (option.dataset.optionType === "audio-track") {
      const streamIndex = Number(option.dataset.streamIndex || -1);
      option.setAttribute(
        "aria-selected",
        streamIndex === selectedAudioStreamIndex ? "true" : "false",
      );
      return;
    }
    if (option.dataset.optionType === "audio-lang") {
      option.setAttribute(
        "aria-selected",
        option.dataset.lang === preferredAudioLang ? "true" : "false",
      );
    }
  });

  subtitleOptions.forEach((option) => {
    const streamIndex = Number(option.dataset.subtitleStream || -1);
    const isOffOption = streamIndex < 0;
    const isSelected = isOffOption
      ? selectedSubtitleStreamIndex < 0
      : streamIndex === selectedSubtitleStreamIndex;
    option.setAttribute("aria-selected", isSelected ? "true" : "false");
  });

  syncSourceSelectionState();
  renderSelectedSourceDetails();
}

function getCurrentAudioSyncSourceHash() {
  return normalizeSourceHash(selectedSourceHash || "");
}

async function adjustSourceAudioSync(deltaMs = 0) {
  if (
    nativePlaybackLaunched ||
    !isTranscodeSourceActive() ||
    !activeTranscodeInput
  ) {
    return;
  }

  const normalizedDelta = normalizeAudioSyncMs(deltaMs);
  if (normalizedDelta === 0) {
    return;
  }

  const nextAudioSync = normalizeAudioSyncMs(
    preferredAudioSyncMs + normalizedDelta,
  );
  if (nextAudioSync === preferredAudioSyncMs) {
    return;
  }

  preferredAudioSyncMs = nextAudioSync;
  const sourceHash = getCurrentAudioSyncSourceHash();
  if (sourceHash) {
    persistSourceAudioSyncMs(sourceHash, preferredAudioSyncMs);
  }

  const resumeFrom = getEffectiveCurrentTime();
  const wasPaused = video.paused;
  showResolver(
    sourceHash
      ? `Audio sync ${preferredAudioSyncMs > 0 ? "+" : ""}${preferredAudioSyncMs}ms (saved for this source).`
      : `Audio sync ${preferredAudioSyncMs > 0 ? "+" : ""}${preferredAudioSyncMs}ms.`,
    { showStatus: true },
  );
  setVideoSource(
    buildSoftwareDecodeUrl(
      activeTranscodeInput,
      0,
      selectedAudioStreamIndex,
      preferredAudioSyncMs,
      selectedSubtitleStreamIndex,
      sourceHash,
    ),
  );
  applySubtitleTrackByStreamIndex(selectedSubtitleStreamIndex);
  if (!wasPaused) {
    await tryPlay();
  }
  if (resumeFrom > 1) {
    seekToAbsoluteTime(resumeFrom);
  }
  hideResolver();
  syncAudioState();
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
  if (
    !Number.isFinite(totalDurationSeconds) ||
    totalDurationSeconds <= 0 ||
    !video.buffered?.length
  ) {
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

  const clampedBuffered = Math.min(
    totalDurationSeconds,
    Math.max(current, bufferedEnd),
  );
  const max = Number(seekBar.max) || 1000;
  return Math.round((clampedBuffered / totalDurationSeconds) * max);
}

function paintSeekProgress(progressValue, bufferedValue = null) {
  const max = Number(seekBar.max) || 1000;
  const clamped = Math.max(0, Math.min(max, Number(progressValue) || 0));
  const bufferedClamped = Math.max(
    clamped,
    Math.min(
      max,
      Number.isFinite(Number(bufferedValue)) ? Number(bufferedValue) : clamped,
    ),
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

  if (
    resolverOverlay &&
    !resolverOverlay.hidden &&
    resolverOverlay.classList.contains("is-error")
  ) {
    hideResolver();
  }

  if (isResolvingSource()) {
    return;
  }

  closeEpisodesPopover(false);
  window.clearTimeout(audioPopoverCloseTimeout);
  if (isTmdbResolvedPlayback && !availablePlaybackSources.length) {
    void fetchTmdbSourceOptionsViaBackend();
  }
  syncSourcePanelVisibility();
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

function scheduleStreamStallRecovery(
  message = "Stream stalled, trying another source...",
) {
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

function renderSourceOptionsWhenStable() {
  renderSourceOptionButtons();
  syncAudioState();
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
  const seekValue = Math.round(
    (effectiveCurrent / seekScaleDurationSeconds) * 1000,
  );
  seekBar.value = Math.max(0, Math.min(1000, seekValue));
  paintSeekProgress(
    seekBar.value,
    getBufferedSeekValue(seekScaleDurationSeconds),
  );
  durationText.textContent = formatTime(
    Math.max(0, seekScaleDurationSeconds - effectiveCurrent),
  );
}

function persistResumeTime(force = false) {
  const effectiveCurrentTime = Math.max(0, getEffectiveCurrentTime());
  if (!Number.isFinite(effectiveCurrentTime)) {
    return;
  }

  const seekScaleDurationSeconds = getSeekScaleDurationSeconds();
  const isNearEnd =
    Number.isFinite(seekScaleDurationSeconds) &&
    seekScaleDurationSeconds > 0 &&
    effectiveCurrentTime >=
      Math.max(
        0,
        seekScaleDurationSeconds - RESUME_CLEAR_AT_END_THRESHOLD_SECONDS,
      );

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
      if (
        Math.abs(effectiveCurrentTime - lastPersistedResumeTime) <
        RESUME_SAVE_MIN_DELTA_SECONDS
      ) {
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
  setVideoSource(
    buildSoftwareDecodeUrl(
      activeTranscodeInput,
      clampedTarget,
      activeAudioStreamIndex,
      activeAudioSyncMs || preferredAudioSyncMs,
      selectedSubtitleStreamIndex,
    ),
  );
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
      const message =
        payload?.error ||
        payload?.message ||
        `Request failed (${response.status})`;
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

async function resolveExplicitSourceTrackSelection(sourceInput) {
  activeTrackSourceInput = String(sourceInput || "").trim();
  if (!activeTrackSourceInput) {
    availableAudioTracks = [];
    availableSubtitleTracks = [];
    selectedAudioStreamIndex = -1;
    selectedSubtitleStreamIndex = -1;
    rebuildTrackOptionButtons();
    return;
  }

  const query = new URLSearchParams({ input: activeTrackSourceInput });
  if (
    supportedAudioLangs.has(preferredAudioLang) &&
    preferredAudioLang !== "auto"
  ) {
    query.set("audioLang", preferredAudioLang);
  }
  if (preferredSubtitleLang && preferredSubtitleLang !== "off") {
    query.set("subtitleLang", preferredSubtitleLang);
  }

  try {
    const payload = await requestJson(`/api/media/tracks?${query.toString()}`);
    availableAudioTracks = Array.isArray(payload?.tracks?.audioTracks)
      ? payload.tracks.audioTracks
      : [];
    availableSubtitleTracks = Array.isArray(payload?.tracks?.subtitleTracks)
      ? payload.tracks.subtitleTracks
      : [];

    const nextAudioStreamIndex = Number(payload?.selectedAudioStreamIndex);
    selectedAudioStreamIndex =
      Number.isFinite(nextAudioStreamIndex) && nextAudioStreamIndex >= 0
        ? Math.floor(nextAudioStreamIndex)
        : -1;

    const nextSubtitleStreamIndex = Number(
      payload?.selectedSubtitleStreamIndex,
    );
    selectedSubtitleStreamIndex =
      Number.isFinite(nextSubtitleStreamIndex) && nextSubtitleStreamIndex >= 0
        ? Math.floor(nextSubtitleStreamIndex)
        : -1;
  } catch {
    // Track probing is best effort for explicit sources.
    availableAudioTracks = [];
    availableSubtitleTracks = [];
    selectedAudioStreamIndex = -1;
    selectedSubtitleStreamIndex = -1;
  }

  rebuildTrackOptionButtons();
}

async function resolveTmdbMovieViaBackend(
  tmdbMovieId,
  { allowSourceFallback = true } = {},
) {
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
  const pinnedSourceHash = getPinnedSourceHashForRequests();
  if (pinnedSourceHash) {
    query.set("sourceHash", pinnedSourceHash);
  }
  if (preferredSourceMinSeeders > 0) {
    query.set("minSeeders", String(preferredSourceMinSeeders));
  }
  if (
    preferredSourceFormats.length > 0 &&
    preferredSourceFormats.length < supportedSourceFormats.length
  ) {
    query.set("allowedFormats", preferredSourceFormats.join(","));
  }
  query.set("sourceLang", preferredSourceLanguage);

  try {
    return await requestJson(
      `/api/resolve/movie?${query.toString()}`,
      {},
      95000,
    );
  } catch (error) {
    if (!allowSourceFallback || !pinnedSourceHash) {
      throw error;
    }
    query.delete("sourceHash");
    return requestJson(`/api/resolve/movie?${query.toString()}`, {}, 95000);
  }
}

async function resolveTmdbTvEpisodeViaBackend(
  tmdbSeriesId,
  season,
  episodeOrdinal,
  { allowContainerFallback = true, allowSourceFallback = true } = {},
) {
  const buildQuery = (containerPreference = "", sourceHash = "") => {
    const query = new URLSearchParams({
      tmdbId: tmdbSeriesId,
      title,
      year,
      seasonNumber: String(Math.max(1, Math.floor(Number(season) || 1))),
      episodeNumber: String(
        Math.max(1, Math.floor(Number(episodeOrdinal) || 1)),
      ),
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
      preferredSourceFormats.length > 0 &&
      preferredSourceFormats.length < supportedSourceFormats.length
    ) {
      query.set("allowedFormats", preferredSourceFormats.join(","));
    }
    query.set("sourceLang", preferredSourceLanguage);
    return query;
  };

  const pinnedSourceHash = getPinnedSourceHashForRequests();
  try {
    return await requestJson(
      `/api/resolve/tv?${buildQuery(preferredContainer, pinnedSourceHash).toString()}`,
      {},
      95000,
    );
  } catch (error) {
    let lastError = error;
    const fallbackAttempts = [];
    const seen = new Set([`${preferredContainer}::${pinnedSourceHash}`]);

    const pushFallback = (containerPreference, sourceHashPreference) => {
      const key = `${containerPreference}::${sourceHashPreference}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      fallbackAttempts.push([containerPreference, sourceHashPreference]);
    };

    if (allowContainerFallback && preferredContainer) {
      pushFallback("", pinnedSourceHash);
    }
    if (allowSourceFallback && pinnedSourceHash) {
      pushFallback(preferredContainer, "");
    }
    if (
      allowContainerFallback &&
      allowSourceFallback &&
      preferredContainer &&
      pinnedSourceHash
    ) {
      pushFallback("", "");
    }

    for (const [fallbackContainer, fallbackSource] of fallbackAttempts) {
      try {
        return await requestJson(
          `/api/resolve/tv?${buildQuery(fallbackContainer, fallbackSource).toString()}`,
          {},
          95000,
        );
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }

    throw lastError;
  }
}

async function fetchTmdbSourceOptionsViaBackend() {
  if (!isTmdbResolvedPlayback || !tmdbId) {
    availablePlaybackSources = [];
    renderSourceOptionsWhenStable();
    return;
  }

  const query = new URLSearchParams({
    tmdbId,
    mediaType: isTmdbTvPlayback ? "tv" : "movie",
    title,
    year,
    audioLang: preferredAudioLang,
    quality: preferredQuality,
    limit: String(
      Math.max(preferredSourceResultsLimit, SOURCE_FETCH_BATCH_LIMIT),
    ),
  });
  if (isTmdbTvPlayback) {
    query.set("seasonNumber", String(seasonNumber));
    query.set("episodeNumber", String(episodeNumber));
    if (preferredContainer) {
      query.set("preferredContainer", preferredContainer);
    }
  }
  const pinnedSourceHash = getPinnedSourceHashForRequests();
  if (pinnedSourceHash) {
    query.set("sourceHash", pinnedSourceHash);
  }
  if (preferredSourceMinSeeders > 0) {
    query.set("minSeeders", String(preferredSourceMinSeeders));
  }
  if (
    preferredSourceFormats.length > 0 &&
    preferredSourceFormats.length < supportedSourceFormats.length
  ) {
    query.set("allowedFormats", preferredSourceFormats.join(","));
  }
  query.set("sourceLang", preferredSourceLanguage);

  try {
    const payload = await requestJson(
      `/api/resolve/sources?${query.toString()}`,
      {},
      45000,
    );
    const options = Array.isArray(payload?.sources) ? payload.sources : [];
    availablePlaybackSources = sortSourcesBySeeders(
      options
        .map((item) => ({
          ...item,
          sourceHash: normalizeSourceHash(
            item?.sourceHash || item?.infoHash || "",
          ),
        }))
        .filter((item) => Boolean(item.sourceHash)),
      {
        preferContainer: "mp4",
      },
    );

    if (
      selectedSourceHash &&
      !availablePlaybackSources.some(
        (item) => item.sourceHash === selectedSourceHash,
      )
    ) {
      selectedSourceHash = "";
      sourceSelectionPinned = false;
      applyPreferredSourceAudioSync(selectedSourceHash);
      persistSourceHashInUrl();
    }
    renderSourceOptionsWhenStable();
  } catch {
    availablePlaybackSources = [];
    renderSourceOptionsWhenStable();
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
  if (sourceSelectionPinned && selectedSourceHash) {
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
  episodesControl.addEventListener("mouseleave", () =>
    closeEpisodesPopover(true),
  );
  episodesControl.addEventListener("focusin", openEpisodesPopover);
  episodesControl.addEventListener("focusout", () =>
    closeEpisodesPopover(true),
  );
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
  audioControl.addEventListener("focusout", (event) => {
    if (!(event.target instanceof Node)) {
      closeAudioPopover(true);
      return;
    }

    if (
      event.relatedTarget instanceof Node &&
      audioControl.contains(event.relatedTarget)
    ) {
      return;
    }
    closeAudioPopover(true);
  });
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
    showResolver("Switching audio language...");
    try {
      const result = await resolveTmdbSourcesAndPlay();
      if (result?.nativeLaunched) {
        return;
      }
      if (resumeFrom > 1) {
        seekToAbsoluteTime(resumeFrom);
      }
    } catch (error) {
      console.error("Failed to switch audio language:", error);
      showResolver(error?.message || "Unable to switch language.", {
        isError: true,
      });
    }
    return;
  }

  const streamIndex = Number(option.dataset.streamIndex || -1);
  const trackLang = String(option.dataset.trackLanguage || "").toLowerCase();
  if (
    !Number.isFinite(streamIndex) ||
    streamIndex < 0 ||
    streamIndex === selectedAudioStreamIndex
  ) {
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

  if (!activeTrackSourceInput) {
    return;
  }

  const resumeFrom = getEffectiveCurrentTime();
  const wasPaused = video.paused;
  const selectedSubtitleTrack = getSubtitleTrackByStreamIndex(
    selectedSubtitleStreamIndex,
  );
  const shouldKeepEmbeddedSubtitle = shouldUseNativeEmbeddedSubtitleTrack(
    selectedSubtitleTrack,
  );
  showResolver("Switching audio track...");
  if (shouldKeepEmbeddedSubtitle) {
    setVideoSource(
      buildSoftwareDecodeUrl(
        activeTrackSourceInput,
        0,
        selectedAudioStreamIndex,
        activeAudioSyncMs || preferredAudioSyncMs,
        selectedSubtitleStreamIndex,
      ),
    );
  } else {
    setVideoSource(
      buildHlsPlaybackUrl(activeTrackSourceInput, selectedAudioStreamIndex, -1),
    );
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

  const previousSubtitleTrack = getSubtitleTrackByStreamIndex(
    selectedSubtitleStreamIndex,
  );
  if (
    streamIndex === selectedSubtitleStreamIndex ||
    (streamIndex < 0 && selectedSubtitleStreamIndex < 0)
  ) {
    closeAudioPopover();
    return;
  }

  selectedSubtitleStreamIndex = streamIndex >= 0 ? streamIndex : -1;
  const selectedTrack = getSubtitleTrackByStreamIndex(
    selectedSubtitleStreamIndex,
  );
  const useNativeEmbeddedSubtitle =
    shouldUseNativeEmbeddedSubtitleTrack(selectedTrack);
  const usedNativeEmbeddedBefore = shouldUseNativeEmbeddedSubtitleTrack(
    previousSubtitleTrack,
  );
  preferredSubtitleLang =
    selectedSubtitleStreamIndex >= 0
      ? String(option.dataset.subtitleLang || "")
      : "off";
  preferredSubtitleLang = normalizeSubtitlePreference(preferredSubtitleLang);
  persistSubtitleLangPreference(preferredSubtitleLang);
  persistSubtitleStreamPreference(selectedSubtitleStreamIndex);
  void persistTrackPreferencesOnServer({
    subtitleLang: preferredSubtitleLang,
  });

  if (
    isTmdbResolvedPlayback &&
    activeTrackSourceInput &&
    (useNativeEmbeddedSubtitle || usedNativeEmbeddedBefore)
  ) {
    const resumeFrom = getEffectiveCurrentTime();
    const wasPaused = video.paused;
    showResolver(
      selectedSubtitleStreamIndex >= 0
        ? "Switching subtitles..."
        : "Turning subtitles off...",
    );
    const remuxSubtitleStreamIndex = useNativeEmbeddedSubtitle
      ? selectedSubtitleStreamIndex
      : -1;
    setVideoSource(
      buildSoftwareDecodeUrl(
        activeTrackSourceInput,
        0,
        selectedAudioStreamIndex,
        activeAudioSyncMs || preferredAudioSyncMs,
        remuxSubtitleStreamIndex,
      ),
    );
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

async function handleSourceOptionSelection(nextSourceHash) {
  const normalizedNextSourceHash = normalizeSourceHash(nextSourceHash);

  if (isResolvingSource()) {
    return;
  }

  if (!normalizedNextSourceHash) {
    syncSourceSelectionState();
    renderSelectedSourceDetails();
    return;
  }

  if (normalizedNextSourceHash === selectedSourceHash) {
    syncSourceSelectionState();
    renderSelectedSourceDetails();
    return;
  }

  const previousSourceHash = selectedSourceHash;
  const previousSourceSelectionPinned = sourceSelectionPinned;
  selectedSourceHash = normalizedNextSourceHash;
  sourceSelectionPinned = true;
  applyPreferredSourceAudioSync(selectedSourceHash);
  persistSourceHashInUrl();
  syncAudioState();

  if (!isTmdbResolvedPlayback) {
    return;
  }

  const resumeFrom = getEffectiveCurrentTime();
  const wasPaused = video.paused;
  tmdbResolveRetries = 0;
  showResolver("Switching source...");
  try {
    const result = await resolveTmdbSourcesAndPlay({
      allowSourceFallback: false,
      requiredSourceHash: normalizedNextSourceHash,
    });
    if (result?.nativeLaunched) {
      return;
    }
    if (!wasPaused) {
      await tryPlay();
    }
    if (resumeFrom > 1) {
      seekToAbsoluteTime(resumeFrom);
    }
  } catch (error) {
    selectedSourceHash = previousSourceHash;
    sourceSelectionPinned = previousSourceSelectionPinned;
    applyPreferredSourceAudioSync(selectedSourceHash);
    persistSourceHashInUrl();
    syncAudioState();
    const fallbackMessage = error?.message || "Unable to switch source.";
    showResolver(fallbackMessage, { isError: true });
  }
}

audioTabSubtitles?.addEventListener("click", () => {
  if (isResolvingSource()) {
    return;
  }
  setActiveAudioTab("subtitles");
});

audioTabSources?.addEventListener("click", () => {
  if (isResolvingSource() || !isTmdbResolvedPlayback) {
    return;
  }

  if (!availablePlaybackSources.length) {
    void fetchTmdbSourceOptionsViaBackend();
  }
  setActiveAudioTab("sources");
});

[audioTabSubtitles, audioTabSources].forEach((tabButton) => {
  tabButton?.addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }

    event.preventDefault();
    if (
      event.key === "ArrowRight" &&
      audioTabSources &&
      !audioTabSources.hidden &&
      !audioTabSources.disabled
    ) {
      setActiveAudioTab("sources");
      audioTabSources.focus({ preventScroll: true });
      return;
    }
    setActiveAudioTab("subtitles");
    audioTabSubtitles?.focus({ preventScroll: true });
  });
});

sourceOptionsContainer?.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const sourceOption = event.target.closest(".source-option");
  if (!(sourceOption instanceof HTMLButtonElement)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  void handleSourceOptionSelection(sourceOption.dataset.sourceHash || "");
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
      return Math.abs(rate - video.playbackRate) <
        Math.abs(closest - video.playbackRate)
        ? rate
        : closest;
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
    seekToAbsoluteTime(pendingTranscodeSeekRatio * seekScaleDurationSeconds, {
      showLoading: true,
    });
  } else if (pendingStandardSeekRatio !== null && !isTranscodeSourceActive()) {
    seekToAbsoluteTime(pendingStandardSeekRatio * seekScaleDurationSeconds, {
      showLoading: true,
    });
  }

  pendingTranscodeSeekRatio = null;
  pendingStandardSeekRatio = null;
}

seekBar.addEventListener("pointerup", handleSeekPointerUp);
seekBar.addEventListener("pointercancel", handleSeekPointerUp);
document.addEventListener("pointerup", handleSeekPointerUp);

seekBar.addEventListener("input", () => {
  const seekScaleDurationSeconds = getSeekScaleDurationSeconds();
  if (
    !hasActiveSource() ||
    isResolvingSource() ||
    seekScaleDurationSeconds <= 0
  ) {
    return;
  }

  const ratio = Number(seekBar.value) / 1000;
  if (isTranscodeSourceActive()) {
    pendingTranscodeSeekRatio = ratio;
    paintSeekProgress(
      seekBar.value,
      getBufferedSeekValue(seekScaleDurationSeconds),
    );
    return;
  }

  paintSeekProgress(
    seekBar.value,
    getBufferedSeekValue(seekScaleDurationSeconds),
  );
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
  if (
    !hasAppliedInitialResume &&
    Number.isFinite(resumeTime) &&
    resumeTime > 1 &&
    resumeTime < seekScaleDurationSeconds - 8
  ) {
    if (isTranscodeSourceActive()) {
      const relativeResume = resumeTime - transcodeBaseOffsetSeconds;
      if (
        relativeResume >= 0 &&
        Number.isFinite(video.duration) &&
        relativeResume < video.duration - 3
      ) {
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
    durationText.textContent = formatTime(
      Math.max(0, seekScaleDurationSeconds - getEffectiveCurrentTime()),
    );
  }
  syncSeekState();
  paintSeekProgress(
    seekBar.value,
    getBufferedSeekValue(seekScaleDurationSeconds),
  );
});
if (
  video.textTracks &&
  typeof video.textTracks.addEventListener === "function"
) {
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
});
video.addEventListener("ended", () => {
  const expectedDuration = getDisplayDurationSeconds();
  const effectiveCurrent = getEffectiveCurrentTime();
  const endedTooEarly =
    isTmdbResolvedPlayback &&
    Number.isFinite(expectedDuration) &&
    expectedDuration > 120 &&
    effectiveCurrent < expectedDuration - 45;

  if (endedTooEarly) {
    const recovered = attemptTmdbRecovery(
      "Stream ended early, trying another source...",
    );
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
  const message =
    mediaError?.message || "Resolved stream could not be played. Try again.";

  if (attemptTmdbRecovery("Trying alternate source...")) {
    return;
  }

  showResolver(message, { isError: true });
});

function isInteractiveTarget(target) {
  if (!target || !(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest("button, input, textarea, select, [contenteditable='true']"),
  );
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
playerShell.addEventListener("touchstart", handleUserActivity, {
  passive: true,
});
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

  if (event.key === "[" || event.key === "]") {
    if (isInteractiveTarget(event.target) || isResolvingSource()) {
      return;
    }
    if (!hasActiveSource() || !isTranscodeSourceActive()) {
      return;
    }
    event.preventDefault();
    await adjustSourceAudioSync(
      event.key === "[" ? AUDIO_SYNC_STEP_MS : -AUDIO_SYNC_STEP_MS,
    );
    return;
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

  if (
    event.key === SOURCE_MIN_SEEDERS_PREF_KEY ||
    event.key === SOURCE_ALLOWED_FORMATS_PREF_KEY ||
    event.key === SOURCE_LANGUAGE_PREF_KEY ||
    event.key === SOURCE_RESULTS_LIMIT_PREF_KEY
  ) {
    preferredSourceMinSeeders = getStoredSourceMinSeeders();
    preferredSourceResultsLimit = getStoredSourceResultsLimit();
    preferredSourceFormats = getStoredSourceFormats();
    preferredSourceLanguage = getStoredSourceLanguage();
    if (event.key === SOURCE_RESULTS_LIMIT_PREF_KEY) {
      renderSourceOptionsWhenStable();
    }
    if (
      event.key !== SOURCE_RESULTS_LIMIT_PREF_KEY &&
      isTmdbResolvedPlayback &&
      audioControl?.classList.contains("is-open")
    ) {
      void fetchTmdbSourceOptionsViaBackend();
    }
  }

  if (event.key === NATIVE_PLAYBACK_MODE_PREF_KEY) {
    preferredNativePlaybackMode = getStoredNativePlaybackMode();
  }

  if (event.key === REMUX_VIDEO_MODE_PREF_KEY) {
    preferredRemuxVideoMode = getStoredRemuxVideoMode();
  }
});
window.addEventListener("beforeunload", () => {
  clearSingleClickPlaybackToggle();
  hideSeekLoadingIndicator();
  clearControlsHideTimer();
  clearStreamStallRecovery();
  persistResumeTime(true);
  destroyHlsInstance();
});

async function initPlaybackSource() {
  hasAppliedInitialResume = false;
  nativePlaybackLaunched = false;
  pendingTranscodeSeekRatio = null;
  availableAudioTracks = [];
  availableSubtitleTracks = [];
  selectedAudioStreamIndex = -1;
  selectedSubtitleStreamIndex = -1;
  activeTrackSourceInput = "";
  rebuildTrackOptionButtons();

  if (hasExplicitSource) {
    tmdbExpectedDurationSeconds = 0;
    hideResolver();
    await resolveExplicitSourceTrackSelection(src);
    const shouldUseRemux =
      shouldUseSoftwareDecode(src) ||
      selectedAudioStreamIndex >= 0 ||
      selectedSubtitleStreamIndex >= 0;
    const nextSource = shouldUseRemux
      ? buildSoftwareDecodeUrl(
          src,
          0,
          selectedAudioStreamIndex,
          preferredAudioSyncMs,
          selectedSubtitleStreamIndex,
        )
      : src;
    if (await tryLaunchNativePlayback(nextSource, resumeTime)) {
      return;
    }
    setVideoSource(nextSource);
    await tryPlay();
    return;
  }

  if (
    isSeriesPlayback &&
    seriesRequiresLocalEpisodeSources() &&
    !hasExplicitSource
  ) {
    tmdbExpectedDurationSeconds = 0;
    video.removeAttribute("src");
    video.load();
    showResolver("This episode is unavailable until its MP4 source is added.", {
      showStatus: true,
      isError: true,
    });
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
    showResolver(error.message || "Unable to resolve this stream.", {
      isError: true,
    });
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
if (
  isTmdbResolvedPlayback &&
  !hasAudioLangParam &&
  preferredAudioLang !== "auto"
) {
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
