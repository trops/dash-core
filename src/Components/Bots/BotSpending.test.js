/**
 * BotSpending — the bot page's Spending tab (NAV-016): the budget box, then
 * what each recent run cost, newest first.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

jest.mock("./BotBudgetSection", () => ({
  BotBudgetSection: () => <div>budget box</div>,
}));

import { BotSpending } from "./BotSpending";

afterEach(() => {
  delete window.mainApi;
});

it("lists recent runs with their cost, newest first", async () => {
  window.mainApi = {
    bots: {
      getRuns: jest.fn().mockResolvedValue([
        {
          startedAt: "2026-10-01T09:00:00Z",
          model: "claude-sonnet-4-6",
          usage: { inputTokens: 1000, outputTokens: 0 },
          cost: { usd: 0.01, includedInPlan: false, estimated: false },
        },
        {
          startedAt: "2026-10-02T09:00:00Z",
          model: "claude-sonnet-4-6",
          usage: { inputTokens: 2000, outputTokens: 0 },
          cost: { usd: 0.02, includedInPlan: false, estimated: false },
        },
      ]),
    },
  };
  render(<BotSpending bot={{ id: "b1" }} />);
  expect(screen.getByText("budget box")).toBeInTheDocument();
  const rows = await screen.findAllByTestId("bot-spending-run");
  expect(window.mainApi.bots.getRuns).toHaveBeenCalledWith("b1", 50);
  expect(rows[0]).toHaveTextContent("$0.02");
  expect(rows[1]).toHaveTextContent("$0.01");
});

it("says when there are no runs", async () => {
  window.mainApi = { bots: { getRuns: jest.fn().mockResolvedValue([]) } };
  render(<BotSpending bot={{ id: "b1" }} />);
  expect(await screen.findByText("No runs yet.")).toBeInTheDocument();
});
