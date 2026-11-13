/**
 * widgetSpec — the widget wizard's model (the approved mockups "Pick the
 * provider" and "Widget, step by step"): which widget a plan makes, and
 * each step's state, from the plan, the user's providers (providers.json)
 * and what the user picked. Pure: the screens and the build read it.
 *
 * The app owns the choices — the Planner's plan proposes, the user
 * decides; nothing here trusts the AI to have asked.
 */
import {
  candidatesFor,
  keepsConnection,
  kindWords,
  livePin,
  normalizeType,
  providerKindLabel,
  providerLabel,
  unpinnedChoices,
} from "../../Create/planChecklist";
import {
  RESERVED_WIDGET_EVENTS,
  isReservedEvent,
} from "../../../utils/widgetEventNames";
import { classifyTool } from "../../../utils/widgetEvents";
import { lookById } from "./widgetLooks";
import { packageComponentIds } from "./reuseSpec";

const listOf = (providers) =>
  (Array.isArray(providers)
    ? providers
    : Object.values(providers || {})
  ).filter((p) => p && p.name);

/**
 * The one new widget a plan makes — the wizard's widget — or -1: a plan
 * that makes several widgets, or bots, or only changes one in place, keeps
 * its plan card.
 */
export function wizardIndex(plan) {
  const pieces = (plan && Array.isArray(plan.pieces) && plan.pieces) || [];
  if (plan && plan.widgetChange) return -1;
  if (pieces.some((p) => p && p.kind === "bot")) return -1;
  const widgets = pieces
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p && p.kind === "widget" && !keepsConnection(p));
  return widgets.length === 1 ? widgets[0].i : -1;
}

/** The kinds a widget piece reads from (normalized, no blanks). */
export const kindsOf = (piece) => [
  ...new Set(
    (Array.isArray(piece && piece.providers) ? piece.providers : [])
      .map(normalizeType)
      .filter(Boolean),
  ),
];

/**
 * Step 1 · Reads from: the user's providers that can serve the widget
 * (found by the app from their saved tools), and whether the user has
 * picked. `none`: none of theirs can — the step says so.
 * @returns {{ kinds, candidates: string[], usable: string[], done, none }}
 */
export function readsFromStep(piece, providers, picked = []) {
  const kinds = kindsOf(piece);
  if (!kinds.length) {
    return { kinds, candidates: [], usable: [], done: true, none: false };
  }
  const all = listOf(providers);
  const candidates = [];
  for (const k of kinds) {
    for (const n of candidatesFor(k, providers)) {
      if (!candidates.includes(n)) candidates.push(n);
    }
  }
  const usable = candidates.filter((n) =>
    all.some((p) => p.name === n && p.providerClass !== "connector"),
  );
  const done =
    unpinnedChoices(piece, providers, Array.isArray(picked) ? picked : [])
      .length === 0 && kinds.every((k) => !!livePin(piece, k, providers));
  return { kinds, candidates, usable, done, none: !usable.length };
}

/**
 * The plan with the user's picks applied: a widget kind that isn't pinned
 * to one of them gets the one they picked of that kind. A new plan from
 * the Planner keeps the user's choice even if it left it out.
 */
export function pinFromPicked(plan, picked, providers) {
  const names = (Array.isArray(picked) ? picked : []).map((n) =>
    String(n).toLowerCase(),
  );
  if (!plan || !names.length) return plan;
  const mine = listOf(providers).filter(
    (p) =>
      names.includes(p.name.toLowerCase()) && p.providerClass !== "connector",
  );
  let changed = false;
  const pieces = (plan.pieces || []).map((piece) => {
    if (!piece || piece.kind !== "widget" || keepsConnection(piece)) {
      return piece;
    }
    let next = piece;
    for (const k of kindsOf(piece)) {
      const pin = livePin(piece, k, providers);
      if (pin && names.includes(pin.name.toLowerCase())) continue;
      const p = mine.find((x) => normalizeType(x.type) === k);
      if (!p) continue;
      const provider = {
        ...(next.provider && typeof next.provider === "object"
          ? next.provider
          : {}),
      };
      for (const key of Object.keys(provider)) {
        if (normalizeType(key) === k) delete provider[key];
      }
      provider[p.type || p.name] = p.name;
      next = { ...next, provider };
      changed = true;
    }
    return next;
  });
  return changed ? { ...plan, pieces } : plan;
}

