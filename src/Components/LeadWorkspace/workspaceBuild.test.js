/**
 * workspaceBuild (lead-workspace release 3b): a plan's build in words —
 * which build a plan gets, its line, Build log, Check report, the Builder's
 * and Checker's rows, and what the lead says in the chat.
 */
import {
  buildChat,
  buildKind,
  activityText,
  liveActivityOf,
  buildLogHead,
  buildLogSteps,
  logDuration,
  buildMemberState,
  buildOptions,
  buildPlanLine,
  buildStatus,
  buildStory,
  checkLine,
  checkRan,
  stopTold,
  checkRows,
  isLeftOff,
  pieceKey,
  waitingFor,
  workingLine,
} from "./workspaceBuild";

const at = (hh, mm) => new Date(2026, 9, 29, hh, mm).toISOString();
const step = (over) => ({ status: "waiting", role: "dash", ...over });

// A Home dashboard, half way: the lights panel built and checked, the
// camera strip being built.
const RUNNING = {
  status: "running",
  startedAt: at(21, 14),
  steps: [
    step({
      id: "dashboard",
      kind: "dashboard",
      label: 'Create the "Home" dashboard',
      status: "done",
      finishedAt: at(21, 14),
    }),
    step({
      id: "build:0",
      kind: "build",
      piece: 0,
      role: "builder",
      label: "Build Lights panel",
      status: "done",
      tokens: 12000,
      startedAt: at(21, 14),
      finishedAt: at(21, 15),
    }),
    step({
      id: "check:0",
      kind: "check",
      piece: 0,
      role: "checker",
      label: "Check Lights panel",
      status: "done",
      tokens: 3000,
      detail: "Renders, follows your theme.\nVERDICT: PASSED",
      finishedAt: at(21, 16),
    }),
    step({
      id: "build:1",
      kind: "build",
      piece: 1,
      role: "builder",
      label: "Build Camera strip",
      status: "running",
      startedAt: at(21, 16),
    }),
    step({
      id: "check:1",
      kind: "check",
      piece: 1,
      role: "checker",
      label: "Check Camera strip",
    }),
    step({
      id: "place:0",
      kind: "place",
      piece: 0,
      label: "Place Lights panel",
    }),
    step({
      id: "place:1",
      kind: "place",
      piece: 1,
      label: "Place Camera strip",
    }),
  ],
};

// The same build, finished: the camera strip failed, so its check and
// placing were skipped.
const FAILED = {
  ...RUNNING,
  status: "finished-with-problems",
  finishedAt: at(21, 18),
  steps: RUNNING.steps.map((s) => {
    if (s.id === "build:1")
      return {
        ...s,
        status: "failed",
        error: "cameras timed out after 30s",
        canFix: true,
        fixesLeft: 2,
        finishedAt: at(21, 17),
      };
    if (s.id === "check:1" || s.id === "place:1")
      return {
        ...s,
        status: "skipped",
        error: "Build Camera strip didn't finish",
      };
    if (s.id === "place:0")
      return { ...s, status: "done", finishedAt: at(21, 18) };
    return s;
  }),
};

const DONE = {
  status: "done",
  startedAt: at(21, 14),
  finishedAt: at(21, 20),
  dashboard: { id: "12", name: "Home" },
  steps: RUNNING.steps.map((s) => ({
    ...s,
    status: "done",
    finishedAt: s.finishedAt || at(21, 19),
  })),
};

describe("which build a plan gets", () => {
  test("one new widget alone is a widget build; one bot alone a bot build; else a dashboard", () => {
    expect(
      buildKind({ pieces: [{ kind: "widget", name: "Clock", source: "new" }] }),
    ).toBe("widget");
    expect(
      buildKind({ pieces: [{ kind: "bot", name: "Brief", source: "new" }] }),
    ).toBe("bot");
    expect(
      buildKind({
        pieces: [
          { kind: "widget", name: "Clock", source: "new" },
          { kind: "layout", name: "Home" },
        ],
      }),
    ).toBe("dashboard");
    // A widget for a dashboard you have goes on it.
    expect(
      buildKind({
        dashboard: { id: "7", name: "Kitchen" },
        pieces: [{ kind: "widget", name: "Clock", source: "new" }],
      }),
    ).toBe("dashboard");
    expect(buildOptions("widget")).toEqual({ cell: true, standalone: true });
    expect(buildOptions("bot")).toEqual({ bot: true });
    expect(buildOptions("dashboard")).toEqual({});
  });
});

