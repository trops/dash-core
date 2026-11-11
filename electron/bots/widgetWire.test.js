/**
 * widgetWire — a widget that shows what a bot sends (TD-009): the wire, the
 * Builder's and Checker's instructions, and the listener check.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  cleanWire,
  payloadField,
  wireBuildLines,
  wireCheckLines,
  wireProblems,
  withWireProblems,
} = require("./widgetWire");

const wire = cleanWire({
  botId: "bot_shop1",
  botName: "Shopping Helper",
  event: "completed",
  eventLabel: "Finishes a run",
  handlerName: "showShoppingHelperAnswer",
  ask: "Show each item with its picture and a link.",
});

const goodConfig = `export default { name: "ShoppingList", eventHandlers: ["showShoppingHelperAnswer"], events: [] };`;
const goodCode = `const { listen, listeners } = useWidgetEvents();
useEffect(() => { listen(listeners, { showShoppingHelperAnswer: (data) => setAnswer(data.message) }); }, [listeners, listen]);`;

describe("cleanWire", () => {
  it("keeps a good wire", () => {
    assert.equal(wire.botId, "bot_shop1");
    assert.equal(wire.handlerName, "showShoppingHelperAnswer");
    assert.equal(wire.eventLabel, "Finishes a run");
  });
  it("drops a bad bot id, event or listener name", () => {
    const base = { botId: "bot_a", event: "completed", handlerName: "showA" };
    assert.ok(cleanWire(base));
    assert.equal(cleanWire({ ...base, botId: "x" }), null);
    assert.equal(cleanWire({ ...base, event: "deleted" }), null);
    assert.equal(cleanWire({ ...base, handlerName: "show a; alert(1)" }), null);
    assert.equal(cleanWire(null), null);
  });
  it("takes results and tools", () => {
    const base = { botId: "bot_a", handlerName: "showA" };
    assert.ok(cleanWire({ ...base, event: "result.importantEmails" }));
    assert.ok(cleanWire({ ...base, event: "tool.gmail.search" }));
    assert.ok(cleanWire({ ...base, event: "failed" }));
  });
});

describe("the Builder's and Checker's lines", () => {
  it("say where the content is", () => {
    assert.match(payloadField("completed"), /message\.output/);
    assert.match(payloadField("failed"), /message\.error/);
    assert.match(payloadField("result.list"), /message\.items/);
    assert.match(payloadField("tool.gmail.search"), /message\.result/);
  });
  it("tell the Builder to read the real answers and use readBotAnswer", () => {
    const text = wireBuildLines(wire).join("\n");
    assert.match(text, /bot_answers with bot "bot_shop1"/);
    assert.match(text, /named exactly showShoppingHelperAnswer/);
    assert.match(text, /readBotAnswer/);
    assert.match(text, /show the text as it is/);
    assert.match(text, /replay: true/);
    assert.match(text, /Dash connects it after the user saves/);
    assert.match(text, /picture and a link/);
  });
  it("tell the Checker to try each answer", () => {
    const text = wireCheckLines(wire).join("\n");
    assert.match(text, /bot_answers \(bot "bot_shop1"\)/);
    assert.match(text, /for each one/);
  });
  it("a result is read with bot_results; a failure or a tool is plain text", () => {
    const result = cleanWire({ ...wire, event: "result.shoppingList" });
    const r = wireBuildLines(result).join("\n");
    assert.match(r, /bot_results gives its latest "shoppingList" result/);
    assert.doesNotMatch(r, /bot_answers/);
    assert.match(wireCheckLines(result).join("\n"), /bot_results/);
    const failed = cleanWire({ ...wire, event: "failed" });
    assert.match(
      wireBuildLines(failed).join("\n"),
      /nothing to read beforehand/,
    );
    assert.doesNotMatch(
      wireCheckLines(failed).join("\n"),
      /bot_answers|bot_results/,
    );
  });
  it("tells the Builder a long answer arrives truncated", () => {
    assert.match(wireBuildLines(wire).join("\n"), /…\[truncated\]/);
  });
  it("say nothing without a wire", () => {
    assert.deepEqual(wireBuildLines(null), []);
    assert.deepEqual(wireCheckLines(null), []);
  });
});

describe("wireProblems", () => {
  it("passes a widget that declares and listens", () => {
    assert.deepEqual(wireProblems(goodCode, goodConfig, wire), []);
  });
  it("fails when eventHandlers doesn't list it", () => {
    const p = wireProblems(
      goodCode,
      `export default { eventHandlers: [] };`,
      wire,
    );
    assert.equal(p.length, 1);
    assert.match(p[0], /eventHandlers/);
  });
  it("fails when it never listens, or listens with another name", () => {
    assert.match(
      wireProblems("const x = 1;", goodConfig, wire)[0],
      /never calls listen/,
    );
    assert.match(
      wireProblems(
        "listen(listeners, { other: () => {} });",
        goodConfig,
        wire,
      )[0],
      /not with a handler named/,
    );
  });
});

describe("withWireProblems", () => {
  it("adds the problems and keeps what the check result hides", () => {
    const res = {
      success: true,
      problems: ["old"],
      componentCode: "",
      configCode: "",
    };
    Object.defineProperty(res, "stamp", { value: 7 });
    const next = withWireProblems(res, wire);
    assert.equal(next.problems.length, 3);
    assert.equal(next.problems[0], "old");
    assert.equal(next.stamp, 7);
    assert.ok(!Object.keys(next).includes("stamp"));
    assert.deepEqual(res.problems, ["old"]);
  });
  it("leaves a good or failed check alone", () => {
    const good = {
      success: true,
      problems: [],
      componentCode: goodCode,
      configCode: goodConfig,
    };
    assert.equal(withWireProblems(good, wire), good);
    const failed = { success: false, error: "x" };
    assert.equal(withWireProblems(failed, wire), failed);
    assert.equal(withWireProblems(good, null), good);
  });
});
