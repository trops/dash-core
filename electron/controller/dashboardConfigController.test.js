const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
    collectComponentNames,
    extractEventWiring,
    buildWidgetDependencies,
    buildProviderRequirements,
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
                    "1.1": { component: "AlgoliaSearchPage", hide: false },
                    "2.1": { component: "AlgoliaHits", hide: false },
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
                    "1.1": { component: "SearchWidget", hide: false },
                    "1.2": { component: "SearchWidget", hide: false },
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
                    providers: [
                        { type: "slack", providerClass: "mcp", required: true },
                    ],
                },
            ],
        };
        const providers = buildProviderRequirements(
            ["SlackWidget"],
            mockRegistry,
        );
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
        assert.deepEqual(providers[0].usedBy, [
            "AlgoliaSearch",
            "AlgoliaHits",
        ]);
    });
});
