/**
 * grantStaleness.test.js
 *
 * Pin for the pure helpers that compute which granted items are
 * "stale" (granted but no longer requested by the widget) and whether
 * a whole server's grant is entirely stale.
 *
 * The manifest scanner only extracts TOOL names from `callTool("X")`
 * literals. It does NOT extract filesystem paths — those have no
 * static-analyzable source (paths are runtime arguments). So tools
 * are validatable; paths are not. The renderer must NOT mark path
 * grants as stale, even when the declared block lists no paths,
 * because absence of a declared path means "the scanner can't tell"
 * — not "the widget no longer needs it."
 */
"use strict";

import { computeStaleItems, isServerEntirelyStale } from "./grantStaleness";

describe("computeStaleItems", () => {
  test("validatesStale=true: granted items not in declared are stale", () => {
    const stale = computeStaleItems(
      ["search_emails", "send_email"],
      ["search_emails", "read_email"],
      true,
    );
    expect(stale.has("read_email")).toBe(true);
    expect(stale.has("search_emails")).toBe(false);
  });

  test("validatesStale=true: empty declared marks all granted as stale", () => {
    const stale = computeStaleItems([], ["a", "b"], true);
    expect(stale.has("a")).toBe(true);
    expect(stale.has("b")).toBe(true);
  });

  test("validatesStale=false: nothing is ever stale (paths case)", () => {
    const stale = computeStaleItems([], ["/Users/john", "/tmp/x"], false);
    expect(stale.size).toBe(0);
  });

  test("validatesStale=false with declared items: still nothing stale", () => {
    // Even if the manifest happened to declare paths, the renderer
    // shouldn't second-guess what the user authorized at runtime.
    const stale = computeStaleItems(["/a"], ["/a", "/b"], false);
    expect(stale.size).toBe(0);
  });

  test("handles missing arrays gracefully", () => {
    expect(computeStaleItems(undefined, undefined, true).size).toBe(0);
    expect(computeStaleItems(null, null, true).size).toBe(0);
    expect(computeStaleItems([], [], true).size).toBe(0);
  });
});

describe("isServerEntirelyStale", () => {
  test("entirely stale only when EVERY tool is missing from declared", () => {
    expect(
      isServerEntirelyStale({ tools: ["a", "b"] }, { tools: ["a", "c"] }),
    ).toBe(false);
    expect(
      isServerEntirelyStale({ tools: ["a", "b"] }, { tools: ["c", "d"] }),
    ).toBe(true);
  });

  test("entirely stale only considers tools, NOT paths", () => {
    // The widget's source declares no paths (scanner limitation),
    // but it does declare and use tools that match. The grant has
    // both matching tools AND read paths the scanner can't validate.
    // The whole-server banner must not fire — tools join correctly,
    // and paths shouldn't tip the verdict either way.
    const decl = { tools: ["read_file"], readPaths: [], writePaths: [] };
    const grant = {
      tools: ["read_file"],
      readPaths: ["/Users/john"],
      writePaths: [],
    };
    expect(isServerEntirelyStale(decl, grant)).toBe(false);
  });

  test("server with paths only (no tools either side) is NOT entirely stale", () => {
    // Paths-only grant against paths-empty manifest: scanner just
    // doesn't speak paths. Quiet pass-through.
    const decl = { tools: [], readPaths: [], writePaths: [] };
    const grant = {
      tools: [],
      readPaths: ["/Users/john"],
      writePaths: [],
    };
    expect(isServerEntirelyStale(decl, grant)).toBe(false);
  });

  test("returns false when grant is null/undefined", () => {
    expect(isServerEntirelyStale({ tools: ["x"] }, null)).toBe(false);
    expect(isServerEntirelyStale({ tools: ["x"] }, undefined)).toBe(false);
  });

  test("returns false when grant has no tools at all (nothing to be stale about)", () => {
    expect(
      isServerEntirelyStale(
        { tools: ["x"] },
        { tools: [], readPaths: [], writePaths: [] },
      ),
    ).toBe(false);
  });
});
