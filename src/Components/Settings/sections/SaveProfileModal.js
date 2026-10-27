import React, { useEffect, useState } from "react";
import { AlertBanner, Checkbox, ConfirmationModal } from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function sizeText(bytes) {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What happens to one widget on the other computer, in a few words. */
export function widgetStatusText(w) {
  switch (w.status) {
    case "in-registry":
    case "assumed-registry": {
      const base = "Downloads automatically when loaded";
      return w.updateAvailable
        ? `${base} · an update (${w.registryVersion}) is available`
        : base;
    }
    case "unchecked":
      return "Couldn't check right now — downloads when loaded, if available";
    case "newer-here":
      return `Newer here than the published one (${w.registryVersion}) — included in this file`;
    case "local-build":
      return "Installed from a file or folder — included in this file";
    case "version-missing":
      return "This version isn't published — included in this file";
    default:
      return "Not published — included in this file";
  }
}

/**
 * Save a profile to a .dashprofile file (dash-profiles PR 4): what goes in,
 * where each widget will come from on the other computer, and a few
 * options. The save dialog itself is the system's.
 *
 * Mounted only while open (it opens inside the Settings modal).
 */
export const SaveProfileModal = ({ appId, profile, onClose, onSaved }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [options, setOptions] = useState({
    bots: true,
    providers: true,
    settings: true,
  });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setPreview(null);
    Promise.resolve(
      window.mainApi?.profiles?.previewSave?.(appId, profile.id, options),
    )
      .then((res) => {
        if (!alive) return;
        if (res && res.success) setPreview(res);
        else setError(res?.error || "Couldn't read this profile.");
      })
      .catch(
        (e) => alive && setError(e?.message || "Couldn't read this profile."),
      );
    return () => {
      alive = false;
    };
  }, [appId, profile.id, options]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    let res;
    try {
      res = await window.mainApi?.profiles?.saveFile?.(
        appId,
        profile.id,
        options,
      );
    } catch (e) {
      res = { success: false, error: e?.message };
    } finally {
      setSaving(false);
    }
    if (res && res.success) {
      onSaved(res);
      return;
    }
    if (res && res.canceled) return;
    setError(res?.error || "Couldn't save the file.");
  }

  const counts = preview?.counts;
  const bundled = (preview?.widgets || []).filter(
    (w) => w.source === "bundled",
  );
  const option = (key, label) => (
    <Checkbox
      label={label}
      checked={options[key]}
      onChange={(checked) => {
        setError(null);
        setOptions({ ...options, [key]: checked });
      }}
    />
  );

  return (
    <ConfirmationModal
      isOpen
      setIsOpen={onClose}
      title={`Save ${profile.name} to a file`}
      confirmLabel={saving ? "Saving…" : "Save…"}
      onConfirm={save}
      onCancel={onClose}
    >
      <div
        className={`flex flex-col gap-4 text-sm ${strong}`}
        data-testid="save-profile"
      >
        <span className={`${muted} max-w-prose`}>
          Load this file on another computer to get the same dashboards, bots
          and widgets. Keys and passwords are never included — you'll add them
          there.
        </span>

        {counts ? (
          <span data-testid="save-profile-counts">
            {[
              plural(counts.dashboards, "dashboard"),
              plural(counts.bots, "bot"),
              plural(counts.folders, "folder"),
              plural(counts.themes, "theme"),
              plural(counts.providers, "provider"),
            ].join(" · ")}
          </span>
        ) : (
          <span className={muted}>Checking what goes in…</span>
        )}

        <div className="flex flex-col gap-2">
          {option("bots", "Bots")}
          {option("providers", "Providers (without their keys)")}
          {option("settings", "App settings (theme, update check)")}
        </div>

        {preview && preview.widgets.length ? (
          <div
            className={`flex flex-col gap-2 rounded-lg border p-3 max-h-60 overflow-y-auto ${hairline}`}
          >
            <span className="font-medium">
              {plural(preview.widgets.length, "widget")}
            </span>
            {preview.widgets.map((w) => (
              <div key={w.package} className="flex flex-col">
                <span>
                  {w.package}
                  {w.version ? ` ${w.version}` : ""}
                </span>
                <span className={muted}>{widgetStatusText(w)}</span>
              </div>
            ))}
          </div>
        ) : null}

        {bundled.length ? (
          <span className={`${muted} max-w-prose`}>
            {plural(bundled.length, "widget")} will be included in the file
            {sizeText(preview.bundledBytes)
              ? ` (up to ${sizeText(preview.bundledBytes)})`
              : ""}
            .
          </span>
        ) : null}

        {error ? (
          <AlertBanner variant="error" size="compact" message={error} />
        ) : null}
      </div>
    </ConfirmationModal>
  );
};
