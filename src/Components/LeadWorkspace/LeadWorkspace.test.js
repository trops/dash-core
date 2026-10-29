/**
 * LeadWorkspace (lead-workspace release 2): opens on the lead you picked;
 * the switcher lists leads and lone bots; each lead shows only its own
 * conversations; asking opens the conversation with that lead; the right
 * column shows outputs and what each bot did.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";

jest.mock("@trops/dash-react", () => {
  const actual = jest.requireActual("@trops/dash-react");
  return {
    ...actual,
    // The real Modal portals and animates; the content is what's tested.
    Modal: ({ children }) => <div data-testid="modal">{children}</div>,
  };
});

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
    expect(rows[0]).toHaveTextContent("Inbox Watch · answered");
    expect(rows[0]).toHaveTextContent("2 need attention.");
    expect(rows[1]).toHaveTextContent("Morning Briefer · not asked");
  });

  test("opening an answer shows what it was asked and said; Expand asks for room", () => {
    const onToggleWide = jest.fn();
    render(
      <WorkspaceSide
        contact={contact}
        messages={messages}
        onToggleWide={onToggleWide}
      />,
    );
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
