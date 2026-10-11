import React, { useContext, useEffect, useState } from "react";
import {
  ButtonIcon,
  ButtonIcon2,
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
          <div className="flex flex-row items-center gap-3 flex-1 min-w-0">
            <Tag text="Editing" />
            <SubHeading3
              title={(workspaceSelected.name || "Untitled").replace(/^./, (c) =>
                c.toUpperCase(),
              )}
              padding={false}
              className="font-bold text-base truncate"
            />
          </div>
          <div className="flex flex-row space-x-1 shrink-0 items-center">
            {onClickEdit !== null && (
              <ButtonIcon2
                icon="xmark"
                text="Cancel"
                onClick={onClickEdit}
                hoverBackgroundColor={"hover:bg-neutral-700"}
              />
            )}
            {onSaveChanges !== null && (
              <ButtonIcon2
                icon="check"
                text="Save"
                onClick={onSaveChanges}
                backgroundColor={"bg-green-800"}
                hoverBackgroundColor={"hover:bg-green-700"}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};
