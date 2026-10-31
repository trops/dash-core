/**
 * workspaceStart.js — what a new Dash Lead conversation opened by a page's
 * New button says (lead-workspace release 6c, frame 41), and the registry's
 * dashboards as Start from lists them (frame 42). Pure.
 */
import { providerLabel } from "../Create/planChecklist";
import { starterToPlan } from "../Create/starters";
import { usageText } from "../Create/editCreate";
import { normalizeUserConfig } from "../../utils/userConfigFields";

const MAKING = {
  widget: {
    what: "a widget",
    title: "What should the widget do?",
    text: "Describe it in your own words. The Dash team plans it with you and builds it; it lands on the Widgets page, ready to add to any dashboard.",
    starters: [
      "Show my calendar for today",
      "Track a stock price",
      "A to-do list",
      "Show my AWS bill",
    ],
  },
  bot: {
    what: "a bot",
    title: "What should the bot do?",
    text: "Describe it in your own words — what it watches, when it runs, what it tells you. The Dash team plans it with you; it's saved paused until you turn it on.",
    starters: [
      "Sum up my email each morning",
      "Tell me when a stock moves 5%",
      "Check my AWS bill every day",
      "Remind me of tomorrow's meetings",
    ],
  },
  // Lead-workspace theme round (frame 44): the Themes page's Describe it.
  theme: {
    what: "a theme",
    title: "What should the theme look like?",
    text: "Describe it in your own words — colors, a mood, a brand. The Dash team plans it with you and shows how it looks, dark and light; nothing is saved until you say yes.",
    starters: [
      "Warm autumn colors, dark",
      "Calm ocean blues",
      "High contrast black and yellow",
      "Soft pastels",
    ],
  },
  dashboard: {
    what: "a dashboard",
    title: "What should the dashboard show?",
    text: "Describe it in your own words. The Dash team plans it with you — its widgets, bots and layout — and nothing is made until you say yes.",
    starters: [
      "My smart home",
      "My day: calendar, email and weather",
      "My AWS costs",
      "Sales at a glance",
    ],
  },
};

const PAGES = {
  widgets: "the Widgets page",
  bots: "the Bots page",
  dashboards: "the Dashboards page",
  themes: "the Themes page",
};

/**
 * What the Dash team can make, for a new Dash Lead conversation (Create —
 * one place to start, frame 1): a card each, with a hint and an example
 * that goes in the box.
 */
export const MAKE_KINDS = [
  {
    kind: "dashboard",
    title: "A dashboard",
    hint: "Widgets and bots together on one screen",
    example: "A dashboard for my smart home",
    icon: "table-cells-large",
  },
  {
    kind: "widget",
    title: "A widget",
    hint: "One tile that shows or does one thing",
    example: "A widget that shows my calendar",
    icon: "puzzle-piece",
  },
  {
    kind: "bot",
    title: "A bot",
    hint: "Works on its own — on a schedule, an event or a click",
    example: "A bot that sums up my email each morning",
    icon: "robot",
  },
  {
    kind: "theme",
    title: "A theme",
    hint: "Colors for the app or one dashboard",
    example: "A Halloween theme",
    icon: "palette",
  },
  {
    kind: "change",
    title: "A change",
    hint: "To a dashboard, widget, bot or theme you have",
    example: "Change one of my dashboards",
    icon: "pen",
  },
];

/**
 * Other ways to start a Dash Lead conversation (frame 13; in the middle
 * since "one place to start"). `kind` is what LeadWorkspace's startFrom
 * does: "registry" | "copy" | "blank" | "import" | "widget". Describing it
 * is the box itself.
 */
