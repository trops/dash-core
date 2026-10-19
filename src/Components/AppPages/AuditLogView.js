import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button3, Card2, FilterMenu } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import {
  AUDIT_KINDS,
  auditKindLabel,
  auditSentence,
  auditWhen,
} from "../Bots/auditText";

/**
 * AuditLogView — Manage › Bots › Log (bot-factory US-003 AC5, US-014 AC9,
 * US-019 AC6): the saved record of approvals, tools that ran without asking,
 * access changes, pause and stop, budget changes, and bots created or
 * deleted. Newest first, filtered by bot and kind, "Show older" pages back.
 *
 * @param {{ bots: Array<{ id: string, name: string }>, botIds: string[],
 *   onBotIdsChange: (ids: string[]) => void }} props
 *   botIds — the Bot filter, kept by the page so a bot's details can open the
 *   Log filtered to it
 */
const PAGE = 50;
// One empty filter, so a default doesn't change on every render.
const NONE = [];

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

export const AuditLogView = ({
  bots = NONE,
  botIds = NONE,
  onBotIdsChange = () => {},
  // One bot's page (NAV-016): already filtered to it — no Bot filter.
  hideBotFilter = false,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [kinds, setKinds] = useState([]);
  const [entries, setEntries] = useState(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);
  // How many entries are showing — a reload keeps the pages already opened.
  const shown = useRef(PAGE);

  const load = useCallback(async () => {
    const b = api();
    if (!b || !b.auditLog) {
      setEntries([]);
      return;
    }
    try {
      const res = await b.auditLog({ botIds, kinds, limit: shown.current });
      setEntries((res && res.entries) || []);
      setMore(!!(res && res.more));
      setError(null);
    } catch (_e) {
      setError("Couldn't read the log.");
      setEntries((prev) => prev || []);
    }
  }, [botIds, kinds]);

  useEffect(() => {
    shown.current = PAGE;
    load();
  }, [load]);

  // New entries arrive as bots run, approvals are answered and settings
  // change.
  useEffect(() => {
    const b = api();
    if (!b) return undefined;
    const ids = [];
    const on = (name, fn) => {
      if (typeof b[name] === "function") ids.push(b[name](fn));
    };
    on("onStream", ({ event } = {}) => {
      const t = event && event.type;
      if (t === "done" || t === "error") load();
    });
    on("onApprovalsChanged", () => load());
    on("onListChanged", () => load());
    on("onRunActive", () => load());
    return () => {
      for (const id of ids) if (b.removeListener) b.removeListener(id);
    };
  }, [load]);

  const showOlder = async () => {
    const b = api();
    const last = entries && entries[entries.length - 1];
    if (!b || !b.auditLog || !last) return;
    try {
      const res = await b.auditLog({
        botIds,
        kinds,
        before: last.id,
        limit: PAGE,
      });
      const older = (res && res.entries) || [];
      setEntries((prev) => [...(prev || []), ...older]);
      setMore(!!(res && res.more));
      shown.current += older.length;
    } catch (_e) {
      setError("Couldn't read the log.");
    }
  };

  const botOptions = bots.map((b) => ({
    value: b.id,
    label: b.name || "Untitled bot",
  }));
  const filtered = botIds.length > 0 || kinds.length > 0;

  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 pb-6 ${strong}`}
      data-testid="audit-log-view"
    >
      <div className="flex-shrink-0 flex flex-row flex-wrap items-center gap-2">
        {hideBotFilter ? null : (
          <FilterMenu
            label="Bot"
            options={botOptions}
            selected={botIds}
            onChange={onBotIdsChange}
          />
        )}
        <FilterMenu
          label="Kind"
          options={AUDIT_KINDS}
          selected={kinds}
          onChange={setKinds}
        />
        <span className={`text-xs ${muted}`}>
          Names only — never what a tool was sent, a prompt or an answer.
        </span>
      </div>
      {entries === null ? (
        <span className={`text-sm ${muted}`} data-testid="audit-log-loading">
          Loading the log…
        </span>
      ) : (
        <Card2
          padding="p-4"
          rounded="rounded-lg"
          shadow=""
          className="flex flex-col"
          testId="audit-log"
        >
          {error ? (
            <span className="text-sm py-2" data-testid="audit-log-error">
              {error}
            </span>
          ) : null}
          {entries.length ? (
            entries.map((e, i) => (
              <div
                key={e.id || i}
                className={`flex flex-col gap-0.5 py-2 ${
                  i ? `border-t ${hairline}` : ""
                }`}
                data-testid="audit-log-row"
              >
                <span className={`text-sm ${strong}`}>{auditSentence(e)}</span>
                <span className={`text-xs ${muted}`}>
                  {auditWhen(e)} · {auditKindLabel(e.kind)}
                </span>
              </div>
            ))
          ) : (
            <span
              className={`text-sm py-2 ${muted}`}
              data-testid="audit-log-empty"
            >
              {filtered
                ? "Nothing in the log matches these filters."
                : "Nothing logged yet. Approvals, pauses, budget changes and tools that ran without asking show here."}
            </span>
          )}
          {more ? (
            <div className="pt-2">
              <Button3 title="Show older" size="sm" onClick={showOlder} />
            </div>
          ) : null}
        </Card2>
      )}
    </div>
  );
};

export default AuditLogView;
