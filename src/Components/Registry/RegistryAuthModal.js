import React, { useContext } from "react";
import {
  Modal,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { RegistryAuthPrompt } from "./RegistryAuthPrompt";

/**
 * RegistryAuthModal — renders the RegistryAuthPrompt inside a themed modal.
 *
 * Props:
 *   isOpen          – whether modal is visible
 *   setIsOpen       – close handler
 *   onAuthenticated – called when auth succeeds
 *   onCancel        – called when user cancels (also closes modal)
 *   message         – custom message for the auth prompt
 */
export const RegistryAuthModal = ({
  isOpen,
  setIsOpen,
  onAuthenticated,
  onCancel,
  message = "The Dash Registry requires authentication to download and install packages.",
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const handleAuthenticated = () => {
    setIsOpen(false);
    if (onAuthenticated) onAuthenticated();
  };

  const handleCancel = () => {
    setIsOpen(false);
    if (onCancel) onCancel();
  };

  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      width="w-[440px]"
      height="auto"
    >
      <div
        className={`flex flex-col rounded-lg overflow-hidden ${panelStyles.backgroundColor || "bg-gray-900"} ${panelStyles.textColor || "text-gray-200"}`}
      >
        <div className="px-5 pt-5 pb-1">
          <h3 className="text-sm font-semibold">Sign In Required</h3>
        </div>
        <RegistryAuthPrompt
          onAuthenticated={handleAuthenticated}
          onCancel={handleCancel}
          message={message}
        />
      </div>
    </Modal>
  );
};
