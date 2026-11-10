import {
  filterBotProviders,
  kindOptions,
  filterSummary,
  hiddenPickedNote,
  KIND_ALL,
  KIND_MCP,
  KIND_CONNECTOR,
} from "./botProviderFilter";

const S = (serverName, label, connector = false) => ({
  serverName,
  label,
  connector,
});
const servers = [
  S("algolia-hr", "Algolia Public HR"),
  S("filesystem", "Filesystem"),
  S("claude-gmail", "Gmail", true),
  S("claude-calendar", "Google Calendar", true),
  S("claude-drive", "Google Drive", true),
];
const names = (r) => r.shown.map((s) => s.label);

describe("filterBotProviders", () => {
  it("shows everything with no filters", () => {
    const r = filterBotProviders(servers, {});
    expect(r.shown).toHaveLength(5);
    expect(r.hiddenPicked).toBe(0);
  });

  it("filters by kind", () => {
    expect(names(filterBotProviders(servers, { kind: KIND_MCP }))).toEqual([
      "Algolia Public HR",
      "Filesystem",
    ]);
    expect(
      names(filterBotProviders(servers, { kind: KIND_CONNECTOR })),
    ).toEqual(["Gmail", "Google Calendar", "Google Drive"]);
  });

  it("searches the label and the provider name, ignoring case", () => {
    expect(names(filterBotProviders(servers, { query: " GOO " }))).toEqual([
      "Google Calendar",
      "Google Drive",
    ]);
    expect(names(filterBotProviders(servers, { query: "algolia-h" }))).toEqual([
      "Algolia Public HR",
    ]);
  });

  it("Picked only shows the picked ones", () => {
    const r = filterBotProviders(servers, {
      pickedOnly: true,
      picked: ["filesystem", "claude-gmail"],
    });
    expect(names(r)).toEqual(["Filesystem", "Gmail"]);
    expect(r.pickedCount).toBe(2);
  });

  it("counts picked providers the filters hide (they stay picked)", () => {
    const r = filterBotProviders(servers, {
      query: "goo",
      picked: ["filesystem", "claude-gmail", "claude-calendar"],
    });
    expect(names(r)).toEqual(["Google Calendar", "Google Drive"]);
    expect(r.pickedCount).toBe(3);
    expect(r.hiddenPicked).toBe(2);
  });

  it("combines kind, search and Picked only", () => {
    const r = filterBotProviders(servers, {
      kind: KIND_CONNECTOR,
      query: "g",
      pickedOnly: true,
      picked: ["claude-gmail", "algolia-hr"],
    });
    expect(names(r)).toEqual(["Gmail"]);
    expect(r.hiddenPicked).toBe(1);
  });

  it("copes with no list", () => {
    expect(filterBotProviders(null, { kind: KIND_ALL }).shown).toEqual([]);
  });
});

describe("kindOptions", () => {
  it("counts each kind", () => {
    expect(kindOptions(servers).map((o) => o.label)).toEqual([
      "All 5",
      "MCP 2",
      "Claude connectors 3",
    ]);
  });
  it("is null when there's only one kind", () => {
    expect(kindOptions(servers.slice(0, 2))).toBeNull();
    expect(kindOptions(servers.slice(2))).toBeNull();
  });
});

describe("wording", () => {
  it("summary and hidden note", () => {
    expect(filterSummary({ pickedCount: 3, shownCount: 2, total: 14 })).toBe(
      "3 picked · showing 2 of 14",
    );
    expect(hiddenPickedNote(0)).toBeNull();
    expect(hiddenPickedNote(1)).toBe(
      "1 picked provider is hidden by the filter — still on",
    );
    expect(hiddenPickedNote(2)).toBe(
      "2 picked providers are hidden by the filter — still on",
    );
  });
});

describe("review fixes", () => {
  it("Picked only lists what was picked when turned on, ticked or not", () => {
    const r = filterBotProviders(servers, {
      pickedOnly: true,
      pickedOnlyNames: ["filesystem", "claude-gmail"],
      picked: ["claude-gmail"],
    });
    expect(names(r)).toEqual(["Filesystem", "Gmail"]);
    expect(r.pickedCount).toBe(1);
  });
  it("a provider no longer set up shows under All only, not counted as a kind", () => {
    const list = [
      ...servers,
      { serverName: "old", label: "Old", connector: false, missing: true },
    ];
    expect(names(filterBotProviders(list, { kind: KIND_MCP }))).not.toContain(
      "Old",
    );
    expect(names(filterBotProviders(list, { kind: KIND_ALL }))).toContain(
      "Old",
    );
    expect(kindOptions(list).map((o) => o.label)).toEqual([
      "All 6",
      "MCP 2",
      "Claude connectors 3",
    ]);
  });
});
