import React, { useEffect, useState } from "react";
import { AlertBanner, FontAwesomeIcon, StatusBadge } from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

const getMainApi = () =>
  typeof window !== "undefined" ? window.mainApi : null;

/**
 * A bot's built-in instructions (bot-teams TEAM-017): what Dash needs it to
 * do, read-only and closed until opened. The user's own instructions are
 * added after these at run time, so editing them can't take these away.
 *
 * @param {{ botId?: string|null, kind: "lead"|"role"|"bot" }} props
 *   `kind` picks the wording; a new bot (no id yet) shows the rules every
 *   bot gets.
 */
export const BuiltinInstructions = ({ botId = null, kind = "bot" }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const [info, setInfo] = useState(null);
  const [open, setOpen] = useState(false);

  // Read again each time it's opened: a lead's text names its dashboard,
  // which can be renamed while these settings are open.
  useEffect(() => {
    let alive = true;
    const api = getMainApi();
    if (!api?.bots?.builtinInstructions) return undefined;
    Promise.resolve(api.bots.builtinInstructions(botId))
      .then((r) => {
        if (alive && r && !r.error) setInfo(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [botId, open]);

  const dismissNotice = () => {
    setInfo((prev) => (prev ? { ...prev, notice: false } : prev));
    const api = getMainApi();
    if (botId && api?.bots?.dismissLayersNotice) {
      Promise.resolve(api.bots.dismissLayersNotice(botId)).catch(() => {});
    }
  };

  if (!info || !info.builtin) return null;
  const regular = kind === "bot";
  const title = regular
    ? "Built-in rules every bot follows"
    : "Built-in instructions";
  const sub = regular
    ? "Rules about tool data and approvals. You can't edit them."
    : `What Dash needs this ${
        kind === "lead" ? "lead" : "role"
      } to do. Kept up to date with Dash — you can't edit them.`;

  return (
    <div className="flex flex-col gap-2">
      {info.notice ? (
        <AlertBanner
          variant="info"
          size="compact"
          message="Dash's built-in instructions now always come first, so this bot keeps what Dash needs it to do. Your own text is kept below as your instructions; the copy of Dash's text that was in it was taken out."
          onClose={dismissNotice}
        />
      ) : null}
      <div
        className={`flex flex-col rounded-md border ${hairline}`}
        data-testid="builtin-instructions"
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex flex-row items-center gap-3 px-3 py-2 text-left"
        >
          <FontAwesomeIcon
            icon={open ? "chevron-down" : "chevron-right"}
            className={`text-xs ${muted}`}
          />
          <span className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className={`text-sm font-medium ${strong}`}>{title}</span>
            <span className={`text-xs ${muted}`}>{sub}</span>
          </span>
          <StatusBadge state="neutral" label="Always on" />
        </button>
        {open ? (
          <div
            className={`mx-3 mb-3 max-h-72 overflow-y-auto rounded-md border px-3 py-2 font-mono text-xs whitespace-pre-wrap select-text ${hairline} ${fieldBg} ${strong}`}
          >
            {info.builtin}
          </div>
        ) : null}
      </div>
    </div>
  );
};
