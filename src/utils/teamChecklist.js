/**
 * teamChecklist.js — the team page's "Set up this team" checklist
 * (DASH-120, mockup 2): what each step says and whether it's done.
 *
 *   1. Bots that need something from you: a card per bot with required
 *      settings of its own (DASH-136), and the team's old settings if any
 *   2. Check setup
 *   3. Repo checks (only when the team has repos)
 *   4. Run a self-test
 *
 * Generic: any team, whatever its bots. Pure, no React.
 */
import { botMissingSettings, settingsOfBot } from "./botSettings";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const skipped = (b) => !b || b.role === "lead" || b.system === "dash-team";
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * One card per bot that has a required setting of its own, or one of its
 * own that's empty and used: the bot's settings as the user is editing them
 * (`drafts[botId]`, else as saved), and what's still empty.
 * @param {object[]} bots   the team's bots, as saved
 * @param {object} [drafts] { [botId]: settingValues } being edited
 * @returns {{ botId, name, about, declared, values, missing, ready, dirty }[]}
 */
export function botSetupCards(bots, drafts = {}) {
  const out = [];
  for (const bot of Array.isArray(bots) ? bots : []) {
    if (skipped(bot)) continue;
    const own = settingsOfBot(bot);
    if (!own.declared.length) continue;
    const key = String(bot.id);
    const dirty = isObj(drafts) && isObj(drafts[key]);
    const values = dirty ? drafts[key] : own.values;
    const missing = botMissingSettings(
      { ...bot, settingValues: values },
      null,
    ).filter((m) => m.owner === "bot");
    const savedMissing = dirty
      ? botMissingSettings(bot, null).filter((m) => m.owner === "bot")
      : missing;
    const required = own.declared.some((s) => s.required === true);
    if (!required && !missing.length && !savedMissing.length) continue;
    out.push({
      botId: bot.id,
      name: bot.name || bot.id,
      about: typeof bot.description === "string" ? bot.description : "",
      declared: own.declared,
      values,
      missing,
      ready: missing.length === 0,
      dirty,
    });
  }
  return out;
}

/** "1 to fill in" / "✓ Ready" for a card. */
export function cardState(card) {
  if (!card) return "";
  return card.ready ? "✓ Ready" : `${card.missing.length} to fill in`;
}

/** Has a draft changed anything from the saved values? */
export function draftChanged(saved, draft) {
  const a = isObj(saved) ? saved : {};
  const b = isObj(draft) ? draft : {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return true;
  }
  return false;
}

/**
 * The steps, each { key, title, done, state }, and how many are done.
 * @param {object} p
 * @param {object[]} p.cards       botSetupCards (as saved: drafts don't count)
 * @param {number} [p.teamEmpty]   team settings with no value (old, DASH-57)
 * @param {object|null} [p.check]  the last Check setup ({ ok, problems })
 * @param {object|null} [p.repos]  { shown, missing, closed } repo checks:
 *   shown when the team has repos; missing = repos with no checks;
 *   closed = team checks whose PR was closed without merging
 * @param {object|null} [p.test]   the team's settings ({ lastTest, untested })
 */
export function checklistSteps({
  cards = [],
  teamEmpty = 0,
  check = null,
  repos = null,
  test = null,
} = {}) {
  const steps = [];
  const waiting = cards.filter((c) => !c.ready).length;
  steps.push({
    key: "settings",
    title: "Bots that need something from you",
    done: waiting === 0 && !teamEmpty,
    state:
      waiting || teamEmpty
        ? [
            waiting ? plural(waiting, "bot to fill in", "bots to fill in") : "",
            teamEmpty
              ? plural(teamEmpty, "team setting", "team settings") + " empty"
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "Nothing to fill in",
  });
  const n = check && Array.isArray(check.problems) ? check.problems.length : 0;
  steps.push({
    key: "check",
    title: "Check setup",
    done: !!(check && check.ok === true),
    state: !check
      ? "Not checked yet"
      : check.ok
        ? "The setup is good"
        : plural(n, "problem", "problems") + " to fix",
  });
  if (repos && repos.shown) {
    const missing = repos.missing || 0;
    const closed = repos.closed || 0;
    steps.push({
      key: "repos",
      title: "Repo checks",
      done: !missing && !closed,
      state: missing
        ? plural(missing, "repo has", "repos have") + " no checks yet"
        : closed
          ? plural(closed, "check needs", "checks need") + " a choice"
          : "Every repo has its checks",
    });
  }
  const tested = !!(test && test.lastTest && test.lastTest.at);
  const untested = !!(test && test.untested);
  steps.push({
    key: "test",
    title: "Run a self-test",
    done: tested && !untested,
    state: untested ? "Untested change" : tested ? "Tested" : "Not tested yet",
  });
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length };
}

/** "1 of 4 done · do them in order" / "All 4 done". */
export function checklistLine({ done, total }) {
  return done >= total
    ? `All ${total} done`
    : `${done} of ${total} done · do them in order`;
}

export default checklistSteps;
