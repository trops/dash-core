/**
 * secretBox.js
 *
 * Field-level encryption for sensitive bot data at rest (run answers today),
 * using the OS keychain through an injected object shaped like Electron's
 * `safeStorage`. The bot core never imports Electron (NFR-006): the host
 * passes `safeStorage` in, and a plain-Node host can pass another keychain
 * binding — or nothing, in which case values stay plain.
 *
 * Sealed values look like "enc:v1:<base64>", so the rest of the store stays
 * readable for debugging and older plain values still open. A value that
 * can't be decrypted (keychain reset, a different app identity) opens as
 * null instead of throwing.
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const PREFIX = "enc:v1:";

/**
 * @param {{ isEncryptionAvailable: () => boolean,
 *           encryptString: (s: string) => Buffer,
 *           decryptString: (b: Buffer) => string,
 *           getSelectedStorageBackend?: () => string } | null} crypto
 */
function createSecretBox(crypto) {
  const status = () => {
    if (!crypto || typeof crypto.isEncryptionAvailable !== "function") {
      return { encrypted: false, reason: "unavailable" };
    }
    let available = false;
    try {
      available = !!crypto.isEncryptionAvailable();
    } catch (_e) {
      available = false;
    }
    if (!available) return { encrypted: false, reason: "unavailable" };
    // On Linux without a keyring, safeStorage uses a hard-coded key —
    // obfuscation, not encryption. Say so instead of pretending.
    if (
      typeof crypto.getSelectedStorageBackend === "function" &&
      crypto.getSelectedStorageBackend() === "basic_text"
    ) {
      return { encrypted: false, reason: "weak-backend" };
    }
    return { encrypted: true };
  };

  /** Encrypt a string for storage; empty / non-strings pass through. */
  const seal = (text) => {
    if (typeof text !== "string" || text === "") return text;
    if (!status().encrypted) return text;
    try {
      return PREFIX + crypto.encryptString(text).toString("base64");
    } catch (_e) {
      return text;
    }
  };

  /** Decrypt a stored value; plain values pass through; failures → null. */
  const open = (value) => {
    if (typeof value !== "string" || !value.startsWith(PREFIX)) return value;
    if (!crypto || typeof crypto.decryptString !== "function") return null;
    try {
      return crypto.decryptString(
        Buffer.from(value.slice(PREFIX.length), "base64"),
      );
    } catch (_e) {
      return null;
    }
  };

  return { seal, open, status };
}

module.exports = { createSecretBox, PREFIX };
