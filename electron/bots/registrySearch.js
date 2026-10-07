/**
 * registrySearch.js
 *
 * Searches the official MCP Registry for find_providers' community tier
 * (bot-capabilities CAP-003). Uses Web Fetch's safeFetch pinned to the
 * registry host (HTTPS, size cap, timeout, no internal addresses) and caches
 * each query for a few minutes. Portable — no Electron.
 */
"use strict";

const { safeFetch } = require("../mcp/builtinServers/safeFetch");

const REGISTRY_HOST = "registry.modelcontextprotocol.io";
const CACHE_TTL_MS = 5 * 60 * 1000;
const LIMIT = 30;

const cache = new Map(); // query → { at, value }

/**
 * @param {string} query
 * @param {{ open?: Function }} deps  injectable transport (tests)
 * @returns {Promise<object>} the registry's /v0/servers JSON
 */
async function searchRegistry(query, deps = {}) {
  const q = String(query || "").trim();
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const url = new URL(`https://${REGISTRY_HOST}/v0/servers`);
  url.searchParams.set("search", q);
  // No version=latest: the registry answers that query slowly or with a 500;
  // findProviders keeps the latest version of each server itself.
  url.searchParams.set("limit", String(LIMIT));

  const res = await safeFetch(
    url.href,
    {
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 10000,
      allowedSites: [REGISTRY_HOST],
      accept: "application/json",
    },
    deps.open ? { open: deps.open } : {},
  );
  let value;
  try {
    value = JSON.parse(res.buffer.toString("utf8"));
  } catch (_e) {
    throw new Error("The MCP Registry returned something that isn't JSON.");
  }
  cache.set(q, { at: Date.now(), value });
  return value;
}

function __clearCacheForTest() {
  cache.clear();
}

module.exports = { searchRegistry, REGISTRY_HOST, __clearCacheForTest };
