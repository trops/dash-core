/**
 * specChecks.test.js — a draft held to what the user chose (held to your
 * choices): each choice a row, each mismatch said plainly.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  specCheck,
  toolCalls,
  mismatchText,
  mismatchKey,
  cantOf,
} = require("./specChecks");

const piece = {
  name: "My Calendar Today",
  providers: ["homeassistant"],
  provider: { homeassistant: "Home Assistant MCP" },
  reads: ["ha_config_get_calendar_events"],
  changes: [],
  settings: { calendar: "calendar.family", daysAhead: 1 },
  whenEmpty: "Nothing on today",
  look: { id: "list" },
  refresh: "Every hour",
};

const config = (extra = "") => `export default {
  name: "MyCalendarToday",
  type: "widget",
  providers: [{ type: "homeassistant", providerClass: "mcp", required: true }],
  userConfig: {
    calendar: { type: "text", defaultValue: "calendar.family" },
    daysAhead: { type: "number", defaultValue: 1 },
  },
  events: ["eventClicked"],
  ${extra}
};`;

const component = (body = "") => `
import { PanelHeader, EmptyState } from "@trops/dash-react";
export default function W() {
  // callTool("ha_delete_event") in a comment is not a call
  useEffect(() => { const t = setInterval(load, 3600000); return () => clearInterval(t); }, []);
  const load = () => callTool("ha_config_get_calendar_events", { calendar });
  const click = (e) => publishEvent("eventClicked", e);
  ${body}
  return items.length ? <PanelHeader title="Today" /> : <EmptyState title="Nothing on today" />;
}`;

const run = (p = piece, code = {}, ctx = { events: ["eventClicked"] }) =>
  specCheck(
    p,
    { componentCode: component(), configCode: config(), ...code },
    ctx,
  );

describe("specCheck — a draft that matches", () => {
  it("every choice is a passed row; nothing to fix", () => {
    const r = run();
    assert.deepEqual(r.problems, []);
    assert.ok(r.rows.length >= 7);
    assert.ok(
      r.rows.every((x) => x.ok),
      JSON.stringify(r.rows),
    );
    assert.ok(r.rows.some((x) => x.main === "Only reads"));
    assert.ok(r.rows.some((x) => x.main === "Looks: List"));
  });
  it("a tool named in a comment isn't a call", () => {
    assert.deepEqual(toolCalls(component()), ["ha_config_get_calendar_events"]);
  });
});

describe("specCheck — what it may change with", () => {
  it("a call that changes things, when the user chose only reads", () => {
    const r = run(piece, {
      componentCode: component('callTool("ha_delete_event", { entity });'),
    });
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0].main, /ha_delete_event, which changes things/);
    assert.match(r.problems[0].chose, /only reads/);
  });
  it("a chosen change is fine", () => {
    const r = run(
      { ...piece, changes: ["ha_delete_event"] },
      { componentCode: component('callTool("ha_delete_event", { entity });') },
    );
    assert.deepEqual(r.problems, []);
  });
  it("a tool Dash can't tell about is left to the Checker", () => {
    const r = run(piece, {
      componentCode: component('callTool("ha_call_service", {});'),
    });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.unsure, ["ha_call_service"]);
  });
  it("the provider's own read-only flag wins over the name", () => {
    const r = run(
      piece,
      { componentCode: component('callTool("ha_call_service", {});') },
      {
        events: ["eventClicked"],
        live: [
          { name: "ha_call_service", annotations: { readOnlyHint: false } },
        ],
      },
    );
    assert.equal(r.problems.length, 1);
  });
  it("a tool it reads with is never held as a change", () => {
    const r = run(
      { ...piece, reads: ["ha_call_service"] },
      { componentCode: component('callTool("ha_call_service", {});') },
      {
        events: ["eventClicked"],
        live: [
          { name: "ha_call_service", annotations: { readOnlyHint: false } },
        ],
      },
    );
    assert.deepEqual(r.problems, []);
  });
});

describe("specCheck — settings, events, provider, looks", () => {
  it("a missing setting and one starting elsewhere", () => {
    const r = run(piece, {
      configCode: config()
        .replace(/daysAhead: \{[^}]*\},/, "")
        .replace(
          'defaultValue: "calendar.family"',
          'defaultValue: "calendar.work"',
        ),
    });
    const mains = r.problems.map((x) => x.main);
    assert.ok(
      mains.some((m) => /no “Days ahead” setting/.test(m)),
      mains,
    );
    assert.ok(
      mains.some((m) => /“Calendar” starts at "calendar.work"/.test(m)),
      mains,
    );
  });
  it("an event never sent, or not listed", () => {
    const r = run(
      piece,
      {
        configCode: config().replace('events: ["eventClicked"]', "events: []"),
      },
      { events: ["eventClicked", "eventStartingSoon"] },
    );
    const mains = r.problems.map((x) => x.main);
    assert.ok(mains.includes("eventClicked isn't listed in its events"));
    assert.ok(mains.includes("It never sends eventStartingSoon"));
  });
  it("Dash's own events are never asked for", () => {
    const r = run(piece, {}, { events: ["eventClicked", "readComplete"] });
    assert.deepEqual(r.problems, []);
  });
  it("its provider isn't declared", () => {
    const r = run(piece, {
      configCode: config().replace(
        'type: "homeassistant"',
        'type: "google-calendar"',
      ),
    });
    assert.match(
      r.problems[0].main,
      /isn't set up to use your Home Assistant MCP connection/,
    );
  });
  it("empty words, look parts and the timer", () => {
    const r = run(piece, {
      componentCode:
        'export default () => { callTool("ha_config_get_calendar_events"); publishEvent("eventClicked"); return null; }',
    });
    const mains = r.problems.map((x) => x.main);
    assert.ok(mains.some((m) => /doesn't say “Nothing on today”/.test(m)));
    assert.ok(mains.includes("It doesn't use dash-react's PanelHeader"));
    assert.ok(mains.includes("It doesn't use dash-react's EmptyState"));
    assert.ok(mains.includes("It never reads again by itself"));
  });
  it("a listener's handler", () => {
    const p = {
      ...piece,
      listens: [
        { bot: "Morning Brief", result: "summary", handler: "onSummary" },
      ],
    };
    assert.match(run(p).problems[0].main, /handler onSummary/);
    const ok = run(p, { configCode: config('eventHandlers: ["onSummary"],') });
    assert.deepEqual(ok.problems, []);
  });
  it("only what was chosen is checked", () => {
    const r = specCheck(
      { name: "X" },
      { componentCode: "x", configCode: "export default {}" },
    );
    assert.deepEqual(r, { rows: [], problems: [], unsure: [] });
  });
  it("an unreadable config holds only what the code settles", () => {
    const r = run(piece, { configCode: "not a config" });
    assert.ok(!r.rows.some((x) => /^Settings/.test(x.main)));
    assert.ok(r.rows.some((x) => x.main === "Only reads"));
  });
});

describe("mismatch text, key, and the Builder's can't", () => {
  it("one line each; the same set in any order is one key", () => {
    const a = [
      { main: "B", chose: "b" },
      { main: "A", chose: "a" },
    ];
    assert.equal(
      mismatchText(a),
      "- B — the user chose: b\n- A — the user chose: a",
    );
    assert.equal(mismatchKey(a), mismatchKey([...a].reverse()));
  });
  it("CAN'T and CLOSEST", () => {
    assert.deepEqual(
      cantOf(
        "Tried.\nCAN'T: all-day events have no time | CLOSEST: show them without a time",
      ),
      {
        what: "all-day events have no time",
        closest: "show them without a time",
      },
    );
    assert.deepEqual(cantOf("CAN’T: no tool reads it"), {
      what: "no tool reads it",
      closest: null,
    });
    assert.equal(cantOf("all good"), null);
  });
});

// Found in review: what a correct widget writes is never a mismatch.
describe("specCheck — never a false mismatch", () => {
  it("useScheduler with scheduledTasks, or a setTimeout loop, reads again", () => {
    const sched = run(piece, {
      componentCode: component().replace(
        /setInterval\(load, 3600000\)/,
        "useScheduler(load)",
      ),
    });
    assert.deepEqual(sched.problems, []);
    const cfg = run(piece, {
      componentCode: component().replace(/setInterval/g, "nothing"),
      configCode: config('scheduledTasks: [{ every: "1h" }],'),
    });
    assert.deepEqual(cfg.problems, []);
  });
  it("Header: None needs no PanelHeader; no mark needs no StatusBadge", () => {
    const r = run(
      {
        ...piece,
        look: { id: "next", options: { header: "None", markFirst: "Off" } },
      },
      {
        componentCode:
          'export default () => { setInterval(x, 1); callTool("ha_config_get_calendar_events"); publishEvent("eventClicked"); return "Nothing on today"; }',
      },
    );
    assert.deepEqual(r.problems, []);
  });
  it("a glob or // in a string isn't a comment", () => {
    const r = run(piece, {
      componentCode:
        component('const glob = "**/*.md"; const u = "a // b";') +
        "\n/* later */",
    });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(
      toolCalls(
        'const g = "**/*.md"; callTool("ha_x"); /* callTool("ha_y") */',
      ),
      ["ha_x"],
    );
  });
  it('JSX entities and {" "} joins read as the words', () => {
    const words = { ...piece, whenEmpty: "There's nothing here today" };
    const r = run(words, {
      componentCode:
        component().replace('"Nothing on today"', '"x"') +
        '\nconst e = <p>There&apos;s nothing here{" "}today</p>;',
    });
    assert.ok(
      !r.problems.some((p) => /doesn't say/.test(p.main)),
      JSON.stringify(r.problems),
    );
  });
  it("CAN'T only as its own line, in capitals", () => {
    assert.equal(cantOf("Significant: none"), null);
    assert.equal(cantOf("Applicant: x"), null);
    assert.equal(cantOf("we can't: x"), null);
    assert.deepEqual(cantOf("Done.\nCAN'T: x\nCLOSEST: y"), {
      what: "x",
      closest: "y",
    });
  });

  it("no trailing full stop — the screen adds its own", () => {
    assert.deepEqual(cantOf("CAN'T: no tool. | CLOSEST: a wrap-only update."), {
      what: "no tool",
      closest: "a wrap-only update",
    });
  });
});