describe("the plan's line and status", () => {
  test("building, failed, left off, built, waiting", () => {
    expect(buildPlanLine(RUNNING)).toBe("Building · 3 of 7 done");
    expect(buildPlanLine(FAILED)).toBe("4 of 7 done · 1 failed");
    // Leaving the camera strip off: built, and it says so.
    const off = [pieceKey(FAILED.steps[3])];
    expect(off).toEqual(["piece:1"]);
    expect(isLeftOff(FAILED.steps[4], off)).toBe(true);
    expect(buildStatus(FAILED, off)).toBe("done");
    expect(buildPlanLine(FAILED, off)).toBe("Built · Camera strip left off");
    expect(buildPlanLine(DONE)).toBe("Built");
    const waiting = {
      ...DONE,
      status: "waiting-for-providers",
      steps: [
        step({
          id: "bot:0",
          kind: "bot",
          label: "Save the Lights-off bot",
          status: "needs-provider",
          waitingFor: ["home-assistant"],
        }),
      ],
    };
    expect(waitingFor(waiting)).toEqual(["home-assistant"]);
    expect(buildPlanLine(waiting)).toMatch(/^Built · waiting for /);
    expect(buildPlanLine({ ...RUNNING, status: "stopped" })).toBe(
      "Stopped · 3 of 7 done",
    );
  });
});

