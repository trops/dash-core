/**
 * connectorDiagnosis — why Dash can't use a Claude connector, and the one
 * thing to do about it (approved mockup "A connector Dash can't find says
 * why"): a different name in the account, still connecting, a different
 * Claude Code, Claude says connected but the sign-in is turned down, or —
 * every fix tried — the end of the line, where Dash stops trying. With the
 * facts Dash checked and every connector it saw. Pure.
 */

export const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors";

const PLANS = { max: "Claude Max", pro: "Claude Pro", team: "Claude Team" };
const planName = (p) =>
  p ? PLANS[String(p).toLowerCase()] || `Claude ${p}` : "";

/** "claude.ai Gmail" → "Gmail". */
export const connectorName = (server) =>
  String(server || "").replace(/^claude\.ai\s+/i, "");

const words = (s) =>
  String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

/** Another connector in the account that may be this one ("Gmail New"). */
function similarTo(name, connectors, server) {
  const want = words(name);
  return (connectors || []).filter(
    (c) => c.server !== server && words(c.name).some((w) => want.includes(w)),
  );
}

const home = (p) => String(p || "").replace(/^\/Users\/[^/]+/, "~");
const secs = (ms) => Math.max(1, Math.round((ms || 0) / 1000));
const timeOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
};

/**
 * @param {object} a
 * @param {string} a.providerName  the provider ("Gmail")
 * @param {string} a.server        its connector ("claude.ai Gmail")
 * @param {object|null} a.result   listClaudeConnectors: { state, connectors,
 *   details: { cli, account, others, waitedMs, stillConnecting,
 *   reconnected }, givenUp: [{ server, retryAt }], checkedAt, message }
 * @param {object|null} a.signInIssue  an open Issue: a call to it couldn't
 *   sign in — { lastAt, call: { tool, error } }
 * @param {object} a.tried  what was tried here: { reconnectedAt,
 *   openedClaudeAt } (ISO)
 * @returns {{ badge, cause, stuck, facts, seen, giveUp }}
 *   cause: { title, text, action: { kind, label, arg } } | null;
 *   stuck: { tried: [{ ok, what, at }], retryAt } | null;
 *   giveUp: true when Dash should stop trying now
 */
