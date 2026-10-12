/**
 * planBuildRecovery.test.js — what happens after a plan build's step fails
 * or waits (create-entry CRE-004 AC4/AC5, phase 4d-3): Let Builder fix it,
 * Try again, waiting for a provider, and an edited plan reusing what an
 * earlier build made.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createPlanBuild,
  buildRequest,
  planBotDefinition,
  builtSummary,
  checkRequest,
  eventsToSend,
  MAX_FIXES,
} = require("./planBuild");

const plan = {
  summary: "Ask",
  pieces: [
    {
      kind: "widget",
      name: "Calendar",
      source: "registry",
      package: "@trops/google-calendar",
    },
    { kind: "widget", name: "Ask button", source: "new", events: ["ask"] },
    {
      kind: "bot",
      name: "Greeter",
      source: "new",
      instructions: "Greet.",
      tools: [{ provider: "gmail", tools: [] }],
      on: [{ widget: "Ask button", event: "ask" }],
      showResults: true,
    },
    { kind: "layout", name: "Ask Test", source: "new" },
  ],
};

const by = (state) => Object.fromEntries(state.steps.map((s) => [s.id, s]));

function deps(over = {}) {
  const calls = [];
  const d = {
    calls,
    verdicts: [],
    installWidget: async (pkg) => {
      calls.push(["install", pkg]);
      return { component: "trops.google-calendar.Calendar" };
    },
    createDashboard: async (name) => {
      calls.push(["dashboard", name]);
      return { id: 77, name };
    },
    askRole: async (role, request) => {
      calls.push([role, request]);
      if (role === "builder") {
        return {
          status: "completed",
          output: "Built @ai-built/askbutton",
          usage: { inputTokens: 100 },
        };
      }
      const v = d.verdicts.length ? d.verdicts.shift() : "PASSED";
      return {
        status: "completed",
        output: `notes\nVERDICT: ${v}`,
        usage: { inputTokens: 10 },
      };
    },
    placeWidget: async (req) => {
      calls.push(["place", req.component || req.widget]);
      return {
        component: req.component || "ai-built.askbutton.AskButton",
        widgetId: req.component ? 1 : 2,
      };
    },
    saveBot: async ({ piece, botId }) => {
      calls.push(["saveBot", piece.name, botId || null]);
      return { id: botId || "bot_1", name: piece.name };
    },
    placeBotResults: async ({ botId }) => {
      calls.push(["results", botId]);
      return { component: "dash.bots.BotResults", widgetId: 3 };
    },
    wireTrigger: async (req) => calls.push(["trigger", req.event]),
    wireListener: async () => calls.push(["listen"]),
    now: () => "2026-10-12T00:00:00.000Z",
    ...over,
  };
  return d;
}

const count = (d, kind) => d.calls.filter((c) => c[0] === kind).length;

describe("Let Builder fix it (CRE-004 AC4)", () => {
  it("a failed check offers a fix; the Builder updates the widget with the Checker's notes", async () => {
    const d = deps();
    d.verdicts.push("FAILED");
    const build = createPlanBuild(plan, d);
    let state = await build.run();
    let s = by(state);
    assert.equal(state.status, "finished-with-problems");
    assert.equal(s["check:1"].canFix, true);
    assert.equal(s["check:1"].fixesLeft, MAX_FIXES);
    assert.equal(s["place:1"].status, "skipped");

    state = await build.fix("check:1");
    s = by(state);
    assert.equal(state.status, "done");
    const fixReq = d.calls.filter((c) => c[0] === "builder")[1][1];
    assert.match(fixReq, /^Fix the widget @ai-built\/askbutton you built/);
    assert.match(fixReq, /The Checker said:\nnotes\nVERDICT: FAILED/);
    assert.match(fixReq, /build_widget with update: true/);
    assert.equal(state.fixes[1], 1);
    // Finished steps aren't run again.
    assert.equal(count(d, "install"), 1);
    assert.equal(count(d, "dashboard"), 1);
    assert.equal(count(d, "place"), 2);
    // Every try's tokens count.
    assert.equal(s["build:1"].tokens, 200);
    assert.equal(state.totals.tokens, 200 + 20);
  });

  it("at most twice per widget, then it's over to the user", async () => {
    const d = deps();
    d.verdicts.push("FAILED", "FAILED", "FAILED");
    const build = createPlanBuild(plan, d);
    await build.run();
    await build.fix("check:1");
    const state = await build.fix("check:1");
    const s = by(state);
    assert.equal(s["check:1"].status, "failed");
    assert.equal(s["check:1"].canFix, false);
    assert.equal(s["check:1"].fixesLeft, 0);
    assert.equal(s["check:1"].fixesUsedUp, true);
    const res = await build.fix("check:1");
    assert.match(res.error, /can't fix/);
  });

  it("a wiring failure is fixed by the Builder, then only that wiring runs again", async () => {
    let tries = 0;
    const d = deps({
      wireTrigger: async () => {
        tries += 1;
        if (tries === 1) throw new Error('the widget doesn\'t send "ask"');
      },
    });
    const build = createPlanBuild(plan, d);
    let state = await build.run();
    assert.equal(by(state)["trigger:0:0"].canFix, true);
    state = await build.fix("trigger:0:0");
    assert.equal(state.status, "done");
    assert.match(
      d.calls.filter((c) => c[0] === "builder")[1][1],
      /What went wrong: Start Greeter when Ask button sends ask: the widget doesn't send "ask"/,
    );
    // Still placed once: the widget is updated where it is.
    assert.equal(count(d, "place"), 2);
    assert.equal(count(d, "saveBot"), 1);
  });

  it("a registry widget's problem isn't the Builder's to fix", async () => {
    const d = deps({
      installWidget: async () => {
        throw new Error("download failed");
      },
    });
    const state = await createPlanBuild(plan, d).run();
    const s = by(state)["install:0"];
    assert.equal(s.canFix, false);
    assert.equal(s.canRetry, true);
  });

  it("can't fix while it's running", async () => {
    let release;
    const d = deps({
      createDashboard: () =>
        new Promise((r) => {
          release = () => r({ id: 1, name: "x" });
        }),
    });
    const build = createPlanBuild(plan, d);
    const done = build.run();
    await new Promise((r) => setTimeout(r, 5));
    assert.match((await build.fix("check:1")).error, /still running/);
    release();
    await done;
  });
});

describe("Try again", () => {
  it("a failed Dash step runs again, then what waited on it", async () => {
    let first = true;
    const d = deps({
      installWidget: async () => {
        if (first) {
          first = false;
          throw new Error("download failed");
        }
        return { component: "trops.google-calendar.Calendar" };
      },
    });
    const build = createPlanBuild(plan, d);
    let state = await build.run();
    assert.equal(by(state)["place:0"].status, "skipped");
    state = await build.retry("install:0");
    assert.equal(state.status, "done");
    assert.equal(by(state)["place:0"].status, "done");
    assert.equal(count(d, "builder"), 1);
  });
});

describe("waiting for a provider (CRE-004 AC5)", () => {
  it("a bot whose provider isn't connected waits, and so does what needs it", async () => {
    let connected = false;
    const d = deps({
      saveBot: async ({ piece }) => {
        if (!connected) {
          const err = new Error("Greeter needs gmail, which isn't connected");
          err.waitingFor = ["gmail"];
          throw err;
        }
        return { id: "bot_1", name: piece.name };
      },
    });
    const build = createPlanBuild(plan, d);
    let state = await build.run();
    let s = by(state);
    assert.equal(state.status, "waiting-for-providers");
    assert.equal(s["bot:0"].status, "needs-provider");
    assert.deepEqual(s["bot:0"].waitingFor, ["gmail"]);
    assert.equal(s["bot:0"].error, undefined);
    assert.equal(s["results:0"].status, "needs-provider");
    assert.deepEqual(s["trigger:0:0"].waitingFor, ["gmail"]);
    assert.equal(s["place:1"].status, "done");

    connected = true;
    state = await build.resume();
    s = by(state);
    assert.equal(state.status, "done");
    assert.equal(s["trigger:0:0"].status, "done");
    assert.equal(count(d, "builder"), 1);
  });

  it("planBotDefinition says which providers it waits for", () => {
    try {
      planBotDefinition(
        {
          name: "Poster",
          instructions: "Post.",
          tools: [{ provider: "slack" }],
        },
        { dashboardId: "1", sources: [], team: [] },
      );
      assert.fail("should throw");
    } catch (err) {
      assert.deepEqual(err.waitingFor, ["slack"]);
    }
  });

  it("resume with nothing waiting says so", async () => {
    const build = createPlanBuild(plan, deps());
    await build.run();
    assert.match((await build.resume()).error, /Nothing is waiting/);
  });
});

describe("Edit plan reuses what was built", () => {
  it("unchanged pieces are kept, new ones built, changed ones updated, dropped ones listed", async () => {
    const d1 = deps();
    const first = await createPlanBuild(plan, d1).run();
    assert.equal(first.status, "done");

    const edited = {
      ...plan,
      pieces: [
        // Calendar dropped; Ask button unchanged; Greeter changed; Notes new.
        plan.pieces[1],
        { ...plan.pieces[2], instructions: "Greet warmly." },
        { kind: "widget", name: "Notes", source: "new" },
        plan.pieces[3],
      ],
    };
    const d2 = deps({
      askRole: async (role, request) => {
        d2.calls.push([role, request]);
        return role === "builder"
          ? { status: "completed", output: "@ai-built/notes" }
          : { status: "completed", output: "VERDICT: PASSED" };
      },
      placeWidget: async (req) => {
        d2.calls.push(["place", req.widget]);
        return { component: "ai-built.notes.Notes", widgetId: 9 };
      },
    });
    const state = await createPlanBuild(edited, d2, {
      resume: { plan, state: first },
    }).run();
    const s = by(state);
    assert.equal(state.status, "done");
    assert.equal(count(d2, "dashboard"), 0);
    assert.deepEqual(state.dashboard, first.dashboard);
    // Only Notes is built and placed.
    assert.equal(count(d2, "builder"), 1);
    assert.deepEqual(
      d2.calls.filter((c) => c[0] === "place").map((c) => c[1]),
      ["@ai-built/notes"],
    );
    assert.equal(s["build:0"].reused, true);
    // Greeter changed: saved over the old bot; the same trigger isn't wired twice.
    assert.deepEqual(
      d2.calls.find((c) => c[0] === "saveBot"),
      ["saveBot", "Greeter", "bot_1"],
    );
    assert.equal(count(d2, "results"), 0);
    assert.equal(count(d2, "trigger"), 0);
    assert.deepEqual(state.leftovers, [
      {
        kind: "widget",
        name: "Calendar",
        package: "@trops/google-calendar",
        built: false,
      },
    ]);
  });

  it("a changed widget the Builder made is updated where it's placed", async () => {
    const first = await createPlanBuild(plan, deps()).run();
    const edited = {
      ...plan,
      pieces: plan.pieces.map((p) =>
        p.name === "Ask button" ? { ...p, notes: "bigger" } : p,
      ),
    };
    const d = deps();
    const state = await createPlanBuild(edited, d, {
      resume: { plan, state: first },
    }).run();
    assert.equal(state.status, "done");
    assert.match(
      d.calls.find((c) => c[0] === "builder")[1],
      /^Fix the widget @ai-built\/askbutton[\s\S]*the plan for this widget changed/,
    );
    assert.equal(count(d, "place"), 0);
    assert.equal(count(d, "install"), 0);
  });
});

describe("builtSummary — what Remove what was built takes away", () => {
  it("the dashboard, saved bots and new widgets go; installs and updates stay", async () => {
    const withUpdate = {
      ...plan,
      pieces: [
        ...plan.pieces,
        {
          kind: "widget",
          name: "Old",
          source: "update",
          package: "@ai-built/old",
        },
      ],
    };
    const d = deps({
      askRole: async (role, request) =>
        role === "builder"
          ? {
              status: "completed",
              output: /Update the widget @ai-built\/old/.test(request)
                ? "@ai-built/old"
                : "@ai-built/askbutton",
            }
          : { status: "completed", output: "VERDICT: PASSED" },
    });
    const state = await createPlanBuild(withUpdate, d).run();
    assert.deepEqual(state.built, builtSummary(state, withUpdate));
    assert.deepEqual(state.built, {
      dashboard: { id: "77", name: "Ask Test" },
      bots: [{ id: "bot_1", name: "Greeter" }],
      widgets: ["@ai-built/askbutton"],
      updated: ["@ai-built/old"],
      installs: ["@trops/google-calendar"],
    });
  });

  it("after Edit plan it still includes what the edit dropped", async () => {
    const first = await createPlanBuild(plan, deps()).run();
    const edited = { ...plan, pieces: [plan.pieces[0], plan.pieces[3]] };
    const state = await createPlanBuild(edited, deps(), {
      resume: { plan, state: first },
    }).run();
    assert.deepEqual(state.built.bots, [{ id: "bot_1", name: "Greeter" }]);
    assert.deepEqual(state.built.widgets, ["@ai-built/askbutton"]);
    assert.deepEqual(state.built.installs, ["@trops/google-calendar"]);
  });
});

describe("buildRequest with a fix", () => {
  it("no package yet → build it again, not an update", () => {
    const req = buildRequest(plan, plan.pieces[1], {
      package: null,
      problem: "the Builder didn't build it",
    });
    assert.match(req, /^Build this plan's widget again/);
    assert.match(req, /What went wrong: the Builder didn't build it/);
    assert.doesNotMatch(req, /update: true/);
  });
});

describe("what the Builder and Checker are told (live 4d-3 findings)", () => {
  const mismatched = {
    ...plan,
    pieces: plan.pieces.map((p) =>
      p.kind === "bot"
        ? { ...p, on: [{ widget: "Ask button", event: "askPressed" }] }
        : p,
    ),
  };
  it("a widget must send the events a bot starts on, as well as its own", () => {
    assert.deepEqual(eventsToSend(mismatched, mismatched.pieces[1]), [
      "ask",
      "askPressed",
    ]);
    assert.match(
      buildRequest(mismatched, mismatched.pieces[1]),
      /useWidgetEvents.*: ask, askPressed/,
    );
  });
  it("the Checker isn't told to hold a new widget's earlier version against it", () => {
    const req = checkRequest(mismatched, mismatched.pieces[1], {
      package: "@ai-built/askbutton",
    });
    assert.match(req, /^Check @ai-built\/askbutton\./);
    assert.match(req, /The plan needs it to send: ask, askPressed\./);
    assert.match(req, /made new in this build.*not a breaking change/);
    const update = checkRequest(
      plan,
      { name: "Old", source: "update" },
      { package: "@ai-built/old" },
    );
    assert.doesNotMatch(update, /breaking change/);
  });
  it("after a fix the Checker hears what it was for", async () => {
    const d = deps();
    d.verdicts.push("FAILED");
    const build = createPlanBuild(plan, d);
    await build.run();
    await build.fix("check:1");
    const checks = d.calls.filter((c) => c[0] === "checker").map((c) => c[1]);
    assert.doesNotMatch(checks[0], /just changed it to fix/);
    assert.match(
      checks[1],
      /The Builder just changed it to fix this: Check Ask button: the Checker found problems/,
    );
  });
});
