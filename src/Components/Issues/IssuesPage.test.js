import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { IssuesPage } from "./IssuesPage";
import { __resetIssuesStore } from "../../hooks/useIssues";
import { mockIssuesApi } from "../../__mocks__/mockIssuesApi";
import { AppContext } from "../../Context/App/AppContext";

const today = (h, m) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const widgetIssue = {
  id: "i1",
  status: "open",
  severity: "problem",
  // Its provider is down (said by the main process), so Reconnect may fix it.
  cause: "provider",
  title: "Shopping List: Notes MCP › search_notes failed",
  message: "connect ECONNREFUSED 127.0.0.1:3845",
  hint: "Notes MCP's server isn't answering — it may not be running. Reconnect starts it again.",
  shown: "Notes aren't available right now.",
  call: {
    provider: "Notes MCP",
    tool: "search_notes",
    args: '{"query":"shopping list","limit":20}',
    error: "connect ECONNREFUSED 127.0.0.1:3845",
  },
  firstAt: today(0, 30),
  lastAt: today(0, 45),
  count: 12,
  recent: [
    { at: today(0, 45), message: "connect ECONNREFUSED 127.0.0.1:3845" },
    { at: today(0, 40), message: "connect ECONNREFUSED 127.0.0.1:3845" },
  ],
  asset: {
    kind: "widget",
    name: "Shopping List",
    component: "acme.notes.ShoppingList",
    itemId: "7-a-3",
    workspaceId: "7",
    dashboardName: "Life HQ",
    // Its place (issues PRD): Fix with AI reaches this very copy.
    id: "a-3",
    gridItemId: "g-1",
    scope: "main",
    packageId: "@acme/notes",
  },
};
const botIssue = {
  id: "i2",
  status: "open",
  severity: "warning",
  cause: "warning",
  title: "Morning Summary: Gmail wasn't connected when the run started",
  message:
    "Gmail wasn't connected when the run started, so it answered without it.",
  call: null,
  firstAt: today(0, 20),
  lastAt: today(0, 20),
  count: 1,
  recent: [{ at: today(0, 20), message: "Gmail wasn't connected" }],
  asset: {
    kind: "bot",
    name: "Morning Summary",
    botId: "b1",
    workspaceId: "7",
  },
};
const providerIssue = {
  id: "i3",
  status: "open",
  severity: "problem",
  cause: "sign-in",
  title: "Home Assistant MCP: sign-in expired",
  message: "401 Unauthorized",
  hint: "Sign in to Home Assistant MCP again.",
  call: null,
  firstAt: today(0, 10),
  lastAt: today(0, 10),
  count: 1,
  recent: [],
  asset: {
    kind: "provider",
    name: "Home Assistant MCP",
    provider: "Home Assistant MCP",
  },
};
const oldIssue = {
  ...widgetIssue,
  id: "i4",
  status: "resolved",
  resolvedAt: today(0, 5),
  title: "Weather couldn't show",
  asset: {
    ...widgetIssue.asset,
    name: "Weather",
    itemId: "8-b-1",
    workspaceId: "8",
  },
};

const workspaces = [
  { id: 7, name: "Life HQ" },
  { id: 8, name: "Smart Home" },
];

function renderPage(props = {}, providers = {}) {
  return render(
    <AppContext.Provider value={{ providers }}>
      <IssuesPage workspaces={workspaces} {...props} />
    </AppContext.Provider>,
  );
}

let t;
beforeEach(() => {
  t = mockIssuesApi([widgetIssue, botIssue, providerIssue, oldIssue]);
});
afterEach(() => {
  __resetIssuesStore();
  delete window.mainApi;
});

const rows = () => screen.getAllByTestId("issue-row");

test("lists open issues, newest first, with name, kind, what, where and count", async () => {
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(3));
  const first = rows()[0];
  expect(within(first).getByText("Shopping List")).toBeInTheDocument();
  expect(within(first).getByText("Widget")).toBeInTheDocument();
  expect(
    within(first).getByText(
      "Notes MCP › search_notes: connect ECONNREFUSED 127.0.0.1:3845",
    ),
  ).toBeInTheDocument();
  expect(within(first).getByText("Life HQ")).toBeInTheDocument();
  expect(within(first).getByText("×12")).toBeInTheDocument();
  expect(within(rows()[1]).getByText("Bot")).toBeInTheDocument();
  expect(within(rows()[2]).getByText("Provider")).toBeInTheDocument();
});

