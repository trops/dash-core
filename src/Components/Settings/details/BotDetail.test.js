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

  it("builds a definition (incl. schedule) and calls onSave", () => {
    const onSave = jest.fn().mockResolvedValue({ id: "bot_x" });
    render(
      <BotDetail
        isCreating
        providers={{}}
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
    fireEvent.change(
      screen.getByPlaceholderText(
        "Comma-separated server names, e.g. github, slack",
      ),
      {
        target: { value: "github, slack" },
      },
    );
    fireEvent.change(screen.getByPlaceholderText("Cron, e.g. 0 7 * * 1-5"), {
      target: { value: "0 7 * * 1-5" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Task prompt for the scheduled run"),
      {
        target: { value: "prepare digest" },
      },
    );
    fireEvent.click(screen.getByText("Create"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: "PR Digest",
      instructions: "Summarize PRs",
      provider: null,
      approvalPolicy: "ask",
      mcpServers: ["github", "slack"],
      schedules: [{ cron: "0 7 * * 1-5", prompt: "prepare digest" }],
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

  it("shows Save + Delete and preserves the id on save", () => {
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
    fireEvent.click(screen.getByText("Save"));
    const def = onSave.mock.calls[0][0];
    expect(def.id).toBe("bot_1");
    expect(def.mcpServers).toEqual(["github"]);
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
