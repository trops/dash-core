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

const save = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save checks" }));

describe("BotChecksModal", () => {
  it("lists its checks in order with a cost each, the first selected", () => {
    open();
    expect(screen.getByText("Writer's checks")).toBeInTheDocument();
    expect(screen.getByText("Its checks")).toBeInTheDocument();
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining("No bananas"),
      expect.stringContaining("You approve"),
    ]);
    expect(rows()[0]).toHaveTextContent("Free · instant rule");
    expect(rows()[1]).toHaveTextContent("Free · waits for you");
    expect(panel().getByLabelText("Name")).toHaveValue("No bananas");
    // Its banned-words rule, from the shared check editor.
    expect(panel().getByText("From your list: 1 word")).toBeInTheDocument();
    expect(
      panel().getByRole("radio", { name: /Automatic: a rule or command/ }),
    ).toBeChecked();
  });

  it("one fixed size wherever it opens (DASH-127)", () => {
    open();
    const win = screen.getByTestId("bot-checks-modal");
    expect(win.style.width).toBe("1040px");
    expect(win.style.height).toBe("760px");
  });

  it("no Hands on here: it moved to the bot's Settings tab", () => {
    open();
    expect(screen.queryByTestId("hands-on")).toBeNull();
    expect(screen.queryByText("Sender")).toBeNull();
  });

  it("Save checks sends the edited checks", async () => {
    const { onSave } = open();
    fireEvent.change(panel().getByLabelText("Name"), {
      target: { value: "No fruit" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "It comes to you" }));
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const { checks } = onSave.mock.calls[0][0];
    expect(checks.steps[0].name).toBe("No fruit");
    expect(checks.onFail).toBe("you");
    expect(checks.handsOn).toBe("answer");
  });

  it("+ Add check adds one at the end; ▲▼ reorder, the ends can't move out", async () => {
    const { onSave } = open();
    fireEvent.click(screen.getByRole("button", { name: "+ Add check" }));
    fireEvent.click(
      within(screen.getByTestId("add-check")).getByRole("button", {
        name: "A command",
      }),
    );
    expect(rows()).toHaveLength(3);
    expect(rows()[2]).toHaveTextContent("A command passes");
    expect(rows()[2]).toHaveTextContent("No AI cost");
    fireEvent.change(panel().getByLabelText("Command"), {
      target: { value: "npm test" },
    });
    expect(
      screen.getByRole("button", { name: "Move No bananas up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move A command passes down" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Move A command passes up" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move A command passes up" }),
    );
    // Still the one selected, at the top now.
    expect(panel().getByLabelText("Name")).toHaveValue("A command passes");
    save();
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

  it("Who decides: a bot reviews lists only other bots, and starts on one", async () => {
    const { onSave } = open();
    fireEvent.click(panel().getByRole("radio", { name: /A bot reviews/ }));
    const who = panel().getByLabelText("Which bot (bots on this team)");
    expect(within(who).queryByText("Writer")).toBeNull();
    expect(who).toHaveValue("s");
    expect(rows()[0]).toHaveTextContent("AI · cost not known yet");
    fireEvent.change(who, { target: { value: "e" } });
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].checks.steps[0]).toMatchObject({
      kind: "reviewer",
      botId: "e",
    });
  });

  it("with no other bot on the team, a bot can't review: it's you", () => {
    open({ members: [writer] });
    expect(
      panel().getByRole("radio", { name: /A bot reviews/ }),
    ).toBeDisabled();
    expect(
      panel().getByText("There's no other bot on this team, so you approve."),
    ).toBeInTheDocument();
  });

  it("a reviewer with no bot says so instead of saving", async () => {
    const bot = {
      ...writer,
      checks: {
        ...writer.checks,
        steps: [{ id: "r1", kind: "reviewer", name: "Reviewer", botId: "" }],
      },
    };
    const { onSave } = open({ bot });
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "needs the bot that reviews",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Automatic: its kinds are cards; Built in picks one and shows its keys", async () => {
    const { onSave } = open();
    // A rule on the answer is one of the Built in checks.
    expect(screen.getByTestId("selectable-card-Built in")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const built = panel().getByLabelText("Built-in check");
    expect(built).toHaveValue("rules");
    fireEvent.change(built, { target: { value: "handoff-has" } });
    // Its name was the default, so it follows the kind.
    expect(rows()[0]).toHaveTextContent("No bananas");
    const keys = within(screen.getByTestId("handoff-keys"));
    expect(keys.getByText("summary")).toBeInTheDocument();
    fireEvent.change(keys.getByLabelText("Add a key"), {
      target: { value: "plan," },
    });
    fireEvent.click(keys.getByRole("button", { name: "Remove summary" }));
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].checks.steps[0].check).toMatchObject({
      kind: "handoff-has",
      keys: ["plan"],
    });
  });

  it("You approve has no settings of its own", () => {
    open();
    fireEvent.click(rows()[1].querySelector("button"));
    expect(panel().getByRole("radio", { name: /You approve/ })).toBeChecked();
    expect(panel().queryByTestId("selectable-card-Built in")).toBeNull();
  });

  it("removing every check saves none", async () => {
    const { onSave } = open();
    fireEvent.click(panel().getByRole("button", { name: "Remove this check" }));
    fireEvent.click(rows()[0].querySelector("button"));
    fireEvent.click(panel().getByRole("button", { name: "Remove this check" }));
    expect(screen.getByText(/No checks yet/)).toBeInTheDocument();
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].checks).toBeNull();
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
    save();
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
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^Save or cancel your edits to Home first/,
    );
  });
});

