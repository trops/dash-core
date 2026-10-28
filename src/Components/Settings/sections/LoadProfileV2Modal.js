import React, { useState } from "react";
import {
  AlertBanner,
  Button2,
  Checkbox,
  ConfirmationModal,
  InputText,
  SelectInput,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const KINDS = [
  { kind: "dashboard", title: "Dashboards", noun: "dashboard" },
  { kind: "bot", title: "Bots", noun: "bot" },
  { kind: "team", title: "Teams", noun: "team" },
  { kind: "theme", title: "Themes", noun: "theme" },
  { kind: "widget", title: "Widgets", noun: "widget" },
];

const rowId = (row) => `${row.kind}:${row.package}`;

/**
 * What replacing takes out of the profile. It stays on this computer; what
 * no other profile holds is hidden until it's ticked back in Settings ›
 * Profiles — said plainly.
 */
export function leavingText(leaving) {
  const all = leaving || [];
  const hidden = all.filter((l) => l.hidden).map((l) => l.name);
  const elsewhere = all.filter((l) => !l.hidden).map((l) => l.name);
  const parts = [];
  if (elsewhere.length) {
    parts.push(
      `Leaves this profile (still in your other profiles): ${elsewhere.join(", ")}.`,
    );
  }
  if (hidden.length) {
    parts.push(
      `Not in any other profile, so hidden until you tick it back in Settings › Profiles (it stays on this computer): ${hidden.join(", ")}.`,
    );
  }
  return parts.length ? parts.join(" ") : null;
}

function savedText(file) {
  const parts = [];
  if (file.owner) parts.push(`@${file.owner}`);
  if (file.createdOn) parts.push(`saved on ${file.createdOn}`);
  if (file.createdAt) {
    const d = new Date(file.createdAt);
    if (!Number.isNaN(d.getTime())) parts.push(d.toLocaleString());
  }
  return parts.join(" · ");
}

/** One item's line: what loading does to it. */
export function rowText(row) {
  const label = `${row.name}${row.version ? ` ${row.version}` : ""}`;
  switch (row.action) {
    case "install":
      return row.withTeam
        ? `${label} · new, with its team (its bots arrive paused)`
        : `${label} · new`;
    case "here":
      return `${label} · already here`;
    case "unavailable":
      return `${row.name} · ${row.reason}`;
    default:
      return label;
  }
}

/**
 * Load a v2 profile (dash-profiles v2): everything comes from the registry
 * at the versions the profile lists. The preview says what's installed,
 * updated, already here or kept, and which providers to use, map or set up;
 * nothing changes until the user confirms.
 *
 * Mounted only while open (it opens inside the Settings modal).
 */
export const LoadProfileV2Modal = ({ appId, preview, onClose, onLoaded }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const replacing = preview.target.mode === "replace";
  const [asNew, setAsNew] = useState(false);
  const [name, setName] = useState(
    replacing ? `${preview.target.name} (loaded)` : preview.target.name,
  );
  // Updates the user doesn't want (keep this Mac's), and kept items they do.
  const [keep, setKeep] = useState(() => new Set());
  const [take, setTake] = useState(() => new Set());
  // The file's provider name → this computer's (null: set up later).
  const [providerMap, setProviderMap] = useState(() => {
    const out = {};
    for (const p of preview.providers || []) {
      if (p.status === "map") out[p.name] = p.mapTo;
    }
    return out;
  });
  const [applySettings, setApplySettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (set, setter, key, on) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    setter(next);
  };

  async function load() {
    if (loading || preview.unreachable) return;
    setLoading(true);
    setError(null);
    let res;
    try {
      res = await window.mainApi?.profiles?.applyLoad?.(appId, preview.token, {
        asNew: replacing && asNew,
        name: replacing && !asNew ? undefined : name,
        keep: [...keep],
        take: [...take],
        providerMap,
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
    setError(res?.error || "Couldn't load the profile.");
  }

  const close = () => {
    if (!loading) onClose();
  };
  const setUp = (p) =>
    window.dispatchEvent(
      new CustomEvent("dash:open-settings-create-provider", {
        detail: { type: p.type, providerClass: p.providerClass || null },
      }),
    );
  const rows = preview.rows || [];
  const providers = preview.providers || [];
  const newBots = rows.filter(
    (r) =>
      ((r.kind === "bot" || r.kind === "team") && r.action === "install") ||
      r.withTeam,
  ).length;
  const title =
    replacing && !asNew
      ? `Replace ${preview.target.name}?`
      : `Load ${preview.file.name}`;
  const confirmLabel = loading
    ? "Installing…"
    : preview.unreachable
      ? "Can't reach the registry"
      : replacing && !asNew
        ? "Replace"
        : "Load";

  return (
    <ConfirmationModal
      isOpen
      setIsOpen={close}
      title={title}
      confirmLabel={confirmLabel}
      onConfirm={load}
      onCancel={close}
    >
      <div
        className={`flex flex-col gap-4 text-sm max-h-96 overflow-y-auto pr-1 ${strong}`}
        data-testid="load-profile-v2"
      >
        {savedText(preview.file) ? (
          <span className={muted}>{savedText(preview.file)}</span>
        ) : null}

        {preview.unreachable ? (
          <AlertBanner
            variant="error"
            size="compact"
            message="Couldn't reach the registry to check the profile's items — try again in a moment."
          />
        ) : null}

        {replacing ? (
          <div className="flex flex-col gap-2">
            {!asNew ? (
              <AlertBanner
                variant="warning"
                size="compact"
                message={`This will replace your "${preview.target.name}" profile with ${
                  preview.fromAccount ? "your account's copy" : "the file's"
                }. Dashboards and bots it no longer holds stay on this computer.`}
              />
            ) : null}
            {!asNew && leavingText(preview.leaving) ? (
              <span
                className={`${muted} max-w-prose`}
                data-testid="load-leaving"
              >
                {leavingText(preview.leaving)}
              </span>
            ) : null}
            <Checkbox
              label="Load as a new profile instead"
              checked={asNew}
              onChange={setAsNew}
            />
          </div>
        ) : null}

        {preview.fromDefault && preview.target.profileId !== "default" ? (
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
          const list = rows.filter((r) => r.kind === kind);
          if (!list.length) return null;
          const here = list.filter((r) => r.action === "here");
          const shown = list.filter((r) => r.action !== "here");
          return (
            <div
              key={kind}
              className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
              data-testid={`load-v2-${kind}`}
            >
              <span>
                <span className="font-medium">{heading}</span>
                <span className={muted}>
                  {` · ${plural(list.length, noun)}`}
                  {here.length ? ` · ${here.length} already here` : ""}
                </span>
              </span>
              {shown.map((row) => (
                <div key={rowId(row)} className="flex flex-col">
                  {row.action === "update" ? (
                    <Checkbox
                      label={`${row.name} — update to ${row.version}`}
                      checked={!keep.has(rowId(row))}
                      onChange={(on) => toggle(keep, setKeep, rowId(row), !on)}
                    />
                  ) : row.action === "keep" ? (
                    <Checkbox
                      label={`${row.name} — use the profile's ${row.version}`}
                      checked={take.has(rowId(row))}
                      onChange={(on) => toggle(take, setTake, rowId(row), on)}
                    />
                  ) : (
                    <span className={row.action === "unavailable" ? muted : ""}>
                      {rowText(row)}
                    </span>
                  )}
                  {row.reason && row.action !== "unavailable" ? (
                    <span className={muted}>{row.reason}</span>
                  ) : null}
                </div>
              ))}
            </div>
          );
        })}

        {providers.length ? (
          <div
            className={`flex flex-col gap-3 rounded-lg border p-3 ${hairline}`}
            data-testid="load-v2-providers"
          >
            <span className="font-medium">Providers</span>
            {providers.map((p) => (
              <div key={p.name} className="flex flex-col gap-1">
                {p.status === "ready" ? (
                  <span>{`${p.name} · ready on this Mac`}</span>
                ) : p.status === "map" ? (
                  <SelectInput
                    label={`Use for "${p.name}"`}
                    value={providerMap[p.name] || ""}
                    onChange={(v) =>
                      setProviderMap({ ...providerMap, [p.name]: v || null })
                    }
                    options={[
                      ...p.options.map((o) => ({ value: o, label: o })),
                      { value: "", label: `None — set up "${p.name}" later` },
                    ]}
                  />
                ) : (
                  <div className="flex flex-row flex-wrap items-center gap-2">
                    <span>{`${p.name} (${p.type})`}</span>
                    <Button2
                      title="Set up"
                      size="sm"
                      onClick={() => setUp(p)}
                    />
                  </div>
                )}
                {p.status === "setup" ? (
                  <span className={muted}>
                    {`Not on this Mac. Set it up with your key and name it "${p.name}" so the profile's dashboards and bots find it.`}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {newBots ? (
          <span className={`${muted} max-w-prose`}>
            New bots arrive paused. Their tools need your approval on this Mac
            the first time they run.
          </span>
        ) : null}

        {(preview.secretsToEnter || []).length ? (
          <div
            className={`flex flex-col gap-1 rounded-lg border p-3 ${hairline}`}
            data-testid="load-v2-secrets"
          >
            <span className="font-medium">Enter on this Mac</span>
            <span className={`${muted} max-w-prose`}>
              Keys and passwords typed into widgets aren't in the profile. Add
              them in each widget's settings after loading:
            </span>
            {preview.secretsToEnter.map((s, i) => (
              <span key={i}>
                {s.dashboard} › {s.title || s.component || s.widget} › {s.field}
              </span>
            ))}
          </div>
        ) : null}

        {(preview.leftOut || []).length ? (
          <div className="flex flex-col gap-1" data-testid="load-v2-left-out">
            <span className="font-medium">Not in this profile</span>
            {preview.leftOut.map((l, i) => (
              <span key={i} className={muted}>
                {`${l.name}: ${l.reason}`}
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
