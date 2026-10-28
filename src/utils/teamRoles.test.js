import {
  runTeamRole,
  findTeamRole,
  extractMatches,
  withoutMatches,
  teamSkipText,
  stopTeamRole,
} from "./teamRoles";

function setupBots({ team, record, events = [], throws = false }) {
  let listener = null;
  window.mainApi = {
    bots: {
      listDashTeam: jest.fn().mockResolvedValue(team),
      onStream: jest.fn((cb) => {
        listener = cb;
        return 7;
      }),
      removeListener: jest.fn(),
      run: jest.fn(async (botId) => {
        for (const event of events) listener && listener({ botId, event });
        if (throws) throw new Error("boom");
        return record;
      }),
    },
  };
  return window.mainApi.bots;
}

afterEach(() => {
  delete window.mainApi;
});

const scout = { id: "b_scout", role: "scout", name: "Scout", paused: false };

describe("runTeamRole (CRE-011 slice 4)", () => {
  test("runs the role's bot, streams its text and returns the run", async () => {
    const api = setupBots({
      team: [scout],
      events: [
        { type: "text", text: "Looking" },
        { type: "tool_call" },
        { type: "text", text: "Found it" },
      ],
      record: {
        status: "completed",
        output: "Found Algolia",
        model: "claude-haiku-4-5",
        usage: { inputTokens: 10 },
        cost: { usd: 0, includedInPlan: true },
      },
    });
    const seen = [];
    const res = await runTeamRole("scout", "find a widget", {
      onText: (t) => seen.push(t),
    });
    expect(api.run).toHaveBeenCalledWith("b_scout", "find a widget", false);
    expect(seen[0]).toBe("Looking");
    expect(seen[1]).toMatch(/Looking\s+Found it/);
    expect(res.status).toBe("completed");
    expect(res.output).toBe("Found Algolia");
    expect(res.model).toBe("claude-haiku-4-5");
    expect(api.removeListener).toHaveBeenCalledWith(7);
  });

  test("a paused or missing role is skipped", async () => {
    setupBots({ team: [{ ...scout, paused: true }] });
    expect(await runTeamRole("scout", "x")).toMatchObject({
      skipped: true,
      reason: "the Scout is paused",
    });
    setupBots({ team: [] });
    expect((await runTeamRole("checker", "x")).skipped).toBe(true);
    delete window.mainApi;
    expect((await runTeamRole("scout", "x")).skipped).toBe(true);
  });

  test("a run the runner skipped, or that threw, is reported", async () => {
    setupBots({ team: [scout], record: { skipped: true, reason: "busy" } });
    expect(await runTeamRole("scout", "x")).toMatchObject({
      skipped: true,
      reason: "busy",
    });
    setupBots({ team: [scout], throws: true });
    expect(await runTeamRole("scout", "x")).toMatchObject({
      status: "failed",
      error: "boom",
    });
  });

  test("findTeamRole", async () => {
    setupBots({ team: [scout] });
    expect((await findTeamRole("scout")).id).toBe("b_scout");
    expect(await findTeamRole("planner")).toBeNull();
  });
});

describe("extractMatches", () => {
  test("reads the matches and normalises them", () => {
    const text = `Here's what I found.
<matches>[{"source":"Registry","name":"Algolia Search","package":"@trops/algolia","why":"search box"},{"source":"Mine","name":"X"},{"name":""}]</matches>`;
    expect(extractMatches(text)).toEqual([
      {
        source: "Registry",
        name: "Algolia Search",
        package: "@trops/algolia",
        why: "search box",
      },
      { source: "Registry", name: "X", package: "", why: "" },
    ]);
    expect(withoutMatches(text)).toBe("Here's what I found.");
  });

  test("a bot match says it's a bot (Phase 2c-1)", () => {
    const text =
      '<matches>[{"kind":"bot","source":"Yours","name":"Inbox Digest","package":"bot_1","why":"same job"}]</matches>';
    expect(extractMatches(text)).toEqual([
      {
        kind: "bot",
        source: "Yours",
        name: "Inbox Digest",
        package: "bot_1",
        why: "same job",
      },
    ]);
  });

  test("an empty list, no tag, or bad JSON", () => {
    expect(extractMatches("<matches>[]</matches>")).toEqual([]);
    expect(extractMatches("nothing")).toBeNull();
    expect(extractMatches("<matches>{oops</matches>")).toBeNull();
  });
});

describe("runTeamRole — conversation and events (phase 4a)", () => {
  test("continues the session when asked, and passes events through", async () => {
    const api = setupBots({
      team: [scout],
      events: [{ type: "tool_call", name: "ask_role" }],
      record: { status: "completed", output: "ok" },
    });
    const events = [];
    await runTeamRole("scout", "more", {
      continueConversation: true,
      onEvent: (e) => events.push(e.type),
    });
    expect(api.run).toHaveBeenCalledWith("b_scout", "more", true);
    expect(events).toEqual(["tool_call"]);
  });
});

describe("why a Dash team role didn't run (QA 2026-10-28)", () => {
  test("busy is busy — never 'turn it on'", () => {
    const r = teamSkipText("a run is already in progress", "Planner");
    expect(r.busy).toBe(true);
    expect(r.text).toMatch(/still working on an earlier request/);
    expect(r.text).not.toMatch(/Turn/);
  });
  test("paused says turn it on; anything else says why", () => {
    expect(teamSkipText("the Planner is paused").text).toMatch(
      /is paused\. Turn it on/,
    );
    expect(teamSkipText("over budget").text).toBe(
      "The Planner can't run right now: over budget.",
    );
  });
  test("stopTeamRole stops the role and what it waits on — the others first", async () => {
    const stop = jest.fn().mockResolvedValue({});
    window.mainApi = {
      bots: {
        listDashTeam: jest.fn().mockResolvedValue([
          { id: "b_planner", role: "planner", name: "Planner" },
          { id: "b_builder", role: "builder", name: "Builder" },
        ]),
        stop,
      },
    };
    expect(await stopTeamRole("planner")).toBe(true);
    expect(stop.mock.calls.map((c) => c[0])).toEqual([
      "b_builder",
      "b_planner",
    ]);
    delete window.mainApi;
  });
});
