/**
 * Step 5 · Review & build (the approved "Widget, step by step" overview and
 * missing frames): every part of the widget, one row each, from the plan,
 * the user's providers and picks — what the user checks is what's built.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { StepBar, StepReview, ReviewSketch } from "./StepReview";
import {
  isNewOnlyWidget,
  readTools,
  reviewRows,
  settingLabel,
  sketchOf,
  stepNotes,
} from "./widgetSpec";

const PROVIDERS = {
  "Home Assistant MCP": {
    name: "Home Assistant MCP",
    type: "home-assistant-mcp",
    providerClass: "mcp",
    allowedTools: ["ha_get_state", "ha_get_todo", "ha_add_todo_item"],
  },
  "Google Calendar": {
    name: "Google Calendar",
    type: "google-calendar",
    providerClass: "mcp",
    allowedTools: ["list-events"],
  },
};

// The user's real Shopping List plan (2026-11-12), before the spec fields.
const SHOPPING = {
  summary:
    "One new compact shopping list widget that shows only 3 items, read from Home Assistant MCP.",
  pieces: [
    {
      kind: "widget",
      name: "Shopping List (3 items)",
      source: "new",
      providers: ["home-assistant-mcp"],
      provider: { "home-assistant-mcp": "Home Assistant MCP" },
      settings: { todoEntityId: "todo.shopping_list", maxItems: 3 },
      notes:
        "Home Assistant MCP is the only provider chosen. It reads the to-do list with ha_get_todo (entity todo.shopping_list by default, changeable in settings) and shows only the first 3 open items in a compact, lightweight card. Read-only: it never changes the list. Shows a short 'List is empty' message when there are no items. Goes in the empty cell at row 2, column 3 of the Home page.",
      sample: ["Milk", "Eggs", "Bread"],
    },
  ],
  checks: [
    "The widget shows at most 3 items, even when the Home Assistant list has more",
    "An empty list shows a friendly empty message instead of an error",
  ],
  access: [
    "The widget can read the Home Assistant to-do list (ha_get_todo)",
    "The widget cannot add, edit or remove items",
  ],
  estimate: { build: "A few minutes", running: "Reads on load and on refresh" },
  cell: { cellNumber: "2.3" },
};

// The same widget with the Planner's spec fields (WIDGET_SPEC).
const withSpec = (over = {}) => ({
  ...SHOPPING,
  pieces: [
    {
      ...SHOPPING.pieces[0],
      shows: "The first 3 open items on your shopping list, in a compact list",
      whenEmpty: "Nothing on the list",
      reads: ["ha_get_todo"],
      changes: [],
      refresh: "every 5 minutes",
      ...over,
    },
  ],
});

const WHERE = "the empty cell in row 2, column 3";
const picked = ["Home Assistant MCP"];
const rowOf = (rows, key) => rows.find((r) => r.key === key);

describe("Review & build's rows", () => {
  test("every part from the Planner's spec fields, the pick and the cell", () => {
    const plan = withSpec();
    const { rows, setCount, total, isNew } = reviewRows(plan, plan.pieces[0], {
      providers: PROVIDERS,
      picked,
      where: WHERE,
    });
    expect(isNew).toBe(true);
    expect(rows.map((r) => r.key)).toEqual([
      "reads",
      "acts",
      "shows",
      "settings",
      "talks",
      "updates",
      "where",
      "checks",
    ]);
    expect(setCount).toBe(total);
    expect(rowOf(rows, "reads")).toMatchObject({
      value: ["Home Assistant MCP · Tools (MCP)"],
      sub: "Uses its tool to get todo",
      tag: "You chose",
    });
    expect(rowOf(rows, "acts").value).toEqual([
      "Only reads — it never changes anything",
    ]);
    expect(rowOf(rows, "shows")).toMatchObject({
      value: [
        "The first 3 open items on your shopping list, in a compact list",
      ],
      sub: 'When empty: "Nothing on the list"',
      tag: "Proposed",
    });
    expect(rowOf(rows, "settings").value).toEqual([
      "Todo entity id: todo.shopping_list  ·  Max items: 3",
    ]);
    expect(rowOf(rows, "updates").value).toEqual(["Every 5 minutes"]);
    expect(rowOf(rows, "where")).toMatchObject({
      value: [WHERE],
      tag: "You chose",
      change: null,
    });
    expect(rowOf(rows, "checks").value).toHaveLength(2);
  });

  test("a plan from before the spec fields: the notes and access fill in, never the provider or the cell twice", () => {
    const { rows } = reviewRows(SHOPPING, SHOPPING.pieces[0], {
      providers: PROVIDERS,
      picked,
      where: WHERE,
    });
    // The tool it reads with, found in its notes among the approved tools.
    expect(rowOf(rows, "reads").sub).toBe("Uses its tool to get todo");
    const shows = rowOf(rows, "shows").value[0];
    expect(shows).toMatch(/shows only the first 3 open items/);
    expect(shows).not.toMatch(/provider chosen|row 2|Read-only/);
    expect(rowOf(rows, "acts").value).toEqual(SHOPPING.access);
    // Never the plan's running cost: how often it reads isn't said yet.
    expect(rowOf(rows, "updates").value).toEqual(["Only when I open it"]);
  });

  test("a plan that also changes another widget keeps the plan's own view", () => {
    const plan = withSpec();
    const both = {
      ...plan,
      pieces: [
        plan.pieces[0],
        { kind: "widget", name: "Clock", source: "settings" },
      ],
    };
    expect(isNewOnlyWidget(both, both.pieces[0])).toBe(false);
  });

  test("the step bar's notes: what was picked, and what the Planner proposed", () => {
    expect(stepNotes(withSpec().pieces[0], "Home Assistant MCP")).toEqual({
      reads: "Home Assistant MCP",
      does: "Only reads",
      talks: "Sends 3",
      looks: "Proposed",
    });
    expect(
      stepNotes(
        withSpec({ changes: ["ha_add_todo_item"], events: ["itemClicked"] })
          .pieces[0],
      ),
    ).toMatchObject({ does: "Can change 1", talks: "Sends 4" });
  });

  test("tools it may change with are named, each behind a button that asks first", () => {
    const plan = withSpec({ changes: ["ha_add_todo_item"] });
    const { rows } = reviewRows(plan, plan.pieces[0], {
      providers: PROVIDERS,
      picked,
    });
    expect(rowOf(rows, "acts")).toMatchObject({
      value: ["Can add todo item"],
      sub: "Each is a button that asks you before it first changes anything",
    });
  });

  test("not picked yet: Reads from is the one part to choose (the missing frame)", () => {
    const plan = withSpec({ provider: {} });
    const { rows, setCount, total } = reviewRows(plan, plan.pieces[0], {
      providers: PROVIDERS,
      picked: [],
    });
    expect(rowOf(rows, "reads")).toMatchObject({
      set: false,
      change: "choose",
      value: ["Choose — 1 of your providers can do this"],
    });
    expect(total - setCount).toBe(1);
  });

  test("settings changed on the review say You chose", () => {
    const plan = withSpec();
    const { rows } = reviewRows(plan, plan.pieces[0], {
      providers: PROVIDERS,
      picked,
      edited: { settings: true },
    });
    expect(rowOf(rows, "settings").tag).toBe("You chose");
  });

  test("only a plan that makes one new widget and nothing else is reviewed here", () => {
    const plan = withSpec();
    expect(isNewOnlyWidget(plan, plan.pieces[0])).toBe(true);
    const reused = { ...plan.pieces[0], source: "yours" };
    expect(isNewOnlyWidget({ pieces: [reused] }, reused)).toBe(false);
    const withLayout = {
      pieces: [plan.pieces[0], { kind: "layout", name: "Home" }],
    };
    expect(isNewOnlyWidget(withLayout, plan.pieces[0])).toBe(false);
  });

  test("names read as words; the sketch is the sample, or the empty words", () => {
    expect(settingLabel("todoEntityId")).toBe("Todo entity id");
    expect(settingLabel("max_items")).toBe("Max items");
    expect(readTools(withSpec().pieces[0], PROVIDERS)).toEqual(["ha_get_todo"]);
    expect(sketchOf(withSpec().pieces[0])).toEqual({
      title: "Shopping List (3 items)",
      lines: ["Milk", "Eggs", "Bread"],
      empty: "",
    });
    expect(sketchOf(withSpec({ sample: [] }).pieces[0]).empty).toBe(
      "Nothing on the list",
    );
  });
});

describe("Review & build on the screen", () => {
  const show = (props = {}) => {
    const plan = props.plan || withSpec();
    const handlers = {
      onChoose: jest.fn(),
      onSettings: jest.fn(),
      onChat: jest.fn(),
      onStep: jest.fn(),
    };
    render(
      <StepReview
        plan={plan}
        piece={plan.pieces[0]}
        providers={PROVIDERS}
        picked={picked}
        where={WHERE}
        footer={<button type="button">Yes, build it</button>}
        {...handlers}
        {...props}
      />,
    );
    return handlers;
  };
  const row = (key) =>
    screen
      .getAllByTestId("review-row")
      .find((r) => r.getAttribute("data-key") === key);

  test("one row per part, each You chose or Proposed, the count and the plan's buttons", () => {
    show();
    const card = screen.getByTestId("wizard-review");
    expect(card).toHaveTextContent("Shopping List (3 items)");
    expect(card).toHaveTextContent("New widget");
    expect(card).toHaveTextContent("8 of 8 set");
    expect(row("reads")).toHaveTextContent("Home Assistant MCP · Tools (MCP)");
    expect(row("reads")).toHaveTextContent("You chose");
    expect(row("shows")).toHaveTextContent("Proposed");
    expect(row("where")).toHaveTextContent(WHERE);
    // The cell is the one the user clicked: nothing to change there.
    expect(
      within(row("where")).queryByRole("button", { name: /Change/ }),
    ).toBeNull();
    expect(
      within(card).getByRole("button", { name: "Yes, build it" }),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent("Nothing is built until you say yes");
  });

  test("Change on Reads from opens the provider window; What it shows goes to Looks; the checks to the chat", () => {
    const h = show();
    fireEvent.click(
      within(row("reads")).getByRole("button", { name: "Change Reads from" }),
    );
    expect(h.onChoose).toHaveBeenCalled();
    fireEvent.click(
      within(row("shows")).getByRole("button", {
        name: "Change What it shows",
      }),
    );
    expect(h.onStep).toHaveBeenCalledWith("looks");
    fireEvent.click(
      within(row("checks")).getByRole("button", {
        name: "Change Checked before it's yours",
      }),
    );
    expect(h.onChat).toHaveBeenCalledWith("Checked before it's yours");
  });

  test("settings change in place, and a new one can be added", () => {
    const h = show();
    fireEvent.click(
      within(row("settings")).getByRole("button", {
        name: "Change Settings you can change",
      }),
    );
    const editor = screen.getByTestId("review-settings-editor");
    fireEvent.change(within(editor).getByDisplayValue("3"), {
      target: { value: "5" },
    });
    fireEvent.click(
      within(editor).getByRole("button", { name: "+ Add a setting" }),
    );
    const [name, startsAs] = within(editor).getAllByRole("textbox").slice(-2);
    fireEvent.change(name, { target: { value: "List title" } });
    fireEvent.change(startsAs, { target: { value: "Groceries" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Add" }));
    fireEvent.click(
      within(row("settings")).getByRole("button", {
        name: "Done changing Settings you can change",
      }),
    );
    // A number stays a number; a new one's name is as the widget declares it.
    expect(h.onSettings).toHaveBeenCalledWith({
      todoEntityId: "todo.shopping_list",
      maxItems: 5,
      listTitle: "Groceries",
    });
  });

  test("a decimal can be typed; on / off is a switch and stays true / false", () => {
    const plan = withSpec({
      settings: { scale: 1, showDone: false },
    });
    const h = show({ plan });
    fireEvent.click(
      within(row("settings")).getByRole("button", {
        name: "Change Settings you can change",
      }),
    );
    const editor = screen.getByTestId("review-settings-editor");
    const scale = within(editor).getByDisplayValue("1");
    fireEvent.change(scale, { target: { value: "2." } });
    expect(scale).toHaveValue("2.");
    fireEvent.change(scale, { target: { value: "2.5" } });
    fireEvent.click(within(editor).getByRole("switch"));
    fireEvent.click(
      within(row("settings")).getByRole("button", {
        name: "Done changing Settings you can change",
      }),
    );
    expect(h.onSettings).toHaveBeenCalledWith({ scale: 2.5, showDone: true });
  });

  test("not picked yet: Choose, the count says so, and the footer says what's first", () => {
    const h = show({ plan: withSpec({ provider: {} }), picked: [] });
    const card = screen.getByTestId("wizard-review");
    expect(card).toHaveTextContent("7 of 8 set · 1 to choose");
    expect(card).toHaveTextContent("Choose what it reads from first");
    expect(row("reads").getAttribute("data-set")).toBe("false");
    fireEvent.click(
      within(row("reads")).getByRole("button", { name: "Choose" }),
    );
    expect(h.onChoose).toHaveBeenCalled();
  });

  test("the step bar marks Review & build, with what was picked done", () => {
    render(<StepBar current="review" done={{ reads: "Home Assistant MCP" }} />);
    const bar = screen.getByTestId("wizard-steps");
    expect(bar).toHaveTextContent("Reads from· Home Assistant MCP");
    expect(
      within(bar).getByText("Review & build").closest("[aria-current]"),
    ).toHaveAttribute("aria-current", "step");
  });

  test("the sketch shows the sample lines", () => {
    render(
      <ReviewSketch sketch={sketchOf(withSpec().pieces[0])} where={WHERE} />,
    );
    const sketch = screen.getByTestId("wizard-sketch");
    expect(sketch).toHaveTextContent("How it will look");
    expect(sketch).toHaveTextContent("MilkEggsBread");
  });
});
