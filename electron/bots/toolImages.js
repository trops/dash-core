/**
 * toolImages.js
 *
 * Image content in bot tool results (bot-capabilities CAP-001). A tool result
 * is { text, images?, isError } where images are { data (base64), mimeType }.
 * These helpers decide which images go to the model, describe them for the
 * Activity feed, and keep image data out of stored sessions. Pure — no
 * Electron.
 */
"use strict";

const SUPPORTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const MAX_IMAGES = 5;
// Anthropic's per-image limit; the strictest of the bot providers.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function byteLength(base64) {
  const s = String(base64 || "");
  const padding = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((s.length * 3) / 4) - padding);
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Pick the images from MCP content blocks that can go to the model.
 * @param {Array} blocks  MCP content blocks
 * @returns {{ images: Array<{data: string, mimeType: string}>, notes: string[] }}
 */
function collectImages(blocks) {
  const images = [];
  const notes = [];
  let leftOut = 0;
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || b.type !== "image") continue;
    if (!b.data) {
      notes.push("An image was left out: it had no data.");
      continue;
    }
    if (!SUPPORTED_TYPES.has(b.mimeType)) {
      notes.push(
        `An image was left out: ${b.mimeType || "unknown type"} isn't supported (PNG, JPEG, GIF, or WebP only).`,
      );
      continue;
    }
    const bytes = byteLength(b.data);
    if (bytes > MAX_IMAGE_BYTES) {
      notes.push(
        `An image was left out: too large (${formatSize(bytes)}; limit ${formatSize(MAX_IMAGE_BYTES)}).`,
      );
      continue;
    }
    if (images.length >= MAX_IMAGES) {
      leftOut++;
      continue;
    }
    images.push({ data: b.data, mimeType: b.mimeType });
  }
  if (leftOut) {
    notes.push(
      `${leftOut} more image${leftOut === 1 ? "" : "s"} left out (limit ${MAX_IMAGES} per result).`,
    );
  }
  return { images, notes };
}

/** "[image: image/png, 240 KB]" */
function imagePlaceholder(image) {
  return `[image: ${image.mimeType}, ${formatSize(byteLength(image.data))}]`;
}

/** Text for the Activity feed: the result text plus a line per image/note. */
function describeResult({ text, images, notes }) {
  const lines = [];
  if (text) lines.push(text);
  for (const img of images || []) lines.push(imagePlaceholder(img));
  for (const n of notes || []) lines.push(n);
  return lines.join("\n");
}

// One content part → its storage form (images become placeholder text).
function stripPart(part) {
  if (!part || typeof part !== "object") return part;
  // Anthropic: { type: "image", source: { type: "base64", media_type, data } }
  if (part.type === "image" && part.source && part.source.data) {
    return {
      type: "text",
      text: imagePlaceholder({
        data: part.source.data,
        mimeType: part.source.media_type,
      }),
    };
  }
  // OpenAI: { type: "image_url", image_url: { url: "data:<mime>;base64,<data>" } }
  if (part.type === "image_url" && part.image_url) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(part.image_url.url || "");
    if (m) {
      return {
        type: "text",
        text: imagePlaceholder({ mimeType: m[1], data: m[2] }),
      };
    }
  }
  if (Array.isArray(part.content)) {
    return { ...part, content: part.content.map(stripPart) };
  }
  return part;
}

/**
 * A copy of a message history with image data replaced by placeholders, for
 * saving as the bot's session. The live history is not modified.
 */
function stripImagesForStorage(messages) {
  return (Array.isArray(messages) ? messages : []).map((msg) =>
    msg && Array.isArray(msg.content)
      ? { ...msg, content: msg.content.map(stripPart) }
      : msg,
  );
}

/**
 * A plain message when the model API refused the images, else null.
 * @param {Error} err
 * @param {string} model
 */
function imageRejectionMessage(err, model) {
  const msg = String((err && err.message) || "");
  if (!/image/i.test(msg)) return null;
  if (
    !/not supported|unsupported|does not support|doesn't support|invalid/i.test(
      msg,
    )
  ) {
    return null;
  }
  return `This model can't read images (${model || "unknown model"}). Choose a model that supports images in the bot's Settings.`;
}

module.exports = {
  SUPPORTED_TYPES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  collectImages,
  imagePlaceholder,
  describeResult,
  stripImagesForStorage,
  imageRejectionMessage,
};
