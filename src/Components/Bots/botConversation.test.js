import {
  buildConversation,
  botStatus,
  attentionCount,
  triggerLabel,
  errorNextSteps,
} from "./botConversation";

const run = (over) => ({
  trigger: "manual",
  status: "completed",
  startedAt: "2026-10-02T09:00:00.000Z",
  endedAt: "2026-10-02T09:00:14.000Z",
  prompt: "",
  output: "",
  toolCalls: [],
  continued: false,
  ...over,
});

describe("buildConversation — runs become chat turns", () => {
  it("a manual run: your prompt, its tool calls, then the answer", () => {
    const turns = buildConversation([
      run({
        prompt: "Check my inbox",
        output: "2 need attention",
        toolCalls: [{ tool: "search_emails", provider: "Gmail New", ok: true }],
      }),
    ]);
    expect(turns.map((t) => t.kind)).toEqual(["user", "tools", "bot"]);
    expect(turns[0].text).toBe("Check my inbox");
    expect(turns[1].calls[0].tool).toBe("search_emails");
    expect(turns[2].text).toBe("2 need attention");
  });

  it("a reply continues the thread; a fresh run starts a new one", () => {
    const turns = buildConversation([
      run({ prompt: "First", output: "A" }),
      run({
        prompt: "Follow-up",
        output: "B",
        continued: true,
        trigger: "reply",
      }),
      run({ prompt: "Fresh", output: "C" }),
    ]);
    const dividers = turns.filter((t) => t.kind === "divider");
    expect(dividers).toHaveLength(1); // only before "Fresh"
    expect(turns.indexOf(dividers[0])).toBe(4);
  });

  it("scheduled and event runs show what started them, not the raw prompt", () => {
    const turns = buildConversation([
      run({ trigger: "schedule", prompt: "prepare digest", output: "Done" }),
      run({
        trigger: "event",
        prompt: "An event you subscribe to just fired. <event_payload>…",
        output: "Posted",
      }),
    ]);
    expect(turns[0]).toMatchObject({ kind: "system", text: "Scheduled run" });
    const event = turns.find((t) => t.kind === "system" && t !== turns[0]);
    expect(event.text).toBe("Triggered by an event");
    expect(JSON.stringify(turns)).not.toMatch(/event_payload/);
  });

  it("a failed run shows its error; an unreadable answer says so", () => {
    const turns = buildConversation([
      run({ prompt: "Sync", status: "failed", error: "Token expired" }),
      run({ prompt: "Again", output: null, outputUnavailable: true }),
    ]);
    expect(turns.find((t) => t.kind === "error").text).toBe("Token expired");
    expect(turns.find((t) => t.kind === "bot" && t.unavailable)).toBeTruthy();
  });

  it("appends the run in progress (streamed text + tools)", () => {
    const turns = buildConversation([run({ prompt: "Hi", output: "Hello" })], {
      live: {
        prompt: "What now?",
        text: "Working",
        toolCalls: [{ tool: "read_email", provider: "Gmail New", ok: null }],
        continued: true,
      },
    });
    const last = turns.slice(-3);
    expect(last.map((t) => t.kind)).toEqual(["user", "tools", "bot"]);
    expect(last[2]).toMatchObject({ text: "Working", pending: true });
  });

  it("handles no runs", () => {
    expect(buildConversation([])).toEqual([]);
    expect(buildConversation(null)).toEqual([]);
  });
});

describe("botStatus", () => {
  const base = {
    botId: "b1",
    running: [],
    paused: { global: false, bots: [] },
    approvals: [],
    lastRun: null,
  };

  it("Idle by default", () => {
    expect(botStatus(base)).toBe("Idle");
  });

  it("Needs approval beats everything", () => {
    expect(
      botStatus({
        ...base,
        running: ["b1"],
        approvals: [{ id: "a", request: { botId: "b1" } }],
      }),
    ).toBe("Needs approval");
  });

  it("Running, Paused, then Failed (last run)", () => {
    expect(botStatus({ ...base, running: ["b1"] })).toBe("Running");
    expect(
      botStatus({ ...base, paused: { global: false, bots: ["b1"] } }),
    ).toBe("Paused");
    expect(botStatus({ ...base, paused: { global: true, bots: [] } })).toBe(
      "Paused",
    );
    expect(botStatus({ ...base, lastRun: { status: "failed" } })).toBe(
      "Failed",
    );
    expect(botStatus({ ...base, lastRun: { status: "completed" } })).toBe(
      "Idle",
    );
  });
});

describe("attentionCount — the Bots switch badge", () => {
  it("counts pending approvals for the team plus bots whose last run failed", () => {
    expect(
      attentionCount({
        botIds: ["b1", "b2", "b3"],
        approvals: [
          { id: "a1", request: { botId: "b1" } },
          { id: "a2", request: { botId: "b1" } },
          { id: "a3", request: { botId: "other-team" } },
        ],
        lastRunByBot: { b2: { status: "failed" }, b3: { status: "completed" } },
      }),
    ).toBe(3);
  });

  it("zero when nothing needs you", () => {
    expect(
      attentionCount({ botIds: [], approvals: [], lastRunByBot: {} }),
    ).toBe(0);
  });
});

