import React, { useState } from "react";
import {
  AlertBanner,
  Checkbox,
  ConfirmationModal,
  InputText,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const KINDS = [
  { kind: "dashboards", title: "Dashboards", noun: "dashboard" },
  { kind: "bots", title: "Bots", noun: "bot" },
  { kind: "folders", title: "Folders", noun: "folder" },
  { kind: "themes", title: "Themes", noun: "theme" },
];

// Widgets the user can tick: installing, updating, or replacing a build.
const WIDGET_CHOICES = ["install", "update", "choose"];

function savedText(file) {
  const parts = [];
  if (file.createdOn) parts.push(`Saved on ${file.createdOn}`);
  if (file.createdAt) {
    const d = new Date(file.createdAt);
    if (!Number.isNaN(d.getTime())) parts.push(d.toLocaleString());
  }
  return parts.join(" · ");
}

/**
 * Load a profile from a .dashprofile (dash-profiles PR 5). The file was
 * already picked and read in the main process; `preview` says what loading
 * would do. Nothing changes until the user confirms.
 *
 * Mounted only while open (it opens inside the Settings modal).
 */
export const LoadProfileModal = ({ appId, preview, onClose, onLoaded }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const replacing = preview.target.mode === "replace";
  const [asNew, setAsNew] = useState(false);
  const [name, setName] = useState(
    replacing ? `${preview.target.name} (loaded)` : preview.target.name,
  );
  // Changed items: which take the file's copy. Starts at the newer copy.
  const [useFile, setUseFile] = useState(() => {
    const out = {};
    for (const { kind } of KINDS) {
      out[kind] = new Set(
        (preview.items[kind] || [])
          .filter((r) => r.state === "changed" && r.useFile)
          .map((r) => r.id),
      );
    }
    return out;
  });
  const [widgets, setWidgets] = useState(
    () =>
      new Set(
        (preview.widgets || []).filter((w) => w.on).map((w) => w.package),
      ),
  );
  const [applySettings, setApplySettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const toggleIn = (set, key, on) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };

  async function load() {
    if (loading) return;
    setLoading(true);
    setError(null);
    let res;
    try {
      res = await window.mainApi?.profiles?.applyLoad?.(appId, preview.token, {
        asNew: replacing && asNew,
        name: replacing && !asNew ? undefined : name,
        useFile: Object.fromEntries(
          KINDS.map(({ kind }) => [kind, [...useFile[kind]]]),
        ),
        widgets: [...widgets],
        applySettings,
      });
    } catch (e) {
      res = { success: false, error: e?.message };
    } finally {
      setLoading(false);
    }
    if (res && res.success) {
      onLoaded(res);
      return;
    }
    setError(res?.error || "Couldn't load the file.");
  }

  const newBots = (preview.items.bots || []).filter(
    (r) => r.state === "new",
  ).length;
  const needSetup = (preview.providers || []).filter((p) => !p.ready);
  const title =
    replacing && !asNew
      ? `Replace ${preview.target.name}?`
      : `Load ${preview.file.name}`;

  return (
    <ConfirmationModal
      isOpen
      setIsOpen={onClose}
      title={title}
      confirmLabel={
        loading ? "Loading…" : replacing && !asNew ? "Replace" : "Load"
      }
      onConfirm={load}
      onCancel={onClose}
    >
      <div
        // One scroll area: the dialog itself doesn't scroll, and a long
        // preview would push Load and Cancel off screen.
        className={`flex flex-col gap-4 text-sm max-h-96 overflow-y-auto pr-1 ${strong}`}
        data-testid="load-profile"
      >
        {savedText(preview.file) ? (
          <span className={muted}>{savedText(preview.file)}</span>
        ) : null}

        {replacing ? (
          <div className="flex flex-col gap-2">
            {!asNew ? (
              <AlertBanner
                variant="warning"
                size="compact"
                message={`This will replace your "${preview.target.name}" profile with the file's. Dashboards and bots it no longer holds stay on this Mac.`}
              />
            ) : null}
            <Checkbox
              label="Load as a new profile instead"
              checked={asNew}
              onChange={setAsNew}
            />
          </div>
        ) : null}

        {preview.fromDefault ? (
          <span className={`${muted} max-w-prose`}>
            Your Default profile isn't changed — this loads as a profile of its
            own.
          </span>
        ) : null}

        {!replacing || asNew ? (
          <InputText
            label="Profile name"
            value={name}
            onChange={setName}
            ariaLabel="Profile name"
          />
        ) : null}

        {KINDS.map(({ kind, title: heading, noun }) => {
          const rows = preview.items[kind] || [];
          if (!rows.length) return null;
          const count = (state) => rows.filter((r) => r.state === state).length;
          const summary = [
            count("new") ? `${count("new")} new` : null,
            count("changed") ? `${count("changed")} changed` : null,
            count("same") ? `${count("same")} already here` : null,
            count("leaves")
              ? `${count("leaves")} leave${count("leaves") === 1 ? "s" : ""} this profile`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const shown = rows.filter((r) => r.state !== "same");
          return (
            <div
              key={kind}
              className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
              data-testid={`load-profile-${kind}`}
            >
              <span>
                <span className="font-medium">{heading}</span>
                <span className={muted}> · {summary || plural(0, noun)}</span>
              </span>
              {shown.length ? (
                <div className="flex flex-col gap-2">
                  {shown.map((row) => (
                    <div
                      key={`${row.state}-${row.id}`}
                      className="flex flex-col"
                    >
                      {row.state === "changed" ? (
                        <Checkbox
                          label={`${row.name} — use the file's`}
                          checked={useFile[kind].has(row.id)}
                          onChange={(on) =>
                            setUseFile({
                              ...useFile,
                              [kind]: toggleIn(useFile[kind], row.id, on),
                            })
                          }
                        />
                      ) : (
                        <span>
                          {row.name}
                          <span className={muted}>
                            {row.state === "new"
                              ? " · new"
                              : " · leaves this profile, stays on this Mac"}
                          </span>
                        </span>
                      )}
                      {row.state === "changed" ? (
                        <span className={muted}>
                          {[
                            row.reason,
                            row.alsoIn && row.alsoIn.length
                              ? `also in ${row.alsoIn.join(", ")}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {(preview.widgets || []).length ? (
          <div
            className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
            data-testid="load-profile-widgets"
          >
            <span className="font-medium">
              {plural(preview.widgets.length, "widget")}
            </span>
            {preview.widgets.map((w) => {
              const label = `${w.package}${w.version ? ` ${w.version}` : ""}`;
              const usedBy =
                (w.action === "update" || w.action === "choose") &&
                w.dashboardsUsing
                  ? ` · used by ${plural(w.dashboardsUsing, "dashboard")} here`
                  : "";
              return (
                <div key={w.package} className="flex flex-col">
                  {WIDGET_CHOICES.includes(w.action) ? (
                    <Checkbox
                      label={label}
                      checked={widgets.has(w.package)}
                      onChange={(on) =>
                        setWidgets(toggleIn(widgets, w.package, on))
                      }
                    />
                  ) : (
                    <span>{label}</span>
                  )}
                  <span className={muted}>
                    {w.reason}
                    {usedBy}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {newBots ? (
          <span className={`${muted} max-w-prose`}>
            New bots arrive paused — turn them on when you're ready.
          </span>
        ) : null}

        {needSetup.length ? (
          <span className={`${muted} max-w-prose`}>
            Keys aren't in the file. Set these up on this Mac after loading:{" "}
            {needSetup.map((p) => p.name).join(", ")}.
          </span>
        ) : null}

        {(preview.secretsToEnter || []).length ? (
          <div
            className={`flex flex-col gap-1 rounded-lg border p-3 ${hairline}`}
            data-testid="load-profile-secrets"
          >
            <span className="font-medium">Enter on this Mac</span>
            <span className={`${muted} max-w-prose`}>
              Keys and passwords typed into widgets aren't in the file. Add them
              in each widget's settings after loading:
            </span>
            {preview.secretsToEnter.map((s, i) => (
              <span key={i}>
                {s.dashboard} › {s.title || s.component || s.widget} › {s.field}
              </span>
            ))}
          </div>
        ) : null}

        {preview.settings ? (
          <Checkbox
            label="Also use its app theme and update setting"
            checked={applySettings}
            onChange={setApplySettings}
          />
        ) : null}

        {error ? (
          <AlertBanner variant="error" size="compact" message={error} />
        ) : null}
      </div>
    </ConfirmationModal>
  );
};