describe("the Build log and the Check report", () => {
  test("every step from the start: done, running, to come; the head says where", () => {
    const now = Date.parse(at(21, 18)) + 40000;
    const rows = buildLogSteps(RUNNING, [], { now });
    expect(rows.map((r) => r.state)).toEqual([
      "done",
      "done",
      "done",
      "running",
      "next",
      "next",
      "next",
    ]);
    expect(rows[3]).toMatchObject({
      who: "Builder",
      now: "Builder · writing the draft",
      side: "started 21:16 · 2m 40s",
    });
    expect(rows[4].side).toBe("Checker · next");
    expect(rows[5].side).toBe("");
    expect(rows[2].side).toMatch(/^passed/);
    expect(buildLogHead(RUNNING, [], { now })).toEqual({
      lead: "Step 4 of 7",
      rest: "building for 4m 40s",
      tone: "running",
    });
  });

  test("a step that can't finish says why once; the steps after it say not started", () => {
    const rows = buildLogSteps(FAILED);
    expect(rows[3]).toMatchObject({
      state: "bad",
      note: "Cameras timed out after 30s",
      side: "21:16 – 21:17",
    });
    expect(rows[4]).toMatchObject({ state: "off", side: "not started" });
    expect(rows[4].note).toBe("");
    expect(buildLogSteps(FAILED, ["piece:1"])[3]).toMatchObject({
      state: "warn",
      side: "left off",
    });
    expect(buildLogHead(FAILED)).toEqual({
      lead: "Stopped at step 4 of 7",
      rest: "4m 00s",
      tone: "bad",
    });
    expect(buildLogHead(DONE)).toEqual({
      lead: "Done",
      rest: "7 steps in 6m 00s",
      tone: "ok",
    });
  });

  test("a try sent back shows on its step, with why; the head counts it", () => {
    const tried = {
      ...DONE,
      steps: DONE.steps.map((s) =>
        s.id === "build:1"
          ? {
              ...s,
              startedAt: at(21, 16),
              finishedAt: at(21, 19),
              tries: [
                {
                  startedAt: at(21, 16),
                  finishedAt: at(21, 17),
                  by: "check",
                  error: "1 thing doesn't match what the user chose",
                  mismatch: [
                    { main: "It shows past events", chose: "today only" },
                  ],
                },
              ],
            }
          : s,
      ),
    };
    const row = buildLogSteps(tried).find((r) => r.id === "build:1");
    expect(row.badge).toBe("2nd try");
    expect(row.side).toBe("2 tries · 3m 00s");
    expect(row.tries).toEqual([
      {
        time: "21:17",
        text: "1st try sent back — The draft didn't match what you chose: It shows past events (you chose: today only).",
        tone: "warn",
      },
    ]);
    // A line in the log, before what this try did.
    expect(row.activity[0]).toEqual(row.tries[0]);
    expect(buildLogHead(tried).rest).toBe("7 steps in 6m 00s · sent back once");
  });

  test("steps waiting for the user say so; the ones after them wait on it", () => {
    const cell = {
      status: "running",
      startedAt: at(21, 0),
      steps: [
        step({
          id: "build:0",
          kind: "build",
          role: "builder",
          label: "Write the change into a draft",
          status: "running",
          startedAt: at(21, 0),
        }),
        step({
          id: "check:0",
          kind: "check",
          role: "checker",
          label: "Check the draft",
        }),
        step({
          id: "preview:0",
          kind: "preview",
          role: "you",
          label: "Preview it",
        }),
        step({ id: "save:0", kind: "save", label: "Update Calendar" }),
      ],
    };
    expect(
      buildLogSteps(cell, [], { now: Date.parse(at(21, 1)) }).map(
        (r) => r.side,
      ),
    ).toEqual([
      "started 21:00 · 1m 00s",
      "Checker · next",
      "waits for your look",
      "after you say it looks good",
    ]);
    const stopped = {
      ...cell,
      status: "finished-with-problems",
      steps: cell.steps.map((s) =>
        s.id === "build:0" ? { ...s, status: "failed", error: "no" } : s,
      ),
    };
    expect(buildLogSteps(stopped, [], { edit: true })[3].side).toBe(
      "not started · your widget is unchanged",
    );
  });

  test("at the user's look, what comes after waits on it; a stop or a cut-off says so once", () => {
    const steps = [
      step({
        id: "build:0",
        kind: "build",
        role: "builder",
        label: "Write the change into a draft",
        status: "done",
        startedAt: at(21, 0),
        finishedAt: at(21, 2),
      }),
      step({
        id: "check:0",
        kind: "check",
        role: "checker",
        label: "Check the draft",
        status: "done",
        startedAt: at(21, 2),
        finishedAt: at(21, 3),
      }),
      step({
        id: "preview:0",
        kind: "preview",
        role: "you",
        label: "Preview it",
        status: "needs-you",
      }),
      step({ id: "save:0", kind: "save", label: "Update Calendar" }),
    ];
    const look = {
      status: "waiting-for-you",
      startedAt: at(21, 0),
      finishedAt: at(21, 3),
      steps,
    };
    expect(buildLogSteps(look, [], { edit: true }).map((r) => r.side)).toEqual([
      "2m 00s",
      "passed · 1m 00s",
      "waiting for your look",
      "after you say it looks good",
    ]);
    expect(buildLogHead(look).lead).toBe("Waiting for you at step 3 of 4");
    const stopped = {
      status: "stopped",
      steps: [
        step({ id: "a", label: "A", status: "done", finishedAt: at(21, 0) }),
        step({ id: "b", label: "B", status: "stopped" }),
        step({ id: "c", label: "C", status: "stopped" }),
      ],
    };
    expect(buildLogSteps(stopped).map((r) => [r.state, r.side])).toEqual([
      ["done", "21:00"],
      ["warn", "stopped"],
      ["off", "not started"],
    ]);
    const cut = {
      status: "interrupted",
      steps: [
        step({ id: "a", label: "A", startedAt: at(21, 0) }),
        step({ id: "b", label: "B" }),
      ],
    };
    expect(buildLogSteps(cut).map((r) => r.side)).toEqual([
      "interrupted",
      "not started",
    ]);
  });

  test("what a role did, in words", () => {
    expect(activityText({ tool: "read_widget", what: "HaCalendar.js" })).toBe(
      "Read HaCalendar.js",
    );
    expect(activityText({ tool: "widget_guide" })).toBe(
      "Read the widget guide",
    );
    expect(activityText({ tool: "gmail_search", what: "today" })).toBe(
      "Gmail search · today",
    );
    // The Claude CLI's tools, and a long answer it saved to read in parts.
    expect(
      activityText({
        tool: "Grep",
        what: "mcp-bot-mcp-widget_guide-1795094171452-q6uyzz.txt",
      }),
    ).toBe("Searched the widget guide");
    expect(
      activityText({ tool: "Read", what: "MusicAssistantPlayerHaMcp.js" }),
    ).toBe("Read MusicAssistantPlayerHaMcp.js");
    expect(activityText({ tool: "Glob", what: "Dash" })).toBe(
      "Looked for files",
    );
    // A bot's live tool call, as the opened step lists it.
    expect(
      liveActivityOf(
        {
          type: "tool_call",
          name: "mcp__dash__search_library",
          args: '{"query":"clock"}',
        },
        "t",
      ),
    ).toEqual({ at: "t", tool: "search_library", what: "clock" });
    expect(
      liveActivityOf({ type: "tool_call", name: "memory_read" }, "t"),
    ).toBe(null);
    expect(liveActivityOf({ type: "text", text: "hi" }, "t")).toBe(null);
    expect(logDuration(65000)).toBe("1m 05s");
    expect(logDuration(3 * 3600000 + 60000)).toBe("3h 1m");
  });

  test("the Check report: each widget the Checker looked at", () => {
    expect(checkRows(RUNNING)).toEqual([
      {
        ok: true,
        main: "Lights panel — passed",
        sub: "Renders, follows your theme.",
      },
    ]);
    expect(checkRows(FAILED)[1]).toEqual({
      ok: null,
      main: "Camera strip — not checked",
      sub: "Build Camera strip didn't finish",
    });
    expect(checkLine(DONE)).toBe("2 new widgets checked");
  });
});

