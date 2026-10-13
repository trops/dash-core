import React, { useState } from "react";
import {
  ButtonIcon,
  ConfirmationModal,
  DropdownPanel,
  FontAwesomeIcon,
  MenuItem2,
} from "@trops/dash-react";

/**
 * PlanMenu — the "…" on an open plan (in Create and in the dock): Discard
 * plan, or Remove from Recent once it has built something (the dashboard
 * stays). Destructive, so it sits in "…" and asks first (design guide rule
 * 10; screen audit, October 2026). `onRemoved` runs before the remove so the
 * plan view closes first and its autosave can't bring the entry back.
 */
export function planRemoveCopy({ title, built }) {
  const name = title ? `“${title}”` : "this plan";
  return built
    ? {
        action: "Remove from Recent",
        title: `Remove ${name} from Recent?`,
        message:
          "It leaves Recent and its notes are forgotten. The dashboard it built stays.",
      }
    : {
        action: "Discard plan",
        title: `Discard ${name}?`,
        message:
          "It's removed from Recent and its notes are forgotten. Nothing has been built.",
      };
}

export const PlanMenu = ({
  recentId,
  title = "",
  built = false,
  onRemoved,
}) => {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!recentId) return null;
  const copy = planRemoveCopy({ title, built });

  const remove = async () => {
    setConfirming(false);
    if (onRemoved) onRemoved();
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots || !bots.removeCreateRecent) return;
    try {
      await bots.removeCreateRecent(recentId);
    } catch (_e) {
      // It stays in Recent; the × there can try again.
    }
  };

  return (
    <div className="relative" data-testid="plan-menu">
      <ButtonIcon
        icon="ellipsis"
        ariaLabel="More actions"
        onClick={() => setOpen((v) => !v)}
      />
      <DropdownPanel
        isOpen={open}
        onClose={() => setOpen(false)}
        position="absolute top-full right-0 mt-1"
        align="right"
        width="w-56"
      >
        <MenuItem2
          onClick={() => {
            setOpen(false);
            setConfirming(true);
          }}
        >
          <span className="inline-flex items-center gap-2">
            <FontAwesomeIcon icon="trash-can" className="h-3.5 w-3.5" />
            {copy.action}
          </span>
        </MenuItem2>
      </DropdownPanel>
      <ConfirmationModal
        isOpen={confirming}
        setIsOpen={setConfirming}
        variant="danger"
        title={copy.title}
        message={copy.message}
        confirmLabel={copy.action}
        cancelLabel="Keep it"
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
};

export default PlanMenu;
