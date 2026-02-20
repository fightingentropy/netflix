const introVideo = document.getElementById("introVideo");
const muteToggle = document.getElementById("muteToggle");
const playButton = document.getElementById("heroPlay");
const infoButton = document.getElementById("heroInfo");
const heroTitle = document.getElementById("heroTitle");
const pageRoot = document.querySelector(".page");
const continueRow = document.getElementById("continueRow");
const continueCardsContainer = document.getElementById("continueCards");
const continueEmpty = document.getElementById("continueEmpty");
const cardsContainer = document.getElementById("cardsContainer");
const accountMenu = document.getElementById("accountMenu");
const accountMenuToggle = document.getElementById("accountMenuToggle");
const accountMenuPanel = document.getElementById("accountMenuPanel");
const accountAvatarButton = document.getElementById("accountAvatarButton");
const accountAvatar = document.getElementById("accountAvatar");
const detailsModal = document.getElementById("detailsModal");
const detailsCloseButton = document.getElementById("detailsClose");
const detailsPlayButton = document.getElementById("detailsPlay");
const detailsImage = document.getElementById("detailsImage");
const detailsTitle = document.getElementById("detailsTitle");
const detailsYear = document.getElementById("detailsYear");
const detailsRuntime = document.getElementById("detailsRuntime");
const detailsMaturity = document.getElementById("detailsMaturity");
const detailsQuality = document.getElementById("detailsQuality");
const detailsAudio = document.getElementById("detailsAudio");
const detailsDescription = document.getElementById("detailsDescription");
const detailsCast = document.getElementById("detailsCast");
const detailsGenres = document.getElementById("detailsGenres");
const detailsVibe = document.getElementById("detailsVibe");

let activeDetails = null;
let detailsTrigger = null;
let closeModalTimer = null;
let detailsRequestVersion = 0;

const tmdbDetailsCache = new Map();
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const AUDIO_LANG_PREF_KEY_PREFIX = "netflix-audio-lang:movie:";
const SUBTITLE_LANG_PREF_KEY_PREFIX = "netflix-subtitle-lang:movie:";
const SUBTITLE_STREAM_PREF_KEY_PREFIX = "netflix-subtitle-stream:movie:";
const STREAM_QUALITY_PREF_KEY = "netflix-stream-quality-pref";
const PROFILE_AVATAR_STYLE_PREF_KEY = "netflix-profile-avatar-style";
const PROFILE_AVATAR_MODE_PREF_KEY = "netflix-profile-avatar-mode";
const PROFILE_AVATAR_IMAGE_PREF_KEY = "netflix-profile-avatar-image";
const RESUME_STORAGE_PREFIX = "netflix-resume:";
const CONTINUE_WATCHING_META_KEY = "netflix-continue-watching-meta";
const JEFFREY_EPSTEIN_SERIES_ID = "jeffrey-epstein-filthy-rich";
const JEFFREY_EPSTEIN_EPISODE_1_SOURCE =
  "assets/videos/Jeffrey.Epstein.Filthy.Rich.S01E01.2160p.NF.WEB-DL.DDP5.1.SDR.HEVC-DiSGUSTiNG.mp4";
const BREAKING_BAD_SERIES_ID = "breaking-bad";
const PRIDE_PREJUDICE_SOURCE =
  "assets/videos/Pride.Prejudice.2005.2160p.4K.WEB.x265.10bit.AAC5.1-[YTS.MX].mp4";
const PRIDE_PREJUDICE_THUMBNAIL = "assets/images/pride-prejudice-thumb.jpg";
const supportedAudioLangs = new Set(["auto", "en", "fr", "es", "de"]);
const supportedStreamQualityPreferences = new Set([
  "auto",
  "2160p",
  "1080p",
  "720p",
]);
const supportedAvatarStyles = new Set([
  "blue",
  "crimson",
  "emerald",
  "violet",
  "amber",
]);
const avatarStyleClassNames = Array.from(supportedAvatarStyles).map(
  (style) => `avatar-style-${style}`,
);

function normalizeAvatarStyle(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (supportedAvatarStyles.has(normalized)) {
    return normalized;
  }
  return "blue";
}

function normalizeAvatarMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "custom" ? "custom" : "preset";
}

function sanitizeAvatarImageData(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("data:image/")) {
    return "";
  }
  if (raw.length > 2_000_000) {
    return "";
  }
  return raw;
}

function getStoredAvatarStylePreference() {
  try {
    return normalizeAvatarStyle(
      localStorage.getItem(PROFILE_AVATAR_STYLE_PREF_KEY),
    );
  } catch {
    return "blue";
  }
}

function getStoredAvatarModePreference() {
  try {
    return normalizeAvatarMode(
      localStorage.getItem(PROFILE_AVATAR_MODE_PREF_KEY),
    );
  } catch {
    return "preset";
  }
}

function getStoredAvatarImagePreference() {
  try {
    return sanitizeAvatarImageData(
      localStorage.getItem(PROFILE_AVATAR_IMAGE_PREF_KEY),
    );
  } catch {
    return "";
  }
}

function applyAccountAvatarStyle({
  style = getStoredAvatarStylePreference(),
  mode = getStoredAvatarModePreference(),
  imageData = getStoredAvatarImagePreference(),
} = {}) {
  if (!accountAvatar) {
    return;
  }

  const normalizedStyle = normalizeAvatarStyle(style);
  const normalizedMode = normalizeAvatarMode(mode);
  const safeImage = sanitizeAvatarImageData(imageData);

  avatarStyleClassNames.forEach((className) => {
    accountAvatar.classList.remove(className);
  });
  accountAvatar.classList.remove("avatar-custom-image");
  accountAvatar.style.removeProperty("--avatar-image");
  accountAvatar.style.removeProperty("backgroundImage");

  if (normalizedMode === "custom" && safeImage) {
    accountAvatar.classList.add("avatar-custom-image");
    accountAvatar.style.setProperty("--avatar-image", `url("${safeImage}")`);
    accountAvatar.style.backgroundImage = "var(--avatar-image)";
    return;
  }

  accountAvatar.classList.add(`avatar-style-${normalizedStyle}`);
}

function getStoredAudioLangForTmdbMovie(tmdbId) {
  const normalizedTmdbId = String(tmdbId || "").trim();
  if (!normalizedTmdbId) {
    return "auto";
  }

  try {
    const raw = String(
      localStorage.getItem(
        `${AUDIO_LANG_PREF_KEY_PREFIX}${normalizedTmdbId}`,
      ) || "",
    )
      .trim()
      .toLowerCase();
    if (supportedAudioLangs.has(raw)) {
      return raw;
    }
  } catch {
    // Ignore storage access issues.
  }

  return "auto";
}

