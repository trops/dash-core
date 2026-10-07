/**
 * imageSniff.test.js — identify an image from its bytes, not the server's
 * Content-Type (CAP-002 edge case).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { sniffImage } = require("./imageSniff");

function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

function gif(w, h) {
  const b = Buffer.alloc(13);
  b.write("GIF89a", 0, "ascii");
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}

function jpeg(w, h) {
  // SOI, an APP0 segment, then SOF0 with height/width.
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (h >> 8) & 0xff,
    h & 0xff,
    (w >> 8) & 0xff,
    w & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ]);
}

function webp() {
  const b = Buffer.alloc(16);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  return b;
}

describe("sniffImage", () => {
  it("detects PNG with its size", () => {
    assert.deepEqual(sniffImage(png(640, 480)), {
      mimeType: "image/png",
      width: 640,
      height: 480,
    });
  });

  it("detects GIF with its size", () => {
    assert.deepEqual(sniffImage(gif(32, 16)), {
      mimeType: "image/gif",
      width: 32,
      height: 16,
    });
  });

  it("detects JPEG and reads the size from the SOF segment", () => {
    assert.deepEqual(sniffImage(jpeg(1200, 800)), {
      mimeType: "image/jpeg",
      width: 1200,
      height: 800,
    });
  });

  it("detects WebP (size not read)", () => {
    assert.deepEqual(sniffImage(webp()), { mimeType: "image/webp" });
  });

  it("returns null for HTML or anything else", () => {
    assert.equal(sniffImage(Buffer.from("<!doctype html><html>")), null);
    assert.equal(sniffImage(Buffer.alloc(0)), null);
  });
});