describe("the Builder and Checker rows", () => {
  test("working with its live line, failed with why, done with its tokens", () => {
    expect(
      buildMemberState("builder", RUNNING, [], { builder: "› build widget" }),
    ).toEqual({
      tone: "working",
      state: "working",
      line: "› build widget",
    });
    expect(buildMemberState("builder", RUNNING).line).toBe(
      "› Build Camera strip",
    );
    expect(buildMemberState("checker", RUNNING)).toEqual({
      tone: "idle",
      state: "waiting",
      line: "passed 1 so far",
    });
    expect(buildMemberState("builder", FAILED)).toEqual({
      tone: "bad",
      state: "failed",
      line: "Camera strip — cameras timed out after 30s",
    });
    expect(buildMemberState("builder", DONE)).toEqual({
      tone: "ok",
      state: "done · 12.0k tokens",
      line: "built 2 widgets",
    });
    expect(buildMemberState("checker", DONE).line).toBe("passed 2 of 2");
    // A build with nothing to build: the Builder wasn't needed.
    expect(
      buildMemberState("builder", { status: "done", steps: [] }),
    ).toBeNull();
    expect(workingLine(RUNNING)).toBe(
      "The team is working · the Builder is building 2 widgets",
    );
  });
});

describe("the build in the chat", () => {
  test("building: the step, and what needs you", () => {
    expect(buildChat(RUNNING)).toEqual({
      step: { label: "Builder is building 2 widgets", status: "asking" },
      card: null,
      reply: "Building now — I'll tell you when it's done.",
      choices: null,
    });
    const needs = {
      ...RUNNING,
      steps: [
        ...RUNNING.steps,
        step({
          id: "bot:0",
          kind: "bot",
          label: "Save the Lights-off bot",
          status: "needs-provider",
          waitingFor: ["home-assistant"],
        }),
      ],
    };
    expect(buildChat(needs).reply).toMatch(
      /^Building now\. One thing needs you — connect .+, on the right\. Everything else carries on\.$/,
    );
  });

  test("a failure: only what's offered, or leave it out; left out, it's built", () => {
    const chat = buildChat(FAILED);
    expect(chat.step).toEqual({
      label: "Builder couldn't finish Camera strip",
      status: "failed",
    });
    expect(chat.reply).toContain(
      "Camera strip didn't work — cameras timed out after 30s.",
    );
    // The Builder can fix it; there's no Try again here.
    expect(chat.reply).toContain("Let the Builder fix it, or leave it out?");
    expect(chat.reply).not.toContain("Try it again");
    expect(chat.leave).toBe("Leave it out");
    expect(chat.choices).toBe("failed");
    expect(chat.failed.id).toBe("build:1");
    const off = buildChat(
      { ...FAILED, dashboard: { id: "12", name: "Home" } },
      { leftOff: ["piece:1"] },
    );
    expect(off.choices).toBe("open");
    expect(off.reply).toContain("Camera strip is left off.");
  });

  test("done: the dashboard's card and Open", () => {
    const chat = buildChat(DONE);
    expect(chat.step).toEqual({
      label: "Builder built 2 widgets · Checker checked them",
      status: "done",
    });
    expect(chat.card).toEqual({
      kind: "dashboard",
      title: "Home",
      sub: "Dashboard · built · 2 widgets",
    });
    expect(chat.reply).toBe(
      "Your Home dashboard is ready. The Checker passed all 2 new widgets.",
    );
    expect(chat.choices).toBe("open");
  });

  test("a widget on its own: its preview waits for you, then it's in your widgets", () => {
    const preview = {
      status: "waiting-for-you",
      steps: [
        step({
          id: "build:0",
          kind: "build",
          piece: 0,
          role: "builder",
          label: "Build Lights panel",
          status: "done",
        }),
        step({
          id: "check:0",
          kind: "check",
          piece: 0,
          role: "checker",
          label: "Check Lights panel",
          status: "done",
        }),
        step({
          id: "preview:0",
          kind: "preview",
          piece: 0,
          role: "you",
          label: "Preview Lights panel",
          status: "needs-you",
        }),
        step({
          id: "save:0",
          kind: "save",
          piece: 0,
          label: "Install Lights panel",
        }),
      ],
    };
    const chat = buildChat(preview, { kind: "widget" });
    expect(chat.choices).toBe("preview");
    expect(chat.card).toEqual({
      kind: "widget",
      title: "Lights panel",
      sub: "Widget · preview ready",
    });
    const done = {
      status: "done",
      steps: preview.steps.map((s) => ({ ...s, status: "done" })),
    };
    expect(buildChat(done, { kind: "widget" }).reply).toMatch(
      /^Lights panel is in your widgets\./,
    );
  });

  test("stopped or interrupted: carry on", () => {
    expect(buildChat({ ...RUNNING, status: "stopped" }).choices).toBe(
      "continue",
    );
    expect(buildChat({ ...RUNNING, status: "interrupted" }).reply).toMatch(
      /^The app closed while it was building\./,
    );
  });
});

