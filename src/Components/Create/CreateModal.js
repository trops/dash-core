import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Modal,
  ThemeContext,
  FontAwesomeIcon,
  ButtonIcon,
  Button,
  Button3,
  Heading2,
  TextArea,
  SectionLabel,
  ChoiceMenu,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { BotDetail } from "../Settings/details/BotDetail";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useAiBackend } from "../../hooks/useAiBackend";
import { getWidgetBuilderRenderer } from "../../utils/widgetBuilderRenderer";
import { CreateScoutStep } from "./CreateScoutStep";
import { CreatePlanStep } from "./CreatePlanStep";
import { recentRows, recentLine } from "./recentRows";
import { StarterCards } from "./StarterCards";
import { starterPackages, starterToPlan, remixRequest } from "./starters";
import { foldCreate } from "./CreateDockPanel";
import { pickType } from "./autoType";
import { themeFromPrompt } from "./themeFromPrompt";
import {
  createTypes,
  PROMPT_PLACEHOLDER,
  RECENT_DRAFTS,
  canSend,
  draftAge,
  noAiOptions,
  normalizeCreateType,
  routeCreate,
} from "./createRouting";

// Widget config (declared `events`) by component name — the bot form's
// event picker.
const getWidgetConfig = (name) =>
  (name && ComponentManager.config(name)) || null;

const EMPTY = [];

/**
 * CreateModal — one place to start making things (create-entry PRD CRE-001,
 * CRE-005, CRE-008). A prompt box with Type and the AI under it, and a row to
 * start without AI. Send hands the prompt to the right builder:
 *
 *   Widget → the Widget Builder here (the host's, via
 *            setWidgetBuilderRenderer), the prompt as its first message;
 *            without one registered, the builder's own window
 *   Bot    → the bot form here, the prompt as its instructions
 *
 * Both open as a step inside Create: ← goes back to the start screen with the
 * prompt kept (CRE-005 AC1).
 *
 * Dashboard and Theme are listed but can't be made with AI yet; their no-AI
 * starts are always in the row below.
 *
 * @param {boolean} open
 * @param {(open: boolean) => void} setIsOpen
 * @param {string} [initialType]          "widget" | "bot"
 * @param {string|number} [workspaceId]   a new bot joins this dashboard's team
 * @param {Array<object>} [workspaces]
 * @param {(key: string) => void} onStartWithoutAi  a no-AI row key (createRouting)
 * @param {(saved: object) => void} [onBotCreated]
 * @param {() => void} [onOpenAiSettings]
 */
