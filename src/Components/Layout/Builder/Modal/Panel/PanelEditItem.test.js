/**
 * PanelEditItem — widget Settings tab keystroke + propagation pins.
 *
 * Two regressions to guard against:
 *
 *   1. (already fixed in this PR) renderCustomSettings used to read
 *      userPrefs via LayoutModel(itemSelected, workspaceSelected),
 *      which hard-resets `layout.userPrefs = {}` then overwrites
 *      from widgetConfig.userPrefs (template defaults) — silently
 *      dropping the instance's `obj.userPrefs`. Every render stripped
 *      the in-flight typed value, snapping the controlled <InputText>
 *      back to "". The first describe block below pins that fix.
 *
 *   2. (also fixed in this PR) handleTextChangeCustom used to call
 *      handleUpdate() per keystroke. That deep-clones the workspace
 *      via WorkspaceModel + walks the layout tree via
 *      replaceItemInLayout + re-renders the whole modal subtree
 *      (sidebar/body/footer) on every char — characters landed but
 *      typing felt sluggish. Now it only updates LOCAL state; the
 *      heavy workspace recompute + parent propagation runs on Save
 *      via a flushRef (or on unmount, e.g. when the user switches
 *      sidebar tabs without saving). The later describe blocks pin
 *      the flushRef wiring.
 *
 * Static source-presence tests, matching the surrounding
 * Panel/*.test.js style. Mount-and-type tests for the modal stack
 * are heavy (ComponentManager, ThemeContext, LayoutModel side
 * effects on import); static pins catch the load-bearing edits
 * without pulling in the whole render tree.
 */
const fs = require("fs");
const path = require("path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "PanelEditItem.js"),
  "utf8",
);
const MODAL_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "LayoutBuilderConfigModal.js"),
  "utf8",
);

function extractFunctionBlock(name, source = SOURCE) {
  const startIdx = source.indexOf(`function ${name}(`);
  if (startIdx === -1) throw new Error(`function ${name} not found`);
  // Match the function body up to the closing `\n  }\n` at its end
  // (consistent indentation: top-level function inside the component
  // body, 2-space indent).
  const remainder = source.slice(startIdx);
  const endMatch = remainder.match(/\n {2}\}\n/);
  if (!endMatch) throw new Error(`could not find end of function ${name}`);
  return remainder.slice(0, endMatch.index + endMatch[0].length);
}

