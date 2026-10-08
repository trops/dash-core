import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
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

  it("a new bot starts on Claude Code (CLI), even with an API key marked default", () => {
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
    expect(screen.getByLabelText("Model source")).toHaveValue("claude-code");
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Y" },
    });
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][0].provider).toBe("claude-code");
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
      // Claude Code (CLI) is the default, even with an API key marked default.
      provider: "claude-code",
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
});

// "Run on events" — pick Dashboard › Widget › Event; never typed (US-011 AC9).
describe("BotDetail — event picker", () => {
  const workspaces = [
    {
      id: 7,
      name: "Kitchen Sink",
      layout: [
        {
          component: "trops.samples.EventSender",
          id: 3,
          dashboardId: 7,
        },
      ],
    },
  ];
  const getWidgetConfig = (name) =>
    name === "trops.samples.EventSender"
      ? { name: "Event Sender", events: ["buttonClicked", "messageSent"] }
      : null;

  const fillRequired = () => {
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Y" },
    });
  };

  it("has no free-text event input", () => {
    render(
      <BotDetail
        isCreating
        providers={{}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        onSave={jest.fn()}
      />,
    );
    expect(screen.queryByPlaceholderText(/Event name/)).toBeNull();
  });

  it("picks a widget event from Runs when… and saves eventType + source", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        isCreating
        providers={{}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        onSave={onSave}
      />,
    );
    fillRequired();
    // One picker: no From / Dashboard / Widget steps.
    expect(screen.queryByLabelText("From")).toBeNull();
    expect(screen.queryByLabelText("Dashboard")).toBeNull();
    expect(screen.queryByLabelText("Widget")).toBeNull();
    fireEvent.change(screen.getByLabelText("Runs when…"), {
      target: { value: "trops.samples.EventSender[3].buttonClicked" },
    });
    fireEvent.click(screen.getByText("Add trigger"));
    expect(screen.getByText("Save to keep this trigger.")).toBeInTheDocument();
    // Chip shows the friendly path, not the raw bus string.
    expect(screen.getByText(/Kitchen Sink › .* › buttonClicked/)).toBeTruthy();
    fireEvent.click(screen.getByText("Create"));
    const [sub] = onSave.mock.calls[0][0].subscriptions;
    expect(sub.eventType).toBe("trops.samples.EventSender[3].buttonClicked");
    expect(sub.source).toEqual({
      kind: "widget",
      ref: "trops.samples.EventSender",
      instanceId: "3",
      event: "buttonClicked",
      workspaceId: "7",
    });
    expect(sub.label).toMatch(/Kitchen Sink › .* › buttonClicked/);
  });

  it("Add trigger stays disabled until a trigger is chosen", () => {
    render(
      <BotDetail
        isCreating
        providers={{}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        onSave={jest.fn()}
      />,
    );
    expect(screen.getByText("Add trigger")).toBeDisabled();
  });

  it("flags a subscription whose widget is gone, and it can be removed", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={{
          id: "bot_1",
          name: "X",
          instructions: "Y",
          schedules: [],
          subscriptions: [
            {
              eventType: "trops.samples.Gone[9].x",
              label: "Kitchen Sink › Gone › x",
              source: {
                kind: "widget",
                ref: "trops.samples.Gone",
                instanceId: "9",
                event: "x",
                workspaceId: "7",
              },
            },
          ],
        }}
        providers={{}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        onSave={onSave}
      />,
    );
    expect(screen.getByText(/widget missing/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove Kitchen Sink › Gone › x"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].subscriptions).toEqual([]);
  });

  it("keeps an older typed subscription (shown as-is) when saving", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={{
          id: "bot_1",
          name: "X",
          instructions: "Y",
          schedules: [],
          subscriptions: [{ eventType: "pr.opened" }],
        }}
        providers={{}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        onSave={onSave}
      />,
    );
    expect(screen.getByText("pr.opened")).toBeInTheDocument();
    // Mark the form changed (Save is disabled until it is); saved
    // instructions are trimmed, so the values checked below are unchanged.
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: {
        value:
          screen.getByPlaceholderText("What should this bot do?").value + " ",
      },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].subscriptions).toEqual([
      { eventType: "pr.opened" },
    ]);
  });

  it("explains when nothing can trigger the bot", () => {
    render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
    expect(
      screen.getByText(/Nothing can trigger this bot yet/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Runs when…")).toBeNull();
  });

  it("a team bot is only offered its own dashboard's widgets", () => {
    render(
      <BotDetail
        isCreating
        defaultWorkspaceId={8}
        providers={{}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        onSave={jest.fn()}
      />,
    );
    // Dashboard 8 has no publishing widget; Kitchen Sink's aren't offered.
    expect(screen.queryByLabelText("Runs when…")).toBeNull();
    expect(
      screen.getByText(/Add a widget that publishes events to this dashboard/),
    ).toBeInTheDocument();
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
    // Mark the form changed (Save is disabled until it is); saved
    // instructions are trimmed, so the values checked below are unchanged.
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: {
        value:
          screen.getByPlaceholderText("What should this bot do?").value + " ",
      },
    });
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
    // Mark the form changed (Save is disabled until it is); saved
    // instructions are trimmed, so the values checked below are unchanged.
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: {
        value:
          screen.getByPlaceholderText("What should this bot do?").value + " ",
      },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].schedules).toEqual([
      { cron: "*/5 * * * *", prompt: "" },
    ]);
  });

  it("saving keeps changes made elsewhere since the form opened (only edited fields win)", async () => {
    // The form opened on Anthropic; since then the provider was switched to
    // the CLI elsewhere and a trigger was added on the team diagram.
    window.mainApi = {
      bots: {
        get: jest.fn().mockResolvedValue({
          ...bot,
          provider: "claude-code",
          subscriptions: [{ eventType: "bot:local/x[b2].completed" }],
        }),
      },
    };
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={{ ...bot, subscriptions: [] }}
        providers={{}}
        onSave={onSave}
        onDelete={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "do it better" },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0];
    expect(window.mainApi.bots.get).toHaveBeenCalledWith("bot_1");
    expect(saved.instructions).toBe("do it better");
    expect(saved.provider).toBe("claude-code");
    expect(saved.subscriptions).toEqual([
      { eventType: "bot:local/x[b2].completed" },
    ]);
    delete window.mainApi;
  });

  it("shows a trigger's note (set on the team diagram, TEAM-014)", () => {
    render(
      <BotDetail
        bot={{
          ...bot,
          subscriptions: [{ eventType: "pr.opened", note: "Summarise it." }],
        }}
        providers={{}}
        onSave={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByTestId("trigger-note")).toHaveTextContent(
      "Then: Summarise it.",
    );
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

// "Run on events" → From: Another bot → Bot › Event (PRD US-010 / US-011 AC9).
describe("BotDetail — bot events in the picker", () => {
  const gmailBot = {
    id: "bot_9",
    name: "Gmail Email Check",
    ref: "local/gmail-email-check",
    instructions: "check mail",
    mcpServers: ["Gmail New"],
    toolSelections: { "Gmail New": ["search_emails"] },
    schedules: [],
  };
  const sources = [
    { name: "Gmail New", type: "gmail", tools: ["search_emails"] },
  ];

  beforeEach(() => {
    window.mainApi = {
      bots: { listToolSources: jest.fn().mockResolvedValue(sources) },
    };
  });

  const fillRequired = () => {
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "Notifier" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Notify me" },
    });
  };

  it("picks another bot's event from Runs when… and saves it", async () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail isCreating providers={{}} bots={[gmailBot]} onSave={onSave} />,
    );
    fillRequired();
    // Tool events appear once the provider list has loaded.
    await screen.findByText(
      "Gmail Email Check › uses search_emails (Gmail New)",
    );
    fireEvent.change(screen.getByLabelText("Runs when…"), {
      target: {
        value: "bot:local/gmail-email-check[bot_9].tool.gmail.search_emails",
      },
    });
    fireEvent.click(screen.getByText("Add trigger"));
    expect(
      screen.getByText("Gmail Email Check › Gmail New › search_emails"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Create"));
    const [sub] = onSave.mock.calls[0][0].subscriptions;
    expect(sub.eventType).toBe(
      "bot:local/gmail-email-check[bot_9].tool.gmail.search_emails",
    );
    expect(sub.source).toEqual({
      kind: "bot",
      ref: "local/gmail-email-check",
      instanceId: "bot_9",
      event: "tool.gmail.search_emails",
    });
  });

  it("doesn't offer the bot being edited as a source", () => {
    render(
      <BotDetail
        bot={gmailBot}
        providers={{}}
        bots={[gmailBot]}
        onSave={jest.fn()}
      />,
    );
    expect(screen.queryByText(/Gmail Email Check ›/)).toBeNull();
    expect(
      screen.getByText(/Nothing can trigger this bot yet/),
    ).toBeInTheDocument();
  });

  it("flags a subscription whose source bot was deleted", () => {
    render(
      <BotDetail
        bot={{
          id: "bot_2",
          name: "Notifier",
          instructions: "x",
          schedules: [],
          subscriptions: [
            {
              eventType: "bot:local/old[bot_gone].completed",
              label: "Old Bot › Completed",
              source: {
                kind: "bot",
                ref: "local/old",
                instanceId: "bot_gone",
                event: "completed",
              },
            },
          ],
        }}
        providers={{}}
        bots={[]}
        onSave={jest.fn()}
      />,
    );
    expect(screen.getByText(/bot missing/i)).toBeInTheDocument();
  });
});

// Team = the dashboard this bot belongs to (bot-teams TEAM-001).
describe("BotDetail — Team", () => {
  const workspaces = [
    {
      id: 7,
      name: "Kitchen Sink",
      layout: [
        { component: "trops.samples.EventSender", id: 3, dashboardId: 7 },
      ],
    },
    { id: 9, name: "Sales", layout: [] },
  ];
  const getWidgetConfig = (name) =>
    name === "trops.samples.EventSender"
      ? { name: "Event Sender", events: ["buttonClicked"] }
      : null;
  const fill = () => {
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Y" },
    });
  };

  it("offers Unassigned + every dashboard; a new bot defaults to Unassigned", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        isCreating
        providers={{}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        onSave={onSave}
      />,
    );
    const team = screen.getByLabelText("Team");
    expect(Array.from(team.options).map((o) => o.textContent)).toEqual([
      "Unassigned",
      "Kitchen Sink",
      "Sales",
    ]);
    fill();
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][0].workspaceId).toBeNull();
  });

  it("a bot created from a dashboard is preset to that team", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        isCreating
        defaultWorkspaceId={7}
        providers={{}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText("Team")).toHaveValue("7");
    // The picker offers this dashboard's widgets.
    expect(
      Array.from(screen.getByLabelText("Runs when…").options).some((o) =>
        o.value.startsWith("trops.samples.EventSender[3]."),
      ),
    ).toBe(true);
    fill();
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][0].workspaceId).toBe("7");
  });

  it("moving a bot out of its team saves workspaceId null", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={{
          id: "bot_1",
          name: "X",
          instructions: "Y",
          schedules: [],
          workspaceId: "9",
        }}
        providers={{}}
        workspaces={workspaces}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText("Team")).toHaveValue("9");
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].workspaceId).toBeNull();
  });

  it("warns when the bot listens to another dashboard's widgets", () => {
    render(
      <BotDetail
        bot={{
          id: "bot_1",
          name: "X",
          instructions: "Y",
          schedules: [],
          workspaceId: null,
          subscriptions: [
            {
              eventType: "trops.samples.EventSender[3].buttonClicked",
              label: "Kitchen Sink › Event Sender › buttonClicked",
              source: {
                kind: "widget",
                ref: "trops.samples.EventSender",
                instanceId: "3",
                event: "buttonClicked",
                workspaceId: "7",
              },
            },
          ],
        }}
        providers={{}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        onSave={jest.fn()}
      />,
    );
    expect(screen.queryByText(/won.t fire/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "9" } });
    expect(screen.getByText(/won.t fire/i)).toBeInTheDocument();
  });
});

