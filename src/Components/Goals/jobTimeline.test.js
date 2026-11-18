import {
  eventText,
  runChecksLine,
  askedText,
  checkResults,
  jobStateText,
  durationText,
  handedOnText,
  isBotJob,
  jobLine,
  jobTimeline,
  nextText,
} from "./jobTimeline";

// A bot's job, as the ledger keeps it (electron/bots/checkJobs.js): the
// bot's first answer, a check that failed, the bot's second answer, the
// checks passing, then waiting for you.
const T = 1_700_000_000_000;
const flow = {
  kind: "bot-checks",
  botId: "coord",
  onFail: "retry",
  handsOn: "answer",
  maxRounds: 3,
  steps: [
    { id: "step_work", kind: "bot", name: "Coordinator", botId: "coord" },
    { id: "step_c1", kind: "check", name: "Every event is in it" },
    {
      id: "step_c2",
      kind: "bot",
      name: "Reads clearly",
      botId: "rev",
      judgment: true,
    },
    { id: "step_c3", kind: "you", name: "You approve" },
  ],
};
const rec = (stepId, status, at, extra = {}) => ({
  stepId,
  status,
  at: T + at * 1000,
  round: 1,
  ...extra,
});
const history = [
  rec("step_work", "passed", 60, {
    said: "bot",
    botName: "Coordinator",
    output: { answer: "Tomorrow: school 8:15." },
  }),
  rec("step_c1", "failed", 62, {
    said: "dash",
    by: "dash",
    summary: 'Missing "Dentist 3:30".',
  }),
  rec("step_work", "passed", 110, {
    said: "bot",
    botName: "Coordinator",
    round: 2,
    output: {
      answer: "Tomorrow: school 8:15. Dentist 3:30.\n\nRain after 2pm.",
    },
  }),
  rec("step_c1", "passed", 112, { said: "dash", by: "dash", round: 2 }),
  rec("step_c2", "passed", 130, {
    said: "bot",
    botName: "Editor",
    round: 2,
    summary: "Clear and matches the calendar.",
  }),
];
const job = (taskPatch = {}, goalPatch = {}) => ({
  id: "goal_1",
  title: "Coordinator: tomorrow's brief",
  body: "Put together tomorrow's brief.",
  createdAt: T,
  source: { kind: "lead", ref: "lead1" },
  createdBy: { botId: "coord", botName: "Coordinator" },
  flow,
  runs: [
    // Run times are ISO strings (BotRunner).
    {
      startedAt: new Date(T + 12000).toISOString(),
      endedAt: new Date(T + 60000).toISOString(),
    },
    {
      startedAt: new Date(T + 69000).toISOString(),
      endedAt: new Date(T + 110000).toISOString(),
    },
    // Another bot's run that ended nearer try 2: not the bot's own.
    {
      botId: "other",
      startedAt: new Date(T + 100000).toISOString(),
      endedAt: new Date(T + 110500).toISOString(),
    },
    {
      startedAt: T + 115000,
      endedAt: T + 129000,
      checks: { goalId: "goal_1", state: "review" },
    },
  ],
  tasks: [
    {
      id: "t1",
      status: "ready",
      stepId: "step_c3",
      round: 2,
      maxRounds: 3,
      history,
      ...taskPatch,
    },
  ],
  ...goalPatch,
});
const nameOf = (id) => (id === "lead1" ? "Home lead" : null);

