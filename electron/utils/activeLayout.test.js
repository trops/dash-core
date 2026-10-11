/**
 * activeLayout.test.js — which layout a tool reads and writes (CRE-011 3c).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  shownPage,
  resolvePage,
  layoutOf,
  withLayout,
  allLayouts,
} = require("./activeLayout");

const paged = () => ({
  activePageId: "b",
  pages: [
    { id: "a", name: "Home", layout: [{ id: 1, component: "A" }] },
    { id: "b", name: "Second", layout: [{ id: 1, component: "B" }] },
  ],
  layout: [{ id: 1, component: "stale" }],
});

describe("activeLayout", () => {
  it("no pages: the top-level layout", () => {
    const ws = { layout: [{ id: 1, component: "X" }] };
    assert.equal(shownPage(ws), null);
    assert.equal(layoutOf(ws).layout[0].component, "X");
    withLayout(ws, [{ id: 2 }], null);
    assert.deepEqual(ws.layout, [{ id: 2 }]);
    assert.match(resolvePage(ws, "Home").error, /no pages/);
  });

  it("pages: the shown page (activePageId, else the first)", () => {
    const ws = paged();
    assert.equal(layoutOf(ws).layout[0].component, "B");
    delete ws.activePageId;
    assert.equal(layoutOf(ws).layout[0].component, "A");
  });

  it("a page by id or name, any case; unknown pages are an error", () => {
    const ws = paged();
    assert.equal(layoutOf(ws, "a").page.name, "Home");
    assert.equal(layoutOf(ws, "home").page.id, "a");
    const bad = layoutOf(ws, "Nope");
    assert.match(bad.error, /No page "Nope". Pages: Home, Second/);
  });

  it("writing the shown page updates the mirror; another page leaves it", () => {
    const ws = paged();
    const shown = layoutOf(ws);
    withLayout(ws, [...shown.layout, { id: 2, component: "C" }], shown.page);
    assert.deepEqual(ws.layout, ws.pages[1].layout);
    assert.notEqual(ws.layout, ws.pages[1].layout); // a copy, not shared
    const home = layoutOf(ws, "Home");
    withLayout(ws, [...home.layout, { id: 3, component: "D" }], home.page);
    assert.equal(ws.pages[0].layout.length, 2);
    assert.ok(!ws.layout.some((i) => i.component === "D"));
  });

  it("allLayouts: each page's, or the one", () => {
    assert.equal(allLayouts(paged()).length, 2);
    assert.equal(allLayouts({ layout: [] }).length, 1);
  });
});
