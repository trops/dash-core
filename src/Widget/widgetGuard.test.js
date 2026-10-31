/**
 * The widget guard (widget guard and safe start, frames 1-3): one widget can
 * never freeze Dash. A widget that keeps failing is stopped on its own; a
 * dashboard Dash froze on opens paused next time.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  LIMIT,
  WINDOW,
  _reset,
  bundleSourceUrl,
  installWidgetGuard,
  isPaused,
  markOpening,
  noteFailure,
  pausedReason,
  restart,
  stoppedInfo,
  turnOn,
  widgetFromStack,
  widgetKey,
} from "./widgetGuard";
import { WidgetGuardGate, WidgetPauseBanner } from "./WidgetGuardViews";
import { evaluateBundle } from "../utils/widgetBundleLoader";

beforeEach(() => {
  _reset();
  window.localStorage.clear();
});

describe("whose an error is", () => {
  test("one key per package, however it's named", () => {
    expect(widgetKey("@ai-built/musicplayer")).toBe("ai-built.musicplayer");
    expect(widgetKey("ai-built.musicplayer.MusicPlayer")).toBe(
      "ai-built.musicplayer",
    );
    expect(widgetKey("ai-built.musicplayer")).toBe("ai-built.musicplayer");
    expect(widgetKey("Clock")).toBe("Clock");
  });

  test("a bundle's code is tagged: a throw from it — even later — names it", () => {
    const exports = evaluateBundle(
      "module.exports.boom = function () { throw new Error('nope'); };",
      "@ai-built/musicplayer",
    );
    let stack = "";
    try {
      exports.boom();
    } catch (e) {
      stack = e.stack;
    }
    expect(stack).toContain(bundleSourceUrl("@ai-built/musicplayer"));
    expect(widgetFromStack(stack)).toBe("ai-built.musicplayer");
    expect(widgetFromStack("Error\n    at somewhere (app.js:1:1)")).toBeNull();
  });

  test("the tag can't break out of its comment line", () => {
    expect(bundleSourceUrl("@x/a\nb")).not.toMatch(/\n/);
  });
});

describe("a widget that keeps failing is stopped — only it", () => {
  test(`${LIMIT} failures in ${WINDOW / 1000} seconds stop it; Try again runs it again`, () => {
    const key = "ai-built.musicplayer";
    for (let i = 1; i < LIMIT; i += 1)
      expect(noteFailure(key, "load", 1000 + i)).toBe(false);
    expect(noteFailure(key, "load", 2000)).toBe(true);
    expect(stoppedInfo(key)).toMatchObject({ count: LIMIT, why: "load" });
    expect(stoppedInfo("ai-built.lights")).toBeNull();
    restart(key);
    expect(stoppedInfo(key)).toBeNull();
    expect(noteFailure(key, "load", 3000)).toBe(false);
  });

  test("slow failures, spread out, don't stop it", () => {
    const key = "ai-built.slow";
    for (let i = 0; i < LIMIT * 3; i += 1)
      expect(noteFailure(key, "error", i * WINDOW)).toBe(false);
  });

  test("from the window: a file it fails to load, a throw from its code", () => {
    installWidgetGuard(window);
    document.body.innerHTML =
      '<div data-widget-key="ai-built.player"><img id="cover"></div><img id="loose">';
    const cover = document.getElementById("cover");
    // The first failure of a picture is just a broken picture; the same one
    // failing again is a loop.
    for (let i = 0; i < LIMIT; i += 1) cover.dispatchEvent(new Event("error"));
    expect(stoppedInfo("ai-built.player")).toBeNull();
    cover.dispatchEvent(new Event("error"));
    expect(stoppedInfo("ai-built.player")).toMatchObject({ why: "load" });
    // An image outside any widget isn't anyone's.
    document.getElementById("loose").dispatchEvent(new Event("error"));
    const err = new Error("x");
    err.stack = `Error: x\n    at tick (${bundleSourceUrl("ai-built.timer")}:3:9)`;
    for (let i = 0; i < LIMIT; i += 1)
      window.dispatchEvent(new ErrorEvent("error", { error: err }));
    expect(stoppedInfo("ai-built.timer")).not.toBeNull();
    document.body.innerHTML = "";
  });

  test("many different pictures failing once each (offline, a broken feed) don't stop it", () => {
    installWidgetGuard(window);
    const imgs = Array.from(
      { length: LIMIT * 2 },
      (_, i) => `<img id="p${i}" src="https://example.com/${i}.jpg">`,
    ).join("");
    document.body.innerHTML = `<div data-widget-key="ai-built.news">${imgs}</div>`;
    for (let i = 0; i < LIMIT * 2; i += 1)
      document.getElementById(`p${i}`).dispatchEvent(new Event("error"));
    expect(stoppedInfo("ai-built.news")).toBeNull();
    document.body.innerHTML = "";
  });

  test("the Widget Builder's preview errors aren't the installed widget's", () => {
    installWidgetGuard(window);
    const exports = evaluateBundle(
      "module.exports.boom = function () { throw new Error('nope'); };",
      "@ai-built/player",
      { preview: true },
    );
    for (let i = 0; i < LIMIT + 1; i += 1) {
      let error;
      try {
        exports.boom();
      } catch (e) {
        error = e;
      }
      window.dispatchEvent(new ErrorEvent("error", { error }));
    }
    expect(stoppedInfo("ai-built.player")).toBeNull();
  });

  test("a layout container is never stopped or paused: its widgets are, each in place", () => {
    window.localStorage.setItem(
      "dash:dashboard-opening",
      JSON.stringify({ id: "42" }),
    );
    render(
      <WidgetGuardGate
        off
        component="LayoutGridContainer"
        label="Grid"
        dashboardId="42"
        uuid="g1"
      >
        <span>grid</span>
      </WidgetGuardGate>,
    );
    expect(screen.getByText("grid")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-paused")).toBeNull();
  });

  test("in its place: Stopped — it kept failing, with Fix with AI and Try again; the others keep running", () => {
    const onFix = jest.fn();
    render(
      <>
        <WidgetGuardGate
          component="ai-built.player.Player"
          label="Music Player"
          onFix={onFix}
        >
          <span>playing</span>
        </WidgetGuardGate>
        <WidgetGuardGate component="ai-built.lights.Lights" label="Lights">
          <span>lights on</span>
        </WidgetGuardGate>
      </>,
    );
    expect(screen.getByText("playing")).toBeInTheDocument();
    act(() => {
      for (let i = 0; i < LIMIT; i += 1) noteFailure("ai-built.player", "load");
    });
    const card = screen.getByTestId("widget-stopped");
    expect(card).toHaveTextContent("Stopped — it kept failing");
    expect(card).toHaveTextContent(
      `It failed ${LIMIT} times in ${WINDOW / 1000} seconds (something it couldn't load)`,
    );
    // Unmounted: its timers stop with it.
    expect(screen.queryByText("playing")).toBeNull();
    expect(screen.getByText("lights on")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
    expect(onFix).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("playing")).toBeInTheDocument();
  });
});

describe("safe start", () => {
  test("a dashboard that didn't finish loading opens paused; Turn on, one or all", () => {
    // Last run: Smart Home was opening when Dash froze.
    window.localStorage.setItem(
      "dash:dashboard-opening",
      JSON.stringify({ id: "42", at: 1 }),
    );
    expect(pausedReason("42")).toBe("unfinished");
    expect(pausedReason("7")).toBeNull();
    expect(isPaused("42", "w1")).toBe(true);
    turnOn("42", "w1");
    expect(isPaused("42", "w1")).toBe(false);
    expect(isPaused("42", "w2")).toBe(true);
    turnOn("42");
    expect(isPaused("42", "w2")).toBe(false);
    expect(pausedReason("42")).toBeNull();
  });

  test("a dashboard that ran a while isn't paused next time; one that froze is", () => {
    jest.useFakeTimers();
    try {
      const stop = markOpening("42");
      expect(window.localStorage.getItem("dash:dashboard-opening")).toMatch(
        /"42"/,
      );
      jest.advanceTimersByTime(15000);
      expect(window.localStorage.getItem("dash:dashboard-opening")).toBeNull();
      stop();
      // Froze before it settled: the mark stays for the next start.
      markOpening("43");
      expect(window.localStorage.getItem("dash:dashboard-opening")).toMatch(
        /"43"/,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test("closed before it settled isn't a freeze; a newer mark isn't cleared by an older one", () => {
    jest.useFakeTimers();
    try {
      const closeA = markOpening("A");
      closeA();
      expect(window.localStorage.getItem("dash:dashboard-opening")).toBeNull();
      // Turn on (a new mark for A), then B opens: A's leftovers never
      // clear B's mark.
      markOpening("A");
      turnOn("A");
      jest.advanceTimersByTime(10000);
      const closeB = markOpening("B");
      jest.advanceTimersByTime(6000);
      expect(window.localStorage.getItem("dash:dashboard-opening")).toMatch(
        /"B"/,
      );
      closeB();
    } finally {
      jest.useRealTimers();
    }
  });

  test("a popout window never reads, marks or clears it", () => {
    window.localStorage.setItem(
      "dash:dashboard-opening",
      JSON.stringify({ id: "42" }),
    );
    window.history.replaceState(null, "", "/#/popout/42");
    try {
      expect(pausedReason("42")).toBeNull();
      markOpening("7");
      expect(window.localStorage.getItem("dash:dashboard-opening")).toMatch(
        /"42"/,
      );
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  test("Start without widgets: every dashboard opens paused, once", () => {
    window.localStorage.setItem("dash:start-paused", "1");
    expect(pausedReason("1")).toBe("start");
    expect(pausedReason("2")).toBe("start");
    expect(window.localStorage.getItem("dash:start-paused")).toBeNull();
  });

  test("Help › Start without widgets (?startPaused=1): paused this time only", () => {
    window.history.replaceState(null, "", "/?startPaused=1#/dashboards");
    expect(pausedReason("9")).toBe("start");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/dashboards");
    window.history.replaceState(null, "", "/");
  });

  test("the banner says why, Turn all on turns them on, and the widgets come back", () => {
    window.localStorage.setItem(
      "dash:dashboard-opening",
      JSON.stringify({ id: "42" }),
    );
    render(
      <>
        <WidgetPauseBanner dashboard={{ id: "42", name: "Smart Home" }} />
        <WidgetGuardGate
          component="ai-built.player.Player"
          label="Music Player"
          dashboardId="42"
          uuid="w1"
        >
          <span>playing</span>
        </WidgetGuardGate>
      </>,
    );
    expect(screen.getByTestId("widget-pause-banner")).toHaveTextContent(
      "Smart Home didn't finish loading last time, so its widgets are paused.",
    );
    expect(screen.getByTestId("widget-paused")).toHaveTextContent("Paused");
    expect(screen.queryByText("playing")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn all on" }));
    expect(screen.getByText("playing")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-pause-banner")).toBeNull();
  });
});
