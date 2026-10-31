# PRD: Widget Guard and Safe Start

**Status:** Implemented
**Last Updated:** 2026-10-31
**Owner:** trops
**Related PRDs:** [Widget Display and Installation](./widget-display-and-installation.md)

---

## Executive Summary

One widget can never freeze Dash. A widget that keeps failing (an image it can't load, errors thrown over and over, crashes
while drawing) is stopped on its own, in its own box, with **Fix with AI**, **Try again** and (while editing) **Remove**. The
rest of the dashboard keeps running. If Dash still froze or quit while a dashboard was opening, that dashboard opens with its
widgets **paused** next time, and **Help › Start Without Widgets** brings back a page that has stopped answering.

---

## Context & Background

### Problem Statement

A user built a Smart Home dashboard. One AI-built widget (a music player) asked for album art from a relative address
(`/api/media_player_proxy/...`), which failed in Dash, and it changed the address every time it failed. The page's error
logger (`src/index.html` in dash-electron) rewrote the whole page on every failed load, so the broken image was created again
and again: 2,906 errors, the app hung, and the user could not edit the dashboard or remove the widget. They were stuck.

**Who experiences this problem?**

- Primary: anyone running an AI-built or third-party widget with a bug.
- Secondary: widget authors, who see no clear sign of what went wrong.

**What happens if we don't solve it?** One bad widget makes Dash unusable, with no way out short of editing files by hand.

### Current State

- `WidgetErrorBoundary` catches render crashes, but a widget that keeps failing outside rendering (load errors, timers,
  unhandled promise rejections) was never stopped.
- Nothing remembered that a dashboard froze Dash, so reopening Dash reopened the same frozen dashboard.

---

## Goals & Success Metrics

1. **A failing widget is stopped, alone.** 20 failures within 10 seconds stop that widget's package; nothing else changes.
2. **Never stuck after a freeze.** A dashboard that didn't finish loading (open for less than 15 seconds when Dash quit) opens
   paused next time.
3. **A manual way out.** Help › Start Without Widgets reloads a hung page with every dashboard paused, once.

---

## User Stories

### Story 1: a widget that keeps failing is stopped

**As a** Dash user, **I want** a widget stuck in an error loop to stop on its own **so that** I can still use and edit my
dashboard.

**Acceptance criteria:**

- [x] 20 failures in 10 seconds from one widget package stop it; slow, spread-out failures don't.
- [x] Failures are counted from: files it fails to load again (the same element or address failing twice, so one broken
      picture among many, or going offline, never stops it), throws from its code (tagged with
      `//# sourceURL=dash-widget://<package>/bundle.js`, so even later throws name it), unhandled rejections, render crashes.
- [x] In its place: "Stopped — it kept failing", how many failures and why, **Fix with AI** (asks the Builder for a fix
      that fails once, never in a loop), **Try again**, and **Remove** while editing.
- [x] The stopped widget is unmounted (its timers stop); other widgets keep running.
- [x] New code for it (Fix with AI, an update) runs again on its own; errors in the Widget Builder's preview are never
      counted (preview bundles are tagged `dash-widget-preview://`).
- [x] Layout containers are never stopped or paused; only widgets are.

### Story 2: a dashboard that froze Dash opens paused

**As a** user whose Dash froze, **I want** it to start without running that dashboard's widgets **so that** I can find and
fix the bad one.

**Acceptance criteria:**

- [x] While a dashboard opens it is marked (`dash:dashboard-opening`); the mark clears after 15 seconds or on a clean close.
- [x] If the mark is still there at start, that dashboard shows a banner ("… didn't finish loading last time, so its
      widgets are paused.") with **Turn all on**, and each widget shows **Paused** with **Turn on**.
- [x] The next start after a clean run is normal, and so is one after leaving a dashboard before it settled.
- [x] Only the main window takes part: popout windows share its storage but never read, mark or clear it.

### Story 3: Help › Start Without Widgets

**As a** user with a hung page, **I want** a menu item that brings Dash back **so that** I'm never stuck.

**Acceptance criteria:**

- [x] Help › Start Without Widgets (dash-electron) asks first (unsaved edits are lost), then drops the hung page and loads it with `?startPaused=1`.
- [x] Every dashboard opens paused, with "You started Dash without widgets…"; the flag is removed from the address once read,
      so a later reload is normal.

---

## Implementation Notes

- `src/Widget/widgetGuard.js`: counting, stopping, the start state (`pausedReason`, `isPaused`, `turnOn`, `markOpening`).
- `src/Widget/WidgetGuardViews.js`: `WidgetGuardGate` (around each widget in `WidgetFactory`), `WidgetPauseBanner` (top of
  `DashboardStage`). The running gate is a `display: contents` box with `data-widget-key`, so it takes no layout space.
- `src/utils/widgetBundleLoader.js`: bundles are tagged with their package for stack attribution.
- The stop is per package: two copies of the same widget stop together.
- dash-electron: `src/index.html` only logs errors now (v0.0.1069); the Widget Builder guide requires pictures from a service
  to use full `https://` or `data:image/` addresses and to hide on error once (v0.0.1071); `GUIDE_LIMIT` raised to 80,000 so
  the Builder reads its whole guide.

### Known limits

- Timers a widget starts when its bundle first runs (not in an effect) keep running after it's stopped; their errors are
  no longer counted.
- A freeze that starts more than 15 seconds after a dashboard opens isn't caught by safe start; Help › Start Without
  Widgets covers it.

### Lessons learned

- A page-level error handler must never rewrite the page; a failed `<img>` re-created by the rewrite is an infinite loop.
- After `webContents.forcefullyCrashRenderer()`, load the page from the `render-process-gone` event; loading right away
  leaves the window crashed.