/**
 * A widget's name as people read it: "GoogleCalendarWidget" → "Google
 * Calendar Widget"; a name with spaces stays as it is.
 */
export function widgetLabel(piece) {
  const name = String((piece && piece.name) || "").trim();
  if (!name) return "the widget";
  if (/\s/.test(name)) return name;
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

/** "found 3 providers for Today's Calendar" — the step line while the user picks. */
export function foundLine(piece, step) {
  const n = (step.usable || step.candidates).length;
  const what = widgetLabel(piece);
  if (step.none) return `none of your providers can do ${what} yet`;
  return `found ${n} ${n === 1 ? "provider" : "providers"} for ${what}`;
}

/**
 * What the wizard's widget reads from, by the names the user picked:
 * "Google Calendar" · "Google Calendar and Home Assistant MCP" — or "".
 */
export function readsFromNames(piece, providers, picked = []) {
  const mine = (Array.isArray(picked) ? picked : []).map((n) =>
    String(n).toLowerCase(),
  );
  const names = [];
  for (const k of kindsOf(piece)) {
    const pin = livePin(piece, k, providers);
    if (
      pin &&
      mine.includes(pin.name.toLowerCase()) &&
      !names.includes(pin.name)
    )
      names.push(pin.name);
  }
  return names.join(" and ");
}

/** The wizard's steps, in order (the step bar). */
export const STEPS = [
  { id: "reads", label: "Reads from" },
  { id: "does", label: "What it does" },
  { id: "talks", label: "Talks to" },
  { id: "looks", label: "Looks" },
  { id: "review", label: "Review & build" },
];

/**
 * Why a provider is on the list, in a few words: its kind ("Your Google
 * Calendar provider"), or the saved tool that matched ("Its tools include
 * ha_config_get_calendar_events").
 */
export function reasonFor(name, kinds, providers) {
  const p = listOf(providers).find((x) => x.name === name);
  if (!p) return "";
  if (p.providerClass === "connector") return "Through your Claude account";
  if (kinds.includes(normalizeType(p.type))) {
    const n = Array.isArray(p.allowedTools) ? p.allowedTools.length : 0;
    return n
      ? `Your ${providerLabel(p.type)} — ${n} tools approved`
      : `Your ${providerLabel(p.type)}`;
  }
  const words = kinds.flatMap(kindWords);
  const tools = (Array.isArray(p.allowedTools) ? p.allowedTools : []).map(
    String,
  );
  const hit = tools.find((t) => words.some((w) => t.toLowerCase().includes(w)));
  return hit ? `Its tools can ${toolWords(hit)}` : "";
}

/** "ha_config_get_calendar_events" → "get calendar events" (no prefixes). */
export function toolWords(tool) {
  return String(tool || "")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 2 && !/^(config|api|mcp|tool)$/i.test(w))
    .join(" ")
    .toLowerCase();
}

/**
 * The Planner asked which provider (a question with pick: "providers"):
 * the same pick as the wizard's, its options as the candidates and its
 * reasons on the rows. Never done — answering it sends a new plan.
 */
export function pickFromQuestion(question, providers, piece = null) {
  const all = listOf(providers);
  const candidates = (Array.isArray(question.options) ? question.options : [])
    .map((o) =>
      all.find((p) => p.name.toLowerCase() === String(o).toLowerCase()),
    )
    .filter(Boolean)
    .map((p) => p.name);
  const usable = candidates.filter((n) =>
    all.some((p) => p.name === n && p.providerClass !== "connector"),
  );
  return {
    name: piece ? widgetLabel(piece) : "the widget",
    piece,
    question,
    reasons: question.reasons || null,
    reads: {
      kinds: piece ? kindsOf(piece) : [],
      candidates,
      usable,
      done: false,
      none: !usable.length,
    },
    done: false,
  };
}

