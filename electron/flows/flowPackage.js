/**
 * flowPackage.js
 *
 * A flow as a registry package (flows PRD, phase 7; G18). A flow travels
 * with its bots, its checks and its own files:
 *
 *   flow.json   { schemaVersion, type: "flow", name, brief, maxRounds,
 *                 taskLimits, steps (bots by role), edges, team (its bots,
 *                 as a team manifest: providers by type), botExtras,
 *                 files: [refs], needs }
 *   files/…     scripts/, checks/, data/
 *
 * Never published: goals, runs, proof, bot memory, keys, folder paths and
 * files kept only on this computer — the publish lists what it left out.
 * A publish is refused while a key or token shows up in its files.
 *
 * On install, scripts from someone else are code: each is shown before the
 * flow can run (installApproved). An update lists what changes; changed
 * scripts need approving again; where you changed your copy you keep yours
 * or take theirs; goals already running finish on their version.
 *
 * Pure (NFR-006): decisions only; flowController reads files, zips and
 * talks to the registry.
 */
"use strict";

const crypto = require("crypto");
const {
  buildTeamManifest,
  validateTeamManifest,
} = require("../bots/teamManifest");
const { normalizeFlow, chain, STEP_KINDS } = require("./flowModel");
const { flowWarnings } = require("./flowWarnings");

const PACKAGE_TYPE_FLOW = "flow";
const SCHEMA_VERSION = 1;
const FILE_REF = /^(scripts|checks|data)\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 256 * 1024;

// What a key or token looks like in a file (publish is refused).
const SECRET_PATTERNS = [
  { label: "an Anthropic or OpenAI key", re: /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/ },
  {
    label: "a GitHub token",
    re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/,
  },
  { label: "a Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { label: "an AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "a private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "a Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    label: "a password or key written in",
    re: /\b(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i,
  },
];

const sha = (text) =>
  crypto
    .createHash("sha256")
    .update(String(text || ""), "utf8")
    .digest("hex");

/** Keys or tokens found in a text, by what they look like. */
function findSecrets(text) {
  const out = [];
  for (const p of SECRET_PATTERNS)
    if (p.re.test(String(text || ""))) out.push(p.label);
  return out;
}

/**
 * A flow as a package.
 * @param {{ flow: object, bots: object[], providers: object[],
 *           files: Array<{ ref: string, text: string }>, description?: string }} p
 * @returns {{ pkg: object, notIncluded: string[], secrets: Array<{ where, what }> }}
 */
function buildFlowPackage({
  flow,
  bots = [],
  providers = [],
  files = [],
  description = "",
}) {
  const f = normalizeFlow(flow);
  const used = new Set(f.steps.map((s) => s.botId).filter(Boolean));
  const own = bots.filter((b) => b && used.has(b.id));
  const { manifest: team, notIncluded } = buildTeamManifest({
    name: f.name,
    description,
    bots: own,
    providers,
  });
  // The role each bot got in the team manifest (same order as `own`).
  const roleOf = new Map(
    own.map((b, i) => [b.id, team.members[i] ? team.members[i].role : null]),
  );
  const botExtras = {};
  for (const b of own) {
    const role = roleOf.get(b.id);
    // What a team manifest doesn't carry: its shell commands and limits.
    if (role && (b.commands || b.runLimits)) {
      botExtras[role] = {
        ...(b.commands
          ? {
              commands: {
                allowed: (b.commands.allowed || []).map(String),
                blocked: (b.commands.blocked || []).map(String),
              },
            }
          : {}),
        ...(b.runLimits && Object.keys(b.runLimits).length
          ? { runLimits: { ...b.runLimits } }
          : {}),
      };
    }
    if (Array.isArray(b.projects) && b.projects.length) {
      notIncluded.push(
        `${b.name}: the folder it works in (${b.projects[0]}) — whoever installs it chooses their own`,
      );
    }
  }
  const secrets = [];
  const steps = f.steps.map((s) => {
    const out = { ...s };
    if (s.botId) {
      out.botRole = roleOf.get(s.botId) || null;
      delete out.botId;
    }
    if (s.kind === "check" && s.check) {
      const check = { ...s.check };
      if (
        check.localFile ||
        String(check.scriptFile || "").startsWith("local:")
      ) {
        const local = String(check.localFile || check.scriptFile).replace(
          /^local:/,
          "",
        );
        notIncluded.push(`${s.name}: ${local} (only on this computer)`);
        // Shown as missing anywhere else: its name, never its path.
        check.missing = local.split(/[\\/]/).pop();
        delete check.localFile;
        if (String(check.scriptFile || "").startsWith("local:"))
          delete check.scriptFile;
        if (check.kind === "command") check.command = "";
      }
      for (const what of findSecrets(JSON.stringify(check))) {
        secrets.push({ where: `${s.name}'s settings`, what });
      }
      out.check = check;
    }
    return out;
  });
  const kept = [];
  for (const file of files.slice(0, MAX_FILES)) {
    if (!file || !FILE_REF.test(file.ref || "")) continue;
    const text = String(file.text == null ? "" : file.text);
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) {
      notIncluded.push(`${file.ref} (too big to publish)`);
      continue;
    }
    for (const what of findSecrets(text))
      secrets.push({ where: file.ref, what });
    kept.push({ ref: file.ref, text });
  }
  for (const what of findSecrets(JSON.stringify(team))) {
    secrets.push({ where: "a bot's instructions", what });
  }
  const pkg = {
    schemaVersion: SCHEMA_VERSION,
    type: PACKAGE_TYPE_FLOW,
    name: f.name,
    brief: f.brief,
    description: String(description || ""),
    maxRounds: f.maxRounds,
    taskLimits: f.taskLimits || null,
    steps,
    edges: f.edges,
    criteria: f.criteria || [],
    team,
    botExtras,
    files: kept.map((x) => x.ref),
    needs: {
      providers: [
        ...new Set(
          team.members.flatMap((m) =>
            (m.embedded.providers || []).map((p) => p.type),
          ),
        ),
      ],
      folder: own.some(
        (b) => Array.isArray(b.projects) && b.projects.length > 0,
      ),
    },
  };
  notIncluded.unshift(
    "Its jobs, their runs and proof",
    "What its bots learned (memory)",
    "Keys and passwords",
  );
  return { pkg, files: kept, notIncluded, secrets };
}

