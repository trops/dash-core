/**
 * askChecks — each wizard step checked before it's asked (the approved
 * "The build is held to your choices" frame 3): only what the provider
 * really has is offered, a setting is held to what its tool takes, and a
 * read that needs a tool that can change things is said at the question,
 * not found at the end. Pure: the provider's running tools (`live`, from
 * useLiveTools) are handed in.
 */
import { classifyTool } from "../../../utils/widgetEvents";
import { livePin } from "../../Create/planChecklist";
import {
  changeTools,
  kindsOf,
  readTools,
  readsFromLabel,
  settingLabel,
} from "./widgetSpec";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const liveList = (live) =>
  live && live.status === "live" && Array.isArray(live.tools)
    ? live.tools
    : null;
const toolNamed = (tools, name) =>
  (tools || []).find((t) => t && t.name === name) || null;

/** Lower-case words of a name: "daysAhead" / "days_ahead" → [days, ahead]. */
const words = (name) =>
  String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const sameName = (a, b) => words(a).join(" ") === words(b).join(" ");

/**
 * Whether one of its other providers (not the one asked) may have the
 * tool: its saved list names it, or doesn't say which it has.
 */
function elsewhere(piece, providers, live, tool) {
  return kindsOf(piece)
    .filter((k) => !live || k !== live.type)
    .map((k) => livePin(piece, k, providers))
    .filter(Boolean)
    .some((p) => {
      const saved = Array.isArray(p.allowedTools) ? p.allowedTools : [];
      return !saved.length || saved.map(String).includes(tool);
    });
}
const hasTool = (piece, providers, live, tool) =>
  !!toolNamed(liveList(live), tool) || elsewhere(piece, providers, live, tool);

/** Step 2's actions: only what the running provider has (or its list). */
export function offeredChanges(piece, providers, live) {
  const tools = liveList(live);
  return changeTools(
    piece,
    providers,
    tools ? { type: live.type, tools } : null,
  );
}

/**
 * The tools it reads with that the provider says can change things (or
 * doesn't say either way): the widget may call them only to read — said
 * at step 2, so it's never a surprise at the end.
 * @returns {Array<{ tool, kind: "change"|"unknown" }>}
 */
export function readNotice(piece, providers, live) {
  const tools = liveList(live);
  return readTools(piece, providers)
    .filter((t) => !tools || toolNamed(tools, t))
    .map((t) => ({ tool: t, kind: classifyTool(toolNamed(tools, t) || t) }))
    .filter((x) => x.kind !== "read");
}

/** The tools it reads with that the running provider doesn't have. */
export function missingReads(piece, providers, live) {
  if (!liveList(live)) return [];
  return readTools(piece, providers).filter(
    (t) => !hasTool(piece, providers, live, t),
  );
}

/**
 * What each setting may be, from the tools it reads with: a setting that
 * goes into one of their inputs (by name) takes what that input takes —
 * one of its choices, or a number from … to.
 * @returns {{ [key]: { options?: string[], min?: number, max?: number,
 *   tool: string, input: string } }}
 */
export function settingBounds(piece, providers, live) {
  const tools = liveList(live);
  const settings = isObj(piece && piece.settings) ? piece.settings : {};
  if (!tools) return {};
  const out = {};
  for (const name of readTools(piece, providers)) {
    const t = toolNamed(tools, name);
    const props =
      t && t.inputSchema && isObj(t.inputSchema.properties)
        ? t.inputSchema.properties
        : {};
    for (const key of Object.keys(settings)) {
      if (out[key]) continue;
      const input = Object.keys(props).find((p) => sameName(p, key));
      const p = input ? props[input] : null;
      if (!isObj(p)) continue;
      const b = { tool: name, input };
      if (Array.isArray(p.enum) && p.enum.length)
        b.options = p.enum.map(String);
      if (typeof p.minimum === "number") b.min = p.minimum;
      if (typeof p.maximum === "number") b.max = p.maximum;
      if (b.options || b.min !== undefined || b.max !== undefined) out[key] = b;
    }
  }
  return out;
}

/** "1 to 7", "at least 1", "one of …" — what a bound allows, in words. */
export function boundWords(b) {
  if (!b) return "";
  if (b.options) return `one of ${b.options.join(", ")}`;
  if (b.min !== undefined && b.max !== undefined) return `${b.min} to ${b.max}`;
  if (b.min !== undefined) return `at least ${b.min}`;
  return `at most ${b.max}`;
}

