/**
 * webFetch.js
 *
 * The built-in Web Fetch provider (bot-capabilities CAP-002): an MCP server
 * that runs inside Dash — nothing to install — with two tools:
 *   - fetch_image(url | urls) → the image(s) as MCP image content
 *   - fetch_url(url)          → readable text of a page (HTML → light markdown)
 *
 * Each copy of the provider has its own settings (Settings › Providers),
 * passed in as its saved credentials; values are clamped to fixed ranges.
 * The fixed safety rules live in safeFetch.js.
 */
"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const z = require("zod");
const { safeFetch, WebFetchError, formatMb } = require("./safeFetch");
const { sniffImage } = require("./imageSniff");
const { htmlToText } = require("./htmlToText");

// The strictest per-image limit among the bot model providers (Anthropic).
const MODEL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
// Above this many pixels on a side, models reject or downscale anyway.
const MODEL_IMAGE_MAX_SIDE = 8000;
// Shrunk images aim for the size Anthropic recommends for vision.
const SHRINK_TARGET_SIDE = 1568;
// fetch_url returns at most this much text.
const MAX_TEXT_CHARS = 40000;

// Setting key → { default, min, max } — mirrors the catalog's credentialSchema.
const NUMBER_SETTINGS = {
  maxDownloadMb: { default: 10, min: 1, max: 50 },
  timeoutSeconds: { default: 20, min: 5, max: 120 },
  maxImages: { default: 5, min: 1, max: 20 },
};

function readNumber(value, { default: dflt, min, max }) {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function readBool(value, dflt) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return dflt;
  return !/^(false|0|no|off)$/i.test(String(value).trim());
}

function readList(value) {
  const items = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[,\n]/);
  return items.map((s) => String(s).trim()).filter(Boolean);
}

/** This copy's settings from its saved credentials, with defaults + ranges. */
function readSettings(credentials = {}) {
  const c = credentials || {};
  const maxDownloadMb = readNumber(
    c.maxDownloadMb,
    NUMBER_SETTINGS.maxDownloadMb,
  );
  return {
    maxBytes: Math.round(maxDownloadMb * 1024 * 1024),
    maxDownloadMb,
    timeoutMs:
      readNumber(c.timeoutSeconds, NUMBER_SETTINGS.timeoutSeconds) * 1000,
    maxImages: Math.round(readNumber(c.maxImages, NUMBER_SETTINGS.maxImages)),
    allowedSites: readList(c.allowedSites),
    shrinkLargeImages: readBool(c.shrinkLargeImages, true),
  };
}

/** Shrink with Electron's nativeImage (PNG and JPEG only). Lazy: tests inject. */
function nativeShrink(buffer, mimeType) {
  if (mimeType !== "image/png" && mimeType !== "image/jpeg") return null;
  // eslint-disable-next-line global-require
  const { nativeImage } = require("electron");
  const img = nativeImage.createFromBuffer(buffer);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const scale = Math.min(1, SHRINK_TARGET_SIDE / Math.max(width, height));
  const resized = img.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: "good",
  });
  const size = resized.getSize();
  let out = mimeType === "image/png" ? resized.toPNG() : resized.toJPEG(85);
  let outType = mimeType;
  if (out.length > MODEL_IMAGE_MAX_BYTES) {
    out = resized.toJPEG(75);
    outType = "image/jpeg";
  }
  return {
    buffer: out,
    mimeType: outType,
    width: size.width,
    height: size.height,
  };
}

function dims(info) {
  return info && info.width && info.height
    ? `, ${info.width}×${info.height}`
    : "";
}

function textResult(text, isError = false) {
  return isError
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}

/**
 * @param {object} credentials  this copy's saved settings
 * @param {{ serverName?: string, fetch?: Function, shrink?: Function }} opts
 */
