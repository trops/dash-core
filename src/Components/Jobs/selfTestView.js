/**
 * selfTestView.js — a team's self-test job in plain words (DASH-121): what
 * it skipped, said as what it would have done ("Open a PR (fix/DASH-97 →
 * main)", "Comment on DASH-97", "Wait for CI"), read from what Dash kept on
 * the job (job.skippedInTest: a blocked command, a skipped tool and its
 * args, or a skipped check); the summary at the top of a finished test job;
 * what each step skipped; and a placeholder PR link (a test opens none)
 * shown as "No PR — skipped in a test". Pure.
 */

export const NO_PR_TEXT = "No PR — skipped in a test";
export const FOR_REAL_TEXT = "To do it for real, run the team on a ticket.";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// Words kept capitalised when a tool's name is said in words.
const NAMES = {
  jira: "Jira",
  github: "GitHub",
  gitlab: "GitLab",
  confluence: "Confluence",
  slack: "Slack",
  linear: "Linear",
  notion: "Notion",
  pr: "PR",
};

/** A command's words, quotes kept together: `a "b c"` → ["a", "b c"]. */
export function commandWords(cmd) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(cmd || "")))) {
    out.push(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]);
  }
  return out;
}

/** The value after a flag: --base main / --base=main / -B main. */
function flag(words, names) {
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    for (const n of names) {
      if (w === n && i + 1 < words.length) return words[i + 1];
      if (w.startsWith(`${n}=`)) return w.slice(n.length + 1);
    }
  }
  return "";
}

/** The words that aren't flags (or a flag's value), after `from`. */
function plainWords(words, from, valued = []) {
  const out = [];
  for (let i = from; i < words.length; i += 1) {
    const w = words[i];
    if (w.startsWith("-")) {
      if (valued.includes(w)) i += 1;
      continue;
    }
    out.push(w);
  }
  return out;
}

/**
 * A blocked command as what it would have done:
 * "gh pr create --base main --head fix/DASH-97" → "Open a PR (fix/DASH-97 →
 * main)". `job`: its workspace's branch, when the command names none.
 */
export function describeCommand(cmd, job = null) {
  const text = String(cmd || "").trim();
  const all = commandWords(text);
  // Past anything before it (an env var, say): where git / gh / npm starts.
  const at = all.findIndex((w) => /^(git|gh|npm)$/.test(w));
  const w = at < 0 ? all : all.slice(at);
  const branch =
    (job && job.workspace && job.workspace.branch) ||
    (job && job.item && job.item.branch) ||
    "";
  const [tool, sub, verb] = w;
  if (tool === "git" && sub === "push") {
    const rest = plainWords(w, 2, ["-o", "--push-option", "--repo"]);
    const ref = rest[1] || branch;
    return ref ? `Push ${ref.replace(/^HEAD:/, "")}` : "Push the branch";
  }
  if (tool === "npm" && sub === "publish") return "Publish to npm";
  if (tool === "gh" && sub === "pr") {
    const num = plainWords(w, 3, ["-b", "--body", "-t", "--title"])[0];
    const the = num ? `PR ${/^\d+$/.test(num) ? `#${num}` : num}` : "the PR";
    if (verb === "create") {
      const head = flag(w, ["--head", "-H"]) || branch;
      const base = flag(w, ["--base", "-B"]);
      const where =
        head && base ? ` (${head} → ${base})` : head ? ` (${head})` : "";
      return `Open a PR${where}`;
    }
    if (verb === "merge") return `Merge ${the}`;
    if (verb === "comment") return `Comment on ${the}`;
    if (verb === "close") return `Close ${the}`;
    if (verb === "review") return `Review ${the}`;
    return `Change ${the}`;
  }
  if (tool === "gh" && sub === "issue") {
    const num = plainWords(w, 3, ["-b", "--body", "-t", "--title"])[0];
    const the = num
      ? `GitHub issue ${/^\d+$/.test(num) ? `#${num}` : num}`
      : "a GitHub issue";
    if (verb === "create") return "Create a GitHub issue";
    if (verb === "comment") return `Comment on ${the}`;
    if (verb === "close") return `Close ${the}`;
    if (verb === "edit") return `Edit ${the}`;
    return `Change ${the}`;
  }
  if (tool === "gh" && sub === "api") {
    const method = (flag(w, ["-X", "--method"]) || "").toUpperCase();
    const path = plainWords(w, 2, [
      "-X",
      "--method",
      "-f",
      "-F",
      "--field",
      "--raw-field",
      "-H",
      "--header",
      "--input",
      "-q",
      "--jq",
    ])[0];
    const what = [method, path].filter(Boolean).join(" ");
    return `Call the GitHub API${what ? ` (${what.slice(0, 80)})` : ""}`;
  }
  if (tool === "gh" && sub === "release") {
    const tag = plainWords(w, 3, ["-n", "--notes", "-t", "--title"])[0];
    return `Make a GitHub release${tag ? ` (${tag})` : ""}`;
  }
  return text ? `Run \`${text}\`` : "Run a command";
}

