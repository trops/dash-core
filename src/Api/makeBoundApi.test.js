/**
 * makeBoundApi.test.js
 *
 * Pins for the per-widget proxy that injects a mount token on every
 * gated `mainApi.*` call. WidgetFactory builds one of these for each
 * mounted widget and passes it via WidgetContext + the `api` prop.
 *
 * Slice-2 invariants:
 *   - Every gated method gets the token appended as its trailing arg.
 *   - Non-gated methods are passed through untouched (so widgets keep
 *     working with `props.api.mcp.listResources(...)` etc).
 *   - The proxy doesn't leak the token outside the gated call site.
 *
 * Runs via Jest (not node --test) — the file uses ESM imports and
 * is picked up by the standard Jest run in dash-core's CI.
 */
import { makeBoundApi } from "./makeBoundApi";

function makeRaw() {
  // Recording stub of mainApi. Every method captures its args so the
  // test can assert what got forwarded.
  const calls = [];
  const recorder =
    (name) =>
    (...args) => {
      calls.push({ name, args });
      return `result-of-${name}`;
    };
  const raw = {
    data: {
      saveData: recorder("data.saveData"),
      readData: recorder("data.readData"),
      readDataFromURL: recorder("data.readDataFromURL"),
      // non-gated read helpers — must be passed through untouched
      readJSONFromFile: recorder("data.readJSONFromFile"),
    },
    mcp: {
      callTool: recorder("mcp.callTool"),
      listResources: recorder("mcp.listResources"),
    },
    webSocket: {
      connect: recorder("webSocket.connect"),
      disconnect: recorder("webSocket.disconnect"),
    },
    // Non-IPC fields that still need to be reachable on the bound API
    // (callers do things like `api.events.SOMETHING`).
    events: { FOO: "foo-channel" },
  };
  return { raw, calls };
}

describe("makeBoundApi", () => {
  test("data.saveData appends the token as the trailing arg", () => {
    const { raw, calls } = makeRaw();
    const bound = makeBoundApi(raw, "tok-A");
    bound.data.saveData({ hi: 1 }, "f.json", false, {});
    expect(calls.length).toBe(1);
    expect(calls[0].args).toEqual([
      { hi: 1 },
      "f.json",
      false,
      {},
      null,
      "tok-A",
    ]);
  });

  test("data.readData appends widgetId+token", () => {
    const { raw, calls } = makeRaw();
    const bound = makeBoundApi(raw, "tok-B");
    bound.data.readData("f.json", []);
    expect(calls[0].args).toEqual(["f.json", [], null, "tok-B"]);
  });

  test("data.readDataFromURL appends widgetId+token", () => {
    const { raw, calls } = makeRaw();
    const bound = makeBoundApi(raw, "tok-C");
    bound.data.readDataFromURL("https://x/", "/tmp/x");
    expect(calls[0].args).toEqual(["https://x/", "/tmp/x", null, "tok-C"]);
  });

  test("mcp.callTool appends allowedTools+widgetId+workspaceId+token", () => {
    const { raw, calls } = makeRaw();
    const bound = makeBoundApi(raw, "tok-D");
    bound.mcp.callTool("server", "tool", { x: 1 });
    expect(calls[0].args).toEqual([
      "server",
      "tool",
      { x: 1 },
      null,
      null,
      null,
      "tok-D",
    ]);
  });

  test("webSocket.connect appends widgetId+token", () => {
    const { raw, calls } = makeRaw();
    const bound = makeBoundApi(raw, "tok-E");
    bound.webSocket.connect("provider", { url: "wss://x/" });
    expect(calls[0].args).toEqual([
      "provider",
      { url: "wss://x/" },
      null,
      "tok-E",
    ]);
  });

  test("non-gated methods are passed through untouched", () => {
    const { raw, calls } = makeRaw();
    const bound = makeBoundApi(raw, "tok-F");
    bound.data.readJSONFromFile("/tmp/x");
    bound.mcp.listResources("server");
    bound.webSocket.disconnect("provider");
    expect(calls[0].args).toEqual(["/tmp/x"]);
    expect(calls[1].args).toEqual(["server"]);
    expect(calls[2].args).toEqual(["provider"]);
  });

  test("non-IPC fields like events.* are reachable on the bound API", () => {
    const { raw } = makeRaw();
    const bound = makeBoundApi(raw, "tok-G");
    expect(bound.events.FOO).toBe("foo-channel");
  });

  test("calling without a token returns rawApi unchanged (defensive)", () => {
    const { raw, calls } = makeRaw();
    // makeBoundApi(raw, null) is allowed during the brief window before
    // the mount-token IPC resolves. Calling gated methods in that
    // window passes args through unchanged — the gate will deny.
    const bound = makeBoundApi(raw, null);
    bound.data.saveData({ hi: 1 }, "f.json", false, {});
    expect(calls[0].args).toEqual([{ hi: 1 }, "f.json", false, {}]);
  });
});
