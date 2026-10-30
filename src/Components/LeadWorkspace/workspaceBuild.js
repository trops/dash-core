/**
 * workspaceBuild.js — a plan built in its lead workspace conversation
 * (lead-workspace release 3b, frames 3, 4, 7, 8, 31, 33): what kind of build
 * a plan gets, and the build's state in words — the plan's line, the Build
 * log, the Check report, the Builder's and Checker's rows, and what the
 * lead says in the chat. The lead's words come from the build's state: no
 * AI call per update. Pure.
 */
import { formatTokens } from "../../utils/runCostLabel";
import { providerLabel } from "../Create/planChecklist";
import { planTarget } from "../../utils/teamPlan";
import { isSettingsChange } from "./workspacePlan";

const pieces = (plan) =>
  ((plan && Array.isArray(plan.pieces) && plan.pieces) || []).filter(Boolean);

/**
 * The build a plan gets: one new widget and nothing else → "widget" (built
 * like Create's widget on its own: you look at it before it's installed);
 * one bot and nothing else → "bot"; anything else → "dashboard". A plan
 * for an empty cell (release 6c) → "cell": previewed, then the editor
 * places it.
 */
export function buildKind(plan) {
  if (plan && plan.cell) return "cell";
  // A change to one widget (release 6c): only its settings, or what it does.
  if (plan && plan.widgetChange)
    return isSettingsChange(plan) ? "settings" : "edit";
  const all = pieces(plan);
  const layout = all.some((p) => p.kind === "layout");
  const widgets = all.filter((p) => p.kind === "widget");
  const bots = all.filter((p) => p.kind === "bot");
  const target = !!planTarget(plan);
  if (!layout && !target && widgets.length === 1 && !bots.length)
    return "widget";
  if (!layout && !widgets.length && bots.length === 1) return "bot";
  return "dashboard";
}

/**
 * startPlanBuild's options for a kind of build — a change to one widget
 * (release 6c) says which, from the plan's `widgetChange`.
 */
export function buildOptions(kind, plan = null) {
  const w = (plan && plan.widgetChange) || null;
  if (kind === "settings" && w) {
    return {
      settings: {
        workspaceId: w.workspaceId,
        itemId: w.itemId,
        pageId: w.pageId ?? null,
        scope: w.scope || "main",
        component: w.component,
        displayName: w.displayName || "",
      },
    };
  }
  if (kind === "edit" && w) {
    return {
      edit: {
        component: w.component,
        mode: w.mode,
        displayName: w.displayName || "",
        settings: w.settingsNow || null,
        providers: w.providers || null,
      },
    };
  }
  if (kind === "widget") return { cell: true, standalone: true };
  if (kind === "cell") return { cell: true };
  if (kind === "bot") return { bot: true };
  return {};
}

/**
 * Which piece a step is about, so leaving a failed piece off takes its other
 * steps with it: "piece:<i>", "bot:<i>", or the step's own id.
 */
export function pieceKey(step) {
  if (!step) return "";
  if (step.piece != null) return `piece:${step.piece}`;
  if (step.bot != null) return `bot:${step.bot}`;
  return String(step.id || "");
}

const stepsOf = (state) =>
  (state && Array.isArray(state.steps) && state.steps) || [];
const BAD = new Set(["failed", "skipped"]);

/** A failed or skipped step the user chose to leave off. */
export function isLeftOff(step, leftOff = []) {
  return BAD.has(step && step.status) && leftOff.includes(pieceKey(step));
}

/** The steps that failed and weren't left off — the first is the one asked about. */
export function failedSteps(state, leftOff = []) {
  return stepsOf(state).filter(
    (s) => s.status === "failed" && !isLeftOff(s, leftOff),
  );
}

/** The providers waiting steps need, once each. */
export function waitingFor(state) {
  const out = [];
  for (const s of stepsOf(state)) {
    if (s.status !== "needs-provider") continue;
    for (const p of s.waitingFor || []) if (!out.includes(p)) out.push(p);
  }
  return out;
}

