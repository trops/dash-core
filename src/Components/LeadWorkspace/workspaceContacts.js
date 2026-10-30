/**
 * workspaceContacts.js — who the lead workspace can talk to (lead-workspace
 * release 2): the Dash Lead, each dashboard's lead, and each bot on no
 * dashboard. A bot on a dashboard is never a contact — its lead is. Pure.
 *
 * A contact:
 *   { key, kind: "dashlead" | "lead" | "bot", name, sub, botId,
 *     recipient (what AskStep is given; null for a lone bot),
 *     members: [{ id, name, role? }] (the bots it hands work to),
 *     line (under its name at the top of the switcher) }
 * `key` matches a conversation's `with` from Recent ("role:dashlead",
 * "lead:<botId>"); a lone bot's is "bot:<id>".
 */

// In the order they work (frame 1): the Scout looks first.
const WORK_ROLES = ["scout", "planner", "builder", "checker"];

const sameId = (a, b) =>
  a !== null &&
  a !== undefined &&
  b !== null &&
  b !== undefined &&
  String(a) === String(b);

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * @param {{ dashTeam?: object[], leads?: object[], bots?: object[] }} p
 *   dashTeam: bots.listDashTeam(); leads: bots.listLeads() (one per
 *   dashboard); bots: the user's bots (bots.list(), leads included)
 * @returns {{ label: string, items: object[] }[]} groups, empty ones left out
 */
export function contactGroups({ dashTeam = [], leads = [], bots = [] } = {}) {
  const leadsGroup = [];
  const dashLead = (dashTeam || []).find((b) => b && b.role === "dashlead");
  if (dashLead) {
    leadsGroup.push({
      key: "role:dashlead",
      kind: "dashlead",
      name: dashLead.name || "Dash Lead",
      sub: "Makes and changes things — the Dash team",
      botId: dashLead.id,
      recipient: { role: "dashlead", roleName: dashLead.name || "Dash Lead" },
      members: WORK_ROLES.map((r) =>
        (dashTeam || []).find((b) => b && b.role === r),
      )
        .filter(Boolean)
        .map((b) => ({ id: b.id, name: b.name, role: b.role })),
    });
    const d = leadsGroup[0];
    d.line = d.members.map((m) => m.name).join(" · ") || d.sub;
  }
  for (const l of leads || []) {
    if (!l || !l.botId) continue;
    const members = (bots || [])
      .filter(
        (b) => b && b.role !== "lead" && sameId(b.workspaceId, l.dashboardId),
      )
      .map((b) => ({ id: b.id, name: b.name }));
    leadsGroup.push({
      key: `lead:${l.botId}`,
      kind: "lead",
      name: l.leadName || "Team lead",
      sub: `${l.dashboardLabel || l.dashboardName || "Dashboard"} · ${plural(members.length, "bot")}`,
      botId: l.botId,
      recipient: l,
      members,
      line: members.map((m) => m.name).join(" · ") || "No bots yet",
    });
  }
  const lone = (bots || [])
    .filter(
      (b) =>
        b &&
        b.role !== "lead" &&
        !b.system &&
        (b.workspaceId === null ||
          b.workspaceId === undefined ||
          b.workspaceId === ""),
    )
    .map((b) => ({
      key: `bot:${b.id}`,
      kind: "bot",
      name: b.name || "Bot",
      sub: "A bot on no dashboard",
      botId: b.id,
      recipient: null,
      members: [],
      line: "A bot on no dashboard",
    }));
  return [
    { label: "Team leads", items: leadsGroup },
    { label: "Bots on no dashboard", items: lone },
  ].filter((g) => g.items.length);
}

/** One contact by key, from the groups; null when it's gone. */
export function findContact(groups, key) {
  for (const g of groups || []) {
    const hit = (g.items || []).find((c) => c.key === key);
    if (hit) return hit;
  }
  return null;
}

/**
 * A plan from the Create window that wasn't finished: a draft, or a build
 * that stopped, was interrupted, had problems, waits for a connection or
 * for a look at its preview. Built (or removed) ones are done.
 */
export function isUnfinishedCreatePlan(e) {
  return (
    !!e &&
    e.kind === "plan" &&
    !["built", "removed", "building"].includes(e.status)
  );
}

/**
 * A contact's conversations from Recent (questions), newest first. The
 * Dash Lead's include the questions once asked of a Dash team role (the
 * Dash team page's chat, Create's Ask — "role:planner", …): the team is
 * talked to through the Dash Lead now (release 6b), so nothing is lost —
 * and the plans started in the Create window and never finished (release
 * 6c: it's retired), to carry on with the Dash Lead.
 * @param {object[]} entries  bots.listCreateRecent()
 */
export function contactThreads(entries, key) {
  const mine = (w) =>
    w === key ||
    (key === "role:dashlead" && typeof w === "string" && w.startsWith("role:"));
  return (entries || [])
    .filter(
      (e) =>
        e &&
        e.id &&
        ((e.kind === "question" && mine(e.with)) ||
          (key === "role:dashlead" && isUnfinishedCreatePlan(e))),
    )
    .sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
    );
}
