/**
 * Changing a saved theme through the Dash team (theme change round, frames
 * 48-52): the user's own changes in place and can be published; one
 * downloaded from the registry is never changed — a remix credits its
 * author.
 */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  changeStanding,
  isThemeChangeOnly,
  planLine,
  planRows,
  planSubLine,
  themeChange,
  themeChangeRows,
  yesLabel,
} from "./workspacePlan";
import { buildChat, buildKind } from "./workspaceBuild";
import { planChanges } from "./planChanges";
import { makingStart } from "./workspaceStart";
import { BuildInChat } from "./BuildViews";

// The connect dialog opens the providers screen: not what's tested here.
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => null,
}));

const colors = {
  primary: "#c2562b",
  secondary: "#d9a441",
  tertiary: "#7c8aa5",
  neutral: "#7a6a5c",
};
const change = (name = "Dusk") => ({
  kind: "theme",
  name,
  source: "update",
  colors,
  colorNames: { primary: "rust", secondary: "amber", neutral: "bark" },
  colorNamesNow: {
    primary: "slate blue",
    secondary: "steel",
    tertiary: "dusty blue",
    neutral: "slate",
  },
});
const rawThemes = {
  "theme-dusk": {
    name: "Dusk",
    primary: "#5b6b8c",
    secondary: "#7a8aa0",
    tertiary: "#7c8aa5",
    neutral: "#4b5563",
  },
  "theme-nordic": {
    name: "Nordic",
    author: "@alexr",
    primary: "#112233",
    registryRef: {
      package: "@alexr/nordic",
      kind: "theme",
      version: "1.0.0",
      origin: "installed",
    },
  },
};
const plan = (name) => ({ summary: "warmer", pieces: [change(name)] });

describe("the plan (frames 49-50)", () => {
  test("your theme: its changes, Yes, change it", () => {
    const p = plan("Dusk");
    expect(isThemeChangeOnly(p)).toBe(true);
    expect(themeChange(p).name).toBe("Dusk");
    expect(changeStanding(p, rawThemes).origin).toBeNull();
    expect(planLine(p, { rawThemes })).toBe("Plan · 3 colors change");
    expect(yesLabel(p, { rawThemes })).toBe("Yes, change it");
    expect(planSubLine(p, [], { rawThemes })).toBe(
      "Your theme — nothing changes until you say yes",
    );
    expect(buildKind(p)).toBe("themechange");
  });

  test("each color: before → after, or unchanged", () => {
    const rows = themeChangeRows(change(), rawThemes["theme-dusk"]);
    expect(rows.map((r) => r.main)).toEqual([
      "Primary — slate blue → rust",
      "Secondary — steel → amber",
      "Tertiary — dusty blue · unchanged",
      "Neutral — slate → bark",
    ]);
    expect(rows.map((r) => r.changed)).toEqual([true, true, false, true]);
    expect(planRows(plan("Dusk"), [], () => false, { rawThemes }).length).toBe(
      4,
    );
  });

  test("a downloaded theme: a remix that credits its author", () => {
    const p = plan("Nordic");
    expect(changeStanding(p, rawThemes).origin.package).toBe("@alexr/nordic");
    expect(planLine(p, { rawThemes })).toBe(
      "Plan · a remix of Nordic, by @alexr",
    );
    expect(yesLabel(p, { rawThemes })).toBe("Yes, make the remix");
    expect(planSubLine(p, [], { rawThemes })).toBe(
      "Nordic is by @alexr — your change is saved as a remix that credits them",
    );
  });

  test("on a dashboard: your theme changes everywhere; a remix goes there", () => {
    const ws = {
      id: "7",
      name: "Kitchen Sink",
      themeKey: "theme-x",
      layout: [],
    };
    const standing = (name) => {
      const hit = Object.values(rawThemes).find((t) => t.name === name);
      return hit
        ? { origin: hit.registryRef ? { author: "@alexr" } : null }
        : null;
    };
    const own = planChanges(
      ws,
      { ...plan("Dusk"), dashboard: { id: "7" } },
      { themeName: () => "Dusk", standing },
    );
    expect(own.rows.map((r) => r.main)).toEqual(["Dusk — new colors"]);
    const remix = planChanges(
      ws,
      { ...plan("Nordic"), dashboard: { id: "7" } },
      { themeName: () => "Nordic", standing },
    );
    expect(remix.rows.map((r) => r.main)).toEqual([
      "Nordic (remix) — a remix of Nordic by @alexr",
      "Kitchen Sink's theme — Nordic → Nordic (remix)",
    ]);
    expect(
      planLine(
        { ...plan("Nordic"), dashboard: { id: "7", name: "Kitchen Sink" } },
        { rawThemes },
      ),
    ).toBe("Plan · a remix of Nordic, by @alexr");
  });
});

