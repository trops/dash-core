/**
 * issueActions — what the Issues screens' buttons do (issues PRD): retry a
 * widget, hand its error to the Dash team, open its provider or dashboard,
 * show the Debug Console, reconnect a provider, mark an issue resolved.
 * Each goes through the app's existing doors (window events the dashboard
 * stage listens for). Best effort: never throws.
 */
import { assetName, fixErrorText, quotedError } from "./issueText";
import {
  restart as restartGuarded,
  widgetKey as guardKey,
} from "../../Widget/widgetGuard";
import { noteIssueOpenAgain } from "../../utils/issues";

const fire = (name, detail) => {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch (_e) {
    // nothing listening
  }
};

const issuesApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.issues) ||
  null;

/**
 * The event one widget copy's cell listens for to run again (GridCellFrame):
 * { component, itemId, workspaceId, handled }. The cell that is this copy
 * remounts its widget and sets `handled`.
 */
export const RETRY_WIDGET_EVENT = "dash:retry-widget";

/**
 * Retry: this one copy runs again (remounted, its guard reset) — not every
 * copy everywhere. When its dashboard isn't open, open it: the widget calls
 * again as it mounts.
 * → { state: "retrying" | "opening" | "none", message }.
 */
export function retryWidget(issue, { workspaces = [], onOpen = null } = {}) {
  const a = (issue && issue.asset) || {};
  if (!a.component) return { state: "none", message: "" };
  // A widget stopped for failing again and again runs again too.
  try {
    restartGuarded(guardKey(a.component));
  } catch (_e) {
    // nothing stopped
  }
  const detail = {
    component: a.component,
    itemId: a.itemId ?? null,
    workspaceId: a.workspaceId ?? null,
    handled: false,
  };
  fire(RETRY_WIDGET_EVENT, detail);
  if (detail.handled) return { state: "retrying", message: "Retrying…" };
  if (a.workspaceId != null) {
    openWidgetDashboard(issue, { workspaces, onOpen });
    return {
      state: "opening",
      message: "Opening its dashboard — it tries again as it opens.",
    };
  }
  return { state: "none", message: "Open the dashboard to retry." };
}

/**
 * Fix with AI: a conversation about the widget, with what went wrong — the
 * same details the cell's Fix sends (fixRequestDetail), so a fix saved as a
 * new widget takes this copy's place. Older issues without its place send
 * the widget and the error only.
 */
export function fixWidgetWithAi(issue) {
  const a = (issue && issue.asset) || {};
  if (!a.component) return;
  const error = fixErrorText(issue);
  if (a.id == null || a.gridItemId == null) {
    fire("dash:edit-widget-with-ai", {
      widgetComponentName: a.component,
      workspaceId: a.workspaceId ?? null,
      error,
    });
    return;
  }
  fire("dash:edit-widget-with-ai", {
    widgetComponentName: a.component,
    error,
    widgetId: a.id,
    gridItemId: a.gridItemId,
    workspaceId: a.workspaceId ?? null,
    scope: a.scope || "main",
    sourcePackage: a.packageId || null,
  });
}

/**
 * Fix with AI for a bot or provider: Ask AI with a draft. The error is
 * quoted and clipped — what the error said, for the AI to read as data.
 */
export function fixWithAiDraft(issue) {
  if (!issue) return;
  const name = assetName(issue);
  const detail = issue.message || (issue.call && issue.call.error) || "";
  // Titles often start with the name ("Digest: …"): say it once.
  const title = String(issue.title || "").startsWith(`${name}: `)
    ? issue.title.slice(name.length + 2)
    : issue.title || "";
  const end = (s) =>
    String(s)
      .replace(/\s+/g, " ")
      .replace(/[.\s]+$/, "");
  const what = end(title).slice(0, 160);
  const said =
    detail && end(detail) !== end(title)
      ? ` The error said: ${quotedError(end(detail))}.`
      : "";
  fire("dash:open-workspace", {
    key: "role:dashlead",
    draft: `${name} had a problem: ${what}.${said} Help me fix it.`,
  });
}

/** Fix with AI, whichever kind it is. */
export function fixWithAi(issue) {
  const kind = issue && issue.asset && issue.asset.kind;
  if (kind === "widget") fixWidgetWithAi(issue);
  else fixWithAiDraft(issue);
}

/** The provider an issue is about (its call's, or the asset's). */
export function providerOf(issue) {
  if (!issue) return "";
  return (
    (issue.call && issue.call.provider) ||
    (issue.asset && issue.asset.provider) ||
    (issue.related && issue.related.provider) ||
    ""
  );
}

