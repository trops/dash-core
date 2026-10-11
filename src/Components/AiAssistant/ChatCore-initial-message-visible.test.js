/**
 * ChatCore — initialMessageHidden (create-entry phase 2a).
 *
 * A greeting auto-sent on mount stays hidden (the default), but the Create
 * screen hands the Widget Builder the user's own prompt, which must show in
 * the chat as what they asked for. Static source pins, like the other
 * ChatCore tests (a behavior test would need the whole mainApi.llm stream).
 */
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "ChatCore.js"), "utf8");

describe("ChatCore — initialMessageHidden", () => {
  test("defaults to hidden", () => {
    expect(source).toMatch(/initialMessageHidden = true,/);
  });

  test("the auto-send uses it (only an explicit false shows the message)", () => {
    expect(source).toMatch(
      /handleSend\(initialMessage, \{ hidden: initialMessageHidden !== false \}\)/,
    );
  });
});
