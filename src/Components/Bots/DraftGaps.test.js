/**
 * DraftGaps — a lead's draft lists what it can't do yet, with providers
 * find_providers suggested for each gap (bot-capabilities CAP-004 AC2,
 * CAP-005): tier labels, best first, and one action per suggestion.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { DraftGaps, gapActionFor } from "./DraftGaps";

// The dialog is tested on its own; here, record what it was asked to open.
jest.mock("./AddProviderDialog", () => ({
  AddProviderDialog: ({ request, onClose }) =>
    request ? (
      <div data-testid="add-provider-dialog">
        {JSON.stringify(request)}
        <button onClick={onClose}>close dialog</button>
      </div>
    ) : null,
}));

const dialogRequest = () =>
  JSON.parse(
    screen
      .getByTestId("add-provider-dialog")
      .textContent.replace("close dialog", ""),
  );

const webFetch = {
  id: "builtin:web-fetch",
  tier: "built-in",
  name: "Web Fetch",
  description: "Download images",
  runs: "Built into Dash",
  credentials: [],
  installable: true,
  install: { kind: "catalog", catalogId: "web-fetch" },
};
const fetchVetted = {
  id: "vetted:fetch",
  tier: "vetted",
  name: "Fetch",
  description: "HTTP fetch",
  runs: "uvx mcp-server-fetch",
  credentials: [],
  sourceUrl: "https://github.com/modelcontextprotocol/servers",
  installable: true,
  install: { kind: "vetted", catalogId: "fetch" },
};
const stockcake = {
  id: "community:com.stockcake/stockcake",
  tier: "community",
  name: "StockCake",
  description: "CC0 images",
  runs: "https://stockcake.com/api/mcp",
  credentials: ["Authorization"],
  sourceUrl: "https://stockcake.com/info/mcp",
  installable: true,
  install: {
    kind: "custom",
    name: "StockCake",
    mcpConfig: {
      transport: "streamable_http",
      url: "https://stockcake.com/api/mcp",
    },
    credentialSchema: {},
  },
};
const dockerOnly = {
  id: "community:io.x/docker",
  tier: "community",
  name: "Docker thing",
  description: "",
  runs: "No install info Dash can use (oci)",
  credentials: [],
  installable: false,
  install: null,
};
const installedGmail = {
  id: "installed:Gmail New",
  tier: "installed",
  name: "Gmail New",
  description: "",
  runs: "Already set up",
  credentials: [],
  installable: true,
  install: { kind: "use", providerName: "Gmail New" },
};

const gaps = [
  {
    need: "find stock photos",
    suggestions: [stockcake, dockerOnly],
  },
  { need: "download images", suggestions: [webFetch, fetchVetted] },
  { need: "read email", suggestions: [installedGmail] },
];

function renderGaps(props = {}) {
  const onUse = jest.fn();
  render(
    <DraftGaps
      gaps={gaps}
      toolSources={[{ name: "Gmail New", type: "gmail" }]}
      selectedServers={[]}
      onUse={onUse}
      {...props}
    />,
  );
  return { onUse };
}

describe("DraftGaps", () => {
  let events;
  const listen = (type) => (e) => events.push({ type, detail: e.detail });
  const types = [
    "dash:open-settings-create-provider",
    "dash:install-known-external",
  ];
  const handlers = {};
  beforeEach(() => {
    events = [];
    for (const t of types) {
      handlers[t] = listen(t);
      window.addEventListener(t, handlers[t]);
    }
  });
  afterEach(() => {
    for (const t of types) window.removeEventListener(t, handlers[t]);
  });

  it("shows each need with tier-labelled suggestions", () => {
    renderGaps();
    expect(screen.getByText("find stock photos")).toBeInTheDocument();
    // Just the tier label: a "runs" line equal to it isn't repeated.
    expect(screen.getAllByText("Built into Dash")).toHaveLength(1);
    expect(screen.getByText("Vetted")).toBeInTheDocument();
    expect(screen.getAllByText("Community · unverified").length).toBe(2);
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(
      screen.getByText("https://stockcake.com/api/mcp"),
    ).toBeInTheDocument();
  });

  it("Use turns on a provider the user already has", () => {
    const { onUse } = renderGaps();
    fireEvent.click(screen.getByText("Use Gmail New"));
    expect(onUse).toHaveBeenCalledWith("Gmail New");
  });

  it("shows a provider that's already on as on", () => {
    renderGaps({ selectedServers: ["Gmail New"] });
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.queryByText("Use Gmail New")).toBeNull();
  });

  it("Add opens a dialog at the built-in catalog entry — without leaving the draft", () => {
    renderGaps();
    fireEvent.click(screen.getByText("Add Web Fetch"));
    expect(dialogRequest()).toEqual({ catalogId: "web-fetch" });
    expect(events).toEqual([]);
    fireEvent.click(screen.getByText("close dialog"));
    expect(screen.queryByTestId("add-provider-dialog")).toBeNull();
  });

  it("Install opens the confirmation for a vetted server", () => {
    renderGaps();
    fireEvent.click(screen.getByText("Install Fetch"));
    expect(events).toEqual([
      { type: "dash:install-known-external", detail: { id: "fetch" } },
    ]);
  });

  it("Install… opens the custom form pre-filled, with the unverified warning", () => {
    renderGaps();
    fireEvent.click(screen.getByText("Install StockCake…"));
    expect(events).toEqual([]);
    const { custom } = dialogRequest();
    expect(custom.name).toBe("StockCake");
    expect(custom.mcpConfig).toEqual(stockcake.install.mcpConfig);
    expect(custom.warning).toMatch(/Unverified/);
    expect(custom.warning).toMatch(/stockcake\.com/);
  });

  it("offers no button for a server Dash can't install", () => {
    renderGaps();
    expect(
      screen.getByText(/Can't be installed from Dash/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Install Docker thing…")).toBeNull();
  });

  it("once installed, a suggestion offers Use for the new provider", () => {
    const { onUse } = renderGaps({
      toolSources: [
        { name: "Gmail New", type: "gmail" },
        { name: "Web Fetch — CDN", type: "web-fetch" },
      ],
    });
    fireEvent.click(screen.getByText("Use Web Fetch — CDN"));
    expect(onUse).toHaveBeenCalledWith("Web Fetch — CDN");
  });

  it("renders nothing without gaps", () => {
    const { container } = render(
      <DraftGaps
        gaps={[]}
        toolSources={[]}
        selectedServers={[]}
        onUse={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("gapActionFor", () => {
  it("matches a custom install by its provider name", () => {
    expect(
      gapActionFor(stockcake, [
        { name: "StockCake", type: "custom-stockcake" },
      ]),
    ).toEqual({ kind: "use", providerName: "StockCake" });
  });
});
