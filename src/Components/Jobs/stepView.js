/**
 * stepView.js — a job step as a bot's message (DASH-123): its prose (the
 * Markdown of its answer) and its handoff (DASH-101) as a card, the raw
 * JSON only on request. Pure.
 *
 * A step finished since DASH-123 keeps the two apart (step.summary is the
 * prose, step.handoff the object; electron/jobs/stepAnswer.js). An older
 * step's summary is one clipped line with the handoff's JSON in it: that
 * JSON is taken out (and read, when it's whole), never shown as text.
 */

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// Dash's own handoff keys (electron/bots/botHandoff.js); the rest is the
// bot's data for the next bot.
const OWN_KEYS = new Set([
  "status",
  "item",
  "workspace",
  "question",
  "items",
  "summary",
  "picks",
  "clipped",
]);

const tryJson = (t) => {
  try {
    const v = JSON.parse(t);
    return isObj(v) ? v : null;
  } catch (_e) {
    return null;
  }
};

/**
 * An older step's summary split: { prose, handoff, cut }. `cut`: it had a
 * json block that was cut off (or doesn't parse), so it's left out.
 */
export function splitStepText(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) return { prose: "", handoff: null, cut: false };
  const whole = /^[{[]/.test(s) ? tryJson(s) : null;
  if (whole) return { prose: "", handoff: whole, cut: false };
  // The last fence that opens a json (or bare, then "{") block.
  const opens = [...s.matchAll(/```(json|jsonc)?[ \t]*(?=\s*\{)/gi)];
  if (!opens.length) {
    // Cut off before its fence had a "{": "```json" alone at the end.
    const bare = /```(?:jsonc?)?\s*$/i.exec(s);
    const odd = (s.match(/```/g) || []).length % 2 === 1;
    return bare && odd
      ? { prose: s.slice(0, bare.index).trim(), handoff: null, cut: true }
      : { prose: s, handoff: null, cut: false };
  }
  const open = opens[opens.length - 1];
  const from = open.index;
  const body = s.slice(from + open[0].length);
  const close = body.indexOf("```");
  const before = s.slice(0, from).trim();
  if (close < 0) return { prose: before, handoff: null, cut: true };
  const after = body.slice(close + 3).trim();
  const handoff = tryJson(body.slice(0, close).trim());
  return {
    prose: [before, after].filter(Boolean).join("\n\n"),
    handoff,
    cut: !handoff,
  };
}

/** A step's message: { prose, handoff, cut }. */
export function stepParts(step) {
  if (!step) return { prose: "", handoff: null, cut: false };
  if (isObj(step.handoff)) {
    return {
      prose: String(step.summary || "").trim(),
      handoff: step.handoff,
      cut: false,
    };
  }
  return splitStepText(step.summary);
}

/**
 * Text shortened at a word boundary: { text, cut }. Never mid-word; an
 * ellipsis marks the cut.
 */
export function shortenText(text, max = 280) {
  const s = String(text == null ? "" : text).trim();
  if (s.length <= max) return { text: s, cut: false };
  const head = s.slice(0, max + 1);
  const space = head.search(/\s\S*$/);
  const at = space > max * 0.5 ? space : max;
  return { text: `${s.slice(0, at).replace(/[\s,;:.–-]+$/, "")}…`, cut: true };
}

/**
 * Markdown shortened at a word boundary, never inside a ``` block (a cut
 * that would land in one is moved to before it): { text, cut }.
 */
export function shortenMarkdown(text, max = 700) {
  const s = String(text == null ? "" : text).trim();
  if (s.length <= max) return { text: s, cut: false };
  const short = shortenText(s, max);
  let at = short.text.length - 1; // without its "…"
  // An odd number of fences before the cut: it's inside a block.
  const fences = [...s.slice(0, at).matchAll(/```/g)];
  if (fences.length % 2 === 1) {
    at = fences[fences.length - 1].index;
    const kept = s.slice(0, at).trim();
    // A block right at the start: show up to the end of it instead.
    if (!kept) {
      const end = s.indexOf("```", fences[0].index + 3);
      return end < 0
        ? { text: s, cut: false }
        : { text: s.slice(0, end + 3), cut: end + 3 < s.length };
    }
    return { text: `${kept}\n\n…`, cut: true };
  }
  return short;
}

const STATUS = {
  ok: { label: "Handed on", word: "OK", tone: "success" },
  none: { label: "Handoff", word: "Nothing to do", tone: null },
  ask: { label: "Handoff", word: "Asks you", tone: "warning" },
  split: { label: "Handoff", word: "Split into items", tone: "info" },
};

const ITEM_WORDS = {
  jira: "Ticket",
  linear: "Ticket",
  github: "Issue",
  gitlab: "Issue",
  obsidian: "Note",
  notion: "Page",
};

const DETAIL_WORDS = {
  body: "Details",
  description: "Details",
  details: "Details",
  notes: "Notes",
  note: "Note",
};

