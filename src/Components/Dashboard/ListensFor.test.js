import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListensFor } from "./ListensFor";

/**
 * The widget panel's "Listens for" (consolidation Phase 3P): one row per
 * wiring, × to stop, "+ Listen for another widget" to add — the same
 * listeners the old editor wrote, handed back for the dashboard's Save.
 */

// Widgets' names come from their .dash.js config, as in the app.
jest.mock("../../ComponentManager", () => ({
  ComponentManager: {
    config: (component) =>
      ({
        "trops.algolia-search.AlgoliaSearchBox": {
          displayName: "Algolia Search Box",
        },
        "trops.algolia-search.AlgoliaHits": { displayName: "Algolia Hits" },
      })[component] || null,
  },
}));
let mockBots = [];
jest.mock("../Settings/details/useBotEmitters", () => ({
  useBotEmitters: () => mockBots,
}));

const searchBox = {
  id: 4,
  component: "trops.algolia-search.AlgoliaSearchBox",
  name: "Algolia Search Box",
  type: "widget",
  events: ["queryChanged"],
};
const hits = (listeners = {}) => ({
  id: 5,
  component: "trops.algolia-search.AlgoliaHits",
  name: "Algolia Hits",
  type: "widget",
  eventHandlers: ["onQueryChanged"],
  listeners,
});
const wired = {
  onQueryChanged: ["trops.algolia-search.AlgoliaSearchBox[4].queryChanged"],
};
const ws = (item) => ({ id: 7, name: "Search", layout: [searchBox, item] });

beforeEach(() => {
  mockBots = [];
});

test("a widget with no handlers says it doesn't react", () => {
  render(
    <ListensFor
      item={{ id: 1, component: "ai-built.counter.Counter", type: "widget" }}
      workspace={{ id: 7, layout: [] }}
      name="Counter"
      onUpdate={() => {}}
    />,
  );
  expect(
    screen.getByText("Counter doesn't react to other widgets or bots."),
  ).toBeInTheDocument();
});

test("one row per wiring, named by who sends it", () => {
  const item = hits(wired);
  render(<ListensFor item={item} workspace={ws(item)} name="Algolia Hits" />);
  expect(screen.getByText("Query changed")).toBeInTheDocument();
  expect(screen.getByText("From Algolia Search Box")).toBeInTheDocument();
});

test("× stops listening and hands back the change", () => {
  const item = hits(wired);
  const onUpdate = jest.fn();
  render(
    <ListensFor
      item={item}
      workspace={ws(item)}
      name="Algolia Hits"
      onUpdate={onUpdate}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Stop listening to Algolia Search Box",
    }),
  );
  const [nextItem, nextWs] = onUpdate.mock.calls[0];
  expect(nextItem.listeners.onQueryChanged || []).toEqual([]);
  expect(nextWs.layout.find((i) => i.id === 5)).toBe(nextItem);
  expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
});

test("+ Listen for another widget: pick what to listen for, then Add", () => {
  const item = hits({});
  const onUpdate = jest.fn();
  render(
    <ListensFor
      item={item}
      workspace={ws(item)}
      name="Algolia Hits"
      onUpdate={onUpdate}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "+ Listen for another widget" }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "When" }), {
    target: { value: "trops.algolia-search.AlgoliaSearchBox[4].queryChanged" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  const [nextItem] = onUpdate.mock.calls[0];
  expect(nextItem.listeners.onQueryChanged).toEqual([
    "trops.algolia-search.AlgoliaSearchBox[4].queryChanged",
  ]);
  expect(screen.getByText("From Algolia Search Box")).toBeInTheDocument();
});

test("bots on the dashboard are sources too", () => {
  mockBots = [
    {
      key: "b1",
      name: "Daily Digest",
      component: "bot:digest",
      itemId: "bot_1",
      events: ["summaryReady"],
    },
  ];
  const item = hits({ onQueryChanged: ["bot:digest[bot_1].summaryReady"] });
  render(<ListensFor item={item} workspace={ws(item)} name="Algolia Hits" />);
  expect(screen.getByText("From Daily Digest")).toBeInTheDocument();
});

test("nothing on the dashboard sends events: says so instead of a picker", () => {
  const item = hits({});
  render(
    <ListensFor
      item={item}
      workspace={{ id: 7, layout: [item] }}
      name="Algolia Hits"
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "+ Listen for another widget" }),
  );
  expect(
    screen.getByText(
      "No other widget or bot on this dashboard sends events yet.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
});
