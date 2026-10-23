/**
 * providerSummary — the Providers page's view of a provider (app-navigation
 * PRD NAV-007): its class, whether it still needs setup (a credential its
 * config uses is empty), its status, and which dashboards and bots use it.
 * Pure.
 */
import { deriveFormFields, formatFieldName } from "../../utils/mcpUtils";

export function classOf(provider) {
  return (provider && provider.providerClass) || "credential";
}

const isEmpty = (v) => v === undefined || v === null || String(v).trim() === "";

/**
 * What still has to be filled in, as display names.
 * - MCP: every field the server config uses (env mapping / {{placeholders}})
 *   plus catalog fields marked required — when empty.
 * - Credentials: nothing saved at all.
 * - WebSocket: no URL.
 */
export function missingFields(
  provider,
  credentialSchema = {},
  credentialOptions = null,
) {
  if (!provider) return [];
  const cls = classOf(provider);
  if (cls === "websocket") {
    return provider.wsConfig && provider.wsConfig.url ? [] : ["URL"];
  }
  const creds = provider.credentials || {};
  if (cls === "mcp") {
    if (!provider.mcpConfig) return [];
    // Fields the config itself references are needed; schema-only fields
    // only when the catalog marks them required.
    const used = new Set(
      deriveFormFields(provider.mcpConfig, {}).map((f) => f.key),
    );
    const fields = deriveFormFields(provider.mcpConfig, credentialSchema || {});
    const nameOf = (key) => {
      const f = fields.find((x) => x.key === key);
      return (f && f.displayName) || formatFieldName(key);
    };
    // "One of these" credentials (catalog `credentialOptions`, e.g. Slack:
    // bot token OR user token OR browser token + cookie): their fields are
    // satisfied when any one option is fully filled in.
    const options = (
      Array.isArray(credentialOptions) ? credentialOptions : []
    ).filter((o) => Array.isArray(o) && o.length);
    const inOptions = new Set(options.flat());
    // Catalog fields the server works without (e.g. Algolia's API key on an
    // endpoint that doesn't ask for one) aren't missing when empty. The
    // catalog's `required: false` can't be used for this: it's set on fields
    // servers do need (GitHub's token).
    const worksWithout = (key) =>
      !!(
        credentialSchema &&
        credentialSchema[key] &&
        credentialSchema[key].worksWithout
      );
    const missing = fields
      .filter(
        (f) =>
          !inOptions.has(f.key) &&
          !worksWithout(f.key) &&
          (used.has(f.key) || f.required) &&
          isEmpty(creds[f.key]),
      )
      .map((f) => f.displayName || formatFieldName(f.key));
    if (
      options.length &&
      !options.some((o) => o.every((key) => !isEmpty(creds[key])))
    ) {
      const choices = options.map((o) => o.map(nameOf).join(" + "));
      const listed =
        choices.length > 1
          ? `${choices.slice(0, -1).join(", ")}, or ${choices[choices.length - 1]}`
          : choices[0];
      missing.unshift(`One of: ${listed}`);
    }
    return missing;
  }
  return Object.values(creds).some((v) => !isEmpty(v)) ? [] : ["Credentials"];
}

/**
 * @returns {{ key: "needsSetup"|"connected"|"ready", label, missing }}
 */
export function providerStatus(
  provider,
  { running = false, credentialSchema, credentialOptions = null } = {},
) {
  const missing = missingFields(provider, credentialSchema, credentialOptions);
  if (missing.length)
    return { key: "needsSetup", label: "Needs setup", missing };
  const cls = classOf(provider);
  if (cls === "mcp") {
    return running
      ? { key: "connected", label: "Connected", missing }
      : { key: "ready", label: "Starts when used", missing };
  }
  return {
    key: "ready",
    label: cls === "websocket" ? "Ready" : "Saved",
    missing,
  };
}

/**
 * Dashboards whose widgets resolve to this provider (with how many widgets),
 * and the bots granted it (leads use team tools, not providers).
 * @param bindingsFor  (workspace) => [{ resolvedProviderName }]
 */
