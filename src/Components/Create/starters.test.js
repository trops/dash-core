/**
 * Starters (create-entry PRD CRE-002, phase 5b): which registry packages are
 * starters, what a card says, the drawn thumbnail, and a starter as a plan
 * (Remix) — nothing installed or built.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  starterPackages,
  starterCategories,
  starterCard,
  thumbnailGrid,
  starterToPlan,
  remixRequest,
  widgetLabel,
} from "./starters";

jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));

const brief = {
  scope: "trops",
  name: "morning-brief-starter",
  displayName: "Morning Brief",
  description: "Today's meetings and the email that needs you.",
  type: "dashboard",
  category: "productivity",
  tags: ["starter", "productivity"],
  widgets: [{}, {}],
  providerTypes: ["gmail", "google-calendar"],
  team: { members: [{ role: "morning-briefer", name: "Morning Briefer" }] },
};
const review = {
  ...brief,
  name: "pr-review-starter",
  displayName: "PR Review",
  category: "engineering",
  providerTypes: ["github"],
};

const config = {
  name: "Morning Brief",
  description: "Today's meetings and the email that needs you.",
  workspace: {
    layout: [
      {
        id: 1,
        component: "LayoutGridContainer",
        grid: {
          rows: 1,
          cols: 3,
          1.1: { component: 2 },
          1.2: { component: 3 },
          1.3: { component: 4 },
        },
      },
      { id: 2, component: "trops.google-calendar.GCalUpcoming" },
      { id: 3, component: "trops.gmail.GmailUnreadCount" },
      { id: 4, component: "dash.bots.BotResults" },
    ],
  },
  widgets: [
    {
      scope: "trops",
      packageName: "google-calendar",
      widgetName: "GCalUpcoming",
    },
    { scope: "trops", packageName: "gmail", widgetName: "GmailUnreadCount" },
  ],
  providers: [
    { type: "google-calendar", usedBy: ["trops.google-calendar.GCalUpcoming"] },
    { type: "gmail", usedBy: ["trops.gmail.GmailUnreadCount"] },
  ],
  team: {
    members: [
      {
        role: "morning-briefer",
        embedded: {
          name: "Morning Briefer",
          instructions: "Brief me.",
          schedules: [{ cron: "0 8 * * 1-5", prompt: "" }],
          providers: [
            { type: "gmail", tools: ["search_emails"] },
            { type: "google-calendar", tools: null },
          ],
          publishes: [{ name: "brief", label: "Morning brief" }],
        },
      },
    ],
    wiring: [],
    triggers: [],
    listeners: [],
    resultWidgets: [{ widget: "4", role: "morning-briefer" }],
  },
};

describe("which packages are starters", () => {
  test("public dashboards tagged starter, with bots", () => {
    const list = starterPackages({
      packages: [
        brief,
        { ...brief, name: "no-bots", team: null },
        { ...brief, name: "untagged", tags: [] },
        { ...brief, name: "private", visibility: "private" },
        { ...brief, name: "a-widget", type: "widget" },
        review,
      ],
    });
    expect(list.map((p) => p.name)).toEqual([
      "morning-brief-starter",
      "pr-review-starter",
    ]);
    expect(starterCategories(list)).toEqual(["productivity", "engineering"]);
  });

  test("a card names what it makes and needs", () => {
    expect(starterCard(brief)).toMatchObject({
      name: "Morning Brief",
      line: "Today's meetings and the email that needs you.",
      makes: "2 widgets · 1 bot",
      needs: "Gmail, Google Calendar",
      category: "productivity",
    });
    expect(starterCard({ ...brief, providerTypes: [] }).needs).toBe(
      "Nothing to connect",
    );
  });
});

describe("the drawn thumbnail", () => {
  test("the grid, a label per filled cell", () => {
    expect(thumbnailGrid(config)).toEqual({
      rows: 1,
      cols: 3,
      cells: [
        { key: "1.1", row: 1, col: 1, label: "GCal Upcoming" },
        { key: "1.2", row: 1, col: 2, label: "Gmail Unread Count" },
        { key: "1.3", row: 1, col: 3, label: "Bot Results" },
      ],
    });
    expect(widgetLabel("trops.clock.DigitalClockWidget")).toBe("Digital Clock");
    expect(widgetLabel("trops.git-hub.GitHubPRList")).toBe("GitHub PR List");
    expect(starterCard({ ...brief, providerTypes: ["github"] }).needs).toBe(
      "GitHub",
    );
  });
});

describe("Remix: a starter as a plan", () => {
  test("registry widgets, its bot as a new bot shown in Bot results, the dashboard", () => {
    const plan = starterToPlan(config, brief);
    expect(plan.summary).toBe(config.description);
    expect(plan.pieces.filter((p) => p.kind === "widget")).toEqual([
      expect.objectContaining({
        name: "GCal Upcoming",
        source: "registry",
        package: "@trops/google-calendar",
        providers: ["google-calendar"],
      }),
      expect.objectContaining({
        name: "Gmail Unread Count",
        package: "@trops/gmail",
        providers: ["gmail"],
      }),
    ]);
    expect(plan.pieces.find((p) => p.kind === "bot")).toEqual({
      kind: "bot",
      name: "Morning Briefer",
      source: "new",
      instructions: "Brief me.",
      providers: ["gmail", "google-calendar"],
      tools: [
        { provider: "gmail", tools: ["search_emails"] },
        { provider: "google-calendar", tools: [] },
      ],
      schedule: { cron: "0 8 * * 1-5" },
      results: [{ name: "brief", label: "Morning brief" }],
      on: [],
      showResults: true,
    });
    expect(plan.pieces[plan.pieces.length - 1]).toEqual({
      kind: "layout",
      name: "Morning Brief",
      source: "new",
    });
    expect(remixRequest(starterCard(brief), plan)).toMatch(
      /^I picked the "Morning Brief" starter[\s\S]*<plan>\{/,
    );
  });
});