/** A skipped tool's args, read back (they're kept as JSON, maybe cut). */
export function readArgs(args) {
  if (isObj(args)) return args;
  const s = String(args == null ? "" : args);
  try {
    const v = JSON.parse(s);
    return isObj(v) ? v : {};
  } catch (_e) {
    // Cut off: pick out its plain "key": "value" pairs.
    const out = {};
    for (const m of s.matchAll(/"([\w-]+)"\s*:\s*("(?:[^"\\]|\\.)*"|\d+)/g)) {
      try {
        out[m[1]] = JSON.parse(m[2]);
      } catch (_e2) {
        // Not a value we can read.
      }
    }
    return out;
  }
}

const TARGET_KEYS = [
  "issueIdOrKey",
  "issueKey",
  "issue_key",
  "ticketId",
  "ticket",
  "key",
  "issue_number",
  "issueNumber",
  "pull_number",
  "pullNumber",
  "number",
  "issueId",
  "issue",
  "pageId",
  "id",
];

/** What a tool acts on, from its args: "DASH-97", "#12", or "". */
export function toolTarget(args) {
  const a = readArgs(args);
  for (const k of TARGET_KEYS) {
    const v = a[k];
    if (typeof v === "number") {
      return /number/i.test(k) ? `#${v}` : String(v);
    }
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 60);
    if (isObj(v) && typeof v.key === "string") return v.key;
  }
  return "";
}

/** "addOrEditJiraIssueComment" → ["add", "or", "edit", "Jira", "issue", …]. */
export function toolWords(name) {
  return String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NAMES[w.toLowerCase()] || w.toLowerCase());
}

const sentence = (words) => {
  const s = words.join(" ");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
};

/**
 * A skipped tool as what it would have done: addOrEditJiraIssueComment
 * {issueIdOrKey: "DASH-97"} → "Comment on DASH-97".
 */
export function describeTool(note) {
  const n = note || {};
  const name = String(n.tool || "");
  const args = readArgs(n.args);
  const target = toolTarget(args);
  const words = toolWords(name);
  const low = words.map((w) => w.toLowerCase());
  const has = (re) => low.some((w) => re.test(w));
  if (has(/^comments?$/)) return `Comment on ${target || "it"}`;
  if (has(/^transitions?$/) || (has(/^move$/) && target)) {
    const t = args.transition;
    const to =
      (isObj(t) && (t.name || t.to)) ||
      args.status ||
      args.state ||
      args.to ||
      "";
    return `Move ${target || "it"}${to ? ` to ${to}` : " along"}`;
  }
  if (has(/^merge$/)) return `Merge ${target || "it"}`;
  const text = sentence(words) || "Use a tool";
  return target ? `${text} (${target})` : text;
}

const CHECKS = { "pr-ci": "Wait for CI" };

/** One thing a test skipped, in words. */
export function describeSkip(note, job = null) {
  const n = note || {};
  if (n.command) return describeCommand(n.command, job);
  if (n.check) return CHECKS[n.check] || `Run its ${n.check} check`;
  return describeTool(n);
}

/** What Dash recorded, as is (a tooltip under the words). */
export function rawSkip(note) {
  const n = note || {};
  if (n.command) return `${n.command} (blocked in a test)`;
  if (n.check) return `${n.check} check (skipped in a test)`;
  return `${n.tool || ""} on ${n.server || ""} ${n.args || ""}`.trim();
}

const notesOf = (job) =>
  (job && job.test && Array.isArray(job.skippedInTest)
    ? job.skippedInTest
    : []
  ).filter(isObj);

/** The same thing said twice (a retried check, say) is listed once. */
function listed(notes, job) {
  const out = [];
  const seen = new Set();
  for (const n of notes) {
    const text = describeSkip(n, job);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ text, raw: rawSkip(n), botName: n.botName || null });
  }
  return out;
}

