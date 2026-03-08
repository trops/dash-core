const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  collectComponentNames,
  extractEventWiring,
  buildWidgetDependencies,
  buildProviderRequirements,
  applyEventWiringToLayout,
  checkDashboardCompatibility,
} = require("../schema/dashboardConfigUtils");

describe("collectComponentNames", () => {
  it("extracts component names from grid cells", () => {
    const layout = [
      {
        id: 1,
        type: "grid",
        component: "LayoutGridContainer",
        grid: {
          rows: 2,
          cols: 1,
          1.1: { component: "AlgoliaSearchPage", hide: false },
          2.1: { component: "AlgoliaHits", hide: false },
        },
      },
    ];
    const names = collectComponentNames(layout);
    assert.ok(names.includes("AlgoliaSearchPage"));
    assert.ok(names.includes("AlgoliaHits"));
    assert.ok(!names.includes("LayoutGridContainer"));
  });

  it("extracts widget-type components", () => {
    const layout = [
      { id: 1, type: "widget", component: "SlackWidget" },
      { id: 2, type: "widget", component: "GitHubWidget" },
    ];
    const names = collectComponentNames(layout);
    assert.ok(names.includes("SlackWidget"));
    assert.ok(names.includes("GitHubWidget"));
  });

  it("excludes container components", () => {
    const layout = [
      { id: 1, type: "grid", component: "LayoutGridContainer" },
      { id: 2, type: "layout", component: "Container" },
    ];
    const names = collectComponentNames(layout);
    assert.ok(!names.includes("LayoutGridContainer"));
    assert.ok(!names.includes("Container"));
  });

  it("returns empty array for empty layout", () => {
    assert.deepEqual(collectComponentNames([]), []);
  });

  it("deduplicates component names", () => {
    const layout = [
      {
        id: 1,
        type: "grid",
        component: "LayoutGridContainer",
        grid: {
          rows: 1,
          cols: 2,
          1.1: { component: "SearchWidget", hide: false },
          1.2: { component: "SearchWidget", hide: false },
        },
      },
    ];
    const names = collectComponentNames(layout);
    const searchCount = names.filter((n) => n === "SearchWidget").length;
    assert.equal(searchCount, 1);
  });
});

describe("extractEventWiring", () => {
  it("extracts wiring from object-format listeners", () => {
    const layout = [
      {
        id: 2,
        component: "ReceiverWidget",
        listeners: {
          buttonClicked: { SenderWidget: "onButtonClicked" },
        },
      },
    ];
    const wiring = extractEventWiring(layout);
    assert.equal(wiring.length, 1);
    assert.equal(wiring[0].source.widget, "SenderWidget");
    assert.equal(wiring[0].source.event, "buttonClicked");
    assert.equal(wiring[0].target.widget, "ReceiverWidget");
    assert.equal(wiring[0].target.handler, "onButtonClicked");
  });

  it("extracts wiring from string-format listeners", () => {
    const layout = [
      {
        id: 2,
        component: "ReceiverWidget",
        listeners: {
          queryChanged: "SenderWidget",
        },
      },
    ];
    const wiring = extractEventWiring(layout);
    assert.equal(wiring.length, 1);
    assert.equal(wiring[0].source.widget, "SenderWidget");
    assert.equal(wiring[0].source.event, "queryChanged");
    assert.equal(wiring[0].target.widget, "ReceiverWidget");
  });

  it("returns empty array for layout without listeners", () => {
    const layout = [
      { id: 1, component: "Widget1" },
      { id: 2, component: "Widget2", listeners: {} },
    ];
    const wiring = extractEventWiring(layout);
    assert.equal(wiring.length, 0);
  });

  it("handles multiple listeners on one widget", () => {
    const layout = [
      {
        id: 1,
        component: "TargetWidget",
        listeners: {
          eventA: { SourceA: "handlerA" },
          eventB: { SourceB: "handlerB" },
        },
      },
    ];
    const wiring = extractEventWiring(layout);
    assert.equal(wiring.length, 2);
  });
});

describe("buildWidgetDependencies", () => {
  it("creates dependency entries from component names", () => {
    const deps = buildWidgetDependencies(["WidgetA", "WidgetB"]);
    assert.equal(deps.length, 2);
    assert.equal(deps[0].package, "WidgetA");
    assert.equal(deps[0].required, true);
  });

  it("deduplicates component names", () => {
    const deps = buildWidgetDependencies(["WidgetA", "WidgetA"]);
    assert.equal(deps.length, 1);
  });

  it("resolves metadata from widget registry", () => {
    const mockRegistry = {
      getWidgets: () => [
        {
          name: "@trops/slack-widgets",
          version: "1.2.0",
          author: "Dash Team",
          componentNames: ["SlackWidget"],
        },
      ],
    };
    const deps = buildWidgetDependencies(["SlackWidget"], mockRegistry);
    assert.equal(deps.length, 1);
    assert.equal(deps[0].package, "@trops/slack-widgets");
    assert.equal(deps[0].version, "1.2.0");
    assert.equal(deps[0].author, "Dash Team");
  });
});

