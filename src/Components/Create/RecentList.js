import React from "react";
import {
  Button3,
  ButtonIcon,
  FontAwesomeIcon,
  SectionLabel,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { recentLine } from "./recentRows";
import { draftAge } from "./createRouting";

const ICONS = {
  plan: "table-cells-large",
  question: "comment",
  "widget-draft": "pen-to-square",
};

/** One row: icon, title, then status · age underneath — left-aligned. */
const RecentRow = ({ row, onOpen, onRemove }) => {
  const { muted, strong } = useConfigTokens();
  return (
    <div className="flex flex-row items-center gap-2" data-testid="recent-row">
      <div className="flex-1 min-w-0">
        <Button3 size="sm" block onClick={() => onOpen(row)}>
          <span
            className="flex flex-row items-start gap-2 w-full text-left"
            // Buttons don't wrap or left-align their text; a row must.
            style={{ whiteSpace: "normal", minWidth: 0 }}
            aria-label={recentLine(row)}
          >
            <FontAwesomeIcon
              icon={ICONS[row.kind] || "pen-to-square"}
              className="h-3.5 w-3.5 mt-0.5 flex-shrink-0"
            />
            <span className="flex flex-col min-w-0">
              <span className={`truncate ${strong}`}>{row.title}</span>
              <span className={`text-xs ${muted}`}>
                {row.status} · {draftAge(row.updatedAt)}
              </span>
            </span>
          </span>
        </Button3>
      </div>
      {onRemove && row.kind !== "widget-draft" ? (
        <ButtonIcon
          icon="xmark"
          ariaLabel={`Remove ${row.title} from Recent`}
          onClick={() => onRemove(row)}
        />
      ) : null}
    </div>
  );
};

/**
 * Recent in two labelled sections (dock and Create's start screen):
 * Questions & plans, and Unfinished widgets (Widget Builder drafts — open to
 * carry on in the builder). Empty sections are hidden; `empty` shows when
 * both are.
 */
export const RecentList = ({
  sections,
  onOpen,
  onRemove = null,
  onAllDrafts = null,
  empty = null,
}) => {
  const { conversations = [], drafts = [], moreDrafts = 0 } = sections || {};
  if (!conversations.length && !drafts.length) return empty;
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
              onRemove={onRemove}
            />
          ))}
        </div>
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
