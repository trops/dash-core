/**
 * markedSpots.test.js — Mark a spot: the user's boxes on the running
 * preview, the picture the app takes of them, and how the Builder gets it
 * (see_marked_spots) — a fix is an edit to its own widget, never a rebuild.
 */
"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanMarks,
  captureMarks,
  rememberMarks,
  marksFor,
  markedSpotsResult,
  _forget,
} = require("./markedSpots");
const { roleToolsFor, handleRoleTool } = require("./roleTools");
const { buildRequest } = require("./planBuild");

const RECT = { x: 100.4, y: 200, width: 600, height: 440 };
const SPOT = { x: 10, y: 60, width: 300, height: 40 };

function fakeImage(width = 600) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height: 440 }),
    resize: ({ width: w }) => fakeImage(w),
    toPNG: () => Buffer.from(`png${width}`),
    toDataURL: () => `data:image/png;base64,thumb${width}`,
  };
}
function fakeWindow(result) {
  const calls = [];
  return {
    calls,
    capturePage: async (rect) => {
      calls.push(rect);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

afterEach(() => _forget());

describe("cleanMarks", () => {
  it("the preview's place, rounded; the boxes numbered from 1", () => {
    assert.deepEqual(
      cleanMarks({ rect: RECT, spots: [SPOT, { ...SPOT, y: 120 }] }),
      {
        rect: { x: 100, y: 200, width: 600, height: 440 },
        spots: [
          { n: 1, ...SPOT },
          { n: 2, ...SPOT, y: 120 },
        ],
      },
    );
  });
  it("nothing usable: no marks", () => {
    assert.equal(cleanMarks(null), null);
    assert.equal(cleanMarks({ rect: RECT, spots: [] }), null);
    assert.equal(cleanMarks({ rect: { x: 0 }, spots: [SPOT] }), null);
    assert.equal(
      cleanMarks({ rect: RECT, spots: [{ x: 1, y: 1, width: 0, height: 4 }] }),
      null,
    );
  });
  it("at most six boxes", () => {
    const many = Array.from({ length: 9 }, () => SPOT);
    assert.equal(cleanMarks({ rect: RECT, spots: many }).spots.length, 6);
  });
});

describe("captureMarks", () => {
  it("a picture of the preview, from the window that sent it, and a thumbnail", async () => {
    const wc = fakeWindow(fakeImage());
    const shot = await captureMarks(wc, { rect: RECT, spots: [SPOT] });
    assert.deepEqual(wc.calls, [{ x: 100, y: 200, width: 600, height: 440 }]);
    assert.deepEqual(shot.image, {
      data: Buffer.from("png600").toString("base64"),
      mimeType: "image/png",
    });
    assert.equal(shot.thumb, "data:image/png;base64,thumb120");
    assert.deepEqual(shot.spots, [{ n: 1, ...SPOT }]);
  });
  it("the app zoomed in: the area is the window's, not the page's", async () => {
    const wc = fakeWindow(fakeImage());
    wc.getZoomFactor = () => 1.25;
    const shot = await captureMarks(wc, { rect: RECT, spots: [SPOT] });
    assert.deepEqual(wc.calls, [{ x: 125, y: 250, width: 750, height: 550 }]);
    // Where the boxes are stays in the page's pixels.
    assert.deepEqual(shot.size, { width: 600, height: 440 });
  });
  it("a wide window's picture is made smaller for the model", async () => {
    const shot = await captureMarks(fakeWindow(fakeImage(2800)), {
      rect: RECT,
      spots: [SPOT],
    });
    assert.equal(shot.image.data, Buffer.from("png1400").toString("base64"));
  });
  it("when the picture fails, the boxes still go, and say why", async () => {
    const shot = await captureMarks(fakeWindow(new Error("gone")), {
      rect: RECT,
      spots: [SPOT],
    });
    assert.equal(shot.image, undefined);
    assert.equal(shot.spots.length, 1);
    assert.match(shot.error, /gone/);
  });
});

describe("see_marked_spots — the Builder looks at them", () => {
  it("the Builder has the tool; the other roles don't", () => {
    assert.ok(
      roleToolsFor("builder").some((t) => t.name === "see_marked_spots"),
    );
    for (const role of ["planner", "checker", "scout", "dashlead"]) {
      assert.ok(
        !roleToolsFor(role).some((t) => t.name === "see_marked_spots"),
        role,
      );
    }
  });

  it("the picture goes as an image, with where each box is", async () => {
    rememberMarks("draft:ShoppingLite", {
      image: { data: "abc", mimeType: "image/png" },
      spots: [{ n: 1, ...SPOT }],
      size: { width: 600, height: 440 },
    });
    // Found by the draft or the bare name.
    assert.ok(marksFor("ShoppingLite"));
    const r = await handleRoleTool(
      {},
      { botId: "b_builder", role: "builder" },
      "see_marked_spots",
      { widget: "draft:ShoppingLite" },
    );
    assert.equal(r.isError, false);
    assert.deepEqual(r.images, [{ data: "abc", mimeType: "image/png" }]);
    assert.match(r.text, /marked one spot/);
    assert.match(r.text, /Box 1 — 2% from the left, 14% from the top/);
  });

  it("nothing marked: work from the words", () => {
    const r = markedSpotsResult("draft:Other");
    assert.equal(r.images, undefined);
    assert.match(r.text, /No spots are marked/);
  });
});

describe("the Builder's request for a fix", () => {
  const plan = { summary: "A light shopping list", pieces: [] };
  const piece = { kind: "widget", name: "Shopping Lite", source: "new" };

  it("a change: only what was asked, in the code it wrote", () => {
    const text = buildRequest(plan, piece, {
      draft: "draft:ShoppingLite",
      change: true,
      problem: "Too much padding around the list items",
    });
    assert.match(text, /^Change the widget you wrote for this plan/);
    assert.match(text, /What to change: Too much padding/);
    assert.match(text, /Change only what the user asked for/);
    assert.doesNotMatch(text, /see_marked_spots/);
  });

  it("with marked spots: look at them first", () => {
    const text = buildRequest(plan, piece, {
      draft: "draft:ShoppingLite",
      change: true,
      problem: "Too much padding",
      marked: 2,
    });
    assert.match(
      text,
      /The user marked 2 spots on the running preview\. Look at them first: see_marked_spots with widget "draft:ShoppingLite"\./,
    );
  });

  it("a failed build's fix isn't told to keep things as they are", () => {
    const text = buildRequest(plan, piece, {
      draft: "draft:ShoppingLite",
      problem: "It didn't compile",
    });
    assert.match(text, /What went wrong: It didn't compile/);
    assert.doesNotMatch(text, /Change only what the user asked for/);
  });
});
