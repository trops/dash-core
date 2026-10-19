/**
 * Registry dashboard install is blocked when the compatibility check says a
 * required widget is unavailable (consolidation Phase 1e).
 */
import {
  depKeyFor,
  unavailableRequiredWidgets,
} from "./registryDashboardCompat";

const deps = [
  {
    scope: "trops",
    packageName: "slack",
    widgetName: "Channels",
    displayName: "Slack Channels",
  },
  {
    scope: "trops",
    packageName: "gong",
    widgetName: "Calls",
    name: "Gong Calls",
  },
  { name: "Notes", required: false },
];

describe("registryDashboardCompat", () => {
  it("keys a dependency like the compatibility check does", () => {
    expect(depKeyFor(deps[0])).toBe("trops.slack.Channels");
    expect(depKeyFor(deps[2])).toBe("Notes");
  });

  it("names the required widgets that aren't available", () => {
    const compatibility = {
      compatible: false,
      widgets: {
        "trops.slack.Channels": "installed",
        "trops.gong.Calls": "unavailable",
        Notes: "unavailable",
      },
    };
    expect(unavailableRequiredWidgets(deps, compatibility)).toEqual([
      "Gong Calls",
    ]);
  });

  it("treats an unknown status as unavailable", () => {
    const compatibility = { compatible: false, widgets: {} };
    expect(unavailableRequiredWidgets(deps, compatibility)).toEqual([
      "Slack Channels",
      "Gong Calls",
    ]);
  });

  it("blocks nothing when compatible or when there's no check yet", () => {
    expect(
      unavailableRequiredWidgets(deps, { compatible: true, widgets: {} }),
    ).toEqual([]);
    expect(unavailableRequiredWidgets(deps, null)).toEqual([]);
  });
});
