/**
 * RecipientPicker — the AI Assistant's "To:" picker (bot-teams TEAM-013).
 *
 * "Assistant" (default) or a team lead, grouped under "Team leads" and
 * labelled "<lead> · <dashboard>" with its state. Picking a lead sends the
 * next messages straight to that lead instead of the Assistant's model.
 */
import { useEffect, useState } from "react";
import { Caption2, SelectInput } from "@trops/dash-react";
import { leadLabel } from "../leadMessages";

export const ASSISTANT_VALUE = "__assistant__";

const stateSuffix = (lead) =>
  lead.paused
    ? " — paused"
    : lead.overBudget
      ? " — over budget"
      : lead.running
        ? " — running"
        : "";

/**
 * Team leads by dashboard, refreshed when bots change or runs start/finish.
 * `enabled` false → no IPC at all (chats that don't offer lead recipients).
 */
export function useTeamLeads(enabled) {
  const [leads, setLeads] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const bots = typeof window !== "undefined" && window.mainApi?.bots;
    if (!enabled || !bots?.listLeads) return undefined;
    let cancelled = false;
    const refresh = () => {
      Promise.resolve(bots.listLeads())
        .then((list) => {
          if (cancelled) return;
          setLeads(Array.isArray(list) ? list : []);
          setLoaded(true);
        })
        .catch(() => {
          if (!cancelled) setLoaded(true);
        });
    };
    refresh();
    const ids = [];
    if (bots.onListChanged) ids.push(bots.onListChanged(refresh));
    if (bots.onRunActive) ids.push(bots.onRunActive(refresh));
    return () => {
      cancelled = true;
      for (const id of ids) {
        if (id != null && bots.removeListener) bots.removeListener(id);
      }
    };
  }, [enabled]);

  return { leads, loaded };
}

export const RecipientPicker = ({ leads, recipient, onChange, disabled }) => {
  const options = [
    { value: ASSISTANT_VALUE, label: "Assistant" },
    ...leads.map((lead) => ({
      value: lead.botId,
      label: `${leadLabel(lead)}${stateSuffix(lead)}`,
      group: "Team leads",
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
      <Caption2>To:</Caption2>
      <SelectInput
        label=""
        placeholder="Send to"
        value={recipient ? recipient.botId : ASSISTANT_VALUE}
        options={options}
        disabled={disabled}
        className="flex-1 min-w-0"
        inputClassName="text-xs py-1"
        onChange={(value) => {
          if (value === ASSISTANT_VALUE) {
            onChange(null);
            return;
          }
          const lead = leads.find((l) => l.botId === value);
          if (lead) onChange(lead);
        }}
      />
      {leads.length === 0 && (
        <Caption2 className="opacity-70">
          No team leads yet — turn one on in a dashboard's Bots view.
        </Caption2>
      )}
    </div>
  );
};
