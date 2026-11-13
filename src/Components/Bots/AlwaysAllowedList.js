import React, { useEffect, useState } from "react";
import { Button3 } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { grantRowText } from "./alwaysAllow";

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

const rowKey = (r) =>
  [r.kind, r.provider || "", r.tool, r.site || "", r.page || ""].join("|");

/**
 * A bot's "Runs without asking": every tool it may use without asking (each
 * Always allow), one row each, with Ask again. Renders nothing while there
 * are none.
 *
 * @param {string} botId
 */
export const AlwaysAllowedList = ({ botId }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let alive = true;
    const api = botsApi();
    if (!botId || !api || !api.listAlwaysAllowed) return undefined;
    const load = () =>
      Promise.resolve(api.listAlwaysAllowed(botId))
        .then((r) => {
          if (alive && Array.isArray(r)) setRows(r);
        })
        .catch(() => {});
    load();
    // An Always allow (or its Undo) answered elsewhere while this is open.
    const changed = (e) => {
      const d = (e && e.detail) || {};
      if (String(d.botId) === String(botId)) load();
    };
    window.addEventListener("dash:always-allowed-changed", changed);
    return () => {
      alive = false;
      window.removeEventListener("dash:always-allowed-changed", changed);
    };
  }, [botId]);

  const askAgain = async (row) => {
    const api = botsApi();
    if (!api || !api.forgetAlwaysAllowed) return;
    try {
      const next = await api.forgetAlwaysAllowed(botId, row);
      if (Array.isArray(next)) setRows(next);
    } catch (_e) {
      // it stays listed; Ask again can be tried again
    }
  };

  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="bot-always-allowed">
      <span
        className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
      >
        Runs without asking · {rows.length}
      </span>
      <div className={`flex flex-col rounded-lg border ${hairline}`}>
        {rows.map((r, i) => {
          const t = grantRowText(r);
          return (
            <div
              key={rowKey(r)}
              className={`flex flex-row items-center gap-3 px-3 py-2 ${
                i ? `border-t ${hairline}` : ""
              }`}
              data-testid="bot-always-allowed-row"
            >
              <span className="flex flex-1 min-w-0 flex-col">
                <span className={`text-sm font-semibold break-words ${strong}`}>
                  {t.name}
                </span>
                <span className={`text-xs break-words ${muted}`}>
                  {t.scope}
                </span>
              </span>
              <Button3
                title="Ask again"
                size="sm"
                ariaLabel={`Ask again before ${t.name}`}
                onClick={() => askAgain(r)}
              />
            </div>
          );
        })}
      </div>
      <span className={`text-xs ${muted}`}>
        Ask again puts it back to asking from the next run.
      </span>
    </div>
  );
};
