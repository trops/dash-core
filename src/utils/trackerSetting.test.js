import {
  cleanTracker,
  trackerProblem,
  trackerProblemText,
  trackerJql,
  trackerGithubQuery,
  trackerText,
  trackerFieldTexts,
  trackerProviders,
  trackerTool,
  parseTrackerProjects,
  parseTrackerPreview,
} from "./trackerSetting";
import {
  settingEmpty,
  botMissingSettings,
  botSetupLines,
  botSetupStatus,
} from "./botSettings";

// DASH-135: where a bot's tickets come from, picked rather than typed.

const TICKETS = {
  name: "tickets",
  label: "Where tickets come from",
  type: "tracker",
  required: true,
};

describe("cleanTracker", () => {
  it("keeps the known fields and drops the rest", () => {
    const r = cleanTracker({
      source: "jira",
      project: " SANDBOX ",
      status: "To Do",
      assignee: "me",
      label: "",
      extra: "x",
      query: "",
    });
    expect(r.value).toEqual({
      source: "jira",
      project: "SANDBOX",
      status: "To Do",
      assignee: "me",
    });
  });
  it("reads a JSON string or a bare source", () => {
    expect(cleanTracker('{"source":"none"}').value).toEqual({ source: "none" });
    expect(cleanTracker("linear").value).toEqual({
      source: "linear",
      assignee: "anyone",
    });
  });
  it("turns a GitHub address into owner/repo, and refuses anything else", () => {
    expect(
      cleanTracker({
        source: "github",
        project: "https://github.com/you/app.git",
      }).value.project,
    ).toBe("you/app");
    expect(cleanTracker({ source: "github", project: "app" }).error).toMatch(
      /owner\/repo/,
    );
  });
  it("keeps a query for Jira only", () => {
    expect(
      cleanTracker({ source: "github", project: "a/b", query: "x" }).value
        .query,
    ).toBeUndefined();
    expect(
      cleanTracker({ source: "jira", query: "project = X" }).value.query,
    ).toBe("project = X");
  });
  it("says what's wrong", () => {
    expect(cleanTracker({ source: "trello" }).error).toMatch(/jira, github/);
    expect(cleanTracker({ source: "jira", assignee: "bob" }).error).toMatch(
      /assigned to/,
    );
    expect(cleanTracker(42).error).toMatch(/ticket source/);
  });
});

describe("what a tracker still needs", () => {
  it("None is filled in on purpose", () => {
    expect(trackerProblem({ source: "none" })).toBeNull();
    expect(settingEmpty(TICKETS, { tickets: { source: "none" } })).toBe(false);
  });
  it("a tracker needs its project (or, for Jira, a JQL search)", () => {
    expect(trackerProblem(null)).toBe("no-source");
    expect(trackerProblem({ source: "jira" })).toBe("no-project");
    expect(trackerProblem({ source: "jira", query: "a = b" })).toBeNull();
    expect(trackerProblemText({ source: "github" })).toBe("no repo chosen");
    expect(settingEmpty(TICKETS, {})).toBe(true);
    expect(settingEmpty(TICKETS, { tickets: { source: "jira" } })).toBe(true);
  });
  it("setup says which: no source, or no project", () => {
    const bot = (v) => ({
      id: "t",
      name: "Ticket Bot",
      instructions: "Take the next ticket from {tickets}.",
      settings: [TICKETS],
      settingValues: v === undefined ? {} : { tickets: v },
    });
    expect(botMissingSettings(bot())[0]).toMatchObject({
      name: "tickets",
      type: "tracker",
      reason: "no-source",
    });
    expect(botSetupLines(botSetupStatus([bot({ source: "jira" })]))).toEqual([
      "Ticket Bot: Where tickets come from is Jira, but no project is chosen.",
    ]);
    expect(botSetupLines(botSetupStatus([bot()]))).toEqual([
      "Ticket Bot: Where tickets come from has no ticket source chosen.",
    ]);
    expect(botSetupStatus([bot({ source: "none" })])).toEqual([]);
  });
});