describe("built (frames 51-52)", () => {
  const done = (changedTheme) => ({
    status: "done",
    steps: [
      {
        id: "changetheme",
        kind: "changetheme",
        label: "Change the Dusk theme",
        status: "done",
      },
    ],
    changedTheme,
    madeTheme: changedTheme
      ? { key: changedTheme.key, name: changedTheme.name }
      : undefined,
  });

  test("yours, published: where it shows, Publish the update", () => {
    const chat = buildChat(
      done({
        key: "theme-dusk",
        name: "Dusk",
        remix: false,
        published: {
          package: "@me/dusk",
          version: "1.2.0",
          visibility: "public",
        },
        usedBy: { app: true, dashboards: ["Kitchen Sink", "Home"] },
      }),
      { kind: "themechange" },
    );
    expect(chat.reply).toBe(
      "Dusk is changed — the app and 2 dashboards show it. It's published (public) as v1.2.0; the registry still has that version until you publish the update.",
    );
    expect(chat.card.sub).toBe("Theme · changed · not yet published");
    expect(chat.choices).toBe("themechange");
  });

  test("the buttons: Publish the update keeps its visibility", () => {
    const publishTheme = jest.fn();
    const openThemeEditor = jest.fn();
    render(
      <BuildInChat
        build={{ buildId: "b1", kind: "themechange" }}
        state={done({
          key: "theme-dusk",
          name: "Dusk",
          remix: false,
          published: {
            package: "@me/dusk",
            version: "1.2.0",
            visibility: "private",
          },
          usedBy: { app: false, dashboards: [] },
        })}
        current
        yes="Yes, change it"
        actions={{ publishTheme, openThemeEditor }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish the update" }));
    expect(publishTheme).toHaveBeenCalledWith({
      key: "theme-dusk",
      name: "Dusk",
      visibility: "private",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open in the theme editor" }),
    );
    expect(openThemeEditor).toHaveBeenCalledWith("theme-dusk");
  });

  test("yours, never published: Publish it…", () => {
    render(
      <BuildInChat
        build={{ buildId: "b1", kind: "themechange" }}
        state={done({
          key: "theme-dusk",
          name: "Dusk",
          remix: false,
          published: null,
          usedBy: { app: false, dashboards: ["Home"] },
        })}
        current
        actions={{ publishTheme: jest.fn(), openThemeEditor: jest.fn() }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Publish it…" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workspace-build-reply")).toHaveTextContent(
      "Dusk is changed — Home shows it.",
    );
  });

  test("a remix: Publish your remix…", () => {
    const state = done({
      key: "theme-r",
      name: "Nordic (remix)",
      remix: true,
      of: { name: "Nordic", author: "@alexr", package: "@alexr/nordic" },
      allowRemix: true,
    });
    expect(buildChat(state, { kind: "themechange" }).reply).toBe(
      "Nordic (remix) is in your themes. It credits @alexr's Nordic — publish it if you'd like to share it.",
    );
    render(
      <BuildInChat
        build={{ buildId: "b1", kind: "themechange" }}
        state={state}
        current
        actions={{ publishTheme: jest.fn(), openThemeEditor: jest.fn() }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Publish your remix…" }),
    ).toBeInTheDocument();
  });

  test("a remix its author doesn't allow published: no Publish (frame 52b)", () => {
    const state = done({
      key: "theme-r",
      name: "Nordic (remix)",
      remix: true,
      of: { name: "Nordic", author: "@alexr" },
      allowRemix: false,
    });
    expect(buildChat(state, { kind: "themechange" }).reply).toMatch(
      /@alexr doesn't allow remixes to be published, so it stays yours to use/,
    );
    render(
      <BuildInChat
        build={{ buildId: "b1", kind: "themechange" }}
        state={state}
        current
        actions={{ publishTheme: jest.fn(), openThemeEditor: jest.fn() }}
      />,
    );
    expect(screen.queryByRole("button", { name: /Publish/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open in the theme editor" }),
    ).toBeInTheDocument();
  });

  test("left off before it changed: says so", () => {
    const chat = buildChat(
      {
        status: "finished-with-problems",
        steps: [
          {
            id: "changetheme",
            kind: "changetheme",
            status: "failed",
            error: "x",
          },
        ],
      },
      { kind: "themechange", leftOff: ["changetheme"] },
    );
    expect(chat.reply).toMatch(/wasn't changed/);
    expect(chat.card).toBeNull();
  });
});

describe("the Themes page's Change with AI (frame 48)", () => {
  test("your theme", () => {
    const m = makingStart({ kind: "themechange", theme: "Dusk" });
    expect(m.label).toBe("Changing");
    expect(m.text).toBe("Dusk — your theme");
    expect(m.note).toMatch(/plan a change to it, source "update"/);
  });
  test("a downloaded one says whose", () => {
    const m = makingStart({
      kind: "themechange",
      theme: "Nordic",
      by: "@alexr",
    });
    expect(m.text).toBe("Nordic — a theme by @alexr");
    expect(m.greeting).toMatch(
      /saves your version as a remix that credits them/,
    );
  });
});

test("after an in-place build: rows compare with the colors before it", () => {
  const changedNow = {
    ...rawThemes,
    "theme-dusk": { ...rawThemes["theme-dusk"], ...colors },
  };
  const rows = planRows(plan("Dusk"), [], () => false, {
    rawThemes: changedNow,
    themeNow: rawThemes["theme-dusk"],
  });
  expect(rows[0].main).toBe("Primary — slate blue → rust");
});
