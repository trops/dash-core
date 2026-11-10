import React from "react";
import {
  Button,
  Button3,
  FontAwesomeIcon,
  ListRow,
  SearchInput,
  StatusBadge,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

/**
 * MakeWays — making a bot or a dashboard in Create (lead-workspace "make it
 * in Create", mockup "Make a bot or dashboard in Create"): Ask AI or one
 * other way to start, each on its own screen with ← Back, never beside the
 * box. LeadWorkspace holds what's picked; these are the screens.
 */

/** A start card: icon, title, one line. */
const WayCard = ({ way, onPick, className = "" }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  return (
    <button
      type="button"
      aria-label={`${way.title}. ${way.sub}`}
      onClick={() => onPick(way.way)}
      className={`w-60 flex flex-row items-start gap-3 rounded-xl border p-3 text-left ${hairline} ${className}`}
      data-testid={`make-way-${way.way}`}
    >
      <span
        className={`flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg ${fieldBg} dr-role-well ${strong}`}
        aria-hidden="true"
      >
        <FontAwesomeIcon icon={way.icon} className="h-4 w-4" />
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className={`text-sm font-semibold ${strong}`}>{way.title}</span>
        <span className={`text-xs ${muted}`}>{way.sub}</span>
      </span>
    </button>
  );
};

/**
 * The ways (frames 2 and 10): Ask AI first, then Or start from. No box —
 * picking one opens it.
 * @param {{ title, ai, from }} ways  workspaceStart.waysFor
 * @param {(way: string) => void} onPick  "ai" | "registry" | "copy" | "blank" | "file"
 * @param {string} raised  the theme's raised surface (the AI card)
 */
export const WaysChooser = ({ ways, onPick, raised, error = null }) => {
  const { muted, strong, fieldBg } = useConfigTokens();
  return (
    <div className="flex flex-col gap-4 max-w-5xl" data-testid="make-ways">
      <span className={`text-2xl font-semibold ${strong}`}>{ways.title}</span>
      <span className={`text-sm ${muted}`}>
        Pick one. Each opens on its own, and ← Back brings you here.
      </span>
      {error ? (
        <span className={`text-sm ${muted}`} role="status">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={`${ways.ai.title}. ${ways.ai.sub}`}
        onClick={() => onPick("ai")}
        className={`flex flex-row items-center gap-4 rounded-xl border p-4 text-left ${raised}`}
        data-testid="make-way-ai"
      >
        <span
          className={`flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-lg ${fieldBg} dr-role-well ${strong}`}
          aria-hidden="true"
        >
          <FontAwesomeIcon icon={ways.ai.icon} className="h-5 w-5" />
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="flex flex-row items-center gap-2">
            <span className={`text-base font-semibold ${strong}`}>
              {ways.ai.title}
            </span>
            <StatusBadge state="info" label="Easiest" />
          </span>
          <span className={`text-sm ${muted}`}>{ways.ai.sub}</span>
        </span>
      </button>
      <span className={`text-xs pt-1 ${muted}`}>Or start from</span>
      <div className="flex flex-row flex-wrap gap-3">
        {ways.from.map((w) => (
          <WayCard key={w.way} way={w} onPick={onPick} />
        ))}
      </div>
    </div>
  );
};

/** "Goes on: Life HQ · Change" — where a bot will be. */
export const GoesOn = ({ target, onChange }) => {
  const { muted, strong } = useConfigTokens();
  if (!target) return null;
  return (
    <span
      className={`flex flex-row items-center gap-2 text-sm ${muted}`}
      data-testid="make-goes-on"
    >
      Goes on:
      <span className={`font-semibold ${strong}`}>
        {target.none ? "No dashboard" : target.name || "Your dashboard"}
      </span>
      {onChange ? (
        <Button3 size="sm" title="Change" onClick={onChange} />
      ) : null}
    </span>
  );
};

/**
 * One way, on its own (frames 5–9, 12, 13): ← Back to the ways, its title,
 * where it goes, what it shows, and at the bottom "Ask AI instead" and its
 * own buttons.
 */
export const WayScreen = ({
  title,
  onBack,
  onAskAi,
  goesOn = null,
  footer = null,
  testId,
  children,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col px-6 py-5">
        <div
          className="flex flex-col gap-4 max-w-3xl w-full min-h-0 flex-1"
          data-testid={testId}
        >
          <div>
            <Button3 size="sm" title="← Back" onClick={onBack} />
          </div>
          <span className={`text-2xl font-semibold ${strong}`}>{title}</span>
          {goesOn}
          {children}
        </div>
      </div>
      <div
        className={`flex-shrink-0 flex flex-row flex-wrap items-center gap-3 px-6 py-3 border-t ${hairline}`}
      >
        <span className={`text-sm ${muted}`}>Rather describe it?</span>
        <Button3 size="sm" title="Ask AI instead" onClick={onAskAi} />
        <span className="flex-1" />
        {footer}
      </div>
    </>
  );
};

/**
 * Where a new bot goes (frame 4): one of the user's dashboards, or none —
 * never a new one.
 * @param {Array<{ id, name, bots: number }>} dashboards
 * @param {{ id }|{ none: true }|null} picked
 */
export const WherePicker = ({ dashboards, picked, onPick }) => {
  const { muted } = useConfigTokens();
  const is = (t) =>
    !!picked &&
    (t.none
      ? !!picked.none
      : !picked.none && String(picked.id) === String(t.id));
  const rows = [
    ...dashboards.map((d) => ({
      key: String(d.id),
      target: { id: String(d.id), name: d.name },
      title: d.name,
      meta: d.bots ? `${d.bots} bot${d.bots === 1 ? "" : "s"}` : "No bots yet",
    })),
    {
      key: "none",
      target: { none: true },
      title: "No dashboard",
      meta: "Runs on its own; find it on the Bots page",
    },
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="make-where">
      <span className={`text-sm ${muted}`}>
        On a dashboard it joins that dashboard&apos;s team and can show its
        results there. On no dashboard it still runs — you find it on the Bots
        page.
      </span>
      <div
        role="radiogroup"
        aria-label="Where the bot goes"
        className="flex flex-col gap-1"
      >
        {rows.map((r) => (
          <ListRow
            key={r.key}
            testId="make-where-row"
            title={r.title}
            meta={r.meta}
            selected={is(r.target)}
            ariaLabel={is(r.target) ? `${r.title} (picked)` : r.title}
            onClick={() => onPick(r.target)}
          />
        ))}
      </div>
      <span className={`text-xs ${muted}`}>
        A bot never makes a new dashboard. To make one with bots on it, make a
        dashboard.
      </span>
    </div>
  );
};

/**
 * A list to copy from (frames 5 and 13): a search, then groups of rows.
 * @param {Array<{ label?, items: Array<{ id, title, meta }> }>} groups
 */
export const CopyPicker = ({
  intro,
  searchLabel,
  query,
  onQuery,
  groups,
  pickedId,
  onPick,
  note = null,
  empty,
}) => {
  const { muted } = useConfigTokens();
  return (
    <div className="flex flex-col gap-3 min-h-0" data-testid="make-copy">
      <span className={`text-sm ${muted}`}>{intro}</span>
      <SearchInput value={query} onChange={onQuery} placeholder={searchLabel} />
      <div className="flex flex-col gap-3">
        {groups.length ? (
          groups.map((g) => (
            <div key={g.label || "all"} className="flex flex-col gap-1">
              {g.label ? (
                <span className={`px-2 text-xs ${muted}`}>{g.label}</span>
              ) : null}
              {g.items.map((it) => (
                <ListRow
                  key={it.id}
                  testId="make-copy-row"
                  title={it.title}
                  meta={it.meta}
                  selected={String(it.id) === String(pickedId)}
                  onClick={() => onPick(it.id)}
                />
              ))}
            </div>
          ))
        ) : (
          <span className={`text-sm ${muted}`}>{empty}</span>
        )}
      </div>
      {note ? <span className={`text-xs ${muted}`}>{note}</span> : null}
    </div>
  );
};

/** The way's own buttons at the bottom right. */
export const WayActions = ({ primary, onPrimary, disabled = false }) => (
  <Button title={primary} size="sm" disabled={disabled} onClick={onPrimary} />
);
