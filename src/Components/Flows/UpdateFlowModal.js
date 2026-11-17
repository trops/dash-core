import React, { useContext, useEffect, useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon,
  Checkbox,
  DiffView,
  Modal,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";

const MARK = { add: "+", remove: "−", change: "~", same: "✓" };

const show = (v) =>
  v == null
    ? "—"
    : typeof v === "object"
      ? v.minutes
        ? `${v.minutes} min`
        : JSON.stringify(v)
      : String(v).slice(0, 80);

/**
 * UpdateFlowModal — "Update <flow>: 1.2.0 → 1.3.0" (frame 35): what
 * changes, changed scripts line by line (they need your OK again), your own
 * changes to keep or replace, and goals already running finishing on their
 * version. Skip this version, Not now, Update.
 */
export const UpdateFlowModal = ({ flow, onClose, onUpdated }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    scrollable: false,
    grow: false,
  });
  const api = flowsApi();
  const [prev, setPrev] = useState(null);
  const [keep, setKeep] = useState({});
  const [approve, setApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.updatePreview(flow.id).then((r) => {
      if (!r || r.error) setError((r && r.error) || "It couldn't be read.");
      else setPrev(r);
    });
  }, [api, flow.id]);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  const tone = (kind) =>
    kind === "add" || kind === "same"
      ? status.success
      : kind === "remove"
        ? status.error
        : status.warning;

  return (
    <Modal
      isOpen
      setIsOpen={(open) => !open && onClose()}
      width="w-11/12 max-w-4xl"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full w-full min-h-0 rounded-lg overflow-clip border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="update-flow-modal"
      >
        <div
          className={`flex flex-row items-start gap-2 px-5 py-4 border-b ${hairline}`}
        >
          <div className="flex-1 min-w-0 flex flex-col">
            <span className={`text-lg font-semibold ${strong}`}>
              {prev
                ? `Update ${flow.name}: ${prev.from} → ${prev.to}`
                : `Update ${flow.name}`}
            </span>
            {prev ? (
              <span
                className={`text-xs ${muted}`}
              >{`From ${prev.package}${prev.whatsNew ? ` · "${prev.whatsNew}"` : ""}`}</span>
            ) : null}
          </div>
          <ButtonIcon
            icon="xmark"
            ariaLabel="Close"
            size="sm"
            onClick={onClose}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 p-5">
          {prev ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div
                  className="flex flex-col gap-2"
                  data-testid="update-changes"
                >
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                  >
                    What changes
                  </span>
                  {prev.changes.map((c, i) => (
                    <div
                      key={i}
                      className={`flex flex-row items-start gap-2 p-3 rounded-lg border ${hairline}`}
                    >
                      <span
                        className={`w-5 h-5 flex-shrink-0 rounded flex items-center justify-center text-xs font-semibold ${tone(c.kind).bg} ${tone(c.kind).text}`}
                      >
                        {MARK[c.kind] || "~"}
                      </span>
                      <span className="flex-1 min-w-0 flex flex-col">
                        <span className={`text-sm font-semibold ${strong}`}>
                          {c.text}
                        </span>
                        {c.detail ? (
                          <span className={`text-xs ${muted}`}>{c.detail}</span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-3">
                  {prev.scripts.map((s) => (
                    <div
                      key={s.ref}
                      className="flex flex-col gap-1"
                      data-testid="update-script"
                    >
                      <span
                        className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
                      >{`Script changes · ${s.ref}`}</span>
                      <DiffView before={s.before} after={s.after} />
                    </div>
                  ))}
                  {prev.scripts.length ? (
                    <Checkbox
                      checked={approve}
                      onChange={(v) => setApprove(!!v)}
                      label="I've read the changed scripts. Let them run."
                    />
                  ) : null}
                  {prev.conflicts.map((c) => (
                    <div
                      key={c.id}
                      data-testid="update-conflict"
                      className={`flex flex-col gap-2 p-3 rounded-lg border ${status.warning.accentBorder} ${status.warning.bg}`}
                    >
                      <span
                        className={`text-sm font-semibold ${status.warning.strongText}`}
                      >
                        {c.text}
                      </span>
                      <span className={`text-sm ${status.warning.text}`}>
                        {`Yours: ${show(c.mine)}   Theirs: ${show(c.theirs)}`}
                      </span>
                      <div className="flex flex-row gap-2">
                        <Button3
                          title={
                            keep[c.id] === "theirs"
                              ? "Keep mine"
                              : "Keep mine ✓"
                          }
                          size="sm"
                          onClick={() =>
                            setKeep((k) => ({ ...k, [c.id]: "mine" }))
                          }
                        />
                        <Button3
                          title={
                            keep[c.id] === "theirs"
                              ? "Take theirs ✓"
                              : "Take theirs"
                          }
                          size="sm"
                          onClick={() =>
                            setKeep((k) => ({ ...k, [c.id]: "theirs" }))
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {prev.running ? (
                <div
                  className={`p-3 rounded-lg text-sm ${status.info.bg} ${status.info.text}`}
                  data-testid="update-running"
                >
                  {`${prev.running} job${prev.running === 1 ? "" : "s"} already running finish${prev.running === 1 ? "es" : ""} on ${prev.from}, so their rules don't change halfway. New jobs use ${prev.to}.`}
                </div>
              ) : null}
            </>
          ) : !error ? (
            <span className={`text-sm ${muted}`}>
              Downloading and comparing…
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
          {prev ? (
            <Button3
              title="Skip this version"
              size="sm"
              onClick={() =>
                run(() => api.skipVersion(flow.id, prev.to)).then(() =>
                  onClose(),
                )
              }
            />
          ) : null}
          <span className="flex-1" />
          <Button3 title="Not now" size="sm" onClick={onClose} />
          <Button
            title={busy ? "Updating…" : "Update"}
            size="sm"
            disabled={busy || !prev || (prev.scripts.length > 0 && !approve)}
            onClick={() =>
              run(async () => {
                const keepAll = Object.fromEntries(
                  (prev.conflicts || []).map((c) => [
                    c.id,
                    keep[c.id] || "mine",
                  ]),
                );
                const r = await api.update(prev.previewId, {
                  keep: keepAll,
                  approveScripts: approve,
                });
                if (!r || r.error)
                  setError((r && r.error) || "It couldn't be updated.");
                else onUpdated(r.flow);
              })
            }
          />
        </div>
      </div>
    </Modal>
  );
};

export default UpdateFlowModal;
