# PRD: Widget Settings Checks and the Widget Side Panel

**Status:** Implemented
**Last Updated:** 2026-11-01
**Owner:** trops
**Related PRDs:** [Widget Guard and Safe Start](./widget-guard.md), [Lead Workspace](./lead-workspace.md)

---

## Executive Summary

A widget built for you has to work without you debugging it. When it doesn't, Dash says why, inside the app:

- Settings are **checked as they are set**. A URL setting that isn't a web address (`http//10.0.0.107`) gets a red line, plus
  "Did you mean http://10.0.0.107? **Use this**". Save waits until it's fixed.
- The side panel has a **Save bar** the moment anything changes: "1 unsaved change", **Cancel**, **Save**. No Tab needed.
- A **picture the widget couldn't show** is listed in its side panel with the exact address it tried and why: not a web
  address, blocked by Dash, or nothing came back. **Copy link** and **Go to the setting** are right there.
- **View code** shows the code the widget runs now, with its version and when it was built. It's in the side panel, the
  widget's ⋮ menu and the Widgets page.
- **Open larger ⤢** shows the side panel's sections in a roomy modal.

Approved mockups: canvas pages "Widget side panel — Save, checks, code" (frames 1-6) and "Widget versions and View code"
(frames 3-5).

---

## Context & Background

### Problem Statement

A user's Music Assistant widget showed "No cover art" for three hours of back and forth, and they had to use a terminal to
find out why:

1. The Widget Builder's preview ran **without the dashboard copy's settings**. It found the picture another way and looked
   right, so the dashboard copy looked broken for no visible reason.
2. Dash's page blocked `http://` pictures (fixed in dash-electron v0.0.1074).
3. The widget's URL setting was saved as `http//10.0.0.107`, missing its ":". It was a `text` setting, so **nothing checked
   it**. The widget said only "No cover art".

Other gaps: the side panel had no Save button (you had to Tab out of a field to see "Save or cancel"); its settings column
was narrow; there was no way to see the code a widget runs, or whether an update had landed.

**Who experiences this problem?** Anyone who builds or changes a widget with the Dash team or the Widget Builder.

### Current State (before)

- `userConfig` types: `text`, `secret`, `number`, `select`. `required` showed a `*` but was never enforced. A number out of
  range silently dropped the keystroke. Any other type rendered **nothing**.
- Settings applied on blur and waited for the dashboard's Save, with a standing footnote.
- `mainApi.widgets.readSources` already read an installed widget's files, but no screen showed them.

---

## Requirements

### Settings checks (`src/utils/userConfigValidation.js`, pure, shared)

- New setting types `url` and `email`. `url` must be `http://` or `https://` and parse as an address. These get a
  suggestion:
  - `http//x`, `https//x`, `http:/x` → `http://x` (or `https://x`)
  - a bare host → `http://` for a home/local address, otherwise `https://`
- `required: true` is enforced: "Player name is required."
- Plain-value checks any setting can add (never code; the config stays parseable by the AST allowlist):
  - `pattern` with `patternMessage`
  - `minLength` / `maxLength`
  - numbers: `min` / `max` → "Must be between 2 and 60."
- A number field keeps what was typed (never drops a key) and says what's wrong.
- An unknown type is shown as a text box with a note, instead of nothing.

**When an error shows:** a value that already fails when the panel opens shows its error at once. A fresh field shows its
error after it's left (blur), never on the first keystroke. A Save that's held back shows every failing field and focuses
the first one.

### Side panel (`WidgetPanel`, `PanelEditItem`)

- **Save bar:** appears on the first keystroke (`onDraft`) or any change to settings, connections or listeners. It shows
  "N unsaved change(s)" with **Cancel** and **Save**, or "Fix N setting(s) first" with Save disabled.
  - Save is the dashboard's own Save (`handleClickSaveWorkspace`).
  - The top bar's Save asks the panel first (`checkRef`) and is held back the same way.
  - Cancel puts the widget back as it was when it was selected.
