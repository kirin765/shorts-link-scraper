const STORAGE_KEY = "shortLinks";
const PATH_KEY = "csvExportPath";
const CAPTURE_MESSAGE = "CAPTURE_LINK";
const EXPORT_MESSAGE = "EXPORT_CSV_NOW";
const MAX_RECORDS = 1000;
const DEFAULT_CSV_PATH = "tiktok_list.csv";
const ALLOWED_SOURCES = new Set(["tiktok"]);

const TIKTOK_VIDEO_PATH_RE = /^\/(?:@([^/]+)\/)?(?:video|shorts)\/([A-Za-z0-9._-]{8,})(?:[/?#].*)?$/;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ [STORAGE_KEY]: [], [PATH_KEY]: DEFAULT_CSV_PATH }, (result) => {
    const updates = {};

    if (!Array.isArray(result[STORAGE_KEY])) {
      updates[STORAGE_KEY] = [];
    }

    const normalizedPath = normalizePath(result[PATH_KEY]);
    if (normalizedPath !== result[PATH_KEY]) {
      updates[PATH_KEY] = normalizedPath;
    }

    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === CAPTURE_MESSAGE) {
    if (!isCaptureMessage(message)) {
      return;
    }

    handleCaptureMessage(message);
    return;
  }

  if (message.type === EXPORT_MESSAGE) {
    handleExportRequest(message.path, sendResponse);
    return true;
  }
});

function isCaptureMessage(message) {
  if (typeof message.url !== "string" || typeof message.ts !== "string") {
    return false;
  }

  if (!ALLOWED_SOURCES.has(message.source)) {
    return false;
  }

  const normalized = normalizeIncoming(message.url, message.source);
  if (!normalized) {
    return false;
  }

  return isValidCount(message.likeCount) && isValidCount(message.commentCount) && isValidCount(message.bookmarkCount) && isValidCount(message.shareCount);
}

function isValidCount(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function handleCaptureMessage(message) {
  const normalized = normalizeIncoming(message.url, message.source);
  const entry = {
    id: buildId(normalized),
    url: normalized,
    source: message.source,
    capturedAt: isValidDate(message.ts) ? message.ts : new Date().toISOString(),
    likeCount: message.likeCount,
    commentCount: message.commentCount,
    bookmarkCount: message.bookmarkCount,
    shareCount: message.shareCount,
  };

  chrome.storage.local.get({ [STORAGE_KEY]: [], [PATH_KEY]: DEFAULT_CSV_PATH }, (result) => {
    const path = normalizePath(result[PATH_KEY]);
    const current = sanitizeRecords(result[STORAGE_KEY]);
    const next = upsertRecord(current, entry);

    chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {
      if (chrome.runtime.lastError) {
        console.error("Failed to persist short link:", chrome.runtime.lastError.message);
        return;
      }

      syncCsvToDownloads(next, path);
    });
  });
}

function handleExportRequest(path, sendResponse) {
  chrome.storage.local.get({ [STORAGE_KEY]: [], [PATH_KEY]: DEFAULT_CSV_PATH }, (result) => {
    const targetPath = normalizePath(path || result[PATH_KEY]);
    const records = sanitizeRecords(result[STORAGE_KEY]);
    syncCsvToDownloads(records, targetPath, (ok) => {
      if (!ok && sendResponse) {
        sendResponse({ ok: false });
      } else if (sendResponse) {
        sendResponse({ ok: true, path: targetPath });
      }
    });
  });
}

function syncCsvToDownloads(records, path, callback = () => {}) {
  const csvText = buildCsvText(records);

  chrome.downloads.download(
    {
      url: `data:text/csv;charset=utf-8,${encodeURIComponent(csvText)}`,
      filename: normalizePath(path),
      saveAs: false,
      conflictAction: "overwrite",
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("CSV download failed:", chrome.runtime.lastError.message);
        callback(false);
        return;
      }

      if (typeof downloadId !== "number") {
        callback(false);
        return;
      }

      callback(true);
    },
  );
}

function buildCsvText(records) {
  const header = ["url", "likeCount", "commentCount", "bookmarkCount", "shareCount", "capturedAt"];
  const rows = records.map((item) => [
    csvValue(item.url),
    csvValue(formatNullableCount(item.likeCount)),
    csvValue(formatNullableCount(item.commentCount)),
    csvValue(formatNullableCount(item.bookmarkCount)),
    csvValue(formatNullableCount(item.shareCount)),
    csvValue(item.capturedAt),
  ].join(","));

  return [csvValueRow(header), ...rows].join("\r\n");
}

function normalizeIncoming(url, source) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (source !== "tiktok") {
      return null;
    }

    if (hostname !== "www.tiktok.com" && hostname !== "m.tiktok.com" && hostname !== "tiktok.com") {
      return null;
    }

    const path = parsed.pathname.replace(/\/+$/, "");
    const match = path.match(TIKTOK_VIDEO_PATH_RE);
    if (!match) {
      return null;
    }

    const user = match[1] ? `@${match[1]}` : null;
    const videoId = match[2];
    return user ? `https://www.tiktok.com/${user}/video/${videoId}` : `https://www.tiktok.com/video/${videoId}`;
  } catch {
    return null;
  }
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
      record.source === "tiktok" &&
      typeof record.capturedAt === "string" &&
      isValidDate(record.capturedAt) &&
      isValidCount(record.likeCount) &&
      isValidCount(record.commentCount) &&
      isValidCount(record.bookmarkCount) &&
      isValidCount(record.shareCount)
    );
  });
}

function upsertRecord(records, entry) {
  const filtered = records.filter((item) => item.url !== entry.url);
  filtered.unshift(entry);
  return filtered.slice(0, MAX_RECORDS);
}

function normalizePath(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return DEFAULT_CSV_PATH;
  }

  const trimmed = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  const ensureCsv = trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
  return ensureCsv;
}

function csvValue(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function formatNullableCount(value) {
  return value == null ? "" : value;
}

function csvValueRow(values) {
  return values.map(csvValue).join(",");
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
