/**
 * planChecklist — Before building, from the plan's structure (create-entry
 * PRD CRE-003 AC2/AC3, CRE-009 AC4/AC5; phase 4b). Pure, so the Plan step
 * stays a thin shell.
 *
 *   install   one per registry piece — reviewed and approved (installed at Build)
 *   connect   one per provider type a piece needs that the user doesn't have
 *   approve   any other step the Planner listed — the user says OK
 *   choose    a widget needs a kind of provider the user has several of,
 *             and the plan didn't name one — the user picks (never Dash)
 *
 * Nothing here installs or connects anything.
 */
import { planTarget } from "../../utils/teamPlan";
import {
  parseCron,
  TIME_OPTIONS,
  DAYS_OF_WEEK,
  DAYS_OF_MONTH,
} from "../Settings/details/cronBuilder";

// The Planner's names for provider types → the type ids Dash uses.
const ALIASES = {
  gcal: "google-calendar",
  "google calendar": "google-calendar",
  googlecalendar: "google-calendar",
  calendar: "google-calendar",
  "google drive": "google-drive",
  gdrive: "google-drive",
  email: "gmail",
  "google mail": "gmail",
  github: "github",
  gh: "github",
};

/** "Google Calendar" / "gcal" / "google-calendar" → "google-calendar". */
export function normalizeType(name) {
  const raw = String(name || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (ALIASES[raw]) return ALIASES[raw];
  const dashed = raw.replace(/\s+/g, "-");
  return ALIASES[dashed.replace(/-/g, "")] || dashed;
}

/**
 * What the user has, as the plan names it (from AppContext.providers): each
 * provider's type and its name — a plan that names one of the user's
 * providers ("Work Mail") has it, whatever its type ("custom").
 */
export function providerTypesOf(providers) {
  const list = Array.isArray(providers)
    ? providers
    : Object.values(providers || {});
  const out = new Set();
  for (const p of list) {
    // A Claude connector is for bots on the Claude subscription, never a
    // widget: it doesn't stand in for a plan's provider.
    if (!p || p.providerClass === "connector") continue;
    if (normalizeType(p.type)) out.add(normalizeType(p.type));
    if (normalizeType(p.name)) out.add(normalizeType(p.name));
  }
  return out;
}

const CONNECTOR = "connector";

/** A Claude connector's service as a plan names it: its name and its server ("claude.ai Gmail" → "gmail"). */
function connectorTypes(p) {
  const server = String((p.mcpConfig && p.mcpConfig.server) || "").replace(
    /^claude\.ai\s+/i,
    "",
  );
  return [normalizeType(p.name), normalizeType(server)].filter(Boolean);
}

/** The provider types only the plan's bots need — no widget needs them too. */
function botOnlyTypes(plan) {
  const bots = new Set();
  const others = new Set();
  for (const p of (plan && plan.pieces) || []) {
    for (const t of (p && p.providers) || []) {
      const type = normalizeType(t);
      if (type) (p.kind === "bot" ? bots : others).add(type);
    }
  }
  return new Set([...bots].filter((t) => !others.has(t)));
}

/**
 * What the user has for this plan: providerTypesOf, plus their Claude
 * connectors for the types only the plan's bots need — a bot can use one
 * (it runs on the Claude subscription), a widget never can.
 */
export function planHave(plan, providers) {
  const have = providerTypesOf(providers);
  const botOnly = botOnlyTypes(plan);
  if (!botOnly.size) return have;
  const list = Array.isArray(providers)
    ? providers
    : Object.values(providers || {});
  for (const p of list) {
    if (!p || p.providerClass !== CONNECTOR) continue;
    for (const t of connectorTypes(p)) if (botOnly.has(t)) have.add(t);
  }
  return have;
}

const titleCase = (t) =>
  String(t)
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

// Names that don't title-case well.
const PROVIDER_NAMES = {
  github: "GitHub",
  gitlab: "GitLab",
  hubspot: "HubSpot",
  websocket: "WebSocket",
};

// Claude connectors only when bots alone need the type (`bots`).
const providerList = (providers, bots = false) =>
  (Array.isArray(providers)
    ? providers
    : Object.values(providers || {})
  ).filter((p) => p && p.name && (bots || p.providerClass !== CONNECTOR));

/**
 * The user's providers to offer for a needed type, closest first: the
 * same type, then MCP servers (most plans' tools are MCP), then the rest.
 * With `bots` (only the plan's bots need it), Claude connectors too.
 * @returns {Array<{ name, type, providerClass, label }>}
 */
export function providerChoices(
  providers,
  providerType,
  { bots = false } = {},
) {
  const want = normalizeType(providerType);
  const rank = (p) =>
    normalizeType(p.type) === want ||
    normalizeType(p.name) === want ||
    (p.providerClass === CONNECTOR && connectorTypes(p).includes(want))
      ? 0
      : p.providerClass === "mcp"
        ? 1
        : 2;
  return providerList(providers, bots)
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((p) => ({
      name: p.name,
      type: p.type || "",
      providerClass: p.providerClass || null,
      label:
        p.providerClass === CONNECTOR
          ? `${p.name} · Claude connector`
          : p.type
            ? `${p.name} · ${p.type}`
            : p.name,
    }));
}

/**
 * Which of the providers made in the Connect window stands in for a needed
 * type: one of that type (or name); else the only one made; else none —
 * the user picks (adding Slack while there never replaces Gmail).
 */
export function createdFor(created, providerType) {
  const list = (created || []).filter((p) => p && p.name);
  const want = normalizeType(providerType);
  const same = list.filter(
    (p) => normalizeType(p.type) === want || normalizeType(p.name) === want,
  );
  if (same.length) return same[same.length - 1];
  return list.length === 1 ? list[0] : null;
}

/**
 * The plan using one of the user's providers wherever it needed
 * `providerType`: widgets name provider types, so they take its type; bots
 * name providers, so they take its name. The checklist, the Builder and
 * the bot's setup then all see the provider the user chose.
 */
export function choosePlanProvider(plan, providerType, provider) {
  if (!plan || !provider || !provider.name) return plan;
  const want = normalizeType(providerType);
  const matches = (t) => normalizeType(t) === want;
  const type = provider.type || provider.name;
  const pieces = (plan.pieces || []).map((p) => {
    if (!p) return p;
    let next = p;
    if (Array.isArray(p.providers) && p.providers.some(matches)) {
      // Its type, and that exact provider pinned (`provider: { type: name }`)
      // — a custom MCP server's type is just "custom", and the user may have
      // two of a type.
      const pinned = {};
      for (const [k, v] of Object.entries(
        p.provider && typeof p.provider === "object" ? p.provider : {},
      )) {
        if (!matches(k)) pinned[k] = v;
      }
      pinned[type] = provider.name;
      next = {
        ...next,
        providers: [
          ...new Set(p.providers.map((t) => (matches(t) ? type : t))),
        ],
        provider: pinned,
      };
    }
    if (
      Array.isArray(p.tools) &&
      p.tools.some((t) => t && matches(t.provider))
    ) {
      next = {
        ...next,
        tools: p.tools.map((t) =>
          t && matches(t.provider) ? { ...t, provider: provider.name } : t,
        ),
      };
    }
    return next;
  });
  return { ...plan, pieces };
}

const lowerFirst = (s) =>
  String(s).charAt(0).toLowerCase() + String(s).slice(1);

const listOf = (providers) =>
  (Array.isArray(providers)
    ? providers
    : Object.values(providers || {})
  ).filter((p) => p && p.name);

/** What a provider is, in the words the Providers page uses. */
export function providerKindLabel(p) {
  const cls = p && p.providerClass;
  if (cls === CONNECTOR) return "Claude connector";
  if (cls === "mcp") return "Tools (MCP)";
  if (cls === "websocket") return "Live feed";
  return "Credentials";
}

/** A change to a widget already placed: it keeps its connection. */
export const keepsConnection = (piece) =>
  !!piece && (piece.source === "update" || piece.source === "settings");

/**
 * The provider a widget piece is pinned to for a kind — only when the pin
 * names one of the user's providers a widget can use (not a Claude
 * connector, not one renamed or removed since).
 */
export function livePin(piece, type, providers) {
  const pins =
    piece && piece.provider && typeof piece.provider === "object"
      ? piece.provider
      : {};
  const key = Object.keys(pins).find((k) => normalizeType(k) === type);
  if (!key || typeof pins[key] !== "string") return null;
  const want = pins[key].toLowerCase();
  return (
    listOf(providers).find(
      (p) => p.providerClass !== CONNECTOR && p.name.toLowerCase() === want,
    ) || null
  );
}

// Words in a kind's name that say nothing about what it does.
const GENERIC_WORDS = new Set([
  "google",
  "microsoft",
  "mcp",
  "api",
  "server",
  "app",
  "the",
  "my",
  "custom",
]);

/** "google-calendar" → ["calendar"]; "home-assistant-mcp" → ["home", "assistant"]. */
export const kindWords = (type) =>
  normalizeType(type)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !GENERIC_WORDS.has(w));