const andList = (names) =>
  names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : names[0] || "";

/**
 * The build's status with what was left off taken into account: a build
 * whose only problems were left off is built.
 */
export function buildStatus(state, leftOff = []) {
  const status = (state && state.status) || "waiting";
  if (status !== "finished-with-problems" || !leftOff.length) return status;
  // Every failure left off: what was skipped because of them goes too.
  if (failedSteps(state, leftOff).length) return status;
  return waitingFor(state).length ? "waiting-for-providers" : "done";
}

/** A build that's still going (or stopping). */
export function isBuilding(state) {
  const s = state && state.status;
  return s === "waiting" || s === "running";
}

/** The names of the pieces left off: "Camera strip". */
function leftOffNames(state, leftOff) {
  const names = [];
  for (const s of stepsOf(state)) {
    if (!isLeftOff(s, leftOff)) continue;
    const name = String(s.label || "").replace(
      /^(Build|Check|Install|Place|Save the|Save)\s+/,
      "",
    );
    if (name && !names.includes(name)) names.push(name.replace(/ bot$/, ""));
  }
  return names;
}

/**
 * The plan output's line while and after it builds (frames 3, 8, 33):
 * "Building · 2 of 5 done", "Built", "3 of 5 done · 1 failed · 1 waiting".
 */
