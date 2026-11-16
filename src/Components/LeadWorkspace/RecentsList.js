import React, { useRef, useState } from "react";
import {
  ActionMenu,
  Button,
  Checkbox,
  ConfirmationModal,
  ListRow,
} from "@trops/dash-react";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The workspace's Recents, with delete (conversation cleanup, frames 3.1–3.3):
 * a row's … menu deletes it; Select ticks several (Select all) to delete at
 * once. Always confirmed: the messages and plan go for good, what they
 * built stays. One still answering or building can't be ticked — the run
 * would save it back when it finishes.
 *
 * @param {object} p
 * @param {object[]} p.threads      the contact's conversations, newest first
 * @param {(t) => string} p.metaOf  a row's second line
 * @param {string|null} p.selectedId
 * @param {(t) => boolean} p.isBusy still answering or building
 * @param {(t) => void} p.onOpen
 * @param {(ids: string[]) => Promise<{ failed: { id, error }[] }>} p.onDelete
 * @param {React.ReactNode} p.before  rows above the list (New conversation)
 * @param {React.ReactNode} p.empty   shown when there are none
 * @param {string} p.muted
 */
export function RecentsList({
  threads = [],
  metaOf = () => "",
  selectedId = null,
  isBusy = () => false,
  onOpen = () => {},
  onDelete = async () => ({ failed: [] }),
  before = null,
  empty = null,
  muted = "",
}) {
  const [selecting, setSelecting] = useState(false);
  const [ticked, setTicked] = useState(() => new Set());
  // The ids waiting for Delete to be confirmed.
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const free = threads.filter((t) => !isBusy(t));
  const busyOnes = threads.filter((t) => isBusy(t));
  const chosen = free.filter((t) => ticked.has(t.id));
  const allTicked = free.length > 0 && chosen.length === free.length;

  const stopSelecting = () => {
    setSelecting(false);
    setTicked(new Set());
  };
  const tick = (id, on) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // One delete at a time: a second click on Delete does nothing.
  const deletingRef = useRef(false);
  const runDelete = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    const ids = confirm || [];
    setDeleting(true);
    setError(null);
    try {
      const res = (await onDelete(ids)) || {};
      const failed = Array.isArray(res.failed) ? res.failed : [];
      if (failed.length) {
        setError(
          failed.length === 1
            ? failed[0].error || "It couldn't be deleted."
            : `${plural(failed.length, "conversation", "conversations")} couldn't be deleted. ${failed[0].error || ""}`.trim(),
        );
      }
      setTicked(new Set(failed.map((f) => f.id)));
      if (!failed.length) setSelecting(false);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
      setConfirm(null);
    }
  };

  const n = confirm ? confirm.length : 0;
  const closesOpen = !!(confirm && selectedId && confirm.includes(selectedId));

  return (
    <>
      <div className="flex flex-row items-center gap-2 px-2 pt-3 pb-1">
        {selecting ? (
          <Checkbox
            label="Select all"
            checked={allTicked}
            disabled={!free.length}
            onChange={(on) =>
              setTicked(on ? new Set(free.map((t) => t.id)) : new Set())
            }
            className="flex-1"
          />
        ) : (
          <span className={`flex-1 text-xs ${muted}`}>Recents</span>
        )}
        {threads.length ? (
          <button
            type="button"
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            className={`text-xs ${muted}`}
            data-testid="workspace-recents-select"
          >
            {selecting ? "Cancel" : "Select"}
          </button>
        ) : null}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {selecting ? null : before}
        {threads.length
          ? threads.map((t) =>
              selecting ? (
                <div
                  key={t.id}
                  className="flex flex-row items-center gap-2 px-2 py-1.5"
                  data-testid="workspace-thread-pick"
                >
                  <Checkbox
                    label={t.title}
                    checked={ticked.has(t.id)}
                    disabled={isBusy(t)}
                    onChange={(on) => tick(t.id, on)}
                    className="flex-1 min-w-0"
                  />
                  {isBusy(t) ? (
                    <span className={`flex-shrink-0 text-xs ${muted}`}>
                      Running
                    </span>
                  ) : null}
                </div>
              ) : (
                <ListRow
                  key={t.id}
                  testId="workspace-thread"
                  title={t.title}
                  meta={metaOf(t)}
                  selected={t.id === selectedId}
                  onClick={() => onOpen(t)}
                  trailing={
                    <ActionMenu
                      label="Conversation options"
                      // Outside the scrolling list, so its edges can't
                      // cut the menu off.
                      portal
                      items={[
                        {
                          label: "Delete conversation",
                          danger: true,
                          disabled: isBusy(t),
                          description: isBusy(t)
                            ? "Still running — stop it first"
                            : undefined,
                          onSelect: () => setConfirm([t.id]),
                        },
                      ]}
                    />
                  }
                />
              ),
            )
          : empty}
      </div>
      {selecting && busyOnes.length ? (
        <span className={`px-2 py-1 text-xs ${muted}`}>
          {busyOnes.length === 1
            ? `“${busyOnes[0].title}” is still working on an answer. Stop it first to delete it.`
            : `${plural(busyOnes.length, "conversation is", "conversations are")} still working on an answer. Stop them first to delete them.`}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className={`px-2 py-1 text-xs ${muted}`}>
          {error}
        </span>
      ) : null}
      {selecting ? (
        <div className="flex flex-row gap-2 px-2 pt-2">
          <Button
            size="sm"
            title={
              chosen.length
                ? `Delete ${plural(chosen.length, "conversation", "conversations")}`
                : "Delete"
            }
            disabled={!chosen.length || deleting}
            onClick={() => setConfirm(chosen.map((t) => t.id))}
          />
        </div>
      ) : null}
      {/* Mounted only while open: a dialog inside the workspace's Modal. */}
      {confirm ? (
        <ConfirmationModal
          isOpen
          setIsOpen={(o) => (o ? null : setConfirm(null))}
          variant="danger"
          title={
            n === 1
              ? "Delete this conversation?"
              : `Delete ${plural(n, "conversation", "conversations")}?`
          }
          message={`${
            n === 1
              ? "Its messages and plan are removed from this computer"
              : "Their messages and plans are removed from this computer"
          } and can't be brought back. Widgets and dashboards ${
            n === 1 ? "it" : "they"
          } built stay where they are.${
            closesOpen
              ? " The open one closes and you start a new conversation."
              : ""
          }`}
          confirmLabel={
            deleting ? "Deleting…" : n === 1 ? "Delete" : `Delete ${n}`
          }
          onConfirm={runDelete}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}

export default RecentsList;
