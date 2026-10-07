import React, { useContext, useState } from "react";
import {
  AlertBanner,
  Modal,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { McpCatalogDetail } from "../Settings/details/McpCatalogDetail";
import { saveMcpProvider } from "../../utils/saveMcpProvider";

/**
 * AddProviderDialog — add a provider a draft bot's gap suggested, without
 * leaving the draft review (bot-capabilities CAP-005). Opens the same
 * catalog / custom-server form as Settings › Providers in a dialog and saves
 * it the same way (saveMcpProvider), so the open bot form keeps its edits and
 * can turn the new provider on right away.
 *
 * @param {{ catalogId?: string, custom?: object } | null} request
 *   catalogId — a built-in catalog entry to configure;
 *   custom — a community server to pre-fill ({ name, mcpConfig,
 *   credentialSchema, warning }).
 * @param {() => void} onClose
 */
export const AddProviderDialog = ({ request, onClose }) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const app = useContext(AppContext);
  const [error, setError] = useState(null);
  if (!request) return null;

  const hairline = currentTheme["border-primary-dark"] || "";
  // The Modal is only a frame — the panel brings the theme's background.
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {});

  const close = () => {
    setError(null);
    onClose();
  };

  const handleSave = (name, type, credentials, mcpConfig, allowedTools) => {
    setError(null);
    saveMcpProvider({
      dashApi: app && app.dashApi,
      appId: app && app.credentials && app.credentials.appId,
      providers: (app && app.providers) || {},
      name,
      type,
      credentials,
      mcpConfig,
      allowedTools,
    })
      .then(() => {
        if (app && typeof app.refreshProviders === "function") {
          app.refreshProviders();
        }
        close();
      })
      .catch((err) =>
        setError(
          `Couldn't save the provider: ${(err && err.message) || String(err)}`,
        ),
      );
  };

  return (
    <Modal
      isOpen={!!request}
      setIsOpen={(open) => !open && close()}
      width="w-2/3"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full min-h-0 rounded-lg border ${hairline} ${panel.backgroundColor || ""} ${panel.textColor || ""}`}
      >
        {error ? (
          <div className="px-6 pt-4">
            <AlertBanner variant="error" size="compact" message={error} />
          </div>
        ) : null}
        <McpCatalogDetail
          onSave={handleSave}
          onCancel={close}
          initialSelectedId={request.catalogId || null}
          initialCustom={request.custom || null}
        />
      </div>
    </Modal>
  );
};

export default AddProviderDialog;
