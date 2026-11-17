import React from "react";
import { ButtonIcon } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

/**
 * SidePanel — the panel on the right of the Graph tab (frames 6, 7, 13,
 * 26): a chip and where it is, a title, a scrolling body, and the buttons
 * at the bottom.
 */
export const SidePanel = ({
  chip = null,
  where = "",
  title = "",
  intro = "",
  onClose = null,
  footer = null,
  testId = "flow-side-panel",
  ariaLabel = null,
  children,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  return (
    <aside
      data-testid={testId}
      aria-label={ariaLabel || title || "Step"}
      className={`w-96 flex-shrink-0 min-h-0 flex flex-col border-l ${hairline}`}
    >
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-4">
        <div className="flex flex-row items-start gap-2">
          <div className="flex-1 min-w-0 flex flex-row flex-wrap items-center gap-2">
            {chip}
            {where ? <span className={`text-xs ${muted}`}>{where}</span> : null}
          </div>
          {onClose ? (
            <ButtonIcon
              icon="xmark"
              ariaLabel="Close"
              size="sm"
              onClick={onClose}
            />
          ) : null}
        </div>
        {title ? (
          <span className={`text-lg font-semibold leading-tight ${strong}`}>
            {title}
          </span>
        ) : null}
        {intro ? <span className={`text-sm ${muted}`}>{intro}</span> : null}
        {children}
      </div>
      {footer ? (
        <div
          className={`flex-shrink-0 flex flex-row items-center gap-2 p-4 border-t ${hairline}`}
        >
          {footer}
        </div>
      ) : null}
    </aside>
  );
};

/** A labelled block inside a side panel: "STARTS WHEN", "READS → WRITES". */
export const PanelSection = ({ label, children, testId = undefined }) => {
  const { muted, strong, hairline } = useConfigTokens();
  return (
    <div
      className={`flex flex-col gap-1 pt-3 border-t ${hairline}`}
      data-testid={testId}
    >
      <span
        className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
      >
        {label}
      </span>
      <div className={`text-sm ${strong}`}>{children}</div>
    </div>
  );
};

export default SidePanel;
