const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const uploadForm = document.getElementById("uploadForm");
const submitButton = document.getElementById("submitButton");
const statusNode = document.getElementById("status");
const uploadProgressWrap = document.getElementById("uploadProgressWrap");
const uploadProgressText = document.getElementById("uploadProgressText");
const uploadProgressBytes = document.getElementById("uploadProgressBytes");
const uploadProgressBar = document.getElementById("uploadProgressBar");
const compatibilityActions = document.getElementById("compatibilityActions");
const transcodeAudioToAacCheckbox = document.getElementById(
  "transcodeAudioToAac",
);

let selectedFile = null;
let pendingCompatibilityWarning = "";
let pendingCanOfferAudioTranscode = false;

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let unitIndex = -1;
  let scaled = bytes;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unitIndex]}`;
}

function setUploadProgress(uploadedBytes, totalBytes) {
  const safeTotal = Math.max(1, Number(totalBytes) || 1);
  const safeUploaded = Math.max(
    0,
    Math.min(safeTotal, Math.floor(Number(uploadedBytes) || 0)),
  );
  const percent = Math.max(
    0,
    Math.min(100, Math.round((safeUploaded / safeTotal) * 100)),
  );

  if (uploadProgressWrap) {
    uploadProgressWrap.hidden = false;
  }
  if (uploadProgressBar) {
    uploadProgressBar.style.width = `${percent}%`;
  }
  if (uploadProgressText) {
    uploadProgressText.textContent = `Uploading... ${percent}%`;
  }
  if (uploadProgressBytes) {
    uploadProgressBytes.textContent = `${formatBytes(safeUploaded)} / ${formatBytes(safeTotal)}`;
  }
}

function hideUploadProgress() {
  if (uploadProgressWrap) {
    uploadProgressWrap.hidden = true;
  }
}

function setStatus(message, type = "") {
  statusNode.textContent = String(message || "");
  statusNode.classList.remove("error", "success", "warning");
  if (type) {
    statusNode.classList.add(type);
  }
}

function detectCompatibilityInfoFromFilename(fileName) {
  const tokens = String(fileName || "")
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
  const tokenSet = new Set(tokens);
  const reasons = [];
  let canOfferAudioTranscode = false;

  if (
    tokenSet.has("dts") ||
    tokenSet.has("dtshd") ||
    tokenSet.has("dtsma") ||
    tokenSet.has("dca")
  ) {
    reasons.push("Audio codec(s) 'dts' are likely not Chrome-compatible.");
    canOfferAudioTranscode = true;
  }

  return {
    warning: reasons.join(" "),
    canOfferAudioTranscode,
  };
}

function updateCompatibilityActions() {
  const shouldShow =
    pendingCanOfferAudioTranscode &&
    transcodeAudioToAacCheckbox instanceof HTMLInputElement;
  if (compatibilityActions) {
    compatibilityActions.hidden = !shouldShow;
  }
  if (!shouldShow && transcodeAudioToAacCheckbox instanceof HTMLInputElement) {
    transcodeAudioToAacCheckbox.checked = false;
  }
}

function withCompatibilityWarning(message) {
  const base = String(message || "").trim();
  const warning = String(pendingCompatibilityWarning || "").trim();
  if (!warning) {
    return base;
  }
  return `${base} Warning: ${warning}`.trim();
}

function normalizeFileExtension(name) {
  const value = String(name || "")
    .toLowerCase()
    .trim();
  if (value.endsWith(".mp4")) {
    return ".mp4";
  }
  if (value.endsWith(".mkv")) {
    return ".mkv";
  }
  return "";
}

function updateSubmitState() {
  submitButton.disabled = !(selectedFile instanceof File);
}

function getSelectedContentType() {
  const selected = uploadForm.querySelector(
    'input[name="contentType"]:checked',
  );
  return String(selected?.value || "movie").toLowerCase();
}

function updateFormForContentType() {
  const isEpisode = getSelectedContentType() === "episode";
  document.querySelectorAll(".episode-only").forEach((node) => {
    node.hidden = !isEpisode;
  });
}

function selectFile(file) {
  if (!(file instanceof File)) {
    return;
  }
  const ext = normalizeFileExtension(file.name);
  if (!ext) {
    selectedFile = null;
    dropZone.classList.remove("has-file");
    hideUploadProgress();
    pendingCompatibilityWarning = "";
    pendingCanOfferAudioTranscode = false;
    updateCompatibilityActions();
    setStatus("Only .mp4 and .mkv files are supported.", "error");
    updateSubmitState();
    return;
  }

  selectedFile = file;
  dropZone.classList.add("has-file");
  hideUploadProgress();
  const compatibilityInfo = detectCompatibilityInfoFromFilename(file.name);
  pendingCompatibilityWarning = compatibilityInfo.warning;
  pendingCanOfferAudioTranscode = compatibilityInfo.canOfferAudioTranscode;
  updateCompatibilityActions();
  if (
    pendingCanOfferAudioTranscode &&
    transcodeAudioToAacCheckbox instanceof HTMLInputElement
  ) {
    transcodeAudioToAacCheckbox.checked = true;
  }
  setStatus(
    withCompatibilityWarning(`Selected: ${file.name}`),
    pendingCompatibilityWarning ? "warning" : "",
  );
  updateSubmitState();
  void inferAndPopulateMetadata(file);
}

fileInput?.addEventListener("change", (event) => {
  const file = event.target.files?.[0] || null;
  selectFile(file);
});

dropZone?.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-active");
});

dropZone?.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-active");
});

dropZone?.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-active");
  const file = event.dataTransfer?.files?.[0] || null;
  selectFile(file);
});

uploadForm?.addEventListener("change", (event) => {
  if (
    event.target instanceof HTMLInputElement &&
    event.target.name === "contentType"
  ) {
    updateFormForContentType();
  }
});

uploadForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!(selectedFile instanceof File)) {
    setStatus("Choose a file first.", "error");
    return;
  }

  submitButton.disabled = true;
  setUploadProgress(0, selectedFile.size);
  setStatus("Uploading and processing file...", "");

  try {
    const payload = await uploadViaChunkSession(selectedFile);

    const converted = payload?.convertedFromMkv ? " (MKV remuxed to MP4)" : "";
    const audioConverted = payload?.audioTranscodedToAac
      ? " (Audio transcoded to AAC)"
      : "";
    const conversionSummary = `${converted}${audioConverted}`;
    const chromeCompatibility = payload?.chromeCompatibility || null;
    const compatibilityWarning = String(
      chromeCompatibility?.warning || "",
    ).trim();
    if (
      chromeCompatibility &&
      chromeCompatibility.isLikelyCompatible === false
    ) {
      setStatus(
        `Upload complete${conversionSummary}. Warning: ${compatibilityWarning || "This file is likely not Chrome-compatible (codec/container)."} Refresh Home to see it.`,
        "warning",
      );
    } else if (chromeCompatibility && chromeCompatibility.checked === false) {
      setStatus(
        `Upload complete${conversionSummary}. Note: could not verify Chrome compatibility. Refresh Home to see it.`,
        "warning",
      );
    } else {
      setStatus(
        `Upload complete${conversionSummary}. Chrome compatibility looks good. Refresh Home to see it.`,
        "success",
      );
    }
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Upload failed.",
      "error",
    );
  } finally {
    hideUploadProgress();
    updateSubmitState();
  }
});

function readUploadMetadataFromForm() {
  const formData = new FormData(uploadForm);
  const transcodeAudioToAac =
    pendingCanOfferAudioTranscode &&
    transcodeAudioToAacCheckbox instanceof HTMLInputElement &&
    transcodeAudioToAacCheckbox.checked;
  return {
    contentType: String(formData.get("contentType") || "movie"),
    title: String(formData.get("title") || ""),
    year: String(formData.get("year") || ""),
    description: String(formData.get("description") || ""),
    thumb: String(formData.get("thumb") || ""),
    tmdbId: String(formData.get("tmdbId") || ""),
    seriesTitle: String(formData.get("seriesTitle") || ""),
    seasonNumber: Number(formData.get("seasonNumber") || 1),
    episodeNumber: Number(formData.get("episodeNumber") || 1),
    episodeTitle: String(formData.get("episodeTitle") || ""),
    transcodeAudioToAac,
  };
}

async function uploadViaChunkSession(file) {
  const metadata = readUploadMetadataFromForm();
  const startResponse = await fetch("/api/upload/session/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...metadata,
      fileName: file.name,
      fileSize: file.size,
    }),
  });
  const startPayload = await startResponse.json().catch(() => null);
  if (!startResponse.ok) {
    throw new Error(
      startPayload?.error || `Failed to start upload (${startResponse.status})`,
    );
  }
  const sessionId = String(startPayload?.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("Upload session did not return a sessionId.");
  }

  const chunkSize = 32 * 1024 * 1024;
  let uploadedBytes = 0;
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
    const chunkBuffer = await chunk.arrayBuffer();
    const chunkResponse = await fetch(
      `/api/upload/session/chunk?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: chunkBuffer,
      },
    );
    const chunkPayload = await chunkResponse.json().catch(() => null);
    if (!chunkResponse.ok) {
      throw new Error(
        chunkPayload?.error || `Chunk upload failed (${chunkResponse.status})`,
      );
    }
    const receivedBytes = Number(chunkPayload?.receivedBytes);
    if (Number.isFinite(receivedBytes) && receivedBytes >= 0) {
      uploadedBytes = Math.min(file.size, Math.floor(receivedBytes));
    } else {
      uploadedBytes = Math.min(file.size, offset + chunk.size);
    }
    setUploadProgress(uploadedBytes, file.size);
    setStatus(
      `Uploading... ${Math.round((uploadedBytes / Math.max(1, file.size)) * 100)}%`,
      "",
    );
  }

  setUploadProgress(file.size, file.size);
  setStatus("Upload sent. Finalizing and processing...", "");

  const finishResponse = await fetch("/api/upload/session/finish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionId,
      ...metadata,
    }),
  });
  const finishPayload = await finishResponse.json().catch(() => null);
  if (!finishResponse.ok) {
    throw new Error(
      finishPayload?.error ||
        `Failed to finalize upload (${finishResponse.status})`,
    );
  }
  return finishPayload;
}

