import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  within,
  cleanup,
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
  render(
    <TeamChart
      lead={lead}
      members={[planner, reader, checker]}
      selectedId={null}
      statusOf={(id) => (id === "reader" ? "Running" : "Idle")}
      approvalsFor={(id) => (id === "checker" ? [{ id: "a1" }] : [])}
      onSelect={onSelect}
      onOpen={onOpen}
      width={1000}
      {...props}
    />,
  );
  return { onSelect, onOpen };
}

describe("TeamChart (TEAM-014 slice 1)", () => {
  it("draws the lead and every team bot with its avatar", () => {
    setup();
    expect(screen.getAllByTestId("bot-avatar")).toHaveLength(4);
    expect(screen.getByText("Algolia Lead")).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Image Checker")).toBeInTheDocument();
  });

  it("draws a labelled line per trigger, dashed for failed", () => {
    setup();
    const lines = screen.getAllByTestId("diagram-edge");
    expect(lines).toHaveLength(2);
    expect(
      screen.getByTestId(`edge-label-reader|${ev("planner", "completed")}`),
    ).toHaveTextContent("completed");
    const failed = lines.find((l) => l.getAttribute("data-kind") === "failed");
    expect(failed).toHaveAttribute("stroke-dasharray");
  });

  it("selecting a bot with lines fades the others; selecting one without fades nothing", () => {
    setup({ selectedId: "planner" });
    const [toReader, toChecker] = screen.getAllByTestId("diagram-edge");
    expect(toReader).toHaveAttribute("stroke-opacity", "1");
    expect(toChecker).toHaveAttribute("stroke-opacity", "0.3");
  });

  it("selecting the lead fades nothing", () => {
    setup({ selectedId: "lead" });
    for (const l of screen.getAllByTestId("diagram-edge")) {
      expect(l).toHaveAttribute("stroke-opacity", "1");
    }
  });

  it("clicking a bot selects it", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Record Reader" }));
    expect(onSelect).toHaveBeenCalledWith("reader");
  });

  it("a selected bot shows Conversation / Activity / Settings; the lead's first is Ask the lead", () => {
    const { onOpen } = setup({ selectedId: "reader" });
    fireEvent.click(
      screen.getByRole("button", { name: "Activity — Record Reader" }),
    );
    expect(onOpen).toHaveBeenCalledWith("reader", "activity");
    fireEvent.mouseEnter(screen.getByTestId("diagram-card-lead"));
    fireEvent.click(
      screen.getByRole("button", { name: "Ask the lead — Algolia Lead" }),
    );
    expect(onOpen).toHaveBeenCalledWith("lead", "conversation");
  });

  it("a bot waiting for approval has a badge that opens its Activity", () => {
    const { onOpen } = setup();
    const c = screen.getByTestId("diagram-card-checker");
    fireEvent.click(within(c).getByRole("button", { name: "Needs approval" }));
    expect(onOpen).toHaveBeenCalledWith("checker", "activity");
  });

  it("a team with only the lead says so", () => {
    setup({ members: [] });
    expect(
      screen.getByText(/No bots on this dashboard yet/),
    ).toBeInTheDocument();
  });
});