test("filters by kind, dashboard and Open / Resolved", async () => {
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(screen.getByRole("radio", { name: /^Bots/ }));
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(within(rows()[0]).getByText("Morning Summary")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("radio", { name: /^All/ }));
  // The app's filter menu (FilterMenu), not a select.
  fireEvent.click(
    within(
      screen.getByRole("group", { name: "Dashboard filter" }),
    ).getByLabelText("Smart Home"),
  );
  await waitFor(() =>
    expect(
      screen.getByText("No open issues match these filters."),
    ).toBeInTheDocument(),
  );

  fireEvent.click(screen.getByRole("radio", { name: "Resolved" }));
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(within(rows()[0]).getByText("Weather")).toBeInTheDocument();
});

test("the detail shows the call, what it was asked with, the error, the cause and the timeline", async () => {
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(3));
  const detail = screen.getByTestId("issue-detail");
  expect(
    within(detail).getByText("Shopping List: Notes MCP › search_notes failed"),
  ).toBeInTheDocument();
  expect(within(detail).getByText("Notes MCP")).toBeInTheDocument();
  expect(within(detail).getByText("search_notes")).toBeInTheDocument();
  expect(
    within(detail).getByText('{ "query": "shopping list", "limit": 20 }'),
  ).toBeInTheDocument();
  expect(
    within(detail).getByText("connect ECONNREFUSED 127.0.0.1:3845"),
  ).toBeInTheDocument();
  expect(
    within(detail).getByText(`"Notes aren't available right now."`),
  ).toBeInTheDocument();
  expect(within(detail).getByRole("note")).toHaveTextContent(
    /Likely cause: Notes MCP's server isn't answering/,
  );
  expect(
    within(detail).getByText(/Widget on Life HQ · 12 times since/),
  ).toBeInTheDocument();
  const timeline = within(detail).getByTestId("issue-timeline");
  expect(
    within(timeline).getByText("search_notes failed for the first time"),
  ).toBeInTheDocument();
});

test("a row opens its detail", async () => {
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(rows()[2]);
  const detail = screen.getByTestId("issue-detail");
  expect(
    within(detail).getByText("Home Assistant MCP: sign-in expired"),
  ).toBeInTheDocument();
  expect(rows()[2]).toHaveAttribute("aria-current", "true");
});

test("Mark resolved resolves it and it leaves the open list", async () => {
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(3));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
  });
  expect(t.api.resolve).toHaveBeenCalledWith("i1");
  await waitFor(() => expect(rows()).toHaveLength(2));
});

test("Clear resolved shows when viewing resolved ones", async () => {
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(3));
  expect(screen.queryByRole("button", { name: "Clear resolved" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Resolved" }));
  await waitFor(() => expect(rows()).toHaveLength(1));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Clear resolved" }));
  });
  expect(t.api.clearResolved).toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByText("No resolved issues.")).toBeInTheDocument(),
  );
});

test("widget actions: Retry runs this copy, Fix with AI sends its place and the error, Open the widget opens its dashboard", async () => {
  const onOpenWorkspace = jest.fn();
  const events = [];
  const keep = (e) => events.push(e);
  // Its cell on the open dashboard takes the retry.
  const cell = (e) => {
    e.detail.handled = true;
  };
  window.addEventListener("dash:retry-widget", cell);
  window.addEventListener("dash:retry-widget", keep);
  window.addEventListener("dash:widget-installed", keep);
  window.addEventListener("dash:edit-widget-with-ai", keep);
  renderPage({ onOpenWorkspace });
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(screen.getByRole("button", { name: "Retry the call" }));
  expect(screen.getByRole("status")).toHaveTextContent("Retrying…");
  fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
  fireEvent.click(screen.getByRole("button", { name: "Open the widget" }));
  window.removeEventListener("dash:retry-widget", cell);
  window.removeEventListener("dash:retry-widget", keep);
  window.removeEventListener("dash:widget-installed", keep);
  window.removeEventListener("dash:edit-widget-with-ai", keep);

  // Only this copy — never every copy of the widget everywhere.
  expect(events.map((e) => e.type)).not.toContain("dash:widget-installed");
  expect(events[0].type).toBe("dash:retry-widget");
  expect(events[0].detail).toMatchObject({
    component: "acme.notes.ShoppingList",
    itemId: "7-a-3",
    workspaceId: "7",
  });
  expect(events[1].type).toBe("dash:edit-widget-with-ai");
  expect(events[1].detail).toMatchObject({
    widgetComponentName: "acme.notes.ShoppingList",
    widgetId: "a-3",
    gridItemId: "g-1",
    workspaceId: "7",
    scope: "main",
    sourcePackage: "@acme/notes",
  });
  expect(events[1].detail.error).toMatch(
    /^Notes MCP › search_notes failed: connect ECONNREFUSED 127\.0\.0\.1:3845 \(12 times\)/,
  );
  expect(onOpenWorkspace).toHaveBeenCalledWith(workspaces[0]);
});

