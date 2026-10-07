/**
 * saveMcpProvider — one way to save a new MCP provider, shared by Settings ›
 * Providers and the draft review's Add/Install dialog (bot-capabilities
 * CAP-005): custom servers get a unique type, the save is announced so open
 * bot forms can turn the provider on.
 */
import { saveMcpProvider } from "./saveMcpProvider";

function fakeApi(fail = false) {
  return {
    saveProvider: jest.fn((appId, name, payload, ok, err) =>
      fail ? err(null, new Error("disk full")) : ok(null, { name }),
    ),
  };
}

describe("saveMcpProvider", () => {
  let events;
  const onInstalled = (e) => events.push(e.detail);
  beforeEach(() => {
    events = [];
    window.addEventListener("dash:provider-installed", onInstalled);
  });
  afterEach(() => {
    window.removeEventListener("dash:provider-installed", onInstalled);
  });

  it("saves a catalog provider under its catalog type and announces it", async () => {
    const dashApi = fakeApi();
    const out = await saveMcpProvider({
      dashApi,
      appId: "app",
      providers: {},
      name: "Web Fetch",
      type: "web-fetch",
      credentials: { maxImages: "3" },
      mcpConfig: { transport: "in_process", builtin: "web-fetch" },
      allowedTools: ["fetch_image"],
    });
    expect(out).toEqual({ name: "Web Fetch", type: "web-fetch" });
    expect(dashApi.saveProvider).toHaveBeenCalledWith(
      "app",
      "Web Fetch",
      {
        providerType: "web-fetch",
        credentials: { maxImages: "3" },
        providerClass: "mcp",
        mcpConfig: { transport: "in_process", builtin: "web-fetch" },
        allowedTools: ["fetch_image"],
      },
      expect.any(Function),
      expect.any(Function),
    );
    expect(events).toEqual([{ id: "web-fetch", name: "Web Fetch" }]);
  });

  it("gives a new custom server its own type", async () => {
    const out = await saveMcpProvider({
      dashApi: fakeApi(),
      appId: "app",
      providers: { Other: { type: "custom-stockcake" } },
      name: "StockCake",
      type: "custom",
      credentials: {},
      mcpConfig: { transport: "streamable_http", url: "https://x.test/mcp" },
    });
    expect(out.type).not.toBe("custom");
    expect(out.type).not.toBe("custom-stockcake");
  });

  it("rejects when the save fails, and announces nothing", async () => {
    await expect(
      saveMcpProvider({
        dashApi: fakeApi(true),
        appId: "app",
        providers: {},
        name: "X",
        type: "web-fetch",
        credentials: {},
        mcpConfig: {},
      }),
    ).rejects.toThrow(/disk full/);
    expect(events).toEqual([]);
  });
});
