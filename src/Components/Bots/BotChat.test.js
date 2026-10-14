import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { BotChat } from "./BotChat";

const bot = { id: "b1", name: "Inbox Watch" };
const lead = { id: "lead_7", name: "Kitchen Lead", role: "lead" };

const runs = [
  {
    trigger: "manual",
    status: "completed",
    prompt: "Check my inbox",
    output: "2 need attention",
    toolCalls: [{ tool: "search_emails", provider: "Gmail New", ok: true }],
    continued: false,
  },
];

function setup({ history = runs, approvals = [], onApprove = jest.fn() } = {}) {
  const listeners = {};
  const api = {
    getRuns: jest.fn().mockResolvedValue(history),
    run: jest.fn().mockResolvedValue({ status: "completed", output: "ok" }),
    askLead: jest.fn().mockResolvedValue({ status: "completed", output: "ok" }),
    onStream: jest.fn((cb) => ((listeners.stream = cb), "s1")),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots: api };
  const utils = render(
    <BotChat bot={bot} approvals={approvals} onApprove={onApprove} />,
  );
  return { api, listeners, onApprove, ...utils };
}

const composer = () => screen.getByLabelText("Message");

afterEach(() => {
  delete window.mainApi;
});

describe("BotChat — history", () => {
  it("shows the conversation from run history", async () => {
    setup();
    expect(await screen.findByText("Check my inbox")).toBeInTheDocument();
    expect(screen.getByText("2 need attention")).toBeInTheDocument();
    expect(screen.getByText(/search_emails/)).toBeInTheDocument();
    expect(screen.getByText(/Gmail New/)).toBeInTheDocument();
  });

  it("shows answers as plain text, never HTML", async () => {
    const { container } = setup({
      history: [
        {
          ...runs[0],
          output: 'Look: **bold** <img src="x" onerror="window.__x=1">',
        },
      ],
    });
    await screen.findByText(/Look: bold/);
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows errors and unreadable answers", async () => {
    setup({
      history: [
        { ...runs[0], status: "failed", error: "Token expired", output: "" },
        { ...runs[0], output: null, outputUnavailable: true, continued: true },
      ],
    });
    expect(await screen.findByText("Token expired")).toBeInTheDocument();
    expect(screen.getByText(/answer unavailable/i)).toBeInTheDocument();
  });

  it("empty state invites the first message", async () => {
    setup({ history: [] });
    expect(await screen.findByText(/No conversation yet/)).toBeInTheDocument();
  });
});

