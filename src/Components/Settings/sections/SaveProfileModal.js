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
  // Publish to your account (PR 4b): nothing is ticked until the user
  // ticks it. results: package → { status, error, findings, ... }.
  const [toPublish, setToPublish] = useState(() => new Set());
  const [confirmPaths, setConfirmPaths] = useState(() => new Set());
  const [results, setResults] = useState({});

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

  // Publish the ticked widgets one at a time. `ready` is false when one
  // needs the user's confirmation first (personal paths), so nothing is
  // saved yet.
  async function publishTicked() {
    const rows = (preview?.publishPlan || []).filter(
      (r) => r.publishable && toPublish.has(r.package),
    );
    let ready = true;
    const outcomes = { ...results };
    for (const row of rows) {
      if (results[row.package]?.status === "published") continue;
      setResults((r) => ({ ...r, [row.package]: { status: "publishing" } }));
      let res;
      try {
        res = await window.mainApi?.profiles?.publishWidget?.(
          appId,
          profile.id,
          row.package,
          { confirmPersonalPaths: confirmPaths.has(row.package) },
        );
      } catch (e) {
        res = { status: "failed", error: e?.message };
      }
      const outcome = res || { status: "failed" };
      outcomes[row.package] = outcome;
      setResults((r) => ({ ...r, [row.package]: outcome }));
      if (outcome.status === "needs-confirmation") ready = false;
    }
    // The dialog closes once the file is saved, so what happened goes
    // along to the "Saved" notice.
    const ticked = rows.map((r) => ({
      package: r.package,
      ...outcomes[r.package],
    }));
    return {
      ready,
      published: ticked.filter((o) => o.status === "published"),
      notPublished: ticked.filter((o) => o.status === "failed"),
    };
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    let publishing = { published: [], notPublished: [] };
    if (toPublish.size) {
      const { ready, ...outcomes } = await publishTicked();
      publishing = outcomes;
      if (!ready) {
        setSaving(false);
        setError(
          "Check the widget below before it's published, then press Save again.",
        );
        return;
      }
    }
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
      onSaved({ ...res, ...publishing });
      return;
    }
    if (res && res.canceled) return;
    setError(res?.error || "Couldn't save the file.");
  }

  const publishRows = preview?.publishPlan || [];
  const toggle = (set, setter, key, on) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    setter(next);
  };
  const resultText = (r) => {
    if (!r) return null;
    if (r.status === "publishing") return "Publishing…";
    if (r.status === "published") {
      const n = r.dashboardsSwitched || 0;
      return `Published as ${r.publishedAs} ${r.version}${
        n ? ` · ${plural(n, "dashboard")} on this computer now use it` : ""
      }`;
    }
    if (r.status === "needs-confirmation") {
      return "Some files mention folders on this computer. Publish anyway?";
    }
    return `Not published: ${r.error || "something went wrong"} — it stays in the file`;
  };

  const counts = preview?.counts;
  const bundled = (preview?.widgets || []).filter(
    (w) => w.source === "bundled",
  );
  // What still goes into the file once the ticked widgets are published.
  const stillBundled = bundled.filter((w) => !toPublish.has(w.package));
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

        {publishRows.length ? (
          <div
            className={`flex flex-col gap-3 rounded-lg border p-3 ${hairline}`}
            data-testid="save-profile-publish"
          >
            <span className="font-medium">Publish to your account</span>
            <span className={`${muted} max-w-prose`}>
              Instead of copying these into the file, publish them to your
              account. The other computer downloads them, and later updates
              reach both. This computer's dashboards switch to the published
              copy — the same code.
            </span>
            {publishRows.map((row) => {
              const result = results[row.package];
              return (
                <div key={row.package} className="flex flex-col gap-1">
                  <Checkbox
                    label={
                      row.publishable
                        ? `${row.publishAs} ${row.version}`
                        : row.package
                    }
                    checked={toPublish.has(row.package)}
                    disabled={!row.publishable || saving}
                    onChange={(on) =>
                      toggle(toPublish, setToPublish, row.package, on)
                    }
                  />
                  <span className={muted}>
                    {row.publishable
                      ? [
                          row.visibility === "public"
                            ? "Stays public"
                            : "Private — only you can see it",
                          row.bumped
                            ? `${row.currentVersion} is already published, so this is ${row.version}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : row.reason}
                  </span>
                  {result ? (
                    <span data-testid={`publish-result-${row.package}`}>
                      {resultText(result)}
                    </span>
                  ) : null}
                  {result?.status === "needs-confirmation" ? (
                    <>
                      {(result.findings || []).slice(0, 5).map((f, i) => (
                        <span key={i} className={muted}>
                          {f.file || f.path}
                          {f.match ? `: ${f.match}` : ""}
                        </span>
                      ))}
                      <Checkbox
                        label="Publish anyway"
                        checked={confirmPaths.has(row.package)}
                        onChange={(on) =>
                          toggle(confirmPaths, setConfirmPaths, row.package, on)
                        }
                      />
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {bundled.length && preview && !preview.signedIn ? (
          <span className={`${muted} max-w-prose`}>
            Sign in to publish these to your account instead of copying them
            into the file.
          </span>
        ) : null}

        {stillBundled.length ? (
          <span className={`${muted} max-w-prose`}>
            {plural(stillBundled.length, "widget")} will be included in the file
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