describe("seen live (release 3b)", () => {
  test("one widget: 'checked it'; the log says steps in words; the report drops 'passed.'", () => {
    const one = {
      status: "done",
      dashboard: { id: "3", name: "Desk" },
      steps: [
        step({
          id: "build:0",
          kind: "build",
          piece: 0,
          role: "builder",
          label: "Build Friday Countdown",
          status: "done",
          detail: "draft:FridayCountdown",
        }),
        step({
          id: "check:0",
          kind: "check",
          piece: 0,
          role: "checker",
          label: "Check Friday Countdown",
          status: "done",
          detail: "passed. The checklist scored 7 passed.",
        }),
        step({
          id: "place:0",
          kind: "place",
          piece: 0,
          label: "Place Friday Countdown",
          status: "done",
          detail: "ai-built.fridaycountdown.FridayCountdown",
        }),
      ],
    };
    expect(buildChat(one).step.label).toBe(
      "Builder built 1 widget · Checker checked it",
    );
    expect(buildLogSteps(one).map((r) => r.label)).toEqual([
      "Build Friday Countdown",
      "Check Friday Countdown",
      "Place Friday Countdown",
    ]);
    expect(checkRows(one)[0].sub).toBe("The checklist scored 7 passed.");
  });
});

test("stopped before the Checker looked: it says stopped, not done", () => {
  const stopped = {
    status: "stopped",
    steps: [
      step({
        id: "build:0",
        kind: "build",
        piece: 0,
        role: "builder",
        label: "Build Coin Flip",
        status: "stopped",
      }),
      step({
        id: "check:0",
        kind: "check",
        piece: 0,
        role: "checker",
        label: "Check Coin Flip",
        status: "stopped",
      }),
    ],
  };
  // Nothing to open: no Report › yet.
  expect(buildMemberState("checker", stopped)).toEqual({
    tone: "idle",
    state: "stopped",
    line: "",
    out: false,
  });
  // Nothing built yet: start it again, not carry on.
  const chat = buildChat(stopped);
  expect(chat.reply).toBe(
    "Stopped before anything was built. I can start it again.",
  );
  expect(chat.continueLabel).toBe("Start it again");
  expect(buildMemberState("builder", stopped).state).toBe("stopped");
});

