import React, { useContext, useEffect, useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon,
  Checkbox,
  FontAwesomeIcon,
  InputText,
  Modal,
  SelectInput,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";

/**
 * InstallFlowModal — "Install <flow>" (frame 34): the dashboard it goes on,
 * your providers matched by type, the folder it works in, and its scripts —
 * code from someone else, read before Install turns on. Its bots join the
 * dashboard and start on Ask.
 */
export const InstallFlowModal = ({
  packageRef,
  workspace,
  onClose,
  onInstalled,
}) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const status = useStatusTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    scrollable: false,
    grow: false,
  });
  const api = flowsApi();
  const [prev, setPrev] = useState(null);
  const [providers, setProviders] = useState({});
  const [folder, setFolder] = useState("");
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.installPreview(packageRef).then((r) => {
      if (!r || r.error) {
        setError((r && r.error) || "It couldn't be read.");
        return;
      }
      setPrev(r);
      const chosen = {};
      for (const n of r.needs.providers)
        if (n.options.length === 1) chosen[n.type] = n.options[0];
      setProviders(chosen);
    });
  }, [api, packageRef]);

  const missing = prev
    ? prev.needs.providers.filter((n) => !providers[n.type])
    : [];
  const ready =
    prev &&
    (!prev.scripts.length || read) &&
    (!prev.needs.folder || folder) &&
    missing.length === 0;

  const install = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.install(prev.previewId, {
        workspaceId: workspace.id,
        providers,
        folder: folder || null,
        scriptsRead: read,
      });
      if (!r || r.error)
        setError((r && r.error) || "It couldn't be installed.");
      else onInstalled(r.flow);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      setIsOpen={(open) => !open && onClose()}
      width="w-11/12 max-w-4xl"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full w-full min-h-0 rounded-lg overflow-clip border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="install-flow-modal"
      >
        <div
          className={`flex flex-row items-start gap-2 px-5 py-4 border-b ${hairline}`}
        >
          <div className="flex-1 min-w-0 flex flex-col">
            <span className={`text-lg font-semibold ${strong}`}>
              {prev ? `Install ${prev.name}` : "Install a flow"}
            </span>
            {prev ? (
              <span className={`text-xs ${muted}`}>
                {`${packageRef} ${prev.package.version} · by ${prev.package.author || prev.package.scope || "someone"} · ${prev.steps} steps, ${prev.bots.length} bots, ${prev.checks} checks`}
              </span>
            ) : null}
          </div>
          <ButtonIcon
            icon="xmark"
            ariaLabel="Close"
            size="sm"
            onClick={onClose}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {prev ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <div
                  className={`flex flex-col gap-2 p-3 rounded-lg border ${hairline}`}
                >
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                  >
                    1 · Put it on
                  </span>
                  <span className={`text-sm ${strong}`}>{workspace.name}</span>
                  <span
                    className={`text-xs ${muted}`}
                  >{`Its ${prev.bots.length} bot${prev.bots.length === 1 ? "" : "s"} join this dashboard and start on Ask.`}</span>
                </div>
                <div
                  className={`flex flex-col gap-2 p-3 rounded-lg border ${hairline}`}
                  data-testid="install-providers"
                >
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                  >
                    2 · Your providers
                  </span>
                  {prev.needs.providers.length ? (
                    prev.needs.providers.map((n) => (
                      <div
                        key={n.type}
                        className="flex flex-row items-center gap-2"
                      >
                        <span className={`w-24 text-sm ${muted}`}>
                          {n.type}
                        </span>
                        <div className="flex-1">
                          {n.options.length ? (
                            <SelectInput
                              ariaLabel={n.type}
                              value={providers[n.type] || ""}
                              placeholder="Choose one"
                              options={n.options.map((o) => ({
                                value: o,
                                label: o,
                              }))}
                              onChange={(v) =>
                                setProviders((p) => ({ ...p, [n.type]: v }))
                              }
                            />
                          ) : (
                            <span className={`text-sm ${status.warning.text}`}>
                              None connected: add one in Providers first
                            </span>
                          )}
                        </div>
                        {providers[n.type] ? (
                          <FontAwesomeIcon
                            icon="check"
                            className={`h-3.5 w-3.5 ${status.success.icon}`}
                          />
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <span className={`text-sm ${muted}`}>It needs none.</span>
                  )}
                </div>
                {prev.needs.folder ? (
                  <div
                    className={`flex flex-col gap-2 p-3 rounded-lg border ${hairline}`}
                  >
                    <span
                      className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                    >
                      3 · The folder it works in
                    </span>
                    <div className="flex flex-row gap-2 items-end">
                      <div className="flex-1">
                        <InputText
                          ariaLabel="Folder"
                          value={folder}
                          onChange={(v) => setFolder(v)}
                          inputClassName="font-mono"
                        />
                      </div>
                      <Button3
                        title="Choose…"
                        size="sm"
                        onClick={async () => {
                          const r = await api.pickFolder({
                            title: "The folder it works in",
                          });
                          if (r && r.path) setFolder(r.path);
                        }}
                      />
                    </div>
                    <span className={`text-xs ${muted}`}>
                      Each task works in its own copy of this folder. It never
                      pushes to the main branch.
                    </span>
                  </div>
                ) : null}
              </div>
              <div
                data-testid="install-scripts"
                className={`flex flex-col gap-2 p-3 rounded-lg border ${
                  prev.scripts.length
                    ? `${status.warning.accentBorder} ${status.warning.bg}`
                    : hairline
                }`}
              >
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${prev.scripts.length ? status.warning.strongText : muted}`}
                >
                  {`${prev.needs.folder ? "4" : "3"} · Read its scripts · code from someone else`}
                </span>
                {prev.scripts.length ? (
                  <>
                    {prev.scripts.map((s) => (
                      <div key={s.ref} className="flex flex-col gap-1">
                        <span
                          className={`text-sm font-mono font-semibold ${strong}`}
                        >
                          {s.ref}
                        </span>
                        <span className={`text-xs ${status.warning.text}`}>
                          {`Used by ${s.usedBy.join(", ") || "a check"}. It runs in the folder you chose, and stops at its time limit.`}
                        </span>
                        <pre
                          className={`m-0 p-3 rounded-md text-xs font-mono whitespace-pre-wrap break-all ${fieldBg} ${strong}`}
                        >
                          {s.text}
                        </pre>
                      </div>
                    ))}
                    <Checkbox
                      checked={read}
                      onChange={(v) => setRead(!!v)}
                      label="I've read it. Let it run."
                    />
                  </>
                ) : (
                  <span className={`text-sm ${muted}`}>It has no scripts.</span>
                )}
              </div>
            </div>
          ) : !error ? (
            <span className={`text-sm ${muted}`}>
              Downloading and checking it…
            </span>
          ) : null}
          {error ? (
            <span className={`text-sm ${status.error.text}`} role="alert">
              {error}
            </span>
          ) : null}
        </div>
        <div
          className={`flex flex-row items-center gap-3 px-5 py-3 border-t ${hairline}`}
        >
          <span className={`text-xs flex-1 ${muted}`}>
            {prev && prev.scripts.length && !read
              ? "Install is ready once you've read the script."
              : "Nothing runs until its first job starts."}
          </span>
          <Button3 title="Cancel" size="sm" onClick={onClose} />
          <Button
            title={busy ? "Installing…" : "Install"}
            size="sm"
            disabled={busy || !ready}
            onClick={install}
          />
        </div>
      </div>
    </Modal>
  );
};

export default InstallFlowModal;
