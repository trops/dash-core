/**
 * A registry dashboard's bots in words, and the publish screen's bots list
 * (create-entry phase 5a-2, US-027 AC2/AC3/AC8).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { teamLines, installedText } from "./dashboardBots";
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
