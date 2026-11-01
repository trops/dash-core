/**
 * userConfigValidation.js — a widget's settings checked as you set them
 * (widget side panel, approved mockup frames 2 and 4). One place for the side
 * panel and the larger view.
 *
 * A setting (one `userConfig` entry) can say, all plain values — never code,
 * so the config stays safe to parse (the AST allowlist):
 *   type        "text" | "secret" | "number" | "select" | "url" | "email"
 *   required    true → empty isn't allowed
 *   pattern     a regular expression the value must match, with
 *   patternMessage  what to say when it doesn't
 *   minLength / maxLength   for text
 *   min / max   for numbers
 *
 * Pure.
 */

export const KNOWN_TYPES = [
  "text",
  "secret",
  "number",
  "select",
  "url",
  "email",
];

const isEmpty = (v) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

const nameOf = (configItem, key) =>
  (configItem && configItem.displayName) || key || "This setting";

const looksLikeHost = (s) =>
  /^(localhost|\d{1,3}(\.\d{1,3}){3}|[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d+)?(\/.*)?$/i.test(
    s,
  );

/**
 * A URL setting: a web address, or what it probably meant.
 * @returns {{ error: string|null, suggestion: string|null }}
 */
export function checkUrl(value) {
  const v = String(value || "").trim();
  if (!v) return { error: null, suggestion: null };
  // Any scheme:// address counts (http, https, ws, wss, rtsp, mqtt…).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      if (u.hostname) return { error: null, suggestion: null };
    } catch (_e) {
      // falls through: not a web address
    }
    return {
      error: "Not a web address. It should look like http://10.0.0.107",
      suggestion: null,
    };
  }
  let suggestion = null;
  // "http//host", "http:/host", "http:host" → "http://host"
  const scheme = /^(https?)(?::\/?|\/\/?)(?!\/)(.+)$/i.exec(v);
  if (scheme) suggestion = `${scheme[1].toLowerCase()}://${scheme[2]}`;
  // "10.0.0.107" or "example.com" with no scheme at all
  else if (looksLikeHost(v)) {
    const local =
      /^(localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/i.test(v);
    suggestion = `${local ? "http" : "https"}://${v}`;
  }
  if (suggestion && checkUrl(suggestion).error) suggestion = null;
  return {
    error: "Not a web address. It should look like http://10.0.0.107",
    suggestion,
  };
}

/** An email setting. */
export function checkEmail(value) {
  const v = String(value || "").trim();
  if (!v) return { error: null, suggestion: null };
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
    ? { error: null, suggestion: null }
    : {
        error: "Not an email address. It should look like name@example.com",
        suggestion: null,
      };
}

/**
 * One setting's value against what the widget asked for.
 * @returns {{ error: string|null, suggestion: string|null }}
 */
export function validateSetting(configItem = {}, value, key = "") {
  const item = configItem || {};
  const type = item.type || "text";
  const name = nameOf(item, key);
  if (isEmpty(value)) {
    return item.required === true
      ? { error: `${name} is required.`, suggestion: null }
      : { error: null, suggestion: null };
  }
  if (type === "url") {
    const r = checkUrl(value);
    if (r.error) return r;
  }
  if (type === "email") {
    const r = checkEmail(value);
    if (r.error) return r;
  }
  if (type === "number") {
    const n = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(n)) {
      return { error: `${name} has to be a number.`, suggestion: null };
    }
    const hasMin = item.min !== undefined && item.min !== null;
    const hasMax = item.max !== undefined && item.max !== null;
    if ((hasMin && n < item.min) || (hasMax && n > item.max)) {
      return {
        error:
          hasMin && hasMax
            ? `Must be between ${item.min} and ${item.max}.`
            : hasMin
              ? `Must be at least ${item.min}.`
              : `Must be at most ${item.max}.`,
        suggestion: null,
      };
    }
    return { error: null, suggestion: null };
  }
  const s = String(value);
  if (typeof item.minLength === "number" && s.length < item.minLength) {
    return {
      error: `Must be at least ${item.minLength} characters.`,
      suggestion: null,
    };
  }
  if (typeof item.maxLength === "number" && s.length > item.maxLength) {
    return {
      error: `Must be at most ${item.maxLength} characters.`,
      suggestion: null,
    };
  }
  if (typeof item.pattern === "string" && item.pattern) {
    let re = null;
    try {
      re = new RegExp(item.pattern);
    } catch (_e) {
      re = null; // a pattern that isn't valid checks nothing
    }
    if (re && !re.test(s)) {
      return {
        error: item.patternMessage || `${name} isn't in the right format.`,
        suggestion: null,
      };
    }
  }
  return { error: null, suggestion: null };
}

/**
 * Every setting shown: { key: { error, suggestion } } for the ones that
 * fail, in the widget's order.
 * @param {object} userConfig  the widget's settings
 * @param {object} prefs       the copy's values
 * @param {string[]} [keys]    only these (the ones the panel shows)
 */
export function validateSettings(userConfig = {}, prefs = {}, keys = null) {
  const out = {};
  for (const key of keys || Object.keys(userConfig || {})) {
    const r = validateSetting((userConfig || {})[key], (prefs || {})[key], key);
    if (r.error) out[key] = r;
  }
  return out;
}

/** "Fix 1 setting first" / "Fix 2 settings first". */
export function fixFirstText(n) {
  return `Fix ${n === 1 ? "1 setting" : `${n} settings`} first`;
}

/** "1 unsaved change" / "3 unsaved changes". */
export function unsavedText(n) {
  return `${n} unsaved ${n === 1 ? "change" : "changes"}`;
}
