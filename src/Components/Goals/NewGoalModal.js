import React, { useContext, useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon,
  FlowKindChip,
  InputText,
  Modal,
  SelectInput,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";
import { CriteriaEditor } from "./CriteriaEditor";
import { chainOrder } from "../Flows/flowText";
import { jobsStart } from "../Flows/FlowList";

/**
 * NewGoalModal — "New goal on <dashboard>" (frame 29): the flow it follows,
 * its title, and what done means — each criterion with how it's proven.
 * It can't start while a criterion has no way to be proven. Everything is
 * locked once it starts.
 */
export const NewGoalModal = ({
  workspace,
  flows = [],
  initialFlowId = null,
  onClose,
  onStarted,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    scrollable: false,
    grow: false,
  });
  const [flowId, setFlowId] = useState(
    initialFlowId || (flows[0] ? flows[0].id : ""),
  );
  // What done means is optional: folded away until you add one.
  const [showCriteria, setShowCriteria] = useState(false);
  const flow = flows.find((x) => x.id === flowId) || null;
  const route = flow ? chainOrder(flow).filter((x) => x.kind !== "source") : [];
  const startsItself =
    !!flow && (flow.steps || []).some((x) => x.kind === "source");
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // An empty row is left out, not a reason it can't start.
  const blocking = criteria.filter(
    (c) => !c.leftOut && String(c.text || "").trim() && c.proof === "none",
  );

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await flowsApi().newGoal(workspace.id, {
        flowId,
        title,
        criteria: criteria.filter((c) => String(c.text || "").trim()),
      });
      if (!r || r.error) {
        setError((r && r.error) || "It couldn't start.");
        return;
      }
      onStarted(r.goal);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      setIsOpen={(open) => !open && onClose()}
      width="w-11/12 max-w-3xl"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full w-full min-h-0 rounded-lg overflow-clip border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="new-goal-modal"
      >
        <div
          className={`flex flex-row items-center gap-2 px-5 py-4 border-b ${hairline}`}
        >
          <span className={`text-lg font-semibold flex-1 ${strong}`}>
            {`New job on ${workspace.name || "this dashboard"}`}
          </span>
          <ButtonIcon
            icon="xmark"
            ariaLabel="Close"
            size="sm"
            onClick={onClose}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-5">
          <SelectInput
            label="Flow"
            value={flowId}
            options={flows.map((f) => ({ value: f.id, label: f.name }))}
            onChange={(v) => setFlowId(v)}
          />
          {flow ? (
            <div
              data-testid="job-route"
              className={`flex flex-col gap-2 p-3 rounded-lg border ${hairline}`}
            >
              <span className={`text-xs ${muted}`}>This job will go</span>
              <div className="flex flex-row flex-wrap items-center gap-2">
                {route.map((x, i) => (
                  <span key={x.id} className="flex flex-row items-center gap-2">
                    {i ? <span className={muted}>→</span> : null}
                    <FlowKindChip kind={x.kind} label={x.name} />
                  </span>
                ))}
              </div>
              <span className={`text-xs ${muted}`}>
                {startsItself
                  ? `This flow starts jobs by itself (${jobsStart(flow)}). Start one now for something extra.`
                  : "Nothing starts jobs in this flow by itself: this is how you start one."}
              </span>
            </div>
          ) : null}
          <InputText
            label="What should be done"
            value={title}
            onChange={(v) => setTitle(v)}
            placeholder="e.g. Make a list for Thanksgiving dinner"
          />
          {showCriteria ? (
            <div className="flex flex-col gap-2" data-testid="job-criteria">
              <div className="flex flex-row items-center gap-2">
                <span className={`text-sm font-semibold ${strong}`}>
                  What done means
                </span>
                <span className={`text-xs flex-1 ${muted}`}>
                  optional · each says who can tell it's done
                </span>
                <Button3
                  title="Fold away"
                  size="sm"
                  onClick={() => setShowCriteria(false)}
                />
              </div>
              <CriteriaEditor criteria={criteria} onChange={setCriteria} />
            </div>
          ) : (
            <div className="self-start">
              <Button3
                size="sm"
                title={
                  criteria.some((c) => String(c.text || "").trim())
                    ? `What done means (${criteria.filter((c) => String(c.text || "").trim()).length})`
                    : "+ Add what done means (optional)"
                }
                onClick={() => {
                  setShowCriteria(true);
                  if (!criteria.length)
                    setCriteria([
                      {
                        id: `c${Date.now().toString(36)}`,
                        text: "",
                        proof: "test",
                      },
                    ]);
                }}
              />
            </div>
          )}
          {error ? (
            <span className={`text-sm ${status.error.text}`} role="alert">
              {error}
            </span>
          ) : null}
        </div>
        <div
          className={`flex flex-row items-center gap-3 px-5 py-3 border-t ${hairline}`}
        >
          <span className={`text-xs flex-1 ${muted}`}>
            {criteria.some((c) => String(c.text || "").trim())
              ? "Locked once it starts, so nothing can quietly change what done means. To change them, stop the job."
              : ""}
          </span>
          <Button3 title="Cancel" size="sm" onClick={onClose} />
          <Button
            title={busy ? "Starting…" : "Start job"}
            size="sm"
            disabled={busy || !title.trim() || !flowId || blocking.length > 0}
            onClick={start}
          />
        </div>
      </div>
    </Modal>
  );
};

export default NewGoalModal;
