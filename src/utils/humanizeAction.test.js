/**
 * humanizeAction.test.js
 *
 * Pin for the action verb humanizer. Maps internal `(domain, action)`
 * names like `("fs", "saveData")` to user-readable verbs ("save").
 * Used in the JIT consent modal and pre-flight permissions modal so
 * regular users see plain language, not engineering jargon.
 */
import { humanizeAction } from "./humanizeAction";

describe("humanizeAction — fs domain", () => {
  test("saveData → 'save changes to a file'", () => {
    expect(humanizeAction("fs", "saveData")).toBe("save changes to a file");
  });

  test("readData → 'read a file'", () => {
    expect(humanizeAction("fs", "readData")).toBe("read a file");
  });

  test("readFromFile → 'read a file' (alias of readData)", () => {
    expect(humanizeAction("fs", "readFromFile")).toBe("read a file");
  });

  test("saveToFile → 'save changes to a file' (alias of saveData)", () => {
    expect(humanizeAction("fs", "saveToFile")).toBe("save changes to a file");
  });

  test("transformFile → 'transform a file'", () => {
    expect(humanizeAction("fs", "transformFile")).toBe("transform a file");
  });

  test("readDataFromURL → 'fetch from a URL and save to a file'", () => {
    expect(humanizeAction("fs", "readDataFromURL")).toBe(
      "fetch from a URL and save to a file",
    );
  });
});

describe("humanizeAction — network domain", () => {
  test("readDataFromURL → 'fetch from a URL'", () => {
    expect(humanizeAction("network", "readDataFromURL")).toBe(
      "fetch from a URL",
    );
  });

  test("connect → 'open a websocket connection'", () => {
    expect(humanizeAction("network", "connect")).toBe(
      "open a websocket connection",
    );
  });
});

describe("humanizeAction — mcp domain", () => {
  test("callTool → 'use the' (caller pairs with tool name)", () => {
    expect(humanizeAction("mcp", "callTool")).toBe("use the");
  });
});

describe("humanizeAction — fallback", () => {
  test("unknown action → returns the raw action verb (defensive)", () => {
    expect(humanizeAction("fs", "exoticNewAction")).toBe("exoticNewAction");
  });

  test("unknown domain → returns the raw action verb", () => {
    expect(humanizeAction("plasma", "saveData")).toBe("saveData");
  });

  test("non-string inputs → returns empty string", () => {
    expect(humanizeAction(null, null)).toBe("");
    expect(humanizeAction("fs", undefined)).toBe("");
  });
});
