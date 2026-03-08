import React, { useState, useContext } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  Button,
  InputText,
  ConfirmationModal,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";

/**
 * PublishDashboardModal — modal for preparing a dashboard for registry publishing.
 *
 * Collects description, tags, and icon from the user, then calls
 * prepareDashboardForPublish to generate a publish-ready ZIP.
 */
export const PublishDashboardModal = ({
  isOpen,
  setIsOpen,
  appId,
  workspaceId,
  workspaceName,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [icon, setIcon] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [result, setResult] = useState(null);

  function handleClose() {
    setIsOpen(false);
    // Reset state after a brief delay to avoid flash
    setTimeout(() => {
      setDescription("");
      setTags("");
      setIcon("");
      setIsPublishing(false);
      setResult(null);
    }, 200);
  }

  async function handlePublish() {
    if (!appId || !workspaceId) return;
    setIsPublishing(true);
    setResult(null);
    try {
      const options = {
        description: description.trim() || undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        icon: icon.trim() || undefined,
      };
      const res =
        await window.mainApi.dashboardConfig.prepareDashboardForPublish(
          appId,
          workspaceId,
          options,
        );
      setResult(res);
    } catch (err) {
      console.error("[PublishDashboardModal] Publish error:", err);
      setResult({
        success: false,
        error: err.message || "Failed to prepare dashboard for publish.",
      });
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <ConfirmationModal
      isOpen={isOpen}
      setIsOpen={handleClose}
      title={`Publish "${workspaceName || "Dashboard"}"`}
      confirmLabel={isPublishing ? "Preparing..." : "Prepare for Publish"}
      onConfirm={result ? handleClose : handlePublish}
      onCancel={handleClose}
      disabled={isPublishing}
    >
      <div className={`space-y-4 ${panelStyles.textColor || "text-gray-200"}`}>
        {!result ? (
          <>
            <p className="text-sm opacity-70">
              This will create a publish-ready ZIP file that can be submitted to
              the dashboard registry.
            </p>
            <div className="space-y-3">
              <InputText
                label="Description"
                value={description}
                onChange={setDescription}
                placeholder="A brief description of this dashboard..."
              />
              <InputText
                label="Tags (comma-separated)"
                value={tags}
                onChange={setTags}
                placeholder="productivity, slack, monitoring"
              />
              <InputText
                label="Icon (FontAwesome name)"
                value={icon}
                onChange={setIcon}
                placeholder="chart-line"
              />
            </div>
          </>
        ) : result.success ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FontAwesomeIcon
                icon="circle-check"
                className="h-4 w-4 text-green-400"
              />
              <span className="text-sm">
                Dashboard prepared for publishing.
              </span>
            </div>
            {result.filePath && (
              <div className="text-xs opacity-50 break-all">
                Saved to: {result.filePath}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <FontAwesomeIcon
              icon="circle-xmark"
              className="h-4 w-4 text-red-400"
            />
            <span className="text-sm text-red-400">
              {result.error || "Publish preparation failed."}
            </span>
          </div>
        )}
      </div>
    </ConfirmationModal>
  );
};
