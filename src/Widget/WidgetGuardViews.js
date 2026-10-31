import React, { useEffect, useState } from "react";
import {
  AlertBanner,
  Button,
  Button2,
  Button3,
  FontAwesomeIcon,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Components/Dashboard/ConfigListRow";
import {
  WINDOW,
  isPaused,
  markOpening,
  pausedReason,
  restart,
  stoppedInfo,
  subscribe,
  turnOn,
  widgetKey,
} from "./widgetGuard";

/**
 * The widget guard's views (widget guard and safe start, frames 1-3): a
 * widget stopped because it kept failing, a widget paused after Dash froze
 * on its dashboard, and that dashboard's banner.
 */

/** Re-render when the guard changes. */
function useGuard() {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
}

const WHY = {
  load: "something it couldn't load",
  render: "it crashed while drawing",
  error: "errors in its code",
};

/**
 * In a widget's place (frame 1): it's stopped, paused, or itself.
 * @param {string} component  its component name ("ai-built.player.Player")
 * @param {string} label      its name for people
 * @param {string|number|null} dashboardId
 * @param {string|null} uuid
 * @param {() => void} [onFix]     Fix with AI
 * @param {() => void} [onRemove]  while editing: take it off
 * @param {boolean} [off]  a layout container: never stopped or paused (its
 *   widgets are, each in its own place)
 */
export const WidgetGuardGate = ({
  off = false,
  component,
  label,
  dashboardId = null,
  uuid = null,
  onFix = null,
  onRemove = null,
  children,
}) => {
  useGuard();
  if (off) return children;
  const key = widgetKey(component);
  const stopped = stoppedInfo(key);
  const box = (body) => (
    <div className="flex flex-col h-full w-full min-h-0" data-widget-key={key}>
      {body}
    </div>
  );
  if (stopped) {
    return box(
      <StoppedCard
        label={label}
        info={stopped}
        onTryAgain={() => restart(key)}
        onFix={onFix}
        onRemove={onRemove}
      />,
    );
  }
  if (isPaused(dashboardId, uuid)) {
    return box(
      <PausedCard label={label} onTurnOn={() => turnOn(dashboardId, uuid)} />,
    );
  }
  // Running: a box that takes no space of its own (display: contents) —
  // only there so a file it fails to load is counted as its.
  return (
    <div style={{ display: "contents" }} data-widget-key={key}>
      {children}
    </div>
  );
};

const StoppedCard = ({ label, info, onTryAgain, onFix, onRemove }) => {
  const { muted, strong } = useConfigTokens();
  const status = useStatusTokens();
  const seconds = Math.round(WINDOW / 1000);
  return (
    <div
      role="status"
      className={`flex flex-col gap-2 h-full w-full rounded-xl border p-4 ${status.warning.accentBorder}`}
      data-testid="widget-stopped"
    >
      <span className={`text-sm font-semibold ${strong}`}>{label}</span>
      <div className="flex flex-col justify-center gap-2 flex-1 min-h-0">
        <span
          className={`flex flex-row items-center gap-2 text-sm font-semibold ${strong}`}
        >
          <FontAwesomeIcon
            icon="circle-pause"
            className={`h-4 w-4 ${status.warning.icon}`}
            aria-hidden="true"
          />
          Stopped — it kept failing
        </span>
        <span className={`text-xs ${muted}`}>
          It failed {info.count} times in {seconds} seconds (
          {WHY[info.why] || WHY.error}), so Dash stopped it. The rest of the
          dashboard is fine.
        </span>
        <div className="flex flex-row flex-wrap gap-2 pt-1">
          {onFix ? (
            <Button size="sm" title="Fix with AI" onClick={onFix} />
          ) : null}
          <Button2 size="sm" title="Try again" onClick={onTryAgain} />
          {onRemove ? (
            <Button3 size="sm" title="Remove" onClick={onRemove} />
          ) : null}
        </div>
      </div>
    </div>
  );
};

const PausedCard = ({ label, onTurnOn }) => {
  const { muted, strong, hairline } = useConfigTokens();
  return (
    <div
      className={`flex flex-col gap-2 h-full w-full rounded-xl border p-4 ${hairline}`}
      data-testid="widget-paused"
    >
      <span className={`text-sm font-semibold ${strong}`}>{label}</span>
      <div className="flex flex-col justify-center items-start gap-2 flex-1 min-h-0">
        <span className={`text-xs ${muted}`}>Paused</span>
        <Button2 size="sm" title="Turn on" onClick={onTurnOn} />
      </div>
    </div>
  );
};

/**
 * Above a dashboard's pages (frame 2): it's marked open while it loads (so
 * a freeze pauses it next time), and says so when its widgets are paused.
 */
export const WidgetPauseBanner = ({ dashboard }) => {
  useGuard();
  const id = dashboard ? dashboard.id : null;
  const [closed, setClosed] = useState(false);
  useEffect(() => markOpening(id), [id]);
  const reason = id != null ? pausedReason(id) : null;
  if (!reason || closed) return null;
  const name =
    (dashboard && (dashboard.name || dashboard.label)) || "This dashboard";
  return (
    <div className="px-4 pt-3" data-testid="widget-pause-banner">
      <AlertBanner
        variant="warning"
        title={
          reason === "unfinished"
            ? `${name} didn't finish loading last time, so its widgets are paused.`
            : "You started Dash without widgets, so this dashboard's widgets are paused."
        }
        message="Turn them on one at a time to find the one that froze Dash — or all at once. Editing works as usual."
        onClose={() => setClosed(true)}
      >
        <div className="pt-2">
          <Button size="sm" title="Turn all on" onClick={() => turnOn(id)} />
        </div>
      </AlertBanner>
    </div>
  );
};
