/**
 * Each wizard step checked before it's asked (canvas "The build is held to
 * your choices", frame 3): only what the provider really has is offered.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import {
  askRows,
  boundProblem,
  boundWords,
  missingReads,
  offeredChanges,
  preflight,
  readNotice,
  settingBounds,
} from "./askChecks";
import { proposedSends } from "./widgetSpec";
import { StepDoes } from "./StepDoes";

// A provider that is still starting: it never answers on its own.
jest.mock("../../../hooks/useMcpProvider", () => ({
  useMcpProvider: () => ({ isConnected: false, error: null, tools: [] }),
}));

const providers = [
  {
    name: "Home Assistant MCP",
    type: "homeassistant",
    providerClass: "mcp",
    allowedTools: [],
  },
];
const piece = {
  name: "My Calendar Today",
  providers: ["homeassistant"],
  provider: { homeassistant: "Home Assistant MCP" },
  reads: ["ha_call_service"],
  changes: ["ha_create_event", "ha_make_coffee"],
  settings: { daysAhead: 1, calendar: "calendar.family" },
};
const live = {
  type: "homeassistant",
  status: "live",
  tools: [
    {
      name: "ha_call_service",
      annotations: { readOnlyHint: false },
      inputSchema: {
        properties: {
          days_ahead: { type: "number", minimum: 1, maximum: 7 },
          calendar: {
            type: "string",
            enum: ["calendar.family", "calendar.work"],
          },
        },
      },
    },
    { name: "ha_create_event" },
    { name: "ha_delete_event" },
    { name: "ha_get_state", annotations: { readOnlyHint: true } },
  ],
};

describe("checked before asking — step 2's actions", () => {
  test("only actions the running provider has; a proposed one it hasn't, never", () => {
    const tools = offeredChanges(piece, providers, live).map((t) => t.tool);
    expect(tools).toEqual(
      expect.arrayContaining([
        "ha_call_service",
        "ha_create_event",
        "ha_delete_event",
      ]),
    );
    expect(tools).not.toContain("ha_make_coffee");
    expect(tools).not.toContain("ha_get_state");
  });
  test("before the provider answers, its saved list (when it has one)", () => {
    const saved = [{ ...providers[0], allowedTools: ["ha_create_event"] }];
    const tools = offeredChanges(piece, saved, { status: "reading" }).map(
      (t) => t.tool,
    );
    expect(tools).toEqual(["ha_create_event"]);
  });
  test("reading needs a tool that can change things: said at the question", () => {
    expect(readNotice(piece, providers, live)).toEqual([
      { tool: "ha_call_service", kind: "change" },
    ]);
    expect(
      readNotice({ ...piece, reads: ["ha_get_state"] }, providers, live),
    ).toEqual([]);
  });
  test("a read tool the provider doesn't have", () => {
    expect(
      missingReads({ ...piece, reads: ["ha_nope"] }, providers, live),
    ).toEqual(["ha_nope"]);
    expect(missingReads(piece, providers, { status: "reading" })).toEqual([]);
  });
});

describe("checked before asking — settings held to what their tool takes", () => {
  test("a setting going into a tool's input takes what it takes", () => {
    const b = settingBounds(piece, providers, live);
    expect(b.daysAhead).toMatchObject({ min: 1, max: 7, input: "days_ahead" });
    expect(b.calendar.options).toEqual(["calendar.family", "calendar.work"]);
    expect(boundWords(b.daysAhead)).toBe("1 to 7");
    expect(boundProblem(9, b.daysAhead)).toBe("It takes 1 to 7.");
    expect(boundProblem("3", b.daysAhead)).toBeNull();
    expect(boundProblem("calendar.x", b.calendar)).toMatch(/^Pick one of/);
  });
  test("the review's last check: a chosen tool it hasn't, a value it can't take", () => {
    const problems = preflight(
      { ...piece, settings: { daysAhead: 30 } },
      providers,
      live,
    ).map((p) => p.text);
    expect(problems).toContain(
      "Home Assistant MCP has no ha_make_coffee — untick it on step 2.",
    );
    expect(problems).toContain("Days ahead: It takes 1 to 7.");
    expect(preflight(piece, providers, { status: "reading" })).toEqual([]);
  });
});

describe("checked before asking — the side's rows and step 3", () => {
  test("what was checked, one row each", () => {
    const r = askRows("does", piece, providers, live);
    const mains = r.rows.map((x) => x.main);
    expect(mains[0]).toBe("Home Assistant MCP is running");
    expect(mains).toContain("Reads with ha_call_service");
    expect(mains).toContain("Reading needs ha_call_service");
    expect(mains).toContain("Days ahead: 1 to 7");
    expect(
      askRows("does", piece, providers, { status: "reading" }).rows[0].ok,
    ).toBeNull();
    expect(askRows("does", piece, providers, { status: "none" })).toBeNull();
  });
  test("only event names a widget can send are proposed", () => {
    const sends = proposedSends({
      events: [
        "eventClicked",
        "event clicked!",
        "readComplete",
        "eventClicked",
      ],
    }).map((s) => s.event);
    expect(sends).toEqual(["eventClicked"]);
  });
});

describe("StepDoes, checked before asking", () => {
  test("the notice, real actions only, and settings it can't take hold Next", () => {
    render(
      <StepDoes
        piece={{ ...piece, settings: { daysAhead: 30 } }}
        providers={providers}
        live={live}
        onNext={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByTestId("does-read-notice").textContent).toMatch(
      /To read, it has to use ha_call_service/,
    );
    expect(screen.queryByText(/make coffee/i)).toBeNull();
    expect(screen.getByTestId("setting-problem").textContent).toBe(
      "It takes 1 to 7.",
    );
    expect(
      screen.getByRole("button", { name: "Next: talks to" }).disabled,
    ).toBe(true);
  });
  test("while the provider is asked, it says so", () => {
    render(
      <StepDoes
        piece={piece}
        providers={providers}
        live={{ status: "reading", tools: [] }}
        onNext={() => {}}
        onBack={() => {}}
      />,
    );
    expect(
      screen.getByText(/Checking what Home Assistant MCP can do/),
    ).toBeTruthy();
  });
});

// Found in review: a widget reading from two providers.
describe("checked before asking — two providers", () => {
  const two = [
    ...providers,
    {
      name: "Work Calendar",
      type: "google-calendar",
      providerClass: "mcp",
      allowedTools: ["create_event", "list_events"],
    },
  ];
  const both = {
    ...piece,
    providers: ["homeassistant", "google-calendar"],
    provider: {
      homeassistant: "Home Assistant MCP",
      "google-calendar": "Work Calendar",
    },
    reads: ["ha_call_service", "list_events"],
    changes: ["create_event"],
    settings: {},
  };
  const one = { ...live, type: "homeassistant" };
  test("the other provider's actions still come from its saved list", () => {
    const tools = offeredChanges(both, two, one).map((t) => t.tool);
    expect(tools).toContain("create_event");
    expect(tools).toContain("ha_create_event");
  });
  test("its tools aren't missing, and its chosen action doesn't hold Yes", () => {
    expect(missingReads(both, two, one)).toEqual([]);
    expect(preflight(both, two, one)).toEqual([]);
  });
});

describe("useLiveTools — a provider that never answers", () => {
  test("after the wait, its saved list is used", () => {
    jest.useFakeTimers();
    const { useLiveTools, LIVE_TOOLS_WAIT_MS } = require("./useLiveTools");
    let seen = null;
    const Probe = () => {
      const t = useLiveTools({
        type: "homeassistant",
        name: "Home Assistant MCP",
      });
      seen = t;
      return t.reader;
    };
    render(<Probe />);
    expect(seen.status).toBe("reading");
    const { act } = require("@testing-library/react");
    act(() => {
      jest.advanceTimersByTime(LIVE_TOOLS_WAIT_MS + 10);
    });
    expect(seen.status).toBe("failed");
    expect(seen.error).toMatch(/didn't answer in time/);
    jest.useRealTimers();
  });
});