describe("the search and the words", () => {
  const jira = {
    source: "jira",
    project: "SANDBOX",
    status: "To Do",
    assignee: "unassigned",
    label: "bot",
    provider: "Jira",
  };
  it("builds JQL from the pickers, quoting values", () => {
    expect(trackerJql(jira)).toBe(
      'project = "SANDBOX" AND status = "To Do" AND assignee is EMPTY AND labels = "bot" ORDER BY created ASC',
    );
    expect(trackerJql({ ...jira, project: 'A"B' })).toMatch(/"A\\"B"/);
    expect(trackerJql({ ...jira, query: "filter = 1" })).toBe("filter = 1");
  });
  it("builds a GitHub issue search", () => {
    expect(
      trackerGithubQuery({
        source: "github",
        project: "you/app",
        status: "open",
        assignee: "me",
        label: "good first issue",
      }),
    ).toBe(
      'repo:you/app is:issue is:open assignee:@me label:"good first issue"',
    );
  });
  it("reads as words for {tickets}, with its parts for {tickets.project}", () => {
    expect(trackerText(jira)).toBe(
      'Jira: project SANDBOX, status "To Do", assigned to nobody, label "bot". Search (JQL): project = "SANDBOX" AND status = "To Do" AND assignee is EMPTY AND labels = "bot" ORDER BY created ASC. Use the Jira tools (provider "Jira").',
    );
    expect(trackerText({ source: "none" })).toMatch(/work only on the task/);
    expect(trackerText({ source: "linear" })).toBe("");
    expect(trackerFieldTexts(jira)).toMatchObject({
      source: "jira",
      project: "SANDBOX",
      assignee: "unassigned",
      provider: "Jira",
    });
    expect(trackerFieldTexts({ source: "none" }).project).toBe("");
  });
});

describe("providers and the pickers", () => {
  const sources = [
    { name: "GitHub", type: "github", running: false, tools: null },
    {
      name: "claude.ai Atlassian",
      type: "claude-connector",
      connector: true,
      server: "claude.ai Atlassian",
      running: true,
    },
    { name: "Jira", type: "atlassian", running: true, tools: null },
  ];
  it("finds a tracker's providers, running first", () => {
    expect(trackerProviders("jira", sources).map((s) => s.name)).toEqual([
      "claude.ai Atlassian",
      "Jira",
    ]);
    expect(trackerProviders("linear", sources)).toEqual([]);
  });
  it("only calls a running Dash provider that has the tool", () => {
    expect(trackerTool("jira", "projects", sources[2]).tool).toBe(
      "jira_get_all_projects",
    );
    expect(trackerTool("jira", "projects", sources[1])).toBeNull();
    expect(trackerTool("github", "search", sources[0])).toBeNull();
    expect(
      trackerTool("jira", "search", { ...sources[2], tools: ["other"] }),
    ).toBeNull();
    expect(trackerTool("linear", "search", { running: true })).toBeNull();
  });
  it("reads projects and the preview from a tool's answer", () => {
    const text = (j) => ({
      result: { content: [{ type: "text", text: JSON.stringify(j) }] },
    });
    expect(
      parseTrackerProjects(
        text([
          { key: "SANDBOX", name: "Code Factory Sandbox" },
          { key: "DASH", name: "DASH" },
          { name: "no key" },
        ]),
      ),
    ).toEqual([
      { value: "SANDBOX", label: "SANDBOX · Code Factory Sandbox" },
      { value: "DASH", label: "DASH" },
    ]);
    expect(
      parseTrackerPreview(
        text({ total: 3, issues: [{ key: "SB-1", summary: "Fix login" }] }),
      ),
    ).toEqual({ count: 3, next: "SB-1 Fix login" });
    expect(
      parseTrackerPreview(
        text({ total_count: 1, items: [{ number: 7, title: "Crash" }] }),
      ),
    ).toEqual({ count: 1, next: "#7 Crash" });
    expect(parseTrackerPreview(text({ issues: [] }))).toEqual({
      count: 0,
      next: null,
    });
    expect(parseTrackerPreview({ result: { content: [] } })).toBeNull();
  });
});
