/**
 * The connector's "why" (approved mockup "A connector Dash can't find says
 * why"): the cause's fix runs, Reconnect asks for a fresh link, Copy
 * details copies, every fix tried → Dash stops trying, once.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ConnectorWhy } from "./ClaudeConnectorDetail";

const conn = (name, status = "connected") => ({
  server: `claude.ai ${name}`,
  name,
  status,
  tools: [{ name: "search", readOnly: true }],
  error: null,
});
const result = (connectors, more = {}) => ({
  state: "ready",
  checkedAt: new Date().toISOString(),
  connectors,
  details: {
    cli: { path: "/Users/me/.local/bin/claude", version: "2.1.305" },
    account: {
      loggedIn: true,
      method: "claude.ai",
      email: "me@example.com",
      plan: "max",
    },
    others: [],
    waitedMs: 3000,
    stillConnecting: [],
  },
  givenUp: [],
  ...more,
});
const claudeOf = (r) => ({
  result: r,
  loading: false,
  reconnect: jest.fn(),
  useCli: jest.fn(),
  giveUp: jest.fn(),
});

beforeEach(() => {
  window.mainApi = { shell: { openExternal: jest.fn() } };
});
afterEach(() => {
  delete window.mainApi;
});

describe("ConnectorWhy", () => {
  test("another name in the account: its fix, the facts and every connector", () => {
    const onRebind = jest.fn();
    const claude = claudeOf(result([conn("Gmail New"), conn("Slack")]));
    render(
      <ConnectorWhy
        providerName="Gmail"
        server="claude.ai Gmail"
        claude={claude}
        onRebind={onRebind}
      />,
    );
    expect(screen.getByTestId("connector-cause")).toHaveTextContent(
      "Your account has a connector called “Gmail New” — not “Gmail”",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use Gmail New for this provider" }),
    );
    expect(onRebind).toHaveBeenCalledWith("claude.ai Gmail New");
    expect(screen.getAllByTestId("connector-fact")).toHaveLength(4);
    expect(screen.getAllByTestId("connector-seen")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(claude.reconnect).toHaveBeenCalledWith("claude.ai Gmail");
  });

  test("a sign-in turned down: claude.ai, then — failing after both — Dash stops trying, once", () => {
    // Calendar is its own here, so earlier tests' tries don't carry over.
    const server = "claude.ai Google Calendar";
    const issue = {
      lastAt: new Date(Date.now() + 60000).toISOString(),
      call: { tool: "list_events", error: "401 invalid_grant" },
    };
    const claude = claudeOf(result([conn("Google Calendar")]));
    const { rerender } = render(
      <ConnectorWhy
        providerName="Google Calendar"
        server={server}
        claude={claude}
        signInIssue={null}
      />,
    );
    // Tried: Reconnect …
    rerender(
      <ConnectorWhy
        providerName="Google Calendar"
        server={server}
        claude={claude}
        signInIssue={{
          ...issue,
          lastAt: new Date(Date.now() - 600000).toISOString(),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    // … and claude.ai.
    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect on claude.ai" }),
    );
    expect(window.mainApi.shell.openExternal).toHaveBeenCalledWith(
      "https://claude.ai/settings/connectors",
    );
    expect(claude.giveUp).not.toHaveBeenCalled();
    // It fails again, after both.
    rerender(
      <ConnectorWhy
        providerName="Google Calendar"
        server={server}
        claude={claude}
        signInIssue={issue}
      />,
    );
    expect(claude.giveUp).toHaveBeenCalledTimes(1);
    expect(claude.giveUp).toHaveBeenCalledWith(server, true);
  });

  test("given up: what was tried, Try once more now", () => {
    const claude = claudeOf(
      result([conn("Slack", "failed")], {
        givenUp: [
          { server: "claude.ai Slack", retryAt: new Date().toISOString() },
        ],
      }),
    );
    render(
      <ConnectorWhy
        providerName="Slack"
        server="claude.ai Slack"
        claude={claude}
      />,
    );
    expect(screen.getByTestId("connector-stuck")).toHaveTextContent(
      "Slack still can't connect — Dash has stopped trying",
    );
    expect(screen.queryByTestId("connector-cause")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try once more now" }));
    expect(claude.giveUp).toHaveBeenCalledWith("claude.ai Slack", false);
  });

  test("Copy details", async () => {
    const writeText = jest.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    const claude = claudeOf(result([conn("Slack")]));
    render(
      <ConnectorWhy
        providerName="Gmail"
        server="claude.ai Gmail"
        claude={claude}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    });
    expect(writeText.mock.calls[0][0]).toMatch(
      /^Dash · Gmail \(claude.ai Gmail\)/,
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
