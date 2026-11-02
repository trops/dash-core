import React, { useCallback, useEffect, useState } from "react";
import {
  AlertBanner,
  Button,
  Button3,
  ConfirmationModal,
  InputText,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { setOnText } from "../../Bots/mcpTaskText";

/**
 * Settings › MCP Server › Task passphrase (bot-teams TEAM-016): the word or
 * phrase an agent connected via MCP must give before a team starts a task.
 * Kept encrypted, so it can be shown; never in a reply or a log. Also: the
 * lock after 5 wrong tries ("Unlock now"), and which teams take tasks.
 *
 * @param {object[]} [workspaces]  dashboards, for the teams' names
 */

// The same count as the main process (mcpTasks.js): letters and digits.
const MIN_LETTERS = 4;
const SHORT_LETTERS = 8;
const letterCount = (text) =>
  String(text || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "").length;

const SHORT_HINT = "Short and easy to guess. Two or three words is safer.";

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

const clock = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export const TaskPassphraseSection = ({ workspaces = [] }) => {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const warnText = (statusTokens.warning && statusTokens.warning.text) || "";
  const [state, setState] = useState(null);
  // A Show / Remove / Unlock that didn't work says so.
  const [notice, setNotice] = useState(null);
  const [teamIds, setTeamIds] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [shown, setShown] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(() => {
    const api = botsApi();
    if (!api) return;
    Promise.resolve(api.getTaskPassphraseState && api.getTaskPassphraseState())
      .then((s) => setState(s || { set: false }))
      .catch(() => setState({ set: false }));
    Promise.resolve(api.listMcpTaskTeams && api.listMcpTaskTeams())
      .then((ids) => setTeamIds(Array.isArray(ids) ? ids.map(String) : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const api = botsApi();
    load();
    if (!api || !api.onMcpTasksChanged) return undefined;
    const id = api.onMcpTasksChanged(load);
    return () => {
      if (id !== null && id !== undefined && api.removeListener) {
        api.removeListener(id);
      }
    };
  }, [load]);

  // Changed or removed elsewhere (another window): the shown phrase is old.
  const setAt = state ? state.setAt || null : null;
  const isSet = !!(state && state.set);
  useEffect(() => {
    setShown(null);
  }, [setAt, isSet]);

  // The lock runs out on its own, with no change to tell us: look again then.
  const lockedUntil = state ? state.lockedUntil || null : null;
  useEffect(() => {
    if (!lockedUntil) return undefined;
    const wait = Date.parse(lockedUntil) - Date.now();
    if (!(wait > 0)) return undefined;
    const t = setTimeout(load, Math.min(wait + 500, 2147483647));
    return () => clearTimeout(t);
  }, [lockedUntil, load]);

  if (!state) return null;

  const entering = !state.set || editing;
  const count = letterCount(draft);
  const shortDraft = count >= MIN_LETTERS && count < SHORT_LETTERS;

  const save = async () => {
    const api = botsApi();
    if (!api || !api.setTaskPassphrase) return;
    setError(null);
    if (count < MIN_LETTERS) {
      setError(`Use at least ${MIN_LETTERS} letters.`);
      return;
    }
    setSaving(true);
    try {
      const r = (await api.setTaskPassphrase(draft)) || {};
      if (r.ok === false) {
        setError(r.error || "Couldn't save it. Try again.");
        return;
      }
      setDraft("");
      setEditing(false);
      setShown(null);
      load();
    } catch (err) {
      setError((err && err.message) || "Couldn't save it. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleShow = async () => {
    if (shown !== null) {
      setShown(null);
      return;
    }
    const api = botsApi();
    if (!api || !api.revealTaskPassphrase) return;
    setNotice(null);
    const phrase = await Promise.resolve(api.revealTaskPassphrase()).catch(
      () => null,
    );
    if (phrase) setShown(phrase);
    else setNotice("Couldn't show the passphrase. Try again.");
  };

  const remove = async () => {
    setConfirmRemove(false);
    const api = botsApi();
    if (!api || !api.removeTaskPassphrase) return;
    setNotice(null);
    try {
      await api.removeTaskPassphrase();
      setShown(null);
      setEditing(false);
    } catch (_e) {
      setNotice("Couldn't remove the passphrase. Try again.");
    }
    load();
  };

  const unlock = async () => {
    const api = botsApi();
    if (!api || !api.unlockMcpTasks) return;
    setNotice(null);
    try {
      await api.unlockMcpTasks();
    } catch (_e) {
      setNotice("Couldn't unlock tasks. Try again.");
    }
    load();
  };

  const teams = teamIds
    .map((id) => workspaces.find((w) => String(w.id) === id))
    .filter(Boolean);

  return (
    <section
      aria-label="Task passphrase"
      className={`flex flex-col gap-3 rounded-xl border p-5 ${hairline}`}
      data-testid="task-passphrase-section"
    >
      <h4 className={`text-xs font-semibold uppercase tracking-wider ${muted}`}>
        Task passphrase
      </h4>
      <p className={`text-sm leading-relaxed ${strong}`}>
        Agents connected via MCP need this phrase before a team starts a task.
        Use words, not numbers — it&apos;s easier to say.
      </p>

      {state.lockedUntil ? (
        <div role="alert">
          <AlertBanner
            variant="warning"
            size="compact"
            message={`5 wrong passphrases via MCP · tasks are locked until ${clock(state.lockedUntil)}`}
          >
            <span className="pt-2 block">
              <Button3 title="Unlock now" size="sm" onClick={unlock} />
            </span>
          </AlertBanner>
        </div>
      ) : null}

      {entering ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-row items-end gap-2">
            <div className="flex-1 min-w-0">
              <InputText
                label="Passphrase"
                value={draft}
                onChange={(v) => {
                  setDraft(v);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                placeholder="e.g. purple otter"
                aria-invalid={error ? true : undefined}
                autoComplete="off"
                spellCheck={false}
                ariaLabel="Passphrase"
              />
            </div>
            <Button
              title={saving ? "Saving…" : "Save"}
              disabled={saving || !draft.trim()}
              onClick={save}
            />
            {editing ? (
              <Button3
                title="Cancel"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                  setError(null);
                }}
              />
            ) : null}
          </div>
          {error ? (
            <span className="text-xs" role="alert">
              {error}
            </span>
          ) : shortDraft ? (
            <span
              className={`text-xs ${warnText || muted}`}
              data-testid="passphrase-short"
            >
              {SHORT_HINT}
            </span>
          ) : null}
          {!state.set && !error && !shortDraft ? (
            <span className={`text-xs ${muted}`} data-testid="passphrase-none">
              No passphrase yet, so teams won&apos;t take tasks via MCP.
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-row flex-wrap items-center gap-2">
            <span
              aria-label="Passphrase"
              data-testid="passphrase-value"
              className={`flex-1 min-w-0 h-10 flex items-center px-3 rounded-lg border text-sm ${hairline} ${fieldBg} ${
                shown !== null ? "" : "tracking-widest"
              }`}
            >
              {shown !== null ? shown : "• • • • • •"}
            </span>
            <Button3
              title={shown !== null ? "Hide" : "Show"}
              onClick={toggleShow}
            />
            <Button3
              title="Change"
              onClick={() => {
                setShown(null);
                setDraft("");
                setEditing(true);
              }}
            />
            <Button3 title="Remove" onClick={() => setConfirmRemove(true)} />
          </div>
          {state.short ? (
            <span className={`text-xs ${warnText || muted}`}>{SHORT_HINT}</span>
          ) : null}
          <span className={`text-xs ${muted}`}>
            {[
              setOnText(state.setAt),
              "Agents never see it, and it isn't kept in replies or logs.",
            ]
              .filter(Boolean)
              .join(". ")}
          </span>
        </div>
      )}

      {notice ? (
        <span className="text-xs" role="alert" data-testid="passphrase-notice">
          {notice}
        </span>
      ) : null}

      <div
        className={`flex flex-col gap-1 border-t pt-3 text-sm ${hairline} ${muted}`}
        data-testid="passphrase-teams"
      >
        <span>
          {teams.length
            ? "Teams that take tasks via MCP · turn it on in each team's Bots view"
            : "No team takes tasks via MCP yet · turn it on in a team's Bots view"}
        </span>
        {teams.map((w) => (
          <span key={w.id} className={`font-semibold ${strong}`}>
            {w.name || "Untitled"}
          </span>
        ))}
      </div>

      <ConfirmationModal
        isOpen={confirmRemove}
        setIsOpen={setConfirmRemove}
        title="Remove the task passphrase?"
        message="Teams won't take tasks via MCP until you set a new one."
        confirmLabel="Remove"
        cancelLabel="Keep it"
        variant="danger"
        onConfirm={remove}
        onCancel={() => setConfirmRemove(false)}
      />
    </section>
  );
};

export default TaskPassphraseSection;