function normalizeStreamQualityPreference(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "auto";
  if (normalized === "4k" || normalized === "uhd") return "2160p";
  if (normalized === "2160") return "2160p";
  if (normalized === "1080") return "1080p";
  if (normalized === "720") return "720p";
  if (supportedStreamQualityPreferences.has(normalized)) {
    return normalized;
  }
  return "auto";
}

function getStoredStreamQualityPreference() {
  try {
    const raw = localStorage.getItem(STREAM_QUALITY_PREF_KEY);
    return normalizeStreamQualityPreference(raw);
  } catch {
    return "auto";
  }
}

function formatRuntime(minutes) {
  if (!minutes || Number.isNaN(minutes)) return "";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) return `${remainingMinutes}m`;
  if (!remainingMinutes) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatResumeTimestamp(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function extractSeriesIdFromSourceIdentity(sourceIdentity) {
  const normalizedSource = String(sourceIdentity || "").trim();
  if (!normalizedSource) {
    return "";
  }

  const seriesMatch = /^series:([^:]+):episode:(\d+)$/i.exec(normalizedSource);
  return seriesMatch
    ? String(seriesMatch[1] || "")
        .trim()
        .toLowerCase()
    : "";
}

function parseTmdbSourceIdentity(sourceIdentity) {
  const normalizedSource = String(sourceIdentity || "").trim();
  if (!normalizedSource.toLowerCase().startsWith("tmdb:")) {
    return { tmdbId: "", mediaType: "" };
  }

  const typedMatch = /^tmdb:(movie|tv):(\d+)(?::s(\d+):e(\d+))?$/i.exec(
    normalizedSource,
  );
  if (typedMatch) {
    return {
      mediaType: String(typedMatch[1] || "")
        .trim()
        .toLowerCase(),
      tmdbId: String(typedMatch[2] || "").trim(),
    };
  }

  return { tmdbId: "", mediaType: "" };
}

function removeResumeEntriesForSource(
  sourceIdentity,
  seriesId = "",
  parsedTmdbSource = { tmdbId: "", mediaType: "" },
) {
  const normalizedSource = String(sourceIdentity || "").trim();
  if (!normalizedSource) {
    return;
  }

  const keysToDelete = new Set();
  keysToDelete.add(`${RESUME_STORAGE_PREFIX}${normalizedSource}`);

  const normalizedSeriesId = String(seriesId || "")
    .trim()
    .toLowerCase();
  if (normalizedSeriesId) {
    const seriesResumePrefix = `${RESUME_STORAGE_PREFIX}series:${normalizedSeriesId}:episode:`;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(seriesResumePrefix)) {
        keysToDelete.add(key);
      }
    }
  }

  const tmdbId = String(parsedTmdbSource?.tmdbId || "").trim();
  const mediaType = String(parsedTmdbSource?.mediaType || "")
    .trim()
    .toLowerCase();
  if (tmdbId) {
    if (mediaType === "tv") {
      const tvResumePrefix = `${RESUME_STORAGE_PREFIX}tmdb:tv:${tmdbId}`;
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (
          key &&
          (key === tvResumePrefix || key.startsWith(`${tvResumePrefix}:`))
        ) {
          keysToDelete.add(key);
        }
      }
    } else {
      keysToDelete.add(`${RESUME_STORAGE_PREFIX}tmdb:movie:${tmdbId}`);
    }
  }

  keysToDelete.forEach((key) => {
    localStorage.removeItem(key);
  });
}

function removeContinueMetaEntriesForSource(
  metaMap,
  sourceIdentity,
  seriesId = "",
  parsedTmdbSource = { tmdbId: "", mediaType: "" },
) {
  if (!metaMap || typeof metaMap !== "object") {
    return;
  }

  const normalizedSource = String(sourceIdentity || "").trim();
  const normalizedSeriesId = String(seriesId || "")
    .trim()
    .toLowerCase();
  if (normalizedSeriesId) {
    Object.keys(metaMap).forEach((key) => {
      if (extractSeriesIdFromSourceIdentity(key) === normalizedSeriesId) {
        delete metaMap[key];
      }
    });
    return;
  }

  const tmdbId = String(parsedTmdbSource?.tmdbId || "").trim();
  const mediaType = String(parsedTmdbSource?.mediaType || "")
    .trim()
    .toLowerCase();
  if (tmdbId) {
    Object.keys(metaMap).forEach((key) => {
      const parsed = parseTmdbSourceIdentity(key);
      if (String(parsed.tmdbId || "").trim() !== tmdbId) {
        return;
      }
      const parsedMediaType = String(parsed.mediaType || "")
        .trim()
        .toLowerCase();
      if (mediaType && parsedMediaType && parsedMediaType !== mediaType) {
        return;
      }
      delete metaMap[key];
    });
  }

  delete metaMap[normalizedSource];
}

function removeLocalTitleTrackPreferences(tmdbId, mediaType = "movie") {
  const normalizedTmdbId = String(tmdbId || "").trim();
  const normalizedMediaType = String(mediaType || "")
    .trim()
    .toLowerCase();
  if (normalizedMediaType === "tv" || !/^\d+$/.test(normalizedTmdbId)) {
    return;
  }
  localStorage.removeItem(`${AUDIO_LANG_PREF_KEY_PREFIX}${normalizedTmdbId}`);
  localStorage.removeItem(
    `${SUBTITLE_LANG_PREF_KEY_PREFIX}${normalizedTmdbId}`,
  );
  localStorage.removeItem(
    `${SUBTITLE_STREAM_PREF_KEY_PREFIX}${normalizedTmdbId}`,
  );
}

async function clearServerTitleMemory(tmdbId, mediaType = "movie") {
  const normalizedTmdbId = String(tmdbId || "").trim();
  const normalizedMediaType = String(mediaType || "")
    .trim()
    .toLowerCase();
  if (normalizedMediaType === "tv" || !/^\d+$/.test(normalizedTmdbId)) {
    return;
  }

  try {
    const query = new URLSearchParams({ tmdbId: normalizedTmdbId });
    await fetch(`/api/title/preferences?${query.toString()}`, {
      method: "DELETE",
    });
  } catch {
    // Best-effort server cleanup only.
  }
}

function inferContinueMediaType(
  sourceIdentity,
  explicitMediaType = "",
  explicitSeriesId = "",
) {
  const normalizedExplicitType = String(explicitMediaType || "")
    .trim()
    .toLowerCase();
  if (normalizedExplicitType === "movie" || normalizedExplicitType === "tv") {
    return normalizedExplicitType;
  }

  const seriesId =
    String(explicitSeriesId || "")
      .trim()
      .toLowerCase() || extractSeriesIdFromSourceIdentity(sourceIdentity);
  if (seriesId) {
    return "tv";
  }

  const parsedSource = parseTmdbSourceIdentity(sourceIdentity);
  if (parsedSource.mediaType === "movie" || parsedSource.mediaType === "tv") {
    return parsedSource.mediaType;
  }

  return "";
}

