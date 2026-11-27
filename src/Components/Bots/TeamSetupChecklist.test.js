/**
 * TeamSetupChecklist (DASH-120): "Set up this team" at the top of a team's
 * page: the bots' required settings (edited here, one Save), Check setup
 * with "Go to it", repo checks when the team has repos, and the self-test.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { TeamSetupChecklist } from "./TeamSetupChecklist";
import { _resetSetupStore, rememberSetupCheck } from "./teamSetupStore";

const folder = { name: "workFolder", label: "Work folder", required: true };
const wsBot = {
  id: "b-ws",
  name: "Workspace Bot",
  workspaceId: "7",
  settings: [folder],
  settingValues: {},
};
const coder = { id: "b-c", name: "Coder", workspaceId: "7" };

function withApi(over = {}) {
  const calls = [];
  window.mainApi = {
    bots: {
      getTeamSettings: jest.fn(async () => ({})),
      getTeamValues: jest.fn(async () => ({ declared: [], values: {} })),
      save: jest.fn(async (d) => {
        calls.push(["save", d]);
        return d;
      }),
      checkSetup: jest.fn(async () => ({
        ok: false,
        problems: [
          {
            kind: "provider",
            botId: "b-c",
            bot: "Coder",
            message: "Coder: GitHub doesn't start.",
          },
          { kind: "repo-read", message: "Can't read o/r." },
        ],
      })),
      reposWithoutChecks: jest.fn(async () => ({ repos: [], withChecks: [] })),
      teamChecks: jest.fn(async () => ({ checks: [] })),
      ...over,
    },
  };
  return calls;
}

afterEach(() => {
  delete window.mainApi;
  _resetSetupStore();
});

describe("TeamSetupChecklist", () => {
  it("numbers the steps in order, with each one's state", async () => {
    withApi();
    render(<TeamSetupChecklist workspaceId="7" bots={[wsBot, coder]} />);
    expect(screen.getByText("Set up this team")).toBeInTheDocument();
    expect(screen.getByTestId("setup-progress")).toHaveTextContent(
      "0 of 3 done · do them in order",
    );
    const steps = screen
      .getAllByTestId(/^(setup-step-\w+|team-setup-check|team-self-test)$/)
      .map((el) => el.getAttribute("data-testid"));
    expect(steps).toEqual([
      "setup-step-settings",
      "team-setup-check",
      "team-self-test",
    ]);
    expect(screen.getByLabelText("Step 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Step 3")).toBeInTheDocument();
    expect(screen.getByText("1 bot to fill in")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The other 1 bot has nothing required. Their settings are on their own pages.",
      ),
    ).toBeInTheDocument();
  });

  it("edits a bot's settings in its card, and saves them with one Save", async () => {
    const calls = withApi();
    const onBotsChanged = jest.fn();
    const onDirtyChange = jest.fn();
    render(
      <TeamSetupChecklist
        workspaceId="7"
        bots={[wsBot, coder]}
        onBotsChanged={onBotsChanged}
        onDirtyChange={onDirtyChange}
      />,
    );
    const card = screen.getByTestId("setup-bot-card-b-ws");
    expect(within(card).getByText("1 to fill in")).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText("Work folder"), {
      target: { value: "~/Work" },
    });
    expect(within(card).getByText("✓ Ready")).toBeInTheDocument();
    expect(screen.getByTestId("setup-unsaved-bar")).toHaveTextContent(
      "You have unsaved changes.",
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(calls).toEqual([
        ["save", { id: "b-ws", settingValues: { workFolder: "~/Work" } }],
      ]),
    );
    await waitFor(() => expect(onBotsChanged).toHaveBeenCalled());
    expect(screen.queryByTestId("setup-unsaved-bar")).toBeNull();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("Discard puts the saved values back", () => {
    withApi();
    render(<TeamSetupChecklist workspaceId="7" bots={[wsBot]} />);
    fireEvent.change(screen.getByLabelText("Work folder"), {
      target: { value: "~/Work" },
    });
    fireEvent.click(screen.getByText("Discard"));
    expect(screen.getByLabelText("Work folder")).toHaveValue("");
    expect(screen.queryByTestId("setup-unsaved-bar")).toBeNull();
  });

  it("opens a bot's Settings tab from its card", () => {
    withApi();
    const open = jest.fn();
    render(
      <TeamSetupChecklist
        workspaceId="7"
        bots={[wsBot]}
        onOpenBotSettings={open}
      />,
    );
    fireEvent.click(screen.getByText("Open Workspace Bot's settings ›"));
    expect(open).toHaveBeenCalledWith("b-ws");
  });

  it("Check setup lists its problems, each bot's with Go to it", async () => {
    withApi();
    const open = jest.fn();
    render(
      <TeamSetupChecklist
        workspaceId="7"
        bots={[wsBot, coder]}
        onOpenBotSettings={open}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Check setup" }));
    const result = await screen.findByTestId("setup-result");
    expect(result).toHaveTextContent("2 problems to fix:");
    expect(result).toHaveTextContent("Coder: GitHub doesn't start.");
    expect(result).toHaveTextContent("Can't read o/r.");
    // Only the bot's problem has somewhere to go: Coder has no card here.
    const go = within(result).getAllByText("Go to it");
    expect(go).toHaveLength(1);
    fireEvent.click(go[0]);
    expect(open).toHaveBeenCalledWith("b-c");
    expect(screen.getByText("2 problems to fix")).toBeInTheDocument();
  });

  it("shows repo checks only when the team has repos", async () => {
    withApi({
      reposWithoutChecks: jest.fn(async () => ({
        repos: [{ key: "web", slug: "o/web" }],
        withChecks: [
          { key: "api", slug: "o/api", checks: ["setup", "validate"] },
        ],
      })),
    });
    render(<TeamSetupChecklist workspaceId="7" bots={[wsBot]} />);
    const step = await screen.findByTestId("setup-step-repos");
    expect(step).toHaveTextContent("o/api · 2 checks (setup, validate)");
    expect(step).toHaveTextContent("o/web has no checks yet.");
    expect(within(step).getByText("Set up checks")).toBeInTheDocument();
    expect(screen.getByLabelText("Step 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Step 4")).toBeInTheDocument();
  });

  it("folds away once every step is done", async () => {
    withApi({
      getTeamSettings: jest.fn(async () => ({
        lastTest: { at: "2026-11-27T00:00:00Z" },
      })),
    });
    rememberSetupCheck("7", { ok: true, problems: [] });
    render(<TeamSetupChecklist workspaceId="7" bots={[coder]} />);
    expect(await screen.findByText("All 3 done")).toBeInTheDocument();
    expect(screen.queryByTestId("team-self-test")).toBeNull();
    fireEvent.click(screen.getByText("Show steps"));
    expect(screen.getByTestId("team-self-test")).toBeInTheDocument();
  });
});

describe("Run a self-test (DASH-121)", () => {
  const ticketBot = {
    id: "b-t",
    name: "Ticket Bot",
    workspaceId: "7",
    settings: [
      { name: "source", label: "Where tickets come from", type: "tracker" },
    ],
    settingValues: { source: { source: "none" } },
  };

  it("has a generic field, and waits for a passing Check setup", async () => {
    withApi({ getTeamSettings: jest.fn(async () => ({})) });
    render(<TeamSetupChecklist workspaceId="7" bots={[ticketBot, coder]} />);
    const field = screen.getByLabelText("Test ticket");
    expect(field).toHaveAttribute(
      "placeholder",
      "A ticket in your sandbox project",
    );
    expect(screen.queryByPlaceholderText("DASH-97")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Run self-test" }),
    ).toBeDisabled();
    expect(screen.getByTestId("self-test-blocked")).toHaveTextContent(
      "Run Check setup in step 2 first.",
    );
  });

  it("checks setup again and doesn't start on problems", async () => {
    rememberSetupCheck("7", { ok: true, problems: [] });
    withApi({ testTeam: jest.fn() });
    render(<TeamSetupChecklist workspaceId="7" bots={[coder]} />);
    fireEvent.change(screen.getByLabelText("Test item"), {
      target: { value: "T-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run self-test" }));
    expect(await screen.findByTestId("self-test-note")).toHaveTextContent(
      "Not started: fix the 2 problems in step 2 first.",
    );
    expect(window.mainApi.bots.testTeam).not.toHaveBeenCalled();
    expect(screen.getByTestId("setup-result")).toHaveTextContent(
      "Coder: GitHub doesn't start.",
    );
  });

  it("starts on a good setup and opens the job", async () => {
    rememberSetupCheck("7", { ok: true, problems: [] });
    withApi({
      checkSetup: jest.fn(async () => ({ ok: true, problems: [] })),
      setTestItem: jest.fn(async (_w, item) => ({ testItem: item })),
      testTeam: jest.fn(async () => ({
        jobId: "job-9",
        botId: "b-c",
        item: { id: "T-1" },
      })),
    });
    const opened = [];
    const onPage = (e) => opened.push(e.detail);
    window.addEventListener("dash:open-page", onPage);
    try {
      render(<TeamSetupChecklist workspaceId="7" bots={[coder]} />);
      fireEvent.change(screen.getByLabelText("Test item"), {
        target: { value: "T-1" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Run self-test" }));
      expect(await screen.findByTestId("self-test-note")).toHaveTextContent(
        "The self-test started on T-1.",
      );
      expect(window.mainApi.bots.setTestItem).toHaveBeenCalledWith("7", {
        id: "T-1",
      });
      expect(opened).toEqual([{ page: "jobs", jobId: "job-9" }]);
      fireEvent.click(screen.getByText("Open the job ›"));
      expect(opened).toHaveLength(2);
    } finally {
      window.removeEventListener("dash:open-page", onPage);
    }
  });
});
