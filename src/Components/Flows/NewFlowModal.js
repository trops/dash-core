import React, { useContext, useEffect, useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon,
  InputText,
  Modal,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";
import { ProposalCard } from "./ProposalCard";
import { InstallFlowModal } from "./InstallFlowModal";

/**
 * NewFlowModal — "New flow on <dashboard>" (frame 22): say what it should
 * do and the dashboard's lead proposes it, or start from a ready-made flow.
 * Either way the proposal shows first (frame 23); nothing is made until
 * "Make this flow".
 */
export const NewFlowModal = ({ workspace, onClose, onMade }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    scrollable: false,
    grow: false,
  });
  const api = flowsApi();
  const [starters, setStarters] = useState([]);
  const [ask, setAsk] = useState("");
  const [preview, setPreview] = useState(null);
  const [said, setSaid] = useState("");
  const [fromLead, setFromLead] = useState(false);
  const [folder, setFolder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // "Or install one": flows on the registry (frame 34).
  const [query, setQuery] = useState("");
  const [found, setFound] = useState(null);
  const [installing, setInstalling] = useState(null);

  useEffect(() => {
    if (api)
      api
        .starters()
        .then((list) => setStarters(Array.isArray(list) ? list : []));
  }, [api]);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError((e && e.message) || "That didn't work.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const askLead = (text) =>
    run(async () => {
      const r = await api.propose(workspace.id, text);
      if (!r || r.error) {
        setError((r && r.error) || "No flow came back.");
        if (r && r.said) setSaid(r.said);
        return;
      }
      setPreview(r);
      setSaid(r.said || "");
      setFromLead(true);
    });

  const pickStarter = (id) =>
    run(async () => {
      const r = await api.preview(workspace.id, id);
      if (!r || r.error) {
        setError((r && r.error) || "That flow couldn't be shown.");
        return;
      }
      setPreview(r);
      setSaid("");
      setFromLead(false);
    });

  const make = () =>
    run(async () => {
      const r = await api.make(workspace.id, preview.proposal, { folder });
      if (!r || r.error) {
        setError((r && r.error) || "It couldn't be made.");
        return;
      }
      onMade(r.flow, r.madeBots || []);
    });

  return (
    <Modal
      isOpen
      setIsOpen={(open) => !open && onClose()}
      width="w-11/12 max-w-4xl"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full w-full min-h-0 rounded-lg overflow-clip border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="new-flow-modal"
      >
        <div
          className={`flex flex-row items-center gap-2 px-5 py-4 border-b ${hairline}`}
        >
          {preview ? (
            <ButtonIcon
              icon="arrow-left"
              ariaLabel="Back"
              size="sm"
              onClick={() => setPreview(null)}
            />
          ) : null}
          <span className={`text-lg font-semibold flex-1 ${strong}`}>
            {`New flow on ${workspace.name || "this dashboard"}`}
          </span>
          <ButtonIcon
            icon="xmark"
            ariaLabel="Close"
            size="sm"
            onClick={onClose}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-5">
          {preview ? (
            <>
              {said ? (
                <span className={`text-sm ${strong}`}>{said}</span>
              ) : null}
              <ProposalCard
                preview={preview}
                dashboardName={workspace.name || ""}
                folder={folder}
                busy={busy}
                onPickFolder={async () => {
                  const r = await api.pickFolder({
                    title: "The folder it works in",
                  });
                  if (r && r.path) setFolder(r.path);
                }}
                onMake={make}
                onChange={
                  fromLead
                    ? (change) =>
                        askLead(
                          `${ask}\n\nChange this in the flow you proposed: ${change}\nThe flow as it stands: ${JSON.stringify(preview.proposal)}`,
                        )
                    : null
                }
              />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                >
                  Say what it should do
                </span>
                <InputText
                  ariaLabel="What the flow should do"
                  placeholder="Every Friday, write the newsletter from my notes, check it, and ask me before it's sent…"
                  value={ask}
                  onChange={(v) => setAsk(v)}
                />
                <div className="flex flex-row items-center gap-3">
                  <Button
                    title={busy ? "Asking…" : "Ask the lead"}
                    size="sm"
                    disabled={busy || !ask.trim()}
                    onClick={() => askLead(ask)}
                  />
                  <span className={`text-xs ${muted}`}>
                    It proposes the steps and checks; nothing is made until you
                    say so.
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2" data-testid="install-search">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                >
                  Or install one
                </span>
                <div className="flex flex-row items-end gap-2">
                  <div className="flex-1">
                    <InputText
                      ariaLabel="Search flows on the registry"
                      placeholder="Search flows on the registry, or paste @scope/name"
                      value={query}
                      onChange={(v) => setQuery(v)}
                    />
                  </div>
                  <Button3
                    title="Search"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        if (/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(query.trim())) {
                          setInstalling(query.trim());
                          return;
                        }
                        const r = await api.search(query);
                        setFound(r && r.ok ? r.packages : []);
                        if (r && r.error) setError(r.error);
                      })
                    }
                  />
                </div>
                {found && !found.length ? (
                  <span className={`text-xs ${muted}`}>No flows found.</span>
                ) : null}
                {(found || []).map((p) => (
                  <button
                    key={p.ref}
                    type="button"
                    onClick={() => setInstalling(p.ref)}
                    className={`flex flex-col gap-0.5 text-left p-3 rounded-lg border ${hairline}`}
                  >
                    <span
                      className={`text-sm font-semibold ${strong}`}
                    >{`${p.name} · ${p.version}`}</span>
                    <span
                      className={`text-xs ${muted}`}
                    >{`${p.ref} · by ${p.author}${p.steps.length ? ` · ${p.steps.map((x) => x.name).join(" → ")}` : ""}`}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                >
                  Or start from
                </span>
                <div className="grid grid-cols-2 gap-3">
                  {starters.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      data-testid={`starter-${s.id}`}
                      disabled={busy}
                      onClick={() => pickStarter(s.id)}
                      className={`flex flex-col gap-1 text-left p-3 rounded-lg border ${hairline}`}
                    >
                      <span className={`text-sm font-semibold ${strong}`}>
                        {s.name}
                      </span>
                      <span className={`text-xs ${muted}`}>{s.summary}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {error ? (
            <span className={`text-sm ${status.error.text}`} role="alert">
              {error}
            </span>
          ) : null}
          {said && !preview ? (
            <span className={`text-sm ${muted}`}>{said}</span>
          ) : null}
        </div>
        <div
          className={`flex flex-row justify-end px-5 py-3 border-t ${hairline}`}
        >
          <Button3 title="Cancel" size="sm" onClick={onClose} />
        </div>
      </div>
      {installing ? (
        <InstallFlowModal
          packageRef={installing}
          workspace={workspace}
          onClose={() => setInstalling(null)}
          onInstalled={(f) => {
            setInstalling(null);
            onMade(f, []);
          }}
        />
      ) : null}
    </Modal>
  );
};

export default NewFlowModal;