function createWebFetchServer(credentials, opts = {}) {
  const settings = readSettings(credentials);
  const serverName = opts.serverName || "Web Fetch";
  const doFetch = opts.fetch || safeFetch;
  const shrink = opts.shrink || nativeShrink;
  const where = (setting) =>
    `(Settings › Providers › ${serverName} › ${setting})`;

  // Plain-language errors that point at the setting involved (AC8).
  function explain(err) {
    const msg = (err && err.message) || String(err);
    if (!(err instanceof WebFetchError)) return msg;
    if (err.code === "TOO_LARGE") {
      return `${msg.replace("; limit ", "; this provider's limit is ")} ${where("Max download size")}`;
    }
    if (err.code === "SITE_NOT_ALLOWED")
      return `${msg} ${where("Allowed sites")}`;
    if (err.code === "TIMEOUT") return `${msg} ${where("Timeout")}`;
    return msg;
  }

  const fetchOpts = (accept) => ({
    maxBytes: settings.maxBytes,
    timeoutMs: settings.timeoutMs,
    allowedSites: settings.allowedSites,
    accept,
  });

  // One URL → { image, line } or throws with an explained message.
  async function fetchOneImage(url) {
    const res = await doFetch(url, fetchOpts("image/*"));
    const info = sniffImage(res.buffer);
    if (!info) {
      const said = res.contentType.split(";")[0].trim() || "unknown type";
      throw new WebFetchError(
        `Not an image: ${said} (PNG, JPEG, GIF or WebP only)`,
        "NOT_IMAGE",
      );
    }
    let buffer = res.buffer;
    let mimeType = info.mimeType;
    let note = "";
    const tooBig =
      buffer.length > MODEL_IMAGE_MAX_BYTES ||
      Math.max(info.width || 0, info.height || 0) > MODEL_IMAGE_MAX_SIDE;
    let finalInfo = info;
    if (tooBig) {
      const shrunk = settings.shrinkLargeImages
        ? shrink(buffer, mimeType)
        : null;
      if (!shrunk) {
        const how = settings.shrinkLargeImages
          ? `only PNG and JPEG can be shrunk`
          : `turn on Shrink large images ${where("Shrink large images")}`;
        throw new WebFetchError(
          `Image too large for the model: ${formatMb(buffer.length)}${dims(info)} (limit ${formatMb(MODEL_IMAGE_MAX_BYTES)}, ${MODEL_IMAGE_MAX_SIDE}px a side); ${how}.`,
          "IMAGE_TOO_LARGE",
        );
      }
      note = `, shrunk from ${info.width || "?"}×${info.height || "?"}`;
      buffer = shrunk.buffer;
      mimeType = shrunk.mimeType;
      finalInfo = shrunk;
    }
    return {
      image: { type: "image", data: buffer.toString("base64"), mimeType },
      line: `${res.finalUrl} — ${mimeType}${dims(finalInfo)}, ${formatMb(buffer.length)}${note}`,
    };
  }

  const server = new McpServer({ name: "dash-web-fetch", version: "1.0.0" });

  server.tool(
    "fetch_image",
    "Download an image from an HTTPS URL so you can see it. Pass `url` for one image or `urls` for several (up to this provider's Max images per result). PNG, JPEG, GIF and WebP only.",
    {
      url: z.string().optional().describe("HTTPS URL of one image"),
      urls: z
        .array(z.string())
        .optional()
        .describe("HTTPS URLs of several images"),
    },
    async ({ url, urls }) => {
      const list = [
        ...(url ? [url] : []),
        ...(Array.isArray(urls) ? urls : []),
      ];
      if (!list.length)
        return textResult("Pass a `url` (or `urls`) to fetch.", true);

      const take = list.slice(0, settings.maxImages);
      const skipped = list.length - take.length;
      const lines = [];
      const images = [];
      for (const u of take) {
        try {
          const { image, line } = await fetchOneImage(u);
          images.push(image);
          lines.push(line);
        } catch (err) {
          lines.push(`${u}: ${explain(err)}`);
        }
      }
      if (skipped) {
        lines.push(
          `${skipped} more URL${skipped === 1 ? "" : "s"} skipped (Max images per result is ${settings.maxImages}) ${where("Max images per result")}`,
        );
      }
      if (!images.length) return textResult(lines.join("\n"), true);
      return { content: [{ type: "text", text: lines.join("\n") }, ...images] };
    },
  );

  server.tool(
    "fetch_url",
    "Download a web page (or JSON/text) from an HTTPS URL and return its readable text. Pages that need JavaScript to show content may come back mostly empty. For images use fetch_image.",
    { url: z.string().describe("HTTPS URL of the page") },
    async ({ url }) => {
      let res;
      try {
        res = await doFetch(
          url,
          fetchOpts(
            "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5",
          ),
        );
      } catch (err) {
        return textResult(explain(err), true);
      }
      const type = res.contentType.split(";")[0].trim().toLowerCase();
      if (sniffImage(res.buffer) || type.startsWith("image/")) {
        return textResult(
          `That URL is an image (${type || "image"}). Use fetch_image to see it.`,
          true,
        );
      }
      const isHtml =
        /html|xml/.test(type) ||
        (!type && /^\s*</.test(res.buffer.toString("utf8", 0, 200)));
      const isText =
        isHtml ||
        type.startsWith("text/") ||
        /json|javascript|csv|yaml/.test(type) ||
        !type;
      if (!isText) {
        return textResult(
          `Not a text page: ${type}. Web Fetch can read web pages, text and JSON.`,
          true,
        );
      }
      const raw = res.buffer.toString("utf8");
      let body = isHtml ? htmlToText(raw) : raw;
      let note = "";
      if (body.length > MAX_TEXT_CHARS) {
        note = `\n\n[Truncated: showing ${MAX_TEXT_CHARS.toLocaleString("en-US")} of ${body.length.toLocaleString("en-US")} characters]`;
        body = body.slice(0, MAX_TEXT_CHARS);
      }
      return textResult(
        `URL: ${res.finalUrl}\nContent-Type: ${type || "unknown"}\n\n${body}${note}`,
      );
    },
  );

  return server;
}

module.exports = {
  createWebFetchServer,
  readSettings,
  MODEL_IMAGE_MAX_BYTES,
  MODEL_IMAGE_MAX_SIDE,
  NUMBER_SETTINGS,
};