// Bots view (TEAM-011): the inline Settings tab guards unsaved changes.
describe("BotDetail — onDirtyChange", () => {
  const existing = {
    id: "bot_1",
    name: "Inbox Watch",
    instructions: "Watch it",
    schedules: [],
  };

  it("reports dirty when a field changes, clean when it's changed back", () => {
    const onDirtyChange = jest.fn();
    render(
      <BotDetail
        bot={existing}
        providers={{}}
        onSave={jest.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
    const nameInput = screen.getByPlaceholderText("e.g. PR Digest");
    fireEvent.change(nameInput, { target: { value: "Inbox Watch 2" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(nameInput, { target: { value: "Inbox Watch" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("is clean again after a successful save", async () => {
    const onDirtyChange = jest.fn();
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={existing}
        providers={{}}
        onSave={onSave}
        onDirtyChange={onDirtyChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
});

describe("BotDetail — a lead's suggestions (TEAM-005 5b)", () => {
  const sources = [
    {
      name: "Gmail New",
      type: "gmail",
      running: true,
      toolCount: 3,
      declared: true,
      tools: ["search_emails", "read_email", "send_email"],
    },
    {
      name: "Slack",
      type: "slack",
      running: false,
      toolCount: null,
      declared: false,
      tools: null,
    },
  ];
  const suggestions = [
    {
      provider: "Gmail New",
      tools: ["search_emails", "read_email"],
      toolsChecked: true,
    },
    { provider: "Slack", tools: ["post_message"], toolsChecked: false },
  ];
  const draftBot = {
    name: "Morning Digest",
    instructions: "Summarise urgent mail.",
    mcpServers: [],
    toolSelections: {},
    schedules: [],
    subscriptions: [],
  };

  beforeEach(() => {
    window.mainApi = {
      bots: { listToolSources: jest.fn().mockResolvedValue(sources) },
    };
  });
  afterEach(() => {
    delete window.mainApi;
  });

  const renderDraft = (onSave = jest.fn().mockResolvedValue({})) => {
    render(
      <BotDetail
        bot={draftBot}
        isCreating
        providers={{}}
        suggestions={suggestions}
        onSave={onSave}
      />,
    );
    return onSave;
  };

  it("marks suggested providers, with nothing selected yet", async () => {
    renderDraft();
    expect(await screen.findByLabelText("Gmail New")).not.toBeChecked();
    expect(screen.getAllByText("Suggested by the lead")).toHaveLength(2);
  });

  it("Accept turns the provider on with exactly the suggested tools", async () => {
    const onSave = renderDraft();
    await screen.findByLabelText("Gmail New");
    fireEvent.click(screen.getByRole("button", { name: "Accept Gmail New" }));
    expect(screen.getByLabelText("Gmail New")).toBeChecked();
    expect(screen.getByLabelText("Search emails")).toBeChecked();
    expect(screen.getByLabelText("Read email")).toBeChecked();
    expect(screen.getByLabelText("Send email")).not.toBeChecked();
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0];
    expect(saved.mcpServers).toEqual(["Gmail New"]);
    expect(saved.toolSelections).toEqual({
      "Gmail New": ["search_emails", "read_email"],
    });
  });

  it("a provider whose tools couldn't be checked says it allows all", async () => {
    renderDraft();
    await screen.findByLabelText("Slack");
    const btn = screen.getByRole("button", { name: "Accept Slack" });
    expect(btn).toHaveTextContent("Accept (all tools)");
    fireEvent.click(btn);
    expect(screen.getByLabelText("Slack")).toBeChecked();
  });

  it("Accept all suggestions", async () => {
    const onSave = renderDraft();
    await screen.findByLabelText("Gmail New");
    fireEvent.click(screen.getByText("Accept all suggestions"));
    expect(screen.getByLabelText("Gmail New")).toBeChecked();
    expect(screen.getByLabelText("Slack")).toBeChecked();
    expect(screen.queryByText("Accept all suggestions")).toBeNull();
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].mcpServers).toEqual(["Gmail New", "Slack"]);
  });

  it("no suggestions → nothing extra", async () => {
    render(
      <BotDetail bot={draftBot} isCreating providers={{}} onSave={jest.fn()} />,
    );
    await screen.findByLabelText("Gmail New");
    expect(screen.queryByText("Suggested by the lead")).toBeNull();
    expect(screen.queryByText("Accept all suggestions")).toBeNull();
  });
});

describe("BotDetail (a bot with no AI model of its own)", () => {
  const bot = {
    id: "bot_lead",
    name: "Daily Lead",
    instructions: "Lead the team",
    provider: null,
  };

  it("shows it runs on the default, Claude Code (CLI) — not an API key marked default", () => {
    render(
      <BotDetail
        bot={bot}
        providers={{
          p1: { type: "openai" },
          p2: { type: "anthropic", isDefaultForType: true },
        }}
        onSave={jest.fn()}
      />,
    );
    const select = screen.getByLabelText("Model source");
    expect(select).toHaveValue("default");
    expect(
      screen.getByRole("option", { name: "Default — Claude Code (CLI)" }),
    ).toBeInTheDocument();
  });

  it("no warning that runs fail, and keeps provider null on save", async () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={bot}
        providers={{ p1: { type: "openai" } }}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText("Model source")).toHaveValue("default");
    expect(
      screen.getByRole("option", { name: "Default — Claude Code (CLI)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/runs fail until you choose one/i),
    ).not.toBeInTheDocument();
    // Mark the form changed (Save is disabled until it is); saved
    // instructions are trimmed, so the values checked below are unchanged.
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: {
        value:
          screen.getByPlaceholderText("What should this bot do?").value + " ",
      },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].provider).toBeNull();
  });

  it("saves an explicit choice when the user picks one", async () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={bot}
        providers={{ p1: { type: "openai" } }}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Model source"), {
      target: { value: "claude-code" },
    });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].provider).toBe("claude-code");
  });
});

describe("BotDetail (approval policy)", () => {
  it("offers Ask before every tool and explains what each policy does", () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <BotDetail
        bot={{
          id: "b1",
          name: "Agenda",
          instructions: "x",
          provider: "claude-code",
        }}
        providers={{}}
        onSave={onSave}
      />,
    );
    const select = screen.getByLabelText("Approval policy");
    expect(select).toHaveValue("ask");
    expect(
      screen.getByText(/read-only tools run without asking/i),
    ).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "ask-every" } });
    expect(
      screen.getByText(/asks before every tool, reads included/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].approvalPolicy).toBe("ask-every");
  });
});

