import { useContext, useEffect, useState } from "react";
import { AppContext } from "../../Context/App/AppContext";

/**
 * A dashboard the user has, as saved — for a plan that changes it (its
 * before and after, release 3c). null while loading, or with no id.
 * @param {string|number|null} id
 */
export function useDashboard(id) {
  const app = useContext(AppContext) || {};
  const appId = app.credentials ? app.credentials.appId : undefined;
  const [workspace, setWorkspace] = useState(null);
  useEffect(() => {
    setWorkspace(null);
    const api =
      typeof window !== "undefined" && window.mainApi
        ? window.mainApi.workspace
        : null;
    if (id == null || id === "" || !api || !api.listWorkspacesForApplication)
      return undefined;
    let alive = true;
    Promise.resolve(api.listWorkspacesForApplication(appId))
      .then((res) => {
        const list = Array.isArray(res) ? res : (res && res.workspaces) || [];
        if (alive)
          setWorkspace(
            list.find((w) => w && String(w.id) === String(id)) || null,
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, appId]);
  return workspace;
}

export default useDashboard;
