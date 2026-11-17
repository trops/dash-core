import React, { useContext, useState } from "react";
import {
  Button,
  Button3,
  InputText,
  Modal,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";

/**
 * RenameFlowModal — Rename… beside a flow's name (polish batch). Jobs
 * already in it keep going; a published flow keeps its package name, and
 * the new name shows on its next version.
 */
export const RenameFlowModal = ({ flow, onClose, onRenamed }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    scrollable: false,
    grow: false,
  });
  const [name, setName] = useState(flow.name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clean = name.trim();

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await flowsApi().save(flow.id, { name: clean });
      if (!r || r.error) setError((r && r.error) || "It wasn't renamed.");
      else onRenamed(clean);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      setIsOpen={(open) => !open && onClose()}
      width="w-11/12 max-w-md"
      height="h-auto"
    >
      <div
        className={`flex flex-col w-full rounded-lg overflow-clip border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="rename-flow-modal"
      >
        <div className={`px-5 py-4 border-b ${hairline}`}>
          <span className={`text-lg font-semibold ${strong}`}>
            {`Rename ${flow.name}`}
          </span>
        </div>
        <div className="flex flex-col gap-3 p-5">
          <InputText
            label="Name"
            value={name}
            onChange={(v) => setName(v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && clean && !busy) save();
            }}
          />
          <span className={`text-xs ${muted}`}>
            {flow.package
              ? "Jobs already in it keep going. A published flow keeps its package name; the new name shows on your next version."
              : "Jobs already in it keep going."}
          </span>
          {error ? (
            <span className={`text-sm ${status.error.text}`} role="alert">
              {error}
            </span>
          ) : null}
        </div>
        <div
          className={`flex flex-row items-center justify-end gap-2 px-5 py-3 border-t ${hairline}`}
        >
          <Button3 title="Cancel" size="sm" onClick={onClose} />
          <Button
            title={busy ? "Saving…" : "Save"}
            size="sm"
            disabled={busy || !clean || clean === flow.name}
            onClick={save}
          />
        </div>
      </div>
    </Modal>
  );
};

export default RenameFlowModal;
