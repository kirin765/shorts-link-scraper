const STORAGE_KEY = "shortLinks";
const CAPTURED_LIMIT = 1000;
const listEl = document.getElementById("list");
const statusText = document.getElementById("status-text");
const countBadge = document.getElementById("count-badge");
const copyButton = document.getElementById("copy-button");
const csvButton = document.getElementById("csv-button");
const clearButton = document.getElementById("clear-button");

function isValidRecord(record) {
  return (
    record &&
    typeof record.url === "string" &&
    typeof record.source === "string" &&
    (record.source === "youtube" || record.source === "tiktok") &&
    typeof record.capturedAt === "string"
  );
}

function readStoredLinks(callback) {
  chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
    const list = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    callback(list.filter(isValidRecord));
  });
}

function render(list) {
  listEl.innerHTML = "";
  const count = list.length;
  countBadge.textContent = count.toString();

  if (!count) {
    statusText.textContent = "아직 수집된 링크가 없습니다.";
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "YouTube Shorts 또는 TikTok Shorts 페이지에서 영상을 재생해보세요.";
    listEl.appendChild(empty);
    return;
  }

  statusText.textContent = `${count}개 수집됨 (최대 ${CAPTURED_LIMIT}개 보관)`;

  for (const record of list) {
    const item = document.createElement("li");
    item.className = "item";

    const meta = document.createElement("p");
    meta.className = "meta-line";
    const pill = document.createElement("span");
    pill.className = "source-pill";
    pill.textContent = record.source;
    const time = document.createElement("span");
    time.textContent = formatTime(record.capturedAt);
    meta.append(pill, time);

    const link = document.createElement("a");
    link.className = "url";
    link.href = record.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = record.url;

    item.append(meta, link);
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

function refreshList() {
  readStoredLinks((list) => {
    render(list);
  });
}

function copyAll() {
  readStoredLinks((list) => {
    const payload = list.map((item) => item.url).join("\n");
    if (!payload) {
      statusText.textContent = "복사할 링크가 없습니다.";
      return;
    }

    navigator.clipboard
      .writeText(payload)
      .then(() => {
        statusText.textContent = "모든 링크를 복사했습니다.";
      })
      .catch(() => {
        statusText.textContent = "클립보드 복사 실패: 브라우저 권한을 확인하세요.";
      });
  });
}

function csvValue(value) {
  const string = String(value ?? "");
  const safe = string.replace(/"/g, '""');
  return `"${safe}"`;
}

function exportCsv() {
  readStoredLinks((list) => {
    if (!list.length) {
      statusText.textContent = "내보낼 링크가 없습니다.";
      return;
    }

    const rows = list.map((item) =>
      [item.url, item.source, item.capturedAt].map(csvValue).join(","),
    );
    const csvText = ["\"url\",\"source\",\"capturedAt\"", ...rows].join("\r\n");
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    const now = new Date();
    const fileStamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "_",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");

    anchor.href = url;
    anchor.download = `short_links_${fileStamp}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    statusText.textContent = "CSV 파일을 다운로드했습니다.";
  });
}

function clearAll() {
  chrome.storage.local.set({ [STORAGE_KEY]: [] }, () => {
    refreshList();
    statusText.textContent = "수집 내역을 초기화했습니다.";
  });
}

copyButton.addEventListener("click", copyAll);
csvButton.addEventListener("click", exportCsv);
clearButton.addEventListener("click", clearAll);

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") {
    return;
  }
  if (!changes[STORAGE_KEY]) {
    return;
  }
  refreshList();
});

document.addEventListener("DOMContentLoaded", refreshList);
