/**
 * safeMarkdown.js
 *
 * Markdown → HTML that is safe to insert with dangerouslySetInnerHTML.
 *
 * AI replies are Markdown, and they can quote untrusted content (emails, web
 * pages, tool results). `marked` passes raw HTML through untouched, so a reply
 * containing `<img onerror=…>` or `<script>` would run in the app window —
 * which can reach window.mainApi. Every Markdown render of model or tool text
 * goes through here: `marked`, then DOMPurify.
 *
 * Kept: normal formatting (headings, emphasis, lists, code, tables, links).
 * Removed: scripts, event-handler attributes, javascript:/data: URLs,
 * iframes/objects/embeds/forms/styles, and inline style. Links get
 * rel="noopener noreferrer" (the app also blocks in-window navigation).
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

const FORBID_TAGS = [
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "link",
  "meta",
  "base",
];
const FORBID_ATTR = ["style"];
// http(s), mailto, and in-page anchors only.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|#)/i;

let hooked = false;
function ensureLinkHook() {
  if (hooked || typeof DOMPurify.addHook !== "function") return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("rel", "noopener noreferrer");
      node.setAttribute("target", "_blank");
    }
  });
  hooked = true;
}

/**
 * @param {string} text Markdown (from a model, a tool, or a user)
 * @returns {string} sanitized HTML
 */
export function renderSafeMarkdown(text) {
  if (!text) return "";
  ensureLinkHook();
  const html = marked(String(text), { breaks: true });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOWED_URI_REGEXP,
  });
}
