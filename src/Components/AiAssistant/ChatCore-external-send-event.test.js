/**
 * ChatCore — external send-event listener (slice 19H).
 *
 * Static source inspection (same pattern as ChatCore-no-end-session
 * and ChatCore-lockdown-props). Asserts ChatCore subscribes to the
 * `dash:chat-core-send` window CustomEvent, key-scopes the handler
 * to its own persistKey/sessionKey/uuid, and calls handleSend on
 * matching events.
 *
 * Why static rather than RTL: a behavior test would have to mock the
 * entire mainApi.llm stream API to verify handleSend actually runs.
 * The static check catches the regression that matters: the
 * subscription itself going missing (which is what made the widget
 * builder's "Send error to AI" silently no-op for months).
 */
const fs = require("fs");
const path = require("path");

describe("ChatCore — external dash:chat-core-send listener", () => {
  const source = fs.readFileSync(path.join(__dirname, "ChatCore.js"), "utf8");

  test("subscribes to window dash:chat-core-send", () => {
    expect(source).toMatch(/addEventListener\(\s*["']dash:chat-core-send["']/);
  });

  test("removes the listener on unmount (cleanup matched)", () => {
    expect(source).toMatch(
      /removeEventListener\(\s*["']dash:chat-core-send["']/,
    );
  });

  test("calls handleSend in the listener body", () => {
    // The handler body must invoke handleSend(content, ...) — if a
    // future refactor removes that call, externally-dispatched
    // events would queue silently. Anchor BEFORE the
    // addEventListener call rather than the comment block (comments
    // can drift in length).
    const idx = source.search(
      /addEventListener\(\s*["']dash:chat-core-send["']/,
    );
    expect(idx).toBeGreaterThan(-1);
    // Walk backwards up to ~3000 chars to find the listener function
    // body — the addEventListener call sits AFTER the function.
    const window = source.slice(Math.max(0, idx - 3000), idx);
    expect(window).toMatch(/handleSend\(/);
  });

  test("key-scopes the handler (persistKey OR sessionKey OR uuid)", () => {
    // Each ChatCore instance only reacts to events for its own key,
    // so AssistantPanel chat and the widget builder chat don't cross-
    // talk. The handler must reference at least one of persistKey /
    // sessionKey / uuid in the listener body.
    const idx = source.search(
      /addEventListener\(\s*["']dash:chat-core-send["']/,
    );
    const window = source.slice(Math.max(0, idx - 3000), idx);
    expect(window).toMatch(/(persistKey|sessionKey|uuid)/);
  });
});
