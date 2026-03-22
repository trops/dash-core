import { useState, useEffect, useCallback } from "react";
import { collectComponentsFromLayout } from "./useInstalledWidgets";
import { isWidgetResolvable } from "../utils/layout";

/**
 * useMissingWidgets — detects unresolvable widget components in a workspace layout.
 *
 * Walks the workspace layout, checks each component against ComponentManager,
 * and returns the list of missing (unresolvable) component keys.
 *
 * Listens for `dash:widgets-updated` to automatically re-check after installs.
 *
 * @param {object} workspace – workspace object with `.layout` array
 * @returns {{ missingComponents: string[], hasMissing: boolean }}
 */
export const useMissingWidgets = (workspace) => {
  const [missingComponents, setMissingComponents] = useState([]);

  const check = useCallback(() => {
    if (!workspace?.layout) {
      setMissingComponents([]);
      return;
    }
    const components = collectComponentsFromLayout(workspace.layout);
    const missing = [
      ...new Set(components.filter((key) => !isWidgetResolvable(key))),
    ];
    setMissingComponents(missing);
  }, [workspace?.layout]);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    const handler = () => check();
    window.addEventListener("dash:widgets-updated", handler);
    return () => window.removeEventListener("dash:widgets-updated", handler);
  }, [check]);

  return {
    missingComponents,
    hasMissing: missingComponents.length > 0,
  };
};
