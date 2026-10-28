/**
 * profileSaveV3.js
 *
 * Saving a profile (dash-profiles v3, user 2026-10-28): the setup goes in
 * as it is (profileSetup.js) and each widget by the version the registry
 * has. Nothing is published.
 *
 *   planSave     what the save would write, for the review: each widget
 *                listed (the registry has this exact version), listed at
 *                the version last published (changes here aren't
 *                published), or not in the registry (left out — the user
 *                can publish it first); what blocks the save
 *   executeSave  write the file, or keep it in the user's account
 *
 * Publishing a widget is the user's step (the review's Publish…, or the
 * Widget Builder's prompt). A profile save only says what it lists.
 */
const path = require("path");

// What a save does with a widget.
const LISTED = "listed";
const UNPUBLISHED = "unpublished";
const NOT_IN_REGISTRY = "not-in-registry";

function defaultDeps() {
  const lookup = (pkg) =>
    require("../registry/registryPackages").getPackageInfo(pkg, {
      authFailuresUnreachable: true,
    });
  return {
    account: () => require("./profileAccount"),
    digest: (appId, profileId) =>
      require("./profileDigest").profileDigest(appId, profileId),
    gather: (appId, profileId, options) =>
      require("./profileFile").gatherProfile(appId, profileId, options, {
        lookupPackage: lookup,
      }),
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
    // Which of the user's widgets the review can offer to publish.
    planWidgets: (widgets, user) =>
      require("./profilePublish").planPublish(widgets, user, lookup),
    widgetRegistry: () => require("../widgetRegistry").getWidgetRegistry(),
    store: {
      setLink: (...args) => require("./profileStore").setLink(...args),
    },
    appVersion: () => {
      try {
        return require("electron").app.getVersion();
      } catch (_e) {
        return null;
      }
    },
  };
}

/** "@scope/name" for a dashboard's widget dependency. */
function packageIdOf(dep) {
  const scope = String(dep.scope || "").replace(/^@/, "");
  const name = String(dep.packageName || dep.package || "");
  if (name.startsWith("@")) return name;
  return scope ? `@${scope}/${name}` : name;
}

/** The widget packages a dashboard uses. */
function dashboardPackages(ws, registry) {
  const {
    collectDependencyRefsFromWorkspace,
    buildWidgetDependencies,
  } = require("../schema/dashboardConfigUtils");
  return new Set(
    buildWidgetDependencies(collectDependencyRefsFromWorkspace(ws), registry)
      .filter((x) => x && (x.packageName || x.package))
      .map(packageIdOf),
  );
}

/**
 * One widget, from the exact-version check (profileFile.classifyWidget):
 * the version the profile lists, and what the review says.
 */
function widgetRow(w) {
  const base = { package: w.package, here: w.version || null };
  switch (w.status) {
    case "in-registry":
    case "assumed-registry":
      return { ...base, action: LISTED, version: w.version };
    case "local-build":
      return {
        ...base,
        action: UNPUBLISHED,
        version: w.version,
        note: `Built on this computer — the profile has ${w.version} as the registry has it.`,
      };
    case "newer-here":
    case "version-missing":
      if (w.registryVersion) {
        return {
          ...base,
          action: UNPUBLISHED,
          version: w.registryVersion,
          note:
            w.status === "newer-here"
              ? `You have ${w.version || "changes"} here, not published — the profile has ${w.registryVersion}.`
              : `The registry doesn't have ${w.version || "this version"} — the profile has ${w.registryVersion}.`,
        };
      }
      return { ...base, action: NOT_IN_REGISTRY };
    case "unchecked":
      return {
        ...base,
        action: "blocked",
        reason: `Couldn't check ${w.package} with the registry — try again.`,
      };
    default:
      return { ...base, action: NOT_IN_REGISTRY };
  }
}

