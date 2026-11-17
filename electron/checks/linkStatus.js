/**
 * linkStatus.js — asks one link for its status, for the "All links work"
 * rule (checks/kinds/rules.js). HEAD first, GET when a server refuses HEAD;
 * up to 3 redirects; 8 seconds at most. Only the status is read.
 */
"use strict";

const http = require("http");
const https = require("https");

const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

function once(url, method) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch (_e) {
      resolve({ status: 0 });
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      resolve({ status: 0 });
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      u,
      {
        method,
        timeout: TIMEOUT_MS,
        headers: { "user-agent": "Dash link check" },
      },
      (res) => {
        res.resume();
        resolve({
          status: res.statusCode || 0,
          location: res.headers.location || null,
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0 });
    });
    req.on("error", () => resolve({ status: 0 }));
    req.end();
  });
}

/** The final status of a link (0 when it doesn't answer). */
async function fetchStatus(url) {
  let cur = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    let r = await once(cur, "HEAD");
    if (r.status === 405 || r.status === 501 || r.status === 403) {
      r = await once(cur, "GET");
    }
    if (r.status >= 300 && r.status < 400 && r.location) {
      try {
        cur = new URL(r.location, cur).toString();
      } catch (_e) {
        return r.status;
      }
      continue;
    }
    return r.status;
  }
  return 0;
}

module.exports = { fetchStatus };
