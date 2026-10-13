import React, { useState } from "react";
import {
  ButtonIcon,
  DropdownPanel,
  FontAwesomeIcon,
  MenuItem2,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";

/**
 * ManageLayout — the shared frame of the five Manage pages (Dashboards,
 * Bots, Widgets, Themes, Providers): a toolbar, then the list and the
 * detail as two panes side by side, each its own bordered container with
 * its own scroll (design audit, October 2026).
 *
 * @param {string}    testId        the page's data-testid
 * @param {node}      toolbar       search / filters / page actions
 * @param {node}      list          the list's rows (inside role="list")
 * @param {string}    listLabel     the list's accessible name
 * @param {node}      listFooter    optional settings under the list
 * @param {node}      detail        the detail pane's content
 * @param {string}    detailTestId  the detail pane's data-testid
 * @param {boolean}   detailFlush   the detail scrolls itself (forms with
 *                                  their own footers): no padding / scroll
 * @param {boolean}   detailFit     the detail sizes to its content (up to
 *                                  the pane height) instead of filling it
 * @param {node}      empty         shown instead of toolbar + panes (the
 *                                  page has nothing at all yet)
 * @param {node}      children      modals
 */
export const ManageLayout = ({
  testId,
  toolbar = null,
  list = null,
  listLabel,
  listFooter = null,
  detail = null,
  detailTestId,
  detailFlush = false,
  detailFit = false,
  empty = null,
  children = null,
}) => {
  const { strong, hairline } = useConfigTokens();
  return (
    // The page's base text colour (plain names inherit it); muted text
    // keeps its own token.
    <div
      data-testid={testId}
      className={`flex flex-col flex-1 min-h-0 gap-3 px-6 pt-4 pb-4 ${strong}`}
    >
      {empty ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
          {empty}
        </div>
      ) : (
        <>
          {/* Filter bar — fixed; the list and detail scroll on their own. */}
          <div className="flex-shrink-0 flex flex-row flex-wrap items-center gap-2">
            {toolbar}
          </div>
          <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
            <div
              data-testid={testId ? `${testId}-list-pane` : undefined}
              className={`min-h-0 flex flex-col rounded-lg border ${hairline}`}
            >
              <div
                role="list"
                aria-label={listLabel}
                className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-2"
              >
                {list}
              </div>
              {listFooter ? (
                <div className={`flex-shrink-0 border-t p-3 ${hairline}`}>
                  {listFooter}
                </div>
              ) : null}
            </div>
            <div
              data-testid={detailTestId}
              className={`col-span-2 min-h-0 rounded-lg border ${hairline} ${
                detailFlush
                  ? "flex flex-col overflow-hidden"
                  : "overflow-y-auto p-5"
              } ${detailFit ? "self-start max-h-full" : ""}`}
            >
              {detail}
            </div>
          </div>
        </>
      )}
      {children}
    </div>
  );
};

/** A list group's heading — sentence case, the muted token, 12px. */
export const ListGroupLabel = ({ text, testId }) => {
  const { muted } = useConfigTokens();
  return (
    <div
      data-testid={testId}
      className={`px-2 pt-1 text-xs font-semibold truncate ${muted}`}
    >
      {text}
    </div>
  );
};

/**
 * DetailGroup — a small titled group in a detail pane (e.g. Last run): a
 * text-sm heading over its lines, on a recessed surface.
 */
export const DetailGroup = ({ title, testId, children }) => {
  const { strong, hairline, selectedBg } = useConfigTokens();
  return (
    <section
      data-testid={testId}
      className={`flex flex-col gap-1.5 rounded-lg border p-3 min-w-0 ${hairline} ${selectedBg}`}
    >
      <h4 className={`text-sm font-semibold ${strong}`}>{title}</h4>
      {children}
    </section>
  );
};

/**
 * OverflowMenu —the "…" in a detail header: the actions that aren't the
 * main ones (Rename, Duplicate, Export, Publish, Delete…). Items that are
 * falsy are skipped; destructive ones confirm in the caller's
 * ConfirmationModal.
 *
 * @param {Array<{ label: string, icon?: string, onClick: () => void }>} items
 */
export const OverflowMenu = ({ items = [], ariaLabel = "More actions" }) => {
  const [open, setOpen] = useState(false);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="relative" data-testid="overflow-menu">
      <ButtonIcon
        icon="ellipsis"
        ariaLabel={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      />
      <DropdownPanel
        isOpen={open}
        onClose={() => setOpen(false)}
        position="absolute top-full right-0 mt-1"
        align="right"
        width="w-56"
      >
        {shown.map((item) => (
          <MenuItem2
            key={item.label}
            onClick={() => {
              setOpen(false);
              item.onClick();
            }}
          >
            <span className="inline-flex items-center gap-2">
              {item.icon ? (
                <FontAwesomeIcon icon={item.icon} className="h-3.5 w-3.5" />
              ) : null}
              {item.label}
            </span>
          </MenuItem2>
        ))}
      </DropdownPanel>
    </div>
  );
};

export default ManageLayout;
