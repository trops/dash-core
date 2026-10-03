import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { AskLead } from "./AskLead";

const lead = { id: "lead_7", name: "Kitchen Sink Lead", role: "lead" };

function setup(askImpl) {
  const listeners = {};
  const api = {
    askLead: jest.fn(askImpl),
    onStream: jest.fn((cb) => {
      listeners.stream = cb;
      return "s1";
    }),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots: api };
  render(<AskLead lead={lead} />);
  return { api, listeners };
}

const ask = (text) => {
  fireEvent.change(screen.getByPlaceholderText(/Ask the lead/), {
    target: { value: text },
  });
  fireEvent.click(screen.getByText("Ask"));
};

afterEach(() => {
  delete window.mainApi;
});

describe("AskLead", () => {
  it("asks the lead and shows its answer", async () => {
    const { api } = setup(async () => ({
      status: "completed",
      output: "Inbox Watch flagged 2 emails.",
    }));
    ask("Anything urgent?");
    expect(screen.getByText("Anything urgent?")).toBeInTheDocument();
    expect(
      await screen.findByText("Inbox Watch flagged 2 emails."),
    ).toBeInTheDocument();
    // First question starts a new conversation.
    expect(api.askLead).toHaveBeenCalledWith(
      "lead_7",
      "Anything urgent?",
      false,
    );
  });

  it("follow-ups continue the conversation; New conversation starts fresh", async () => {
    const { api } = setup(async () => ({ status: "completed", output: "ok" }));
    ask("First?");
    await screen.findByText("ok");
    ask("And then?");
    await waitFor(() => expect(api.askLead).toHaveBeenCalledTimes(2));
    expect(api.askLead.mock.calls[1]).toEqual(["lead_7", "And then?", true]);

    fireEvent.click(screen.getByText("New conversation"));
    expect(screen.queryByText("First?")).toBeNull();
    ask("Fresh?");
    await waitFor(() => expect(api.askLead).toHaveBeenCalledTimes(3));
    expect(api.askLead.mock.calls[2]).toEqual(["lead_7", "Fresh?", false]);
  });

  it("shows the lead's answer as it streams", async () => {
    let finish;
    const { listeners } = setup(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    ask("Status?");
    act(() => {
      listeners.stream({
        botId: "lead_7",
        event: { type: "text", text: "Working on " },
      });
      listeners.stream({
        botId: "other_bot",
        event: { type: "text", text: "NOT MINE" },
      });
      listeners.stream({
        botId: "lead_7",
        event: { type: "text", text: "it" },
      });
    });
    expect(screen.getByText("Working on it")).toBeInTheDocument();
    expect(screen.queryByText(/NOT MINE/)).toBeNull();
    await act(async () => finish({ status: "completed", output: "Done." }));
    expect(await screen.findByText("Done.")).toBeInTheDocument();
  });

  it("separates streamed text before and after a tool call", () => {
    const { listeners } = setup(() => new Promise(() => {}));
    ask("Status?");
    act(() => {
      const send = (event) => listeners.stream({ botId: "lead_7", event });
      send({ type: "text", text: "Checking." });
      send({ type: "tool_call", id: "t1", name: "team_list_bots" });
      send({ type: "text", text: "Done" });
    });
    expect(
      screen.getByText((_c, el) => el.textContent === "Checking.\n\nDone"),
    ).toBeInTheDocument();
  });

  it("shows a failure plainly", async () => {
    setup(async () => ({ status: "failed", error: "No model source" }));
    ask("Hello?");
    expect(await screen.findByText(/No model source/)).toBeInTheDocument();
  });

  it("shows answers as plain text (Markdown markers stripped, never HTML)", async () => {
    setup(async () => ({
      status: "completed",
      output:
        "## Team\nGo to **Dashboard Config › Bots** and use `Add bot`. <b>x</b>",
    }));
    ask("How do I add one?");
    expect(
      await screen.findByText(
        /Go to Dashboard Config › Bots and use Add bot\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).toBeNull();
    // Raw HTML stays text — it's never rendered.
    expect(screen.getByText(/<b>x<\/b>/)).toBeInTheDocument();
  });

  it("Ask is disabled for an empty question", () => {
    setup(async () => ({}));
    expect(screen.getByText("Ask")).toBeDisabled();
  });
});
