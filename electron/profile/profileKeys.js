/**
 * profileKeys.js — a profile's keys and passwords, locked with a phrase only
 * the user knows (dash-profiles, "Include keys and passwords", 2026-11-02).
 *
 * Saving with the option on puts one locked blob in the profile: the
 * providers' keys and the passwords typed into widgets, encrypted on this
 * Mac before anything leaves it. Neither Dash nor the registry can read it —
 * only the phrase opens it. Loading unlocks it in the main process; the
 * keys never pass through the renderer.
 *
 *   key   scrypt(phrase, salt)  N 2^17, r 8, p 1 → 32 bytes (async: the
 *         main process isn't held up; the blob can sit on a server, so
 *         guessing must be slow)
 *   seal  AES-256-GCM, 12-byte IV, 16-byte auth tag (a wrong phrase or a changed
 *         blob fails to open — never a garbled result)
 *
 * The phrase is compared as typed, after Unicode normalization and trimming
 * (unlike the spoken task passphrase, it's typed — and it's the only thing
 * standing between the registry's copy and the keys, so no loosening).
 *
 * Pure: Node's crypto only.
 */
"use strict";

const crypto = require("crypto");

const VERSION = 1;
const SCRYPT = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const MIN_CHARS = 12;
const SHORT_CHARS = 16;
const TAG_BYTES = 16;
const MAX_CHARS = 200;
// A blob bigger than this isn't one of ours (keys are small).
const MAX_DATA_CHARS = 2 * 1024 * 1024;

const norm = (phrase) =>
  String(phrase == null ? "" : phrase)
    .normalize("NFKC")
    .trim();

/**
 * Can this be the phrase? { ok, short? } or { ok: false, error }. Short is
 * advice, not a refusal.
 */
function checkKeysPhrase(phrase) {
  const p = norm(phrase);
  if (p.length < MIN_CHARS) {
    return {
      ok: false,
      error: `Use at least ${MIN_CHARS} characters — a few words works well.`,
    };
  }
  if (p.length > MAX_CHARS) {
    return { ok: false, error: `Keep it under ${MAX_CHARS} characters.` };
  }
  return { ok: true, short: p.length < SHORT_CHARS };
}

const deriveKey = (phrase, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(norm(phrase), salt, 32, SCRYPT, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

/**
 * Lock a bundle with a phrase.
 * @param {{ providers?: object, widgetSecrets?: object[] }} bundle
 * @param {string} phrase
 * @returns {{ v, kdf, salt, iv, tag, data, counts: { providers, widgetSecrets } }}
 */
async function lockKeys(bundle, phrase) {
  const check = checkKeysPhrase(phrase);
  if (!check.ok) throw new Error(check.error);
  const providers =
    bundle && bundle.providers && typeof bundle.providers === "object"
      ? bundle.providers
      : {};
  const widgetSecrets = Array.isArray(bundle && bundle.widgetSecrets)
    ? bundle.widgetSecrets
    : [];
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(phrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_BYTES,
  });
  const plain = Buffer.from(
    JSON.stringify({ providers, widgetSecrets }),
    "utf8",
  );
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    v: VERSION,
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
    // What's inside, without what it is: for the load preview.
    counts: {
      providers: Object.keys(providers).length,
      widgetSecrets: widgetSecrets.length,
    },
  };
}

/** Is this a locked blob we can try to open? (A profile is untrusted.) */
function isLockedKeys(x) {
  return !!(
    x &&
    typeof x === "object" &&
    x.v === VERSION &&
    x.kdf === "scrypt" &&
    typeof x.salt === "string" &&
    typeof x.iv === "string" &&
    typeof x.tag === "string" &&
    typeof x.data === "string" &&
    x.data.length <= MAX_DATA_CHARS
  );
}

/**
 * Open a locked blob.
 * @returns {{ ok: true, bundle: { providers, widgetSecrets } } |
 *           { ok: false, error }}
 */
async function unlockKeys(locked, phrase) {
  if (!isLockedKeys(locked)) {
    return { ok: false, error: "This profile's keys can't be read." };
  }
  try {
    const tag = Buffer.from(locked.tag, "base64");
    if (tag.length !== TAG_BYTES) throw new Error("bad tag");
    const key = await deriveKey(phrase, Buffer.from(locked.salt, "base64"));
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(locked.iv, "base64"),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(locked.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plain);
    return { ok: true, bundle: cleanBundle(parsed) };
  } catch (_e) {
    return { ok: false, error: "That phrase doesn't open these keys." };
  }
}

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const plainStrings = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (UNSAFE.has(k) || typeof k !== "string" || k.length > 100) continue;
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      out[k] = v;
    }
  }
  return out;
};

/**
 * Only what a bundle may hold, even from a phrase-opened blob: a profile
 * can come from someone else, who knows their own phrase.
 */
function cleanBundle(b) {
  const providers = {};
  for (const [name, creds] of Object.entries((b && b.providers) || {})) {
    if (UNSAFE.has(name) || typeof name !== "string" || name.length > 100) {
      continue;
    }
    if (creds && typeof creds === "object" && !Array.isArray(creds)) {
      providers[name] = plainStrings(creds);
    }
  }
  const widgetSecrets = (
    Array.isArray(b && b.widgetSecrets) ? b.widgetSecrets : []
  )
    .filter(
      (s) =>
        s &&
        (typeof s.dashboardId === "string" ||
          typeof s.dashboardId === "number") &&
        typeof s.item === "string" &&
        typeof s.field === "string" &&
        !UNSAFE.has(s.field) &&
        typeof s.value === "string",
    )
    .map((s) => ({
      dashboardId: s.dashboardId,
      item: s.item,
      field: s.field,
      value: s.value,
    }))
    .slice(0, 1000);
  return { providers, widgetSecrets };
}

module.exports = {
  lockKeys,
  unlockKeys,
  isLockedKeys,
  checkKeysPhrase,
  MIN_CHARS,
  SHORT_CHARS,
};
