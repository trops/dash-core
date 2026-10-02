import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  Button3,
  ButtonIcon,
  FontAwesomeIcon,
  ThemeContext,
} from "@trops/dash-react";
import { AskLead } from "./AskLead";
import { sameWorkspace } from "./teamUtils";

/**
 * TeamLeadSection — a dashboard's team lead (bot-teams PRD TEAM-002/003):
 * its one-time introduction, Ask the lead, and Turn off / Turn on. Used by
 * Dashboard Config › Bots and the Bot Activity panel.
 *
 * The lead itself is created (idle) when the dashboard opens — see
 * DashboardStage → bots.ensureLead.
 */
export const TeamLeadSection = ({ workspace }) => {
  const { currentTheme } = useContext(ThemeContext) || {};
  const [lead, setLead] = useState(null);
  const [settings, setSettings] = useState(null);
  const [asking, setAsking] = useState(false);

  const refresh = useCallback(async () => {
    const api = typeof window !== "undefined" ? window.mainApi : null;
    if (!workspace || !api?.bots?.list) return;
    try {
      const [bots, ts] = await Promise.all([
        api.bots.list(),
        api.bots.getTeamSettings
          ? api.bots.getTeamSettings(workspace.id)
          : { leadEnabled: true },
      ]);
      setLead(
        (bots || []).find(
          (b) =>
            b.role === "lead" && sameWorkspace(b.workspaceId, workspace.id),
        ) || null,
      );
      setSettings(ts || { leadEnabled: true });
    } catch (_e) {
      // Keep the last view on a transient IPC error.
    }
  }, [workspace]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!workspace || !settings) return null;

  const setEnabled = async (enabled) => {
    await window.mainApi.bots.setLeadEnabled(
      workspace.id,
      enabled,
      workspace.name,
    );
    setAsking(false);
    refresh();
  };

  if (!lead) {
    return settings.leadEnabled === false ? (
      <div className="flex flex-row items-center justify-between gap-3">
        <span className="text-xs opacity-60">
          This dashboard&apos;s team lead is off.
        </span>
        <Button3 title="Turn on" size="xs" onClick={() => setEnabled(true)} />
      </div>
    ) : null;
  }

  // Theme tokens (not hard-coded colors) so the section reads correctly on
  // any surface — the Activity panel and Dashboard Config alike.
  const textColor = currentTheme?.["text-primary-light"] || "text-gray-200";
  const mutedColor = currentTheme?.["text-neutral-medium"] || "text-gray-400";
  const hairline = currentTheme?.["border-neutral-dark"] || "border-gray-700";

  return (
    <div className={`flex flex-col gap-2 ${textColor}`}>
      <div className="flex flex-row items-center justify-between gap-3">
        <div className="flex flex-row items-center gap-2 min-w-0">
          <FontAwesomeIcon
            icon="robot"
            className={`h-3.5 w-3.5 flex-shrink-0 ${mutedColor}`}
          />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">{lead.name}</span>
            <span className={`text-xs ${mutedColor}`}>Team lead · idle</span>
          </div>
        </div>
        <div className="flex flex-row items-center gap-1 flex-shrink-0">
          {/* Secondary — the view's primary action stays "Add bot". */}
          <Button3
            title={asking ? "Hide chat" : "Ask the lead"}
            size="xs"
            onClick={() => setAsking((v) => !v)}
          />
          <Button3
            title="Turn off"
            size="xs"
            tooltip="Remove this dashboard's lead. You can turn it back on."
            onClick={() => setEnabled(false)}
          />
        </div>
      </div>
      {!settings.introDismissed ? (
        <div
          className={`flex flex-row items-start justify-between gap-2 border rounded-md px-3 py-2 ${hairline}`}
        >
          <span className={`text-xs ${mutedColor}`}>
            I&apos;m this dashboard&apos;s team lead. Ask me what the team is
            doing, what it found, or what failed — I answer from the team&apos;s
            runs and shared memory. I don&apos;t run on my own, so I cost
            nothing until you ask.
          </span>
          <ButtonIcon
            icon="xmark"
            size="sm"
            ariaLabel="Dismiss introduction"
            onClick={() => {
              window.mainApi.bots.dismissLeadIntro(workspace.id);
              setSettings((s) => ({ ...s, introDismissed: true }));
            }}
          />
        </div>
      ) : null}
      {asking ? <AskLead lead={lead} /> : null}
    </div>
  );
};
