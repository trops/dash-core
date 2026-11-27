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
    // Its team's settings with no value yet (DASH-57).
    const needs = bots.needsSettings || [];
    if (needs.length) {
      text += ` Fill in its team settings (${needs.join(", ")}) on the Bots page before turning them on.`;
    }
    // Its command checks, off until you read and turn on each (DASH-57).
    const held = bots.heldChecks || [];
    if (held.length) {
      text += ` ${held.length} command check${held.length === 1 ? " is" : "s are"} off until you turn ${held.length === 1 ? "it" : "them"} on in the bot's checks.`;
    }
  }
  return text;
}

/**
 * Does a fresh install's team still need setting up (DASH-118)? Its team
 * settings or its bots' own settings with no value yet: then the install
 * lands on the team's setup.
 */
export function needsTeamSetup(result) {
  const bots = result && result.summary && result.summary.bots;
  if (!bots || bots.error || !(result.workspace && result.workspace.id != null))
    return false;
  return (
    (Array.isArray(bots.needsSettings) && bots.needsSettings.length > 0) ||
    (Array.isArray(bots.botsNeedSettings) && bots.botsNeedSettings.length > 0)
  );
}

/**
 * After an install from the options dialog (DASH-130): "Install and open
 * Set up" lands on the team's setup whenever a team came with it; "Install,
 * fill in later" never does. With no choice made (an install that didn't
 * come from the dialog, like the retry after signing in), it lands there
 * only when something still needs filling in (DASH-118).
 */
export function opensTeamSetup(result, openSetup) {
  if (openSetup === false) return false;
  if (openSetup !== true) return needsTeamSetup(result);
  const bots = result && result.summary && result.summary.bots;
  return !!(
    bots &&
    !bots.error &&
    result.workspace &&
    result.workspace.id != null
  );
}

/**
 * The install dialog's buttons (mockup 8), after Cancel: with a team, a
 * plain install ("Install, fill in later" while a required setting is
 * still empty) and "Install and open Set up" (the main one).
 * @returns {Array<{ title: string, openSetup: boolean|undefined, primary: boolean }>}
 */
export function installButtons({ hasTeam = false, missing = false } = {}) {
  if (!hasTeam)
    return [{ title: "Install", openSetup: undefined, primary: true }];
  return [
    {
      title: missing ? "Install, fill in later" : "Install",
      openSetup: false,
      primary: false,
    },
    { title: "Install and open Set up", openSetup: true, primary: true },
  ];
}

/**
 * The install dialog's note while required settings are empty: the
 * dashboard installs anyway, and what waits until they're filled in.
 * `teamMissing` counts empty team settings, `botsWaiting` the bots with one
 * of their own still empty. Null when nothing is missing.
 */
export function installWaitingText({ teamMissing = 0, botsWaiting = 0 } = {}) {
  if (!teamMissing && !botsWaiting) return null;
  const tail = "The team's Set up shows what's left.";
  if (!teamMissing) {
    const n = botsWaiting;
    return `${n} bot${n === 1 ? "" : "s"} still need${n === 1 ? "s" : ""} settings. The dashboard installs, and ${n === 1 ? "that bot waits" : "those bots wait"} until ${n === 1 ? "it's" : "they're"} filled in. ${tail}`;
  }
  const what = botsWaiting
    ? `Team settings and ${botsWaiting} bot${botsWaiting === 1 ? "" : "s"} still need filling in.`
    : `${teamMissing} required team setting${teamMissing === 1 ? " is" : "s are"} still empty.`;
  return `${what} The dashboard installs, but its team won't take work until they're filled in. ${tail}`;
}