describe("TeamChart — drag to wire (TEAM-014 slice 2)", () => {
  const choicesFor = () => [
    { event: "completed", label: "Completed" },
    { event: "failed", label: "Failed" },
  ];
  function wire(props = {}) {
    const onSaveTrigger = jest.fn().mockResolvedValue(undefined);
    const onRemoveTrigger = jest.fn().mockResolvedValue(undefined);
    render(
      <TeamChart
        lead={lead}
        members={[planner, reader, checker]}
        statusOf={() => "Idle"}
        approvalsFor={() => []}
        onSelect={jest.fn()}
        onOpen={jest.fn()}
        width={1000}
        canWire
        choicesFor={choicesFor}
        onSaveTrigger={onSaveTrigger}
        onRemoveTrigger={onRemoveTrigger}
        {...props}
      />,
    );
    return { onSaveTrigger, onRemoveTrigger };
  }
  const handle = (name) =>
    screen.getByRole("button", { name: `Drag to wire ${name}` });

  it("team bots have a handle; the lead doesn't", () => {
    wire();
    expect(handle("Record Reader")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Drag to wire Algolia Lead" }),
    ).toBeNull();
  });

  it("dragging from one bot onto another opens the popover; Add trigger saves it", async () => {
    const { onSaveTrigger } = wire();
    fireEvent.pointerDown(handle("Image Checker"));
    fireEvent.pointerUp(screen.getByTestId("diagram-card-planner"));
    const dialog = screen.getByRole("dialog", {
      name: "Trigger for Schema Planner",
    });
    expect(within(dialog).getByText("after Image Checker")).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add trigger" }),
    );
    expect(onSaveTrigger).toHaveBeenCalledWith({
      mode: "add",
      sourceId: "checker",
      targetId: "planner",
      oldEventType: null,
      event: "completed",
      label: "Completed",
      note: "",
    });
  });

  it("dropping on the lead or on the same bot does nothing", () => {
    wire();
    fireEvent.pointerDown(handle("Record Reader"));
    fireEvent.pointerUp(screen.getByTestId("diagram-card-lead"));
    fireEvent.pointerDown(handle("Record Reader"));
    fireEvent.pointerUp(screen.getByTestId("diagram-card-reader"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking a line's label edits it; Remove removes it", () => {
    const { onRemoveTrigger } = wire();
    fireEvent.click(
      screen.getByTestId(`edge-label-reader|${ev("planner", "completed")}`),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Trigger for Record Reader",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(onRemoveTrigger).toHaveBeenCalledWith({
      targetId: "reader",
      eventType: ev("planner", "completed"),
    });
  });

  it("no handles while wiring is off (e.g. a bot's Settings is open)", () => {
    wire({ canWire: false });
    expect(
      screen.queryByRole("button", { name: "Drag to wire Record Reader" }),
    ).toBeNull();
  });

  it("lines in a loop are marked", () => {
    const loopPlanner = {
      ...planner,
      subscriptions: [{ eventType: ev("reader", "completed") }],
    };
    wire({ members: [loopPlanner, reader] });
    expect(
      screen.getByTestId(`edge-label-planner|${ev("reader", "completed")}`),
    ).toHaveTextContent("loop");
  });
});

