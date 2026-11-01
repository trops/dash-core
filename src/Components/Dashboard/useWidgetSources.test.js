import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import {
  widgetPackageOf,
  builtText,
  versionLine,
  sourceFiles,
  useWidgetSources,
} from "./useWidgetSources";

describe("which package a widget is from", () => {
  test("its item's own package first, else its id", () => {
    expect(widgetPackageOf("x.y.Z", { packageId: "@a/b" })).toBe("@a/b");
    expect(
      widgetPackageOf(
        "ai-built.musicassistantplayerhamcp.MusicAssistantPlayerHaMcp",
      ),
    ).toBe("@ai-built/musicassistantplayerhamcp");
    expect(widgetPackageOf("dash.Clock")).toBeNull();
    expect(widgetPackageOf("Clock")).toBeNull();
  });
});

describe("when it was built", () => {
  const now = new Date(2026, 9, 31, 21, 30);
  test("today, yesterday, a date", () => {
    expect(builtText(new Date(2026, 9, 31, 17, 37).toISOString(), now)).toBe(
      "built today at 5:37 PM",
    );
    expect(builtText(new Date(2026, 9, 30, 9, 2).toISOString(), now)).toBe(
      "built yesterday at 9:02 AM",
    );
    expect(builtText(new Date(2026, 9, 29, 9, 2).toISOString(), now)).toBe(
      "built Oct 29",
    );
    expect(builtText(null, now)).toBe("");
  });
  test("the version line", () => {
    expect(
      versionLine(
        {
          version: "1.0.4",
          builtAt: new Date(2026, 9, 31, 17, 37).toISOString(),
        },
        now,
      ),
    ).toBe("v1.0.4 · built today at 5:37 PM");
    expect(versionLine({ version: "2.1.0" }, now)).toBe("v2.1.0");
    expect(versionLine({}, now)).toBe("");
  });
});

describe("its files", () => {
  test("the component first, then its config", () => {
    expect(
      sourceFiles({
        success: true,
        componentName: "Player",
        componentCode: "a",
        configCode: "b",
      }).map((f) => f.name),
    ).toEqual(["Player.js", "Player.dash.js"]);
    expect(sourceFiles({ success: false })).toEqual([]);
  });
});

describe("reading them", () => {
  const Show = ({ pkg }) => {
    const s = useWidgetSources(pkg, "ai-built.player.Player");
    return (
      <span data-testid="s">
        {s.loading ? "loading" : s.error || `${s.version}|${s.files.length}`}
      </span>
    );
  };
  afterEach(() => {
    delete window.mainApi;
  });
  test("the installed package's code and dash.json", async () => {
    window.mainApi = {
      widgets: {
        readSources: jest.fn(async () => ({
          success: true,
          componentName: "Player",
          componentCode: "x",
          configCode: "y",
          manifest: { version: "1.0.4", builtAt: "2026-10-31T21:37:00.000Z" },
        })),
      },
    };
    render(<Show pkg="@ai-built/player" />);
    await waitFor(() =>
      expect(screen.getByTestId("s").textContent).toBe("1.0.4|2"),
    );
    expect(window.mainApi.widgets.readSources).toHaveBeenCalledWith(
      "@ai-built/player",
      "ai-built.player.Player",
    );
  });
  test("says when it can't be read", async () => {
    window.mainApi = {
      widgets: { readSources: async () => ({ success: false, error: "gone" }) },
    };
    render(<Show pkg="@ai-built/player" />);
    await waitFor(() =>
      expect(screen.getByTestId("s").textContent).toBe("gone"),
    );
  });
});
