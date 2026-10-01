import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BotDetail } from "./BotDetail";

describe("BotDetail (create)", () => {
  it("keeps Create disabled until name + instructions are filled", () => {
    render(
      <BotDetail
        isCreating
        providers={{}}
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText("Create")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "PR Digest" },
    });
    expect(screen.getByText("Create")).toBeDisabled(); // instructions still empty
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Summarize PRs" },
    });
    expect(screen.getByText("Create")).not.toBeDisabled();
  });

  it("auto-selects the user's default AI provider for a new bot", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        isCreating
        providers={{
          p1: { type: "anthropic", isDefaultForType: true },
          p2: { type: "openai" },
        }}
        onSave={onSave}
      />,
    );
    // Shows the actual provider name, pre-selected — not a vague "default".
    expect(screen.getByLabelText("Model source")).toHaveValue("anthropic");
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Y" },
    });
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][0].provider).toBe("anthropic");
  });

  it("offers Claude Code (CLI) as a provider option", () => {
    render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
    // With no API-key provider configured, CLI is the pre-selected fallback.
    expect(screen.getByLabelText("Model source")).toHaveValue("claude-code");
  });

  it("does not label the AI dropdown 'Provider' (that word means Dash MCP providers)", () => {
    render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
    expect(screen.queryByLabelText("Provider")).toBeNull();
    expect(screen.getByText("AI model")).toBeInTheDocument();
  });

  it("builds a definition with a schedule from the friendly dropdowns", () => {
    const onSave = jest.fn().mockResolvedValue({ id: "bot_x" });
    render(
      <BotDetail
        isCreating
        providers={{ p1: { type: "anthropic", isDefaultForType: true } }}
        onSave={onSave}
        onCancel={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "PR Digest" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Summarize PRs" },
    });
    // Schedule: Every weekday at 07:00 → "0 7 * * 1-5"
    fireEvent.change(screen.getByLabelText("Runs"), {
      target: { value: "weekday" },
    });
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "07:00" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Task prompt for the scheduled run"),
      { target: { value: "prepare digest" } },
    );
    fireEvent.click(screen.getByText("Create"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: "PR Digest",
      instructions: "Summarize PRs",
      provider: "anthropic",
      model: null,
      approvalPolicy: "ask",
      mcpServers: [],
      schedules: [{ cron: "0 7 * * 1-5", prompt: "prepare digest" }],
    });
  });

  it("no schedule when frequency is Off", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(<BotDetail isCreating providers={{}} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Y" },
    });
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][0].schedules).toEqual([]);
  });

  it("saves the selected engine (Claude Agent)", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(<BotDetail isCreating providers={{}} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Y" },
    });
    fireEvent.change(screen.getByLabelText("Engine"), {
      target: { value: "claude-agent" },
    });
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][0].engine).toBe("claude-agent");
  });

  it("defaults engine to null (Standard)", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(<BotDetail isCreating providers={{}} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Y" },
    });
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][0].engine).toBeNull();
  });

  it("adds an event subscription and saves it", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(<BotDetail isCreating providers={{}} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Y" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Event name, e.g. pr.opened"),
      { target: { value: "pr.opened" } },
    );
    fireEvent.click(screen.getByText("Add"));
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][0].subscriptions).toEqual([
      { eventType: "pr.opened" },
    ]);
  });
});

