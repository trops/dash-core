import React from "react";
import {
  Button,
  InputText,
  SubHeading3,
  Tag,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { IconPicker } from "./IconPicker";
export { FOLDER_ICONS } from "./IconPicker";

export const FolderDetail = ({
  menuItem = null,
  workspaces = [],
  isEditing = false,
  isCreating = false,
  formName = "",
  setFormName,
  formIcon = "folder",
  setFormIcon,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  onCreate,
  onDelete,
}) => {
  const isFormMode = isEditing || isCreating;

  // Get dashboards in this folder
  const folderDashboards = menuItem
    ? workspaces.filter((ws) => ws.menuId === menuItem.id)
    : [];

  if (isFormMode) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Fixed header fields */}
        <div className="flex-shrink-0 p-6 pb-0 space-y-5">
          <SubHeading3
            title={isCreating ? "New Folder" : "Edit Folder"}
            padding={false}
          />
          <InputText
            value={formName}
            onChange={(value) => setFormName(value)}
            placeholder="Folder name"
          />
        </div>
        {/* Scrollable icon picker */}
        <div className="flex flex-col flex-1 min-h-0 px-6 pt-5 pb-6 space-y-2">
          <span className="flex-shrink-0 text-sm font-medium opacity-70">
            Icon
          </span>
          <IconPicker selectedIcon={formIcon} onSelectIcon={setFormIcon} />
        </div>
        {/* Footer */}
        <div className="flex-shrink-0 flex flex-row justify-end gap-2 px-6 py-4 border-t border-white/10">
          <Button title="Cancel" onClick={onCancelEdit} size="sm" />
          <Button
            title={isCreating ? "Create" : "Save"}
            onClick={isCreating ? onCreate : onSaveEdit}
            size="sm"
          />
        </div>
      </div>
    );
  }

  if (!menuItem) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
        {/* Name + icon */}
        <div className="flex flex-row items-center gap-3">
          <FontAwesomeIcon
            icon={menuItem.folder || menuItem.icon || "folder"}
            className="h-5 w-5 opacity-60"
          />
          <SubHeading3 title={menuItem.name} padding={false} />
        </div>

        {/* Dashboard count + list */}
        <div className="flex flex-col space-y-3">
          <span className="text-sm opacity-70">
            {folderDashboards.length} dashboard
            {folderDashboards.length !== 1 ? "s" : ""}
          </span>
          {folderDashboards.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {folderDashboards.map((ws) => (
                <Tag key={ws.id} text={ws.name || "Untitled"} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex flex-row justify-end gap-2 px-6 py-4 border-t border-white/10">
        <Button title="Edit" onClick={() => onStartEdit(menuItem)} size="sm" />
        <Button title="Delete" onClick={() => onDelete(menuItem)} size="sm" />
      </div>
    </div>
  );
};
