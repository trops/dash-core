/**
 * grantSummary.test.js
 *
 * Pin for the plain-English copy that drives the revoke-confirmation
 * banners. Bug-prone spots: pluralization, joining 1/2/3-item lists,
 * and the "this server's grants" fallback when a grant exists but
 * has no concrete content (shouldn't happen at runtime but defensive
 * is cheap).
 */
"use strict";

import { describeServerGrant, describeWidgetGrant } from "./grantSummary";

describe("describeServerGrant", () => {
  test("singular tool", () => {
    expect(
      describeServerGrant({
        tools: ["read_email"],
        readPaths: [],
        writePaths: [],
      }),
    ).toBe("1 tool grant");
  });

  test("plural tools", () => {
    expect(
      describeServerGrant({
        tools: ["read_email", "send_email"],
        readPaths: [],
        writePaths: [],
      }),
    ).toBe("2 tool grants");
  });

  test("tools + read paths", () => {
    expect(
      describeServerGrant({
        tools: ["read_file"],
        readPaths: ["/a", "/b"],
        writePaths: [],
      }),
    ).toBe("1 tool grant and 2 read paths");
  });

  test("tools + read + write — Oxford comma joining", () => {
    expect(
      describeServerGrant({
        tools: ["t"],
        readPaths: ["/r"],
        writePaths: ["/w1", "/w2"],
      }),
    ).toBe("1 tool grant, 1 read path, and 2 write paths");
  });

  test("paths only (no tools)", () => {
    expect(
      describeServerGrant({
        tools: [],
        readPaths: ["/a"],
        writePaths: [],
      }),
    ).toBe("1 read path");
  });

  test("null grant", () => {
    expect(describeServerGrant(null)).toBe("this server's grants");
  });

  test("grant with all empty arrays", () => {
    expect(
      describeServerGrant({ tools: [], readPaths: [], writePaths: [] }),
    ).toBe("this server's grants");
  });
});

describe("describeWidgetGrant", () => {
  test("single server, single tool", () => {
    expect(
      describeWidgetGrant({
        gmail: { tools: ["read_email"], readPaths: [], writePaths: [] },
      }),
    ).toBe("1 tool grant across 1 server");
  });

  test("multiple servers, mixed contents", () => {
    expect(
      describeWidgetGrant({
        gmail: {
          tools: ["read_email", "send_email"],
          readPaths: [],
          writePaths: [],
        },
        filesystem: {
          tools: ["read_file"],
          readPaths: ["/a", "/b"],
          writePaths: ["/w"],
        },
      }),
    ).toBe("3 tool grants, 2 read paths, and 1 write path across 2 servers");
  });

  test("empty servers map", () => {
    expect(describeWidgetGrant({})).toBe("this widget's grants");
  });

  test("server with empty content still counts in server count", () => {
    expect(
      describeWidgetGrant({
        gmail: { tools: [], readPaths: [], writePaths: [] },
      }),
    ).toBe("this widget's grants across 1 server");
  });
});
