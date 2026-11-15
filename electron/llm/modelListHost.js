/**
 * modelListHost.js
 *
 * Runs modelList.js inside the app: the published list's address, fetch
 * with a time limit, the saved copy (electron-store), and a check on wake.
 * The only part of the model list that touches Electron.
 */
"use strict";

const { createModelList } = require("./modelList");
const { PROVIDERS } = require("./modelProviders");

const FETCH_TIMEOUT_MS = 10000;
// Anthropic's Models API (with an API key): it narrows the list, so a slow
// answer mustn't hold up Check now or a run waiting on the list.
const LIVE_TIMEOUT_MS = 10000;
const MAX_BYTES = 256 * 1024;

function listUrl() {
  if (process.env.DASH_MODEL_LIST_URL) return process.env.DASH_MODEL_LIST_URL;
  const base =
    process.env.DASH_REGISTRY_API_URL ||
    "https://main.d919rwhuzp7rj.amplifyapp.com";
  return `${base}/api/models`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`The model list answered ${res.status}.`);
    const tooBig = () => new Error("The model list is too big.");
    if (Number(res.headers.get("content-length")) > MAX_BYTES) throw tooBig();
    // Read at most MAX_BYTES, whatever the server says its size is.
    const chunks = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        controller.abort();
        throw tooBig();
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error("The model list didn't answer in time.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ getApiKey?: () => Promise<string|null>,
 *           onChange?: (status: object) => void }} opts
 * @returns the started model list (see modelList.js)
 */
function startModelList({ getApiKey, onChange } = {}) {
  const Store = require("electron-store");
  const store = new Store({ name: "dash-model-list" });
  const list = createModelList({
    url: listUrl(),
    fetchJson,
    readSaved: () => store.get("saved", null),
    save: (saved) => store.set("saved", saved),
    getApiKey,
    // Anthropic's own Models API, as it answers — or nothing after a while.
    listLive: (apiKey) =>
      Promise.race([
        PROVIDERS.anthropic.listModels({ apiKey }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Anthropic's model list timed out.")),
            LIVE_TIMEOUT_MS,
          ).unref(),
        ),
      ]),
    builtInIds: () => PROVIDERS.anthropic.curatedModels.map((m) => m.value),
    onChange,
  });
  list.start();
  try {
    const { powerMonitor } = require("electron");
    powerMonitor.on("resume", () => list.tick());
  } catch (_e) {
    // No power events here: the timer still checks.
  }
  return list;
}

module.exports = { startModelList, listUrl };
