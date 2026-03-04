const CAPTURE_MESSAGE = "CAPTURE_LINK";
const THROTTLE_MS = 2500;
const FALLBACK_INTERVAL_MS = 3000;
const NAVIGATION_POLL_MS = 1200;

let lastEmittedUrl = "";
let lastEmittedAt = 0;
let lastObservedHref = "";

function isYouTubeHost() {
  const host = window.location.hostname;
  return host === "www.youtube.com" || host === "m.youtube.com" || host === "youtube.com";
}

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

function extractYouTubeVideoFromUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "www.youtube.com" && hostname !== "m.youtube.com" && hostname !== "youtube.com") {
    return null;
  }

  const match = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
  if (!match) {
    return null;
  }

  return {
    source: "youtube",
    url: `https://www.youtube.com/shorts/${match[1]}`,
  };
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

  const path = parsed.pathname.replace(/\/+$/, "");
  const match = path.match(/^\/(?:@([^/]+)\/)?(?:video|shorts)\/([A-Za-z0-9._-]{8,})/);
  if (!match) {
    return null;
  }

  const user = match[1] ? `@${match[1]}` : null;
  const videoId = match[2];

  return {
    source: "tiktok",
    url: user ? `https://www.tiktok.com/${user}/video/${videoId}` : `https://www.tiktok.com/video/${videoId}`,
  };
}

function readCurrentCandidate() {
  if (isYouTubeHost()) {
    return extractYouTubeVideoFromUrl(window.location.href);
  }

  if (isTikTokHost()) {
    return extractTikTokVideoFromUrl(window.location.href);
  }

  return null;
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

["yt-navigate-finish", "yt-page-data-updated", "yt-load-start", "yt-update-title"].forEach((eventName) => {
  window.addEventListener(eventName, () => {
    window.setTimeout(captureCurrentVideo, 120);
  });
});

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