/**
 * The checks shown before a publish (frame 33): every AI step checked,
 * no keys or tokens, checks can only read, scripts run sealed off.
 */
function publishChecks(pkg, secrets = []) {
  const flow = toFlowShape(pkg);
  const warnings = flowWarnings(flow, { botExists: () => true });
  const toolOk = (pkg.steps || []).every(
    (s) =>
      s.kind !== "check" ||
      !s.check ||
      s.check.kind !== "tool" ||
      !/(create|update|delete|merge|send|post|write)/i.test(s.check.tool || ""),
  );
  return [
    {
      ok: !warnings.some((w) => w.id.startsWith("unchecked:")),
      text: "Every AI step is checked by something",
    },
    {
      ok: secrets.length === 0,
      text: secrets.length
        ? `Keys or tokens found: ${secrets.map((s) => `${s.what} in ${s.where}`).join("; ")}`
        : "No keys or tokens found in the files",
    },
    { ok: toolOk, text: "Checks can only read" },
    { ok: true, text: "Scripts run sealed off" },
  ];
}

/** A package's steps as a flow (roles in place of bot ids), for checks. */
function toFlowShape(pkg) {
  return normalizeFlow({
    name: pkg.name,
    maxRounds: pkg.maxRounds,
    steps: (pkg.steps || []).map((s) => ({ ...s, botId: s.botRole || null })),
    edges: pkg.edges || [],
  });
}

/**
 * The manifest sent with the zip to the registry's /api/publish.
 * @param {object} pkg
 * @param {{ scope, name, displayName, version, description?, visibility?,
 *           appOrigin, author? }} meta
 */