describe("triggerLabel (TEAM-011 gaps)", () => {
  const names = { b0: "Lead Scout", b1: "Inbox Watch" };
  const nameOf = (id) => names[id] || id;

  it("names the event a run was triggered by", () => {
    expect(
      triggerLabel(
        {
          trigger: "event",
          source: {
            eventType: "Gmail[w1].newEmail",
            label: "Gmail › new email",
            chain: [],
          },
        },
        nameOf,
      ),
    ).toBe("Triggered by Gmail › new email");
  });

  it("falls back to the event type, then to the old text", () => {
    expect(
      triggerLabel({
        trigger: "event",
        source: { eventType: "X[1].ping", label: null },
      }),
    ).toBe("Triggered by X[1].ping");
    expect(triggerLabel({ trigger: "event" })).toBe("Triggered by an event");
  });

  it("shows the bot chain with names", () => {
    expect(
      triggerLabel(
        {
          trigger: "event",
          source: {
            eventType: "bot:local/inbox-watch[b1].completed",
            label: "Inbox Watch › completed",
            originBotId: "b1",
            chain: ["b0", "b1"],
          },
        },
        nameOf,
      ),
    ).toBe("Triggered by Inbox Watch › completed · Lead Scout → Inbox Watch");
  });

  it("schedules and typed runs are unchanged", () => {
    expect(triggerLabel({ trigger: "schedule" })).toBe("Scheduled run");
    expect(triggerLabel({ trigger: "manual" })).toBe(null);
  });

  it("buildConversation uses it, and error turns carry the prompt to run again", () => {
    const turns = buildConversation(
      [
        {
          trigger: "event",
          source: { eventType: "e", label: "Gmail › new email", chain: [] },
          status: "failed",
          error: "boom",
          prompt: "EVENT PROMPT",
        },
      ],
      { nameOf },
    );
    expect(turns[0]).toMatchObject({
      kind: "system",
      text: "Triggered by Gmail › new email",
    });
    expect(turns[1]).toMatchObject({
      kind: "error",
      text: "boom",
      prompt: "EVENT PROMPT",
    });
  });
});

describe("errorNextSteps (TEAM-011 gaps)", () => {
  const actions = (text, opts) =>
    errorNextSteps(text, opts).map((s) => s.action);

  it("always offers Run again (Ask again for a lead)", () => {
    expect(errorNextSteps("Something odd happened")).toEqual([
      { action: "run-again", label: "Run again" },
    ]);
    expect(errorNextSteps("x", { isLead: true })[0].label).toBe("Ask again");
  });

  it("points provider problems at Settings › Providers", () => {
    for (const text of [
      "Slack couldn't start: Authentication required: …. Check its settings in Settings › Providers.",
      "Your credit balance is too low to access the Anthropic API.",
      "401 invalid x-api-key",
      "Invalid API key provided",
      "Token expired",
    ]) {
      expect(actions(text)).toEqual(["run-again", "open-settings"]);
    }
    expect(errorNextSteps("Token expired")[1]).toEqual({
      action: "open-settings",
      section: "providers",
      label: "Open Settings › Providers",
    });
  });

  it("nothing for an empty error", () => {
    expect(errorNextSteps("")).toEqual([]);
  });
});

describe("via the AI Assistant (TEAM-004)", () => {
  it("labels a lead question the Assistant asked, then shows the question", () => {
    const turns = buildConversation([
      {
        trigger: "ask",
        via: "assistant",
        status: "completed",
        prompt: "Anything urgent?",
        output: "No.",
      },
    ]);
    expect(turns[0]).toMatchObject({
      kind: "system",
      text: "Asked via the AI Assistant",
    });
    expect(turns[1]).toMatchObject({ kind: "user", text: "Anything urgent?" });
    expect(turns[2]).toMatchObject({ kind: "bot", text: "No." });
  });

  it("a question the user typed has no label", () => {
    const turns = buildConversation([
      { trigger: "ask", status: "completed", prompt: "Hi", output: "Hello" },
    ]);
    expect(turns[0]).toMatchObject({ kind: "user", text: "Hi" });
  });
});

describe("answer turns keep their run's times (5b)", () => {
  it("carries startedAt / endedAt on the bot turn", () => {
    const turns = buildConversation([
      {
        trigger: "ask",
        status: "completed",
        prompt: "Add a bot",
        output: "Drafted it.",
        startedAt: "2026-10-03T10:00:00.000Z",
        endedAt: "2026-10-03T10:00:20.000Z",
      },
    ]);
    const answer = turns.find((t) => t.kind === "bot");
    expect(answer.startedAt).toBe("2026-10-03T10:00:00.000Z");
    expect(answer.endedAt).toBe("2026-10-03T10:00:20.000Z");
  });
});