test("Retry when its dashboard isn't open: opens it, and says so", async () => {
  const onOpenWorkspace = jest.fn();
  renderPage({ onOpenWorkspace });
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(screen.getByRole("button", { name: "Retry the call" }));
  expect(onOpenWorkspace).toHaveBeenCalledWith(workspaces[0]);
  expect(screen.getByRole("status")).toHaveTextContent("Opening its dashboard");
});

test("Fix with AI on an older issue without its place sends the widget and error only", async () => {
  t.set([
    {
      ...widgetIssue,
      asset: {
        kind: "widget",
        name: "Shopping List",
        component: "acme.notes.ShoppingList",
        itemId: "7-a-3",
        workspaceId: "7",
      },
    },
  ]);
  const events = [];
  const keep = (e) => events.push(e);
  window.addEventListener("dash:edit-widget-with-ai", keep);
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
  window.removeEventListener("dash:edit-widget-with-ai", keep);
  expect(events[0].detail.widgetComponentName).toBe("acme.notes.ShoppingList");
  expect(events[0].detail.workspaceId).toBe("7");
  expect(events[0].detail).not.toHaveProperty("widgetId");
  expect(events[0].detail).not.toHaveProperty("gridItemId");
});

test("Reconnect stops and starts an MCP provider's server", async () => {
  const dashApi = {
    mcpStopServer: jest.fn((name, ok) => ok()),
    mcpStartServer: jest.fn((name, cfg, creds, ok) => ok({}, { tools: [] })),
  };
  renderPage(
    { dashApi },
    {
      "Notes MCP": {
        providerClass: "mcp",
        mcpConfig: { command: "notes" },
        credentials: {},
      },
    },
  );
  await waitFor(() => expect(rows()).toHaveLength(3));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect Notes MCP" }),
    );
  });
  expect(dashApi.mcpStopServer).toHaveBeenCalledWith(
    "Notes MCP",
    expect.any(Function),
    expect.any(Function),
  );
  expect(dashApi.mcpStartServer.mock.calls[0][0]).toBe("Notes MCP");
  expect(t.api.resolveAsset).toHaveBeenCalledWith({
    kind: "provider",
    provider: "Notes MCP",
  });
  expect(
    await screen.findByText("Notes MCP started again."),
  ).toBeInTheDocument();
});

test("a bot's Fix with AI opens Ask AI with a draft", async () => {
  const events = [];
  const keep = (e) => events.push(e);
  window.addEventListener("dash:open-workspace", keep);
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(rows()[1]);
  fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
  window.removeEventListener("dash:open-workspace", keep);
  expect(events[0].detail.key).toBe("role:dashlead");
  // The error is quoted, as data.
  expect(events[0].detail.draft).toBe(
    "Morning Summary had a problem: Gmail wasn't connected when the run started. The error said: \"Gmail wasn't connected when the run started, so it answered without it\". Help me fix it.",
  );
});

test("a bot warning says its message once; the timeline stays short", async () => {
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(rows()[1]);
  const detail = screen.getByTestId("issue-detail");
  expect(within(detail).getAllByText(/so it answered without it/)).toHaveLength(
    1,
  );
  const timeline = within(detail).getByTestId("issue-timeline");
  expect(timeline).not.toHaveTextContent("Gmail");
  expect(
    within(timeline).getByText("It happened for the first time"),
  ).toBeInTheDocument();
});

test("a bot warning about a provider offers Reconnect for it", async () => {
  t.set([
    {
      ...botIssue,
      title: "Morning Summary: Notes MCP wasn't available",
      message: "Notes MCP didn't start.",
      related: { provider: "Notes MCP" },
    },
  ]);
  renderPage(
    {},
    {
      "Notes MCP": {
        providerClass: "mcp",
        mcpConfig: { command: "notes" },
        credentials: {},
      },
    },
  );
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(
    screen.getByRole("button", { name: "Reconnect Notes MCP" }),
  ).toBeInTheDocument();
});

