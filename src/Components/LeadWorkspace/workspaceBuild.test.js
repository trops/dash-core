/**
 * workspaceBuild (lead-workspace release 3b): a plan's build in words —
 * which build a plan gets, its line, Build log, Check report, the Builder's
 * and Checker's rows, and what the lead says in the chat.
 */
import {
  buildChat,
  buildKind,
  buildLogLine,
  buildLogRows,
  buildMemberState,
  buildOptions,
  buildPlanLine,
  buildStatus,
  checkLine,
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
  test("a row per step that started, with its time; failures say why", () => {
    const rows = buildLogRows(FAILED);
    expect(rows.map((r) => r.time)).toEqual([
      "21:14",
      "21:15",
      "21:16",
      "21:17",
      "",
      "21:18",
      "",
    ]);
    expect(rows[1]).toEqual({
      time: "21:15",
      text: "Build Lights panel",
      tone: "",
    });
    expect(rows[3]).toEqual({
      time: "21:17",
      text: "Build Camera strip — cameras timed out after 30s",
      tone: "bad",
    });
    expect(rows[4].text).toBe(
      "Check Camera strip — skipped: Build Camera strip didn't finish",
    );
    expect(buildLogRows(FAILED, ["piece:1"])[3]).toEqual({
      time: "21:17",
      text: "Build Camera strip — left off",
      tone: "warn",
    });
    expect(buildLogLine(RUNNING)).toBe("In progress");
    expect(buildLogLine(FAILED)).toBe("Stopped on 1 step");
    expect(buildLogLine(DONE)).toBe("Finished in 6 min");
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

  test("a failure: Try again or leave it off; left off, it's built", () => {
    const chat = buildChat(FAILED);
    expect(chat.step).toEqual({
      label: "Builder couldn't finish Camera strip",
      status: "failed",
    });
    expect(chat.reply).toContain(
      "Camera strip didn't work — cameras timed out after 30s.",
    );
    expect(chat.reply).toContain("Try it again, or leave it off for now?");
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
    expect(buildLogRows(one).map((r) => r.text)).toEqual([
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
