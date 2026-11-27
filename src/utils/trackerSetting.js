/**
 * trackerSetting.js — the "tracker" setting type (DASH-135): where a bot's
 * tickets come from, picked rather than typed.
 *
 * Any bot may declare one (the Ticket Bot is the example):
 *
 *   { name: "tickets", label: "Where tickets come from", type: "tracker",
 *     required: true }
 *
 * Its value is an object:
 *
 *   { source:   "jira" | "github" | "linear" | "none",
 *     project:  Jira project key, GitHub "owner/repo", or Linear team,
 *     status:   "To Do", "open", "Todo" … ("" = any),
 *     assignee: "anyone" | "me" | "unassigned",
 *     label:    an optional label,
 *     query?:   Jira only: a JQL search that replaces the choices above,
 *     provider?: the Dash provider it was connected through, by name }
 *
 * "none" is a choice ("I'll hand it tickets myself"): the setting is filled
 * in, and the bot starts only from a task it's given.
 *
 * In a bot's text, {tickets} is the whole value in words (with the search
 * the bot can run), and {tickets.source}, {tickets.project},
 * {tickets.status}, {tickets.assignee}, {tickets.label}, {tickets.query}
 * and {tickets.provider} are its parts.
 *
 * Pure, no imports: the renderer and the main process both use it.
 */

export const TRACKER_TYPE = "tracker";
export const TRACKER_SOURCES = ["jira", "github", "linear", "none"];
export const TRACKER_ASSIGNEES = ["anyone", "me", "unassigned"];
export const TRACKER_FIELDS = [
  "source",
  "project",
  "status",
  "assignee",
  "label",
  "query",
  "provider",
];

const MAX_FIELD = 200;
const MAX_QUERY = 2000;

/** What each source is called, and what its "project" is. */
export const TRACKER_INFO = {
  jira: {
    label: "Jira",
    project: "Project",
    projectHint: "Its key, like SANDBOX",
    statuses: ["To Do", "Selected for Development", "Backlog", "In Progress"],
    // Provider types / names / connector servers that are this tracker.
    match: /jira|atlassian/i,
  },
  github: {
    label: "GitHub Issues",
    project: "Repo",
    projectHint: "owner/repo, like you/your-app",
    statuses: ["open"],
    match: /github/i,
  },
  linear: {
    label: "Linear",
    project: "Team",
    projectHint: "Its key, like ENG",
    statuses: ["Todo", "Backlog", "Triage", "In Progress"],
    match: /linear/i,
  },
  none: { label: "None", project: null, statuses: [] },
};

export const ASSIGNEE_LABELS = {
  anyone: "Anyone",
  me: "Me",
  unassigned: "Nobody (unassigned)",
};

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

/** A tracker's source label: "Jira", "GitHub Issues" … */
export function sourceLabel(source) {
  return (TRACKER_INFO[source] && TRACKER_INFO[source].label) || "";
}

/**
 * A value checked: { value } or { error }. A JSON string is read first (MCP
 * and imports may send one). Unknown fields are dropped; a query is kept for
 * Jira only.
 */
export function cleanTracker(raw, label = "Where tickets come from") {
  let input = raw;
  if (typeof input === "string") {
    const s = input.trim();
    if (TRACKER_SOURCES.includes(s.toLowerCase())) {
      input = { source: s.toLowerCase() };
    } else {
      try {
        input = JSON.parse(s);
      } catch (_e) {
        return {
          error: `${label}: must be a ticket source (jira, github, linear or none)`,
        };
      }
    }
  }
  if (!isObj(input)) {
    return {
      error: `${label}: must be a ticket source (jira, github, linear or none)`,
    };
  }
  const source = str(input.source).toLowerCase();
  if (!TRACKER_SOURCES.includes(source)) {
    return {
      error: `${label}: its source must be one of ${TRACKER_SOURCES.join(", ")}`,
    };
  }
  if (source === "none") return { value: { source } };
  const value = { source };
  for (const f of ["project", "status", "label", "provider"]) {
    const v = str(input[f]);
    if (v.length > MAX_FIELD)
      return { error: `${label}: its ${f} is too long` };
    if (v) value[f] = v;
  }
  const assignee = str(input.assignee).toLowerCase() || "anyone";
  if (!TRACKER_ASSIGNEES.includes(assignee)) {
    return {
      error: `${label}: assigned to must be one of ${TRACKER_ASSIGNEES.join(", ")}`,
    };
  }
  value.assignee = assignee;
  if (source === "github" && value.project) {
    const p = value.project
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/\/+$/, "");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(p)) {
      return { error: `${label}: the repo must be owner/repo` };
    }
    value.project = p;
  }
  if (source === "jira") {
    const q = str(input.query);
    if (q.length > MAX_QUERY) return { error: `${label}: the JQL is too long` };
    if (q) value.query = q;
  }
  return { value };
}