export function buildPlanLine(state, leftOff = []) {
  const steps = stepsOf(state);
  const done = steps.filter((s) => s.status === "done").length;
  const total = steps.length;
  const of = `${done} of ${total} done`;
  const status = buildStatus(state, leftOff);
  const off = leftOffNames(state, leftOff);
  const offLine = off.length ? ` · ${andList(off)} left off` : "";
  switch (status) {
    case "waiting":
    case "running":
      return `Building · ${of}`;
    case "done":
      return `Built${offLine}`;
    case "waiting-for-you":
      return "Ready for you to look at";
    case "waiting-for-providers":
      return `Built · waiting for ${andList(waitingFor(state).map(providerLabel))}${offLine}`;
    case "finished-with-problems": {
      const failed = failedSteps(state, leftOff).length;
      const waiting = steps.filter((s) => s.status === "needs-provider").length;
      return [
        of,
        failed ? `${failed} failed` : null,
        waiting ? `${waiting} waiting` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "stopped":
      return `Stopped · ${of}`;
    case "interrupted":
      return `Interrupted · ${of}`;
    case "removed":
      return "Removed";
    default:
      return of;
  }
}

/** "21:15" — a step's time in the Build log. */
export function logTime(at) {
  const d = new Date(at);
  if (!at || Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "The checklist passed. check_widget saw…" → "The checklist passed." */
const firstSentence = (t) => {
  const m = /^.*?[.!?](\s|$)/.exec(String(t || ""));
  return (m ? m[0] : String(t || "")).trim();
};

const firstLine = (t) =>
  String(t || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) || "";

/**
 * The Build log (frame 4): a row per step that has started — its time and
 * what happened. tone: "bad" (failed), "warn" (waiting, stopped, left
 * off), or "" .
 */
export function buildLogRows(state, leftOff = []) {
  return stepsOf(state)
    .filter((s) => s.status !== "waiting")
    .map((s) => {
      const time = logTime(s.finishedAt || s.startedAt);
      if (isLeftOff(s, leftOff))
        return { time, text: `${s.label} — left off`, tone: "warn" };
      switch (s.status) {
        case "running":
          return { time, text: `${s.label}…`, tone: "" };
        case "failed":
          return {
            time,
            text: `${s.label} — ${firstLine(s.error) || "it didn't work"}`,
            tone: "bad",
          };
        case "skipped":
          return {
            time,
            text: `${s.label} — skipped: ${firstLine(s.error)}`,
            tone: "warn",
          };
        case "needs-provider":
          return {
            time,
            text: `${s.label} — waiting for ${andList((s.waitingFor || []).map(providerLabel))}`,
            tone: "warn",
          };
        case "needs-you":
          return { time, text: `${s.label} — waiting for you`, tone: "warn" };
        case "stopped":
          return { time, text: `${s.label} — stopped`, tone: "warn" };
        default:
          // The step in words — its detail is often an id (a draft, a package).
          return { time, text: s.label, tone: "" };
      }
    });
}

/** "Finished in 6 min" · "In progress" · "Stopped on 1 step" (frame 4). */
export function buildLogLine(state, leftOff = []) {
  const status = buildStatus(state, leftOff);
  if (isBuilding(state)) return "In progress";
  const failed = failedSteps(state, leftOff).length;
  if (failed)
    return `Stopped on ${failed === 1 ? "1 step" : `${failed} steps`}`;
  if (status === "stopped") return "Stopped";
  const start = Date.parse(state && state.startedAt);
  const end = Date.parse(state && state.finishedAt);
  if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
    const min = Math.max(1, Math.round((end - start) / 60000));
    return `Finished in ${min} min`;
  }
  return "Finished";
}

const nameOf = (label, verb) =>
  String(label || "").replace(new RegExp(`^${verb}\\s+`), "");

/**
 * The Check report (frame 7): a row per widget the Checker looked at —
 * passed, or what it found.
 */
export function checkRows(state) {
  return stepsOf(state)
    .filter((s) => s.kind === "check" && s.status !== "waiting")
    .map((s) => {
      const name = nameOf(s.label, "Check");
      if (s.status === "done")
        return {
          ok: true,
          main: `${name} — passed`,
          // The Checker's words, without a leading "Passed." (the row says it).
          sub: firstSentence(
            firstLine(s.detail).replace(/^(verdict:\s*)?passed[.:!]?\s*/i, ""),
          ),
        };
      if (s.status === "failed")
        return {
          ok: false,
          main: `${name} — didn't pass`,
          sub: firstLine(s.detail || s.error),
        };
      if (s.status === "running")
        return { ok: null, main: `${name} — checking…`, sub: "" };
      return {
        ok: null,
        main: `${name} — not checked`,
        sub: firstLine(s.error),
      };
    });
}

/** "2 new widgets checked" — the report's line. */
export function checkLine(state) {
  const n = stepsOf(state).filter(
    (s) => s.kind === "check" && s.status !== "waiting",
  ).length;
  return n === 1 ? "1 new widget checked" : `${n} new widgets checked`;
}

const tokensOf = (steps) =>
  steps.reduce((sum, s) => sum + (Number(s.tokens) || 0), 0);
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * The Builder's and the Checker's rows while it builds and after (frames 3,
 * 8, 31, 33): { tone, state, line, out? } — or null for a role the build
 * didn't use and won't. `lines` are the live lines by role. `out`: what
 * its row opens — "preview" (frame 31), or false while there's nothing to
 * open yet; otherwise the role's own output.
 */
export function buildMemberState(role, state, leftOff = [], lines = {}) {
  const steps = stepsOf(state).filter((s) => s.role === role);
  if (!steps.length) return null;
  // A preview waiting for your look (frame 31).
  const look = stepsOf(state).find(
    (s) => s.kind === "preview" && s.status === "needs-you",
  );
  if (role === "builder" && look)
    return {
      tone: "idle",
      state: "waiting for you",
      line: `${String(look.label).replace(/^Preview /, "")} built — waiting for your look`,
      out: "preview",
    };
  // The Checker's report has something in it once a check has run.
  const started = steps.some(
    (s) =>
      s.status !== "waiting" &&
      s.status !== "stopped" &&
      s.status !== "skipped",
  );
  const out = role === "checker" && !started ? { out: false } : {};
  const used = tokensOf(steps);
  const spent = used ? ` · ${formatTokens(used)} tokens` : "";
  const running = steps.find((s) => s.status === "running");
  if (running)
    return {
      tone: "working",
      state: "working",
      line: lines[role] || `› ${running.label}`,
      ...out,
    };
  const failed = steps.find(
    (s) => s.status === "failed" && !isLeftOff(s, leftOff),
  );
  if (failed)
    return {
      tone: "bad",
      state: "failed",
      line: `${role === "checker" ? nameOf(failed.label, "Check") : nameOf(failed.label, "Build")} — ${firstLine(role === "checker" ? failed.detail || failed.error : failed.error) || "it didn't work"}`,
    };
  const done = steps.filter((s) => s.status === "done");
  if (role === "builder") {
    if (done.length === steps.length)
      return {
        tone: "ok",
        state: `done${spent}`,
        line: `built ${plural(done.length, "widget")}`,
      };
    if (isBuilding(state))
      return {
        tone: "idle",
        state: "waiting",
        line: done.length ? `built ${done.length} so far` : "builds next",
      };
    return {
      tone: "idle",
      state: done.length ? `done${spent}` : "stopped",
      line: done.length ? `built ${plural(done.length, "widget")}` : "",
    };
  }
  const passed = done.length;
  // What it really looked at — a check that was stopped or skipped wasn't.
  const looked = steps.filter(
    (s) => s.status === "done" || s.status === "failed",
  ).length;
  if (passed === steps.length)
    return {
      tone: "ok",
      state: `done${spent}`,
      line: `passed ${passed} of ${steps.length}`,
    };
  if (!isBuilding(state) && !looked)
    return {
      tone: "idle",
      state:
        state.status === "stopped" || state.status === "interrupted"
          ? "stopped"
          : "not needed",
      line: "",
      ...out,
    };
  if (isBuilding(state) || !looked)
    return {
      tone: "idle",
      state: "waiting",
      line: passed ? `passed ${passed} so far` : "checks them next",
      ...out,
    };
  return {
    tone: "idle",
    state: `done${spent}`,
    line: `passed ${passed} of ${steps.length}`,
  };
}

/** "the Builder is building 2 widgets" — what's going on, for the reply box. */
export function workingLine(state) {
  const steps = stepsOf(state);
  const running = steps.find((s) => s.status === "running");
  if (!running) return "The team is working";
  if (running.role === "builder") {
    const n = steps.filter((s) => s.kind === "build").length;
    return `The team is working · the Builder is building ${plural(n, "widget")}`;
  }
  if (running.role === "checker")
    return `The team is working · the Checker is checking ${nameOf(running.label, "Check")}`;
  return `The team is working · ${running.label}`;
}

/**
 * The build in the chat (frames 3, 8, 31, 33): a step line, an output card,
 * the lead's words, and the reply choices.
 *   step: { label, status: "asking" | "done" | "failed" | "stopped" }
 *   card: { kind: "dashboard" | "widget" | "bot", title, sub } | null
 *   reply: the lead's words
 *   choices: "open" | "failed" | "preview" | "continue" | "again" | null
 *   continueLabel: Carry on building, or Start it again (nothing built yet)
 *   failed: the step asked about (choices "failed")
 * A cell build (release 6c): `cell` { dashboardName, placed, canPlace } —
 * placed: true (in the cell, unsaved; choices "place-again"), "placing", a
 * reason it didn't go in ("preview", "no-answer", "taken", "gone",
 * "unknown-widget", "failed"), or unknown (a reopened one): choices "place"
 * where it can still go in.
 * A change to one widget (release 6c): kind "settings" (set on that copy)
 * or "edit" (built, previewed, then saved) — `change` { displayName, mode,
 * dashboardName, onDashboard, settingLabels, placed, canPlace }: placed as
 * a cell build's, for a new widget taking that copy's place.
 */
export function buildChat(state, opts = {}) {
  const chat = chatFor(state, opts);
  // Nothing runs a build saved before Dash last closed (or carried on from
  // the Create window, release 6c): what it waits on starts it again.
  if (
    opts.restored &&
    (chat.choices === "failed" ||
      chat.choices === "preview" ||
      buildStatus(state, opts.leftOff || []) === "waiting-for-providers")
  ) {
    return {
      ...chat,
      reply: `${String(chat.reply).replace(
        /\n\nTry it again, or leave it off for now\?$/,
        "",
      )}\n\nThis build was saved before Dash last closed — carry on building to pick it up from there.`,
      choices: "continue",
      continueLabel: "Carry on building",
    };
  }
  return chat;
}

function chatFor(
  state,
  { kind = "dashboard", leftOff = [], cell = null, change = null } = {},
) {
  const steps = stepsOf(state);
  const status = buildStatus(state, leftOff);
  const built = steps.filter((s) => s.kind === "build");
  const builtDone = built.filter((s) => s.status === "done");
  const checks = steps.filter((s) => s.kind === "check");
  const checked = checks.filter((s) => s.status === "done");
  const bots = Object.values((state && state.bots) || {}).filter(
    (b) => b && b.id,
  );
  const dashboard = state && state.dashboard;
  const waiting = waitingFor(state).map(providerLabel);
  const off = leftOffNames(state, leftOff);
  const builtLine = () => {
    const parts = [];
    if (builtDone.length) parts.push(plural(builtDone.length, "widget"));
    if (bots.length)
      parts.push(bots.length === 1 ? "the bot" : `${bots.length} bots`);
    const what = parts.length
      ? `Builder built ${parts.join(" and ")}`
      : "Built it";
    return checked.length
      ? `${what} · Checker checked ${checked.length === 1 ? "it" : "them"}`
      : what;
  };

  if (isBuilding(state)) {
    const toBuild = built.some(
      (s) => s.status === "running" || s.status === "waiting",
    )
      ? built.length
      : 0;
    return {
      step: {
        label: toBuild
          ? `Builder is building ${plural(toBuild, "widget")}`
          : "Setting it up",
        status: "asking",
      },
      card: null,
      reply: waiting.length
        ? `Building now. One thing needs you — connect ${andList(waiting)}, on the right. Everything else carries on.`
        : "Building now — I'll tell you when it's done.",
      choices: null,
    };
  }
  if (status === "waiting-for-you") {
    const at = steps.find((s) => s.status === "needs-you");
    const name = at ? String(at.label).replace(/^Preview /, "") : "It";
    return {
      step: { label: `Builder built ${name}`, status: "done" },
      card: { kind: "widget", title: name, sub: "Widget · preview ready" },
      reply: `${name} is ready to look at — it's on the right, running. Tell me if anything should change before ${
        kind === "cell"
          ? "it goes in the cell you picked"
          : kind === "edit" && change && change.mode === "update"
            ? `${change.displayName || "it"} changes everywhere it's used`
            : kind === "edit"
              ? "it's saved as a new widget"
              : "it goes into your widgets"
      }.`,
      choices: "preview",
    };
  }
  if (status === "finished-with-problems") {
    const failed = failedSteps(state, leftOff);
    const first = failed[0] || null;
    const label = first
      ? nameOf(nameOf(first.label, "Build"), "Check")
      : "One step";
    return {
      step: {
        label: first
          ? `${first.role === "checker" ? "Checker" : first.role === "builder" ? "Builder" : "Dash"} couldn't finish ${label}`
          : "Something didn't finish",
        status: "failed",
      },
      card: null,
      reply: [
        first
          ? `${label} didn't work — ${firstLine(first.error) || "it didn't finish"}. Everything else that could be done is done.`
          : "Part of it didn't finish. Everything else that could be done is done.",
        waiting.length
          ? ` What needs ${andList(waiting)} waits for it (on the right).`
          : "",
        first ? "\n\nTry it again, or leave it off for now?" : "",
      ].join(""),
      choices: first ? "failed" : null,
      failed: first,
    };
  }
  if (status === "stopped" || status === "interrupted") {
    const any = steps.some((s) => s.status === "done");
    return {
      step: { label: "The build stopped", status: "stopped" },
      card: null,
      reply: !any
        ? status === "interrupted"
          ? "The app closed before anything was built. I can start it again."
          : "Stopped before anything was built. I can start it again."
        : status === "interrupted"
          ? "The app closed while it was building. What's built is kept — I can carry on from there."
          : "Stopped — what's built is kept. I can carry on from there.",
      choices: "continue",
      continueLabel: any ? "Carry on building" : "Start it again",
    };
  }
  // Removed: the plan can be built again.
  if (status === "removed") {
    return {
      step: { label: "Removed what was built", status: "done" },
      card: null,
      reply: "I removed what the build made. Say if you want it built again.",
      choices: "again",
    };
  }
  // Built (or built, waiting for a provider).
  const leftNote = off.length
    ? ` ${andList(off)} ${off.length === 1 ? "is" : "are"} left off.`
    : "";
  const waitNote = waiting.length
    ? ` What needs ${andList(waiting)} runs once it's connected — on the right.`
    : "";
  if (kind === "settings") {
    const name = (change && change.displayName) || "The widget";
    const labels = (change && change.settingLabels) || {};
    const at = steps.find((s) => s.kind === "settings");
    const keys = at && at.detail ? String(at.detail).split(", ") : [];
    const which = keys.map((k) => labels[k] || k);
    const on = dashboard
      ? dashboard.name
      : (change && change.dashboardName) || "";
    return {
      step: { label: `Changed ${name}'s settings`, status: "done" },
      card: {
        kind: "widget",
        title: name,
        sub: `Settings · ${plural(keys.length, "change")}`,
      },
      reply: `${name}'s settings are changed${on ? ` on ${on}` : ""}${
        which.length ? `: ${andList(which)}` : ""
      }. Only this copy changed.`,
      choices: dashboard ? "open" : null,
    };
  }
  if (kind === "edit") {
    const made = steps.find((s) => s.kind === "save");
    const was = (change && change.displayName) || "The widget";
    const name = made
      ? String(made.label).replace(/^(Install|Update) /, "")
      : was;
    const on = (change && change.dashboardName) || "your dashboard";
    if (!change || change.mode === "update") {
      return {
        step: { label: builtLine(), status: "done" },
        card: { kind: "widget", title: was, sub: "Widget · updated" },
        reply: `${was} is updated — everywhere it's used shows the change.${waitNote}`,
        choices: null,
      };
    }
    if (!change.onDashboard) {
      return {
        step: { label: builtLine(), status: "done" },
        card: { kind: "widget", title: name, sub: "Widget · in your widgets" },
        reply: `${name} is in your widgets — ${was} stays as it is. Put it on a dashboard from any empty cell's Add widget.${waitNote}`,
        choices: null,
      };
    }
    // A new widget taking that copy's place: the editor swaps it in.
    const placed = change.placed;
    const why = {
      preview: `${on} isn't being edited, so it isn't in ${was}'s place yet. Open ${on}, click Edit, then put it in.`,
      "no-answer": `It isn't in ${was}'s place yet: ${on} isn't open for editing on the page with it. Open it there, click Edit, then put it in.`,
      gone: `${was} isn't on ${on} any more — add the new one to any empty cell with Add widget.`,
      "unknown-widget": "It isn't ready to go in yet. Try again in a moment.",
      failed: "Something went wrong putting it in. Try again.",
    };
    const again =
      !!change.canPlace && placed !== "gone" && placed !== "placing";
    return {
      step: { label: builtLine(), status: "done" },
      card: {
        kind: "widget",
        title: name,
        sub:
          placed === true
            ? `Widget · in ${was}'s place`
            : "Widget · in your widgets",
      },
      reply:
        placed === true
          ? `${name} is in ${was}'s place on ${on}. Save ${on} to keep it.${waitNote}`
          : placed === "placing"
            ? `${name} is ready — putting it in ${was}'s place…`
            : why[placed]
              ? `${name} is in your widgets. ${why[placed]}${waitNote}`
              : `${name} is in your widgets. If it isn't in ${was}'s place yet, put it in while you're editing ${on}.${waitNote}`,
      choices: again && placed !== true ? "swap" : null,
    };
  }
  if (kind === "cell") {
    const made = steps.find((s) => s.kind === "save" || s.kind === "install");
    const name = made
      ? String(made.label).replace(/^Install /, "")
      : "Your widget";
    const on = (cell && cell.dashboardName) || "your dashboard";
    const placed = cell ? cell.placed : null;
    const canPlace = !!(cell && cell.canPlace);
    const why = {
      preview: `${on} isn't being edited any more, so it couldn't go in the cell. Open ${on}, click Edit, then put it in.`,
      "no-answer": `It couldn't go in the cell: ${on} isn't open for editing on the page with that cell. Open it there, click Edit, then put it in.`,
      taken:
        "The cell you picked isn't empty any more, so it wasn't put in — add it to any empty cell with Add widget.",
      gone: "The cell you picked isn't there any more — add it to any empty cell with Add widget.",
      "unknown-widget":
        "It isn't ready to go in the cell yet. Try again in a moment.",
      failed: "Something went wrong putting it in the cell. Try again.",
    };
    // Tried again only where it can still go in.
    const again =
      canPlace &&
      placed !== "taken" &&
      placed !== "gone" &&
      placed !== "placing";
    return {
      step: { label: builtLine(), status: "done" },
      card: {
        kind: "widget",
        title: name,
        sub:
          placed === true
            ? "Widget · in the cell you picked"
            : "Widget · in your widgets",
      },
      reply:
        placed === true
          ? `${name} is in the cell you picked. Save ${on} to keep it.${waitNote}`
          : placed === "placing"
            ? `${name} is ready — putting it in the cell you picked…`
            : why[placed]
              ? `${name} is in your widgets. ${why[placed]}${waitNote}`
              : `${name} is in your widgets. If it isn't in the cell you picked yet, put it in while you're editing ${on}.${waitNote}`,
      // Cancelled edits take it out again: it can be put back.
      choices: again ? (placed === true ? "place-again" : "place") : null,
    };
  }
  if (kind === "widget") {
    const made = steps.find((s) => s.kind === "save" || s.kind === "install");
    const name = made
      ? String(made.label).replace(/^Install /, "")
      : "Your widget";
    return {
      step: { label: builtLine(), status: "done" },
      card: { kind: "widget", title: name, sub: "Widget · in your widgets" },
      reply: `${name} is in your widgets. Put it on a dashboard from any empty cell's Add widget.${waitNote}`,
      choices: null,
    };
  }
  if (kind === "bot" || (!dashboard && bots.length)) {
    const bot = bots[0];
    return {
      step: { label: "Saved the bot", status: "done" },
      card: bot
        ? { kind: "bot", title: bot.name, sub: "Bot · saved, paused" }
        : null,
      reply: `${bot ? bot.name : "The bot"} is saved, paused — try it from the Build log on the right, then turn it on.${waitNote}`,
      choices: null,
    };
  }
  const placed = steps.filter(
    (s) => s.kind === "place" && s.status === "done",
  ).length;
  return {
    step: { label: builtLine(), status: "done" },
    card: dashboard
      ? {
          kind: "dashboard",
          title: dashboard.name,
          // A dashboard the user had: what was added, not its size.
          sub: dashboard.targeted
            ? `Dashboard · changed · ${placed} added`
            : `Dashboard · built · ${plural(placed, "widget")}`,
        }
      : null,
    reply: [
      dashboard
        ? dashboard.targeted
          ? `${dashboard.name} is changed.`
          : `Your ${dashboard.name} dashboard is ready.`
        : "It's built.",
      checked.length
        ? ` The Checker passed ${
            checked.length === checks.length
              ? checked.length === 1
                ? "the new widget"
                : `all ${checked.length} new widgets`
              : plural(checked.length, "new widget")
          }.`
        : "",
      leftNote,
      waitNote,
      bots.length
        ? ` New bots start paused — try ${bots.length === 1 ? "it" : "them"} from the Build log.`
        : "",
    ].join(""),
    choices: dashboard ? "open" : null,
  };
}
