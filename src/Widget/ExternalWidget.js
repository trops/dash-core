import React from "react";
import { FontAwesomeIcon } from "@trops/dash-react";

/**
 * ExternalWidget
 *
 * Placeholder component rendered for installed (external) widgets.
 * Since raw JSX cannot be loaded at runtime in the renderer
 * (contextIsolation: true, nodeIntegration: false), this component
 * is assigned as the `component` field when registering installed widgets
 * with ComponentManager.
 */
export const ExternalWidget = ({ title, description, icon, ...props }) => {
  return (
    <div className="flex flex-col h-full justify-center items-center w-full gap-2 p-4 text-center">
      <FontAwesomeIcon
        icon={icon || "triangle-exclamation"}
        className="h-5 w-5 text-amber-500"
      />
      <div className="text-sm font-semibold text-gray-300">
        Widget Unavailable
      </div>
      {title && <div className="text-xs text-gray-500 font-mono">{title}</div>}
      <div className="text-xs text-gray-600 mt-1">
        {description ||
          "Check widget configuration or reinstall from the registry."}
      </div>
    </div>
  );
};