/**
 * The user's providers that could give a widget what one kind gives — found
 * by the app, not the AI: that kind itself, or a provider whose saved tools
 * name what it's about (a calendar from Home Assistant's
 * "ha_config_get_calendar_events"). Claude connectors are included (the
 * pick list shows them off). Same kind first.
 * @returns {string[]} names
 */
export function candidatesFor(type, providers) {
  const want = normalizeType(type);
  const words = kindWords(want);
  const all = listOf(providers);
  const same = all.filter(
    (p) =>
      normalizeType(p.type) === want ||
      (p.providerClass === CONNECTOR && connectorTypes(p).includes(want)),
  );
  const byTools = all.filter((p) => {
    if (same.includes(p) || !words.length) return false;
    const tools = (Array.isArray(p.allowedTools) ? p.allowedTools : [])
      .concat(Array.isArray(p.tools) ? p.tools : [])
      .map((t) => String((t && t.name) || t).toLowerCase());
    return tools.some((t) => words.some((w) => t.includes(w)));
  });
  return [...same, ...byTools].map((p) => p.name);
}

/**
 * The kinds a widget piece needs that the user hasn't chosen a provider
 * for (widget step by step, release 1: the user always chooses). With
 * `picked` (the names the user picked in this conversation), a pin counts
 * only when it's one of those — a pin the Planner made itself doesn't; any
 * kind some provider of theirs could serve is theirs to choose. Without it
 * (an older screen), only a kind they have several of and none pinned.
 */
