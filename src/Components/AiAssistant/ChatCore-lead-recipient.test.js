/**
 * ChatCore — message a team lead directly from the AI Assistant
 * (bot-teams TEAM-013). Renders ChatCore with a mocked mainApi and drives
 * the "To:" picker and the input.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { ChatCore } from "./ChatCore";

const DAILY = {
  botId: "lead_1",
  leadName: "Daily Brief Lead",
  dashboardId: "1",
  dashboardName: "Daily Brief",
  dashboardLabel: "Daily Brief",
  running: false,
  paused: false,
  overBudget: false,
};
const SALES = {
  ...DAILY,
  botId: "lead_2",
  leadName: "Sales Lead",
  dashboardId: "2",
  dashboardName: "Sales",
  dashboardLabel: "Sales",
  paused: true,
};

let streamCb;
function makeMainApi({
  leads = [DAILY, SALES],
  answer = "Two failures today.",
} = {}) {
  let next = 0;
  const llm = {
    sendMessage: jest.fn(),
    listConnectedTools: jest.fn(() => Promise.resolve([])),
    removeStreamListener: jest.fn(),
    abortRequest: jest.fn(),
    clearCliSession: jest.fn(),
    checkCliAvailable: jest.fn(() => Promise.resolve({ available: true })),
  };
  for (const name of [
    "onStreamDelta",
    "onStreamToolCall",
    "onStreamToolResult",
    "onStreamComplete",
    "onStreamError",
  ]) {
    llm[name] = jest.fn(() => `l${++next}`);
  }
  const bots = {
    listLeads: jest.fn(() => Promise.resolve(leads)),
    onListChanged: jest.fn(() => "lc"),
    onRunActive: jest.fn(() => "ra"),
    removeListener: jest.fn(),
    stop: jest.fn(),
    onStream: jest.fn((cb) => {
      streamCb = cb;
      return "s1";
    }),
    askLead: jest.fn(
      () =>
        new Promise((resolve) => {
          // Stream a chunk, then resolve with the final record.
          setTimeout(() => {
            act(() => {
              streamCb({
                botId: "lead_1",
                event: { type: "text", text: "Two " },
              });
            });
            resolve({ status: "completed", output: answer });
          }, 0);
        }),
    ),
  };
  return { llm, bots };
}

function renderChat(props = {}) {
  return render(
    <ChatCore
      backend="anthropic"
      apiKey="k"
      sessionKey={`t-${Math.random()}`}
      enableLeadRecipients
      {...props}
    />,
  );
}

const input = () => screen.getByPlaceholderText("Type a message...");
const send = (text) => {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: "Enter", code: "Enter" });
};
const pick = async (botId) => {
  const select = await screen.findByRole("combobox");
  await waitFor(() =>
    expect(select.querySelectorAll("option").length).toBeGreaterThan(1),
  );
  fireEvent.change(select, { target: { value: botId } });
};

beforeEach(() => {
  sessionStorage.clear();
});

describe("ChatCore — direct-to-lead (TEAM-013)", () => {
  test("lists the Assistant and each team lead with its dashboard and state", async () => {
    window.mainApi = makeMainApi();
    renderChat();
    const select = await screen.findByRole("combobox");
    await waitFor(() =>
      expect(
        screen.getByText("Daily Brief Lead · Daily Brief"),
      ).toBeInTheDocument(),
    );
    expect(select).toHaveValue("__assistant__");
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("Sales Lead · Sales — paused")).toBeInTheDocument();
  });

  test("sends straight to the lead, not the Assistant model, and shows its answer", async () => {
    const api = makeMainApi();
    window.mainApi = api;
    renderChat();
    await pick("lead_1");
    send("What failed today?");

    await waitFor(() =>
      expect(api.bots.askLead).toHaveBeenCalledWith(
        "lead_1",
        "What failed today?",
        false,
        "assistant",
      ),
    );
    expect(api.llm.sendMessage).not.toHaveBeenCalled();
    expect(
      screen.getByText("You → Daily Brief Lead · Daily Brief"),
    ).toBeInTheDocument();
    const bubble = await screen.findByTestId("lead-bubble");
    await waitFor(() =>
      expect(bubble).toHaveTextContent("Two failures today."),
    );
    expect(bubble).toHaveTextContent("Daily Brief Lead · Daily Brief");
  });

  test("a follow-up to the same lead continues its session", async () => {
    const api = makeMainApi();
    window.mainApi = api;
    renderChat();
    await pick("lead_1");
    send("What failed today?");
    await screen.findByText("Two failures today.");
    send("Any urgent?");
    await waitFor(() => expect(api.bots.askLead).toHaveBeenCalledTimes(2));
    expect(api.bots.askLead.mock.calls[1]).toEqual([
      "lead_1",
      "Any urgent?",
      true,
      "assistant",
    ]);
  });

  test("a paused lead is not run: a notice explains why and the text stays", async () => {
    const api = makeMainApi();
    window.mainApi = api;
    renderChat();
    await pick("lead_2");
    send("Status?");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sales Lead is paused — resume it in the Bots view.",
    );
    expect(api.bots.askLead).not.toHaveBeenCalled();
    expect(input()).toHaveValue("Status?");
  });

  test("back on the Assistant, the lead exchange is sent as labelled context", async () => {
    const api = makeMainApi();
    window.mainApi = api;
    renderChat();
    await pick("lead_1");
    send("What failed today?");
    await screen.findByText("Two failures today.");

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "__assistant__" },
    });
    send("Summarise what the lead said");
    await waitFor(() => expect(api.llm.sendMessage).toHaveBeenCalled());
    const payload = api.llm.sendMessage.mock.calls[0][1];
    const last = payload.messages[payload.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain(
      "Daily Brief Lead (Daily Brief) answered: Two failures today.",
    );
    expect(last.content).toContain("Summarise what the lead said");
  });

  test("without enableLeadRecipients there is no picker and no lead lookup", async () => {
    const api = makeMainApi();
    window.mainApi = api;
    renderChat({ enableLeadRecipients: false });
    await act(async () => {});
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(api.bots.listLeads).not.toHaveBeenCalled();
  });

  test("@ shortcut: '@dai' + Enter sets the To: picker to that lead (AC6)", async () => {
    const api = makeMainApi();
    window.mainApi = api;
    renderChat();
    const select = await screen.findByRole("combobox");
    await waitFor(() =>
      expect(select.querySelectorAll("option").length).toBeGreaterThan(1),
    );
    fireEvent.change(input(), { target: { value: "@dai" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Enter", code: "Enter" });
    expect(select).toHaveValue("lead_1");
    expect(input()).toHaveValue("");
    expect(api.bots.askLead).not.toHaveBeenCalled();
    expect(api.llm.sendMessage).not.toHaveBeenCalled();
  });

  test("with lead recipients off (widget chats), @ stays plain text", async () => {
    const api = makeMainApi();
    window.mainApi = api;
    renderChat({ enableLeadRecipients: false });
    fireEvent.change(input(), { target: { value: "@channel ship it" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