function setContentType(type) {
  const normalized =
    String(type || "").toLowerCase() === "episode" ? "episode" : "movie";
  const target = uploadForm.querySelector(
    `input[name="contentType"][value="${normalized}"]`,
  );
  if (target instanceof HTMLInputElement) {
    target.checked = true;
    updateFormForContentType();
  }
}

function setFormValue(name, value) {
  const field = uploadForm.elements.namedItem(name);
  if (
    !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
  ) {
    return;
  }
  field.value = String(value || "");
}

async function inferAndPopulateMetadata(file) {
  if (!(file instanceof File)) {
    return;
  }

  setStatus(
    withCompatibilityWarning(
      "Inferring title and episode info from filename...",
    ),
    pendingCompatibilityWarning ? "warning" : "",
  );

  try {
    const response = await fetch("/api/upload/infer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileName: file.name,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        payload?.error || `Inference failed (${response.status})`,
      );
    }

    const inferred = payload?.inferred || {};
    setContentType(inferred.contentType || "movie");
    setFormValue("title", inferred.title || "");
    setFormValue("year", inferred.year || "");
    setFormValue("tmdbId", inferred.tmdbId || "");

    if (String(inferred.contentType || "").toLowerCase() === "episode") {
      setFormValue("seriesTitle", inferred.seriesTitle || inferred.title || "");
      setFormValue("seasonNumber", inferred.seasonNumber || 1);
      setFormValue("episodeNumber", inferred.episodeNumber || 1);
      setFormValue("episodeTitle", inferred.episodeTitle || "");
    }

    const confidence = Number(inferred.confidence || 0);
    const confidencePct = Math.round(
      Math.max(0, Math.min(1, confidence)) * 100,
    );
    setStatus(
      withCompatibilityWarning(
        `Selected: ${file.name} • Auto-filled metadata (${confidencePct}% confidence)`,
      ),
      pendingCompatibilityWarning ? "warning" : "success",
    );
  } catch (error) {
    setStatus(
      withCompatibilityWarning(
        `Selected: ${file.name} • Metadata inference failed: ${error instanceof Error ? error.message : "unknown error"}`,
      ),
      "error",
    );
  }
}

updateFormForContentType();
updateSubmitState();
hideUploadProgress();
updateCompatibilityActions();
