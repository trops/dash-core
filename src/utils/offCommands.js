/**
 * offCommands.js — commands that came with a package and are off (DASH-125).
 *
 * A check a package brings that runs something on this computer (a
 * command, a repo check, a check package) stays off until you turn it on
 * (DASH-57, DASH-102): its jobs wait for you to approve the work in its
 * place. Check setup lists them for the whole team, with one "Review and
 * turn on" that turns them all on at once.
 *
 *   offCommands(bots)       [{ botId, bot, stepId, step, command }]
 *   offCommandsLine(off)    "3 commands that came with the package are off: …"
 *   turnOnAll(checks)       the bot's checks with every one turned on
 *
 * Generic: any team, whatever its bots. Pure, no React; the main process's
 * Check setup (electron/bots/preflight.js) uses it too.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What a check that's off would run: its command, package or repo file. */
export function offCommandOf(step) {
  const c = (step && step.check) || {};
  if (c.kind === "repo" && c.name) return `.dash/checks/${c.name}`;
  return String(
    c.command || (c.fallback && c.fallback.command) || c.package || "",
  );
}

/** The team's checks that came with a package and are off, bot by bot. */
export function offCommands(bots) {
  const out = [];
  for (const bot of Array.isArray(bots) ? bots : []) {
    const steps =
      (bot && bot.checks && Array.isArray(bot.checks.steps)
        ? bot.checks.steps
        : null) || [];
    for (const s of steps) {
      if (!s || s.kind !== "check" || s.held !== true) continue;
      out.push({
        botId: bot.id == null ? null : String(bot.id),
        bot: bot.name || "A bot",
        stepId: s.id || null,
        step: s.name || "A check",
        command: offCommandOf(s) || s.name || "a command",
      });
    }
  }
  return out;
}

/**
 * The line Check setup shows (mockup 2): the commands, each bot's name
 * after its last one, and what it means until they're on. "" when none.
 */
export function offCommandsLine(off) {
  const list = Array.isArray(off) ? off : [];
  if (!list.length) return "";
  const groups = [];
  for (const o of list) {
    const last = groups[groups.length - 1];
    if (last && last.bot === o.bot) last.commands.push(o.command);
    else groups.push({ bot: o.bot, commands: [o.command] });
  }
  const what = groups
    .map((g) => `${g.commands.join(", ")} (${g.bot})`)
    .join(", ");
  const n = list.length;
  return `${plural(n, "command", "commands")} that came with the package ${n === 1 ? "is" : "are"} off: ${what}. Until ${n === 1 ? "it's" : "they're"} on, ${n === 1 ? "that check waits" : "those checks wait"} for your approval.`;
}

/** A bot's checks with every check that came with a package turned on. */
export function turnOnAll(checks) {
  if (!checks || !Array.isArray(checks.steps)) return checks;
  return {
    ...checks,
    steps: checks.steps.map((s) => {
      if (!s || s.held !== true) return s;
      const { held: _h, ...rest } = s;
      return rest;
    }),
  };
}

export default offCommands;
