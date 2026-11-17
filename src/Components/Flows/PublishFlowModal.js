import React, { useContext, useEffect, useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon,
  FontAwesomeIcon,
  InputText,
  Modal,
  SegmentedControl,
  Switch,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";

/**
 * PublishFlowModal — "Publish <flow>" (frame 33): its name and version
 * (a fix, a new feature, a big change), what's new, what's in it, what it
 * needs (asked on install), what's left out, and the checks run first.
 */
export const PublishFlowModal = ({ flow, onClose, onPublished }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    scrollable: false,
    grow: false,
  });
  const api = flowsApi();
  const [prev, setPrev] = useState(null);
  const [name, setName] = useState("");
  const [bump, setBump] = useState("minor");
  const [whatsNew, setWhatsNew] = useState("");
  // Like profiles: private first, then what it was last published as.
  const [visibility, setVisibility] = useState("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.publishPreview(flow.id).then((r) => {
      if (!r || r.error) {
        setError((r && r.error) || "It couldn't be read.");
        return;
      }
      setPrev(r);
      setName(r.name);
      setVisibility(r.visibility === "public" ? "public" : "private");
      if (!r.current) setBump("patch");
    });
  }, [api, flow.id]);

  const version = prev ? prev.versions[bump] : "";
  const blocked =
    prev && prev.checks.some((c) => !c.ok && /Keys or tokens/.test(c.text));

  const publish = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.publish(flow.id, {
        name,
        version,
        whatsNew,
        visibility,
      });
      if (!r || r.error) setError((r && r.error) || "It wasn't published.");
      else onPublished(r);
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ label, children }) => (
    <div className="flex flex-row gap-3 py-1">
      <span className={`w-24 flex-shrink-0 text-sm ${muted}`}>{label}</span>
      <span className={`flex-1 min-w-0 text-sm ${strong}`}>{children}</span>
    </div>
  );

  return (
    <Modal
      isOpen
      setIsOpen={(open) => !open && onClose()}
      width="w-11/12 max-w-4xl"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full w-full min-h-0 rounded-lg overflow-clip border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="publish-flow-modal"
      >
        <div
          className={`flex flex-row items-center gap-2 px-5 py-4 border-b ${hairline}`}
        >
          <span
            className={`text-lg font-semibold flex-1 ${strong}`}
          >{`Publish ${flow.name}`}</span>
          <ButtonIcon
            icon="xmark"
            ariaLabel="Close"
            size="sm"
            onClick={onClose}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-5">
          {prev && !prev.signedIn ? (
            <span className={`text-sm ${status.warning.text}`}>
              Sign in to the registry first (Settings › Account).
            </span>
          ) : null}
          {prev ? (
            <>
              <div className="flex flex-row flex-wrap gap-4">
                <div className="flex-1 min-w-48">
                  <InputText
                    label="Name"
                    value={name}
                    onChange={(v) => setName(v)}
                    inputClassName="font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                  >
                    {prev.current ? `Version · now ${prev.current}` : "Version"}
                  </span>
                  {prev.current ? (
                    <SegmentedControl
                      ariaLabel="Version"
                      size="sm"
                      value={bump}
                      onChange={setBump}
                      options={[
                        {
                          value: "patch",
                          label: `Fix · ${prev.versions.patch}`,
                        },
                        {
                          value: "minor",
                          label: `New feature · ${prev.versions.minor}`,
                        },
                        {
                          value: "major",
                          label: `Big change · ${prev.versions.major}`,
                        },
                      ]}
                    />
                  ) : (
                    <span className={`text-sm ${strong}`}>
                      1.0.0 (first version)
                    </span>
                  )}
                </div>
              </div>
              <div
                className="flex flex-row items-center gap-3"
                data-testid="publish-visibility"
              >
                <div className="flex flex-col flex-1 min-w-0">
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                  >
                    Who can install it
                  </span>
                  <span className={`text-sm ${muted}`}>
                    {visibility === "public"
                      ? "Anyone can find and install it."
                      : "Only you can install it."}
                  </span>
                </div>
                <span
                  className={`text-sm ${visibility === "public" ? strong : muted}`}
                >
                  {visibility === "public" ? "Public" : "Private"}
                </span>
                <Switch
                  ariaLabel="Public"
                  checked={visibility === "public"}
                  onChange={(on) => {
                    if (!busy) setVisibility(on ? "public" : "private");
                  }}
                />
              </div>
              <InputText
                label="What's new"
                value={whatsNew}
                onChange={(v) => setWhatsNew(v)}
              />
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`flex flex-col p-3 rounded-lg border ${hairline}`}
                  data-testid="publish-contents"
                >
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide pb-1 ${muted}`}
                  >
                    What's in it
                  </span>
                  <Row label="Steps">{prev.contents.steps.join(" → ")}</Row>
                  <Row label={`Bots (${prev.contents.bots.length})`}>
                    {prev.contents.bots.join(", ") || "—"}
                  </Row>
                  <Row label={`Checks (${prev.contents.checks.length})`}>
                    {prev.contents.checks.join(" · ") || "—"}
                  </Row>
                  <Row label="Files">
                    <span className="font-mono text-xs">
                      {prev.contents.files.join(" · ") || "—"}
                    </span>
                  </Row>
                  <Row label="Outputs">
                    {prev.contents.outputs.join("; ") || "—"}
                  </Row>
                  <Row label="Criteria">
                    {prev.contents.criteria
                      ? `${prev.contents.criteria} ready-made`
                      : "—"}
                  </Row>
                </div>
                <div className="flex flex-col gap-3">
                  <div
                    className={`flex flex-col gap-1 p-3 rounded-lg border ${hairline}`}
                  >
                    <span
                      className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                    >
                      It needs · asked on install
                    </span>
                    {prev.needs.providers.map((t) => (
                      <span
                        key={t}
                        className={`text-sm ${strong}`}
                      >{`A ${t} provider (any)`}</span>
                    ))}
                    {prev.needs.folder ? (
                      <span className={`text-sm ${strong}`}>
                        A folder to work in
                      </span>
                    ) : null}
                    {!prev.needs.providers.length && !prev.needs.folder ? (
                      <span className={`text-sm ${muted}`}>Nothing</span>
                    ) : null}
                  </div>
                  <div
                    className={`flex flex-col gap-1 p-3 rounded-lg border ${hairline}`}
                    data-testid="publish-left-out"
                  >
                    <span
                      className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                    >
                      Left out
                    </span>
                    {prev.leftOut.map((l) => (
                      <span key={l} className={`text-sm ${muted}`}>
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div
                data-testid="publish-checks"
                className={`flex flex-row flex-wrap gap-x-4 gap-y-1 p-3 rounded-lg border ${
                  prev.checks.every((c) => c.ok)
                    ? `${status.success.border} ${status.success.bg}`
                    : `${status.warning.border} ${status.warning.bg}`
                }`}
              >
                {prev.checks.map((c) => (
                  <span
                    key={c.text}
                    className={`text-sm flex flex-row items-center gap-1.5 ${c.ok ? status.success.text : status.warning.text}`}
                  >
                    <FontAwesomeIcon
                      icon={c.ok ? "check" : "triangle-exclamation"}
                      className="h-3 w-3"
                    />
                    {c.text}
                  </span>
                ))}
              </div>
            </>
          ) : !error ? (
            <span className={`text-sm ${muted}`}>Reading the flow…</span>
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
            {prev && prev.current
              ? `Signed with your publisher key. Anyone who installed ${prev.current} sees an update.`
              : "Signed with your publisher key."}
          </span>
          <Button3 title="Cancel" size="sm" onClick={onClose} />
          <Button
            title={busy ? "Publishing…" : `Publish ${version}`}
            size="sm"
            disabled={
              busy || !prev || !prev.signedIn || blocked || !name.trim()
            }
            onClick={publish}
          />
        </div>
      </div>
    </Modal>
  );
};

export default PublishFlowModal;
