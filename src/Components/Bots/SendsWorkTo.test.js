import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { SendsWorkTo } from "./SendsWorkTo";
import { sendToSave, sendsWorkTo, stopSendingSave } from "./checksView";

// "Sends its work to" on a bot's Settings tab (DASH-127, screen 7b).

const ev = (id, event) => `bot:local/${id}[${id}].${event}`;
const coder = {
  id: "c",
  name: "Coder",
  workspaceId: 1,
  checks: { steps: [{ id: "s1", kind: "you" }], handsOn: "answer" },
};
const reviewer = {
  id: "r",
  name: "Reviewer",
  workspaceId: 1,
  subscriptions: [{ eventType: ev("c", "completed") }],
};
const notify = { id: "n", name: "Notify", workspaceId: 1, subscriptions: [] };
const lead = { id: "l", name: "Lead", role: "lead", workspaceId: 1 };
const elsewhere = { id: "x", name: "Elsewhere", workspaceId: 2 };
const all = [coder, reviewer, notify, lead, elsewhere];

describe("sendsWorkTo helpers", () => {
  it("lists the team bots that run when it completes, and the rest of the team", () => {
    const { targets, choices } = sendsWorkTo(coder, all);
    expect(targets.map((t) => t.name)).toEqual(["Reviewer"]);
    // Not its lead, not another team's bot, not itself.
    expect(choices.map((c) => c.name)).toEqual(["Notify"]);
  });

  it("the same trigger as a line on the Diagram: on the other bot's Completed", () => {
    const add = sendToSave(notify, coder);
    expect(add.id).toBe("n");
    expect(add.subscriptions.map((s) => s.eventType)).toEqual([
      expect.stringMatching(/\[c\]\.completed$/),
    ]);
    expect(stopSendingSave(reviewer, ev("c", "completed"))).toEqual({
      id: "r",
      subscriptions: [],
    });
  });
});

describe("SendsWorkTo", () => {
  let save;
  beforeEach(() => {
    save = jest.fn(() => Promise.resolve({}));
    window.mainApi = {
      bots: { save, get: jest.fn((id) => all.find((b) => b.id === id)) },
    };
  });
  afterEach(() => {
    delete window.mainApi;
  });

  it("Remove stops sending to that bot, right away", async () => {
    const onChanged = jest.fn();
    render(<SendsWorkTo bot={coder} bots={all} onChanged={onChanged} />);
    const box = within(screen.getByTestId("sends-work-to"));
    expect(box.getByText("Reviewer")).toBeInTheDocument();
    fireEvent.click(
      box.getByRole("button", { name: "Stop sending to Reviewer" }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ id: "r", subscriptions: [] }),
    );
    await waitFor(() =>
      expect(
        box.queryByRole("button", { name: "Stop sending to Reviewer" }),
      ).toBeNull(),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("+ Send to another bot adds its trigger", async () => {
    render(<SendsWorkTo bot={coder} bots={all} />);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Send to another bot" }),
      { target: { value: "bot:n" } },
    );
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0].id).toBe("n");
    expect(await screen.findByText("Notify")).toBeInTheDocument();
  });

  it("what it sends: its whole answer or only the summary, in its checks", async () => {
    render(<SendsWorkTo bot={coder} bots={all} />);
    fireEvent.click(screen.getByRole("radio", { name: "Only the summary" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        id: "c",
        checks: { ...coder.checks, handsOn: "summary" },
      }),
    );
  });

  it("a save that fails says so", async () => {
    save.mockImplementation(() => Promise.reject(new Error("disk full")));
    render(<SendsWorkTo bot={coder} bots={all} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Stop sending to Reviewer" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
  });
});
