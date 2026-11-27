import { placeMenu } from "./menuPlacement";

const bounds = { left: 0, top: 0, right: 1000, bottom: 800 };
const menu = { width: 224, height: 160 };
const at = (left, top = 100, w = 40, h = 32) => ({
  left,
  right: left + w,
  top,
  bottom: top + h,
});

describe("placeMenu", () => {
  test("keeps the preferred right edge when the menu fits growing left", () => {
    expect(placeMenu({ anchor: at(600), menu, bounds })).toEqual({
      align: "right",
      direction: "down",
    });
  });

  test("flips to the left edge near the left of the window", () => {
    // Button at x=120: lined up right, the menu would start at -64.
    expect(placeMenu({ anchor: at(120), menu, bounds }).align).toBe("left");
  });

  test("a clipping container's edge counts, not just the window's", () => {
    const clipped = { ...bounds, left: 56 }; // under a 56px sidebar
    expect(placeMenu({ anchor: at(220), menu, bounds: clipped }).align).toBe(
      "left",
    );
    expect(placeMenu({ anchor: at(260), menu, bounds: clipped }).align).toBe(
      "right",
    );
  });

  test("prefer left: flips to the right edge near the right of the window", () => {
    expect(
      placeMenu({ anchor: at(900), menu, bounds, prefer: "left" }).align,
    ).toBe("right");
    expect(
      placeMenu({ anchor: at(100), menu, bounds, prefer: "left" }).align,
    ).toBe("left");
  });

  test("fits on neither side: takes the side with more room", () => {
    const narrow = { left: 0, top: 0, right: 300, bottom: 800 };
    expect(placeMenu({ anchor: at(60), menu, bounds: narrow }).align).toBe(
      "left",
    );
    expect(placeMenu({ anchor: at(200), menu, bounds: narrow }).align).toBe(
      "right",
    );
  });

  test("opens up when there's no room below but room above", () => {
    expect(placeMenu({ anchor: at(600, 700), menu, bounds }).direction).toBe(
      "up",
    );
    expect(placeMenu({ anchor: at(600, 20), menu, bounds }).direction).toBe(
      "down",
    );
  });

  test("no measurements: the preferred side, opening down", () => {
    expect(placeMenu({ anchor: null, menu, bounds })).toEqual({
      align: "right",
      direction: "down",
    });
    expect(placeMenu({ prefer: "left" })).toEqual({
      align: "left",
      direction: "down",
    });
  });
});