test("review fixes: waiting for your look, removed, counts and agreement", () => {
  const look = {
    status: "waiting-for-you",
    steps: [
      step({
        id: "build:0",
        kind: "build",
        piece: 0,
        role: "builder",
        label: "Build Coin Flip",
        status: "done",
      }),
      step({
        id: "preview:0",
        kind: "preview",
        piece: 0,
        role: "you",
        label: "Preview Coin Flip",
        status: "needs-you",
      }),
    ],
  };
  expect(buildMemberState("builder", look)).toEqual({
    tone: "idle",
    state: "waiting for you",
    line: "Coin Flip built — waiting for your look",
    out: "preview",
  });
  expect(buildChat({ ...DONE, status: "removed" }).choices).toBe("again");
  // Two pieces left off: "are"; the Checker passed what it looked at.
  const two = {
    ...FAILED,
    dashboard: { id: "12", name: "Home" },
    steps: FAILED.steps.map((x) =>
      x.id === "build:0" ? { ...x, status: "failed", error: "x" } : x,
    ),
  };
  const reply = buildChat(two, { leftOff: ["piece:0", "piece:1"] }).reply;
  expect(reply).toContain("are left off.");
  expect(
    checkRows({
      steps: [
        step({
          kind: "check",
          label: "Check A",
          status: "done",
          detail: "passed. Renders. check_widget saw 7.",
        }),
      ],
    })[0].sub,
  ).toBe("Renders.");
  const partly = {
    ...DONE,
    steps: DONE.steps.map((x) =>
      x.id === "check:1" ? { ...x, status: "skipped" } : x,
    ),
  };
  expect(
    buildChat(
      { ...partly, status: "finished-with-problems" },
      { leftOff: ["piece:1"] },
    ).reply,
  ).toContain("The Checker passed 1 new widget.");
});

// A bot made but not saved until it's tested (bot-test-run TST-003).
describe("a bot build waiting for its test", () => {
  const waiting = {
    status: "waiting-for-you",
    steps: [
      {
        id: "checkbot:0",
        kind: "checkbot",
        role: "dash",
        status: "done",
        label: "Check the bot",
      },
      {
        id: "testbot:0",
        kind: "testbot",
        role: "you",
        status: "needs-you",
        label: "Test Meeting Reminder",
      },
      {
        id: "bot:0",
        kind: "bot",
        role: "dash",
        status: "waiting",
        label: "Save Meeting Reminder — paused",
      },
    ],
  };
  it("says it's made, not saved yet, and sends the user to its test", () => {
    const chat = buildChat(waiting, { kind: "bot" });
    expect(chat.step.label).toBe("Made Meeting Reminder · not saved yet");
    expect(chat.card).toEqual({
      kind: "bot",
      title: "Meeting Reminder",
      sub: "Bot · ready to test",
    });
    expect(chat.reply).toMatch(/nothing is saved before that/);
    expect(chat.choices).toBe("testbot");
  });
  it("a build saved before Dash closed carries on first", () => {
    expect(buildChat(waiting, { kind: "bot", restored: true }).choices).toBe(
      "continue",
    );
  });
});

describe("a bot build, saved after its test", () => {
  it("says it's saved with its test, and offers Turn on right there", () => {
    const chat = buildChat(
      {
        status: "done",
        bots: { 0: { id: "bot_1", name: "Meeting Reminder" } },
        steps: [
          {
            id: "testbot:0",
            kind: "testbot",
            role: "you",
            status: "done",
            label: "Test Meeting Reminder",
          },
          {
            id: "bot:0",
            kind: "bot",
            role: "dash",
            status: "done",
            label: "Save Meeting Reminder — paused",
          },
        ],
      },
      { kind: "bot" },
    );
    expect(chat.card.sub).toBe("Bot · tested, saved, paused");
    expect(chat.reply).toMatch(/with its test kept as its sample/);
    expect(chat.choices).toBe("turnon");
  });
});

// DASH-19: the message offers only what's on screen.
describe("a failure's way on", () => {
  const failed = (step, extra = {}) => ({
    status: "finished-with-problems",
    steps: [
      {
        id: "build:0",
        kind: "build",
        role: "builder",
        piece: 0,
        status: "failed",
        label: "Write the change into a draft",
        error:
          "the draft doesn't match what you chose: shows past events (you chose: today only)",
        ...step,
      },
    ],
    ...extra,
  });
  it("its fixes used up: say what to change, or keep the widget as it was", () => {
    const chat = buildChat(failed({ fixesUsedUp: true }), { kind: "edit" });
    expect(chat.reply).toContain(
      "the draft doesn't match what you chose: shows past events (you chose: today only)",
    );
    expect(chat.reply).toContain(
      "Say what to change in the reply, or keep the widget as it was.",
    );
    expect(chat.reply).not.toMatch(/Try it again/);
    expect(chat.leave).toBe("Keep the widget as it was");
  });
  it("one that can be tried again says so", () => {
    const chat = buildChat(failed({ canRetry: true }));
    expect(chat.reply).toContain("Try it again, or leave it out?");
  });
  it("a build saved before Dash closed drops the question", () => {
    const chat = buildChat(failed({ canRetry: true }), { restored: true });
    expect(chat.reply).not.toContain("Try it again");
    expect(chat.reply).toContain("carry on building");
  });
});