export const START_FROM = [
  {
    kind: "registry",
    title: "A dashboard from the registry",
    sub: "Install a ready-made one and its bots, then adjust it",
    icon: "cloud-arrow-down",
  },
  {
    kind: "copy",
    title: "Copy one of your dashboards",
    sub: "Start from what you have and change it",
    icon: "copy",
  },
  // The Create window's no-AI starts (release 6c).
  {
    kind: "blank",
    title: "A blank dashboard",
    sub: "Start empty and add widgets yourself",
    icon: "square-plus",
  },
  {
    kind: "import",
    title: "A dashboard file",
    sub: "Import one someone shared with you",
    icon: "file-import",
  },
  {
    kind: "widget",
    title: "Edit a widget you have",
    sub: "Open it in the Widget Builder",
    icon: "code",
  },
];

/**
 * A page's New: { kind: "widget" | "bot" | "dashboard", from?: page } →
 * the conversation's start — its "Making:" line, greeting and starters,
 * and what the Dash Lead is told with the first question. null for
 * anything else.
 */
export function makingStart(making) {
  // Changing a saved theme (theme change round, frame 48).
  if (making && making.kind === "themechange" && making.theme) {
    const name = String(making.theme).slice(0, 60);
    const by = making.by ? String(making.by).slice(0, 60) : null;
    return {
      label: "Changing",
      text: by ? `${name} — a theme by ${by}` : `${name} — your theme`,
      title: `What should change in ${name}?`,
      greeting: by
        ? `Describe it in your own words. ${name} is by ${by}, so it isn't changed: the Dash team saves your version as a remix that credits them. Nothing is saved until you say yes.`
        : `Describe it in your own words. The Dash team plans the new colors with you — everything that uses ${name} changes, and your font and corners from the theme editor stay. Nothing changes until you say yes.`,
      starters: [
        "Make it warmer",
        "Make it calmer",
        "More contrast",
        "Brighter accents",
      ],
      note: `(The user wants to change their saved theme "${name}" — plan a change to it, source "update".)`,
    };
  }
  const m = making && MAKING[making.kind];
  if (!m) return null;
  const page = making.from ? PAGES[making.from] : null;
  return {
    label: "Making",
    text: page ? `${m.what} — from ${page}` : m.what,
    title: m.title,
    greeting: m.text,
    starters: m.starters,
    // Goes with the first question (and the first reply after a reopen).
    note: `(The user wants to make ${m.what} — plan ${m.what}.)`,
  };
}

/** "row 2, column 1" — and its size when it spans more than one cell. */
export function cellPlace(cell) {
  const [row, col] = String((cell && cell.cellNumber) || "")
    .split(".")
    .map((n) => Number(n));
  if (!row || !col) return "the empty cell";
  const span = (cell && cell.span) || {};
  const wide = Number(span.col) || 1;
  const tall = Number(span.row) || 1;
  const size = wide > 1 || tall > 1 ? ` (${wide} × ${tall})` : "";
  return `the empty cell in row ${row}, column ${col}${size}`;
}

/**
 * An empty cell's Build with AI (release 6c, frame 38):
 * the conversation's "For:" line, greeting and starters, and what the lead
 * is told — one widget, for that cell, placed by the editor. `cell`:
 * { workspaceId, gridItemId, cellNumber, pageId, scope, span? }.
 */
export function cellStart(cell, { dashboardName = "", leadName = "" } = {}) {
  if (!cell || cell.gridItemId == null || !cell.cellNumber) return null;
  const name = dashboardName || "this dashboard";
  const place = cellPlace(cell);
  return {
    label: "For",
    text: `${dashboardName || "Your dashboard"} — ${place}`,
    title: "What should go in this cell?",
    greeting: `Describe it, or pick one below. ${leadName || "The lead"} brings in the Dash team to find or make it, and it goes in the cell you picked — nothing changes until you say yes.`,
    starters: [
      "My calendar for today",
      "The weather",
      "A clock",
      "Something from the registry",
    ],
    note: `(The user is editing ${name} and picked ${place}. Plan exactly one widget for that cell — no bots, theme or layout. The user previews the widget and it goes into that one cell. Put the connection and settings they want on the widget piece. When you bring in the Dash team, tell the Planner this.)`,
    cell: { ...cell, dashboardName: dashboardName || "" },
  };
}