test("an expired sign-in without its own sign-in command offers Reconnect", async () => {
  renderPage(
    {},
    {
      "Home Assistant MCP": {
        providerClass: "mcp",
        mcpConfig: { url: "https://ha.example/mcp" },
        credentials: {},
      },
    },
  );
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(rows()[2]);
  expect(
    screen.getByRole("button", { name: "Reconnect Home Assistant MCP" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Sign in to Home Assistant MCP" }),
  ).toBeNull();
});

test("nothing wrong: an empty state", async () => {
  t.set([]);
  renderPage();
  expect(await screen.findByText("No problems")).toBeInTheDocument();
});

test("a link to one issue opens on it", async () => {
  renderPage({ issueLink: { issueId: "i2", nonce: 1 } });
  await waitFor(() => expect(rows()).toHaveLength(3));
  expect(
    within(screen.getByTestId("issue-detail")).getByText(
      "Morning Summary: Gmail wasn't connected when the run started",
    ),
  ).toBeInTheDocument();
});

test("a call that failed on what it was given offers no Reconnect", async () => {
  t = mockIssuesApi([
    {
      ...widgetIssue,
      cause: "call",
      message: "getaddrinfo ENOTFOUND bad.example",
      call: { ...widgetIssue.call, error: "getaddrinfo ENOTFOUND bad.example" },
    },
  ]);
  renderPage(
    {},
    { "Notes MCP": { providerClass: "mcp", mcpConfig: {}, credentials: {} } },
  );
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(screen.getByRole("button", { name: "Retry the call" })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Reconnect Notes MCP" }),
  ).toBeNull();
});

test("a provider's JSON error reads plainly; Show raw shows all of it", async () => {
  const json = JSON.stringify({
    success: false,
    error: {
      code: "VALIDATION_FAILED",
      message: "API error: 400 - 400: Bad Request",
    },
  });
  t = mockIssuesApi([
    {
      ...widgetIssue,
      cause: "call",
      message: "API error: 400 - 400: Bad Request",
      call: { ...widgetIssue.call, error: json },
    },
  ]);
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(1));
  const detail = screen.getByTestId("issue-detail");
  expect(detail.textContent).toContain("API error: 400 - 400: Bad Request");
  expect(screen.queryByTestId("issue-raw-error")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show raw" }));
  expect(screen.getByTestId("issue-raw-error").textContent).toContain(
    '"code": "VALIDATION_FAILED"',
  );
  fireEvent.click(screen.getByRole("button", { name: "Hide raw" }));
  expect(screen.queryByTestId("issue-raw-error")).toBeNull();
});

test("Mute errors like this: says exactly what it mutes, then it moves to Muted", async () => {
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(
    within(screen.getByTestId("issue-detail")).getByRole("button", {
      name: "Mute errors like this",
    }),
  );
  const confirm = await screen.findByTestId("mute-confirm");
  expect(confirm.textContent).toContain(
    "Mutes only this widget, this call, and this error",
  );
  expect(confirm.textContent).toContain("Shopping List (Life HQ)");
  expect(confirm.textContent).toContain("Notes MCP › search_notes");
  expect(confirm.textContent).toContain("connect ECONNREFUSED 127.0.0.1:3845");
  fireEvent.click(screen.getByRole("button", { name: "Mute" }));
  await waitFor(() => expect(t.api.mute).toHaveBeenCalledWith("i1"));
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(screen.getByText("1 muted error is hidden.")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Muted · 1" })).toBeInTheDocument();
});

test("Muted: the muted issue, how often since, and Unmute", async () => {
  t = mockIssuesApi([
    {
      ...widgetIssue,
      status: "muted",
      mutedAt: today(0, 40),
      mutedCount: 214,
    },
    botIssue,
  ]);
  renderPage();
  await waitFor(() => expect(rows()).toHaveLength(1));
  fireEvent.click(screen.getByRole("radio", { name: "Muted · 1" }));
  await waitFor(() =>
    expect(within(rows()[0]).getByText("Shopping List")).toBeInTheDocument(),
  );
  const detail = screen.getByTestId("issue-detail");
  expect(within(detail).getByText("Muted")).toBeInTheDocument();
  expect(screen.getByTestId("issue-muted").textContent).toContain(
    "214 times since you muted it",
  );
  // Newest first: it happened at 0:45, after it was muted at 0:40.
  const said = within(screen.getByTestId("issue-timeline"))
    .getAllByText(/./)
    .map((n) => n.textContent);
  expect(said.indexOf("You muted it")).toBeGreaterThan(
    said.indexOf("search_notes failed"),
  );
  expect(
    within(detail).queryByRole("button", { name: "Mark resolved" }),
  ).toBeNull();
  fireEvent.click(within(detail).getByRole("button", { name: "Unmute" }));
  await waitFor(() => expect(t.api.unmute).toHaveBeenCalledWith("i1"));
  // It happened since it was muted: shown back in Open.
  await waitFor(() =>
    expect(screen.getByRole("radio", { name: /^Open/ })).toHaveAttribute(
      "aria-checked",
      "true",
    ),
  );
  await waitFor(() =>
    expect(within(rows()[0]).getByText("Shopping List")).toBeInTheDocument(),
  );
});
