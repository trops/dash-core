import {
  buildConversation,
  botStatus,
  attentionCount,
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
