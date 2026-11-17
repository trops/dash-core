import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button3,
  ConfirmationModal,
  FlowGraph,
  FlowGraphLegend,
  StatusBadge,
  flowLayout,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi, useFlows } from "../../hooks/useFlows";
import { FlowList } from "./FlowList";
import { RenameFlowModal } from "./RenameFlowModal";
import { AddStepMenu } from "./AddStepMenu";
import { CheckPanel } from "./CheckPanel";
import { StepPanel } from "./StepPanel";
import { FieldsPanel } from "./FieldsPanel";
import { WarningsPanel } from "./WarningsPanel";
import { NewFlowModal } from "./NewFlowModal";
import { SimpleGraph } from "./SimpleGraph";
import { PublishFlowModal } from "./PublishFlowModal";
import { UpdateFlowModal } from "./UpdateFlowModal";
import {
  betweenText,
  chainOrder,
  graphEdges,
  graphSteps,
  warnedSteps,
} from "./flowText";

// The card size FlowGraph draws (dash-react), for placing the + menu.
const NODE_W = 208;
const NODE_H = 128;

/** The width a box has, kept up to date. */
function useBoxWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth || 0);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return [ref, width];
}

const remembered = (wsId) => {
  try {
    return window.localStorage.getItem(`dash.graph.flow.${wsId}`);
  } catch (_e) {
    return null;
  }
};
const remember = (wsId, flowId) => {
  try {
    window.localStorage.setItem(`dash.graph.flow.${wsId}`, flowId);
  } catch (_e) {
    // A convenience only.
  }
};

/**
 * GraphView — a dashboard's Graph tab (flows PRD, frames 5–7, 11–17,
 * 21–24): who hands work to whom in each flow, where its goals are now,
 * a step opened beside the graph, a + on every arrow to add a step, what
 * could fool itself, and New flow. A dashboard with no flows shows what
 * its bots read and show.
 *
 * `command` ({ type: "add-step" | "new-flow", seq }) comes from the
 * dashboard header's button.
 */
