import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppContext } from "../../Context/App/AppContext";
import { ComponentManager } from "../../ComponentManager";
import { deriveWidgetOwnership } from "../../utils/widgetOwnership";
import {
  holdsComponent,
  inPlaceProblem,
  resolveEditComponent,
  widgetUsage,
} from "../Create/editCreate";

/**
 * The widget a Change with AI conversation is about (lead-workspace release
 * 6c, frame 40), worked out as Create › Change did: which component and
 * package it is, its name, whether the change can go into it in place (the
 * user's own, from a package that can change in place) or is saved as a new
 * widget, and the dashboards it's on.
 *
 * @param {object|null} widget  the door's { component, sourcePackage, … }
 * @returns {{ status: "none" | "loading" | "ready" | "missing", target,
 *   mode: "update" | "new" | null, usedOn: string[], canInPlace,
 *   canSignIn, refresh }} — canInPlace: it can go either way (the user
 *   picks); canSignIn: signed out, and signing in could make it theirs;
 *   refresh: work it out again (after signing in)
 */
export function useWidgetTarget(widget) {
  const app = useContext(AppContext) || {};
  const appId = app.credentials ? app.credentials.appId : undefined;
  const [tries, setTries] = useState(0);
  const [out, setOut] = useState(() =>
    widget
      ? { status: "loading", target: null, mode: null, usedOn: [] }
      : { status: "none", target: null, mode: null, usedOn: [] },
  );
  const component = widget ? widget.component : null;
  const sourcePackage = widget ? widget.sourcePackage : null;
  useEffect(() => {
    if (!component) return undefined;
    let alive = true;
    const api = (typeof window !== "undefined" && window.mainApi) || {};
    (async () => {
      let installed = [];
      try {
        installed = (api.widgets && (await api.widgets.list())) || [];
      } catch (_e) {
        installed = [];
      }
      const id = resolveEditComponent(component, sourcePackage, installed);
      const pkg = id ? installed.find((w) => holdsComponent(w, id)) : null;
      if (!alive) return;
      if (!id || !pkg) {
        setOut({ status: "missing", target: null, mode: null, usedOn: [] });
        return;
      }
      const config = ComponentManager.config(id) || {};
      const componentName = id.split(".").pop();
      const target = {
        component: id,
        componentName,
        displayName:
          ((pkg.widgets || []).find((w) => w && w.name === componentName) || {})
            .displayName ||
          config.displayName ||
          config.label ||
          config.name ||
          componentName,
        package: pkg.name,
        config,
      };
      let username = null;
      try {
        const status = api.registryAuth && (await api.registryAuth.getStatus());
        if (status && status.authenticated) {
          const profile = await api.registryAuth.getProfile();
          username = (profile && profile.username) || null;
        }
      } catch (_e) {
        username = null;
      }
      let usedOn = [];
      try {
        const res =
          api.workspace && api.workspace.listWorkspacesForApplication
            ? await api.workspace.listWorkspacesForApplication(appId)
            : [];
        const list = Array.isArray(res) ? res : (res && res.workspaces) || [];
        usedOn = widgetUsage(list, id);
      } catch (_e) {
        usedOn = [];
      }
      if (!alive) return;
      const owner = deriveWidgetOwnership({
        originalPackage: target.package,
        originalComponentName: target.component,
        registryUsername: username,
      }).isOwner;
      // Theirs, from a package that can change in place (and not loaded
      // from their own folder): in place. Otherwise a new widget — the main
      // process holds the same rule.
      const fromFolder = /^@local\//i.test(target.package);
      const canChange = !inPlaceProblem(target) && !fromFolder;
      const inPlace = owner && canChange;
      setOut({
        status: "ready",
        target,
        mode: inPlace ? "update" : "new",
        usedOn,
        canInPlace: inPlace,
        canSignIn:
          !owner &&
          canChange &&
          !username &&
          !/^@ai-built\//i.test(target.package),
      });
    })();
    return () => {
      alive = false;
    };
  }, [component, sourcePackage, appId, tries]);
  const refresh = useCallback(() => setTries((n) => n + 1), []);
  // Kept as one object while nothing changes: what's made from it follows.
  return useMemo(() => ({ ...out, refresh }), [out, refresh]);
}

export default useWidgetTarget;
