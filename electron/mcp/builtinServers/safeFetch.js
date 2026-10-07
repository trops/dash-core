/**
 * safeFetch.js
 *
 * The download behind the built-in Web Fetch provider (bot-capabilities
 * CAP-002). Fixed rules, not settings: HTTPS only, at most 5 redirects (each
 * re-checked), and no internal addresses — checked on the IP actually
 * connected to, so DNS tricks can't reach the user's network. Size cap,
 * timeout and allowed sites come from the provider's settings.
 *
 * `deps.open` is injectable for tests; the real one uses Node https with a
 * guarded DNS lookup.
 */
"use strict";

const https = require("https");
const dns = require("dns");
const net = require("net");
const { isBlockedAddress } = require("./addressGuard");

const MAX_REDIRECTS = 5;

class WebFetchError extends Error {
  constructor(message, code = "WEB_FETCH_ERROR") {
    super(message);
    this.name = "WebFetchError";
    this.code = code;
  }
}

/** "240 KB", "1.5 MB", "14 MB". */
function formatMb(bytes) {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** Normalise an allowed-sites entry ("https://CDN.test/x" → "cdn.test"). */
function normaliseSite(entry) {
  let s = String(entry || "")
    .trim()
    .toLowerCase();
  s = s
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
  return s;
}

/** Empty list = any public site; "*.x.test" matches subdomains of x.test. */
function hostAllowed(hostname, allowedSites) {
  const list = (allowedSites || []).map(normaliseSite).filter(Boolean);
  if (!list.length) return true;
  const host = String(hostname || "").toLowerCase();
  return list.some((site) =>
    site.startsWith("*.")
      ? host.endsWith(site.slice(1)) && host.length > site.length - 1
      : host === site,
  );
}

function blockedError(address) {
  return new WebFetchError(
    `Blocked: private network address (${address}). Web Fetch only reaches public websites.`,
    "BLOCKED_ADDRESS",
  );
}

/**
 * A dns.lookup wrapper that refuses internal addresses. Handles both the
 * single-address and `{ all: true }` callback shapes.
 */
function guardedLookup(lookup = dns.lookup) {
  return (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    lookup(hostname, options, (err, address, family) => {
      if (err) return callback(err);
      const list = Array.isArray(address)
        ? address.map((a) => a.address)
        : [address];
      const bad = list.find((a) => isBlockedAddress(a));
      if (bad) return callback(blockedError(bad));
      return callback(null, address, family);
    });
  };
}

/** Real transport: one HTTPS GET with the guarded lookup. */
function httpsOpen(url, { signal, accept }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup(),
        signal,
        headers: {
          "User-Agent": "Dash-WebFetch/1.0",
          Accept: accept || "*/*",
          "Accept-Encoding": "identity",
        },
      },
      (res) =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: res,
          destroy: () => res.destroy(),
        }),
    );
    req.on("error", reject);
    req.end();
  });
}

function checkUrl(url, allowedSites) {
  if (url.protocol !== "https:") {
    throw new WebFetchError(
      `Only HTTPS URLs are allowed: ${url.protocol.replace(":", "")}://${url.host}`,
      "NOT_HTTPS",
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedAddress(host)) throw blockedError(host);
  if (!hostAllowed(host, allowedSites)) {
    throw new WebFetchError(
      `Not in this provider's allowed sites: ${host}`,
      "SITE_NOT_ALLOWED",
    );
  }
}

/**
 * @param {string} rawUrl
 * @param {{ maxBytes: number, timeoutMs: number, allowedSites?: string[], accept?: string }} opts
 * @param {{ open?: Function }} deps
 * @returns {Promise<{ finalUrl: string, status: number, contentType: string, buffer: Buffer }>}
 */
async function safeFetch(rawUrl, opts, deps = {}) {
  const open = deps.open || httpsOpen;
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch (_e) {
    throw new WebFetchError(`Not a valid URL: ${rawUrl}`, "BAD_URL");
  }

  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new WebFetchError(
          `Timed out after ${Math.round(opts.timeoutMs / 1000)} s: ${url.host}`,
          "TIMEOUT",
        ),
      );
    }, opts.timeoutMs);
  });

  const run = async () => {
    for (let hop = 0; ; hop++) {
      checkUrl(url, opts.allowedSites);
      const res = await open(url, {
        signal: controller.signal,
        accept: opts.accept,
      });
      const status = res.statusCode || 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.destroy();
        if (hop >= MAX_REDIRECTS) {
          throw new WebFetchError(
            `Too many redirects (more than ${MAX_REDIRECTS}) from ${rawUrl}`,
            "TOO_MANY_REDIRECTS",
          );
        }
        url = new URL(res.headers.location, url);
        continue;
      }
      if (status < 200 || status >= 300) {
        res.destroy();
        throw new WebFetchError(
          `HTTP ${status} from ${url.host}`,
          "HTTP_ERROR",
        );
      }

      const tooLarge = (bytes) =>
        new WebFetchError(
          `Too large: ${bytes ? formatMb(bytes) : `over ${formatMb(opts.maxBytes)}`}; limit ${formatMb(opts.maxBytes)}`,
          "TOO_LARGE",
        );
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        res.destroy();
        throw tooLarge(declared);
      }
      const chunks = [];
      let total = 0;
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > opts.maxBytes) {
          res.destroy();
          throw tooLarge(Number.isFinite(declared) ? declared : 0);
        }
        chunks.push(chunk);
      }
      return {
        finalUrl: url.href,
        status,
        contentType: String(res.headers["content-type"] || ""),
        buffer: Buffer.concat(chunks),
      };
    }
  };

  try {
    return await Promise.race([run(), timeout]);
  } catch (err) {
    if (controller.signal.aborted && !(err instanceof WebFetchError)) {
      throw new WebFetchError(
        `Timed out after ${Math.round(opts.timeoutMs / 1000)} s: ${url.host}`,
        "TIMEOUT",
      );
    }
    // A guarded-lookup refusal surfaces from https as a request error.
    if (err && err.code === "BLOCKED_ADDRESS") throw err;
    if (err instanceof WebFetchError) throw err;
    throw new WebFetchError(
      `Couldn't download ${url.host}: ${err.message}`,
      err.code || "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  safeFetch,
  guardedLookup,
  hostAllowed,
  WebFetchError,
  MAX_REDIRECTS,
  formatMb,
};
