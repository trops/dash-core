import {
  cardFixPill,
  ownerLabel,
  humanizeName,
  listenerRows,
  changeBlockedText,
} from "./widgetPanelText";

describe("ownerLabel", () => {
  test("AI-built, yours, someone else's, built in", () => {
    expect(ownerLabel({ component: "ai-built.counter.Counter" })).toBe(
      "Built by AI · yours",
    );
    expect(
      ownerLabel({
        component: "trops.algolia-search.AlgoliaHits",
        sourcePackage: "@trops/algolia-search",
        username: "trops",
      }),
    ).toBe("Yours · published to the registry");
    expect(
      ownerLabel({
        component: "acme.gmail.Inbox",
        sourcePackage: "@acme/gmail",
        username: "trops",
      }),
    ).toBe("From the registry · by acme");
    expect(ownerLabel({ component: "dash.bots.BotResults" })).toBe(
      "Built into Dash",
    );
    expect(ownerLabel({ component: "Clock" })).toBe("");
  });

  // QA 2026-10-22: a package loaded from a folder while signed out.
  test("@local: loaded from your folder, yours — not 'from the registry'", () => {
    for (const username of ["", "trops"]) {
      expect(
        ownerLabel({
          component: "local.clock.Clock",
          sourcePackage: "@local/clock",
          username,
        }),
      ).toBe("Loaded from your folder · yours");
    }
  });

  test("signed out, your registry widget reads as from the registry", () => {
    expect(
      ownerLabel({
        component: "trops.algolia-search.AlgoliaHits",
        sourcePackage: "@trops/algolia-search",
      }),
    ).toBe("From the registry · by trops");
  });
});

describe("humanizeName", () => {
  test("events and handlers as words", () => {
    expect(humanizeName("queryChanged")).toBe("query changed");
    expect(humanizeName("onQueryChanged", { handler: true })).toBe(
      "query changed",
    );
    expect(humanizeName("handleRefinementChange", { handler: true })).toBe(
      "refinement change",
    );
    expect(humanizeName("fetch_complete")).toBe("fetch complete");
    // "on" only goes when it's the prefix of a handler name.
    expect(humanizeName("online", { handler: true })).toBe("online");
  });
});

describe("listenerRows", () => {
  const item = {
    listeners: {
      onQueryChanged: [
        "trops.algolia-search.AlgoliaSearchBox[4].queryChanged",
        "bot:digest[bot_1].summaryReady",
      ],
      broken: ["not an event string"],
    },
  };

  test("one row per wiring, named by the source", () => {
    const names = {
      "trops.algolia-search.AlgoliaSearchBox|4": "Algolia Search Box",
      "bot:digest|bot_1": "Daily Digest",
    };
    const rows = listenerRows(item, (c, id) => names[`${c}|${id}`]);
    expect(rows).toEqual([
      {
        handler: "onQueryChanged",
        eventString: "trops.algolia-search.AlgoliaSearchBox[4].queryChanged",
        source: "Algolia Search Box",
        event: "queryChanged",
        isBot: false,
      },
      {
        handler: "onQueryChanged",
        eventString: "bot:digest[bot_1].summaryReady",
        source: "Daily Digest",
        event: "summaryReady",
        isBot: true,
      },
    ]);
  });

  test("a source it can't name falls back to its component", () => {
    const rows = listenerRows({
      listeners: { onX: ["trops.algolia-search.AlgoliaSearchBox[4].q"] },
    });
    expect(rows[0].source).toBe("algolia search box");
  });

  test("nothing wired: no rows", () => {
    expect(listenerRows({})).toEqual([]);
    expect(listenerRows(null)).toEqual([]);
  });
});

describe("changeBlockedText", () => {
  test("names how many changes wait", () => {
    expect(changeBlockedText(0)).toBe("");
    expect(changeBlockedText(1)).toBe("Save or cancel your 1 change first.");
    expect(changeBlockedText(3)).toBe("Save or cancel your 3 changes first.");
  });
});

describe("cardFixPill (consolidation Phase 4c)", () => {
  const label = (t) => ({ slack: "Slack", algolia: "Algolia" })[t] || t;
  test("nothing missing: no pill", () => {
    expect(cardFixPill({})).toBeNull();
    expect(
      cardFixPill({ missingConnections: [], unconnectedListeners: 0 }),
    ).toBeNull();
  });
  test("one connection: names it (a / an) and opens Connections", () => {
    expect(cardFixPill({ missingConnections: ["slack"], label })).toEqual({
      text: "Needs a Slack connection",
      section: "providers",
      icon: "plug",
    });
    expect(cardFixPill({ missingConnections: ["algolia"], label }).text).toBe(
      "Needs an Algolia connection",
    );
  });
  test("listeners only: the count, and Listens for", () => {
    expect(cardFixPill({ unconnectedListeners: 2 })).toEqual({
      text: "2 listeners not connected",
      section: "handlers",
      icon: "tower-broadcast",
    });
    expect(cardFixPill({ unconnectedListeners: 1 }).text).toBe(
      "1 listener not connected",
    );
  });
  test("two things: says so, and opens at Connections first", () => {
    expect(
      cardFixPill({ missingConnections: ["slack"], unconnectedListeners: 3 }),
    ).toMatchObject({ text: "2 things to fix", section: "providers" });
    expect(
      cardFixPill({ missingConnections: ["slack", "algolia"] }),
    ).toMatchObject({ text: "2 things to fix", section: "providers" });
  });
});
