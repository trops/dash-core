/**
 * WidgetSidebar.test.js
 *
 * Static regression check that every `widget.providers` iterator in
 * WidgetSidebar is routed through `getUserConfigurableProviders`.
 *
 * Background: a sparse providers array (`[{type:"x"}, null, {type:"y"}]`)
 * shipped with the @ai-built/pipeline package and crashed the entire
 * sidebar in production:
 *
 *     TypeError: Cannot read properties of null (reading 'type')
 *
 * The fix funneled every iterator through `getUserConfigurableProviders`
 * (already null-tolerant). A render-based test would require mocking
 * react-dnd, @headlessui, dash-react, ThemeContext, ComponentManager,
 * and the entire DragDropContext just to exercise three lines of
 * `forEach` / `map` / `some`. The actual null-tolerance logic is
 * locked in `utils/providerUtils.test.js`. What's worth pinning HERE
 * is that none of the iterators get refactored back to direct
 * `widget.providers.<iter>(...)` access — that's a textual property,
 * so a textual test is the right tool.
 *
 * If this test fails it means someone added a new direct-iteration
 * call site (or removed a route-through). Re-add the
 * `getUserConfigurableProviders(...)` wrapper before merging.
 */

import fs from "fs";
import path from "path";

const SOURCE = fs.readFileSync(
  path.join(__dirname, "WidgetSidebar.js"),
  "utf8",
);

describe("WidgetSidebar — provider iteration safety", () => {
  test("imports getUserConfigurableProviders", () => {
    expect(SOURCE).toMatch(
      /import\s*\{\s*getUserConfigurableProviders\s*\}\s*from\s*["'][^"']*providerUtils["']/,
    );
  });

  test("no direct .forEach / .map / .some on widget.providers", () => {
    // Match any direct iteration on a `.providers` array:
    //   widget.providers.forEach(...)
    //   widget.providers.map(...)
    //   widget.providers.some(...)
    //   (widget.providers || []).forEach(...)   ← still wrong, throws on entry === null
    //
    // The negative cases are also matched and asserted to be zero.
    const directIter =
      /(?:widget\??\.providers|\(\s*widget\??\.providers\s*\|\|\s*\[\]\s*\))\s*\.\s*(?:forEach|map|some|filter|reduce)\s*\(/g;
    const matches = SOURCE.match(directIter) || [];
    expect(matches).toEqual([]);
  });

  test("every providers iteration goes through getUserConfigurableProviders", () => {
    // Every call site we care about should look like:
    //   getUserConfigurableProviders(widget.providers).<iter>(...)
    //   getUserConfigurableProviders(widget?.providers).<iter>(...)
    // We expect at LEAST 3 such call sites (DraggableWidgetItem
    // chip render, uniqueProviders useMemo, filteredGrouped predicate).
    const helperIter =
      /getUserConfigurableProviders\s*\(\s*widget\??\.providers\s*\)/g;
    const matches = SOURCE.match(helperIter) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});
