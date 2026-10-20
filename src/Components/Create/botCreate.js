/**
 * botCreate.js — Create › Bot through the Dash team (consolidation Phase
 * 2c-1). The Scout looks for a bot the user has (or a registry one), else
 * the Planner plans exactly one new bot; it's checked and saved paused, on
 * the dashboard Where names or Unassigned. Kept apart from the modal so it
 * can be tested on its own.
 */
import { starterToPlan } from "./starters";

// A bot build's steps, shown as a wizard in Create's header.
export const BOT_STEPS = ["Describe", "Find", "Plan", "Build", "Done"];

/** Where a bot build is: 0 Describe … 4 Done (saved). */
export function botStepIndex({ scout, plan, buildStatus }) {
  if (buildStatus === "done") return 4;
  if (buildStatus) return 3;
  if (plan) return 2;
  if (scout) return 1;
  return 0;
}

/** Where's menu: No dashboard (Unassigned), then each dashboard. */
export function whereOptions(workspaces) {
  return [
    { value: "", label: "No dashboard" },
    ...(Array.isArray(workspaces) ? workspaces : [])
      .filter((w) => w && w.id != null)
      .map((w) => ({
        value: String(w.id),
        label: w.name || w.label || `Dashboard ${w.id}`,
      })),
  ];
}

/**
 * The plan as Where says — on that dashboard, or none; a bot with no
 * dashboard has no results card (its results stay in the Bots view).
 * @param {{ id: string, name: string } | null} where
 */
export function forWhere(plan, where) {
  if (!plan || typeof plan !== "object") return plan;
  const { dashboard: _d, ...rest } = plan;
  return {
    ...rest,
    ...(where ? { dashboard: { id: where.id, name: where.name } } : {}),
    pieces: (Array.isArray(plan.pieces) ? plan.pieces : []).map((p) =>
      p && p.kind === "bot" && !where ? { ...p, showResults: false } : p,
    ),
  };
}

/**
 * What the Planner is told: one new bot, for that dashboard or none — and
 * what Dash knows there (teamContext.contextRequest, 2c-2).
 */
export function botPlanRequest(prompt, where, context = "") {
  const place = where
    ? `It goes on the user's "${where.name}" dashboard: set "dashboard": {"id": "${where.id}", "name": "${where.name}"}. Unless the user said, ask whether to show its results on ${where.name} (a results card) or keep them in the Bots view, and set showResults from the answer.`
    : "It isn't on a dashboard: leave dashboard out, and set showResults false — its results stay in the Bots view.";
  return `${prompt}\n\n(Plan exactly one new bot — no widgets, layout or theme. ${place} Give it everything a new bot needs: instructions, only the tools it needs from the user's providers, a schedule if it runs on its own. It's saved paused; the user tries it with Try it now right after it's saved, then turns it on. Write what the user reads in plain words — no cron expressions or code.)${context ? `\n\n${context}` : ""}`;
}

/** What the Scout is asked: bots that already do it (with what Dash knows). */
export function scoutBotRequest(prompt, context = "") {
  return `Find bots that already do this: "${prompt}". Search with search_library with what: "bots". End with the bots that fit as <matches>, each with "kind": "bot" and package set to the bot's id for one of theirs, or its dashboard package for a registry one; start its why with where it is ("on Work", "Unassigned", "in the Inbox Triage package"). If nothing fits, say so in a sentence or two — the Planner plans a new one next, so don't tell the user who to ask. A bot already on that dashboard isn't a match to copy there — say it already does this instead.${context ? `\n\n${context}` : ""}`;
}

/**
 * One of the user's bots as the plan's one bot: a copy, saved new. Beside
 * the original (same dashboard, or both Unassigned) it's "<name> (copy)".
 * Its results card is the user's call (the Planner asks), and what started
 * it on events doesn't come along — the note says so.
 */
export function pieceFromBot(bot, where) {
  const b = bot || {};
  const selections = b.toolSelections || {};
  const schedule = (Array.isArray(b.schedules) ? b.schedules : []).find(
    (s) => s && s.cron,
  );
  const samePlace =
    String(b.workspaceId == null ? "" : b.workspaceId) ===
    String(where ? where.id : "");
  const onEvents = (Array.isArray(b.subscriptions) ? b.subscriptions : [])
    .length;
  return {
    kind: "bot",
    name: samePlace ? `${b.name} (copy)` : b.name,
    source: "new",
    instructions: b.instructions || "",
    tools: (Array.isArray(b.mcpServers) ? b.mcpServers : []).map((name) => ({
      provider: name,
      tools: Array.isArray(selections[name]) ? selections[name] : [],
    })),
    ...(schedule ? { schedule: { cron: schedule.cron } } : {}),
    results: (Array.isArray(b.publishes) ? b.publishes : []).map((p) => ({
      name: p.name,
      ...(p.label ? { label: p.label } : {}),
    })),
    showResults: false,
    notes: onEvents
      ? `A copy of your ${b.name} bot. It also ran on events; this copy runs on its schedule or when you start it.`
      : `A copy of your ${b.name} bot`,
  };
}

/** A registry bot: the one with that name in its dashboard package. */
export function pieceFromStarter(config, pkg, name) {
  const plan = starterToPlan(config, pkg || {});
  const piece = (plan.pieces || []).find(
    (p) =>
      p &&
      p.kind === "bot" &&
      String(p.name || "").toLowerCase() === String(name || "").toLowerCase(),
  );
  if (!piece) return null;
  // Its package's widget events aren't here to start it: it runs on its
  // schedule or when started. Its results card is the user's call.
  const { on: _on, ...rest } = piece;
  return {
    ...rest,
    showResults: false,
    notes: `From the ${(pkg && pkg.displayName) || (config && config.name) || "registry"} dashboard package`,
  };
}

/** A found bot as the plan, shown at once — nothing to ask the Planner. */
export function botSeed(piece, where) {
  const label = where
    ? `Use ${piece.name} on ${where.name}`
    : `Use a copy of ${piece.name}`;
  return {
    plan: {
      summary: label,
      ...(where ? { dashboard: { id: where.id, name: where.name } } : {}),
      pieces: [piece],
    },
    request: null,
    label,
  };
}
