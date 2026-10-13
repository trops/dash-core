import React, { useState } from "react";
import {
  Button3,
  ButtonIcon,
  ConfirmationModal,
  ListRow,
  SectionLabel,
} from "@trops/dash-react";
import { recentLine } from "./recentRows";
import { draftAge } from "./createRouting";
import { planRemoveCopy } from "./PlanMenu";

/** What removing a Recent row says before it happens. */
export function rowRemoveCopy(row) {
  if (row.kind === "question") {
    return {
      action: "Remove",
      title: `Remove “${row.title}” from Recent?`,
      message: "The question and its answer leave Recent.",
    };
  }
  const built = /^Built/.test(String(row.status || ""));
  const copy = planRemoveCopy({ title: row.title, built });
  return built ? copy : { ...copy, action: "Discard" };
}

const ICONS = {
  plan: "table-cells-large",
  question: "comment",
  "widget-draft": "pen-to-square",
};

/**
 * One row (dash-react ListRow — design guide "List rows"): icon, title, then
 * status · age underneath; Remove (×) shows on hover, outside the row button.
 */
const RecentRow = ({ row, onOpen, onRemove }) => (
  <ListRow
    testId="recent-row"
    icon={ICONS[row.kind] || "pen-to-square"}
    title={row.title}
    meta={`${row.status} · ${draftAge(row.updatedAt)}`}
    ariaLabel={recentLine(row)}
    onClick={() => onOpen(row)}
    trailing={
      onRemove && row.kind !== "widget-draft" ? (
        <ButtonIcon
          icon="xmark"
          ariaLabel={`Remove ${row.title} from Recent`}
          onClick={() => onRemove(row)}
        />
      ) : null
    }
  />
);

/**
 * Recent in two labelled sections (dock and Create's start screen):
 * Questions & plans, and Unfinished widgets (Widget Builder drafts — open to
 * carry on in the builder). Empty sections are hidden; `empty` shows when
 * both are. Removing a question or plan asks first (design guide rule 10);
 * `onRemove` runs once it's confirmed.
 */
export const RecentList = ({
  sections,
  onOpen,
  onRemove = null,
  onAllDrafts = null,
  empty = null,
}) => {
  const [confirming, setConfirming] = useState(null);
  const { conversations = [], drafts = [], moreDrafts = 0 } = sections || {};
  if (!conversations.length && !drafts.length) return empty;
  const copy = confirming ? rowRemoveCopy(confirming) : null;
  return (
    <div className="flex flex-col gap-4" data-testid="create-recent">
      {conversations.length ? (
        <div className="flex flex-col gap-1" data-testid="recent-conversations">
          <SectionLabel text="Questions & plans" />
          {conversations.map((row) => (
            <RecentRow
              key={row.key}
              row={row}
              onOpen={onOpen}
              onRemove={onRemove ? setConfirming : null}
            />
          ))}
        </div>
      ) : null}
      {copy ? (
        <ConfirmationModal
          isOpen
          setIsOpen={(v) => !v && setConfirming(null)}
          variant="danger"
          title={copy.title}
          message={copy.message}
          confirmLabel={copy.action}
          cancelLabel="Keep it"
          onConfirm={() => {
            const row = confirming;
            setConfirming(null);
            onRemove(row);
          }}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {drafts.length ? (
        <div className="flex flex-col gap-1" data-testid="recent-drafts">
          <SectionLabel text="Unfinished widgets" />
          {drafts.map((row) => (
            <RecentRow key={row.key} row={row} onOpen={onOpen} />
          ))}
          {moreDrafts > 0 && onAllDrafts ? (
            <div>
              <Button3
                size="sm"
                title={`All ${drafts.length + moreDrafts} drafts`}
                onClick={onAllDrafts}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default RecentList;