describe("BotDetail (save feedback)", () => {
  const bot = {
    id: "bot_1",
    name: "Agenda",
    instructions: "Read the calendar.",
    provider: "claude-code",
  };
  const edit = () =>
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Read today's calendar." },
    });

  it("keeps Save disabled until something changes", () => {
    render(<BotDetail bot={bot} providers={{}} onSave={jest.fn()} />);
    expect(screen.getByText("Save")).toBeDisabled();
    edit();
    expect(screen.getByText("Save")).not.toBeDisabled();
  });

  it("says Saved after a successful save, until the next edit", async () => {
    const onSave = jest.fn().mockResolvedValue({ id: "bot_1" });
    render(<BotDetail bot={bot} providers={{}} onSave={onSave} />);
    edit();
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "Agenda 2" },
    });
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("shows Saving… while saving", async () => {
    let finish;
    const onSave = jest.fn(() => new Promise((r) => (finish = r)));
    render(<BotDetail bot={bot} providers={{}} onSave={onSave} />);
    edit();
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByText("Saving…")).toBeDisabled();
    finish({});
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("shows a failed save next to the button, and keeps the changes", async () => {
    const onSave = jest
      .fn()
      .mockRejectedValue(new Error("invalid bot — name is required"));
    render(<BotDetail bot={bot} providers={{}} onSave={onSave} />);
    edit();
    fireEvent.click(screen.getByText("Save"));
    const msg = await screen.findByText("invalid bot — name is required");
    expect(msg.closest("[data-testid='bot-detail-footer']")).not.toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.getByText("Save")).not.toBeDisabled();
  });
});