/**
 * What's still missing from a tracker value, or null when it's filled in:
 *   "no-source"   nothing chosen yet
 *   "no-project"  a tracker but no project / repo / team (or JQL)
 * "none" is filled in (chosen on purpose).
 */
export function trackerProblem(v) {
  if (!isObj(v) || !TRACKER_SOURCES.includes(v.source)) return "no-source";
  if (v.source === "none") return null;
  if (str(v.project)) return null;
  if (v.source === "jira" && str(v.query)) return null;
  return "no-project";
}

/** Has this tracker value nothing usable yet? */
export function trackerEmpty(v) {
  return trackerProblem(v) !== null;
}

/** The problem in words: "no project chosen" … */
export function trackerProblemText(v) {
  const p = trackerProblem(v);
  if (p === "no-source") return "no ticket source chosen";
  if (p === "no-project") {
    const what = (TRACKER_INFO[v.source] || {}).project || "project";
    return `no ${what.toLowerCase()} chosen`;
  }
  return null;
}

const jqlQuote = (s) =>
  `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const ghQuote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, "")}"` : s);

/** The Jira search the choices make (JQL), or the one typed under Advanced. */
export function trackerJql(v) {
  if (!isObj(v) || v.source !== "jira") return "";
  if (str(v.query)) return str(v.query);
  const parts = [];
  if (str(v.project)) parts.push(`project = ${jqlQuote(str(v.project))}`);
  if (str(v.status)) parts.push(`status = ${jqlQuote(str(v.status))}`);
  if (v.assignee === "me") parts.push("assignee = currentUser()");
  if (v.assignee === "unassigned") parts.push("assignee is EMPTY");
  if (str(v.label)) parts.push(`labels = ${jqlQuote(str(v.label))}`);
  if (!parts.length) return "";
  return `${parts.join(" AND ")} ORDER BY created ASC`;
}

/** The GitHub issue search the choices make ("repo:o/r is:issue is:open …"). */
export function trackerGithubQuery(v) {
  if (!isObj(v) || v.source !== "github" || !str(v.project)) return "";
  const parts = [`repo:${str(v.project)}`, "is:issue"];
  parts.push(
    str(v.status).toLowerCase() === "closed" ? "is:closed" : "is:open",
  );
  if (v.assignee === "me") parts.push("assignee:@me");
  if (v.assignee === "unassigned") parts.push("no:assignee");
  if (str(v.label)) parts.push(`label:${ghQuote(str(v.label))}`);
  return parts.join(" ");
}

/** The search for this value, in its tracker's own words ("" for none). */
export function trackerQuery(v) {
  if (!isObj(v)) return "";
  if (v.source === "jira") return trackerJql(v);
  if (v.source === "github") return trackerGithubQuery(v);
  return "";
}

/**
 * The value in words, for {name} in a bot's text. "" when empty.
 *   "Jira: project SANDBOX, status "To Do", assigned to anyone. Search (JQL):
 *    project = "SANDBOX" AND status = "To Do" ORDER BY created ASC. Use the
 *    Jira tools (provider "Jira")."
 */
export function trackerText(v) {
  if (trackerEmpty(v)) return "";
  if (v.source === "none") {
    return "None: no ticket tracker. Don't look for tickets: work only on the task you're given.";
  }
  const info = TRACKER_INFO[v.source];
  const bits = [];
  if (v.source === "jira" && str(v.query) && !str(v.project)) {
    bits.push("the tickets the search below finds");
  } else {
    bits.push(`${info.project.toLowerCase()} ${str(v.project)}`);
    if (str(v.status)) {
      bits.push(
        v.source === "github"
          ? `${str(v.status).toLowerCase()} issues`
          : `status "${str(v.status)}"`,
      );
    }
    bits.push(
      v.assignee === "me"
        ? "assigned to me"
        : v.assignee === "unassigned"
          ? "assigned to nobody"
          : "assigned to anyone",
    );
    if (str(v.label)) bits.push(`label "${str(v.label)}"`);
  }
  let out = `${info.label}: ${bits.join(", ")}.`;
  const q = trackerQuery(v);
  if (q) {
    out += ` ${v.source === "jira" ? "Search (JQL)" : "Search"}: ${q}.`;
  }
  out += str(v.provider)
    ? ` Use the ${info.label} tools (provider "${str(v.provider)}").`
    : ` Use your ${info.label} tools.`;
  return out;
}

