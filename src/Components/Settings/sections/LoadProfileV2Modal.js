import React, { useContext, useState } from "react";
import {
  AlertBanner,
  Button2,
  Checkbox,
  ConfirmationModal,
  InputText,
  SelectInput,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { openProviderSetup } from "../../Provider/providerSetupEvent";

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const KINDS = [
  { kind: "dashboard", title: "Dashboards", noun: "dashboard" },
  { kind: "bot", title: "Bots", noun: "bot" },
  { kind: "team", title: "Teams", noun: "team" },
  { kind: "theme", title: "Themes", noun: "theme" },
  { kind: "folder", title: "Folders", noun: "folder" },
  { kind: "widget", title: "Widgets", noun: "widget" },
];

const rowId = (row) => `${row.kind}:${row.package}`;

// After loading: what each added provider needs, and its button.
const afterNeed = (p) =>
  p.needsRun
    ? p.reach === "address"
      ? "connect"
      : "run"
    : p.signIn
      ? "signIn"
      : "key";
const AFTER_TEXT = {
  key: "paste your key",
  signIn: "sign in on this Mac",
  run: "runs a program — you OK it first",
  connect: "connects to an address — you OK it first",
};
const AFTER_ACTION = {
  key: "Add key",
  signIn: "Sign in",
  run: "Review",
  connect: "Review",
};

// What a provider the profile adds here still needs (dash-profiles).
const NEED_TEXT = {
  key: "added without its key — you add it after loading",
  signIn: "added — you sign in on this Mac after loading",
  run: "added — runs a program, so you OK it before it runs",
  connect: "added — connects to an address, so you OK it first",
};

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
 * A changed item's choice: a widget by version; setup (a dashboard,
 * folder, theme or bot — v3) by "the profile's copy" — "the account's"
 * when it came from the account.
 */
export function choiceLabel(row, fromAccount = false) {
  const whose = fromAccount ? "the account's" : "the profile's";
  if (row.action === "update") {
    return row.version
      ? `${row.name} — update to ${row.version}`
      : `${row.name} — use ${whose} copy`;
  }
  return `${row.name} — use ${whose} ${row.version || "copy"}`;
}

/**
 * Load a v2 or v3 profile: widgets (and, in v2, everything else) come
 * from the registry at the versions the profile lists; a v3 profile's
 * setup — dashboards, folders, themes, bots — comes as it is. The preview
 * says what's new, updated, already here or kept, and which providers to
 * use, map or set up; nothing changes until the user confirms.
 *
 * Mounted only while open (it opens inside the Settings modal).
 */
export const LoadProfileV2Modal = ({ appId, preview, onClose, onLoaded }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const app = useContext(AppContext) || {};
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
  // Loaded, with providers added that still need the user: the list of
  // what's left, before the window closes (dash-profiles).
  const [done, setDone] = useState(null);

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
      // The providers it added: every screen sees them now (the after-load
      // list opens them), not after a restart.
      if ((res.providersAdded || []).length && app.refreshProviders) {
        await Promise.resolve(app.refreshProviders()).catch(() => {});
      }
      if ((res.providersAdded || []).length) setDone(res);
      else onLoaded(res);
      return;
    }
    setError(res?.error || "Couldn't load the profile.");
  }

  const close = () => {
    if (!loading) onClose();
  };
  if (done) {
    const added = done.providersAdded || [];
    const finish = () => onLoaded(done);
    return (
      <ConfirmationModal
        isOpen
        // Only Done or Later close it: a provider's setup opening in front
        // takes the focus, and that mustn't close the list underneath.
        setIsOpen={() => {}}
        title={`Add keys for ${plural(added.length, "provider")}`}
        confirmLabel="Done"
        cancelLabel="Later"
        onConfirm={finish}
        onCancel={finish}
      >
        <div
          className={`flex flex-col gap-3 text-sm max-h-96 overflow-y-auto pr-1 ${strong}`}
          data-testid="load-v2-after"
        >
          <AlertBanner
            variant="success"
            size="compact"
            message={`${done.profile.name} is loaded.`}
          />
          <span className="max-w-prose">
            Its dashboards work once these have their keys. Each opens in front
            of this list.
          </span>
          <div className={`flex flex-col rounded-lg border ${hairline}`}>
            {added.map((p, i) => (
              <div
                key={p.name}
                className={`flex flex-row items-center gap-3 px-3 py-2 ${
                  i ? `border-t ${hairline}` : ""
                }`}
                data-testid="load-v2-after-row"
              >
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="font-medium truncate">{p.name}</span>
                  <span className={`text-xs ${muted}`}>
                    {`${p.type} · ${AFTER_TEXT[afterNeed(p)]}`}
                  </span>
                </span>
                <Button2
                  title={AFTER_ACTION[afterNeed(p)]}
                  size="sm"
                  onClick={() =>
                    openProviderSetup(p.name, { review: p.needsRun })
                  }
                />
              </div>
            ))}
          </div>
          <span className={`${muted} max-w-prose`}>
            You can also add them later — each one shows what it needs on the
            Providers page and on its widgets.
          </span>
        </div>
      </ConfirmationModal>
    );
  }

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
            {asNew && preview.schemaVersion === 3 ? (
              <span
                className={`${muted} max-w-prose`}
                data-testid="load-as-new-shared"
              >
                Dashboards and bots already on this computer are shared: the new
                profile holds the same ones, so a change to one shows in both
                profiles.
              </span>
            ) : null}
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
                      label={choiceLabel(row, !!preview.fromAccount)}
                      checked={!keep.has(rowId(row))}
                      onChange={(on) => toggle(keep, setKeep, rowId(row), !on)}
                    />
                  ) : row.action === "keep" ? (
                    <Checkbox
                      label={choiceLabel(row, !!preview.fromAccount)}
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
            {providers.some((p) => p.status !== "ready") ? (
              <span className={`${muted} max-w-prose`}>
                Ones this Mac doesn&apos;t have are added with their settings,
                without their keys. You add each key after loading.
              </span>
            ) : null}
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
                      {
                        value: "",
                        label: `None — add "${p.name}" without its key`,
                      },
                    ]}
                  />
                ) : (
                  <span>
                    {`${p.name} (${p.type}) · ${NEED_TEXT[p.need] || NEED_TEXT.key}`}
                  </span>
                )}
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
