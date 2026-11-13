/**
 * Steps 2 and 3 of the widget wizard (the approved "Widget, step by step"
 * does and talks-step frames): what it can change, its settings and how
 * often it reads; what it sends and what it listens for. The user's
 * choices hold over every plan, and are what's built.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { StepDoes, doesQuestion } from "./StepDoes";
import { StepTalks } from "./StepTalks";
import { carryChoices } from "../useWorkspacePlan";
import {
  REFRESH_CHOICES,
  applyChoices,
  changeTools,
  chosenParts,
  listenChoices,
  listenersFor,
  proposedSends,
  refreshChoices,
  reviewRows,
  settingKind,
  silentBots,
  standardSends,
} from "./widgetSpec";

const PROVIDERS = {
  "Google Calendar": {
    name: "Google Calendar",
    type: "google-calendar",
    providerClass: "mcp",
    allowedTools: [
      "list-calendars",
      "list-events",
      "create-event",
      "update-event",
      "delete-event",
    ],
  },
};

const CALENDAR = {
  kind: "widget",
  name: "Today's calendar",
  source: "new",
  providers: ["google-calendar"],
  provider: { "google-calendar": "Google Calendar" },
  settings: { calendar: "primary", daysShown: 1, showDeclined: false },
  shows: "Today's events as a list: time, title, place",
  whenEmpty: "Nothing on your calendar today",
  reads: ["list-events"],
  changes: [],
  refresh: "every 5 minutes",
  events: ["eventClicked", "eventStartingSoon"],
  sends: [
    {
      event: "eventClicked",
      when: "when you click an event",
      carries: "its title, start, end and place",
    },
    {
      event: "eventStartingSoon",
      when: "when the next event is 15 minutes away",
      carries: "the event",
    },
  ],
};
const planOf = (piece) => ({
  summary: "A calendar for today",
  pieces: [piece],
  checks: ["Shows today's events"],
  cell: { cellNumber: "1.2" },
});

// The dashboard's bots, as useBotEmitters gives them (getBotEmitters).
const BOTS = [
  {
    key: "bot:local/recipe-bot|bot_recipe",
    component: "bot:local/recipe-bot",
    itemId: "bot_recipe",
    label: "Recipe Bot (bot)",
    name: "Recipe Bot",
    events: ["completed", "failed", "result.meal"],
    eventLabels: {
      completed: "Completed",
      failed: "Failed",
      "result.meal": "planned meal (result)",
    },
  },
  {
    key: "bot:local/quiet|bot_quiet",
    component: "bot:local/quiet",
    itemId: "bot_quiet",
    label: "Quiet Bot (bot)",
    name: "Quiet Bot",
    events: ["completed", "failed"],
    eventLabels: { completed: "Completed", failed: "Failed" },
  },
];

describe("the model: steps 2 and 3", () => {
  test("what it can change: the provider's tools that change things, as actions", () => {
    expect(changeTools(CALENDAR, PROVIDERS).map((t) => t.label)).toEqual([
      "Create event",
      "Update event",
      "Delete event",
    ]);
  });

  test("updates: the three, the Planner's words matched; reads when opened if unsaid", () => {
    expect(refreshChoices(CALENDAR)).toEqual({
      options: REFRESH_CHOICES,
      value: "Every 5 minutes",
    });
    const own = refreshChoices({ refresh: "every 10 minutes" });
    expect(own.options[0]).toBe("Every 10 minutes");
    expect(own.value).toBe("Every 10 minutes");
    expect(refreshChoices({}).value).toBe("Only when I open it");
  });

  test("a setting's kind, in words", () => {
    expect(settingKind(false)).toBe("On / off");
    expect(settingKind(3)).toBe("Number");
    expect(settingKind("primary")).toBe("Text");
    expect(settingKind(["a"])).toBe("List");
  });

  test("every widget sends Dash's three; this one's own are proposed, each with when and what", () => {
    expect(standardSends("Google Calendar").map((s) => s.event)).toEqual([
      "readComplete",
      "renderComplete",
      "readFailed",
    ]);
    expect(standardSends("Google Calendar")[0].when).toBe(
      "When it has read from Google Calendar",
    );
    expect(proposedSends(CALENDAR, ["eventStartingSoon"])).toEqual([
      {
        event: "eventClicked",
        when: "When you click an event",
        carries: "its title, start, end and place",
        on: true,
      },
      {
        event: "eventStartingSoon",
        when: "When the next event is 15 minutes away",
        carries: "the event",
        on: false,
      },
    ]);
    // Dash's own are never proposed as the widget's.
    expect(
      proposedSends({ events: ["readComplete", "itemAdded"] }).map(
        (s) => s.event,
      ),
    ).toEqual(["itemAdded"]);
  });

  test("it can listen for the results the dashboard's bots send", () => {
    expect(listenChoices(BOTS)).toEqual([
      {
        key: "bot_recipe:meal",
        bot: "Recipe Bot",
        botId: "bot_recipe",
        ref: "local/recipe-bot",
        result: "meal",
        label: "planned meal",
        handler: "showRecipeBotMeal",
      },
    ]);
    expect(silentBots(BOTS)).toEqual(["Quiet Bot"]);
  });

  test("a cell's widget: its listeners, as its layout item keeps them", () => {
    expect(
      listenersFor({
        listens: [
          {
            bot: "Recipe Bot",
            botId: "bot_recipe",
            ref: "local/recipe-bot",
            result: "meal",
            handler: "showRecipeBotMeal",
          },
        ],
      }),
    ).toEqual({
      showRecipeBotMeal: ["bot:local/recipe-bot[bot_recipe].result.meal"],
    });
    expect(listenersFor(CALENDAR)).toBeNull();
  });

  test("what the user chose holds over the plan, and says You chose", () => {
    const choices = {
      changes: ["create-event"],
      refresh: "Every hour",
      eventsOff: ["eventStartingSoon"],
      listens: [{ bot: "Recipe Bot", botId: "bot_recipe", result: "meal" }],
    };
    const plan = applyChoices(planOf(CALENDAR), 0, choices);
    const p = plan.pieces[0];
    expect(p.changes).toEqual(["create-event"]);
    expect(p.refresh).toBe("Every hour");
    expect(p.events).toEqual(["eventClicked"]);
    expect(p.sends.map((s) => s.event)).toEqual(["eventClicked"]);
    expect(p.listens).toHaveLength(1);
    // Nothing chosen: the plan as it was.
    const same = planOf(CALENDAR);
    expect(applyChoices(same, 0, {})).toBe(same);
    // Picked again: only what the provider it reads from now can do.
    const narrower = {
      "Google Calendar": {
        ...PROVIDERS["Google Calendar"],
        allowedTools: ["list-events", "update-event"],
      },
    };
    expect(
      applyChoices(
        planOf(CALENDAR),
        0,
        { changes: ["create-event", "update-event"] },
        narrower,
      ).pieces[0].changes,
    ).toEqual(["update-event"]);
    const { rows } = reviewRows(plan, p, {
      providers: PROVIDERS,
      picked: ["Google Calendar"],
      edited: chosenParts(choices),
    });
    const tag = (k) => rows.find((r) => r.key === k).tag;
    expect(tag("acts")).toBe("You chose");
    expect(tag("updates")).toBe("You chose");
    expect(tag("talks")).toBe("You chose");
    expect(tag("settings")).toBe("Proposed");
    expect(rows.find((r) => r.key === "talks").value).toEqual([
      "Sends readComplete, renderComplete, readFailed, eventClicked",
    ]);
    expect(rows.find((r) => r.key === "talks").change).toBe("talks");
    expect(rows.find((r) => r.key === "acts").change).toBe("does");
  });
});

describe("Step 2 · What it does, on the screen", () => {
  test("a provider that can do much: the actions about what it reads first, the rest behind a link", () => {
    const HA = {
      "Home Assistant MCP": {
        name: "Home Assistant MCP",
        type: "home-assistant-mcp",
        providerClass: "mcp",
        allowedTools: [
          "ha_get_todo",
          "ha_config_set_todo_item",
          "ha_config_remove_todo_item",
          "ha_config_delete_dashboard",
          "ha_config_remove_automation",
        ],
      },
    };
    const shopping = {
      kind: "widget",
      name: "Shopping List",
      source: "new",
      providers: ["home-assistant-mcp"],
      provider: { "home-assistant-mcp": "Home Assistant MCP" },
      reads: ["ha_get_todo"],
      changes: [],
    };
    expect(changeTools(shopping, HA).map((t) => [t.label, t.related])).toEqual([
      ["Set todo item", true],
      ["Remove todo item", true],
      ["Delete dashboard", false],
      ["Remove automation", false],
    ]);
    render(
      <StepDoes
        piece={shopping}
        providers={HA}
        onNext={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    const acts = () => within(screen.getByTestId("does-acts"));
    expect(acts().getByLabelText("Set todo item")).toBeInTheDocument();
    expect(acts().queryByLabelText("Delete dashboard")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Show 2 other actions",
      }),
    );
    expect(acts().getByLabelText("Delete dashboard")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Hide the other actions" }),
    );
    expect(acts().queryByLabelText("Delete dashboard")).toBeNull();
  });

  test("its actions to tick, the settings table, how often — and Next takes them", () => {
    const onNext = jest.fn();
    render(
      <StepDoes
        piece={CALENDAR}
        providers={PROVIDERS}
        onNext={onNext}
        onBack={jest.fn()}
      />,
    );
    // The question is the Planner's bubble; the card is the answer.
    expect(doesQuestion(CALENDAR, PROVIDERS)).toEqual({
      question: "Can it change anything on Google Calendar?",
      why: expect.stringMatching(/^Each one you tick becomes a button/),
    });
    expect(screen.getByText("Buttons in the widget")).toBeInTheDocument();
    // Nothing ticked: the Planner proposed it only reads.
    const acts = within(screen.getByTestId("does-acts"));
    expect(acts.getByLabelText("Create event")).not.toBeChecked();
    fireEvent.click(acts.getByLabelText("Create event"));
    // The settings: name, starts as, kind.
    const rows = screen.getAllByTestId("setting-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Calendar"),
      expect.stringContaining("Days shown"),
      expect.stringContaining("Show declined"),
    ]);
    expect(within(rows[1]).getByText("Number")).toBeInTheDocument();
    expect(within(rows[2]).getByText("On / off")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Days shown"), {
      target: { value: "3" },
    });
    // Updates.
    fireEvent.click(screen.getByRole("radio", { name: "Every hour" }));
    fireEvent.click(screen.getByRole("button", { name: "Next: talks to" }));
    expect(onNext).toHaveBeenCalledWith({
      changes: ["create-event"],
      settings: { calendar: "primary", daysShown: 3, showDeclined: false },
      refresh: "Every hour",
    });
  });

  test("a provider with nothing to change with: it only reads; Back goes back", () => {
    const onBack = jest.fn();
    render(
      <StepDoes
        piece={{ ...CALENDAR, changes: undefined }}
        providers={{
          "Google Calendar": {
            ...PROVIDERS["Google Calendar"],
            allowedTools: ["list-events"],
          },
        }}
        onNext={jest.fn()}
        onBack={onBack}
      />,
    );
    expect(screen.getByTestId("wizard-does")).toHaveTextContent(
      "None — Google Calendar has nothing a widget could change with.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("Step 3 · Talks to, on the screen", () => {
  const renderTalks = (over = {}) => {
    const onNext = jest.fn();
    const onDescribe = jest.fn();
    render(
      <StepTalks
        plannedPiece={CALENDAR}
        piece={CALENDAR}
        botEmitters={BOTS}
        dashboardName="Shopping List"
        readsFrom="Google Calendar"
        onNext={onNext}
        onBack={jest.fn()}
        onDescribe={onDescribe}
        {...over}
      />,
    );
    return { onNext, onDescribe };
  };

  test("Dash's three, always on; its own ticked; the bots' results to tick", () => {
    const { onNext } = renderTalks();
    // Folded into one line; Show lists them.
    expect(screen.queryAllByTestId("talks-always")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const always = screen.getAllByTestId("talks-always");
    expect(always.map((r) => r.textContent)).toEqual([
      expect.stringContaining("readComplete"),
      expect.stringContaining("renderComplete"),
      expect.stringContaining("readFailed"),
    ]);
    expect(within(always[0]).queryByRole("checkbox")).toBeNull();
    expect(screen.getByLabelText("When you click an event")).toBeChecked();
    fireEvent.click(
      screen.getByLabelText("When the next event is 15 minutes away"),
    );
    expect(
      screen.getByText(/what the bots on Shopping List send/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Recipe Bot's planned meal"));
    fireEvent.click(screen.getByRole("button", { name: "Next: looks" }));
    expect(onNext).toHaveBeenCalledWith({
      eventsOff: ["eventStartingSoon"],
      listens: [
        {
          bot: "Recipe Bot",
          botId: "bot_recipe",
          ref: "local/recipe-bot",
          result: "meal",
          handler: "showRecipeBotMeal",
        },
      ],
    });
  });

  test("no bots with results: it says so; nothing is a fine answer; Describe it goes to the chat", () => {
    const { onNext, onDescribe } = renderTalks({ botEmitters: [] });
    expect(
      screen.getByText("Nothing yet — there are no bots on Shopping List."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Describe it" }));
    expect(onDescribe).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next: looks" }));
    expect(onNext).toHaveBeenCalledWith({ eventsOff: [], listens: [] });
  });

  test("bots that send no results are named; still loading says so", () => {
    renderTalks({ botEmitters: [BOTS[1]] });
    expect(
      screen.getByText(
        /The bots on Shopping List \(Quiet Bot\) send no results/,
      ),
    ).toBeInTheDocument();
  });

  test("while the bots load: what it listens for stays as it is", () => {
    const listens = [
      { bot: "Recipe Bot", botId: "bot_recipe", result: "meal" },
    ];
    const { onNext } = renderTalks({
      botEmitters: null,
      piece: { ...CALENDAR, listens },
    });
    expect(screen.getByText("Looking for its bots…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next: looks" }));
    expect(onNext).toHaveBeenCalledWith({ eventsOff: [], listens });
  });

  test("not on a dashboard: it says so", () => {
    renderTalks({ botEmitters: [], hasDashboard: false });
    expect(screen.getByText(/It isn't on a dashboard yet/)).toBeInTheDocument();
  });
});

describe("a new plan from the Planner: the user's choices stay with their widget", () => {
  const carried = {
    wizardStage: "review",
    choicesFor: "today's calendar",
    choices: {
      changes: ["create-event"],
      refresh: "Every hour",
      settings: { daysShown: 3 },
      eventsOff: ["eventStartingSoon"],
    },
  };
  test("the same widget: kept, but a part the Planner changed is its own", () => {
    const next = planOf({ ...CALENDAR, refresh: "every 10 minutes" });
    const out = carryChoices(carried, planOf(CALENDAR), next);
    expect(out.wizardStage).toBe("review");
    expect(out.choices.refresh).toBeUndefined();
    expect(out.choices.changes).toEqual(["create-event"]);
    expect(out.choices.settings).toEqual({ daysShown: 3 });
    expect(out.choices.eventsOff).toEqual(["eventStartingSoon"]);
  });
  test("a setting the Planner changed is its own; the others stay the user's", () => {
    const next = planOf({
      ...CALENDAR,
      settings: { ...CALENDAR.settings, daysShown: 7 },
    });
    expect(
      carryChoices(
        {
          ...carried,
          choices: { settings: { daysShown: 3, calendar: "work" } },
        },
        planOf(CALENDAR),
        next,
      ).choices.settings,
    ).toEqual({ calendar: "work" });
  });
  test("another widget in the same conversation starts its own steps", () => {
    const weather = planOf({ kind: "widget", name: "Weather", source: "new" });
    expect(carryChoices(carried, planOf(CALENDAR), weather)).toEqual({
      wizardStage: null,
      choices: {},
      choicesFor: null,
    });
  });
  test("an event the Planner no longer proposes isn't kept off", () => {
    const next = planOf({ ...CALENDAR, events: ["eventClicked"] });
    expect(
      carryChoices(carried, planOf(CALENDAR), next).choices.eventsOff,
    ).toEqual([]);
  });
});