async function planFrom(g, user, d) {
  const registry = d.widgetRegistry();
  const usedBy = new Map();
  for (const ws of g.dashboards) {
    for (const pkg of dashboardPackages(ws, registry)) {
      if (!usedBy.has(pkg)) usedBy.set(pkg, []);
      usedBy.get(pkg).push(ws.name || ws.label || "Untitled");
    }
  }
  const rows = (g.widgets || []).map((w) => ({
    ...widgetRow(w),
    dashboards: usedBy.get(w.package) || [],
  }));
  // The user's own widgets the registry doesn't have (or not as they are
  // here) can be published from the review (`@ai-built` or their scope).
  const missing = (g.widgets || []).filter((w) =>
    rows.some(
      (r) =>
        r.package === w.package &&
        (r.action === NOT_IN_REGISTRY || r.action === UNPUBLISHED),
    ),
  );
  if (missing.length && user) {
    const plan = await d.planWidgets(missing, user);
    for (const r of rows) {
      const p = plan.find((x) => x.package === r.package);
      if (p && p.publishable) r.publishable = true;
    }
  }
  for (const r of rows) {
    if (r.action === UNPUBLISHED && r.publishable) {
      r.note += " Publish to include your changes.";
    }
    if (r.action !== NOT_IN_REGISTRY) continue;
    r.note = `Not in the registry${
      r.dashboards.length
        ? ` — ${r.dashboards.join(", ")} will show it as missing on the other computer`
        : ""
    }.${r.publishable ? " Publish it to include it." : ""}`;
  }
  const blockers = rows
    .filter((r) => r.action === "blocked")
    .map((r) => ({
      kind: "widget",
      key: r.package,
      name: r.package,
      reason: r.reason,
    }));
  const count = (action) => rows.filter((r) => r.action === action).length;
  const { isLead } = require("../bots/teamLeads");
  return {
    success: true,
    schemaVersion: 3,
    profile: { id: g.profile.id, name: g.profile.name },
    username: user || null,
    widgets: rows,
    blockers,
    counts: {
      dashboards: g.dashboards.length,
      bots: (g.bots || []).filter((b) => b && !isLead(b)).length,
      themes: Object.keys(g.themes || {}).length,
      folders: (g.folders || []).length,
      widgets: count(LISTED) + count(UNPUBLISHED),
      unpublished: count(UNPUBLISHED),
      notInRegistry: count(NOT_IN_REGISTRY),
    },
    secretsLeftOut: (g.secretsLeftOut || []).length,
  };
}

/**
 * What saving would write. Never changes anything.
 *
 * @param {{bots?: boolean, providers?: boolean, settings?: boolean}} options
 */
async function planSave(appId, profileId, options = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const user = await d.username();
  const g = await d.gather(appId, profileId, options);
  return planFrom(g, user, d);
}

function computerName() {
  return (
    String(require("os").hostname() || "").replace(/\.local$/i, "") || null
  );
}

/**
 * Save: write the v3 file — or, with `target: "account"`, keep it in the
 * user's account (profileAccount.js).
 *
 * @param {{filePath?: string, target?: "file" | "account", asNew?: boolean,
 *   replaceRevision?: number}} choices
 *   `asNew`: add it to the account as a new profile (its account copy was
 *   removed); `replaceRevision`: the newer account revision the user chose
 *   to replace ("keep this computer's")
 */
