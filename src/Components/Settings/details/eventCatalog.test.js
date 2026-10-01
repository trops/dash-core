import {
  buildWidgetEventCatalog,
  widgetSubscription,
  describeSubscription,
} from "./eventCatalog";

const cfg = (map) => (name) => map[name] || null;

const kitchenSink = {
  id: 7,
  name: "Kitchen Sink",
  layout: [
    {
      component: "trops.samples.EventSender",
      id: 3,
      dashboardId: 7,
      title: "Event Sender",
    },
    // Declares no events → not offered.
    { component: "trops.samples.Notepad", id: 4, dashboardId: 7 },
  ],
};
const empty = { id: 8, name: "Empty", layout: [] };

const widgetConfigs = cfg({
  "trops.samples.EventSender": {
    name: "Event Sender",
    events: ["buttonClicked", "messageSent"],
  },
  "trops.samples.Notepad": { name: "Notepad", events: [] },
});

describe("buildWidgetEventCatalog", () => {
  it("lists dashboards → widgets → declared events, skipping silent ones", () => {
    const cat = buildWidgetEventCatalog([kitchenSink, empty], widgetConfigs);
    expect(cat).toHaveLength(1);
    expect(cat[0]).toMatchObject({ workspaceId: "7", name: "Kitchen Sink" });
    expect(cat[0].widgets).toHaveLength(1);
    expect(cat[0].widgets[0]).toMatchObject({
      ref: "trops.samples.EventSender",
      instanceId: "3",
      events: ["buttonClicked", "messageSent"],
    });
    expect(cat[0].widgets[0].label).toBeTruthy();
  });

  it("numbers dashboards that share a name so they can be told apart", () => {
    const twin = {
      ...kitchenSink,
      id: 9,
      layout: [{ ...kitchenSink.layout[0], dashboardId: 9 }],
    };
    const names = buildWidgetEventCatalog(
      [kitchenSink, twin],
      widgetConfigs,
    ).map((w) => w.name);
    expect(names).toEqual(["Kitchen Sink (1)", "Kitchen Sink (2)"]);
  });

  it("tolerates bad input", () => {
    expect(buildWidgetEventCatalog(null, widgetConfigs)).toEqual([]);
    expect(buildWidgetEventCatalog([null, {}], widgetConfigs)).toEqual([]);
  });
});

describe("widgetSubscription", () => {
  it("builds the runtime eventType plus a portable structured source", () => {
    const [ws] = buildWidgetEventCatalog([kitchenSink], widgetConfigs);
    const sub = widgetSubscription(ws, ws.widgets[0], "buttonClicked");
    // Exactly the string the widget publishes on the bus.
    expect(sub.eventType).toBe("trops.samples.EventSender[3].buttonClicked");
    expect(sub.source).toEqual({
      kind: "widget",
      ref: "trops.samples.EventSender",
      instanceId: "3",
      event: "buttonClicked",
      workspaceId: "7",
    });
    expect(sub.label).toBe(
      `Kitchen Sink › ${ws.widgets[0].label} › buttonClicked`,
    );
  });
});

describe("describeSubscription", () => {
  const catalog = buildWidgetEventCatalog([kitchenSink], widgetConfigs);

  it("labels a picked subscription from the live catalog", () => {
    const sub = widgetSubscription(
      catalog[0],
      catalog[0].widgets[0],
      "messageSent",
    );
    expect(describeSubscription(sub, catalog)).toEqual({
      label: sub.label,
      missing: false,
    });
  });

  it("flags a subscription whose widget was removed", () => {
    const sub = {
      eventType: "trops.samples.Gone[9].x",
      label: "Kitchen Sink › Gone › x",
      source: {
        kind: "widget",
        ref: "trops.samples.Gone",
        instanceId: "9",
        event: "x",
        workspaceId: "7",
      },
    };
    expect(describeSubscription(sub, catalog)).toEqual({
      label: "Kitchen Sink › Gone › x",
      missing: true,
    });
  });

  it("gives a legacy typed eventType a friendly label when it resolves", () => {
    expect(
      describeSubscription(
        { eventType: "trops.samples.EventSender[3].buttonClicked" },
        catalog,
      ),
    ).toEqual({
      label: `Kitchen Sink › ${catalog[0].widgets[0].label} › buttonClicked`,
      missing: false,
    });
  });

  it("shows an unresolvable legacy eventType as-is (not flagged)", () => {
    expect(describeSubscription({ eventType: "pr.opened" }, catalog)).toEqual({
      label: "pr.opened",
      missing: false,
    });
  });
});