describe("jobTimeline", () => {
  it("only for a bot's job", () => {
    expect(isBotJob(job())).toBe(true);
    expect(isBotJob({ flow: { kind: "flow" } })).toBe(false);
    expect(jobTimeline({ flow: { steps: [] } })).toEqual([]);
  });

  it("reads top to bottom: asked, each try, its checks, now", () => {
    const rows = jobTimeline(job(), { nameOf });
    expect(rows.map((r) => r.type)).toEqual([
      "asked",
      "try",
      "failed",
      "try",
      "passed",
      "now",
    ]);
    expect(rows[0]).toMatchObject({
      who: "Home lead",
      kind: "lead",
      text: "Put together tomorrow's brief.",
    });
    expect(rows[1]).toMatchObject({
      n: 1,
      ms: 48000,
      answer: "Tomorrow: school 8:15.",
    });
    expect(rows[2]).toMatchObject({
      name: "Every event is in it",
      reason: 'Missing "Dentist 3:30".',
      then: "back",
    });
    expect(rows[3]).toMatchObject({ n: 2, ms: 41000 });
    // The reviewer's run isn't taken for a try.
    expect(rows[4].names).toEqual([
      { name: "Every event is in it" },
      {
        name: "Reads clearly",
        reviewer: "Editor",
        said: "Clear and matches the calendar.",
      },
    ]);
  });

  it("waiting for you: the work being approved is on it", () => {
    const now = jobTimeline(job()).pop();
    expect(now).toMatchObject({
      state: "waiting",
      round: 2,
      maxRounds: 3,
      work: "Tomorrow: school 8:15. Dentist 3:30.\n\nRain after 2pm.",
    });
    const summary = jobTimeline(
      job({}, { flow: { ...flow, handsOn: "summary" } }),
    ).pop();
    expect(summary.work).toBe("Tomorrow: school 8:15. Dentist 3:30.");
  });

  it("your send-back shows with its reason, then the next try", () => {
    const sent = [
      ...history,
      {
        by: "you",
        status: "send-back",
        summary: "Add the weather",
        at: T + 140000,
      },
    ];
    const rows = jobTimeline(
      job({ history: sent, status: "new", stepId: "step_work", round: 3 }),
    );
    expect(rows.slice(-2)).toEqual([
      {
        type: "you",
        action: "send-back",
        reason: "Add the weather",
        at: T + 140000,
      },
      expect.objectContaining({ type: "now", state: "working", round: 3 }),
    ]);
  });

  it("a fail goes where its record says, even after you gave it one more try", () => {
    const outOfTries = [
      ...history.slice(0, 1),
      { ...history[1], to: "needs-you", stopped: true },
      { by: "you", status: "one-more-round", to: "new", at: T + 70000 },
    ];
    const rows = jobTimeline(
      job({ history: outOfTries, status: "new", stepId: "step_work" }),
    );
    expect(rows.find((r) => r.type === "failed").then).toBe("you");
    expect(rows.find((r) => r.type === "you").action).toBe("one-more-round");
  });

  it("onFail stop: it stopped, and Dash's close isn't shown as yours", () => {
    const stopped = [
      ...history.slice(0, 1),
      { ...history[1], to: "needs-you" },
      { by: "you", status: "close", to: "closed", at: T + 63000 },
    ];
    const rows = jobTimeline(
      job(
        { history: stopped, status: "closed" },
        { flow: { ...flow, onFail: "stop" }, closed: true },
      ),
    );
    expect(rows.find((r) => r.type === "failed").then).toBe("stop");
    expect(rows.some((r) => r.type === "you")).toBe(false);
    expect(rows.pop().state).toBe("closed");
  });

  it("out of tries: Dash fails it, and says so in the list and to the lead (DASH-12)", () => {
    const failedOut = [
      ...history.slice(0, 3),
      rec("step_c1", "failed", 112, {
        by: "dash",
        summary: "Still missing",
        to: "needs-you",
      }),
      {
        by: "you",
        status: "close",
        to: "closed",
        dash: true,
        failed: true,
        at: T + 113000,
      },
    ];
    const g = job({ history: failedOut, status: "closed" }, { closed: true });
    const rows = jobTimeline(g);
    expect(rows.filter((r) => r.type === "failed")[1].then).toBe("stop");
    expect(rows.some((r) => r.type === "you")).toBe(false);
    const now = rows.pop();
    expect(now.failedOut).toBe(true);
    expect(jobLine(g)).toBe("Coordinator · the lead asked · failed on try 2");
    expect(jobStateText(g)).toBe("It failed on try 2: nothing was handed on");
  });

  it("an old job that ran out of tries before DASH-12 still came to you", () => {
    const old = [
      ...history.slice(0, 3),
      rec("step_c1", "failed", 112, {
        by: "dash",
        summary: "Still missing",
        to: "needs-you",
      }),
    ];
    const rows = jobTimeline(
      job({ history: old, status: "needs-you", stepId: "step_c1" }),
    );
    expect(rows.filter((r) => r.type === "failed")[1].then).toBe("you");
    expect(rows.pop().state).toBe("needs-you");
  });

  it("your own Close after it came to you shows as yours", () => {
    const closed = [
      ...history.slice(0, 1),
      { ...history[1], to: "needs-you" },
      { by: "you", status: "close", to: "closed", at: T + 63000 },
    ];
    const rows = jobTimeline(
      job({ history: closed, status: "closed" }, { closed: true }),
    );
    expect(rows.find((r) => r.type === "failed").then).toBe("you");
    expect(rows.find((r) => r.type === "you").action).toBe("close");
    expect(rows.pop().failedOut).toBe(false);
  });

  it("came to you without a failed check says so", () => {
    const noRecord = [
      ...history.slice(0, 1),
      rec("step_c2", "needs-you", 70, { by: "dash", summary: "No record." }),
    ];
    const g = job({
      history: noRecord,
      status: "needs-you",
      stepId: "step_c2",
    });
    expect(jobStateText(g)).toBe("It came to you");
    expect(jobLine(g)).toBe("Coordinator · the lead asked · came to you");
  });

  it("done, closed, and checking a first try", () => {
    expect(jobTimeline(job({ status: "done" })).pop().state).toBe("done");
    expect(jobTimeline(job({}, { closed: true })).pop().state).toBe("closed");
    const first = jobTimeline(
      job({ history: history.slice(0, 1), status: "new", stepId: "step_c1" }),
    );
    expect(first.pop().state).toBe("checking");
  });

  it("who asked, in the list's words", () => {
    expect(askedText(job())).toBe("the lead asked");
    expect(askedText(job({}, { source: { kind: "schedule" } }))).toBe(
      "its schedule",
    );
    expect(askedText(job({}, { source: { kind: "manual" } }))).toBe(
      "you asked",
    );
  });

  it("the list's line", () => {
    expect(jobLine(job())).toBe(
      "Coordinator · the lead asked · waiting for you",
    );
    expect(jobLine(job({ status: "done" }))).toBe(
      "Coordinator · the lead asked · passed on try 2",
    );
    expect(jobLine(job({ status: "done", history: history.slice(0, 1) }))).toBe(
      "Coordinator · the lead asked · passed first try",
    );
  });

  it("where it goes next", () => {
    const targets = [
      { type: "bot", name: "Home Bot" },
      { type: "widget", name: "Bot results" },
    ];
    expect(nextText(job(), "waiting", targets)).toBe(
      "Next: Home Bot gets it, Bot results shows it and the lead tells you.",
    );
    expect(nextText(job(), "done", targets)).toBe(
      "Handed on: Home Bot got it, Bot results shows it and the lead was told.",
    );
    expect(
      nextText(job({}, { source: { kind: "schedule" } }), "waiting", []),
    ).toBe("Nothing after it: the checks only prove its own work.");
  });

  it("summary hands on the first paragraph; durations read short", () => {
    expect(handedOnText("A\nB\n\nC", "summary")).toBe("A\nB");
    expect(handedOnText("A\n\nC")).toBe("A\n\nC");
    expect(durationText(48000)).toBe("48s");
    expect(durationText(125000)).toBe("2m 5s");
    expect(durationText(null)).toBe("");
  });

  it("each check's result on its try, and where the job is", () => {
    expect(checkResults(job())).toEqual([
      {
        name: "Every event is in it",
        status: "failed",
        tryN: 1,
        reason: 'Missing "Dentist 3:30".',
      },
      { name: "Every event is in it", status: "passed", tryN: 2, reason: "" },
      { name: "Reads clearly", status: "passed", tryN: 2, reason: "" },
    ]);
    expect(jobStateText(job())).toBe(
      "Its work is waiting for you to approve it",
    );
    expect(jobStateText(job({ status: "done" }))).toBe("Passed and handed on");
    const approved = [
      ...history,
      { by: "you", status: "done", at: T + 200000 },
    ];
    expect(jobStateText(job({ status: "done", history: approved }))).toBe(
      "Approved and handed on",
    );
  });
});