export const GraphView = ({
  workspace,
  command = null,
  onOpenGoals = null,
  onOpenBot = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const api = flowsApi();
  const workspaceId = workspace ? workspace.id : null;
  const { flows, loading, refresh } = useFlows(workspaceId);
  const [flowId, setFlowId] = useState(() =>
    workspaceId ? remembered(workspaceId) : null,
  );
  const [panel, setPanel] = useState(null);
  const [menu, setMenu] = useState(null);
  const [banner, setBanner] = useState(null);
  const [newFlow, setNewFlow] = useState(false);
  const [bots, setBots] = useState([]);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [warningsClosed, setWarningsClosed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [update, setUpdate] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [graphBox, graphWidth] = useBoxWidth();
  // The graph's own width (its box less the padding): for drawing it, and
  // for placing the + menu from the same layout.
  const drawWidth = graphWidth ? Math.max(0, graphWidth - 32) : undefined;

  const flow = flows.find((f) => f.id === flowId) || flows[0] || null;

  // An installed flow with a newer version out (frame 35).
  const flowKey = flow
    ? `${flow.id}:${flow.package ? flow.package.version : ""}`
    : "";
  useEffect(() => {
    let live = true;
    setUpdate(null);
    if (!api || !flow || !flow.package || flow.package.own) return undefined;
    api
      .checkUpdate(flow.id)
      .then((r) => live && r && r.ok && r.available && setUpdate(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowKey]);

  useEffect(() => {
    let live = true;
    const m = typeof window !== "undefined" ? window.mainApi : null;
    if (m && m.bots && typeof m.bots.list === "function") {
      Promise.resolve(m.bots.list()).then((list) => {
        if (!live) return;
        const all = Array.isArray(list) ? list : (list && list.bots) || [];
        setBots(
          all.filter(
            (b) =>
              b &&
              String(b.workspaceId) === String(workspaceId) &&
              b.role !== "lead" &&
              b.system !== "dash-team",
          ),
        );
      });
    }
    return () => {
      live = false;
    };
  }, [workspaceId, flows]);

  const steps = useMemo(
    () => (flow ? graphSteps(flow, { warnSteps: warnedSteps(flow) }) : []),
    [flow],
  );
  const edges = useMemo(() => (flow ? graphEdges(flow) : []), [flow]);
  const layout = useMemo(
    () => flowLayout(steps, edges, null, { width: drawWidth }),
    [steps, edges, drawWidth],
  );

  // The + menu, under the arrow it adds on (or after the last step): at the
  // + itself when the graph says where it is.
  const openMenu = (from, to, at = null) => {
    if (at && typeof at.x === "number" && typeof at.y === "number") {
      setMenu({
        from,
        to,
        x: at.x,
        y: at.y + 22,
        title: `Add ${betweenText(flow, from, to)}`.trim(),
      });
      return;
    }
    const a = from ? layout.pos[from] : null;
    const b = to ? layout.pos[to] : null;
    const x =
      a && b
        ? (a.x + NODE_W + b.x) / 2
        : a
          ? a.x + NODE_W + 32
          : b
            ? b.x - 32
            : 200;
    const y = a || b ? (a || b).y + NODE_H / 2 + 22 : 60;
    setMenu({
      from,
      to,
      x,
      y,
      title: `Add ${betweenText(flow, from, to)}`.trim(),
    });
  };

  // The header's button: "Add a step" (a flow is open) or "New flow". Only
  // a press made while this tab is open counts — not the last one, replayed
  // when the tab opens again.
  const seenSeq = useRef(command ? command.seq : 0);
  useEffect(() => {
    if (!command || command.seq <= seenSeq.current) return;
    seenSeq.current = command.seq;
    if (command.type !== "new-flow" && command.type !== "add-step") return;
    if (command.type === "new-flow" || !flow) {
      setNewFlow(true);
      return;
    }
    const order = chainOrder(flow);
    const last = order[order.length - 1];
    openMenu(last ? last.id : null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command && command.seq]);

  const act = useCallback(async (fn) => {
    setError("");
    try {
      const r = await fn();
      if (r && r.error) setError(r.error);
      return r;
    } catch (e) {
      setError((e && e.message) || "That didn't work.");
      return null;
    }
  }, []);

  const pickStepKind = async (kind) => {
    const at = menu;
    setMenu(null);
    if (!at || !flow) return;
    const between = {
      from: at.from,
      to: at.to,
      text: betweenText(flow, at.from, at.to),
    };
    if (kind === "you") {
      const r = await act(() =>
        api.addStep(flow.id, {
          from: at.from,
          to: at.to,
          step: {
            kind: "you",
            name: "You approve",
            mode: "approve",
            action: "Approve",
          },
        }),
      );
      if (r && r.ok) setPanel({ type: "warnings", justAdded: "Your approval" });
      return;
    }
    setPanel({ type: "new", kind, between });
  };

  const onFix = (fix) => {
    if (!flow) return;
    if (fix.type === "add-check") {
      setPanel({
        type: "new",
        kind: "check",
        between: {
          from: fix.from,
          to: fix.to,
          text: betweenText(flow, fix.from, fix.to),
        },
      });
    } else if (fix.type === "add-you") {
      act(() =>
        api.addStep(flow.id, {
          from: fix.from,
          to: fix.to,
          step: {
            kind: "you",
            name: "You approve",
            mode: "approve",
            action: "Approve before it acts",
          },
        }),
      ).then(
        (r) =>
          r &&
          r.ok &&
          setPanel({ type: "warnings", justAdded: "Your approval" }),
      );
    } else if (fix.type === "open-fields") {
      setPanel({ type: "fields", stepId: fix.stepId });
    } else if (fix.type === "open-step") {
      setPanel({ type: "step", stepId: fix.stepId });
    } else if (fix.type === "remove-step") {
      act(() => api.removeStep(flow.id, fix.stepId));
    }
  };

  const onMade = (made, madeBots) => {
    setNewFlow(false);
    setFlowId(made.id);
    remember(workspaceId, made.id);
    setPanel(null);
    setBanner({
      flowId: made.id,
      name: made.name,
      brief: made.brief,
      bots: madeBots.length,
    });
    refresh();
  };

  if (!loading && !flows.length) {
    return (
      <div
        data-testid="graph-view"
        className={`flex-1 min-h-0 flex flex-col ${strong}`}
      >
        <div
          className={`flex-shrink-0 flex flex-row items-center gap-3 px-4 py-2.5 border-b ${hairline}`}
        >
          <span className={`text-sm flex-1 ${muted}`}>
            Your bots, what they read and where their results go.
          </span>
          <FlowGraphLegend />
        </div>
        <SimpleGraph workspace={workspace} onNewFlow={() => setNewFlow(true)} />
        {newFlow ? (
          <NewFlowModal
            workspace={workspace}
            onClose={() => setNewFlow(false)}
            onMade={onMade}
          />
        ) : null}
      </div>
    );
  }

  const selectedStep =
    panel && (panel.type === "step" || panel.type === "fields") && flow
      ? flow.steps.find((s) => s.id === panel.stepId) || null
      : null;
  const warnings = (flow && flow.warnings) || [];
  const showWarnings =
    flow && !panel && warnings.length > 0 && !warningsClosed
      ? { type: "warnings", justAdded: null }
      : null;
  const shown = panel || showWarnings;
  const botOf = (id) => bots.find((b) => b.id === id) || null;

  return (
    <div
      data-testid="graph-view"
      className={`flex-1 min-h-0 flex flex-col ${strong}`}
    >
      <div className="flex-1 min-h-0 flex flex-row">
        <FlowList
          flows={flows}
          value={flow ? flow.id : null}
          onPick={(id) => {
            setFlowId(id);
            remember(workspaceId, id);
            setPanel(null);
            setMenu(null);
            setWarningsClosed(false);
          }}
          onNew={() => setNewFlow(true)}
        />
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div
            className={`flex-shrink-0 flex flex-row flex-wrap items-center gap-3 px-4 py-2.5 border-b ${hairline}`}
          >
            <div className="flex-1 min-w-48 flex flex-col">
              <span
                className={`text-lg font-semibold ${strong}`}
                data-testid="flow-name"
              >
                {flow ? flow.name : ""}
              </span>
              <span className={`text-xs ${muted}`}>
                Who hands work to whom. Counts show where jobs are now.
              </span>
            </div>
            {warnings.length ? (
              <button
                type="button"
                data-testid="flow-problems"
                onClick={() => {
                  setWarningsClosed(false);
                  setPanel({ type: "warnings", justAdded: null });
                }}
              >
                <StatusBadge
                  state="warning"
                  label={`${warnings.length} problem${warnings.length === 1 ? "" : "s"}`}
                />
              </button>
            ) : null}
            <FlowGraphLegend />
            {update ? (
              <button
                type="button"
                data-testid="flow-update"
                onClick={() => setUpdating(true)}
              >
                <StatusBadge
                  state="info"
                  label={`Update to ${update.version}`}
                />
              </button>
            ) : null}
            {flow ? (
              <Button3
                title="Rename…"
                size="sm"
                onClick={() => setRenaming(true)}
              />
            ) : null}
            {flow ? (
              <Button3
                title="Publish…"
                size="sm"
                onClick={() => setPublishing(true)}
              />
            ) : null}
            {flow ? (
              <Button3
                title="Delete flow"
                size="sm"
                onClick={() => setConfirmDelete(true)}
              />
            ) : null}
          </div>

          {banner && flow && banner.flowId === flow.id ? (
            <div
              data-testid="flow-made-banner"
              className={`mx-4 mt-3 flex flex-row items-center gap-3 px-4 py-2.5 rounded-lg border ${status.success.border} ${status.success.bg}`}
            >
              <span className={`text-sm flex-1 ${status.success.text}`}>
                <span className="font-semibold">{`${banner.name} is set up. `}</span>
                {`${banner.brief ? `It runs ${banner.brief}. ` : ""}${
                  banner.bots
                    ? `${banner.bots} new bot${banner.bots === 1 ? "" : "s"} ask before they change anything. `
                    : ""
                }Nothing is in it yet.`}
              </span>
              {onOpenGoals ? (
                <button
                  type="button"
                  className={`text-sm font-semibold ${status.success.strongText}`}
                  onClick={onOpenGoals}
                >
                  Open Jobs
                </button>
              ) : null}
              <button
                type="button"
                className={`text-sm font-semibold ${status.success.strongText}`}
                onClick={async () => {
                  const r = await act(() => api.undo(banner.flowId));
                  if (r && r.ok) {
                    setBanner(null);
                    setFlowId(null);
                  }
                }}
              >
                Undo
              </button>
            </div>
          ) : null}

          {error ? (
            <span
              className={`mx-4 mt-2 text-sm ${status.error.text}`}
              role="alert"
            >
              {error}
            </span>
          ) : null}

          <div className="flex-1 min-h-0 flex flex-row">
            <div
              ref={graphBox}
              className="flex-1 min-w-0 min-h-0 overflow-auto p-4 flex flex-col gap-6"
            >
              {flow ? (
                <div className="relative w-full">
                  <FlowGraph
                    steps={steps}
                    edges={edges}
                    selectedId={
                      selectedStep
                        ? selectedStep.id
                        : panel && panel.type === "new"
                          ? null
                          : null
                    }
                    onSelect={(id) => {
                      setMenu(null);
                      setPanel({ type: "step", stepId: id });
                    }}
                    onAdd={({ from, to, x, y }) => openMenu(from, to, { x, y })}
                    width={drawWidth}
                    ariaLabel={`${flow.name}: who hands work to whom`}
                  />
                  {menu ? (
                    <AddStepMenu
                      title={menu.title}
                      x={menu.x}
                      y={menu.y}
                      onPick={pickStepKind}
                      onClose={() => setMenu(null)}
                    />
                  ) : null}
                </div>
              ) : null}
              <div
                className={`flex flex-col gap-1 p-3 rounded-lg border border-dashed max-w-3xl ${hairline}`}
              >
                <span className={`text-sm font-semibold ${strong}`}>
                  Each job's record
                </span>
                <span className={`text-sm ${muted}`}>
                  Every step reads and writes it: the status, the round, and
                  each step's record with its proof. Steps never talk to each
                  other directly.
                </span>
              </div>
            </div>

            {flow && shown ? (
              shown.type === "warnings" ? (
                <WarningsPanel
                  flow={flow}
                  justAdded={shown.justAdded}
                  onFix={onFix}
                  onClose={() => {
                    setPanel(null);
                    setWarningsClosed(true);
                  }}
                />
              ) : shown.type === "fields" && selectedStep ? (
                <FieldsPanel
                  key={`fields-${selectedStep.id}`}
                  flow={flow}
                  step={selectedStep}
                  onClose={() =>
                    setPanel({ type: "step", stepId: selectedStep.id })
                  }
                  onOpenStep={(id) => setPanel({ type: "step", stepId: id })}
                  onSave={async (p) => {
                    const r = await act(() =>
                      api.updateStep(flow.id, selectedStep.id, p),
                    );
                    if (r && r.ok)
                      setPanel({ type: "step", stepId: selectedStep.id });
                    return r;
                  }}
                />
              ) : shown.type === "new" && shown.kind === "check" ? (
                <CheckPanel
                  key={`new-check-${shown.between.from}-${shown.between.to}`}
                  flow={flow}
                  mode="new"
                  between={shown.between}
                  onClose={() => setPanel(null)}
                  onAdd={async ({ name, check, failTo }) => {
                    const r = await act(() =>
                      api.addStep(flow.id, {
                        from: shown.between.from,
                        to: shown.between.to,
                        step: {
                          kind: "check",
                          name,
                          check,
                          failTo: failTo || null,
                        },
                      }),
                    );
                    if (r && r.ok)
                      setPanel({ type: "warnings", justAdded: name });
                    return r;
                  }}
                />
              ) : shown.type === "new" ? (
                <StepPanel
                  key={`new-bot-${shown.between.from}-${shown.between.to}`}
                  flow={flow}
                  step={null}
                  mode="new"
                  between={shown.between}
                  bots={bots}
                  onClose={() => setPanel(null)}
                  onAdd={async (patch) => {
                    const r = await act(() =>
                      api.addStep(flow.id, {
                        from: shown.between.from,
                        to: shown.between.to,
                        step: { kind: "bot", ...patch },
                      }),
                    );
                    if (r && r.ok) setPanel({ type: "step", stepId: r.stepId });
                    return r;
                  }}
                />
              ) : selectedStep && selectedStep.kind === "check" ? (
                <CheckPanel
                  key={`check-${selectedStep.id}-${flow.version}`}
                  flow={flow}
                  step={selectedStep}
                  mode="edit"
                  between={{
                    text: betweenText(
                      flow,
                      ...neighbours(flow, selectedStep.id),
                    ),
                  }}
                  onClose={() => setPanel(null)}
                  onRemove={() =>
                    act(() => api.removeStep(flow.id, selectedStep.id)).then(
                      () => setPanel(null),
                    )
                  }
                  onSave={async (p) =>
                    act(() => api.updateStep(flow.id, selectedStep.id, p))
                  }
                />
              ) : selectedStep ? (
                <StepPanel
                  key={`step-${selectedStep.id}-${flow.version}`}
                  flow={flow}
                  step={selectedStep}
                  bot={botOf(selectedStep.botId)}
                  bots={bots}
                  onClose={() => setPanel(null)}
                  onOpenFields={(id) =>
                    setPanel({ type: "fields", stepId: id })
                  }
                  onOpenBot={
                    onOpenBot ? (botId, tab) => onOpenBot(botId, tab) : null
                  }
                  onRemove={() =>
                    act(() => api.removeStep(flow.id, selectedStep.id)).then(
                      () => setPanel(null),
                    )
                  }
                  onSave={async (p) =>
                    act(() => api.updateStep(flow.id, selectedStep.id, p))
                  }
                />
              ) : null
            ) : null}
          </div>
        </div>
      </div>

      {newFlow ? (
        <NewFlowModal
          workspace={workspace}
          onClose={() => setNewFlow(false)}
          onMade={onMade}
        />
      ) : null}
      {renaming && flow ? (
        <RenameFlowModal
          flow={flow}
          onClose={() => setRenaming(false)}
          onRenamed={() => {
            setRenaming(false);
            refresh();
          }}
        />
      ) : null}
      {publishing && flow ? (
        <PublishFlowModal
          flow={flow}
          onClose={() => setPublishing(false)}
          onPublished={() => setPublishing(false)}
        />
      ) : null}
      {updating && flow ? (
        <UpdateFlowModal
          flow={flow}
          onClose={() => setUpdating(false)}
          onUpdated={() => {
            setUpdating(false);
            setUpdate(null);
          }}
        />
      ) : null}

      {confirmDelete && flow ? (
        <ConfirmationModal
          isOpen
          setIsOpen={() => setConfirmDelete(false)}
          title={`Delete ${flow.name}?`}
          confirmLabel="Delete flow"
          variant="danger"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            const r = await act(() => api.remove(flow.id, false));
            if (r && r.ok) {
              setFlowId(null);
              setPanel(null);
            }
          }}
        >
          <span
            className={`text-sm ${muted}`}
            data-testid="flow-delete-confirm"
          >
            {`Its steps and its files (scripts, checks, data) are removed. Its bots stay on this dashboard, and jobs already in it keep the copy of the flow they started with.`}
          </span>
        </ConfirmationModal>
      ) : null}
    </div>
  );
};

/** The steps either side of a step, for "between X and Y". */
function neighbours(flow, stepId) {
  const prev = (flow.edges || []).find(
    (e) => e.kind === "next" && e.to === stepId,
  );
  const next = (flow.edges || []).find(
    (e) => e.kind === "next" && e.from === stepId,
  );
  return [prev ? prev.from : null, next ? next.to : null];
}

export default GraphView;
