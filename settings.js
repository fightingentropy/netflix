const STREAM_QUALITY_PREF_KEY = "netflix-stream-quality-pref";
const AUDIO_SYNC_PREF_KEY = "netflix-audio-sync-ms-v2";
const supportedStreamQualityPreferences = new Set(["auto", "2160p", "1080p", "720p"]);
const AUDIO_SYNC_MIN_MS = 0;
const AUDIO_SYNC_MAX_MS = 1500;
const DEFAULT_AUDIO_SYNC_MS = 800;

const qualityForm = document.getElementById("qualityForm");
const saveStatus = document.getElementById("saveStatus");
const audioSyncRange = document.getElementById("audioSyncMs");
const audioSyncNumber = document.getElementById("audioSyncMsNumber");
const audioSyncValue = document.getElementById("audioSyncValue");

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
    return normalizeStreamQualityPreference(localStorage.getItem(STREAM_QUALITY_PREF_KEY));
  } catch {
    return "auto";
  }
}

function normalizeAudioSyncMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
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

function setSelectedQuality(value) {
  const normalized = normalizeStreamQualityPreference(value);
  const input = qualityForm?.querySelector(`input[name=\"quality\"][value=\"${normalized}\"]`);
  if (input) {
    input.checked = true;
  }
}

function persistSelectedQuality(value) {
  const normalized = normalizeStreamQualityPreference(value);
  try {
    if (normalized === "auto") {
      localStorage.removeItem(STREAM_QUALITY_PREF_KEY);
      return normalized;
    }

    localStorage.setItem(STREAM_QUALITY_PREF_KEY, normalized);
    return normalized;
  } catch {
    return normalized;
  }
}

function persistAudioSyncMs(value) {
  const normalized = normalizeAudioSyncMs(value);
  try {
    localStorage.setItem(AUDIO_SYNC_PREF_KEY, String(normalized));
    return normalized;
  } catch {
    return normalized;
  }
}

function renderAudioSyncLabel(value) {
  if (!audioSyncValue) {
    return;
  }
  if (value <= 0) {
    audioSyncValue.textContent = "Off (0 ms)";
    return;
  }
  audioSyncValue.textContent = `+${value} ms`;
}

function setAudioSyncInputs(value) {
  const normalized = normalizeAudioSyncMs(value);
  if (audioSyncRange) {
    audioSyncRange.value = String(normalized);
  }
  if (audioSyncNumber) {
    audioSyncNumber.value = String(normalized);
  }
  renderAudioSyncLabel(normalized);
}

function readAudioSyncFromInputs() {
  if (!audioSyncRange && !audioSyncNumber) {
    return 0;
  }
  const rawValue = audioSyncNumber ? audioSyncNumber.value : audioSyncRange.value;
  return normalizeAudioSyncMs(rawValue);
}

audioSyncRange?.addEventListener("input", () => {
  const value = normalizeAudioSyncMs(audioSyncRange.value);
  if (audioSyncNumber) {
    audioSyncNumber.value = String(value);
  }
  renderAudioSyncLabel(value);
});

audioSyncNumber?.addEventListener("input", () => {
  const value = normalizeAudioSyncMs(audioSyncNumber.value);
  if (audioSyncRange) {
    audioSyncRange.value = String(value);
  }
  renderAudioSyncLabel(value);
});

qualityForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(qualityForm);
  const selected = normalizeStreamQualityPreference(formData.get("quality") || "auto");
  const saved = persistSelectedQuality(selected);
  const savedAudioSyncMs = persistAudioSyncMs(readAudioSyncFromInputs());
  setSelectedQuality(saved);
  setAudioSyncInputs(savedAudioSyncMs);

  if (saveStatus) {
    const qualityLabel = saved === "auto" ? "Auto (Best Available)" : saved.toUpperCase();
    const syncLabel = savedAudioSyncMs > 0 ? `Audio Delay +${savedAudioSyncMs}ms` : "Audio Delay Off";
    saveStatus.textContent = `Saved: ${qualityLabel}, ${syncLabel}`;
  }
});

setSelectedQuality(getStoredStreamQualityPreference());
setAudioSyncInputs(getStoredAudioSyncMs());
