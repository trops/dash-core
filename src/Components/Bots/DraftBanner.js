import React, { useContext } from "react";
import { Button3, ThemeContext } from "@trops/dash-react";

/**
 * DraftBanner — shown above a lead's drafted bot in the Bots view (bot-teams
 * TEAM-005): the lead's reasoning, its suggested providers and tools (not
 * turned on — the user picks them in the form), providers the user doesn't
 * have, and anything it left out. All plain text.
 *
 * @param {object} draft  from bots.listDrafts
 * @param {() => void} onDiscard
 * @param {(section: string) => void} [onOpenSettings]
 */
export const DraftBanner = ({ draft, onDiscard, onOpenSettings = null }) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";
  const hairline = currentTheme["border-primary-dark"] || "border-gray-600";
  if (!draft) return null;
  const suggestions = draft.suggestions || [];
  const missing = draft.missing || [];
  const dropped = draft.dropped || [];
  const notes = draft.notes || [];

  return (
    <div
      className={`mx-5 mt-4 rounded-lg border px-4 py-3 flex flex-col gap-2 text-sm ${hairline}`}
    >
      <div className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium">Drafted by your team lead</span>
          {draft.reasoning ? (
            <span className={muted}>{draft.reasoning}</span>
          ) : null}
        </div>
        <Button3 title="Discard draft" size="xs" onClick={onDiscard} />
      </div>

      {draft.duplicateOf ? (
        <span className="text-amber-300">
          The team already has a bot named &quot;{draft.duplicateOf}&quot; — you
          may want to adjust that one instead.
        </span>
      ) : null}

      {suggestions.length ? (
        <div className="flex flex-col gap-0.5">
          <span className={`text-xs ${muted}`}>
            Suggested providers and tools
          </span>
          {suggestions.map((s) => (
            <span key={s.provider} className="font-mono text-xs">
              {`${s.provider}: ${s.tools.length ? s.tools.join(", ") : "any tools"}${
                s.toolsChecked ? "" : " (couldn't check these tools)"
              }`}
            </span>
          ))}
        </div>
      ) : null}

      {missing.length ? (
        <div className="flex flex-row flex-wrap items-center gap-2">
          <span className="text-amber-300">
            Needs a provider you don&apos;t have: {missing.join(", ")}
          </span>
          {onOpenSettings ? (
            <Button3
              title="Open Settings › Providers"
              size="xs"
              onClick={() => onOpenSettings("providers")}
            />
          ) : null}
        </div>
      ) : null}

      {notes.length ? (
        <div className="flex flex-col gap-0.5">
          <span className={`text-xs ${muted}`}>Notes from the lead</span>
          {notes.map((n, i) => (
            <span key={i}>{n}</span>
          ))}
        </div>
      ) : null}

      {dropped.length ? (
        <div className="flex flex-col gap-0.5">
          <span className={`text-xs ${muted}`}>Left out</span>
          {dropped.map((d, i) => (
            <span key={i} className={`text-xs ${muted}`}>
              {d}
            </span>
          ))}
        </div>
      ) : null}

      <span className={`text-xs ${muted}`}>
        Nothing is turned on until you choose it below and Save. Providers and
        tools start unselected.
      </span>
    </div>
  );
};
