import React, { useState } from "react";
import { AlertBanner, Button, Button2, Button3 } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { ModelPicker } from "./ModelPicker";
import {
  choiceLabel,
  choiceText,
  nameFromId,
  resolveModel,
} from "./modelChoices";

/**
 * A retired model's name: from the list when it's still there, else from
 * its id ("Claude Sonnet 4").
 */
export function retiredName(models, id) {
  const m = resolveModel(models, id);
  return m && m.label ? m.label : nameFromId(id);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "12 widgets", "12 widgets, 1 bot and 1 default" — what's still on it. */
export function whatsOnIt(usage) {
  const k = usage.kinds || {};
  const parts = [];
  if (k.widget) parts.push(plural(k.widget, "widget", "widgets"));
  if (k.bot) parts.push(plural(k.bot, "bot", "bots"));
  const defaults = (k.default || 0) + (k.teamPick || 0);
  if (defaults) parts.push(plural(defaults, "default", "defaults"));
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The rows under the notice: dashboards (same-named ones together), then
 * bots, then defaults.
 */
export function usageRows(usage) {
  const rows = [];
  const byName = new Map();
  for (const d of usage.dashboards || []) {
    // Dashboards in a profile that isn't open say so.
    const key = d.otherProfile ? `${d.name}\u0000other` : d.name;
    const row = byName.get(key) || {
      name: d.name,
      other: !!d.otherProfile,
      boards: 0,
      count: 0,
    };
    row.boards++;
    row.count += d.count;
    byName.set(key, row);
  }
  // Most widgets first.
  const boards = [...byName].sort((a, b) => b[1].count - a[1].count);
  for (const [, r] of boards) {
    const name = r.boards > 1 ? `${r.name} (${r.boards} dashboards)` : r.name;
    rows.push({
      name: r.other ? `${name} · in another profile` : name,
      count: plural(r.count, "widget", "widgets"),
    });
  }
  for (const b of usage.bots || []) rows.push({ name: b.name, count: "bot" });
  for (const c of usage.defaultJobs || []) {
    rows.push({ name: c, count: "default" });
  }
  return rows;
}

/** "Latest Sonnet (now Sonnet 5.5)" or "Sonnet 5.5". */
export function moveLabel(models, to) {
  return choiceText(models, to).replace(/, now (.*)$/, " (now $1)");
}

/** The exact model a family's "Latest" is now ("claude-sonnet-5-5"), or null. */
function exactNow(models, to) {
  const m = resolveModel(models, to);
  return m && m.value !== to ? m : null;
}

/**
 * "Moved 10 widgets on 10 dashboards from Claude Sonnet 4 to Latest Sonnet
 * (now Sonnet 5.5)." — and, when some widgets got the exact model (their
 * Model lists versions), says so.
 */
export function movedText(models, usage, result) {
  const boards =
    result.dashboards > 0
      ? ` on ${plural(result.dashboards, "dashboard", "dashboards")}`
      : "";
  const failed = result.failed
    ? ` ${plural(result.failed, "dashboard", "dashboards")} couldn't be saved; try again.`
    : "";
  const m = exactNow(models, result.to);
  const exact =
    result.exact && m
      ? ` ${plural(result.exact, "widget lists", "widgets list")} exact versions, so ${result.exact === 1 ? "it's" : "they're"} on ${String(m.label || m.value).replace(/^Claude /, "")}.`
      : "";
  return `Moved ${whatsOnIt(usage)}${boards} from ${retiredName(models, usage.model)} to ${moveLabel(models, result.to)}.${exact}${failed}`;
}

/**
 * RetiredModelNotice — Settings › AI, when a retired model is still saved
 * somewhere: what's on it, what it's been running on instead, and Move all
 * (or Choose another model). After a move: what moved, from what, to what.
 */
export function RetiredModelNotice({ models, usage, onMove }) {
  const { muted, strong, hairline } = useConfigTokens();
  const [choosing, setChoosing] = useState(null);
  const [pick, setPick] = useState("");
  const [moved, setMoved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const retired = (usage && usage.retired) || [];

  // forAll: every widget gets `to` as chosen, even one whose own Model
  // lists exact versions.
  const move = async (u, to, opts = {}) => {
    setBusy(true);
    setError(null);
    try {
      const res = await onMove(u.model, to, opts);
      if (res && res.error) setError(res.error);
      else if (res) setMoved({ usage: u, result: res });
      setChoosing(null);
    } catch (e) {
      setError((e && e.message) || "That didn't move.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {moved ? (
        <div data-testid="ai-model-moved">
          <AlertBanner
            variant="success"
            message={movedText(models, moved.usage, moved.result)}
          >
            <div className="flex flex-row pt-2">
              <Button3
                title="Dismiss"
                size="sm"
                onClick={() => setMoved(null)}
              />
            </div>
          </AlertBanner>
        </div>
      ) : null}
      {retired.map((u) => {
        const name = retiredName(models, u.model);
        const now = u.to ? resolveModel(models, u.to) : null;
        const rows = usageRows(u);
        return (
          <div key={u.model} data-testid="ai-retired-model">
            <AlertBanner
              variant="warning"
              title={`${whatsOnIt(u)} ${u.count === 1 ? "is" : "are"} set to ${name}, which Anthropic retired`}
              message={
                now
                  ? `${u.count === 1 ? "It's" : "They've"} been running on ${String(now.label || now.value).replace(/^Claude /, "")} instead. Move ${u.count === 1 ? "it" : "them"} so ${u.count === 1 ? "its settings say" : "their settings say"} what ${u.count === 1 ? "it really uses" : "they really use"}.`
                  : `Dash doesn't know what replaced it. Choose a model to move ${u.count === 1 ? "it" : "them"} to.`
              }
            >
              <div className="flex flex-col pt-2">
                {rows.map((r) => (
                  <div
                    key={r.name}
                    className={`flex flex-row items-center gap-3 py-1.5 border-t text-sm ${hairline}`}
                  >
                    <span className={`flex-1 min-w-0 ${strong}`}>{r.name}</span>
                    <span className={muted}>{r.count}</span>
                  </div>
                ))}
              </div>
              {error ? (
                <span className={`text-sm ${strong}`} role="alert">
                  {error}
                </span>
              ) : null}
              {choosing === u.model ? (
                <div className="flex flex-row flex-wrap items-end gap-2 pt-2">
                  <div className="w-64">
                    <ModelPicker
                      ariaLabel="Move them to"
                      models={models}
                      value={pick}
                      onChange={setPick}
                    />
                  </div>
                  <Button
                    title={busy ? "Moving…" : `Move all ${u.count}`}
                    size="sm"
                    disabled={!pick || busy}
                    onClick={() => move(u, pick, { forAll: true })}
                  />
                  <Button3
                    title="Cancel"
                    size="sm"
                    disabled={busy}
                    onClick={() => setChoosing(null)}
                  />
                </div>
              ) : (
                <div className="flex flex-row flex-wrap gap-2 pt-2">
                  {u.to ? (
                    <Button
                      title={
                        busy
                          ? "Moving…"
                          : `Move all ${u.count} to ${choiceLabel(models, u.to)}`
                      }
                      size="sm"
                      disabled={busy}
                      onClick={() => move(u, u.to, { forAll: true })}
                    />
                  ) : null}
                  {u.to && exactNow(models, u.to) ? (
                    <Button2
                      title={`Move all ${u.count} to ${choiceLabel(models, exactNow(models, u.to).value)}`}
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        move(u, exactNow(models, u.to).value, { forAll: true })
                      }
                    />
                  ) : null}
                  <Button2
                    title="Choose another model"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setPick(u.to || "");
                      setChoosing(u.model);
                    }}
                  />
                </div>
              )}
            </AlertBanner>
          </div>
        );
      })}
    </>
  );
}

export default RetiredModelNotice;
