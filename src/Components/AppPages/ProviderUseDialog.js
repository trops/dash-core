import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Button,
  Button3,
  Checkbox,
  Modal,
  SectionLabel,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const initialPicks = (model) => {
  const picks = {};
  for (const d of (model && model.dashboards) || []) {
    for (const r of d.rows) picks[r.key] = r.usesThis;
  }
  for (const b of (model && model.bots) || []) picks[b.key] = b.usesThis;
  return picks;
};

// A row whose current provider needs setup, or that has none at all.
const needsAttention = (row) =>
  !row.locked && (row.current.needsSetup || row.current.kind === "none");

/**
 * ProviderUseDialog — "Use <provider> for…" (app-navigation PRD NAV-015).
 * Every widget that takes this provider's type, grouped by dashboard, and
 * the bots (MCP providers only); ticked = uses this provider. Unticking
 * removes it (the widget falls back to the type's default, shown inline).
 *
 * @param model   providerUseModel(...)
 * @param onSave  (picks) => Promise<applyProviderUse result>
 */
export const ProviderUseDialog = ({ isOpen, model, onSave, onClose }) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const { muted, strong, hairline } = useConfigTokens();
  const [picks, setPicks] = useState(() => initialPicks(model));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setPicks(initialPicks(model));
      setResult(null);
      setSaving(false);
    }
  }, [isOpen, model]);

  const changes = useMemo(() => {
    let n = 0;
    for (const d of (model && model.dashboards) || []) {
      for (const r of d.rows)
        if (!r.locked && !!picks[r.key] !== r.usesThis) n++;
    }
    for (const b of (model && model.bots) || []) {
      if (!!picks[b.key] !== b.usesThis) n++;
    }
    return n;
  }, [model, picks]);

  if (!isOpen || !model) return null;

  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {});
  const set = (key, value) => setPicks((p) => ({ ...p, [key]: value }));
  const tickAll = (rows) =>
    setPicks((p) => {
      const next = { ...p };
      for (const r of rows) if (!r.locked) next[r.key] = true;
      return next;
    });
  const attention = model.dashboards.flatMap((d) =>
    d.rows.filter(needsAttention),
  );
  const fallback = model.defaultName || "none set";

  const save = async () => {
    setSaving(true);
    try {
      setResult(await onSave(picks));
    } catch (err) {
      setResult({
        widgets: 0,
        removed: 0,
        dashboards: 0,
        bots: 0,
        failed: [
          { kind: "save", name: "Save", error: (err && err.message) || "" },
        ],
      });
    } finally {
      setSaving(false);
    }
  };

  const nowText = (row) => {
    const c = row.current;
    if (c.kind === "none") return "now: no provider";
    const label = c.kind === "default" ? `default — ${c.name}` : c.name;
    return `now: ${label}${c.needsSetup ? " · needs setup" : ""}`;
  };
  const afterText = (row) => {
    const ticked = !!picks[row.key];
    if (row.locked || ticked === row.usesThis) return null;
    return ticked ? `→ ${model.providerName}` : `→ uses default: ${fallback}`;
  };

  const summary = (r) => {
    const parts = [];
    if (r.widgets) {
      parts.push(
        `${plural(r.widgets, "more widget")} on ${plural(r.dashboards, "dashboard")}`,
      );
    }
    if (r.bots) parts.push(plural(r.bots, "bot"));
    const used = parts.length
      ? `${model.providerName} is now used by ${parts.join(" and ")}.`
      : "";
    const removed = r.removed
      ? ` Removed from ${plural(r.removed, "widget")}.`
      : "";
    return `${used}${removed}`.trim() || "Nothing was changed.";
  };

  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={(open) => !open && onClose()}
      width="w-2/3"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full min-h-0 rounded-lg border ${hairline} ${panel.backgroundColor || ""} ${panel.textColor || ""}`}
      >
        <div
          className={`flex flex-row items-center justify-between gap-3 px-6 py-4 border-b ${hairline}`}
        >
          <div className="flex flex-col min-w-0">
            <span className={`text-base font-semibold truncate ${strong}`}>
              {`Use ${model.providerName} for…`}
            </span>
            <span className={`text-xs ${muted}`}>
              Ticked widgets and bots use this provider. Unticked widgets use
              the default for {model.providerType}.
            </span>
          </div>
          {!result && attention.length ? (
            <Button3
              title="Select all needing setup"
              size="xs"
              onClick={() => tickAll(attention)}
            />
          ) : null}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-5">
          {result ? (
            <div className="flex flex-col gap-2">
              <span
                data-testid="provider-use-summary"
                className={`text-sm ${strong}`}
              >
                {summary(result)}
              </span>
              {result.failed.length ? (
                <div
                  data-testid="provider-use-failed"
                  className="flex flex-col gap-1 text-sm text-amber-400"
                >
                  <span>Couldn't save:</span>
                  {result.failed.map((f) => (
                    <span key={`${f.kind}-${f.name}`}>
                      {`${f.name} (${f.kind}): ${f.error}`}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {!model.dashboards.length && !model.bots.length ? (
                <span className={`text-sm ${muted}`}>
                  No widgets or bots take a {model.providerType} provider.
                </span>
              ) : null}
              {model.dashboards.map((d) => (
                <div key={`d-${d.workspaceId}`} className="flex flex-col gap-2">
                  <div className="flex flex-row items-center justify-between gap-3">
                    <span className={`text-sm font-medium ${strong}`}>
                      {d.workspaceName}
                    </span>
                    <Button3
                      title="Select all"
                      ariaLabel={`Select all in ${d.workspaceName}`}
                      size="xs"
                      onClick={() => tickAll(d.rows)}
                    />
                  </div>
                  {d.rows.map((row) => (
                    <Row
                      key={row.key}
                      row={row}
                      label={row.label}
                      checked={!!picks[row.key]}
                      onChange={(v) => set(row.key, v)}
                      now={nowText(row)}
                      warn={row.current.needsSetup}
                      after={afterText(row)}
                      muted={muted}
                    />
                  ))}
                </div>
              ))}
              {model.bots.length ? (
                <div className="flex flex-col gap-2">
                  <SectionLabel text="Bots" />
                  {model.bots.map((b) => {
                    const ticked = !!picks[b.key];
                    return (
                      <Row
                        key={b.key}
                        row={b}
                        label={b.name}
                        checked={ticked}
                        onChange={(v) => set(b.key, v)}
                        now={
                          b.others.length
                            ? `also uses: ${b.others.join(", ")}`
                            : null
                        }
                        after={
                          ticked === b.usesThis
                            ? null
                            : ticked
                              ? `→ gets ${model.providerName}`
                              : `→ loses ${model.providerName}`
                        }
                        muted={muted}
                      />
                    );
                  })}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div
          className={`flex flex-row justify-end gap-2 px-6 py-3 border-t ${hairline}`}
        >
          {result ? (
            <Button title="Close" onClick={onClose} />
          ) : (
            <>
              <Button3 title="Cancel" onClick={onClose} />
              <Button
                title={
                  changes
                    ? `Save — ${plural(changes, "change")}`
                    : "Save — no changes"
                }
                disabled={!changes || saving}
                onClick={save}
              />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

const Row = ({ row, label, checked, onChange, now, warn, after, muted }) => (
  <div className="flex flex-row items-center justify-between gap-3 pl-2">
    <Checkbox
      label={label}
      checked={checked}
      disabled={!!row.locked}
      onChange={(v) => onChange(!!v)}
    />
    <span className="flex flex-row items-center gap-2 text-xs min-w-0">
      {now ? (
        <span
          data-testid={`now-${row.key}`}
          className={`truncate ${warn ? "text-amber-400" : muted}`}
        >
          {now}
        </span>
      ) : null}
      {after ? (
        <span data-testid={`after-${row.key}`} className="truncate">
          {after}
        </span>
      ) : null}
    </span>
  </div>
);

export default ProviderUseDialog;
