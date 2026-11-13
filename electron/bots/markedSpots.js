/**
 * markedSpots.js
 *
 * Mark a spot (a fix on a widget's preview): the user draws numbered boxes on
 * the running preview and says what's wrong. The app takes a picture of the
 * preview with the boxes on it; the Builder looks at it with
 * see_marked_spots before changing its widget.
 *
 * The picture is kept here in memory, by the widget's draft name, never in
 * the build's saved state (it's large). Capturing takes Electron's
 * webContents, passed in, so this file stays portable.
 */
"use strict";

// Boxes per fix; more than this is a new fix.
const MAX_SPOTS = 6;
// The picture's widest side: enough to read text, small enough for a model.
const MAX_WIDTH = 1400;
// The thumbnail the chat shows with your message.
const THUMB_WIDTH = 120;
// Pictures kept (oldest go first).
const MAX_KEPT = 20;

const kept = new Map(); // widget name → { image, spots, at }

const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);

/**
 * What the renderer sent, made safe: the preview's place in the window and
 * the boxes on it (relative to the preview), numbered from 1.
 * @param {*} marks  { rect: {x,y,width,height}, spots: [{x,y,width,height}] }
 * @returns {{ rect: object, spots: object[] } | null}
 */
function cleanMarks(marks) {
  if (!marks || typeof marks !== "object") return null;
  const r = marks.rect || {};
  const rect = {
    x: num(r.x),
    y: num(r.y),
    width: num(r.width),
    height: num(r.height),
  };
  if (Object.values(rect).some((v) => Number.isNaN(v))) return null;
  if (rect.width < 8 || rect.height < 8) return null;
  rect.x = Math.max(0, rect.x);
  rect.y = Math.max(0, rect.y);
  const spots = (Array.isArray(marks.spots) ? marks.spots : [])
    .map((s) => ({
      x: num(s && s.x),
      y: num(s && s.y),
      width: num(s && s.width),
      height: num(s && s.height),
    }))
    .filter(
      (s) =>
        !Object.values(s).some((v) => Number.isNaN(v)) &&
        s.width > 0 &&
        s.height > 0,
    )
    .slice(0, MAX_SPOTS)
    .map((s, i) => ({ n: i + 1, ...s }));
  if (!spots.length) return null;
  return { rect, spots };
}

/**
 * The picture of the preview with the boxes on it.
 * @param {{ capturePage: Function }} webContents  the window that sent it
 * @param {*} marks  as cleanMarks takes
 * @returns {Promise<{ image?: {data,mimeType}, thumb?: string, spots: object[], size?: object, error?: string } | null>}
 */
async function captureMarks(webContents, marks) {
  const clean = cleanMarks(marks);
  if (!clean) return null;
  try {
    // The rect is in the page's CSS pixels; the window's are those times
    // the zoom (View › Zoom In).
    const zoom =
      typeof webContents.getZoomFactor === "function"
        ? Number(webContents.getZoomFactor()) || 1
        : 1;
    const area = {
      x: Math.round(clean.rect.x * zoom),
      y: Math.round(clean.rect.y * zoom),
      width: Math.round(clean.rect.width * zoom),
      height: Math.round(clean.rect.height * zoom),
    };
    let shot = await webContents.capturePage(area);
    if (!shot || shot.isEmpty()) {
      return { spots: clean.spots, error: "The picture came out empty." };
    }
    const size = shot.getSize();
    if (size.width > MAX_WIDTH) shot = shot.resize({ width: MAX_WIDTH });
    const thumb = shot.resize({ width: THUMB_WIDTH }).toDataURL();
    return {
      image: { data: shot.toPNG().toString("base64"), mimeType: "image/png" },
      thumb,
      spots: clean.spots,
      size: { width: clean.rect.width, height: clean.rect.height },
    };
  } catch (err) {
    return {
      spots: clean.spots,
      error: `Couldn't take the picture: ${(err && err.message) || err}`,
    };
  }
}

/** Keep a fix's picture for the Builder, by the widget's name. */
function rememberMarks(widget, marks) {
  const key = String(widget || "").trim();
  if (!key || !marks) return;
  kept.delete(key);
  kept.set(key, { ...marks, at: Date.now() });
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
}

/** The latest marks for a widget ("draft:Name", "Name" or a package). */
function marksFor(widget) {
  const key = String(widget || "").trim();
  if (!key) return null;
  if (kept.has(key)) return kept.get(key);
  const bare = key.replace(/^draft:/, "");
  for (const [k, v] of kept) {
    if (k.replace(/^draft:/, "") === bare) return v;
  }
  return null;
}

/** Where each box is, in words (for the Builder, with the picture). */
function describeSpots(spots, size = null) {
  const list = Array.isArray(spots) ? spots : [];
  const where = (s) => {
    if (!size || !size.width || !size.height) return "";
    const pct = (a, b) => Math.round((a / b) * 100);
    return ` — ${pct(s.x, size.width)}% from the left, ${pct(s.y, size.height)}% from the top, ${pct(s.width, size.width)}% wide, ${pct(s.height, size.height)}% tall`;
  };
  return list.map((s) => `Box ${s.n}${where(s)}`).join("\n");
}

/**
 * see_marked_spots: the picture and where the boxes are, as a tool result
 * ({ text, images }), or a plain answer when there's none.
 */
function markedSpotsResult(widget) {
  const m = marksFor(widget);
  if (!m) {
    return {
      text: `No spots are marked on ${widget || "that widget"} — work from the user's words.`,
      isError: false,
    };
  }
  const lines = [
    `The user marked ${m.spots.length === 1 ? "one spot" : `${m.spots.length} spots`} on the running preview of ${widget}. The picture shows the widget as it looks now, each spot a numbered dashed box. Change what's in the boxes as the user asked; leave the rest as it is.`,
    describeSpots(m.spots, m.size),
  ];
  if (m.error || !m.image) {
    lines.push(`(No picture: ${m.error || "it wasn't taken"}.)`);
    return { text: lines.join("\n"), isError: false };
  }
  return { text: lines.join("\n"), images: [m.image], isError: false };
}

module.exports = {
  MAX_SPOTS,
  cleanMarks,
  captureMarks,
  rememberMarks,
  marksFor,
  describeSpots,
  markedSpotsResult,
  _forget: () => kept.clear(),
};