function registryManifestForFlow(pkg, meta) {
  const order = chain(toFlowShape(pkg));
  // The registry wants keys that start with a letter ("step_6" → "s6").
  const keyOf = (s) => {
    const k =
      String(s.id || "")
        .replace(/^step_/, "")
        .replace(/[^A-Za-z0-9_-]/g, "") || "s";
    return /^[A-Za-z]/.test(k) ? k : `s${k}`;
  };
  return {
    scope: meta.scope,
    name: meta.name,
    displayName: meta.displayName,
    version: meta.version,
    description: meta.description || "",
    author: meta.author || "",
    appOrigin: meta.appOrigin,
    visibility: meta.visibility === "public" ? "public" : "private",
    type: PACKAGE_TYPE_FLOW,
    providerTypes: pkg.needs.providers,
    flow: {
      name: pkg.name,
      steps: order.map((s) => ({
        key: keyOf(s).replace(/[^A-Za-z0-9_-]/g, "") || "s",
        kind: s.kind,
        name: s.name,
      })),
      bots: pkg.team.members.length,
      checks: order.filter((s) => s.kind === "check").length,
      files: pkg.files,
      needs: pkg.needs,
    },
  };
}

/** The files in a published flow's zip. */
function publishFlowFiles(pkg, files, registryManifest) {
  return [
    { name: "manifest.json", text: JSON.stringify(registryManifest, null, 2) },
    { name: "flow.json", text: JSON.stringify(pkg, null, 2) },
    ...files.map((f) => ({ name: `files/${f.ref}`, text: f.text })),
  ];
}

/**
 * Read a downloaded flow package (its files by path).
 * @returns {{ pkg, team, files: Array<{ ref, text, hash }> } | { error, errors? }}
 */
function readFlowPackage(fileMap) {
  const entries = Object.entries(fileMap || {});
  const flowFile = entries.find(
    ([p]) => p === "flow.json" || p.endsWith("/flow.json"),
  );
  if (!flowFile) return { error: "The package has no flow.json." };
  let json;
  try {
    json = JSON.parse(flowFile[1]);
  } catch (_e) {
    return { error: "The flow's definition isn't valid JSON." };
  }
  if (!json || json.type !== PACKAGE_TYPE_FLOW || !Array.isArray(json.steps)) {
    return { error: "The package isn't a Dash flow." };
  }
  const steps = json.steps.filter((s) => s && STEP_KINDS.includes(s.kind));
  if (!steps.length) return { error: "The flow has no steps." };
  const t = validateTeamManifest(json.team);
  if (!t.valid)
    return { error: "The flow's bots aren't valid.", errors: t.errors };
  const roles = new Set(t.manifest.members.map((m) => m.role));
  for (const s of steps) {
    if (s.botRole && !roles.has(s.botRole)) {
      return {
        error: `Step "${s.name}" names a bot the package doesn't have.`,
      };
    }
  }
  const files = [];
  for (const [p, text] of entries) {
    const m = /(?:^|\/)files\/(.+)$/.exec(p);
    if (!m || !FILE_REF.test(m[1])) continue;
    files.push({ ref: m[1], text: String(text), hash: sha(text) });
  }
  // A package never points at a file on this computer: such a check comes
  // without its file, shown as missing.
  for (const s of steps) {
    if (!s.check) continue;
    const local =
      s.check.localFile ||
      (String(s.check.scriptFile || "").startsWith("local:")
        ? s.check.scriptFile
        : null);
    if (local) {
      s.check = {
        ...s.check,
        missing: String(local)
          .replace(/^local:/, "")
          .split(/[\\/]/)
          .pop(),
      };
      delete s.check.localFile;
      if (String(s.check.scriptFile || "").startsWith("local:"))
        delete s.check.scriptFile;
    }
  }
  const pkg = {
    ...json,
    steps,
    team: t.manifest,
    botExtras:
      json.botExtras && typeof json.botExtras === "object"
        ? json.botExtras
        : {},
  };
  return { pkg, team: t.manifest, files };
}

/** Scripts a check runs, from a package's files (shown before install). */
function scriptsToRead(pkg, files) {
  return whatRuns(pkg, files);
}

/**
 * Everything in a package that runs code or commands on this computer —
 * shown before install and approved again when it changes: its script
 * files, each command check's command, each inline script, and what each
 * bot may run without asking.
 * @returns {Array<{ ref, text, usedBy: string[] }>}
 */