const firstSentence = (text) => {
  const t = String(text || "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^(.{20,220}?[.!?])(\s|$)/.exec(t);
  return m ? m[1] : t.slice(0, 220);
};

/**
 * What the plan makes, said plainly (frame 4): the widget, new or reused,
 * where it goes, what it reads from, what it does — then the question.
 */
export function planSays(piece, { where = "", reads = "" } = {}) {
  if (!piece) return "";
  const label = widgetLabel(piece);
  const kind =
    !piece.source || piece.source === "new"
      ? "a new widget"
      : "your widget, reused";
  const parts = [
    `${label} — ${kind}${where ? ` in ${where}` : ""}.`,
    reads ? `It reads from ${reads}.` : "",
    firstSentence(piece.notes),
    "Do you want it built?",
  ].filter(Boolean);
  return parts.join(" ");
}

/** The plan card's title and line for the wizard's widget (frame 4). */
export function planCardFor(piece, { where = "", reads = "" } = {}) {
  const isNew = !piece.source || piece.source === "new";
  return {
    title: `${widgetLabel(piece)}${isNew ? " (new)" : ""}`,
    sub: [
      isNew ? "Built for you" : "Your widget, reused",
      where || null,
      reads ? `reads from ${reads}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

const strs = (v) =>
  (Array.isArray(v) ? v : [])
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => x.trim());
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");

const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "todoEntityId" → "Todo entity id"; "maxItems" → "Max items". */
export function settingLabel(key) {
  const words = String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

/**
 * The tools a widget reads with: what the plan says (reads), else the
 * pinned providers' approved tools its notes name.
 */
export function readTools(piece, providers) {
  const said = strs(piece && piece.reads);
  if (said.length) return said;
  const notes = String((piece && piece.notes) || "");
  const found = [];
  for (const k of kindsOf(piece)) {
    const pin = livePin(piece, k, providers);
    for (const t of (pin && Array.isArray(pin.allowedTools)
      ? pin.allowedTools
      : []
    ).map(String)) {
      if (notes.includes(t) && !found.includes(t)) found.push(t);
    }
  }
  return found;
}

// Sentences of the notes that say what's shown — not which provider, where
// it goes, or that it only reads (those have their own rows).
const OTHER_ROWS =
  /provider|connector|\bgoes in\b|\bplaced\b|\brow \d|\bcolumn \d|read-only|only reads|never changes/i;

function showsFromNotes(notes) {
  const sentences = String(notes || "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((x) => x.trim())
    .filter(Boolean);
  return sentences.filter((x) => !OTHER_ROWS.test(x)).join(" ");
}

/**
 * Review & build (the approved "Widget, step by step" overview): every part
 * of the widget, one row each, from the plan, the user's providers and
 * picks. `set`: false when the user must choose it first (the missing
 * frame). `tag`: "You chose" or "Proposed" (the Planner's).
 *
 * @returns {{ rows: Array<{ key, label, value: string[], sub, tag, set,
 *   change }>, setCount, total, isNew }}
 */
export function reviewRows(
  plan,
  piece,
  { providers = [], picked = [], reads = null, where = "", edited = {} } = {},
) {
  if (!piece) return { rows: [], setCount: 0, total: 0, isNew: false };
  const isNew = !piece.source || piece.source === "new";
  const rows = [];
  // Reads from — the user's pick.
  const step = reads || readsFromStep(piece, providers, picked);
  const names = readsFromNames(piece, providers, picked);
  if (!step.done || (kindsOf(piece).length && !names)) {
    const n = (step.usable || step.candidates || []).length;
    rows.push({
      key: "reads",
      label: "Reads from",
      value: [
        n
          ? `Choose — ${n} of your providers can do this`
          : "Choose — none of your providers can do this yet",
      ],
      sub: "",
      tag: "",
      set: false,
      change: "choose",
    });
  } else if (kindsOf(piece).length) {
    const pins = kindsOf(piece)
      .map((k) => livePin(piece, k, providers))
      .filter(Boolean);
    const tools = readTools(piece, providers);
    rows.push({
      key: "reads",
      label: "Reads from",
      value: pins.map((p) => `${p.name} · ${providerKindLabel(p)}`),
      sub: tools.length
        ? `Uses its ${tools.length === 1 ? "tool" : "tools"} to ${tools
            .map((t) => toolWords(t))
            .join(", ")}`
        : "",
      tag: "You chose",
      set: true,
      change: "provider",
    });
  }
  if (isNew) {
    // Can change things — what it may change with, or only reads.
    const changes = Array.isArray(piece.changes) ? strs(piece.changes) : null;
    const access = strs(plan && plan.access);
    rows.push({
      key: "acts",
      label: "Can change things",
      value:
        changes === null
          ? access.length
            ? access
            : ["Not said — ask for what it may change"]
          : changes.length
            ? changes.map((t) => `Can ${toolWords(t)}`)
            : ["Only reads — it never changes anything"],
      sub:
        changes && changes.length
          ? "Each is a button that asks you before it first changes anything"
          : "",
      tag: edited.acts ? "You chose" : "Proposed",
      set: true,
      change: "does",
    });
    // What it shows.
    const shows = text(piece.shows) || showsFromNotes(piece.notes);
    const look = piece.look && piece.look.id ? piece.look : null;
    const lookOpts = (look && look.options) || {};
    const empty = text(lookOpts.empty) || text(piece.whenEmpty);
    rows.push({
      key: "shows",
      label: "What it shows",
      value: [shows || "Not said — ask what it should show"],
      sub: [
        // The look picked, with its choices.
        look
          ? [
              `Looks: ${lookById(look.id).name}`,
              lookOpts.spacing,
              lookOpts.header,
            ]
              .filter(Boolean)
              .join(" · ")
          : "",
        empty ? `When empty: "${empty}"` : "",
      ]
        .filter(Boolean)
        .join("  ·  "),
      tag: edited.shows ? "You chose" : "Proposed",
      set: true,
      change: "looks",
    });
  }
  // Settings — editable here.
  const settings =
    piece.settings && typeof piece.settings === "object" ? piece.settings : {};
  const keys = Object.keys(settings);
  rows.push({
    key: "settings",
    label: "Settings you can change",
    value: keys.length
      ? [
          keys
            .map((k) => `${settingLabel(k)}: ${settingText(settings[k])}`)
            .join("  ·  "),
        ]
      : ["None"],
    sub: keys.length ? "In the widget's panel any time — no rebuild" : "",
    tag: edited.settings ? "You chose" : "Proposed",
    set: true,
    change: "settings",
  });
  if (isNew) {
    // Talks to others — the events it sends and what it listens for.
    const events = strs(piece.events).filter((e) => !isReservedEvent(e));
    const listens = (Array.isArray(piece.listens) ? piece.listens : [])
      .filter((l) => l && l.bot)
      .map((l) => `${l.bot}'s ${l.result || "results"}`);
    rows.push({
      key: "talks",
      label: "Talks to others",
      value: [`Sends ${[...RESERVED_WIDGET_EVENTS, ...events].join(", ")}`],
      sub: `Listens for: ${listens.length ? listens.join(", ") : "nothing"}`,
      tag: edited.talks ? "You chose" : "Proposed",
      set: true,
      change: "talks",
    });
    // Updates — how often it reads again.
    rows.push({
      key: "updates",
      label: "Updates",
      value: [capital(text(piece.refresh)) || REFRESH_CHOICES[2]],
      sub: "",
      tag: edited.updates ? "You chose" : "Proposed",
      set: true,
      change: "does",
    });
  }
  // Where — the cell the user picked.
  if (where) {
    rows.push({
      key: "where",
      label: "Where",
      value: [where],
      sub: "",
      tag: "You chose",
      set: true,
      change: null,
    });
  }
  // How it's checked before it's yours.
  const checks = strs(plan && plan.checks);
  if (checks.length) {
    rows.push({
      key: "checks",
      label: "Checked before it's yours",
      value: checks,
      sub: "",
      tag: "Proposed",
      set: true,
      change: "chat",
    });
  }
  const setCount = rows.filter((r) => r.set).length;
  return { rows, setCount, total: rows.length, isNew };
}

/**
 * Review & build is for a plan that makes one new widget and nothing else:
 * a reused widget, or a dashboard's layout or theme, keeps the plan's own
 * view (its before and after).
 */
export function isNewOnlyWidget(plan, piece) {
  const pieces = (plan && Array.isArray(plan.pieces) && plan.pieces) || [];
  return (
    !!piece &&
    (!piece.source || piece.source === "new") &&
    pieces.length === 1 &&
    pieces[0] === piece
  );
}

/**
 * The sketch beside the review ("How it will look"): the widget's name and
 * the Planner's sample lines, or its empty words.
 */
export function sketchOf(piece) {
  if (!piece) return null;
  const lines = strs(piece.sample);
  return {
    title: widgetLabel(piece),
    lines,
    empty: lines.length ? "" : text(piece.whenEmpty) || "Nothing to show yet",
  };
}

/** A setting's value as text: on / off, a number, words, or its JSON. */
export function settingText(v) {
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * The step bar on Review & build (the overview frame): the steps before it
 * ticked, each with what was chosen or proposed.
 */
export function stepNotes(piece, reads = "") {
  const notes = {};
  if (reads) notes.reads = reads;
  if (!piece) return notes;
  const changes = Array.isArray(piece.changes) ? strs(piece.changes) : null;
  notes.does =
    changes === null
      ? "Proposed"
      : changes.length
        ? `Can change ${changes.length}`
        : "Only reads";
  const events = strs(piece.events).filter((e) => !isReservedEvent(e));
  notes.talks = `Sends ${RESERVED_WIDGET_EVENTS.length + events.length}`;
  notes.looks =
    piece.look && piece.look.id ? lookById(piece.look.id).name : "Proposed";
  return notes;
}

/**
 * What was answered at each step, as your side of the chat (the approved
 * "Wizard steps read like a chat"): the buttons it gets, what it also sends,
 * the look picked.
 */
export function stepAnswers(piece, providers = []) {
  if (!piece) return {};
  const changes = Array.isArray(piece.changes) ? strs(piece.changes) : [];
  const tools = changeTools(piece, providers);
  const label = (t) => (tools.find((x) => x.tool === t) || {}).label || t;
  const events = strs(piece.events).filter((e) => !isReservedEvent(e));
  return {
    does: changes.length
      ? `Buttons: ${changes.map(label).join(", ")}`
      : "No buttons — it only reads",
    talks: events.length
      ? `It also sends ${events.join(", ")}`
      : "Nothing extra to send",
    looks:
      piece.look && piece.look.id ? lookById(piece.look.id).name : "Your pick",
  };
}

// --- Steps 2 and 3 (the approved "does" and "talks-step" frames) ---------

// The things a tool is about: its words, less verbs, prefixes and plurals
// ("ha_config_get_calendar_events" → calendar, event).
const NOT_ABOUT =
  /^(ha|mcp|api|config|tool|get|list|search|read|find|fetch|query|create|add|set|update|edit|delete|remove|send|post|write|item|items|all|by|for|of|the|a|an|new)$/;
const aboutWords = (tool) =>
  String(tool || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !NOT_ABOUT.test(w))
    .map((w) => w.replace(/s$/, ""));

/**
 * Step 2 · What it does — "Can it change things?": the tools of the
 * providers it reads from that change things, as plain actions — checked
 * before it's asked: with `live` (the provider's running tools, their
 * read-only flags) only those it really has; without, its saved list. A
 * tool the Planner proposed is offered only when the provider has it (or
 * its saved list doesn't say which it has). `related`: about what the
 * widget reads (or proposed) — shown first; the others behind a link.
 * @param {{ type, tools: Array<{ name, annotations? }> }|null} live  one
 *   provider's running tools — the others keep their saved list
 * @returns {Array<{ tool, label, provider, related }>}
 */
export function changeTools(piece, providers, live = null) {
  const about = new Set(readTools(piece, providers).flatMap(aboutWords));
  const proposed = strs(piece && piece.changes);
  const out = [];
  // Whether a provider says which tools it has: live, or a saved list.
  let known = false;
  for (const k of kindsOf(piece)) {
    const pin = livePin(piece, k, providers);
    if (!pin) continue;
    const mine =
      live && Array.isArray(live.tools) && live.type === pin.type
        ? live.tools
        : null;
    const tools = mine
      ? mine.filter((t) => t && t.name)
      : (Array.isArray(pin.allowedTools) ? pin.allowedTools : []).map(String);
    if (tools.length) known = true;
    for (const t of tools) {
      const name = typeof t === "string" ? t : t.name;
      if (classifyTool(t) !== "change" || out.some((x) => x.tool === name)) {
        continue;
      }
      out.push({
        tool: name,
        label: capital(toolWords(name)),
        provider: pin.name,
      });
    }
  }
  for (const t of proposed) {
    if (!known && !out.some((x) => x.tool === t)) {
      out.push({ tool: t, label: capital(toolWords(t)), provider: "" });
    }
  }
  return out.map((x) => ({
    ...x,
    // Not known what it reads: every action is offered alike.
    related:
      !about.size ||
      proposed.includes(x.tool) ||
      aboutWords(x.tool).some((w) => about.has(w)),
  }));
}

/**
 * The read the Looks previews are drawn from: the provider it reads from
 * (type and name), and the read tool the Planner named (`preview`), else
 * the first it reads with — only a tool that reads (one whose name doesn't
 * say might change things).
 * @returns {{ type, provider, tool, args } | null}
 */
export function previewRead(piece, providers) {
  const pin = kindsOf(piece)
    .map((k) => livePin(piece, k, providers))
    .find(Boolean);
  if (!pin) return null;
  const p =
    piece && piece.preview && typeof piece.preview === "object"
      ? piece.preview
      : {};
  const tool =
    (typeof p.tool === "string" && p.tool.trim()) ||
    readTools(piece, providers).find((t) => classifyTool(t) === "read") ||
    null;
  // Only a tool that reads: one whose name doesn't say so might change things.
  if (!tool || classifyTool(tool) !== "read") return null;
  return {
    type: pin.type,
    provider: pin.name,
    tool,
    args: p.args && typeof p.args === "object" ? p.args : {},
    settings:
      piece.settings && typeof piece.settings === "object"
        ? piece.settings
        : {},
  };
}

/** The first provider it reads from, as { type, name } — or null. */
export function wizardPin(piece, providers) {
  const pin = kindsOf(piece)
    .map((k) => livePin(piece, k, providers))
    .find(Boolean);
  return pin ? { type: pin.type, name: pin.name } : null;
}

/** The providers it reads from, by name: "Google Calendar". */
export function readsFromLabel(piece, providers) {
  return kindsOf(piece)
    .map((k) => livePin(piece, k, providers))
    .filter(Boolean)
    .map((p) => p.name)
    .join(" and ");
}

/** How often it can read again (step 2's Updates). */
export const REFRESH_CHOICES = [
  "Every 5 minutes",
  "Every hour",
  "Only when I open it",
];

/**
 * Updates' choices: the three, and the Planner's own words first when they
 * aren't one of them. `value`: what it reads again on now.
 */
export function refreshChoices(piece) {
  const said = capital(text(piece && piece.refresh));
  const same = REFRESH_CHOICES.find(
    (c) => c.toLowerCase() === said.toLowerCase(),
  );
  const options = said && !same ? [said, ...REFRESH_CHOICES] : REFRESH_CHOICES;
  // Nothing said: it reads when it opens.
  return { options, value: same || said || REFRESH_CHOICES[2] };
}

/** A setting's kind, in words (the settings table's Kind). */
export function settingKind(v) {
  if (typeof v === "boolean") return "On / off";
  if (typeof v === "number") return "Number";
  if (Array.isArray(v)) return "List";
  if (v && typeof v === "object") return "Group of values";
  return "Text";
}

/** "eventClicked" → "Event clicked". */
const eventWords = (name) => settingLabel(name);

/**
 * Step 3 · Talks to — "Every widget sends": Dash's own three, always on.
 * @returns {Array<{ event, when, carries }>}
 */
export function standardSends(readsFrom = "") {
  const from = readsFrom || "its provider";
  return [
    {
      event: RESERVED_WIDGET_EVENTS[0],
      when: `When it has read from ${from}`,
      carries: "what it read, and from where",
    },
    {
      event: RESERVED_WIDGET_EVENTS[1],
      when: "When it's on screen",
      carries: "the time it showed",
    },
    {
      event: RESERVED_WIDGET_EVENTS[2],
      when: "When it can't read",
      carries: "what went wrong, and which provider",
    },
  ];
}

/**
 * "This widget also sends": what the Planner proposed (its events, each
 * with when and what it carries), ticked unless the user unticked it.
 * @param {object} plannedPiece  the piece as the Planner made it
 * @param {string[]} off         the events the user unticked
 * @returns {Array<{ event, when, carries, on }>}
 */
// A name a widget can send (checked before it's asked): eventClicked.
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export function proposedSends(plannedPiece, off = []) {
  const sends = Array.isArray(plannedPiece && plannedPiece.sends)
    ? plannedPiece.sends.filter((s) => s && typeof s.event === "string")
    : [];
  const names = [
    ...strs(plannedPiece && plannedPiece.events),
    ...sends.map((s) => s.event.trim()),
  ].filter(
    (e, i, all) =>
      e && all.indexOf(e) === i && !isReservedEvent(e) && EVENT_NAME.test(e),
  );
  return names.map((event) => {
    const s = sends.find((x) => x.event.trim() === event) || {};
    return {
      event,
      when: capital(text(s.when)) || eventWords(event),
      carries: text(s.carries),
      on: !(Array.isArray(off) ? off : []).includes(event),
    };
  });
}

const pascal = (s) =>
  String(s || "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");

/**
 * "It listens for…": the results the dashboard's bots send, each one a
 * widget could show. `botEmitters`: useBotEmitters — { component:
 * "bot:<ref>", itemId: <bot id>, name, events: ["result.<name>", …],
 * eventLabels }.
 * @returns {Array<{ key, bot, botId, ref, result, label, handler }>}
 */
export function listenChoices(botEmitters) {
  const out = [];
  for (const b of Array.isArray(botEmitters) ? botEmitters : []) {
    if (!b || !b.itemId) continue;
    const name = b.name || String(b.itemId);
    const ref = String(b.component || "").replace(/^bot:/, "");
    for (const ev of Array.isArray(b.events) ? b.events : []) {
      if (typeof ev !== "string" || !ev.startsWith("result.")) continue;
      const result = ev.slice("result.".length);
      out.push({
        key: `${b.itemId}:${result}`,
        bot: name,
        botId: String(b.itemId),
        ref,
        result,
        label:
          String((b.eventLabels && b.eventLabels[ev]) || "")
            .replace(/ \(result\)$/, "")
            .trim() || result,
        handler: `show${pascal(name)}${pascal(result)}`,
      });
    }
  }
  return out;
}

/**
 * A widget's listeners for what it listens for — its layout item's
 * `listeners` ({ handler: ["bot:<ref>[<botId>].result.<name>"] }), for the
 * bots already on the dashboard.
 */
export function listenersFor(piece) {
  const out = {};
  for (const l of Array.isArray(piece && piece.listens) ? piece.listens : []) {
    if (!l || !l.handler || !l.botId || !l.ref || !l.result) continue;
    const ev = `bot:${l.ref}[${l.botId}].result.${l.result}`;
    out[l.handler] = [...new Set([...(out[l.handler] || []), ev])];
  }
  return Object.keys(out).length ? out : null;
}

/** The dashboard's bots that send no results a widget could show. */
export function silentBots(botEmitters) {
  return (Array.isArray(botEmitters) ? botEmitters : [])
    .filter(
      (b) =>
        b &&
        !(Array.isArray(b.events) ? b.events : []).some(
          (e) => typeof e === "string" && e.startsWith("result."),
        ),
    )
    .map((b) => b.name || String(b.itemId));
}

/**
 * The plan with what the user chose in the wizard on its widget — whatever
 * a new plan says, as the user's provider picks hold (with `providers`, the
 * actions only the provider it reads from now has). `choices`:
 * { changes?: [tool], refresh?, settings?, eventsOff?: [event],
 *   listens?: [{ bot, botId, result, handler }] }.
 */
export function applyChoices(plan, index, choices, providers = null) {
  const c = choices || {};
  if (!plan || index < 0 || !Object.keys(c).length) return plan;
  const piece = plan.pieces && plan.pieces[index];
  if (!piece) return plan;
  // Built step by step: the build holds it to these choices (planBuild).
  const next = { ...piece, chosen: true };
  if (Array.isArray(c.changes)) {
    // Only what the provider it reads from now can do (picked again: the
    // last one's actions go).
    const can = providers
      ? changeTools(piece, providers).map((t) => t.tool)
      : null;
    next.changes = can ? c.changes.filter((t) => can.includes(t)) : c.changes;
  }
  if (typeof c.refresh === "string" && c.refresh) next.refresh = c.refresh;
  if (c.settings && typeof c.settings === "object") {
    next.settings = {
      ...(piece.settings && typeof piece.settings === "object"
        ? piece.settings
        : {}),
      ...c.settings,
    };
  }
  if (Array.isArray(c.eventsOff) && c.eventsOff.length) {
    next.events = strs(piece.events).filter((e) => !c.eventsOff.includes(e));
    if (Array.isArray(piece.sends)) {
      next.sends = piece.sends.filter(
        (s) => !(s && c.eventsOff.includes(s.event)),
      );
    }
  }
  if (Array.isArray(c.listens)) next.listens = c.listens;
  // A widget the user already has: which of its package's widgets, and
  // which of their providers it reads from.
  // Only one of its own package's widgets.
  if (
    typeof c.component === "string" &&
    c.component &&
    packageComponentIds(piece.package, [c.component]).length
  ) {
    next.component = c.component;
  }
  if (c.provider && typeof c.provider === "object") {
    next.provider = {
      ...(piece.provider && typeof piece.provider === "object"
        ? piece.provider
        : {}),
      ...c.provider,
    };
    next.providers = [
      ...new Set([...strs(piece.providers), ...Object.keys(c.provider)]),
    ];
  }
  if (c.look && c.look.id) {
    next.look = c.look;
    const empty = c.look.options && text(c.look.options.empty);
    if (empty) next.whenEmpty = empty;
  }
  const pieces = plan.pieces.map((p, i) => (i === index ? next : p));
  return { ...plan, pieces };
}

/** Which parts the user chose (their rows say "You chose"). */
export function chosenParts(choices) {
  const c = choices || {};
  const went = Array.isArray(c.confirmed) ? c.confirmed : [];
  return {
    acts: Array.isArray(c.changes) || went.includes("does"),
    updates:
      (typeof c.refresh === "string" && !!c.refresh) || went.includes("does"),
    settings:
      !!(c.settings && typeof c.settings === "object") || went.includes("does"),
    talks:
      Array.isArray(c.eventsOff) ||
      Array.isArray(c.listens) ||
      went.includes("talks"),
    shows: !!(c.look && c.look.id),
  };
}
