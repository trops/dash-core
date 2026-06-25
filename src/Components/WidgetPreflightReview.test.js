/**
 * WidgetPreflightReview — pins the shared permission-consent panel used
 * by BOTH the on-launch AppUpdatesModal and the Settings → Widgets batch
 * update. The Settings path previously had no consent UI, so a
 * permissioned update hung forever; this component is what unblocks it.
 *
 * Covers:
 *   - renders one row per widget + the per-line permission checkboxes
 *   - Approve emits { acceptedByWidgetId } with the checked lines applied
 *   - unchecking a line excludes it from the approved grant blob
 *   - Cancel emits null (batch unwinds, nothing granted)
 *   - renders nothing when there is no pending preflight
 */
import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  WidgetPreflightReview,
  flattenPreflightLines,
} from "./WidgetPreflightReview";

function makePreflight() {
  return {
    widgets: [
      {
        widgetId: "trops.pipeline.AutomationHub",
        displayName: "AutomationHub",
        packageId: "@trops/pipeline",
        missing: {
          servers: {
            filesystem: {
              tools: ["write_file", "read_file"],
              readPaths: [],
              writePaths: [],
            },
          },
        },
      },
      {
        widgetId: "trops.pipeline.DealNotes",
        displayName: "DealNotes",
        packageId: "@trops/pipeline",
        missing: {
          servers: {
            filesystem: {
              tools: ["list_directory"],
              readPaths: [],
              writePaths: [],
            },
          },
        },
      },
    ],
  };
}

describe("flattenPreflightLines", () => {
  test("flattens tools / readPaths / writePaths into keyed apply-able lines", () => {
    const lines = flattenPreflightLines({
      servers: {
        filesystem: {
          tools: ["write_file"],
          readPaths: ["/a"],
          writePaths: ["/b"],
        },
      },
    });
    expect(lines.map((l) => l.key)).toEqual([
      "mcp:filesystem:tool:write_file",
      "mcp:filesystem:readPath:/a",
      "mcp:filesystem:writePath:/b",
    ]);
    const acc = {};
    lines.forEach((l) => l.apply(acc));
    expect(acc.servers.filesystem.tools).toContain("write_file");
    expect(acc.servers.filesystem.readPaths).toContain("/a");
    expect(acc.servers.filesystem.writePaths).toContain("/b");
  });

  test("returns [] for empty / missing input", () => {
    expect(flattenPreflightLines(null)).toEqual([]);
    expect(flattenPreflightLines({})).toEqual([]);
  });
});

describe("WidgetPreflightReview", () => {
  test("renders header, one row per widget, and per-line checkboxes", () => {
    render(
      <WidgetPreflightReview
        pendingPreflight={makePreflight()}
        resolvePreflight={() => {}}
      />,
    );
    expect(
      screen.getByText("Review 2 widgets before installing"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "widget-preflight-review-widget-trops.pipeline.AutomationHub",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "widget-preflight-review-widget-trops.pipeline.DealNotes",
      ),
    ).toBeInTheDocument();
    // First widget is selected by default → its lines are visible.
    expect(
      screen.getByText("Call write_file on filesystem"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Call read_file on filesystem"),
    ).toBeInTheDocument();
  });

  test("Approve emits acceptedByWidgetId with all lines checked by default", () => {
    const resolvePreflight = jest.fn();
    render(
      <WidgetPreflightReview
        pendingPreflight={makePreflight()}
        resolvePreflight={resolvePreflight}
      />,
    );
    fireEvent.click(screen.getByTestId("widget-preflight-review-approve"));
    expect(resolvePreflight).toHaveBeenCalledTimes(1);
    const decision = resolvePreflight.mock.calls[0][0];
    expect(
      decision.acceptedByWidgetId["trops.pipeline.AutomationHub"].servers
        .filesystem.tools,
    ).toEqual(["write_file", "read_file"]);
    expect(
      decision.acceptedByWidgetId["trops.pipeline.DealNotes"].servers.filesystem
        .tools,
    ).toEqual(["list_directory"]);
  });

  test("unchecking a line excludes it from the approved grant", () => {
    const resolvePreflight = jest.fn();
    render(
      <WidgetPreflightReview
        pendingPreflight={makePreflight()}
        resolvePreflight={resolvePreflight}
      />,
    );
    // Uncheck "Call write_file on filesystem" for the default-selected widget.
    fireEvent.click(screen.getByText("Call write_file on filesystem"));
    fireEvent.click(screen.getByTestId("widget-preflight-review-approve"));
    const decision = resolvePreflight.mock.calls[0][0];
    expect(
      decision.acceptedByWidgetId["trops.pipeline.AutomationHub"].servers
        .filesystem.tools,
    ).toEqual(["read_file"]);
  });

  test("Cancel emits null", () => {
    const resolvePreflight = jest.fn();
    render(
      <WidgetPreflightReview
        pendingPreflight={makePreflight()}
        resolvePreflight={resolvePreflight}
      />,
    );
    fireEvent.click(screen.getByTestId("widget-preflight-review-cancel"));
    expect(resolvePreflight).toHaveBeenCalledWith(null);
  });

  test("renders nothing when there is no pending preflight", () => {
    const { container } = render(
      <WidgetPreflightReview
        pendingPreflight={null}
        resolvePreflight={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
