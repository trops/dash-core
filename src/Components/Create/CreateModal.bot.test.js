/**
 * Create › Bot through the Dash team (consolidation Phase 2c-1): the bot's
 * start screen (Where, the step bar), the Scout first, Use on <dashboard>
 * as a copy, or the Planner plans one.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { CreateModal } from "./CreateModal";

jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: () => null },
}));
let mockScoutProps;
jest.mock("./CreateScoutStep", () => ({
  CreateScoutStep: (props) => {
    mockScoutProps = props;
    return <div data-testid="scout">{props.prompt}</div>;
  },
}));
let mockPlanProps;
jest.mock("./CreatePlanStep", () => ({
  CreatePlanStep: (props) => {
    mockPlanProps = props;
    return <div data-testid="plan-step">{props.prompt}</div>;
  },
  withoutPlan: (t) => t,
}));

const WORKSPACES = [
  { id: 7, name: "Morning Brief" },
  { id: 8, name: "Work" },
];
const INBOX_DIGEST = {
  id: "bot_1",
  name: "Inbox Digest",
  instructions: "Summarize unread mail.",
  mcpServers: ["Work Gmail"],
  toolSelections: { "Work Gmail": ["search"] },
  schedules: [{ cron: "0 9 * * *" }],
};

function setup(props = {}) {
  window.mainApi = {
    llm: {
      checkCliAvailable: jest.fn().mockResolvedValue({ available: true }),
    },
    drafts: { list: jest.fn().mockResolvedValue([]) },
    bots: {
      list: jest.fn().mockResolvedValue([INBOX_DIGEST]),
      listLeads: jest.fn().mockResolvedValue([]),
      listDashTeam: jest.fn().mockResolvedValue([]),
      listCreateRecent: jest.fn().mockResolvedValue([]),
      onCreateRecent: jest.fn(() => 9),
      removeListener: jest.fn(),
    },
    dashboardConfig: {
      getPackageConfig: jest.fn().mockResolvedValue({
        success: true,
        config: {
          name: "Inbox Triage",
          team: {
            members: [
              {
                role: "triager",
                embedded: { name: "Inbox Triager", instructions: "Triage." },
              },
            ],
          },
        },
      }),
    },
  };
  render(
    <ThemeContext.Provider value={{ currentTheme: {} }}>
      <AppContext.Provider value={{ providers: {}, settings: {} }}>
        <CreateModal
          open
          setIsOpen={jest.fn()}
          initialType="bot"
          workspaces={WORKSPACES}
          {...props}
        />
      </AppContext.Provider>
    </ThemeContext.Provider>,
  );
}

const describeIt = (text = "Summarize my unread email every morning") =>
  fireEvent.change(
    screen.getByRole("textbox", { name: "What do you want to make?" }),
    { target: { value: text } },
  );
const stepLabel = () =>
  within(screen.getByTestId("create-bot-steps")).getByTestId("step-label")
    .textContent;

afterEach(() => {
  delete window.mainApi;
  mockScoutProps = null;
  mockPlanProps = null;
});

test("the bot's start screen: Where, the step bar, only the bot form without AI", () => {
  setup({ workspaceId: 7 });
  expect(screen.getByText("What should this bot do?")).toBeInTheDocument();
  expect(
    screen.getByText(/then the Planner plans it with you/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /^Where: Morning Brief/ }),
  ).toBeInTheDocument();
  expect(screen.getByText("Bot for Morning Brief")).toBeInTheDocument();
  expect(stepLabel()).toBe("Describe");
  expect(screen.queryByTestId("create-ask")).toBeNull();
  expect(screen.queryByText("Recent")).toBeNull();
  expect(screen.getByTestId("create-no-ai")).toHaveTextContent(
    "Fill in the bot form",
  );
  expect(screen.queryByText("Blank dashboard")).toBeNull();
});

test("with no dashboard it's a New bot, Where: No dashboard", () => {
  setup();
  expect(
    screen.getByRole("button", { name: /^Where: No dashboard/ }),
  ).toBeInTheDocument();
  expect(screen.getByText("New bot")).toBeInTheDocument();
});

test("a lead's hand-off arrives with the request filled in", () => {
  setup({ workspaceId: 7, initialPrompt: "Add a bot that sums up my mail" });
  expect(
    screen.getByRole("textbox", { name: "What do you want to make?" }),
  ).toHaveValue("Add a bot that sums up my mail");
});

test("Send: the Scout looks for a bot first, then the Planner plans one", () => {
  setup({ workspaceId: 7 });
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(screen.getByTestId("scout")).toBeInTheDocument();
  expect(mockScoutProps.bot).toEqual({ where: "Morning Brief" });
  expect(stepLabel()).toBe("Find");
  act(() => mockScoutProps.onBuildNew());
  expect(mockPlanProps.prompt).toBe("Summarize my unread email every morning");
  expect(mockPlanProps.bot).toEqual({
    where: { id: "7", name: "Morning Brief" },
  });
  expect(stepLabel()).toBe("Plan");
  expect(screen.getByText("Plan a bot for Morning Brief")).toBeInTheDocument();
});

test("Use on Morning Brief: one of your bots, as a copy, shown as the plan", async () => {
  setup({ workspaceId: 7 });
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await act(async () => {
    await mockScoutProps.onUse({
      kind: "bot",
      source: "Yours",
      name: "Inbox Digest",
      package: "bot_1",
    });
  });
  expect(mockPlanProps.seed.request).toBeNull();
  expect(mockPlanProps.seed.plan.dashboard).toEqual({
    id: "7",
    name: "Morning Brief",
  });
  expect(mockPlanProps.seed.plan.pieces[0]).toMatchObject({
    kind: "bot",
    name: "Inbox Digest",
    source: "new",
    tools: [{ provider: "Work Gmail", tools: ["search"] }],
    showResults: false,
  });
});

test("Use a registry bot: read from its dashboard package", async () => {
  setup();
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await act(async () => {
    await mockScoutProps.onUse({
      kind: "bot",
      source: "Registry",
      name: "Inbox Triager",
      package: "@trops/inbox-triage",
    });
  });
  expect(window.mainApi.dashboardConfig.getPackageConfig).toHaveBeenCalledWith(
    "inbox-triage",
  );
  expect(mockPlanProps.seed.plan.pieces[0]).toMatchObject({
    name: "Inbox Triager",
    instructions: "Triage.",
    showResults: false,
  });
  expect(mockPlanProps.seed.plan.dashboard).toBeUndefined();
});

test("a found bot that can't be read: the Planner plans one like it", async () => {
  setup({ workspaceId: 7 });
  describeIt("sum up my mail");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await act(async () => {
    await mockScoutProps.onUse({
      kind: "bot",
      source: "Yours",
      name: "Gone",
      package: "bot_x",
    });
  });
  expect(mockPlanProps.seed).toBeFalsy();
  expect(mockPlanProps.prompt).toBe(
    "sum up my mail\n\nBase it on the Gone bot (bot_x).",
  );
});

test("a bot plan reopened from Recent keeps its steps and headers", () => {
  setup({ initialType: "auto", initialRecentId: "plan_7" });
  expect(mockPlanProps.recentId).toBe("plan_7");
  act(() =>
    mockPlanProps.onState({
      recentId: "plan_7",
      busy: false,
      botName: "Morning Email Summary",
      bot: { where: { id: "7", name: "Morning Brief" } },
    }),
  );
  expect(stepLabel()).toBe("Plan");
  expect(screen.getByText("Plan a bot for Morning Brief")).toBeInTheDocument();
});

test("a quick build that's done before Create listens still reads Done", async () => {
  setup({ workspaceId: 7 });
  window.mainApi.bots.onPlanBuild = jest.fn(() => 3);
  window.mainApi.bots.getPlanBuild = jest
    .fn()
    .mockResolvedValue({ state: { status: "done" } });
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  act(() => mockScoutProps.onBuildNew());
  await act(async () => {
    mockPlanProps.onState({
      recentId: "plan_1",
      busy: false,
      buildId: "build_1",
      botName: "Morning Email Summary",
      bot: { where: { id: "7", name: "Morning Brief" } },
    });
  });
  expect(window.mainApi.bots.getPlanBuild).toHaveBeenCalledWith("build_1");
  expect(stepLabel()).toBe("Done");
  expect(
    screen.getByText("Morning Email Summary is ready"),
  ).toBeInTheDocument();
});

test("Open its page closes Create and opens the bot", () => {
  setup({ workspaceId: 7 });
  describeIt();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  act(() => mockScoutProps.onBuildNew());
  const opened = jest.fn();
  window.addEventListener("dash:open-bot", opened);
  act(() => mockPlanProps.onOpenBot("bot_9"));
  window.removeEventListener("dash:open-bot", opened);
  expect(opened).toHaveBeenCalled();
  expect(opened.mock.calls[0][0].detail).toEqual({ botId: "bot_9" });
});