async function executeSave(
  win,
  appId,
  profileId,
  options = {},
  choices = {},
  deps = {},
) {
  const d = { ...defaultDeps(), ...deps };
  const user = await d.username();
  const toAccount = choices.target === "account";
  if (toAccount && !user) {
    return {
      success: false,
      signInRequired: true,
      error: "Sign in to keep profiles in your account.",
    };
  }
  // Worked out again here — never taken from the renderer.
  const g = await d.gather(appId, profileId, options);
  const plan = await planFrom(g, user, d);
  if (plan.blockers.length) {
    return {
      success: false,
      error: "Some widgets couldn't be checked with the registry — try again.",
      blockers: plan.blockers,
    };
  }

  // Kept in the account: a newer copy from another computer is never
  // overwritten (unless the user chose to replace that revision).
  let accountTarget = null;
  if (toAccount) {
    const account = d.account();
    const link = choices.asNew ? null : account.getLink(appId, user, profileId);
    accountTarget = link
      ? {
          accountId: link.accountId,
          baseRevision: account.revisionOf(link.revision),
        }
      : { accountId: account.newAccountId(), baseRevision: null };
    if (link) {
      const remote = await account.listRemote();
      if (!remote.success) return remote;
      const there = remote.profiles.find((p) => p.id === link.accountId);
      const replacing =
        there &&
        choices.replaceRevision != null &&
        account.revisionOf(choices.replaceRevision) === there.revision;
      if (replacing) {
        accountTarget.baseRevision = there.revision;
      } else if (!there || there.revision !== accountTarget.baseRevision) {
        return {
          success: false,
          error: there
            ? "Your account has a newer copy of this profile, saved from another computer."
            : "This profile isn't in your account any more.",
          conflict: {
            revision: there ? there.revision : null,
            updatedOn: there ? there.updatedOn || null : null,
            updatedAt: there ? there.updatedAt || null : null,
            missing: !there,
          },
        };
      }
    }
  }

  const widgets = {};
  const leftOut = [];
  const unpublished = [];
  for (const r of plan.widgets) {
    if (r.action === LISTED || r.action === UNPUBLISHED) {
      widgets[r.package] = r.version;
    }
    if (r.action === UNPUBLISHED) {
      unpublished.push({
        package: r.package,
        version: r.version,
        here: r.here,
      });
    }
    if (r.action === NOT_IN_REGISTRY) {
      leftOut.push({ kind: "widget", name: r.package, reason: r.note });
    }
  }
  const { buildManifestV3, MAX_ACCOUNT_BYTES } = require("./profileSetup");
  const { portableSettings } = require("./profileFile");
  const revision = ((g.profile.link && g.profile.link.revision) || 0) + 1;
  const manifest = buildManifestV3({
    profile: g.profile,
    owner: user,
    widgets,
    dashboards: g.dashboards,
    themes: g.themes,
    folders: g.folders || [],
    bots: g.bots || [],
    providers: g.providers || [],
    appSettings: g.settings ? portableSettings(g.settings) : null,
    secretsToEnter: g.secretsLeftOut || [],
    leftOut,
    unpublished,
    revision,
    createdOn: computerName(),
    appVersion: d.appVersion(),
  });
  const result = {
    leftOut,
    unpublished,
    counts: plan.counts,
    secretsLeftOut: plan.secretsLeftOut,
  };

  if (toAccount) {
    const size = Buffer.byteLength(JSON.stringify(manifest), "utf8");
    if (size > MAX_ACCOUNT_BYTES) {
      return {
        success: false,
        error: `This profile is too big to keep in your account (${Math.round(
          size / 1000,
        )} KB; the limit is ${MAX_ACCOUNT_BYTES / 1000} KB). Save it to a file instead, or take some dashboards out of it.`,
      };
    }
    const account = d.account();
    const put = await account.putRemote(
      accountTarget.accountId,
      manifest,
      accountTarget.baseRevision,
    );
    if (!put.success) return put;
    const link = account.setLink(appId, user, profileId, {
      accountId: accountTarget.accountId,
      revision: put.saved.revision,
      savedAt: put.saved.updatedAt || manifest.createdAt,
      updatedOn: put.saved.updatedOn || manifest.createdOn,
      // What it holds now: later changes are counted from here.
      digest: d.digest(appId, profileId),
    });
    return { success: true, account: link, ...result };
  }

  let filePath = choices.filePath || null;
  if (!filePath) {
    const { dialog, app } = require("electron");
    const { PROFILE_FILE_EXTENSION } = require("./profileFile");
    const safe =
      String(g.profile.name)
        .replace(/[\\/:*?"<>|]+/g, "-")
        .trim() || "Profile";
    const res = await dialog.showSaveDialog(win, {
      title: `Save ${g.profile.name} to a file`,
      defaultPath: path.join(
        app.getPath("desktop"),
        `${safe}.${PROFILE_FILE_EXTENSION}`,
      ),
      filters: [{ name: "Dash profile", extensions: [PROFILE_FILE_EXTENSION] }],
    });
    if (res.canceled || !res.filePath)
      return { success: false, canceled: true };
    filePath = res.filePath;
  }
  require("fs").writeFileSync(filePath, JSON.stringify(manifest, null, 2));
  if (g.explicit && typeof d.store.setLink === "function") {
    d.store.setLink(appId, profileId, {
      revision,
      savedAt: manifest.createdAt,
    });
  }
  return { success: true, filePath, revision, ...result };
}

module.exports = {
  planSave,
  executeSave,
  widgetRow,
  LISTED,
  UNPUBLISHED,
  NOT_IN_REGISTRY,
};
