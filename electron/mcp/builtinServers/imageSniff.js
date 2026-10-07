/**
 * imageSniff.js
 *
 * Identifies an image from its bytes (servers often send a wrong
 * Content-Type) and reads its size where that's cheap: PNG, GIF and JPEG.
 * Only the four types models accept are recognised. Pure — no Electron.
 */
"use strict";

function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    // SOF0–SOF15 carry the frame size (C4, C8 and CC are not frames).
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
      };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * @param {Buffer} buf
 * @returns {{ mimeType: string, width?: number, height?: number } | null}
 */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf.toString("ascii", 1, 4) === "PNG"
  ) {
    return {
      mimeType: "image/png",
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: "image/jpeg", ...(jpegSize(buf) || {}) };
  }
  const head = buf.toString("ascii", 0, 6);
  if ((head === "GIF87a" || head === "GIF89a") && buf.length >= 10) {
    return {
      mimeType: "image/gif",
      width: buf.readUInt16LE(6),
      height: buf.readUInt16LE(8),
    };
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mimeType: "image/webp" };
  }
  return null;
}

module.exports = { sniffImage };