describe("the Check report only once the Checker looked", () => {
  const st = (check) => ({
    status: "failed",
    steps: [
      { id: "build:0", kind: "build", status: "failed" },
      { id: "check:0", kind: "check", status: check },
    ],
  });
  test("a check skipped because its build failed was never checked", () => {
    expect(checkRan(st("skipped"))).toBe(false);
    expect(checkRan(st("waiting"))).toBe(false);
    expect(checkLine(st("skipped"))).toBe("0 new widgets checked");
  });
  test("looking, or looked", () => {
    expect(checkRan(st("running"))).toBe(true);
    expect(checkLine(st("running"))).toBe("Checking…");
    expect(checkRan(st("failed"))).toBe(true);
    expect(checkLine(st("done"))).toBe("1 new widget checked");
  });
});

describe("the build told in the chat (DASH-21 frame 2)", () => {
  const at = (m, sec = 0) => new Date(2026, 10, 19, 8, m, sec).toISOString();
  const steps = (build, check, extra = {}) => ({
    status: "running",
    steps: [
      {
        id: "build:0",
        kind: "build",
        piece: 0,
        role: "builder",
        label: "Build Player",
        ...build,
      },
      {
        id: "check:0",
        kind: "check",
        piece: 0,
        role: "checker",
        label: "Check Player",
        ...check,
      },
      {
        id: "preview:0",
        kind: "preview",
        piece: 0,
        role: "you",
        label: "Preview Player",
        status: "waiting",
      },
      {
        id: "save:0",
        kind: "save",
        piece: 0,
        label: "Save Player",
        status: "waiting",
      },
    ],
    ...extra,
  });
  test("the steps up front, in words", () => {
    const story = buildStory(
      steps({ status: "running", startedAt: at(13) }, { status: "waiting" }),
    );
    expect(story.intro).toBe(
      "Building it now, in 4 steps: the Builder writes it, the Checker checks it, you look at a preview and I save it. I'll tell you as each one goes.",
    );
    expect(story.events).toEqual([]);
    expect(story.now).toEqual({
      text: "Step 1 of 4 · Builder is writing the draft",
      since: at(13),
    });
  });
  test("a try sent back says why, with its time; the next draft in; the step it's on now", () => {
    const story = buildStory(
      steps(
        {
          status: "done",
          startedAt: at(13),
          finishedAt: at(16),
          tries: [
            {
              startedAt: at(13),
              finishedAt: at(14),
              by: "checker",
              error: "the list still leaves a gap at the bottom",
            },
          ],
        },
        { status: "running", startedAt: at(16) },
      ),
    );
    expect(story.events.map((e) => [e.time, e.tone, e.text])).toEqual([
      [
        "08:14",
        "warn",
        "The Builder's 1st draft was sent back: The list still leaves a gap at the bottom. It's trying again — 2nd try.",
      ],
      ["08:16", "done", "The 2nd draft is in."],
    ]);
    expect(story.now.text).toBe("Step 2 of 4 · Checker is checking the draft");
  });
  test("done: the check passed; nothing running", () => {
    const story = buildStory({
      ...steps(
        { status: "done", finishedAt: at(14) },
        { status: "done", finishedAt: at(15) },
      ),
      status: "waiting-for-you",
    });
    expect(story.events.map((e) => e.text)).toEqual([
      "The Builder finished the draft.",
      "The Checker checked it — it passed.",
    ]);
    expect(story.now).toBeNull();
  });
  test("no steps yet: nothing to tell", () => {
    expect(buildStory(null)).toBeNull();
  });
});

