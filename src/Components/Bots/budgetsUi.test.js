/**
 * Budgets UI (bot-factory US-019 slice B): the wording, the budget field,
 * the bot form's Monthly budget and the Team budget window.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  budgetStateLabel,
  limitLine,
  monthName,
  providerName,
  spentLine,
} from "./spendingText";
import { BudgetField } from "./BudgetField";
import { BotBudgetSection } from "./BotBudgetSection";
import { TeamBudgetDialog } from "./TeamBudgetDialog";

const summary = {
  month: "2026-10",
  overall: { usd: 6, tokens: 30000, planTokens: 0, budget: 50, state: "ok" },
  bots: [
    {
      id: "a",
      name: "Inbox Sorter",
      workspaceId: "7",
      usd: 4.5,
      tokens: 14200,
      planTokens: 0,
      budget: 5,
      state: "warn",
      over: false,
    },
    {
      id: "b",
      name: "Digest",
      workspaceId: "7",
      usd: 0,
      tokens: 15700,
      planTokens: 15700,
      budget: null,
      state: "ok",
      over: false,
    },
  ],
  dashboards: [
    {
      id: "7",
      name: "Morning Brief",
      usd: 4.5,
      tokens: 29900,
      planTokens: 15700,
      budget: null,
      state: "ok",
    },
  ],
  providers: [],
};

function mockApi(over = {}) {
  const api = {
    spendingSummary: jest.fn().mockResolvedValue(summary),
    setBudget: jest.fn().mockResolvedValue(5),
    resumeBudget: jest.fn().mockResolvedValue(true),
    onStream: jest.fn(() => 1),
    onBudgetAlert: jest.fn(() => 2),
    onListChanged: jest.fn(() => 3),
    removeListener: jest.fn(),
    ...over,
  };
  window.mainApi = { bots: api };
  return api;
}
afterEach(() => {
  delete window.mainApi;
});

describe("spendingText", () => {
  test("dollars and tokens; Claude plan runs as tokens; nothing yet", () => {
    expect(spentLine(summary.bots[0])).toBe("$4.50 · 14.2k tokens");
    expect(spentLine(summary.bots[1])).toBe(
      "15.7k tokens · covered by your Claude plan",
    );
    expect(spentLine({ usd: 0, tokens: 0 })).toBe("Nothing yet this month");
    expect(spentLine(null)).toBe("Nothing yet this month");
  });
  test("state words, limits, providers, month", () => {
    expect(budgetStateLabel({ state: "warn" })).toBe("80% of budget");
    expect(budgetStateLabel({ state: "exceeded" })).toBe("Over budget");
    expect(budgetStateLabel({ state: "ok", over: true })).toBe("Over budget");
    expect(budgetStateLabel({ state: "ok" })).toBeNull();
    expect(limitLine({ budget: 5 })).toBe("of $5.00 a month");
    expect(limitLine({ budget: null })).toBe("No limit");
    expect(providerName("claude-code")).toBe("Claude Code");
    expect(providerName("anthropic")).toBe("Anthropic API");
    expect(monthName("2026-10")).toMatch(/October/);
  });
});

describe("BudgetField", () => {
  test("Set limit saves a dollar amount; Remove limit clears it", async () => {
    const onSave = jest.fn().mockResolvedValue();
    const { rerender } = render(
      <BudgetField label="Limit" budget={null} onSave={onSave} />,
    );
    const btn = screen.getByRole("button", { name: "Set limit" });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("No limit"), {
      target: { value: "12.50" },
    });
    fireEvent.click(btn);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(12.5));
    expect(
      await screen.findByText("Saved — $12.50 a month."),
    ).toBeInTheDocument();
    rerender(<BudgetField label="Limit" budget={12.5} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove limit" }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(null));
  });
  test("a non-amount says how to write it and can't be saved", () => {
    render(<BudgetField label="Limit" budget={null} onSave={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("No limit"), {
      target: { value: "lots" },
    });
    expect(
      screen.getByText("Enter an amount in dollars, like 5 or 12.50."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set limit" })).toBeDisabled();
  });
});

describe("BotBudgetSection", () => {
  test("shows this month and the limit; Set limit saves for this bot", async () => {
    const api = mockApi();
    render(<BotBudgetSection bot={{ id: "a", name: "Inbox Sorter" }} />);
    await waitFor(() =>
      expect(screen.getByTestId("bot-budget-spent")).toHaveTextContent(
        "This month: $4.50 · 14.2k tokens · limit $5.00",
      ),
    );
    // The loaded limit fills the box first — typing before it lands would be
    // overwritten (the test was flaky under load).
    const input = screen.getByPlaceholderText("No limit");
    await waitFor(() => expect(input).toHaveValue("5"));
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Set limit" }));
    await waitFor(() =>
      expect(api.setBudget).toHaveBeenCalledWith("bot", "a", 8),
    );
  });
  test("over budget: Keep running this month", async () => {
    const api = mockApi({
      spendingSummary: jest.fn().mockResolvedValue({
        ...summary,
        bots: [{ ...summary.bots[0], over: true, state: "exceeded" }],
      }),
    });
    render(<BotBudgetSection bot={{ id: "a" }} />);
    expect(await screen.findByTestId("bot-budget-over")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep running this month" }),
    );
    await waitFor(() => expect(api.resumeBudget).toHaveBeenCalledWith("a"));
  });
});

describe("TeamBudgetDialog", () => {
  test("the team's spending, its limit, and each bot", async () => {
    const api = mockApi();
    render(
      <TeamBudgetDialog
        open
        workspace={{ id: 7, name: "Morning Brief" }}
        onClose={jest.fn()}
      />,
    );
    expect(await screen.findByTestId("team-budget-spent")).toHaveTextContent(
      "This month: $4.50 · 29.9k tokens",
    );
    expect(screen.getByText("Team budget — Morning Brief")).toBeInTheDocument();
    expect(
      screen.getByText(/\$4\.50 · 14\.2k tokens · 80% of budget/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("No limit"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set limit" }));
    await waitFor(() =>
      expect(api.setBudget).toHaveBeenCalledWith("workspace", "7", 20),
    );
  });
});
