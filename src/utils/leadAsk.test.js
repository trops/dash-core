/**
 * askTeamLead (create-entry 5e-2a): Create's Ask box sends a question
 * straight to a team lead and streams its answer.
 */
import { askTeamLead, skipReason } from "./leadAsk";

const LEAD = {
  botId: "b_lead",
  leadName: "Daily Brief Lead",
  dashboardName: "Daily Brief",
};

function api(over = {}) {
  let listener = null;
  window.mainApi = {
    bots: {
      onStream: jest.fn((fn) => {
        listener = fn;
        return 7;
      }),
      removeListener: jest.fn(),
      askLead: jest.fn(async () => {
        listener({ botId: "other", event: { type: "text", text: "nope" } });
        listener({ botId: "b_lead", event: { type: "text", text: "No." } });
        return { status: "completed", output: "No.", model: "m" };
      }),
      ...over,
    },
  };
  return window.mainApi.bots;
}

afterEach(() => {
  delete window.mainApi;
});

test("asks the lead directly, labelled from Create, streaming its text", async () => {
  const bots = api();
  const onText = jest.fn();
  const res = await askTeamLead(LEAD, "Anything urgent?", {
    onText,
    continueConversation: true,
  });
  expect(bots.askLead).toHaveBeenCalledWith(
    "b_lead",
    "Anything urgent?",
    true,
    "create",
    // No conversation given: none recorded on the bots it asks.
    null,
  );
  expect(onText).toHaveBeenCalledTimes(1);
  expect(onText).toHaveBeenCalledWith("No.");
  expect(res).toMatchObject({ status: "completed", output: "No." });
  expect(bots.removeListener).toHaveBeenCalledWith(7);
});

test("a paused lead is asked: the user's message goes through", async () => {
  const bots = api();
  await askTeamLead({ ...LEAD, paused: true }, "Hi");
  expect(bots.askLead).toHaveBeenCalled();
});

test("why a skipped run didn't start, in the user's words", () => {
  expect(skipReason("Daily Brief Lead", "all bots are paused")).toMatch(
    /^All bots are paused/,
  );
  expect(skipReason("Daily Brief Lead", "this bot is over its budget")).toMatch(
    /^Daily Brief Lead is over its budget/,
  );
  expect(skipReason("Daily Brief Lead", "a run is in progress")).toMatch(
    /busy with another run/,
  );
});

test("an over-budget or busy lead isn't asked", async () => {
  const bots = api();
  for (const state of [{ overBudget: true }, { running: true }]) {
    const res = await askTeamLead({ ...LEAD, ...state }, "Hi");
    expect(res.skipped).toBe(true);
    expect(res.reason).toMatch(/^Daily Brief Lead is /);
  }
  expect(bots.askLead).not.toHaveBeenCalled();
});

test("a run the lead skipped says it's busy; errors come back as failed", async () => {
  api({ askLead: jest.fn().mockResolvedValue({ skipped: true }) });
  expect(await askTeamLead(LEAD, "Hi")).toEqual({
    skipped: true,
    reason:
      "Daily Brief Lead is busy with another run — try again when it finishes.",
  });
  api({ askLead: jest.fn().mockRejectedValue(new Error("boom")) });
  expect(await askTeamLead(LEAD, "Hi")).toEqual({
    status: "failed",
    error: "boom",
  });
});

test("no lead or no bots API → skipped", async () => {
  expect((await askTeamLead(null, "Hi")).skipped).toBe(true);
  expect((await askTeamLead(LEAD, "Hi")).reason).toBe(
    "Team leads aren't available here.",
  );
});
