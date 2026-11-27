import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { TeamChart } from "./TeamChart";

const ev = (bot, event) => `bot:local/${bot}[${bot}].${event}`;
const lead = { id: "lead", name: "Algolia Lead", role: "lead" };
const planner = { id: "planner", name: "Schema Planner", subscriptions: [] };
const reader = {
  id: "reader",
  name: "Record Reader",
  subscriptions: [{ eventType: ev("planner", "completed") }],
};
const checker = {
  id: "checker",
  name: "Image Checker",
  subscriptions: [{ eventType: ev("reader", "failed") }],
};

function setup(props = {}) {
  const onSelect = jest.fn();
  const onOpen = jest.fn();
  const utils = render(
    <TeamChart
      lead={lead}
      // Listed out of order: the diagram follows the work order.
      members={[checker, reader, planner]}
      selectedId={null}
      statusOf={(id) => (id === "reader" ? "Running" : "Idle")}
      approvalsFor={(id) => (id === "checker" ? [{ id: "a1" }] : [])}
      onSelect={onSelect}
      onOpen={onOpen}
      width={1000}
      {...props}
    />,
  );
  return { onSelect, onOpen, ...utils };
}

const cardOrder = () =>
  screen
    .getAllByTestId(/^diagram-card-/)
    .map((el) => el.getAttribute("data-testid").replace("diagram-card-", ""));

