import React, { useContext, useEffect, useState } from "react";
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
import {
  CREATE_TYPES,
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
 *   Widget → the Widget Builder, the prompt as its first message
 *   Bot    → the bot form here, the prompt as its instructions
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
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const appContext = useContext(AppContext) || {};
  const { muted, strong, hairline } = useConfigTokens();
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const ai = useAiBackend();

  const [type, setType] = useState(normalizeCreateType(initialType));
  const [prompt, setPrompt] = useState("");
  // null = the start screen; { bot, workspaceId } = the bot form.
  const [botForm, setBotForm] = useState(null);
  const [bots, setBots] = useState(EMPTY);
  // Recent Widget Builder drafts (newest first) — "Continue a draft".
  const [drafts, setDrafts] = useState(EMPTY);

  // Each open starts fresh on the requested type.
  useEffect(() => {
    if (!open) return;
    setType(normalizeCreateType(initialType));
    setPrompt("");
    setBotForm(null);
  }, [open, initialType]);

  // The cursor starts in the prompt (CRE-001 AC2). The dialog focuses its
  // first control (Close) on open, so take focus back right after.
  useEffect(() => {
    if (!open || botForm) return undefined;
    const t = setTimeout(() => {
      const el = document.getElementById("create-prompt");
      if (el) el.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [open, botForm]);

  // Widget drafts to continue (the host's drafts store; none outside the
  // app).
  useEffect(() => {
    if (!open || type !== "widget") return undefined;
    let alive = true;
    const api = typeof window !== "undefined" ? window.mainApi : null;
    if (!api?.drafts?.list) return undefined;
    Promise.resolve(api.drafts.list())
      .then((list) => {
        if (alive && Array.isArray(list)) setDrafts(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, type]);

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

  const close = () => setIsOpen(false);
  const sendable = canSend({ type, prompt, aiBackend: ai.effective });
  const needsAi = type === "widget";
  const noAi = needsAi && ai.effective === null && ai.cliAvailable !== null;

  const send = () => {
    if (!sendable) return;
    const action = routeCreate({ type, prompt, workspaceId });
    if (!action) return;
    if (action.kind === "widget-builder") {
      close();
      window.dispatchEvent(
        new CustomEvent("dash:open-widget-builder", { detail: action.detail }),
      );
    } else if (action.kind === "bot-form") {
      setBotForm({ bot: action.bot, workspaceId: action.workspaceId });
    }
  };

  const continueDraft = (draft) => {
    close();
    window.dispatchEvent(
      new CustomEvent("dash:open-widget-builder", {
        detail: { resumeDraftId: draft.id },
      }),
    );
  };

  const recentDrafts =
    type === "widget"
      ? [...drafts]
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .slice(0, RECENT_DRAFTS)
      : EMPTY;

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
              options={CREATE_TYPES}
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

        {recentDrafts.length > 0 && (
          <div className="flex flex-col gap-2">
            <SectionLabel>Continue a draft</SectionLabel>
            <div className="flex flex-row flex-wrap gap-2">
              {recentDrafts.map((d) => (
                <Button3 key={d.id} size="sm" onClick={() => continueDraft(d)}>
                  <span className="inline-flex items-center gap-2">
                    <FontAwesomeIcon
                      icon="pen-to-square"
                      className="h-3.5 w-3.5"
                    />
                    {d.name || "Untitled draft"}
                    <span className={muted}>· {draftAge(d.updatedAt)}</span>
                  </span>
                </Button3>
              ))}
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

  return (
    <Modal isOpen={open} setIsOpen={setIsOpen} width="w-11/12" height="h-5/6">
      <div
        className={`flex flex-col h-full w-full rounded-lg overflow-clip border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
      >
        <div
          className={`flex-shrink-0 flex flex-row items-center justify-between px-6 py-3 border-b ${hairline}`}
        >
          <div className={`flex items-center gap-3 ${strong}`}>
            {botForm ? (
              <ButtonIcon
                icon="arrow-left"
                onClick={() => setBotForm(null)}
                ariaLabel="Back"
              />
            ) : (
              <FontAwesomeIcon icon="plus" className="h-4 w-4 opacity-70" />
            )}
            <span className="text-lg font-semibold">
              {botForm ? "New bot" : "Create"}
            </span>
          </div>
          <ButtonIcon icon="xmark" onClick={close} ariaLabel="Close" />
        </div>
        {botForm ? form : start}
      </div>
    </Modal>
  );
};
