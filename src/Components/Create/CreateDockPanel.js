import React, { useEffect, useState } from "react";
import {
  Button2,
  ButtonIcon,
  ChatComposer,
  EmptyState,
  FontAwesomeIcon,
  PanelHeader,
  ResizeHandle,
  useResizableWidth,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { CreatePlanStep } from "./CreatePlanStep";
import { AskStep } from "./AskStep";
import { recentSections } from "./recentRows";
import { RecentList } from "./RecentList";
import { PlanMenu } from "./PlanMenu";
import {
  RecipientPicker,
  useTeamLeads,
} from "../AiAssistant/components/RecipientPicker";

/**
 * CreateDockPanel — Create in the right-hand dock (create-entry PRD CRE-007
 * AC1, phase 4e-2). A plan conversation folded out of the Create modal
 * (`dash:create-fold` { recentId, title }) carries on here in a compact
 * layout — chat, plan, Before building and the build's live steps — and
 * Expand reopens it full size (`dash:open-create` { type, recentId }). With
 * nothing folded it shows Recent, where questions and plans share one list
 * (CRE-007 AC4), with the Ask box pinned at the bottom like every chat (5e —
 * questions go to the Planner, which reads the bots' results; design guide
 * rule 16). A question opens here, never full size. The box's "To:" sends
 * it to the Dash team (the Planner) or straight to a dashboard's team lead
 * (5e-2a), shown only when there are leads.
 *
 * The host's dock decides when it's open (`collapsed`); it stays mounted
 * either way so a fold is never missed.
 */

/** Ask the dashboard stage to open Create (optionally on a plan). */
export function openCreate(detail) {
  window.dispatchEvent(new CustomEvent("dash:open-create", { detail }));
}

/** Fold a plan conversation into the dock. */
export function foldCreate(detail) {
  window.dispatchEvent(new CustomEvent("dash:create-fold", { detail }));
}

export const CreateDockPanel = ({ collapsed = false, onCollapse = null }) => {
  const { hairline } = useConfigTokens();
  // { recentId, title, kind?: "question", question? } — the conversation
  // folded here (a new question has no recentId yet), or null (Recent).
  const [folded, setFolded] = useState(null);
  const [asking, setAsking] = useState("");
  // null = the Dash team (Planner); else a team lead from bots.listLeads.
  const [recipient, setRecipient] = useState(null);
  const { leads, loaded: leadsLoaded } = useTeamLeads(!collapsed);
  // The chosen lead was deleted or turned off → back to the Dash team.
  useEffect(() => {
    if (
      recipient &&
      leadsLoaded &&
      !leads.some((l) => l.botId === recipient.botId)
    ) {
      setRecipient(null);
    }
  }, [recipient, leads, leadsLoaded]);
  const [plans, setPlans] = useState([]);
  const [drafts, setDrafts] = useState([]);
  // The open plan, as CreatePlanStep reports it (for the "…" menu).
  const [planInfo, setPlanInfo] = useState(null);
  const { width, handleProps } = useResizableWidth({
    // Same default as the AI Assistant and Bot Activity docks.
    defaultWidth: 384,
    min: 340,
    max: 720,
    edge: "left",
    storageKey: "dash:create-dock:width",
  });

  useEffect(() => {
    const onFold = (e) => {
      const d = (e && e.detail) || {};
      if (d.recentId) {
        setFolded({
          recentId: d.recentId,
          title: d.title || "",
          kind: d.kind === "question" ? "question" : "plan",
        });
      }
    };
    window.addEventListener("dash:create-fold", onFold);
    return () => window.removeEventListener("dash:create-fold", onFold);
  }, []);

  // Recent, while it's showing.
  useEffect(() => {
    if (collapsed || folded) return undefined;
    let alive = true;
    const api = window.mainApi || {};
    const bots = api.bots;
    const load = () => {
      if (bots && bots.listCreateRecent) {
        Promise.resolve(bots.listCreateRecent())
          .then((l) => alive && Array.isArray(l) && setPlans(l))
          .catch(() => {});
      }
    };
    load();
    if (api.drafts && api.drafts.list) {
      Promise.resolve(api.drafts.list())
        .then((l) => alive && Array.isArray(l) && setDrafts(l))
        .catch(() => {});
    }
    const id = bots && bots.onCreateRecent ? bots.onCreateRecent(load) : null;
    return () => {
      alive = false;
      if (id != null && bots.removeListener) bots.removeListener(id);
    };
  }, [collapsed, folded]);

  if (collapsed) return null;

  const expand = () => {
    if (!folded || folded.kind === "question") return;
    const { recentId } = folded;
    setFolded(null);
    if (onCollapse) onCollapse();
    openCreate({ type: "dashboard", recentId });
  };
  const openRow = (row) => {
    if (row.kind === "plan" || row.kind === "question") {
      setFolded({ recentId: row.id, title: row.title, kind: row.kind });
      return;
    }
    // A widget draft opens in the Widget Builder (full size).
    window.dispatchEvent(
      new CustomEvent("dash:open-widget-builder", {
        detail: { resumeDraftId: row.id },
      }),
    );
  };
  // Remove a question or plan from Recent (RecentList asks first).
  const removeRecent = async (row) => {
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots || !bots.removeCreateRecent) return;
    try {
      await bots.removeCreateRecent(row.id);
    } catch (_e) {
      // It stays listed; try again.
    }
  };
  const sections = recentSections(plans, drafts, { conversations: 12 });
  const hasRecent = sections.conversations.length + sections.drafts.length > 0;
  // A secondary button, not a link: it leaves the dock for Create full size.
  const makeNew = (
    <Button2
      size="sm"
      onClick={() => openCreate({ type: "dashboard" })}
      ariaLabel="Make something new — opens Create full size"
    >
      <span className="inline-flex items-center gap-2">
        <FontAwesomeIcon
          icon="up-right-and-down-left-from-center"
          className="h-3 w-3"
        />
        Make something new…
      </span>
    </Button2>
  );
  const askNow = () => {
    const q = asking.trim();
    if (!q) return;
    setAsking("");
    setFolded({
      recentId: null,
      title: q,
      kind: "question",
      question: q,
      // Its latest state (paused / running) from the live list.
      recipient: recipient
        ? leads.find((l) => l.botId === recipient.botId) || recipient
        : null,
    });
  };
  // Open as a plan: Create (full size) starts from the answer's plan.
  const openPlan = (seed) => {
    if (onCollapse) onCollapse();
    openCreate({ type: "dashboard", seed });
  };

  return (
    <aside
      className={`relative flex flex-col h-full border-l ${hairline}`}
      style={{ width }}
      data-testid="create-dock"
      aria-label="Create"
    >
      <ResizeHandle {...handleProps} ariaLabel="Resize Create" />
      <PanelHeader
        testId="create-dock-header"
        onBack={folded ? () => setFolded(null) : null}
        backLabel="Back to Recent"
        title={
          folded
            ? folded.title ||
              (folded.kind === "question" ? "Question" : "Plan a dashboard")
            : "Create"
        }
        actions={
          <>
            {folded && folded.kind !== "question" ? (
              <ButtonIcon
                icon="up-right-and-down-left-from-center"
                ariaLabel="Expand"
                onClick={expand}
              />
            ) : null}
            {folded && folded.kind !== "question" && folded.recentId ? (
              <PlanMenu
                recentId={folded.recentId}
                title={(planInfo && planInfo.title) || folded.title}
                built={!!(planInfo && planInfo.built)}
                onRemoved={() => setFolded(null)}
              />
            ) : null}
            {onCollapse ? (
              <ButtonIcon
                icon="xmark"
                ariaLabel="Close Create panel"
                onClick={onCollapse}
              />
            ) : null}
          </>
        }
      />
      {folded && folded.kind === "question" ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <AskStep
            key={folded.recentId || `new:${folded.question}`}
            question={folded.question || ""}
            recentId={folded.recentId}
            recipient={folded.recipient || null}
            onOpenPlan={openPlan}
          />
        </div>
      ) : folded ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <CreatePlanStep
            key={folded.recentId}
            prompt=""
            recentId={folded.recentId}
            compact
            onState={setPlanInfo}
            onOpenDashboard={(id) =>
              window.dispatchEvent(
                new CustomEvent("dash:open-built-dashboard", {
                  detail: { id },
                }),
              )
            }
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div
            className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-4"
            data-testid="create-dock-recent"
          >
            <RecentList
              sections={sections}
              onOpen={openRow}
              onRemove={removeRecent}
              empty={
                <EmptyState
                  testId="create-dock-empty"
                  className="my-auto"
                  title="Nothing here yet"
                  description="Ask about your dashboards and bots below. Ask for something new and you'll get a plan to review first — nothing is made until you press Build. Questions, plans and unfinished widgets show up here."
                >
                  {makeNew}
                </EmptyState>
              }
            />
            {hasRecent ? <div>{makeNew}</div> : null}
          </div>
          <ChatComposer
            value={asking}
            onChange={(v) => setAsking(v)}
            onSend={askNow}
            ariaLabel="Ask about your dashboards and bots"
            placeholder={
              recipient
                ? `Ask ${recipient.leadName}…`
                : "Ask about your dashboards and bots…"
            }
            above={
              leads.length ? (
                <RecipientPicker
                  leads={leads}
                  recipient={recipient}
                  onChange={setRecipient}
                  defaultLabel="Dash team"
                />
              ) : null
            }
            sendLabel="Ask"
          />
        </div>
      )}
    </aside>
  );
};

export default CreateDockPanel;
