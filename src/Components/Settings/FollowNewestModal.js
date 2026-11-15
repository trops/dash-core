import React, { useState } from "react";
import { Checkbox, ConfirmationModal } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { JOB_ROWS } from "./sections/aiSettingsText";
import { choiceLabel } from "./modelChoices";

/**
 * FollowNewestModal — once, after models could follow the newest of their
 * family: each default set to one exact model, ticked to become "Latest
 * <family>". Follow the newest saves the ticked ones; Keep exact versions
 * saves none. Either way it isn't asked again.
 *
 * @param {{ rows: Array<{ job, from, to, sameToday }>, models: object[],
 *   onFollow: (rows) => Promise, onKeep: () => Promise,
 *   onClose: () => void }} props
 */
export function FollowNewestModal({ rows, models, onFollow, onKeep, onClose }) {
  const { muted, strong, hairline } = useConfigTokens();
  const [ticked, setTicked] = useState(() => rows.map((r) => r.job));
  const chosen = rows.filter((r) => ticked.includes(r.job));
  const allToday = rows.every((r) => r.sameToday);
  const name = (job) => (JOB_ROWS.find((r) => r.job === job) || {}).name || job;

  return (
    <ConfirmationModal
      isOpen
      setIsOpen={onClose}
      title="Keep your models up to date?"
      confirmLabel={`Follow the newest (${chosen.length})`}
      cancelLabel="Keep exact versions"
      onConfirm={() => (chosen.length ? onFollow(chosen) : onKeep())}
      onCancel={onKeep}
    >
      <div
        className="flex flex-col gap-3 text-sm"
        data-testid="ai-follow-newest"
      >
        <span className={muted}>
          Each default below is set to one exact model. Following the newest
          means it moves up by itself when Anthropic releases a newer model of
          the same family. Untick any you want to keep exactly as it is.
        </span>
        <div className="flex flex-col" role="list">
          {rows.map((r) => (
            <div
              key={r.job}
              role="listitem"
              className={`flex flex-row items-center gap-3 py-2 border-t ${hairline}`}
            >
              <Checkbox
                label={name(r.job)}
                checked={ticked.includes(r.job)}
                onChange={(on) =>
                  setTicked((t) =>
                    on ? [...t, r.job] : t.filter((j) => j !== r.job),
                  )
                }
              />
              <span className={`flex-1 text-right ${muted}`}>
                {choiceLabel(models, r.from)}
              </span>
              <span className={muted}>→</span>
              <span className={`w-32 ${strong}`}>
                {choiceLabel(models, r.to)}
              </span>
            </div>
          ))}
        </div>
        <span className={`text-xs ${muted}`}>
          {allToday
            ? "Nothing changes today: each one is already the newest of its family. You can change any of them later in Settings › AI."
            : "Any that isn't the newest of its family moves up on its next run. You can change any of them later in Settings › AI."}
        </span>
      </div>
    </ConfirmationModal>
  );
}

export default FollowNewestModal;
