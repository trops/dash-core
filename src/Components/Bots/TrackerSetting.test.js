import React, { useState } from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { TrackerSetting } from "./TrackerSetting";
import { TeamSettingsForm, emptySettings } from "./TeamSettingsForm";
import { settingFromDraft } from "./BotSettings";

// DASH-135: where a bot's tickets come from, with pickers (mockups 2 and 8).

const TICKETS = {
  name: "tickets",
  label: "Where tickets come from",
  type: "tracker",
  required: true,
};

const text = (j) => ({
  result: { content: [{ type: "text", text: JSON.stringify(j) }] },
});

function setApi({ sources = [], callTool = null } = {}) {
  window.mainApi = {
    bots: { listToolSources: jest.fn(() => Promise.resolve(sources)) },
    mcp: callTool ? { callTool: jest.fn(callTool) } : undefined,
  };
}

function Harness({ initial = null, onValue = () => {}, ...rest }) {
  const [value, setValue] = useState(initial);
  return (
    <TrackerSetting
      setting={TICKETS}
      value={value}
      botName="Ticket Bot"
      onChange={(v) => {
        setValue(v);
        onValue(v);
      }}
      {...rest}
    />
  );
}

afterEach(() => {
  delete window.mainApi;
  jest.useRealTimers();
});

describe("TrackerSetting", () => {
  it("starts with nothing chosen, saying so", async () => {
    setApi();
    render(<Harness />);
    expect(
      screen.getByRole("radiogroup", { name: "Where tickets come from" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No ticket source chosen yet: Ticket Bot can't/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(window.mainApi.bots.listToolSources).toHaveBeenCalled(),
    );
  });

  it("None: no pickers, filled in", async () => {
    setApi();
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.click(
      screen.getByRole("radio", { name: "None: I'll hand it tickets myself" }),
    );
    expect(onValue).toHaveBeenLastCalledWith({ source: "none" });
    expect(screen.getByText(/jobs start only from a task/)).toBeInTheDocument();
    expect(screen.queryByText(/yet: Ticket Bot can't/)).toBeNull();
    expect(screen.queryByLabelText("Status")).toBeNull();
  });

  it("GitHub with no provider: Connect, and a plain repo field", async () => {
    setApi();
    const onValue = jest.fn();
    const asked = jest.fn();
    window.addEventListener("dash:open-settings-create-provider", asked);
    render(<Harness onValue={onValue} />);
    fireEvent.click(screen.getByRole("radio", { name: "GitHub Issues" }));
    expect(onValue).toHaveBeenLastCalledWith({
      source: "github",
      status: "open",
      assignee: "anyone",
    });
    await screen.findByText(
      "GitHub Issues isn't connected on this computer yet.",
    );
    fireEvent.click(screen.getByText("Connect GitHub Issues"));
    expect(asked).toHaveBeenCalled();
    expect(asked.mock.calls[0][0].detail).toEqual({
      type: "github",
      providerClass: "mcp",
    });
    window.removeEventListener("dash:open-settings-create-provider", asked);
    expect(screen.getByText(/No repo chosen yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Repo"), {
      target: { value: "you/app" },
    });
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ project: "you/app" }),
    );
    expect(screen.queryByText(/No repo chosen yet/)).toBeNull();
  });

  it("Jira connected and running: projects listed, and a preview", async () => {
    const callTool = (server, tool) =>
      Promise.resolve(
        tool === "jira_get_all_projects"
          ? text([{ key: "SANDBOX", name: "Code Factory Sandbox" }])
          : text({
              total: 2,
              issues: [{ key: "SANDBOX-4", summary: "Fix the login" }],
            }),
      );
    setApi({
      sources: [
        { name: "Jira", type: "atlassian", running: true, tools: null },
      ],
      callTool,
    });
    const onValue = jest.fn();
    render(<Harness onValue={onValue} />);
    // The providers are read first.
    await act(async () => {});
    fireEvent.click(screen.getByRole("radio", { name: "Jira" }));
    await screen.findByText("✓ Jira connected");
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ source: "jira", provider: "Jira" }),
    );
    await screen.findByText("SANDBOX · Code Factory Sandbox");
    const project = screen.getByLabelText("Project");
    fireEvent.change(project, { target: { value: "SANDBOX" } });
    expect(
      await screen.findByText(
        "Right now this matches 2 tickets. Next up: SANDBOX-4 Fix the login",
        {},
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
    const search = window.mainApi.mcp.callTool.mock.calls.find(
      (c) => c[1] === "jira_search",
    );
    expect(search[2].jql).toBe(
      'project = "SANDBOX" AND status = "To Do" ORDER BY created ASC',
    );
  });

  it("Jira's Advanced search replaces the choices, and can be undone", async () => {
    setApi();
    const onValue = jest.fn();
    render(
      <Harness
        initial={{ source: "jira", project: "SB", assignee: "me" }}
        onValue={onValue}
      />,
    );
    fireEvent.click(screen.getByText("Advanced: edit as a Jira search (JQL)"));
    const jql = screen.getByLabelText("Jira search (JQL)");
    expect(jql).toHaveValue(
      'project = "SB" AND assignee = currentUser() ORDER BY created ASC',
    );
    fireEvent.change(jql, { target: { value: "filter = 10" } });
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "filter = 10" }),
    );
    expect(
      screen.getByText("This search replaces the choices above."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Use the choices instead"));
    expect(onValue.mock.calls.at(-1)[0].query).toBeUndefined();
  });

  it("a Claude connector counts as connected, with plain fields", async () => {
    setApi({
      sources: [
        {
          name: "claude.ai Linear",
          type: "claude-connector",
          connector: true,
          server: "claude.ai Linear",
          running: true,
        },
      ],
    });
    render(<Harness initial={{ source: "linear", assignee: "anyone" }} />);
    await screen.findByText("✓ Linear connected");
    expect(screen.getByLabelText("Team")).toBeInTheDocument();
  });
});

describe("a tracker in the settings form", () => {
  it("is drawn by TeamSettingsForm and counts as empty until filled", async () => {
    setApi();
    expect(emptySettings([TICKETS], {}).length).toBe(1);
    expect(emptySettings([TICKETS], { tickets: { source: "none" } })).toEqual(
      [],
    );
    await act(async () => {
      render(
        <TeamSettingsForm
          settings={[TICKETS]}
          values={{ tickets: { source: "none" } }}
          botName="Ticket Bot"
          onChange={() => {}}
        />,
      );
    });
    expect(screen.getByTestId("team-setting-tickets")).toBeInTheDocument();
    expect(
      screen.getByTestId("team-setting-tickets-required"),
    ).toBeInTheDocument();
  });

  it("can be added on a bot's Settings tab", () => {
    expect(
      settingFromDraft({ name: "tickets", type: "tracker", default: "x" })
        .setting,
    ).toEqual({ name: "tickets", label: "tickets", type: "tracker" });
  });
});
