/**
 * addressGuard.js
 *
 * Decides whether an IP address is internal (loopback, private, link-local,
 * CGNAT, multicast, reserved, or an IPv4 address hidden inside IPv6). Web Fetch
 * refuses to connect to these so a bot can't reach the user's own machine or
 * network (bot-capabilities CAP-002 AC4). Pure — no Electron.
 */
"use strict";

const net = require("net");

// [first octet, second-octet min, second-octet max] or whole /8s.
function isBlockedV4(ip) {
  const p = ip.split(".").map(Number);
  if (
    p.length !== 4 ||
    p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return true;
  }
  const [a, b, c] = p;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

// Expand an IPv6 address to 8 numeric groups (handles :: and a dotted tail).
function v6Groups(ip) {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  let tail = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const v4 = dotted[1].split(".").map(Number);
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, -dotted[1].length);
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }
  const [head, rest] = s.includes("::") ? s.split("::") : [s, null];
  const parse = (part) =>
    part
      ? part
          .split(":")
          .filter((x) => x !== "")
          .map((h) => parseInt(h, 16))
      : [];
  const left = parse(head);
  const right = rest === null ? [] : parse(rest);
  const fill = 8 - left.length - right.length - tail.length;
  if (rest === null && fill !== 0) return null;
  return [...left, ...new Array(Math.max(0, fill)).fill(0), ...right, ...tail];
}

function isBlockedV6(ip) {
  const g = v6Groups(ip);
  if (!g || g.length !== 8 || g.some((n) => Number.isNaN(n))) return true;
  if (g.every((n) => n === 0)) return true; // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): check the IPv4.
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    return isBlockedV4(v4);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 — could reach anything
  if (g[0] === 0x2002) return true; // 6to4 — embeds an IPv4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True when Web Fetch must not connect to this address. Fails closed. */
function isBlockedAddress(ip) {
  if (typeof ip !== "string" || !ip) return true;
  const family = net.isIP(ip.split("%")[0]);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true;
}

module.exports = { isBlockedAddress };