export function unpinnedChoices(piece, providers, picked = null) {
  if (!piece || piece.kind !== "widget" || keepsConnection(piece)) return [];
  const usable = listOf(providers).filter((p) => p.providerClass !== CONNECTOR);
  const mine = Array.isArray(picked)
    ? picked.map((n) => String(n).toLowerCase())
    : null;
  const out = [];
  for (const t of Array.isArray(piece.providers) ? piece.providers : []) {
    const type = normalizeType(t);
    if (!type || out.includes(type)) continue;
    const pin = livePin(piece, type, providers);
    if (mine) {
      if (pin && mine.includes(pin.name.toLowerCase())) continue;
      const usableNames = usable.map((p) => p.name);
      const can = candidatesFor(type, providers).filter((n) =>
        usableNames.includes(n),
      );
      if (can.length || pin) out.push(type);
      continue;
    }
    if (pin) continue;
    const same = usable.filter((p) => normalizeType(p.type) === type);
    if (same.length > 1) out.push(type);
  }
  return out;
}

/**
 * What a widget piece reads from now, by name: each kind's live pin, or
 * the user's only provider of that kind — what Change starts ticked.
 */
export function readsNow(piece, providers) {
  const usable = listOf(providers).filter((p) => p.providerClass !== CONNECTOR);
  const names = [];
  for (const t of Array.isArray(piece && piece.providers)
    ? piece.providers
    : []) {
    const type = normalizeType(t);
    if (!type) continue;
    const pin = livePin(piece, type, providers);
    const same = usable.filter((p) => normalizeType(p.type) === type);
    const p = pin || (same.length === 1 ? same[0] : null);
    if (p && !names.includes(p.name)) names.push(p.name);
  }
  return names;
}

