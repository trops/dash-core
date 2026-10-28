import React, { useCallback, useEffect, useState } from "react";
import { Button, Button3 } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

// What a Dash team tool does, in words.
const TOOL_WORDS = {
  build_widget: "build and install a widget",
  place_widget: "put a widget on a dashboard",
};

/** "The Builder wants to build and install a widget: Smart Lights". */
export function approvalText(request, botName) {
  const r = request || {};
  const what = TOOL_WORDS[r.toolName] || `use ${r.toolName || "a tool"}`;
  const input = r.input && typeof r.input === "object" ? r.input : {};
  const subject =
    input.widget || input.name || input.widgetName || input.component || null;
  const where =
    r.toolName === "place_widget" && input.dashboard
      ? ` on ${input.dashboard}`
      : "";
  return `${botName || "A Dash team bot"} wants to ${what}${
    subject ? `: ${subject}` : ""
  }${where}.`;
}

/**
 * The Dash team's approvals waiting on the user — Allow once, Always allow,
 * or Deny — wherever the user is working with the team (Create, Ask, the
 * Dash team page, the Bots panel). A team bot asks before it changes
 * anything, and its run waits until it's answered; the Bots page lists
 * only the user's own bots, so without this nobody can answer it.
 *
 * Renders nothing when none is waiting.
 */
export const DashTeamApprovals = ({ compact = false }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [team, setTeam] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [busy, setBusy] = useState(null);

  const reload = useCallback(async () => {
    const b = api();
    if (!b || !b.listApprovals) return;
    try {
      const list = await b.listApprovals();
      setApprovals(Array.isArray(list) ? list : []);
    } catch (_e) {
      // keep what's shown on a transient IPC error
    }
  }, []);

  useEffect(() => {
    const b = api();
    if (!b) return undefined;
    // The team, once (it doesn't change while this is open).
    if (b.listDashTeam) {
      Promise.resolve(b.listDashTeam())
        .then((members) => setTeam(Array.isArray(members) ? members : []))
        .catch(() => {});
    }
    reload();
    const ids = [];
    // A change carries the whole list; without that event, reload on a new one.
    if (b.onApprovalsChanged) {
      ids.push(
        b.onApprovalsChanged((payload) =>
          payload && Array.isArray(payload.approvals)
            ? setApprovals(payload.approvals)
            : reload(),
        ),
      );
    } else if (b.onApprovalPending) {
      ids.push(b.onApprovalPending(() => reload()));
    }
    return () => {
      for (const id of ids) if (b.removeListener) b.removeListener(id);
    };
  }, [reload]);

  const byId = new Map(team.map((t) => [t.id, t]));
  const waiting = approvals.filter(
    (a) => a && a.request && byId.has(a.request.botId),
  );
  if (!waiting.length) return null;

  const answer = async (id, decision) => {
    const b = api();
    if (!b || !b.approve || busy) return;
    setBusy(id);
    try {
      await b.approve(id, decision);
    } finally {
      setBusy(null);
      reload();
    }
  };

  return (
    <div
      className={`flex flex-col gap-2 ${compact ? "" : "max-w-3xl"}`}
      data-testid="dash-team-approvals"
    >
      {waiting.map((a) => {
        const bot = byId.get(a.request.botId);
        return (
          <div
            key={a.id}
            className={`flex flex-col gap-2 rounded-lg border p-3 text-sm ${hairline} ${strong}`}
            data-testid="dash-team-approval"
          >
            <span>{approvalText(a.request, bot && bot.name)}</span>
            <span className={`text-xs ${muted}`}>
              It&apos;s waiting for your answer before it carries on.
            </span>
            <div className="flex flex-row flex-wrap items-center gap-2">
              <Button
                title="Allow once"
                size="sm"
                onClick={() => answer(a.id, { allow: true })}
              />
              {/* Always allow saves a grant — not for the team's build
                  tools (nothing shows a Dash team bot's grants to undo). */}
              {a.request.serverName &&
              a.request.serverName !== "dash-team-build" ? (
                <Button3
                  title="Always allow"
                  size="sm"
                  onClick={() => answer(a.id, { allow: true, remember: true })}
                />
              ) : null}
              <Button3
                title="Deny"
                size="sm"
                onClick={() => answer(a.id, { allow: false })}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DashTeamApprovals;
