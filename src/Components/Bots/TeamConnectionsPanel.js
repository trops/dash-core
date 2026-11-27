import React, { useState } from "react";
import {
  AlertBanner,
  Button3,
  ButtonIcon,
  SectionLabel,
  SelectInput,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotAvatar } from "./BotAvatar";
import { TONE, stepTone } from "./checksView";
import { checkCost } from "./teamFlow";
import { WhatItCanDo } from "./WhatItCanDo";
import { SelectedMarker } from "./TeamChartLegend";

/**
 * TeamConnectionsPanel — the side panel of the team diagram for the
 * selected bot (DASH-139 screen 1b), in flow order: its name (the heading,
 * with the same "Selected" marker as its card) with the full
 * page (expand icon) and ✕ (the lead also gets Open conversation); Gets work
 * from; What it can do (DASH-126); Its checks with Edit checks; one box per
 * event it publishes (On Complete, On Failure, On Result · <name>) listing
 * the bots and widgets listening, each with ✕ and "+ Add a bot or widget…";
 * Tool events, collapsed; Helpers it uses.
 *
 * @param {object} bot
 * @param {object|null} connections  botConnections() (null for the lead)
 * @param {(event, value) => Promise} onAdd  value: "bot:<id>" | "widget:<key>"
 * @param {(event, listener) => Promise} onRemove
 * @param {boolean} canEdit  listeners can be added/removed now
 */
