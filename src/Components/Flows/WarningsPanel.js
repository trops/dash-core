import React from "react";
import {
  Button3,
  FontAwesomeIcon,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { SidePanel } from "./SidePanel";

/**
 * WarningsPanel — "This setup can fool itself" (frame 7), and after a fix
 * "Draft check added" with what's now right (frame 14). Dash checks every
 * step for three things: what it reads and writes, what checks it, and
 * what it can't argue with. Each problem offers its fix.
 */
export const WarningsPanel = ({ flow, justAdded = null, onFix, onClose }) => {
  const { muted } = useConfigTokens();
  const status = useStatusTokens();
  const warnings = flow.warnings || [];
  const good = justAdded ? flow.good || [] : [];
  const n = warnings.length;
  return (
    <SidePanel
      testId="warnings-panel"
      chip={
        n ? (
          <StatusBadge
            state="warning"
            label={
              justAdded
                ? `${n} problem${n === 1 ? "" : "s"} left`
                : `${n} problem${n === 1 ? "" : "s"}`
            }
          />
        ) : (
          <StatusBadge state="success" label="No problems" />
        )
      }
      title={
        justAdded
          ? `${justAdded} added`
          : n
            ? "This setup can fool itself"
            : "Nothing to fix"
      }
      intro={
        justAdded
          ? "The steps after it now start only when it passes. Work that fails goes back with what failed."
          : "Dash checks every step for three things: what it reads and writes, what checks it, and what it can't argue with."
      }
      onClose={onClose}
    >
      {good.map((g) => (
        <div
          key={g.id}
          className={`flex flex-row items-start gap-2 p-3 rounded-md border ${status.success.border} ${status.success.bg}`}
        >
          <FontAwesomeIcon
            icon="check"
            className={`h-3.5 w-3.5 mt-0.5 ${status.success.icon}`}
          />
          <span className={`text-sm ${status.success.text}`}>{g.text}</span>
        </div>
      ))}
      {warnings.map((w) => (
        <div
          key={w.id}
          data-testid="flow-warning"
          className={`flex flex-col gap-1.5 p-3 rounded-md border ${status.warning.accentBorder} ${status.warning.bg}`}
        >
          <span
            className={`text-sm font-semibold ${status.warning.strongText}`}
          >
            {w.title}
          </span>
          <span className={`text-sm ${status.warning.text}`}>{w.body}</span>
          {w.fix ? (
            <div className="pt-1">
              <Button3
                title={w.fix.label}
                size="sm"
                onClick={() => onFix(w.fix)}
              />
            </div>
          ) : null}
        </div>
      ))}
      {!n ? (
        <span className={`text-sm ${muted}`}>
          Every AI step is checked by something, every check only reads, and
          nothing goes out that you haven't seen.
        </span>
      ) : null}
    </SidePanel>
  );
};

export default WarningsPanel;