export function providerUsage(
  name,
  { workspaces = [], bots = [], bindingsFor },
) {
  const dashboards = [];
  for (const ws of workspaces || []) {
    const widgets = (bindingsFor ? bindingsFor(ws) : []).filter(
      (b) => b && b.resolvedProviderName === name,
    ).length;
    if (widgets) {
      dashboards.push({
        workspaceId: ws.id,
        workspaceName: ws.name || String(ws.id),
        widgets,
      });
    }
  }
  const usedBy = (bots || []).filter(
    (b) => b && b.role !== "lead" && (b.mcpServers || []).includes(name),
  );
  return { dashboards, bots: usedBy, count: dashboards.length + usedBy.length };
}

const MAX_NAMES = 3;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const nameList = (names) =>
  names.length > MAX_NAMES
    ? `${names.slice(0, MAX_NAMES).join(", ")} and ${names.length - MAX_NAMES} more`
    : names.join(", ");

/** "1 dashboard (Sales) and 2 bots (Digest, Loose)", or "" when unused. */
export function providerUsedByText(usage) {
  const parts = [];
  const dashboards = (usage && usage.dashboards) || [];
  const bots = (usage && usage.bots) || [];
  if (dashboards.length) {
    parts.push(
      `${plural(dashboards.length, "dashboard")} (${nameList(
        dashboards.map((d) => d.workspaceName),
      )})`,
    );
  }
  if (bots.length) {
    parts.push(
      `${plural(bots.length, "bot")} (${nameList(bots.map((b) => b.name))})`,
    );
  }
  return parts.join(" and ");
}

// Who's affected, worded for one bot, one dashboard, or several.
function affected(usage) {
  const dashboards = (usage && usage.dashboards) || [];
  const bots = (usage && usage.bots) || [];
  if (bots.length === 1 && !dashboards.length) {
    return { subject: "that bot", s: "s", them: "it" };
  }
  if (dashboards.length === 1 && !bots.length) {
    return { subject: "that dashboard's widgets", s: "", them: "them" };
  }
  return { subject: "they", s: "", them: "them" };
}

/**
 * The Delete confirm (QA 2026-10-22: it never said what uses it). Null
 * usage = not known yet (bots still loading, or no dashboards given).
 */
export function providerDeleteMessage(name, usage) {
  if (!usage) {
    return `Widgets and bots that use ${name} will need another provider picked before they work again. This can't be undone.`;
  }
  const usedBy = providerUsedByText(usage);
  if (!usedBy) return `Nothing uses ${name}. This can't be undone.`;
  const { subject, s } = affected(usage);
  const it = s ? "it" : "they";
  return `${name} is used by ${usedBy}. Once it's deleted, ${subject} need${s} another provider picked before ${it} work${s} again. This can't be undone.`;
}

/**
 * The Rename confirm: widgets and bots find a provider by its name, so a
 * rename leaves them without it. Null when nothing uses it (no confirm);
 * null usage = not known yet, so it still asks.
 */
export function providerRenameMessage(from, to, usage) {
  if (!usage) {
    return `Widgets and bots find ${from} by name, so any that use it won't find it after it's renamed to ${to} until you pick ${to} for them.`;
  }
  const usedBy = providerUsedByText(usage);
  if (!usedBy) return null;
  const { subject, s, them } = affected(usage);
  const Subject = subject[0].toUpperCase() + subject.slice(1);
  const it = s ? "it" : "they";
  return `${from} is used by ${usedBy}. ${Subject} find${s} providers by name, so after the rename to ${to} ${it} won't work until you pick ${to} for ${them}.`;
}

const GROUPS = [
  { cls: "mcp", label: "Tools (MCP)" },
  { cls: "credential", label: "API keys" },
  { cls: "websocket", label: "Live data" },
];

/**
 * Providers grouped by class, A-Z, after the class chip, search (name or
 * type) and the Needs setup chip.
 * @param statusOf  (name) => status key
 */
export function groupProviders(
  providers,
  { cls = "all", query = "", needsSetupOnly = false, statusOf } = {},
) {
  const q = query.trim().toLowerCase();
  const entries = Object.entries(providers || {})
    .map(([name, provider]) => ({ name, provider, cls: classOf(provider) }))
    .filter(
      (e) =>
        (cls === "all" || e.cls === cls) &&
        (!q ||
          e.name.toLowerCase().includes(q) ||
          (e.provider.type || "").toLowerCase().includes(q)) &&
        (!needsSetupOnly || (statusOf && statusOf(e.name) === "needsSetup")),
    )
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  return GROUPS.map((g) => ({
    ...g,
    items: entries.filter((e) => e.cls === g.cls),
  })).filter((g) => g.items.length);
}
