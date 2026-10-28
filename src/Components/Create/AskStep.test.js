/**
 * Ask (create-entry CRE-007 AC4 / CRE-011 AC6, phase 5e): questions go to
 * the Planner, are kept in Recent as questions, and an answer that plans
 * something opens as a plan.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AskStep } from "./AskStep";
import {
  questionRequest,
  roleQuestion,
  leadQuestion,
  reopenedQuestion,
  hasPlan,
  handoverSeed,
  earlierTurns,
} from "./askThread";
import { questionThreads, recentRows, recentStatus } from "./recentRows";

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

  test("a plan with pieces or questions opens; the seed carries the chat", () => {
    expect(hasPlan(null)).toBe(false);
    expect(hasPlan({ summary: "x", pieces: [] })).toBe(false);
    expect(hasPlan(PLAN)).toBe(true);
    expect(hasPlan({ summary: "x", questions: [{ question: "Which?" }] })).toBe(
      true,
    );
    const seed = handoverSeed(
      [
        { who: "you", text: " Show that " },
        { who: "planner", text: "Here.", meta: "m", plan: PLAN },
        { who: "lead", text: "not mine" },
      ],
      PLAN,
    );
    expect(seed.plan).toBe(PLAN);
    expect(seed.label).toBe("Show that");
    expect(seed.request).toBeUndefined();
    expect(seed.messages).toEqual([
      { who: "you", text: " Show that " },
      { who: "planner", text: "Here.", meta: "m" },
    ]);
  });

  test("the earlier turns, for the Planner in Create", () => {
    expect(earlierTurns([])).toBe("");
    expect(
      earlierTurns([
        { who: "you", text: "a" },
        { who: "note", text: "n" },
        { who: "planner", text: "b" },
      ]),
    ).toBe("Earlier in this conversation:\nMe: a\nYou: b");
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

  test("a follow-up continues; an answer with a plan moves on to Create with the chat", async () => {
    const bots = api();
    const onOpenPlan = jest.fn();
    render(<AskStep question="What ran?" onOpenPlan={onOpenPlan} />);
    await screen.findByTestId("ask-answer");
    expect(onOpenPlan).not.toHaveBeenCalled();
    bots.run.mockResolvedValueOnce(
      answered(`Here's a widget for it.\n<plan>${JSON.stringify(PLAN)}</plan>`),
    );
    fireEvent.change(screen.getByLabelText("Ask a follow-up"), {
      target: { value: "Show that on a widget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(onOpenPlan).toHaveBeenCalledTimes(1));
    expect(bots.run.mock.calls[1][2]).toBe(true);
    const seed = onOpenPlan.mock.calls[0][0];
    expect(seed.plan).toEqual(PLAN);
    expect(seed.label).toBe("What ran?");
    expect(seed.messages.map((m) => [m.who, m.text])).toEqual([
      ["you", "What ran?"],
      ["planner", "Morning Briefer sent a brief today at 8:02."],
      ["you", "Show that on a widget"],
      ["planner", "Here's a widget for it."],
    ]);
    // Still there if the chat is reopened.
    fireEvent.click(screen.getByRole("button", { name: "Open as a plan" }));
    expect(onOpenPlan).toHaveBeenCalledTimes(2);
  });

  test("questions before a plan move on to Create too (QA 2026-10-26)", async () => {
    const asking = {
      summary: "Home",
      questions: [{ question: "Include sprinklers?", options: ["Yes", "No"] }],
      pieces: [],
    };
    api({
      run: jest
        .fn()
        .mockResolvedValue(
          answered(
            `A few choices before I write the full plan:\n<plan>${JSON.stringify(asking)}</plan>`,
          ),
        ),
    });
    const onOpenPlan = jest.fn();
    // Like the Dash team modal: it closes as Create opens.
    const Host = () => {
      const [open, setOpen] = React.useState(true);
      return open ? (
        <AskStep
          question="Make me a home dashboard"
          onOpenPlan={(seed) => {
            onOpenPlan(seed);
            setOpen(false);
          }}
        />
      ) : null;
    };
    render(<Host />);
    await waitFor(() => expect(onOpenPlan).toHaveBeenCalledTimes(1));
    expect(onOpenPlan.mock.calls[0][0].plan).toEqual(asking);
    // The thread keeps the answer, though it closed before showing it.
    const bots = window.mainApi.bots;
    const saved = bots.saveCreateRecent.mock.calls
      .map((c) => c[0])
      .filter((r) => r.id === "plan_q1" && r.conversation);
    const last = saved[saved.length - 1].conversation.messages;
    expect(last.map((m) => m.who)).toEqual(["you", "planner"]);
    expect(last[1].plan).toEqual(asking);
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

  // Consolidation Phase 2c-2: asked to make something, the lead hands it to
  // the Dash team.
  const HANDED_OFF =
    'The Dash team makes bots — they\'ll plan it with you.\n<handoff>{"type":"bot","request":"A bot that sums up my email at 7:30","note":"News Digest covers headlines."}</handoff>';

  test("a hand-off shows Plan this with the Dash team, never the marker", async () => {
    leadApi({
      askLead: jest.fn().mockResolvedValue({
        status: "completed",
        output: HANDED_OFF,
      }),
    });
    const onHandoff = jest.fn();
    render(
      <AskStep
        question="Add a bot that sums up my email"
        recipient={{ ...LEAD, dashboardId: "7" }}
        onHandoff={onHandoff}
      />,
    );
    const answer = await screen.findByTestId("ask-answer");
    expect(answer).toHaveTextContent("The Dash team makes bots");
    expect(answer.textContent).not.toMatch(/handoff/);
    fireEvent.click(
      screen.getByRole("button", { name: "Plan this with the Dash team" }),
    );
    expect(onHandoff).toHaveBeenCalledWith(
      {
        type: "bot",
        request: "A bot that sums up my email at 7:30",
        note: "News Digest covers headlines.",
      },
      expect.objectContaining({
        leadName: "Daily Brief Lead",
        dashboardId: "7",
      }),
    );
  });

  test("outside Create (the dock) it opens Create for that dashboard", async () => {
    leadApi({
      askLead: jest.fn().mockResolvedValue({
        status: "completed",
        output: HANDED_OFF,
      }),
    });
    render(<AskStep question="x" recipient={{ ...LEAD, dashboardId: "7" }} />);
    const opened = jest.fn();
    window.addEventListener("dash:open-create", opened);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Plan this with the Dash team",
      }),
    );
    window.removeEventListener("dash:open-create", opened);
    expect(opened.mock.calls[0][0].detail).toEqual({
      type: "bot",
      workspaceId: "7",
      prompt: "A bot that sums up my email at 7:30",
      context: {
        note: "News Digest covers headlines.",
        from: "Daily Brief Lead",
      },
    });
  });

  test("a plain answer has no hand-off button", async () => {
    leadApi();
    render(<AskStep question="Anything urgent?" recipient={LEAD} />);
    await screen.findByTestId("ask-answer");
    expect(
      screen.queryByRole("button", { name: "Plan this with the Dash team" }),
    ).toBeNull();
  });
});

describe("asking another Dash team role (QA 2026-10-28)", () => {
  const BUILDER = { role: "builder", roleName: "Builder" };
  const roleApi = (over = {}) =>
    api({
      listDashTeam: jest
        .fn()
        .mockResolvedValue([
          ...team,
          { id: "b_builder", role: "builder", name: "Builder" },
        ]),
      run: jest
        .fn()
        .mockResolvedValue(answered("Yes — set its refresh to 1 second.")),
      ...over,
    });

  test("goes to that role, kept with the conversation; no plan button", async () => {
    const bots = roleApi();
    render(
      <AskStep
        question="Can a widget poll every second?"
        recipient={BUILDER}
        onOpenPlan={jest.fn()}
      />,
    );
    const answer = await screen.findByTestId("ask-answer");
    expect(answer).toHaveTextContent("Yes — set its refresh to 1 second.");
    expect(answer).toHaveTextContent("Builder");
    expect(bots.saveCreateRecent).toHaveBeenNthCalledWith(1, {
      kind: "question",
      prompt: "Can a widget poll every second?",
      conversation: { recipient: BUILDER },
    });
    const [botId, prompt, cont] = bots.run.mock.calls[0];
    expect(botId).toBe("b_builder");
    expect(prompt).toBe(roleQuestion("Can a widget poll every second?"));
    expect(cont).toBe(false);
    expect(screen.getByTestId("ask-to")).toHaveTextContent(
      "To: Builder · Dash team",
    );
    // A follow-up stays with the Builder and continues.
    fireEvent.change(screen.getByLabelText("Ask a follow-up"), {
      target: { value: "And every 100ms?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(bots.run).toHaveBeenCalledTimes(2));
    expect(bots.run.mock.calls[1][0]).toBe("b_builder");
    expect(bots.run.mock.calls[1][2]).toBe(true);
    expect(screen.queryByRole("button", { name: "Open as a plan" })).toBeNull();
  });

  test("busy: says so and offers to stop that role", async () => {
    roleApi({
      run: jest.fn().mockResolvedValue({
        skipped: true,
        reason: "a run is already in progress",
      }),
    });
    render(<AskStep question="Hi" recipient={BUILDER} />);
    expect(await screen.findByTestId("planner-busy")).toHaveTextContent(
      "The Builder is still working on an earlier request.",
    );
    expect(
      screen.getByRole("button", { name: "Stop the Builder" }),
    ).toBeInTheDocument();
  });

  test("reopened from Recent: carries on with the same role", async () => {
    const bots = roleApi({
      getCreateRecent: jest.fn().mockResolvedValue({
        id: "plan_q1",
        kind: "question",
        prompt: "Can it poll?",
        conversation: {
          recipient: BUILDER,
          messages: [
            { who: "you", text: "Can it poll?" },
            { who: "role", text: "Yes." },
          ],
        },
      }),
    });
    render(<AskStep recentId="plan_q1" />);
    expect(await screen.findByText("Yes.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ask a follow-up"), {
      target: { value: "How fast?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(bots.run).toHaveBeenCalled());
    const [botId, prompt] = bots.run.mock.calls[0];
    expect(botId).toBe("b_builder");
    expect(prompt).toMatch(
      /^Earlier in this conversation:\nMe: Can it poll\?\nYou: Yes\.\n\n\(A question from the Dash team chat/,
    );
  });

  test("Recent names the role", () => {
    expect(
      recentStatus({ kind: "question", status: "answered", to: "Builder" }),
    ).toBe("Answered · Builder");
  });
});

describe("the Dash team's conversations (consolidation Phase 4a)", () => {
  test("questionThreads: questions only, newest first, a lead's named", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const threads = questionThreads(
      [
        { id: "p", title: "Brief", status: "draft", updatedAt: now - 1000 },
        {
          id: "q1",
          kind: "question",
          title: "What ran?",
          updatedAt: now - 3 * 3600000,
        },
        {
          id: "q2",
          kind: "question",
          title: "Anything urgent?",
          to: "Sales Lead",
          updatedAt: now - 60000,
        },
        { kind: "question", title: "no id" },
      ],
      now,
    );
    expect(threads.map((x) => [x.id, x.sub])).toEqual([
      ["q2", "1m ago · asked Sales Lead"],
      ["q1", "3h ago"],
    ]);
    expect(questionThreads(null)).toEqual([]);
  });

  test("onStarted says which Recent entry a new question was saved as", async () => {
    api();
    const onStarted = jest.fn();
    render(<AskStep question="What ran today?" onStarted={onStarted} />);
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("plan_q1"));
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
