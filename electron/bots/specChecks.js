/**
 * specChecks.js — a built widget's code held to what the user chose in the
 * widget wizard (Review & build): the provider it reads from, what it may
 * change with, its settings, the events it sends and listens for, its empty
 * words, its look and how often it reads again. Checked by Dash itself on
 * every draft — before the Checker, and when the Builder saves one — so a
 * mismatch goes back to the Builder with exactly what to change.
 *
 * Only what the code settles is held here: a tool Dash can't tell reads or
 * changes is left to the Checker (`unsure`), never failed. Configs are read
 * with the AST-allowlist parser — never executed. Portable (NFR-006).
 */
"use strict";

const { parseDashConfig } = require("../utils/dashConfigParser");
const { eventNames, settingsOf } = require("./configDiff");
const { isReservedEvent } = require("./widgetEvents");
const { classifyTool } = require("./roleTools");

const isStr = (v) => typeof v === "string";
const strList = (v) =>
  (Array.isArray(v) ? v : []).filter((x) => isStr(x) && x.trim());
const lower = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();
// "google-calendar", "Google Calendar", "googlecalendar" → one key.
const kindKey = (v) => lower(v).replace(/[^a-z0-9]/g, "");

/** "daysAhead" / "days_ahead" → "Days ahead". */
function settingWords(key) {
  const words = String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/**
 * Comments blanked, strings and template literals kept whole — a glob like
 * "**\/*.md" or "a // b" in a string is never taken for a comment.
 */
function withoutComments(src) {
  const text = String(src || "");
  let out = "";
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && i + 1 < text.length) {
        out += n;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
    } else if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      out += " ";
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Every callTool("<name>", …) with a written name, in order, once each. */
function toolCalls(componentCode) {
  const out = [];
  const re = /callTool\s*\(\s*(["'`])([\w.:\-/]+)\1/g;
  const src = withoutComments(componentCode);
  let m;
  while ((m = re.exec(src))) if (!out.includes(m[2])) out.push(m[2]);
  return out;
}

/**
 * The look's dash-react components (widgetLooks LOOKS, planBuild
 * LOOK_PARTS) — less what the user turned off: no header, no mark.
 */
function lookParts(look) {
  const l = look && LOOK_COMPONENTS[look.id];
  if (!l) return null;
  const o =
    (look.options && typeof look.options === "object" && look.options) || {};
  const parts = l[1].filter(
    (c) =>
      !(c === "PanelHeader" && o.header === "None") &&
      !(
        c === "StatusBadge" &&
        o.markFirst !== undefined &&
        o.markFirst !== "On"
      ),
  );
  return [l[0], parts];
}

const LOOK_COMPONENTS = {
  list: ["List", ["PanelHeader", "EmptyState"]],
  timeline: ["Timeline", ["PanelHeader"]],
  next: ["Next up", ["PanelHeader", "StatusBadge"]],
  cards: ["Cards", ["PanelHeader"]],
  count: ["Count", ["PanelHeader"]],
};

// "Every 5 minutes" / "Every hour" read again on a timer.
const TIMED = /^every\b/i;
const TIMER =
  /\b(setInterval|setTimeout|useInterval|useScheduler|refreshInterval|pollInterval)\b/;

const squash = (v) =>
  String(v || "")
    .replace(/\{\s*(["'`])([^"'`]*)\1\s*\}/g, "$2")
    .replace(/&(apos|#39|#x27|rsquo|lsquo);/g, "'")
    .replace(/&(quot|#34|ldquo|rdquo);/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const sameValue = (a, b) =>
  a === b || (a != null && b != null && String(a).trim() === String(b).trim());

function toolKind(name, live) {
  const t = (live || []).find((x) => x && x.name === name);
  return classifyTool(t || name);
}

/**
 * @param {object} piece  the plan's widget, with what the user chose
 * @param {{ componentCode, configCode }} code  the draft
 * @param {{ events?: string[], live?: Array<{ name, annotations? }> }} ctx
 *   events: what it must send (the plan's, and any a bot starts on);
 *   live: the provider's running tools, when known (their read-only flags)
 * @returns {{ rows: Array<{ ok, main, sub }>, problems: Array<{ main, chose }>,
 *   unsure: string[] }}
 *   rows — one per choice, for the Check report; problems — what doesn't
 *   match, said plainly; unsure — tools Dash can't tell read or change
 */
function specCheck(piece, code = {}, { events = [], live = null } = {}) {
  const p = piece || {};
  const component = String(code.componentCode || "");
  const plain = withoutComments(component);
  let config = null;
  try {
    const parsed = code.configCode ? parseDashConfig(code.configCode) : null;
    config = parsed && parsed.ok ? parsed.config : null;
  } catch (_e) {
    config = null;
  }
  const rows = [];
  const problems = [];
  const unsure = [];
  const row = (ok, main, sub) => rows.push({ ok, main, sub });
  const off = (main, chose) => problems.push({ main, chose });

  // Reads from: it uses the user's connection, declared in its config.
  const kinds = strList(p.providers);
  const pinned = p.provider && typeof p.provider === "object" ? p.provider : {};
  if (kinds.length && config) {
    const declared = (Array.isArray(config.providers) ? config.providers : [])
      .map((x) => kindKey(isStr(x) ? x : x && x.type))
      .filter(Boolean);
    for (const k of kinds) {
      const name = pinned[k] || k;
      if (declared.includes(kindKey(k))) {
        row(
          true,
          `Reads from ${name}`,
          "uses your connection — no keys of its own",
        );
      } else {
        row(false, `Reads from ${name}`, "isn't set up to use your connection");
        off(
          `It isn't set up to use your ${name} connection (its .dash.js providers don't list ${k})`,
          `it reads from ${name}`,
        );
      }
    }
  }

  // What it may change with: every call that changes things is one chosen.
  const calls = toolCalls(component);
  const reads = strList(p.reads);
  if (Array.isArray(p.changes)) {
    const changes = strList(p.changes);
    const chose = changes.length
      ? `it may change things only with ${changes.join(", ")}`
      : "only reads — it never changes anything";
    const wrong = [];
    for (const t of calls) {
      if (changes.includes(t) || reads.includes(t)) continue;
      const kind = toolKind(t, live);
      if (kind === "change") wrong.push(t);
      else if (kind === "unknown") unsure.push(t);
    }
    for (const t of wrong) {
      off(`It calls ${t}, which changes things`, chose);
    }
    const label = changes.length
      ? `Changes only with ${changes.join(", ")}`
      : "Only reads";
    row(
      !wrong.length,
      label,
      wrong.length
        ? `also calls ${wrong.join(", ")}, which ${wrong.length === 1 ? "changes" : "change"} things`
        : calls.length
          ? `calls ${calls.join(", ")}`
          : "calls no tools that change things",
    );
  }

  // Settings: each one there, starting at what was chosen.
  const settings =
    p.settings && typeof p.settings === "object" ? p.settings : {};
  const keys = Object.keys(settings);
  if (keys.length && config) {
    const have = settingsOf(config);
    const missing = [];
    const wrongStart = [];
    for (const k of keys) {
      const s = have[k];
      if (!s) {
        missing.push(k);
        off(
          `There is no “${settingWords(k)}” setting (${k} in its userConfig)`,
          `${settingWords(k)}, starting at ${JSON.stringify(settings[k])} — a setting you can change later`,
        );
        continue;
      }
      const start = s && typeof s === "object" ? s.defaultValue : undefined;
      if (start !== undefined && !sameValue(start, settings[k])) {
        wrongStart.push(k);
        off(
          `“${settingWords(k)}” starts at ${JSON.stringify(start)}`,
          `${settingWords(k)} starts at ${JSON.stringify(settings[k])}`,
        );
      }
    }
    const names = keys.map(settingWords).join(", ");
    row(
      !missing.length && !wrongStart.length,
      `Settings: ${names}`,
      missing.length
        ? `${missing.map(settingWords).join(", ")} ${missing.length === 1 ? "is" : "are"} missing`
        : wrongStart.length
          ? `${wrongStart.map(settingWords).join(", ")} ${wrongStart.length === 1 ? "starts" : "start"} somewhere else`
          : `${keys.length === 1 ? "the setting" : "each setting"}, with what you chose`,
    );
  }

  // Events it sends: listed in its config and sent from its code.
  const sends = strList(events).filter((e) => !isReservedEvent(e));
  if (sends.length && config) {
    const listed = eventNames(config);
    for (const e of sends) {
      const isListed = listed.includes(e);
      const isSent =
        plain.includes(`"${e}"`) ||
        plain.includes(`'${e}'`) ||
        plain.includes(`\`${e}\``);
      if (!isListed) off(`${e} isn't listed in its events`, `it sends ${e}`);
      if (!isSent) off(`It never sends ${e}`, `it sends ${e}`);
      row(
        isListed && isSent,
        `Sends ${e}`,
        isListed && isSent
          ? "listed, and sent from its code"
          : !isSent
            ? "never sent from its code"
            : "not listed in its events",
      );
    }
  }

  // What it listens for: the handler is declared.
  const listens = (Array.isArray(p.listens) ? p.listens : []).filter(
    (l) => l && isStr(l.handler) && l.handler.trim(),
  );
  if (listens.length && config) {
    const handlers = (
      Array.isArray(config.eventHandlers) ? config.eventHandlers : []
    )
      .map((h) => (isStr(h) ? h : h && (h.name || h.handler)))
      .filter(Boolean);
    for (const l of listens) {
      const ok = handlers.includes(l.handler);
      if (!ok) {
        off(
          `It doesn't declare the handler ${l.handler}`,
          `it listens for the ${l.bot || "bot"}'s “${l.result || "result"}”`,
        );
      }
      row(
        ok,
        `Listens for ${l.bot ? `${l.bot}'s ` : ""}${l.result || l.handler}`,
        ok ? `declares ${l.handler}` : `${l.handler} isn't declared`,
      );
    }
  }

  // Its empty words.
  if (isStr(p.whenEmpty) && p.whenEmpty.trim()) {
    const words = p.whenEmpty.trim();
    const ok =
      squash(component).includes(squash(words)) ||
      squash(code.configCode).includes(squash(words));
    if (!ok) {
      off(
        `It doesn't say “${words}” when there's nothing to show`,
        `when empty it says “${words}”`,
      );
    }
    row(
      ok,
      `When empty: “${words}”`,
      ok ? "in the widget" : "not in the widget",
    );
  }

  // The look: built from that look's dash-react parts.
  const look = lookParts(p.look);
  if (look && look[1].length) {
    const [name, parts] = look;
    const lacking = parts.filter((c) => !new RegExp(`\\b${c}\\b`).test(plain));
    for (const c of lacking) {
      off(
        `It doesn't use dash-react's ${c}`,
        `the ${name} look, built from ${parts.join(", ")}`,
      );
    }
    row(
      !lacking.length,
      `Looks: ${name}`,
      lacking.length ? `no ${lacking.join(", ")}` : parts.join(", "),
    );
  }

  // How often it reads again: a timer, when it's every so often.
  if (isStr(p.refresh) && TIMED.test(p.refresh.trim())) {
    const every = p.refresh.trim();
    const ok =
      TIMER.test(plain) ||
      /\bscheduledTasks\b/.test(withoutComments(code.configCode));
    if (!ok) {
      off(
        `It never reads again by itself`,
        `${every.toLowerCase()}, it reads again`,
      );
    }
    row(
      ok,
      `Reads again ${every.toLowerCase()}`,
      ok ? "refreshes on a timer" : "no timer",
    );
  }

  return { rows, problems, unsure };
}

/** The problems as one line each, for a step's error and the Builder. */
function mismatchText(problems) {
  return (problems || [])
    .map((x) => `- ${x.main} — the user chose: ${x.chose}`)
    .join("\n");
}

/** The same problems in any order, for telling a fix that got nowhere. */
function mismatchKey(problems) {
  return (problems || [])
    .map((x) => x.main)
    .sort()
    .join("\n");
}

/**
 * The Builder's own "can't": `CAN'T: <what and why>` and, optionally,
 * `CLOSEST: <the closest that works>` in its answer.
 * @returns {{ what, closest } | null}
 */
function cantOf(output) {
  const text = String(output || "");
  const m = /^\s*CAN['’]T:\s*(.+)$/m.exec(text);
  if (!m) return null;
  const c =
    /CLOSEST:\s*(.+)$/m.exec(m[0]) || /^\s*CLOSEST:\s*(.+)$/m.exec(text);
  // No trailing full stop: the screen puts its own after it.
  const bare = (s) => s.trim().replace(/[.\s]+$/, "");
  const clean = (s) => bare(s.replace(/\s*\|\s*CLOSEST:.*$/i, ""));
  return {
    what: clean(m[1]),
    closest: c ? bare(c[1]) : null,
  };
}

module.exports = {
  specCheck,
  toolCalls,
  mismatchText,
  mismatchKey,
  cantOf,
  settingWords,
};