describe("BotDetail — Providers (the user's Dash MCP providers)", () => {
  const sources = [
    {
      name: "gmail",
      type: "gmail",
      running: true,
      toolCount: 17,
      declared: true,
      tools: ["search_emails", "read_email", "send_email"],
    },
    {
      name: "notion",
      type: "notion",
      running: false,
      toolCount: null,
      declared: false,
      tools: null,
    },
  ];
  let listToolSources;

  beforeEach(() => {
    listToolSources = jest.fn().mockResolvedValue(sources);
    window.mainApi = { bots: { listToolSources } };
  });
  afterEach(() => {
    delete window.mainApi;
  });

  const fillRequired = () => {
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "Inbox triage" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Summarize unread mail" },
    });
  };

  it("lists every configured MCP provider — including ones not running", async () => {
    render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
    expect(await screen.findByLabelText("Gmail")).toBeInTheDocument();
    // Not running, but configured → still offered.
    expect(screen.getByLabelText("Notion")).toBeInTheDocument();
    expect(listToolSources).toHaveBeenCalled();
  });

  it("shows running status / tool count for each provider", async () => {
    render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
    await screen.findByLabelText("Gmail");
    expect(screen.getByText(/17 tools/)).toBeInTheDocument();
    expect(screen.getByText(/starts when the bot runs/i)).toBeInTheDocument();
  });

  it("saves the selected providers as mcpServers", async () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(<BotDetail isCreating providers={{}} onSave={onSave} />);
    fillRequired();
    fireEvent.click(await screen.findByLabelText("Notion"));
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][0].mcpServers).toEqual(["notion"]);
  });

  it("puts Providers before the AI model settings", async () => {
    render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
    await screen.findByLabelText("Gmail");
    const providersHeading = screen.getByText("Providers");
    const aiHeading = screen.getByText("AI model");
    expect(
      providersHeading.compareDocumentPosition(aiHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("checking a provider expands its declared tools, all allowed by default", async () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(<BotDetail isCreating providers={{}} onSave={onSave} />);
    fillRequired();
    // Tools stay hidden until the provider is selected.
    expect(screen.queryByLabelText("Search emails")).toBeNull();
    fireEvent.click(await screen.findByLabelText("Gmail"));
    expect(screen.getByLabelText("Search emails")).toBeChecked();
    expect(screen.getByLabelText("Read email")).toBeChecked();
    expect(screen.getByLabelText("Send email")).toBeChecked();
    fireEvent.click(screen.getByText("Create"));
    const def = onSave.mock.calls[0][0];
    expect(def.mcpServers).toEqual(["gmail"]);
    // Untouched → no narrowing stored (every tool the provider allows).
    expect(def.toolSelections).toEqual({});
  });

  it("unchecking a tool saves the narrowed selection for that provider", async () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(<BotDetail isCreating providers={{}} onSave={onSave} />);
    fillRequired();
    fireEvent.click(await screen.findByLabelText("Gmail"));
    fireEvent.click(screen.getByLabelText("Send email"));
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][0].toolSelections).toEqual({
      gmail: ["search_emails", "read_email"],
    });
  });

  it("a provider with no declared tool limit says it allows every tool", async () => {
    render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
    fireEvent.click(await screen.findByLabelText("Notion"));
    expect(
      screen.getByText(/All tools this provider offers/i),
    ).toBeInTheDocument();
  });

  it("restores an existing bot's narrowed selection", async () => {
    render(
      <BotDetail
        bot={{
          id: "bot_9",
          name: "x",
          instructions: "y",
          mcpServers: ["gmail"],
          toolSelections: { gmail: ["read_email"] },
          schedules: [],
        }}
        providers={{}}
        onSave={jest.fn()}
      />,
    );
    expect(await screen.findByLabelText("Read email")).toBeChecked();
    expect(screen.getByLabelText("Search emails")).not.toBeChecked();
  });

  it("empty state points to Settings → Providers (not MCP Server)", async () => {
    listToolSources.mockResolvedValue([]);
    render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
    expect(await screen.findByText(/Settings → Providers/)).toBeInTheDocument();
    expect(screen.queryByText(/Settings → MCP Server/)).toBeNull();
  });

  // Remembered approvals ("Always allow") — visible + revocable per tool.
  describe("remembered approvals", () => {
    const editBot = {
      id: "bot_9",
      name: "x",
      instructions: "y",
      mcpServers: ["gmail"],
      schedules: [],
    };

    it("marks remembered tools 'Always allowed' with a Revoke control", async () => {
      window.mainApi.bots.getGrants = jest.fn().mockResolvedValue({
        gmail: { tools: ["search_emails"], folders: [] },
      });
      render(<BotDetail bot={editBot} providers={{}} onSave={jest.fn()} />);
      expect(await screen.findByText(/Always allowed/)).toBeInTheDocument();
      expect(window.mainApi.bots.getGrants).toHaveBeenCalledWith("bot_9");
      expect(
        screen.getByLabelText("Revoke always-allow for Search emails"),
      ).toBeInTheDocument();
      // Only the remembered tool is marked.
      expect(screen.getAllByText(/Always allowed/)).toHaveLength(1);
    });

    it("Revoke removes the remembered approval", async () => {
      window.mainApi.bots.getGrants = jest.fn().mockResolvedValue({
        gmail: { tools: ["search_emails"], folders: [] },
      });
      window.mainApi.bots.revokeGrant = jest.fn().mockResolvedValue({});
      render(<BotDetail bot={editBot} providers={{}} onSave={jest.fn()} />);
      fireEvent.click(
        await screen.findByLabelText("Revoke always-allow for Search emails"),
      );
      expect(window.mainApi.bots.revokeGrant).toHaveBeenCalledWith(
        "bot_9",
        "gmail",
        "search_emails",
      );
      await waitFor(() =>
        expect(screen.queryByText(/Always allowed/)).toBeNull(),
      );
    });

    it("lists remembered folders for a provider", async () => {
      window.mainApi.bots.getGrants = jest.fn().mockResolvedValue({
        gmail: { tools: ["read_email"], folders: ["/Users/me/Inbox"] },
      });
      render(<BotDetail bot={editBot} providers={{}} onSave={jest.fn()} />);
      expect(await screen.findByText(/\/Users\/me\/Inbox/)).toBeInTheDocument();
    });

    it("a new (unsaved) bot doesn't look up remembered approvals", async () => {
      window.mainApi.bots.getGrants = jest.fn().mockResolvedValue({});
      render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
      await screen.findByLabelText("Gmail");
      expect(window.mainApi.bots.getGrants).not.toHaveBeenCalled();
    });
  });
});

