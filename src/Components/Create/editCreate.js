/**
 * editCreate.js — Create › Change <widget> (consolidation Phase 3): a change
 * to one widget the user has, through the Dash team. The Scout says what it
 * does now, the Planner plans the change, the Builder writes it into a
 * draft, the Checker checks it, and the user previews it before anything
 * is installed — in place (their own widget) or as a new widget.
 *
 * What's shown about the widget comes from Dash (its config, where it's
 * used), never from what a model said.
 */

import { normalizeUserConfig } from "../../utils/userConfigFields";

export const EDIT_STEPS = ["Describe", "Plan", "Build", "Preview", "Done"];

/**
 * Where a change is: 0 Describe, 1 Plan (the Planner), 2 Build (Builder,
 * Checker), 3 Preview (waiting for the user), 4 Done.
 */
export function editStepIndex({ plan, buildStatus, done }) {
  if (done || buildStatus === "done") return 4;
  if (buildStatus === "waiting-for-you") return 3;
  if (buildStatus) return 2;
  if (plan) return 1;
  return 0;
}

// A copy of electron/bots/editTarget.js's holdsComponent — keep the two the
// same (editTarget.parity.test.js checks).
/**
 * Does this installed package hold the component ("jg.inbox.Inbox")? The
 * registry lists components by their bare names ("Inbox"), so the package
 * must also be that id's scope/package ("@jg/inbox", or "inbox" as a
 * registry package is kept).
 */
export function holdsComponent(w, component) {
  if (!w || typeof component !== "string") return false;
  const names = [
    ...(Array.isArray(w.componentNames) ? w.componentNames : []),
    ...(Array.isArray(w.widgets) ? w.widgets : []).map((x) => x && x.name),
  ];
  if (names.includes(component)) return true;
  const parts = component.split(".");
  if (parts.length < 3 || !names.includes(parts[parts.length - 1])) {
    return false;
  }
  const pkg = String(w.packageId || w.name || "")
    .toLowerCase()
    .replace(/^@/, "");
  return (
    pkg === `${parts[0]}/${parts[1]}`.toLowerCase() ||
    pkg === parts[1].toLowerCase()
  );
}

/**
 * Why a change can't go in place ("<name> <reason>"), or null: the package has no registry
 * name (an unscoped "inbox" — whose it is can't be told), or it's an
 * AI-built package holding more than this widget (@ai-built/<name> is
 * replaced whole). Ownership is checked separately (ownsWidget).
 * A copy of electron/bots/editTarget.js's — keep the two the same
 * (editTarget.parity.test.js checks).
 */