function whatRuns(pkg, files) {
  const steps = (pkg && pkg.steps) || [];
  const usedBy = (needle) =>
    steps
      .filter((s) => s.check && JSON.stringify(s.check).includes(needle))
      .map((s) => s.name);
  const out = (files || [])
    .filter((f) => /^(scripts|checks)\//.test(f.ref))
    .map((f) => ({ ref: f.ref, text: f.text, usedBy: usedBy(f.ref) }));
  for (const s of steps) {
    const c = s.check || {};
    if (c.kind === "command" && String(c.command || "").trim()) {
      out.push({
        ref: `${s.name} · its command`,
        text: String(c.command),
        usedBy: [s.name],
      });
    }
    if (c.kind === "script" && String(c.script || "").trim() && !c.scriptFile) {
      out.push({
        ref: `${s.name} · its script`,
        text: String(c.script),
        usedBy: [s.name],
      });
    }
  }
  const names = Object.fromEntries(
    (((pkg && pkg.team) || {}).members || []).map((m) => [
      m.role,
      m.embedded.name,
    ]),
  );
  for (const [role, extra] of Object.entries((pkg && pkg.botExtras) || {})) {
    const allowed = (extra && extra.commands && extra.commands.allowed) || [];
    if (allowed.length) {
      out.push({
        ref: `${names[role] || role} · runs without asking`,
        text: allowed.join("\n"),
        usedBy: [names[role] || role],
      });
    }
  }
  return out;
}

/**
 * The flow an installed package makes, once its bots exist.
 * @param {Record<string, string>} botIdsByRole
 */
function installedFlow(pkg, botIdsByRole, workspaceId) {
  return normalizeFlow({
    workspaceId,
    name: pkg.name,
    brief: pkg.brief,
    maxRounds: pkg.maxRounds,
    taskLimits: pkg.taskLimits,
    criteria: pkg.criteria,
    steps: pkg.steps.map((s) => ({
      ...s,
      botId: s.botRole ? botIdsByRole[s.botRole] || null : null,
    })),
    edges: pkg.edges,
  });
}

/**
 * What an update changes (frame 35): steps added, removed and changed;
 * bots' instructions and limits; scripts (with their text); output fields;
 * what it needs. `base` is the version you installed, `mine` your copy now,
 * `theirs` the new version. Where you changed something they changed too,
 * it's a conflict: keep yours or take theirs.
 */
function compareVersions({
  base,
  mine,
  theirs,
  baseFiles = [],
  theirFiles = [],
  mineFiles = null,
}) {
  const changes = [];
  const conflicts = [];
  const byName = (list) => new Map((list || []).map((s) => [s.name, s]));
  const b = byName(base.steps);
  const m = byName(mine.steps);
  const t = byName(theirs.steps);
  for (const [name, s] of t) {
    if (!b.has(name)) {
      changes.push({
        kind: "add",
        text: `Adds a step: ${name}`,
        detail:
          s.kind === "check"
            ? `Code check · ${s.check ? s.check.kind : ""}`
            : s.kind === "bot"
              ? "AI"
              : s.kind,
      });
    }
  }
  for (const [name] of b) {
    if (!t.has(name))
      changes.push({ kind: "remove", text: `Removes the step ${name}` });
  }
  // Output fields.
  for (const [name, s] of t) {
    const was = b.get(name);
    if (!was) continue;
    const before = new Set((was.outputs || []).map((f) => f.name));
    const after = new Set((s.outputs || []).map((f) => f.name));
    for (const f of after)
      if (!before.has(f))
        changes.push({
          kind: "add",
          text: `Adds output field ${name}.${f}`,
          detail: "Nothing of yours uses a removed field",
        });
    for (const f of before)
      if (!after.has(f))
        changes.push({
          kind: "remove",
          text: `Removes output field ${name}.${f}`,
        });
    if (
      JSON.stringify(was.check || null) !== JSON.stringify(s.check || null) &&
      was.kind === "check"
    ) {
      changes.push({ kind: "change", text: `Changes ${name}'s check` });
    }
  }
  // Bots: instructions and limits, with your own edits.
  // A bot as compared: its embedded definition plus what travels beside it.
  const members = (pkg) =>
    new Map(
      (((pkg && pkg.team) || {}).members || []).map((x) => [
        x.role,
        { ...x.embedded, ...(((pkg && pkg.botExtras) || {})[x.role] || {}) },
      ]),
    );
  const bm = members(base);
  const tm = members(theirs);
  const mm = members(mine);
  for (const [role, e] of tm) {
    const was = bm.get(role);
    if (!was) {
      changes.push({ kind: "add", text: `Adds a bot: ${e.name}` });
      continue;
    }
    for (const field of ["instructions", "runLimits", "schedules", "model"]) {
      const theirsChanged =
        JSON.stringify(was[field] ?? null) !== JSON.stringify(e[field] ?? null);
      if (!theirsChanged) continue;
      const mineNow = mm.get(role);
      const mineChanged =
        mineNow &&
        JSON.stringify(was[field] ?? null) !==
          JSON.stringify(mineNow[field] ?? null);
      if (mineChanged) {
        conflicts.push({
          id: `${role}.${field}`,
          role,
          field,
          text: `You changed this too: ${e.name}'s ${fieldLabel(field)}`,
          mine: mineNow[field] ?? null,
          theirs: e[field] ?? null,
        });
      } else {
        changes.push({
          kind: "change",
          text: `Changes ${e.name}'s ${fieldLabel(field)}`,
          role,
          field,
        });
      }
    }
  }
  // Files, three ways: theirs changed it and so did you → keep yours or
  // take theirs.
  const bf = new Map(baseFiles.map((f) => [f.ref, f]));
  const mf = new Map((mineFiles || []).map((f) => [f.ref, f]));
  for (const f of theirFiles) {
    const was = bf.get(f.ref);
    if (!was) {
      changes.push({ kind: "add", text: `Adds ${f.ref}` });
    } else if (was.text !== f.text) {
      const mineNow = mf.get(f.ref);
      if (mineNow && mineNow.text !== was.text && mineNow.text !== f.text) {
        conflicts.push({
          id: `file:${f.ref}`,
          ref: f.ref,
          text: `You changed this too: ${f.ref}`,
          mine: "your edits",
          theirs: "their new version",
        });
      } else {
        changes.push({
          kind: "change",
          text: `Changes ${f.ref}`,
          detail: "Shown on the right",
        });
      }
    }
  }
  for (const f of baseFiles) {
    if (!theirFiles.some((x) => x.ref === f.ref))
      changes.push({ kind: "remove", text: `Removes ${f.ref}` });
  }
  // Your own steps: a step you added, removed or changed since you
  // installed it is a conflict — keep your steps, or take theirs.
  const stepsKey = (pkg) =>
    JSON.stringify(
      ((pkg && pkg.steps) || []).map((s) => [
        s.name,
        s.kind,
        s.check || null,
        s.action || null,
      ]),
    );
  if (
    stepsKey(mine) !== stepsKey(base) &&
    stepsKey(theirs) !== stepsKey(base)
  ) {
    conflicts.push({
      id: "flow:steps",
      text: "You changed its steps too",
      mine: "your steps",
      theirs: "their steps",
    });
  }
  // Everything that runs, before and after: approved again when changed.
  const ranBefore = new Map(
    whatRuns(base, baseFiles).map((x) => [x.ref, x.text]),
  );
  const scripts = [];
  for (const x of whatRuns(theirs, theirFiles)) {
    const before = ranBefore.get(x.ref);
    if (before === undefined || before !== x.text) {
      scripts.push({ ref: x.ref, before: before || "", after: x.text });
    }
  }
  // What it needs.
  const needBefore = new Set((base.needs && base.needs.providers) || []);
  const newNeeds = ((theirs.needs && theirs.needs.providers) || []).filter(
    (p) => !needBefore.has(p),
  );
  if (newNeeds.length)
    changes.push({ kind: "change", text: `Needs ${newNeeds.join(", ")}` });
  else
    changes.push({
      kind: "same",
      text: "Needs nothing new",
      detail: "Same providers, same folder",
    });
  return { changes, conflicts, scripts };
}

function fieldLabel(field) {
  return field === "runLimits"
    ? "time limit"
    : field === "instructions"
      ? "instructions"
      : field === "schedules"
        ? "schedule"
        : field;
}

/** The next version for a publish: a fix, a new feature, or a big change. */
function bumpVersion(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ""));
  if (!m) return "1.0.0";
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

module.exports = {
  PACKAGE_TYPE_FLOW,
  findSecrets,
  buildFlowPackage,
  publishChecks,
  registryManifestForFlow,
  publishFlowFiles,
  readFlowPackage,
  scriptsToRead,
  whatRuns,
  installedFlow,
  compareVersions,
  bumpVersion,
  sha,
};
