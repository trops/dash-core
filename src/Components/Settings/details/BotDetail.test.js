import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
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
    expect(screen.getByLabelText("Provider")).toHaveValue("anthropic");
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
    expect(screen.getByLabelText("Provider")).toHaveValue("claude-code");
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
