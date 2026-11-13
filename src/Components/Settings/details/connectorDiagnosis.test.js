/**
 * A Claude connector Dash can't use says why (approved mockup "A connector
 * Dash can't find says why", frames 1–6).
 */
import { connectorDiagnosis, diagnosisText } from "./connectorDiagnosis";

const details = (over = {}) => ({
  cli: { path: "/Users/me/.local/bin/claude", version: "2.1.305" },
  account: {
    loggedIn: true,
    method: "claude.ai",
    email: "me@example.com",
    plan: "max",
  },
  others: [],
  waitedMs: 4000,
  stillConnecting: [],
  ...over,
});
const conn = (name, status = "connected", extra = {}) => ({
  server: `claude.ai ${name}`,
  name,
  status,
  tools: [{ name: "search" }],
  error: null,
  ...extra,
});
const ready = (connectors, over = {}, more = {}) => ({
  state: "ready",
  checkedAt: "2026-11-13T13:12:00.000Z",
  connectors,
  details: details(over),
  givenUp: [],
  ...more,
});
const diag = (result, extra = {}) =>
  connectorDiagnosis({
    providerName: "Gmail",
    server: "claude.ai Gmail",
    result,
    ...extra,
  });

describe("connectorDiagnosis", () => {
  test("connected: no cause, the facts say so", () => {
    const d = diag(ready([conn("Gmail")]));
    expect(d.cause).toBeNull();
    expect(d.badge).toEqual({ state: "success", label: "Connected" });
    expect(d.facts.map((f) => f.label)).toEqual([
      "Claude Code used",
      "Signed in as",
      "Waited",
      "Gmail",
    ]);
    expect(d.facts[0].sub).toBe("~/.local/bin/claude");
    expect(d.facts[1].value).toBe("me@example.com · Claude Max");
  });

  test("frame 1 — the account has it under another name: use it", () => {
    const d = diag(ready([conn("Gmail New"), conn("Slack")]));
    expect(d.cause.title).toBe(
      "Your account has a connector called “Gmail New” — not “Gmail”",
    );
    expect(d.cause.action).toEqual({
      kind: "rebind",
      label: "Use Gmail New for this provider",
      arg: "claude.ai Gmail New",
    });
    expect(d.seen.find((c) => c.name === "Gmail New").isPick).toBe(true);
    expect(d.facts[3].value).toBe("No connector by that name");
  });

  test("frame 2 — still connecting when Dash stopped waiting", () => {
    const d = diag(ready([conn("Gmail", "pending")], { waitedMs: 15000 }));
    expect(d.cause.title).toMatch(/still connecting/);
    expect(d.cause.action).toEqual({
      kind: "reconnect",
      label: "Reconnect and wait longer",
    });
    const gone = diag(
      ready([], { stillConnecting: ["Gmail"], waitedMs: 15000 }),
    );
    expect(gone.cause.action.label).toBe("Reconnect and wait longer");
  });

  test("frame 3 — a different Claude Code, signed in to another account", () => {
    const d = diag(
      ready([conn("Slack")], {
        others: [
          {
            path: "/Users/me/.local/bin/claude",
            version: "2.1.305",
            account: {
              loggedIn: true,
              method: "claude.ai",
              email: "other@example.com",
            },
          },
        ],
        cli: { path: "/usr/local/bin/claude", version: "2.0.14" },
      }),
    );
    expect(d.cause.title).toMatch(/different Claude Code/);
    expect(d.cause.action).toEqual({
      kind: "use-cli",
      label: "Use the one in ~/.local/bin",
      arg: "/Users/me/.local/bin/claude",
    });
    expect(d.facts[0].ok).toBeNull();
    expect(d.facts[0].sub).toMatch(
      /Also here: ~\/.local\/bin\/claude \(2.1.305\)/,
    );
  });

  test("frame 5 — Claude says connected, but the sign-in is turned down", () => {
    const issue = {
      lastAt: "2026-11-13T13:17:00.000Z",
      call: { tool: "list_events", error: "401 invalid_grant" },
    };
    const d = diag(ready([conn("Gmail")]), { signInIssue: issue });
    expect(d.badge.label).toBe("Sign-in failing");
    expect(d.cause.action.kind).toBe("claude-ai");
    expect(d.cause.text).toMatch(/401 invalid_grant/);
    expect(d.facts[3].value).toMatch(/sign-in turned down/);
    expect(d.giveUp).toBe(false);
    // Signed in again and reconnected — and it failed after: stop trying.
    const after = diag(ready([conn("Gmail")]), {
      signInIssue: issue,
      tried: {
        reconnectedAt: "2026-11-13T13:14:00.000Z",
        openedClaudeAt: "2026-11-13T13:16:00.000Z",
      },
    });
    expect(after.giveUp).toBe(true);
  });

  test("frame 6 — given up: what was tried, no cause, no loop", () => {
    const d = diag(
      ready(
        [conn("Gmail")],
        {},
        {
          givenUp: [
            { server: "claude.ai Gmail", retryAt: "2026-11-13T14:17:00.000Z" },
          ],
        },
      ),
      {
        signInIssue: {
          lastAt: "2026-11-13T13:17:00.000Z",
          call: { error: "401" },
        },
        tried: {
          reconnectedAt: "2026-11-13T13:14:00.000Z",
          openedClaudeAt: "2026-11-13T13:16:00.000Z",
        },
      },
    );
    expect(d.cause).toBeNull();
    expect(d.badge).toEqual({
      state: "error",
      label: "Can't connect right now",
    });
    expect(d.stuck.tried.map((t) => t.ok)).toEqual([true, true, false]);
    expect(d.stuck.retryAt).toBe("2026-11-13T14:17:00.000Z");
  });

  test("a failed connector: Reconnect first, then claude.ai", () => {
    const failed = ready([conn("Gmail", "failed", { error: "timeout" })]);
    expect(diag(failed).cause.action.kind).toBe("reconnect");
    expect(
      diag(failed, { tried: { reconnectedAt: "2026-11-13T13:00:00.000Z" } })
        .cause.action.kind,
    ).toBe("claude-ai");
  });

  test("Claude Code missing, not signed in (another one is), didn't answer", () => {
    expect(
      diag({ state: "not-installed", details: { others: [] } }).cause.title,
    ).toMatch(/can't find Claude Code/);
    const ns = diag({
      state: "not-signed-in",
      details: details({
        account: { loggedIn: false, method: null },
        others: [
          {
            path: "/opt/homebrew/bin/claude",
            account: { method: "claude.ai", email: "me@example.com" },
          },
        ],
      }),
    });
    expect(ns.cause.action.kind).toBe("use-cli");
    expect(
      diag({ state: "error", message: "No answer." }).cause.action.kind,
    ).toBe("reconnect");
  });

  test("not in the account at all: claude.ai", () => {
    const d = diag(ready([conn("Slack")]));
    expect(d.cause.title).toBe(
      "Gmail isn't in the Claude account Dash checked",
    );
    expect(d.cause.action.kind).toBe("claude-ai");
  });

  test("Copy details: one line each", () => {
    const result = ready([conn("Gmail New")]);
    const text = diagnosisText({
      providerName: "Gmail",
      server: "claude.ai Gmail",
      result,
      diagnosis: diag(result),
    });
    expect(text).toMatch(/^Dash · Gmail \(claude.ai Gmail\)/);
    expect(text).toMatch(/Likely cause: Your account has a connector called/);
    expect(text).toMatch(/Connectors: Gmail New — connected/);
  });
});