export function inPlaceProblem({ package: pkg, componentName }) {
  const name = String(componentName || "");
  const p = String(pkg || "");
  const scope = (/^@([^/]+)\//.exec(p) || /^([^/@]+)\//.exec(p) || [])[1];
  if (!scope) {
    return "has no registry name";
  }
  if (
    scope.toLowerCase() === "ai-built" &&
    p.toLowerCase() !== `@ai-built/${name.toLowerCase()}`
  ) {
    return "shares its package with other widgets";
  }
  return null;
}

/**
 * The component id ("jg.inbox.Inbox") a door named: as given when an
 * installed package holds it, else — a bare name from an older door — the
 * one in the package that has it (the door's package first). null when it
 * isn't installed.
 * @param {Array<{ name, packageId?, componentNames?, widgets? }>} installed
 *   widgets.list()
 */
export function resolveEditComponent(name, sourcePackage, installed) {
  const want = String(name || "").trim();
  if (!want) return null;
  const list = (Array.isArray(installed) ? installed : []).filter(Boolean);
  if (want.split(".").length >= 3) {
    return list.some((w) => holdsComponent(w, want)) ? want : null;
  }
  const norm = (p) =>
    String(p || "")
      .toLowerCase()
      .replace(/^@/, "");
  const holders = list.filter((w) =>
    [
      ...(w.componentNames || []),
      ...(w.widgets || []).map((x) => x && x.name),
    ].includes(want),
  );
  const pick =
    holders.find(
      (w) =>
        sourcePackage &&
        [norm(w.packageId), norm(w.name)].includes(norm(sourcePackage)),
    ) || holders[0];
  const scoped = pick
    ? /^@?([^/]+)\/(.+)$/.exec(String(pick.packageId || pick.name || ""))
    : null;
  return scoped ? `${scoped[1]}.${scoped[2]}.${want}` : null;
}

/** "Max messages (20)" — a setting's label and its value. */
function settingLine(key, field, value) {
  const label = (field && (field.displayName || field.label)) || key;
  const v =
    value === undefined || value === null || value === ""
      ? field && field.defaultValue
      : value;
  if (v === undefined || v === null || v === "") return label;
  if (typeof v === "boolean") return `${label} (${v ? "on" : "off"})`;
  const text = typeof v === "object" ? "…" : String(v);
  return `${label} (${text.length > 24 ? `${text.slice(0, 23)}…` : text})`;
}

/**
 * What Dash knows about the widget, for the Describe card: { settings,
 * uses, sends } — each a list of short lines. Settings and connections are
 * this cell's when the change came from one.
 * @param {object|null} config  ComponentManager.config(component)
 * @param {{ settings?: object, providers?: object }} [cell]
 */
export function widgetFacts(
  config,
  { settings = null, providers = null } = {},
) {
  const c = config || {};
  const userConfig = normalizeUserConfig(c.userConfig);
  const chosen = providers && typeof providers === "object" ? providers : {};
  return {
    settings: Object.entries(userConfig).map(([key, field]) =>
      settingLine(key, field, settings ? settings[key] : undefined),
    ),
    uses: (Array.isArray(c.providers) ? c.providers : [])
      .filter((p) => p && p.type)
      .map((p) =>
        chosen[p.type] ? `${p.type} — here: ${chosen[p.type]}` : p.type,
      ),
    sends: (Array.isArray(c.events) ? c.events : [])
      .map((e) => (typeof e === "string" ? e : e && e.name))
      .filter(Boolean),
  };
}

/** Every widget item on a dashboard: its pages' (else its layout) and sidebar. */
function itemsOf(ws) {
  const pages = Array.isArray(ws && ws.pages) ? ws.pages : [];
  return [
    ...(pages.length
      ? pages.flatMap((p) => (p && p.layout) || [])
      : (ws && ws.layout) || []),
    ...((ws && ws.sidebarLayout) || []),
  ];
}

/** The names of the dashboards that use this component, once each. */
export function widgetUsage(workspaces, component) {
  if (!component) return [];
  return (Array.isArray(workspaces) ? workspaces : [])
    .filter((ws) => itemsOf(ws).some((i) => i && i.component === component))
    .map((ws) => ws.name || ws.label || `Dashboard ${ws.id}`)
    .filter((n, i, all) => all.indexOf(n) === i);
}

/** "Morning Brief and Sales" · "3 dashboards" */
export function usageText(names) {
  if (!names.length) return "";
  if (names.length > 3) return `${names.length} dashboards`;
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : names[0];
}

/** The Scout's request: what the widget does now, in plain words. */
export function researchRequest(target) {
  return `What does the user's widget ${target.componentName} do now? They want to change it. Read it with read_widget (name "${target.package}", component "${target.componentName}") and any of its package's files it imports, then say in two or three plain sentences what it shows, what the user can do with it, and what it sends to other widgets. Don't search the library, list matches, or say how to change it.`;
}

/**
 * The Planner's request for a change: what the user asked, which widget,
 * where the change goes, and (from the error box) what went wrong.
 */
export function editPlanRequest(
  prompt,
  target,
  mode,
  { error = "", usedOn = [] } = {},
) {
  const where =
    mode === "update"
      ? `The change goes into ${target.componentName} itself (in place)${
          usedOn.length ? `, which is on ${usageText(usedOn)}` : ""
        }: its piece is source "update" with package "${target.package}" and the name "${target.componentName}".`
      : `The change is saved as a new widget — ${target.componentName} stays as it is: its piece is source "new" with a new name.`;
  return [
    prompt,
    "",
    `(A change to one widget the user has: ${target.componentName} — package ${target.package}, component ${target.component}. ${where} Plan only that widget — no other widgets, bots, theme, layout or dashboard. Read it with read_widget first, and say what the change adds and what it keeps.${
      error
        ? ` It stopped working with this error, quoted from the app: ${JSON.stringify(
            String(error).replace(/\s+/g, " ").trim().slice(0, 400),
          )}.`
        : ""
    })`,
  ].join("\n");
}

/**
 * The plan held to the change (as the main process holds it): its one
 * widget piece is that package as an update, or a new widget — and it names
 * no dashboard (the Planner sometimes sets the one the widget is on).
 */
export function forEdit(plan, target, mode) {
  if (!plan || !Array.isArray(plan.pieces)) return plan;
  let seen = false;
  // A change goes to a widget, never to a dashboard.
  const { dashboard: _dashboard, ...rest } = plan;
  return {
    ...rest,
    pieces: plan.pieces.map((p) => {
      if (!p || p.kind !== "widget" || seen) return p;
      seen = true;
      if (mode === "update") {
        return {
          ...p,
          source: "update",
          package: target.package,
          name: p.name || target.displayName || target.componentName,
        };
      }
      const { package: _pkg, ...rest } = p;
      return { ...rest, source: "new" };
    }),
  };
}

/**
 * The lines that changed between two texts, with a little context:
 * [{ type: "same" | "add" | "del" | "gap", text }]. Longest common
 * subsequence, line by line — fine for one widget's files.
 */
export function lineDiff(before, after, context = 2) {
  const a = String(before || "").split("\n");
  const b = String(after || "").split("\n");
  // Too big to compare line by line: say so rather than hang.
  if (a.length * b.length > 4000000) {
    return [{ type: "gap", text: "Too long to compare here — see Code." }];
  }
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const all = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      all.push({ type: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      all.push({ type: "del", text: a[i] });
      i += 1;
    } else {
      all.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < n) all.push({ type: "del", text: a[i++] });
  while (j < m) all.push({ type: "add", text: b[j++] });
  // Keep changed lines and `context` lines around them; the rest is a gap.
  const keep = all.map((l, k) =>
    all
      .slice(Math.max(0, k - context), k + context + 1)
      .some((x) => x.type !== "same"),
  );
  const out = [];
  all.forEach((l, k) => {
    if (keep[k]) out.push(l);
    else if (!out.length || out[out.length - 1].type !== "gap") {
      out.push({ type: "gap", text: "…" });
    }
  });
  return out;
}