function normalizeLocalContinueEntry(entry) {
  const safeEntry = { ...entry };
  safeEntry.mediaType = String(safeEntry.mediaType || "")
    .trim()
    .toLowerCase();
  if (safeEntry.mediaType !== "movie" && safeEntry.mediaType !== "tv") {
    safeEntry.mediaType = "";
  }
  safeEntry.seriesId = String(safeEntry.seriesId || "").trim();
  safeEntry.episodeIndex = Number.isFinite(Number(safeEntry.episodeIndex))
    ? Math.max(0, Math.floor(Number(safeEntry.episodeIndex)))
    : -1;
  return safeEntry;
}

function removeContinueWatchingEntry(sourceIdentity) {
  const normalizedSource = String(sourceIdentity || "").trim();
  if (!normalizedSource) return;
  const normalizedSeriesId =
    extractSeriesIdFromSourceIdentity(normalizedSource);
  const parsedTmdbSource = parseTmdbSourceIdentity(normalizedSource);

  try {
    removeResumeEntriesForSource(
      normalizedSource,
      normalizedSeriesId,
      parsedTmdbSource,
    );

    const metaMap = readContinueWatchingMetaMap();
    if (metaMap && typeof metaMap === "object") {
      removeContinueMetaEntriesForSource(
        metaMap,
        normalizedSource,
        normalizedSeriesId,
        parsedTmdbSource,
      );

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

    removeLocalTitleTrackPreferences(
      parsedTmdbSource.tmdbId,
      parsedTmdbSource.mediaType,
    );
  } catch {
    // Ignore storage access issues.
  }

  void clearServerTitleMemory(
    parsedTmdbSource.tmdbId,
    parsedTmdbSource.mediaType,
  );
}

function getContinueWatchingEntries() {
  const entriesBySource = new Map();
  const metaMap = readContinueWatchingMetaMap();
  const dedupeKeyForSource = (sourceIdentity, explicitSeriesId = "") => {
    const normalizedSeriesId =
      String(explicitSeriesId || "")
        .trim()
        .toLowerCase() || extractSeriesIdFromSourceIdentity(sourceIdentity);
    if (normalizedSeriesId) {
      return `series:${normalizedSeriesId}`;
    }
    return String(sourceIdentity || "").trim();
  };

  Object.entries(metaMap).forEach(([sourceIdentity, value]) => {
    const normalizedSource = String(sourceIdentity || "").trim();
    if (!normalizedSource || typeof value !== "object" || value === null)
      return;

    const resumeKey = `${RESUME_STORAGE_PREFIX}${normalizedSource}`;
    const resumeSeconds = Number(localStorage.getItem(resumeKey));
    if (!Number.isFinite(resumeSeconds) || resumeSeconds < 1) {
      return;
    }

    const normalizedEntry = normalizeLocalContinueEntry({
      sourceIdentity: normalizedSource,
      resumeSeconds,
      updatedAt: Number(value.updatedAt) || 0,
      title: String(value.title || "").trim(),
      episode: String(value.episode || "").trim(),
      src: String(value.src || "").trim(),
      tmdbId:
        String(value.tmdbId || "").trim() ||
        parseTmdbSourceIdentity(normalizedSource).tmdbId,
      mediaType: inferContinueMediaType(
        normalizedSource,
        String(value.mediaType || "").trim(),
        String(value.seriesId || "").trim(),
      ),
      seriesId: String(value.seriesId || "").trim(),
      episodeIndex: Number.isFinite(Number(value.episodeIndex))
        ? Math.max(0, Math.floor(Number(value.episodeIndex)))
        : -1,
      year: String(value.year || "").trim(),
      thumb: String(value.thumb || "").trim(),
    });
    const dedupeKey = dedupeKeyForSource(
      normalizedSource,
      normalizedEntry.seriesId,
    );
    const existingEntry = entriesBySource.get(dedupeKey);
    if (
      !existingEntry ||
      Number(normalizedEntry.updatedAt || 0) >=
        Number(existingEntry.updatedAt || 0)
    ) {
      entriesBySource.set(dedupeKey, normalizedEntry);
    }
  });

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(RESUME_STORAGE_PREFIX)) {
      continue;
    }

    const sourceIdentity = key.slice(RESUME_STORAGE_PREFIX.length).trim();
    const dedupeCandidateKey = dedupeKeyForSource(sourceIdentity);
    if (!sourceIdentity || entriesBySource.has(dedupeCandidateKey)) {
      continue;
    }

    const resumeSeconds = Number(localStorage.getItem(key));
    if (!Number.isFinite(resumeSeconds) || resumeSeconds < 1) {
      continue;
    }

    const parsedTmdbSource = parseTmdbSourceIdentity(sourceIdentity);
    const tmdbId = String(parsedTmdbSource.tmdbId || "").trim();
    const seriesMatch = /^series:([^:]+):episode:(\d+)$/i.exec(sourceIdentity);
    const inferredSeriesId = seriesMatch
      ? String(seriesMatch[1] || "").trim()
      : "";
    const inferredEpisodeIndex = seriesMatch ? Number(seriesMatch[2]) : -1;
    const normalizedEntry = normalizeLocalContinueEntry({
      sourceIdentity,
      resumeSeconds,
      updatedAt: 0,
      title: tmdbId ? "Movie" : "Continue Watching",
      episode: "",
      src: tmdbId || inferredSeriesId ? "" : sourceIdentity,
      tmdbId,
      mediaType: inferContinueMediaType(
        sourceIdentity,
        parsedTmdbSource.mediaType,
        inferredSeriesId,
      ),
      seriesId: inferredSeriesId,
      episodeIndex: Number.isFinite(inferredEpisodeIndex)
        ? Math.max(0, Math.floor(inferredEpisodeIndex))
        : -1,
      year: "",
      thumb: "",
    });
    const dedupeKey = dedupeKeyForSource(sourceIdentity, inferredSeriesId);
    const existingEntry = entriesBySource.get(dedupeKey);
    if (
      !existingEntry ||
      Number(normalizedEntry.updatedAt || 0) >=
        Number(existingEntry.updatedAt || 0)
    ) {
      entriesBySource.set(dedupeKey, normalizedEntry);
    }
  }

  return Array.from(entriesBySource.values())
    .sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }
      return right.resumeSeconds - left.resumeSeconds;
    })
    .slice(0, 12);
}