describe("buildProviderRequirements", () => {
  it("returns empty array without registry", () => {
    const providers = buildProviderRequirements(["SlackWidget"]);
    assert.deepEqual(providers, []);
  });

  it("aggregates providers from widget registry", () => {
    const mockRegistry = {
      getWidgets: () => [
        {
          name: "@trops/slack",
          componentNames: ["SlackWidget"],
          providers: [{ type: "slack", providerClass: "mcp", required: true }],
        },
      ],
    };
    const providers = buildProviderRequirements(["SlackWidget"], mockRegistry);
    assert.equal(providers.length, 1);
    assert.equal(providers[0].type, "slack");
    assert.equal(providers[0].providerClass, "mcp");
    assert.deepEqual(providers[0].usedBy, ["SlackWidget"]);
  });

  it("deduplicates providers used by multiple widgets", () => {
    const mockRegistry = {
      getWidgets: () => [
        {
          name: "@trops/algolia",
          componentNames: ["AlgoliaSearch", "AlgoliaHits"],
          providers: [
            {
              type: "algolia",
              providerClass: "credential",
              required: true,
            },
          ],
        },
      ],
    };
    const providers = buildProviderRequirements(
      ["AlgoliaSearch", "AlgoliaHits"],
      mockRegistry,
    );
    assert.equal(providers.length, 1);
    assert.deepEqual(providers[0].usedBy, ["AlgoliaSearch", "AlgoliaHits"]);
  });
});

describe("applyEventWiringToLayout", () => {
  it("applies event wiring to matching layout items", () => {
    const layout = [
      { id: 1, component: "SenderWidget" },
      { id: 2, component: "ReceiverWidget" },
    ];
    const eventWiring = [
      {
        source: { widget: "SenderWidget", event: "buttonClicked" },
        target: {
          widget: "ReceiverWidget",
          handler: "onButtonClicked",
        },
      },
    ];
    applyEventWiringToLayout(layout, eventWiring);
    assert.deepEqual(layout[1].listeners, {
      buttonClicked: { SenderWidget: "onButtonClicked" },
    });
  });

  it("does not modify items without matching wiring", () => {
    const layout = [
      { id: 1, component: "SenderWidget" },
      { id: 2, component: "ReceiverWidget" },
    ];
    const eventWiring = [
      {
        source: { widget: "SenderWidget", event: "clicked" },
        target: { widget: "ReceiverWidget", handler: "onClick" },
      },
    ];
    applyEventWiringToLayout(layout, eventWiring);
    assert.equal(layout[0].listeners, undefined);
  });

  it("handles multiple wiring entries for same target", () => {
    const layout = [{ id: 1, component: "TargetWidget" }];
    const eventWiring = [
      {
        source: { widget: "SourceA", event: "eventA" },
        target: { widget: "TargetWidget", handler: "handlerA" },
      },
      {
        source: { widget: "SourceB", event: "eventB" },
        target: { widget: "TargetWidget", handler: "handlerB" },
      },
    ];
    applyEventWiringToLayout(layout, eventWiring);
    assert.deepEqual(layout[0].listeners, {
      eventA: { SourceA: "handlerA" },
      eventB: { SourceB: "handlerB" },
    });
  });

  it("merges with existing listeners", () => {
    const layout = [
      {
        id: 1,
        component: "ReceiverWidget",
        listeners: { existingEvent: { OtherWidget: "handler" } },
      },
    ];
    const eventWiring = [
      {
        source: { widget: "NewSource", event: "newEvent" },
        target: { widget: "ReceiverWidget", handler: "newHandler" },
      },
    ];
    applyEventWiringToLayout(layout, eventWiring);
    assert.deepEqual(layout[0].listeners, {
      existingEvent: { OtherWidget: "handler" },
      newEvent: { NewSource: "newHandler" },
    });
  });

  it("returns layout unchanged when eventWiring is empty", () => {
    const layout = [{ id: 1, component: "Widget" }];
    const result = applyEventWiringToLayout(layout, []);
    assert.equal(result, layout);
    assert.equal(layout[0].listeners, undefined);
  });

  it("returns layout unchanged when eventWiring is null", () => {
    const layout = [{ id: 1, component: "Widget" }];
    const result = applyEventWiringToLayout(layout, null);
    assert.equal(result, layout);
  });

  it("is the inverse of extractEventWiring (roundtrip)", () => {
    // Start with a layout that has listeners
    const originalLayout = [
      {
        id: 1,
        component: "ReceiverWidget",
        listeners: {
          buttonClicked: { SenderWidget: "onButtonClicked" },
          messageSent: { SenderWidget: "onMessageReceived" },
        },
      },
      { id: 2, component: "SenderWidget" },
    ];

    // Extract wiring
    const wiring = extractEventWiring(originalLayout);

    // Apply to a fresh layout
    const freshLayout = [
      { id: 1, component: "ReceiverWidget" },
      { id: 2, component: "SenderWidget" },
    ];
    applyEventWiringToLayout(freshLayout, wiring);

    // Should reconstruct the original listeners
    assert.deepEqual(freshLayout[0].listeners, originalLayout[0].listeners);
  });
});

