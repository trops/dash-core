/**
 * LeadWorkspace (lead-workspace release 2): opens on the lead you picked;
 * the switcher lists leads and lone bots; each lead shows only its own
 * conversations; asking opens the conversation with that lead; the right
 * column shows outputs and what each bot did.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

jest.mock("@trops/dash-react", () => {
  const actual = jest.requireActual("@trops/dash-react");
  return {
    ...actual,
    // The real Modal portals and animates; the content is what's tested.
    Modal: ({ children }) => <div data-testid="modal">{children}</div>,
  };
});

// Connect new opens the providers screen: not what's tested here.
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));

let mockAskProps = null;
jest.mock("../Create/AskStep", () => ({
  AskStep: (props) => {
    mockAskProps = props;
    return (
      <div data-testid="ask-step">
        {props.recentId ? `thread ${props.recentId}` : `new: ${props.question}`}
      </div>
    );
  },
}));
jest.mock("../Bots/BotChat", () => ({
  BotChat: ({ bot }) => <div data-testid="bot-chat">chat with {bot.name}</div>,
}));
let mockApprovals = [];
jest.mock("../AppPages/useAllBots", () => ({
  useAllBots: () => ({
    approvals: mockApprovals,
    bots: [
      {
        id: "lead_7",
        role: "lead",
        name: "Kitchen Sink Lead",
        workspaceId: "7",
      },
      { id: "b1", name: "Inbox Watch", workspaceId: "7" },
      { id: "w1", name: "Word Keeper", workspaceId: null },
    ],
    dashTeam: [
      { id: "d_p", role: "planner", name: "Planner" },
      { id: "d_s", role: "scout", name: "Scout" },
      { id: "d_l", role: "dashlead", name: "Dash Lead" },
      { id: "d_b", role: "builder", name: "Builder" },
      { id: "d_c", role: "checker", name: "Checker" },
    ],
    statusOf: () => "Idle",
  }),
}));
let mockLeadsLoaded = true;
jest.mock("../AiAssistant/components/RecipientPicker", () => ({
  useTeamLeads: () => ({
    loaded: mockLeadsLoaded,
    leads: [
      {
        botId: "lead_7",
        leadName: "Kitchen Sink Lead",
        dashboardId: "7",
        dashboardName: "Kitchen Sink",
        dashboardLabel: "Kitchen Sink",
      },
    ],
  }),
}));

// Which widget a Change with AI is about (release 6c): set per test.
let mockWidgetTarget = { status: "none", target: null, mode: null, usedOn: [] };
jest.mock("./useWidgetTarget", () => ({
  useWidgetTarget: (widget) =>
    widget
      ? mockWidgetTarget
      : { status: "none", target: null, mode: null, usedOn: [] },
}));

import { LeadWorkspace } from "./LeadWorkspace";
import { WorkspaceSide } from "./WorkspaceSide";

beforeEach(() => {
  mockAskProps = null;
  mockApprovals = [];
  mockLeadsLoaded = true;
  window.mainApi = {
    bots: {
      listCreateRecent: jest.fn().mockResolvedValue([
        {
          id: "q1",
          kind: "question",
          title: "Anything urgent?",
          with: "lead:lead_7",
          updatedAt: "2026-10-28T09:00:00Z",
        },
        {
          id: "q2",
          kind: "question",
          title: "Do I have a clock?",
          with: "role:dashlead",
          updatedAt: "2026-10-28T08:00:00Z",
        },
      ]),
      onCreateRecent: jest.fn(() => 1),
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "q_new" }),
      getCreateRecent: jest.fn().mockResolvedValue(null),
      listApprovals: jest.fn().mockResolvedValue([]),
      listDashTeam: jest.fn().mockResolvedValue([]),
      onApprovalsChanged: jest.fn(() => 2),
      onStream: jest.fn(() => 3),
      getRuns: jest.fn().mockResolvedValue([
        {
          trigger: "schedule",
          status: "completed",
          endedAt: "2026-10-28T19:46:00Z",
          output: "TICK",
        },
      ]),
      onRunActive: jest.fn(() => 4),
      removeListener: jest.fn(),
    },
  };
});
afterEach(() => {
  delete window.mainApi;
});

test("opens on the lead you picked, with only its own conversations", async () => {
  render(
    <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={jest.fn()} />,
  );
  expect(screen.getByTestId("workspace-switcher")).toHaveTextContent(
    "Kitchen Sink Lead",
  );
  expect(await screen.findByText("Anything urgent?")).toBeInTheDocument();
  expect(screen.queryByText("Do I have a clock?")).toBeNull();
  // It starts on a new conversation with that lead.
  expect(screen.getByTestId("workspace-start")).toHaveTextContent(
    "Ask Kitchen Sink Lead",
  );
});

test("the switcher lists the Dash Lead, dashboard leads and lone bots; switching follows", async () => {
  render(
    <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={jest.fn()} />,
  );
  fireEvent.click(screen.getByTestId("workspace-switcher"));
  const menu = screen.getByTestId("workspace-switcher-menu");
  expect(within(menu).getByText("Team leads")).toBeInTheDocument();
  expect(within(menu).getByText("Bots on no dashboard")).toBeInTheDocument();
  // A bot on a dashboard is never in it.
  expect(within(menu).queryByText("Inbox Watch")).toBeNull();
  fireEvent.click(within(menu).getByText("Dash Lead"));
  expect(screen.getByTestId("workspace-switcher")).toHaveTextContent(
    "Dash Lead",
  );
  expect(await screen.findByText("Do I have a clock?")).toBeInTheDocument();
  expect(screen.queryByText("Anything urgent?")).toBeNull();
});

test("asking starts a conversation with that lead, its team's approvals with it", () => {
  render(
    <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={jest.fn()} />,
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Ask Kitchen Sink Lead" }),
    {
      target: { value: "Anything urgent?" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(screen.getByTestId("ask-step")).toHaveTextContent(
    "new: Anything urgent?",
  );
  expect(mockAskProps.recipient.botId).toBe("lead_7");
  expect(mockAskProps.hideTo).toBe(true);
  expect(mockAskProps.approvalBots.map((b) => b.id)).toEqual(["lead_7", "b1"]);
});

test("a starter asks it straight away; a thread reopens", async () => {
  render(
    <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={jest.fn()} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Ask Inbox Watch to run now" }),
  );
  expect(screen.getByTestId("ask-step")).toHaveTextContent(
    "new: Ask Inbox Watch to run now",
  );
  fireEvent.click(await screen.findByText("Anything urgent?"));
  expect(screen.getByTestId("ask-step")).toHaveTextContent("thread q1");
});

test("a bot on no dashboard: its own chat, and its runs on the right", async () => {
  render(<LeadWorkspace request={{ key: "bot:w1" }} onClose={jest.fn()} />);
  expect(screen.getByTestId("bot-chat")).toHaveTextContent(
    "chat with Word Keeper",
  );
  expect(await screen.findByText("TICK")).toBeInTheDocument();
  expect(screen.queryByText("New conversation")).toBeNull();
});

describe("WorkspaceSide", () => {
  const contact = {
    key: "lead:lead_7",
    kind: "lead",
    name: "Kitchen Sink Lead",
    botId: "lead_7",
    members: [
      { id: "b1", name: "Inbox Watch" },
      { id: "b2", name: "Morning Briefer" },
    ],
  };
  const messages = [
    { who: "you", text: "Anything urgent?" },
    {
      who: "step",
      id: "t1",
      bot: "Inbox Watch",
      label: "Asked Inbox Watch",
      request: "Anything urgent since 9:00?",
      status: "done",
      answer: "2 need attention.\nDana wants to move Thursday.",
      result: "2 need attention.",
    },
  ];

  test("a preview that's past (it went in): Outputs, not an empty page (6c-2)", () => {
    render(
      <WorkspaceSide
        contact={contact}
        messages={messages}
        open="preview"
        build={{ buildId: "b1", kind: "cell" }}
        pb={{ state: { status: "done", steps: [] } }}
      />,
    );
    expect(screen.getByTestId("workspace-side")).toHaveTextContent("Outputs");
  });

  test("an answer is an output; each bot says whether it was asked", () => {
    render(<WorkspaceSide contact={contact} messages={messages} />);
    expect(screen.getByTestId("workspace-output")).toHaveTextContent(
      "Inbox Watch's answer",
    );
    const rows = screen.getAllByTestId("workspace-member");
    expect(rows[0]).toHaveTextContent("Inbox Watch · done");
    expect(rows[0]).toHaveTextContent("2 need attention.");
    expect(rows[1]).toHaveTextContent("Morning Briefer · ready");
  });

  test("it tells the folded button how many outputs it holds (release 6a)", () => {
    const onSummary = jest.fn();
    render(
      <WorkspaceSide
        contact={contact}
        messages={messages}
        onSummary={onSummary}
      />,
    );
    expect(onSummary).toHaveBeenLastCalledWith({ count: 1, needsYou: false });
  });

  test("opening an answer shows what it was asked and said; Expand asks for room", () => {
    const onToggleWide = jest.fn();
    // What's open is the workspace's (the chat's plan card opens it too).
    const Host = () => {
      const [open, setOpen] = React.useState(null);
      return (
        <WorkspaceSide
          contact={contact}
          messages={messages}
          open={open}
          onOpen={setOpen}
          onToggleWide={onToggleWide}
        />
      );
    };
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Answer ›" }));
    expect(screen.getByText("Anything urgent since 9:00?")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-output-detail")).toHaveTextContent(
      "Dana wants to move Thursday.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(onToggleWide).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "← Outputs" }));
    expect(screen.getByTestId("workspace-team")).toBeInTheDocument();
  });

  test("a bot still asking shows as working", () => {
    render(
      <WorkspaceSide
        contact={contact}
        messages={[
          {
            ...messages[1],
            status: "asking",
            answer: undefined,
            result: undefined,
          },
        ]}
      />,
    );
    expect(screen.getAllByTestId("workspace-member")[0]).toHaveTextContent(
      "Inbox Watch · working",
    );
  });
});

test("while the leads load nothing can be asked; a lead that's gone says so", () => {
  mockLeadsLoaded = false;
  const { unmount } = render(
    <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={jest.fn()} />,
  );
  expect(screen.getByTestId("workspace-loading")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByTestId("workspace-side")).toBeNull();
  unmount();
  mockLeadsLoaded = true;
  render(<LeadWorkspace request={{ key: "lead:gone" }} onClose={jest.fn()} />);
  expect(screen.getByTestId("workspace-missing")).toHaveTextContent(
    "isn't available any more",
  );
  expect(screen.queryByRole("textbox")).toBeNull();
});

describe("a plan in the conversation (release 3a)", () => {
  const PLAN = {
    summary: "A home dashboard with your lights",
    pieces: [
      { kind: "widget", name: "Lights panel", source: "new" },
      { kind: "layout", name: "Home", source: "new" },
    ],
    beforeBuilding: [{ kind: "approve", what: "Turn on the lights-off bot" }],
  };
  const conversation = [
    { who: "you", text: "Plan me a home dashboard" },
    {
      who: "step",
      id: "1:t1",
      bot: "the Planner",
      label: "Asked the Planner",
      status: "done",
      answer: "Here's a plan.",
      result: "Here's a plan.",
      plan: PLAN,
    },
    { who: "role", text: "The Planner has a plan. Want it built?" },
  ];

  const openWithPlan = async () => {
    const onClose = jest.fn();
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={onClose} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "A dashboard for my smart home",
      }),
    );
    expect(mockAskProps).not.toBeNull();
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange(conversation);
    });
    return onClose;
  };
  const api = { busy: false, send: jest.fn(), focusReply: jest.fn() };
  const after = (i) => {
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(conversation[i], i, api);
    });
    return node;
  };

  test("the plan's card opens it on the right; Before it builds names who asks", async () => {
    await openWithPlan();
    const side = screen.getByTestId("workspace-side");
    expect(within(side).getByTestId("workspace-output-plan")).toHaveTextContent(
      "Home — plan",
    );
    expect(within(side).getByTestId("workspace-output-plan")).toHaveTextContent(
      "Waiting for your go-ahead · 1 before it builds",
    );
    // The Planner's step is the plan, not another answer.
    expect(within(side).queryAllByTestId("workspace-output")).toHaveLength(0);
    const before = within(side).getByTestId("workspace-before");
    expect(before).toHaveTextContent("Before it builds · 0 of 1 done");
    expect(before).toHaveTextContent("Planner · Dash team");
    fireEvent.click(within(before).getByRole("button", { name: "OK" }));
    expect(screen.getByTestId("workspace-before")).toHaveTextContent(
      "Before it builds · 1 of 1 done",
    );

    // The card under the Planner's step opens the plan.
    expect(after(0)).toBeNull();
    const card = render(after(1));
    fireEvent.click(
      within(card.container).getByRole("button", { name: /Home/ }),
    );
    expect(screen.getByTestId("workspace-plan-output")).toHaveTextContent(
      "Lights panel",
    );
    // One row per piece, read only: changes are asked for in the chat.
    expect(screen.getAllByTestId("workspace-plan-row")[0]).toHaveTextContent(
      "Lights panelNew",
    );
    expect(
      within(screen.getByTestId("workspace-plan-output")).queryByRole(
        "button",
        { name: /Swap|Remove/ },
      ),
    ).toBeNull();
  });

  test("Yes, build it asks what's left to review, then builds here; Change something goes to the reply box", async () => {
    window.mainApi.bots.startPlanBuild = jest
      .fn()
      .mockResolvedValue({ buildId: "build_1", state: null });
    const onClose = await openWithPlan();
    const choices = render(after(2));
    fireEvent.click(
      within(choices.container).getByRole("button", {
        name: "Change something",
      }),
    );
    expect(api.focusReply).toHaveBeenCalled();
    fireEvent.click(
      within(choices.container).getByRole("button", { name: "Yes, build it" }),
    );
    // The Planner's approval is asked first, as Create does.
    await waitFor(() =>
      expect(screen.getAllByText("Turn on the lights-off bot")).toHaveLength(2),
    );
    expect(window.mainApi.bots.startPlanBuild).not.toHaveBeenCalled();
    // The window's OK (the last one; the row's own is first).
    fireEvent.click(screen.getAllByRole("button", { name: "OK" }).pop());
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledWith(PLAN, {
        recentId: "q_new",
      }),
    );
    // Built here: the window stays, and the build is saved with the
    // conversation, after the message it started from.
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(window.mainApi.bots.saveCreateRecent).toHaveBeenCalledWith({
        id: "q_new",
        conversation: {
          workspacePlan: expect.objectContaining({
            checks: { "approve:Turn on the lights-off bot": "done" },
            builds: [
              {
                stepId: "1:t1",
                leftOff: [],
                buildId: "build_1",
                kind: "dashboard",
                at: 2,
              },
            ],
          }),
        },
      }),
    );
  });

  test("a typed reply takes the plan along; the plan is saved with the conversation", async () => {
    await openWithPlan();
    expect(mockAskProps.prepareSend("Make it blue")).toContain(
      JSON.stringify(PLAN),
    );
    await waitFor(() =>
      expect(window.mainApi.bots.saveCreateRecent).toHaveBeenCalledWith({
        id: "q_new",
        conversation: {
          workspacePlan: {
            stepId: "1:t1",
            plan: PLAN,
            checks: {},
            edits: [],
            sent: false,
            builds: [],
            // When the plan came in (release 4's notifications).
            madeAt: expect.any(Number),
          },
        },
      }),
    );
  });

  test("the Planner's questions are taps under the answer", async () => {
    await openWithPlan();
    const asking = {
      ...conversation[1],
      id: "2:t1",
      plan: {
        summary: "",
        pieces: [],
        questions: [
          { question: "Which rooms?", options: ["All", "Downstairs"] },
        ],
      },
    };
    act(() => {
      mockAskProps.onMessagesChange([...conversation, asking, conversation[2]]);
    });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(conversation[2], 4, api);
    });
    const q = render(node);
    fireEvent.click(
      within(q.container).getByRole("button", { name: "Downstairs" }),
    );
    expect(api.send).toHaveBeenCalledWith("Which rooms? — Downstairs");
  });
});

describe("release 3a review fixes", () => {
  const PLAN = {
    summary: "A home dashboard with your lights",
    pieces: [
      { kind: "widget", name: "Lights panel", source: "new" },
      { kind: "layout", name: "Home", source: "new" },
    ],
    beforeBuilding: [{ kind: "approve", what: "Turn on the lights-off bot" }],
  };
  const planStep = (id, plan = PLAN) => ({
    who: "step",
    id,
    bot: "the Planner",
    label: "Asked the Planner",
    status: "done",
    answer: "Here's a plan.",
    result: "Here's a plan.",
    plan,
  });
  const you = (text) => ({ who: "you", text });
  const reply = { who: "role", text: "Want it built?" };
  const api = { busy: false, send: jest.fn(), focusReply: jest.fn() };

  // Opens the Dash Lead's saved conversation q2, saved with `saved`.
  const reopen = async (saved, conversation) => {
    window.mainApi.bots.getCreateRecent = jest
      .fn()
      .mockResolvedValue({ conversation: { workspacePlan: saved } });
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    fireEvent.click(await screen.findByText("Do I have a clock?"));
    await waitFor(() =>
      expect(window.mainApi.bots.getCreateRecent).toHaveBeenCalledWith("q2"),
    );
    act(() => {
      mockAskProps.onMessagesChange(conversation);
    });
  };

  test("a plan that came in after the window closed keeps what was done before building", async () => {
    await reopen(
      {
        stepId: "1:t1",
        plan: PLAN,
        checks: { "approve:Turn on the lights-off bot": "done" },
        edits: [],
      },
      [
        you("Plan it"),
        planStep("1:t1"),
        reply,
        you("Bigger"),
        planStep("2:t1"),
        reply,
      ],
    );
    expect(await screen.findByTestId("workspace-before")).toHaveTextContent(
      "Before it builds · 1 of 1 done",
    );
  });

  test("sent to Create: reopened, it says so and isn't offered to build again", async () => {
    await reopen(
      { stepId: "1:t1", plan: PLAN, checks: {}, edits: [], sent: true },
      [you("Plan it"), planStep("1:t1"), reply],
    );
    await screen.findByTestId("workspace-output-plan");
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    const choices = render(node);
    expect(
      within(choices.container).getByTestId("workspace-plan-sent"),
    ).toHaveTextContent("Sent to Create to build");
    expect(
      within(choices.container).queryByRole("button", {
        name: "Yes, build it",
      }),
    ).toBeNull();
  });

  test("while the lead answers, the plan can't be changed; the plan on the right builds once", async () => {
    const onClose = jest.fn();
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={onClose} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "A dashboard for my smart home",
      }),
    );
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([
        you("Plan it"),
        planStep("1:t1"),
        reply,
        you("Bigger"),
      ]);
    });
    // Answering: nothing to press in Before it builds, no remove on pieces.
    expect(
      within(screen.getByTestId("workspace-before")).queryByRole("button"),
    ).toBeNull();
    act(() => {
      mockAskProps.renderAfter(planStep("1:t1"), 1, api);
    });
    fireEvent.click(screen.getByText("Home — plan"));
    expect(
      screen.queryByRole("button", { name: /Remove .* from the plan/ }),
    ).toBeNull();
    expect(screen.getByTestId("workspace-plan-output")).toHaveTextContent(
      "the plan may change",
    );

    // Answered: Yes, build it on the plan itself — once.
    act(() => {
      mockAskProps.onMessagesChange([
        you("Plan it"),
        planStep("1:t1"),
        reply,
        you("Bigger"),
        { who: "note", text: "Stopped." },
      ]);
    });
    window.mainApi.bots.startPlanBuild = jest
      .fn()
      .mockResolvedValue({ buildId: "build_1", state: null });
    fireEvent.click(
      within(screen.getByTestId("workspace-plan-output")).getByRole("button", {
        name: "Yes, build it",
      }),
    );
    // The plan is open on the right: the window's OK is the only one.
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledTimes(1),
    );
    expect(onClose).not.toHaveBeenCalled();
    // Built once: the plan now says where the build stands, with no second yes.
    await waitFor(() =>
      expect(
        within(screen.getByTestId("workspace-plan-output")).queryByRole(
          "button",
          { name: "Yes, build it" },
        ),
      ).toBeNull(),
    );
  });

  test("a broken plan: plain words, the problems go to the lead unseen", async () => {
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "A dashboard for my smart home",
      }),
    );
    const broken = { summary: "x", pieces: "nope" };
    act(() => {
      mockAskProps.onMessagesChange([
        you("Plan it"),
        planStep("1:t1", broken),
        reply,
      ]);
    });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    const r = render(node);
    expect(r.container).toHaveTextContent("The plan has a few gaps");
    expect(r.container).not.toHaveTextContent("pieces");
    fireEvent.click(
      within(r.container).getByRole("button", {
        name: "Ask the Planner to fix it",
      }),
    );
    const [shown, details] =
      api.send.mock.calls[api.send.mock.calls.length - 1];
    expect(shown).toBe("Please have the Planner fill the gaps in the plan.");
    expect(details).toMatch(/^\(What's missing, for the Planner:\n- /);
  });
});

describe("release 3a: matches the mockup", () => {
  const PLAN = {
    summary: "A home dashboard with your lights",
    pieces: [
      {
        kind: "widget",
        name: "Weather",
        source: "registry",
        package: "@trops/weather",
      },
      {
        kind: "widget",
        name: "Lights panel",
        source: "new",
        providers: ["home-assistant"],
      },
      { kind: "layout", name: "Home", source: "new" },
    ],
  };
  const planStep = (id, plan = PLAN) => ({
    who: "step",
    id,
    bot: "the Planner",
    label: "Asked the Planner",
    status: "done",
    answer: "Here's a plan.",
    result: "Here's a plan.",
    plan,
  });
  const you = (text) => ({ who: "you", text });
  const reply = { who: "role", text: "Want it built?" };
  const api = { busy: false, send: jest.fn(), focusReply: jest.fn() };

  test("the switcher's list scrolls, each with its avatar, the current one ticked", () => {
    render(
      <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={jest.fn()} />,
    );
    // Under the name at the top: who's on the team.
    expect(screen.getByTestId("workspace-switcher")).toHaveTextContent(
      "Inbox Watch",
    );
    fireEvent.click(screen.getByTestId("workspace-switcher"));
    const menu = screen.getByTestId("workspace-switcher-menu");
    expect(menu.className).toMatch(/overflow-y-auto/);
    expect(menu.style.maxHeight).toBe("calc(100% - 88px)");
    const items = within(menu).getAllByTestId("workspace-switcher-item");
    for (const it of items) {
      expect(within(it).getByTestId("bot-avatar")).toBeInTheDocument();
    }
    const current = within(menu).getByRole("button", {
      name: "Kitchen Sink Lead",
    });
    expect(within(current).getByLabelText("Current")).toBeInTheDocument();
    expect(
      within(
        within(menu).getByRole("button", { name: "Dash Lead" }),
      ).queryByLabelText("Current"),
    ).toBeNull();
  });

  test("a new Dash Lead conversation: Start from, the team ready, a New conversation row", () => {
    const onClose = jest.fn();
    const onOpenPage = jest.fn();
    render(
      <LeadWorkspace
        request={{ key: "role:dashlead" }}
        onClose={onClose}
        onOpenPage={onOpenPage}
      />,
    );
    expect(screen.getByTestId("workspace-start")).toHaveTextContent(
      "What should we make?",
    );
    expect(screen.getByTestId("workspace-thread-new")).toHaveTextContent(
      "New conversation",
    );
    const from = screen.getByTestId("workspace-start-from");
    expect(
      within(from)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "Describe itSay what you want in the box — the usual way",
      "A dashboard from the registryInstall a ready-made one and its bots, then adjust it",
      "Copy one of your dashboardsStart from what you have and change it",
      "Edit a widget you haveOpen it in the Widget Builder",
    ]);
    // Nothing made yet: no empty Outputs box under Start from.
    expect(screen.queryByText("What the team makes shows here.")).toBeNull();
    // The team in the order it works, each saying what it's for.
    const rows = screen.getAllByTestId("workspace-member");
    expect(rows[0]).toHaveTextContent("Scout · ready");
    expect(rows[0]).toHaveTextContent("finds what you already have");
    expect(rows[1]).toHaveTextContent("Planner · ready");
    expect(rows[1]).toHaveTextContent("turns your request into a plan");

    fireEvent.click(within(from).getByText("Describe it"));
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Ask Dash Lead" }),
    );
    fireEvent.click(within(from).getByText("Copy one of your dashboards"));
    expect(onOpenPage).toHaveBeenLastCalledWith("dashboards");
    fireEvent.click(within(from).getByText("Edit a widget you have"));
    expect(onOpenPage).toHaveBeenLastCalledWith("widgets");
    // The registry's dashboards open on the right (release 6c, frame 42).
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:open-create", listen);
    fireEvent.click(within(from).getByText("A dashboard from the registry"));
    window.removeEventListener("dash:open-create", listen);
    expect(heard).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace-registry")).toBeInTheDocument();
  });

  describe("a page's New (release 6c, frame 41)", () => {
    test("opening a Recent drops it; a reopened conversation shows its own", async () => {
      render(
        <LeadWorkspace
          request={{
            key: "role:dashlead",
            making: { kind: "widget", from: "widgets" },
          }}
          onClose={jest.fn()}
        />,
      );
      fireEvent.click(
        await screen.findByRole("button", { name: /Do I have a clock/ }),
      );
      expect(screen.queryByTestId("workspace-about")).toBeNull();
      expect(mockAskProps.about).toBeNull();
      act(() =>
        mockAskProps.onAbout({ label: "Making", text: "a bot", note: "(n)" }),
      );
      expect(screen.getByTestId("workspace-about")).toHaveTextContent(
        "Making: a bot",
      );
    });

    test("says what's being made, its greeting and starters; no Start from", () => {
      render(
        <LeadWorkspace
          request={{
            key: "role:dashlead",
            making: { kind: "widget", from: "widgets" },
          }}
          onClose={jest.fn()}
        />,
      );
      expect(screen.getByTestId("workspace-about")).toHaveTextContent(
        "Making: a widget — from the Widgets page",
      );
      const start = screen.getByTestId("workspace-start");
      expect(start).toHaveTextContent("What should the widget do?");
      expect(
        within(start).getByRole("button", { name: "Track a stock price" }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("workspace-start-from")).toBeNull();
    });

    test("the first question tells the Dash Lead what's being made; the line stays", () => {
      render(
        <LeadWorkspace
          request={{
            key: "role:dashlead",
            making: { kind: "bot", from: "bots" },
          }}
          onClose={jest.fn()}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Sum up my email each morning" }),
      );
      expect(mockAskProps.question).toBe("Sum up my email each morning");
      expect(mockAskProps.about).toEqual({
        label: "Making",
        text: "a bot — from the Bots page",
        note: "(The user wants to make a bot — plan a bot.)",
      });
      expect(screen.getByTestId("workspace-about")).toHaveTextContent(
        "Making: a bot — from the Bots page",
      );
    });

    test("New conversation starts an ordinary one", () => {
      render(
        <LeadWorkspace
          request={{
            key: "role:dashlead",
            making: { kind: "dashboard", from: "dashboards" },
          }}
          onClose={jest.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "My AWS costs" }));
      fireEvent.click(
        screen.getByRole("button", { name: "+ New conversation" }),
      );
      expect(screen.queryByTestId("workspace-about")).toBeNull();
      expect(screen.getByTestId("workspace-start")).toHaveTextContent(
        "What should we make?",
      );
      expect(screen.getByTestId("workspace-start-from")).toBeInTheDocument();
    });
  });

  describe("Start from › a dashboard from the registry (release 6c, frame 42)", () => {
    const index = {
      packages: [
        {
          type: "dashboard",
          scope: "trops",
          name: "home",
          displayName: "Home",
          widgets: [{}, {}, {}, {}],
          team: { members: [{ role: "lights" }] },
          providerTypes: ["home-assistant"],
        },
        { type: "dashboard", name: "secret", visibility: "private" },
        { type: "widget", name: "clock" },
      ],
    };
    const config = {
      name: "Home",
      description: "Your home at a glance",
      workspace: { layout: [{ id: 1, component: "trops.weather.Weather" }] },
      widgets: [{ scope: "trops", packageName: "weather" }],
      providers: [],
      team: { members: [] },
    };

    test("lists the public dashboards; Use this starts a conversation with its plan", async () => {
      window.mainApi.registry = {
        fetchIndex: jest.fn().mockResolvedValue(index),
      };
      window.mainApi.dashboardConfig = {
        getPackageConfig: jest
          .fn()
          .mockResolvedValue({ success: true, config }),
      };
      render(
        <LeadWorkspace
          request={{ key: "role:dashlead" }}
          onClose={jest.fn()}
        />,
      );
      fireEvent.click(screen.getByText("A dashboard from the registry"));
      const rows = await screen.findAllByTestId("workspace-registry-row");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent("Home");
      expect(rows[0]).toHaveTextContent(
        "trops · 4 widgets · 1 bot · needs Home Assistant",
      );
      fireEvent.click(
        within(rows[0]).getByRole("button", { name: "Use this: Home" }),
      );
      await waitFor(() =>
        expect(mockAskProps && mockAskProps.recentId).toBe("q_new"),
      );
      expect(
        window.mainApi.dashboardConfig.getPackageConfig,
      ).toHaveBeenCalledWith("home");
      const saved = window.mainApi.bots.saveCreateRecent.mock.calls[0][0];
      expect(saved.prompt).toBe("Start from Home");
      const msgs = saved.conversation.messages;
      expect(msgs[0]).toEqual({
        who: "you",
        text: "Start from Home, from the registry",
      });
      expect(msgs[1]).toMatchObject({
        who: "step",
        bot: "the registry",
        label: "Read Home",
      });
      expect(msgs[1].plan.pieces.map((p) => p.kind)).toEqual([
        "widget",
        "layout",
      ]);
      expect(msgs[2].text).toMatch(/^Here's Home from the registry as a plan/);
    });

    test("the registry out of reach says so", async () => {
      window.mainApi.registry = {
        fetchIndex: jest.fn().mockRejectedValue(new Error("offline")),
      };
      render(
        <LeadWorkspace
          request={{ key: "role:dashlead" }}
          onClose={jest.fn()}
        />,
      );
      fireEvent.click(screen.getByText("A dashboard from the registry"));
      expect(
        await screen.findByText(/The registry couldn't be reached/),
      ).toBeInTheDocument();
    });

    test("a package that can't be read says so on its row", async () => {
      window.mainApi.registry = {
        fetchIndex: jest.fn().mockResolvedValue(index),
      };
      window.mainApi.dashboardConfig = {
        getPackageConfig: jest
          .fn()
          .mockResolvedValue({ success: false, error: "Not found." }),
      };
      render(
        <LeadWorkspace
          request={{ key: "role:dashlead" }}
          onClose={jest.fn()}
        />,
      );
      fireEvent.click(screen.getByText("A dashboard from the registry"));
      const [row] = await screen.findAllByTestId("workspace-registry-row");
      fireEvent.click(
        within(row).getByRole("button", { name: "Use this: Home" }),
      );
      expect(await within(row).findByRole("alert")).toHaveTextContent(
        "Home couldn't be read.",
      );
      expect(window.mainApi.bots.saveCreateRecent).not.toHaveBeenCalled();
    });

    const deferred = () => {
      let resolve;
      const promise = new Promise((r) => (resolve = r));
      return { promise, resolve };
    };
    const openList = async () => {
      render(
        <LeadWorkspace
          request={{ key: "role:dashlead" }}
          onClose={jest.fn()}
        />,
      );
      fireEvent.click(screen.getByText("A dashboard from the registry"));
      const [row] = await screen.findAllByTestId("workspace-registry-row");
      return row;
    };

    test("a conversation that couldn't be saved says so on its row", async () => {
      window.mainApi.registry = {
        fetchIndex: jest.fn().mockResolvedValue(index),
      };
      window.mainApi.dashboardConfig = {
        getPackageConfig: jest
          .fn()
          .mockResolvedValue({ success: true, config }),
      };
      window.mainApi.bots.saveCreateRecent = jest.fn().mockResolvedValue({});
      const row = await openList();
      fireEvent.click(
        within(row).getByRole("button", { name: "Use this: Home" }),
      );
      expect(await within(row).findByRole("alert")).toHaveTextContent(
        "Home didn't come over.",
      );
      expect(screen.queryByTestId("ask-step")).toBeNull();
    });

    test("busy until it's open: a second click doesn't make two", async () => {
      window.mainApi.registry = {
        fetchIndex: jest.fn().mockResolvedValue(index),
      };
      window.mainApi.dashboardConfig = {
        getPackageConfig: jest
          .fn()
          .mockResolvedValue({ success: true, config }),
      };
      const saving = deferred();
      window.mainApi.bots.saveCreateRecent = jest.fn(() => saving.promise);
      const row = await openList();
      const use = within(row).getByRole("button", { name: "Use this: Home" });
      fireEvent.click(use);
      await waitFor(() =>
        expect(window.mainApi.bots.saveCreateRecent).toHaveBeenCalledTimes(1),
      );
      expect(use).toBeDisabled();
      fireEvent.click(use);
      await act(async () => saving.resolve({ id: "q_new" }));
      expect(window.mainApi.bots.saveCreateRecent).toHaveBeenCalledTimes(1);
      expect(mockAskProps.recentId).toBe("q_new");
    });

    test("moved on while it was read: nothing opens", async () => {
      window.mainApi.registry = {
        fetchIndex: jest.fn().mockResolvedValue(index),
      };
      const reading = deferred();
      window.mainApi.dashboardConfig = {
        getPackageConfig: jest.fn(() => reading.promise),
      };
      const row = await openList();
      fireEvent.click(
        within(row).getByRole("button", { name: "Use this: Home" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "+ New conversation" }),
      );
      await act(async () => reading.resolve({ success: true, config }));
      expect(window.mainApi.bots.saveCreateRecent).not.toHaveBeenCalled();
      expect(screen.queryByTestId("ask-step")).toBeNull();
    });

    test("moved on while it was saved: it isn't opened over what you did", async () => {
      window.mainApi.registry = {
        fetchIndex: jest.fn().mockResolvedValue(index),
      };
      window.mainApi.dashboardConfig = {
        getPackageConfig: jest
          .fn()
          .mockResolvedValue({ success: true, config }),
      };
      const saving = deferred();
      window.mainApi.bots.saveCreateRecent = jest.fn(() => saving.promise);
      const row = await openList();
      fireEvent.click(
        within(row).getByRole("button", { name: "Use this: Home" }),
      );
      await waitFor(() =>
        expect(window.mainApi.bots.saveCreateRecent).toHaveBeenCalled(),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "+ New conversation" }),
      );
      await act(async () => saving.resolve({ id: "q_new" }));
      expect(screen.queryByTestId("ask-step")).toBeNull();
      expect(screen.getByTestId("workspace-start")).toBeInTheDocument();
    });

    test("an empty registry says so", async () => {
      window.mainApi.registry = {
        fetchIndex: jest.fn().mockResolvedValue({ packages: [] }),
      };
      render(
        <LeadWorkspace
          request={{ key: "role:dashlead" }}
          onClose={jest.fn()}
        />,
      );
      fireEvent.click(screen.getByText("A dashboard from the registry"));
      expect(
        await screen.findByText("There are no dashboards in the registry yet."),
      ).toBeInTheDocument();
    });
  });

  test("a plan ready: Outputs first, the team waits for the go-ahead, providers at the foot", () => {
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "A dashboard for my smart home" }),
    );
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([you("Plan it"), planStep("1:t1"), reply]);
    });
    expect(mockAskProps.placeholder).toBe("Reply");
    expect(mockAskProps.hint).toBeNull();
    const side = screen.getByTestId("workspace-side");
    // Outputs heads the column; Before it builds sits under it.
    const text = side.textContent;
    expect(text.indexOf("Outputs")).toBeLessThan(
      text.indexOf("Before it builds"),
    );
    expect(screen.queryByTestId("workspace-start-from")).toBeNull();
    expect(within(side).getByTestId("workspace-output-plan")).toHaveTextContent(
      "Plan",
    );
    const rows = screen.getAllByTestId("workspace-member");
    expect(rows[1]).toHaveTextContent("Planner · done");
    // What it made, not its first words; the Scout wasn't needed.
    expect(rows[1]).toHaveTextContent("drafted a plan — 2 widgets");
    expect(rows[0]).toHaveTextContent("Scout · not needed");
    expect(
      within(rows[1]).getByRole("button", { name: "Plan ›" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workspace-providers")).toHaveTextContent(
      "Home Assistant · not connected yet",
    );
    // Before it builds: the action on each row (Review, Connect).
    const before = screen.getByTestId("workspace-before");
    expect(
      within(before)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(expect.arrayContaining(["Review", "Connect"]));
    // The opened plan: what's missing to connect, as a row.
    fireEvent.click(within(side).getByTestId("workspace-output-plan"));
    const out = screen.getByTestId("workspace-plan-output");
    expect(out).toHaveTextContent("2 widgets · uses Home Assistant");
    expect(out).toHaveTextContent("Needs Home Assistant connected");
  });

  test("a changed plan: the earlier card stays and opens the earlier plan", () => {
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "A dashboard for my smart home" }),
    );
    const OLD = { ...PLAN, pieces: PLAN.pieces.slice(1) };
    const msgs = [
      you("Plan it"),
      planStep("1:t1", OLD),
      reply,
      you("Add the weather"),
      planStep("2:t1"),
      reply,
    ];
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange(msgs);
    });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(msgs[1], 1, api);
    });
    const card = render(node);
    expect(card.container).toHaveTextContent("changed since");
    fireEvent.click(within(card.container).getByRole("button"));
    const out = screen.getByTestId("workspace-plan-output");
    expect(out).toHaveTextContent("Planner · an earlier plan");
    expect(out).not.toHaveTextContent("Weather");
    expect(
      within(out).queryByRole("button", { name: "Yes, build it" }),
    ).toBeNull();
  });
});

describe("release 3b: building in the conversation", () => {
  const PLAN = {
    summary: "A home dashboard with your lights",
    pieces: [
      { kind: "widget", name: "Lights panel", source: "new" },
      { kind: "widget", name: "Camera strip", source: "new" },
      { kind: "layout", name: "Home", source: "new" },
    ],
  };
  const planStep = (id, plan = PLAN) => ({
    who: "step",
    id,
    bot: "the Planner",
    label: "Asked the Planner",
    status: "done",
    answer: "Here's a plan.",
    result: "Here's a plan.",
    plan,
  });
  const you = (text) => ({ who: "you", text });
  const reply = { who: "role", text: "Want it built?" };
  const api = { busy: false, send: jest.fn(), focusReply: jest.fn() };
  const at = (hh, mm) => new Date(2026, 9, 29, hh, mm).toISOString();
  const s = (over) => ({ status: "waiting", role: "dash", ...over });
  const RUNNING = {
    status: "running",
    startedAt: at(21, 14),
    steps: [
      s({
        id: "dashboard",
        kind: "dashboard",
        label: 'Create the "Home" dashboard',
        status: "done",
        finishedAt: at(21, 14),
      }),
      s({
        id: "build:0",
        kind: "build",
        piece: 0,
        role: "builder",
        label: "Build Lights panel",
        status: "done",
        finishedAt: at(21, 15),
      }),
      s({
        id: "check:0",
        kind: "check",
        piece: 0,
        role: "checker",
        label: "Check Lights panel",
        status: "done",
        detail: "Renders.\nVERDICT: PASSED",
        finishedAt: at(21, 16),
      }),
      s({
        id: "build:1",
        kind: "build",
        piece: 1,
        role: "builder",
        label: "Build Camera strip",
        status: "running",
        startedAt: at(21, 16),
      }),
      s({
        id: "check:1",
        kind: "check",
        piece: 1,
        role: "checker",
        label: "Check Camera strip",
      }),
      s({
        id: "place:0",
        kind: "place",
        piece: 0,
        label: "Place Lights panel",
      }),
      s({
        id: "place:1",
        kind: "place",
        piece: 1,
        label: "Place Camera strip",
      }),
    ],
  };
  const FAILED = {
    ...RUNNING,
    status: "finished-with-problems",
    finishedAt: at(21, 18),
    dashboard: { id: "12", name: "Home" },
    steps: RUNNING.steps.map((x) =>
      x.id === "build:1"
        ? {
            ...x,
            status: "failed",
            error: "cameras timed out after 30s",
            canFix: true,
            fixesLeft: 2,
            finishedAt: at(21, 17),
          }
        : x.id === "check:1" || x.id === "place:1"
          ? {
              ...x,
              status: "skipped",
              error: "Build Camera strip didn't finish",
            }
          : x.id === "place:0"
            ? { ...x, status: "done", finishedAt: at(21, 18) }
            : x,
    ),
  };

  let push = null;
  beforeEach(() => {
    push = null;
    Object.assign(window.mainApi.bots, {
      startPlanBuild: jest
        .fn()
        .mockResolvedValue({ buildId: "build_1", state: null }),
      getPlanBuild: jest.fn().mockResolvedValue(null),
      onPlanBuild: jest.fn((cb) => {
        push = (state) => act(() => cb({ buildId: "build_1", state }));
        return 9;
      }),
      stopPlanBuild: jest.fn().mockResolvedValue({ ok: true }),
      fixPlanBuild: jest.fn().mockResolvedValue({ ok: true }),
      retryPlanBuild: jest.fn().mockResolvedValue({ ok: true }),
      resumePlanBuild: jest.fn().mockResolvedValue({ ok: true }),
      approvePlanStep: jest.fn().mockResolvedValue({ ok: true }),
    });
  });

  // Asks the Dash Lead, gets the plan, and says Yes, build it.
  const buildIt = async (plan = PLAN, props = {}) => {
    render(
      <LeadWorkspace
        request={{ key: "role:dashlead" }}
        onClose={jest.fn()}
        {...props}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "A dashboard for my smart home" }),
    );
    const msgs = [you("Plan it"), planStep("1:t1", plan), reply];
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange(msgs);
    });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    const choices = render(node);
    fireEvent.click(
      within(choices.container).getByRole("button", { name: "Yes, build it" }),
    );
    choices.unmount();
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalled(),
    );
    await waitFor(() => expect(push).not.toBeNull());
  };
  // The chat after the message the build started from.
  const chat = () => {
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    return render(node).container;
  };

  test("it builds here: the step, the lead's words, Stop in the reply box, the team at work (frame 3)", async () => {
    await buildIt();
    expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledWith(PLAN, {
      recentId: "q_new",
    });
    push(RUNNING);
    const c = chat();
    expect(c).toHaveTextContent("Yes, build it");
    expect(within(c).getByTestId("workspace-build-step")).toHaveTextContent(
      "Builder is building 2 widgets",
    );
    expect(within(c).getByTestId("workspace-build-reply")).toHaveTextContent(
      "Building now",
    );
    // The reply box says what's going on, and its Stop stops the build.
    expect(mockAskProps.working.text).toBe(
      "The team is working · the Builder is building 2 widgets",
    );
    await act(async () => {
      await mockAskProps.working.onStop();
    });
    expect(window.mainApi.bots.stopPlanBuild).toHaveBeenCalledWith("build_1");

    const side = screen.getByTestId("workspace-side");
    expect(within(side).getByTestId("workspace-output-plan")).toHaveTextContent(
      "Building · 3 of 7 done",
    );
    const rows = screen.getAllByTestId("workspace-member");
    const builder = rows.find((r) => r.textContent.startsWith("Builder"));
    const checker = rows.find((r) => r.textContent.startsWith("Checker"));
    expect(builder).toHaveTextContent("Builder · working");
    expect(builder).toHaveTextContent("› Build Camera strip");
    expect(checker).toHaveTextContent("Checker · waiting");
    // The Build log, from the Builder's row (frame 4).
    fireEvent.click(
      within(builder).getByRole("button", { name: "Build log ›" }),
    );
    const log = screen.getByTestId("workspace-build-log");
    expect(log).toHaveTextContent("In progress");
    expect(
      screen
        .getAllByTestId("workspace-build-log-row")
        .map((r) => r.textContent),
    ).toEqual([
      '21:14Create the "Home" dashboard',
      "21:15Build Lights panel",
      "21:16Check Lights panel",
      "21:16Build Camera strip…",
    ]);
  });

  test("a failure: Let the Builder fix it, or leave it off — then Open Home (frames 33, 8)", async () => {
    const onOpenDashboard = jest.fn();
    await buildIt(PLAN, { onOpenDashboard });
    push(FAILED);
    let c = chat();
    expect(within(c).getByTestId("workspace-build-reply")).toHaveTextContent(
      "Camera strip didn't work — cameras timed out after 30s.",
    );
    fireEvent.click(
      within(c).getByRole("button", { name: "Let the Builder fix it" }),
    );
    await waitFor(() =>
      expect(window.mainApi.bots.fixPlanBuild).toHaveBeenCalledWith(
        "build_1",
        "build:1",
      ),
    );
    expect(
      screen
        .getAllByTestId("workspace-member")
        .find((r) => r.textContent.startsWith("Builder")),
    ).toHaveTextContent("Builder · failed");
    c = chat();
    fireEvent.click(within(c).getByRole("button", { name: "Leave it off" }));
    c = chat();
    expect(within(c).getByTestId("workspace-build-reply")).toHaveTextContent(
      "Camera strip is left off.",
    );
    expect(
      within(screen.getByTestId("workspace-side")).getByTestId(
        "workspace-output-plan",
      ),
    ).toHaveTextContent("Built · Camera strip left off");
    // The built dashboard is an output; it opens the Check report (frame 7).
    fireEvent.click(screen.getByTestId("workspace-output-dashboard"));
    expect(screen.getByTestId("workspace-check-report")).toHaveTextContent(
      "Lights panel — passed",
    );
    fireEvent.click(within(c).getByRole("button", { name: "Open Home" }));
    expect(onOpenDashboard).toHaveBeenCalledWith("12");
  });

  test("a provider it waits for: Needs you on the right; connected, it carries on", async () => {
    await buildIt();
    const waiting = {
      ...RUNNING,
      status: "waiting-for-providers",
      finishedAt: at(21, 20),
      steps: [
        ...RUNNING.steps.map((x) => ({ ...x, status: "done" })),
        s({
          id: "bot:0",
          kind: "bot",
          label: "Save the Lights-off bot",
          status: "needs-provider",
          waitingFor: ["home-assistant"],
        }),
      ],
    };
    push(waiting);
    const needs = screen.getByTestId("workspace-build-needs");
    expect(needs).toHaveTextContent("Needs you: connect");
    expect(
      within(needs).getByRole("button", { name: "Connect" }),
    ).toBeInTheDocument();
    expect(window.mainApi.bots.resumePlanBuild).not.toHaveBeenCalled();
  });

  test("one widget on its own: built to look at first — Looks good adds it (frame 31)", async () => {
    const ONE = {
      summary: "A calendar widget",
      pieces: [{ kind: "widget", name: "Calendar", source: "new" }],
    };
    await buildIt(ONE);
    expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledWith(ONE, {
      cell: true,
      standalone: true,
      recentId: "q_new",
    });
    push({
      status: "waiting-for-you",
      steps: [
        s({
          id: "build:0",
          kind: "build",
          piece: 0,
          role: "builder",
          label: "Build Calendar",
          status: "done",
        }),
        s({
          id: "check:0",
          kind: "check",
          piece: 0,
          role: "checker",
          label: "Check Calendar",
          status: "done",
        }),
        s({
          id: "preview:0",
          kind: "preview",
          piece: 0,
          role: "you",
          label: "Preview Calendar",
          status: "needs-you",
        }),
        s({ id: "save:0", kind: "save", piece: 0, label: "Install Calendar" }),
      ],
    });
    expect(screen.getByTestId("workspace-output-preview")).toHaveTextContent(
      "Calendar",
    );
    const c = chat();
    fireEvent.click(within(c).getByRole("button", { name: "Looks good" }));
    await waitFor(() =>
      expect(window.mainApi.bots.approvePlanStep).toHaveBeenCalledWith(
        "build_1",
        "preview:0",
        {},
      ),
    );
  });

  test("stopped: Carry on building continues the same build in its place", async () => {
    await buildIt();
    push({ ...RUNNING, status: "stopped" });
    window.mainApi.bots.startPlanBuild.mockResolvedValue({
      buildId: "build_2",
      state: null,
    });
    fireEvent.click(
      within(chat()).getByRole("button", { name: "Carry on building" }),
    );
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenLastCalledWith(
        PLAN,
        { resumeFrom: "build_1", recentId: "q_new" },
      ),
    );
    await waitFor(() =>
      expect(window.mainApi.bots.saveCreateRecent).toHaveBeenLastCalledWith({
        id: "q_new",
        conversation: {
          workspacePlan: expect.objectContaining({
            builds: [expect.objectContaining({ buildId: "build_2", at: 2 })],
          }),
        },
      }),
    );
  });

  test("Recents tag a conversation by its build", async () => {
    window.mainApi.bots.listCreateRecent.mockResolvedValue([
      {
        id: "q3",
        kind: "question",
        title: "Plan me a Home dashboard",
        with: "role:dashlead",
        planned: true,
        built: "built",
        updatedAt: "2026-10-28T09:00:00Z",
      },
    ]);
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    const row = await screen.findByText("Plan me a Home dashboard");
    expect(row.closest("[data-testid='workspace-thread']")).toHaveTextContent(
      "Built",
    );
  });
  test("Yes, build it pressed twice starts one build", async () => {
    let finish;
    window.mainApi.bots.startPlanBuild = jest.fn(
      () => new Promise((r) => (finish = r)),
    );
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "A dashboard for my smart home" }),
    );
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([you("Plan it"), planStep("1:t1"), reply]);
    });
    const yes = () => {
      let node = null;
      act(() => {
        node = mockAskProps.renderAfter(reply, 2, api);
      });
      const r = render(node);
      const b = within(r.container).queryByRole("button", {
        name: "Yes, build it",
      });
      if (b) fireEvent.click(b);
      return { r, pressed: !!b };
    };
    expect(yes().pressed).toBe(true);
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledTimes(1),
    );
    // While it starts: no second yes, here or on the right.
    const again = yes();
    expect(again.pressed).toBe(false);
    expect(again.r.container).toHaveTextContent("Starting the build…");
    fireEvent.click(screen.getByTestId("workspace-output-plan"));
    expect(
      within(screen.getByTestId("workspace-plan-output")).queryByRole(
        "button",
        { name: "Yes, build it" },
      ),
    ).toBeNull();
    await act(async () => finish({ buildId: "build_1", state: null }));
    expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledTimes(1);
  });

  test("switched to another conversation while it started: the build isn't added there", async () => {
    let finish;
    window.mainApi.bots.startPlanBuild = jest.fn(
      () => new Promise((r) => (finish = r)),
    );
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "A dashboard for my smart home" }),
    );
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([you("Plan it"), planStep("1:t1"), reply]);
    });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    const c = render(node);
    fireEvent.click(
      within(c.container).getByRole("button", { name: "Yes, build it" }),
    );
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalled(),
    );
    // Another conversation, then the build comes back.
    fireEvent.click(await screen.findByText("Do I have a clock?"));
    await act(async () => finish({ buildId: "build_1", state: null }));
    expect(window.mainApi.bots.saveCreateRecent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: {
          workspacePlan: expect.objectContaining({
            builds: [expect.objectContaining({ buildId: "build_1" })],
          }),
        },
      }),
    );
  });

  test("a waiting provider resumes once per change in what's connected, not in a loop", async () => {
    await buildIt();
    const waiting = (finishedAt) => ({
      ...RUNNING,
      status: "waiting-for-providers",
      finishedAt,
      steps: [
        ...RUNNING.steps.map((x) => ({ ...x, status: "done" })),
        s({
          id: "bot:0",
          kind: "bot",
          label: "Save the bot",
          status: "needs-provider",
          waitingFor: ["a way to read cameras"],
        }),
      ],
    });
    push(waiting(at(21, 20)));
    push(waiting(at(21, 21)));
    // Not a provider type: nothing to resume by itself.
    expect(window.mainApi.bots.resumePlanBuild).not.toHaveBeenCalled();
  });

  test("removed: Build it again builds the plan anew", async () => {
    await buildIt();
    push({ ...FAILED, status: "removed" });
    window.mainApi.bots.startPlanBuild.mockResolvedValue({
      buildId: "build_2",
      state: null,
    });
    const c = chat();
    expect(within(c).getByTestId("workspace-build-reply")).toHaveTextContent(
      "I removed what the build made.",
    );
    fireEvent.click(within(c).getByRole("button", { name: "Build it again" }));
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenLastCalledWith(
        PLAN,
        { recentId: "q_new" },
      ),
    );
    await waitFor(() =>
      expect(window.mainApi.bots.saveCreateRecent).toHaveBeenLastCalledWith({
        id: "q_new",
        conversation: {
          workspacePlan: expect.objectContaining({
            builds: [
              expect.objectContaining({ buildId: "build_1" }),
              expect.objectContaining({ buildId: "build_2" }),
            ],
          }),
        },
      }),
    );
  });

  test("reopened: an earlier build shows as it ended, even when the app no longer has it", async () => {
    window.mainApi.bots.getCreateRecent = jest.fn().mockResolvedValue({
      conversation: {
        workspacePlan: {
          stepId: "2:t1",
          plan: PLAN,
          checks: {},
          edits: [],
          builds: [
            {
              buildId: "build_old",
              stepId: "1:t1",
              at: 2,
              kind: "dashboard",
              leftOff: [],
              last: { ...FAILED, status: "stopped" },
            },
          ],
        },
      },
    });
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    fireEvent.click(await screen.findByText("Do I have a clock?"));
    await waitFor(() =>
      expect(window.mainApi.bots.getCreateRecent).toHaveBeenCalledWith("q2"),
    );
    const msgs = [
      you("Plan it"),
      planStep("1:t1"),
      reply,
      you("Bigger"),
      planStep("2:t1"),
      reply,
    ];
    act(() => {
      mockAskProps.onMessagesChange(msgs);
    });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    const c = render(node).container;
    await waitFor(() =>
      expect(within(c).getByTestId("workspace-build-step")).toHaveTextContent(
        "The build stopped",
      ),
    );
    // An earlier build offers nothing to press.
    expect(within(c).queryByTestId("workspace-build-choices")).toBeNull();
  });

  test("a second plan's build reuses the first one's work, or starts fresh if it can't", async () => {
    await buildIt();
    push({ ...FAILED, dashboard: { id: "12", name: "Home" } });
    const msgs = [
      you("Plan it"),
      planStep("1:t1"),
      reply,
      you("Bigger"),
      planStep("2:t1"),
      reply,
    ];
    act(() => {
      mockAskProps.onMessagesChange(msgs);
    });
    window.mainApi.bots.startPlanBuild = jest
      .fn()
      .mockResolvedValueOnce({
        error: "What the earlier build made was removed.",
      })
      .mockResolvedValueOnce({ buildId: "build_2", state: null });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 5, api);
    });
    fireEvent.click(
      within(render(node).container).getByRole("button", {
        name: "Yes, build it",
      }),
    );
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledTimes(2),
    );
    expect(window.mainApi.bots.startPlanBuild.mock.calls[0][1]).toEqual({
      resumeFrom: "build_1",
      recentId: "q_new",
    });
    expect(window.mainApi.bots.startPlanBuild.mock.calls[1][1]).toEqual({
      recentId: "q_new",
    });
  });

  test("unsaved edits on the dashboard it changes: it waits for them", async () => {
    globalThis.__dashboardDirtyId = "7";
    try {
      await (async () => {
        render(
          <LeadWorkspace
            request={{ key: "role:dashlead" }}
            onClose={jest.fn()}
          />,
        );
        fireEvent.click(
          screen.getByRole("button", { name: "A dashboard for my smart home" }),
        );
        const TARGETED = {
          summary: "Lights on the kitchen dashboard",
          dashboard: { id: "7", name: "Kitchen Sink" },
          pieces: PLAN.pieces.filter((p) => p.kind === "widget"),
        };
        act(() => {
          mockAskProps.onStarted("q_new");
          mockAskProps.onMessagesChange([
            you("Plan it"),
            planStep("1:t1", TARGETED),
            reply,
          ]);
        });
        let node = null;
        act(() => {
          node = mockAskProps.renderAfter(reply, 2, api);
        });
        fireEvent.click(
          within(render(node).container).getByRole("button", {
            name: "Yes, make the changes",
          }),
        );
        await waitFor(() => {
          act(() => {
            node = mockAskProps.renderAfter(reply, 2, api);
          });
          expect(render(node).container).toHaveTextContent(
            "Save or cancel your edits to Kitchen Sink first",
          );
        });
        expect(window.mainApi.bots.startPlanBuild).not.toHaveBeenCalled();
      })();
    } finally {
      delete globalThis.__dashboardDirtyId;
    }
  });
  test("the walk: an install is reviewed first; Skip takes it out of the plan and waits for another yes", async () => {
    const REG = {
      ...PLAN,
      pieces: [
        {
          kind: "widget",
          name: "Weather",
          source: "registry",
          package: "@trops/weather",
        },
        ...PLAN.pieces,
      ],
    };
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "A dashboard for my smart home" }),
    );
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([
        you("Plan it"),
        planStep("1:t1", REG),
        reply,
      ]);
    });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    fireEvent.click(
      within(render(node).container).getByRole("button", {
        name: "Yes, build it",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Skip this piece" }),
    );
    // Weather is out of the plan; nothing was built.
    fireEvent.click(screen.getByTestId("workspace-output-plan"));
    expect(screen.getByTestId("workspace-plan-output")).not.toHaveTextContent(
      "Weather",
    );
    expect(window.mainApi.bots.startPlanBuild).not.toHaveBeenCalled();
  });
});

describe("release 3c: leads bring in the Dash team; Create opens here; changes show before and after", () => {
  const you = (text) => ({ who: "you", text });
  const PLAN = {
    summary: "Weather on Kitchen Sink",
    dashboard: { id: "7", name: "Kitchen Sink" },
    pieces: [
      {
        kind: "widget",
        name: "Weather",
        source: "registry",
        package: "@trops/weather",
      },
    ],
  };
  const dashStep = {
    who: "step",
    id: "1:t1",
    bot: "the Planner",
    label: "Brought in the Dash team · asked the Planner",
    status: "done",
    answer: "Here's a plan.",
    result: "Here's a plan.",
    dashTeam: true,
    plan: PLAN,
  };
  const reply = {
    who: "lead",
    text: "I brought in the Dash team. Want it built?",
  };
  const KITCHEN = {
    id: 7,
    name: "Kitchen Sink",
    layout: [
      {
        id: 1,
        component: "LayoutGridContainer",
        grid: {
          rows: 1,
          cols: 3,
          1.1: { component: 2 },
          1.2: { component: null },
          1.3: { component: null },
        },
      },
      { id: 2, component: "trops.inbox.InboxWatch" },
    ],
  };

  const openLead = () => {
    window.mainApi.workspace = {
      listWorkspacesForApplication: jest.fn().mockResolvedValue([KITCHEN]),
    };
    render(
      <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={jest.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "What did my bots do today?" }),
    );
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([you("Add the weather"), dashStep, reply]);
    });
  };

  test("a dashboard lead's Dash team shows under its own bots, brought in by it (frame 18)", () => {
    openLead();
    expect(screen.getByTestId("workspace-team-group")).toHaveTextContent(
      "Dash team · brought in by Kitchen Sink Lead",
    );
    const rows = screen
      .getAllByTestId("workspace-member")
      .map((r) => r.textContent);
    // Its own bot wasn't asked for this plan; the Planner drafted it, and
    // the Builder waits for the yes — only the roles in it (frame 18).
    expect(rows[0]).toMatch(/^Inbox Watch · not needed/);
    expect(rows.slice(1).map((r) => r.split(" · ")[0])).toEqual([
      "Planner",
      "Builder",
    ]);
    expect(rows[1]).toMatch(/Planner · done/);
    // Its link says what the Planner made: the changes (frame 30).
    expect(
      screen.getByRole("button", { name: "Changes ›" }),
    ).toBeInTheDocument();
  });

  test("a plan for this dashboard shows what changes: now and after, and Yes, make the changes (frame 30)", async () => {
    openLead();
    const side = screen.getByTestId("workspace-side");
    expect(within(side).getByTestId("workspace-output-plan")).toHaveTextContent(
      "Kitchen Sink — changes",
    );
    fireEvent.click(within(side).getByTestId("workspace-output-plan"));
    const out = screen.getByTestId("workspace-plan-output");
    expect(out).toHaveTextContent("Planner · the changes");
    expect(out).toHaveTextContent("Nothing changes until you say yes");
    await waitFor(() =>
      expect(screen.getAllByTestId("workspace-plan-grid")).toHaveLength(2),
    );
    const [now, after] = screen.getAllByTestId("workspace-plan-grid");
    const tiles = (g) =>
      within(g)
        .getAllByTestId("workspace-plan-tile")
        .map((t) => `${t.textContent.trim()}:${t.getAttribute("data-kind")}`);
    // What's added and what's empty is said, not only shown.
    expect(tiles(now)).toEqual([
      "Inbox Watch:keep",
      "empty cell:empty",
      "empty cell:empty",
    ]);
    expect(tiles(after)).toEqual([
      "Inbox Watch:keep",
      "Weather (added):add",
      "empty cell:empty",
    ]);
    expect(
      screen.getByRole("group", { name: "After: the dashboard's cells" }),
    ).toBeInTheDocument();
    expect(out).toHaveTextContent("Weather — added");
    expect(out).toHaveTextContent("Inbox Watch — unchanged");
    expect(
      within(out).getByRole("button", { name: "Yes, make the changes" }),
    ).toBeInTheDocument();
    // The card in the chat says what it changes.
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(dashStep, 1, {
        busy: false,
        send: jest.fn(),
        focusReply: jest.fn(),
      });
    });
    expect(render(node).container).toHaveTextContent(
      "Plan · 1 added · on Kitchen Sink",
    );
  });

  test("Open as a plan: the plan carries on as a new Dash Lead conversation", async () => {
    render(
      <LeadWorkspace
        request={{
          key: "role:dashlead",
          seed: {
            plan: PLAN,
            label: "Weather on my kitchen dashboard",
            messages: [
              { who: "you", text: "Weather on my kitchen dashboard" },
              { who: "planner", text: "Here's a plan." },
            ],
          },
        }}
        onClose={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(window.mainApi.bots.saveCreateRecent).toHaveBeenCalledWith({
        kind: "question",
        prompt: "Weather on my kitchen dashboard",
        conversation: {
          recipient: { role: "dashlead", roleName: "Dash Lead" },
          messages: expect.arrayContaining([
            expect.objectContaining({ who: "step", plan: PLAN }),
          ]),
        },
      }),
    );
    // Opened like any conversation in Recents.
    await waitFor(() => expect(mockAskProps.recentId).toBe("q_new"));
  });

  test("Open as a plan that can't be saved says so, rather than losing it", async () => {
    window.mainApi.bots.saveCreateRecent = jest
      .fn()
      .mockRejectedValue(new Error("disk full"));
    render(
      <LeadWorkspace
        request={{ key: "role:dashlead", seed: { plan: PLAN, messages: [] } }}
        onClose={jest.fn()}
      />,
    );
    expect(await screen.findByTestId("workspace-seed-error")).toHaveTextContent(
      "didn't come over",
    );
  });

  test("once it's built, the changed plan shows no before and after (the dashboard has it now)", async () => {
    window.mainApi.bots.startPlanBuild = jest
      .fn()
      .mockResolvedValue({ buildId: "build_9", state: null });
    window.mainApi.bots.getPlanBuild = jest.fn().mockResolvedValue({
      buildId: "build_9",
      state: {
        status: "done",
        dashboard: { id: "7", name: "Kitchen Sink", targeted: true },
        steps: [],
      },
    });
    window.mainApi.bots.onPlanBuild = jest.fn(() => 9);
    openLead();
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, {
        busy: false,
        send: jest.fn(),
        focusReply: jest.fn(),
      });
    });
    fireEvent.click(
      within(render(node).container).getByRole("button", {
        name: "Yes, make the changes",
      }),
    );
    // The registry widget is reviewed first.
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId("workspace-side")).getByTestId(
          "workspace-output-plan",
        ),
      ).toHaveTextContent("Built"),
    );
    fireEvent.click(
      within(screen.getByTestId("workspace-side")).getByTestId(
        "workspace-output-plan",
      ),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryAllByTestId("workspace-plan-grid")).toHaveLength(0);
    expect(screen.getByTestId("workspace-plan-output")).toHaveTextContent(
      "Built",
    );
  });
});

test("release 4: opened on one of a lead's conversations (Review in conversation)", () => {
  render(
    <LeadWorkspace
      request={{ key: "lead:lead_7", recentId: "q1" }}
      onClose={jest.fn()}
    />,
  );
  expect(mockAskProps.recentId).toBe("q1");
});

// Release 6a (frames 35, 36): a smaller window folds the columns away.
describe("a smaller window", () => {
  const wideAs = window.innerWidth;
  afterEach(() => {
    window.innerWidth = wideAs;
  });

  it("the left column folds to ☰, Outputs is a button that slides over; a waiting approval puts a dot on it", async () => {
    window.innerWidth = 1024;
    mockApprovals = [
      { id: "a1", request: { botId: "b1", toolName: "gmail_send" } },
    ];
    render(
      <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={jest.fn()} />,
    );
    expect(screen.getByTestId("workspace-nav")).toHaveClass("hidden");
    expect(
      screen.getByRole("complementary", { hidden: true, name: "Outputs" }),
    ).toHaveClass("hidden");
    const outputs = screen.getByRole("button", {
      name: "Outputs 0 — something needs you",
    });
    expect(screen.getByTestId("workspace-outputs-dot")).toBeInTheDocument();
    // Outputs slides over the conversation; its × closes it, not the window.
    fireEvent.click(outputs);
    const aside = screen.getByRole("complementary", { name: "Outputs" });
    expect(aside).toHaveClass("absolute");
    expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
    fireEvent.click(
      within(aside).getByRole("button", { name: "Close outputs" }),
    );
    expect(aside).toHaveClass("hidden");
    // ☰ opens the leads and conversations; picking one closes it.
    fireEvent.click(
      screen.getByRole("button", { name: "Conversations and leads" }),
    );
    const nav = screen.getByTestId("workspace-nav");
    expect(nav).toHaveClass("absolute");
    // The drawer covers ☰: clicking beside it, or Escape, closes it.
    fireEvent.click(screen.getByTestId("workspace-scrim"));
    expect(screen.getByTestId("workspace-nav")).toHaveClass("hidden");
    fireEvent.click(
      screen.getByRole("button", { name: "Conversations and leads" }),
    );
    fireEvent.keyDown(screen.getByTestId("workspace-nav"), { key: "Escape" });
    expect(screen.getByTestId("workspace-nav")).toHaveClass("hidden");
    fireEvent.click(
      screen.getByRole("button", { name: "Conversations and leads" }),
    );
    fireEvent.click(
      await within(screen.getByTestId("workspace-nav")).findByText(
        "Anything urgent?",
      ),
    );
    expect(screen.getByTestId("workspace-nav")).toHaveClass("hidden");
  });

  it("Escape closes a drawer, not the window; the header toggles say they're open; the window's × is in the header", () => {
    window.innerWidth = 1024;
    const onClose = jest.fn();
    render(
      <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={onClose} />,
    );
    const nav = screen.getByRole("button", { name: "Conversations and leads" });
    expect(nav).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(nav);
    expect(nav).toHaveAttribute("aria-expanded", "true");
    // Focus goes into the drawer.
    expect(screen.getByTestId("workspace-nav")).toContainElement(
      document.activeElement,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("workspace-nav")).toHaveClass("hidden");
    expect(onClose).not.toHaveBeenCalled();
    // …and back to the button that opened it.
    expect(document.activeElement).toBe(nav);
    const outs = screen.getByRole("button", { name: /^Outputs \d/ });
    fireEvent.click(outs);
    expect(outs).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.getByRole("complementary", { hidden: true, name: "Outputs" }),
    ).toHaveClass("hidden");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it("the drawer closes on + New conversation and on switching lead", () => {
    window.innerWidth = 1024;
    render(
      <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={jest.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Conversations and leads" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "+ New conversation" }));
    expect(screen.getByTestId("workspace-nav")).toHaveClass("hidden");
    fireEvent.click(
      screen.getByRole("button", { name: "Conversations and leads" }),
    );
    fireEvent.click(screen.getByTestId("workspace-switcher"));
    fireEvent.click(
      within(screen.getByTestId("workspace-switcher-menu")).getByText(
        "Dash Lead",
      ),
    );
    expect(screen.getByTestId("workspace-nav")).toHaveClass("hidden");
  });

  it("growing the window brings the columns back", () => {
    window.innerWidth = 1024;
    render(
      <LeadWorkspace request={{ key: "lead:lead_7" }} onClose={jest.fn()} />,
    );
    expect(screen.getByTestId("workspace-nav")).toHaveClass("hidden");
    act(() => {
      window.innerWidth = 1600;
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByTestId("workspace-nav")).not.toHaveClass("hidden");
    expect(
      screen.queryByRole("button", { name: "Conversations and leads" }),
    ).toBeNull();
  });
});

describe("an empty cell (release 6c, frames 38, 39)", () => {
  const CELL = {
    workspaceId: "7",
    gridItemId: 3,
    cellNumber: "2.1",
    pageId: "p1",
    scope: "main",
  };
  const ONE = {
    summary: "A weather widget",
    pieces: [{ kind: "widget", name: "Weather", source: "new" }],
  };
  const you = (text) => ({ who: "you", text });
  const reply = { who: "role", text: "Put it there?" };
  const api = { busy: false, send: jest.fn(), focusReply: jest.fn() };
  const planStep = (plan) => ({
    who: "step",
    id: "1:t1",
    bot: "the Planner",
    label: "Asked the Planner",
    status: "done",
    answer: "Here's a plan.",
    result: "Here's a plan.",
    plan,
  });
  let push = null;
  beforeEach(() => {
    push = null;
    Object.assign(window.mainApi.bots, {
      startPlanBuild: jest
        .fn()
        .mockResolvedValue({ buildId: "build_c", state: null }),
      getPlanBuild: jest.fn().mockResolvedValue(null),
      onPlanBuild: jest.fn((cb) => {
        push = (state) => act(() => cb({ buildId: "build_c", state }));
        return 9;
      }),
      approvePlanStep: jest.fn().mockResolvedValue({ ok: true }),
    });
  });

  test("opens with the dashboard's lead: For: that cell, its greeting and starters", () => {
    render(<LeadWorkspace request={{ cell: CELL }} onClose={jest.fn()} />);
    expect(screen.getByTestId("workspace-about")).toHaveTextContent(
      "For: Kitchen Sink — the empty cell in row 2, column 1",
    );
    const start = screen.getByTestId("workspace-start");
    expect(start).toHaveTextContent("What should go in this cell?");
    expect(start).toHaveTextContent(
      "Kitchen Sink Lead brings in the Dash team",
    );
    expect(
      within(start).getByRole("button", { name: "The weather" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workspace-switcher")).toHaveTextContent(
      "Kitchen Sink Lead",
    );
    fireEvent.click(within(start).getByRole("button", { name: "The weather" }));
    expect(mockAskProps.recipient).toMatchObject({ botId: "lead_7" });
    expect(mockAskProps.about.label).toBe("For");
    expect(mockAskProps.about.note).toMatch(/Plan exactly one widget/);
    expect(mockAskProps.about.cell).toMatchObject({
      gridItemId: 3,
      cellNumber: "2.1",
      dashboardName: "Kitchen Sink",
    });
  });

  test("a plan with more than one widget doesn't fit: the check says so, nothing is built", () => {
    render(<LeadWorkspace request={{ cell: CELL }} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "The weather" }));
    const TWO = {
      summary: "Two",
      pieces: [
        { kind: "widget", name: "Weather", source: "new" },
        { kind: "widget", name: "Clock", source: "new" },
      ],
    };
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([you("The weather"), planStep(TWO), reply]);
    });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    const choices = render(node);
    expect(
      within(choices.container).queryByRole("button", { name: "Yes, add it" }),
    ).toBeNull();
    expect(
      within(choices.container).getByRole("button", {
        name: "Ask the Planner to fix it",
      }),
    ).toBeInTheDocument();
    choices.unmount();
    expect(window.mainApi.bots.startPlanBuild).not.toHaveBeenCalled();
  });

  test("New conversation drops the cell: the next plan isn't for it", () => {
    render(<LeadWorkspace request={{ cell: CELL }} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New conversation" }));
    expect(screen.queryByTestId("workspace-about")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "What did my bots do today?" }),
    );
    expect(mockAskProps.about).toBeNull();
  });

  test("Put it in again, while it's still there, stays in", async () => {
    await yesAddIt();
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:place-widget-in-cell", listen);
    push({
      status: "running",
      steps: [{ ...DONE.steps[0], status: "running" }],
    });
    push(DONE);
    act(() => heard[0].onPlaced(true));
    fireEvent.click(
      within(chat()).getByRole("button", { name: "Put it in again" }),
    );
    act(() => heard[1].onPlaced("taken"));
    window.removeEventListener("dash:place-widget-in-cell", listen);
    expect(
      within(chat()).getByTestId("workspace-build-reply"),
    ).toHaveTextContent("Weather is in the cell you picked.");
  });

  test("a build that ends waiting for a provider is put in too", async () => {
    await yesAddIt();
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:place-widget-in-cell", listen);
    push({
      status: "running",
      steps: [{ ...DONE.steps[0], status: "running" }],
    });
    push({ ...DONE, status: "waiting-for-providers" });
    window.removeEventListener("dash:place-widget-in-cell", listen);
    expect(heard).toHaveLength(1);
  });

  test("a dashboard with no lead: the Dash Lead", () => {
    render(
      <LeadWorkspace
        request={{ cell: { ...CELL, workspaceId: "99" } }}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByTestId("workspace-switcher")).toHaveTextContent(
      "Dash Lead",
    );
    expect(screen.getByTestId("workspace-about")).toHaveTextContent(
      "For: Your dashboard — the empty cell in row 2, column 1",
    );
  });

  const yesAddIt = async () => {
    render(<LeadWorkspace request={{ cell: CELL }} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "The weather" }));
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([you("The weather"), planStep(ONE), reply]);
    });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    const choices = render(node);
    fireEvent.click(
      within(choices.container).getByRole("button", { name: "Yes, add it" }),
    );
    choices.unmount();
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalled(),
    );
    await waitFor(() => expect(push).not.toBeNull());
  };
  const chat = () => {
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    return render(node).container;
  };
  const DONE = {
    status: "done",
    made: [
      {
        component: "ai-built.weather.Weather",
        inputs: { settings: { units: "c" } },
      },
    ],
    steps: [
      { id: "build:0", kind: "build", label: "Build Weather", status: "done" },
      {
        id: "install:0",
        kind: "install",
        label: "Install Weather",
        status: "done",
      },
    ],
  };

  test("Yes, add it: built as a cell's, without the dashboard; the editor puts it in", async () => {
    await yesAddIt();
    expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledWith(ONE, {
      cell: true,
      recentId: "q_new",
    });
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:place-widget-in-cell", listen);
    push({
      status: "running",
      steps: [{ ...DONE.steps[0], status: "running" }],
    });
    push(DONE);
    window.removeEventListener("dash:place-widget-in-cell", listen);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      widgetComponentName: "ai-built.weather.Weather",
      cellNumber: "2.1",
      gridItemId: 3,
      workspaceId: "7",
      pageId: "p1",
      scope: "main",
      userPrefs: { units: "c" },
    });
    expect(
      within(chat()).getByTestId("workspace-build-reply"),
    ).toHaveTextContent("putting it in the cell you picked");
    act(() => heard[0].onPlaced(true));
    const c = chat();
    expect(within(c).getByTestId("workspace-build-reply")).toHaveTextContent(
      "Weather is in the cell you picked. Save Kitchen Sink to keep it.",
    );
    expect(
      within(c).queryByRole("button", { name: "Put it in the cell" }),
    ).toBeNull();
  });

  test("not being edited any more: it says so, and Put it in the cell tries again", async () => {
    await yesAddIt();
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:place-widget-in-cell", listen);
    push({
      status: "running",
      steps: [{ ...DONE.steps[0], status: "running" }],
    });
    push(DONE);
    act(() => heard[0].onPlaced("preview"));
    const c = chat();
    expect(within(c).getByTestId("workspace-build-reply")).toHaveTextContent(
      "Kitchen Sink isn't being edited any more",
    );
    fireEvent.click(
      within(c).getByRole("button", { name: "Put it in the cell" }),
    );
    window.removeEventListener("dash:place-widget-in-cell", listen);
    expect(heard).toHaveLength(2);
  });

  test("no editor answers: not placed", async () => {
    await yesAddIt();
    jest.useFakeTimers();
    try {
      push({
        status: "running",
        steps: [{ ...DONE.steps[0], status: "running" }],
      });
      push(DONE);
      act(() => jest.advanceTimersByTime(8000));
    } finally {
      jest.useRealTimers();
    }
    expect(
      within(chat()).getByRole("button", { name: "Put it in the cell" }),
    ).toBeInTheDocument();
  });

  test("a finished cell build reopened isn't put in again by itself", async () => {
    await yesAddIt();
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:place-widget-in-cell", listen);
    push(DONE);
    window.removeEventListener("dash:place-widget-in-cell", listen);
    expect(heard).toHaveLength(0);
    expect(
      within(chat()).getByRole("button", { name: "Put it in the cell" }),
    ).toBeInTheDocument();
  });
});

describe("Change with AI (release 6c, frame 40)", () => {
  const DOOR = {
    component: "trops.weather.Weather",
    sourcePackage: "@trops/weather",
    itemId: 12,
    workspaceId: "7",
    pageId: "p1",
    scope: "main",
    settings: { units: "f" },
  };
  const TARGET = {
    component: "trops.weather.Weather",
    componentName: "Weather",
    displayName: "Weather",
    package: "@trops/weather",
    config: {
      userConfig: {
        units: { displayName: "Units", defaultValue: "f" },
        days: { displayName: "Forecast", defaultValue: 5 },
      },
    },
  };
  const you = (text) => ({ who: "you", text });
  const reply = { who: "role", text: "Change it?" };
  const api = { busy: false, send: jest.fn(), focusReply: jest.fn() };
  const planStep = (plan) => ({
    who: "step",
    id: "1:t1",
    bot: "the Planner",
    label: "Asked the Planner",
    status: "done",
    answer: "Here's a plan.",
    result: "Here's a plan.",
    plan,
  });
  let push = null;
  beforeEach(() => {
    push = null;
    mockWidgetTarget = {
      status: "ready",
      target: TARGET,
      mode: "new",
      usedOn: ["Kitchen Sink"],
    };
    Object.assign(window.mainApi.bots, {
      startPlanBuild: jest
        .fn()
        .mockResolvedValue({ buildId: "build_w", state: null }),
      getPlanBuild: jest.fn().mockResolvedValue(null),
      onPlanBuild: jest.fn((cb) => {
        push = (state) => act(() => cb({ buildId: "build_w", state }));
        return 9;
      }),
    });
  });
  afterEach(() => {
    mockWidgetTarget = { status: "none", target: null, mode: null, usedOn: [] };
  });

  test("opens with its dashboard's lead: Changing: Weather — on Kitchen Sink", () => {
    render(<LeadWorkspace request={{ widget: DOOR }} onClose={jest.fn()} />);
    expect(screen.getByTestId("workspace-switcher")).toHaveTextContent(
      "Kitchen Sink Lead",
    );
    expect(screen.getByTestId("workspace-about")).toHaveTextContent(
      "Changing: Weather — on Kitchen Sink",
    );
    expect(screen.getByTestId("workspace-start")).toHaveTextContent(
      "What should change in Weather?",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Change its settings" }),
    );
    expect(mockAskProps.recipient).toMatchObject({ botId: "lead_7" });
    expect(mockAskProps.about.widget).toMatchObject({
      component: "trops.weather.Weather",
      itemId: 12,
      mode: "new",
    });
  });

  test("from the Widgets page: the Dash Lead", () => {
    render(
      <LeadWorkspace
        request={{ widget: { ...DOOR, itemId: null, workspaceId: null } }}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByTestId("workspace-switcher")).toHaveTextContent(
      "Dash Lead",
    );
    expect(screen.getByTestId("workspace-about")).toHaveTextContent(
      "Changing: Weather",
    );
  });

  test("Edit the code yourself: the Widget Builder on it, by hand; the window closes", () => {
    const onClose = jest.fn();
    render(<LeadWorkspace request={{ widget: DOOR }} onClose={onClose} />);
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:edit-widget-code", listen);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit the code yourself" }),
    );
    window.removeEventListener("dash:edit-widget-code", listen);
    expect(heard[0]).toMatchObject({
      widgetComponentName: "trops.weather.Weather",
      sourcePackage: "@trops/weather",
      widgetId: 12,
      workspaceId: "7",
      userPrefs: { units: "f" },
    });
    expect(onClose).toHaveBeenCalled();
  });

  test("in place or new, when it can go either way: the plan's switch decides the build", async () => {
    mockWidgetTarget = {
      ...mockWidgetTarget,
      mode: "update",
      canInPlace: true,
    };
    const CODE = {
      summary: "Hourly",
      pieces: [
        {
          kind: "widget",
          name: "Weather",
          source: "update",
          package: "@trops/weather",
        },
      ],
    };
    render(<LeadWorkspace request={{ widget: DOOR }} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([you("Show more"), planStep(CODE), reply]);
    });
    fireEvent.click(screen.getByTestId("workspace-output-plan"));
    const sw = within(
      screen.getByTestId("workspace-plan-widget-mode"),
    ).getByRole("switch");
    fireEvent.click(sw);
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    const choices = render(node);
    fireEvent.click(
      within(choices.container).getByRole("button", { name: "Yes, change it" }),
    );
    choices.unmount();
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalled(),
    );
    expect(window.mainApi.bots.startPlanBuild.mock.calls[0][1].edit.mode).toBe(
      "new",
    );
  });

  test("signed out, theirs perhaps: Sign in to change it in place", () => {
    mockWidgetTarget = { ...mockWidgetTarget, mode: "new", canSignIn: true };
    const CODE = {
      summary: "Hourly",
      pieces: [{ kind: "widget", name: "Weather 2", source: "new" }],
    };
    render(<LeadWorkspace request={{ widget: DOOR }} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([you("Show more"), planStep(CODE), reply]);
    });
    fireEvent.click(screen.getByTestId("workspace-output-plan"));
    expect(screen.getByTestId("workspace-plan-widget-mode")).toHaveTextContent(
      "Published Weather yourself? Sign in to change it in place.",
    );
  });

  test("a widget that isn't installed any more says so", () => {
    mockWidgetTarget = {
      status: "missing",
      target: null,
      mode: null,
      usedOn: [],
    };
    render(<LeadWorkspace request={{ widget: DOOR }} onClose={jest.fn()} />);
    expect(screen.getByTestId("workspace-start")).toHaveTextContent(
      "That widget isn't installed any more",
    );
  });

  const yesChangeIt = async (plan) => {
    render(<LeadWorkspace request={{ widget: DOOR }} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    act(() => {
      mockAskProps.onStarted("q_new");
      mockAskProps.onMessagesChange([you("Show more"), planStep(plan), reply]);
    });
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    const choices = render(node);
    fireEvent.click(
      within(choices.container).getByRole("button", { name: "Yes, change it" }),
    );
    choices.unmount();
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalled(),
    );
    await waitFor(() => expect(push).not.toBeNull());
  };
  const chat = () => {
    let node = null;
    act(() => {
      node = mockAskProps.renderAfter(reply, 2, api);
    });
    return render(node).container;
  };

  test("only its settings: set on that copy, without the Builder", async () => {
    const SETTINGS = {
      summary: "°C",
      pieces: [
        {
          kind: "widget",
          name: "Weather",
          source: "settings",
          settings: { units: "c" },
        },
      ],
    };
    await yesChangeIt(SETTINGS);
    expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledWith(SETTINGS, {
      settings: {
        workspaceId: "7",
        itemId: 12,
        pageId: "p1",
        scope: "main",
        component: "trops.weather.Weather",
        displayName: "Weather",
      },
      recentId: "q_new",
    });
    push({
      status: "done",
      dashboard: { id: "7", name: "Kitchen Sink", targeted: true },
      steps: [
        {
          id: "settings:0",
          kind: "settings",
          status: "done",
          label: "Change Weather's settings",
          detail: "units",
        },
      ],
    });
    expect(
      within(chat()).getByTestId("workspace-build-reply"),
    ).toHaveTextContent(
      "Weather's settings are changed on Kitchen Sink: Units. Only this copy changed.",
    );
  });

  test("what it does: an edit build; done, the new one goes in its place", async () => {
    const CODE = {
      summary: "Hourly",
      pieces: [{ kind: "widget", name: "Weather Hourly", source: "new" }],
    };
    await yesChangeIt(CODE);
    expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledWith(CODE, {
      edit: {
        component: "trops.weather.Weather",
        mode: "new",
        displayName: "Weather",
        settings: { units: "f", days: 5 },
        providers: null,
      },
      recentId: "q_new",
    });
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:swap-widget-in-cell", listen);
    push({
      status: "running",
      steps: [
        {
          kind: "build",
          status: "running",
          label: "Write the change into a draft",
        },
      ],
    });
    push({
      status: "done",
      made: [{ component: "ai-built.weatherhourly.WeatherHourly" }],
      steps: [
        {
          kind: "build",
          status: "done",
          label: "Write the change into a draft",
        },
        { kind: "save", status: "done", label: "Install Weather Hourly" },
      ],
    });
    window.removeEventListener("dash:swap-widget-in-cell", listen);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      widgetComponentName: "ai-built.weatherhourly.WeatherHourly",
      widgetId: 12,
      workspaceId: "7",
      pageId: "p1",
      scope: "main",
    });
    act(() => heard[0].onPlaced(true));
    expect(
      within(chat()).getByTestId("workspace-build-reply"),
    ).toHaveTextContent(
      "Weather Hourly is in Weather's place on Kitchen Sink. Save Kitchen Sink to keep it.",
    );
  });

  test("in place: done, it's reloaded everywhere; nothing is swapped", async () => {
    mockWidgetTarget = { ...mockWidgetTarget, mode: "update" };
    const CODE = {
      summary: "Hourly",
      pieces: [
        {
          kind: "widget",
          name: "Weather",
          source: "update",
          package: "@trops/weather",
        },
      ],
    };
    await yesChangeIt(CODE);
    const changed = [];
    const swapped = [];
    const onChanged = (e) => changed.push(e.detail);
    const onSwap = (e) => swapped.push(e.detail);
    window.addEventListener("dash:widget-changed", onChanged);
    window.addEventListener("dash:swap-widget-in-cell", onSwap);
    push({
      status: "running",
      steps: [{ kind: "build", status: "running", label: "x" }],
    });
    push({
      status: "done",
      made: [{ component: "trops.weather.Weather" }],
      steps: [{ kind: "save", status: "done", label: "Update Weather" }],
    });
    window.removeEventListener("dash:widget-changed", onChanged);
    window.removeEventListener("dash:swap-widget-in-cell", onSwap);
    expect(changed).toEqual([
      { package: "@trops/weather", component: "trops.weather.Weather" },
    ]);
    expect(swapped).toHaveLength(0);
    expect(
      within(chat()).getByTestId("workspace-build-reply"),
    ).toHaveTextContent(
      "Weather is updated — everywhere it's used shows the change.",
    );
  });
});
