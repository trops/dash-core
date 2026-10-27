/**
 * profileSaveV2.js
 *
 * Saving a profile as a v2 file (dash-profiles v2, user decisions
 * 2026-10-27): everything it holds is in the registry, and the file lists
 * the packages at exact versions plus what publishing leaves out
 * (profileManifest.js). Signed in only.
 *
 *   planSave     what the save would do, for the review: each item is
 *                referenced (already in the registry as it is here),
 *                published (yours, new or changed — private when new),
 *                published as a remix (someone else's, changed, and its
 *                author allows it), or left out with the reason; and what
 *                blocks the save
 *   executeSave  do it: publish (widgets, themes, dashboards, then bots),
 *                then write the file
 *
 * Only what changed since it was last published or installed is published
 * (registry/fingerprint.js). A changed item of the user's that's public
 * would publish a new public version: the review shows it ticked, and an
 * unticked one is saved at its last published version (its settings still
 * come along). One of the user's own items that can't be published blocks
 * the save; someone else's that can't is left out, with the reason.
 */
const path = require("path");
const {
  readRegistryRef,
  normalizePackageRef,
} = require("../registry/packageRef");
const { changedSince } = require("../registry/fingerprint");

// What can happen to an item.
const REFERENCE = "reference";
const PUBLISH = "publish";
const REMIX = "remix";
const LEAVE_OUT = "leave-out";
// A dashboard's own team, unchanged: installed with the dashboard.
const WITH_DASHBOARD = "with-dashboard";

