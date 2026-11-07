import React, { useContext, useEffect, useState } from "react";
import {
  AlertBanner,
  Button,
  Button2,
  Button3,
  Checkbox,
  ConfirmationModal,
  InputText,
  ProgressBar,
  RadioGroup,
  SelectInput,
  StatusBadge,
  SubHeading3,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { BudgetField } from "../../Bots/BudgetField";
import { useSpending } from "../../Bots/useSpending";
import { money } from "../../Bots/spendingText";
import { BotModelsList } from "./BotModelsList";
import { useAiSettings } from "./useAiSettings";
import {
  JOB_ROWS,
  STYLE_OPTIONS,
  anyOnMostExpensive,
  cheaperDefaults,
  effectiveJobModel,
  isMostExpensive,
  perRunText,
  shortModel,
} from "./aiSettingsText";

const COST_SUFFIX = {
  planner: " a step",
  builder: " a step",
  checker: " a check",
};

/**
 * Settings › AI: what Dash's AI runs on (your Claude subscription through
 * Claude Code, or an Anthropic API key), each job's default model and style,
 * spending limits, run limits, and every bot's model in one list (Bot
 * models). The main process applies it: electron/bots/aiDefaults.js.
 */
export const AiAssistantSection = () => {
  const appContext = useContext(AppContext) || {};
  const { muted, strong, hairline } = useConfigTokens();
  const { ai, models, bots, leads, team, save, saveBot, reload } =
    useAiSettings();
  const { summary, setBudget } = useSpending();
  const [view, setView] = useState("settings");
  const [cliStatus, setCliStatus] = useState(null);
  const [confirmApi, setConfirmApi] = useState(false);
  const [useCheaper, setUseCheaper] = useState(true);
  const [error, setError] = useState(null);

  // The Anthropic API key: the Anthropic provider (Settings › Providers).
  const providers = appContext.providers || {};
  const anthropic = Object.entries(providers).find(
    ([, p]) =>
      p &&
      p.type === "anthropic" &&
      (p.providerClass || "credential") === "credential",
  );
  const hasKey = !!anthropic;

  useEffect(() => {
    const llm = window.mainApi?.llm;
    if (!llm?.checkCliAvailable) {
      setCliStatus({ available: false });
      return;
    }
    llm
      .checkCliAvailable()
      .then((r) => setCliStatus(r || { available: false }))
      .catch(() => setCliStatus({ available: false }));
  }, []);

  if (view === "bots") {
    return (
      <BotModelsList
        ai={ai}
        models={models}
        bots={bots}
        leads={leads}
        team={team}
        spending={summary}
        saveBot={saveBot}
        onChanged={reload}
        onBack={() => setView("settings")}
      />
    );
  }

  if (!ai) {
    return <span className={`text-sm ${muted}`}>Loading…</span>;
  }

  const onApi = ai.backend === "api";
  const run = async (fn) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err && err.message) || "That didn't save.");
    }
  };

  // The old app setting the Create window read; kept in step.
  const keepAppSetting = (backend) => {
    const current = appContext.settings || {};
    if (!appContext.changeSettings) return;
    appContext.changeSettings({
      ...current,
      aiAssistant: {
        ...(current.aiAssistant || {}),
        preferredBackend: backend === "api" ? "anthropic" : "claude-code",
      },
    });
  };

  const chooseBackend = (value) => {
    if (value === ai.backend) return;
    if (value === "api") {
      setUseCheaper(anyOnMostExpensive(ai, models));
      setConfirmApi(true);
      return;
    }
    run(async () => {
      await save({ backend: "subscription" });
      keepAppSetting("subscription");
    });
  };

  const switchToApi = () =>
    run(async () => {
      await save({
        backend: "api",
        ...(useCheaper ? { defaults: cheaperDefaults(models) } : {}),
      });
      keepAppSetting("api");
      setConfirmApi(false);
    });

  const ownModelBots = bots.filter((b) => b.model);
  const defaultBotModel = effectiveJobModel("bots", ai, models);
  const overall = summary && summary.overall;
  const usedPct =
    overall && overall.budget ? (overall.usd / overall.budget) * 100 : 0;

  const backendOptions = [
    {
      value: "subscription",
      label: (
        <span className="flex flex-col gap-0.5">
          <span className={`text-sm font-medium ${strong}`}>
            Your Claude subscription (Claude Code CLI)
          </span>
          <span className={`text-xs ${muted}`}>
            {cliStatus === null
              ? "Checking for Claude Code…"
              : cliStatus.available
                ? "Uses your Claude Code sign-in. Runs count toward your plan's usage, not a bill."
                : "Claude Code isn't installed on this computer."}
          </span>
        </span>
      ),
    },
    {
      value: "api",
      label: (
        <span className="flex flex-col gap-0.5">
          <span className={`text-sm font-medium ${strong}`}>
            Anthropic API key
          </span>
          <span className={`text-xs ${muted}`}>
            {hasKey
              ? "Paid per run from your Anthropic Console credits. Cheaper models for bots make them go much further."
              : "Add a key below first."}
          </span>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6" data-testid="ai-settings">
      {error ? (
        <AlertBanner variant="error" size="compact" message={error} />
      ) : null}

      <section className="flex flex-col gap-3">
        <SubHeading3 title="Run AI with" padding={false} />
        <span className={`text-sm ${muted}`}>
          Bots, dashboard leads and Create all use this.
        </span>
        <RadioGroup
          name="ai-backend"
          value={ai.backend}
          onChange={(v) => {
            if (v === "api" && !hasKey) return;
            chooseBackend(v);
          }}
          options={backendOptions}
        />
        <ApiKeyField anthropic={anthropic} appContext={appContext} />
      </section>

      <section
        className={`flex flex-col gap-2 rounded-lg border p-4 ${hairline}`}
      >
        <SubHeading3 title="Default models" padding={false} />
        <span className={`text-sm ${muted}`}>
          Used by everything that doesn&apos;t pick its own. Style sets how much
          it thinks and writes: Brief, Normal or Thorough.{" "}
          {onApi
            ? "Costs are estimates for one run on your API key."
            : "On your subscription these are included in your plan."}
        </span>
        <div className="flex flex-col" role="list">
          {JOB_ROWS.map((row) => (
            <JobRow
              key={row.job}
              row={row}
              ai={ai}
              models={models}
              onApi={onApi}
              botCount={bots.length}
              leadCount={leads.length}
              onSave={(patch) =>
                run(() => save({ defaults: { [row.job]: patch } }))
              }
            />
          ))}
        </div>
      </section>

      <section
        className={`flex flex-row items-center gap-3 rounded-lg border p-4 ${hairline}`}
      >
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <SubHeading3 title="Bot models" padding={false} />
          <span
            className={`text-sm ${muted}`}
            data-testid="ai-bot-models-summary"
          >
            {ownModelBots.length
              ? `${bots.length - ownModelBots.length} of ${bots.length} bots use the default (${shortModel(models, defaultBotModel)}). ${ownModelBots.length} ${ownModelBots.length === 1 ? "picks its" : "pick their"} own.`
              : `All ${bots.length} bots use the default (${shortModel(models, defaultBotModel)}).`}
            {isMostExpensive(models, defaultBotModel)
              ? " That's the most expensive model."
              : ""}
          </span>
        </div>
        <Button2
          title={`Review all ${bots.length} bots`}
          onClick={() => setView("bots")}
        />
      </section>

      <section
        className={`flex flex-col gap-3 rounded-lg border p-4 ${hairline}`}
        data-testid="ai-spending-limits"
      >
        <SubHeading3 title="Spending limits" padding={false} />
        <span className={`text-sm ${muted}`}>
          A month&apos;s limit, in dollars, for runs on your API key. When one
          is reached, what it covers stops until next month or until you raise
          it.
        </span>
        <div className="flex flex-col gap-1">
          <BudgetField
            label="All AI together (bots, leads and Create)"
            budget={overall ? overall.budget : null}
            onSave={(usd) => setBudget("global", null, usd)}
            testId="ai-limit-total"
          />
          {overall && overall.budget ? (
            <div className="flex flex-col gap-1 max-w-md">
              <ProgressBar value={Math.min(100, usedPct)} size="sm" />
              <span className={`text-xs ${muted}`}>
                {money(overall.usd)} used this month
              </span>
            </div>
          ) : null}
        </div>
        <BudgetField
          label="Each bot, by default (new bots start on this)"
          budget={ai.limits.perBot}
          onSave={(usd) => save({ limits: { perBot: usd } })}
          testId="ai-limit-per-bot"
        />
      </section>

      <section
        className={`flex flex-col gap-3 rounded-lg border p-4 ${hairline}`}
        data-testid="ai-run-limits"
      >
        <SubHeading3 title="Run limits" padding={false} />
        <span className={`text-sm ${muted}`}>
          Stops a single run that goes on too long, so a bot can&apos;t loop.
          The run ends with a note saying which limit it hit. A step is one tool
          use.
        </span>
        <LimitField
          label="Steps per run · bots and leads"
          hint="Most bots finish in 3–8"
          value={ai.limits.steps}
          onSave={(v) => run(() => save({ limits: { steps: v } }))}
        />
        <LimitField
          label="Steps per run · Create"
          hint="Building a widget takes more"
          value={ai.limits.createSteps}
          onSave={(v) => run(() => save({ limits: { createSteps: v } }))}
        />
        <LimitField
          label="Cost per run (US dollars, API key only)"
          hint="Stops a run that passes this, whatever its steps"
          value={ai.limits.costPerRun}
          decimal
          onSave={(v) => run(() => save({ limits: { costPerRun: v } }))}
        />
        <LimitField
          label="Time per run (minutes)"
          hint="Also stops a run stuck waiting on a tool"
          value={ai.limits.minutes}
          onSave={(v) => run(() => save({ limits: { minutes: v } }))}
        />
      </section>

      {confirmApi ? (
        <ConfirmationModal
          isOpen
          setIsOpen={() => setConfirmApi(false)}
          title="Run AI with your API key?"
          confirmLabel="Use my API key"
          onConfirm={switchToApi}
          onCancel={() => setConfirmApi(false)}
        >
          <div className="flex flex-col gap-3 text-sm" data-testid="ai-switch">
            <span className={strong}>
              These move to your Anthropic API key and are paid from your
              Console credits:
            </span>
            <div className="flex flex-col" role="list">
              {[
                [
                  `${bots.length} ${bots.length === 1 ? "bot" : "bots"}`,
                  ownModelBots.length
                    ? `${bots.length - ownModelBots.length} on the default · ${ownModelBots.length} on their own`
                    : "the default model",
                ],
                [
                  `${leads.length} dashboard ${leads.length === 1 ? "lead" : "leads"}`,
                  "the default model",
                ],
                [`Create (${team.length} roles)`, "their default models"],
              ].map(([name, what]) => (
                <div
                  key={name}
                  role="listitem"
                  className={`flex flex-row justify-between gap-3 py-1.5 border-t ${hairline}`}
                >
                  <span className={strong}>{name}</span>
                  <span className={muted}>{what}</span>
                </div>
              ))}
            </div>
            <span className={`text-xs ${muted}`}>
              Bots that picked Claude Code (CLI) themselves stay on it.
            </span>
            {anyOnMostExpensive(ai, models) ? (
              <AlertBanner
                variant="warning"
                size="compact"
                message={expensiveNote(ai, models)}
              />
            ) : null}
            <Checkbox
              label="Use cheaper defaults: Haiku for bots and leads, Sonnet for Create"
              checked={useCheaper}
              onChange={setUseCheaper}
            />
            <span className={`text-xs ${muted}`}>
              You can switch back any time.
            </span>
          </div>
        </ConfirmationModal>
      ) : null}
    </div>
  );
};

/** "Some jobs run on Opus 5.5 by default, …" — the switch dialog's warning. */
function expensiveNote(ai, models) {
  const dear = JOB_ROWS.map(({ job }) =>
    effectiveJobModel(job, ai, models),
  ).find((id) => isMostExpensive(models, id));
  const cheap = (models.find((m) => m.tier === "fast") || {}).value;
  return `Some jobs run on ${shortModel(models, dear)} by default, the most expensive model: ${perRunText(models, dear)}${cheap ? `, against ${perRunText(models, cheap)} on ${shortModel(models, cheap)}` : ""}.`;
}

/** One job's default model and style, with its cost per run. */
function JobRow({ row, ai, models, onApi, botCount, leadCount, onSave }) {
  const { muted, strong, hairline } = useConfigTokens();
  const d = ai.defaults[row.job] || {};
  const model = effectiveJobModel(row.job, ai, models);
  const sub =
    row.job === "bots"
      ? `${row.sub} · ${botCount} ${botCount === 1 ? "bot uses" : "bots use"} it`
      : row.job === "leads"
        ? `${leadCount} ${leadCount === 1 ? "lead" : "leads"} · ${row.sub.toLowerCase()}`
        : row.sub;
  const modelOptions = [
    ...(d.model
      ? []
      : [{ value: "", label: `${shortModel(models, model)} (built in)` }]),
    ...models.map((m) => ({ value: m.value, label: m.label })),
  ];
  return (
    <div
      role="listitem"
      className={`flex flex-row flex-wrap items-center gap-3 py-2 border-t ${hairline}`}
      data-testid={`ai-job-${row.job}`}
    >
      <div className="flex flex-col flex-1 min-w-0">
        <span className={`text-sm font-medium ${strong}`}>{row.name}</span>
        <span className={`text-xs ${muted}`}>{sub}</span>
      </div>
      {isMostExpensive(models, model) ? (
        <StatusBadge state="warning" label="Most expensive" />
      ) : null}
      <div className="w-48">
        <SelectInput
          ariaLabel={`${row.name} model`}
          value={d.model || ""}
          onChange={(v) => onSave({ model: v || null })}
          options={modelOptions}
        />
      </div>
      <div className="w-32">
        <SelectInput
          ariaLabel={`${row.name} style`}
          value={d.style || ""}
          onChange={(v) => onSave({ style: v || null })}
          options={[
            ...(d.style ? [] : [{ value: "", label: "Not set" }]),
            ...STYLE_OPTIONS,
          ]}
        />
      </div>
      <span className={`w-28 text-right text-xs ${muted}`}>
        {onApi
          ? perRunText(models, model, COST_SUFFIX[row.job] || " a run")
          : "Included in plan"}
      </span>
    </div>
  );
}

/** A run limit: a number, saved with Set; empty means no limit. */
function LimitField({ label, hint, value, decimal = false, onSave }) {
  const { muted } = useConfigTokens();
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const typed = text.trim();
  const n = typed === "" ? null : Number(typed.replace(/^\$/, ""));
  const invalid = typed !== "" && !(n > 0 && (decimal || Number.isInteger(n)));
  const changed = n !== value && !(n === null && value == null);
  return (
    <div className="flex flex-row flex-wrap items-end gap-2">
      <div className="w-64">
        <InputText
          label={label}
          value={text}
          onChange={(v) => setText(v)}
          placeholder="No limit"
          inputMode={decimal ? "decimal" : "numeric"}
        />
      </div>
      <Button3
        title="Set"
        size="sm"
        disabled={invalid || !changed}
        onClick={() => onSave(n)}
      />
      <span className={`text-xs ${muted} pb-2`}>
        {invalid
          ? decimal
            ? "Enter an amount, like 1 or 2.50."
            : "Enter a whole number."
          : hint}
      </span>
    </div>
  );
}

/** The Anthropic API key: add one, or replace the saved one. */
function ApiKeyField({ anthropic, appContext }) {
  const { muted } = useConfigTokens();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(null);
  const name = anthropic ? anthropic[0] : "Anthropic (AI Assistant)";
  const saveKey = () => {
    const { dashApi, credentials, refreshProviders } = appContext;
    if (!key.trim() || !dashApi || !credentials) return;
    setSaving(true);
    setNote(null);
    dashApi.saveProvider(
      credentials.appId,
      name,
      { providerType: "anthropic", credentials: { apiKey: key.trim() } },
      () => {
        setSaving(false);
        setKey("");
        setNote(anthropic ? "Key replaced." : "Key saved.");
        if (refreshProviders) refreshProviders();
      },
      () => {
        setSaving(false);
        setNote("The key didn't save. Try again.");
      },
    );
  };
  return (
    <div className="flex flex-col gap-1 pl-6" data-testid="ai-api-key">
      <div className="flex flex-row flex-wrap items-end gap-2">
        <div className="w-80">
          <InputText
            label={
              anthropic ? `Replace the key (${name})` : "Anthropic API key"
            }
            type="password"
            value={key}
            onChange={(v) => {
              setKey(v);
              setNote(null);
            }}
            placeholder={anthropic ? "Paste a new key" : "sk-ant-…"}
          />
        </div>
        <Button
          title={saving ? "Saving…" : anthropic ? "Replace key" : "Save key"}
          size="sm"
          disabled={!key.trim() || saving}
          onClick={saveKey}
        />
      </div>
      <span className={`text-xs ${muted}`} role="status">
        {note || "Stored encrypted on this computer, never shown again."}
      </span>
    </div>
  );
}

export default AiAssistantSection;
