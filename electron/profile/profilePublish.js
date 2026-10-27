/**
 * profilePublish.js
 *
 * Publish privately from "Save to file" (dash-profiles PRD, PR 4b). When a
 * profile uses widgets the registry can't supply, a signed-in user can tick
 * them in the Save dialog (nothing is ticked by default) to publish them to
 * their own account instead of copying them into the file:
 *
 *   - `@ai-built/x` (or any widget already under the user's name) publishes
 *     as `@<user>/x`, at its own version;
 *   - never over a version the registry already has (the registry would
 *     silently replace it) — the patch number goes up until it's free;
 *   - a package's first publish is private; later ones keep its visibility
 *     (publishing without one would make a private package public).
 *
 * After an `@ai-built/x` publishes, the published package is installed and
 * every dashboard on this computer that used `@ai-built/x` points at
 * `@<user>/x` — the same code and version — so both computers run one
 * package and later updates reach both.
 */
const { isNewerVersion } = require("../utils/isNewerVersion");

function splitPackage(pkg) {
  const m = String(pkg || "").match(/^@?([^/]+)\/(.+)$/);
  return m ? { scope: m[1], name: m[2] } : null;
}

function bumpPatch(version) {
  const m = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return "1.0.0";
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** The first version at or after `version` that the registry doesn't have. */
function freeVersion(version, taken) {
  const have = new Set(taken || []);
  let v = /^\d+\.\d+\.\d+/.test(String(version || "")) ? version : "1.0.0";
  // Never below what's published: start past the newest taken version.
  for (const t of have) {
    if (isNewerVersion(t, v)) v = t;
  }
  while (have.has(v)) v = bumpPatch(v);
  return v;
}

/**
 * Which widgets the Save dialog can offer to publish, and how.
 *
 * @param {Array} widgets   gatherProfile(...).widgets
 * @param {string} username the signed-in registry username
 * @param {(pkg: string) => Promise<object|null|"unreachable">} lookup
 *   the registry's { versions, visibility } for a package
 */
async function planPublish(widgets, username, lookup) {
  const user = String(username || "").replace(/^@/, "");
  const rows = [];
  for (const w of widgets || []) {
    if (w.source !== "bundled") continue;
    const ref = splitPackage(w.package);
    const scope = ref ? ref.scope.toLowerCase() : "";
    if (
      !ref ||
      !user ||
      (scope !== "ai-built" && scope !== user.toLowerCase())
    ) {
      rows.push({
        package: w.package,
        publishable: false,
        reason: "Published by someone else — it stays in the file",
      });
      continue;
    }
    const publishAs = `@${user}/${ref.name}`;
    const info = await lookup(publishAs);
    if (info === "unreachable") {
      rows.push({
        package: w.package,
        publishAs,
        publishable: false,
        reason: "Couldn't reach your account right now — it stays in the file",
      });
      continue;
    }
    const taken = (info && info.versions) || [];
    const version = freeVersion(w.version, taken);
    rows.push({
      package: w.package,
      publishAs,
      publishable: true,
      currentVersion: w.version || null,
      version,
      bumped: !!w.version && version !== w.version,
      exists: !!info,
      visibility: info && info.visibility ? info.visibility : "private",
    });
  }
  return rows;
}

function defaultDeps() {
  return {
    publish: (appId, pkg, options) =>
      require("../controller/widgetRegistryController").prepareWidgetForPublish(
        appId,
        pkg,
        options,
      ),
    registry: () => require("../widgetRegistry").getWidgetRegistry(),
    listWorkspaces: (appId) =>
      require("../utils/file").getFileContents(
        require("../utils/appPaths").getAppFilePath(appId, "workspaces.json"),
      ),
    saveWorkspace: (win, appId, ws) =>
      require("../controller/workspaceController").saveWorkspaceForApplication(
        win,
        appId,
        ws,
      ),
  };
}

/**
 * Publish one widget from the Save dialog and, for a renamed package,
 * switch this computer over to it.
 *
 * @param {object} row   a publishable row from planPublish
 * @param {{confirmPersonalPaths?: boolean}} options
 * @returns {Promise<{status: "published"|"needs-confirmation"|"failed",
 *   publishedAs?, version?, dashboardsSwitched?, error?, findings?}>}
 */
async function publishWidget(win, appId, row, options = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!row || !row.publishable) {
    return { status: "failed", error: "This widget can't be published." };
  }
  const to = splitPackage(row.publishAs);
  const res = await d.publish(appId, row.package, {
    version: row.version,
    visibility: row.visibility === "public" ? "public" : "private",
    scope: to ? to.scope : undefined,
    confirmPersonalPaths: !!options.confirmPersonalPaths,
  });
  if (res && res.needsConfirmation) {
    return {
      status: "needs-confirmation",
      reason: res.reason,
      findings: res.personalPathFindings || [],
    };
  }
  if (!res || !res.success) {
    // The registry says what's wrong in `details`.
    const details =
      res && Array.isArray(res.details) && res.details.length
        ? ` — ${res.details.join("; ")}`
        : "";
    return {
      status: "failed",
      error: `${(res && res.error) || "Publishing failed."}${details}`,
      problems: (res && res.problems) || null,
    };
  }

  const registry = d.registry();
  // Same package name (already under the user's scope): this computer
  // already runs exactly the published code.
  if (row.publishAs === row.package) {
    if (registry && registry.markInstallSource) {
      registry.markInstallSource(row.package, "registry", row.version);
    }
    return {
      status: "published",
      publishedAs: row.publishAs,
      version: row.version,
      dashboardsSwitched: 0,
    };
  }

  // Renamed (@ai-built/x → @user/x): install the published package, then
  // point every dashboard on this computer at it.
  const downloadUrl = res.registryResult && res.registryResult.downloadUrl;
  try {
    if (!downloadUrl)
      throw new Error("The registry didn't return a download link.");
    await registry.downloadWidget(row.publishAs, downloadUrl);
  } catch (e) {
    return {
      status: "failed",
      published: true,
      publishedAs: row.publishAs,
      version: row.version,
      error: `Published, but installing it here failed: ${e.message}. Dashboards still use the local copy.`,
    };
  }

  const { repointLayoutPackage } = require("../schema/dashboardConfigUtils");
  let switched = 0;
  for (const ws of d.listWorkspaces(appId) || []) {
    if (!ws) continue;
    const { workspace, changed } = repointLayoutPackage(
      ws,
      row.package,
      row.publishAs,
    );
    if (changed > 0) {
      d.saveWorkspace(win, appId, workspace);
      switched += 1;
    }
  }
  return {
    status: "published",
    publishedAs: row.publishAs,
    version: row.version,
    dashboardsSwitched: switched,
  };
}

module.exports = { planPublish, publishWidget, freeVersion, bumpPatch };