export const CreateModal = ({
  open,
  setIsOpen,
  initialType = "widget",
  workspaceId = null,
  workspaces = EMPTY,
  onStartWithoutAi = null,
  onBotCreated = null,
  onOpenAiSettings = null,
  // Open a widget the Scout found: ({ source, name, package }) — the host
  // shows it on the Widgets page (yours) or in the registry (to install).
  onOpenWidget = null,
  // Open a dashboard a plan build made: (workspaceId) — the live dashboard.
  onOpenDashboard = null,
  // Open on a plan conversation from Recent — Expand from the dock (4e-2).
  initialRecentId = null,
  // Open on a plan to start from — Open as a plan from Ask (5e).
  initialSeed = null,
  // Open the theme editor on a theme Create made (unsaved) — Type: Theme.
  onOpenTheme = null,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const appContext = useContext(AppContext) || {};
  const { muted, strong, hairline } = useConfigTokens();
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const ai = useAiBackend();

  const [type, setType] = useState(normalizeCreateType(initialType));
  // Type: Auto (phase 5c): { prompt } while it works out what to make, and
  // the pick it made ({ type, why, by: "ai" | "guess" }) for the header.
  const [autoStep, setAutoStep] = useState(null);
  const [autoPick, setAutoPick] = useState(null);
  // Type: Theme: { prompt, error? } while the AI makes it.
  const [themeStep, setThemeStep] = useState(null);
  // Answers that arrive after Back or Close are dropped.
  const askSeq = useRef(0);
  const [prompt, setPrompt] = useState("");
  // null = the start screen; { bot, workspaceId } = the bot form.
  const [botForm, setBotForm] = useState(null);
  // null = not building; { initialPrompt, resumeDraftId, title } = the Widget
  // Builder inside Create.
  const [builderStep, setBuilderStep] = useState(null);
  // null = no search; { prompt, detail } = the Scout looking first (slice 4).
  const [scoutStep, setScoutStep] = useState(null);
  // null = no plan; { prompt } = planning a dashboard with the Planner (4a).
  const [planStep, setPlanStep] = useState(null);
  // The plan's { recentId, busy }, for Fold (4e-2).
  const [planInfo, setPlanInfo] = useState(null);
  const [bots, setBots] = useState(EMPTY);
  // Recent (CRE-007 AC2, 4e-1): Widget Builder drafts and plan
  // conversations (summaries from the main process).
  const [drafts, setDrafts] = useState(EMPTY);
  const [recentPlans, setRecentPlans] = useState(EMPTY);
  // Starters (CRE-002, 5b): registry dashboards tagged "starter" with bots.
  const [starters, setStarters] = useState(EMPTY);

  // Each open starts fresh on the requested type.
  useEffect(() => {
    if (!open) return;
    setType(normalizeCreateType(initialType));
    setPrompt("");
    setBotForm(null);
    setBuilderStep(null);
    if (initialRecentId) {
      setPlanStep({ prompt: "", recentId: initialRecentId });
    } else if (initialSeed) {
      setPlanStep({ prompt: "", seed: initialSeed });
    }
  }, [open, initialType, initialRecentId, initialSeed]);

  // The cursor starts in the prompt (CRE-001 AC2). The dialog focuses its
  // first control (Close) on open, so take focus back right after.
  useEffect(() => {
    if (!open || botForm || builderStep) return undefined;
    const t = setTimeout(() => {
      const el = document.getElementById("create-prompt");
      if (el) el.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [open, botForm, builderStep]);

  // Recent: widget drafts (the host's drafts store) and plan conversations
  // (Create's Recent, live as builds progress). None outside the app.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const api = typeof window !== "undefined" ? window.mainApi : null;
    if (api?.drafts?.list) {
      Promise.resolve(api.drafts.list())
        .then((list) => {
          if (alive && Array.isArray(list)) setDrafts(list);
        })
        .catch(() => {});
    }
    const bots = api && api.bots;
    const loadPlans = () => {
      if (!bots || !bots.listCreateRecent) return;
      Promise.resolve(bots.listCreateRecent())
        .then((list) => {
          if (alive && Array.isArray(list)) setRecentPlans(list);
        })
        .catch(() => {});
    };
    loadPlans();
    const id =
      bots && bots.onCreateRecent ? bots.onCreateRecent(loadPlans) : null;
    return () => {
      alive = false;
      if (id != null && bots.removeListener) bots.removeListener(id);
    };
  }, [open]);

  // Starters, for Auto and Dashboard (the registry index; none offline).
  const wantsStarters = type === "auto" || type === "dashboard";
  useEffect(() => {
    if (!open || !wantsStarters) return undefined;
    let alive = true;
    const registry = window.mainApi && window.mainApi.registry;
    if (!registry || !registry.fetchIndex) return undefined;
    Promise.resolve(registry.fetchIndex())
      .then((index) => alive && setStarters(starterPackages(index)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, wantsStarters]);

  // A starter opens as a plan the Planner adapts — never built directly.
  const pickStarter = (card, pkg, config) => {
    const plan = starterToPlan(config, pkg);
    setPlanStep({
      prompt: "",
      seed: {
        plan,
        request: remixRequest(card, plan),
        label: `Start from the ${card.name} starter`,
      },
    });
  };

  // Other bots → "Another bot" events in the bot form's picker.
  useEffect(() => {
    if (!botForm) return undefined;
    let alive = true;
    const api = typeof window !== "undefined" ? window.mainApi : null;
    if (!api?.bots?.list) return undefined;
    Promise.resolve(api.bots.list())
      .then((list) => {
        if (alive && Array.isArray(list)) setBots(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [botForm]);

  if (!open) return null;

  // Closing ends any step (builder or bot form) here, so reopening starts on
  // the start screen — never a flash of the last builder, which would rerun
  // its startup (chat reset, draft resume) before the reset effect.
  const close = () => {
    askSeq.current += 1;
    setPlanStep(null);
    setScoutStep(null);
    setBuilderStep(null);
    setBotForm(null);
    setAutoStep(null);
    setAutoPick(null);
    setThemeStep(null);
    setIsOpen(false);
  };
  const sendable = canSend({ type, prompt, aiBackend: ai.effective });
  // The AI picker shows for types that ask the AI here.
  const needsAi = type === "widget" || type === "theme" || type === "auto";
  const noAi =
    (type === "widget" || type === "theme") &&
    ai.effective === null &&
    ai.cliAvailable !== null;

  const Builder = getWidgetBuilderRenderer();

  // The Widget Builder: inside Create when the host registered one, else its
  // own window (the old event).
  const openBuilder = (detail, title) => {
    if (Builder) {
      setBuilderStep({
        initialPrompt: detail.prompt || null,
        resumeDraftId: detail.resumeDraftId || null,
        title,
      });
      return;
    }
    close();
    window.dispatchEvent(
      new CustomEvent("dash:open-widget-builder", { detail }),
    );
  };

  const send = () => {
    if (!sendable) return;
    setAutoPick(null);
    perform(routeCreate({ type, prompt, workspaceId }));
  };

  // A theme from the description, opened unsaved in the theme editor.
  const makeTheme = (text) => {
    const seq = ++askSeq.current;
    setThemeStep({ prompt: text });
    themeFromPrompt(text, {
      backend: ai.effective,
      providers: appContext.providers,
    }).then(
      (theme) => {
        if (seq !== askSeq.current) return;
        close();
        if (onOpenTheme) onOpenTheme(theme);
      },
      (err) => {
        if (seq !== askSeq.current) return;
        setThemeStep({
          prompt: text,
          error: (err && err.message) || "The theme couldn't be made.",
        });
      },
    );
  };

  // Auto: work out what to make, then carry on as that type.
  const decide = (text) => {
    const seq = ++askSeq.current;
    setAutoStep({ prompt: text });
    pickType(text, {
      backend: ai.effective,
      providers: appContext.providers,
    }).then((pick) => {
      if (seq !== askSeq.current) return;
      setAutoStep(null);
      setAutoPick(pick);
      perform(routeCreate({ type: pick.type, prompt: text, workspaceId }));
    });
  };

  const perform = (action) => {
    if (!action) return;
    if (action.kind === "auto") {
      decide(action.detail.prompt);
      return;
    }
    if (action.kind === "theme") {
      makeTheme(action.detail.prompt);
      return;
    }
    if (action.kind === "widget-builder") {
      // The Scout looks for something that already does this first (CRE-009).
      if (
        action.detail &&
        action.detail.prompt &&
        typeof window !== "undefined" &&
        window.mainApi?.bots?.listDashTeam
      ) {
        setScoutStep({ prompt: action.detail.prompt, detail: action.detail });
      } else {
        openBuilder(action.detail, "New widget");
      }
    } else if (action.kind === "dashboard-plan") {
      setPlanStep({ prompt: action.detail.prompt });
    } else if (action.kind === "bot-form") {
      setBotForm({ bot: action.bot, workspaceId: action.workspaceId });
    }
  };

  const continueDraft = (draft) => {
    openBuilder({ resumeDraftId: draft.id }, draft.name || "Draft");
  };

  const recent = recentRows(recentPlans, drafts);
  const openRecent = (row) => {
    if (row.kind === "widget-draft") {
      continueDraft({ id: row.id, name: row.title });
      return;
    }
    if (row.kind === "question") {
      // Questions live in the dock (5e).
      setIsOpen(false);
      window.dispatchEvent(
        new CustomEvent("dash:create-fold", {
          detail: { recentId: row.id, title: row.title, kind: "question" },
        }),
      );
      return;
    }
    setPlanStep({ prompt: "", recentId: row.id });
  };
  const removeRecent = async (row) => {
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots || !bots.removeCreateRecent) return;
    try {
      await bots.removeCreateRecent(row.id);
    } catch (_e) {
      // the list stays as it is
    }
  };

  const startWithoutAi = (key) => {
    if (key === "blank-bot") {
      setBotForm({ bot: null, workspaceId });
      return;
    }
    close();
    if (onStartWithoutAi) onStartWithoutAi(key);
  };

  const saveBot = async (definition) => {
    const saved = await window.mainApi.bots.save(definition);
    close();
    if (onBotCreated) onBotCreated(saved);
    return saved;
  };

  const aiFooter = onOpenAiSettings ? (
    <Button3
      title="AI settings…"
      size="sm"
      onClick={() => {
        close();
        onOpenAiSettings();
      }}
    />
  ) : null;

  const start = (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl flex flex-col gap-6 px-6 py-16">
        <div className="flex flex-col gap-2">
          <Heading2 title="What do you want to make?" padding={false} />
          <p className={`text-sm ${muted}`}>
            Describe it and Dash builds it with AI, or start without AI below.
          </p>
        </div>

        <div
          className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
        >
          <TextArea
            id="create-prompt"
            aria-label="What do you want to make?"
            value={prompt}
            onChange={(value) => setPrompt(value)}
            placeholder={PROMPT_PLACEHOLDER[type] || ""}
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex flex-row flex-wrap items-center gap-2">
            <ChoiceMenu
              label="Type"
              value={type}
              options={createTypes()}
              onChange={setType}
            />
            <div className="flex-1" />
            {needsAi && (
              <ChoiceMenu
                label="AI"
                value={ai.effective}
                options={ai.options}
                onChange={ai.setPreferred}
                align="right"
                footer={aiFooter}
              />
            )}
            <Button title="Send" onClick={send} disabled={!sendable} />
          </div>
        </div>

        {noAi && (
          <div className={`flex flex-row items-center gap-2 text-sm ${muted}`}>
            <FontAwesomeIcon icon="circle-info" className="h-3.5 w-3.5" />
            <span>
              No AI is set up yet, so widgets can't be built here. Starting
              without AI still works.
            </span>
            {onOpenAiSettings && (
              <Button3
                title="Set up AI"
                size="sm"
                onClick={() => {
                  close();
                  onOpenAiSettings();
                }}
              />
            )}
          </div>
        )}

        {wantsStarters && starters.length > 0 && (
          <StarterCards starters={starters} onPick={pickStarter} />
        )}

        {recent.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="create-recent">
            <SectionLabel>Recent</SectionLabel>
            <div className="flex flex-col gap-1">
              {recent.map((row) => (
                <div
                  key={row.key}
                  className="flex flex-row items-center gap-2"
                  data-testid="recent-row"
                >
                  <Button3 size="sm" onClick={() => openRecent(row)}>
                    <span
                      className="inline-flex items-center gap-2"
                      aria-label={recentLine(row)}
                    >
                      <FontAwesomeIcon
                        icon={
                          row.kind === "plan"
                            ? "table-cells-large"
                            : row.kind === "question"
                              ? "comment"
                              : "pen-to-square"
                        }
                        className="h-3.5 w-3.5"
                      />
                      {row.title}
                      <span className={muted}>
                        · {row.status} · {draftAge(row.updatedAt)}
                      </span>
                    </span>
                  </Button3>
                  {row.kind === "plan" || row.kind === "question" ? (
                    <ButtonIcon
                      icon="xmark"
                      ariaLabel={`Remove ${row.title} from Recent`}
                      onClick={() => removeRecent(row)}
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <div className="flex flex-row flex-wrap gap-2">
              {drafts.length > RECENT_DRAFTS && (
                <Button3
                  size="sm"
                  title={`All ${drafts.length} drafts`}
                  onClick={() => startWithoutAi("widget-drafts")}
                />
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <SectionLabel>Or start without AI</SectionLabel>
          <div className="flex flex-row flex-wrap gap-2">
            {noAiOptions(type).map((o) => (
              <Button3
                key={o.key}
                size="sm"
                onClick={() => startWithoutAi(o.key)}
              >
                <span className="inline-flex items-center gap-2">
                  <FontAwesomeIcon icon={o.icon} className="h-3.5 w-3.5" />
                  {o.label}
                </span>
              </Button3>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const form = botForm && (
    <div className="flex-1 min-h-0 flex flex-col">
      <BotDetail
        key={botForm.bot ? "from-prompt" : "blank"}
        bot={botForm.bot}
        isCreating
        defaultWorkspaceId={botForm.workspaceId}
        providers={appContext.providers || {}}
        workspaces={workspaces}
        getWidgetConfig={getWidgetConfig}
        bots={bots}
        onSave={saveBot}
        onCancel={() => setBotForm(null)}
      />
    </div>
  );

  const scout = scoutStep && !builderStep && (
    <CreateScoutStep
      prompt={scoutStep.prompt}
      onBuildNew={() => {
        const { detail } = scoutStep;
        setScoutStep(null);
        openBuilder(detail, "New widget");
      }}
      onUse={(match) => {
        close();
        if (onOpenWidget) onOpenWidget(match);
      }}
    />
  );

  const planner = planStep && (
    <CreatePlanStep
      key={planStep.recentId || "new"}
      prompt={planStep.prompt}
      recentId={planStep.recentId || null}
      seed={planStep.seed || null}
      onState={setPlanInfo}
      onOpenDashboard={
        onOpenDashboard
          ? (id) => {
              close();
              onOpenDashboard(id);
            }
          : null
      }
    />
  );

  const builder = builderStep && Builder && (
    <div className="flex-1 min-h-0 flex flex-col">
      <Builder
        key={builderStep.resumeDraftId || "new"}
        initialPrompt={builderStep.initialPrompt}
        resumeDraftId={builderStep.resumeDraftId}
        onClose={close}
        onTitle={(title) =>
          title && setBuilderStep((step) => (step ? { ...step, title } : step))
        }
      />
    </div>
  );

  // A step inside Create: the builder or the bot form. ← returns to the
  // start screen (the prompt is kept).
  const stepTitle = builderStep
    ? builderStep.title || "New widget"
    : planStep
      ? "Plan a dashboard"
      : scoutStep
        ? "Looking first"
        : botForm
          ? "New bot"
          : autoStep
            ? "Deciding what to make"
            : themeStep
              ? "New theme"
              : null;
  // Fold the plan into the dock's Create panel; it carries on there (4e-2).
  const canFold = !!(planStep && planInfo && planInfo.recentId);
  const fold = () => {
    if (!canFold || planInfo.busy) return;
    foldCreate({ recentId: planInfo.recentId, title: stepTitle });
    close();
  };
  const back = () => {
    askSeq.current += 1;
    setPlanStep(null);
    setScoutStep(null);
    setBuilderStep(null);
    setBotForm(null);
    setAutoStep(null);
    setAutoPick(null);
    setThemeStep(null);
  };
  // Auto picked wrong: back to the start, the prompt kept, Type set to its
  // pick so another is one choice away.
  const changePick = () => {
    const picked = autoPick && autoPick.type;
    back();
    if (picked) setType(picked);
  };

  // Working out what to make, or making a theme: a status, and for a
  // theme that failed, why and Try again.
  const waiting = (autoStep || themeStep) && (
    <div
      className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-8"
      data-testid="create-waiting"
    >
      {themeStep && themeStep.error ? (
        <>
          <span className={`text-sm ${strong}`}>{themeStep.error}</span>
          <div className="flex flex-row gap-2">
            <Button3
              title="Try again"
              onClick={() => makeTheme(themeStep.prompt)}
            />
            <Button3 title="Back" onClick={back} />
          </div>
        </>
      ) : (
        <span className={`text-sm ${muted}`} role="status">
          {autoStep ? "Deciding what to make…" : "Making a theme…"}
        </span>
      )}
    </div>
  );

  return (
    <Modal
      isOpen={open}
      setIsOpen={(v) => (v ? setIsOpen(true) : close())}
      width="w-11/12"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full w-full rounded-lg overflow-clip border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
      >
        <div
          className={`flex-shrink-0 flex flex-row items-center justify-between px-6 py-3 border-b ${hairline}`}
        >
          <div className={`flex items-center gap-3 ${strong}`}>
            {stepTitle ? (
              <ButtonIcon icon="arrow-left" onClick={back} ariaLabel="Back" />
            ) : (
              <FontAwesomeIcon icon="plus" className="h-4 w-4 opacity-70" />
            )}
            {stepTitle ? (
              <nav
                aria-label="Where you are"
                className="flex items-center gap-2 text-lg"
              >
                <span className={muted}>Create</span>
                <span className={muted} aria-hidden="true">
                  ›
                </span>
                <span className="font-semibold">{stepTitle}</span>
                {autoPick && !autoStep ? (
                  <span
                    className={`text-sm ${muted}`}
                    data-testid="auto-pick"
                    title={autoPick.why || undefined}
                  >
                    ·{" "}
                    {autoPick.by === "ai"
                      ? "picked by Auto"
                      : "guessed by Auto"}
                  </span>
                ) : null}
              </nav>
            ) : (
              <span className="text-lg font-semibold">Create</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {autoPick && !autoStep ? (
              <Button3 title="Change" size="sm" onClick={changePick} />
            ) : null}
            {canFold ? (
              <ButtonIcon
                icon="down-left-and-up-right-to-center"
                onClick={fold}
                disabled={planInfo.busy}
                ariaLabel="Fold into the sidebar"
                title={
                  planInfo.busy
                    ? "Fold after the Planner answers"
                    : "Fold into the sidebar"
                }
              />
            ) : null}
            <ButtonIcon icon="xmark" onClick={close} ariaLabel="Close" />
          </div>
        </div>
        {builder || planner || scout || waiting || (botForm ? form : start)}
      </div>
    </Modal>
  );
};
