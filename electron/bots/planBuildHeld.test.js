/**
 * planBuildHeld.test.js — a build held to what the user chose (held to your
 * choices): Dash checks each draft's code before the Checker; a mismatch
 * goes back to the Builder by itself until it matches, a fix that gets
 * nowhere starts afresh once, then it's the end of the line.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createPlanBuild, checkRequest, buildRequest } = require("./planBuild");

const plan = {
  summary: "Today's events",
  pieces: [
    {
      kind: "widget",
      name: "My Calendar Today",
      source: "new",
      providers: ["homeassistant"],
      provider: { homeassistant: "Home Assistant MCP" },
      reads: ["ha_config_get_calendar_events"],
      changes: [],
      settings: { daysAhead: 1 },
      chosen: true,
    },
    { kind: "layout", name: "Smart Home", source: "new" },
  ],
};

const config = (settings = 'daysAhead: { type: "number", defaultValue: 1 },') =>
  `export default { name: "MyCalendarToday", type: "widget", providers: [{ type: "homeassistant" }], userConfig: { ${settings} } };`;
const GOOD = 'callTool("ha_config_get_calendar_events", {});';
const WRITES = GOOD + ' callTool("ha_delete_event", {});';

/**
 * A build whose Builder writes each draft in turn from `drafts`
 * ([componentCode, configCode]); the Checker passes.
 */
function scripted(drafts, { builderSays = [] } = {}) {
  const requests = [];
  let n = 0;
  let current = null;
  const d = {
    requests,
    createDashboard: async (name) => ({ id: 1, name }),
    placeWidget: async (req) => ({ component: req.component || req.widget }),
    installBuilt: async (draft) => ({
      success: true,
      widgetName: String(draft).replace(/^draft:/, ""),
    }),
    askRole: async (role, request) => {
      requests.push([role, request]);
      if (role === "builder") {
        current = drafts[Math.min(n, drafts.length - 1)];
        n += 1;
        return {
          status: "completed",
          output: builderSays.shift() || "Built @ai-built/mycalendartoday.",
          builds: [
            {
              ok: true,
              package: "@ai-built/mycalendartoday",
              draft: "draft:MyCalendarToday",
            },
          ],
        };
      }
      return { status: "completed", output: "VERDICT: PASSED" };
    },
    draftCode: async () =>
      current ? { componentCode: current[0], configCode: current[1] } : null,
    now: () => "2026-11-13T00:00:00.000Z",
  };
  return d;
}
const roles = (d) => d.requests.map((r) => r[0]);
const step = (state, id) => state.steps.find((s) => s.id === id);

