/**
 * toolImages.test.js — image content in bot tool results (bot-capabilities
 * CAP-001): what's kept, what's dropped with a note, the Activity placeholder,
 * and stripping image data from stored sessions.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  collectImages,
  imagePlaceholder,
  describeResult,
  stripImagesForStorage,
  imageRejectionMessage,
} = require("./toolImages");

// base64 of `bytes` zero bytes.
const b64 = (bytes) => Buffer.alloc(bytes).toString("base64");
const png = (bytes = 3) => ({
  type: "image",
  data: b64(bytes),
  mimeType: "image/png",
});

describe("collectImages", () => {
  it("keeps supported MCP image blocks and ignores text blocks", () => {
    const r = collectImages([
      { type: "text", text: "hi" },
      png(),
      { type: "image", data: b64(3), mimeType: "image/jpeg" },
    ]);
    assert.deepEqual(r.images, [
      { data: b64(3), mimeType: "image/png" },
      { data: b64(3), mimeType: "image/jpeg" },
    ]);
    assert.deepEqual(r.notes, []);
  });

  it("drops an unsupported type with a note naming it", () => {
    const r = collectImages([
      { type: "image", data: b64(3), mimeType: "image/svg+xml" },
    ]);
    assert.deepEqual(r.images, []);
    assert.match(r.notes[0], /image\/svg\+xml/);
  });

  it("drops an image over the size limit with its size and the limit", () => {
    const r = collectImages([png(MAX_IMAGE_BYTES + 1024)]);
    assert.deepEqual(r.images, []);
    assert.match(r.notes[0], /too large/i);
    assert.match(r.notes[0], /MB/);
  });

  it(`keeps at most ${MAX_IMAGES} and says how many were left out`, () => {
    const blocks = Array.from({ length: MAX_IMAGES + 2 }, () => png());
    const r = collectImages(blocks);
    assert.equal(r.images.length, MAX_IMAGES);
    assert.match(r.notes[0], /2 more images/);
  });

  it("drops a block with no data", () => {
    const r = collectImages([{ type: "image", mimeType: "image/png" }]);
    assert.deepEqual(r.images, []);
    assert.equal(r.notes.length, 1);
  });

  it("handles a missing or non-array content list", () => {
    assert.deepEqual(collectImages(undefined), { images: [], notes: [] });
  });
});

describe("imagePlaceholder / describeResult", () => {
  it("names the type and a readable size", () => {
    assert.equal(
      imagePlaceholder({ data: b64(240 * 1024), mimeType: "image/png" }),
      "[image: image/png, 240 KB]",
    );
  });

  it("describeResult appends placeholders and notes to the text", () => {
    const out = describeResult({
      text: "done",
      images: [{ data: b64(2048), mimeType: "image/png" }],
      notes: ["1 more image left out"],
    });
    assert.equal(out, "done\n[image: image/png, 2 KB]\n1 more image left out");
  });

  it("describeResult of a text-only result is just the text", () => {
    assert.equal(describeResult({ text: "plain" }), "plain");
  });
});

describe("stripImagesForStorage", () => {
  it("replaces Anthropic image blocks inside tool_result content", () => {
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [
              { type: "text", text: "ok" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: b64(2048),
                },
              },
            ],
          },
        ],
      },
    ];
    const out = stripImagesForStorage(messages);
    assert.deepEqual(out[0].content[0].content, [
      { type: "text", text: "ok" },
      { type: "text", text: "[image: image/png, 2 KB]" },
    ]);
    // The live history keeps its image.
    assert.equal(messages[0].content[0].content[1].type, "image");
  });

  it("replaces OpenAI image_url data parts", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Images from fetch_image:" },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${b64(1024)}` },
          },
        ],
      },
    ];
    const out = stripImagesForStorage(messages);
    assert.deepEqual(out[0].content[1], {
      type: "text",
      text: "[image: image/jpeg, 1 KB]",
    });
  });

  it("leaves text-only history unchanged", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];
    assert.deepEqual(stripImagesForStorage(messages), messages);
  });
});

describe("imageRejectionMessage", () => {
  it("translates an API refusal of images into a plain message", () => {
    const msg = imageRejectionMessage(
      new Error(
        "400 Invalid content type: image_url is not supported by this model",
      ),
      "grok-3-mini",
    );
    assert.match(msg, /can't read images/);
    assert.match(msg, /grok-3-mini/);
  });

  it("returns null for errors unrelated to images", () => {
    assert.equal(imageRejectionMessage(new Error("rate limited"), "m"), null);
  });
});
