/**
 * ChatCore — End Session button removal regression guard.
 *
 * Static source-presence test. Asserts:
 *   1. `ChatCore.js` source contains no `handleEndSession` function.
 *   2. `ChatCore.js` source contains no rendered "End Session" UI text.
 *   3. `ChatCore.js` still renders a "New Chat" button (regression
 *      protection — we removed End Session, but New Chat must stay
 *      as the sole reset action).
 *
 * Why static rather than RTL: a full RTL test would have to mock
 * dash-react's `SubHeading2` export and the full mainApi.llm
 * listener surface (onStreamStart/Delta/End/Error/ToolUse/...).
 * That mocking footprint is out of scope for this PLAN. The static
 * check is sufficient — if "End Session" reappears in source, this
 * test fails immediately.
 */
const fs = require("fs");
const path = require("path");

describe("ChatCore — End Session button removal", () => {
  const source = fs.readFileSync(path.join(__dirname, "ChatCore.js"), "utf8");

  test("no handleEndSession function in source", () => {
    expect(source).not.toMatch(/handleEndSession/);
  });

  test("no rendered 'End Session' UI text in source", () => {
    // Match the JSX text node form to avoid false positives on a
    // hypothetical comment containing the words "End Session".
    expect(source).not.toMatch(/>\s*End Session\s*</);
  });

  test("New Chat button still rendered (regression guard)", () => {
    expect(source).toMatch(/>\s*New Chat\s*</);
  });
});
