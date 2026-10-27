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

const KIND_LABEL = {
  widget: "Widget",
  theme: "Theme",
  dashboard: "Dashboard",
  bot: "Bot",
  team: "Team",
};

/** What publishing does to one item, in a few words. */
export function publishText(item) {
  if (item.action === "remix") {
    return `Your remix, published privately${item.package ? ` (credits ${item.package})` : ""}`;
  }
  if (!item.package) return "New — published privately to your account";
  return `Changed — published as a new version of ${item.package}${
    item.public ? " (public)" : ""
  }`;
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

/** What was already published when a save was refused after publishing. */
export function publishedBeforeText(published) {
  const list = (published || []).map(
    (p) => `${p.name} (${p.package} ${p.version})`,
  );
  return list.length
    ? ` Already published to your account: ${list.join(", ")}.`
    : "";
}

/** The "Saved" notice for the Profiles screen. */
export function savedNoticeText(res) {
  if (res.account) {
    let text = "Saved to your account.";
    const published = (res.published || []).map(
      (p) => `${p.name} (${p.package} ${p.version})`,
    );
    if (published.length) {
      text += ` Published: ${published.join(", ")}.`;
    }
    if (res.secretsLeftOut) {
      text += ` ${plural(res.secretsLeftOut, "key")} typed into widgets ${
        res.secretsLeftOut === 1 ? "isn't" : "aren't"
      } included.`;
    }
    return text;
  }
  const parts = String(res.filePath || "").split(/[\\/]/);
  const file = parts.pop();
  const folder = parts.pop();
  const published = (res.published || []).map(
    (p) => `${p.name} (${p.package} ${p.version})`,
  );
  let text = `Saved "${file}"${folder ? ` in ${folder}` : ""}.`;
  if (published.length) {
    text += ` Published to your account: ${published.join(", ")}.`;
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
 * Save a profile (dash-profiles v2): everything it holds goes to the
 * user's registry account — what changed is published (private when new),
 * the rest is referenced as it is — and the file lists them. The dialog
 * shows the plan first; the save itself asks where to write the file.
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
}) => {
  const toAccount = to === "account";
  const { muted, strong, hairline } = useConfigTokens();
  const { ensureAuthed, authGate, isAuthGateOpen } = useRegistryAuthGate();
  const [options, setOptions] = useState({
    bots: true,
    providers: true,
    settings: true,
  });
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // The user's public items not to release now ("<kind>:<key>").
  const [skipPublic, setSkipPublic] = useState(() => new Set());
  // A widget whose files mention this computer's folders: shown, then
  // confirmed before it's published.
  const [confirm, setConfirm] = useState(null);
  const [confirmed, setConfirmed] = useState(() => new Set());
  const [reload, setReload] = useState(0);
  // The account copy was removed: the next save adds it as new.
  const [asNew, setAsNew] = useState(false);
  // The newer account revision the user may choose to replace ("keep this
  // computer's") — set when a save was refused.
  const [replaceRevision, setReplaceRevision] = useState(null);

  useEffect(() => {
    let alive = true;
    setPlan(null);
    setError(null);
    Promise.resolve(
      window.mainApi?.profiles?.previewSave?.(appId, profile.id, options),
    )
      .then((res) => {
        if (!alive) return;
        if (res && (res.success || res.signInRequired)) setPlan(res);
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

  async function save() {
    if (saving || !plan || !plan.success || plan.blockers.length) return;
    setSaving(true);
    setError(null);
    let res;
    try {
      const api = window.mainApi?.profiles;
      const chosen = {
        ...options,
        skipPublic: [...skipPublic],
        confirmPersonalPaths: [...confirmed],
      };
      res = toAccount
        ? await api?.saveToAccount?.(appId, profile.id, {
            ...chosen,
            asNew,
            replaceRevision,
          })
        : await api?.saveFile?.(appId, profile.id, chosen);
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
      setError(conflictText(res.conflict) + publishedBeforeText(res.published));
      // What was published changes the plan.
      if ((res.published || []).length) setReload((n) => n + 1);
      return;
    }
    if (res && res.needsConfirmation) {
      setConfirm(res.needsConfirmation);
      setError(res.error);
      return;
    }
    setError(res?.error || "Couldn't save the profile.");
    // Something may have been published before the failure: show the
    // current state.
    setReload((n) => n + 1);
  }

  const items = (plan && plan.items) || [];
  const toPublish = items.filter(
    (i) => i.action === "publish" || i.action === "remix",
  );
  const referenced = items.filter((i) => i.action === "reference");
  const leftOut = items.filter((i) => i.action === "leave-out");
  const blockers = (plan && plan.blockers) || [];
  const option = (key, label) => (
    <Checkbox
      label={label}
      checked={options[key]}
      disabled={saving}
      onChange={(checked) => {
        setError(null);
        setOptions({ ...options, [key]: checked });
      }}
    />
  );
  // The dialog's button says what's missing (it can't be disabled).
  const confirmLabel = saving
    ? "Publishing and saving…"
    : !plan
      ? "Checking…"
      : plan.signInRequired
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
    if (!saving) onClose();
  };
  const toggleSkip = (id, release) => {
    const next = new Set(skipPublic);
    if (release) next.delete(id);
    else next.add(id);
    setSkipPublic(next);
  };

  return (
    <>
      <ConfirmationModal
        isOpen
        // Not closed while publishing (it would go on unseen).
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
              ? "Everything in this profile goes to your registry account — private unless you already made it public — and the profile is kept there too. Sign in on another computer and load it from your account to get the same setup. Keys and passwords are never included."
              : "Everything in this profile goes to your registry account — private unless you already made it public — and the file lists it. Load the file on another computer to get the same setup. Keys and passwords are never included."}
          </span>

          {plan && plan.signInRequired ? (
            <div className="flex flex-col gap-2" data-testid="save-sign-in">
              <span>Sign in to the registry to save a profile.</span>
              <div className="self-start">
                <Button2 title="Sign in" size="sm" onClick={signIn} />
              </div>
            </div>
          ) : null}

          {plan && plan.success ? (
            <span data-testid="save-profile-counts">
              {[
                `${plural(plan.counts.publish, "item")} to publish`,
                `${plan.counts.reference} up to date`,
                plan.counts.leaveOut
                  ? `${plan.counts.leaveOut} left out`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : !plan && !error ? (
            <span className={muted}>Checking what goes in…</span>
          ) : null}

          <div className="flex flex-col gap-2">
            {option("bots", "Bots")}
            {option("providers", "Providers (without their keys)")}
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
                <span key={`${b.kind}:${b.key}`}>
                  {`${KIND_LABEL[b.kind] || b.kind} ${b.name}: ${b.reason}`}
                </span>
              ))}
            </div>
          ) : null}

          {toPublish.length ? (
            <div
              className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
              data-testid="save-publish"
            >
              <span className="font-medium">Published to your account</span>
              {toPublish.map((i) => {
                const id = `${i.kind}:${i.key}`;
                return (
                  <div key={id} className="flex flex-col gap-0.5">
                    <span>{`${KIND_LABEL[i.kind] || i.kind}: ${i.name}`}</span>
                    <span className={muted}>{publishText(i)}</span>
                    {i.public ? (
                      <Checkbox
                        label="Release this as a new public version"
                        checked={!skipPublic.has(id)}
                        disabled={saving}
                        onChange={(on) => toggleSkip(id, on)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {referenced.length ? (
            <span className={muted} data-testid="save-referenced">
              {`Up to date in the registry: ${referenced
                .map((i) => i.name)
                .join(", ")}.`}
            </span>
          ) : null}

          {leftOut.length ? (
            <div className="flex flex-col gap-1" data-testid="save-left-out">
              <span className="font-medium">Left out</span>
              {leftOut.map((i) => (
                <span key={`${i.kind}:${i.key}`} className={muted}>
                  {`${KIND_LABEL[i.kind] || i.kind} ${i.name}: ${i.reason}`}
                </span>
              ))}
            </div>
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

          {plan && plan.success && plan.secretsLeftOut ? (
            <span className={`${muted} max-w-prose`}>
              {plan.secretsLeftOut === 1
                ? "1 key typed into a widget isn't included"
                : `${plan.secretsLeftOut} keys typed into widgets aren't included`}{" "}
              — the other computer asks for{" "}
              {plan.secretsLeftOut === 1 ? "it" : "them"}.
            </span>
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
