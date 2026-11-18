import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { BotChecksModal } from "./BotChecksModal";

// "<Bot>'s checks" (bot-checks PRD CHK-002, frame 2).

const ev = (id, event) => `bot:local/${id}[${id}].${event}`;
const writer = {
  id: "w",
  name: "Writer",
  workspaceId: 1,
  checks: {
    steps: [
      {
        id: "step_c1",
        kind: "check",
        name: "No bananas",
        check: {
          kind: "rules",
          rules: [{ type: "banned", field: "input.answer", words: ["banana"] }],
        },
      },
      { id: "step_c2", kind: "you", name: "You approve" },
    ],
    onFail: "retry",
    maxTries: 3,
    handsOn: "answer",
  },
};
const sender = {
  id: "s",
  name: "Sender",
  subscriptions: [{ eventType: ev("w", "completed") }],
};
const editor = { id: "e", name: "Editor", subscriptions: [] };

function open(props = {}) {
  const onSave = jest.fn(() => Promise.resolve());
  const onClose = jest.fn();
  render(
    <BotChecksModal
      bot={writer}
      members={[writer, sender, editor]}
      widgets={[]}
      wEdges={[]}
      onSave={onSave}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSave, onClose };
}

const rows = () => screen.getAllByTestId(/^check-row-/);
const panel = () => within(screen.getByTestId("selected-check"));

describe("BotChecksModal", () => {
  it("shows the bot's run, then its checks in order, the first selected", () => {
    open();
    expect(screen.getByText("Writer's checks")).toBeInTheDocument();
    expect(screen.getByText("Writer runs")).toBeInTheDocument();
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining("No bananas"),
      expect.stringContaining("You approve"),
    ]);
    expect(panel().getByLabelText("Name")).toHaveValue("No bananas");
    // Its banned-words rule, from the shared check editor.
    expect(panel().getByText("From your list: 1 word")).toBeInTheDocument();
  });

  it("Save sends the edited checks", async () => {
    const { onSave } = open();
    fireEvent.change(panel().getByLabelText("Name"), {
      target: { value: "No fruit" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "It comes to you" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const { checks, adds, removes } = onSave.mock.calls[0][0];
    expect(checks.steps[0].name).toBe("No fruit");
    expect(checks.onFail).toBe("you");
    expect(adds).toEqual([]);
    expect(removes).toEqual([]);
  });

  it("+ adds a check where it is; Move up reorders", async () => {
    const { onSave } = open();
    fireEvent.click(
      screen.getByRole("button", { name: "Add a check here (2)" }),
    );
    fireEvent.click(
      within(screen.getByTestId("add-menu-1")).getByRole("button", {
        name: "A command or test",
      }),
    );
    expect(rows()).toHaveLength(3);
    expect(rows()[1]).toHaveTextContent("A command passes");
    fireEvent.change(panel().getByLabelText("Command"), {
      target: { value: "npm test" },
    });
    fireEvent.click(panel().getByRole("button", { name: "Move up" }));
    expect(rows()[0]).toHaveTextContent("npm test");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].checks.steps.map((s) => s.name)).toEqual([
      "A command passes",
      "No bananas",
      "You approve",
    ]);
  });

  it("drag a check onto another to move it", () => {
    open();
    fireEvent.dragStart(rows()[1]);
    fireEvent.dragOver(rows()[0]);
    fireEvent.drop(rows()[0]);
    expect(rows()[0]).toHaveTextContent("You approve");
  });

  it("a reviewer needs a bot, and not itself; it says so instead of saving", async () => {
    const { onSave } = open();
    fireEvent.change(panel().getByLabelText("Kind"), {
      target: { value: "reviewer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "needs the bot that reviews",
    );
    expect(onSave).not.toHaveBeenCalled();
    // The bot itself isn't offered.
    const who = panel().getByLabelText("Who reviews");
    expect(within(who).queryByText("Writer")).toBeNull();
    fireEvent.change(who, { target: { value: "e" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].checks.steps[0]).toMatchObject({
      kind: "reviewer",
      botId: "e",
    });
  });

  it("removing every check saves none", async () => {
    const { onSave } = open();
    fireEvent.click(panel().getByRole("button", { name: "Remove this check" }));
    fireEvent.click(rows()[0]);
    fireEvent.click(
      within(rows()[0]).getByRole("button", { name: /You approve/ }),
    );
    fireEvent.click(panel().getByRole("button", { name: "Remove this check" }));
    expect(screen.getByText(/No checks yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].checks).toBeNull();
  });

  it("hands on: lists where its work goes; × and + Add change it on Save", async () => {
    const { onSave } = open();
    const hands = within(screen.getByTestId("hands-on"));
    expect(hands.getByText("Sender")).toBeInTheDocument();
    fireEvent.click(
      hands.getByRole("button", { name: "Stop handing on to Sender" }),
    );
    fireEvent.change(hands.getByRole("combobox", { name: "Hand on to" }), {
      target: { value: "bot:e" },
    });
    expect(hands.getByText("Editor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const { adds, removes } = onSave.mock.calls[0][0];
    expect(adds.map((t) => t.key)).toEqual(["bot:e"]);
    expect(removes.map((t) => t.key)).toEqual(["bot:s"]);
    expect(removes[0].eventType).toBe(ev("w", "completed"));
  });

  it("Cancel closes without saving", () => {
    const { onSave, onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a save that fails says why and stays open", async () => {
    const onSave = jest.fn(() => Promise.reject(new Error("disk full")));
    open({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't save all of it: disk full",
    );
  });

  it("refused while the dashboard is being edited: says so in its own words", async () => {
    const refused = Object.assign(
      new Error("Save or cancel your edits to Home first, then try again."),
      { refused: true },
    );
    open({ onSave: jest.fn(() => Promise.reject(refused)) });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^Save or cancel your edits to Home first/,
    );
  });
});