function stripComments(src) {
  // Drop /* … */ blocks and // line comments so symbol-presence tests
  // only inspect actual code, not explanatory prose about the bug.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("PanelEditItem.handleTextChangeCustom — local-only on each keystroke", () => {
  const handler = stripComments(extractFunctionBlock("handleTextChangeCustom"));

  test("updates local state synchronously via setItemSelected", () => {
    // The controlled InputText reads from itemSelected; without a
    // synchronous local update the input visibly lags the keystroke.
    expect(handler).toMatch(/setItemSelected\(/);
  });

  test("does NOT call handleUpdate per keystroke (heavy work is deferred)", () => {
    // handleUpdate runs WorkspaceModel(workspaceSelected) — a deep
    // clone of the entire workspace — plus replaceItemInLayout, plus
    // parent setState that re-renders the whole modal. Doing that
    // per keystroke is the cause of the typing-feels-sluggish bug.
    expect(handler).not.toMatch(/handleUpdate\s*\(/);
  });

  test("marks the panel dirty so flushPending / unmount cleanup will propagate", () => {
    // Dirty flag is the bridge between per-keystroke local edits and
    // the Save/unmount flush. If this assertion fails, the local
    // edits will be silently lost on Save.
    expect(handler).toMatch(/dirtyRef\.current\s*=\s*true/);
  });

  test("writes the new value into newItem.userPrefs[key] (read target unchanged)", () => {
    // The controlled InputText reads from itemSelected.userPrefs[key]
    // in renderCustomSettings. If a refactor moves the write into a
    // sibling field (e.g. userConfigValues), the read has to be
    // updated to match. This test fails noisily if those drift apart.
    expect(handler).toMatch(/newItem\["userPrefs"\]\[key\]\s*=\s*value/);
  });
});

describe("PanelEditItem.flushPending — workspace recompute deferred to Save / unmount", () => {
  const flush = stripComments(extractFunctionBlock("flushPending"));

  test("guards on dirtyRef so a no-op call (e.g. Save with no edits) costs nothing", () => {
    // The whole point of deferring propagation is to avoid the
    // workspace clone unless something actually changed. Guarding on
    // dirtyRef keeps Save-without-edits and tab-switch-without-edits
    // free of the heavy work.
    expect(flush).toMatch(/if\s*\(\s*!dirtyRef\.current\s*\)/);
  });

  test("rebuilds the workspace via WorkspaceModel + replaceItemInLayout", () => {
    // This is the work we removed from the per-keystroke path.
    // It must still happen on flush, otherwise the saved workspace
    // doesn't reflect the user's edits.
    expect(flush).toMatch(/WorkspaceModel\(/);
    expect(flush).toMatch(/replaceItemInLayout\(/);
  });

  test("calls onUpdate so the modal's workspaceSelected state stays in sync", () => {
    // Even though the caller gets the workspace back via the return
    // value, we still propagate via onUpdate so the modal's local
    // state mirrors what was just saved. Otherwise the modal would
    // show pre-flush state if the user re-opens the same widget.
    expect(flush).toMatch(/onUpdateRef\.current\(/);
  });

  test("returns the freshly-built workspace synchronously so the caller can save it without awaiting setState", () => {
    // React setState is async — the modal's workspaceSelected won't
    // reflect the flush by the time handleSaveConfig calls
    // onSaveWorkspace. Returning the workspace synchronously lets
    // the modal use the fresh value directly.
    expect(flush).toMatch(/return\s*\{\s*item:[^,]*,\s*workspace:/);
  });

  test("clears dirtyRef after flushing so a second flush is a cheap no-op", () => {
    expect(flush).toMatch(/dirtyRef\.current\s*=\s*false/);
  });
});

describe("PanelEditItem — flushRef + unmount cleanup wiring", () => {
  test("declares a flushRef prop with a null default", () => {
    expect(SOURCE).toMatch(/flushRef\s*=\s*null/);
  });

  test("assigns flushPending into flushRef.current inside a useEffect", () => {
    // The modal passes a ref in; we mount flushPending into it so the
    // modal can call it before Save. Cleanup must null out
    // flushRef.current so a re-mount (e.g. tab switch back) doesn't
    // leave a stale handle from the previous mount.
    expect(SOURCE).toMatch(/flushRef\.current\s*=\s*flushPending/);
    expect(SOURCE).toMatch(
      /flushRef\.current\s*===\s*flushPending[\s\S]{0,80}flushRef\.current\s*=\s*null/,
    );
  });

  test("flushes pending edits on unmount via a useEffect cleanup", () => {
    // Tab switch unmounts PanelEditItem (the modal conditionally
    // renders only the active section). Without this cleanup, a
    // user typing in Settings and then clicking Providers would
    // lose their edits without warning.
    const stripped = stripComments(SOURCE);
    expect(stripped).toMatch(
      /return\s*\(\s*\)\s*=>\s*\{[\s\S]*?if\s*\(\s*dirtyRef\.current\s*\)[\s\S]*?flushPending\s*\(/,
    );
  });
});

describe("PanelEditItem.renderCustomSettings — reads userPrefs directly off itemSelected", () => {
  const renderer = stripComments(extractFunctionBlock("renderCustomSettings"));

  test("does NOT pipe userPrefs through LayoutModel", () => {
    // LayoutModel resets userPrefs to widgetConfig template defaults
    // and only merges back obj.userConfigValues; instance-level
    // obj.userPrefs is dropped. Reading through it strips the
    // user's typed value on every render.
    expect(renderer).not.toMatch(/LayoutModel\(/);
  });

  test("reads userPrefs from itemSelected.userPrefs", () => {
    expect(renderer).toMatch(/itemSelected\.userPrefs/);
  });
});

describe("PanelEditItem — unused LayoutModel import dropped", () => {
  test("LayoutModel is no longer imported", () => {
    // Belt-and-suspenders: leaving the import in place would let a
    // future edit accidentally re-introduce the LayoutModel(itemSelected)
    // call without anyone noticing. Drop the dependency to make any
    // re-introduction visible as a new import line in review.
    expect(SOURCE).not.toMatch(/import\s*\{[^}]*\bLayoutModel\b/);
  });
});

describe("LayoutBuilderConfigModal — wires the flushRef so Save reads fresh state", () => {
  test("declares panelEditFlushRef via useRef(null)", () => {
    expect(MODAL_SOURCE).toMatch(/panelEditFlushRef\s*=\s*useRef\(null\)/);
  });

  test("passes panelEditFlushRef into <PanelEditItem flushRef=...>", () => {
    expect(MODAL_SOURCE).toMatch(/flushRef=\{panelEditFlushRef\}/);
  });

  test("handleSaveConfig calls the flush and uses the returned workspace, not the stale state", () => {
    // The bug we're guarding against: calling onSaveWorkspace
    // (workspaceSelected) directly would save the pre-flush state
    // because setState is async. Reading from the flush return value
    // sidesteps that.
    const save = stripComments(
      extractFunctionBlock("handleSaveConfig", MODAL_SOURCE),
    );
    expect(save).toMatch(/panelEditFlushRef\.current\(/);
    expect(save).toMatch(/flushed\.workspace/);
    expect(save).toMatch(/onSaveWorkspace\(workspaceToSave\)/);
  });
});