function buildContinueWatchingCard(entry, tmdbDetails = null) {
  const normalizedMediaType = inferContinueMediaType(
    entry.sourceIdentity,
    entry.mediaType,
    entry.seriesId,
  );
  const isSeriesEntry = normalizedMediaType === "tv";
  const title =
    (isSeriesEntry
      ? tmdbDetails?.name || tmdbDetails?.title
      : tmdbDetails?.title || tmdbDetails?.name) ||
    entry.title ||
    (isSeriesEntry ? "Series" : "Movie");
  const releaseDate = isSeriesEntry
    ? String(tmdbDetails?.first_air_date || tmdbDetails?.release_date || "")
    : String(tmdbDetails?.release_date || "");
  const year = releaseDate ? releaseDate.slice(0, 4) : entry.year || "";
  const posterPath =
    tmdbDetails?.poster_path || tmdbDetails?.backdrop_path || "";
  const backdropPath =
    tmdbDetails?.backdrop_path || tmdbDetails?.poster_path || "";
  const posterUrl = posterPath
    ? `${TMDB_IMAGE_BASE}/w500${posterPath}`
    : entry.thumb ||
      getFallbackThumbnailForSource(entry.src || entry.sourceIdentity) ||
      "assets/images/thumbnail.jpg";
  const heroUrl = backdropPath
    ? `${TMDB_IMAGE_BASE}/original${backdropPath}`
    : posterUrl;
  const runtimeMinutes =
    Number(
      isSeriesEntry ? tmdbDetails?.episode_run_time?.[0] : tmdbDetails?.runtime,
    ) || 0;
  const estimatedDurationSeconds = runtimeMinutes > 0 ? runtimeMinutes * 60 : 0;
  const progressPercent =
    estimatedDurationSeconds > 0
      ? Math.max(
          4,
          Math.min(
            96,
            Math.round((entry.resumeSeconds / estimatedDurationSeconds) * 100),
          ),
        )
      : 24;
  const genreNames = (tmdbDetails?.genres || [])
    .map((genre) => String(genre?.name || "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const tagLine = genreNames.length
    ? genreNames.map(escapeHtml).join(" <span>&bull;</span> ")
    : "Continue <span>&bull;</span> Resume";
  const safeTitle = escapeHtml(title);
  const safeDescription = tmdbDetails?.overview || "Resume where you left off.";
  const maturity = tmdbDetails?.adult ? "18" : "13+";
  const qualityLabel = "HD";
  const contentTypeLabel = isSeriesEntry ? "Series" : "Movie";
  const cast = (tmdbDetails?.credits?.cast || [])
    .slice(0, 4)
    .map((person) => person?.name)
    .filter(Boolean)
    .join(", ");

  const card = document.createElement("article");
  card.className = "card";
  card.tabIndex = 0;
  card.dataset.resumeSource = entry.sourceIdentity;
  card.dataset.title = title;
  card.dataset.episode = `Resume at ${formatResumeTimestamp(entry.resumeSeconds)}`;
  card.dataset.src = entry.src || "";
  card.dataset.thumb = heroUrl;
  card.dataset.year = year || (isSeriesEntry ? "Series" : "Movie");
  card.dataset.runtime =
    runtimeMinutes > 0
      ? formatRuntime(runtimeMinutes)
      : isSeriesEntry
        ? "Series"
        : "Movie";
  card.dataset.maturity = maturity;
  card.dataset.quality = qualityLabel;
  card.dataset.audio = "Stereo";
  card.dataset.description = safeDescription;
  card.dataset.cast = cast || "Cast details unavailable.";
  card.dataset.genres = genreNames.length ? genreNames.join(", ") : "Movie";
  card.dataset.vibe = "Continue watching";
  card.dataset.tmdbId = entry.tmdbId || "";
  card.dataset.mediaType = normalizedMediaType || entry.mediaType || "";
  card.dataset.seriesId = entry.seriesId || "";
  card.dataset.episodeIndex = Number.isFinite(Number(entry.episodeIndex))
    ? String(Math.max(0, Math.floor(Number(entry.episodeIndex))))
    : "-1";

  card.innerHTML = `
    <div class="card-base">
      <img src="${posterUrl}" alt="${safeTitle}" loading="lazy" />
      <div class="progress"><span style="width: ${progressPercent}%"></span></div>
    </div>
    <div class="card-hover">
      <img class="card-hover-image" src="${heroUrl}" alt="${safeTitle} preview" loading="lazy" />
      <div class="card-hover-body">
        <div class="card-hover-controls">
          <div class="card-hover-actions">
            <button class="hover-round hover-play" type="button" aria-label="Resume ${safeTitle}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5v17L20 12 5 3.5Z" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Added to my list">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 12.5 5 5L19.5 7.5" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button class="hover-round hover-remove" type="button" aria-label="Remove ${safeTitle} from continue watching">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke-linecap="round" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Rate thumbs up">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20H5.8A1.8 1.8 0 0 1 4 18.2V10a1.8 1.8 0 0 1 1.8-1.8H8V20Zm2 0h6a3.5 3.5 0 0 0 3.4-2.8l.8-4A2.5 2.5 0 0 0 17.75 10H14V6.6A2.6 2.6 0 0 0 11.4 4L10 9.3V20Z" /></svg>
            </button>
          </div>
          <button class="hover-round hover-details" type="button" aria-label="More details">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <div class="card-hover-meta">
          <span class="meta-age">${maturity}</span>
          <span>${card.dataset.episode}</span>
          <span class="meta-chip">${qualityLabel}</span>
          <span class="meta-spatial">${contentTypeLabel}</span>
        </div>
        <p class="card-hover-tags">${tagLine}</p>
      </div>
    </div>
  `;

  return card;
}

function getFallbackThumbnailForSource(sourceValue) {
  const normalizedSource = String(sourceValue || "").trim();
  if (!normalizedSource) {
    return "";
  }
  if (normalizedSource === PRIDE_PREJUDICE_SOURCE) {
    return PRIDE_PREJUDICE_THUMBNAIL;
  }
  return "";
}

async function apiFetch(path, params = {}) {
  const query = new URLSearchParams(params);
  const url = query.size ? `${path}?${query.toString()}` : path;

  const response = await fetch(url);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return payload;
}

function buildCardFromTmdb(item, genreMap, imageBase = TMDB_IMAGE_BASE) {
  const title = item.title || "Untitled";
  const releaseDate = item.release_date || "";
  const year = releaseDate ? releaseDate.slice(0, 4) : "2024";
  const posterPath = item.poster_path || item.backdrop_path;
  const backdropPath = item.backdrop_path || item.poster_path;
  const posterUrl = posterPath
    ? `${imageBase}/w500${posterPath}`
    : "assets/images/thumbnail.jpg";
  const heroUrl = backdropPath
    ? `${imageBase}/original${backdropPath}`
    : posterUrl;
  const maturity = item.adult ? "18" : "13+";
  const genreNames = (item.genre_ids || [])
    .map((id) => genreMap.get(id))
    .filter(Boolean)
    .slice(0, 3);
  const tagLine = genreNames.length
    ? genreNames.map(escapeHtml).join(" <span>&bull;</span> ")
    : "Popular <span>&bull;</span> Trending";
  const safeTitle = escapeHtml(title);

  const card = document.createElement("article");
  card.className = "card";
  card.tabIndex = 0;
  card.dataset.title = title;
  card.dataset.episode = "TMDB Movie";
  card.dataset.src = "";
  card.dataset.thumb = heroUrl;
  card.dataset.year = year;
  card.dataset.runtime = "Movie";
  card.dataset.maturity = maturity;
  card.dataset.quality = "HD";
  card.dataset.audio = "Stereo";
  card.dataset.description = item.overview || "No description available.";
  card.dataset.cast = "Loading cast...";
  card.dataset.genres = genreNames.length
    ? genreNames.join(", ")
    : "Popular title";
  card.dataset.vibe = "Trending, Popular, High-energy";
  card.dataset.tmdbId = String(item.id);
  card.dataset.mediaType = "movie";

  card.innerHTML = `
    <div class="card-base">
      <img src="${posterUrl}" alt="${safeTitle}" loading="lazy" />
      <div class="progress"><span style="width: ${Math.max(10, Math.min(96, Math.round(item.vote_average * 10)))}%"></span></div>
    </div>
    <div class="card-hover">
      <img class="card-hover-image" src="${heroUrl}" alt="${safeTitle} preview" loading="lazy" />
      <div class="card-hover-body">
        <div class="card-hover-controls">
          <div class="card-hover-actions">
            <button class="hover-round hover-play" type="button" aria-label="Play ${safeTitle}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5v17L20 12 5 3.5Z" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Added to my list">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 12.5 5 5L19.5 7.5" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Remove from continue watching">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke-linecap="round" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Rate thumbs up">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20H5.8A1.8 1.8 0 0 1 4 18.2V10a1.8 1.8 0 0 1 1.8-1.8H8V20Zm2 0h6a3.5 3.5 0 0 0 3.4-2.8l.8-4A2.5 2.5 0 0 0 17.75 10H14V6.6A2.6 2.6 0 0 0 11.4 4L10 9.3V20Z" /></svg>
            </button>
          </div>
          <button class="hover-round hover-details" type="button" aria-label="More details">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <div class="card-hover-meta">
          <span class="meta-age">${maturity}</span>
          <span>${year}</span>
          <span class="meta-chip">HD</span>
          <span class="meta-spatial">Movie</span>
        </div>
        <p class="card-hover-tags">${tagLine}</p>
      </div>
    </div>
  `;

  return card;
}

function buildCardFromTmdbSeries(item, imageBase = TMDB_IMAGE_BASE) {
  const title =
    String(item?.name || item?.title || "Untitled").trim() || "Untitled";
  const firstAirDate = String(
    item?.first_air_date || item?.release_date || "",
  ).trim();
  const year = firstAirDate ? firstAirDate.slice(0, 4) : "2008";
  const posterPath = item?.poster_path || item?.backdrop_path;
  const backdropPath = item?.backdrop_path || item?.poster_path;
  const posterUrl = posterPath
    ? `${imageBase}/w500${posterPath}`
    : "assets/images/thumbnail.jpg";
  const heroUrl = backdropPath
    ? `${imageBase}/original${backdropPath}`
    : posterUrl;
  const maturity = item?.adult ? "18" : "16+";
  const genreNames = Array.isArray(item?.genres)
    ? item.genres
        .map((genre) => String(genre?.name || "").trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const tagLine = genreNames.length
    ? genreNames.map(escapeHtml).join(" <span>&bull;</span> ")
    : "Crime <span>&bull;</span> Drama <span>&bull;</span> Thriller";
  const safeTitle = escapeHtml(title);

  const card = document.createElement("article");
  card.className = "card";
  card.tabIndex = 0;
  card.dataset.title = title;
  card.dataset.episode = "E1 Pilot";
  card.dataset.src = "";
  card.dataset.thumb = heroUrl;
  card.dataset.year = year;
  card.dataset.runtime = "Series";
  card.dataset.maturity = maturity;
  card.dataset.quality = "HD";
  card.dataset.audio = "Stereo";
  card.dataset.description =
    item?.overview ||
    "A high school chemistry teacher enters the meth trade and spirals into a dangerous double life.";
  card.dataset.cast = "Loading cast...";
  card.dataset.genres = genreNames.length
    ? genreNames.join(", ")
    : "Crime, Drama";
  card.dataset.vibe = "Dark, Tense, Character-driven";
  card.dataset.tmdbId = String(item?.id || "1396");
  card.dataset.mediaType = "tv";
  card.dataset.seriesId = BREAKING_BAD_SERIES_ID;
  card.dataset.episodeIndex = "0";

  card.innerHTML = `
    <div class="card-base">
      <img src="${posterUrl}" alt="${safeTitle}" loading="lazy" />
      <div class="progress"><span style="width: 96%"></span></div>
    </div>
    <div class="card-hover">
      <img class="card-hover-image" src="${heroUrl}" alt="${safeTitle} preview" loading="lazy" />
      <div class="card-hover-body">
        <div class="card-hover-controls">
          <div class="card-hover-actions">
            <button class="hover-round hover-play" type="button" aria-label="Play ${safeTitle}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5v17L20 12 5 3.5Z" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Added to my list">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 12.5 5 5L19.5 7.5" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Remove from continue watching">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke-linecap="round" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Rate thumbs up">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20H5.8A1.8 1.8 0 0 1 4 18.2V10a1.8 1.8 0 0 1 1.8-1.8H8V20Zm2 0h6a3.5 3.5 0 0 0 3.4-2.8l.8-4A2.5 2.5 0 0 0 17.75 10H14V6.6A2.6 2.6 0 0 0 11.4 4L10 9.3V20Z" /></svg>
            </button>
          </div>
          <button class="hover-round hover-details" type="button" aria-label="More details">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <div class="card-hover-meta">
          <span class="meta-age">${maturity}</span>
          <span>${year}</span>
          <span class="meta-chip">HD</span>
          <span class="meta-spatial">Series</span>
        </div>
        <p class="card-hover-tags">${tagLine}</p>
      </div>
    </div>
  `;

  return card;
}

function buildPridePrejudiceCard() {
  const title = "Pride & Prejudice";
  const year = "2005";
  const maturity = "13+";
  const qualityLabel = "4K";
  const posterUrl = PRIDE_PREJUDICE_THUMBNAIL;
  const heroUrl = PRIDE_PREJUDICE_THUMBNAIL;
  const safeTitle = escapeHtml(title);
  const tagLine =
    "Romance <span>&bull;</span> Period Drama <span>&bull;</span> Classic";

  const card = document.createElement("article");
  card.className = "card";
  card.tabIndex = 0;
  card.dataset.title = title;
  card.dataset.episode = "Feature Film";
  card.dataset.src = PRIDE_PREJUDICE_SOURCE;
  card.dataset.thumb = heroUrl;
  card.dataset.year = year;
  card.dataset.runtime = "2h 9m";
  card.dataset.maturity = maturity;
  card.dataset.quality = qualityLabel;
  card.dataset.audio = "5.1";
  card.dataset.description =
    "Sparks fly when Elizabeth Bennet meets Mr. Darcy in this sweeping adaptation of Jane Austen's beloved novel.";
  card.dataset.cast = "Keira Knightley, Matthew Macfadyen, Rosamund Pike";
  card.dataset.genres = "Romance, Drama";
  card.dataset.vibe = "Romantic, Witty, Period";
  card.dataset.mediaType = "movie";

  card.innerHTML = `
    <div class="card-base">
      <img src="${posterUrl}" alt="${safeTitle}" loading="lazy" />
      <div class="progress"><span style="width: 92%"></span></div>
    </div>
    <div class="card-hover">
      <img class="card-hover-image" src="${heroUrl}" alt="${safeTitle} preview" loading="lazy" />
      <div class="card-hover-body">
        <div class="card-hover-controls">
          <div class="card-hover-actions">
            <button class="hover-round hover-play" type="button" aria-label="Play ${safeTitle}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5v17L20 12 5 3.5Z" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Added to my list">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4.5 12.5 5 5L19.5 7.5" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Remove from continue watching">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke-linecap="round" /></svg>
            </button>
            <button class="hover-round" type="button" aria-label="Rate thumbs up">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20H5.8A1.8 1.8 0 0 1 4 18.2V10a1.8 1.8 0 0 1 1.8-1.8H8V20Zm2 0h6a3.5 3.5 0 0 0 3.4-2.8l.8-4A2.5 2.5 0 0 0 17.75 10H14V6.6A2.6 2.6 0 0 0 11.4 4L10 9.3V20Z" /></svg>
            </button>
          </div>
          <button class="hover-round hover-details" type="button" aria-label="More details">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </div>
        <div class="card-hover-meta">
          <span class="meta-age">${maturity}</span>
          <span>${year}</span>
          <span class="meta-chip">${qualityLabel}</span>
          <span class="meta-spatial">Movie</span>
        </div>
        <p class="card-hover-tags">${tagLine}</p>
      </div>
    </div>
  `;

  return card;
}

function renderPopularCards(cardsToRender) {
  cardsContainer.innerHTML = "";
  cardsToRender.forEach((card, index) => {
    if (index >= Math.max(1, cardsToRender.length - 2)) {
      card.classList.add("card--align-right");
    }
    cardsContainer.appendChild(card);
    attachCardInteractions(card);
  });
}

async function loadPopularTitles() {
  if (!cardsContainer) return;
  const cardsToRender = [buildPridePrejudiceCard()];

  try {
    const [
      payload,
      darkKnightDetails,
      inceptionDetails,
      interstellarDetails,
      breakingBadDetails,
    ] = await Promise.all([
      apiFetch("/api/tmdb/popular-movies", { page: "1" }),
      apiFetch("/api/tmdb/details", {
        tmdbId: "155",
        mediaType: "movie",
      }).catch(() => null),
      apiFetch("/api/tmdb/details", {
        tmdbId: "27205",
        mediaType: "movie",
      }).catch(() => null),
      apiFetch("/api/tmdb/details", {
        tmdbId: "157336",
        mediaType: "movie",
      }).catch(() => null),
      apiFetch("/api/tmdb/details", {
        tmdbId: "1396",
        mediaType: "tv",
      }).catch(() => null),
    ]);

    const genreMap = new Map();
    (payload.genres || []).forEach((genre) => {
      genreMap.set(genre.id, genre.name);
    });

    const normalizeMovie = (movie) => {
      if (!movie?.id) return null;
      return {
        ...movie,
        genre_ids:
          Array.isArray(movie.genre_ids) && movie.genre_ids.length
            ? movie.genre_ids
            : (movie.genres || []).map((genre) => genre.id).filter(Boolean),
      };
    };

    const popularMovies = [
      normalizeMovie(darkKnightDetails),
      normalizeMovie(inceptionDetails),
      normalizeMovie(interstellarDetails),
    ].filter(Boolean);
    const breakingBadSeries =
      breakingBadDetails && typeof breakingBadDetails === "object"
        ? breakingBadDetails
        : {
            id: 1396,
            name: "Breaking Bad",
            first_air_date: "2008-01-20",
            overview:
              "A chemistry teacher diagnosed with cancer teams with a former student to build a meth empire.",
            genres: [
              { name: "Drama" },
              { name: "Crime" },
              { name: "Thriller" },
            ],
          };

    const imageBase = payload.imageBase || TMDB_IMAGE_BASE;

    if (breakingBadSeries) {
      cardsToRender.push(buildCardFromTmdbSeries(breakingBadSeries, imageBase));
    }
    popularMovies.forEach((item) => {
      cardsToRender.push(buildCardFromTmdb(item, genreMap, imageBase));
    });
  } catch (error) {
    console.error("Failed to load TMDB popular movie titles:", error);
  }

  renderPopularCards(cardsToRender);
}

async function loadContinueWatching() {
  if (!continueRow || !continueCardsContainer) {
    return;
  }

  const entries = getContinueWatchingEntries();
  if (!entries.length) {
    continueCardsContainer.innerHTML = "";
    if (continueEmpty) {
      continueEmpty.hidden = false;
    }
    continueRow.hidden = true;
    return;
  }

  const tmdbDetailKeys = Array.from(
    new Set(
      entries
        .map((entry) => {
          const tmdbId = String(entry.tmdbId || "").trim();
          if (!tmdbId) {
            return "";
          }
          const mediaType =
            inferContinueMediaType(
              entry.sourceIdentity,
              entry.mediaType,
              entry.seriesId,
            ) || "movie";
          return `${mediaType}:${tmdbId}`;
        })
        .filter(Boolean),
    ),
  );

  const detailsMap = new Map();
  await Promise.all(
    tmdbDetailKeys.map(async (detailKey) => {
      try {
        const separatorIndex = detailKey.indexOf(":");
        if (separatorIndex <= 0) {
          return;
        }
        const mediaType = detailKey.slice(0, separatorIndex);
        const tmdbId = detailKey.slice(separatorIndex + 1);
        const details = await apiFetch("/api/tmdb/details", {
          tmdbId,
          mediaType,
        });
        if (details && typeof details === "object") {
          detailsMap.set(detailKey, details);
        }
      } catch {
        // Best-effort enrichment only.
      }
    }),
  );

  continueCardsContainer.innerHTML = "";
  entries.forEach((entry, index) => {
    const normalizedMediaType =
      inferContinueMediaType(
        entry.sourceIdentity,
        entry.mediaType,
        entry.seriesId,
      ) || "movie";
    const detailsLookupKey = entry.tmdbId
      ? `${normalizedMediaType}:${String(entry.tmdbId).trim()}`
      : "";
    const details = detailsLookupKey
      ? detailsMap.get(detailsLookupKey) || null
      : null;
    const card = buildContinueWatchingCard(entry, details);
    if (index >= Math.max(1, entries.length - 2)) {
      card.classList.add("card--align-right");
    }
    continueCardsContainer.appendChild(card);
    attachCardInteractions(card);
  });

  continueRow.hidden = false;
  if (continueEmpty) {
    continueEmpty.hidden = true;
  }
}

function syncMuteUI() {
  const isMuted = introVideo.muted;
  muteToggle.classList.toggle("muted", isMuted);
  muteToggle.setAttribute(
    "aria-label",
    isMuted ? "Unmute trailer" : "Mute trailer",
  );
}

function getJeffreyEpsteinHeroDestination() {
  return {
    title: "Jeffrey Epstein: Filthy Rich",
    episode: "E1 Hunting Grounds",
    src: JEFFREY_EPSTEIN_EPISODE_1_SOURCE,
    mediaType: "tv",
    seriesId: JEFFREY_EPSTEIN_SERIES_ID,
    episodeIndex: 0,
  };
}

muteToggle.addEventListener("click", async () => {
  introVideo.muted = !introVideo.muted;
  syncMuteUI();
  if (introVideo.paused) {
    try {
      await introVideo.play();
    } catch (error) {
      // Ignore autoplay restrictions when manually unmuting.
    }
  }
});

playButton?.addEventListener("click", () => {
  openPlayerPage(getJeffreyEpsteinHeroDestination());
});

infoButton.addEventListener("click", () => {
  document
    .getElementById("continueRow")
    .scrollIntoView({ behavior: "smooth", block: "center" });
});

function openPlayerPage({
  title,
  episode,
  src,
  thumb,
  tmdbId,
  mediaType,
  year,
  seriesId,
  episodeIndex,
}) {
  const normalizedMediaType = String(mediaType || "")
    .trim()
    .toLowerCase();
  const normalizedSeriesId = String(seriesId || "").trim();
  const parsedEpisodeIndex = Number(episodeIndex);
  const hasEpisodeIndex =
    Number.isFinite(parsedEpisodeIndex) && parsedEpisodeIndex >= 0;
  const isSeriesLaunch =
    normalizedMediaType === "tv" ||
    (!normalizedMediaType && Boolean(normalizedSeriesId) && hasEpisodeIndex);

  const params = new URLSearchParams({
    title: title || "Title",
    episode: episode || "Now Playing",
  });

  if (src) {
    params.set("src", src);
  }
  if (thumb) {
    params.set("thumb", thumb);
  }

  if (tmdbId) {
    params.set("tmdbId", tmdbId);
  }

  if (normalizedMediaType === "movie" || normalizedMediaType === "tv") {
    params.set("mediaType", normalizedMediaType);
  } else if (isSeriesLaunch) {
    params.set("mediaType", "tv");
  }

  if (year) {
    params.set("year", year);
  }

  if (isSeriesLaunch && normalizedSeriesId) {
    params.set("seriesId", normalizedSeriesId);
  }

  if (isSeriesLaunch && hasEpisodeIndex) {
    params.set("episodeIndex", String(Math.floor(parsedEpisodeIndex)));
  }

  if (!src && tmdbId && normalizedMediaType === "movie") {
    const preferredAudioLang = getStoredAudioLangForTmdbMovie(tmdbId);
    const preferredQuality = getStoredStreamQualityPreference();
    if (preferredAudioLang !== "auto") {
      params.set("audioLang", preferredAudioLang);
    }
    if (preferredQuality !== "auto") {
      params.set("quality", preferredQuality);
    }
  }

  if (!src && !tmdbId && !normalizedSeriesId) {
    params.set("src", "assets/videos/intro.mp4");
  }

  window.location.href = `player.html?${params.toString()}`;
}

function getCardDetails(card) {
  const rawEpisodeIndex = Number(card.dataset.episodeIndex || -1);
  return {
    title: card.dataset.title || "Title",
    episode: card.dataset.episode || "Now Playing",
    src: card.dataset.src || "",
    thumb:
      card.dataset.thumb ||
      card.querySelector("img")?.getAttribute("src") ||
      "",
    tmdbId: card.dataset.tmdbId || "",
    mediaType: card.dataset.mediaType || "",
    seriesId: card.dataset.seriesId || "",
    episodeIndex: Number.isFinite(rawEpisodeIndex) ? rawEpisodeIndex : -1,
    year: card.dataset.year || "",
  };
}

function getCardModalData(card) {
  const previewImage = card.querySelector("img");

  return {
    ...getCardDetails(card),
    thumb:
      card.dataset.thumb ||
      previewImage?.getAttribute("src") ||
      "assets/images/thumbnail.jpg",
    year: card.dataset.year || "2024",
    runtime: card.dataset.runtime || "1h 40m",
    maturity: card.dataset.maturity || "16+",
    quality: card.dataset.quality || "HD",
    audio: card.dataset.audio || "Spatial Audio",
    description: card.dataset.description || "No description available.",
    cast: card.dataset.cast || "Cast details unavailable.",
    genres: card.dataset.genres || "Genres unavailable.",
    vibe: card.dataset.vibe || "Atmosphere unavailable.",
  };
}

function populateDetailsModal(details) {
  if (!detailsModal) return;

  detailsImage.src = details.thumb;
  detailsImage.alt = `${details.title} artwork`;
  detailsTitle.textContent = details.title.toUpperCase();
  detailsYear.textContent = details.year;
  detailsRuntime.textContent = details.runtime;
  detailsMaturity.textContent = details.maturity;
  detailsQuality.textContent = details.quality;
  detailsAudio.textContent = details.audio;
  detailsDescription.textContent = details.description;
  detailsCast.textContent = details.cast;
  detailsGenres.textContent = details.genres;
  detailsVibe.textContent = details.vibe;
}

function mapDetailsToModalPatch(rawDetails, currentDetails, mediaType) {
  const castList = (rawDetails.credits?.cast || [])
    .slice(0, 4)
    .map((person) => person.name);
  const genresList = (rawDetails.genres || [])
    .slice(0, 4)
    .map((genre) => genre.name);
  const runtime =
    mediaType === "movie"
      ? formatRuntime(rawDetails.runtime)
      : formatRuntime(rawDetails.episode_run_time?.[0]);

  return {
    ...currentDetails,
    runtime: runtime || currentDetails.runtime,
    maturity: rawDetails.adult ? "18" : currentDetails.maturity,
    description: rawDetails.overview || currentDetails.description,
    cast: castList.length ? castList.join(", ") : currentDetails.cast,
    genres: genresList.length ? genresList.join(", ") : currentDetails.genres,
    vibe: rawDetails.tagline ? rawDetails.tagline : currentDetails.vibe,
  };
}

async function hydrateModalFromTmdb(card) {
  const tmdbId = card.dataset.tmdbId;
  const mediaType = card.dataset.mediaType;
  if (!tmdbId || !mediaType) return;

  const cacheKey = `${mediaType}:${tmdbId}`;
  const requestVersion = ++detailsRequestVersion;

  if (tmdbDetailsCache.has(cacheKey)) {
    activeDetails = {
      ...activeDetails,
      ...tmdbDetailsCache.get(cacheKey),
    };
    populateDetailsModal(activeDetails);
    return;
  }

  try {
    const details = await apiFetch("/api/tmdb/details", {
      tmdbId,
      mediaType,
    });

    if (
      requestVersion !== detailsRequestVersion ||
      detailsModal?.hidden ||
      !activeDetails
    ) {
      return;
    }

    const modalPatch = mapDetailsToModalPatch(
      details,
      activeDetails,
      mediaType,
    );
    tmdbDetailsCache.set(cacheKey, modalPatch);
    activeDetails = modalPatch;
    populateDetailsModal(activeDetails);
  } catch (error) {
    console.error("Failed to load TMDB details:", error);
  }
}

function openDetailsModal(card, trigger) {
  if (!detailsModal) return;

  if (closeModalTimer) {
    clearTimeout(closeModalTimer);
    closeModalTimer = null;
  }

  activeDetails = getCardModalData(card);
  detailsTrigger = trigger || null;
  populateDetailsModal(activeDetails);
  detailsModal.hidden = false;
  requestAnimationFrame(() => {
    detailsModal.classList.add("is-open");
  });
  document.body.classList.add("modal-open");
  detailsCloseButton?.focus({ preventScroll: true });
  hydrateModalFromTmdb(card);
}

function closeDetailsModal({ restoreFocus = true } = {}) {
  if (!detailsModal || detailsModal.hidden) return;

  detailsModal.classList.remove("is-open");
  document.body.classList.remove("modal-open");

  closeModalTimer = window.setTimeout(() => {
    detailsModal.hidden = true;
    if (detailsTrigger) {
      detailsTrigger.blur();
    }
    if (restoreFocus && pageRoot) {
      pageRoot.focus({ preventScroll: true });
    }
    detailsTrigger = null;
    closeModalTimer = null;
  }, 220);
}

if (heroTitle) {
  heroTitle.style.cursor = "pointer";
  heroTitle.addEventListener("click", () =>
    openPlayerPage(getJeffreyEpsteinHeroDestination()),
  );
  heroTitle.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openPlayerPage(getJeffreyEpsteinHeroDestination());
    }
  });
}

