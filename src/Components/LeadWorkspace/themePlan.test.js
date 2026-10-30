/**
 * A new theme made by the Dash team (lead-workspace theme round, frames
 * 44-47): the plan's lines and colors, how it looks, the build's words, and
 * the Themes page's Describe it.
 */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  isThemeOnly,
  newTheme,
  planLine,
  planRows,
  planSubLine,
  yesLabel,
} from "./workspacePlan";
import { buildChat, buildKind } from "./workspaceBuild";
import { countsLine } from "../Create/planChecklist";
import { PlanCard, ThemeLooks } from "./PlanViews";
import { BuildInChat } from "./BuildViews";
import { ThemeNewChooser } from "../Theme/Wizard/ThemeNewChooser";

// The connect dialog opens the providers screen: not what's tested here.
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => null,
}));

const colors = {
  primary: "#c2562b",
  secondary: "#d9a441",
  tertiary: "#6b7f3a",
  neutral: "#7a6a5c",
};
const autumn = { kind: "theme", name: "Autumn", source: "new", colors };
const themePlan = { summary: "Autumn", pieces: [autumn] };
const onKitchen = {
  summary: "Kitchen Sink in autumn colors",
  dashboard: { id: "7", name: "Kitchen Sink" },
  pieces: [autumn],
};

describe("a plan that makes a theme (frame 45)", () => {
  test("only a theme: its own lines and yes", () => {
    expect(isThemeOnly(themePlan)).toBe(true);
    expect(newTheme(themePlan)).toBe(autumn);
    expect(planLine(themePlan)).toBe("Plan · 1 new theme");
    expect(planSubLine(themePlan)).toBe(
      "A new theme — nothing is saved until you say yes",
    );
    expect(yesLabel(themePlan)).toBe("Yes, make it");
    expect(buildKind(themePlan)).toBe("theme");
  });

  test("its four colors, one row each, drawn in that color", () => {
    const rows = planRows(themePlan);
    expect(rows.map((r) => r.main)).toEqual([
      "Primary — #c2562b",
      "Secondary — #d9a441",
      "Tertiary — #6b7f3a",
      "Neutral — #7a6a5c",
    ]);
    expect(rows.map((r) => r.swatch)).toEqual([
      "#c2562b",
      "#d9a441",
      "#6b7f3a",
      "#7a6a5c",
    ]);
  });

  test("on a dashboard you have it's a change, not a theme-only plan (frame 46)", () => {
    expect(isThemeOnly(onKitchen)).toBe(false);
    expect(newTheme(onKitchen)).toBe(autumn);
    expect(yesLabel(onKitchen)).toBe("Yes, make the changes");
    expect(planLine(onKitchen)).toBe("Plan · a new theme, on Kitchen Sink");
    expect(countsLine(onKitchen)).toBe(
      "Applies a new Autumn theme to Kitchen Sink",
    );
    expect(buildKind(onKitchen)).toBe("dashboard");
  });

  test("a saved theme reads as before", () => {
    const dusk = {
      ...onKitchen,
      pieces: [{ kind: "theme", name: "Dusk", source: "yours" }],
    };
    expect(isThemeOnly(dusk)).toBe(false);
    expect(countsLine(dusk)).toBe("Applies the Dusk theme to Kitchen Sink");
  });

  test("a plan whose pieces aren't a list isn't a theme", () => {
    expect(isThemeOnly({ pieces: "x" })).toBe(false);
    expect(newTheme({ pieces: "x" })).toBeNull();
  });

  test("the card says it's a theme", () => {
    render(<PlanCard plan={themePlan} onOpen={jest.fn()} />);
    expect(screen.getByText("Autumn — theme")).toBeInTheDocument();
    expect(screen.getByText("Plan · 1 new theme")).toBeInTheDocument();
  });

  test("how it looks: the generated theme, dark and light", () => {
    render(<ThemeLooks piece={autumn} />);
    expect(screen.getByTestId("workspace-theme-looks")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getAllByTestId("theme-preview")).toHaveLength(2);
    // Compact: two cards each, no sidebar.
    expect(screen.getAllByTestId("preview-card")).toHaveLength(4);
    expect(screen.getAllByText("Autumn")).toHaveLength(2);
  });
});