describe("TeamChart — the readable diagram (DASH-139)", () => {
  it("the lead sits on top with its line and no arrow; bots follow the work order", () => {
    setup();
    expect(cardOrder()).toEqual(["lead", "planner", "reader", "checker"]);
    expect(
      within(screen.getByTestId("diagram-card-lead")).getByText(
        "You give it tasks · it can ask any bot",
      ),
    ).toBeInTheDocument();
    // One neighbour arrow: planner → reader. Nothing from the lead.
    expect(screen.getAllByTestId("diagram-arrow")).toHaveLength(1);
  });

  it("says when each bot runs, and where its failures go — failures are never drawn", () => {
    setup({ lines: "all" });
    expect(screen.getByTestId("diagram-card-reader")).toHaveTextContent(
      "After Schema Planner",
    );
    expect(screen.getByTestId("fail-line-reader")).toHaveTextContent(
      "If it fails → Image Checker",
    );
    expect(screen.getByTestId("fail-line-checker")).toHaveTextContent(
      "Gets Record Reader's failures",
    );
    expect(screen.queryAllByTestId("diagram-edge")).toHaveLength(0);
  });

  it("no line labels: nothing on the canvas says completed / failed", () => {
    setup({ lines: "flow" });
    expect(screen.getByTestId("team-diagram")).not.toHaveTextContent(
      /completed|failed/,
    );
  });

  it("stacks the bots one hands on to in the next column", () => {
    const pr = {
      id: "pr",
      name: "PR Bot",
      subscriptions: [{ eventType: ev("planner", "completed") }],
    };
    setup({ members: [planner, reader, pr] });
    const stack = screen.getByTestId("diagram-stack");
    expect(within(stack).getByText("Record Reader")).toBeInTheDocument();
    expect(within(stack).getByText("PR Bot")).toBeInTheDocument();
    // A fork: an arrow to each.
    expect(screen.getAllByTestId("diagram-arrow")).toHaveLength(2);
  });

  it("wraps into rows of at most 4 columns that share the width", () => {
    const chain = Array.from({ length: 6 }, (_, i) => ({
      id: `b${i}`,
      name: `Bot ${i}`,
      subscriptions: i ? [{ eventType: ev(`b${i - 1}`, "completed") }] : [],
    }));
    setup({ members: chain, width: 1400 });
    const rows = screen.getAllByTestId("diagram-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByTestId(/^diagram-card-/)).toHaveLength(4);
    // The wrap has no arrow; the others do.
    expect(screen.getAllByTestId("diagram-arrow")).toHaveLength(4);
  });

  it("Lines: a line that isn't a neighbour arrow shows for the selected bot, or always on Work flow", () => {
    // reader → planner too: back along the row, not a neighbour arrow.
    const loopPlanner = {
      ...planner,
      subscriptions: [{ eventType: ev("reader", "completed") }],
    };
    const { rerender } = setup({ members: [loopPlanner, reader] });
    expect(screen.queryAllByTestId("diagram-edge")).toHaveLength(0);
    const props = {
      lead,
      members: [loopPlanner, reader],
      onSelect: jest.fn(),
      width: 1000,
    };
    rerender(<TeamChart {...props} selectedId="reader" />);
    expect(screen.getAllByTestId("diagram-edge")).toHaveLength(1);
    rerender(<TeamChart {...props} lines="flow" />);
    expect(screen.getAllByTestId("diagram-edge")).toHaveLength(1);
  });

  it("selecting a bot dims everything it isn't linked to and lights its arrows", () => {
    setup({ selectedId: "planner" });
    expect(screen.getByTestId("diagram-card-planner")).not.toHaveAttribute(
      "data-dim",
    );
    expect(screen.getByTestId("diagram-card-reader")).not.toHaveAttribute(
      "data-dim",
    );
    expect(screen.getByTestId("diagram-card-checker")).toHaveAttribute(
      "data-dim",
      "true",
    );
    expect(screen.getByTestId("diagram-arrow")).toHaveAttribute(
      "data-hot",
      "true",
    );
  });

  it("a click selects a bot; a click on the selected one closes it", () => {
    const { onSelect, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Record Reader" }));
    expect(onSelect).toHaveBeenCalledWith("reader");
    rerender(
      <TeamChart
        lead={lead}
        members={[planner, reader]}
        selectedId="reader"
        onSelect={onSelect}
        width={1000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record Reader" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("a bot with a pending approval shows Needs approval, which opens its Activity", () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Needs approval" }));
    expect(onOpen).toHaveBeenCalledWith("checker", "activity");
  });

  it("Needs setup on a bot its host says needs it", () => {
    setup({ setupFor: (id) => id === "planner" });
    expect(screen.getByTestId("diagram-card-planner")).toHaveTextContent(
      "Needs setup",
    );
    expect(screen.getByTestId("diagram-card-reader")).not.toHaveTextContent(
      "Needs setup",
    );
  });

  it("helpers (bots only used in another bot's checks) get their own lane", () => {
    const reviewer = { id: "rev", name: "Reviewer", subscriptions: [] };
    const coder = {
      ...reader,
      checks: {
        steps: [
          {
            id: "s1",
            kind: "reviewer",
            name: "Reviewer approves",
            botId: "rev",
          },
        ],
      },
    };
    setup({ members: [planner, coder, reviewer] });
    expect(screen.getByText("Helpers")).toBeInTheDocument();
    expect(screen.getByTestId("diagram-card-rev")).toHaveTextContent(
      `Record Reader · "Reviewer approves"`,
    );
    // Not in the flow's rows.
    const rows = screen.getAllByTestId("diagram-row");
    expect(within(rows[0]).queryByTestId("diagram-card-rev")).toBeNull();
  });
});

describe("TeamChart — widgets (DASH-139)", () => {
  const notes = {
    key: "Notes|1",
    itemId: "1",
    component: "Notes",
    label: "Notes",
    page: "",
    handlers: ["showIt"],
    listens: [
      {
        handlerName: "showIt",
        botId: "planner",
        event: "completed",
        raw: ev("planner", "completed"),
      },
    ],
    listenerNames: ["showIt"],
    resultsBotId: null,
  };
  const results = {
    key: "dash.bots.BotResults|2",
    itemId: "2",
    component: "dash.bots.BotResults",
    label: "Bot results",
    page: "",
    handlers: [],
    listens: [],
    listenerNames: [],
    resultsBotId: null,
  };

  it("hidden on the canvas unless Lines is All, with widgets", () => {
    const { rerender } = setup({ widgets: [notes] });
    expect(screen.queryByTestId("diagram-widget-1")).toBeNull();
    expect(
      screen.getByText(/Widgets aren't drawn here unless Lines is/),
    ).toBeInTheDocument();
    rerender(
      <TeamChart
        lead={lead}
        members={[planner, reader]}
        widgets={[notes]}
        lines="all"
        width={1000}
      />,
    );
    expect(screen.getByTestId("diagram-widget-1")).toBeInTheDocument();
    expect(screen.getAllByTestId("diagram-widget-edge")).toHaveLength(1);
  });

  it("the panel lists a widget under the event it listens to; ✕ removes it", async () => {
    const onRemoveWidgetLine = jest.fn().mockResolvedValue();
    setup({
      widgets: [notes],
      selectedId: "planner",
      canWire: true,
      onRemoveWidgetLine,
    });
    const box = screen.getByTestId("event-box-completed");
    expect(within(box).getByText("Notes")).toBeInTheDocument();
    fireEvent.click(within(box).getByRole("button", { name: "Remove Notes" }));
    await waitFor(() => expect(onRemoveWidgetLine).toHaveBeenCalled());
    expect(onRemoveWidgetLine.mock.calls[0][0].edge.raw).toBe(
      ev("planner", "completed"),
    );
  });

  it("adding a Bot results widget on complete shows the bot there", async () => {
    const onShowHere = jest.fn().mockResolvedValue();
    setup({
      widgets: [results],
      selectedId: "planner",
      canWire: true,
      onShowHere,
    });
    const box = screen.getByTestId("event-box-completed");
    fireEvent.change(within(box).getByRole("combobox"), {
      target: { value: `widget:${results.key}` },
    });
    await waitFor(() =>
      expect(onShowHere).toHaveBeenCalledWith({
        widget: results,
        botId: "planner",
      }),
    );
  });
});

describe("TeamChart — the connections panel (DASH-139)", () => {
  const coder = {
    id: "reader",
    name: "Record Reader",
    subscriptions: [{ eventType: ev("planner", "completed") }],
    publishes: [{ name: "prUrl" }],
    checks: {
      steps: [
        {
          id: "s1",
          kind: "check",
          name: "Validate passes",
          check: { kind: "command", command: "npm test" },
        },
      ],
    },
  };
  const draw = (props = {}) => {
    const fns = {
      onSelect: jest.fn(),
      onOpen: jest.fn(),
      onOpenChecks: jest.fn(),
      onSaveTrigger: jest.fn().mockResolvedValue(),
      onRemoveTrigger: jest.fn().mockResolvedValue(),
    };
    render(
      <TeamChart
        lead={lead}
        members={[planner, coder, checker]}
        selectedId="reader"
        canWire
        width={1000}
        choicesFor={() => [
          { event: "completed", label: "Completed" },
          { event: "failed", label: "Failed" },
          { event: "result.prUrl", label: "prUrl" },
          { event: "tool.github.push", label: "GitHub › push" },
        ]}
        {...fns}
        {...props}
      />,
    );
    return fns;
  };
  const panel = () =>
    screen.getByRole("complementary", { name: "Record Reader's connections" });

  it("in flow order: gets work from, its checks, the events it sends, tool events, helpers", () => {
    draw();
    const p = panel();
    const text = p.textContent;
    const order = [
      "Gets work from",
      "Its checks · 1",
      "On Complete",
      "On Failure",
      "On Result · prUrl",
      "Tool events · 1",
      "Helpers it uses",
    ].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(
      within(screen.getByTestId("gets-work-from")).getByText("Schema Planner"),
    ).toBeInTheDocument();
    expect(screen.getByText("when it completes")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("event-box-failed")).getByText("Image Checker"),
    ).toBeInTheDocument();
  });

  it("header: Open full page opens its page, ✕ closes; Edit checks opens the checks window", () => {
    const fns = draw();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Record Reader's full page" }),
    );
    expect(fns.onOpen).toHaveBeenCalledWith("reader", "activity");
    expect(
      screen.getByRole("button", { name: "Open Record Reader's full page" })
        .parentElement,
    ).toHaveAttribute("title", "Open full page");
    fireEvent.click(screen.getByRole("button", { name: "Edit checks" }));
    expect(fns.onOpenChecks).toHaveBeenCalledWith("reader");
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(fns.onSelect).toHaveBeenCalledWith(null);
    // Team members have no conversation button.
    expect(
      screen.queryByRole("button", { name: "Open conversation" }),
    ).toBeNull();
  });

  it("+ Add a bot or widget saves a trigger on that bot; ✕ removes one", async () => {
    const fns = draw();
    const failed = screen.getByTestId("event-box-failed");
    fireEvent.change(within(failed).getByRole("combobox"), {
      target: { value: "bot:planner" },
    });
    await waitFor(() =>
      expect(fns.onSaveTrigger).toHaveBeenCalledWith({
        mode: "add",
        sourceId: "reader",
        targetId: "planner",
        oldEventType: null,
        event: "failed",
        label: "Failed",
        note: "",
      }),
    );
    const remove = within(failed).getByRole("button", {
      name: "Remove Image Checker",
    });
    await waitFor(() => expect(remove).not.toBeDisabled());
    fireEvent.click(remove);
    await waitFor(() =>
      expect(fns.onRemoveTrigger).toHaveBeenCalledWith({
        targetId: "checker",
        eventType: ev("reader", "failed"),
      }),
    );
  });

  it("a failed save says so in the panel", async () => {
    draw({
      onRemoveTrigger: jest.fn().mockRejectedValue(new Error("disk full")),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Image Checker" }),
    );
    expect(
      await screen.findByText("Couldn't save: disk full"),
    ).toBeInTheDocument();
  });

  it("while it can't be changed: no add or remove", () => {
    draw({ canWire: false });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove Image Checker" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit checks" })).toBeNull();
  });

  it("the lead's panel opens its conversation", () => {
    const fns = draw({ selectedId: "lead" });
    const p = screen.getByRole("complementary", {
      name: "Algolia Lead's connections",
    });
    fireEvent.click(
      within(p).getByRole("button", { name: "Open conversation" }),
    );
    expect(fns.onOpen).toHaveBeenCalledWith("lead", "conversation");
    expect(within(p).queryByText(/On Complete/)).toBeNull();
  });

  it("no panel when the host shows the bot's page instead", () => {
    draw({ showPanel: false });
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("TeamChart — a bot's checks inside its box (DASH-12)", () => {
  const checks = {
    steps: [
      {
        id: "step_c1",
        kind: "check",
        name: "No bananas",
        check: { kind: "rules", rules: [] },
      },
      { id: "step_c2", kind: "you", name: "You approve" },
    ],
  };
  const checkedPlanner = { ...planner, checks };
  const draw = (props = {}) => {
    const onOpenChecks = jest.fn();
    const onOpenJob = jest.fn();
    render(
      <TeamChart
        lead={lead}
        members={[checkedPlanner, reader, checker]}
        statusOf={() => "Idle"}
        approvalsFor={() => []}
        onSelect={jest.fn()}
        onOpen={jest.fn()}
        canWire
        onOpenChecks={onOpenChecks}
        onOpenJob={onOpenJob}
        width={1400}
        {...props}
      />,
    );
    return { onOpenChecks, onOpenJob };
  };

  it("lists a bot's checks inside its box with a kind mark; a click opens the checks window", () => {
    const { onOpenChecks } = draw();
    const card = screen.getByTestId("diagram-card-planner");
    const section = within(card).getByTestId("checks-section-planner");
    expect(section).toHaveTextContent("Checks · 2");
    expect(section).toHaveTextContent("No bananas");
    expect(section).toHaveTextContent("You approve");
    expect(
      within(section).getByLabelText("A rule or compare"),
    ).toHaveTextContent("R");
    expect(within(section).getByTitle("No bananas")).toBeInTheDocument();
    fireEvent.click(section);
    expect(onOpenChecks).toHaveBeenCalledWith("planner");
  });

  it("a bot with none offers Add checks inside its box", () => {
    const { onOpenChecks } = draw();
    const card = screen.getByTestId("diagram-card-reader");
    fireEvent.click(
      within(card).getByRole("button", { name: "Add checks — Record Reader" }),
    );
    expect(onOpenChecks).toHaveBeenCalledWith("reader");
  });

  it("while Settings is open: checks still show, Add checks doesn't", () => {
    draw({ canWire: false });
    expect(screen.getByTestId("checks-section-planner")).toBeInTheDocument();
    expect(screen.queryByTestId("checks-section-reader")).toBeNull();
  });

  describe("what its checks are doing now", () => {
    const live = (l) => (id) => (id === "planner" ? l : null);
    const base = {
      needs: 0,
      header: null,
      stepId: null,
      goalId: null,
      workspaceId: null,
    };

    it("checking: the try in the header, a spinner on the check being run", () => {
      const { onOpenJob, onOpenChecks } = draw({
        liveFor: live({
          ...base,
          header: "Checking · try 1 of 3",
          stepId: "step_c1",
          goalId: "j1",
          workspaceId: "ws1",
        }),
      });
      const section = screen.getByTestId("checks-section-planner");
      expect(section).toHaveTextContent("Checking · try 1 of 3");
      expect(within(section).getByTestId("check-running")).toHaveTextContent(
        "No bananas",
      );
      fireEvent.click(section);
      expect(onOpenJob).toHaveBeenCalledWith("j1", "ws1");
      expect(onOpenChecks).not.toHaveBeenCalled();
    });

    it("sent back: the header says so, no check spins", () => {
      draw({
        liveFor: live({
          ...base,
          header: "Sent back · try 2 of 3",
          goalId: "j1",
        }),
      });
      const section = screen.getByTestId("checks-section-planner");
      expect(section).toHaveTextContent("Sent back · try 2 of 3");
      expect(within(section).queryByTestId("check-running")).toBeNull();
    });

    it("waiting for a paused bot: says so, nothing spins", () => {
      draw({
        liveFor: live({
          ...base,
          header: "Paused · try 2 of 3 waits",
          waiting: true,
          goalId: "j1",
        }),
      });
      const section = screen.getByTestId("checks-section-planner");
      expect(section).toHaveTextContent("Paused · try 2 of 3 waits");
      expect(section.querySelector(".animate-spin")).toBeNull();
    });

    it("needs you: an amber count and an amber box", () => {
      const { onOpenJob } = draw({
        liveFor: live({ ...base, needs: 1, goalId: "j2", workspaceId: "ws1" }),
      });
      const section = screen.getByTestId("checks-section-planner");
      expect(section).toHaveTextContent("Checks · 2");
      expect(section).toHaveTextContent("1 needs you");
      expect(screen.getByTestId("diagram-card-planner").className).toContain(
        "border-amber-400",
      );
      fireEvent.click(section);
      expect(onOpenJob).toHaveBeenCalledWith("j2", "ws1");
    });

    it("nothing happening: no tick or cross, the checks window opens", () => {
      const { onOpenChecks } = draw({ liveFor: live(base) });
      const section = screen.getByTestId("checks-section-planner");
      expect(section).toHaveTextContent("Checks · 2");
      expect(section).not.toHaveTextContent(/needs you|Checking|Sent back/);
      fireEvent.click(section);
      expect(onOpenChecks).toHaveBeenCalledWith("planner");
    });
  });
});
