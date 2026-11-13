/**
 * alwaysAllow.js — what "Always allow" covers, in words, for a bot's
 * approval: a provider tool (this bot, this tool, every run) or a built-in
 * web fetch (this bot, this site or only this page). Mirrors
 * electron/bots/rememberGrant.js. Pure.
 */
import { shortToolName } from "../../utils/toolNames";

export const WEB_FETCH = "WebFetch";

/** "search_messages" → "Search messages". */
export function toolWords(name) {
  const words = shortToolName(name)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The site and page a web fetch asks for, or null. The site is its origin
 * (scheme, host, port), as Dash saves it.
 */
export function webFetchTarget(request) {
  const r = request || {};
  if (r.toolName !== WEB_FETCH) return null;
  try {
    const u = new URL(String((r.input && r.input.url) || ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return { host: u.hostname, site: u.origin, url: u.toString() };
  } catch (_e) {
    return null;
  }
}

/** Can this ask be answered with Always allow? */
export function canAlwaysAllow(request) {
  const r = request || {};
  if (!r.toolName) return false;
  return !!r.serverName || webFetchTarget(r) !== null;
}

// Punycode (RFC 3492) decoding, for showing an international site name
// ("xn--bcher-kva") as people write it ("bücher").
function decodePunycode(input) {
  const base = 36;
  const out = [];
  let i = 0;
  let n = 128;
  let bias = 72;
  const last = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(last, 0); j++) out.push(input.charCodeAt(j));
  let pos = last > 0 ? last + 1 : 0;
  while (pos < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (pos >= input.length) return null;
      const c = input.charCodeAt(pos++);
      const digit =
        c - 48 < 10
          ? c - 22
          : c - 65 < 26
            ? c - 65
            : c - 97 < 26
              ? c - 97
              : base;
      if (digit >= base) return null;
      i += digit * w;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    const len = out.length + 1;
    let delta = oldi === 0 ? Math.floor((i - oldi) / 700) : (i - oldi) >> 1;
    delta += Math.floor(delta / len);
    let k = 0;
    while (delta > 455) {
      delta = Math.floor(delta / 35);
      k += base;
    }
    bias = k + Math.floor((36 * delta) / (delta + 38));
    n += Math.floor(i / len);
    i %= len;
    if (n > 0x10ffff) return null;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

/**
 * A site name as people write it. An international one shows both ways —
 * "bücher.example (xn--bcher-kva.example)" — since a look-alike name only
 * shows itself in the encoded form.
 */
function unicodeHost(host) {
  return String(host || "")
    .split(".")
    .map((label) =>
      /^xn--/i.test(label) ? decodePunycode(label.slice(4)) || label : label,
    )
    .join(".");
}

export function hostText(host) {
  const h = String(host || "");
  const shown = unicodeHost(h);
  return shown === h ? h : `${shown} (${h})`;
}

/**
 * "news.example.com/today" — an https page or site without its scheme
 * (http keeps it, so it's clear it isn't secure); an international site
 * name shown as people write it, too.
 */
export function pageText(url) {
  const text = String(url || "")
    .replace(/^https:\/\//, "")
    .replace(/\/$/, "");
  const m = text.match(/^(http:\/\/)?([^/:]+)(.*)$/);
  if (!m) return text;
  const shown = unicodeHost(m[2]);
  return shown === m[2] ? text : `${m[1] || ""}${shown}${m[3]} (${m[2]})`;
}

/** Under "Only this page": what it covers, including where it's sent on. */
export function pageReach(url) {
  return `${pageText(url)} — and any page on this site it redirects to`;
}

/** What Always allow means, under the buttons. */
export function alwaysAllowLine(request, scope = "site") {
  const r = request || {};
  const web = webFetchTarget(r);
  if (web) {
    const what =
      scope === "page"
        ? `reads ${pageText(web.url)}`
        : `reads pages on ${pageText(web.site)}`;
    return `Always allow: this bot ${what} without asking, every run. You can take it back in its settings.`;
  }
  const on = r.serverName ? ` on ${r.serverName}` : "";
  return `Always allow: this bot uses ${toolWords(r.toolName)}${on} without asking, every run. You can take it back in its settings.`;
}

/** The card after Always allow: what was saved. */
export function savedText(request, botName, scope = "site") {
  const r = request || {};
  const who = botName || "This bot";
  const web = webFetchTarget(r);
  if (web) {
    return scope === "page"
      ? `${who} reads ${pageText(web.url)} without asking, from now on.`
      : `${who} reads pages on ${pageText(web.site)} without asking, from now on. Other sites still ask.`;
  }
  const on = r.serverName ? ` on ${r.serverName}` : "";
  return `${who} uses ${toolWords(r.toolName)}${on} without asking, from now on. It still asks before anything else you haven't allowed.`;
}

/** One row of a bot's "Runs without asking": its name and what it covers. */
export function grantRowText(row) {
  const g = row || {};
  if (g.kind === "builtin") {
    return {
      name: "Web fetch · built in",
      scope: g.page
        ? `Only ${pageText(g.page)}`
        : `Pages on ${pageText(g.site)}`,
    };
  }
  return {
    name: `${toolWords(g.tool)} · ${g.provider}`,
    scope:
      g.folders && g.folders.length
        ? `In ${g.folders.join(", ")}`
        : "Every run, without asking",
  };
}
