const CAPTURE_MESSAGE = "CAPTURE_LINK";

const THROTTLE_MS = 2500;
const FALLBACK_INTERVAL_MS = 3000;
const NAVIGATION_POLL_MS = 1200;
const COUNT_RETRY_INTERVAL_MS = 500;
const COUNT_COLLECTION_TIMEOUT_MS = 5000;
const SCROLL_RETRY_DELAY_MS = 400;

let lastEmittedUrl = "";
let lastEmittedAt = 0;
let lastObservedHref = "";

let activeUrl = "";
let captureStartAt = 0;
let countRetryTimerId = null;
let hasAdvancedCurrent = false;

function isTikTokHost() {
  const host = window.location.hostname;
  return (
    host === "www.tiktok.com" ||
    host === "m.tiktok.com" ||
    host === "tiktok.com" ||
    host === "localhost" ||
    host === "127.0.0.1"
  );
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
  if (
    hostname !== "www.tiktok.com" &&
    hostname !== "m.tiktok.com" &&
    hostname !== "tiktok.com" &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1"
  ) {
    return null;
  }

  const pathMatch = parsed.pathname.match(/^\/(?:@([^/]+)\/)?(?:video|shorts)\/([A-Za-z0-9._-]{8,})(?:[/?#].*)?$/);
  if (!pathMatch) {
    return null;
  }

  const user = pathMatch[1] ? `@${pathMatch[1]}` : null;
  const videoId = pathMatch[2];

  return {
    source: "tiktok",
    url: user ? `https://www.tiktok.com/${user}/video/${videoId}` : `https://www.tiktok.com/video/${videoId}`,
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

  const koreman = input.match(/^([0-9]+(?:[.,][0-9]+)?)\s*만$/);
  if (koreman) {
    const num = parseFloat(koreman[1].replace(/,/g, ""));
    return Number.isFinite(num) ? Math.round(num * 10_000) : null;
  }

  const match = input.match(/([0-9]+(?:[.,][0-9]+)?)([kKmMbB]?)/);
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

  return Math.round(numberPart);
}

function collectCountsFromSelectors(keySelectors) {
  const collectFromElements = (selector, keyword) => {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const text = readTextFromElement(el);
      const matched = text.match(/([0-9][0-9.,]*\s*[kKmMbB]?|[0-9]+\s*만)/);
      if (matched) {
        const parsed = normalizeCount(matched[0]);
        if (parsed !== null) {
          return parsed;
        }
      }
    }

    const buttonLike = [...elements].find((el) => {
      const text = readTextFromElement(el.closest("button") || el);
      return keyword.test((text || "").toLowerCase());
    });
    if (buttonLike) {
      const text = readTextFromElement(buttonLike);
      const matched = text.match(/([0-9][0-9.,]*\s*[kKmMbB]?|[0-9]+\s*만)/);
      if (matched) {
        const parsed = normalizeCount(matched[0]);
        if (parsed !== null) {
          return parsed;
        }
      }
    }

    return null;
  };

  for (const selectorGroup of keySelectors) {
    const value = collectFromElements(selectorGroup.selector, selectorGroup.keyword);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function collectCountsFromJsonScripts() {
  const result = {};
  const keys = ["like", "comment", "bookmark", "share"];

  const scripts = [...document.querySelectorAll("script[type='application/ld+json'], script")];
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

      const pattern = new RegExp(
        `"${key}Count"\\s*:\\s*"?([0-9][0-9.,]*[kKmM]?|[0-9]+\\s*만|0)"?`,
        "i",
      );
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
  const result = {
    likeCount: null,
    commentCount: null,
    bookmarkCount: null,
    shareCount: null,
  };

  result.likeCount = collectCountsFromSelectors([
    { selector: '[data-e2e*="like"]', keyword: /\blike\b/ },
    { selector: "[aria-label]", keyword: /like|좋아요/ },
    { selector: '[data-e2e*="like"]', keyword: /좋아요/ },
    { selector: '[aria-label*="좋아요"]', keyword: /좋아요/ },
  ]);

  result.commentCount = collectCountsFromSelectors([
    { selector: '[data-e2e*="comment"]', keyword: /comment/ },
    { selector: "[aria-label]", keyword: /comment|댓글/ },
    { selector: '[aria-label*="댓글"]', keyword: /댓글/ },
  ]);

  result.bookmarkCount = collectCountsFromSelectors([
    { selector: '[data-e2e*="bookmark"]', keyword: /bookmark|저장/ },
    { selector: '[data-e2e*="collect"]', keyword: /collect|즐겨찾/ },
    { selector: '[aria-label*="즐겨찾"]', keyword: /즐겨찾|bookmark|저장/ },
  ]);

  result.shareCount = collectCountsFromSelectors([
    { selector: '[data-e2e*="share"]', keyword: /share/ },
    { selector: "[aria-label]", keyword: /share|공유/ },
    { selector: '[aria-label*="공유"]', keyword: /공유/ },
  ]);

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

function isAdVideoCurrent() {
  const paragraphs = document.querySelectorAll("p");
  for (const p of paragraphs) {
    if ((p.textContent || "").trim() === "광고") {
      return true;
    }
  }

  return false;
}

function isCompleteCounts(candidate) {
  return (
    typeof candidate.likeCount === "number" &&
    typeof candidate.commentCount === "number" &&
    typeof candidate.bookmarkCount === "number" &&
    typeof candidate.shareCount === "number"
  );
}

function clearRetryTimer() {
  if (countRetryTimerId) {
    window.clearTimeout(countRetryTimerId);
    countRetryTimerId = null;
  }
}

function resetCaptureState() {
  activeUrl = "";
  captureStartAt = 0;
  hasAdvancedCurrent = false;
  clearRetryTimer();
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

function scheduleAutoScroll(reason) {
  const scrollOptions = {
    top: window.innerHeight * 0.98,
    left: 0,
    behavior: "smooth",
  };

  window.setTimeout(() => {
    if (document.hidden) {
      return;
    }

    window.scrollBy(scrollOptions);
  }, reason === "ad" ? 150 : 0);

  window.setTimeout(() => {
    if (document.hidden) {
      return;
    }

    window.scrollBy(scrollOptions);
  }, SCROLL_RETRY_DELAY_MS);
}

function attemptCaptureAndAdvance() {
  if (document.hidden) {
    return;
  }

  const candidate = readCurrentCandidate();
  if (!candidate) {
    resetCaptureState();
    return;
  }

  const currentUrl = candidate.url;
  if (currentUrl !== activeUrl) {
    resetCaptureState();
    activeUrl = currentUrl;
    captureStartAt = Date.now();
  }

  if (hasAdvancedCurrent) {
    return;
  }

  if (isAdVideoCurrent()) {
    hasAdvancedCurrent = true;
    clearRetryTimer();
    window.setTimeout(() => {
      scheduleAutoScroll("ad");
    }, 120);
    return;
  }

  if (isCompleteCounts(candidate)) {
    clearRetryTimer();
    emitCandidate(candidate);
    hasAdvancedCurrent = true;
    scheduleAutoScroll("captured");
    return;
  }

  const elapsed = Date.now() - captureStartAt;
  if (elapsed >= COUNT_COLLECTION_TIMEOUT_MS) {
    hasAdvancedCurrent = true;
    clearRetryTimer();
    console.log("[TikTok Short Link Scraper] count collection timeout without completion", {
      url: currentUrl,
      elapsed,
    });
    scheduleAutoScroll("timeout");
    return;
  }

  clearRetryTimer();
  countRetryTimerId = window.setTimeout(() => {
    countRetryTimerId = null;
    attemptCaptureAndAdvance();
  }, COUNT_RETRY_INTERVAL_MS);
}

function wrapHistoryMethod(methodName) {
  const original = history[methodName];
  if (typeof original !== "function") {
    return;
  }

  history[methodName] = function (...args) {
    const ret = original.apply(this, args);
    window.setTimeout(attemptCaptureAndAdvance, 80);
    return ret;
  };
}

function onPotentialNavigation() {
  const href = window.location.href;
  if (href === lastObservedHref || document.hidden) {
    return;
  }

  lastObservedHref = href;
  window.setTimeout(attemptCaptureAndAdvance, 120);
}

wrapHistoryMethod("pushState");
wrapHistoryMethod("replaceState");
window.addEventListener("popstate", () => {
  window.setTimeout(attemptCaptureAndAdvance, 80);
});
window.addEventListener("hashchange", () => {
  window.setTimeout(attemptCaptureAndAdvance, 80);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    attemptCaptureAndAdvance();
  }
});
window.addEventListener("focus", attemptCaptureAndAdvance);
window.addEventListener("pageshow", attemptCaptureAndAdvance);

window.setInterval(() => {
  if (!document.hidden) {
    attemptCaptureAndAdvance();
  }
}, FALLBACK_INTERVAL_MS);

window.setInterval(onPotentialNavigation, NAVIGATION_POLL_MS);

window.setTimeout(() => {
  lastObservedHref = window.location.href;
  attemptCaptureAndAdvance();
}, 500);