describe("BotDetail (edit)", () => {
  const bot = {
    id: "bot_1",
    name: "A",
    instructions: "do it",
    provider: "anthropic",
    approvalPolicy: "ask",
    mcpServers: ["github"],
    schedules: [],
  };

  it("shows Save + Delete and preserves id + attached servers", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={bot}
        providers={{}}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    // An attached-but-not-connected server still renders, checked, and is kept.
    expect(screen.getByLabelText("GitHub")).toBeChecked();
    fireEvent.click(screen.getByText("Save"));
    const def = onSave.mock.calls[0][0];
    expect(def.id).toBe("bot_1");
    expect(def.mcpServers).toEqual(["github"]);
  });

  it("pre-populates the schedule dropdowns from an existing cron", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={{
          ...bot,
          schedules: [{ cron: "0 9 * * 1-5", prompt: "hi" }],
        }}
        providers={{}}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByLabelText("Runs")).toHaveValue("weekday");
    expect(screen.getByLabelText("Time")).toHaveValue("09:00");
  });

  it("shows Advanced cron for a hand-written expression and round-trips it", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={{ ...bot, schedules: [{ cron: "*/5 * * * *", prompt: "" }] }}
        providers={{}}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("Cron, e.g. 0 7 * * 1-5")).toHaveValue(
      "*/5 * * * *",
    );
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].schedules).toEqual([
      { cron: "*/5 * * * *", prompt: "" },
    ]);
  });

  it("renders existing subscriptions and removes one", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={{ ...bot, subscriptions: [{ eventType: "pr.opened" }] }}
        providers={{}}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByText("pr.opened")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove pr.opened"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].subscriptions).toEqual([]);
  });

  it("Delete triggers onDelete", () => {
    const onDelete = jest.fn();
    render(
      <BotDetail
        bot={bot}
        providers={{}}
        onSave={jest.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
  });
});