function defaultDeps() {
  const registryPackages = () => require("../registry/registryPackages");
  const bots = () => {
    const c = require("../controller/botController");
    return c && c._ready ? c : null;
  };
  return {
    // Profiles kept in the account (step 2).
    account: () => require("./profileAccount"),
    gather: (appId, profileId, options) =>
      require("./profileFile").gatherProfile(appId, profileId, options),
    username: async () => {
      const auth = require("../controller/registryAuthController");
      const cached = auth.getStoredUsername && auth.getStoredUsername();
      if (cached) return cached;
      const profile = await auth.getRegistryProfile().catch(() => null);
      return (profile && profile.username) || null;
    },
    isOwnScope: (scope, user) => registryPackages().isOwnScope(scope, user),
    lookup: (pkg) =>
      registryPackages().getPackageInfo(pkg, { authFailuresUnreachable: true }),
    remixOrigin: (kind, record, user) =>
      require("../registry/remix").remixOrigin(kind, record, user),
    checkRemixAll: (origins) =>
      require("../registry/remix").checkRemixAll(origins),
    planWidgets: (widgets, user, lookup) =>
      require("./profilePublish").planPublish(widgets, user, lookup),
    widgetRegistry: () => require("../widgetRegistry").getWidgetRegistry(),
    teamSettings: (workspaceId) => {
      const c = bots();
      return c ? c._store.getTeamSettings(workspaceId) || {} : {};
    },
    // A dashboard's team as published: every bot on it but its lead.
    teamBots: (workspaceId) => {
      const c = bots();
      if (!c) return [];
      const { isOnTeam } = require("../bots/teams");
      const { isLead } = require("../bots/teamLeads");
      return c._store
        .list()
        .filter((b) => isOnTeam(b, workspaceId) && !isLead(b));
    },
    publishWidget: (win, appId, row, opts) =>
      require("./profilePublish").publishWidget(win, appId, row, opts),
    publishTheme: (appId, key) =>
      require("../controller/themeRegistryController").publishThemeHeadless(
        appId,
        key,
      ),
    publishDashboard: (appId, id) =>
      require("../controller/dashboardConfigController").publishDashboardHeadless(
        appId,
        id,
        {},
        require("../widgetRegistry").getWidgetRegistry(),
      ),
    publishBot: (opts) => {
      const c = bots();
      return c
        ? c.publishHeadless(opts)
        : { success: false, error: "Bots aren't available right now." };
    },
    // Fresh records after publishing (each publish records its package).
    reload: (appId, profileId) =>
      require("./profileFile").gatherProfile(appId, profileId, {}),
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

function scopeOf(pkg) {
  const ref = normalizePackageRef(pkg);
  return ref ? ref.scope : null;
}

/** "@scope/name" for a dashboard's widget dependency. */
function packageIdOf(dep) {
  const scope = String(dep.scope || "").replace(/^@/, "");
  const name = String(dep.packageName || dep.package || "");
  if (name.startsWith("@")) return name;
  return scope ? `@${scope}/${name}` : name;
}

function dashboardPackages(ws, registry) {
  const {
    collectDependencyRefsFromWorkspace,
    buildWidgetDependencies,
  } = require("../schema/dashboardConfigUtils");
  return new Set(
    buildWidgetDependencies(collectDependencyRefsFromWorkspace(ws), registry)
      .filter((d) => d && (d.packageName || d.package))
      .map(packageIdOf),
  );
}

// Edited since it was installed, for records installed before fingerprints
// (dashboards stamp `updatedAt` on save; installs record `importedAt`).
function editedSinceInstall(ws) {
  const c = (ws && ws._dashboardConfig) || {};
  const edited = Date.parse(ws && ws.updatedAt);
  const installed = Date.parse(c.importedAt);
  if (!Number.isFinite(edited) || !Number.isFinite(installed)) return false;
  return edited - installed > 5000;
}

/**
 * Decide one dashboard, theme, bot or team.
 *
 * @returns {Promise<object>} { action, package?, version?, public?, reason? }
 */
async function decide(kind, record, ctx, extra = {}) {
  const { user, d } = ctx;
  const ref = readRegistryRef(kind, extra.refRecord || record);
  const scope = ref && ref.package ? scopeOf(ref.package) : null;
  const fpRecord = extra.fingerprintRecord || record;
  const own = !ref || (scope && d.isOwnScope(scope, user));

  if (ref && !ref.package && ref.origin === "published") {
    // Published from here before Dash recorded the scope: the user's own,
    // published again (under its own name when it's free).
    return { action: PUBLISH, package: null, version: null, public: false };
  }
  if (ref && !ref.package) {
    // Installed before Dash recorded which account it came from.
    return {
      action: LEAVE_OUT,
      reason:
        "Installed before Dash recorded where it came from — reinstall it from the registry to include it.",
    };
  }
  if (own) {
    if (
      kind === "dashboard" &&
      !ref &&
      record._dashboardConfig &&
      record._dashboardConfig.shareable === false
    ) {
      return {
        action: LEAVE_OUT,
        reason: "Imported from a file, so it can't be published.",
      };
    }
    const changed = ref ? changedSince(kind, fpRecord, ref) : true;
    if (ref && changed === false && ref.version) {
      return { action: REFERENCE, package: ref.package, version: ref.version };
    }
    // The user's own copy of someone else's work (a remix, or a team with
    // someone else's bots): it publishes only if those authors allow it.
    const origins = (
      extra.origins || [d.remixOrigin(kind, record, user)]
    ).filter(Boolean);
    if (origins.length) {
      const check = await d.checkRemixAll(origins);
      if (check.error) return { action: LEAVE_OUT, reason: check.error };
    }
    // New, changed, or published before fingerprints: published. A public
    // package of the user's gets a public version — the review asks.
    let isPublic = false;
    if (ref && ref.package) {
      const info = await d.lookup(ref.package);
      if (info === "unreachable") {
        return {
          action: "blocked",
          reason: `Couldn't reach the registry to check ${ref.package}.`,
        };
      }
      isPublic = !!(info && info.visibility === "public");
    }
    return {
      action: PUBLISH,
      package: ref ? ref.package : null,
      version: ref ? ref.version : null,
      public: isPublic,
    };
  }

  // Someone else's.
  let changed = changedSince(kind, fpRecord, ref);
  if (changed === null)
    changed = kind === "dashboard" && editedSinceInstall(record);
  if (!changed) {
    return { action: REFERENCE, package: ref.package, version: ref.version };
  }
  const origins = extra.origins || [d.remixOrigin(kind, record, user)];
  const check = await d.checkRemixAll(origins);
  if (check.error) return { action: LEAVE_OUT, reason: check.error };
  return { action: REMIX, package: ref.package, version: ref.version };
}

/**
 * What saving would do. Never changes anything.
 *
 * @returns {Promise<object>} { success, signInRequired?, profile, username,
 *   items: [{ kind, key, name, action, package, version, public, reason }],
 *   blockers: [{ kind, key, name, reason }], counts, secretsLeftOut }
 */
async function planSave(appId, profileId, options = {}, deps = {}) {
  const d = { ...defaultDeps(), ...deps };
  const user = await d.username();
  if (!user) {
    return {
      success: false,
      signInRequired: true,
      error: "Sign in to the registry to save a profile.",
    };
  }
  const g = await d.gather(appId, profileId, options);
  const ctx = { user, d };
  const items = [];
  const blockers = [];
  const add = (item) => {
    if (item.action === "blocked") {
      blockers.push({
        kind: item.kind,
        key: item.key,
        name: item.name,
        reason: item.reason,
      });
    }
    items.push(item);
  };

  // Widgets: the registry's exact versions are referenced; the user's own
  // builds are published; someone else's the registry doesn't have take
  // their dashboards out.
  const widgetPlan = await d.planWidgets(g.widgets, user, d.lookup);
  const planFor = new Map(widgetPlan.map((r) => [r.package, r]));
  const leftOutWidgets = new Map();
  for (const w of g.widgets) {
    const base = { kind: "widget", key: w.package, name: w.package };
    if (w.status === "unchecked") {
      add({
        ...base,
        action: "blocked",
        reason: `Couldn't check ${w.package} with the registry — try again.`,
      });
    } else if (w.source !== "bundled") {
      add({
        ...base,
        action: REFERENCE,
        package: w.package,
        version: w.version,
      });
    } else {
      const row = planFor.get(w.package);
      if (row && row.publishable) {
        const isPublic = !!(row.exists && row.visibility === "public");
        // Held back, it stays at the version the registry has now.
        let lastVersion = null;
        if (isPublic) {
          const info = await d.lookup(row.publishAs);
          lastVersion =
            (info && typeof info === "object" && info.latestVersion) || null;
        }
        add({
          ...base,
          action: PUBLISH,
          package: row.publishAs,
          version: row.version,
          public: isPublic && !!lastVersion,
          lastVersion,
        });
      } else {
        const reason =
          (row && row.reason) ||
          "Not in the registry, and not yours to publish";
        leftOutWidgets.set(w.package, reason);
        add({ ...base, action: LEAVE_OUT, reason });
      }
    }
  }

  // Themes.
  for (const [key, theme] of Object.entries(g.themes || {})) {
    add({
      kind: "theme",
      key,
      name: (theme && theme.name) || key,
      ...(await decide("theme", theme, ctx)),
    });
  }

  // Dashboards: one that needs a widget left out is left out too.
  const registry = d.widgetRegistry();
  const dashboardsIn = new Set();
  for (const ws of g.dashboards) {
    const base = {
      kind: "dashboard",
      key: String(ws.id),
      name: ws.name || ws.label || "Dashboard",
    };
    const missing = [...dashboardPackages(ws, registry)].filter((p) =>
      leftOutWidgets.has(p),
    );
    if (missing.length) {
      add({
        ...base,
        action: LEAVE_OUT,
        reason: `Uses ${missing.join(", ")}, which the registry doesn't have and you can't publish.`,
      });
      continue;
    }
    const decision = await decide("dashboard", ws, ctx);
    add({ ...base, ...decision });
    if (decision.action !== LEAVE_OUT) dashboardsIn.add(String(ws.id));
  }

  // Bots: a dashboard's team as one package, other bots one by one. A lead
  // goes with its dashboard (it's made when the dashboard opens).
  const { isLead } = require("../bots/teamLeads");
  const bots = (g.bots || []).filter((b) => b && !isLead(b));
  const teams = new Map();
  for (const b of bots) {
    const wsId = b.workspaceId != null ? String(b.workspaceId) : null;
    if (wsId && dashboardsIn.has(wsId)) {
      teams.set(wsId, true);
      continue;
    }
    const fromTeam =
      (b.registryRef && b.registryRef.kind === "bot-team") ||
      (b.installedFrom && b.installedFrom.kind === "bot-team");
    if (fromTeam) {
      add({
        kind: "bot",
        key: String(b.id),
        name: b.name || "Bot",
        action: LEAVE_OUT,
        reason: "Part of a team package — include its dashboard to include it.",
      });
      continue;
    }
    add({
      kind: "bot",
      key: String(b.id),
      name: b.name || "Bot",
      ...(await decide("bot", b, ctx)),
    });
  }
  for (const wsId of teams.keys()) {
    const ws = g.dashboards.find((w) => String(w.id) === wsId);
    const settings = d.teamSettings(wsId);
    // The whole team, as a team publish packs it.
    const members = d.teamBots(wsId);
    if (!members.length) continue;
    const base = {
      kind: "team",
      key: wsId,
      name: `${(ws && (ws.name || ws.label)) || "Dashboard"} team`,
    };
    // The dashboard's own team, unchanged: it comes with the dashboard.
    const embedded = settings.embeddedFrom;
    if (
      embedded &&
      !settings.registryRef &&
      changedSince("bot-team", members, embedded) === false
    ) {
      add({ ...base, action: WITH_DASHBOARD });
      continue;
    }
    add({
      ...base,
      ...(await decide("bot-team", members, ctx, {
        refRecord: settings,
        fingerprintRecord: members,
        origins: members.map((b) => d.remixOrigin("bot-team", b, user)),
      })),
    });
  }

  const count = (action) => items.filter((i) => i.action === action).length;
  return {
    success: true,
    profile: { id: g.profile.id, name: g.profile.name },
    username: user,
    items,
    blockers,
    counts: {
      reference: count(REFERENCE) + count(WITH_DASHBOARD),
      publish: count(PUBLISH) + count(REMIX),
      leaveOut: count(LEAVE_OUT),
      blocked: blockers.length,
    },
    secretsLeftOut: (g.secretsLeftOut || []).length,
  };
}

/**
 * Save: publish what the plan says (in an order that keeps references
 * whole), then write the v2 file — or, with `target: "account"`, keep it
 * in the user's account (profileAccount.js).
 *
 * @param {{skipPublic?: string[], confirmPersonalPaths?: string[],
 *   filePath?: string, target?: "file" | "account", asNew?: boolean,
 *   replaceRevision?: number}} choices
 *   `skipPublic`: "<kind>:<key>" of the user's public items not to release
 *   now; `confirmPersonalPaths`: widgets whose files mention this
 *   computer's folders, confirmed by the user; `asNew`: add it to the
 *   account as a new profile (its account copy was removed);
 *   `replaceRevision`: the newer account revision the user chose to replace
 *   ("keep this computer's")
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
  // Worked out again here — never taken from the renderer.
  const plan = await planSave(appId, profileId, options, d);
  if (!plan.success) return plan;
  if (plan.blockers.length) {
    return {
      success: false,
      error: "Some items can't be saved yet.",
      blockers: plan.blockers,
    };
  }
  // Kept in the account: checked before anything is published, so a save
  // that would be refused (another computer saved since) changes nothing.
  const toAccount = choices.target === "account";
  let accountTarget = null;
  if (toAccount) {
    const account = d.account();
    const link = choices.asNew
      ? null
      : account.getLink(appId, plan.username, profileId);
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
      // "Keep this computer's": the user saw the newer copy (its revision)
      // and chose to replace it. A save from yet another computer since
      // still refuses (the registry checks the revision).
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
  const user = plan.username;
  const skip = new Set(choices.skipPublic || []);
  const confirmPaths = new Set(choices.confirmPersonalPaths || []);
  const leftOut = plan.items
    .filter((i) => i.action === LEAVE_OUT)
    .map((i) => ({ kind: i.kind, name: i.name, reason: i.reason }));
  const published = [];

  const g0 = await d.gather(appId, profileId, options);
  const widgetPlan = await d.planWidgets(g0.widgets, user, d.lookup);
  const widgets = {};
  const order = ["widget", "theme", "dashboard", "bot", "team"];
  const toPublish = plan.items
    .filter((i) => i.action === PUBLISH || i.action === REMIX)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const skipped = new Set();

  for (const item of plan.items) {
    if (item.kind === "widget" && item.action === REFERENCE) {
      widgets[item.package] = item.version;
    }
  }

  for (const item of toPublish) {
    const id = `${item.kind}:${item.key}`;
    // The user's public item not released now: its last published version.
    if (item.public && skip.has(id) && item.package) {
      skipped.add(id);
      if (item.kind === "widget") widgets[item.package] = item.lastVersion;
      continue;
    }
    let res;
    if (item.kind === "widget") {
      const row = widgetPlan.find((r) => r.package === item.key);
      res = await d.publishWidget(win, appId, row, {
        confirmPersonalPaths: confirmPaths.has(item.key),
      });
      if (res && res.status === "needs-confirmation") {
        return {
          success: false,
          needsConfirmation: {
            package: item.key,
            findings: res.findings || [],
          },
          error: `${item.key}'s files mention folders on this computer — check them, then save again.`,
        };
      }
      if (res && res.status === "published") {
        widgets[res.publishedAs || row.publishAs] = res.version || row.version;
        published.push({
          kind: "widget",
          name: item.name,
          package: res.publishedAs || row.publishAs,
          version: res.version || row.version,
        });
        continue;
      }
    } else if (item.kind === "theme") {
      res = await d.publishTheme(appId, item.key);
    } else if (item.kind === "dashboard") {
      res = await d.publishDashboard(appId, item.key);
    } else if (item.kind === "bot") {
      res = await d.publishBot({ kind: "bot", botId: item.key });
    } else {
      res = await d.publishBot({ kind: "team", workspaceId: item.key });
    }
    if (res && res.success) {
      published.push({
        kind: item.kind,
        name: item.name,
        package: res.package,
        version: res.version,
      });
      continue;
    }
    const why = (res && res.error) || "Publishing failed.";
    if (item.action === REMIX) {
      // Someone else's: left out, with the registry's reason.
      leftOut.push({ kind: item.kind, name: item.name, reason: why });
      continue;
    }
    return {
      success: false,
      error: `${item.name} couldn't be published: ${why}`,
      failed: { kind: item.kind, key: item.key, name: item.name },
      published,
    };
  }

  // What each item is now (every publish recorded its package).
  const g = await d.reload(appId, profileId, options);
  const out = { dashboards: [], bots: [], themes: [] };
  // Teams that go with their dashboard (unchanged since installed).
  const withDashboard = new Set(
    plan.items
      .filter((i) => i.kind === "team" && i.action === WITH_DASHBOARD)
      .map((i) => String(i.key)),
  );
  const leftKeys = new Set(
    plan.items
      .filter((i) => i.action === LEAVE_OUT)
      .map((i) => `${i.kind}:${i.key}`),
  );
  const refOf = (kind, record) => {
    const ref = readRegistryRef(kind, record);
    return ref && ref.package ? ref : null;
  };
  const themePackage = {};
  for (const [key, theme] of Object.entries(g.themes || {})) {
    if (leftKeys.has(`theme:${key}`)) continue;
    const ref = refOf("theme", theme);
    if (!ref) continue;
    themePackage[key] = ref.package;
    out.themes.push({ package: ref.package, version: ref.version, key });
  }
  const {
    dashboardOverlay,
    botOverlay,
    buildManifestV2,
  } = require("./profileManifest");
  const dashPackage = {};
  for (const ws of g.dashboards) {
    if (leftKeys.has(`dashboard:${ws.id}`)) continue;
    const ref = refOf("dashboard", ws);
    if (!ref) continue;
    dashPackage[String(ws.id)] = ref.package;
    out.dashboards.push({
      package: ref.package,
      version: ref.version,
      id: ws.id,
      name: ws.name || ws.label || null,
      folder: ws.menuId,
      theme: ws.themeKey ? themePackage[ws.themeKey] || null : null,
      // Its own team comes with it (unchanged since installed).
      withTeam: withDashboard.has(String(ws.id)),
      overlay: dashboardOverlay(ws),
    });
  }
  const { isLead } = require("../bots/teamLeads");
  const teamDone = new Set(withDashboard);
  for (const b of (g.bots || []).filter((x) => x && !isLead(x))) {
    const wsId = b.workspaceId != null ? String(b.workspaceId) : null;
    if (wsId && dashPackage[wsId]) {
      if (teamDone.has(wsId) || leftKeys.has(`team:${wsId}`)) continue;
      teamDone.add(wsId);
      const ref = refOf("bot-team", d.teamSettings(wsId));
      if (!ref) continue;
      const members = (g.bots || []).filter(
        (x) => x && !isLead(x) && String(x.workspaceId) === wsId,
      );
      const overlay = {};
      for (const m of members) overlay[m.name || m.id] = botOverlay(m);
      out.bots.push({
        package: ref.package,
        version: ref.version,
        kind: "team",
        dashboard: dashPackage[wsId],
        overlay: { members: overlay },
      });
      continue;
    }
    if (leftKeys.has(`bot:${b.id}`)) continue;
    const ref = refOf("bot", b);
    if (!ref) continue;
    out.bots.push({
      package: ref.package,
      version: ref.version,
      kind: "bot",
      dashboard: wsId ? dashPackage[wsId] || null : null,
      overlay: botOverlay(b),
    });
  }

  const revision = ((g.profile.link && g.profile.link.revision) || 0) + 1;
  const { portableSettings } = require("./profileFile");
  const manifest = buildManifestV2({
    profile: g.profile,
    owner: user,
    dashboards: out.dashboards,
    bots: out.bots,
    themes: out.themes,
    widgets,
    folders: g.folders || [],
    providers: g.providers || [],
    appSettings: g.settings ? portableSettings(g.settings) : null,
    secretsToEnter: g.secretsLeftOut || [],
    leftOut,
    revision,
    createdOn: computerName(),
    appVersion: d.appVersion(),
  });

  const counts = {
    dashboards: out.dashboards.length,
    bots: out.bots.length,
    themes: out.themes.length,
    widgets: Object.keys(widgets).length,
  };
  if (toAccount) {
    const account = d.account();
    const put = await account.putRemote(
      accountTarget.accountId,
      manifest,
      accountTarget.baseRevision,
    );
    if (!put.success) return { ...put, published };
    const link = account.setLink(appId, user, profileId, {
      accountId: accountTarget.accountId,
      revision: put.saved.revision,
      savedAt: put.saved.updatedAt || manifest.createdAt,
      updatedOn: put.saved.updatedOn || manifest.createdOn,
    });
    return {
      success: true,
      account: link,
      published,
      skipped: [...skipped],
      leftOut,
      counts,
      secretsLeftOut: (g.secretsLeftOut || []).length,
    };
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
    if (res.canceled || !res.filePath) {
      return { success: false, canceled: true, published };
    }
    filePath = res.filePath;
  }
  require("fs").writeFileSync(filePath, JSON.stringify(manifest, null, 2));

  if (g.explicit && typeof d.store.setLink === "function") {
    d.store.setLink(appId, profileId, {
      revision,
      savedAt: manifest.createdAt,
    });
  }
  return {
    success: true,
    filePath,
    revision,
    published,
    skipped: [...skipped],
    leftOut,
    counts,
    secretsLeftOut: (g.secretsLeftOut || []).length,
  };
}

function computerName() {
  return (
    String(require("os").hostname() || "").replace(/\.local$/i, "") || null
  );
}

module.exports = {
  planSave,
  executeSave,
  REFERENCE,
  PUBLISH,
  REMIX,
  LEAVE_OUT,
  WITH_DASHBOARD,
};
