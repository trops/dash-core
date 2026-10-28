/**
 * planChecklist — Before building, from the plan's structure (create-entry
 * PRD CRE-003 AC2/AC3, CRE-009 AC4/AC5; phase 4b). Pure, so the Plan step
 * stays a thin shell.
 *
 *   install   one per registry piece — reviewed and approved (installed at Build)
 *   connect   one per provider type a piece needs that the user doesn't have
 *   approve   any other step the Planner listed — the user says OK
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
    if (!p) continue;
    if (normalizeType(p.type)) out.add(normalizeType(p.type));
    if (normalizeType(p.name)) out.add(normalizeType(p.name));
  }
  return out;
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

const providerList = (providers) =>
  (Array.isArray(providers)
    ? providers
    : Object.values(providers || {})
  ).filter((p) => p && p.name);

/**
 * The user's providers to offer for a needed type, closest first: the
 * same type, then MCP servers (most plans' tools are MCP), then the rest.
 * @returns {Array<{ name, type, providerClass }>}
 */
export function providerChoices(providers, providerType) {
  const want = normalizeType(providerType);
  const rank = (p) =>
    normalizeType(p.type) === want || normalizeType(p.name) === want
      ? 0
      : p.providerClass === "mcp"
        ? 1
        : 2;
  return providerList(providers)
    .map((p) => ({
      name: p.name,
      type: p.type || "",
      providerClass: p.providerClass || null,
    }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
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

/** "gmail" / "Google Calendar" / "github" → "Gmail" / "Google Calendar" / "GitHub". */
export function providerLabel(name) {
  const type = normalizeType(name);
  return PROVIDER_NAMES[type] || titleCase(type);
}

/**
 * @param {object} plan
 * @param {Set<string>} have  the user's provider types
 * @returns {Array<{ id, kind, label, package?, providerType?, pieceIndex? }>}
 */
export function buildChecklist(plan, have = new Set()) {
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
      });
    }
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
  const parts = [];
  if (connects.length === 1) parts.push(connects[0].label);
  else if (connects.length) parts.push(`Connect ${connects.length} accounts`);
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
      out.push(
        adds
          ? `applies the ${theme.name} theme`
          : `Applies the ${theme.name} theme to ${target.name}`,
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
  if (theme) parts.push(`the ${theme.name} theme`);
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
 * October 2026): Runs, Uses, Sends — a labelled list, not loose lines.
 * @returns {{ label: string, value: string }[]}
 */
export function botDetails(piece) {
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
  return rows;
}

/** What the Planner is told about edits made in the panel. */
export function editNote(edits) {
  if (!edits || !edits.length) return "";
  return `(I changed the plan: ${edits.join("; ")}. Keep these changes.)`;
}
