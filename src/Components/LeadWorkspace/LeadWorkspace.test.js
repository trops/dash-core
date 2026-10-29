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
jest.mock("../AppPages/useAllBots", () => ({
  useAllBots: () => ({
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

import { LeadWorkspace } from "./LeadWorkspace";
import { WorkspaceSide } from "./WorkspaceSide";

beforeEach(() => {
  mockAskProps = null;
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

  test("Yes, build it hands the plan to Create's build, with what's done; Change something goes to the reply box", async () => {
    const onClose = await openWithPlan();
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:open-create", listen);
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
    window.removeEventListener("dash:open-create", listen);
    expect(heard).toEqual([
      {
        type: "dashboard",
        seed: {
          plan: PLAN,
          label: "Home",
          checks: {},
          messages: [
            { who: "you", text: "Plan me a home dashboard" },
            { who: "note", text: "Planned with Dash Lead." },
          ],
        },
      },
    ]);
    expect(onClose).toHaveBeenCalled();
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
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:open-create", listen);
    fireEvent.click(
      within(screen.getByTestId("workspace-plan-output")).getByRole("button", {
        name: "Yes, build it",
      }),
    );
    window.removeEventListener("dash:open-create", listen);
    expect(heard).toHaveLength(1);
    expect(heard[0].seed.messages.map((m) => m.text)).toEqual([
      "Plan it",
      "Bigger",
      "Planned with Dash Lead.",
    ]);
    expect(onClose).toHaveBeenCalled();
    // Saved as sent at once (the window closes next).
    expect(window.mainApi.bots.saveCreateRecent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "q_new",
        conversation: {
          workspacePlan: expect.objectContaining({ sent: true }),
        },
      }),
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
    const heard = [];
    const listen = (e) => heard.push(e.detail);
    window.addEventListener("dash:open-create", listen);
    fireEvent.click(within(from).getByText("A dashboard from the registry"));
    window.removeEventListener("dash:open-create", listen);
    expect(heard).toEqual([{ type: "dashboard" }]);
    expect(onClose).toHaveBeenCalled();
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
