/**
 * TeamSetupChecklist — "Set up this team" at the top of a team's page
 * (DASH-120, mockup 2). A numbered checklist, done top to bottom, each step
 * with its state:
 *
 *   1. Bots that need something from you: a card per bot with a required
 *      setting of its own (DASH-136), its fields right there, with "Open its
 *      settings ›". One Save for all of them (the unsaved bar). The team's
 *      old settings (DASH-57), when it declares some, sit under the cards.
 *   2. Check setup: its problems, each with "Go to it".
 *   3. Repo checks: only when the team has repos.
 *   4. Run a self-test.
 *
 * Generic: any team, whatever its bots.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Button3,
  FontAwesomeIcon,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotAvatar } from "./BotAvatar";
import {
  TeamSettingsForm,
  TeamSettingsPanel,
  emptySettings,
} from "./TeamSettingsForm";
import { selfTestLine, setupView, SELF_TEST_HELP } from "./TeamJobSettings";
import {
  RepoChecksRows,
  repoChecksSummary,
  useRepoChecks,
} from "./TeamChecksPanel";
import {
  lastSetupCheck,
  noteSetupChanged,
  onSetupChanged,
  rememberSetupCheck,
} from "./teamSetupStore";
import {
  botSetupCards,
  cardState,
  checklistLine,
  checklistSteps,
  draftChanged,
  selfTestBlock,
  testItemField,
} from "../../utils/teamChecklist";
import { onJobsChanged } from "../../hooks/useJobs";

/** The Jobs page, open on a job (DashboardStage's `dash:open-page`). */
export function openJob(jobId) {
  if (typeof window === "undefined" || !jobId) return;
  window.dispatchEvent(
    new CustomEvent("dash:open-page", { detail: { page: "jobs", jobId } }),
  );
}

const botsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

export const CHECK_SETUP_HELP =
  "Dash checks each bot's providers and AI login start, its required settings have values, and the repos it uses can be reached.";
export const REPO_CHECKS_HELP =
  "Each repo keeps the commands that prove a change works (set up, then validate) in .dash/checks.";
export const SETTINGS_HELP =
  "Each bot keeps the settings for its own job. These are the ones with a required setting. The same fields are on each bot's Settings tab.";

/** A step: its number (a tick when done), title, state and body. */
const Step = ({ n, step, help, children, testId }) => {
  const { muted, hairline } = useConfigTokens();
  const status = useStatusTokens();
  return (
    <div
      className={`flex flex-row gap-3 px-4 py-4 border-t first:border-t-0 ${hairline}`}
      data-testid={testId}
      data-done={step.done ? "true" : "false"}
    >
      <span
        className={`flex-shrink-0 w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold ${
          step.done
            ? `${status.success.border} ${status.success.text}`
            : hairline
        }`}
        aria-label={step.done ? "Done" : `Step ${n}`}
      >
        {step.done ? <FontAwesomeIcon icon="check" /> : n}
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="flex flex-row flex-wrap items-start gap-2">
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-sm font-semibold">{step.title}</span>
            {help ? <span className={`text-xs ${muted}`}>{help}</span> : null}
          </span>
          <StatusBadge
            state={step.done ? "success" : "neutral"}
            label={step.state}
          />
        </div>
        {children}
      </div>
    </div>
  );
};

/** One bot's card in step 1: its settings, editable here. */
const BotSetupCard = ({
  card,
  bot,
  workspaceId,
  onChange,
  onOpen,
  cardRef,
}) => {
  const { muted, hairline } = useConfigTokens();
  return (
    <div
      ref={cardRef}
      className={`flex flex-col gap-3 rounded-xl border p-4 ${hairline}`}
      data-testid={`setup-bot-card-${card.botId}`}
    >
      <div className="flex flex-row items-center gap-3">
        <BotAvatar bot={bot || { name: card.name }} />
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{card.name}</span>
          {card.about ? (
            <span className={`text-xs ${muted}`}>{card.about}</span>
          ) : null}
        </span>
        <StatusBadge
          state={card.ready ? "success" : "warning"}
          label={cardState(card)}
        />
      </div>
      <TeamSettingsForm
        settings={card.declared}
        values={card.values}
        botName={card.name}
        workspaceId={workspaceId}
        onChange={(name, v) => onChange({ ...card.values, [name]: v })}
      />
      {onOpen ? (
        <div>
          <Button3
            title={`Open ${card.name}'s settings ›`}
            size="sm"
            onClick={onOpen}
          />
        </div>
      ) : null}
    </div>
  );
};