/** "next_step" → "Next step". */
export function keyLabel(key) {
  const k = String(key || "");
  if (DETAIL_WORDS[k.toLowerCase()]) return DETAIL_WORDS[k.toLowerCase()];
  const words = k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

const plain = (v) =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

const itemOf = (v) => {
  if (typeof v === "string" || typeof v === "number") {
    return String(v).trim() ? { id: String(v).trim() } : null;
  }
  if (!isObj(v) || !plain(v.id) || !String(v.id).trim()) return null;
  const out = { id: String(v.id).trim() };
  if (typeof v.title === "string" && v.title.trim()) out.title = v.title.trim();
  if (typeof v.url === "string" && /^https?:\/\/\S+$/i.test(v.url.trim())) {
    out.url = v.url.trim();
  }
  if (typeof v.source === "string" && v.source.trim()) {
    out.source = v.source.trim().toLowerCase();
  }
  return out;
};

const workspaceOf = (v) => {
  const raw = typeof v === "string" ? { dir: v } : v;
  if (!isObj(raw) || typeof raw.dir !== "string" || !raw.dir.trim()) {
    return null;
  }
  const out = { dir: raw.dir.trim() };
  if (typeof raw.branch === "string" && raw.branch.trim()) {
    out.branch = raw.branch.trim();
  }
  return out;
};

/** "/a/b/c" → "…/c" (the whole path is the row's tooltip). */
export function shortDir(dir) {
  const parts = String(dir || "")
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean);
  if (parts.length <= 1) return String(dir || "");
  return `…/${parts[parts.length - 1]}`;
}

/**
 * What Dash carries from the job to every bot it starts, whatever its
 * handoff says (electron/jobs/jobContext.js withEventContext: the job's
 * item and workspace go into each completed/failed event): { item?,
 * workspace? }, or null when the job has neither.
 */
export function carriedFields(job) {
  if (!isObj(job)) return null;
  const out = {};
  const item = itemOf(job.item);
  if (item) out.item = item;
  const workspace = workspaceOf(job.workspace);
  if (workspace) out.workspace = workspace;
  return Object.keys(out).length ? out : null;
}

const workspaceRow = (ws) =>
  ws && {
    ...ws,
    text: ws.branch ? `${shortDir(ws.dir)} on ${ws.branch}` : shortDir(ws.dir),
  };

/**
 * A handoff as its card's rows (null for none):
 * { status: { label, word, tone }, item: { id, title?, url?, label } | null,
 *   workspace: { dir, branch?, text } | null, summary, question,
 *   items: string[], picks: [{ name, value }],
 *   details: [{ key, label, text }], clipped,
 *   fromJob: { item?, workspace? } | null }
 *
 * The rows up to `clipped` are what the bot wrote; `fromJob` is what Dash
 * carries from the job (carriedFields), shown apart — a bot's own value
 * for the same key stays in its own rows.
 *
 * `job`: its work item fills in a url the handoff lacks; its picks (the
 * team's table names) say which top-level keys are picks.
 */
export function handoffCard(handoff, job = null) {
  if (!isObj(handoff)) return null;
  const h = handoff;
  const s = typeof h.status === "string" ? h.status.trim().toLowerCase() : "";
  const status = STATUS[s || "ok"] || {
    label: "Handoff",
    word: String(h.status),
    tone: "error",
  };
  let item = itemOf(h.item);
  const jobItem = job && itemOf(job.item);
  if (item && jobItem && jobItem.id === item.id) {
    item = { ...jobItem, ...item };
  }
  if (item) item.label = ITEM_WORDS[item.source] || "Item";
  const tables = new Set(Object.keys((job && job.picks) || {}));
  const picks = [];
  if (isObj(h.picks)) {
    for (const [name, v] of Object.entries(h.picks)) {
      if (plain(v) && String(v).trim()) picks.push({ name, value: String(v) });
    }
  }
  const details = [];
  for (const [key, v] of Object.entries(h)) {
    if (OWN_KEYS.has(key)) continue;
    if (tables.has(key) && plain(v)) {
      if (!picks.some((p) => p.name === key)) {
        picks.push({ name: key, value: String(v) });
      }
      continue;
    }
    if (plain(v) && String(v).trim()) {
      details.push({ key, label: keyLabel(key), text: String(v).trim() });
    }
  }
  const items = Array.isArray(h.items)
    ? h.items
        .map((x) => itemOf(x))
        .filter(Boolean)
        .map((x) => (x.title ? `${x.id} · ${x.title}` : x.id))
    : [];
  const carried = carriedFields(job);
  let fromJob = null;
  if (carried) {
    fromJob = {};
    if (carried.item) {
      fromJob.item = {
        ...carried.item,
        label: ITEM_WORDS[carried.item.source] || "Item",
      };
    }
    if (carried.workspace) fromJob.workspace = workspaceRow(carried.workspace);
  }
  return {
    status,
    item,
    workspace: workspaceRow(workspaceOf(h.workspace)),
    summary: typeof h.summary === "string" ? h.summary.trim() : "",
    question: typeof h.question === "string" ? h.question.trim() : "",
    items,
    picks,
    details,
    clipped: !!h.clipped,
    fromJob,
  };
}

/** What the job carries (carriedFields), pretty-printed; "" for nothing. */
export function carriedJson(job) {
  const c = carriedFields(job);
  return c ? JSON.stringify(c, null, 2) : "";
}

/** The handoff, pretty-printed for "Show handoff JSON". */
export function handoffJson(handoff) {
  try {
    return JSON.stringify(handoff, null, 2);
  } catch (_e) {
    return "";
  }
}
