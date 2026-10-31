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
const {
  freeVersion,
  bumpPatch,
  nextFreeVersion,
  kindConflict,
} = require("../registry/registryPackages");

function splitPackage(pkg) {
  const m = String(pkg || "").match(/^@?([^/]+)\/(.+)$/);
  return m ? { scope: m[1], name: m[2] } : null;
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
        why: "not-yours",
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
        why: "unreachable",
        reason: "Couldn't reach your account right now — it stays in the file",
      });
      continue;
    }
    if (kindConflict(publishAs, "widget", info)) {
      rows.push({
        package: w.package,
        publishAs,
        publishable: false,
        why: "name-taken",
        takenBy: info.type,
        reason: `${publishAs} is already the name of a ${info.type} you published — it stays in the file`,
      });
      continue;
    }
    const version = nextFreeVersion(w.version, info);
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

// The visibility a widget is published with: the user's choice, or a
// first publish private and later ones as they are.
function chosenVisibility(row, options = {}) {
  if (options.visibility === "public" || options.visibility === "private") {
    return options.visibility;
  }
  return row.visibility === "public" ? "public" : "private";
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
 * @param {{confirmPersonalPaths?: boolean, visibility?: "public"|"private"}} options
 *   visibility: the user's choice (bulk publish); without one, a first
 *   publish is private and later ones keep the package's visibility
 * @returns {Promise<{status: "published"|"needs-confirmation"|"failed",
 *   publishedAs?, version?, dashboardsSwitched?, error?, problems?,
 *   findings?, warnings?}>}  warnings: what the checks found that didn't
 *   block the publish (hard-coded colors)
 */
async function publishWidget(win, appId, row, options = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  if (!row || !row.publishable) {
    return { status: "failed", error: "This widget can't be published." };
  }
  const to = splitPackage(row.publishAs);
  const res = await d.publish(appId, row.package, {
    version: row.version,
    visibility: chosenVisibility(row, options),
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

  // Published with checks that don't block (hard-coded colors).
  const warned =
    Array.isArray(res.warnings) && res.warnings.length
      ? { warnings: res.warnings }
      : {};

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
      visibility: chosenVisibility(row, options),
      dashboardsSwitched: 0,
      ...warned,
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
      ...warned,
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
    visibility: chosenVisibility(row, options),
    dashboardsSwitched: switched,
    ...warned,
  };
}

// Bulk publishes asked to stop, by "appId:profileId".
const bulkStops = new Set();

/** Stop a bulk publish after the widget being published now. */
function stopPublishing(appId, profileId) {
  bulkStops.add(`${appId}:${profileId}`);
}

/**
 * A bulk publish was asked for: forget an old stop. Called as the request
 * arrives, before planning, so a Stop clicked while the run is still being
 * planned counts.
 */
function beginPublishing(appId, profileId) {
  bulkStops.delete(`${appId}:${profileId}`);
}

/**
 * Publish several of a profile's widgets in one go (bulk publish in the
 * Save dialog), from one plan. Each widget gets its own visibility and
 * personal-path confirmation, and the window hears about each one as it
 * goes. A stop takes effect after the widget being published now.
 *
 * @param {Array} plan       planPublish rows
 * @param {string[]} packages the widgets to publish, in order
 * @param {{options?: {visibility?: object, confirmPersonalPaths?: string[]},
 *   publishOne?: Function}} deps
 * @returns {Promise<{success: true, results: Array, stopped: boolean}>}
 */
async function publishMany(win, appId, profileId, plan, packages, deps = {}) {
  const options = deps.options || {};
  const publishOne = deps.publishOne || publishWidget;
  const key = `${appId}:${profileId}`;
  const visibility = options.visibility || {};
  const confirmed = new Set(
    Array.isArray(options.confirmPersonalPaths)
      ? options.confirmPersonalPaths
      : [],
  );
  const send = (data) => {
    try {
      if (win && win.webContents && !(win.isDestroyed && win.isDestroyed())) {
        const { PROFILE_PUBLISH_PROGRESS } = require("../events/profileEvents");
        win.webContents.send(PROFILE_PUBLISH_PROGRESS, data);
      }
    } catch (_e) {
      // The window went away; publishing goes on.
    }
  };
  const list = [...new Set((packages || []).filter(Boolean))];
  const results = [];
  let stopped = false;
  for (let i = 0; i < list.length; i += 1) {
    if (bulkStops.has(key)) {
      stopped = true;
      break;
    }
    const pkg = list[i];
    send({ package: pkg, index: i, total: list.length, status: "publishing" });
    const row = (plan || []).find((r) => r.package === pkg);
    let result;
    if (!row || !row.publishable) {
      result = { status: "failed", error: `${pkg} can't be published.` };
    } else {
      try {
        result = await publishOne(win, appId, row, {
          confirmPersonalPaths: confirmed.has(pkg),
          visibility: visibility[pkg],
        });
      } catch (e) {
        result = { status: "failed", error: e.message };
      }
    }
    const entry = { package: pkg, ...result };
    results.push(entry);
    send({
      package: pkg,
      index: i,
      total: list.length,
      status: entry.status,
      result: entry,
    });
  }
  bulkStops.delete(key);
  return { success: true, results, stopped };
}

module.exports = {
  planPublish,
  publishWidget,
  publishMany,
  beginPublishing,
  stopPublishing,
  freeVersion,
  bumpPatch,
};