/**
 * @param {string|number} workspaceId  the team's dashboard
 * @param {object[]} bots   the team's bots, as saved
 * @param {(botId) => void} [onOpenBotSettings]  a bot's Settings tab
 * @param {() => void} [onBotsChanged]  after a bot's settings were saved
 * @param {(dirty: boolean) => void} [onDirtyChange]  unsaved bot settings
 */
export const TeamSetupChecklist = ({
  workspaceId,
  bots = [],
  onOpenBotSettings = null,
  onBotsChanged = null,
  onDirtyChange = null,
}) => {
  const { muted, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const current = useRef(workspaceId);
  current.current = workspaceId;

  // --- Step 1: the bots' settings, as edited here ---
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState([]);
  const byId = useMemo(
    () => new Map((bots || []).map((b) => [String(b.id), b])),
    [bots],
  );
  // Only drafts that differ from what's saved count.
  const changed = Object.keys(drafts).filter((id) => {
    const b = byId.get(id);
    return !!b && draftChanged(b.settingValues, drafts[id]);
  });
  const dirty = changed.length > 0;
  const cards = botSetupCards(bots, drafts);
  const savedCards = botSetupCards(bots);
  const cardRefs = useRef({});
  const membersCount = (bots || []).filter(
    (b) => b && b.role !== "lead" && b.system !== "dash-team",
  ).length;
  const others = membersCount - cards.length;

  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    if (onDirtyRef.current) onDirtyRef.current(dirty);
  }, [dirty]);
  // A team change starts clean.
  useEffect(() => {
    setDrafts({});
    setSaveErrors([]);
  }, [workspaceId]);
  useEffect(
    () => () => {
      if (onDirtyRef.current) onDirtyRef.current(false);
    },
    [],
  );

  const discard = () => {
    setDrafts({});
    setSaveErrors([]);
  };
  const save = async () => {
    const api = botsApi();
    if (!api || !api.save) {
      setSaveErrors(["Saving a bot's settings needs a newer Dash."]);
      return;
    }
    setSaving(true);
    setSaveErrors([]);
    const errors = [];
    const done = [];
    for (const id of changed) {
      const b = byId.get(id);
      try {
        await api.save({ id: b.id, settingValues: drafts[id] });
        done.push(id);
      } catch (e) {
        errors.push((e && e.message) || `${b.name || "A bot"} wasn't saved.`);
      }
    }
    setSaving(false);
    if (current.current !== workspaceId) return;
    setDrafts((d) => {
      const next = { ...d };
      for (const id of done) delete next[id];
      return next;
    });
    setSaveErrors(errors);
    if (done.length) {
      noteSetupChanged(workspaceId);
      if (onBotsChanged) onBotsChanged();
    }
  };

  // The team's old settings (DASH-57): how many are empty.
  const [teamEmpty, setTeamEmpty] = useState(0);
  const [teamDeclared, setTeamDeclared] = useState([]);
  // The team's settings: its test item, last self-test, untested change.
  const [teamSettings, setTeamSettings] = useState(null);
  const [check, setCheck] = useState(() => lastSetupCheck(workspaceId));
  useEffect(() => {
    let alive = true;
    const api = botsApi();
    setCheck(lastSetupCheck(workspaceId));
    const load = () => {
      if (!api || workspaceId == null) return;
      if (api.getTeamSettings) {
        Promise.resolve(api.getTeamSettings(workspaceId))
          .then((s) => {
            if (!alive) return;
            setTeamSettings(s || null);
          })
          .catch(() => {});
      }
      if (api.getTeamValues) {
        Promise.resolve(api.getTeamValues(workspaceId))
          .then((t) => {
            if (!alive) return;
            const declared =
              (t && Array.isArray(t.declared) && t.declared) || [];
            setTeamDeclared(declared);
            setTeamEmpty(emptySettings(declared, (t && t.values) || {}).length);
          })
          .catch(() => {});
      }
    };
    load();
    const off = onSetupChanged((id) => {
      if (!alive || id !== String(workspaceId)) return;
      setCheck(lastSetupCheck(workspaceId));
      load();
    });
    // A self-test that ended done: tested now (DASH-121).
    const offJobs = onJobsChanged((msg) => {
      if (!alive || String(msg.workspaceId) !== String(workspaceId)) return;
      if (msg.status === "done" || msg.status === "failed") load();
    });
    return () => {
      alive = false;
      off();
      offJobs();
    };
  }, [workspaceId]);

  // --- Step 2: Check setup ---
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(null);
  const checkSetup = async () => {
    const api = botsApi();
    setCheckError(null);
    if (!api || !api.checkSetup) {
      setCheckError("This version of Dash can't check a setup yet.");
      return null;
    }
    setChecking(true);
    try {
      const r = await api.checkSetup(workspaceId);
      // The team's setup status everywhere counts it (DASH-119).
      rememberSetupCheck(workspaceId, r);
      if (current.current === workspaceId) {
        if (r && r.error) setCheckError(r.error);
        setCheck(lastSetupCheck(workspaceId));
      }
      return r || null;
    } catch (err) {
      if (current.current === workspaceId)
        setCheckError((err && err.message) || "Couldn't check it.");
      return null;
    } finally {
      if (current.current === workspaceId) setChecking(false);
    }
  };
  const shown = setupView(check);
  const goTo = (p) => {
    if (!p || p.botId == null) return null;
    const el = cardRefs.current[String(p.botId)];
    if (el && typeof el.scrollIntoView === "function") {
      return () => el.scrollIntoView({ block: "center" });
    }
    return onOpenBotSettings ? () => onOpenBotSettings(p.botId) : null;
  };

  // --- Step 3: repo checks ---
  const repoData = useRepoChecks(workspaceId);
  const repos = repoChecksSummary(repoData);

  // --- Step 4: the self-test (DASH-121) ---
  // It checks the setup first and, when that passes, starts the test and
  // opens its job on the Jobs page.
  const [testId, setTestId] = useState("");
  const [testNote, setTestNote] = useState(null);
  const [testing, setTesting] = useState(false);
  const [started, setStarted] = useState(null);
  useEffect(() => {
    setTestId(
      (teamSettings && teamSettings.testItem && teamSettings.testItem.id) || "",
    );
  }, [teamSettings && teamSettings.testItem && teamSettings.testItem.id]);
  const field = testItemField({ bots, team: { declared: teamDeclared } });
  const blocked = selfTestBlock({
    waiting: savedCards.filter((c) => !c.ready).length,
    teamEmpty,
    dirty,
    check,
    item: testId,
  });
  const runTest = async () => {
    const api = botsApi();
    if (!api || !api.testTeam) {
      setTestNote("This version of Dash can't run a self-test yet.");
      return;
    }
    setTestNote(null);
    setStarted(null);
    setTesting(true);
    try {
      // The setup as it is now, not as it was at the last check.
      const r0 = await checkSetup();
      if (!r0 || r0.error || r0.ok === false) {
        const n = (r0 && Array.isArray(r0.problems) && r0.problems.length) || 0;
        setTestNote(
          n
            ? `Not started: fix the ${n} problem${n === 1 ? "" : "s"} in step 2 first.`
            : "Not started: Check setup didn't pass.",
        );
        return;
      }
      const want = testId.trim();
      const saved = teamSettings && teamSettings.testItem;
      if (want && (!saved || saved.id !== want)) {
        const s = await api.setTestItem(workspaceId, { id: want });
        if (s && s.error) throw new Error(s.error);
        setTeamSettings(s);
      }
      const r = await api.testTeam(workspaceId);
      if (r && r.error) throw new Error(r.error);
      setStarted(r || null);
      setTestNote(`The self-test started on ${r.item.id}.`);
      if (r && r.jobId) openJob(r.jobId);
    } catch (e) {
      setTestNote((e && e.message) || "Couldn't start it.");
    } finally {
      setTesting(false);
    }
  };

  const { steps, done, total } = checklistSteps({
    cards: savedCards,
    teamEmpty,
    check,
    repos,
    test: teamSettings,
  });
  // A team that's all set up keeps its steps folded away, a click away.
  const allDone = done >= total && !dirty;
  const [expanded, setExpanded] = useState(false);
  const open = !allDone || expanded;
  const stepOf = (key) => steps.find((s) => s.key === key);
  const numberOf = (key) => steps.findIndex((s) => s.key === key) + 1;

  return (
    <section
      aria-label="Set up"
      data-testid="team-setup-checklist"
      className="flex flex-col gap-2"
    >
      <div className="flex flex-row flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Set up this team</span>
        <span
          className={`flex-1 min-w-0 text-xs ${muted}`}
          data-testid="setup-progress"
        >
          {checklistLine({ done, total })}
        </span>
        {allDone ? (
          <Button3
            title={open ? "Hide steps" : "Show steps"}
            size="sm"
            onClick={() => setExpanded(!open)}
          />
        ) : null}
      </div>
      {!open ? null : (
        <div className={`flex flex-col rounded-xl border ${hairline}`}>
          <Step
            n={numberOf("settings")}
            step={stepOf("settings")}
            help={cards.length ? SETTINGS_HELP : null}
            testId="setup-step-settings"
          >
            {cards.map((c) => (
              <BotSetupCard
                key={c.botId}
                card={c}
                bot={byId.get(String(c.botId))}
                workspaceId={workspaceId}
                cardRef={(el) => {
                  cardRefs.current[String(c.botId)] = el;
                }}
                onChange={(values) =>
                  setDrafts((d) => ({ ...d, [String(c.botId)]: values }))
                }
                onOpen={
                  onOpenBotSettings ? () => onOpenBotSettings(c.botId) : null
                }
              />
            ))}
            {cards.length && others > 0 ? (
              <span className={`text-xs ${muted}`}>
                {`The other ${others} bot${others === 1 ? " has" : "s have"} nothing required. Their settings are on their own pages.`}
              </span>
            ) : null}
            {!cards.length ? (
              <span className={`text-xs ${muted}`}>
                No bot on this team has a required setting. Each bot's settings
                are on its own page.
              </span>
            ) : null}
            {dirty || saveErrors.length ? (
              <div
                role="status"
                data-testid="setup-unsaved-bar"
                className={`flex flex-row flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${status.warning.border}`}
              >
                <span className="flex-1 min-w-0 text-xs">
                  {dirty
                    ? "You have unsaved changes."
                    : "Some settings weren't saved."}
                </span>
                <Button3
                  title="Discard"
                  size="sm"
                  disabled={saving}
                  onClick={discard}
                />
                <Button
                  title={saving ? "Saving…" : "Save"}
                  size="sm"
                  disabled={saving || !dirty}
                  onClick={save}
                />
              </div>
            ) : null}
            {saveErrors.map((e, i) => (
              <span key={i} className={`text-xs ${status.error.text}`}>
                {e}
              </span>
            ))}
            {/* The team's own settings (DASH-57), when it declares some. */}
            <TeamSettingsPanel
              key={String(workspaceId)}
              workspaceId={workspaceId}
            />
          </Step>
          <Step
            n={numberOf("check")}
            step={stepOf("check")}
            help={CHECK_SETUP_HELP}
            testId="team-setup-check"
          >
            <div>
              <Button
                title={checking ? "Checking…" : "Check setup"}
                size="sm"
                onClick={checking ? undefined : checkSetup}
              />
            </div>
            {checkError ? (
              <span className={`text-xs ${status.error.text}`}>
                {checkError}
              </span>
            ) : null}
            {shown && !shown.ok ? (
              <div
                className="flex flex-col gap-1 text-xs"
                data-testid="setup-result"
              >
                <span className="font-semibold">{shown.title}</span>
                {(check.problems || []).map((p, i) => {
                  const go = goTo(p);
                  return (
                    <span
                      key={i}
                      className="flex flex-row flex-wrap items-center gap-2"
                    >
                      <span className="flex-1 min-w-0">{p.message}</span>
                      {go ? (
                        <Button3 title="Go to it" size="sm" onClick={go} />
                      ) : null}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </Step>
          {repos.shown ? (
            <Step
              n={numberOf("repos")}
              step={stepOf("repos")}
              help={REPO_CHECKS_HELP}
              testId="setup-step-repos"
            >
              <RepoChecksRows data={repoData} />
            </Step>
          ) : null}
          <Step
            n={numberOf("test")}
            step={stepOf("test")}
            help={SELF_TEST_HELP}
            testId="team-self-test"
          >
            <span className="text-xs" data-testid="self-test-line">
              {selfTestLine(teamSettings)}
            </span>
            <div className="flex flex-row flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium">{field.label}</span>
                <input
                  aria-label={field.label}
                  className={`w-64 text-sm px-2 py-1 rounded border bg-transparent ${hairline}`}
                  placeholder={field.placeholder}
                  value={testId}
                  onChange={(e) => setTestId(e.target.value)}
                />
              </label>
              <Button
                title={testing ? "Checking setup…" : "Run self-test"}
                size="sm"
                disabled={!!blocked || testing}
                onClick={blocked || testing ? undefined : runTest}
              />
            </div>
            {blocked && !testNote ? (
              <span
                className={`text-xs ${muted}`}
                data-testid="self-test-blocked"
              >
                {blocked}
              </span>
            ) : null}
            {testNote ? (
              <span
                className="flex flex-row flex-wrap items-center gap-2 text-xs"
                data-testid="self-test-note"
              >
                <span>{testNote}</span>
                {started && started.jobId ? (
                  <Button3
                    title="Open the job ›"
                    size="sm"
                    onClick={() => openJob(started.jobId)}
                  />
                ) : null}
              </span>
            ) : null}
          </Step>
        </div>
      )}
    </section>
  );
};

export default TeamSetupChecklist;