export const TeamConnectionsPanel = ({
  bot,
  connections = null,
  canEdit = true,
  onClose,
  onOpenPage,
  onOpenConversation = null,
  onOpenChecks = null,
  // Its Settings tab: "What it can do"'s Edit (DASH-126).
  onOpenSettings = null,
  onAdd,
  onRemove,
  children = null,
}) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!bot) return null;
  const isLead = bot.role === "lead";
  const steps = (bot.checks && bot.checks.steps) || [];

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(
        err && err.refused
          ? err.message
          : `Couldn't save: ${(err && err.message) || String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const rowCls = `flex flex-row items-center gap-2 rounded-lg border px-3 py-2 text-sm ${hairline} ${fieldBg}`;
  const listenerRow = (box, t) => (
    <div key={t.key} className={rowCls} data-testid={`listener-${t.key}`}>
      {t.type === "bot" ? (
        <BotAvatar bot={{ id: t.id, name: t.name }} />
      ) : (
        <span
          aria-hidden="true"
          className={`h-6 w-6 rounded flex items-center justify-center flex-shrink-0 border ${hairline} ${muted}`}
        >
          ▦
        </span>
      )}
      <span className={`flex-1 min-w-0 truncate ${strong}`}>{t.name}</span>
      {t.main ? (
        <span className={`text-xs ${muted}`}>main path</span>
      ) : t.type === "widget" ? (
        <span className={`text-xs ${muted}`}>widget</span>
      ) : null}
      {canEdit && onRemove ? (
        <ButtonIcon
          icon="xmark"
          size="xs"
          ariaLabel={`Remove ${t.name}`}
          disabled={busy}
          onClick={() => run(() => onRemove(box.event, t))}
        />
      ) : null}
    </div>
  );
  const eventBox = (box, { heading = true } = {}) => (
    <div
      key={box.event}
      className="flex flex-col gap-1.5"
      data-testid={`event-box-${box.event}`}
    >
      {heading ? (
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${
            box.event === "failed" ? "text-red-300" : muted
          }`}
        >
          {box.title}
        </span>
      ) : null}
      <div
        className={`flex flex-col gap-1.5 rounded-xl border p-2 ${hairline}`}
      >
        {box.listeners.length ? (
          box.listeners.map((t) => listenerRow(box, t))
        ) : (
          <span className={`text-xs px-1 ${muted}`}>Nothing listens yet.</span>
        )}
        {canEdit && onAdd && box.addChoices.length ? (
          <SelectInput
            value=""
            ariaLabel={`Add a bot or widget — ${box.title}`}
            placeholder="+ Add a bot or widget…"
            options={[
              { value: "", label: "+ Add a bot or widget…" },
              ...box.addChoices,
            ]}
            onChange={(v) => v && run(() => onAdd(box.event, v))}
          />
        ) : null}
      </div>
    </div>
  );

  return (
    <aside
      aria-label={`${bot.name}'s connections`}
      className={`relative flex flex-col gap-4 p-4 border-l min-w-0 ${hairline}`}
      style={{ flex: "1 1 300px", maxWidth: 360 }}
    >
      <div className="flex flex-row items-center gap-3">
        <BotAvatar bot={bot} large />
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="flex flex-row items-center gap-2 min-w-0">
            <h3
              data-testid="connections-heading"
              className={`text-base font-semibold truncate ${strong}`}
            >
              {bot.name}
            </h3>
            <SelectedMarker className="flex-shrink-0" />
          </span>
          <span className={`text-xs ${muted}`}>
            {isLead ? "Team lead" : "Its connections"}
          </span>
        </div>
        <span title="Open full page">
          <ButtonIcon
            icon="up-right-and-down-left-from-center"
            size="xs"
            ariaLabel={`Open ${bot.name}'s full page`}
            onClick={onOpenPage}
          />
        </span>
        <ButtonIcon
          icon="xmark"
          size="xs"
          ariaLabel="Close panel"
          onClick={onClose}
        />
      </div>

      {isLead && onOpenConversation ? (
        <Button3
          title="Open conversation"
          size="sm"
          onClick={onOpenConversation}
        />
      ) : null}

      {error ? (
        <AlertBanner variant="danger" size="compact" message={error} />
      ) : null}

      <div className="flex flex-col gap-1.5" data-testid="gets-work-from">
        <SectionLabel text="Gets work from" />
        {isLead ? (
          <div className={rowCls}>
            <span className={`flex-1 ${strong}`}>You</span>
            <span className={`text-xs ${muted}`}>
              it can ask any bot on the team
            </span>
          </div>
        ) : connections && connections.getsWorkFrom.length ? (
          connections.getsWorkFrom.map((a, i) => (
            <div key={`${a.botId}-${i}`} className={rowCls}>
              <BotAvatar bot={{ id: a.botId, name: a.name }} />
              <span className={`flex-1 min-w-0 truncate ${strong}`}>
                {`${a.name}${a.offTeam ? " (other dashboard)" : ""}`}
              </span>
              <span className={`text-xs ${muted}`}>{a.when}</span>
            </div>
          ))
        ) : (
          <span className={`text-sm ${muted}`}>
            Nothing — it runs manually or on its schedule.
          </span>
        )}
      </div>

      {/* DASH-126 fills this slot. */}
      <WhatItCanDo bot={bot} onEdit={onOpenSettings} />

      {isLead || !connections ? null : (
        <>
          <div className="flex flex-col gap-1.5" data-testid="its-checks">
            <div className="flex flex-row items-center justify-between gap-2">
              <SectionLabel text={`Its checks · ${steps.length}`} />
              {onOpenChecks ? (
                <Button3 title="Edit checks" size="sm" onClick={onOpenChecks} />
              ) : null}
            </div>
            {steps.length ? (
              steps.map((s, i) => {
                const tone = TONE[stepTone(s)];
                return (
                  <div
                    key={s.id || `s${i}`}
                    className={`${rowCls} items-start`}
                  >
                    <span
                      className={`flex-shrink-0 h-4 rounded px-1 flex items-center justify-center text-white font-bold ${tone.bg}`}
                      style={{ minWidth: 16, fontSize: 9, marginTop: 2 }}
                      title={tone.label}
                    >
                      {tone.short}
                    </span>
                    <span className={`flex-1 min-w-0 ${strong}`}>
                      {s.name || tone.label}
                    </span>
                    <span className={`text-xs ${muted}`}>{checkCost(s)}</span>
                  </div>
                );
              })
            ) : (
              <span className={`text-sm ${muted}`}>
                None — its work goes straight on.
              </span>
            )}
          </div>

          {connections.events.map((box) => eventBox(box))}

          {connections.toolEvents.length ? (
            <details
              className={`rounded-xl border px-3 py-2 ${hairline}`}
              data-testid="tool-events"
            >
              <summary className={`cursor-pointer text-xs ${muted}`}>
                {`Tool events · ${connections.toolEvents.length}${
                  connections.toolEvents.some((b) => b.listeners.length)
                    ? ""
                    : " (nothing listens)"
                }`}
              </summary>
              <div className="flex flex-col gap-3 mt-2">
                {connections.toolEvents.map((box) => eventBox(box))}
              </div>
            </details>
          ) : null}

          <div className="flex flex-col gap-1.5" data-testid="helpers-it-uses">
            <SectionLabel text="Helpers it uses" />
            {connections.helpers.length ? (
              connections.helpers.map((h, i) => (
                <div key={`${h.botId}-${i}`} className={rowCls}>
                  <BotAvatar bot={{ id: h.botId, name: h.name }} />
                  <span className={`flex-1 min-w-0 truncate ${strong}`}>
                    {h.name}
                  </span>
                  <span className={`text-xs ${muted}`}>
                    {`check "${h.check}"`}
                  </span>
                </div>
              ))
            ) : (
              <span className={`text-sm ${muted}`}>None.</span>
            )}
          </div>
        </>
      )}
      {children}
    </aside>
  );
};

export default TeamConnectionsPanel;
