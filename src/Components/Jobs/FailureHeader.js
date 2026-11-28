/**
 * FailureHeader — the top of a failed job (DASH-122): "Failed at <bot>:
 * <plain reason>", one line more, and the button that fixes it, picked by
 * the kind of failure (failureView.js): that bot's settings, Check setup,
 * Turn on a package's check, Raise budget, or Run the job again (DASH-165:
 * the whole chain from its first bot, in the same job, as its next try),
 * with a note if you like. A failing check's output on request.
 * The header is the first failure; bots that failed after it (an On
 * Failure listener, say) get a line each: "Then Reporter failed too: …".
 */
import React, { useState } from "react";
import {
  Button,
  Button2,
  Button3,
  TextArea,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { CheckOutput } from "../Goals/JobCheckRows";
import { setupView } from "../Bots/TeamJobSettings";
import { openBotSettings } from "./NeedsYouCards";
import { failureThenText, failureTitle } from "./failureView";

const botsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

const fire = (name, detail) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
};

const NO_HANDLER = /No handler registered/i;

/** The job's first bot: the one its chain starts from. */
const firstStep = (job) =>
  ((job && job.steps) || []).find((s) => s && s.botId) || null;

/**
 * Run the whole job again (DASH-165): its chain restarts from its first
 * bot, in the same job, as its next try. bots-rerun-step is the IPC
 * (rerunJob, or rerunStep in an older preload: both restart the job). An
 * app without its handler starts the first bot, or the lead, as a new job.
 */
async function runAgain(job, view, note) {
  const api = botsApi();
  if (!api) return { error: "This version of Dash can't run it again." };
  const restart = api.rerunJob
    ? () => api.rerunJob(job.id, note)
    : api.rerunStep
      ? () => api.rerunStep(job.id, view.stepId, note)
      : null;
  if (restart) {
    try {
      const r = await restart();
      if (r && r.ok) {
        const first = firstStep(job);
        return {
          note: `The job is running again from ${
            (r && r.firstBot) || (first && first.botName) || "its first bot"
          }, in this job.`,
        };
      }
      return { error: (r && r.error) || "It couldn't be run again." };
    } catch (e) {
      if (!NO_HANDLER.test(String((e && e.message) || e))) {
        return { error: (e && e.message) || "It couldn't be run again." };
      }
    }
  }
  const extra = [`The last try failed: ${view.reason}.`, note]
    .filter(Boolean)
    .join("\n\n");
  const first = firstStep(job);
  if (job.leadId && api.askLead) {
    await api.askLead(job.leadId, `${job.request || job.title}\n\n${extra}`);
  } else if (first && api.run) {
    await api.run(first.botId, `${job.title || ""}\n\n${extra}`.trim());
  } else {
    return { error: "This version of Dash can't run it again." };
  }
  return { note: "The job is starting again — it shows as a new job." };
}

export const FailureHeader = ({ job, view, onGo }) => {
  const { muted, strong } = useConfigTokens();
  const status = useStatusTokens();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [setup, setSetup] = useState(null);
  if (!view) return null;
  const tone = view.verb === "Failed" ? status.error : status.warning;
  const action = view.action || {};

  const act = async (fn) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const r = (await fn()) || {};
      if (r.error) setError(r.error);
      if (r.note) setNote(r.note);
    } catch (e) {
      setError((e && e.message) || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const checkSetup = () =>
    act(async () => {
      const api = botsApi();
      if (!api || !api.checkSetup) {
        return { error: "This version of Dash can't check a setup yet." };
      }
      const r = await api.checkSetup(job.workspaceId);
      setSetup(setupView(r || null));
      return null;
    });

  const fix = () => {
    if (action.type === "settings") {
      openBotSettings(action.botId, action.section || null);
    } else if (action.type === "check-setup") {
      checkSetup();
    } else if (action.type === "turn-on") {
      // Its checks, where the package's check is turned on.
      fire("dash:open-bots-view", {
        workspaceId: job.workspaceId,
        botId: action.botId,
        tab: "checks",
      });
    } else if (action.type === "budget") {
      fire("dash:open-bot", { botId: action.botId, tab: "spending" });
    }
  };

  const again = (withNote = "") =>
    act(async () => {
      const r = await runAgain(job, view, withNote);
      if (!r.error) {
        setSending(false);
        setText("");
      }
      return r;
    });

  return (
    <div
      data-testid="job-failure"
      className={`flex flex-col gap-2 p-3 rounded-lg border ${tone.accentBorder} ${tone.bg}`}
    >
      <span
        className={`text-sm font-semibold break-words ${tone.strongText}`}
        data-testid="job-failure-title"
      >
        {failureTitle(view)}
      </span>
      {view.detail ? (
        <span
          className={`text-sm break-words ${strong}`}
          data-testid="job-failure-detail"
        >
          {view.detail}
        </span>
      ) : null}
      {(view.then || []).map((t) => (
        <span
          key={t.stepId}
          className={`text-xs break-words ${muted}`}
          data-testid="job-failure-then"
        >
          {failureThenText(t)}
        </span>
      ))}
      {view.lines.length > 1 ? (
        <ul className={`text-xs list-disc pl-4 ${muted}`}>
          {view.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
      {sending ? (
        <TextArea
          label="A note for the team: every bot gets it with the job's next try."
          rows={2}
          value={text}
          onChange={(v) => setText(v)}
        />
      ) : null}
      <div className="flex flex-row flex-wrap items-center gap-2">
        {sending ? (
          <>
            <Button
              title="Run the job again"
              size="sm"
              disabled={busy || !text.trim()}
              onClick={() => again(text.trim())}
            />
            <Button3
              title="Cancel"
              size="sm"
              onClick={() => {
                setSending(false);
                setText("");
              }}
            />
          </>
        ) : (
          <>
            {action.type && action.type !== "rerun" ? (
              <Button
                title={action.label}
                size="sm"
                disabled={busy}
                onClick={fix}
              />
            ) : null}
            {view.rerun ? (
              action.type === "rerun" ? (
                <Button
                  title="Run the job again"
                  size="sm"
                  disabled={busy}
                  onClick={() => again()}
                />
              ) : (
                <Button2
                  title="Run the job again"
                  size="sm"
                  disabled={busy}
                  onClick={() => again()}
                />
              )
            ) : null}
            {view.rerun ? (
              <Button3
                title="Run again with a note"
                size="sm"
                disabled={busy}
                onClick={() => setSending(true)}
              />
            ) : null}
            {onGo ? (
              <Button3 title="Go to the step" size="sm" onClick={onGo} />
            ) : null}
          </>
        )}
      </div>
      {view.output ? (
        <CheckOutput
          output={view.output.output}
          exitCode={view.output.exitCode}
          label={view.output.name}
        />
      ) : null}
      {setup ? (
        <div className="flex flex-col gap-1" data-testid="job-failure-setup">
          <span className={`text-sm font-semibold ${strong}`}>
            {setup.title}
          </span>
          {setup.lines.map((l, i) => (
            <span key={i} className={`text-xs ${muted}`}>
              {`- ${l}`}
            </span>
          ))}
        </div>
      ) : null}
      {note ? <span className={`text-xs ${muted}`}>{note}</span> : null}
      {error ? (
        <span className={`text-xs ${tone.text}`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
};

export default FailureHeader;