/** A setting's value in a few words: "on", "not set", the text. */
export const shownSetting = (v) => {
  if (v === undefined || v === null || v === "") return "not set";
  if (typeof v === "boolean") return v ? "on" : "off";
  const t = typeof v === "object" ? JSON.stringify(v) : String(v);
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
};

/**
 * A widget's "Change with AI" (release 6c, frame 40): the conversation's
 * "Changing:" line, greeting and starters, and what the lead is told — that
 * widget only; on a dashboard, a change to only its settings is a
 * "settings" piece (nothing is built, only that copy changes); otherwise in
 * place (`mode` "update") or as a new widget ("new").
 * @param {object} widget  the door's { component, itemId, workspaceId,
 *   pageId, scope, gridItemId, cellNumber, settings, providers, error }
 * @param {{ target, mode, usedOn, dashboardName, leadName }} found
 *   (useWidgetTarget)
 */
export function widgetStart(
  widget,
  {
    target,
    mode,
    usedOn = [],
    dashboardName = "",
    leadName = "",
    canInPlace = false,
    canSignIn = false,
  } = {},
) {
  if (!widget || !target || !mode) return null;
  const name = target.displayName || target.componentName;
  const onDashboard = widget.itemId != null && widget.workspaceId != null;
  const dash = dashboardName || "your dashboard";
  const fields = normalizeUserConfig((target.config || {}).userConfig);
  const settingsNow = {};
  const settingLabels = {};
  const settingOptions = {};
  // A key, token or password: its value isn't told to the AI or saved with
  // the conversation.
  const secret = (key, field) =>
    /key|token|secret|password|passwd|credential|auth/i.test(key) ||
    /password|secret/i.test(String((field && field.type) || ""));
  for (const [key, field] of Object.entries(fields)) {
    const mine = widget.settings && widget.settings[key];
    const value = mine !== undefined ? mine : field && field.defaultValue;
    if (!secret(key, field)) settingsNow[key] = value;
    settingLabels[key] = (field && (field.displayName || field.label)) || key;
    const options = Array.isArray(field && field.options) ? field.options : [];
    if (options.length) {
      settingOptions[key] = {};
      for (const o of options) {
        if (o && typeof o === "object" && o.value !== undefined)
          settingOptions[key][String(o.value)] = String(
            o.displayName || o.label || o.value,
          );
      }
    }
  }
  const settingsList = Object.keys(fields)
    .map((k) =>
      k in settingsNow
        ? `${k} (now ${shownSetting(settingsNow[k])})`
        : `${k} (set — not shown)`,
    )
    .join(", ");
  const where =
    mode === "update"
      ? `the change goes into ${target.componentName} itself (in place)${
          usedOn.length ? `, which is on ${usageText(usedOn)}` : ""
        }: its piece is source "update" with package "${target.package}" and the name "${target.componentName}".`
      : `the change is saved as a new widget — ${target.componentName} stays as it is: its piece is source "new" with a new name${
          onDashboard ? `, and it takes this copy's place on ${dash}` : ""
        }.`;
  const error = widget.error
    ? ` It stopped working with this error, quoted from the app: ${JSON.stringify(
        String(widget.error).replace(/\s+/g, " ").trim().slice(0, 400),
      )}.`
    : "";
  const settingsRule =
    onDashboard && settingsList
      ? `If the change is only to its settings — ${settingsList} — plan one widget piece {"kind": "widget", "name": "${name}", "source": "settings", "settings": {only the settings that change, by those names}}: nothing is built, and only this copy changes. Otherwise `
      : "";
  return {
    label: "Changing",
    text: onDashboard ? `${name} — on ${dash}` : name,
    title: `What should change in ${name}?`,
    greeting: [
      "Say what you want different.",
      // Only a widget with settings can change just them (live check).
      onDashboard && settingsList
        ? `Its settings change right here on ${dash}; a change to what it does goes to the Builder, and you see it running before it's saved.`
        : "The Builder makes the change, and you see it running before it's saved.",
      mode === "update"
        ? `${name} changes everywhere it's used${usedOn.length ? ` (${usageText(usedOn)})` : ""}.`
        : `It's saved as a new widget — ${name} stays as it is.`,
      `${leadName || "The lead"} brings in the Dash team.`,
    ].join(" "),
    starters: widget.error
      ? ["Fix the error so it works again"]
      : onDashboard && settingsList
        ? [
            "Change its settings",
            "Show more",
            "Make it look different",
            "Something's wrong with it",
          ]
        : [
            "Show more",
            "Make it look different",
            "Add an option",
            "Something's wrong with it",
          ],
    note: `(The user wants to change their widget ${target.componentName} — package ${target.package}, component ${target.component}${
      onDashboard ? `, the copy on ${dash}` : ""
    }. Read it with read_widget first. ${settingsRule}${settingsRule ? where.charAt(0) : where.charAt(0).toUpperCase()}${where.slice(1)} Plan only that widget — no other widgets, bots, theme, layout or dashboard — and say what the change adds and what it keeps.${error} When you bring in the Dash team, tell the Planner all of this.)`,
    widget: {
      component: target.component,
      componentName: target.componentName,
      displayName: name,
      package: target.package,
      mode,
      usedOn,
      onDashboard,
      dashboardName: onDashboard ? dashboardName : "",
      workspaceId: widget.workspaceId ?? null,
      itemId: widget.itemId ?? null,
      pageId: widget.pageId ?? null,
      scope: widget.scope || "main",
      gridItemId: widget.gridItemId ?? null,
      cellNumber: widget.cellNumber ?? null,
      settingsNow,
      settingLabels,
      settingOptions,
      canInPlace: !!canInPlace,
      canSignIn: !!canSignIn,
      providers:
        widget.providers && typeof widget.providers === "object"
          ? widget.providers
          : null,
    },
  };
}

