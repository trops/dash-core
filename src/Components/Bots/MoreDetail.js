/**
 * MoreDetail — a small "Show how bots use it" / "Learn more" toggle
 * (DASH-129). The copy a person installing a team needs is always shown;
 * how Dash fills in a value or passes work between bots ({name}, a row's
 * key, the handoff's format) waits behind this, one click away.
 */
import React, { useState } from "react";
import { Button3 } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

export const SHOW_HOW = "Show how bots use it";
export const HIDE_HOW = "Hide how bots use it";

/**
 * Controlled when `open` + `onToggle` are given (one toggle for a whole
 * form), else it keeps its own state and shows `children` when open.
 */
export const MoreDetail = ({
  label = SHOW_HOW,
  hideLabel = HIDE_HOW,
  open: openProp,
  onToggle = null,
  testId = "more-detail",
  children = null,
}) => {
  const { muted } = useConfigTokens();
  const [own, setOwn] = useState(false);
  const controlled = typeof openProp === "boolean";
  const open = controlled ? openProp : own;
  const toggle = () => {
    if (onToggle) onToggle(!open);
    if (!controlled) setOwn(!open);
  };
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div>
        <Button3 title={open ? hideLabel : label} size="sm" onClick={toggle} />
      </div>
      {open && children ? (
        <span className={`text-xs ${muted}`} data-testid={`${testId}-text`}>
          {children}
        </span>
      ) : null}
    </div>
  );
};

export default MoreDetail;
