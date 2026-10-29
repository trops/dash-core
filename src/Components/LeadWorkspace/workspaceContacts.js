/**
 * workspaceContacts.js — who the lead workspace can talk to (lead-workspace
 * release 2): the Dash Lead, each dashboard's lead, and each bot on no
 * dashboard. A bot on a dashboard is never a contact — its lead is. Pure.
 *
 * A contact:
 *   { key, kind: "dashlead" | "lead" | "bot", name, sub, botId,
 *     recipient (what AskStep is given; null for a lone bot),
 *     members: [{ id, name }] (the bots it hands work to) }
 * `key` matches a conversation's `with` from Recent ("role:dashlead",
 * "lead:<botId>"); a lone bot's is "bot:<id>".
 */

const WORK_ROLES = ["planner", "scout", "builder", "checker"];

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
        .map((b) => ({ id: b.id, name: b.name })),
    });
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
 * A contact's conversations from Recent (questions), newest first.
 * @param {object[]} entries  bots.listCreateRecent()
 */
export function contactThreads(entries, key) {
  return (entries || [])
    .filter((e) => e && e.kind === "question" && e.id && e.with === key)
    .sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
    );
}