describe("checkDashboardCompatibility", () => {
  const installedWidgets = [
    { name: "@trops/algolia-search", version: "1.2.0" },
    { name: "@trops/slack-widgets", version: "2.0.1" },
  ];

  const registryPackages = [
    { name: "@trops/algolia-search", version: "1.3.0" },
    { name: "@trops/github-widgets", version: "1.0.0" },
  ];

  it("reports all installed widgets as compatible", () => {
    const dashboardWidgets = [
      { package: "@trops/algolia-search", version: "^1.0.0", required: true },
      { package: "@trops/slack-widgets", version: "^2.0.0", required: true },
    ];
    const result = checkDashboardCompatibility(
      dashboardWidgets,
      installedWidgets,
      registryPackages,
    );
    assert.equal(result.compatible, true);
    assert.equal(result.summary.installed, 2);
    assert.equal(result.summary.toInstall, 0);
    assert.equal(result.summary.unavailable, 0);
    assert.equal(result.widgets[0].status, "installed");
    assert.equal(result.widgets[0].installedVersion, "1.2.0");
  });

  it("reports widgets available in registry as to-install", () => {
    const dashboardWidgets = [
      { package: "@trops/github-widgets", version: "^1.0.0", required: true },
    ];
    const result = checkDashboardCompatibility(
      dashboardWidgets,
      installedWidgets,
      registryPackages,
    );
    assert.equal(result.compatible, true);
    assert.equal(result.summary.toInstall, 1);
    assert.equal(result.widgets[0].status, "to-install");
    assert.equal(result.widgets[0].availableVersion, "1.0.0");
  });

  it("reports unavailable required widgets as incompatible", () => {
    const dashboardWidgets = [
      { package: "@trops/unknown-widget", version: "^1.0.0", required: true },
    ];
    const result = checkDashboardCompatibility(
      dashboardWidgets,
      installedWidgets,
      registryPackages,
    );
    assert.equal(result.compatible, false);
    assert.equal(result.summary.unavailable, 1);
    assert.equal(result.widgets[0].status, "unavailable");
  });

  it("stays compatible when unavailable widget is optional", () => {
    const dashboardWidgets = [
      { package: "@trops/algolia-search", version: "^1.0.0", required: true },
      { package: "@trops/unknown-widget", version: "^1.0.0", required: false },
    ];
    const result = checkDashboardCompatibility(
      dashboardWidgets,
      installedWidgets,
      registryPackages,
    );
    assert.equal(result.compatible, true);
    assert.equal(result.summary.installed, 1);
    assert.equal(result.summary.unavailable, 1);
  });

  it("handles mixed statuses", () => {
    const dashboardWidgets = [
      { package: "@trops/algolia-search", version: "^1.0.0", required: true },
      { package: "@trops/github-widgets", version: "^1.0.0", required: true },
      { package: "@trops/unknown-widget", version: "^1.0.0", required: false },
    ];
    const result = checkDashboardCompatibility(
      dashboardWidgets,
      installedWidgets,
      registryPackages,
    );
    assert.equal(result.compatible, true);
    assert.equal(result.summary.total, 3);
    assert.equal(result.summary.installed, 1);
    assert.equal(result.summary.toInstall, 1);
    assert.equal(result.summary.unavailable, 1);
  });

  it("returns compatible with empty widget list", () => {
    const result = checkDashboardCompatibility([], installedWidgets, []);
    assert.equal(result.compatible, true);
    assert.equal(result.summary.total, 0);
  });

  it("defaults required to true when not specified", () => {
    const dashboardWidgets = [{ package: "@trops/missing" }];
    const result = checkDashboardCompatibility(dashboardWidgets, [], []);
    assert.equal(result.compatible, false);
    assert.equal(result.widgets[0].required, true);
  });
});
