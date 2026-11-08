import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ClaudeConnectorDetail,
  ClaudeConnectorPicker,
  connectorLabel,
  connectorProviderName,
  connectorToolsText,
  toolKind,
} from "./ClaudeConnectorDetail";
import { providerStatus, missingFields } from "../../AppPages/providerSummary";

const CALENDAR = {
  server: "claude.ai Google Calendar",
  name: "Google Calendar",
  status: "connected",
  tools: [
    { name: "list_events", description: "List events", readOnly: true },
    { name: "create_event", description: "Add an event" },
    { name: "delete_event", description: "Delete one", destructive: true },
  ],
};
const DRIVE = {
  server: "claude.ai Google Drive",
  name: "Google Drive",
  status: "needs-auth",
  tools: [],
};

const hook = (result, over = {}) => ({
  result,
  loading: false,
  refresh: jest.fn(),
  statusOf: () => null,
  ...over,
});

describe("ClaudeConnectorPicker", () => {
  it("lists the account's connectors; Add only for connected ones", () => {
    const onAdd = jest.fn();
    render(
      <ClaudeConnectorPicker
        connectors={hook({ state: "ready", connectors: [CALENDAR, DRIVE] })}
        onAdd={onAdd}
      />,
    );
    expect(screen.getByText("Signed in to Claude Code")).toBeInTheDocument();
    expect(screen.getAllByTestId("claude-connector-row")).toHaveLength(2);
    expect(screen.getByText("3 tools · 1 read-only")).toBeInTheDocument();
    expect(screen.getByText("Sign in on claude.ai")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add Google Drive" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Add Google Calendar" }),
    );
    expect(onAdd).toHaveBeenCalledWith(CALENDAR);
  });

  it("a connector already added opens instead", () => {
    const onOpen = jest.fn();
    render(
      <ClaudeConnectorPicker
        connectors={hook({ state: "ready", connectors: [CALENDAR] })}
        providers={{
          Calendar: {
            providerClass: "connector",
            mcpConfig: { server: "claude.ai Google Calendar" },
          },
        }}
        onOpen={onOpen}
      />,
    );
    // By the connector's name; opens the provider it was added as.
    fireEvent.click(
      screen.getByRole("button", { name: "Open Google Calendar" }),
    );
    expect(onOpen).toHaveBeenCalledWith("Calendar");
  });

  it("not signed in: how to sign in, and Check again", () => {
    const h = hook({ state: "not-signed-in", connectors: [] });
    render(<ClaudeConnectorPicker connectors={h} />);
    expect(screen.getByText("Claude Code isn't signed in")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Check again"));
    expect(h.refresh).toHaveBeenCalled();
  });

  it("not installed, and while reading", () => {
    const { rerender } = render(
      <ClaudeConnectorPicker
        connectors={hook({ state: "not-installed", connectors: [] })}
      />,
    );
    expect(screen.getByText("Claude Code isn't installed")).toBeInTheDocument();
    rerender(<ClaudeConnectorPicker connectors={hook(null)} />);
    expect(
      screen.getByText("Reading your Claude connectors…"),
    ).toBeInTheDocument();
  });
});

describe("ClaudeConnectorDetail", () => {
  const provider = {
    providerClass: "connector",
    mcpConfig: { server: CALENDAR.server },
    allowedTools: ["list_events"],
  };

  it("ticks the allowed tools, marks what each does, saves the new set", async () => {
    const onSave = jest.fn().mockResolvedValue();
    render(
      <ClaudeConnectorDetail
        providerName="Google Calendar"
        provider={provider}
        connector={CALENDAR}
        status="connected"
        onSave={onSave}
      />,
    );
    expect(screen.getByText("1 of 3 on")).toBeInTheDocument();
    expect(screen.getByLabelText("list_events")).toBeChecked();
    expect(screen.getByLabelText("create_event")).not.toBeChecked();
    expect(screen.getByText("Deletes")).toBeInTheDocument();
    expect(screen.getByText("Changes things")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("create_event"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(["list_events", "create_event"]),
    );
  });

  it("Select all and Read-only only", () => {
    render(
      <ClaudeConnectorDetail
        providerName="Google Calendar"
        provider={provider}
        connector={CALENDAR}
        status="connected"
        onSave={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Select all"));
    expect(screen.getByText("3 of 3 on")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Read-only only"));
    expect(screen.getByText("1 of 3 on")).toBeInTheDocument();
  });

  it("Remove from Dash", () => {
    const onDelete = jest.fn();
    render(
      <ClaudeConnectorDetail
        providerName="Google Calendar"
        provider={provider}
        connector={null}
        status={null}
        onSave={jest.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByText("Remove from Dash"));
    expect(onDelete).toHaveBeenCalledWith("Google Calendar");
  });
});

describe("helpers", () => {
  it("names a new provider after the connector, never over another", () => {
    expect(connectorProviderName(CALENDAR, {})).toBe("Google Calendar");
    expect(connectorProviderName(CALENDAR, { "Google Calendar": {} })).toBe(
      "Google Calendar (Claude connector)",
    );
    // Shown by the connector's own name, whatever its provider is called.
    expect(
      connectorLabel("Google Calendar (Claude connector)", {
        mcpConfig: { server: "claude.ai Google Calendar" },
      }),
    ).toBe("Google Calendar");
  });
  it("tool counts and kinds", () => {
    expect(connectorToolsText(DRIVE)).toBe("No tools listed");
    expect(toolKind({ readOnly: true }).label).toBe("Read-only");
  });
  it("a connector never needs a key; its status comes from the account", () => {
    const p = { providerClass: "connector", credentials: {} };
    expect(missingFields(p)).toEqual([]);
    expect(providerStatus(p).label).toBe("Claude connector");
    expect(providerStatus(p, { connectorStatus: "connected" }).key).toBe(
      "connected",
    );
    expect(providerStatus(p, { connectorStatus: "needs-auth" }).label).toBe(
      "Sign in on claude.ai",
    );
    expect(providerStatus(p, { connectorStatus: "absent" }).label).toBe(
      "Not in your Claude account",
    );
  });
});
