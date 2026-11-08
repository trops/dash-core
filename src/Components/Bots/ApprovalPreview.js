import React from "react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { approvalPreview } from "../../utils/approvalPreview";

/**
 * The exact thing a bot asks to do — the command, file, address or values —
 * on every card that asks the user to allow it. Renders nothing when the
 * call carries nothing to show.
 */
export const ApprovalPreview = ({ request }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const preview = approvalPreview(request);
  if (!preview) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="approval-preview">
      <span className={`text-xs ${muted}`}>
        {preview.label}
        {preview.note ? ` · ${preview.note}` : ""}
      </span>
      <div
        className={`max-h-40 overflow-y-auto rounded-md border px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-all select-text ${hairline} ${fieldBg} ${strong}`}
      >
        {preview.text}
      </div>
    </div>
  );
};
