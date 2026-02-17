const STREAM_QUALITY_PREF_KEY = "netflix-stream-quality-pref";
const SUBTITLE_COLOR_PREF_KEY = "netflix-subtitle-color-pref";
const PROFILE_AVATAR_STYLE_PREF_KEY = "netflix-profile-avatar-style";
const PROFILE_AVATAR_MODE_PREF_KEY = "netflix-profile-avatar-mode";
const PROFILE_AVATAR_IMAGE_PREF_KEY = "netflix-profile-avatar-image";

const DEFAULT_SUBTITLE_COLOR = "#b8bcc3";
const DEFAULT_AVATAR_STYLE = "blue";
const DEFAULT_AVATAR_MODE = "preset";
const AVATAR_OUTPUT_SIZE_PX = 180;

const supportedStreamQualityPreferences = new Set(["auto", "2160p", "1080p", "720p"]);
const supportedAvatarStyles = new Set(["blue", "crimson", "emerald", "violet", "amber"]);
const supportedAvatarChoices = new Set([...supportedAvatarStyles, "custom"]);
const avatarStyleClassNames = Array.from(supportedAvatarStyles).map((style) => `avatar-style-${style}`);

const qualityForm = document.getElementById("qualityForm");
const saveStatus = document.getElementById("saveStatus");
const subtitleColorInput = document.getElementById("subtitleColorInput");
const subtitleColorPreview = document.getElementById("subtitleColorPreview");
const subtitleColorReset = document.getElementById("subtitleColorReset");
const avatarStylePreview = document.getElementById("avatarStylePreview");
const avatarCustomThumb = document.getElementById("avatarCustomThumb");
const avatarImageInput = document.getElementById("avatarImageInput");
const avatarUploadHint = document.getElementById("avatarUploadHint");

let pendingCustomAvatarImage = "";

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

function setSelectedSubtitleColor(value) {
  const normalized = normalizeSubtitleColor(value);
  if (subtitleColorInput) {
    subtitleColorInput.value = normalized;
  }
  if (subtitleColorPreview) {
    subtitleColorPreview.style.color = normalized;
  }
}

function persistSubtitleColorPreference(value) {
  const normalized = normalizeSubtitleColor(value);
  try {
    if (normalized === DEFAULT_SUBTITLE_COLOR) {
      localStorage.removeItem(SUBTITLE_COLOR_PREF_KEY);
      return normalized;
    }
    localStorage.setItem(SUBTITLE_COLOR_PREF_KEY, normalized);
    return normalized;
  } catch {
    return normalized;
  }
}

function normalizeAvatarStyle(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (supportedAvatarStyles.has(normalized)) {
    return normalized;
  }
  return DEFAULT_AVATAR_STYLE;
}

function normalizeAvatarMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "custom" ? "custom" : DEFAULT_AVATAR_MODE;
}

function normalizeAvatarChoice(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (supportedAvatarChoices.has(normalized)) {
    return normalized;
  }
  return DEFAULT_AVATAR_STYLE;
}

function sanitizeAvatarImageData(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("data:image/")) {
    return "";
  }

  // Keep payload bounded for localStorage safety.
  if (raw.length > 2_000_000) {
    return "";
  }
  return raw;
}

function getStoredAvatarStylePreference() {
  try {
    return normalizeAvatarStyle(localStorage.getItem(PROFILE_AVATAR_STYLE_PREF_KEY));
  } catch {
    return DEFAULT_AVATAR_STYLE;
  }
}

function getStoredAvatarModePreference() {
  try {
    return normalizeAvatarMode(localStorage.getItem(PROFILE_AVATAR_MODE_PREF_KEY));
  } catch {
    return DEFAULT_AVATAR_MODE;
  }
}

function getStoredAvatarImagePreference() {
  try {
    return sanitizeAvatarImageData(localStorage.getItem(PROFILE_AVATAR_IMAGE_PREF_KEY));
  } catch {
    return "";
  }
}

function applyAvatarPreviewPreset(style) {
  if (!avatarStylePreview) {
    return;
  }

  avatarStylePreview.classList.remove("avatar-style-custom-image");
  avatarStylePreview.style.removeProperty("--avatar-image");
  avatarStylePreview.style.removeProperty("backgroundImage");
  avatarStyleClassNames.forEach((className) => avatarStylePreview.classList.remove(className));
  avatarStylePreview.classList.add(`avatar-style-${normalizeAvatarStyle(style)}`);
}