/** Everything a test job skipped: [{ text, raw, botName }], once each. */
export function skippedList(job) {
  return listed(notesOf(job), job);
}

const inTime = (at, step) => {
  if (!at || !step.startedAt) return false;
  if (at < step.startedAt) return false;
  return !step.endedAt || at <= step.endedAt;
};

/**
 * What one step of a test job skipped: its bot's notes (a note's stepId
 * when it has one), made while the step ran — any time, when that bot has
 * only the one step.
 */
export function stepSkips(job, step) {
  if (!step) return [];
  const steps = (job && job.steps) || [];
  const only = steps.filter((s) => s.botName === step.botName).length === 1;
  const notes = notesOf(job).filter((n) =>
    n.stepId
      ? n.stepId === step.id
      : n.botName === step.botName && (only || inTime(n.at, step)),
  );
  return listed(notes, job);
}

/** "Skipped in this test: Open a PR (…) · Wait for CI", or "". */
export function stepSkipsText(job, step) {
  const l = stepSkips(job, step);
  return l.length
    ? `Skipped in this test: ${l.map((s) => s.text).join(" · ")}`
    : "";
}

const plural = (n) =>
  n === 1
    ? "1 outward action was skipped"
    : `${n} outward actions were skipped`;

/**
 * The top of a finished test job: { passed, title, items, tail } or null
 * (not a test, or not finished). Done: "Self-test passed · 2 outward
 * actions were skipped", the list, then how to do it for real. Failed (or
 * stopped): its failure header stays; this is the list under it.
 */
export function selfTestSummary(job) {
  if (!job || !job.test) return null;
  const items = skippedList(job);
  // Passed only from the job's own status, and only when no step of this
  // try failed or stopped (DASH-165): a step that did nothing can't pass.
  const bad = (job.steps || []).some(
    (s) => s && (s.status === "failed" || s.status === "stopped"),
  );
  if (job.status === "done" && !bad) {
    return {
      passed: true,
      title: items.length
        ? `Self-test passed · ${plural(items.length)}`
        : "Self-test passed · nothing outward to skip",
      items,
      tail: FOR_REAL_TEXT,
    };
  }
  if (job.status === "failed" || job.status === "stopped" || bad) {
    return {
      passed: false,
      title: items.length
        ? `Skipped in this test · ${plural(items.length)}`
        : "Nothing outward was skipped before it ended",
      items,
      tail: FOR_REAL_TEXT,
    };
  }
  return null;
}

/**
 * A PR link a test made up (it opens none): github.com/<anything>/pull/0,
 * or one with no owner or repo (https://github.com///pull/0).
 */
export function isPlaceholderPr(url) {
  const m =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]*)\/([^/\s]*)\/pulls?\/(\d+)\/?$/i.exec(
      String(url || "").trim(),
    );
  if (!m) return false;
  const [, owner, repo, num] = m;
  return (
    Number(num) === 0 ||
    !owner ||
    !repo ||
    /^<.*>$/.test(owner) ||
    /^<.*>$/.test(repo)
  );
}

const URL_IN_TEXT =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/[^/\s)\]>]*\/[^/\s)\]>]*\/pulls?\/\d+\/?/gi;

/**
 * Text with a test's placeholder PR links said as "No PR — skipped in a
 * test": a Markdown link to one, an <autolink>, or the bare url.
 */
export function withoutPlaceholderPrs(text) {
  const s = String(text == null ? "" : text);
  if (!/github\.com/i.test(s)) return s;
  return s
    .replace(/\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)/g, (all, _label, url) =>
      isPlaceholderPr(url) ? NO_PR_TEXT : all,
    )
    .replace(/<([^>\s]+)>/g, (all, url) =>
      isPlaceholderPr(url) ? NO_PR_TEXT : all,
    )
    .replace(URL_IN_TEXT, (url) => (isPlaceholderPr(url) ? NO_PR_TEXT : url));
}

/**
 * A handoff card (stepView.handoffCard) in a test job: its placeholder PR
 * links said as "No PR — skipped in a test", never shown as links.
 */
export function testCard(card, job) {
  if (!card || !job || !job.test) return card;
  const fix = withoutPlaceholderPrs;
  const item =
    card.item && card.item.url && isPlaceholderPr(card.item.url)
      ? (({ url: _u, ...rest }) => rest)(card.item)
      : card.item;
  return {
    ...card,
    item,
    summary: fix(card.summary),
    question: fix(card.question),
    details: card.details.map((d) => ({ ...d, text: fix(d.text) })),
  };
}
