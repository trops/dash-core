/**
 * TeamOverview (DASH-120): a dashboard team's page reads top to bottom:
 * Set up this team, How jobs run, then the bots.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { TeamOverview } from "./TeamOverview";
import { _resetSetupStore } from "../Bots/teamSetupStore";

afterEach(() => {
  delete window.mainApi;
  _resetSetupStore();
});

const bots = [
  {
    id: "b1",
    name: "Workspace Bot",
    workspaceId: "7",
    settings: [{ name: "workFolder", label: "Work folder", required: true }],
  },
  { id: "b2", name: "Coder", workspaceId: "7" },
];

it("puts the Set up checklist first, then How jobs run, then the bots", () => {
  window.mainApi = { bots: {} };
  const team = {
    key: "team:7",
    kind: "team",
    name: "My team",
    workspace: { id: "7", name: "My team" },
    lead: null,
    allMembers: bots,
  };
  const { container } = render(<TeamOverview team={team} />);
  const text = container.textContent;
  const a = text.indexOf("Set up this team");
  const b = text.indexOf("How jobs run");
  const c = text.indexOf("Bots on this team");
  expect(a).toBeGreaterThan(-1);
  expect(a).toBeLessThan(b);
  expect(b).toBeLessThan(c);
  expect(screen.getByTestId("team-setup")).toContainElement(
    screen.getByTestId("team-setup-checklist"),
  );
  // The checklist says what the banner did.
  expect(screen.queryByTestId("team-setup-banner")).toBeNull();
});
