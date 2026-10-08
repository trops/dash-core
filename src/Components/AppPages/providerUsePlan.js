/**
 * providerUsePlan — "Choose where to use…" on a provider (app-navigation PRD
 * NAV-015): every widget and bot that can take this provider, what each uses
 * now, the changes the user's ticks make, and saving them.
 *
 *   providerUseModel  — the dialog's rows (pure)
 *   planProviderUse   — ticks → per-dashboard binding changes + per-bot
 *                        provider lists (pure)
 *   applyProviderUse  — saves each changed dashboard and bot once
 */
import {
  getAllProviderBindings,
  resolveProviderName,
} from "../../utils/providerResolution";
import { applyBulkProviderBindings } from "../../utils/applyBulkProviderBindings";
import { reconcileWorkspaceAfterLayoutChange } from "../../utils/workspaceReconciliation";
import { classOf } from "./providerSummary";

const explicitBinding = (workspace, binding) =>
  (binding.layoutItem &&
    binding.layoutItem.selectedProviders &&
    binding.layoutItem.selectedProviders[binding.providerType]) ||
  (binding.widgetId != null &&
    workspace.selectedProviders &&
    workspace.selectedProviders[binding.widgetId] &&
    workspace.selectedProviders[binding.widgetId][binding.providerType]) ||
  null;

/**
 * @returns {{
 *   providerName, providerType, defaultName,
 *   dashboards: Array<{ workspaceId, workspaceName, rows: Array<{
 *     key, widgetId, label, current: { kind: "explicit"|"default"|"none",
 *     name, needsSetup }, usesThis, locked }> }>,
 *   bots: Array<{ key, botId, name, workspaceId, usesThis, others }>
 * }}
 *   locked — the widget uses this provider only because it's the type's
 *   default, so unticking it wouldn't change anything.
 */
export function providerUseModel({
  providerName,
  providers = {},
  workspaces = [],
  bots = [],
  getWidgetRequirements,
  statusOf = () => null,
}) {
  const provider = (providers || {})[providerName] || {};
  const providerType = provider.type || null;
  const defaultName = providerType
    ? resolveProviderName({ providerType, appProviders: providers })
    : null;
  const needsSetup = (name) => {
    const s = name ? statusOf(name) : null;
    return !!(s && s.key === "needsSetup");
  };

  const dashboards = [];
  for (const workspace of workspaces || []) {
    if (!workspace || !providerType) continue;
    const rows = getAllProviderBindings({
      workspace,
      appProviders: providers,
      getWidgetRequirements,
    })
      .filter((b) => b.providerType === providerType)
      .map((b) => {
        const explicit = explicitBinding(workspace, b);
        const name = explicit || defaultName || null;
        const kind = explicit ? "explicit" : defaultName ? "default" : "none";
        const usesThis = name === providerName;
        return {
          key: `w:${workspace.id}:${b.widgetId}`,
          widgetId: b.widgetId,
          label: b.label || b.component,
          current: { kind, name, needsSetup: needsSetup(name) },
          usesThis,
          locked: usesThis && kind === "default",
        };
      });
    if (rows.length) {
      dashboards.push({
        workspaceId: workspace.id,
        workspaceName: workspace.name || String(workspace.id),
        rows,
      });
    }
  }

  // Bots use MCP providers only.
  const botRows =
    providerType && classOf(provider) === "mcp"
      ? (bots || [])
          .filter((b) => b && b.role !== "lead")
          .map((b) => {
            const servers = b.mcpServers || [];
            return {
              key: `b:${b.id}`,
              botId: b.id,
              name: b.name || String(b.id),
              workspaceId: b.workspaceId || null,
              usesThis: servers.includes(providerName),
              // Other providers of the same type the bot already has.
              others: servers.filter(
                (n) =>
                  n !== providerName &&
                  providers[n] &&
                  providers[n].type === providerType,
              ),
            };
          })
      : [];

  return {
    providerName,
    providerType,
    defaultName,
    dashboards,
    bots: botRows,
  };
}

/**
 * @param model  from providerUseModel
 * @param picks  { [row.key]: boolean } — ticked or not
 * @returns {{ workspaces: Array<{ workspaceId, changes }>,
 *             bots: Array<{ botId, mcpServers }>, count }}
 */
export function planProviderUse(model, picks = {}) {
  const ticked = (row) =>
    Object.prototype.hasOwnProperty.call(picks, row.key)
      ? !!picks[row.key]
      : row.usesThis;
  const workspaces = [];
  let count = 0;
  for (const d of model.dashboards) {
    const changes = [];
    for (const row of d.rows) {
      if (row.locked || ticked(row) === row.usesThis) continue;
      changes.push({
        widgetId: row.widgetId,
        providerType: model.providerType,
        providerName: ticked(row) ? model.providerName : null,
      });
    }
    if (changes.length) {
      workspaces.push({ workspaceId: d.workspaceId, changes });
      count += changes.length;
    }
  }
  const bots = [];
  for (const row of model.bots) {
    if (ticked(row) === row.usesThis) continue;
    bots.push({ botId: row.botId, add: ticked(row) });
    count += 1;
  }
  return { workspaces, bots, count, providerName: model.providerName };
}

const saveWorkspace = (dashApi, appId, workspace) =>
  new Promise((resolve, reject) => {
    try {
      dashApi.saveWorkspace(
        appId,
        workspace,
        () => resolve(),
        (e, err) =>
          reject(
            new Error(
              (err && (err.message || err.error)) ||
                String(err || "save failed"),
            ),
          ),
      );
    } catch (err) {
      reject(err);
    }
  });

/**
 * Save the plan: each changed dashboard once (both binding layers, via
 * applyBulkProviderBindings), each changed bot once (only its provider list
 * changes — its tool choices stay). One failure doesn't stop the rest.
 *
 * @returns {Promise<{ widgets, dashboards, bots, removed,
 *   failed: Array<{ kind, name, error }> }>}
 */
export async function applyProviderUse({
  plan,
  workspaces = [],
  bots = [],
  dashApi,
  appId,
  botsApi,
}) {
  const result = { widgets: 0, removed: 0, dashboards: 0, bots: 0, failed: [] };
  for (const { workspaceId, changes } of plan.workspaces) {
    const workspace = (workspaces || []).find((w) => w && w.id === workspaceId);
    const name = (workspace && workspace.name) || String(workspaceId);
    try {
      if (!workspace) throw new Error("dashboard not found");
      const updated = reconcileWorkspaceAfterLayoutChange(
        applyBulkProviderBindings(workspace, changes),
      );
      await saveWorkspace(dashApi, appId, updated);
      result.dashboards += 1;
      for (const c of changes) {
        if (c.providerName) result.widgets += 1;
        else result.removed += 1;
      }
    } catch (err) {
      result.failed.push({
        kind: "dashboard",
        name,
        error: (err && err.message) || String(err),
      });
    }
  }
  for (const { botId, add } of plan.bots) {
    const bot = (bots || []).find((b) => b && b.id === botId);
    const name = (bot && bot.name) || String(botId);
    try {
      if (!bot) throw new Error("bot not found");
      const current = bot.mcpServers || [];
      const mcpServers = add
        ? current.includes(plan.providerName)
          ? current
          : [...current, plan.providerName]
        : current.filter((n) => n !== plan.providerName);
      await botsApi.save({ ...bot, mcpServers });
      result.bots += 1;
    } catch (err) {
      result.failed.push({
        kind: "bot",
        name,
        error: (err && err.message) || String(err),
      });
    }
  }
  return result;
}