describe("the event a finished job sent (DASH-12)", () => {
  it("names who listens, or says nothing does yet", () => {
    expect(
      eventText("Writer", "failed", [{ type: "bot", name: "Fixer" }]),
    ).toBe("Writer's Failed event went out → Fixer runs on it");
    expect(eventText("Writer", "failed", [])).toBe(
      "Writer's Failed event went out · nothing listens for it yet",
    );
    expect(
      eventText("Writer", "completed", [
        { type: "bot", name: "Sender" },
        { type: "widget", name: "Bot results" },
      ]),
    ).toBe(
      "Writer's Completed event went out → Sender runs on it and Bot results shows it",
    );
  });
});

describe("a run's checks, for its Activity (DASH-13)", () => {
  const botJob = (task, extra = {}) => ({
    id: "g1",
    flow: {
      kind: "bot-checks",
      botId: "b1",
      steps: [
        { id: "step_work", kind: "bot", name: "Writer", botId: "b1" },
        { id: "step_c1", kind: "check", name: "Has a title" },
      ],
    },
    tasks: [{ maxRounds: 3, ...task }],
    ...extra,
  });
  const work = { stepId: "step_work", status: "passed" };
  const fail = { stepId: "step_c1", status: "failed", summary: "No title" };

  it("says nothing for a run that wasn't held", () => {
    expect(runChecksLine({ status: "completed" })).toBe(null);
  });

  it("being checked, sent back, passed, replaced", () => {
    expect(
      runChecksLine(
        { checks: { state: "checking" } },
        botJob({ status: "new", stepId: "step_c1", history: [work] }),
      ),
    ).toEqual({ state: "info", text: "Held for its checks · being checked" });
    expect(
      runChecksLine(
        { checks: { state: "checking" } },
        botJob({
          status: "new",
          stepId: "step_work",
          history: [work, { ...fail, to: "step_work" }],
        }),
      ).text,
    ).toBe("Held for its checks · sent back: trying again");
    expect(runChecksLine({ checks: { state: "passed" } }).text).toBe(
      "Held for its checks · passed: handed on",
    );
    expect(runChecksLine({ checks: { state: "replaced" } }).state).toBe(
      "neutral",
    );
  });

  it("failed: the check and the try, in red", () => {
    const g = botJob(
      {
        status: "closed",
        stepId: "step_c1",
        history: [
          work,
          { ...fail, to: "step_work" },
          work,
          { ...fail, to: "needs-you" },
          { by: "you", status: "close", dash: true, failed: true },
        ],
      },
      { closed: true },
    );
    expect(runChecksLine({ checks: { state: "stopped" } }, g)).toEqual({
      state: "error",
      text: 'Held for its checks · didn\'t pass "Has a title" on try 2: it failed, nothing was handed on',
    });
    // Its job gone: still says it was closed.
    expect(runChecksLine({ checks: { state: "stopped" } }).text).toBe(
      "Held for its checks · closed: nothing was handed on",
    );
  });
});

describe("an earlier try, in Activity (DASH-13)", () => {
  it("says what failed on it", () => {
    const goal = {
      id: "g1",
      closed: true,
      flow: {
        kind: "bot-checks",
        botId: "b1",
        steps: [
          { id: "step_work", kind: "bot", name: "Writer", botId: "b1" },
          { id: "step_c1", kind: "check", name: "Has a title" },
        ],
      },
      tasks: [
        {
          status: "closed",
          stepId: "step_c1",
          maxRounds: 3,
          history: [
            { stepId: "step_work", status: "passed" },
            { stepId: "step_c1", status: "failed", to: "step_work" },
            { stepId: "step_work", status: "passed" },
            { stepId: "step_c1", status: "failed", to: "needs-you" },
            { by: "you", status: "close", dash: true, failed: true },
          ],
        },
      ],
    };
    const run = { checks: { state: "stopped" } };
    expect(runChecksLine(run, goal, 1)).toEqual({
      state: "neutral",
      text: 'Try 1 · didn\'t pass "Has a title": sent back',
    });
    expect(runChecksLine(run, goal, 2).state).toBe("error");
  });
});
