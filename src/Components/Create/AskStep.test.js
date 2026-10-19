/**
 * Ask (create-entry CRE-007 AC4 / CRE-011 AC6, phase 5e): questions go to
 * the Planner, are kept in Recent as questions, and an answer that plans
 * something opens as a plan.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AskStep } from "./AskStep";
import { CreateDockPanel } from "./CreateDockPanel";
import {
  questionRequest,
  leadQuestion,
  reopenedQuestion,
  hasPlan,
  planSeed,
} from "./askThread";
import { recentRows, recentStatus, recentSections } from "./recentRows";

jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));

const team = [{ id: "b_planner", role: "planner", name: "Planner" }];
const answered = (output) => ({
  status: "completed",
  model: "claude-opus-4-8",
  usage: { inputTokens: 1000, outputTokens: 100 },
  cost: { usd: 0, includedInPlan: true },
  output,
});
const PLAN = {
  summary: "A brief widget",
  pieces: [{ kind: "widget", name: "Brief", source: "new" }],
};

function api(over = {}) {
  window.mainApi = {
    bots: {
      listDashTeam: jest.fn().mockResolvedValue(team),
      onStream: jest.fn(() => 1),
      removeListener: jest.fn(),
      run: jest
        .fn()
        .mockResolvedValue(
          answered("Morning Briefer sent a brief today at 8:02."),
        ),
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_q1" }),
      getCreateRecent: jest.fn().mockResolvedValue(null),
      listCreateRecent: jest.fn().mockResolvedValue([]),
      onCreateRecent: jest.fn(() => 3),
      ...over,
    },
    drafts: { list: jest.fn().mockResolvedValue([]) },
  };
  return window.mainApi.bots;
}

afterEach(() => {
  delete window.mainApi;
});

describe("askThread", () => {
  test("a question is marked as one", () => {
    expect(questionRequest(" What ran? ")).toMatch(
      /^\(A question from the Ask box — answer it; write a plan only if I ask you to make or change something\.\)\nWhat ran\?$/,
    );
  });

  test("a reopened question carries the last turns, notes left out", () => {
    const text = reopenedQuestion(
      [
        { who: "you", text: "What ran?" },
        { who: "note", text: "Planner asked the Scout…" },
        { who: "planner", text: "Two bots." },
      ],
      "Which failed?",
    );
    expect(text).toMatch(
      /^Earlier in this conversation:\nMe: What ran\?\nYou: Two bots\.\n\n/,
    );
    expect(text).not.toMatch(/Scout/);
    expect(text).toMatch(/Which failed\?$/);
    expect(reopenedQuestion([], "Hi")).toBe(questionRequest("Hi"));
  });

  test("only a plan with pieces opens; the seed carries the plan", () => {
    expect(hasPlan(null)).toBe(false);
    expect(hasPlan({ summary: "x", pieces: [] })).toBe(false);
    expect(hasPlan(PLAN)).toBe(true);
    const seed = planSeed("Show that", PLAN);
    expect(seed.plan).toBe(PLAN);
    expect(seed.label).toBe("From a question: Show that");
    expect(seed.request).toContain(`<plan>${JSON.stringify(PLAN)}</plan>`);
  });
});

describe("recentRows — questions share the list", () => {
  test("a question row says Asked / Answered", () => {
    expect(recentStatus({ kind: "question", status: "answered" })).toBe(
      "Answered",
    );
    expect(recentStatus({ kind: "question", status: "asked" })).toBe("Asked");
    const rows = recentRows([
      {
        id: "q",
        kind: "question",
        title: "What ran?",
        status: "answered",
        updatedAt: 2,
      },
      { id: "p", title: "Brief", status: "draft", updatedAt: 1 },
    ]);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ["question", "Answered"],
      ["plan", "Draft plan"],
    ]);
  });
});

describe("AskStep", () => {
  test("kept in Recent as a question, then the Planner answers it", async () => {
    const bots = api();
    render(<AskStep question="What did my bots find today?" />);
    expect(await screen.findByTestId("ask-answer")).toHaveTextContent(
      "Morning Briefer sent a brief today at 8:02.",
    );
    expect(bots.saveCreateRecent).toHaveBeenNthCalledWith(1, {
      kind: "question",
      prompt: "What did my bots find today?",
    });
    const [, prompt, cont, opts] = bots.run.mock.calls[0];
    expect(prompt).toBe(questionRequest("What did my bots find today?"));
    expect(cont).toBe(false);
    expect(opts).toEqual({ planId: "plan_q1" });
    // No plan in the answer → nothing to open.
    expect(screen.queryByRole("button", { name: "Open as a plan" })).toBeNull();
    // Saved as it goes.
    await waitFor(() =>
      expect(bots.saveCreateRecent).toHaveBeenCalledWith(
        expect.objectContaining({ id: "plan_q1" }),
      ),
    );
  });

  test("a follow-up continues; an answer with a plan opens as one", async () => {
    const bots = api();
    const onOpenPlan = jest.fn();
    render(<AskStep question="What ran?" onOpenPlan={onOpenPlan} />);
    await screen.findByTestId("ask-answer");
    bots.run.mockResolvedValueOnce(
      answered(`Here's a widget for it.\n<plan>${JSON.stringify(PLAN)}</plan>`),
    );
    fireEvent.change(screen.getByLabelText("Ask a follow-up"), {
      target: { value: "Show that on a widget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Open as a plan" }),
    );
    expect(bots.run.mock.calls[1][2]).toBe(true);
    expect(onOpenPlan).toHaveBeenCalledWith(
      planSeed("Show that on a widget", PLAN),
    );
  });

  test("reopened: as it was; the next question carries the conversation", async () => {
    const bots = api({
      getCreateRecent: jest.fn().mockResolvedValue({
        id: "plan_q1",
        kind: "question",
        prompt: "What ran?",
        conversation: {
          messages: [
            { who: "you", text: "What ran?" },
            { who: "planner", text: "Two bots." },
          ],
        },
      }),
    });
    render(<AskStep recentId="plan_q1" />);
    expect(await screen.findByText("Two bots.")).toBeInTheDocument();
    expect(bots.run).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Ask a follow-up"), {
      target: { value: "Which failed?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(bots.run).toHaveBeenCalled());
    const [, prompt, cont] = bots.run.mock.calls[0];
    expect(cont).toBe(false);
    expect(prompt).toMatch(
      /^Earlier in this conversation:\nMe: What ran\?\nYou: Two bots\./,
    );
  });
});

const LEAD = {
  botId: "b_lead",
  leadName: "Daily Brief Lead",
  dashboardName: "Daily Brief",
  dashboardLabel: "Daily Brief",
};

describe("asking a team lead (5e-2a)", () => {
  const leadApi = (over = {}) =>
    api({
      listLeads: jest.fn().mockResolvedValue([LEAD]),
      onListChanged: jest.fn(() => 4),
      onRunActive: jest.fn(() => 5),
      askLead: jest
        .fn()
        .mockResolvedValue({ status: "completed", output: "Nothing urgent." }),
      ...over,
    });

  test("a lead's words go as typed; a reopened one carries lead turns", () => {
    expect(leadQuestion(" Anything urgent? ")).toBe("Anything urgent?");
    expect(
      reopenedQuestion(
        [
          { who: "you", text: "Anything urgent?" },
          { who: "lead", text: "No." },
        ],
        "And tomorrow?",
        6,
        leadQuestion,
      ),
    ).toBe(
      "Earlier in this conversation:\nMe: Anything urgent?\nYou: No.\n\nAnd tomorrow?",
    );
  });

  test("Recent names the lead", () => {
    expect(
      recentStatus({
        kind: "question",
        status: "answered",
        to: "Daily Brief Lead",
      }),
    ).toBe("Answered · Daily Brief Lead");
  });

  test("goes straight to the lead, kept with the conversation; no plan button", async () => {
    const bots = leadApi();
    render(
      <AskStep
        question="Anything urgent?"
        recipient={LEAD}
        onOpenPlan={jest.fn()}
      />,
    );
    expect(await screen.findByTestId("ask-answer")).toHaveTextContent(
      "Nothing urgent.",
    );
    expect(screen.getByText("Daily Brief Lead")).toBeInTheDocument();
    expect(bots.saveCreateRecent).toHaveBeenNthCalledWith(1, {
      kind: "question",
      prompt: "Anything urgent?",
      conversation: { recipient: LEAD },
    });
    expect(bots.askLead).toHaveBeenCalledWith(
      "b_lead",
      "Anything urgent?",
      false,
      "create",
    );
    expect(bots.run).not.toHaveBeenCalled();
    expect(
      screen.getByText("To: Daily Brief Lead · Daily Brief"),
    ).toBeInTheDocument();
    // A follow-up stays with the lead and continues its session.
    fireEvent.change(screen.getByLabelText("Ask a follow-up"), {
      target: { value: "And tomorrow?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(bots.askLead).toHaveBeenCalledTimes(2));
    expect(bots.askLead.mock.calls[1]).toEqual([
      "b_lead",
      "And tomorrow?",
      true,
      "create",
    ]);
    expect(screen.queryByRole("button", { name: "Open as a plan" })).toBeNull();
  });

  test("a paused lead isn't asked; the note says why", async () => {
    const bots = leadApi();
    render(<AskStep question="Hi" recipient={{ ...LEAD, paused: true }} />);
    expect(
      await screen.findByText(
        "Daily Brief Lead is paused — resume it in the Bots view.",
      ),
    ).toBeInTheDocument();
    expect(bots.askLead).not.toHaveBeenCalled();
  });

  test("reopened from Recent: carries on with the same lead", async () => {
    const bots = leadApi({
      getCreateRecent: jest.fn().mockResolvedValue({
        id: "plan_q1",
        kind: "question",
        prompt: "Anything urgent?",
        conversation: {
          recipient: LEAD,
          messages: [
            { who: "you", text: "Anything urgent?" },
            { who: "lead", text: "No." },
          ],
        },
      }),
    });
    render(<AskStep recentId="plan_q1" />);
    expect(await screen.findByText("No.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ask a follow-up"), {
      target: { value: "And tomorrow?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(bots.askLead).toHaveBeenCalled());
    const [botId, prompt, cont] = bots.askLead.mock.calls[0];
    expect(botId).toBe("b_lead");
    expect(cont).toBe(false);
    expect(prompt).toMatch(
      /^Earlier in this conversation:\nMe: Anything urgent\?\nYou: No\./,
    );
    expect(bots.run).not.toHaveBeenCalled();
  });

  test("the dock's To: lists leads; picking one sends the question to it", async () => {
    const bots = leadApi();
    render(<CreateDockPanel />);
    const to = await screen.findByLabelText("Send to");
    expect([...to.options].map((o) => o.textContent)).toEqual([
      "Dash team",
      "Daily Brief Lead · Daily Brief",
    ]);
    fireEvent.change(to, { target: { value: "b_lead" } });
    const box = screen.getByLabelText("Ask about your dashboards and bots");
    expect(box).toHaveAttribute("placeholder", "Ask Daily Brief Lead…");
    fireEvent.change(box, { target: { value: "Anything urgent?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByTestId("ask-answer")).toHaveTextContent(
      "Nothing urgent.",
    );
    expect(bots.askLead).toHaveBeenCalledWith(
      "b_lead",
      "Anything urgent?",
      false,
      "create",
    );
    expect(bots.run).not.toHaveBeenCalled();
  });

  test("no leads → no To: (the Dash team answers)", async () => {
    api({ listLeads: jest.fn().mockResolvedValue([]) });
    render(<CreateDockPanel />);
    await waitFor(() =>
      expect(window.mainApi.bots.listLeads).toHaveBeenCalled(),
    );
    expect(screen.queryByLabelText("Send to")).toBeNull();
  });
});

describe("CreateDockPanel — the Ask box", () => {
  test("asking opens the question in the dock", async () => {
    api();
    render(<CreateDockPanel />);
    fireEvent.change(
      screen.getByLabelText("Ask about your dashboards and bots"),
      { target: { value: "What did my bots find today?" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByTestId("ask-step")).toBeInTheDocument();
    expect(await screen.findByTestId("ask-answer")).toBeInTheDocument();
    // A question has no Expand.
    expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
  });
});

describe("recentSections (fix/recent-sections)", () => {
  test("conversations and unfinished widgets apart; drafts say what opening does", () => {
    const plans = [
      {
        id: "q",
        kind: "question",
        title: "What ran?",
        status: "answered",
        updatedAt: 5,
      },
      { id: "p", title: "Brief", status: "draft", updatedAt: 1 },
    ];
    const drafts = [1, 2, 3, 4].map((n) => ({
      id: `d${n}`,
      name: `W${n}`,
      updatedAt: 10 - n,
    }));
    const s = recentSections(plans, drafts);
    expect(s.conversations.map((r) => r.id)).toEqual(["q", "p"]);
    expect(s.drafts.map((r) => [r.id, r.status])).toEqual([
      ["d1", "Continue in Widget Builder"],
      ["d2", "Continue in Widget Builder"],
      ["d3", "Continue in Widget Builder"],
    ]);
    expect(s.moreDrafts).toBe(1);
    expect(recentSections([], [], {}).conversations).toEqual([]);
  });
});

// Consolidation Phase 2a: Ask lives inside Create, where Back / Close unmount
// the question while it's still answering. The answer still lands in Recent.
describe("AskStep — closed before the answer arrives", () => {
  test("the answer is saved to Recent, not lost", async () => {
    let finish;
    const bots = api({
      run: jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { unmount } = render(<AskStep question="What ran today?" />);
    await waitFor(() => expect(bots.run).toHaveBeenCalled());
    unmount();
    finish(answered("Two bots ran."));
    await waitFor(() =>
      expect(bots.saveCreateRecent).toHaveBeenCalledWith({
        id: "plan_q1",
        conversation: {
          messages: [
            { who: "you", text: "What ran today?" },
            expect.objectContaining({ who: "planner", text: "Two bots ran." }),
          ],
        },
      }),
    );
  });
});
