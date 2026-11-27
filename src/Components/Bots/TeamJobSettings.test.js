/**
 * TeamJobSettings (DASH-81): a team's "One job at a time", on unless the
 * team turned it off, saved as soon as it's switched.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  TeamJobSettings,
  oneJobAtATimeOf,
  ONE_JOB_HELP,
  usesHandoffsOf,
  setupView,
  selfTestLine,
  HANDOFF_HELP,
} from "./TeamJobSettings";

afterEach(() => {
  delete window.mainApi;
});

function withApi(settings = {}) {
  const calls = [];
  window.mainApi = {
    bots: {
      getTeamSettings: jest.fn(async () => settings),
      setOneJobAtATime: jest.fn(async (ws, on) => calls.push([ws, on])),
      setUsesHandoffs: jest.fn(async (ws, on) =>
        calls.push(["handoffs", ws, on]),
      ),
    },
  };
  return calls;
}

describe("TeamJobSettings", () => {
  it("is on unless the team turned it off", () => {
    expect(oneJobAtATimeOf({})).toBe(true);
    expect(oneJobAtATimeOf(null)).toBe(true);
    expect(oneJobAtATimeOf({ oneJobAtATime: true })).toBe(true);
    expect(oneJobAtATimeOf({ oneJobAtATime: false })).toBe(false);
  });

  it("shows the team's setting and saves a change at once", async () => {
    const calls = withApi({ oneJobAtATime: false });
    render(<TeamJobSettings workspaceId="7" />);
    expect(await screen.findByText(ONE_JOB_HELP.off)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "One job at a time" }));
    await waitFor(() => expect(calls).toEqual([["7", true]]));
    expect(screen.getByText(ONE_JOB_HELP.on)).toBeInTheDocument();
  });

  it("has the standard handoff off unless turned on (DASH-101)", async () => {
    expect(usesHandoffsOf({})).toBe(false);
    expect(usesHandoffsOf({ usesHandoffs: true })).toBe(true);
    const calls = withApi({});
    render(<TeamJobSettings workspaceId="7" />);
    expect(await screen.findByText(HANDOFF_HELP.off)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Standard handoff" }));
    await waitFor(() => expect(calls).toEqual([["handoffs", "7", true]]));
    expect(screen.getByText(HANDOFF_HELP.on)).toBeInTheDocument();
  });
});

describe("Check setup (DASH-108)", () => {
  it("says a good setup, or each problem", () => {
    expect(setupView(null)).toBeNull();
    expect(setupView({ ok: true, problems: [] })).toMatchObject({
      ok: true,
      title: "The setup is good.",
      lines: [],
      offLine: "",
    });
    expect(
      setupView({ ok: false, problems: [{ message: "A" }, { message: "B" }] }),
    ).toMatchObject({
      ok: false,
      title: "2 problems to fix:",
      lines: ["A", "B"],
    });
    // Commands that came with a package and are off (DASH-125).
    const off = setupView({
      ok: true,
      problems: [],
      off: [{ botId: "c", bot: "Coder", command: "npm test" }],
    });
    expect(off.title).toBe("1 problem to fix:");
    expect(off.lines).toEqual([
      "1 command that came with the package is off: npm test (Coder). Until it's on, that check waits for your approval.",
    ]);
    expect(setupView({ error: "Nope" }).title).toBe("Nope");
  });
});

describe("Self-test (DASH-109)", () => {
  it("says the untested change, or when it was tested", () => {
    expect(selfTestLine({ untested: { what: "Reporter changed" } })).toBe(
      "Untested change: Reporter changed. Run a self-test before real work.",
    );
    expect(selfTestLine({})).toBe("Not tested yet.");
    expect(selfTestLine({ lastTest: { at: "2026-11-27T00:00:00Z" } })).toMatch(
      /^Tested /,
    );
  });
});

describe("How jobs run (DASH-120)", () => {
  it("has a heading, and each switch's error under its own row", async () => {
    window.mainApi = {
      bots: {
        getTeamSettings: jest.fn(async () => ({})),
        setOneJobAtATime: jest.fn(async () => {}),
        setUsesHandoffs: jest.fn(async () => ({ error: "No can do." })),
      },
    };
    render(<TeamJobSettings workspaceId="7" />);
    expect(screen.getByText("How jobs run")).toBeInTheDocument();
    expect(
      screen.getByText("Bots pass work in a standard format (recommended)"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Standard handoff" }));
    const err = await screen.findByTestId("handoff-error");
    expect(err).toHaveTextContent("No can do.");
    expect(screen.getByTestId("team-handoff-setting")).toContainElement(err);
    expect(screen.queryByTestId("one-job-error")).toBeNull();
  });

  it("says what the handoff is for; its format is under Learn more (DASH-129)", async () => {
    window.mainApi = {
      bots: {
        getTeamSettings: jest.fn(async () => ({ usesHandoffs: true })),
      },
    };
    render(<TeamJobSettings workspaceId="7" />);
    const row = screen.getByTestId("team-handoff-setting");
    expect(
      await within(row).findByText(
        "Dash checks each handoff, stops when there's nothing to do, and brings a bot's question to you as a card.",
      ),
    ).toBeInTheDocument();
    expect(row).not.toHaveTextContent("JSON");
    fireEvent.click(within(row).getByText("Learn more"));
    expect(row).toHaveTextContent("one JSON block");
    fireEvent.click(within(row).getByText("Show less"));
    expect(row).not.toHaveTextContent("JSON");
  });
});
