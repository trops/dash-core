/**
 * Providers tab theming pin — ProvidersTab must NOT wrap its sidebar
 * or detail pane in `<Card2>`.
 *
 * Why this test exists: `<Card2>` resolves to `bg-secondary-very-light`
 * (a contrasting card surface, see dash-react `Utils/colors.js:161`).
 * Inside the DashboardConfigModal — which already has a dark
 * `bg-primary-medium` background — a Card2 wrapper reads as a washed-
 * out fill that doesn't match any other tab in the modal (Widgets,
 * Listeners, Notifications, Permissions, Dependencies all use plain
 * `<div>` wrappers and inherit the modal's chrome).
 *
 * Pre-fix the Providers tab wrapped both its sidebar (PROVIDER TYPES
 * list) and its detail pane in `<Card2>`. The visual jolt when
 * switching from Widgets → Providers read as "different modal," not
 * "different tab." Replacing with plain `<div>` containers fixed it.
 *
 * Static source-presence test (mirrors the existing
 * DashboardConfigModal.bulk.test.js style) — extracting the
 * `ProvidersTab` function for render testing would be more churn than
 * the regression guard is worth.
 */
const fs = require("fs");
const path = require("path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "DashboardConfigModal.js"),
  "utf8",
);

function extractProvidersTabSource(source) {
  // ProvidersTab starts at `function ProvidersTab(` and ends at the
  // start of the NEXT top-level function in the file. The next one
  // is `function ProviderTypeRow(` (legacy row component, intentionally
  // unchanged — see file-level comment). Slice between those two
  // anchors so we test only the ProvidersTab body and don't
  // accidentally cover the legacy component below it.
  const startIdx = source.indexOf("function ProvidersTab(");
  if (startIdx === -1) throw new Error("ProvidersTab function not found");
  const endIdx = source.indexOf("\nfunction ProviderTypeRow(", startIdx);
  if (endIdx === -1)
    throw new Error("ProviderTypeRow function not found after ProvidersTab");
  return source.slice(startIdx, endIdx);
}

describe("DashboardConfigModal — ProvidersTab theming", () => {
  const providersTabBody = extractProvidersTabSource(SOURCE);

  test("ProvidersTab does NOT wrap its panes in <Card2>", () => {
    // <Card2 ...> elements add a `bg-secondary-very-light` fill that
    // doesn't match the modal's dark chrome. Sibling tabs in this
    // modal use plain <div> wrappers; ProvidersTab must too.
    expect(providersTabBody).not.toMatch(/<Card2\b/);
  });

  test("ProvidersTab still has the sidebar 'Provider Types' label", () => {
    // Anchor check — confirms we're matching the right slice. If
    // someone reorganizes the modal and ProvidersTab loses this
    // header, that's a structural change worth a CR conversation.
    expect(providersTabBody).toMatch(/Provider Types/);
  });

  test("ProvidersTab sidebar uses plain <div> with the established w-56 column width", () => {
    // Mirrors WidgetsTab's structural pattern: a fixed-width column
    // (w-56) sitting next to a flex-1 detail pane, both as plain
    // <div>. The width is what makes the side rail readable; pinning
    // it prevents an over-eager simplification.
    expect(providersTabBody).toMatch(
      /<div className="w-56 flex-shrink-0 overflow-hidden flex flex-col[^"]*"/,
    );
  });

  test("ProvidersTab detail pane uses plain <div> with flex-1 to fill remaining space", () => {
    expect(providersTabBody).toMatch(
      /<div className="flex-1 min-w-0 overflow-hidden flex flex-col"/,
    );
  });

  // Sanity guard: the legacy ProviderTypeRow below ProvidersTab still
  // uses <Card2> by design (it's a stand-alone row card, not a
  // full-width pane). The slice above intentionally stops before
  // ProviderTypeRow so this regression test doesn't get tangled up
  // with the legacy component's styling choice.
  test("legacy ProviderTypeRow component (unchanged) is preserved below", () => {
    // Just confirms the slicing logic: ProviderTypeRow IS still in the
    // source file. If someone removes it, this test fails loudly so
    // we don't silently lose coverage on a still-shipping component.
    expect(SOURCE).toMatch(/function ProviderTypeRow\(/);
  });
});

/**
 * Listeners-tab theming pin — ListenersTab + its HandlersColumn /
 * EventsColumn sub-components must NOT wrap their panes in <Card2>.
 *
 * Same reasoning as ProvidersTab above: Card2's `bg-secondary-very-light`
 * reads as a washed-out fill against the modal's dark chrome. Plain
 * <div> wrappers inherit the chrome correctly.
 *
 * Previously ListenersTab's sidebar (Widgets), its empty-state
 * placeholder ("Pick a widget on the left..."), HandlersColumn's
 * sidebar (Event Handlers), EventsColumn's empty state ("Select a
 * handler..."), and EventsColumn's main pane all wrapped in Card2.
 * The visual jolt when switching to Listeners read as "different
 * modal," not "different tab."
 */
function extractFunctionBody(source, name) {
  const startIdx = source.indexOf(`function ${name}(`);
  if (startIdx === -1) throw new Error(`function ${name} not found`);
  // End the slice at the next top-level function declaration so we
  // only test the body of THIS function, not anything below it.
  const remainder = source.slice(startIdx);
  const nextFn = remainder.search(/\n\nfunction [A-Z][a-zA-Z]+\(/);
  return nextFn !== -1 ? remainder.slice(0, nextFn) : remainder;
}

describe("DashboardConfigModal — ListenersTab theming", () => {
  const listenersTabBody = extractFunctionBody(SOURCE, "ListenersTab");
  const handlersColumnBody = extractFunctionBody(SOURCE, "HandlersColumn");
  const eventsColumnBody = extractFunctionBody(SOURCE, "EventsColumn");
  const orphanBannerBody = extractFunctionBody(SOURCE, "OrphanBanner");

  test("ListenersTab body does NOT wrap any pane in <Card2>", () => {
    expect(listenersTabBody).not.toMatch(/<Card2\b/);
  });

  test("HandlersColumn does NOT wrap its sidebar in <Card2>", () => {
    expect(handlersColumnBody).not.toMatch(/<Card2\b/);
  });

  test("EventsColumn does NOT wrap its empty-state or main pane in <Card2>", () => {
    expect(eventsColumnBody).not.toMatch(/<Card2\b/);
  });

  test("OrphanBanner does NOT wrap its banner in <Card2>", () => {
    // Belt-and-suspenders — OrphanBanner sits inside ListenersTab
    // and would propagate the washed-out fill if it picked up
    // Card2 in the future.
    expect(orphanBannerBody).not.toMatch(/<Card2\b/);
  });

  test("ListenersTab sidebar uses plain <div> with the established w-56 column width", () => {
    // Same structural pattern as ProvidersTab + WidgetsTab.
    expect(listenersTabBody).toMatch(
      /<div className="w-56 flex-shrink-0 overflow-hidden flex flex-col"/,
    );
  });

  test("HandlersColumn sidebar uses plain <div> with the established w-56 column width", () => {
    expect(handlersColumnBody).toMatch(
      /<div className="w-56 flex-shrink-0 overflow-hidden flex flex-col"/,
    );
  });

  test("EventsColumn main pane uses plain <div> with flex-1 to fill remaining space", () => {
    expect(eventsColumnBody).toMatch(
      /<div className="flex-1 min-w-0 overflow-hidden flex flex-col"/,
    );
  });
});
