/**
 * Step 4 · Looks (the approved "Widget, step by step" looks and tweak
 * frames): ways the widget could look, drawn with Dash's own components
 * from the user's real data — or the plan's sample, said so — then the
 * picked one changed live, no AI.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { StepLooks, shortError } from "./StepLooks";
import {
  shownLimit,
  argsFromSettings,
  defaultOptions,
  fieldRoles,
  itemsFrom,
  looksFor,
  optionControls,
  lookById,
  timeText,
} from "./widgetLooks";
import { applyChoices, previewRead } from "./widgetSpec";

const mockCall = jest.fn();
let mockMcp = {};
jest.mock("../../../hooks/useMcpProvider", () => ({
  useMcpProvider: () => mockMcp,
}));

// What a calendar's list-events returns (MCP text content, JSON).
const EVENTS = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        items: [
          {
            id: "a1",
            summary: "Standup",
            start: { dateTime: "2026-11-12T09:00:00" },
            location: "Video call",
          },
          {
            id: "a2",
            summary: "Lunch with Sam",
            start: { dateTime: "2026-11-12T12:30:00" },
            location: "Café Luna",
          },
        ],
      }),
    },
  ],
};

const SHOPPING = {
  kind: "widget",
  name: "Shopping List",
  source: "new",
  providers: ["home-assistant-mcp"],
  provider: { "home-assistant-mcp": "Home Assistant MCP" },
  reads: ["ha_get_todo"],
  sample: ["Milk", "Eggs", "Bread"],
  whenEmpty: "Nothing on the list",
};
const HA = {
  "Home Assistant MCP": {
    name: "Home Assistant MCP",
    type: "home-assistant-mcp",
    providerClass: "mcp",
    allowedTools: ["ha_get_todo", "ha_config_set_todo_item"],
  },
};

beforeEach(() => {
  mockCall.mockReset();
  mockMcp = { isConnected: false, error: null, callTool: mockCall };
});

describe("the model: what it shows, from what was read", () => {
  test("a JSON result: its first list, each field as text", () => {
    const items = itemsFrom(EVENTS);
    expect(items).toEqual([
      {
        id: "a1",
        summary: "Standup",
        start: "2026-11-12T09:00:00",
        location: "Video call",
      },
      {
        id: "a2",
        summary: "Lunch with Sam",
        start: "2026-11-12T12:30:00",
        location: "Café Luna",
      },
    ]);
    const roles = fieldRoles(items);
    expect(roles).toMatchObject({
      title: "summary",
      time: "start",
      place: "location",
    });
    // An id isn't something to show.
    expect(roles.fields).toEqual(["summary", "start", "location"]);
  });

  test("plain lines, and the Planner's sample", () => {
    expect(itemsFrom("- Milk\n- Eggs\n\n3. Bread")).toEqual([
      { title: "Milk" },
      { title: "Eggs" },
      { title: "Bread" },
    ]);
    expect(itemsFrom(["Milk"].join("\n"))).toEqual([{ title: "Milk" }]);
  });

  test("times read as times", () => {
    expect(timeText("2026-11-12T09:00:00")).toMatch(/9:00/);
    expect(timeText("buy soon")).toBe("buy soon");
  });

  test("looks that suit the data come first; times bring Timeline and Next up", () => {
    expect(looksFor({ time: "start" }).map((l) => l.id)).toEqual([
      "list",
      "timeline",
      "next",
      "cards",
      "count",
    ]);
    expect(
      looksFor({ title: "title" })
        .slice(0, 3)
        .map((l) => l.id),
    ).toEqual(["list", "cards", "count"]);
  });

  test("each look's controls; the defaults", () => {
    const roles = { title: "summary", time: "start", place: "location" };
    expect(optionControls(lookById("list"), roles).map((c) => c.label)).toEqual(
      ["Spacing", "Header", "Mark the next one", "Time"],
    );
    expect(
      optionControls(lookById("count"), roles).map((c) => c.label),
    ).toEqual(["Spacing", "Header"]);
    expect(defaultOptions(roles, "Nothing today")).toEqual({
      spacing: "Roomy",
      header: "Title and count",
      markFirst: "On",
      timeAt: "Left column",
      fields: ["summary", "start", "location"],
      empty: "Nothing today",
    });
  });

  test("the read for the previews: the Planner's, else a read tool it uses — never one that changes", () => {
    expect(previewRead(SHOPPING, HA)).toEqual({
      type: "home-assistant-mcp",
      provider: "Home Assistant MCP",
      tool: "ha_get_todo",
      args: {},
      settings: {},
    });
    expect(
      previewRead(
        { ...SHOPPING, preview: { tool: "ha_get_todo", args: { a: 1 } } },
        HA,
      ).args,
    ).toEqual({ a: 1 });
    expect(
      previewRead(
        {
          ...SHOPPING,
          reads: [],
          preview: { tool: "ha_config_set_todo_item" },
        },
        HA,
      ),
    ).toBeNull();
  });
});

describe("Step 4 · Looks, on the screen", () => {
  const show = (props = {}) => {
    const h = {
      onPick: jest.fn(),
      onNext: jest.fn(),
      onBack: jest.fn(),
      onDescribe: jest.fn(),
    };
    const r = render(
      <StepLooks piece={SHOPPING} preview={null} {...h} {...props} />,
    );
    return { ...h, ...r };
  };

  test("three ideas drawn from the sample, said so; more on asking; describe it goes to the chat", () => {
    const h = show();
    expect(screen.getByText(/Using the plan's sample\./)).toBeInTheDocument();
    const ideas = screen.getAllByTestId("look-idea");
    expect(ideas).toHaveLength(3);
    expect(within(ideas[0]).getByText("Milk")).toBeInTheDocument();
    expect(within(ideas[0]).getByText(/Built from:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more ideas" }));
    expect(screen.getAllByTestId("look-idea")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "describe it" }));
    expect(h.onDescribe).toHaveBeenCalled();
  });

  test("pick one: it's kept, then changed live — and Next takes it", () => {
    const h = show();
    fireEvent.click(screen.getByRole("button", { name: "Use List" }));
    expect(h.onPick).toHaveBeenCalledWith({ id: "list", options: null });
    const live = screen.getByTestId("look-live");
    expect(within(live).getByText("3 items")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Title only" }));
    expect(within(live).queryByText("3 items")).toBeNull();
    fireEvent.change(screen.getByLabelText("When there's nothing"), {
      target: { value: "All bought" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: review" }));
    expect(h.onNext).toHaveBeenCalledWith({
      id: "list",
      options: expect.objectContaining({
        header: "Title only",
        empty: "All bought",
        fields: ["title"],
      }),
    });
  });

  test("a look already picked opens as it was left", () => {
    show({
      look: {
        id: "cards",
        options: { ...defaultOptions({ title: "title" }), spacing: "Compact" },
      },
    });
    expect(screen.getByText("Cards · change it")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Compact" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to the ideas" }));
    expect(screen.getAllByTestId("look-idea")).toHaveLength(3);
  });

  test("the user's real data: one read with the provider, drawn when it comes", async () => {
    mockCall.mockResolvedValue(EVENTS);
    mockMcp = { isConnected: true, error: null, callTool: mockCall };
    show({
      piece: { ...SHOPPING, name: "Today" },
      preview: {
        type: "google-calendar",
        provider: "Google Calendar",
        tool: "list-events",
        args: { calendarId: "primary" },
      },
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Using what's in Google Calendar now\./),
      ).toBeInTheDocument(),
    );
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockCall).toHaveBeenCalledWith("list-events", {
      calendarId: "primary",
    });
    expect(screen.getAllByText("Lunch with Sam").length).toBeGreaterThan(0);
  });

  test("a read that fails: the sample, and why", async () => {
    mockCall.mockRejectedValue(new Error("not signed in"));
    mockMcp = { isConnected: true, error: null, callTool: mockCall };
    show({
      preview: {
        type: "home-assistant-mcp",
        provider: "Home Assistant MCP",
        tool: "ha_get_todo",
        args: {},
      },
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          /Home Assistant MCP couldn't be read \(not signed in\)/,
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Milk").length).toBeGreaterThan(0);
  });
});

describe("the mockup check's fixes", () => {
  test("the widget's own limit holds in the previews; Count says how many in all", () => {
    expect(shownLimit({ todoEntityId: "x", maxItems: 3 })).toBe(3);
    expect(shownLimit({ calendar: "primary" })).toBeNull();
    render(
      <StepLooks
        piece={{
          ...SHOPPING,
          settings: { maxItems: 2 },
          sample: ["Milk", "Eggs", "Bread"],
        }}
        preview={null}
        onNext={jest.fn()}
        onBack={jest.fn()}
        onDescribe={jest.fn()}
      />,
    );
    const [list, , count] = screen.getAllByTestId("look-idea");
    expect(within(list).getByText("2 items")).toBeInTheDocument();
    expect(within(list).queryByText("Bread")).toBeNull();
    expect(within(count).getByText("IN ALL")).toBeInTheDocument();
    expect(within(count).getByText("3")).toBeInTheDocument();
  });
});

describe("the review's fixes", () => {
  test("the read's arguments come from the widget's settings that name them", () => {
    const schema = {
      properties: { entity_id: { type: "string" }, status: { type: "string" } },
    };
    expect(
      argsFromSettings(schema, {
        todoEntityId: "todo.shopping_list",
        maxItems: 3,
      }),
    ).toEqual({ entity_id: "todo.shopping_list" });
    expect(argsFromSettings(null, { a: 1 })).toEqual({});
  });

  test("sample lines keep their times and dates; only list marks go", () => {
    expect(
      itemsFrom(
        "9:00 AM  Standup\n- 10:30 Design review\n2026-11-12 Dentist\n3. Bread",
      ),
    ).toEqual([
      { title: "9:00 AM  Standup" },
      { title: "10:30 Design review" },
      { title: "2026-11-12 Dentist" },
      { title: "Bread" },
    ]);
  });

  test("the list under items wins over a sibling list (a calendar's reminders)", () => {
    const r = JSON.stringify({
      kind: "calendar#events",
      defaultReminders: [{ method: "popup", minutes: 10 }],
      items: [{ summary: "Standup" }, { summary: "Lunch" }],
    });
    expect(itemsFrom(r).map((i) => i.summary)).toEqual(["Standup", "Lunch"]);
  });

  test("one JSON block per thing: each is one", () => {
    const result = {
      content: [
        { type: "text", text: JSON.stringify({ name: "Milk" }, null, 2) },
        { type: "text", text: JSON.stringify({ name: "Eggs" }, null, 2) },
      ],
    };
    expect(itemsFrom(result)).toEqual([{ name: "Milk" }, { name: "Eggs" }]);
  });

  test("an event's start, never when it was created; ids and links never the title", () => {
    const roles = fieldRoles([
      {
        calendarId: "primary",
        created: "2026-11-01T10:00:00Z",
        updated: "2026-11-02T10:00:00Z",
        start: "2026-11-12T09:00:00",
        summary: "Standup",
        htmlLink: "https://x",
      },
    ]);
    expect(roles.time).toBe("start");
    expect(roles.title).toBe("summary");
    expect(roles.fields).not.toContain("calendarId");
    expect(roles.fields).not.toContain("htmlLink");
    // Home Assistant states: the friendly name, not on / off.
    expect(
      itemsFrom(
        JSON.stringify([
          {
            entity_id: "light.desk",
            state: "on",
            attributes: { friendly_name: "Desk" },
          },
        ]),
      ),
    ).toEqual([{ entity_id: "light.desk", state: "on", attributes: "Desk" }]);
  });

  test("a tool whose name doesn't say it reads is never called for the previews", () => {
    expect(
      previewRead(
        { ...SHOPPING, reads: ["HassTurnOn"], preview: { tool: "HassTurnOn" } },
        HA,
      ),
    ).toBeNull();
  });

  test("the look's empty words are the widget's (said once to the Builder)", () => {
    const plan = applyChoices({ summary: "x", pieces: [SHOPPING] }, 0, {
      look: { id: "list", options: { empty: "All bought" } },
    });
    expect(plan.pieces[0].whenEmpty).toBe("All bought");
  });

  test("fields picked from other data that this data doesn't have: the defaults", () => {
    render(
      <StepLooks
        piece={SHOPPING}
        preview={null}
        look={{ id: "list", options: { fields: ["friendly_name", "state"] } }}
        onNext={jest.fn()}
        onBack={jest.fn()}
        onDescribe={jest.fn()}
      />,
    );
    expect(screen.getByLabelText("Title")).toBeChecked();
  });

  test("a sample that isn't a list of lines doesn't break the step", () => {
    render(
      <StepLooks
        piece={{ ...SHOPPING, sample: "Milk, Eggs" }}
        preview={null}
        onNext={jest.fn()}
        onBack={jest.fn()}
        onDescribe={jest.fn()}
      />,
    );
    expect(screen.getAllByTestId("look-idea")).toHaveLength(3);
  });

  test("a read that says it failed, in JSON: the sample, and its words", async () => {
    mockCall.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: '{"error":"calendarId is required"}' }],
    });
    mockMcp = { isConnected: true, error: null, callTool: mockCall };
    render(
      <StepLooks
        piece={SHOPPING}
        preview={{
          type: "home-assistant-mcp",
          provider: "Home Assistant MCP",
          tool: "ha_get_todo",
          args: {},
        }}
        onNext={jest.fn()}
        onBack={jest.fn()}
        onDescribe={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/couldn't be read \(.*calendarId is required/),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Milk").length).toBeGreaterThan(0);
  });
});

test("a provider's error in a few words — not its whole reply", () => {
  const reply =
    '{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "API error: 400 - Bad Request", "suggestion": "Verify calendar entity" }, "entity_id": "calendar.home" }';
  expect(shortError(reply)).toBe("API error: 400 - Bad Request");
  expect(shortError("not signed in")).toBe("not signed in");
  expect(shortError("x".repeat(200))).toHaveLength(118);
  expect(shortError("")).toBe("no reason given");
});
