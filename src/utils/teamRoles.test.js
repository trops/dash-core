import {
  runTeamRole,
  findTeamRole,
  extractMatches,
  withoutMatches,
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
