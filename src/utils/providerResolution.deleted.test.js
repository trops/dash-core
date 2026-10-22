/**
 * A binding to a provider that has since been deleted is unresolved, so
 * the widget gets its missing-provider pill (QA 2026-10-22: deleting an
 * in-use provider left no pill). Before the provider list has loaded, an
 * empty list is "not known yet" and nothing is flagged.
 */
import {
  providerExists,
  resolveProviderName,
  getUnresolvedProviders,
  getAllProviderBindings,
} from "./providerResolution";
import { dashboardSummary } from "../Components/AppPages/dashboardSummary";

const slack = { name: "Slack", type: "slack" };

describe("providerExists", () => {
  test("finds a name in a map or an array", () => {
    expect(providerExists({ Slack: slack }, "Slack", true)).toBe(true);
    expect(providerExists([slack], "Slack", true)).toBe(true);
    expect(providerExists({ Slack: slack }, "Gone", true)).toBe(false);
    expect(providerExists([slack], "Gone")).toBe(false);
  });

  test("an empty list counts as unknown until loaded", () => {
    expect(providerExists({}, "Slack")).toBe(true);
    expect(providerExists(undefined, "Slack")).toBe(true);
    expect(providerExists({}, "Slack", true)).toBe(false);
  });
});

describe("resolveProviderName with a deleted provider", () => {
  test("a widget-level pick of a deleted provider is null, not the default", () => {
    const appProviders = {
      Other: { name: "Other", type: "slack", isDefaultForType: true },
    };
    expect(
      resolveProviderName({
        providerType: "slack",
        layoutItem: { selectedProviders: { slack: "Slack" } },
        appProviders,
        providersLoaded: true,
      }),
    ).toBe(null);
  });

  test("a workspace-level pick of a deleted provider is null", () => {
    expect(
      resolveProviderName({
        providerType: "slack",
        layoutItem: {},
        widgetId: "w1",
        workspace: { selectedProviders: { w1: { slack: "Slack" } } },
        appProviders: {},
        providersLoaded: true,
      }),
    ).toBe(null);
  });

  test("a pick of an existing provider still resolves", () => {
    expect(
      resolveProviderName({
        providerType: "slack",
        layoutItem: { selectedProviders: { slack: "Slack" } },
        appProviders: { Slack: slack },
        providersLoaded: true,
      }),
    ).toBe("Slack");
  });
});

describe("getUnresolvedProviders", () => {
  const workspace = {
    id: 1,
    layout: [
      {
        id: 7,
        uuidString: "u7",
        dashboardId: 1,
        component: "@me/slack.Inbox",
        selectedProviders: { slack: "Slack" },
      },
    ],
  };
  const getWidgetRequirements = () => [{ type: "slack", required: true }];

  test("lists a widget bound to a deleted provider once providers loaded", () => {
    const rows = getUnresolvedProviders({
      workspace,
      appProviders: {},
      providersLoaded: true,
      getWidgetRequirements,
    });
    expect(rows.map((r) => r.providerType)).toEqual(["slack"]);
  });

  test("lists nothing while providers are still loading", () => {
    expect(
      getUnresolvedProviders({
        workspace,
        appProviders: {},
        getWidgetRequirements,
      }),
    ).toEqual([]);
  });

  // The last provider deleted: the Config modal's Providers tab and the
  // Dashboards page summary agree with the card (review of PR #792).
  test("the Config modal's bindings show the deleted last provider as missing", () => {
    const [row] = getAllProviderBindings({
      workspace,
      appProviders: {},
      providersLoaded: true,
      getWidgetRequirements,
    });
    expect(row.resolvedProviderName).toBe(null);
  });

  test("the Dashboards page counts it unresolved", () => {
    const summary = dashboardSummary(workspace, {
      getWidgetRequirements,
      appProviders: {},
      providersLoaded: true,
    });
    expect(summary.unresolvedProviders).toBe(1);
  });
});
