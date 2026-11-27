import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { BotDetail } from "./BotDetail";

// The bot's Settings tab as accordion sections (DASH-127, screen 7b).

const coder = {
  id: "c",
  name: "Coder",
  instructions: "Make the change.",
  workspaceId: 1,
};
const reviewer = {
  id: "r",
  name: "Reviewer",
  workspaceId: 1,
  subscriptions: [{ eventType: "bot:local/c[c].completed" }],
};

const head = (title) =>
  screen.getByRole("button", { name: new RegExp(`^${title}`) });

describe("BotDetail sections", () => {
  it("a saved bot: its sections in order, all closed", () => {
    render(
      <BotDetail bot={coder} bots={[coder, reviewer]} onSave={jest.fn()} />,
    );
    expect(
      screen
        .getAllByTestId(/^settings-section-[a-z]+$/)
        .map((s) => s.dataset.testid),
    ).toEqual([
      "settings-section-instructions",
      "settings-section-access",
      "settings-section-sends",
      "settings-section-budget",
      "settings-section-job",
    ]);
    for (const t of [
      "Instructions, model and engine",
      "Approval policy, folders and shell commands",
      "Sends its work to",
      "Budget and schedule",
    ]) {
      expect(head(t)).toHaveAttribute("aria-expanded", "false");
    }
    // Where its work goes is listed in its own section.
    const sends = within(screen.getByTestId("settings-section-sends"));
    expect(sends.getByText("Reviewer")).toBeInTheDocument();
  });

  it("each opens in place, and more than one can be open", () => {
    render(<BotDetail bot={coder} bots={[coder]} onSave={jest.fn()} />);
    fireEvent.click(head("Sends its work to"));
    fireEvent.click(head("Budget and schedule"));
    expect(head("Sends its work to")).toHaveAttribute("aria-expanded", "true");
    expect(head("Budget and schedule")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    fireEvent.click(head("Sends its work to"));
    expect(head("Sends its work to")).toHaveAttribute("aria-expanded", "false");
  });

  it("starts with the one that has something to fill in open", () => {
    render(
      <BotDetail
        bot={{
          ...coder,
          settings: [
            { name: "repo", label: "Repo", type: "text", required: true },
          ],
          settingValues: {},
        }}
        bots={[coder]}
        onSave={jest.fn()}
      />,
    );
    expect(head("Settings for its job")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(head("Instructions, model and engine")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("a new bot opens Instructions, and has no Sends its work to yet", () => {
    render(<BotDetail isCreating providers={{}} onSave={jest.fn()} />);
    expect(head("Instructions, model and engine")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.queryByTestId("settings-section-sends")).toBeNull();
  });

  it("the edit panel's one-section tabs stay flat", () => {
    render(
      <BotDetail
        bot={coder}
        bots={[coder]}
        section="access"
        stageChanges
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByTestId(/^settings-section-/)).toBeNull();
  });
});