describe("held to your choices — the build", () => {
  it("a draft that matches: checked, then the Checker hears what matched", async () => {
    const d = scripted([[GOOD, config()]]);
    const state = await createPlanBuild(plan, d, { autoFix: true }).run();
    assert.equal(state.status, "done");
    assert.deepEqual(roles(d), ["builder", "checker"]);
    assert.match(
      d.requests[1][1],
      /Dash already checked these in the code, and they match: Reads from Home Assistant MCP; Only reads; Settings: Days ahead/,
    );
    const held = state.made[0].held;
    assert.ok(held.rows.every((r) => r.ok));
    assert.equal(held.fixed, undefined);
  });

  it("a mismatch goes back to the Builder, exactly, before the Checker runs", async () => {
    const d = scripted([
      [WRITES, config("")],
      [GOOD, config()],
    ]);
    const state = await createPlanBuild(plan, d, { autoFix: true }).run();
    assert.equal(state.status, "done");
    assert.deepEqual(roles(d), ["builder", "builder", "checker"]);
    const fix = d.requests[1][1];
    assert.match(
      fix,
      /It doesn't match what the user chose — change exactly these/,
    );
    assert.match(
      fix,
      /- It calls ha_delete_event, which changes things — the user chose: only reads/,
    );
    assert.match(fix, /- There is no “Days ahead” setting/);
    // Two things were fixed to match.
    assert.equal(state.made[0].held.fixed, 2);
    assert.equal(state.made[0].mismatch, undefined);
  });

  it("the same mismatch twice: a fresh start; again after that: the end of the line", async () => {
    const d = scripted([[WRITES, config()]]);
    const state = await createPlanBuild(plan, d, { autoFix: true }).run();
    const builds = d.requests.filter((r) => r[0] === "builder");
    // First try, a fix, then the fresh start — no Checker ever runs.
    assert.equal(builds.length, 3);
    assert.ok(!roles(d).includes("checker"));
    assert.match(builds[2][1], /Build this plan's widget again from the start/);
    const check = step(state, "check:0");
    assert.equal(check.status, "failed");
    assert.equal(check.canFix, false);
    assert.match(check.endOfLine.what, /ha_delete_event, which changes things/);
    assert.equal(check.endOfLine.closest, null);
    assert.equal(state.status, "finished-with-problems");
  });

  it("the Builder's own can't is the end of the line — with the closest that works", async () => {
    const d = scripted([[GOOD, config()]], {
      builderSays: [
        "CAN'T: all-day events have no time, so eventClicked can't carry one | CLOSEST: send them without a time",
      ],
    });
    const build = createPlanBuild(plan, d, { autoFix: true });
    let state = await build.run();
    const b = step(state, "build:0");
    assert.equal(b.status, "failed");
    assert.equal(b.canFix, false);
    assert.deepEqual(b.endOfLine, {
      what: "all-day events have no time, so eventClicked can't carry one",
      closest: "send them without a time",
    });
    assert.equal(roles(d).length, 1, "no fix tried by itself");
    // The user takes the closest: built that way, checked, done.
    state = await build.settle("build:0");
    assert.equal(state.status, "done");
    assert.match(
      d.requests[1][1],
      /The user agreed to the closest that works: send them without a time/,
    );
  });

  it("a can't about Dash's own tools isn't the end of the line — the Builder tries again", async () => {
    const d = scripted([[GOOD, config()]], {
      builderSays: [
        "CAN'T: change draft:MyCalendarToday, because its existing code can't be read by read_widget or found on disk | CLOSEST: once the widget is readable, I'll make a wrap-only update.",
      ],
    });
    const state = await createPlanBuild(plan, d, { autoFix: true }).run();
    assert.equal(state.status, "done");
    assert.deepEqual(roles(d), ["builder", "builder", "checker"]);
    assert.equal(step(state, "build:0").endOfLine, undefined);
  });

  it("each step keeps which model ran it, its style and how long it took", async () => {
    const d = scripted([[GOOD, config()]]);
    const ask = d.askRole;
    d.askRole = async (role, request) => ({
      ...(await ask(role, request)),
      model: role === "builder" ? "claude-opus-5-5" : "claude-sonnet-5-5",
      style: role === "builder" ? "thorough" : null,
      modelChosen: role === "builder",
      startedAt: "2026-11-13T10:00:00.000Z",
      endedAt: "2026-11-13T10:02:14.000Z",
    });
    const state = await createPlanBuild(plan, d, { autoFix: true }).run();
    const b = step(state, "build:0");
    assert.equal(b.model, "claude-opus-5-5");
    assert.equal(b.style, "thorough");
    assert.equal(b.modelChosen, true);
    assert.equal(b.tookMs, 134000);
    const c = step(state, "check:0");
    assert.equal(c.model, "claude-sonnet-5-5");
    assert.equal(c.style, null);
    assert.equal(c.modelChosen, false);
  });

  it("settling a mismatch stops holding it against the widget", async () => {
    const d = scripted([[WRITES, config()]]);
    const build = createPlanBuild(plan, d, { autoFix: true });
    let state = await build.run();
    const check = step(state, "check:0");
    check.endOfLine.closest = "read with ha_delete_event's sibling";
    state = await build.settle("check:0");
    assert.equal(state.status, "done");
  });

  it("nothing to settle is said so", async () => {
    const d = scripted([[GOOD, config()]]);
    const build = createPlanBuild(plan, d, { autoFix: true });
    await build.run();
    const res = await build.settle("check:0");
    assert.match(res.error, /nothing closer/);
  });

  it("while the Builder builds, build_widget can hold each draft to the choices", async () => {
    const d = scripted([[GOOD, config()]]);
    const held = [];
    let during = null;
    let released = 0;
    d.holdBuilder = (fn) => {
      held.push(fn);
      return () => {
        released += 1;
      };
    };
    const ask = d.askRole;
    d.askRole = async (role, r) => {
      if (role === "builder") {
        during = held[held.length - 1]({
          componentCode: WRITES,
          configCode: config(),
        });
      }
      return ask(role, r);
    };
    await createPlanBuild(plan, d, { autoFix: true }).run();
    assert.equal(typeof held[0], "function");
    assert.equal(released, held.length, "let go once it's built");
    assert.deepEqual(
      during.map((p) => p.main),
      ["It calls ha_delete_event, which changes things"],
    );
  });

  it("a plan the user didn't choose step by step: the Checker alone, as before", async () => {
    const d = scripted([[WRITES, config()]]);
    let asked = false;
    d.holdBuilder = () => {
      asked = true;
    };
    const unchosen = {
      ...plan,
      pieces: [{ ...plan.pieces[0], chosen: undefined }, plan.pieces[1]],
    };
    const state = await createPlanBuild(unchosen, d, { autoFix: true }).run();
    assert.equal(state.status, "done");
    assert.deepEqual(roles(d), ["builder", "checker"]);
    assert.equal(asked, false);
    assert.equal(state.made[0].held, undefined);
  });

  it("after the closest that works, what's still off is excused", async () => {
    const d = scripted(
      [
        [GOOD, config()],
        [WRITES, config()],
      ],
      {
        builderSays: ["CAN'T: x | CLOSEST: call ha_delete_event to tidy up"],
      },
    );
    const build = createPlanBuild(plan, d, { autoFix: true });
    await build.run();
    const state = await build.settle("build:0");
    assert.equal(state.status, "done");
    assert.deepEqual(state.waived[0], [
      "It calls ha_delete_event, which changes things",
    ]);
  });

  it("a mismatch fixed, then back after a pass: not a fix that got nowhere", async () => {
    const d = scripted([
      [WRITES, config()],
      [GOOD, config()],
      [WRITES, config()],
      [GOOD, config()],
    ]);
    const build = createPlanBuild(plan, d, { autoFix: true });
    const state = await build.run();
    assert.equal(state.status, "done");
    assert.deepEqual(state.mismatches[0], []);
    assert.equal(state.fresh[0], undefined);
  });

  it("no draft code here: the Checker alone, as before", async () => {
    const d = scripted([[WRITES, config()]]);
    delete d.draftCode;
    const state = await createPlanBuild(plan, d, { autoFix: true }).run();
    assert.equal(state.status, "done");
    assert.deepEqual(roles(d), ["builder", "checker"]);
  });
});

describe("held to your choices — what the roles are told", () => {
  it("the Builder is told to say CAN'T rather than fake it", () => {
    assert.match(
      buildRequest(plan, plan.pieces[0]),
      /CAN'T: <what and why> \| CLOSEST:/,
    );
  });
  it("the Checker hears which tools Dash couldn't tell about", () => {
    const r = checkRequest(
      plan,
      plan.pieces[0],
      { draft: "draft:X" },
      {
        held: { rows: [], unsure: ["ha_call_service"] },
      },
    );
    assert.match(r, /Dash couldn't tell whether ha_call_service only reads/);
  });
});