function attachCardInteractions(card) {
  if (!card || card.dataset.interactionsBound === "true") {
    return;
  }
  card.dataset.interactionsBound = "true";

  card.addEventListener("click", (event) => {
    if (event.target.closest("button")) {
      return;
    }

    openPlayerPage(getCardDetails(card));
  });

  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (event.target.closest("button")) {
        return;
      }
      event.preventDefault();
      openPlayerPage(getCardDetails(card));
    }
  });

  const hoverPlayButton = card.querySelector(".hover-play");
  hoverPlayButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    openPlayerPage(getCardDetails(card));
  });

  const hoverDetailsButton = card.querySelector(".hover-details");
  hoverDetailsButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    openDetailsModal(card, hoverDetailsButton);
  });

  const hoverRemoveButton = card.querySelector(".hover-remove");
  hoverRemoveButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();

    const resumeSource =
      String(card.dataset.resumeSource || "").trim() ||
      (card.dataset.tmdbId && card.dataset.mediaType === "movie"
        ? `tmdb:movie:${String(card.dataset.tmdbId).trim()}`
        : String(card.dataset.src || "").trim());

    if (!resumeSource) {
      return;
    }

    removeContinueWatchingEntry(resumeSource);
    void loadContinueWatching();
  });
}

document.querySelectorAll(".card").forEach(attachCardInteractions);

