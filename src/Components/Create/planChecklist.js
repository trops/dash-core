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

/** The provider types the user has (from AppContext.providers). */
export function providerTypesOf(providers) {
  const list = Array.isArray(providers)
    ? providers
    : Object.values(providers || {});
  return new Set(list.map((p) => normalizeType(p && p.type)).filter(Boolean));
}

const titleCase = (t) =>
  String(t)
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

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
    return have.has(item.providerType) || state[item.id] === "done";
  }
  return state[item.id] === "approved" || state[item.id] === "done";
}

/**
 * The Build button: names what's still open (CRE-003 AC3).
 *   "Build" · "Connect Gmail & build" · "Approve 2 installs & build" ·
 *   "Connect Gmail, approve 1 install & build"
 */
export function buildButtonLabel(items, state = {}, have = new Set()) {
  const open = items.filter((it) => !isDone(it, state, have));
  if (!open.length) return "Build";
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
  return `${parts.join(", ")} & build`;
}

/** The first open item — what pressing Build walks to next. */
export function nextOpen(items, state = {}, have = new Set()) {
  return items.find((it) => !isDone(it, state, have)) || null;
}

const SOURCE_WORD = {
  yours: "yours",
  "ai-built": "AI-built",
  registry: "from the registry",
  new: "new",
  update: "updated",
};

/** "3 widgets: 1 AI-built, 2 from the registry · 1 new layout" (CRE-009 AC5). */
export function countsLine(plan) {
  const pieces = (plan && Array.isArray(plan.pieces) && plan.pieces) || [];
  const parts = [];
  for (const [kind, one, many] of [
    ["bot", "bot", "bots"],
    ["widget", "widget", "widgets"],
    ["layout", "layout", "layouts"],
  ]) {
    const group = pieces.filter((p) => p && p.kind === kind);
    if (!group.length) continue;
    const bySource = {};
    for (const p of group) bySource[p.source] = (bySource[p.source] || 0) + 1;
    const detail = Object.entries(bySource)
      .map(([src, n]) => `${n} ${SOURCE_WORD[src] || src}`)
      .join(", ");
    if (kind === "layout" && group.length === 1) {
      parts.push(`1 ${SOURCE_WORD[group[0].source] || group[0].source} layout`);
    } else {
      parts.push(
        `${group.length} ${group.length === 1 ? one : many}: ${detail}`,
      );
    }
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

/** What the Planner is told about edits made in the panel. */
export function editNote(edits) {
  if (!edits || !edits.length) return "";
  return `(I changed the plan: ${edits.join("; ")}. Keep these changes.)`;
}