- **Header line:** "Built by AI · yours · v1.0.4 · built today at 5:37 PM", read from the installed `dash.json`
  (`version`, `builtAt`).
- **View code:** `WidgetCodeModal` shows the files (component first, then `.dash.js`) in a read-only editor, with Copy.
- **Open larger ⤢:** a modal with Settings / Connections / Listens for / Advanced, the problems line and the same Save bar.
  The side panel says "Open in the larger view." meanwhile.

### Pictures a widget couldn't show (`src/Widget/pictureProblems.js`)

- Capture-phase `error` / `load` on `<img>` inside a widget's box. The box carries `data-widget-uuid` (the copy) and
  `data-widget-key` (the package).
- `securitypolicyviolation` with `img-src` marks an address as blocked by Dash.
- The reason and its words:
  - `not-address`: "Not a web address: it's missing ":" after http." or "…a path with no server address in front of it."
  - `blocked`: "Dash blocked it: its security rules don't allow this address."
  - `failed`: "Nothing came back as a picture: the address wasn't found, the server didn't answer, or it isn't a picture."
- The side panel shows "1 picture didn't load", the exact address (the src as written when it isn't a web address), the
  reason, Copy link, and **Go to the setting** (the `url` setting).
- A picture that loads later clears its problem.

### View code elsewhere

- The widget card's ⋮ menu (edit mode) has **View code**, which opens the same modal (event `dash:view-widget-code`).
- The Widgets page package detail has **View code**. Package rows and the header show "v1.0.7 · built today at 2:14 PM"
  (`builtAt` carried by `widgetSummary`).

### Widget Builder rules (dash-electron)

- The `.claude/skills/dash-widget-builder/SKILL.md` userConfig example lists the types and checks. An address setting is
  always `url`.
- When a picture fails, the widget shows what it tried and which setting to check, never just "No cover art".
- The team's build check (`teamWidgetTools.cjs settingTypeProblems`) refuses a setting whose name or label says
  URL/address/email but whose type is `text`.

### Related fixes shipped with it (dash-core 0.1.887)

- A change's preview uses the dashboard copy's own settings and connection when the change carries none. The change's
  dashboard comes first, and one copy's inputs are never mixed with another's. A widget placed in a new cell never borrows
  another dashboard's settings.
- The Lead never says "is updated" when the save step was left off.

---

## Acceptance Criteria

- [x] `http//10.0.0.107` in a `url` setting shows "Not a web address…" and "Did you mean http://10.0.0.107?". **Use this**
      fixes it.
- [x] The Save bar shows on the first keystroke. Save and Cancel work. Save is disabled with "Fix 1 setting first" while a
      setting fails, and the top bar's Save is held back too.
- [x] Required, number range, pattern and length checks have their own messages. Unknown types still render.
- [x] A broken picture shows in the side panel with the exact address and reason. Loading it later clears it.
- [x] View code is in the side panel, the larger view, the card's ⋮ menu and the Widgets page, with version and build time.
- [x] Open larger shows the same sections and Save bar.
- [x] The team's build refuses an address/email setting typed `text`.

## Implementation Notes

- Unit tests: `userConfigValidation.test.js`, `pictureProblems.test.js`, `useWidgetSources.test.js`,
  `PanelEditItem.fields.test.js`, `WidgetPanel.test.js` (Save bar, Cancel, held-back Save, problems line, View code, Open
  larger), `WidgetCardHeader.test.js`, `widgetSummary.test.js`, `EditPanel.test.js`. dash-electron:
  `teamWidgetTools.test.js`.
- dash-react 1.0.85: a field with `aria-invalid` gets the red edge, including under Aurora and on focus.
- Not done: the ⋮ menu doesn't show the version itself (it would mean reading every card's package). The version is in
  View code's header and the side panel.
