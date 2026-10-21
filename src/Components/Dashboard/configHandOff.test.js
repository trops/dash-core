import { findWidgetForHandOff } from "./configHandOff";

const hits = { id: 5, uuid: "7-hits-5", component: "trops.algolia.Hits" };
const box = { id: 4, uuid: "7-box-4", component: "trops.algolia.Box" };
const notes = { id: 9, uuid: "7-notes-9", component: "ai-built.notes.Notes" };

describe("findWidgetForHandOff", () => {
  const paged = {
    id: 7,
    pages: [
      { id: "p1", layout: [box] },
      { id: "p2", layout: [hits] },
    ],
    sidebarLayout: [notes],
  };

  test("by uuid: its page and scope", () => {
    const found = findWidgetForHandOff(paged, { uuid: "7-hits-5" });
    expect(found.item).toBe(hits);
    expect(found.pageId).toBe("p2");
    expect(found.scope).toBe("main");
    expect(found.layout).toBe(paged.pages[1].layout);
  });

  test("by component and layout id (the Listeners map)", () => {
    const found = findWidgetForHandOff(paged, {
      component: "trops.algolia.Box",
      itemId: "4",
    });
    expect(found.item).toBe(box);
    expect(found.pageId).toBe("p1");
  });

  test("in the pinned sidebar", () => {
    const found = findWidgetForHandOff(paged, { uuid: "7-notes-9" });
    expect(found.scope).toBe("sidebar");
    expect(found.pageId).toBeNull();
  });

  test("a dashboard without pages", () => {
    const found = findWidgetForHandOff(
      { id: 7, layout: [hits] },
      { uuid: "7-hits-5" },
    );
    expect(found.item).toBe(hits);
    expect(found.pageId).toBeNull();
  });

  test("not there, or nothing asked: null", () => {
    expect(findWidgetForHandOff(paged, { uuid: "nope" })).toBeNull();
    expect(findWidgetForHandOff(paged, null)).toBeNull();
    expect(findWidgetForHandOff(null, { uuid: "7-hits-5" })).toBeNull();
  });
});