describe("a command that came with a package (DASH-57)", () => {
  const imported = {
    ...writer,
    checks: {
      ...writer.checks,
      steps: [
        {
          id: "step_c1",
          kind: "check",
          name: "Tests pass",
          held: true,
          check: {
            kind: "command",
            command: "npm test",
            passWhen: { type: "exit0" },
          },
        },
      ],
    },
  };

  it("shows it's off with its command, and Turn on saves it on", async () => {
    const { onSave } = open({ bot: imported, members: [imported] });
    const held = screen.getByTestId("held-check");
    expect(held).toHaveTextContent("it's off");
    expect(held).toHaveTextContent("npm test");
    expect(rows()[0]).toHaveTextContent("Tests pass (off)");
    fireEvent.click(within(held).getByRole("button", { name: "Turn on" }));
    expect(screen.queryByTestId("held-check")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save checks" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].checks.steps[0].held).toBeUndefined();
  });
});

describe("cost and time from its recent jobs (DASH-127)", () => {
  afterEach(() => {
    delete window.mainApi;
  });

  it("a command's last run time and a reviewer's average cost", async () => {
    const bot = {
      ...writer,
      checks: {
        ...writer.checks,
        steps: [
          {
            id: "c1",
            kind: "check",
            name: "Tests",
            check: { kind: "command", command: "npm test" },
          },
          { id: "rv", kind: "reviewer", name: "Review", botId: "e" },
        ],
      },
    };
    window.mainApi = {
      goals: {
        list: jest.fn(() =>
          Promise.resolve([
            {
              id: "g1",
              flow: {
                botId: "w",
                steps: [{ id: "rv", kind: "bot", botId: "e", judgment: true }],
              },
              tasks: [
                {
                  history: [
                    { stepId: "work", status: "passed", at: 0 },
                    { stepId: "c1", status: "passed", at: 120000 },
                  ],
                },
              ],
            },
          ]),
        ),
      },
      bots: {
        getRuns: jest.fn(() =>
          Promise.resolve([
            { checks: { goalId: "g1", state: "review" }, cost: { usd: 0.05 } },
          ]),
        ),
      },
    };
    open({ bot });
    await waitFor(() =>
      expect(rows()[0]).toHaveTextContent("No AI cost · ~2 min"),
    );
    expect(rows()[1]).toHaveTextContent("AI · ~$0.05 a run");
    expect(window.mainApi.goals.list).toHaveBeenCalledWith(1);
    expect(window.mainApi.bots.getRuns).toHaveBeenCalledWith("e", 50);
  });
});
