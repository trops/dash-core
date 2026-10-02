import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { BotRunHistory } from "./BotRunHistory";

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
