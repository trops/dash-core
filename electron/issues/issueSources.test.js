/**
 * issueSources — failures turned into issues, with a likely cause.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  readableError,
  likelyCause,
  toolErrorText,
  widgetCallIssue,
  widgetCrashIssue,
  botRunIssues,
  providerIssue,
} = require("./issueSources");
const { cleanInput } = require("./issueStore");

describe("likelyCause", () => {
  const p = { provider: "Notes MCP" };
  it("names common causes in plain words", () => {
    assert.match(
      likelyCause("connect ECONNREFUSED 127.0.0.1:3845", p),
      /isn't answering/,
    );
    assert.match(
      likelyCause("getaddrinfo ENOTFOUND x", p),
      /An address can't be found/,
    );
    assert.match(
      likelyCause(
        "Notes MCP couldn't start: Cannot find module '/x/server.js'",
        p,
      ),
      /program Notes MCP starts can't be found/,
    );
    assert.match(likelyCause("Request timed out", p), /too long/);
    assert.match(likelyCause("401 Unauthorized", p), /sign-in/);
    assert.match(likelyCause("403 Forbidden", p), /refused it/);
    assert.match(likelyCause("429 Too Many Requests", p), /limiting/);
    assert.match(
      likelyCause("Server not connected: __no_workspace__::Notes MCP", p),
      /isn't connected/,
    );
    assert.match(
      likelyCause("Widget permission gate: not allowed", p),
      /allowed tools/,
    );
  });
  it("says nothing when it can't tell", () => {
    assert.equal(likelyCause("Something odd", p), "");
    assert.equal(likelyCause(null), "");
  });
});

describe("toolErrorText", () => {
  it("joins the error result's text", () => {
    assert.equal(
      toolErrorText({
        isError: true,
        content: [{ type: "text", text: "Note not found" }],
      }),
      "Note not found",
    );
    assert.equal(
      toolErrorText({ isError: true, content: [] }),
      "The tool reported an error.",
    );
  });
});

describe("issue builders", () => {
  it("a widget's failed call: names the widget, the call and the cause", () => {
    const input = widgetCallIssue({
      component: "ai-built.shoppinglist.ShoppingList",
      itemId: "11",
      workspaceId: "7301",
      widgetName: "Shopping List",
      provider: "Notes MCP",
      tool: "search_notes",
      args: { query: "shopping list" },
      error: "connect ECONNREFUSED 127.0.0.1:3845",
    });
    assert.equal(input.title, "Shopping List: Notes MCP › search_notes failed");
    assert.match(input.hint, /isn't answering/);
    assert.ok(cleanInput(input));
  });
  it("a widget whose provider couldn't connect", () => {
    const input = widgetCallIssue({
      component: "ai-built.notesview.NotesView",
      itemId: "12",
      workspaceId: "7401",
      widgetName: "Notes View",
      provider: "Notes (local)",
      tool: "connect",
      error: "Notes (local) couldn't start: Cannot find module",
    });
    assert.equal(input.title, "Notes View couldn't connect to Notes (local)");
  });
  it("a widget with no title is named from its component", () => {
    const input = widgetCallIssue({
      component: "ai-built.pagereader.PageReader",
      provider: "Web Fetch",
      tool: "fetch_url",
      error: "x",
    });
    assert.equal(input.asset.name, "Page Reader");
    assert.equal(input.title, "Page Reader: Web Fetch › fetch_url failed");
  });
  it("a widget that crashed or was stopped", () => {
    assert.equal(
      widgetCrashIssue({
        component: "a.b.Weather",
        message: "x",
        stopped: true,
      }).title,
      "Weather was stopped — it kept failing",
    );
    assert.equal(
      widgetCrashIssue({ component: "a.b.Weather", message: "x" }).title,
      "Weather couldn't show",
    );
  });
  it("a bot run: its failure with the failed call, and each warning", () => {
    const issues = botRunIssues({
      bot: { id: "bot_m", name: "Morning Email Summary", workspaceId: 7301 },
      run: {
        status: "failed",
        error: "429 rate limited",
        toolCalls: [
          { tool: "search_threads", provider: "Gmail", ok: true },
          {
            tool: "get_thread",
            provider: "Gmail",
            ok: false,
            error: "429 rate limited",
          },
        ],
        warnings: [
          {
            message:
              "Gmail isn't connected in your Claude account right now, so its tools may not be available.",
          },
        ],
      },
    });
    assert.equal(issues.length, 2);
    assert.equal(issues[0].call.tool, "get_thread");
    assert.match(issues[0].hint, /limiting/);
    assert.equal(issues[1].severity, "warning");
    // No provider named: the whole warning, never cut at its first dot.
    assert.equal(
      issues[1].title,
      "Morning Email Summary: Gmail isn't connected in your Claude account right now, so its tools may not be available.",
    );
    assert.equal(issues[0].cause, "run");
    assert.equal(issues[1].cause, "warning");
    assert.equal(
      botRunIssues({ bot: { id: "b" }, run: { status: "completed" } }).length,
      0,
    );
  });

  it("a warning about a provider: one issue per provider, its detail, and the provider to reconnect", () => {
    const issues = botRunIssues({
      bot: { id: "bot_n", name: "Notes Digest" },
      run: {
        status: "completed",
        // As the store hands it back: sealed JSON, opened.
        warnings: JSON.stringify([
          {
            message:
              "api.example.com couldn't start, so its tools aren't available this run.",
            provider: "api.example.com",
            detail: "connect ECONNREFUSED 127.0.0.1:9",
          },
        ]),
      },
    });
    assert.equal(issues.length, 1);
    assert.equal(
      issues[0].title,
      "Notes Digest: api.example.com wasn't available",
    );
    assert.equal(issues[0].message, "connect ECONNREFUSED 127.0.0.1:9");
    assert.deepEqual(issues[0].related, { provider: "api.example.com" });
    assert.match(issues[0].hint, /isn't answering/);
  });
  it("a provider that couldn't start or needs signing in", () => {
    assert.equal(
      providerIssue({ provider: "Notes MCP", error: "spawn ENOENT" }).title,
      "Notes MCP couldn't start",
    );
    // Its program can't be found: says which; anything unclear: open it.
    assert.match(
      providerIssue({ provider: "Notes MCP", error: "spawn ENOENT" }).hint,
      /program Notes MCP starts can't be found/,
    );
    assert.match(
      providerIssue({ provider: "Notes MCP", error: "exited with code 1" })
        .hint,
      /Check Notes MCP's settings, then Reconnect/,
    );
    const signIn = providerIssue({
      provider: "Home Assistant MCP",
      signIn: true,
    });
    assert.equal(signIn.title, "Home Assistant MCP: sign-in expired");
    // The kind of failure is said by its source, not guessed from text.
    assert.equal(signIn.cause, "sign-in");
    assert.match(signIn.hint, /^Reconnect Home Assistant MCP/);
    assert.equal(
      providerIssue({ provider: "X", error: "401 Unauthorized at start" })
        .cause,
      "start",
    );
  });
});

describe("whose fault a widget call is", () => {
  const call = (error, tool = "list_notes") =>
    widgetCallIssue({ component: "Notes", provider: "Notes MCP", tool, error })
      .cause;
  it("the provider when it's down; the call when it was given something bad", () => {
    assert.equal(call("connect ECONNREFUSED 127.0.0.1:9"), "provider");
    assert.equal(call("Notes MCP is not connected"), "provider");
    assert.equal(call("anything", "connect"), "provider");
    assert.equal(call("getaddrinfo ENOTFOUND bad.example"), "call");
    assert.equal(call("No note named Groceries"), "call");
  });
});

// A provider's JSON answer (shape from a real Home Assistant MCP error).
const haError = JSON.stringify({
  success: false,
  error: {
    code: "VALIDATION_FAILED",
    message: "API error: 400 - 400: Bad Request",
    suggestion: "Verify media_player.tv exists using ha_get_state()",
    suggestions: ["Verify media_player.tv exists using ha_get_state()"],
  },
  domain: "music_assistant",
  service: "get_queue",
});

describe("a provider's JSON error", () => {
  it("reads as its message, with its own suggestion; raw stays available", () => {
    const r = readableError(haError);
    assert.equal(r.message, "API error: 400 - 400: Bad Request");
    assert.equal(
      r.suggestion,
      "Verify media_player.tv exists using ha_get_state()",
    );
    assert.match(r.raw, /"code": "VALIDATION_FAILED"/);
    assert.equal(
      readableError("Error: " + haError).message,
      "API error: 400 - 400: Bad Request",
    );
    assert.equal(readableError('{"error":"Not found"}').message, "Not found");
    // Plain text stays as it is, with no raw.
    assert.deepEqual(readableError("connect ECONNREFUSED"), {
      message: "connect ECONNREFUSED",
      suggestion: "",
      raw: "",
    });
    assert.equal(readableError("Couldn't parse {oops").raw, "");
  });
  it("a widget call's issue: readable message, the provider's suggestion as the likely cause, JSON kept on the call", () => {
    const input = widgetCallIssue({
      component: "x.y.Player",
      provider: "Home Assistant MCP",
      tool: "ha_call_service",
      error: haError,
    });
    assert.equal(input.message, "API error: 400 - 400: Bad Request");
    assert.equal(
      input.hint,
      "Home Assistant MCP suggests: Verify media_player.tv exists using ha_get_state()",
    );
    assert.equal(input.call.error, haError);
    assert.equal(input.cause, "call");
  });
});

describe("a path outside the provider's folders", () => {
  it("says so plainly, and points at the widget's settings", () => {
    const error =
      "Widget permission gate: path argument 'path' rejected: safePath: requested path is not within any allowed root. Requested: From /tmp/notes/shopping.md (resolved to /app/From /tmp/notes/shopping.md). Allowed roots: /tmp/notes";
    const input = widgetCallIssue({
      component: "ai-built.shoppinglist.ShoppingList",
      provider: "My Files",
      tool: "read_text_file",
      error,
    });
    assert.equal(
      input.message,
      'The path "From /tmp/notes/shopping.md" isn\'t inside a folder My Files can use.',
    );
    assert.match(
      input.hint,
      /check the widget's settings \(a value like "From …"/,
    );
    assert.equal(input.call.error, error);
  });
});

// A connector Claude says is connected, whose service turned the sign-in
// down (connector details: the user's Google Calendar on the Mac mini).
describe("botRunIssues — a finished run whose call couldn't sign in", () => {
  const bot = { id: "b1", name: "Morning Brief", workspaceId: 7 };
  it("is the provider's sign-in problem, once per provider", () => {
    const issues = botRunIssues({
      bot,
      run: {
        status: "completed",
        toolCalls: [
          {
            tool: "list_events",
            provider: "Google Calendar",
            ok: false,
            error: "401 invalid_grant",
          },
          {
            tool: "get_event",
            provider: "Google Calendar",
            ok: false,
            error: "401 invalid_grant",
          },
          { tool: "search", provider: "Gmail", ok: false, error: "No results" },
        ],
      },
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0].cause, "sign-in");
    assert.equal(issues[0].title, "Google Calendar couldn't sign in");
    assert.deepEqual(issues[0].related, { provider: "Google Calendar" });
    assert.equal(issues[0].call.tool, "list_events");
  });
  it("a failed run keeps its own failure", () => {
    const issues = botRunIssues({
      bot,
      run: {
        status: "failed",
        error: "boom",
        toolCalls: [{ tool: "x", provider: "P", ok: false, error: "401" }],
      },
    });
    assert.equal(issues.filter((i) => i.cause === "sign-in").length, 0);
  });
});
