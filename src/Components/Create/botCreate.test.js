/**
 * botCreate — Create › Bot through the Dash team (consolidation Phase 2c-1):
 * the step bar, Where, the Scout's and Planner's requests, and a found bot
 * as the plan's one bot.
 */
import {
  BOT_STEPS,
  botStepIndex,
  whereOptions,
  forWhere,
  botPlanRequest,
  scoutBotRequest,
  pieceFromBot,
  pieceFromStarter,
  botSeed,
} from "./botCreate";

const brief = { id: "7", name: "Morning Brief" };

test("the steps: Describe · Find · Plan · Build · Done", () => {
  expect(BOT_STEPS).toEqual(["Describe", "Find", "Plan", "Build", "Done"]);
  expect(botStepIndex({})).toBe(0);
  expect(botStepIndex({ scout: true })).toBe(1);
  expect(botStepIndex({ plan: true })).toBe(2);
  expect(botStepIndex({ plan: true, buildStatus: "running" })).toBe(3);
  expect(botStepIndex({ plan: true, buildStatus: "done" })).toBe(4);
});

test("Where: No dashboard, then each dashboard by name", () => {
  expect(
    whereOptions([
      { id: 7, name: "Morning Brief" },
      { id: 8, label: "Work" },
    ]),
  ).toEqual([
    { value: "", label: "No dashboard" },
    { value: "7", label: "Morning Brief" },
    { value: "8", label: "Work" },
  ]);
});

test("the plan goes where Where says — and with no dashboard, no results card", () => {
  const plan = {
    summary: "s",
    dashboard: { id: "9", name: "Other" },
    pieces: [{ kind: "bot", name: "B", source: "new", showResults: true }],
  };
  expect(forWhere(plan, brief).dashboard).toEqual(brief);
  expect(forWhere(plan, brief).pieces[0].showResults).toBe(true);
  const none = forWhere(plan, null);
  expect(none.dashboard).toBeUndefined();
  expect(none.pieces[0].showResults).toBe(false);
  // The original is left as it was.
  expect(plan.dashboard.id).toBe("9");
});

test("the Planner plans exactly one bot, for that dashboard or none", () => {
  const on = botPlanRequest("Summarize my email", brief);
  expect(on).toMatch(/^Summarize my email\n\n\(Plan exactly one new bot/);
  expect(on).toMatch(/"dashboard": \{"id": "7", "name": "Morning Brief"\}/);
  expect(on).toMatch(/ask whether to show its results on Morning Brief/);
  const none = botPlanRequest("Summarize my email", null);
  expect(none).toMatch(/isn't on a dashboard: leave dashboard out/);
  expect(none).toMatch(/showResults false/);
});

test("the Scout searches bots and says how to hand them back", () => {
  const text = scoutBotRequest("Summarize my email");
  expect(text).toMatch(/search_library with what: "bots"/);
  expect(text).toMatch(/"kind": "bot"/);
  expect(text).toMatch(/the bot's id for one of theirs/);
});

test("one of your bots as a copy: its instructions, tools, schedule and results", () => {
  const bot = {
    id: "bot_1",
    name: "Inbox Digest",
    instructions: "Summarize unread mail.",
    mcpServers: ["Work Gmail"],
    toolSelections: { "Work Gmail": ["search", "read"] },
    schedules: [{ cron: "0 9 * * *", prompt: "" }],
    publishes: [{ name: "summary", label: "Summary" }],
  };
  expect(pieceFromBot(bot, brief)).toEqual({
    kind: "bot",
    name: "Inbox Digest",
    source: "new",
    instructions: "Summarize unread mail.",
    tools: [{ provider: "Work Gmail", tools: ["search", "read"] }],
    schedule: { cron: "0 9 * * *" },
    results: [{ name: "summary", label: "Summary" }],
    // A results card is the user's call — not added unasked.
    showResults: false,
    notes: "A copy of your Inbox Digest bot",
  });
});

test("a copy beside its original is '(copy)'; one that ran on events says so", () => {
  const bot = { id: "b", name: "Inbox Digest", instructions: "x" };
  expect(pieceFromBot({ ...bot, workspaceId: "7" }, brief).name).toBe(
    "Inbox Digest (copy)",
  );
  expect(pieceFromBot(bot, null).name).toBe("Inbox Digest (copy)");
  expect(pieceFromBot({ ...bot, workspaceId: "8" }, brief).name).toBe(
    "Inbox Digest",
  );
  expect(
    pieceFromBot({ ...bot, subscriptions: [{ eventType: "x" }] }, brief).notes,
  ).toMatch(/It also ran on events; this copy runs on its schedule/);
});

test("a registry bot: the one with that name in its dashboard package", () => {
  const config = {
    team: {
      members: [
        {
          role: "triager",
          embedded: {
            name: "Inbox Triager",
            instructions: "Triage.",
            providers: [{ type: "gmail", tools: ["search"] }],
          },
        },
      ],
    },
  };
  const piece = pieceFromStarter(
    config,
    { displayName: "Inbox Triage" },
    "Inbox Triager",
  );
  expect(piece).toMatchObject({
    kind: "bot",
    name: "Inbox Triager",
    source: "new",
    instructions: "Triage.",
    tools: [{ provider: "gmail", tools: ["search"] }],
    showResults: false,
    notes: "From the Inbox Triage dashboard package",
  });
  // Its package's widget events aren't here to start it.
  expect(piece.on).toBeUndefined();
  expect(pieceFromStarter(config, {}, "Nope")).toBeNull();
});

test("a found bot opens as the plan, shown at once — the Planner isn't asked", () => {
  const piece = { kind: "bot", name: "Inbox Digest", source: "new" };
  const seed = botSeed(piece, brief);
  expect(seed.request).toBeNull();
  expect(seed.label).toBe("Use Inbox Digest on Morning Brief");
  expect(seed.plan).toEqual({
    summary: "Use Inbox Digest on Morning Brief",
    dashboard: brief,
    pieces: [piece],
  });
  expect(botSeed(piece, null).label).toBe("Use a copy of Inbox Digest");
});
