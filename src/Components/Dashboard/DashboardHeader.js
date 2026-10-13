import React, { useContext, useEffect, useState } from "react";
import {
  Button,
  Button2,
  Button3,
  ButtonIcon,
  FontAwesomeIcon,
  SegmentedControl,
  SubHeading3,
  Tag,
} from "@trops/dash-react";
import { ThemeContext } from "../../Context";
import deepEqual from "deep-equal";

export const DashboardHeader = ({
  workspace,
  preview,
  onClickEdit = null,
  onPopout = null,
  onSaveChanges = null,
  // Select-to-edit (phase 1c): the breadcrumb and the grid buttons.
  selectionLabel = null,
  selectionKind = null,
  onClearSelection = null,
  onAddRow = null,
  onAddColumn = null,
  // Name, folder, theme, layout toggles and Dashboard Config moved to the
  // EditPanel (create-entry phase 1b).
  // Dashboard | Bots switch (bot-teams PRD TEAM-011). Present = render the
  // switch next to the title in preview mode. `botsAttention` is the team's
  // pending approvals + failed bots, shown as a count on "Bots".
  stageMode = "dashboard",
  onStageModeChange = null,
  botsAttention = 0,
}) => {
  const [workspaceSelected, setWorkspaceSelected] = useState(workspace);
  const { currentTheme } = useContext(ThemeContext);
  const dashboardTitle = (workspaceSelected.name || "Untitled").replace(
    /^./,
    (c) => c.toUpperCase(),
  );

  useEffect(() => {
    if (deepEqual(workspace, workspaceSelected) === false) {
      setWorkspaceSelected(() => workspace);
    }
  }, [workspace, workspaceSelected]);

  return (
    <div
      className={`dr-header flex flex-row p-1 justify-between shrink items-center px-4 ${currentTheme["bg-none"]} py-2`}
    >
      {preview === true ? (
        <>
          <div className="flex flex-row items-center gap-4 min-w-0">
            <SubHeading3
              title={(workspaceSelected.name || "Untitled").replace(/^./, (c) =>
                c.toUpperCase(),
              )}
              padding={false}
              className="font-bold text-base"
            />
            {onStageModeChange !== null && (
              <SegmentedControl
                ariaLabel="View"
                size="sm"
                value={stageMode}
                onChange={onStageModeChange}
                options={[
                  { value: "dashboard", label: "Dashboard" },
                  {
                    value: "bots",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        Bots
                        {botsAttention > 0 && (
                          <span
                            aria-label={`${botsAttention} need attention`}
                            className="inline-flex items-center justify-center rounded-full bg-amber-500 text-gray-900 text-xs font-semibold px-1.5 h-5"
                          >
                            {botsAttention}
                          </span>
                        )}
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </div>
          <div className="flex flex-row items-center gap-1">
            {/* Dashboard Config gear is intentionally NOT rendered in
                preview mode — wiring is a configuration concern, not a
                viewer concern. The button only appears in edit mode
                below. */}
            {onPopout !== null && stageMode !== "bots" && (
              <ButtonIcon
                icon="arrow-up-right-from-square"
                ariaLabel="Pop out"
                onClick={onPopout}
                hoverBackgroundColor={"hover:bg-neutral-700"}
              />
            )}
            {onClickEdit !== null && (
              <ButtonIcon
                icon="pencil"
                ariaLabel="Edit dashboard"
                onClick={onClickEdit}
                hoverBackgroundColor={"hover:bg-neutral-700"}
              />
            )}
          </div>
        </>
      ) : (
        <>
          {/* Edit mode (create-entry phase 1b): say what is being edited;
              name, folder, theme, layout toggles and Dashboard Config live
              in the EditPanel on the right. */}
          <nav
            aria-label="What you are editing"
            className="flex flex-row items-center gap-3 flex-1 min-w-0"
          >
            <Tag text="Editing" />
            {selectionLabel ? (
              <>
                <Button3
                  title={dashboardTitle}
                  onClick={onClearSelection}
                  size="sm"
                />
                <span className="opacity-50">›</span>
                <span
                  className={`font-semibold truncate ${currentTheme["text-primary-light"] || ""}`}
                >
                  {selectionLabel}
                </span>
                {selectionKind && (
                  <span
                    className={`text-xs ${currentTheme["text-primary-medium"] || ""}`}
                  >
                    {selectionKind}
                  </span>
                )}
              </>
            ) : (
              <SubHeading3
                title={dashboardTitle}
                padding={false}
                className="font-bold text-base truncate"
              />
            )}
          </nav>
          {/* +Row / +Column stay quiet (ghost); Cancel is secondary; Save
              is the one primary button. */}
          <div className="flex flex-row gap-2 shrink-0 items-center">
            {onAddRow && <Button3 title="+ Row" onClick={onAddRow} size="sm" />}
            {onAddColumn && (
              <Button3 title="+ Column" onClick={onAddColumn} size="sm" />
            )}
            {onClickEdit !== null && (
              <Button2 title="Cancel" onClick={onClickEdit} size="sm" />
            )}
            {onSaveChanges !== null && (
              <Button onClick={onSaveChanges} size="sm">
                <span className="inline-flex items-center gap-1.5">
                  <FontAwesomeIcon icon="check" className="h-3 w-3" />
                  Save
                </span>
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
