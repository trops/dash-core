import { useState, useEffect, useCallback, useMemo } from "react";
import { CodeEditorVS } from "@trops/dash-react";
import deepEqual from "deep-equal";

// Fields that LayoutModel re-derives on load (from ComponentManager,
// dashboardId, parent widgets, etc.) or that are schema-default noise
// from the component config. Keeping them in the Code editor produces
// a wall of redundant JSON that buries the actual editable state
// (listeners / userPrefs / selectedProviders / grid). We hide them in
// the visible JSON and merge them back on save so the round-trip is
// lossless.
const DERIVED_FIELDS = [
  "widgetConfig", // biggest offender — full component definition blob
  "uuid",
  "dashboardId",
  "parentWorkspaceName",
  "componentName",
  "siblingCount",
  "hasChildren",
  "canHaveChildren",
  "events", // declared by the widget's .dash.js, not editable per-item
  "eventHandlers",
];

function stripDerivedFields(item) {
  if (!item || typeof item !== "object") return item;
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (DERIVED_FIELDS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export const PanelCode = ({ workspace, onUpdate, item = null }) => {
  const [itemSelected, setItemSelected] = useState(item);
  const [workspaceSelected, setWorkspaceSelected] = useState(workspace);
  const [, updateState] = useState();
  const forceUpdate = useCallback(() => updateState({}), []);

  useEffect(() => {
    if (deepEqual(item, itemSelected) === false) {
      setItemSelected(() => item);
      forceUpdate();
    }

    if (deepEqual(workspace, workspaceSelected) === false) {
      setWorkspaceSelected(() => workspace);
      forceUpdate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, item]);

  const displayJson = useMemo(() => {
    if (!itemSelected) return "";
    return JSON.stringify(stripDerivedFields(itemSelected), null, 2);
  }, [itemSelected]);

  function handleCodeChange(code) {
    try {
      const edited = JSON.parse(code);
      // Preserve the derived fields from the live item so save +
      // re-render stays in sync with what the rest of the layout
      // expects. LayoutModel re-derives these on reload, but losing
      // them between render cycles can cause flashes of "unknown
      // widget" state.
      const merged = { ...itemSelected };
      for (const k of Object.keys(edited)) merged[k] = edited[k];
      onUpdate(merged, workspaceSelected);
    } catch {
      // Malformed JSON — leave state alone; the editor keeps the
      // user's text so they can fix it.
    }
  }

  return (
    itemSelected &&
    workspaceSelected && (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 min-h-0 overflow-hidden relative">
          <div className="absolute inset-0">
            <CodeEditorVS
              code={displayJson}
              language="json"
              onChange={handleCodeChange}
              readOnly={false}
              minimapEnabled={false}
              padding="p-0"
            />
          </div>
        </div>
      </div>
    )
  );
};

export default PanelCode;
