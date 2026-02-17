const introVideo = document.getElementById("introVideo");
const muteToggle = document.getElementById("muteToggle");
const playButton = document.getElementById("heroPlay");
const infoButton = document.getElementById("heroInfo");
const heroTitle = document.getElementById("heroTitle");
const pageRoot = document.querySelector(".page");
const cardsContainer = document.getElementById("cardsContainer");
const accountMenu = document.getElementById("accountMenu");
const accountMenuToggle = document.getElementById("accountMenuToggle");
const accountMenuPanel = document.getElementById("accountMenuPanel");
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
const STREAM_QUALITY_PREF_KEY = "netflix-stream-quality-pref";
const AUDIO_SYNC_PREF_KEY = "netflix-audio-sync-ms-v2";
const supportedAudioLangs = new Set(["auto", "en", "fr", "es", "de"]);
const supportedStreamQualityPreferences = new Set(["auto", "2160p", "1080p", "720p"]);
const AUDIO_SYNC_MIN_MS = 0;
const AUDIO_SYNC_MAX_MS = 1500;
const DEFAULT_AUDIO_SYNC_MS = 800;

function getStoredAudioLangForTmdbMovie(tmdbId) {
  const normalizedTmdbId = String(tmdbId || "").trim();
  if (!normalizedTmdbId) {
    return "auto";
  }

  try {
    const raw = String(localStorage.getItem(`${AUDIO_LANG_PREF_KEY_PREFIX}${normalizedTmdbId}`) || "")
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
  const normalized = String(value || "").trim().toLowerCase();
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

function normalizeAudioSyncMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const clamped = Math.max(AUDIO_SYNC_MIN_MS, Math.min(AUDIO_SYNC_MAX_MS, Math.round(parsed)));
  return clamped;
}

function getStoredAudioSyncMs() {
  try {
    const raw = localStorage.getItem(AUDIO_SYNC_PREF_KEY);
    if (raw === null || raw === "") {
      return DEFAULT_AUDIO_SYNC_MS;
    }
    return normalizeAudioSyncMs(raw);
  } catch {
    return DEFAULT_AUDIO_SYNC_MS;
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
  const posterUrl = posterPath ? `${imageBase}/w500${posterPath}` : "thumbnail.jpg";
  const heroUrl = backdropPath ? `${imageBase}/original${backdropPath}` : posterUrl;
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
  card.dataset.genres = genreNames.length ? genreNames.join(", ") : "Popular title";
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

async function loadPopularTitles() {
  if (!cardsContainer) return;

  try {
    const [payload, darkKnightDetails, inceptionDetails] = await Promise.all([
      apiFetch("/api/tmdb/popular-movies", { page: "1" }),
      apiFetch("/api/tmdb/details", {
        tmdbId: "155",
        mediaType: "movie",
      }).catch(() => null),
      apiFetch("/api/tmdb/details", {
        tmdbId: "27205",
        mediaType: "movie",
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
        genre_ids: Array.isArray(movie.genre_ids) && movie.genre_ids.length
          ? movie.genre_ids
          : (movie.genres || []).map((genre) => genre.id).filter(Boolean),
      };
    };

    const popularMovies = [
      normalizeMovie(darkKnightDetails),
      normalizeMovie(inceptionDetails),
    ].filter(Boolean);

    const imageBase = payload.imageBase || TMDB_IMAGE_BASE;

    if (!popularMovies.length) {
      throw new Error("Pinned movie titles were not returned.");
    }

    cardsContainer.innerHTML = "";
    popularMovies.forEach((item, index) => {
      const card = buildCardFromTmdb(item, genreMap, imageBase);
      if (index >= Math.max(1, popularMovies.length - 2)) {
        card.classList.add("card--align-right");
      }
      cardsContainer.appendChild(card);
      attachCardInteractions(card);
    });
  } catch (error) {
    console.error("Failed to load TMDB popular movie titles:", error);
  }
}

function syncMuteUI() {
  const isMuted = introVideo.muted;
  muteToggle.classList.toggle("muted", isMuted);
  muteToggle.setAttribute("aria-label", isMuted ? "Unmute trailer" : "Mute trailer");
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

function syncPlayButtonUI() {
  if (introVideo.paused) {
    playButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5v17L20 12 5 3.5Z" /></svg>Play';
  } else {
    playButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zm8 0h4v16h-4z" /></svg>Pause';
  }
}

playButton.addEventListener("click", async () => {
  if (introVideo.paused) {
    try {
      await introVideo.play();
    } catch (error) {
      // Ignore autoplay restrictions if browser blocks playback.
    }
    syncPlayButtonUI();
    return;
  }

  introVideo.pause();
  syncPlayButtonUI();
});

document.addEventListener("keydown", (event) => {
  if (detailsModal && !detailsModal.hidden) return;
  if (event.key !== " " && event.code !== "Space") return;
  if (event.target.matches("input, textarea, [contenteditable], button, a")) return;

  event.preventDefault();
  event.stopPropagation();
  playButton.click();
}, { capture: true });

infoButton.addEventListener("click", () => {
  document.getElementById("continueRow").scrollIntoView({ behavior: "smooth", block: "center" });
});

function openPlayerPage({ title, episode, src, tmdbId, mediaType, year }) {
  const params = new URLSearchParams({
    title: title || "Title",
    episode: episode || "Now Playing",
  });
  const audioSyncMs = getStoredAudioSyncMs();

  if (src) {
    params.set("src", src);
  }

  if (tmdbId) {
    params.set("tmdbId", tmdbId);
  }

  if (mediaType) {
    params.set("mediaType", mediaType);
  }

  if (year) {
    params.set("year", year);
  }

  if (!src && tmdbId && mediaType === "movie") {
    const preferredAudioLang = getStoredAudioLangForTmdbMovie(tmdbId);
    const preferredQuality = getStoredStreamQualityPreference();
    if (preferredAudioLang !== "auto") {
      params.set("audioLang", preferredAudioLang);
    }
    if (preferredQuality !== "auto") {
      params.set("quality", preferredQuality);
    }
  }

  if (audioSyncMs > 0) {
    params.set("audioSyncMs", String(audioSyncMs));
  }

  if (!src && !tmdbId) {
    params.set("src", "intro.mp4");
  }

  window.location.href = `player.html?${params.toString()}`;
}

function getCardDetails(card) {
  return {
    title: card.dataset.title || "Title",
    episode: card.dataset.episode || "Now Playing",
    src: card.dataset.src || "",
    tmdbId: card.dataset.tmdbId || "",
    mediaType: card.dataset.mediaType || "",
    year: card.dataset.year || "",
  };
}

function getCardModalData(card) {
  const previewImage = card.querySelector("img");

  return {
    ...getCardDetails(card),
    thumb: card.dataset.thumb || previewImage?.getAttribute("src") || "thumbnail.jpg",
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
  const castList = (rawDetails.credits?.cast || []).slice(0, 4).map((person) => person.name);
  const genresList = (rawDetails.genres || []).slice(0, 4).map((genre) => genre.name);
  const runtime = mediaType === "movie"
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

    if (requestVersion !== detailsRequestVersion || detailsModal?.hidden || !activeDetails) {
      return;
    }

    const modalPatch = mapDetailsToModalPatch(details, activeDetails, mediaType);
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
  const heroDestination = {
    title: "Jeffrey Epstein: Filthy Rich",
    episode: "Official Trailer",
    src: "intro.mp4",
  };

  heroTitle.style.cursor = "pointer";
  heroTitle.addEventListener("click", () => openPlayerPage(heroDestination));
  heroTitle.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openPlayerPage(heroDestination);
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
  accountMenuPanel.hidden = false;
}

function closeAccountMenu() {
  if (!accountMenu || !accountMenuToggle || !accountMenuPanel) {
    return;
  }
  accountMenu.setAttribute("aria-expanded", "false");
  accountMenuToggle.setAttribute("aria-expanded", "false");
  accountMenuPanel.hidden = true;
}

accountMenuToggle?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  const shouldOpen = accountMenuPanel?.hidden !== false;
  if (shouldOpen) {
    openAccountMenu();
    return;
  }
  closeAccountMenu();
});

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
syncPlayButtonUI();
loadPopularTitles();
closeAccountMenu();

pageRoot?.focus();