/**
 * A provider question's rows: the providers the Planner suggested (its
 * order), and the user's others under "Show other compatible providers". A Claude
 * connector can't back a widget yet: shown, off, with why.
 * @returns {{ suggested: Row[], others: Row[] }}  Row: { name, type,
 *   providerClass, kind, off, why, reason }
 */
export function providerPickRows(
  providers,
  options = [],
  { forBots = false, reasons = null } = {},
) {
  const all = listOf(providers);
  const row = (p) => {
    const off = !forBots && p.providerClass === CONNECTOR;
    return {
      name: p.name,
      type: p.type || "",
      providerClass: p.providerClass || null,
      kind: providerKindLabel(p),
      off,
      why: off ? "Widgets can't use Claude connectors yet — bots can." : "",
      reason:
        (reasons && typeof reasons[p.name] === "string" && reasons[p.name]) ||
        "",
      isDefault: p.isDefaultForType === true,
    };
  };
  const byName = (n) =>
    all.find((p) => p.name.toLowerCase() === String(n || "").toLowerCase());
  const suggested = [];
  for (const o of Array.isArray(options) ? options : []) {
    const p = byName(o);
    if (p && !suggested.some((s) => s.name === p.name)) suggested.push(row(p));
  }
  // What can't be used here goes last.
  suggested.sort((a, b) => Number(a.off) - Number(b.off));
  const others = all
    .filter((p) => !suggested.some((s) => s.name === p.name))
    // Plain credentials (an API key) aren't something a widget reads from
    // on its own; tools and live feeds are.
    .filter((p) => p.providerClass !== "credential" || p.type)
    .map(row)
    // Only what could be used here: a widget can't use a Claude connector.
    .filter((r) => !r.off)
    .sort(
      (a, b) => Number(a.off) - Number(b.off) || a.name.localeCompare(b.name),
    );
  return { suggested, others };
}

/**
 * The user's answer to a provider question, for the Planner: the exact
 * names, and which they picked that weren't suggested (so it checks them).
 */
export function providerPickAnswer(question, picked, suggestedNames = []) {
  const names = (picked || []).map((p) => (p && p.name) || p).filter(Boolean);
  const extra = names.filter((n) => !(suggestedNames || []).includes(n));
  const head = `${question} — ${names.join(" and ")}`;
  return extra.length
    ? `${head}. (I picked ${extra.join(" and ")} myself — check ${
        extra.length === 1 ? "it" : "they"
      } can give what the widget needs, and say so if not.)`
    : head;
}

/**
 * One widget reads from the providers the user picked: its types and each
 * pinned by name. A widget the user has (reused) that read something else
 * becomes a new one — it was made for other tools.
 * @returns {{ plan, note }}
 */
export function pinWidgetProviders(plan, index, picked) {
  const pieces = (plan && plan.pieces) || [];
  const piece = pieces[index];
  const use = (picked || []).filter(
    (p) => p && p.name && p.providerClass !== CONNECTOR,
  );
  if (!piece || !use.length) return { plan, note: "" };
  // A widget reads one provider of each kind: the last one picked wins.
  const byKind = new Map();
  for (const p of use) byKind.set(normalizeType(p.type || p.name), p);
  const kept = [...byKind.values()];
  const types = kept.map((p) => p.type || p.name);
  const provider = {};
  for (const p of kept) provider[p.type || p.name] = p.name;
  const before = (Array.isArray(piece.providers) ? piece.providers : []).map(
    normalizeType,
  );
  const same =
    before.length === types.length &&
    types.every((t) => before.includes(normalizeType(t)));
  const reused = piece.source && piece.source !== "new";
  const next = { ...piece, providers: types, provider };
  if (reused && !same) {
    next.source = "new";
    delete next.package;
    delete next.component;
  }
  const names = kept.map((p) => p.name).join(" and ");
  return {
    plan: {
      ...plan,
      pieces: pieces.map((p, i) => (i === index ? next : p)),
    },
    note:
      reused && !same
        ? `${piece.name} reads from ${names} — build it new (the one I have reads something else)`
        : `${piece.name} reads from ${names}`,
  };
}

