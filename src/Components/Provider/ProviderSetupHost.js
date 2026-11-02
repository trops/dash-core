import React, { useContext, useEffect, useState } from "react";
import {
  Button3,
  Modal,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { ProvidersSection } from "../Settings/sections/ProvidersSection";
import { PROVIDER_SETUP_EVENT } from "./providerSetupEvent";

/**
 * ProviderSetupHost — opens one provider's setup in front of whatever is
 * showing (dash-profiles: "Add key" never opens behind a window).
 *
 * Anything can ask, by event:
 *   window.dispatchEvent(new CustomEvent("dash:open-provider-setup",
 *     { detail: { name, review? } }))
 * `name`: the provider (it already exists — a loaded profile added it).
 * Without `review` its edit form opens, to add the key or sign in; with
 * `review` its page shows, where a program waiting for the user's OK has
 * Allow.
 *
 * Mounted once, at the app's root. The window is mounted only while open,
 * so it stacks above any window already showing.
 */

function usePanel() {
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme || {}, {
    grow: false,
  });
  return `${panel.backgroundColor || ""} ${panel.borderColor || ""} ${
    panel.textColor || ""
  }`;
}

export const ProviderSetupHost = () => {
  const app = useContext(AppContext) || {};
  const { hairline } = useConfigTokens();
  const panel = usePanel();
  // { name, review, seq } — seq remounts the form for each request.
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let seq = 0;
    const onOpen = (e) => {
      const d = (e && e.detail) || {};
      if (!d.name) return;
      seq += 1;
      setOpen({ name: String(d.name), review: !!d.review, seq });
    };
    window.addEventListener(PROVIDER_SETUP_EVENT, onOpen);
    return () => window.removeEventListener(PROVIDER_SETUP_EVENT, onOpen);
  }, []);

  if (!open) return null;
  const close = () => setOpen(null);
  return (
    <Modal
      isOpen
      setIsOpen={(v) => !v && close()}
      width="w-11/12"
      height="h-5/6"
    >
      <div
        data-testid="provider-setup-dialog"
        className={`flex flex-col h-full w-full rounded-lg border overflow-clip ${panel} ${hairline}`}
      >
        <div
          className={`flex flex-row items-center justify-between px-6 py-3 border-b ${hairline}`}
        >
          <span className="text-lg font-semibold">
            {open.review ? open.name : `Set up ${open.name}`}
          </span>
          <Button3 title="Done" onClick={close} />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <ProvidersSection
            key={open.seq}
            dashApi={app.dashApi || null}
            credentials={app.credentials || null}
            initialProviderName={open.name}
            initialEdit={!open.review}
          />
        </div>
      </div>
    </Modal>
  );
};

export default ProviderSetupHost;