describe("when it can't finish, told in full (DASH-21 frame 3)", () => {
  const build = (extra) => ({
    id: "build:0",
    kind: "build",
    piece: 0,
    role: "builder",
    label: "Build Latest Notes",
    status: "failed",
    ...extra,
  });
  const state = (step) => ({ status: "finished-with-problems", steps: [step] });
  test("the Builder can't do what's planned: why, unchanged, change the plan or stop", () => {
    const step = build({
      endOfLine: {
        what: "show a time for each note in the left column — Home Assistant to-do items have no created or updated time",
        closest: null,
      },
    });
    const t = stopTold(
      { choices: "endofline", failed: step, closest: null },
      state(step),
      { edit: false },
    );
    expect(t.title).toBe("The Builder can't do this as planned.");
    expect(t.reason).toBe(
      "It can't show a time for each note in the left column — Home Assistant to-do items have no created or updated time.",
    );
    expect(t.unchanged).toBe("Nothing was installed.");
    expect(t.options.map((o) => o.label)).toEqual([
      "Change the plan",
      "Stop here",
    ]);
    expect(t.options[0].explain).toMatch(
      /new plan here before anything builds/,
    );
  });
  test("tries used up on a change: how many, why it stopped, the widget unchanged", () => {
    const step = build({
      fixesUsedUp: true,
      error: "the draft didn't pass",
      tries: [
        { error: "the list still leaves a gap" },
        { error: "still a gap under the player list" },
      ],
    });
    const t = stopTold(
      { choices: "failed", failed: step, leave: "Keep the widget as it was" },
      state(step),
      { edit: true },
    );
    expect(t.title).toBe("The Builder couldn't make this change in 3 tries.");
    // The failed step's own reason — not the try before it.
    expect(t.reason).toBe("The draft didn't pass.");
    expect(t.unchanged).toBe(
      "Your widget is unchanged — nothing was installed.",
    );
    expect(t.options.map((o) => o.label)).toEqual([
      "Change the plan",
      "Keep the widget as it was",
    ]);
  });
  test("only what's really there: Try again and the Builder's fix when offered", () => {
    const step = build({
      canRetry: true,
      canFix: true,
      fixesLeft: 1,
      error: "timed out",
    });
    const t = stopTold({ choices: "failed", failed: step }, state(step));
    expect(t.options.map((o) => o.key)).toEqual([
      "retry",
      "fix",
      "plan",
      "leave",
    ]);
    expect(t.options[1].explain).toMatch(/its last try/);
  });
  test("a check that ran out of tries: counted from the Builder's drafts, the check's own reason", () => {
    const draft = build({
      status: "done",
      tries: [{ error: "a gap" }, { error: "still a gap" }],
    });
    const check = {
      id: "check:0",
      kind: "check",
      piece: 0,
      role: "checker",
      label: "Check Latest Notes",
      status: "failed",
      fixesUsedUp: true,
      error: "the list still ends above the bottom",
    };
    const t = stopTold(
      { choices: "failed", failed: check, leave: "Keep the widget as it was" },
      {
        status: "finished-with-problems",
        steps: [draft, check],
        waitingFor: [],
      },
      { edit: true },
    );
    expect(t.title).toBe("The Builder couldn't make this change in 3 tries.");
    expect(t.reason).toBe("The list still ends above the bottom.");
  });

  test("a dead end from what didn't match: no garbled reason — the list says it", () => {
    const step = build({
      endOfLine: {
        what: "- Lights reads only — the user chose: switch",
        closest: null,
      },
    });
    const t = stopTold(
      {
        choices: "endofline",
        failed: step,
        off: [{ main: "Lights reads only", chose: "switch" }],
      },
      state(step),
    );
    expect(t.reason).toBe("");
    // A sentence that isn't a "can't" stays a sentence.
    const own = build({
      endOfLine: { what: "Live video isn't offered by the API", closest: null },
    });
    expect(
      stopTold({ choices: "endofline", failed: own }, state(own)).reason,
    ).toBe("Live video isn't offered by the API.");
  });

  test("reopened after Dash closed: still told; what needs the build running is Carry on building", () => {
    const step = build({
      canRetry: true,
      canFix: true,
      fixesLeft: 2,
      error: "timed out",
    });
    const t = stopTold({ choices: "failed", failed: step }, state(step), {
      restored: true,
    });
    expect(t.title).toBe("Latest Notes didn't work.");
    expect(t.options.map((o) => o.key)).toEqual(["carry", "plan", "leave"]);
    // A dead end has nothing to carry on: the same choices.
    const end = build({ endOfLine: { what: "show a time", closest: null } });
    expect(
      stopTold({ choices: "endofline", failed: end }, state(end), {
        restored: true,
      }).options.map((o) => o.key),
    ).toEqual(["plan", "leave"]);
  });

  test("still building, or done: nothing to tell", () => {
    expect(stopTold({ choices: "preview" }, state(build()))).toBeNull();
    expect(stopTold(null, null)).toBeNull();
  });
});