// "Leave blank for America/New_York", "(blank = 10)": what a blank answer
// means, said in the question itself.
const BLANK_MEANS = [
  /\b(?:leave|left|keep)\s+(?:it\s+)?(?:blank|empty)\s*(?:for|to\s+use|and\s+(?:it|I)(?:'ll|\s+will)\s+use|=|:)\s*(?:the\s+default\s*(?:of|:|\()?\s*)?["\u201c']?([^"\u201d'.)\n,;?]+)/i,
  /\bblank\s*(?:=|means|uses?)\s*["\u201c']?([^"\u201d'.)\n,;?]+)/i,
];

/**
 * The answer a typed question suggests: its "default", or what the
 * question says a blank means. "" when it has none (or has options).
 */
export function questionDefault(q) {
  if (!q || (Array.isArray(q.options) && q.options.length) || q.pick) return "";
  if (typeof q.default === "number") return String(q.default);
  if (typeof q.default === "string" && q.default.trim())
    return q.default.trim();
  const text = String(q.question || "");
  for (const re of BLANK_MEANS) {
    const m = text.match(re);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return "";
}

/**
 * The Planner's questions answered, as lines for it: each answer given
 * (trimmed), a typed one left blank taking its default (found live: "leave
 * blank for America/New_York" was sent as no answer, and asked again),
 * then the user's own words.
 */
export function answerLines(questions, picks = {}, own = "") {
  const lines = (questions || [])
    .map((q, i) => {
      const a =
        (picks && picks[i] != null ? String(picks[i]).trim() : "") ||
        questionDefault(q);
      return q && a ? `${q.question} — ${a}` : null;
    })
    .filter(Boolean);
  const mine = String(own || "").trim();
  return mine ? [...lines, mine] : lines;
}

/** "gmail" / "Google Calendar" / "github" → "Gmail" / "Google Calendar" / "GitHub". */
export function providerLabel(name) {
  const type = normalizeType(name);
  return PROVIDER_NAMES[type] || titleCase(type);
}

/**
 * @param {object} plan
 * @param {Set<string>} have  the user's provider types
 * @param {Array|object} [providers]  the user's providers: a widget whose
 *   provider the user hasn't picked gets a "choose"
 * @param {string[]} [picked]  provider names the user picked in this
 *   conversation (unpinnedChoices)
 * @returns {Array<{ id, kind, label, package?, providerType?, pieceIndex? }>}
 */
export function buildChecklist(
  plan,
  have = new Set(),
  providers = null,
  picked = null,
) {
  const pieces = (plan && Array.isArray(plan.pieces) && plan.pieces) || [];
  const items = [];
  const seenPkg = new Set();
  pieces.forEach((p, i) => {
    if (p && p.source === "registry" && p.package) {
      const pkg = String(p.package).split(" ")[0].split("›")[0].trim();
      if (!seenPkg.has(pkg)) {
        seenPkg.add(pkg);
        items.push({
          id: `install:${pkg}`,
          kind: "install",
          label: `Install ${p.name}`,
          package: pkg,
          pieceIndex: i,
        });
      }
    }
  });
  const seenType = new Set();
  // Only bots need it: a Claude connector can stand in.
  const botOnly = botOnlyTypes(plan);
  for (const p of pieces) {
    for (const t of (p && p.providers) || []) {
      const type = normalizeType(t);
      if (!type || have.has(type) || seenType.has(type)) continue;
      seenType.add(type);
      items.push({
        id: `connect:${type}`,
        kind: "connect",
        label: `Connect ${titleCase(type)}`,
        providerType: type,
        botsOnly: botOnly.has(type),
      });
    }
  }
  // Which provider a widget reads from: the user's pick, never a guess.
  if (providers) {
    pieces.forEach((p, i) => {
      for (const type of unpinnedChoices(p, providers, picked)) {
        items.push({
          id: `choose:${i}:${type}`,
          kind: "choose",
          label: `Choose what ${p.name || "the widget"} reads from`,
          providerType: type,
          pieceIndex: i,
        });
      }
    });
  }
  // Planner steps that aren't an install or a connect above.
  for (const b of (plan && plan.beforeBuilding) || []) {
    if (!b || b.kind !== "approve" || !b.what) continue;
    items.push({ id: `approve:${b.what}`, kind: "approve", label: b.what });
  }
  return items;
}

/** Whether an item is done: approved/OK'd, or (connect) the type now exists. */
export function isDone(item, state = {}, have = new Set()) {
  if (item.kind === "choose") return false;
  if (item.kind === "connect") {
    // Skipped: the build goes ahead and waits for it (CRE-004 AC5).
    return (
      have.has(item.providerType) ||
      state[item.id] === "done" ||
      state[item.id] === "skipped"
    );
  }
  return state[item.id] === "approved" || state[item.id] === "done";
}

/** A sign-in the user skipped and still hasn't connected. */
export function isSkipped(item, state = {}, have = new Set()) {
  return (
    item.kind === "connect" &&
    state[item.id] === "skipped" &&
    !have.has(item.providerType)
  );
}

/**
 * The Build button: names what's still open (CRE-003 AC3).
 *   "Build" · "Connect Gmail & build" · "Approve 2 installs & build" ·
 *   "Connect Gmail, approve 1 install & build"
 * A plan for a dashboard the user has (5e-2b, `targeted`) makes changes:
 *   "Make these changes" · "Connect Gmail & make these changes"
 */
export function buildButtonLabel(
  items,
  state = {},
  have = new Set(),
  { targeted = false } = {},
) {
  const verb = targeted ? "make these changes" : "build";
  const open = items.filter((it) => !isDone(it, state, have));
  if (!open.length) {
    const skipped = items.filter((it) => isSkipped(it, state, have));
    const lead = targeted ? "Make these changes" : "Build";
    if (skipped.length === 1) {
      return `${lead} without ${providerLabel(skipped[0].providerType)}`;
    }
    return skipped.length ? `${lead} without ${skipped.length} accounts` : lead;
  }
  const connects = open.filter((it) => it.kind === "connect");
  const installs = open.filter((it) => it.kind === "install");
  const others = open.filter((it) => it.kind === "approve");
  const chooses = open.filter((it) => it.kind === "choose");
  const parts = [];
  if (chooses.length === 1) parts.push(chooses[0].label);
  else if (chooses.length) {
    parts.push(`Choose what ${chooses.length} widgets read from`);
  }
  if (connects.length === 1) {
    parts.push(
      parts.length ? lowerFirst(connects[0].label) : connects[0].label,
    );
  } else if (connects.length) {
    parts.push(
      `${parts.length ? "connect" : "Connect"} ${connects.length} accounts`,
    );
  }
  if (installs.length) {
    parts.push(
      `${parts.length ? "approve" : "Approve"} ${installs.length} install${
        installs.length === 1 ? "" : "s"
      }`,
    );
  }
  if (others.length) {
    parts.push(
      `${parts.length ? "confirm" : "Confirm"} ${others.length} step${
        others.length === 1 ? "" : "s"
      }`,
    );
  }
  return `${parts.join(", ")} & ${verb}`;
}

/** The first open item — what pressing Build walks to next. */
export function nextOpen(items, state = {}, have = new Set()) {
  return items.find((it) => !isDone(it, state, have)) || null;
}

/** Where a plan piece comes from; none given means the plan makes it. */
export const pieceSource = (piece) => (piece && piece.source) || "new";

const SOURCE_WORD = {
  yours: "yours",
  "ai-built": "AI-built",
  registry: "from the registry",
  new: "new",
  update: "updated",
};

/** "1 widget and 1 bot" · "2 widgets" */
const countWords = (pieces) =>
  [
    ["widget", "widget", "widgets"],
    ["bot", "bot", "bots"],
  ]
    .map(([kind, one, many]) => {
      const n = pieces.filter((p) => p && p.kind === kind).length;
      return n ? `${n} ${n === 1 ? one : many}` : null;
    })
    .filter(Boolean)
    .join(" and ");

/**
 * "3 widgets: 1 AI-built, 2 from the registry · 1 new layout" (CRE-009 AC5).
 * A plan for a dashboard the user has (5e-2b) says what it adds there:
 * "Adds 1 widget and 1 bot to Slack Pack and applies the Nordic Frost theme".
 */
export function countsLine(plan) {
  const pieces = (plan && Array.isArray(plan.pieces) && plan.pieces) || [];
  const theme = pieces.find((p) => p && p.kind === "theme" && p.name);
  const target = planTarget(plan);
  if (target) {
    const adds = countWords(pieces);
    const out = [];
    if (adds) out.push(`Adds ${adds} to ${target.name}`);
    if (theme) {
      const which =
        theme.source === "new"
          ? `a new ${theme.name} theme`
          : `the ${theme.name} theme`;
      out.push(
        adds ? `applies ${which}` : `Applies ${which} to ${target.name}`,
      );
    }
    return out.join(" and ");
  }
  const parts = [];
  for (const [kind, one, many] of [
    ["bot", "bot", "bots"],
    ["widget", "widget", "widgets"],
    ["layout", "layout", "layouts"],
  ]) {
    const group = pieces.filter((p) => p && p.kind === kind);
    if (!group.length) continue;
    // A piece with no source (a plan's layout often has none) is one the
    // plan makes: new — not "1 undefined layout" (QA 2026-10-22).
    const bySource = {};
    for (const p of group) {
      const src = pieceSource(p);
      bySource[src] = (bySource[src] || 0) + 1;
    }
    const detail = Object.entries(bySource)
      .map(([src, n]) => `${n} ${SOURCE_WORD[src] || src}`)
      .join(", ");
    if (kind === "layout" && group.length === 1) {
      const src = pieceSource(group[0]);
      parts.push(`1 ${SOURCE_WORD[src] || src} layout`);
    } else {
      parts.push(
        `${group.length} ${group.length === 1 ? one : many}: ${detail}`,
      );
    }
  }
  if (theme) {
    parts.push(
      theme.source === "new"
        ? `a new ${theme.name} theme`
        : `the ${theme.name} theme`,
    );
  }
  return parts.join(" · ");
}

/** The plan with piece `index` replaced by a Scout match (or "new"). */
export function swapPiece(plan, index, match) {
  const pieces = [...(plan.pieces || [])];
  const old = pieces[index];
  if (!old) return plan;
  const source =
    match.source === "Yours"
      ? "yours"
      : match.source === "AI-built"
        ? "ai-built"
        : match.source === "Registry"
          ? "registry"
          : "new";
  pieces[index] = {
    ...old,
    name: match.name || old.name,
    source,
    package: source === "new" ? undefined : match.package || old.package,
    notes: match.why || old.notes,
  };
  return { ...plan, pieces };
}

/**
 * The plan without piece `index` — and without wiring that named it (a
 * removed widget no longer starts a bot; a removed bot isn't shown).
 */
export function removePiece(plan, index) {
  const gone = (plan.pieces || [])[index];
  const name = String((gone && gone.name) || "")
    .trim()
    .toLowerCase();
  const pieces = (plan.pieces || [])
    .filter((_, i) => i !== index)
    .map((p) => {
      if (!p || !gone) return p;
      if (gone.kind === "widget" && Array.isArray(p.on)) {
        const on = p.on.filter(
          (o) =>
            String((o && o.widget) || "")
              .trim()
              .toLowerCase() !== name,
        );
        return on.length === p.on.length ? p : { ...p, on };
      }
      if (gone.kind === "bot" && Array.isArray(p.listens)) {
        const listens = p.listens.filter(
          (l) =>
            String((l && l.bot) || "")
              .trim()
              .toLowerCase() !== name,
        );
        return listens.length === p.listens.length ? p : { ...p, listens };
      }
      return p;
    });
  return { ...plan, pieces };
}

const labelOf = (list, value) =>
  (list.find((o) => o.value === value) || {}).label || value;

/** "every day at 8:00 AM" — a cron in words, or the cron itself. */
export function scheduleLabel(cron) {
  const p = parseCron(cron);
  const at = p.time ? ` at ${labelOf(TIME_OPTIONS, p.time)}` : "";
  switch (p.frequency) {
    case "hourly":
      return "every hour";
    case "daily":
      return `every day${at}`;
    case "weekday":
      return `every weekday${at}`;
    case "weekly":
      return `every ${labelOf(DAYS_OF_WEEK, p.dayOfWeek)}${at}`;
    case "monthly":
      return `on the ${labelOf(DAYS_OF_MONTH, p.dayOfMonth)} of each month${at}`;
    case "off":
      return "";
    default:
      return `on the schedule ${cron}`;
  }
}

/**
 * What a planned bot does, for the plan card (phase 4d-2): what starts it,
 * what it can use, what it shows. Approving the plan saves it as it is.
 */
export function botSummary(piece) {
  const starts = [];
  for (const o of Array.isArray(piece.on) ? piece.on : []) {
    if (o && o.widget && o.event)
      starts.push(`when ${o.widget} sends ${o.event}`);
  }
  const sched = piece.schedule && piece.schedule.cron;
  if (sched) starts.push(scheduleLabel(sched));
  const uses = (Array.isArray(piece.tools) ? piece.tools : [])
    .filter((t) => t && t.provider)
    .map((t) =>
      t.tools && t.tools.length
        ? `${t.provider}: ${t.tools.join(", ")}`
        : t.provider,
    );
  const results = (Array.isArray(piece.results) ? piece.results : [])
    .map((r) => r && (r.label || r.name))
    .filter(Boolean);
  return {
    starts: starts.length
      ? `Starts ${starts.join(" or ")}`
      : "Starts when you run it",
    uses: uses.length ? `Can use ${uses.join("; ")}` : "Uses no providers",
    shows: results.length
      ? `Sends ${results.join(", ")}${piece.showResults ? " to a Bot results widget" : ""}`
      : piece.showResults
        ? "Shown in a Bot results widget"
        : "",
  };
}

/**
 * A planned bot as label / value rows for the plan card (screen audit,
 * October 2026): Runs, Uses, Sends — a labelled list, not loose lines —
 * and Runs on, when it uses one of the user's Claude connectors
 * (`connectors`, from connectorNames): the build sets it to the Claude
 * subscription.
 * @returns {{ label: string, value: string }[]}
 */
export function botDetails(piece, { connectors = null } = {}) {
  const p = piece || {};
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const starts = [];
  for (const o of Array.isArray(p.on) ? p.on : []) {
    if (o && o.widget && o.event)
      starts.push(`when ${o.widget} sends ${o.event}`);
  }
  const sched = p.schedule && p.schedule.cron;
  if (sched) starts.push(scheduleLabel(sched));
  const uses = (Array.isArray(p.tools) ? p.tools : [])
    .filter((t) => t && t.provider)
    .map((t) =>
      t.tools && t.tools.length
        ? `${t.provider}: ${t.tools.join(", ")}`
        : t.provider,
    );
  const results = (Array.isArray(p.results) ? p.results : [])
    .map((r) => r && (r.label || r.name))
    .filter(Boolean);
  const rows = [
    {
      label: "Runs",
      value: starts.length ? cap(starts.join(" or ")) : "When you run it",
    },
    { label: "Uses", value: uses.length ? uses.join("; ") : "No providers" },
  ];
  if (results.length || p.showResults) {
    rows.push({
      label: "Sends",
      value: results.length
        ? `${results.join(", ")}${p.showResults ? " → a Bot results widget" : ""}`
        : "Its results → a Bot results widget",
    });
  }
  const viaConnector =
    connectors &&
    (Array.isArray(p.tools) ? p.tools : []).find(
      (t) =>
        t && t.provider && connectors.has(String(t.provider).toLowerCase()),
    );
  if (viaConnector) {
    rows.push({
      label: "Runs on",
      value: `Your Claude subscription — ${viaConnector.provider} is a Claude connector`,
    });
  }
  return rows;
}

/** The names of the user's Claude connectors, lowercased (for botDetails). */
export function connectorNames(providers) {
  const list = Array.isArray(providers)
    ? providers
    : Object.values(providers || {});
  return new Set(
    list
      .filter((p) => p && p.name && p.providerClass === CONNECTOR)
      .map((p) => String(p.name).toLowerCase()),
  );
}

/** What the Planner is told about edits made in the panel. */
export function editNote(edits) {
  if (!edits || !edits.length) return "";
  return `(I changed the plan: ${edits.join("; ")}. Keep these changes.)`;
}
