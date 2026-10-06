/**
 * leadMessages — pure helpers for messaging a team lead directly from the
 * AI Assistant (bot-teams TEAM-013).
 */
import {
  leadLabel,
  buildLlmHistory,
  availabilityNotice,
  hasLeadSession,
  filterRecipients,
  ASSISTANT_RECIPIENT,
} from "./leadMessages";

const lead = {
  botId: "lead_1",
  leadName: "Daily Brief Lead",
  dashboardName: "Daily Brief",
  dashboardLabel: "Daily Brief",
};

describe("leadLabel", () => {
  test("names the lead and its dashboard", () => {
    expect(leadLabel(lead)).toBe("Daily Brief Lead · Daily Brief");
  });

  test("prefers the disambiguated dashboard label", () => {
    expect(leadLabel({ ...lead, dashboardLabel: "Daily Brief (2)" })).toBe(
      "Daily Brief Lead · Daily Brief (2)",
    );
  });
});

describe("buildLlmHistory (AC10)", () => {
  test("passes ordinary messages through as { role, content }", () => {
    const msgs = [
      { id: "1", role: "user", content: "hi", hidden: true },
      { id: "2", role: "assistant", content: [{ type: "text", text: "hey" }] },
    ];
    expect(buildLlmHistory(msgs)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "hey" }] },
    ]);
  });

  test("folds a lead exchange into one labelled user-role context message", () => {
    const msgs = [
      { id: "1", role: "assistant", content: [{ type: "text", text: "hey" }] },
      { id: "2", role: "user", content: "What failed today?", to: lead },
      {
        id: "3",
        role: "lead",
        from: lead,
        content: "The inbox bot failed twice.",
      },
      { id: "4", role: "user", content: "Summarise what the lead said" },
    ];
    const history = buildLlmHistory(msgs);
    expect(history).toHaveLength(2);
    expect(history[1].role).toBe("user");
    expect(history[1].content).toBe(
      "You asked Daily Brief Lead (Daily Brief): What failed today?\n\n" +
        "Daily Brief Lead (Daily Brief) answered: The inbox bot failed twice.\n\n" +
        "Summarise what the lead said",
    );
  });

  test("reports a failed lead answer instead of dropping it", () => {
    const history = buildLlmHistory([
      { id: "2", role: "user", content: "Status?", to: lead },
      { id: "3", role: "lead", from: lead, content: "", error: "Timed out" },
    ]);
    expect(history[0].content).toMatch(
      /Daily Brief Lead \(Daily Brief\) could not answer: Timed out$/,
    );
  });

  test("skips an empty lead answer with no error", () => {
    const history = buildLlmHistory([
      { id: "2", role: "user", content: "Status?", to: lead },
      { id: "3", role: "lead", from: lead, content: "" },
    ]);
    expect(history).toEqual([
      {
        role: "user",
        content: "You asked Daily Brief Lead (Daily Brief): Status?",
      },
    ]);
  });

  test("never sends the streaming placeholder", () => {
    const history = buildLlmHistory([
      {
        id: "x",
        role: "lead",
        from: lead,
        content: "partial",
        streaming: true,
      },
    ]);
    expect(history).toEqual([]);
  });
});

describe("availabilityNotice (AC7)", () => {
  test("null when the lead can answer", () => {
    expect(availabilityNotice(lead)).toBeNull();
  });

  test.each([
    [{ paused: true }, /paused — resume it in the Bots view/],
    [{ overBudget: true }, /over its budget/],
    [{ running: true }, /busy with another run/],
  ])("explains %p", (state, pattern) => {
    expect(availabilityNotice({ ...lead, ...state })).toMatch(pattern);
    expect(availabilityNotice({ ...lead, ...state })).toMatch(
      /^Daily Brief Lead/,
    );
  });
});

describe("hasLeadSession (AC4)", () => {
  test("true once this lead has answered in the chat", () => {
    const msgs = [{ id: "3", role: "lead", from: lead, content: "ok" }];
    expect(hasLeadSession(msgs, "lead_1")).toBe(true);
    expect(hasLeadSession(msgs, "lead_2")).toBe(false);
  });

  test("ignores the streaming placeholder and failed answers", () => {
    expect(
      hasLeadSession(
        [{ id: "x", role: "lead", from: lead, content: "p", streaming: true }],
        "lead_1",
      ),
    ).toBe(false);
    expect(
      hasLeadSession(
        [{ id: "y", role: "lead", from: lead, content: "", error: "x" }],
        "lead_1",
      ),
    ).toBe(false);
  });
});

describe("filterRecipients (AC6 @ shortcut)", () => {
  const leads = [
    lead,
    {
      ...lead,
      botId: "lead_2",
      leadName: "Sales Lead",
      dashboardName: "Sales",
      dashboardLabel: "Sales",
    },
    {
      ...lead,
      botId: "lead_3",
      leadName: "Ops Lead",
      dashboardName: "Daily Ops",
      dashboardLabel: "Daily Ops",
    },
  ];

  test("empty query → Assistant first, then every lead", () => {
    const out = filterRecipients(leads, "");
    expect(out[0]).toBe(ASSISTANT_RECIPIENT);
    expect(out.slice(1).map((l) => l.botId)).toEqual([
      "lead_1",
      "lead_2",
      "lead_3",
    ]);
  });

  test("matches the lead or dashboard name, any case", () => {
    expect(filterRecipients(leads, "DAI").map((l) => l.botId)).toEqual([
      "lead_1",
      "lead_3",
    ]);
    expect(filterRecipients(leads, "sales").map((l) => l.botId)).toEqual([
      "lead_2",
    ]);
  });

  test("'assist' matches the Assistant entry", () => {
    expect(filterRecipients(leads, "assist")).toEqual([ASSISTANT_RECIPIENT]);
  });

  test("no match → empty list", () => {
    expect(filterRecipients(leads, "zzz")).toEqual([]);
  });
});