export function connectorDiagnosis({
  providerName,
  server,
  result = null,
  signInIssue = null,
  tried = {},
}) {
  const name = providerName || connectorName(server);
  const d = (result && result.details) || {};
  const connectors = (result && result.connectors) || [];
  const found = connectors.find((c) => c.server === server) || null;
  const givenUp = ((result && result.givenUp) || []).find(
    (g) => g.server === server,
  );
  const account = d.account || null;
  const others = (d.others || []).filter(
    (o) =>
      o.account &&
      o.account.method === "claude.ai" &&
      (!account || o.account.email !== account.email),
  );
  const ready = result && result.state === "ready";
  const still = (d.stillConnecting || []).includes(connectorName(server));
  const reconnect = { kind: "reconnect", label: "Reconnect" };
  const claudeAi = {
    kind: "claude-ai",
    label: "Reconnect on claude.ai",
    arg: CLAUDE_CONNECTORS_URL,
  };
  // Every fix tried, and it still fails: the end of the line.
  const triedBoth = !!(tried.reconnectedAt && tried.openedClaudeAt);
  const failingSince = (iso) =>
    !!iso && !!tried.openedClaudeAt && iso > tried.openedClaudeAt;

  // --- facts: what Dash checked ---
  const facts = [];
  if (d.cli) {
    facts.push({
      ok: others.length ? null : true,
      label: "Claude Code used",
      value: d.cli.version ? `Version ${d.cli.version}` : "Version not known",
      sub: [
        home(d.cli.path),
        ...others.map(
          (o) =>
            `Also here: ${home(o.path)}${o.version ? ` (${o.version})` : ""}`,
        ),
      ].join(" · "),
    });
  } else if (result && result.state === "not-installed") {
    // Only when Dash looked and found none — an answer without details
    // (an older app) says nothing about Claude Code.
    facts.push({
      ok: false,
      label: "Claude Code used",
      value: "None found on this computer",
      sub: "",
    });
  }
  if (account) {
    facts.push({
      ok: account.loggedIn && account.method === "claude.ai",
      label: "Signed in as",
      value: account.loggedIn
        ? [account.email, planName(account.plan)].filter(Boolean).join(" · ")
        : "Not signed in",
      sub:
        account.method === "claude.ai"
          ? "claude.ai login"
          : account.method
            ? `${account.method} login — connectors need a claude.ai login`
            : "",
    });
  }
  if (ready) {
    facts.push({
      ok: still ? null : true,
      label: "Waited",
      value: still
        ? `${secs(d.waitedMs)} seconds — ${name} was still connecting`
        : `${secs(d.waitedMs)} seconds — every connector answered`,
      sub: "",
    });
  }
  const turnedDown = !!signInIssue;
  facts.push({
    ok:
      found && found.status === "connected" && !turnedDown && !givenUp
        ? true
        : found && found.status === "pending"
          ? null
          : false,
    label: name,
    value: !result
      ? "Not checked yet"
      : !ready
        ? "Couldn't check"
        : found
          ? turnedDown
            ? "Claude: connected · its service: sign-in turned down"
            : found.status === "connected"
              ? `Connected · ${found.tools.length} ${found.tools.length === 1 ? "tool" : "tools"}`
              : found.status === "pending"
                ? "Still connecting"
                : found.status === "needs-auth"
                  ? "Needs you to sign in on claude.ai"
                  : found.error
                    ? `Couldn't connect: ${found.error}`
                    : "Couldn't connect"
          : "No connector by that name",
    sub: turnedDown
      ? `Last call: ${signInIssue.call && signInIssue.call.tool ? `${signInIssue.call.tool} → ` : ""}${(signInIssue.call && signInIssue.call.error) || signInIssue.message || ""}${signInIssue.lastAt ? `, ${timeOf(signInIssue.lastAt)}` : ""}`
      : found
        ? ""
        : `Looked for: ${server}`,
  });

  // --- every connector it saw ---
  const like = found ? [] : similarTo(name, connectors, server);
  const seen = connectors.map((c) => ({
    name: c.name,
    server: c.server,
    status: c.status,
    isPick: like.some((x) => x.server === c.server),
  }));

  // --- the end of the line ---
  const stuckOf = (failure, at) => ({
    tried: [
      ...(tried.reconnectedAt
        ? [
            {
              ok: true,
              what: "Reconnected Dash to your Claude account",
              at: tried.reconnectedAt,
            },
          ]
        : []),
      ...(tried.openedClaudeAt
        ? [
            {
              ok: true,
              what: "You opened claude.ai to sign in again",
              at: tried.openedClaudeAt,
            },
          ]
        : []),
      { ok: false, what: failure, at: at || (result && result.checkedAt) },
    ],
    retryAt: givenUp ? givenUp.retryAt : null,
  });
  const badge = (state, label) => ({ state, label });

  if (givenUp) {
    const failure = turnedDown
      ? `${name}'s sign-in is still turned down`
      : found && found.error
        ? `Claude still can't connect it: ${found.error}`
        : `${name} still can't connect`;
    return {
      badge: badge("error", "Can't connect right now"),
      cause: null,
      stuck: stuckOf(failure, turnedDown ? signInIssue.lastAt : null),
      facts,
      seen,
      giveUp: false,
    };
  }

  // Claude Code itself: missing, not signed in, didn't answer.
  if (result && result.state === "not-installed") {
    return {
      badge: badge("warning", "Claude Code not found"),
      cause: {
        title: "Dash can't find Claude Code on this computer",
        text: "Claude connectors come through Claude Code. Install it and sign in with your Claude account, then Reconnect.",
        action: reconnect,
      },
      stuck: null,
      facts,
      seen,
      giveUp: false,
    };
  }
  if (result && result.state === "not-signed-in") {
    const other = others[0];
    return {
      badge: badge("warning", "Claude Code isn't signed in"),
      cause: other
        ? {
            title: "Dash used a Claude Code that isn't signed in to Claude",
            text: `This computer has another Claude Code, in ${home(other.path)}, signed in as ${other.account.email || "a Claude account"}. Use that one — your bots will too.`,
            action: {
              kind: "use-cli",
              label: `Use the one in ${home(other.path).replace(/\/claude$/, "")}`,
              arg: other.path,
            },
          }
        : {
            title: "Claude Code isn't signed in with a Claude account",
            text: "In a terminal, run claude and sign in with your Claude account (connectors don't work with an API key), then Reconnect.",
            action: reconnect,
          },
      stuck: null,
      facts,
      seen,
      giveUp: false,
    };
  }
  if (result && result.state === "error") {
    return {
      badge: badge("warning", "Couldn't check"),
      cause: {
        title: "Claude Code didn't answer",
        text: `${result.message || "Dash couldn't read your Claude connectors."} Reconnect tries again with a fresh link, and waits longer.`,
        action: reconnect,
      },
      stuck: null,
      facts,
      seen,
      giveUp: triedBoth && failingSince(result.checkedAt),
    };
  }
  if (!ready) {
    return {
      badge: null,
      cause: null,
      stuck: null,
      facts,
      seen,
      giveUp: false,
    };
  }

  // Claude says connected, but its service turns the sign-in down.
  if (turnedDown && (!found || found.status === "connected")) {
    return {
      badge: badge("warning", "Sign-in failing"),
      cause: {
        title: `Claude says ${name} is connected — but signing in to it fails`,
        text: `A bot's call to ${name} was turned down: ${(signInIssue.call && signInIssue.call.error) || signInIssue.message || "the sign-in is no longer valid"}. Sign in to ${name} again on claude.ai — then Reconnect here.`,
        action: claudeAi,
      },
      stuck: null,
      facts,
      seen,
      // Signed in again on claude.ai and reconnected, and it failed after.
      giveUp: triedBoth && failingSince(signInIssue.lastAt),
    };
  }

  if (found) {
    if (found.status === "connected") {
      return {
        badge: badge("success", "Connected"),
        cause: null,
        stuck: null,
        facts,
        seen,
        giveUp: false,
      };
    }
    if (found.status === "pending") {
      return {
        badge: badge("neutral", "Connecting"),
        cause: {
          title: `${name} was still connecting when Dash stopped waiting`,
          text: `Your account has ${name}, but it hadn't finished connecting after ${secs(d.waitedMs)} seconds. This often happens right after the computer wakes up.`,
          action: { kind: "reconnect", label: "Reconnect and wait longer" },
        },
        stuck: null,
        facts,
        seen,
        giveUp: false,
      };
    }
    if (found.status === "needs-auth") {
      return {
        badge: badge("warning", "Sign in on claude.ai"),
        cause: {
          title: `${name} needs you to sign in again`,
          text: `Claude can't use ${name} until you sign in to it again on claude.ai. Then Reconnect here.`,
          action: claudeAi,
        },
        stuck: null,
        facts,
        seen,
        giveUp: triedBoth && failingSince(result.checkedAt),
      };
    }
    if (found.status === "disabled") {
      return {
        badge: badge("neutral", "Turned off in Claude Code"),
        cause: {
          title: `${name} is turned off in Claude Code`,
          text: "Turn it back on in Claude Code (/mcp), then Reconnect.",
          action: reconnect,
        },
        stuck: null,
        facts,
        seen,
        giveUp: false,
      };
    }
    // failed
    return {
      badge: badge("error", "Couldn't connect"),
      cause: {
        title: `Claude couldn't connect ${name}`,
        text: `${found.error ? `It said: ${found.error}. ` : ""}${tried.reconnectedAt ? `Reconnecting didn't help — sign in to ${name} again on claude.ai.` : "Reconnect tries it again."}`,
        action: tried.reconnectedAt ? claudeAi : reconnect,
      },
      stuck: null,
      facts,
      seen,
      giveUp: triedBoth && failingSince(result.checkedAt),
    };
  }

  // Not in the list.
  if (still) {
    return {
      badge: badge("neutral", "Connecting"),
      cause: {
        title: `${name} was still connecting when Dash stopped waiting`,
        text: `Dash waited ${secs(d.waitedMs)} seconds and ${name} hadn't finished connecting.`,
        action: { kind: "reconnect", label: "Reconnect and wait longer" },
      },
      stuck: null,
      facts,
      seen,
      giveUp: false,
    };
  }
  if (like.length) {
    const other = like[0];
    return {
      badge: badge("warning", "Not found in your Claude account"),
      cause: {
        title: `Your account has a connector called “${other.name}” — not “${connectorName(server)}”`,
        text: `This provider looks for a connector named ${connectorName(server)}. Your Claude account has one named ${other.name}${other.status === "connected" ? ", connected" : ""}. If it's the same ${name}, use it for this provider — your bots keep working.`,
        action: {
          kind: "rebind",
          label: `Use ${other.name} for this provider`,
          arg: other.server,
        },
      },
      stuck: null,
      facts,
      seen,
      giveUp: false,
    };
  }
  if (others.length) {
    const other = others[0];
    return {
      badge: badge("warning", "Not found in your Claude account"),
      cause: {
        title: "Dash may be using a different Claude Code from yours",
        text: `This computer has two Claude Codes. Dash used ${home(d.cli && d.cli.path)}${account && account.email ? `, signed in as ${account.email}` : ""}, which has no ${name}. The one in ${home(other.path)} is signed in as ${other.account.email || "another account"}.`,
        action: {
          kind: "use-cli",
          label: `Use the one in ${home(other.path).replace(/\/claude$/, "")}`,
          arg: other.path,
        },
      },
      stuck: null,
      facts,
      seen,
      giveUp: false,
    };
  }
  return {
    badge: badge("warning", "Not found in your Claude account"),
    cause: {
      title: `${name} isn't in the Claude account Dash checked`,
      text: `${account && account.email ? `Dash checked ${account.email}. ` : ""}Add or reconnect ${name} on claude.ai, then Reconnect here.`,
      action: claudeAi,
    },
    stuck: null,
    facts,
    seen,
    giveUp: triedBoth && failingSince(result.checkedAt),
  };
}

/** The details as text, to paste for help (Copy details). */
export function diagnosisText({ providerName, server, result, diagnosis }) {
  const lines = [
    `Dash · ${providerName} (${server})`,
    `Checked: ${(result && result.checkedAt) || "not yet"}`,
    ...(diagnosis.cause ? [`Likely cause: ${diagnosis.cause.title}`] : []),
    ...diagnosis.facts.map(
      (f) => `${f.label}: ${f.value}${f.sub ? ` (${f.sub})` : ""}`,
    ),
    `Connectors: ${diagnosis.seen.map((c) => `${c.name} — ${c.status}`).join("; ") || "none"}`,
  ];
  const r = result && result.details && result.details.reconnected;
  if (r && r.length) {
    lines.push(
      `Reconnected: ${r.map((x) => `${connectorName(x.server)} ${x.ok ? "ok" : `failed (${x.error})`}`).join("; ")}`,
    );
  }
  return lines.join("\n");
}