describe("BotDetail (show results on the dashboard, TEAM-012)", () => {
  const fill = () => {
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "Inbox" },
    });
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Scan mail" },
    });
  };

  it("offers 'Show results on this dashboard', ticked, when creating on a dashboard", () => {
    const onSave = jest.fn().mockResolvedValue({ id: "bot_new" });
    render(
      <BotDetail
        isCreating
        providers={{}}
        onSave={onSave}
        canShowOnDashboard
      />,
    );
    const box = screen.getByRole("checkbox", {
      name: "Show results on this dashboard",
    });
    expect(box).toBeChecked();
    fill();
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][1]).toEqual({ showOnDashboard: true });
    expect(onSave.mock.calls[0][0].showOnDashboard).toBeUndefined();
  });

  it("passes the choice when unticked", () => {
    const onSave = jest.fn().mockResolvedValue({ id: "bot_new" });
    render(
      <BotDetail
        isCreating
        providers={{}}
        onSave={onSave}
        canShowOnDashboard
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show results on this dashboard" }),
    );
    fill();
    fireEvent.click(screen.getByText("Create"));
    expect(onSave.mock.calls[0][1]).toEqual({ showOnDashboard: false });
  });

  it("isn't offered outside a dashboard, or when editing", () => {
    const { unmount } = render(
      <BotDetail isCreating providers={{}} onSave={jest.fn()} />,
    );
    expect(screen.queryByText("Show results on this dashboard")).toBeNull();
    unmount();
    render(
      <BotDetail
        bot={{ id: "b1", name: "X", instructions: "Y" }}
        providers={{}}
        onSave={jest.fn()}
        canShowOnDashboard
      />,
    );
    expect(screen.queryByText("Show results on this dashboard")).toBeNull();
  });
});

