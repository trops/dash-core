import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { WidgetIssueChip } from "./WidgetIssueChip";
import { WidgetProblems } from "./IssueParts";
import { __resetIssuesStore } from "../../hooks/useIssues";
import { mockIssuesApi } from "../../__mocks__/mockIssuesApi";

const at = (h, m) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const issue = {
  id: "i1",
  status: "open",
  severity: "problem",
  title: "Shopping List: Notes MCP › search_notes failed",
  message: "connect ECONNREFUSED 127.0.0.1:3845",
  hint: "Notes MCP's server isn't answering — it may not be running.",
  call: {
    provider: "Notes MCP",
    tool: "search_notes",
    args: '{"query":"shopping list"}',
    error: "connect ECONNREFUSED 127.0.0.1:3845",
  },
  firstAt: at(0, 30),
  lastAt: at(0, 45),
  count: 12,
  recent: [
    { at: at(0, 45), message: "connect ECONNREFUSED 127.0.0.1:3845" },
    { at: at(0, 31), message: "Worked — 14 notes" },
  ],
  asset: {
    kind: "widget",
    name: "Shopping List",
    component: "acme.notes.ShoppingList",
    itemId: "7-a-3",
    workspaceId: "7",
  },
};

afterEach(() => {
  __resetIssuesStore();
  delete window.mainApi;
});

describe("WidgetIssueChip (issues PRD)", () => {
  it("shows nothing when the copy has no open issues", async () => {
    const t = mockIssuesApi([issue]);
    render(
      <WidgetIssueChip
        component="acme.notes.ShoppingList"
        itemId="7-a-9"
        workspaceId="7"
      />,
    );
    await waitFor(() => expect(t.api.list).toHaveBeenCalled());
    expect(screen.queryByTestId("widget-issue-chip")).toBeNull();
  });

  it("a red chip with the count; hover shows the newest issue", async () => {
    mockIssuesApi([issue]);
    render(
      <WidgetIssueChip
        component="acme.notes.ShoppingList"
        itemId="7-a-3"
        workspaceId={7}
      />,
    );
    const chip = await screen.findByTestId("widget-issue-chip");
    expect(chip).toHaveTextContent("1 problem");
    fireEvent.mouseEnter(chip.parentElement);
    const card = screen.getByTestId("widget-issue-card");
    expect(
      within(card).getByText("Shopping List: Notes MCP › search_notes failed"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        /connect ECONNREFUSED 127\.0\.0\.1:3845\. 12 times since/,
      ),
    ).toBeInTheDocument();
  });

  it("See what went wrong opens the panel at Problems; Retry runs this copy again", async () => {
    mockIssuesApi([issue]);
    const onSee = jest.fn();
    // This copy's cell (GridCellFrame) takes the retry.
    const retried = jest.fn((e) => {
      e.detail.handled = true;
    });
    window.addEventListener("dash:retry-widget", retried);
    render(
      <WidgetIssueChip
        component="acme.notes.ShoppingList"
        itemId="7-a-3"
        workspaceId="7"
        onSee={onSee}
      />,
    );
    fireEvent.click(await screen.findByTestId("widget-issue-chip"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retried).toHaveBeenCalled();
    expect(retried.mock.calls[0][0].detail).toMatchObject({
      component: "acme.notes.ShoppingList",
      itemId: "7-a-3",
      workspaceId: "7",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Retrying…");
    fireEvent.click(
      screen.getByRole("button", { name: "See what went wrong" }),
    );
    expect(onSee).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
    window.removeEventListener("dash:retry-widget", retried);
  });

  it("without a panel, See what went wrong opens the Issues page on it", async () => {
    mockIssuesApi([issue]);
    const opened = jest.fn();
    window.addEventListener("dash:open-page", opened);
    render(
      <WidgetIssueChip
        component="acme.notes.ShoppingList"
        itemId="7-a-3"
        workspaceId="7"
      />,
    );
    fireEvent.click(await screen.findByTestId("widget-issue-chip"));
    fireEvent.click(
      screen.getByRole("button", { name: "See what went wrong" }),
    );
    expect(opened.mock.calls[0][0].detail).toEqual({
      page: "issues",
      issueId: "i1",
    });
    window.removeEventListener("dash:open-page", opened);
  });
});

describe("WidgetProblems — the panel's Problems section", () => {
  it("says what went wrong: call, asked with, error, last, likely cause, earlier", () => {
    render(<WidgetProblems issues={[issue]} />);
    const box = screen.getByTestId("widget-problems");
    expect(within(box).getByText("What went wrong")).toBeInTheDocument();
    expect(within(box).getByText(/^12 times since/)).toBeInTheDocument();
    expect(
      within(box).getByText("Notes MCP › search_notes"),
    ).toBeInTheDocument();
    expect(
      within(box).getByText('{ "query": "shopping list" }'),
    ).toBeInTheDocument();
    expect(
      within(box).getByText("connect ECONNREFUSED 127.0.0.1:3845"),
    ).toBeInTheDocument();
    expect(within(box).getByText(/^Today /)).toBeInTheDocument();
    expect(
      within(box).getByText(/^Likely cause: Notes MCP's server/),
    ).toBeInTheDocument();
    expect(within(box).getByText("Earlier")).toBeInTheDocument();
    expect(within(box).getByText("Worked — 14 notes")).toBeInTheDocument();
  });

  it("Open provider, Fix with AI and Show in Debug Console", () => {
    const open = jest.fn();
    window.mainApi = { debug: { open } };
    const events = [];
    const keep = (e) => events.push(e);
    window.addEventListener("dash:open-page", keep);
    window.addEventListener("dash:edit-widget-with-ai", keep);
    render(<WidgetProblems issues={[issue]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Notes MCP" }));
    fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Show in Debug Console" }),
    );
    window.removeEventListener("dash:open-page", keep);
    window.removeEventListener("dash:edit-widget-with-ai", keep);
    expect(events[0].detail).toEqual({
      page: "providers",
      providerName: "Notes MCP",
    });
    expect(events[1].detail.error).toMatch(/\(12 times\)/);
    expect(open).toHaveBeenCalled();
  });

  it("no Debug Console in this app: no button for it", () => {
    window.mainApi = {};
    render(<WidgetProblems issues={[issue]} />);
    expect(
      screen.queryByRole("button", { name: "Show in Debug Console" }),
    ).toBeNull();
  });
});
