import React, { useContext, useState } from "react";
import {
  AlertBanner,
  Button,
  Button2,
  Checkbox,
  InputText,
  Modal,
  SelectInput,
  ThemeContext,
  getStylesForItem,
  themeObjects,
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

// What still needs the user after loading: the ones that came with their
// key (unlocked) are set up — unless they need a sign-in or an OK.
const stillToSetUp = (res) =>
  ((res && res.providersAdded) || []).filter(
    (p) => !p.withKey || p.needsRun || p.signIn,
  );

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
 * The load window: dash-react's ConfirmationModal is too narrow for a row
 * per provider and dashboard, so this is the same dialog, wide like Save.
 * Tall (most of the window) for the preview, which can be long; the list
 * after loading sizes to fit.
 */
function LoadDialog({
  title,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  setIsOpen,
  tall = false,
  children,
}) {
  const { currentTheme } = useContext(ThemeContext) || {};
  const style = (key) =>
    getStylesForItem(key, currentTheme, { scrollable: false, grow: false }) ||
    {};
  const panelStyles = style(themeObjects.PANEL);
  const headerStyles = style(themeObjects.PANEL_HEADER);
  const footerStyles = style(themeObjects.SETTINGS_MODAL_FOOTER);
  return (
    <Modal
      isOpen
      setIsOpen={setIsOpen}
      width="w-full max-w-3xl"
      height={tall ? "h-5/6" : "h-auto"}
    >
      <div
        // Raised above the dimmed page, like dash-react's dialogs.
        className={`dr-modal-surface flex flex-col h-full rounded-lg overflow-clip border ${panelStyles.backgroundColor || ""} ${panelStyles.borderColor || ""}`}
      >
        <div
          className={`flex flex-row items-center p-4 border-b ${headerStyles.borderColor || ""} ${headerStyles.textColor || ""}`}
        >
          <span className="text-lg font-semibold">{title}</span>
        </div>
        <div className="flex-1 min-h-0 flex flex-col p-4">{children}</div>
        <div
          className={`flex flex-row justify-end items-center gap-2 px-4 py-3 border-t ${footerStyles.borderColor || ""}`}
        >
          <Button2 title={cancelLabel} onClick={onCancel} />
          <Button title={confirmLabel} onClick={onConfirm} />
        </div>
      </div>
    </Modal>
  );
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
  // Unticked providers (a map row unticks by picking one of this Mac's).
  const [skipped, setSkipped] = useState(() => new Set());
  // A map row's pick before it was ticked, so unticking brings it back.
  const [mapBack, setMapBack] = useState({});
  const [applySettings, setApplySettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Loaded, with providers added that still need the user: the list of
  // what's left, before the window closes (dash-profiles).
  const [done, setDone] = useState(null);
  // "Include keys and passwords": unlocked in the main process; here only
  // which providers' keys it holds.
  const [phrase, setPhrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);
  const [unlocked, setUnlocked] = useState(null);
  const locked = !!preview.lockedKeys;

  async function unlock() {
    if (unlocking || !phrase) return;
    setUnlocking(true);
    setUnlockError(null);
    let res;
    try {
      res = await window.mainApi?.profiles?.unlockKeys?.(
        appId,
        preview.token,
        phrase,
      );
    } catch (e) {
      res = { success: false, error: e?.message };
    } finally {
      setUnlocking(false);
    }
    if (res && res.success) {
      setPhrase("");
      const withKeys = res.providers || [];
      setUnlocked({ providers: withKeys, counts: res.counts });
      // A provider that came with its key is added as itself, with it —
      // not swapped for another of the same kind here (a different
      // account). The user can still choose one of theirs.
      setProviderMap((prev) => {
        const next = { ...prev };
        for (const p of preview.providers || []) {
          if (p.status === "map" && withKeys.includes(p.name)) {
            next[p.name] = null;
          }
        }
        return next;
      });
      return;
    }
    setUnlockError(res?.error || "Couldn't unlock the keys.");
  }

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
        skipProviders: [...skipped],
        applySettings,
        // Locked keys not unlocked: loaded without them.
        withoutKeys: locked && !unlocked,
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
      if (stillToSetUp(res).length) setDone(res);
      else onLoaded(res);
      return;
    }
    setError(res?.error || "Couldn't load the profile.");
  }

  const close = () => {
    if (!loading) onClose();
  };
  if (done) {
    const added = stillToSetUp(done);
    const finish = () => onLoaded(done);
    return (
      <LoadDialog
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
      </LoadDialog>
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
        ? locked && !unlocked
          ? "Replace without keys"
          : "Replace"
        : locked && !unlocked
          ? "Load without keys"
          : "Load";
  // "1 provider key and 2 passwords"
  const lockedWhat = [
    preview.lockedKeys?.providers
      ? plural(preview.lockedKeys.providers, "provider key")
      : null,
    preview.lockedKeys?.widgetSecrets
      ? plural(preview.lockedKeys.widgetSecrets, "password")
      : null,
  ]
    .filter(Boolean)
    .join(" and ");
  // A provider's line in the preview.
  const providerLine = (p) => {
    const need = p.need || "key";
    if (locked && need === "key") {
      const has = unlocked && unlocked.providers.includes(p.name);
      if (has) return `${p.name} (${p.type}) · added with its key, unlocked`;
      if (!unlocked) return `${p.name} (${p.type}) · added — its key is locked`;
    }
    return `${p.name} (${p.type}) · ${NEED_TEXT[need] || NEED_TEXT.key}`;
  };
  // Each provider has a checkbox, but one already here with its key
  // (nothing to add or fill in). Ticked: added (or its key filled in);
  // a map row unticked uses one of this Mac's instead.
  const hasKey = (p) => !!(unlocked && unlocked.providers.includes(p.name));
  // One here waiting for its key: a choice only when the profile has keys.
  const isPlainReady = (p) => p.status === "ready" && !(p.waiting && locked);
  const pickable = providers.filter((p) => !isPlainReady(p));
  const ticked = (p) =>
    p.status === "map" ? !providerMap[p.name] : !skipped.has(p.name);
  const nextMap = (map, p, on) => ({
    ...map,
    [p.name]: on ? null : mapBack[p.name] || p.mapTo || p.options[0],
  });
  const setTicked = (p, on) => {
    if (p.status === "map") {
      if (!on) setProviderMap(nextMap(providerMap, p, false));
      else {
        setMapBack({ ...mapBack, [p.name]: providerMap[p.name] });
        setProviderMap(nextMap(providerMap, p, true));
      }
      return;
    }
    toggle(skipped, setSkipped, p.name, !on);
  };
  const setAll = (on) => {
    let map = { ...providerMap };
    const back = { ...mapBack };
    for (const p of pickable) {
      if (p.status !== "map") continue;
      if (on && providerMap[p.name]) back[p.name] = providerMap[p.name];
      map = nextMap(map, p, on);
    }
    // Unticking all brings back each row's own pick.
    if (!on) {
      for (const p of pickable) {
        if (p.status === "map") map[p.name] = back[p.name] || map[p.name];
      }
    }
    setMapBack(back);
    setProviderMap(map);
    setSkipped(
      on
        ? new Set()
        : new Set(
            pickable.filter((p) => p.status !== "map").map((p) => p.name),
          ),
    );
  };
  const pickLine = (p) => {
    const kind = `${p.name} (${p.type})`;
    if (!ticked(p)) {
      if (p.status === "map") return `${kind} · not added`;
      if (p.status === "ready")
        return `${p.name} · on this Mac, its key isn't added`;
      return `${kind} · not added — widgets that use it say "Needs a provider" until you pick one`;
    }
    if (p.status === "ready") {
      return hasKey(p)
        ? `${p.name} · on this Mac, its key will be added`
        : `${p.name} · on this Mac, still needs its key`;
    }
    if (p.status === "map") {
      return hasKey(p)
        ? `${kind} · added with its key`
        : `${kind} · added without its key`;
    }
    return providerLine(p);
  };

  return (
    <LoadDialog
      tall
      setIsOpen={close}
      title={title}
      confirmLabel={confirmLabel}
      onConfirm={load}
      onCancel={close}
    >
      <div
        className={`flex-1 min-h-0 flex flex-col gap-4 text-sm overflow-y-auto pr-1 ${strong}`}
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
            <span className="font-medium">
              Providers
              {locked ? (
                <span className={muted}>
                  {unlocked
                    ? " · keys included, unlocked"
                    : " · keys included, locked"}
                </span>
              ) : null}
            </span>
            {locked ? (
              <span className={`${muted} max-w-prose`}>
                {unlocked
                  ? "Unlocked on this Mac — the keys go into this Mac's keychain like any key you type in."
                  : `This profile was saved with ${lockedWhat || "its keys"}, locked with a phrase. Unlock them here, or load without them.`}
              </span>
            ) : providers.some((p) => p.status !== "ready") ? (
              <span className={`${muted} max-w-prose`}>
                Ones this Mac doesn&apos;t have are added with their settings,
                without their keys. You add each key after loading.
              </span>
            ) : null}
            {pickable.length ? (
              <span className={`${muted} max-w-prose`}>
                Untick any you don&apos;t want on this Mac — it isn&apos;t
                added, and its key isn&apos;t used.
              </span>
            ) : null}
            {locked && !unlocked ? (
              <div className="flex flex-col gap-2" data-testid="load-unlock">
                <div className="flex flex-row items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <InputText
                      label="Phrase to unlock the keys"
                      type="password"
                      value={phrase}
                      autoComplete="off"
                      spellCheck={false}
                      ariaLabel="Phrase to unlock the keys"
                      onChange={(v) => {
                        setPhrase(v);
                        setUnlockError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") unlock();
                      }}
                    />
                  </div>
                  <Button2
                    title={unlocking ? "Unlocking…" : "Unlock"}
                    size="sm"
                    disabled={!phrase || unlocking}
                    onClick={unlock}
                  />
                </div>
                {unlockError ? (
                  <AlertBanner
                    variant="error"
                    size="compact"
                    message={unlockError}
                  />
                ) : null}
                <span className={`text-xs ${muted}`}>
                  Or load without them, and add each key after.
                </span>
              </div>
            ) : null}
            {pickable.length ? (
              <Checkbox
                label="Select all"
                checked={pickable.every(ticked)}
                onChange={(on) => setAll(on)}
              />
            ) : null}
            {providers.map((p) => (
              <div key={p.name} className="flex flex-col gap-1">
                {isPlainReady(p) ? (
                  <span>
                    {p.waiting
                      ? `${p.name} · on this Mac, still needs its key`
                      : `${p.name} · ready on this Mac`}
                  </span>
                ) : (
                  <Checkbox
                    label={pickLine(p)}
                    checked={ticked(p)}
                    onChange={(on) => setTicked(p, on)}
                  />
                )}
                {p.status === "map" && ticked(p) ? (
                  <span className={`text-xs ${muted} pl-6`}>
                    {p.options.length === 1
                      ? `This Mac also has "${p.options[0]}" — untick to use that one instead.`
                      : "This Mac has others of its kind — untick to use one of them instead."}
                  </span>
                ) : null}
                {p.status === "map" && !ticked(p) ? (
                  <div className="pl-6">
                    <SelectInput
                      label="Its widgets use instead"
                      value={providerMap[p.name] || p.options[0]}
                      onChange={(v) =>
                        setProviderMap({ ...providerMap, [p.name]: v })
                      }
                      options={p.options.map((o) => ({ value: o, label: o }))}
                    />
                  </div>
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
              {unlocked && unlocked.counts?.widgetSecrets
                ? "The unlocked keys fill these in. Any that aren't, you add in the widget's settings after loading:"
                : "Keys and passwords typed into widgets aren't in the profile. Add them in each widget's settings after loading:"}
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
    </LoadDialog>
  );
};
