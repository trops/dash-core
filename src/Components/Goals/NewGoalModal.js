import React, { useContext, useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon,
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

/**
 * NewGoalModal — "New goal on <dashboard>" (frame 29): the flow it follows,
 * its title, and what done means — each criterion with how it's proven.
 * It can't start while a criterion has no way to be proven. Everything is
 * locked once it starts.
 */
export const NewGoalModal = ({ workspace, flows = [], onClose, onStarted }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    scrollable: false,
    grow: false,
  });
  const [flowId, setFlowId] = useState(flows[0] ? flows[0].id : "");
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const blocking = criteria.filter(
    (c) => !c.leftOut && (c.proof === "none" || !String(c.text || "").trim()),
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
            {`New goal on ${workspace.name || "this dashboard"}`}
          </span>
          <ButtonIcon
            icon="xmark"
            ariaLabel="Close"
            size="sm"
            onClick={onClose}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-5">
          <div className="grid grid-cols-3 gap-3">
            <SelectInput
              label="Flow"
              value={flowId}
              options={flows.map((f) => ({ value: f.id, label: f.name }))}
              onChange={(v) => setFlowId(v)}
            />
            <div className="col-span-2">
              <InputText
                label="Goal"
                value={title}
                onChange={(v) => setTitle(v)}
                placeholder="What should be done"
              />
            </div>
          </div>
          <span
            className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
          >
            What done means · each one needs a way to be proven
          </span>
          <CriteriaEditor criteria={criteria} onChange={setCriteria} />
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
            Locked once it starts, so nothing can quietly change what done
            means. To change them, stop the goal.
          </span>
          <Button3 title="Cancel" size="sm" onClick={onClose} />
          <Button
            title={busy ? "Starting…" : "Start goal"}
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