describe("BotChat — sending", () => {
  it("Enter sends a reply that continues the conversation", async () => {
    const { api } = setup();
    await screen.findByText("Check my inbox");
    fireEvent.change(composer(), { target: { value: "And yesterday?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() =>
      expect(api.run).toHaveBeenCalledWith("b1", "And yesterday?", true),
    );
  });

  it("Shift+Enter does not send", async () => {
    const { api } = setup();
    await screen.findByText("Check my inbox");
    fireEvent.change(composer(), { target: { value: "line one" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(api.run).not.toHaveBeenCalled();
  });

  it("the first message starts a new conversation", async () => {
    const { api } = setup({ history: [] });
    await screen.findByText(/No conversation yet/);
    fireEvent.change(composer(), { target: { value: "Hi" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() =>
      expect(api.run).toHaveBeenCalledWith("b1", "Hi", false),
    );
  });

  it("New conversation makes the next message start fresh", async () => {
    const { api } = setup();
    await screen.findByText("Check my inbox");
    fireEvent.click(screen.getByText("New conversation"));
    fireEvent.change(composer(), { target: { value: "Fresh" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() =>
      expect(api.run).toHaveBeenCalledWith("b1", "Fresh", false),
    );
  });

  it("a team lead is asked (Ask), not run", async () => {
    const api = {
      getRuns: jest.fn().mockResolvedValue([]),
      askLead: jest
        .fn()
        .mockResolvedValue({ status: "completed", output: "x" }),
      run: jest.fn(),
      onStream: jest.fn(() => "s1"),
      removeListener: jest.fn(),
    };
    window.mainApi = { bots: api };
    render(<BotChat bot={lead} isLead approvals={[]} />);
    await screen.findByText(/No conversation yet/);
    fireEvent.change(composer(), { target: { value: "Anything urgent?" } });
    fireEvent.click(screen.getByText("Ask"));
    await waitFor(() =>
      expect(api.askLead).toHaveBeenCalledWith(
        "lead_7",
        "Anything urgent?",
        false,
      ),
    );
    expect(api.run).not.toHaveBeenCalled();
  });

  it("streams the answer while the bot works, then reloads history", async () => {
    let finish;
    const { api, listeners } = setup();
    api.run.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    await screen.findByText("Check my inbox");
    fireEvent.change(composer(), { target: { value: "More?" } });
    fireEvent.click(screen.getByText("Send"));
    act(() => {
      listeners.stream({ botId: "b1", event: { type: "text", text: "Work" } });
      listeners.stream({ botId: "x", event: { type: "text", text: "NOPE" } });
      listeners.stream({ botId: "b1", event: { type: "text", text: "ing" } });
    });
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.queryByText(/NOPE/)).toBeNull();
    api.getRuns.mockResolvedValue([
      ...runs,
      { ...runs[0], prompt: "More?", output: "Done", continued: true },
    ]);
    await act(async () => finish({ status: "completed", output: "Done" }));
    expect(await screen.findByText("Done")).toBeInTheDocument();
  });

  it("a run started elsewhere streams in as its own run (Running now)", async () => {
    const { listeners } = setup();
    expect(await screen.findByText("2 need attention")).toBeInTheDocument();
    act(() => {
      listeners.stream({ botId: "b1", event: { type: "text", text: "Hi" } });
    });
    expect(screen.getByText("Running now")).toBeInTheDocument();
    // The divider (there's also a New conversation button).
    expect(
      screen
        .getAllByText("New conversation")
        .some((el) => el.tagName !== "BUTTON"),
    ).toBe(true);
  });

  it("separates streamed text before and after a tool call", async () => {
    const { api, listeners } = setup();
    api.run.mockImplementation(() => new Promise(() => {}));
    await screen.findByText("Check my inbox");
    fireEvent.change(composer(), { target: { value: "More?" } });
    fireEvent.click(screen.getByText("Send"));
    act(() => {
      const send = (event) => listeners.stream({ botId: "b1", event });
      send({ type: "text", text: "Checking." });
      send({ type: "tool_call", id: "t1", name: "search_emails" });
      send({ type: "tool_result", id: "t1" });
      send({ type: "text", text: "Done" });
    });
    const bubbles = screen.getAllByTestId("answer-bubble");
    expect(bubbles[bubbles.length - 1].textContent).toContain(
      "Checking.\n\nDone",
    );
  });
});

describe("BotChat — approvals inline", () => {
  const approval = {
    id: "a1",
    request: { botId: "b1", serverName: "Slack", toolName: "send_message" },
  };

  it("shows the bot's pending approval with Allow once / Always allow / Deny", async () => {
    const { onApprove } = setup({ approvals: [approval] });
    expect(await screen.findByText(/Needs your approval/)).toBeInTheDocument();
    expect(screen.getByText(/send_message/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Always allow"));
    expect(onApprove).toHaveBeenCalledWith("a1", {
      allow: true,
      remember: true,
    });
    fireEvent.click(screen.getByText("Deny"));
    expect(onApprove).toHaveBeenCalledWith("a1", { allow: false });
  });

  it("built-in tools can't be remembered (no Always allow)", async () => {
    setup({
      approvals: [{ id: "a2", request: { botId: "b1", toolName: "Bash" } }],
    });
    await screen.findByText(/Needs your approval/);
    expect(screen.queryByText("Always allow")).toBeNull();
    expect(screen.getByText("Allow once")).toBeInTheDocument();
  });
});

describe("BotChat — triggers and next steps (TEAM-011 gaps)", () => {
  function setupWith(history, props = {}) {
    const api = {
      getRuns: jest.fn().mockResolvedValue(history),
      run: jest.fn().mockResolvedValue({ status: "completed" }),
      askLead: jest.fn().mockResolvedValue({ status: "completed" }),
      onStream: jest.fn(() => "s1"),
      removeListener: jest.fn(),
    };
    window.mainApi = { bots: api };
    const onOpenSettings = jest.fn();
    render(
      <BotChat
        bot={bot}
        approvals={[]}
        onOpenSettings={onOpenSettings}
        nameOf={(id) => ({ b0: "Lead Scout", b9: "Inbox Watch" })[id] || id}
        {...props}
      />,
    );
    return { api, onOpenSettings };
  }

  it("shows what triggered an event run, with bot names in the chain", async () => {
    setupWith([
      {
        trigger: "event",
        status: "completed",
        output: "done",
        source: {
          eventType: "bot:local/inbox[b9].completed",
          label: "Inbox Watch › completed",
          chain: ["b0", "b9"],
        },
      },
    ]);
    expect(
      await screen.findByText(
        "Started after Inbox Watch completed · Lead Scout → Inbox Watch",
      ),
    ).toBeInTheDocument();
  });

  it("only the latest failure offers Run again; an earlier one is marked as earlier", async () => {
    setupWith([
      { trigger: "manual", status: "failed", error: "First", prompt: "a" },
      { trigger: "manual", status: "failed", error: "Second", prompt: "b" },
    ]);
    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.getAllByText("Run again")).toHaveLength(1);
    expect(screen.getByText(/Earlier run failed/)).toBeInTheDocument();
  });

  it("a finished run's unanswered tool call says it didn't finish (no spinner)", async () => {
    setupWith([
      {
        trigger: "manual",
        status: "failed",
        error: "boom",
        prompt: "a",
        toolCalls: [{ tool: "search_index", ok: null }],
      },
    ]);
    expect(await screen.findByText(/didn't finish/)).toBeInTheDocument();
  });

  it("a failed run offers Run again (same prompt, fresh run)", async () => {
    const { api } = setupWith([
      {
        trigger: "manual",
        status: "failed",
        error: "Something odd",
        prompt: "Check inbox",
      },
    ]);
    fireEvent.click(await screen.findByText("Run again"));
    await waitFor(() =>
      expect(api.run).toHaveBeenCalledWith("b1", "Check inbox", false),
    );
    expect(screen.queryByText("Open Settings › Providers")).toBeNull();
  });

  it("a provider problem also offers Open Settings › Providers", async () => {
    const { onOpenSettings } = setupWith([
      {
        trigger: "manual",
        status: "failed",
        error: "Slack couldn't start: Authentication required.",
        prompt: "x",
      },
    ]);
    fireEvent.click(await screen.findByText("Open Settings › Providers"));
    expect(onOpenSettings).toHaveBeenCalledWith("providers");
  });

  it("an AI model problem shows the readable message and offers Change AI model", async () => {
    const onChangeModel = jest.fn();
    setupWith(
      [
        {
          trigger: "manual",
          status: "failed",
          error:
            '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
          prompt: "x",
        },
      ],
      { onChangeModel },
    );
    expect(
      await screen.findByText(
        "Your credit balance is too low to access the Anthropic API.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Open Settings › Providers")).toBeNull();
    fireEvent.click(screen.getByText("Change AI model"));
    expect(onChangeModel).toHaveBeenCalled();
  });

  it("a lead's failed answer offers Ask again", async () => {
    const { api } = setupWith(
      [
        {
          trigger: "ask",
          status: "failed",
          error: "oops",
          prompt: "Anything urgent?",
        },
      ],
      { bot: lead, isLead: true },
    );
    fireEvent.click(await screen.findByText("Ask again"));
    await waitFor(() =>
      expect(api.askLead).toHaveBeenCalledWith(
        "lead_7",
        "Anything urgent?",
        false,
      ),
    );
  });
});

describe("BotChat — Review draft under the lead's answer (5b)", () => {
  const run = {
    trigger: "ask",
    status: "completed",
    prompt: "Add a Gmail digest bot",
    output: "I drafted Morning Digest.",
    startedAt: "2026-10-03T10:00:00.000Z",
    endedAt: "2026-10-03T10:00:20.000Z",
    continued: false,
  };
  const during = {
    id: "d1",
    leadId: "lead_7",
    createdAt: "2026-10-03T10:00:12.000Z",
    definition: { name: "Morning Digest" },
  };
  const other = {
    ...during,
    id: "d2",
    createdAt: "2026-10-01T09:00:00.000Z",
    definition: { name: "Old" },
  };

  function setupLead(drafts) {
    window.mainApi = {
      bots: {
        getRuns: jest.fn().mockResolvedValue([run]),
        askLead: jest.fn(),
        onStream: jest.fn(() => "s1"),
        removeListener: jest.fn(),
      },
    };
    const onOpenDraft = jest.fn();
    render(
      <BotChat
        bot={lead}
        isLead
        approvals={[]}
        drafts={drafts}
        onOpenDraft={onOpenDraft}
      />,
    );
    return onOpenDraft;
  }

  it("shows Review draft under the answer that drafted it, and opens it", async () => {
    const onOpenDraft = setupLead([during, other]);
    const btn = await screen.findByText("Review draft: Morning Digest");
    expect(btn.closest('[data-testid="answer-bubble"]')).not.toBeNull();
    expect(screen.queryByText("Review draft: Old")).toBeNull();
    fireEvent.click(btn);
    expect(onOpenDraft).toHaveBeenCalledWith("d1");
  });

  it("no button once the draft is saved or discarded", async () => {
    setupLead([]);
    await screen.findByText("I drafted Morning Digest.");
    expect(screen.queryByText(/Review draft/)).toBeNull();
  });
});

describe("BotChat — answers in a chat bubble", () => {
  const bubbleOf = (text) =>
    screen.getByText(text).closest('[data-testid="answer-bubble"]');

  it("puts the bot's answer in a bubble with its name above", async () => {
    setup();
    await screen.findByText("2 need attention");
    const b = bubbleOf("2 need attention");
    expect(b).not.toBeNull();
    expect(b.parentElement).toHaveTextContent("Inbox Watch");
  });

  it("your own message is not an answer bubble", async () => {
    setup();
    await screen.findByText("Check my inbox");
    expect(bubbleOf("Check my inbox")).toBeNull();
  });

  it("'Working…' shows inside the bubble while the bot runs", async () => {
    const { api } = setup();
    api.run.mockImplementation(() => new Promise(() => {}));
    await screen.findByText("Check my inbox");
    fireEvent.change(composer(), { target: { value: "More?" } });
    fireEvent.click(screen.getByText("Send"));
    expect(bubbleOf("Working…")).not.toBeNull();
  });
});

describe("BotChat — a message that doesn't run is kept (TEAM-015)", () => {
  it("a busy bot: the message goes back in the box, with why", async () => {
    const { api } = setup();
    api.run.mockResolvedValue({
      botId: "b1",
      skipped: true,
      reason: "a run is already in progress",
    });
    await screen.findByText("Check my inbox");
    fireEvent.change(composer(), { target: { value: "Again please" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByTestId("bot-chat-notice")).toHaveTextContent(
      "Inbox Watch is busy with another run — send again when it finishes.",
    );
    expect(composer()).toHaveValue("Again please");
  });

  it("a paused bot says so, offers Resume, and the box waits", async () => {
    window.mainApi = {
      bots: {
        getRuns: jest.fn().mockResolvedValue(runs),
        run: jest.fn(),
        onStream: jest.fn(() => "s1"),
        removeListener: jest.fn(),
      },
    };
    const onResume = jest.fn();
    render(<BotChat bot={bot} paused onResume={onResume} />);
    await screen.findByText("Check my inbox");
    expect(screen.getByTestId("bot-chat-paused")).toHaveTextContent(
      "Paused — it won't answer until you resume it.",
    );
    expect(composer()).toBeDisabled();
    expect(composer()).toHaveAttribute(
      "placeholder",
      "Resume Inbox Watch to message it",
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalled();
    expect(window.mainApi.bots.run).not.toHaveBeenCalled();
  });
});

describe("BotChat — the shared chat (TEAM-015 AC8)", () => {
  it("the reply is labelled with the bot and its model · tokens", async () => {
    setup({
      history: [
        {
          ...runs[0],
          model: "claude-sonnet-4-6",
          usage: { inputTokens: 1500, outputTokens: 600 },
        },
      ],
    });
    const reply = (await screen.findByText("2 need attention")).closest(
      '[data-testid="answer-bubble"]',
    );
    expect(reply).toHaveTextContent("Inbox Watch");
    expect(reply).toHaveTextContent(/2\.1k tokens/);
  });

  it("run labels and breaks are centered dividers", async () => {
    setup({ history: [{ ...runs[0], trigger: "schedule", prompt: "" }] });
    await screen.findByText("2 need attention");
    const notes = screen.getAllByRole("separator");
    expect(notes.some((n) => /Scheduled run/.test(n.textContent))).toBe(true);
  });

  it("while the bot answers, Send becomes Stop", async () => {
    const { api } = setup();
    api.stop = jest.fn();
    api.run.mockImplementation(() => new Promise(() => {}));
    await screen.findByText("Check my inbox");
    fireEvent.change(composer(), { target: { value: "More?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(api.stop).toHaveBeenCalledWith("b1");
  });
});

describe("BotChat — over budget (US-019)", () => {
  it("says which limit, offers Keep running this month, and the box waits", async () => {
    window.mainApi = {
      bots: {
        getRuns: jest.fn().mockResolvedValue(runs),
        run: jest.fn(),
        onStream: jest.fn(() => "s1"),
        removeListener: jest.fn(),
      },
    };
    const onKeepRunning = jest.fn();
    render(
      <BotChat
        bot={bot}
        overBudget="its $5.00 monthly budget"
        onKeepRunning={onKeepRunning}
      />,
    );
    await screen.findByText("Check my inbox");
    expect(screen.getByTestId("bot-chat-over-budget")).toHaveTextContent(
      "Over its $5.00 monthly budget — it won't run until you keep it running this month or raise the budget.",
    );
    expect(composer()).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep running this month" }),
    );
    expect(onKeepRunning).toHaveBeenCalled();
    expect(window.mainApi.bots.run).not.toHaveBeenCalled();
  });

  it("a run skipped for budget keeps the message and says so", async () => {
    const { api } = setup();
    api.run.mockResolvedValue({
      skipped: true,
      reason: "this bot is over its budget",
    });
    await screen.findByText("Check my inbox");
    fireEvent.change(composer(), { target: { value: "Go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByTestId("bot-chat-notice")).toHaveTextContent(
      "Inbox Watch is over its budget — keep it running this month, then send again.",
    );
    expect(composer()).toHaveValue("Go");
  });
});
