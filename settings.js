const STREAM_QUALITY_PREF_KEY = "netflix-stream-quality-pref";
const supportedStreamQualityPreferences = new Set(["auto", "2160p", "1080p", "720p"]);

const qualityForm = document.getElementById("qualityForm");
const saveStatus = document.getElementById("saveStatus");

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

qualityForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(qualityForm);
  const selected = normalizeStreamQualityPreference(formData.get("quality") || "auto");
  const saved = persistSelectedQuality(selected);
  setSelectedQuality(saved);

  if (saveStatus) {
    const qualityLabel = saved === "auto" ? "Auto (Best Available)" : saved.toUpperCase();
    saveStatus.textContent = `Saved: ${qualityLabel}`;
  }
});

setSelectedQuality(getStoredStreamQualityPreference());
