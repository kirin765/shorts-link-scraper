const STORAGE_KEY = "shortLinks";
const CAPTURE_MESSAGE = "CAPTURE_LINK";
const MAX_RECORDS = 1000;
const ALLOWED_SOURCES = new Set(["youtube", "tiktok"]);

const YOUTUBE_SHORT_PATH_RE = /^\/shorts\/([A-Za-z0-9_-]{6,})(?:[/?#].*)?$/;
const TIKTOK_VIDEO_PATH_RE = /^\/(?:@([^/]+)\/)?(?:video|shorts)\/([A-Za-z0-9._-]{8,})/;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
    if (!Array.isArray(result[STORAGE_KEY])) {
      chrome.storage.local.set({ [STORAGE_KEY]: [] });
    }
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (!isCaptureMessage(message)) {
    return;
  }

  handleCaptureMessage(message);
});

function isCaptureMessage(message) {
  if (!message || message.type !== CAPTURE_MESSAGE) {
    return false;
  }

  if (typeof message.url !== "string" || typeof message.ts !== "string") {
    return false;
  }

  if (!ALLOWED_SOURCES.has(message.source)) {
    return false;
  }

  const parsed = normalizeIncoming(message.url, message.source);
  return parsed !== null;
}

function handleCaptureMessage(message) {
  const normalized = normalizeIncoming(message.url, message.source);
  if (!normalized) {
    return;
  }

  const entry = {
    id: buildId(normalized),
    url: normalized,
    source: message.source,
    capturedAt: isValidDate(message.ts) ? message.ts : new Date().toISOString(),
  };

  chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
    const current = sanitizeRecords(result[STORAGE_KEY]);
    const next = upsertRecord(current, entry);

    chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {
      if (chrome.runtime.lastError) {
        console.error("Failed to persist short link:", chrome.runtime.lastError.message);
      }
    });
  });
}

function normalizeIncoming(url, source) {
  try {
    const parsed = new URL(url);
    if (source === "youtube") {
      if (parsed.hostname !== "www.youtube.com") {
        return null;
      }
      const match = parsed.pathname.match(YOUTUBE_SHORT_PATH_RE);
      if (!match) {
        return null;
      }
      return `https://www.youtube.com/shorts/${match[1]}`;
    }

    if (source === "tiktok") {
      const path = parsed.pathname.replace(/\/+$/, "");
      const match = path.match(TIKTOK_VIDEO_PATH_RE);
      if (!match) {
        return null;
      }

      const user = match[1] ? `@${match[1]}` : null;
      const videoId = match[2];
      return user ? `https://www.tiktok.com/${user}/video/${videoId}` : `https://www.tiktok.com/video/${videoId}`;
    }
  } catch {
    return null;
  }

  return null;
}

function sanitizeRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records.filter((record) => {
    return (
      record &&
      typeof record.id === "string" &&
      typeof record.url === "string" &&
      typeof record.source === "string" &&
      ALLOWED_SOURCES.has(record.source) &&
      typeof record.capturedAt === "string" &&
      isValidDate(record.capturedAt)
    );
  });
}

function upsertRecord(records, entry) {
  const filtered = records.filter((item) => item.url !== entry.url);
  filtered.unshift(entry);
  return filtered.slice(0, MAX_RECORDS);
}

function buildId(url) {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${now}-${random}-${url.slice(-6)}`;
}

function isValidDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}
