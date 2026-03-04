import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const sourceExtensionDir = rootDir;
const manifestForSmoke = path.join(rootDir, "manifest.e2e.json");
const fixtureDir = path.join(rootDir, "tests", "e2e", "fixtures");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractExtensionIdFromWorkers(workers) {
  for (const worker of workers) {
    const url = worker.url();
    const match = /^chrome-extension:\/\/([^/]+)\//.exec(url);
    if (match) {
      return match[1];
    }
  }
  return "";
}

async function startFixtureServer() {
  const server = http.createServer(async (req, res) => {
    const resolved = new URL(req.url || "/", "http://127.0.0.1");
    const safePath = resolved.pathname === "/" ? "/tiktok-mock-feed.html" : resolved.pathname;
    const filePath = path.join(fixtureDir, safePath);
    const normalized = path.normalize(filePath);

    if (!normalized.startsWith(path.normalize(`${fixtureDir}/`))) {
      res.statusCode = 400;
      res.end("Invalid path");
      return;
    }

    try {
      const data = await fs.readFile(normalized);
      const ext = path.extname(normalized).toLowerCase();
      if (ext === ".html") {
        res.setHeader("content-type", "text/html; charset=utf-8");
      } else if (ext === ".js") {
        res.setHeader("content-type", "text/javascript; charset=utf-8");
      } else {
        res.setHeader("content-type", "text/plain; charset=utf-8");
      }
      res.statusCode = 200;
      res.end(data);
      return;
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address()?.port || 0;
  return {
    server,
    port,
    url: (targetPath) => `http://127.0.0.1:${port}${targetPath}`,
  };
}

async function prepareSmokeExtension() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "shorts-link-scraper-e2e-ext-"));
  await fs.cp(sourceExtensionDir, tempDir, { recursive: true });
  await fs.copyFile(manifestForSmoke, path.join(tempDir, "manifest.json"));
  return tempDir;
}

async function getStorage(page) {
  return page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.get({ shortLinks: [], csvExportPath: "tiktok_list.csv" }, (result) => {
        const records = Array.isArray(result.shortLinks) ? result.shortLinks : [];
        const csvPath = result.csvExportPath || "tiktok_list.csv";
        resolve({ records, csvPath });
      });
    });
  });
}

async function getStorageFromServiceWorker(context) {
  const workers = context.serviceWorkers();
  const worker = workers[0];
  if (!worker) {
    return { records: [], csvPath: "tiktok_list.csv" };
  }

  return worker.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.get({ shortLinks: [], csvExportPath: "tiktok_list.csv" }, (result) => {
        const records = Array.isArray(result.shortLinks) ? result.shortLinks : [];
        const csvPath = result.csvExportPath || "tiktok_list.csv";
        resolve({ records, csvPath });
      });
    });
  });
}

async function waitForExtensionId(context) {
  const startedAt = Date.now();
  const timeoutMs = 20000;
  while (Date.now() - startedAt < timeoutMs) {
    const fromWorkers = extractExtensionIdFromWorkers(context.serviceWorkers());
    if (fromWorkers) {
      return fromWorkers;
    }
    await sleep(100);
  }
  return "";
}

async function waitFor(predicate, timeoutMs, intervalMs = 250) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const result = await predicate();
    if (result) {
      return result;
    }
    await sleep(intervalMs);
  }
  return null;
}

async function run() {
  const tempExtensionDir = await prepareSmokeExtension();
  const fixtureServer = await startFixtureServer();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "shorts-link-scraper-smoke-profile-"));

  const launchArgs = [
    `--disable-extensions-except=${tempExtensionDir}`,
    `--load-extension=${tempExtensionDir}`,
  ];

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: launchArgs,
    acceptDownloads: true,
  });

  let browserContext = context;
  const cleanup = async () => {
    await browserContext.close().catch(() => {});
    await fs.rm(tempExtensionDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    await new Promise((resolve) => fixtureServer.server.close(resolve));
  };

  try {
    const feed = await context.newPage();
    await feed.goto(fixtureServer.url("/tiktok-mock-feed.html"), { waitUntil: "domcontentloaded" });

    const extensionId = await waitForExtensionId(context);
    if (!extensionId) {
      throw new Error("Could not resolve extension ID from service worker url.");
    }

    const serviceWorker = context.serviceWorkers()[0];
    if (serviceWorker) {
      await serviceWorker.evaluate(() => {
        return new Promise((resolve) => {
          chrome.storage.local.set({ shortLinks: [] }, () => {
            resolve();
          });
        });
      });
    }

    const records = await waitFor(async () => {
      const state = await getStorageFromServiceWorker(context);
      return state.records.length >= 2 ? state.records : null;
    }, 30000);

    assert.ok(records, "expected captured records should appear within timeout");

    const finalState = await getStorageFromServiceWorker(context);
    const deduped = new Set(finalState.records.map((entry) => entry.url));

    assert.equal(finalState.records.length, 2, "expected exactly 2 records after dedupe (ad + timeout are excluded)");
    assert.equal(deduped.size, finalState.records.length, "records must be deduplicated by URL");

    const latest = finalState.records[0];
    assert.equal(latest.source, "tiktok");
    assert.equal(typeof latest.likeCount, "number");
    assert.equal(typeof latest.commentCount, "number");
    assert.equal(typeof latest.bookmarkCount, "number");
    assert.equal(typeof latest.shareCount, "number");

    const paths = finalState.records.map((item) => item.url);
    assert.ok(!paths.some((value) => value.includes("ad")),
      "ad pages should not be persisted");

    const timeoutExpected = finalState.records.every((item) => item.commentCount !== null);
    assert.equal(timeoutExpected, true, "captured records should have full numeric counts");

    const popup = await context.newPage();
    const popupUrl = `chrome-extension://${extensionId}/src/popup/popup.html`;
    await popup.goto(popupUrl, { waitUntil: "domcontentloaded" });

    await popup.fill("#csv-path", "custom_tiktok_list.csv");
    await popup.click("#save-path-button");

    const exportResult = await popup.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "EXPORT_CSV_NOW",
            path: document.getElementById("csv-path").value,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }

            if (!response) {
              resolve({ ok: false, error: "No response from background" });
              return;
            }

            resolve(response);
          },
        );
      });
    });

    assert.ok(exportResult?.ok, `CSV export request should succeed: ${exportResult?.error || "unknown"}`);
    assert.equal(exportResult.path, "custom_tiktok_list.csv", "CSV filename should reflect configured path");

    console.log("Smoke test passed:");
    console.log(`- extension id: ${extensionId}`);
    console.log(`- records: ${finalState.records.length}`);
    console.log(`- latest: ${latest.url}`);
    console.log(`- csv export path: ${exportResult.path}`);
  } catch (error) {
    console.error("Smoke test failed");
    throw error;
  } finally {
    await cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