detailsPlayButton?.addEventListener("click", () => {
  if (!activeDetails) return;
  openPlayerPage(activeDetails);
});

detailsCloseButton?.addEventListener("click", () => {
  closeDetailsModal();
});

detailsModal?.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-modal]")) {
    closeDetailsModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (accountMenuPanel && !accountMenuPanel.hidden) {
      closeAccountMenu();
      return;
    }
    closeDetailsModal();
  }
});

function openAccountMenu() {
  if (!accountMenu || !accountMenuToggle || !accountMenuPanel) {
    return;
  }
  accountMenu.setAttribute("aria-expanded", "true");
  accountMenuToggle.setAttribute("aria-expanded", "true");
  accountAvatarButton?.setAttribute("aria-expanded", "true");
  accountMenuPanel.hidden = false;
}

function closeAccountMenu() {
  if (!accountMenu || !accountMenuToggle || !accountMenuPanel) {
    return;
  }
  accountMenu.setAttribute("aria-expanded", "false");
  accountMenuToggle.setAttribute("aria-expanded", "false");
  accountAvatarButton?.setAttribute("aria-expanded", "false");
  accountMenuPanel.hidden = true;
}

function handleAccountMenuToggle(event) {
  event.preventDefault();
  event.stopPropagation();
  const shouldOpen = accountMenuPanel?.hidden !== false;
  if (shouldOpen) {
    openAccountMenu();
    return;
  }
  closeAccountMenu();
}

accountMenuToggle?.addEventListener("click", handleAccountMenuToggle);
accountAvatarButton?.addEventListener("click", handleAccountMenuToggle);

document.addEventListener("pointerdown", (event) => {
  if (!accountMenu || accountMenuPanel?.hidden !== false) {
    return;
  }

  if (accountMenu.contains(event.target)) {
    return;
  }

  closeAccountMenu();
});

syncMuteUI();
void loadContinueWatching();
loadPopularTitles();
applyAccountAvatarStyle();
closeAccountMenu();

pageRoot?.focus();

window.addEventListener("storage", (event) => {
  if (!event.key) {
    applyAccountAvatarStyle();
    void loadContinueWatching();
    return;
  }

  if (
    event.key === PROFILE_AVATAR_STYLE_PREF_KEY ||
    event.key === PROFILE_AVATAR_MODE_PREF_KEY ||
    event.key === PROFILE_AVATAR_IMAGE_PREF_KEY
  ) {
    applyAccountAvatarStyle();
  }

  if (
    event.key === CONTINUE_WATCHING_META_KEY ||
    event.key.startsWith(RESUME_STORAGE_PREFIX)
  ) {
    void loadContinueWatching();
  }
});