/** What the conversation saves as its `about` (AskStep): line, note, cell. */
export function makingAbout(start) {
  return start
    ? {
        label: start.label,
        text: start.text,
        note: start.note,
        ...(start.cell ? { cell: start.cell } : {}),
        ...(start.widget ? { widget: start.widget } : {}),
      }
    : null;
}

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * The registry index's public dashboards, as Start from lists them:
 * { key, packageName, name, sub } — "trops · 4 widgets · 1 bot · needs
 * Home Assistant".
 */
export function registryDashboards(index) {
  const list = Array.isArray(index)
    ? index
    : (index && Array.isArray(index.packages) && index.packages) || [];
  return list
    .filter((p) => p && p.type === "dashboard" && p.visibility !== "private")
    .map((p) => {
      const widgets = (p.widgets || []).length;
      const bots = ((p.team && p.team.members) || []).length;
      const needs = (p.providerTypes || []).map(providerLabel);
      return {
        key: `${p.scope || ""}/${p.name}`,
        packageName: p.name,
        name: p.displayName || p.name,
        sub: [
          p.scope || null,
          widgets ? plural(widgets, "widget") : null,
          bots ? plural(bots, "bot") : null,
          needs.length ? `needs ${needs.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    });
}

/**
 * A registry dashboard as a new Dash Lead conversation's seed: its plan
 * (as Create's starters made it), what the user picked, and the lead
 * asking whether to set it up.
 */
export function registrySeed(dashboard, config) {
  const plan = starterToPlan(config, { displayName: dashboard.name });
  return {
    plan,
    label: `Start from ${dashboard.name}`,
    messages: [
      { who: "you", text: `Start from ${dashboard.name}, from the registry` },
    ],
    step: { bot: "the registry", label: `Read ${dashboard.name}` },
    reply: `Here's ${dashboard.name} from the registry as a plan — it's on the right. Want me to set it up? Tell me anything to change first.`,
  };
}