describe("TeamChart — widgets (polish 2026-11)", () => {
  const widgets = [
    {
      key: "w1",
      itemId: "1",
      label: "Bot results",
      page: "",
      handlers: [],
      listens: [],
      resultsBotId: "checker",
    },
    {
      key: "w2",
      itemId: "2",
      label: "Planner board",
      page: "",
      handlers: ["showPlan"],
      listens: [
        {
          handlerName: "showPlan",
          botId: "planner",
          event: "completed",
          raw: "x",
        },
      ],
      resultsBotId: null,
    },
  ];
  const draw = (width) =>
    render(
      <TeamChart
        lead={lead}
        members={[planner, reader, checker]}
        statusOf={() => "Idle"}
        approvalsFor={() => []}
        onSelect={jest.fn()}
        onOpen={jest.fn()}
        width={width}
        widgets={widgets}
      />,
    );
  const box = (id) => screen.getByTestId(id).style;

  it("wide: widgets in a column on the right, each line labelled", () => {
    draw(1400);
    expect(box("diagram-widget-1").left).toBe(box("diagram-widget-2").left);
    expect(screen.getAllByTestId("diagram-widget-edge")).toHaveLength(2);
    expect(screen.getByTestId("widget-edge-label-r|w1")).toHaveTextContent(
      "shows answers",
    );
  });

  it("narrow: each widget below its bot, in its column", () => {
    draw(700);
    expect(box("diagram-widget-2").left).toBe(box("diagram-card-planner").left);
    expect(parseFloat(box("diagram-widget-1").top)).toBeGreaterThan(
      parseFloat(box("diagram-card-checker").top),
    );
    expect(screen.getAllByTestId("diagram-widget-edge")).toHaveLength(2);
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
  const box = (id) => screen.getByTestId(id).style;

  it("lists a bot's checks inside its box; a click opens the checks window", () => {
    const { onOpenChecks } = draw();
    const card = screen.getByTestId("diagram-card-planner");
    const section = within(card).getByTestId("checks-section-planner");
    expect(section).toHaveTextContent("Checks · 2");
    expect(section).toHaveTextContent("No bananas");
    expect(section).toHaveTextContent("You approve");
    fireEvent.click(section);
    expect(onOpenChecks).toHaveBeenCalledWith("planner");
  });

  it("every bot's box takes the tallest height, so rows stay level", () => {
    draw();
    const heights = ["planner", "reader", "checker"].map((id) =>
      parseFloat(box(`diagram-card-${id}`).height),
    );
    // 80 on top (room for a two-line name) + the section: header and two rows.
    expect(heights).toEqual([153, 153, 153]);
    // The lead keeps its own height.
    expect(parseFloat(box("diagram-card-lead").height)).toBe(80);
  });

  it("no checks anywhere and nothing to add: plain 80px boxes", () => {
    draw({ members: [planner, reader], canWire: false });
    expect(parseFloat(box("diagram-card-planner").height)).toBe(80);
    expect(screen.queryByTestId("checks-section-planner")).toBeNull();
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

  it("the circle is filled once a bot hands its work on, hollow otherwise", () => {
    draw();
    // planner → reader (completed), reader → checker (failed); checker: none.
    expect(screen.getByTestId("diagram-handle-planner")).toHaveAttribute(
      "data-filled",
      "true",
    );
    expect(screen.getByTestId("diagram-handle-reader")).toHaveAttribute(
      "data-filled",
      "true",
    );
    expect(screen.getByTestId("diagram-handle-checker")).toHaveAttribute(
      "data-filled",
      "false",
    );
    // Shown while the diagram can't be changed too, just not draggable.
    cleanup();
    draw({ canWire: false });
    const still = screen.getByTestId("diagram-handle-planner");
    expect(still.tagName).toBe("SPAN");
    expect(still).toHaveAttribute("data-filled", "true");
  });

  it("a line to the next bot leaves from the bot's own box", () => {
    draw();
    const bot = box("diagram-card-planner");
    const right = parseFloat(bot.left) + parseFloat(bot.width);
    const toReader = screen
      .getAllByTestId("diagram-edge")
      .find((l) => l.getAttribute("data-kind") === "completed");
    const [, x1] = toReader.getAttribute("d").match(/^M([\d.]+),/);
    expect(parseFloat(x1)).toBeCloseTo(right, 0);
  });

  it("a bot on the next row: down from its circle, along the gap, into its top", () => {
    draw({ width: 600 });
    const bot = box("diagram-card-planner");
    const reader = box("diagram-card-reader");
    const toReader = screen
      .getAllByTestId("diagram-edge")
      .find((l) => l.getAttribute("data-kind") === "completed");
    const m = toReader
      .getAttribute("d")
      .match(/^M([\d.]+),([\d.]+) V([\d.]+) H([\d.]+) V([\d.]+)$/);
    expect(m).not.toBeNull();
    const [, sx, sy, gapY, tx, ty] = m.map(Number);
    expect(sx).toBeCloseTo(parseFloat(bot.left) + parseFloat(bot.width) / 2, 0);
    expect(sy).toBe(parseFloat(bot.top) + parseFloat(bot.height));
    expect(gapY).toBeGreaterThan(sy);
    expect(gapY).toBeLessThan(parseFloat(reader.top));
    expect(tx).toBeCloseTo(
      parseFloat(reader.left) + parseFloat(reader.width) / 2,
      0,
    );
    expect(ty).toBe(parseFloat(reader.top));
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
      expect(
        screen.getByTestId("diagram-card-planner").firstChild.className,
      ).toContain("border-amber-400");
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