/** Its parts for {name.field}: every field, "" when it has none. */
export function trackerFieldTexts(v) {
  const out = {};
  if (trackerEmpty(v)) return out;
  for (const f of TRACKER_FIELDS) out[f] = "";
  out.source = v.source;
  if (v.source === "none") return out;
  out.project = str(v.project);
  out.status = str(v.status);
  out.assignee = v.assignee || "anyone";
  out.label = str(v.label);
  out.query = trackerQuery(v);
  out.provider = str(v.provider);
  return out;
}

/**
 * The user's providers that are this tracker, from bots.listToolSources:
 * by type, name or Claude connector server ("Jira", "atlassian",
 * "claude.ai Linear"). Running ones first.
 */
export function trackerProviders(source, toolSources) {
  const info = TRACKER_INFO[source];
  if (!info || !info.match) return [];
  return (Array.isArray(toolSources) ? toolSources : [])
    .filter(
      (s) =>
        s &&
        info.match.test([s.type, s.name, s.server].filter(Boolean).join(" ")),
    )
    .sort((a, b) => Number(!!b.running) - Number(!!a.running));
}

/**
 * The tools Dash can call itself on a running provider of this tracker to
 * fill the pickers and the preview (stdio servers from the catalog:
 * mcp-atlassian, @modelcontextprotocol/server-github). A Claude connector,
 * or a server without these tools, gets plain fields instead.
 */
export const TRACKER_TOOLS = {
  jira: {
    projects: { tool: "jira_get_all_projects", args: () => ({}) },
    search: {
      tool: "jira_search",
      args: (v) => ({ jql: trackerJql(v), limit: 5, fields: "summary" }),
    },
  },
  github: {
    projects: null,
    search: {
      tool: "search_issues",
      args: (v) => ({ q: trackerGithubQuery(v), per_page: 5 }),
    },
  },
  linear: { projects: null, search: null },
};

/** The tool for this job ("projects" | "search") on this source, if any. */
export function trackerTool(source, job, provider) {
  const spec = TRACKER_TOOLS[source] && TRACKER_TOOLS[source][job];
  if (!spec || !provider || provider.connector || !provider.running) {
    return null;
  }
  // tools null: every tool (not listed yet), so try it.
  if (Array.isArray(provider.tools) && !provider.tools.includes(spec.tool)) {
    return null;
  }
  return spec;
}

/** An MCP callTool result's JSON (its text content, read), or null. */
function resultJson(res) {
  const r = res && (res.result || res);
  if (!r) return null;
  if (r.structuredContent && typeof r.structuredContent === "object") {
    return r.structuredContent;
  }
  const text = (Array.isArray(r.content) ? r.content : [])
    .map((c) => (c && c.type === "text" ? c.text : ""))
    .join("")
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
}

/** The first list of objects in `j` (itself, or under a known key). */
function firstList(j, keys) {
  if (Array.isArray(j)) return j;
  if (!isObj(j)) return null;
  for (const k of keys) if (Array.isArray(j[k])) return j[k];
  return null;
}

/** Projects from a projects call: [{ value, label }] (key · name). */
export function parseTrackerProjects(res) {
  const list = firstList(resultJson(res), ["projects", "values", "items"]);
  if (!list) return [];
  const out = [];
  for (const p of list) {
    if (!isObj(p)) continue;
    const key = str(p.key) || str(p.full_name);
    if (!key) continue;
    const name = str(p.name);
    out.push({
      value: key,
      label: name && name !== key ? `${key} · ${name}` : key,
    });
  }
  return out;
}

/**
 * The preview from a search call: { count, next } where next is
 * "DASH-12 Fix the login" (or null when nothing matches); null when the
 * answer can't be read.
 */
export function parseTrackerPreview(res) {
  const j = resultJson(res);
  const list = firstList(j, ["issues", "items", "nodes", "results"]);
  if (!list) return null;
  const total = isObj(j)
    ? [j.total, j.total_count, j.totalCount].find(
        (n) => typeof n === "number" && n >= 0,
      )
    : undefined;
  const count = total !== undefined ? total : list.length;
  const first = list.find(isObj) || null;
  let next = null;
  if (first) {
    const id =
      str(first.key) ||
      str(first.identifier) ||
      (first.number !== undefined ? `#${first.number}` : "");
    const title =
      str(first.summary) ||
      str(first.fields && first.fields.summary) ||
      str(first.title);
    next = [id, title].filter(Boolean).join(" ") || null;
  }
  return { count, next };
}
