/**
 * The main process's ownership rule for a change in place (electron/bots/
 * editTarget.js, consolidation Phase 3) is the Widget Builder's and the
 * Widgets page's (widgetOwnership.js).
 */
import { deriveWidgetOwnership } from "./widgetOwnership";

import {
  holdsComponent as rendererHolds,
  inPlaceProblem as rendererInPlace,
} from "../Components/Create/editCreate";

const {
  ownsWidget,
  holdsComponent,
  inPlaceProblem,
} = require("../../electron/bots/editTarget");

const CASES = [
  ["@ai-built/inbox", "ai-built.inbox.Inbox", null],
  ["@jg/inbox", "jg.inbox.Inbox", "jg"],
  ["@jg/inbox", "jg.inbox.Inbox", "@JG"],
  ["@jg/inbox", "jg.inbox.Inbox", "someone"],
  ["@jg/inbox", "jg.inbox.Inbox", null],
  ["jg/inbox", null, "jg"],
  [null, "trops.clock.Clock", "trops"],
  [null, "trops.clock.Clock", "jg"],
  ["inbox", "jg.inbox.Inbox", "jg"],
  [null, null, "jg"],
  // A package loaded from the user's folder while signed out (QA
  // 2026-10-22): never changed in place — it would rewrite their folder.
  ["@local/clock", "local.clock.Clock", null],
  ["@local/clock", "local.clock.Clock", "jg"],
  [null, "local.clock.Clock", "jg"],
];

test("@local is never changed in place, on either side", () => {
  for (const username of [null, "jg"]) {
    expect(
      ownsWidget({
        pkg: "@local/clock",
        component: "local.clock.Clock",
        username,
      }),
    ).toBe(false);
    expect(
      deriveWidgetOwnership({
        originalPackage: "@local/clock",
        originalComponentName: "local.clock.Clock",
        registryUsername: username,
      }).isOwner,
    ).toBe(false);
  }
});

test.each(CASES)("%s / %s / %s", (pkg, component, username) => {
  const { isOwner } = deriveWidgetOwnership({
    originalPackage: pkg,
    originalComponentName: component,
    registryUsername: username,
  });
  expect(ownsWidget({ pkg, component, username })).toBe(isOwner);
});

// Which package holds a component: the same in Create and the main process.
const PACKAGES = [
  { name: "inbox", componentNames: ["Inbox"] },
  { name: "@jg/inbox", componentNames: ["Inbox"] },
  {
    name: "@ai-built/notes",
    packageId: "@ai-built/notes",
    componentNames: ["Notes"],
  },
  { name: "@jg/tools", widgets: [{ name: "Clock" }] },
  { name: "@other/inbox", componentNames: ["Inbox"] },
];
const COMPONENTS = [
  "jg.inbox.Inbox",
  "ai-built.notes.Notes",
  "jg.tools.Clock",
  "jg.inbox.Sent",
  "Inbox",
];
test.each(COMPONENTS)("holdsComponent agrees for %s", (component) => {
  for (const w of PACKAGES) {
    expect(rendererHolds(w, component)).toBe(holdsComponent(w, component));
  }
});
test("holdsComponent: its package, not another with the same widget name", () => {
  expect(holdsComponent(PACKAGES[0], "jg.inbox.Inbox")).toBe(true);
  expect(holdsComponent(PACKAGES[1], "jg.inbox.Inbox")).toBe(true);
  expect(holdsComponent(PACKAGES[4], "jg.inbox.Inbox")).toBe(false);
  expect(holdsComponent(PACKAGES[3], "jg.tools.Clock")).toBe(true);
});

// Whether a change can go in place: the same in Create and the main process.
test.each([
  ["@jg/inbox", "Inbox"],
  ["@ai-built/notes", "Notes"],
  ["@AI-Built/Notes", "Notes"],
  ["@ai-built/pipeline", "Stages"],
  ["inbox", "Inbox"],
  ["jg/inbox", "Inbox"],
  ["", "Inbox"],
  [null, null],
])("inPlaceProblem agrees for %s / %s", (pkg, componentName) => {
  const target = { package: pkg, componentName };
  expect(rendererInPlace(target)).toBe(inPlaceProblem(target));
});
