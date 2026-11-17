import React, { useState } from "react";
import {
  Button,
  Button3,
  FlowGraph,
  FlowKindChip,
  FontAwesomeIcon,
  InputText,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { checkSummary } from "./flowText";

/** A proposal's steps as FlowGraph draws them (keys as ids). */
function proposalGraph(p) {
  return {
    steps: p.steps.map((s) => ({
      id: s.key,
      kind: s.kind,
      name: s.name,
      note: s.kind === "check" ? s.note || checkSummary(s.check) : s.note,
    })),
    edges: p.edges.map((e) => ({
      ...e,
      state: e.kind === "fail" ? "error" : undefined,
    })),
  };
}

/**
 * ProposalCard — a proposed flow before anything is made (frame 23): each
 * step with what it may do and what happens when it fails; what Dash
 * checked; what it will make and use; Make this flow, See it as a graph,
 * Change something.
 */
export const ProposalCard = ({
  preview,
  dashboardName = "",
  folder = null,
  onPickFolder = null,
  onMake,
  onChange = null,
  busy = false,
}) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const status = useStatusTokens();
  const [asGraph, setAsGraph] = useState(false);
  const [changing, setChanging] = useState(false);
  const [change, setChange] = useState("");
  const p = preview.proposal;
  const checked = preview.checked || [];
  const will = preview.itWill || { makeBots: [], uses: [], folder: false };
  const byKey = Object.fromEntries(p.steps.map((s) => [s.key, s]));
  const failOf = (key) =>
    p.edges.find((e) => e.kind === "fail" && e.from === key);
  const allGood = checked.every((c) => c.ok);
  const needsFolder = will.folder && !folder;

  return (
    <div
      data-testid="flow-proposal"
      className={`flex flex-col gap-3 p-4 rounded-lg border ${hairline}`}
    >
      <div className="flex flex-row items-baseline gap-2">
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
        >
          New flow
        </span>
        <span className={`text-base font-semibold ${strong}`}>{p.name}</span>
        {dashboardName ? (
          <span className={`text-xs ${muted}`}>{`· on ${dashboardName}`}</span>
        ) : null}
      </div>

      {asGraph ? (
        <div className="overflow-x-auto">
          <FlowGraph
            {...proposalGraph(p)}
            ariaLabel={`${p.name}, as a graph`}
          />
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {p.steps.map((s, i) => {
            const fail = failOf(s.key);
            const back = fail ? byKey[fail.to] : null;
            return (
              <li
                key={s.key}
                data-testid="proposal-step"
                className={`flex flex-row gap-3 items-start p-3 rounded-md border ${hairline}`}
              >
                <span
                  className={`w-6 flex-shrink-0 text-sm font-semibold ${muted}`}
                >
                  {i + 1}
                </span>
                <span className="w-40 flex-shrink-0 flex flex-col items-start gap-1">
                  <span className={`text-sm font-semibold ${strong}`}>
                    {s.name}
                  </span>
                  <FlowKindChip kind={s.kind} />
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className={`text-sm ${strong}`}>
                    {s.kind === "check"
                      ? s.note || checkSummary(s.check)
                      : s.note}
                  </span>
                  {back ? (
                    <span className={`text-sm ${status.error.icon}`}>
                      {`If it fails: back to ${back.name}${
                        s.kind === "bot"
                          ? `, up to ${p.maxRounds || 3} rounds, then to you`
                          : " with what failed"
                      }`}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div
          data-testid="proposal-checked"
          className={`flex flex-col gap-1 p-3 rounded-md border ${
            allGood
              ? `${status.success.border} ${status.success.bg}`
              : `${status.warning.border} ${status.warning.bg}`
          }`}
        >
          <span
            className={`text-xs font-semibold uppercase tracking-wide ${allGood ? status.success.text : status.warning.text}`}
          >
            Dash checked this flow
          </span>
          {checked.map((c) => (
            <span
              key={c.text}
              className={`text-sm flex flex-row items-center gap-1.5 ${c.ok ? status.success.text : status.warning.text}`}
            >
              <FontAwesomeIcon
                icon={c.ok ? "check" : "triangle-exclamation"}
                className="h-3 w-3"
              />
              {c.text}
            </span>
          ))}
        </div>
        <div
          className={`flex flex-col gap-1 p-3 rounded-md border ${hairline}`}
          data-testid="proposal-will"
        >
          <span
            className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
          >
            It will
          </span>
          {will.makeBots.length ? (
            <span className={`text-sm ${strong}`}>
              {`Make ${will.makeBots.length} bot${will.makeBots.length === 1 ? "" : "s"}: ${will.makeBots.join(", ")}`}
            </span>
          ) : (
            <span className={`text-sm ${strong}`}>
              Use the bots you already have
            </span>
          )}
          {will.uses.map((u) => (
            <span
              key={u.label}
              className={`text-sm flex flex-row items-center gap-1.5 ${u.connected ? strong : status.warning.text}`}
            >
              <FontAwesomeIcon
                icon={u.connected ? "check" : "plug"}
                className="h-3 w-3"
              />
              {u.connected
                ? `${u.label}: ${u.provider}`
                : `${u.label}: connect one in Providers`}
            </span>
          ))}
          {will.folder ? (
            <span
              className={`text-sm flex flex-row items-center gap-2 ${strong}`}
            >
              {folder ? `Work in ${folder}` : "Needs a folder to work in"}
              {onPickFolder ? (
                <button
                  type="button"
                  className="text-xs font-semibold underline"
                  onClick={onPickFolder}
                >
                  {folder ? "Change…" : "Choose…"}
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>

      {changing && onChange ? (
        <div
          className={`flex flex-row items-end gap-2 p-2 rounded-md ${fieldBg}`}
        >
          <div className="flex-1">
            <InputText
              ariaLabel="What to change"
              placeholder="Say what to change…"
              value={change}
              onChange={(v) => setChange(v)}
            />
          </div>
          <Button
            title="Send"
            size="sm"
            disabled={busy || !change.trim()}
            onClick={() => {
              onChange(change);
              setChange("");
              setChanging(false);
            }}
          />
        </div>
      ) : null}

      <div className="flex flex-row flex-wrap items-center gap-2">
        <Button
          title={busy ? "Making…" : "Make this flow"}
          size="sm"
          disabled={busy || needsFolder}
          onClick={onMake}
        />
        <Button3
          title={asGraph ? "See it as steps" : "See it as a graph"}
          size="sm"
          onClick={() => setAsGraph((g) => !g)}
        />
        {onChange ? (
          <Button3
            title="Change something"
            size="sm"
            onClick={() => setChanging((c) => !c)}
          />
        ) : null}
        {needsFolder ? (
          <span className={`text-xs ${status.warning.text}`}>
            Choose the folder it works in first.
          </span>
        ) : null}
      </div>
      <span className={`text-xs ${muted}`}>
        Nothing runs until you make it. Its new bots ask before they change
        anything.
      </span>
    </div>
  );
};

export default ProposalCard;
