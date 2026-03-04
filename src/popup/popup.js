const STORAGE_KEY = "shortLinks";
const PATH_KEY = "csvExportPath";
const DEFAULT_CSV_PATH = "tiktok_list.csv";
const CAPTURED_LIMIT = 1000;
const EXPORT_MESSAGE = "EXPORT_CSV_NOW";

const listEl = document.getElementById("list");
const statusText = document.getElementById("status-text");
const countBadge = document.getElementById("count-badge");
const copyButton = document.getElementById("copy-button");
const csvButton = document.getElementById("csv-button");
const clearButton = document.getElementById("clear-button");
const csvPathInput = document.getElementById("csv-path");
const savePathButton = document.getElementById("save-path-button");
const pathMessage = document.getElementById("path-message");

function isValidRecord(record) {
  return (
    record &&
    typeof record.url === "string" &&
    record.source === "tiktok" &&
    typeof record.capturedAt === "string" &&
    isValidDate(record.capturedAt)
  );
}

function isValidDate(value) {
  const ts = Date.parse(value);
  return Number.isFinite(ts);
}

function normalizePath(value) {
  const raw = (typeof value === "string" ? value : "").trim();
  if (!raw) {
    return DEFAULT_CSV_PATH;
  }

  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.toLowerCase().endsWith(".csv") ? normalized : `${normalized}.csv`;
}

function readStoredLinks(callback) {
  chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
    const list = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    callback(list.filter(isValidRecord));
  });
}

function readCsvPath(callback) {
  chrome.storage.local.get({ [PATH_KEY]: DEFAULT_CSV_PATH }, (result) => {
    callback(normalizePath(result[PATH_KEY]));
  });
}

function formatCount(value) {
  if (value === null || typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return value.toLocaleString("ko-KR");
}

function render(list) {
  listEl.innerHTML = "";
  const count = list.length;
  countBadge.textContent = String(count);

  if (!count) {
    statusText.textContent = "수집된 항목이 없습니다.";
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "현재 TikTok 비디오 항목이 없습니다.";
    listEl.appendChild(empty);
    return;
  }

  statusText.textContent = `${count}건 수집됨 (최대 ${CAPTURED_LIMIT}건 저장)`;

  for (const record of list) {
    const item = document.createElement("li");
    item.className = "item";

    const meta = document.createElement("p");
    meta.className = "meta-line";
    meta.textContent = formatTime(record.capturedAt);

    const stats = document.createElement("p");
    stats.className = "stats";
    stats.innerHTML = [
      `<span>좋아요: ${formatCount(record.likeCount)}</span>`,
      `<span>댓글: ${formatCount(record.commentCount)}</span>`,
      `<span>즐겨찾기: ${formatCount(record.bookmarkCount)}</span>`,
      `<span>공유: ${formatCount(record.shareCount)}</span>`,
    ].join("");

    const link = document.createElement("a");
    link.className = "url";
    link.href = record.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = record.url;

    item.append(meta, stats, link);
    listEl.appendChild(item);
  }
}

function formatTime(value) {
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) {
    return "";
  }

  return ts.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function renderAndRefreshPath() {
  refreshList();
  readCsvPath((path) => {
    csvPathInput.value = path;
  });
}

function refreshList() {
  readStoredLinks((list) => {
    render(list);
  });
}

function csvLine(record) {
  const cells = [
    record.url,
    record.likeCount,
    record.commentCount,
    record.bookmarkCount,
    record.shareCount,
    record.capturedAt,
  ];

  return cells
    .map((value) => {
      const raw = String(value ?? "");
      return `"${raw.replace(/"/g, '""')}"`;
    })
    .join(",");
}

function copyAll() {
  readStoredLinks((list) => {
    if (!list.length) {
      statusText.textContent = "복사할 기록이 없습니다.";
      return;
    }

    const payload = [
      '"url","likeCount","commentCount","bookmarkCount","shareCount","capturedAt"',
      ...list.map(csvLine),
    ].join("\r\n");

    navigator.clipboard
      .writeText(payload)
      .then(() => {
        statusText.textContent = "전체 기록이 클립보드에 복사되었습니다.";
      })
      .catch(() => {
        statusText.textContent = "복사에 실패했습니다. 브라우저 권한을 확인하세요.";
      });
  });
}

function exportCsv() {
  const path = normalizePath(csvPathInput.value);
  chrome.runtime.sendMessage(
    {
      type: EXPORT_MESSAGE,
      path,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        statusText.textContent = `CSV 저장 요청 실패: ${chrome.runtime.lastError.message}`;
        return;
      }

      if (!response || response.ok === false) {
        statusText.textContent = "CSV 저장 요청이 실패했습니다.";
        return;
      }

      statusText.textContent = `CSV 저장 완료: ${response.path || path}`;
    },
  );
}

function clearAll() {
  chrome.storage.local.set({ [STORAGE_KEY]: [] }, () => {
    refreshList();
    statusText.textContent = "모든 기록을 삭제했습니다.";
  });
}

function savePath() {
  const path = normalizePath(csvPathInput.value);
  chrome.storage.local.set({ [PATH_KEY]: path }, () => {
    readCsvPath((savedPath) => {
      pathMessage.textContent = `경로 저장: ${savedPath}`;
      csvPathInput.value = savedPath;
    });
  });
}

copyButton.addEventListener("click", copyAll);
csvButton.addEventListener("click", exportCsv);
clearButton.addEventListener("click", clearAll);
savePathButton.addEventListener("click", savePath);

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") {
    return;
  }

  if (!changes[STORAGE_KEY]) {
    return;
  }

  refreshList();
});

document.addEventListener("DOMContentLoaded", renderAndRefreshPath);
