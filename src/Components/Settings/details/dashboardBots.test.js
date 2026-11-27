/**
 * A registry dashboard's bots in words, and the publish screen's bots list
 * (create-entry phase 5a-2, US-027 AC2/AC3/AC8).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  teamLines,
  installedText,
  needsTeamSetup,
  opensTeamSetup,
  installButtons,
  installWaitingText,
} from "./dashboardBots";
import { PublishBotsList } from "./PublishDashboardModal";

jest.mock("../../../ComponentManager", () => ({
  ComponentManager: { config: () => null },
}));

const team = {
  members: [
    { role: "greeter", name: "Greeter" },
    { role: "poster", name: "Poster" },
  ],
  wiring: [
    { role: "poster", on: { role: "greeter", event: "result.greeting" } },
  ],
};

test("teamLines: each bot, and how they work together", () => {
  expect(teamLines(team)).toEqual({
    bots: ["Greeter", "Poster"],
    links: ["Poster runs when Greeter sends its greeting result"],
  });
  expect(teamLines(null)).toEqual({ bots: [], links: [] });
});

test("installedText: bots added paused, what wasn't wired, or why none", () => {
  expect(installedText({ workspace: { name: "Ask" }, summary: {} }, "x")).toBe(
    'Dashboard "Ask" installed successfully.',
  );
  expect(
    installedText(
      {
        workspace: { name: "Ask" },
        summary: {
          bots: {
            installed: [{ id: 1 }, { id: 2 }],
            unwired: ["showGreeting (that widget isn't on the dashboard)"],
          },
        },
      },
      "x",
    ),
  ).toBe(
    'Dashboard "Ask" installed successfully. 2 bots added — paused; resume them on the Bots page. Not wired: showGreeting (that widget isn\'t on the dashboard).',
  );
  expect(
    installedText(
      { summary: { bots: { error: "Bots aren't available" } } },
      "Pkg",
    ),
  ).toBe(
    "Dashboard \"Pkg\" installed successfully. Its bots couldn't be added: Bots aren't available",
  );
});

test("PublishBotsList: bots with what starts them; Include toggles", () => {
  const onInclude = jest.fn();
  const bots = [
    {
      role: "greeter",
      name: "Greeter",
      starts: ["on a schedule"],
      providers: ["gmail"],
    },
  ];
  const { rerender } = render(
    <PublishBotsList
      bots={bots}
      notIncluded={["a trigger"]}
      include
      onInclude={onInclude}
    />,
  );
  expect(screen.getByTestId("publish-bots")).toHaveTextContent(
    "Greeter — starts on a schedule · uses gmail",
  );
  expect(screen.getByText("Not included: a trigger")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Include this dashboard's 1 bot"));
  expect(onInclude).toHaveBeenCalledWith(false);
  rerender(
    <PublishBotsList bots={bots} include={false} onInclude={onInclude} />,
  );
  expect(screen.queryByText(/Greeter/)).toBeNull();
});

describe("needsTeamSetup (DASH-118)", () => {
  const ws = { id: 12, name: "Factory" };
  it("a fresh install whose team or bots still need settings lands on its setup", () => {
    expect(
      needsTeamSetup({
        workspace: ws,
        summary: { bots: { installed: [{}], needsSettings: ["Repo URL"] } },
      }),
    ).toBe(true);
    expect(
      needsTeamSetup({
        workspace: ws,
        summary: {
          bots: {
            installed: [{}],
            botsNeedSettings: [
              { botId: "b", name: "Workspace Bot", missing: [{}] },
            ],
          },
        },
      }),
    ).toBe(true);
  });
  it("not when nothing is missing, its bots failed, or there's no dashboard", () => {
    expect(
      needsTeamSetup({ workspace: ws, summary: { bots: { installed: [{}] } } }),
    ).toBe(false);
    expect(
      needsTeamSetup({
        workspace: ws,
        summary: { bots: { error: "x", needsSettings: ["A"] } },
      }),
    ).toBe(false);
    expect(
      needsTeamSetup({ summary: { bots: { needsSettings: ["A"] } } }),
    ).toBe(false);
    expect(needsTeamSetup(null)).toBe(false);
  });
});

describe("the install dialog's choice (DASH-130)", () => {
  const ws = { id: 7 };
  const filled = { workspace: ws, summary: { bots: { installed: [{}] } } };
  const missing = {
    workspace: ws,
    summary: { bots: { installed: [{}], needsSettings: ["Repo URL"] } },
  };

  it("fill in later never lands on Set up; open Set up always does", () => {
    expect(opensTeamSetup(missing, false)).toBe(false);
    expect(opensTeamSetup(filled, true)).toBe(true);
    expect(opensTeamSetup(missing, true)).toBe(true);
    // No choice made: DASH-118's rule.
    expect(opensTeamSetup(filled, undefined)).toBe(false);
    expect(opensTeamSetup(missing, undefined)).toBe(true);
    // Nothing to open.
    expect(opensTeamSetup({ summary: { bots: {} } }, true)).toBe(false);
    expect(
      opensTeamSetup(
        { workspace: ws, summary: { bots: { error: "x" } } },
        true,
      ),
    ).toBe(false);
    expect(opensTeamSetup(null, true)).toBe(false);
  });

  it("buttons: one Install without a team; fill in later while missing", () => {
    expect(installButtons({}).map((b) => b.title)).toEqual(["Install"]);
    expect(
      installButtons({ hasTeam: true, missing: true }).map((b) => [
        b.title,
        b.openSetup,
        b.primary,
      ]),
    ).toEqual([
      ["Install, fill in later", false, false],
      ["Install and open Set up", true, true],
    ]);
    expect(installButtons({ hasTeam: true })[0].title).toBe("Install");
  });

  it("says the team won't take work until required settings are filled in", () => {
    expect(installWaitingText({})).toBeNull();
    expect(installWaitingText({ teamMissing: 1 })).toBe(
      "1 required team setting is still empty. The dashboard installs, but its team won't take work until they're filled in. The team's Set up shows what's left.",
    );
    expect(installWaitingText({ teamMissing: 2, botsWaiting: 1 })).toMatch(
      /^Team settings and 1 bot still need filling in\./,
    );
    expect(installWaitingText({ botsWaiting: 2 })).toMatch(
      /^2 bots still need settings\. .*those bots wait until they're filled in\./,
    );
  });
});
