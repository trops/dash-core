/**
 * The user picks which provider a widget reads from (widget step by step,
 * release 1), on the screens: the Planner's question (nothing ticked, a
 * connector off with why, the others one tap away), the plan's Reads from,
 * and Change pinning the plan to the pick.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AppContext } from "../../Context/App/AppContext";
import { PlanChoices, PlanNext, PlanOutput } from "../LeadWorkspace/PlanViews";
import { BuildWalk } from "../LeadWorkspace/BuildViews";
import { buildChecklist } from "./planChecklist";

jest.mock("../../hooks/useRegistryUsername", () => ({
  useRegistryUsername: () => null,
}));

jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));

const PROVIDERS = {
  "Google Calendar": {
    name: "Google Calendar",
    type: "google-calendar",
    providerClass: "mcp",
  },
  "Home Assistant MCP": {
    name: "Home Assistant MCP",
    type: "home-assistant-mcp",
    providerClass: "mcp",
    allowedTools: ["ha_get_state", "ha_config_get_calendar_events"],
  },
  "Google Calendar (Claude connector)": {
    name: "Google Calendar (Claude connector)",
    type: "claude-connector",
    providerClass: "connector",
    allowedTools: ["list_events", "list_calendars"],
  },
  "Web Fetch": { name: "Web Fetch", type: "web-fetch", providerClass: "mcp" },
};

const withApp = (ui, providers = PROVIDERS) => (
  <AppContext.Provider value={{ providers }}>{ui}</AppContext.Provider>
);

const QUESTION = {
  question: "Which should your calendar come from?",
  pick: "providers",
  options: [
    "Google Calendar",
    "Home Assistant MCP",
    "Google Calendar (Claude connector)",
  ],
  reasons: { "Home Assistant MCP": "Calendars in your Home Assistant" },
};

const boxFor = (name) => {
  const row = screen
    .getAllByTestId("provider-pick-row")
    .find((r) => within(r).queryByText(name, { exact: true }));
  return within(row).getByRole("checkbox");
};

const asking = (onAnswer) =>
  render(
    withApp(
      <PlanNext
        next="question"
        plan={{ summary: "x", questions: [QUESTION] }}
        onAnswer={onAnswer}
      />,
    ),
  );

describe("the Planner's provider question", () => {
  test("nothing ticked; a connector off, with why; Use waits for a pick", () => {
    asking(jest.fn());
    expect(screen.getAllByTestId("provider-pick-row")).toHaveLength(3);
    expect(boxFor("Google Calendar")).not.toBeChecked();
    expect(boxFor("Home Assistant MCP")).not.toBeChecked();
    expect(boxFor("Google Calendar (Claude connector)")).toBeDisabled();
    expect(
      screen.getByText("Widgets can't use Claude connectors yet — bots can."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Calendars in your Home Assistant"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this" })).toBeDisabled();
    expect(screen.getByText("Pick at least one")).toBeInTheDocument();
  });

  test("two ticked: Use these 2 sends their exact names", () => {
    const onAnswer = jest.fn();
    asking(onAnswer);
    fireEvent.click(boxFor("Google Calendar"));
    fireEvent.click(boxFor("Home Assistant MCP"));
    fireEvent.click(screen.getByRole("button", { name: "Use these 2" }));
    expect(onAnswer).toHaveBeenCalledWith(
      "Which should your calendar come from? — Google Calendar and Home Assistant MCP",
      "Google Calendar, Home Assistant MCP",
    );
  });

  test("one of the others: shown on request, and the Planner is asked to check it", () => {
    const onAnswer = jest.fn();
    asking(onAnswer);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Show other compatible providers (1)",
      }),
    );
    fireEvent.click(boxFor("Web Fetch"));
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(onAnswer.mock.calls[0][0]).toMatch(
      /— Web Fetch\. \(I picked Web Fetch myself — check it can give what the widget needs/,
    );
  });

  test("the others can be hidden again", () => {
    asking(jest.fn());
    fireEvent.click(
      screen.getByRole("button", {
        name: "Show other compatible providers (1)",
      }),
    );
    expect(screen.getByText("Web Fetch", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("Web Fetch", { exact: true })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Show other compatible providers (1)",
      }),
    ).toBeInTheDocument();
  });
});

describe("the plan names what a widget reads from (the plan sheet)", () => {
  const reused = {
    summary: "x",
    pieces: [
      {
        kind: "widget",
        name: "Google Calendar",
        source: "yours",
        package: "@trops/google-calendar",
        providers: ["google-calendar"],
        provider: { "google-calendar": "Google Calendar" },
      },
    ],
  };
  const wpOf = (plan, over = {}) => ({
    plan,
    checklist: [],
    have: new Set(["google-calendar"]),
    edit: jest.fn(),
    picked: ["Google Calendar"],
    notePicked: jest.fn(),
    ...over,
  });

  test("a provider the Planner named itself isn't chosen: Choose — the app's own list, nothing ticked", () => {
    const wp = wpOf(reused, { picked: [] });
    render(withApp(<PlanOutput wp={wp} />));
    expect(
      screen.getByText("Choose — you have 2 that can do this"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    // Found by its saved tools, not by the AI: Home Assistant for a calendar.
    expect(boxFor("Google Calendar")).not.toBeChecked();
    expect(boxFor("Home Assistant MCP")).not.toBeChecked();
    expect(boxFor("Google Calendar (Claude connector)")).toBeDisabled();
    fireEvent.click(boxFor("Home Assistant MCP"));
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(wp.notePicked).toHaveBeenCalledWith(["Home Assistant MCP"]);
  });

  test("one new widget in a cell: the plan is the widget, part by part — not the cell", () => {
    const plan = {
      summary: "x",
      cell: { cellNumber: "1.3", dashboardName: "Smart Home" },
      pieces: [
        {
          kind: "widget",
          name: "Today's Calendar",
          source: "new",
          providers: ["home-assistant-mcp"],
          provider: { "home-assistant-mcp": "Home Assistant MCP" },
          settings: { maxItems: 5 },
        },
      ],
    };
    render(
      withApp(
        <PlanOutput
          wp={wpOf(plan, { picked: ["Home Assistant MCP"], providers: [] })}
        />,
      ),
    );
    const out = screen.getByTestId("workspace-plan-output");
    expect(out).toHaveTextContent("Planner · the widget");
    expect(out).toHaveTextContent("Today's Calendar");
    expect(out).not.toHaveTextContent("Only the cell you picked changes");
    // Every part, read-only: no Change on the side.
    const rows = within(out).getAllByTestId("review-row");
    expect(rows.map((r) => r.getAttribute("data-key"))).toContain("reads");
    expect(rows.map((r) => r.getAttribute("data-key"))).toContain("settings");
    expect(within(out).queryByRole("button", { name: /^Change/ })).toBeNull();
  });

  test("by name and kind, with Change", () => {
    render(withApp(<PlanOutput wp={wpOf(reused)} />));
    const reads = screen.getByTestId("plan-reads-from");
    expect(within(reads).getByText("Google Calendar")).toBeInTheDocument();
    expect(within(reads).getByText("Tools (MCP)")).toBeInTheDocument();
    expect(
      within(reads).getByRole("button", { name: "Change" }),
    ).toBeInTheDocument();
  });

  test("Change to two providers: the plan makes a new widget reading both", () => {
    const wp = wpOf(reused);
    render(withApp(<PlanOutput wp={wp} />));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const dialog = screen.getByTestId("choose-provider");
    expect(boxFor("Google Calendar")).toBeChecked();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: /Show other compatible providers/,
      }),
    );
    fireEvent.click(boxFor("Home Assistant MCP"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Use these 2" }),
    );
    const [next, note] = wp.edit.mock.calls[0];
    expect(next.pieces[0]).toMatchObject({
      source: "new",
      provider: {
        "google-calendar": "Google Calendar",
        "home-assistant-mcp": "Home Assistant MCP",
      },
    });
    expect(note).toMatch(/build it new/);
  });

  test("a widget with two kinds: changing one keeps the other (its only one starts ticked)", () => {
    const two = {
      ...PROVIDERS,
      "Google Calendar (Work)": {
        name: "Google Calendar (Work)",
        type: "google-calendar",
        providerClass: "mcp",
      },
    };
    const plan = {
      summary: "x",
      pieces: [
        {
          kind: "widget",
          name: "Day",
          source: "new",
          providers: ["google-calendar", "web-fetch"],
        },
      ],
    };
    const wp = wpOf(plan, {
      have: new Set(["google-calendar", "web-fetch"]),
      picked: ["Web Fetch"],
    });
    render(withApp(<PlanOutput wp={wp} />, two));
    fireEvent.click(screen.getAllByRole("button", { name: "Choose" })[0]);
    // Web Fetch, picked before: already ticked.
    expect(boxFor("Web Fetch")).toBeChecked();
    fireEvent.click(boxFor("Google Calendar (Work)"));
    fireEvent.click(screen.getByRole("button", { name: "Use these 2" }));
    expect(wp.edit.mock.calls[0][0].pieces[0].provider).toEqual({
      "google-calendar": "Google Calendar (Work)",
      "web-fetch": "Web Fetch",
    });
  });

  test("two of one kind: ticking the second swaps the first", () => {
    const two = {
      ...PROVIDERS,
      "Google Calendar (Work)": {
        name: "Google Calendar (Work)",
        type: "google-calendar",
        providerClass: "mcp",
      },
    };
    render(withApp(<PlanOutput wp={wpOf(reused)} />, two));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(boxFor("Google Calendar")).toBeChecked();
    fireEvent.click(boxFor("Google Calendar (Work)"));
    expect(boxFor("Google Calendar")).not.toBeChecked();
    expect(boxFor("Google Calendar (Work)")).toBeChecked();
    expect(
      screen.getByText(/A widget reads one of each kind/),
    ).toBeInTheDocument();
  });

  test("a change to a widget already placed keeps its connection: no Change", () => {
    const plan = {
      summary: "x",
      pieces: [{ ...reused.pieces[0], source: "update" }],
    };
    render(withApp(<PlanOutput wp={wpOf(plan)} />));
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  test("a pin to a provider that's gone isn't a choice", () => {
    const plan = {
      summary: "x",
      pieces: [
        {
          kind: "widget",
          name: "Today",
          source: "new",
          providers: ["google-calendar"],
          provider: { "google-calendar": "Old Calendar" },
        },
      ],
    };
    const two = {
      ...PROVIDERS,
      "Google Calendar (Work)": {
        name: "Google Calendar (Work)",
        type: "google-calendar",
        providerClass: "mcp",
      },
    };
    expect(
      buildChecklist(plan, new Set(["google-calendar"]), two).map(
        (i) => i.kind,
      ),
    ).toEqual(["choose"]);
  });
});

describe("Build: the walk stops for the choice, and goes on once it's made", () => {
  test("Choose what Today reads from opens; picking one edits the plan", () => {
    const two = {
      ...PROVIDERS,
      "Google Calendar (Work)": {
        name: "Google Calendar (Work)",
        type: "google-calendar",
        providerClass: "mcp",
      },
    };
    const plan = {
      summary: "x",
      pieces: [
        {
          kind: "widget",
          name: "Today",
          source: "new",
          providers: ["google-calendar"],
        },
      ],
    };
    const wp = {
      plan,
      checks: {},
      have: new Set(["google-calendar"]),
      checklist: buildChecklist(plan, new Set(["google-calendar"]), two),
      edit: jest.fn(),
      setCheck: jest.fn(),
    };
    const onReady = jest.fn();
    const onCancel = jest.fn();
    render(
      withApp(<BuildWalk wp={wp} onReady={onReady} onCancel={onCancel} />, two),
    );
    expect(
      screen.getByText("What should Today read from?"),
    ).toBeInTheDocument();
    expect(onReady).not.toHaveBeenCalled();
    fireEvent.click(boxFor("Google Calendar (Work)"));
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(wp.edit.mock.calls[0][0].pieces[0].provider).toEqual({
      "google-calendar": "Google Calendar (Work)",
    });
    // Chosen: the walk isn't cancelled — the next plan carries it on.
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("several questions: every answer goes, typed ones too", () => {
  test("one message from the Planner: its words in a bubble, every question in one card", () => {
    render(
      withApp(
        <PlanChoices
          plan={{
            summary: "x",
            questions: [
              { question: "12 or 24 hour?", options: ["12-hour", "24-hour"] },
              { question: "Show the date?", options: ["Yes", "No"] },
            ],
          }}
          onAnswer={jest.fn()}
          onSend={jest.fn()}
          onChange={jest.fn()}
        />,
      ),
    );
    const box = screen.getByTestId("workspace-plan-questions");
    expect(box).toHaveTextContent("Planner");
    expect(box).toHaveTextContent("2 things before I plan it");
    expect(box).not.toHaveTextContent("Dash team asks");
    expect(within(box).getAllByTestId("workspace-plan-question")).toHaveLength(
      2,
    );
  });

  test("a typed answer with a default: filled in, counted, sent — never asked again", () => {
    const onAnswer = jest.fn();
    render(
      withApp(
        <PlanChoices
          plan={{
            summary: "x",
            questions: [
              { question: "12 or 24 hour?", options: ["12-hour", "24-hour"] },
              {
                question: "Which time zone? Leave blank for America/New_York.",
              },
            ],
          }}
          onAnswer={onAnswer}
          onSend={jest.fn()}
          onChange={jest.fn()}
        />,
      ),
    );
    expect(screen.getByLabelText("Your answer")).toHaveValue(
      "America/New_York",
    );
    fireEvent.click(screen.getByRole("button", { name: "12-hour" }));
    expect(screen.getByText("2 of 2 answered")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    expect(onAnswer.mock.calls[0][0]).toBe(
      [
        "12 or 24 hour? — 12-hour",
        "Which time zone? Leave blank for America/New_York. — America/New_York",
      ].join("\n"),
    );
  });

  test("a provider pick, a typed answer and a tap are sent together — with words of your own", () => {
    const onAnswer = jest.fn();
    render(
      withApp(
        <PlanNext
          next="question"
          plan={{
            summary: "x",
            questions: [
              QUESTION,
              { question: "What is the full path to shopping.md?" },
              {
                question: "Checkable?",
                options: ["Just show it", "Tick items off"],
              },
            ],
          }}
          onAnswer={onAnswer}
        />,
      ),
    );
    fireEvent.click(boxFor("Google Calendar"));
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(screen.getByTestId("provider-question-picked")).toHaveTextContent(
      "Google Calendar",
    );
    fireEvent.change(screen.getByLabelText("Your answer"), {
      target: { value: "/Users/me/notes/shopping.md" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Just show it" }));
    fireEvent.change(screen.getByLabelText("Or say it your way"), {
      target: { value: "Call it Groceries" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAnswer.mock.calls[0][0]).toBe(
      [
        "Which should your calendar come from? — Google Calendar",
        "What is the full path to shopping.md? — /Users/me/notes/shopping.md",
        "Checkable? — Just show it",
        "Call it Groceries",
      ].join("\n"),
    );
  });
});

describe("the inline questions (PlanChoices): answers kept, blanks aren't answers", () => {
  test("a pick and a typed answer go together; a blank isn't counted; no Decide while picking a provider", () => {
    const onAnswer = jest.fn();
    render(
      withApp(
        <PlanChoices
          plan={{
            summary: "x",
            questions: [QUESTION, { question: "What is the full path?" }],
          }}
          onSend={jest.fn()}
          onChange={jest.fn()}
          onAnswer={onAnswer}
          onDecide={jest.fn()}
        />,
      ),
    );
    expect(
      screen.queryByRole("button", {
        name: "Decide for me and finish the plan",
      }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Your answer"), {
      target: { value: "   " },
    });
    expect(
      screen.getByText("0 of 2 answered — answer each to send"),
    ).toBeInTheDocument();
    // Not every question answered: nothing to send yet.
    expect(screen.getByRole("button", { name: "Send answers" }).disabled).toBe(
      true,
    );
    fireEvent.click(boxFor("Home Assistant MCP"));
    fireEvent.click(screen.getByRole("button", { name: "Use this" }));
    fireEvent.change(screen.getByLabelText("Or say it your way"), {
      target: { value: "It's in my notes folder" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onAnswer.mock.calls[0][0]).toBe(
      [
        "Which should your calendar come from? — Home Assistant MCP",
        "It's in my notes folder",
      ].join("\n"),
    );
  });
});