describe("made (frame 47)", () => {
  const made = {
    status: "done",
    steps: [
      {
        id: "maketheme",
        kind: "maketheme",
        role: "dash",
        label: "Make the Autumn theme",
        status: "done",
      },
    ],
    madeTheme: { key: "theme-1", name: "Autumn", colors },
  };

  test("it's in your themes; Open in the theme editor", () => {
    const chat = buildChat(made, { kind: "theme" });
    expect(chat.step).toEqual({
      label: "Saved the Autumn theme",
      status: "done",
    });
    expect(chat.card).toEqual({
      kind: "theme",
      title: "Autumn",
      sub: "Theme · saved",
    });
    expect(chat.reply).toMatch(/^Autumn is in your themes\./);
    expect(chat.choices).toBe("theme");
  });

  test("the button and the card open it in the theme editor by its key", () => {
    const openThemeEditor = jest.fn();
    render(
      <BuildInChat
        build={{ buildId: "b1", kind: "theme" }}
        state={made}
        current
        yes="Yes, make it"
        actions={{ openThemeEditor }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open in the theme editor" }),
    );
    expect(openThemeEditor).toHaveBeenCalledWith("theme-1");
    fireEvent.click(screen.getByTestId("workspace-build-card"));
    expect(openThemeEditor).toHaveBeenCalledTimes(2);
  });
});

describe("a new theme on a dashboard you have, built (frame 46)", () => {
  test("the card and reply say which theme it has now", () => {
    const chat = buildChat(
      {
        status: "done",
        dashboard: { id: "7", name: "Kitchen Sink", targeted: true },
        theme: { name: "Autumn", key: "theme-1" },
        steps: [
          { id: "dashboard", kind: "dashboard", status: "done" },
          { id: "maketheme", kind: "maketheme", status: "done" },
          { id: "theme", kind: "theme", status: "done" },
        ],
      },
      { kind: "dashboard" },
    );
    expect(chat.card.sub).toBe("Dashboard · changed · Autumn theme");
    expect(chat.reply).toMatch(
      /^Kitchen Sink is changed — it has the Autumn theme now\./,
    );
  });
});

describe("left off before it was saved (review fix)", () => {
  test("says nothing was made", () => {
    const chat = buildChat(
      {
        status: "finished-with-problems",
        steps: [
          {
            id: "maketheme",
            kind: "maketheme",
            role: "dash",
            label: "Make the Autumn theme",
            status: "failed",
            error: "disk full",
          },
        ],
      },
      { kind: "theme", leftOff: ["maketheme"] },
    );
    expect(chat.card).toBeNull();
    expect(chat.reply).toMatch(/wasn't saved/);
    expect(chat.reply).not.toMatch(/in your themes/);
  });
});

describe("the Themes page's New Theme (frame 44)", () => {
  test("Describe it comes first, when it can open the Dash Lead", () => {
    const onDescribe = jest.fn();
    render(
      <ThemeNewChooser
        onSearchThemes={jest.fn()}
        onSelectMethod={jest.fn()}
        onDescribe={onDescribe}
      />,
    );
    fireEvent.click(screen.getByText("Describe it"));
    expect(onDescribe).toHaveBeenCalled();
    // The hand-made ways stay.
    for (const t of [
      "Search Marketplace",
      "From Presets",
      "From Colors",
      "From Random",
      "From Website",
    ]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  test("without it, only the hand-made ways", () => {
    render(
      <ThemeNewChooser onSearchThemes={jest.fn()} onSelectMethod={jest.fn()} />,
    );
    expect(screen.queryByText("Describe it")).toBeNull();
  });
});
