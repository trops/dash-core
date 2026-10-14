/**
 * SpendingView — Manage › Bots › Spending (bot-factory US-019 AC5).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SpendingView } from "./SpendingView";

const summary = {
  month: "2026-10",
  overall: {
    usd: 6,
    tokens: 30000,
    planTokens: 0,
    budget: 5,
    state: "exceeded",
  },
  bots: [
    {
      id: "a",
      name: "Inbox Sorter",
      usd: 6,
      tokens: 14200,
      planTokens: 0,
      budget: null,
      state: "ok",
    },
  ],
  dashboards: [],
  providers: [
    {
      id: "claude-code",
      usd: 0,
      tokens: 15700,
      planTokens: 15700,
      budget: null,
      state: "ok",
    },
  ],
};

afterEach(() => {
  delete window.mainApi;
});

test("overall against its limit, by bot / dashboard / provider, and the overall limit", async () => {
  const setBudget = jest.fn().mockResolvedValue(10);
  window.mainApi = {
    bots: {
      spendingSummary: jest.fn().mockResolvedValue(summary),
      setBudget,
      onStream: jest.fn(() => 1),
      removeListener: jest.fn(),
    },
  };
  render(<SpendingView />);
  expect(await screen.findByTestId("spending-overall-line")).toHaveTextContent(
    "$6.00 · 30.0k tokens · of $5.00 a month",
  );
  expect(screen.getByTestId("spending-overall")).toHaveTextContent(
    "Over budget",
  );
  expect(screen.getByTestId("spending-bots")).toHaveTextContent("Inbox Sorter");
  expect(screen.getByTestId("spending-dashboards")).toHaveTextContent(
    "No dashboard spending or limits yet.",
  );
  expect(screen.getByTestId("spending-providers")).toHaveTextContent(
    "Claude Code15.7k tokens · covered by your Claude plan · No limit",
  );
  fireEvent.change(screen.getByPlaceholderText("No limit"), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Set limit" }));
  await waitFor(() =>
    expect(setBudget).toHaveBeenCalledWith("global", null, 10),
  );
});