/** Why a value isn't one the setting's tool takes — or null. */
export function boundProblem(value, b) {
  if (!b) return null;
  const v = typeof value === "string" ? value.trim() : value;
  if (b.options) {
    return b.options.includes(String(v)) ? null : `Pick ${boundWords(b)}.`;
  }
  const n = Number(v);
  if (v === "" || v === null || v === undefined || !Number.isFinite(n)) {
    return `A number, ${boundWords(b)}.`;
  }
  if (
    (b.min !== undefined && n < b.min) ||
    (b.max !== undefined && n > b.max)
  ) {
    return `It takes ${boundWords(b)}.`;
  }
  return null;
}

/**
 * Before Yes, build it: the whole set, checked — a tool it reads or
 * changes with that the provider doesn't have, a setting it can't take.
 * @returns {Array<{ part, text }>}
 */
export function preflight(piece, providers, live) {
  const tools = liveList(live);
  if (!tools) return [];
  const from = readsFromLabel(piece, providers) || "Its provider";
  const out = [];
  const missing = missingReads(piece, providers, live);
  if (missing.length && missing.length === readTools(piece, providers).length) {
    out.push({
      part: "reads",
      text: `${from} has no ${missing.join(", ")} — ask the Planner to read with a tool it has.`,
    });
  }
  for (const t of Array.isArray(piece && piece.changes) ? piece.changes : []) {
    if (!hasTool(piece, providers, live, t)) {
      out.push({
        part: "acts",
        text: `${from} has no ${t} — untick it on step 2.`,
      });
    }
  }
  const bounds = settingBounds(piece, providers, live);
  const settings = isObj(piece && piece.settings) ? piece.settings : {};
  for (const [key, b] of Object.entries(bounds)) {
    const why = boundProblem(settings[key], b);
    if (why) {
      out.push({ part: "settings", text: `${settingLabel(key)}: ${why}` });
    }
  }
  return out;
}

/**
 * The side's "Checked before asking": what was checked for this step, one
 * row each — so every option on it is something the provider really does.
 * @returns {{ sub, rows: Array<{ ok, main, sub }> } | null}
 */
export function askRows(stage, piece, providers, live) {
  const from = readsFromLabel(piece, providers) || "Its provider";
  if (!live || live.status === "none") return null;
  if (live.status === "reading") {
    return {
      sub: `Checking what ${from} can do…`,
      rows: [{ ok: null, main: `Asking ${from} for its tools`, sub: "" }],
    };
  }
  if (live.status === "failed") {
    return {
      sub: `${from} didn't answer — its saved list is used`,
      rows: [
        { ok: false, main: `${from} didn't start`, sub: live.error || "" },
      ],
    };
  }
  const tools = liveList(live) || [];
  const rows = [
    {
      ok: true,
      main: `${from} is running`,
      sub: `${tools.length} tools, read just now`,
    },
  ];
  const reads = readTools(piece, providers);
  const missing = missingReads(piece, providers, live);
  const kept = reads.filter((t) => !missing.includes(t));
  if (kept.length) {
    rows.push({
      ok: true,
      main: `Reads with ${kept.join(", ")}`,
      sub: "a tool it really has",
    });
  }
  if (missing.length) {
    rows.push({
      ok: false,
      main: `No ${missing.join(", ")}`,
      sub: "not one of its tools — not offered",
    });
  }
  if (stage === "does" || stage === "review") {
    const acts = offeredChanges(piece, providers, live);
    rows.push({
      ok: true,
      main: acts.length
        ? `${acts.length} ${acts.length === 1 ? "action" : "actions"} offered`
        : "No actions to offer",
      sub: acts.length
        ? "each one a tool it really has"
        : "it has nothing that changes things",
    });
    for (const n of readNotice(piece, providers, live)) {
      rows.push({
        ok: true,
        main: `Reading needs ${n.tool}`,
        sub:
          n.kind === "change"
            ? "it can also change things — said on this step"
            : "it doesn't say whether it changes things — read only",
      });
    }
    const bounds = settingBounds(piece, providers, live);
    for (const [key, b] of Object.entries(bounds)) {
      rows.push({
        ok: true,
        main: `${settingLabel(key)}: ${boundWords(b)}`,
        sub: `what ${b.tool} takes`,
      });
    }
  }
  return { sub: "Every option here is something it really does", rows };
}