function applyAvatarPreviewCustom(imageData) {
  if (!avatarStylePreview) {
    return;
  }

  avatarStyleClassNames.forEach((className) => avatarStylePreview.classList.remove(className));
  avatarStylePreview.classList.add("avatar-style-custom-image");
  avatarStylePreview.style.setProperty("--avatar-image", `url("${imageData}")`);
  avatarStylePreview.style.backgroundImage = `var(--avatar-image)`;
}

function applyAvatarCustomThumb(imageData) {
  if (!avatarCustomThumb) {
    return;
  }

  if (imageData) {
    avatarCustomThumb.classList.add("avatar-style-custom-image");
    avatarCustomThumb.style.setProperty("--avatar-image", `url("${imageData}")`);
    avatarCustomThumb.style.backgroundImage = "var(--avatar-image)";
    return;
  }

  avatarCustomThumb.classList.remove("avatar-style-custom-image");
  avatarCustomThumb.style.removeProperty("--avatar-image");
  avatarCustomThumb.style.removeProperty("backgroundImage");
}

function setSelectedAvatarChoice(choiceValue, customImage = pendingCustomAvatarImage) {
  const choice = normalizeAvatarChoice(choiceValue);
  const input = qualityForm?.querySelector(`input[name="avatarStyle"][value="${choice}"]`);
  if (input) {
    input.checked = true;
  }

  const safeCustomImage = sanitizeAvatarImageData(customImage);
  applyAvatarCustomThumb(safeCustomImage);

  if (choice === "custom" && safeCustomImage) {
    applyAvatarPreviewCustom(safeCustomImage);
    return;
  }

  const fallbackStyle = choice === "custom" ? getStoredAvatarStylePreference() : choice;
  applyAvatarPreviewPreset(fallbackStyle);
}

function persistAvatarStylePreference(styleValue) {
  const style = normalizeAvatarStyle(styleValue);
  try {
    if (style === DEFAULT_AVATAR_STYLE) {
      localStorage.removeItem(PROFILE_AVATAR_STYLE_PREF_KEY);
      return style;
    }
    localStorage.setItem(PROFILE_AVATAR_STYLE_PREF_KEY, style);
    return style;
  } catch {
    return style;
  }
}

function persistAvatarModePreference(modeValue) {
  const mode = normalizeAvatarMode(modeValue);
  try {
    if (mode === DEFAULT_AVATAR_MODE) {
      localStorage.removeItem(PROFILE_AVATAR_MODE_PREF_KEY);
      return mode;
    }
    localStorage.setItem(PROFILE_AVATAR_MODE_PREF_KEY, mode);
    return mode;
  } catch {
    return mode;
  }
}

function persistAvatarImagePreference(imageData) {
  const safeImage = sanitizeAvatarImageData(imageData);
  try {
    if (!safeImage) {
      localStorage.removeItem(PROFILE_AVATAR_IMAGE_PREF_KEY);
      return "";
    }
    localStorage.setItem(PROFILE_AVATAR_IMAGE_PREF_KEY, safeImage);
    return safeImage;
  } catch {
    return "";
  }
}

function getAvatarChoiceDisplayLabel(choiceValue) {
  const choice = normalizeAvatarChoice(choiceValue);
  if (choice === "custom") {
    return "Custom image";
  }

  const labels = {
    blue: "Blue",
    crimson: "Crimson",
    emerald: "Emerald",
    violet: "Violet",
    amber: "Amber",
  };
  return labels[choice] || "Blue";
}

function setSelectedQuality(value) {
  const normalized = normalizeStreamQualityPreference(value);
  const input = qualityForm?.querySelector(`input[name="quality"][value="${normalized}"]`);
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to decode image."));
    image.src = dataUrl;
  });
}

