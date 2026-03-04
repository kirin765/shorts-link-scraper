const scenes = [
  {
    type: "normal",
    videoId: "videook01",
    user: "e2euser",
    label: "Normal video with full counts",
    title: "First normal video",
    counts: {
      likeCount: 1200,
      commentCount: 85,
      bookmarkCount: 44,
      shareCount: 17,
    },
    scheduleMs: {
      likeCount: 300,
      commentCount: 420,
      bookmarkCount: 620,
      shareCount: 800,
    },
  },
  {
    type: "ad",
    videoId: "videoad01",
    user: "sponsored",
    label: "Ad video should be skipped",
    title: "Ad video",
  },
  {
    type: "partial",
    videoId: "partial01",
    user: "e2euser",
    label: "Missing counts should timeout without capture",
    title: "Delayed partial video",
    counts: {
      likeCount: 777,
      commentCount: 77,
      bookmarkCount: null,
      shareCount: null,
    },
    scheduleMs: {
      likeCount: 700,
      commentCount: 1800,
      bookmarkCount: null,
      shareCount: null,
    },
  },
  {
    type: "normal",
    videoId: "videook02",
    user: "e2euser",
    label: "Second normal video with full counts",
    title: "Second normal video",
    counts: {
      likeCount: 25000,
      commentCount: 430,
      bookmarkCount: 91,
      shareCount: 63,
    },
    scheduleMs: {
      likeCount: 350,
      commentCount: 560,
      bookmarkCount: 730,
      shareCount: 900,
    },
  },
  {
    type: "normal",
    videoId: "videook01",
    user: "e2euser",
    label: "Duplicate URL should be deduped",
    title: "Duplicate normal video",
    counts: {
      likeCount: 1210,
      commentCount: 87,
      bookmarkCount: 45,
      shareCount: 18,
    },
    scheduleMs: {
      likeCount: 250,
      commentCount: 450,
      bookmarkCount: 650,
      shareCount: 850,
    },
  },
];

const sceneContainer = document.getElementById("scene");
let index = 0;
let timeoutHandles = [];
let hasAdvanced = false;
let lastScrollY = 0;

function buildPath(video) {
  return `/@${video.user}/video/${video.videoId}`;
}

function clearTimeouts() {
  for (const timer of timeoutHandles) {
    clearTimeout(timer);
  }
  timeoutHandles = [];
}

function formatCount(value) {
  return String(value);
}

function createCountNode(type, value) {
  const node = document.createElement("div");
  const badge = document.createElement("button");
  badge.setAttribute("type", "button");
  badge.setAttribute("data-e2e", `${type}-metric`);
  badge.setAttribute("aria-label", `${type} ${formatCount(value)}`);
  badge.textContent = `${type}: ${formatCount(value)}`;
  node.appendChild(badge);
  return node;
}

function renderJsonStats(video) {
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify({
    likeCount: video.counts.likeCount,
    commentCount: video.counts.commentCount,
    bookmarkCount: video.counts.bookmarkCount,
    shareCount: video.counts.shareCount,
  });
  return script;
}

function setUrl(video) {
  const pathname = buildPath(video);
  const query = `?idx=${index}`;
  const href = `${pathname}${query}`;
  const current = window.location.pathname;
  if (current === pathname) {
    window.history.replaceState({}, "", href);
    return;
  }

  window.history.pushState({}, "", href);
}

function renderScene(indexValue) {
  const video = scenes[indexValue];
  clearTimeouts();
  hasAdvanced = false;

  setUrl(video);
  document.title = `${video.label} (${indexValue + 1}/${scenes.length})`;

  sceneContainer.innerHTML = "";
  const title = document.createElement("h2");
  title.className = "title";
  title.textContent = video.title || video.label;

  const subtitle = document.createElement("p");
  subtitle.className = "meta";
  subtitle.textContent = `Path: ${window.location.pathname}`;

  const stats = document.createElement("div");
  stats.className = "stats";

  if (video.type === "ad") {
    const adBadge = document.createElement("p");
    adBadge.textContent = "±¤°í";
    sceneContainer.append(title, subtitle, adBadge);
  } else {
    sceneContainer.append(title, subtitle, stats);

    const countFields = [
      { key: "likeCount", name: "like" },
      { key: "commentCount", name: "comment" },
      { key: "bookmarkCount", name: "bookmark" },
      { key: "shareCount", name: "share" },
    ];

    for (const field of countFields) {
      const delay = video.scheduleMs?.[field.key];
      if (!Number.isFinite(delay)) {
        continue;
      }

      const timer = window.setTimeout(() => {
        const value = video.counts?.[field.key];
        if (value == null) {
          return;
        }

        const stat = createCountNode(field.name, value);
        stats.appendChild(stat);
      }, delay);
      timeoutHandles.push(timer);
    }

    if (video.counts) {
      const timer = window.setTimeout(() => {
        const script = renderJsonStats(video);
        sceneContainer.appendChild(script);
      }, 700);
      timeoutHandles.push(timer);
    }
  }

  const pathOutput = document.createElement("p");
  pathOutput.style.marginTop = "12px";
  pathOutput.textContent = `Current URL: ${window.location.href}`;
  sceneContainer.appendChild(pathOutput);
}

function advanceScene() {
  if (hasAdvanced) {
    return;
  }
  hasAdvanced = true;

  const nextIndex = index + 1;
  if (nextIndex >= scenes.length) {
    return;
  }

  index = nextIndex;
  clearTimeouts();
  window.scrollTo(0, 0);
  renderScene(index);
}

function onScroll() {
  if (window.scrollY <= lastScrollY + 8) {
    return;
  }

  lastScrollY = window.scrollY;
  if (hasAdvanced) {
    return;
  }

  const timer = window.setTimeout(() => {
    hasAdvanced = false;
    advanceScene();
  }, 100);
  timeoutHandles.push(timer);
}

window.addEventListener("scroll", onScroll);
window.addEventListener("popstate", () => {
  const target = window.location.pathname;
  const found = scenes.findIndex((video) => buildPath(video) === target);
  if (found >= 0) {
    index = found;
    renderScene(index);
  }
});

renderScene(index);
