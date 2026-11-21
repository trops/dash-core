import React, { useEffect, useState } from "react";
import { Button, Button3 } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { grantRowText, isAnywhere, providerFiles } from "./alwaysAllow";

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
 * are none and it has no providers. A provider row can be widened to
 * anywhere in that provider's files, or back (DASH-30), and each of its
 * providers can have all its tools allowed ahead of time (DASH-29).
 *
 * @param {string} botId
 * @param {string[]} [providers]  the providers the bot uses
 */
export const AlwaysAllowedList = ({ botId, providers = [] }) => {
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

  const change = async (provider, action) => {
    const api = botsApi();
    if (!api || !api.changeAlwaysAllowed) return;
    try {
      const next = await api.changeAlwaysAllowed(botId, provider, action);
      if (Array.isArray(next)) setRows(next);
    } catch (_e) {
      // unchanged; it can be tried again
    }
  };
  // Providers it uses whose tools aren't all allowed yet.
  const notAll = (providers || []).filter(
    (p) =>
      !rows.some(
        (r) => r.kind === "tool" && r.provider === p && r.tool === "*",
      ),
  );

  const allTools = new Set(
    rows
      .filter((r) => r.kind === "tool" && r.tool === "*")
      .map((r) => r.provider),
  );

  if (!rows.length && !notAll.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="bot-always-allowed">
      {rows.length ? (
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
        >
          Runs without asking · {rows.length}
        </span>
      ) : null}
      {rows.length ? (
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
                  <span
                    className={`text-sm font-semibold break-words ${strong}`}
                  >
                    {t.name}
                  </span>
                  <span className={`text-xs break-words ${muted}`}>
                    {t.scope}
                  </span>
                </span>
                {r.kind === "tool" &&
                r.tool !== "*" &&
                !isAnywhere(r) &&
                (r.folders || []).length ? (
                  <Button3
                    title={`Anywhere in ${providerFiles(r.provider)}`}
                    size="sm"
                    ariaLabel={`Allow its ${r.provider} tools anywhere in ${providerFiles(r.provider)}`}
                    onClick={() => change(r.provider, "anywhere")}
                  />
                ) : null}
                {/* Folders are kept per provider: narrowing back would also
                    narrow "All its tools", so not while that's allowed. */}
                {r.kind === "tool" &&
                r.tool !== "*" &&
                isAnywhere(r) &&
                !allTools.has(r.provider) &&
                (r.folders || []).some((x) => x !== ".") ? (
                  <Button3
                    title="Only its folders"
                    size="sm"
                    ariaLabel={`Allow its ${r.provider} tools only in their folders`}
                    onClick={() => change(r.provider, "folders")}
                  />
                ) : null}
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
      ) : null}
      {rows.length ? (
        <span className={`text-xs ${muted}`}>
          Ask again puts it back to asking from the next run.
        </span>
      ) : null}
      {notAll.length ? (
        <div className="flex flex-col gap-2" data-testid="bot-allow-ahead">
          <span className={`text-sm font-semibold ${strong}`}>
            Allow a provider's tools ahead of time
          </span>
          <span className={`text-xs ${muted}`}>
            For a bot that runs on its own: every tool it may use on that
            provider runs without asking from its first run, anywhere in that
            provider's files. That includes tools that delete or send, even when
            its lead asks.
          </span>
          <div className={`flex flex-col rounded-lg border ${hairline}`}>
            {notAll.map((p, i) => (
              <div
                key={p}
                className={`flex flex-row items-center gap-3 px-3 py-2 ${
                  i ? `border-t ${hairline}` : ""
                }`}
              >
                <span
                  className={`flex-1 min-w-0 text-sm font-semibold break-words ${strong}`}
                >
                  {p}
                </span>
                <Button
                  title="Always allow all its tools"
                  size="sm"
                  ariaLabel={`Always allow all of ${p}'s tools`}
                  onClick={() => change(p, "all-tools")}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
