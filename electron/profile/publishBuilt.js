/**
 * publishBuilt.js
 *
 * Publishing a widget just built in the Widget Builder (dash-profiles v3,
 * Slice 2): the prompt after Install. Widgets are the only items a profile
 * lists by version, so a widget built here reaches the user's other
 * computers once it's published.
 *
 *   planBuiltPublish  can it be published, under what name and version,
 *                     and is it public already
 *   publishBuilt      publish it — private by default — then (an
 *                     `@ai-built` widget) install the published package and
 *                     point this computer's dashboards at it
 *
 * The same publish path as the profile save review (profilePublish.js):
 * the version is the next one the registry doesn't have; a widget whose
 * files mention this computer's folders asks first.
 */

function defaultDeps() {
  return {
    username: async () => {
      try {
        const auth = require("../controller/registryAuthController");
        const cached = auth.getStoredUsername && auth.getStoredUsername();
        if (cached) return cached;
        const profile = await auth.getRegistryProfile().catch(() => null);
        return (profile && profile.username) || null;
      } catch (_e) {
        return null;
      }
    },
    registry: () => require("../widgetRegistry").getWidgetRegistry(),
    lookup: (pkg) =>
      require("../registry/registryPackages").getPackageInfo(pkg, {
        authFailuresUnreachable: true,
      }),
    planPublish: (...a) => require("./profilePublish").planPublish(...a),
    publishWidget: (...a) => require("./profilePublish").publishWidget(...a),
  };
}

/**
 * What publishing `packageName` would do.
 *
 * @returns {Promise<object>} { success, signInRequired?, publishable,
 *   package, publishAs, version, exists, visibility, reason }
 */
async function planBuiltPublish(packageName, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const user = await d.username();
  if (!user) {
    return {
      success: false,
      signInRequired: true,
      error: "Sign in to the registry to publish to your account.",
    };
  }
  const { installedWidget } = require("./profileSetup");
  const installed = installedWidget(d.registry(), packageName);
  if (!installed) {
    return { success: false, error: `${packageName} isn't installed here.` };
  }
  const [row] = await d.planPublish(
    [
      {
        package: packageName,
        version: installed.version || null,
        source: "bundled",
      },
    ],
    user,
    d.lookup,
  );
  if (!row) return { success: false, error: "Couldn't plan the publish." };
  return {
    success: true,
    package: packageName,
    publishable: !!row.publishable,
    publishAs: row.publishAs || null,
    version: row.version || null,
    exists: !!row.exists,
    visibility: row.visibility === "public" ? "public" : "private",
    // Why not, in the Builder's words — none for someone else's widget
    // (nothing to offer there).
    why: row.publishable ? null : row.why || null,
    reason: row.publishable
      ? null
      : row.why === "unreachable"
        ? "Couldn't reach your account right now — publish it later from the Widgets page."
        : row.why === "name-taken"
          ? `${row.publishAs} is already the name of a ${row.takenBy || "package"} you published — rename the widget to publish it.`
          : row.reason || null,
  };
}

/**
 * Publish `packageName` to the signed-in user's account.
 *
 * @param {{visibility?: "public"|"private", confirmPersonalPaths?: boolean}} options
 *   `visibility`: private unless "public" is asked for
 * @returns {Promise<object>} { success, status, publishedAs, version,
 *   visibility, dashboardsSwitched, findings?, error? }
 */
async function publishBuilt(win, appId, packageName, options = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const plan = await planBuiltPublish(packageName, d);
  if (!plan.success) return plan;
  if (!plan.publishable) {
    return {
      success: false,
      error: plan.reason || `${packageName} can't be published.`,
    };
  }
  const visibility = options.visibility === "public" ? "public" : "private";
  const res = await d.publishWidget(
    win,
    appId,
    {
      package: packageName,
      publishAs: plan.publishAs,
      publishable: true,
      version: plan.version,
      visibility,
    },
    { confirmPersonalPaths: options.confirmPersonalPaths === true },
  );
  return {
    ...res,
    success: !!res && res.status === "published",
    visibility,
  };
}

module.exports = { planBuiltPublish, publishBuilt };
