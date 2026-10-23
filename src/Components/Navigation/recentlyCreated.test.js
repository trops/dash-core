/**
 * recentlyCreated — the Add panel's "Recently created" group (QA
 * 2026-10-22): the user's own widgets, newest first, the last few within two
 * weeks; nothing when there are none.
 */
import fs from "fs";
import path from "path";
import { recentlyCreated, RECENT_LIMIT } from "./recentlyCreated";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

const row = (key, pkg) => ({
  key,
  widget: { type: "widget", _sourcePackage: pkg },
});
const reg = (pkg, at, extra = {}) => ({
  name: pkg,
  packageId: pkg,
  registeredAt: at,
  ...extra,
});

test("the user's own widgets, newest first", () => {
  const widgets = [
    row("ai-built.clock.Clock", "@ai-built/clock"),
    row("ai-built.timer.Timer", "@ai-built/timer"),
    row("john.notes.Notes", "@john/notes"),
  ];
  const registry = [
    reg("@ai-built/clock", daysAgo(3)),
    reg("@ai-built/timer", daysAgo(1)),
    reg("@john/notes", daysAgo(2)),
  ];
  expect(
    recentlyCreated(widgets, registry, { username: "john", now: NOW }).map(
      (r) => r.key,
    ),
  ).toEqual([
    "ai-built.timer.Timer",
    "john.notes.Notes",
    "ai-built.clock.Clock",
  ]);
});

test("not someone else's package, a built-in, or one from over two weeks ago", () => {
  const widgets = [
    row("trops.slack.Channels", "@trops/slack"),
    { key: "dash.bots.BotActivity", widget: { type: "widget" } },
    row("ai-built.old.Old", "@ai-built/old"),
  ];
  const registry = [
    reg("@trops/slack", daysAgo(1)),
    reg("@ai-built/old", daysAgo(30)),
  ];
  expect(recentlyCreated(widgets, registry, { now: NOW })).toEqual([]);
});

test("a widget loaded from the user's own folder counts as theirs", () => {
  const widgets = [row("acme.chart.Bar", "@acme/chart")];
  const registry = [reg("@acme/chart", daysAgo(1), { loadedInPlace: true })];
  expect(recentlyCreated(widgets, registry, { now: NOW })).toHaveLength(1);
});

test("at most the last few", () => {
  const widgets = [];
  const registry = [];
  for (let i = 0; i < RECENT_LIMIT + 3; i++) {
    widgets.push(row(`ai-built.w${i}.W${i}`, `@ai-built/w${i}`));
    registry.push(reg(`@ai-built/w${i}`, daysAgo(i / 10)));
  }
  const out = recentlyCreated(widgets, registry, { now: NOW });
  expect(out).toHaveLength(RECENT_LIMIT);
  expect(out[0].key).toBe("ai-built.w0.W0");
});

test("nothing installed recently, or no install time: nothing", () => {
  expect(recentlyCreated([], [], { now: NOW })).toEqual([]);
  const widgets = [row("ai-built.clock.Clock", "@ai-built/clock")];
  expect(
    recentlyCreated(widgets, [reg("@ai-built/clock", undefined)], {
      now: NOW,
    }),
  ).toEqual([]);
});

test("the Add panel shows the group first, only while nothing narrows the list", () => {
  const src = fs.readFileSync(path.join(__dirname, "WidgetSidebar.js"), "utf8");
  expect(src).toMatch(
    /hasActiveFilters\s*\?\s*\[\]\s*:\s*recentlyCreated\(allWidgets, registryEntries, \{ username \}\)/,
  );
  expect(src).toMatch(
    /recent\.length > 0 \? \(\s*<Sidebar\.Group label="Recently created">/,
  );
  // Before the author groups.
  expect(src.indexOf('label="Recently created"')).toBeLessThan(
    src.indexOf("{authorNames.map((author) => ("),
  );
});