/**
 * Whether a provider whose sign-in expired signs in with its own command
 * (its config's, or its catalog entry's). Without one (an OAuth server),
 * Reconnect is the way back: starting it again asks for the sign-in.
 */
export function signsInWithCommand(provider, catalogAuthCommand = null) {
  return !!(
    (provider && provider.mcpConfig && provider.mcpConfig.authCommand) ||
    catalogAuthCommand
  );
}

/** Open the Providers page on a provider. */
export function openProvider(name) {
  fire("dash:open-page", { page: "providers", providerName: name || null });
}

/** The Debug Console (where the app's calls are logged). */
export function openDebugConsole() {
  try {
    const debug = typeof window !== "undefined" && window.mainApi?.debug;
    if (debug && typeof debug.open === "function") {
      const p = debug.open();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  } catch (_e) {
    // no console in this app
  }
}

/** Is there a Debug Console to open? */
export const hasDebugConsole = () =>
  !!(
    typeof window !== "undefined" &&
    window.mainApi &&
    window.mainApi.debug &&
    typeof window.mainApi.debug.open === "function"
  );

/** Open the widget's dashboard (by id; the stage reloads and opens it). */
export function openWidgetDashboard(issue, { workspaces = [], onOpen } = {}) {
  const a = (issue && issue.asset) || {};
  if (a.workspaceId == null) return;
  const ws = (workspaces || []).find(
    (w) => w && String(w.id) === String(a.workspaceId),
  );
  if (ws && typeof onOpen === "function") onOpen(ws);
  else fire("dash:open-built-dashboard", { id: a.workspaceId });
}

/** Open a bot's page (its Activity). */
export function openBot(issue) {
  const a = (issue && issue.asset) || {};
  if (a.botId) fire("dash:open-bot", { botId: a.botId, tab: "activity" });
}

/** Mark one issue resolved. */
export async function resolveIssue(issue) {
  const api = issuesApi();
  if (!api || !issue || typeof api.resolve !== "function") return;
  try {
    await api.resolve(issue.id);
  } catch (_e) {
    // it stays open; the list says so
  }
}

/** Mute errors like this one: still counted, never shown as open. */
export async function muteIssue(issue) {
  const api = issuesApi();
  if (!api || !issue || typeof api.mute !== "function") return false;
  try {
    return !!(await api.mute(issue.id));
  } catch (_e) {
    return false;
  }
}

/**
 * Unmute: back in Open if it happened since, else resolved.
 * → "open" | "resolved" | null (it didn't change).
 */
export async function unmuteIssue(issue) {
  const api = issuesApi();
  if (!api || !issue || typeof api.unmute !== "function") return null;
  try {
    if (!(await api.unmute(issue.id))) return null;
  } catch (_e) {
    return null;
  }
  if (!issue.mutedCount) return "resolved";
  // Open again: its call working next resolves it.
  noteIssueOpenAgain(issue);
  return "open";
}

/** Forget resolved issues. */
export async function clearResolved() {
  const api = issuesApi();
  if (!api || typeof api.clearResolved !== "function") return;
  try {
    await api.clearResolved();
  } catch (_e) {
    // they stay
  }
}

/**
 * Reconnect an MCP provider: stop its server, then start it again with its
 * saved config — the same calls the Providers page makes after an edit.
 * Resolves its open issues when it starts. → { ok, message }.
 */
export function reconnectProvider(dashApi, name, provider) {
  return new Promise((resolve) => {
    if (
      !dashApi ||
      !name ||
      !provider ||
      typeof dashApi.mcpStartServer !== "function"
    ) {
      resolve({ ok: false, message: "Can't reconnect it here." });
      return;
    }
    const start = () =>
      dashApi.mcpStartServer(
        name,
        provider.mcpConfig,
        provider.credentials,
        (_e, result) => {
          if (result && result.error) {
            resolve({
              ok: false,
              message: result.message || "It didn't start.",
            });
            return;
          }
          const api = issuesApi();
          if (api && typeof api.resolveAsset === "function") {
            Promise.resolve(
              api.resolveAsset({ kind: "provider", provider: name }),
            ).catch(() => {});
          }
          resolve({ ok: true, message: "" });
        },
        (_e, err) =>
          resolve({
            ok: false,
            message: (err && err.message) || "It didn't start.",
          }),
      );
    if (typeof dashApi.mcpStopServer === "function") {
      dashApi.mcpStopServer(name, start, start);
    } else {
      start();
    }
  });
}