async function convertFileToAvatarImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const sourceWidth = Number(image.naturalWidth || image.width || 0);
  const sourceHeight = Number(image.naturalHeight || image.height || 0);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Image size is invalid.");
  }

  const cropSize = Math.min(sourceWidth, sourceHeight);
  const sourceX = Math.floor((sourceWidth - cropSize) / 2);
  const sourceY = Math.floor((sourceHeight - cropSize) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE_PX;
  canvas.height = AVATAR_OUTPUT_SIZE_PX;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context unavailable.");
  }

  context.clearRect(0, 0, AVATAR_OUTPUT_SIZE_PX, AVATAR_OUTPUT_SIZE_PX);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    cropSize,
    cropSize,
    0,
    0,
    AVATAR_OUTPUT_SIZE_PX,
    AVATAR_OUTPUT_SIZE_PX,
  );

  let output = canvas.toDataURL("image/webp", 0.9);
  if (!output.startsWith("data:image/")) {
    output = canvas.toDataURL("image/png");
  }
  const safeOutput = sanitizeAvatarImageData(output);
  if (!safeOutput) {
    throw new Error("Image is too large to save.");
  }
  return safeOutput;
}

qualityForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(qualityForm);
  const selectedQuality = normalizeStreamQualityPreference(formData.get("quality") || "auto");
  const selectedAvatarChoice = normalizeAvatarChoice(formData.get("avatarStyle") || DEFAULT_AVATAR_STYLE);

  const savedQuality = persistSelectedQuality(selectedQuality);
  const savedSubtitleColor = persistSubtitleColorPreference(subtitleColorInput?.value);
  setSelectedQuality(savedQuality);
  setSelectedSubtitleColor(savedSubtitleColor);

  let savedAvatarChoiceLabel = "";
  if (selectedAvatarChoice === "custom") {
    const customImage = sanitizeAvatarImageData(pendingCustomAvatarImage || getStoredAvatarImagePreference());
    if (!customImage) {
      if (saveStatus) {
        saveStatus.textContent = "Choose an image first for custom profile icon.";
      }
      return;
    }

    persistAvatarModePreference("custom");
    persistAvatarImagePreference(customImage);
    setSelectedAvatarChoice("custom", customImage);
    savedAvatarChoiceLabel = "Custom image";
  } else {
    const savedStyle = persistAvatarStylePreference(selectedAvatarChoice);
    persistAvatarModePreference("preset");
    persistAvatarImagePreference("");
    setSelectedAvatarChoice(savedStyle, "");
    savedAvatarChoiceLabel = getAvatarChoiceDisplayLabel(savedStyle);
  }

  if (saveStatus) {
    const qualityLabel = savedQuality === "auto" ? "Auto (Best Available)" : savedQuality.toUpperCase();
    saveStatus.textContent = `Saved: ${qualityLabel}, subtitles ${savedSubtitleColor.toUpperCase()}, icon ${savedAvatarChoiceLabel}`;
  }
});

setSelectedQuality(getStoredStreamQualityPreference());
setSelectedSubtitleColor(getStoredSubtitleColorPreference());

const storedAvatarStyle = getStoredAvatarStylePreference();
const storedAvatarMode = getStoredAvatarModePreference();
const storedAvatarImage = getStoredAvatarImagePreference();
pendingCustomAvatarImage = storedAvatarImage;
setSelectedAvatarChoice(
  storedAvatarMode === "custom" && storedAvatarImage ? "custom" : storedAvatarStyle,
  storedAvatarImage,
);

subtitleColorInput?.addEventListener("input", () => {
  setSelectedSubtitleColor(subtitleColorInput.value);
});

subtitleColorReset?.addEventListener("click", () => {
  setSelectedSubtitleColor(DEFAULT_SUBTITLE_COLOR);
});

qualityForm?.querySelectorAll('input[name="avatarStyle"]').forEach((input) => {
  input.addEventListener("change", () => {
    const nextChoice = normalizeAvatarChoice(input.value);
    setSelectedAvatarChoice(nextChoice);
  });
});

avatarImageInput?.addEventListener("change", async () => {
  const file = avatarImageInput.files?.[0];
  if (!file) {
    return;
  }

  if (avatarUploadHint) {
    avatarUploadHint.textContent = "Processing image...";
  }

  try {
    const preparedImage = await convertFileToAvatarImage(file);
    pendingCustomAvatarImage = preparedImage;
    setSelectedAvatarChoice("custom", preparedImage);
    if (avatarUploadHint) {
      avatarUploadHint.textContent = "Image ready. Click Save Preference to apply.";
    }
  } catch (error) {
    if (avatarUploadHint) {
      avatarUploadHint.textContent = error instanceof Error ? error.message : "Failed to load image.";
    }
  } finally {
    avatarImageInput.value = "";
  }
});
