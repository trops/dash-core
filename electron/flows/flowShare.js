/**
 * flowShare.js
 *
 * Publish, install and update a flow (flows PRD, phase 7; frames 33–36).
 * What goes in a package and how versions compare is flowPackage.js; this
 * file does the steps around it — read the flow's bots and files, sign in,
 * zip and publish, download and verify, make the bots, write the files —
 * with everything outside it handed in, so it's tested without a registry.
 *
 *   publishPreview → publish        (frame 33)
 *   installPreview → install        (frame 34) — scripts read first
 *   checkUpdate / updatePreview → update / skipVersion   (frames 35–36)
 */
"use strict";

const {
  buildFlowPackage,
  publishChecks,
  registryManifestForFlow,
  publishFlowFiles,
  readFlowPackage,
  scriptsToRead,
  installedFlow,
  compareVersions,
  bumpVersion,
  sha,
} = require("./flowPackage");
const { planTeamInstall } = require("../bots/teamManifest");
const { chain } = require("./flowModel");

const PACKAGE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const toPackageName = (s) => {
  let n = String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!n) n = "my-flow";
  if (!/^[a-z]/.test(n)) n = `flow-${n}`;
  return n.slice(0, 50).replace(/-+$/, "");
};

/**
 * @param {{ store, goals: () => object, bots: object,
 *           identity: () => Promise<{signedIn, username?}>,
 *           publishZip: (files, manifest) => Promise<{success?, error?}>,
 *           download: (ref, opts) => Promise<{files, pkg}|{error}>,
 *           latest: (ref) => Promise<{version}|{error}>,
 *           appOrigin?: string, now?: () => number }} deps
 */
