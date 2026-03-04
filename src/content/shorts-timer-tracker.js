const CAPTURE_MESSAGE = "CAPTURE_LINK";

const THROTTLE_MS = 2500;
const FALLBACK_INTERVAL_MS = 3000;
const NAVIGATION_POLL_MS = 1200;

let lastEmittedUrl = "";
let lastEmittedAt = 0;
let lastObservedHref = "";

function isTikTokHost() {
  const host = window.location.hostname;
  return host === "www.tiktok.com" || host === "m.tiktok.com" || host === "tiktok.com";
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function extractTikTokVideoFromUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "www.tiktok.com" && hostname !== "m.tiktok.com" && hostname !== "tiktok.com") {
    return null;
  }

  const match = parsed.pathname.match(/^\/(?:@([^/]+)\/)?(?:video|shorts)\/([A-Za-z0-9._-]{8,})(?:[/?#].*)?$/);
  if (!match) {
    return null;
  }

  return {
    source: "tiktok",
    url,
  };
}

function readTextFromElement(element) {
  if (!element) {
    return "";
  }

  const text = element.textContent?.trim() || "";
  const aria = element.getAttribute("aria-label") || "";
  const title = element.getAttribute("title") || "";
  const dataLabel = element.getAttribute("data-label") || "";

  return [text, aria, title, dataLabel].join(" ").trim();
}

function normalizeCount(raw) {
  if (raw == null) {
    return null;
  }

  const input = String(raw).trim();
  if (!input || /^[-\s]*$/.test(input) || /^(n\/a|na|null|undefined)$/i.test(input)) {
    return null;
  }

  const match = input.match(/(\d+(?:[\.,]\d+)?)([kmKbB만]?)/);
  if (!match) {
    return null;
  }

  const numberPart = parseFloat(match[1].replace(/,/g, ""));
  if (Number.isNaN(numberPart)) {
    return null;
  }

  const suffix = (match[2] || "").toLowerCase();
  if (suffix === "k") {
    return Math.round(numberPart * 1000);
  }

  if (suffix === "m") {
    return Math.round(numberPart * 1_000_000);
  }

  if (suffix === "b") {
    return Math.round(numberPart * 1_000_000_000);
  }

  if (input.includes("만")) {
    return Math.round(numberPart * 10_000);
  }

  return Math.round(numberPart);
}

function collectCountsFromSelectors(keySelectors) {
  const findInElements = (selector, keyword) => {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const text = readTextFromElement(el);
      const matched = text.match(/(\d[\d.,]*\s*[kKmMbB]?|[\d]+\s*만)/);
      if (!matched) {
        continue;
      }

      const parsed = normalizeCount(matched[0]);
      if (parsed !== null) {
        return parsed;
      }
    }

    const buttonLike = [...elements].find((el) => {
      const text = readTextFromElement(el.closest("button") || el);
      return keyword.test((text || "").toLowerCase());
    });

    if (buttonLike) {
      const text = readTextFromElement(buttonLike);
      const matched = text.match(/(\d[\d.,]*\s*[kKmMbB]?|[\d]+\s*만)/);
      if (matched) {
        const parsed = normalizeCount(matched[0]);
        if (parsed !== null) {
          return parsed;
        }
      }
    }
  };

  for (const selectorGroup of keySelectors) {
    const value = findInElements(selectorGroup.selector, selectorGroup.keyword);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function collectCountsFromJsonScripts() {
  const result = {};
  const keys = ["like", "comment", "bookmark", "share"];

  const scripts = [...document.querySelectorAll("script")];
  for (const script of scripts) {
    const text = script.textContent || "";
    const lowered = text.toLowerCase();

    if (!keys.some((key) => lowered.includes(`${key}count`))) {
      continue;
    }

    for (const key of keys) {
      if (result[`${key}Count`] !== undefined) {
        continue;
      }

      const pattern = new RegExp(`"${key}Count"\\s*:\\s*"?(\\d[\\d.,]*(?:[kKmM]?)|\\d+\\s*만|0)"?`, "i");
      const match = lowered.includes(`${key}count`) ? text.match(pattern) : null;
      if (!match) {
        continue;
      }

      const value = normalizeCount(match[1]);
      if (value !== null) {
        result[`${key}Count`] = value;
      }
    }

    if (Object.keys(result).length === keys.length) {
      break;
    }
  }

  return result;
}

function collectCounts() {
  const result = {};

  const selectorMap = {
    likeCount: [
      { selector: '[data-e2e*="like"]', keyword: /\blike\b/ },
      { selector: "[aria-label]", keyword: /like|좋아요/ },
      { selector: '[aria-label*="좋아요"]', keyword: /좋아요/ },
    ],
    commentCount: [
      { selector: '[data-e2e*="comment"]', keyword: /comment/ },
      { selector: "[aria-label]", keyword: /comment|댓글/ },
      { selector: '[aria-label*="댓글"]', keyword: /댓글/ },
    ],
    bookmarkCount: [
      { selector: '[data-e2e*="bookmark"]', keyword: /bookmark/ },
      { selector: '[data-e2e*="collect"]', keyword: /collect/ },
      { selector: '[aria-label*="북마크"]', keyword: /북마크/ },
    ],
    shareCount: [
      { selector: '[data-e2e*="share"]', keyword: /share/ },
      { selector: "[aria-label]", keyword: /share|공유/ },
      { selector: '[aria-label*="공유"]', keyword: /공유/ },
    ],
  };

  result.likeCount = collectCountsFromSelectors(selectorMap.likeCount);
  result.commentCount = collectCountsFromSelectors(selectorMap.commentCount);
  result.bookmarkCount = collectCountsFromSelectors(selectorMap.bookmarkCount);
  result.shareCount = collectCountsFromSelectors(selectorMap.shareCount);

  const jsonCounts = collectCountsFromJsonScripts();
  for (const [key, value] of Object.entries(jsonCounts)) {
    if (result[key] == null && value != null) {
      result[key] = value;
    }
  }

  return result;
}

function readCurrentCandidate() {
  if (!isTikTokHost()) {
    return null;
  }

  const video = extractTikTokVideoFromUrl(window.location.href);
  if (!video) {
    return null;
  }

  return {
    ...video,
    ...collectCounts(),
  };
}

function shouldIgnoreCandidate(url) {
  const now = Date.now();

  if (!url) {
    return true;
  }

  if (url !== lastEmittedUrl) {
    return false;
  }

  return now - lastEmittedAt < THROTTLE_MS;
}

function emitCandidate(candidate) {
  if (shouldIgnoreCandidate(candidate.url)) {
    return;
  }

  lastEmittedUrl = candidate.url;
  lastEmittedAt = Date.now();

  chrome.runtime.sendMessage({
    type: CAPTURE_MESSAGE,
    url: candidate.url,
    source: candidate.source,
    ts: new Date().toISOString(),
    likeCount: candidate.likeCount ?? null,
    commentCount: candidate.commentCount ?? null,
    bookmarkCount: candidate.bookmarkCount ?? null,
    shareCount: candidate.shareCount ?? null,
  });
}

function captureCurrentVideo() {
  const candidate = readCurrentCandidate();
  if (!candidate || document.hidden) {
    return;
  }

  emitCandidate(candidate);
}

function wrapHistoryMethod(methodName) {
  const original = history[methodName];
  if (typeof original !== "function") {
    return;
  }

  history[methodName] = function (...args) {
    const ret = original.apply(this, args);
    window.setTimeout(captureCurrentVideo, 80);
    return ret;
  };
}

function onPotentialNavigation() {
  const href = window.location.href;
  if (href === lastObservedHref || document.hidden) {
    return;
  }

  lastObservedHref = href;
  captureCurrentVideo();
}

wrapHistoryMethod("pushState");
wrapHistoryMethod("replaceState");

window.addEventListener("popstate", () => {
  window.setTimeout(captureCurrentVideo, 80);
});

window.addEventListener("hashchange", () => {
  window.setTimeout(captureCurrentVideo, 80);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    captureCurrentVideo();
  }
});

window.addEventListener("focus", captureCurrentVideo);
window.addEventListener("pageshow", captureCurrentVideo);

window.setInterval(() => {
  if (!document.hidden) {
    captureCurrentVideo();
  }
}, FALLBACK_INTERVAL_MS);

window.setInterval(onPotentialNavigation, NAVIGATION_POLL_MS);

window.setTimeout(() => {
  lastObservedHref = window.location.href;
  captureCurrentVideo();
}, 500);
