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
import {
  BotRunHistory,
  RunDetails,
  runStatusLabel,
  runToolErrors,
  runWarningList,
} from "./BotRunHistory";

const bot = { id: "b1", name: "Inbox Watch" };
const runs = [
  {
    trigger: "schedule",
    status: "completed",
    startedAt: "2026-10-01T09:00:00.000Z",
    output: "Yesterday: nothing urgent.",
    toolCalls: [],
  },
  {
    trigger: "manual",
    status: "failed",
    startedAt: "2026-10-02T10:15:00.000Z",
    error: "Token expired",
    output: "",
    toolCalls: [{ tool: "search_emails", provider: "Gmail New", ok: false }],
  },
  {
    trigger: "reply",
    status: "completed",
    startedAt: "2026-10-02T11:00:00.000Z",
    prompt: "Any more?",
    output: "Found 2 urgent emails from Acme.\nSecond line of detail.",
    toolCalls: [{ tool: "search_emails", provider: "Gmail New", ok: true }],
  },
];

function setup(history = runs) {
  window.mainApi = {
    bots: { getRuns: jest.fn().mockResolvedValue(history) },
  };
  return render(<BotRunHistory bot={bot} />);
}

afterEach(() => {
  delete window.mainApi;
});

describe("BotRunHistory", () => {
  it("lists runs newest first with trigger, status and the answer's first line", async () => {
    setup();
    const rows = await screen.findAllByTestId("run-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Reply");
    expect(rows[0]).toHaveTextContent("Completed");
    expect(rows[0]).toHaveTextContent("Found 2 urgent emails from Acme.");
    expect(rows[0]).not.toHaveTextContent("Second line");
    expect(rows[1]).toHaveTextContent("Failed");
    expect(rows[1]).toHaveTextContent("Token expired");
    expect(rows[2]).toHaveTextContent("Schedule");
  });

  it("opening a run shows the full answer, prompt and tool calls", async () => {
    setup();
    const rows = await screen.findAllByTestId("run-row");
    fireEvent.click(rows[0]);
    expect(screen.getByText(/Second line of detail/)).toBeInTheDocument();
    expect(screen.getByText("Any more?")).toBeInTheDocument();
    expect(
      screen.getByText(/search_emails · Gmail New · ok/),
    ).toBeInTheDocument();
  });

  it("says when an answer can't be read", async () => {
    setup([
      {
        trigger: "manual",
        status: "completed",
        startedAt: "2026-10-02T11:00:00.000Z",
        output: null,
        outputUnavailable: true,
      },
    ]);
    expect(await screen.findByText(/answer unavailable/i)).toBeInTheDocument();
  });

  it("empty state", async () => {
    setup([]);
    expect(await screen.findByText(/hasn.t run yet/)).toBeInTheDocument();
  });
});