function createFlowShare(deps) {
  const { store, goals, bots } = deps;
  const now = deps.now || Date.now;
  const previews = new Map();
  const newPreviewId = () =>
    `fp_${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  function filesOf(flowId) {
    return store
      .listFiles(flowId)
      .map((f) => ({ ref: f.ref, text: store.readFile(flowId, f.ref) || "" }));
  }

  function packageOf(flow) {
    return buildFlowPackage({
      flow,
      bots: (bots.listBots(flow.workspaceId) || []).filter(Boolean),
      providers: bots.providers(),
      files: filesOf(flow.id),
    });
  }

  /** Goals in this flow that haven't finished. */
  function runningGoals(flow) {
    const g = goals();
    if (!g) return 0;
    return g
      .listGoals({ workspaceId: flow.workspaceId })
      .filter(
        (x) => x.flowId === flow.id && !["done", "closed"].includes(x.status),
      ).length;
  }

  // ---- publish (frame 33) -------------------------------------------------

  async function publishPreview(flowId) {
    const flow = store.get(flowId);
    if (!flow) return { error: "No such flow." };
    const id = await deps.identity();
    const built = packageOf(flow);
    const current = (flow.package && flow.package.version) || null;
    const order = chain(flow);
    return {
      ok: true,
      signedIn: !!id.signedIn,
      name:
        flow.package && flow.package.scope === id.username && flow.package.name
          ? `@${flow.package.scope}/${flow.package.name}`
          : id.username
            ? `@${id.username}/${toPackageName(flow.name)}`
            : toPackageName(flow.name),
      current,
      versions: {
        patch: current ? bumpVersion(current, "patch") : "1.0.0",
        minor: current ? bumpVersion(current, "minor") : "1.0.0",
        major: current ? bumpVersion(current, "major") : "1.0.0",
      },
      contents: {
        steps: order.map((s) => s.name),
        bots: built.pkg.team.members.map((m) => m.embedded.name),
        checks: order
          .filter((s) => s.kind === "check")
          .map((s) => `${s.name} (${s.check ? s.check.kind : "not set up"})`),
        files: built.pkg.files,
        outputs: order
          .filter((s) => (s.outputs || []).length)
          .map((s) => `${s.name}: ${s.outputs.map((f) => f.name).join(", ")}`),
        criteria: (flow.criteria || []).length,
      },
      needs: built.pkg.needs,
      leftOut: [
        ...built.notIncluded
          .slice(0, 1)
          .map(
            () =>
              `${runningGoals(flow) + doneGoals(flow)} goals, their runs and proof`,
          ),
        ...built.notIncluded.slice(1),
      ],
      checks: publishChecks(built.pkg, built.secrets),
      secrets: built.secrets,
    };
  }

  function doneGoals(flow) {
    const g = goals();
    if (!g) return 0;
    return g
      .listGoals({ workspaceId: flow.workspaceId })
      .filter(
        (x) => x.flowId === flow.id && ["done", "closed"].includes(x.status),
      ).length;
  }

  /**
   * @param {{ name: string, version: string, whatsNew?: string,
   *           visibility?: "public"|"private" }} opts
   */
  async function publish(flowId, opts = {}) {
    const flow = store.get(flowId);
    if (!flow) return { error: "No such flow." };
    const id = await deps.identity();
    if (!id.signedIn)
      return { error: "Sign in to the registry first (Settings › Account)." };
    const m = /^@([a-z0-9][a-z0-9-]*)\/([a-z0-9-]+)$/.exec(
      String(opts.name || ""),
    );
    const scope = m ? m[1] : id.username;
    const name = m ? m[2] : toPackageName(opts.name || flow.name);
    if (scope !== id.username)
      return { error: `You publish as @${id.username}.` };
    if (!PACKAGE_NAME_RE.test(name) || name.length < 2) {
      return {
        error: "The name must be lowercase letters, digits and dashes.",
      };
    }
    if (!/^\d+\.\d+\.\d+$/.test(String(opts.version || "")))
      return { error: "Choose the version." };
    const built = packageOf(flow);
    if (built.secrets.length) {
      return {
        error: `Not published: ${built.secrets.map((s) => `${s.what} in ${s.where}`).join("; ")}. Take it out and try again.`,
      };
    }
    const manifest = registryManifestForFlow(built.pkg, {
      scope,
      name,
      displayName: flow.name,
      version: opts.version,
      description: String(opts.whatsNew || flow.brief || "").slice(0, 500),
      author: id.displayName || id.username,
      appOrigin: deps.appOrigin || "@trops/dash-electron",
      visibility: opts.visibility,
    });
    const r = await deps.publishZip(
      publishFlowFiles(built.pkg, built.files, manifest),
      manifest,
    );
    if (!r || !r.success)
      return {
        error: (r && (r.error || r.message)) || "The registry didn't take it.",
      };
    store.update(flowId, {
      ...flow,
      package: {
        ...(flow.package || {}),
        scope,
        name,
        version: opts.version,
        publishedAt: now(),
        own: true,
        base: built.pkg,
        baseFiles: built.files.map((f) => ({ ref: f.ref, text: f.text })),
        approved: Object.fromEntries(
          built.files.map((f) => [f.ref, sha(f.text)]),
        ),
      },
      edited: false,
    });
    return { ok: true, package: `@${scope}/${name}`, version: opts.version };
  }

  // ---- install (frame 34) -------------------------------------------------

  async function installPreview(packageRef) {
    const d = await deps.download(packageRef, {
      types: ["flow"],
      withFiles: true,
    });
    if (d.error) return d;
    const read = readFlowPackage(d.files);
    if (read.error) return read;
    const previewId = newPreviewId();
    previews.set(previewId, { kind: "install", pkgMeta: d.pkg, read });
    const providers = bots.providers();
    return {
      ok: true,
      previewId,
      package: d.pkg,
      name: read.pkg.name,
      steps: read.pkg.steps.length,
      bots: read.team.members.map((x) => x.embedded.name),
      checks: read.pkg.steps.filter((s) => s.kind === "check").length,
      needs: {
        providers: (read.pkg.needs.providers || []).map((type) => ({
          type,
          options: providers.filter((p) => p.type === type).map((p) => p.name),
        })),
        folder: !!read.pkg.needs.folder,
      },
      // Everything that runs on this computer: read before Install.
      scripts: scriptsToRead(read.pkg, read.files),
    };
  }

  /**
   * @param {{ workspaceId, providers?: Record<type, name>, folder?: string,
   *           scriptsRead?: boolean }} choices
   */
  function install(previewId, choices = {}) {
    const p = previews.get(previewId);
    if (!p || p.kind !== "install")
      return { error: "That install has expired. Open it again." };
    const { read, pkgMeta } = p;
    if (choices.workspaceId == null || choices.workspaceId === "")
      return { error: "Choose the dashboard it goes on." };
    if (
      scriptsToRead(read.pkg, read.files).length &&
      choices.scriptsRead !== true
    ) {
      return {
        error: "Read its scripts first: they're code from someone else.",
      };
    }
    if (read.pkg.needs.folder && !choices.folder)
      return { error: "Choose the folder it works in." };
    const roleChoices = {};
    for (const m of read.team.members)
      roleChoices[m.role] = { ...(choices.providers || {}) };
    const plan = planTeamInstall(read.team, {
      workspaceId: String(choices.workspaceId),
      providers: bots.providers(),
      choices: roleChoices,
    });
    const made = {};
    const madeBots = [];
    try {
      for (const member of plan.members) {
        const extra = (read.pkg.botExtras || {})[member.role] || {};
        const usesFolder = read.pkg.steps.some(
          (s) => s.botRole === member.role && s.kind === "bot",
        );
        const saved = bots.saveBot({
          ...member.definition,
          ...(extra.commands ? { commands: extra.commands } : {}),
          ...(extra.runLimits ? { runLimits: extra.runLimits } : {}),
          ...(choices.folder && read.pkg.needs.folder && usesFolder
            ? { projects: [String(choices.folder)] }
            : {}),
        });
        if (saved && saved.id) {
          made[member.role] = saved.id;
          madeBots.push(saved.id);
          bots.resumeBot(saved.id);
        }
      }
    } catch (e) {
      for (const id of madeBots) {
        try {
          bots.deleteBot(id);
        } catch (_e) {
          // Best effort.
        }
      }
      return { error: (e && e.message) || String(e) };
    }
    const flow = installedFlow(read.pkg, made, String(choices.workspaceId));
    const r = store.create({
      ...flow,
      madeBots,
      package: {
        scope: pkgMeta.scope,
        name: pkgMeta.name,
        version: pkgMeta.version,
        installedAt: now(),
        own: false,
        roles: made,
        base: read.pkg,
        baseFiles: read.files.map((f) => ({ ref: f.ref, text: f.text })),
        approved: Object.fromEntries(read.files.map((f) => [f.ref, f.hash])),
      },
    });
    if (r.error) return r;
    for (const f of read.files) store.writeFile(r.flow.id, f.ref, f.text);
    previews.delete(previewId);
    return { ok: true, flow: r.flow, madeBots };
  }

  // ---- update (frames 35–36) ----------------------------------------------

  const refOf = (flow) =>
    flow.package && flow.package.name
      ? `${flow.package.scope ? `${flow.package.scope}/` : ""}${flow.package.name}`
      : null;

  /** Is there a newer version? (The Graph tab shows Update.) */
  async function checkUpdate(flowId) {
    const flow = store.get(flowId);
    if (!flow || !refOf(flow) || flow.package.own)
      return { ok: true, available: false };
    const l = await deps.latest(refOf(flow));
    if (!l || l.error) return { ok: true, available: false };
    const newer = compareSemver(l.version, flow.package.version) > 0;
    return {
      ok: true,
      available: newer && flow.package.skipped !== l.version,
      version: l.version,
      current: flow.package.version,
    };
  }

  async function updatePreview(flowId) {
    const flow = store.get(flowId);
    if (!flow || !refOf(flow))
      return { error: "This flow didn't come from the registry." };
    const d = await deps.download(refOf(flow), {
      types: ["flow"],
      withFiles: true,
    });
    if (d.error) return d;
    const read = readFlowPackage(d.files);
    if (read.error) return read;
    const mine = packageOf(flow);
    const roles = flow.package.roles || {};
    // Your bots, keyed by the package's roles (so "you changed this" lines up).
    const mineTeam = {
      members: Object.entries(roles)
        .map(([role, botId]) => {
          const b = bots.getBot(botId);
          return b
            ? {
                role,
                embedded: {
                  name: b.name,
                  instructions: b.instructions,
                  runLimits: b.runLimits,
                  schedules: b.schedules,
                  model: b.model,
                },
              }
            : null;
        })
        .filter(Boolean),
    };
    const cmp = compareVersions({
      base: flow.package.base || read.pkg,
      mine: { ...mine.pkg, team: mineTeam, botExtras: {} },
      theirs: read.pkg,
      baseFiles: flow.package.baseFiles || [],
      theirFiles: read.files,
      mineFiles: filesOf(flow.id),
    });
    const previewId = newPreviewId();
    previews.set(previewId, {
      kind: "update",
      flowId,
      pkgMeta: d.pkg,
      read,
      cmp,
    });
    return {
      ok: true,
      previewId,
      from: flow.package.version,
      to: d.pkg.version,
      package: `${flow.package.scope ? `@${flow.package.scope}/` : ""}${flow.package.name}`,
      whatsNew: (read.pkg.description || "").slice(0, 300),
      changes: cmp.changes,
      conflicts: cmp.conflicts,
      scripts: cmp.scripts,
      running: runningGoals(flow),
    };
  }

  /**
   * @param {{ keep?: Record<conflictId, "mine"|"theirs">,
   *           approveScripts?: boolean }} choices
   */
  function update(previewId, choices = {}) {
    const p = previews.get(previewId);
    if (!p || p.kind !== "update")
      return { error: "That update has expired. Open it again." };
    const flow = store.get(p.flowId);
    if (!flow) return { error: "No such flow." };
    const { read, cmp, pkgMeta } = p;
    if (cmp.scripts.length && choices.approveScripts !== true) {
      return {
        error: "Read the changed scripts first: they need your OK again.",
      };
    }
    const keep = choices.keep || {};
    const roles = { ...(flow.package.roles || {}) };
    // Bots: theirs, except where you chose to keep yours.
    for (const m of read.team.members) {
      const botId = roles[m.role];
      const extra = (read.pkg.botExtras || {})[m.role] || {};
      if (botId && bots.getBot(botId)) {
        const patch = {
          id: botId,
          name: m.embedded.name,
          instructions: m.embedded.instructions,
          schedules: (m.embedded.schedules || []).map((s) => ({
            cron: s.cron,
            prompt: s.prompt,
          })),
          ...(extra.runLimits ? { runLimits: extra.runLimits } : {}),
          ...(extra.commands ? { commands: extra.commands } : {}),
        };
        for (const c of cmp.conflicts) {
          if (c.role !== m.role || keep[c.id] !== "mine") continue;
          delete patch[c.field];
        }
        bots.saveBot(patch);
      } else {
        const plan = planTeamInstall(
          { ...read.team, members: [m], wiring: [] },
          {
            workspaceId: flow.workspaceId,
            providers: bots.providers(),
            choices: {},
          },
        );
        const saved = bots.saveBot({
          ...plan.members[0].definition,
          ...(extra.commands ? { commands: extra.commands } : {}),
        });
        if (saved && saved.id) {
          roles[m.role] = saved.id;
          bots.resumeBot(saved.id);
        }
      }
    }
    const theirsFlow = installedFlow(read.pkg, roles, flow.workspaceId);
    // Your own steps, when you chose to keep them.
    const next =
      keep["flow:steps"] === "mine"
        ? { ...theirsFlow, steps: flow.steps, edges: flow.edges }
        : theirsFlow;
    // Files: theirs replace the package's, except ones you chose to keep;
    // yours that the package never had stay.
    for (const f of read.files) {
      if (keep[`file:${f.ref}`] === "mine") continue;
      store.writeFile(flow.id, f.ref, f.text);
    }
    const r = store.update(flow.id, {
      ...flow,
      ...next,
      package: {
        ...flow.package,
        version: pkgMeta.version,
        updatedAt: now(),
        roles,
        base: read.pkg,
        baseFiles: read.files.map((f) => ({ ref: f.ref, text: f.text })),
        approved: Object.fromEntries(read.files.map((f) => [f.ref, f.hash])),
        skipped: null,
      },
      edited: false,
    });
    previews.delete(previewId);
    return r.error ? r : { ok: true, flow: r.flow };
  }

  function skipVersion(flowId, version) {
    const flow = store.get(flowId);
    if (!flow || !flow.package) return { error: "No such flow." };
    const r = store.update(flowId, {
      ...flow,
      package: { ...flow.package, skipped: String(version) },
    });
    return r.error ? r : { ok: true };
  }

  return {
    publishPreview,
    publish,
    installPreview,
    install,
    checkUpdate,
    updatePreview,
    update,
    skipVersion,
  };
}

function compareSemver(a, b) {
  const pa = String(a || "0.0.0")
    .split(/[.-]/)
    .map(Number);
  const pb = String(b || "0.0.0")
    .split(/[.-]/)
    .map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

module.exports = { createFlowShare, toPackageName, compareSemver };
