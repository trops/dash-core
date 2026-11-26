/**
 * TeamJobSettings (DASH-81): a team's "One job at a time", on unless the
 * team turned it off, saved as soon as it's switched.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  TeamJobSettings,
  oneJobAtATimeOf,
  ONE_JOB_HELP,
  usesHandoffsOf,
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
