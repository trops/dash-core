import React, { useCallback, useEffect, useState } from "react";
import {
  AlertBanner,
  Button2,
  Button3,
  ConfirmationModal,
  FontAwesomeIcon,
  ListRow,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { useRegistryAuthGate } from "../../../hooks/useRegistryAuthGate";
import { savedWhenText } from "./SaveProfileModal";

/** One account profile's line under its name. */
export function accountRowMeta(p) {
  const where = savedWhenText(p);
  return [
    where ? `Saved ${where}` : null,
    p.linkedTo ? `On this computer: ${p.linkedTo.name}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * "Load from my account…" (dash-profiles step 2): the profiles kept in the
 * user's account. Picking one fetches it and hands the preview to the
 * Profiles screen, which shows the same Load dialog as a file. A profile
 * can also be removed from the account here (profiles on this computer
 * stay).
 *
 * Mounted only while open (it opens inside the Settings modal).
 */
export const AccountProfilesModal = ({ appId, onClose, onPreview }) => {
  const { muted, strong } = useConfigTokens();
  const { ensureAuthed, authGate, isAuthGateOpen } = useRegistryAuthGate();
  const [list, setList] = useState(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Removing the selected profile asks first (inline — a second dialog
  // would open beneath this one).
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setList(null);
    setError(null);
    Promise.resolve(window.mainApi?.profiles?.listAccount?.(appId))
      .then((res) => {
        if (!alive) return;
        if (res && res.success) {
          setSignInRequired(false);
          setList(res.profiles || []);
        } else if (res && res.signInRequired) {
          setSignInRequired(true);
          setList([]);
        } else {
          setError(res?.error || "Couldn't read your account.");
          setList([]);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message || "Couldn't read your account.");
        setList([]);
      });
    return () => {
      alive = false;
    };
  }, [appId, reload]);

  const signIn = useCallback(async () => {
    const ok = await ensureAuthed({
      message: "Sign in to the registry to load a profile from your account.",
    });
    if (ok) setReload((n) => n + 1);
  }, [ensureAuthed]);

  const selected = (list || []).find((p) => p.id === selectedId) || null;

  async function load() {
    if (busy || !selected) return;
    setBusy(true);
    setError(null);
    let res;
    try {
      res = await window.mainApi?.profiles?.previewLoadFromAccount?.(
        appId,
        selected.id,
      );
    } catch (e) {
      res = { success: false, error: e?.message };
    } finally {
      setBusy(false);
    }
    if (res && res.success) {
      onPreview(res);
      return;
    }
    if (res && res.signInRequired) setSignInRequired(true);
    setError(res?.error || "Couldn't load that profile.");
  }

  async function remove() {
    if (busy || !selected) return;
    setBusy(true);
    setError(null);
    let res;
    try {
      res = await window.mainApi?.profiles?.deleteFromAccount?.(
        appId,
        selected.id,
      );
    } catch (e) {
      res = { success: false, error: e?.message };
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
    if (res && res.success) {
      setSelectedId(null);
      setReload((n) => n + 1);
      return;
    }
    setError(res?.error || "Couldn't remove that profile.");
  }

  const close = () => {
    if (!busy) onClose();
  };
  // The dialog's button says what's missing (it can't be disabled).
  const confirmLabel = busy
    ? "Working…"
    : list === null
      ? "Checking…"
      : signInRequired
        ? "Sign in first"
        : !selected
          ? "Choose a profile"
          : "Load…";

  return (
    <>
      <ConfirmationModal
        isOpen
        setIsOpen={close}
        title="Load from your account"
        confirmLabel={confirmLabel}
        onConfirm={load}
        onCancel={close}
      >
        <div
          className={`flex flex-col gap-4 text-sm max-h-96 overflow-y-auto ${strong}`}
          data-testid="account-profiles"
        >
          <span className={`${muted} max-w-prose`}>
            Profiles you saved to your account, from any computer. Loading one
            shows what it adds or changes here first.
          </span>
          {signInRequired ? (
            <div className="flex flex-col gap-2">
              <span>Sign in to the registry to see your profiles.</span>
              <div className="self-start">
                <Button2 title="Sign in" size="sm" onClick={signIn} />
              </div>
            </div>
          ) : null}
          {list && list.length === 0 && !signInRequired && !error ? (
            <span className={muted} data-testid="account-profiles-empty">
              No profiles in your account yet. Use "Save to my account" on a
              profile to keep it there.
            </span>
          ) : null}
          {list && list.length ? (
            <nav
              aria-label="Profiles in your account"
              className="flex flex-col gap-0.5"
            >
              {list.map((p) => (
                <ListRow
                  key={p.id}
                  icon={<FontAwesomeIcon icon="user" className="h-3.5 w-3.5" />}
                  title={p.name}
                  meta={accountRowMeta(p) || null}
                  selected={p.id === selectedId}
                  onClick={() => {
                    setError(null);
                    setConfirmRemove(false);
                    setSelectedId(p.id);
                  }}
                  testId={`account-profile-${p.id}`}
                />
              ))}
            </nav>
          ) : null}
          {selected ? (
            confirmRemove ? (
              <div
                className="flex flex-col gap-2"
                data-testid="account-remove-confirm"
              >
                <span>
                  Remove "{selected.name}" from your account? Profiles on your
                  computers stay as they are.
                </span>
                <div className="flex flex-row gap-2">
                  <Button2 title="Remove" size="sm" onClick={remove} />
                  <Button3
                    title="Keep it"
                    size="sm"
                    onClick={() => setConfirmRemove(false)}
                  />
                </div>
              </div>
            ) : (
              <div className="self-start">
                <Button3
                  title="Remove from my account…"
                  size="sm"
                  onClick={() => setConfirmRemove(true)}
                  testId="account-remove"
                />
              </div>
            )
          ) : null}
          {error ? (
            <AlertBanner variant="error" size="compact" message={error} />
          ) : null}
        </div>
      </ConfirmationModal>
      {isAuthGateOpen ? authGate : null}
    </>
  );
};