describe("BotDetail — gaps the lead found providers for (bot-capabilities CAP-005)", () => {
  const gaps = [
    {
      need: "download images",
      suggestions: [
        {
          id: "builtin:web-fetch",
          tier: "built-in",
          name: "Web Fetch",
          description: "",
          runs: "Built into Dash",
          credentials: [],
          installable: true,
          install: { kind: "catalog", catalogId: "web-fetch" },
        },
      ],
    },
  ];
  const draftBot = {
    name: "Image Labeler",
    instructions: "Label images.",
    mcpServers: [],
    toolSelections: {},
    schedules: [],
    subscriptions: [],
  };
  let listToolSources;
  beforeEach(() => {
    listToolSources = jest
      .fn()
      .mockResolvedValue([{ name: "Gmail New", type: "gmail", tools: null }]);
    window.mainApi = { bots: { listToolSources } };
  });
  afterEach(() => {
    delete window.mainApi;
  });

  it("shows each gap with its suggestions", async () => {
    render(
      <BotDetail
        bot={draftBot}
        isCreating
        providers={{}}
        gaps={gaps}
        onSave={jest.fn()}
      />,
    );
    expect(await screen.findByText("download images")).toBeInTheDocument();
    expect(screen.getByText("Add Web Fetch")).toBeInTheDocument();
  });

  it("after an install, the new provider can be turned on with Use", async () => {
    render(
      <BotDetail
        bot={draftBot}
        isCreating
        providers={{}}
        gaps={gaps}
        onSave={jest.fn()}
      />,
    );
    await screen.findByLabelText("Gmail New");
    listToolSources.mockResolvedValue([
      { name: "Gmail New", type: "gmail", tools: null },
      { name: "Web Fetch", type: "web-fetch", tools: ["fetch_image"] },
    ]);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("dash:provider-installed", {
          detail: { name: "Web Fetch" },
        }),
      );
    });
    fireEvent.click(await screen.findByText("Use Web Fetch"));
    expect(screen.getByLabelText("Web Fetch")).toBeChecked();
  });

  it("no gaps → no gap list", async () => {
    render(
      <BotDetail bot={draftBot} isCreating providers={{}} onSave={jest.fn()} />,
    );
    await screen.findByLabelText("Gmail New");
    expect(screen.queryByTestId("draft-gaps")).toBeNull();
  });
});

describe("BotDetail — Instructions grows to fit", () => {
  it("asks the TextArea to grow instead of scrolling inside the form", () => {
    render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
    expect(
      screen.getByPlaceholderText("What should this bot do?"),
    ).toHaveAttribute("data-autogrow", "true");
  });
});

describe("BotDetail — header scrolls with the form", () => {
  it("renders the header inside the scroll area, above Name", () => {
    render(
      <BotDetail
        isCreating
        providers={{}}
        onSave={jest.fn()}
        header={<div data-testid="draft-header">Drafted by your team lead</div>}
      />,
    );
    const header = screen.getByTestId("draft-header");
    const scroller = header.closest(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller).toContainElement(
      screen.getByPlaceholderText("e.g. PR Digest"),
    );
  });
});
