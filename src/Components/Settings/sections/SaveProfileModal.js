import React, { useCallback, useEffect, useState } from "react";
import {
  AlertBanner,
  Button2,
  Checkbox,
  ConfirmationModal,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { useRegistryAuthGate } from "../../../hooks/useRegistryAuthGate";

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** What the profile holds, e.g. "2 dashboards · 1 bot · 4 widgets". */
export function countsText(counts = {}) {
  return [
    plural(counts.dashboards || 0, "dashboard"),
    counts.bots ? plural(counts.bots, "bot") : null,
    counts.themes ? plural(counts.themes, "theme") : null,
    plural(counts.widgets || 0, "widget"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** When and where a profile was last saved, e.g. "on Mac Mini, Oct 27, 9:00 AM". */
export function savedWhenText({ updatedOn, updatedAt, savedAt } = {}) {
  const at = updatedAt || savedAt;
  const when = at
    ? new Date(at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return [updatedOn ? `on ${updatedOn}` : null, when]
    .filter(Boolean)
    .join(", ");
}

/** Why a save to the account was refused, in a sentence. */
export function conflictText(conflict) {
  if (conflict.missing) {
    return "This profile isn't in your account any more. Save again to add it back as a new profile.";
  }
  const where = savedWhenText(conflict);
  return `Your account has a newer copy of this profile${
    where ? `, saved ${where}` : ""
  }. Load it from your account to use it here, or replace it with this computer's.`;
}

/** The "Saved" notice for the Profiles screen. */
export function savedNoticeText(res) {
  let text;
  if (res.account) {
    text = "Saved to your account.";
  } else {
    const parts = String(res.filePath || "").split(/[\\/]/);
    const file = parts.pop();
    const folder = parts.pop();
    text = `Saved "${file}"${folder ? ` in ${folder}` : ""}.`;
  }
  const unpublished = (res.unpublished || []).length;
  if (unpublished) {
    text += ` ${plural(unpublished, "widget")} went in at the version you last published.`;
  }
  if (res.secretsLeftOut) {
    text += ` ${plural(res.secretsLeftOut, "key")} typed into widgets ${
      res.secretsLeftOut === 1 ? "isn't" : "aren't"
    } included.`;
  }
  return text;
}

/** Items left out, said once the dialog has closed. */
export function leftOutText(res) {
  const list = res.leftOut || [];
  if (!list.length) return null;
  return `Not in the profile: ${list
    .map((l) => `${l.name} — ${String(l.reason || "").replace(/\.$/, "")}`)
    .join("; ")}.`;
}

/**
 * Save a profile (dash-profiles v3): the setup — dashboards, folders,
 * themes, bots, app settings — goes in as it is, and each widget by the
 * version the registry has. Nothing is published; a widget with changes
 * that aren't published, or one the registry doesn't have, is listed with
 * a Publish button. The save itself asks where to write the file.
 *
 * Mounted only while open (it opens inside the Settings modal).
 */
export const SaveProfileModal = ({
  appId,
  profile,
  onClose,
  onSaved,
  // "file" (a .dashprofile) or "account" (kept in the registry account).
  to = "file",
  // Opened to replace the account's newer copy ("keep this computer's",
  // from the updates dialog): the revision that copy has.
  replaceRevision: replaceInitially = null,
}) => {
  const toAccount = to === "account";
  const { muted, strong, hairline } = useConfigTokens();
  const { ensureAuthed, authGate, isAuthGateOpen } = useRegistryAuthGate();
  const [options, setOptions] = useState({ bots: true, settings: true });
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // The widget being published from the review, and what was published.
  const [publishing, setPublishing] = useState(null);
  const [published, setPublished] = useState([]);
  // A widget whose files mention this computer's folders: shown, then
  // confirmed before it's published.
  const [confirm, setConfirm] = useState(null);
  const [confirmed, setConfirmed] = useState(() => new Set());
  const [reload, setReload] = useState(0);
  // The account copy was removed: the next save adds it as new.
  const [asNew, setAsNew] = useState(false);
  // The newer account revision the user may choose to replace ("keep this
  // computer's") — set when a save was refused.
  const [replaceRevision, setReplaceRevision] = useState(replaceInitially);

  useEffect(() => {
    let alive = true;
    setPlan(null);
    Promise.resolve(
      window.mainApi?.profiles?.previewSave?.(appId, profile.id, options),
    )
      .then((res) => {
        if (!alive) return;
        if (res && res.success) setPlan(res);
        else setError(res?.error || "Couldn't read this profile.");
      })
      .catch(
        (e) => alive && setError(e?.message || "Couldn't read this profile."),
      );
    return () => {
      alive = false;
    };
  }, [appId, profile.id, options, reload]);

  const signIn = useCallback(async () => {
    const ok = await ensureAuthed({
      message: "Sign in to the registry to save this profile to your account.",
    });
    if (ok) setReload((n) => n + 1);
  }, [ensureAuthed]);

  const needsSignIn = toAccount && plan && !plan.username;
  const blockers = (plan && plan.blockers) || [];
  const busy = saving || !!publishing;

  async function publish(pkg) {
    if (busy) return;
    setPublishing(pkg);
    setError(null);
    let res;
    try {
      res = await window.mainApi?.profiles?.publishWidget?.(
        appId,
        profile.id,
        pkg,
        { confirmPersonalPaths: confirmed.has(pkg) },
      );
    } catch (e) {
      res = { success: false, error: e?.message };
    } finally {
      setPublishing(null);
    }
    if (res && res.success) {
      setConfirm(null);
      setPublished([
        ...published,
        `${res.publishedAs || pkg}${res.version ? ` ${res.version}` : ""}`,
      ]);
      setReload((n) => n + 1);
      return;
    }
    if (res && res.status === "needs-confirmation") {
      setConfirm({ package: pkg, findings: res.findings || [] });
      setError(
        `${pkg}'s files mention folders on this computer — check them, then publish again.`,
      );
      return;
    }
    setError(res?.error || `Couldn't publish ${pkg}.`);
  }

  async function save() {
    if (busy || !plan || needsSignIn || blockers.length) return;
    setSaving(true);
    setError(null);
    let res;
    try {
      const api = window.mainApi?.profiles;
      res = toAccount
        ? await api?.saveToAccount?.(appId, profile.id, {
            ...options,
            asNew,
            replaceRevision,
          })
        : await api?.saveFile?.(appId, profile.id, options);
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
    if (res && res.conflict) {
      if (res.conflict.missing) setAsNew(true);
      else setReplaceRevision(res.conflict.revision);
      setError(conflictText(res.conflict));
      return;
    }
    setError(res?.error || "Couldn't save the profile.");
  }

  const widgets = (plan && plan.widgets) || [];
  const attention = widgets.filter(
    (w) => w.action === "unpublished" || w.action === "not-in-registry",
  );
  const listed = widgets.filter((w) => w.action === "listed");
  const option = (key, label) => (
    <Checkbox
      label={label}
      checked={options[key]}
      disabled={busy}
      onChange={(checked) => {
        setError(null);
        setOptions({ ...options, [key]: checked });
      }}
    />
  );
  // The dialog's button says what's missing (it can't be disabled).
  const confirmLabel = saving
    ? "Saving…"
    : publishing
      ? "Publishing…"
      : !plan
        ? "Checking…"
        : needsSignIn
          ? "Sign in first"
          : blockers.length
            ? "Fix the items above first"
            : toAccount
              ? asNew
                ? "Save as new to my account"
                : replaceRevision != null
                  ? "Replace the account's copy"
                  : "Save to my account"
              : "Save…";
  const close = () => {
    if (!busy) onClose();
  };

  return (
    <>
      <ConfirmationModal
        isOpen
        // Not closed while publishing or saving (it would go on unseen).
        setIsOpen={close}
        title={
          toAccount
            ? `Save ${profile.name} to your account`
            : `Save ${profile.name}`
        }
        confirmLabel={confirmLabel}
        onConfirm={save}
        onCancel={close}
      >
        <div
          className={`flex flex-col gap-4 text-sm max-h-96 overflow-y-auto ${strong}`}
          data-testid="save-profile"
        >
          <span className={`${muted} max-w-prose`}>
            {toAccount
              ? "Your setup — dashboards, folders, themes, bots and settings — is kept in your registry account as it is, with each widget by the version the registry has. Sign in on another computer and load it from your account to get the same setup. Nothing is published, and keys and passwords typed into widgets are left out."
              : "Your setup — dashboards, folders, themes, bots and settings — goes in the file as it is, with each widget by the version the registry has. Load the file on another computer to get the same setup. Nothing is published, and keys and passwords typed into widgets are left out."}
          </span>

          {needsSignIn ? (
            <div className="flex flex-col gap-2" data-testid="save-sign-in">
              <span>
                Sign in to the registry to keep this profile in your account.
              </span>
              <div className="self-start">
                <Button2 title="Sign in" size="sm" onClick={signIn} />
              </div>
            </div>
          ) : null}

          {plan ? (
            <span data-testid="save-profile-counts">
              {countsText(plan.counts)}
            </span>
          ) : !error ? (
            <span className={muted}>Checking what goes in…</span>
          ) : null}

          <div className="flex flex-col gap-2">
            {option("bots", "Bots")}
            {option("settings", "App settings (theme, update check)")}
          </div>

          {blockers.length ? (
            <div className="flex flex-col gap-1" data-testid="save-blockers">
              <AlertBanner
                variant="error"
                size="compact"
                message="Fix these before saving:"
              />
              {blockers.map((b) => (
                <span key={b.key}>{`${b.name}: ${b.reason}`}</span>
              ))}
            </div>
          ) : null}

          {attention.length ? (
            <div
              className={`flex flex-col gap-3 rounded-lg border p-3 ${hairline}`}
              data-testid="save-widgets"
            >
              <span className="font-medium">Widgets to check</span>
              {attention.map((w) => (
                <div key={w.package} className="flex flex-col gap-1">
                  <div className="flex flex-row flex-wrap items-center gap-2">
                    <span>{w.package}</span>
                    {w.publishable ? (
                      <Button2
                        title={
                          publishing === w.package ? "Publishing…" : "Publish"
                        }
                        size="sm"
                        onClick={() => publish(w.package)}
                      />
                    ) : null}
                  </div>
                  <span className={`${muted} max-w-prose`}>{w.note}</span>
                </div>
              ))}
            </div>
          ) : null}

          {listed.length ? (
            <span className={muted} data-testid="save-listed">
              {`In the registry: ${listed
                .map((w) => `${w.package} ${w.version}`)
                .join(", ")}.`}
            </span>
          ) : null}

          {published.length ? (
            <span data-testid="save-published">
              {`Published to your account: ${published.join(", ")}.`}
            </span>
          ) : null}

          {confirm ? (
            <div
              className="flex flex-col gap-1"
              data-testid="save-confirm-paths"
            >
              <span>{`${confirm.package}'s files mention folders on this computer:`}</span>
              {(confirm.findings || []).slice(0, 5).map((f, n) => (
                <span key={n} className={muted}>
                  {f.file || f.path}
                  {f.match ? `: ${f.match}` : ""}
                </span>
              ))}
              <Checkbox
                label="Publish anyway"
                checked={confirmed.has(confirm.package)}
                onChange={(on) => {
                  const next = new Set(confirmed);
                  if (on) next.add(confirm.package);
                  else next.delete(confirm.package);
                  setConfirmed(next);
                }}
              />
            </div>
          ) : null}

          {plan && plan.secretsLeftOut ? (
            <span className={`${muted} max-w-prose`}>
              {plan.secretsLeftOut === 1
                ? "1 key typed into a widget isn't included"
                : `${plan.secretsLeftOut} keys typed into widgets aren't included`}{" "}
              — the other computer asks for{" "}
              {plan.secretsLeftOut === 1 ? "it" : "them"}.
            </span>
          ) : null}

          {!error && replaceRevision != null ? (
            <AlertBanner
              variant="warning"
              size="compact"
              message="Your account has a newer copy of this profile. Saving replaces it with this computer's."
            />
          ) : null}
          {error ? (
            <AlertBanner variant="error" size="compact" message={error} />
          ) : null}
        </div>
      </ConfirmationModal>
      {/* Mounted only while open: a nested dialog opens beneath its Modal. */}
      {isAuthGateOpen ? authGate : null}
    </>
  );
};