describe("BotRunHistory — details, next steps, live (TEAM-011 gaps)", () => {
  function setupLive(history, props = {}) {
    const listeners = {};
    const api = {
      getRuns: jest.fn().mockResolvedValue(history),
      run: jest.fn().mockResolvedValue({ status: "completed" }),
      askLead: jest.fn().mockResolvedValue({ status: "completed" }),
      onStream: jest.fn((cb) => ((listeners.stream = cb), "s1")),
      removeListener: jest.fn(),
    };
    window.mainApi = { bots: api };
    const onOpenSettings = jest.fn();
    const utils = render(
      <BotRunHistory bot={bot} onOpenSettings={onOpenSettings} {...props} />,
    );
    return { api, listeners, onOpenSettings, ...utils };
  }

  const failed = {
    trigger: "event",
    status: "failed",
    startedAt: "2026-10-02T11:00:00.000Z",
    error:
      "Slack couldn't start: Authentication required. Check its settings on the Providers page.",
    prompt: "EVENT PROMPT",
    source: { eventType: "e", label: "Gmail › new email", chain: [] },
    approvals: [
      { tool: "send_message", provider: "Slack", decision: "allowed" },
      { tool: "send_email", provider: "Gmail New", decision: "allowed-always" },
      { tool: "Bash", provider: null, decision: "denied" },
    ],
  };

  it("shows what triggered the run and its approval decisions", async () => {
    setupLive([failed]);
    fireEvent.click(await screen.findByTestId("run-row"));
    expect(
      screen.getByText("Triggered by Gmail › new email"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("send_message on Slack · you allowed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("send_email on Gmail New · you always allowed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Bash (built-in) · you denied"),
    ).toBeInTheDocument();
  });

  it("shows read-only tools that ran without asking", async () => {
    setupLive([
      {
        ...failed,
        approvals: [
          {
            tool: "list_events",
            provider: "Google Calendar",
            decision: "read-only",
          },
        ],
      },
    ]);
    fireEvent.click(await screen.findByTestId("run-row"));
    expect(
      screen.getByText(
        "list_events on Google Calendar · read-only, ran without asking",
      ),
    ).toBeInTheDocument();
  });

  it("a failed run offers Run again and Open Providers", async () => {
    const { api, onOpenSettings } = setupLive([failed]);
    fireEvent.click(await screen.findByTestId("run-row"));
    fireEvent.click(screen.getByText("Run again"));
    await waitFor(() =>
      expect(api.run).toHaveBeenCalledWith("b1", "EVENT PROMPT", false),
    );
    fireEvent.click(screen.getByText("Open Providers"));
    expect(onOpenSettings).toHaveBeenCalledWith("providers");
  });

  it("an AI model error reads cleanly and offers Change AI model", async () => {
    const onChangeModel = jest.fn();
    setupLive(
      [
        {
          ...failed,
          error:
            '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
        },
      ],
      { onChangeModel },
    );
    const row = await screen.findByTestId("run-row");
    expect(row).toHaveTextContent(
      "Your credit balance is too low to access the Anthropic API.",
    );
    expect(row).not.toHaveTextContent("invalid_request_error");
    fireEvent.click(row);
    expect(screen.queryByText("Open Providers")).toBeNull();
    fireEvent.click(screen.getByText("Change AI model"));
    expect(onChangeModel).toHaveBeenCalled();
  });

  it("reloads when this bot's run finishes", async () => {
    const { api, listeners } = setupLive([]);
    await screen.findByText(/hasn.t run yet/);
    api.getRuns.mockResolvedValue([runs[0]]);
    await act(async () => {
      listeners.stream({ botId: "other", event: { type: "done" } });
    });
    expect(api.getRuns).toHaveBeenCalledTimes(1);
    await act(async () => {
      listeners.stream({ botId: "b1", event: { type: "done" } });
    });
    expect(await screen.findAllByTestId("run-row")).toHaveLength(1);
  });
});

describe("BotRunHistory — model and cost per run (CRE-012)", () => {
  test("the row shows the short cost; opening it shows model · tokens · cost", async () => {
    setup([
      {
        trigger: "manual",
        status: "completed",
        startedAt: "2026-10-11T09:00:00.000Z",
        output: "Done",
        model: "claude-sonnet-4-6",
        usage: { inputTokens: 12000, outputTokens: 2230 },
        cost: { usd: 0, includedInPlan: true, estimated: false },
      },
    ]);
    const row = await screen.findByTestId("run-row");
    expect(row).toHaveTextContent("14.2k tok");
    fireEvent.click(row);
    expect(screen.getByTestId("run-cost")).toHaveTextContent(
      "Sonnet · 14.2k tokens · included in your plan",
    );
  });
});

describe("BotRunHistory — compact, for the Bots dock (TEAM-015)", () => {
  it("each run on two lines: status and when, then trigger and what it said", async () => {
    window.mainApi = {
      bots: { getRuns: jest.fn().mockResolvedValue(runs) },
    };
    render(<BotRunHistory bot={bot} compact />);
    const rows = await screen.findAllByTestId("run-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].className).toMatch(/flex-col/);
    expect(rows[0]).toHaveTextContent(/Completed\s*·/);
    expect(rows[0]).toHaveTextContent(
      "Reply · Found 2 urgent emails from Acme.",
    );
    expect(rows[0]).not.toHaveTextContent("Second line");
  });
});

describe("BotRunHistory — retries (US-023)", () => {
  it("a run that needed more than one attempt says so in its details", async () => {
    setup([{ ...runs[0], attempts: 2 }]);
    const rows = await screen.findAllByTestId("run-row");
    fireEvent.click(rows[0]);
    expect(await screen.findByTestId("run-attempts")).toHaveTextContent(
      "Took 2 attempts",
    );
  });
});

// Lead-workspace release 5 (frames 15, 24): each run links to the
// conversation it came from.
test("a run its lead asked for opens that conversation; scheduled runs have no link", async () => {
  const opened = jest.fn();
  window.addEventListener("dash:open-workspace", opened);
  window.mainApi = {
    bots: {
      getRuns: jest.fn().mockResolvedValue([
        {
          trigger: "schedule",
          status: "completed",
          startedAt: "2026-10-01T09:00:00.000Z",
          output: "Nothing urgent.",
        },
        {
          trigger: "ask",
          via: "lead:lead7",
          conversationId: "q_42",
          status: "completed",
          startedAt: "2026-10-02T09:00:00.000Z",
          output: "2 need attention.",
        },
      ]),
    },
  };
  render(
    <BotRunHistory
      bot={bot}
      nameOf={(id) => (id === "lead7" ? "Kitchen Sink Lead" : id)}
    />,
  );
  const links = await screen.findAllByRole("button", {
    name: /^Open conversation/,
  });
  expect(links).toHaveLength(1);
  // Where it came from, on the row itself (frame 15).
  expect(screen.getByTestId("run-conversation-label")).toHaveTextContent(
    "Asked by Kitchen Sink Lead",
  );
  expect(links[0]).toHaveAccessibleName(
    "Open conversation — Asked by Kitchen Sink Lead",
  );
  fireEvent.click(links[0]);
  window.removeEventListener("dash:open-workspace", opened);
  expect(opened.mock.calls[0][0].detail).toEqual({
    key: "lead:lead7",
    recentId: "q_42",
  });
});

describe("RunDetails — warnings and why calls failed (issues PRD)", () => {
  const warned = {
    trigger: "manual",
    status: "completed",
    startedAt: "2026-11-11T07:36:00.000Z",
    output: "I couldn't check your email.",
    warnings: [
      {
        message:
          "Gmail (Claude connector) wasn't connected when the run started, so it answered without it.",
      },
    ],
    toolCalls: [],
  };
  const failed = {
    trigger: "schedule",
    status: "failed",
    startedAt: "2026-11-10T07:00:00.000Z",
    error: "Rate limited",
    toolCalls: [
      { tool: "search_threads", provider: "Gmail", ok: true },
      { tool: "get_thread", provider: "Gmail", ok: false },
    ],
    toolErrors: JSON.stringify([
      {
        call: 1,
        args: JSON.stringify({ id: "t-42" }),
        error: "Error: 429 — rate limited by Gmail, try again in a minute",
      },
    ]),
  };

  afterEach(() => {
    delete window.mainApi;
  });

  it("a run with a warning: the status says so and a box shows it", () => {
    expect(runStatusLabel(warned)).toBe("Completed · 1 warning");
    expect(runStatusLabel({ status: "completed" })).toBe("Completed");
    const run = jest.fn();
    window.mainApi = { bots: { run } };
    render(<RunDetails run={warned} bot={bot} />);
    const box = screen.getByTestId("run-warnings");
    expect(box).toHaveTextContent(
      "Gmail (Claude connector) wasn't connected when the run started",
    );
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(run).toHaveBeenCalledWith("b1", "", false);
  });

  it("a failed call says why, and what it was asked with", () => {
    render(<RunDetails run={failed} bot={bot} />);
    expect(screen.getByTestId("tool-call-error")).toHaveTextContent(
      "Error: 429 — rate limited by Gmail, try again in a minute",
    );
    expect(screen.getByTestId("tool-call-args")).toHaveTextContent(
      `Asked with {"id":"t-42"}`,
    );
    expect(screen.getAllByTestId("tool-call-error")).toHaveLength(1);
  });

  it("Fix with AI opens Ask AI with what went wrong", () => {
    const events = [];
    const keep = (e) => events.push(e);
    window.addEventListener("dash:open-workspace", keep);
    render(<RunDetails run={warned} bot={bot} />);
    fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
    window.removeEventListener("dash:open-workspace", keep);
    expect(events[0].detail.key).toBe("role:dashlead");
    // The error quoted, as data for the AI.
    expect(events[0].detail.draft).toBe(
      'Inbox Watch had a problem in a run. The error said: "Gmail (Claude connector) wasn\'t connected when the run started, so it answered without it". Help me fix it.',
    );
  });

  it("warnings sealed as a JSON string are read; one about a provider offers Check <provider>", () => {
    const sealed = {
      ...warned,
      warnings: JSON.stringify([
        {
          message: "Notes MCP wasn't available, so it answered without it.",
          provider: "Notes MCP",
        },
      ]),
    };
    expect(runStatusLabel(sealed)).toBe("Completed · 1 warning");
    expect(runWarningList(sealed)[0].provider).toBe("Notes MCP");
    expect(runWarningList({ warnings: "{bad" })).toEqual([]);
    const opened = jest.fn();
    window.addEventListener("dash:open-page", opened);
    render(<RunDetails run={sealed} bot={bot} />);
    expect(screen.getByTestId("run-warnings")).toHaveTextContent(
      "Notes MCP wasn't available",
    );
    fireEvent.click(screen.getByRole("button", { name: "Check Notes MCP" }));
    window.removeEventListener("dash:open-page", opened);
    expect(opened.mock.calls[0][0].detail).toEqual({
      page: "providers",
      providerName: "Notes MCP",
    });
  });

  it("toolErrors that aren't JSON are ignored", () => {
    expect(runToolErrors({ toolErrors: "{bad" })).toEqual({});
    expect(runToolErrors({})).toEqual({});
  });
});

describe("BotRunHistory — problems on the run row (issues PRD)", () => {
  it("shows the warning box and failed calls without opening the run, and the status as a pill", async () => {
    setup([
      {
        trigger: "schedule",
        status: "completed",
        startedAt: "2026-11-11T07:00:00.000Z",
        output: "Done.",
        warnings: JSON.stringify([
          { message: "Gmail wasn't available, so it answered without it." },
        ]),
        toolCalls: [{ tool: "get_thread", provider: "Gmail", ok: false }],
        toolErrors: JSON.stringify([
          { call: 0, args: "{}", error: "429 rate limited" },
        ]),
      },
    ]);
    const row = await screen.findByTestId("run-row");
    expect(row).toHaveAttribute("aria-expanded", "false");
    const pill = within(row).getByTestId("status-badge");
    expect(pill).toHaveTextContent("Completed · 1 warning");
    expect(pill).toHaveAttribute("data-state", "warning");
    expect(screen.getByTestId("run-warnings")).toHaveTextContent(
      "Gmail wasn't available",
    );
    expect(screen.getByTestId("run-failed-call")).toHaveTextContent(
      "get_thread · Gmail · failed",
    );
    expect(screen.getByTestId("tool-call-error")).toHaveTextContent(
      "429 rate limited",
    );
    // Opening it doesn't show them twice.
    fireEvent.click(row);
    expect(screen.getAllByTestId("run-warnings")).toHaveLength(1);
    expect(screen.getAllByTestId("tool-call-error")).toHaveLength(1);
  });
});
