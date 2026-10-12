/**
 * dashboardBots.js — a registry dashboard's bots in words (create-entry
 * phase 5a-2, bot-factory US-027 AC3/AC8): the lines shown before installing
 * and the message after.
 */

const EVENT_WORDS = (ev) =>
  ev === "completed"
    ? "finishes"
    : ev === "failed"
      ? "fails"
      : String(ev || "").startsWith("result.")
        ? `sends its ${ev.slice(7)} result`
        : `uses ${String(ev || "").replace(/^tool\./, "")}`;

/**
 * The registry's team summary as lines: one per bot ("Greeter"), plus how
 * they work together ("Poster runs when Greeter sends its greeting result").
 * @returns {{ bots: string[], links: string[] }}
 */
export function teamLines(team) {
  const members = (team && Array.isArray(team.members) && team.members) || [];
  const names = Object.fromEntries(members.map((m) => [m.role, m.name]));
  return {
    bots: members.map((m) => m.name),
    links: ((team && team.wiring) || []).map(
      (w) =>
        `${names[w.role] || w.role} runs when ${
          names[w.on.role] || w.on.role
        } ${EVENT_WORDS(w.on.event)}`,
    ),
  };
}

/** After installing: the dashboard, and its bots (paused) when it had any. */
export function installedText(result, fallbackName) {
  const name =
    (result && result.workspace && result.workspace.name) || fallbackName;
  let text = `Dashboard "${name}" installed successfully.`;
  const bots = result && result.summary && result.summary.bots;
  if (bots && bots.error) {
    text += ` Its bots couldn't be added: ${bots.error}`;
  } else if (bots && Array.isArray(bots.installed) && bots.installed.length) {
    const n = bots.installed.length;
    text += ` ${n} bot${n === 1 ? "" : "s"} added — paused; resume them on the Bots page.`;
    const unwired = bots.unwired || [];
    if (unwired.length) text += ` Not wired: ${unwired.join("; ")}.`;
  }
  return text;
}
