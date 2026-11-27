import React from "react";
import { Button3, SectionLabel } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { canDoView } from "./canDoView";

/**
 * WhatItCanDo — the "What it can do" section of a bot's connections panel
 * on the team diagram (DASH-126, screen 1b), after "Gets work from": what
 * this bot's own setup lets it touch and run (canDoView), each label above
 * its value: Files and shell (with the folders it works in), Asks you
 * before, Commands (Runs / Never chips), Providers (each one's allowed
 * tools as chips), then the always-blocked list once. Edit opens the bot's
 * Settings (shown when onEdit is given).
 *
 * @param {object} bot
 * @param {() => void} [onEdit]  opens the bot's Settings
 */
export const WhatItCanDo = ({ bot, onEdit = null }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  if (!bot) return null;
  const v = canDoView(bot);

  const chip = (text, key) => (
    <span
      key={key}
      className={`font-mono text-xs rounded border px-1.5 py-0.5 break-all ${hairline} ${fieldBg} ${strong}`}
    >
      {text}
    </span>
  );
  const chips = (lead, list, testid) => (
    <span
      key={testid}
      className="flex flex-row flex-wrap items-center gap-1"
      data-testid={testid}
    >
      <span className={strong}>{lead}</span>
      {list.map((c, i) => chip(c, `${c}-${i}`))}
    </span>
  );
  const item = (label, value, testid) => (
    <div className="flex flex-col gap-1" data-testid={testid}>
      <span className={`text-xs ${muted}`}>{label}</span>
      {value}
    </div>
  );
  const provider = (p) => {
    if (p.tools && p.tools.length) {
      return chips(p.label, p.tools, `can-do-provider-${p.name}`);
    }
    return (
      <span key={p.name} className={strong}>
        {p.tools ? `${p.label}: no tools` : `${p.label}: every tool it offers`}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="what-it-can-do">
      <div className="flex flex-row items-center justify-between gap-2">
        <SectionLabel text="What it can do" />
        {onEdit ? <Button3 title="Edit" size="sm" onClick={onEdit} /> : null}
      </div>
      <div
        className={`flex flex-col gap-2.5 rounded-xl border p-3 text-sm ${hairline}`}
      >
        {item(
          "Files and shell",
          <span className="flex flex-row flex-wrap items-center gap-1">
            <span className={strong}>{v.files}</span>
            {v.folders.map((f, i) => chip(f, `${f}-${i}`))}
          </span>,
          "can-do-files",
        )}
        {item(
          "Asks you before",
          <span className={strong}>{v.asks}</span>,
          "can-do-asks",
        )}
        {item(
          "Commands",
          <>
            {v.commands.note ? (
              <span className={strong}>{v.commands.note}</span>
            ) : (
              chips("Runs", v.commands.runs, "can-do-runs")
            )}
            {v.commands.never.length
              ? chips("Never", v.commands.never, "can-do-never")
              : null}
          </>,
          "can-do-commands",
        )}
        {item(
          "Providers",
          v.providers.length ? (
            v.providers.map(provider)
          ) : (
            <span className={strong}>None</span>
          ),
          "can-do-providers",
        )}
        <span className={`text-xs ${muted}`} data-testid="can-do-blocked">
          {v.alwaysBlocked}
        </span>
      </div>
    </div>
  );
};

export default WhatItCanDo;
