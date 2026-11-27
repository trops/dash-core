/**
 * FailureHeader — the top of a failed job (DASH-122): "Failed at <bot>:
 * <plain reason>", one line more, and the button that fixes it, picked by
 * the kind of failure (failureView.js): that bot's settings, Check setup,
 * Turn on a package's check, Raise budget, or Run again from that step /
 * Send back to its bot with a note. A failing check's output on request.
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

/**
 * Run the job again from its failed step, in the same job. An app without
 * that yet (its handler) starts the step's bot, or the lead, as a new job.
 */
async function runAgain(job, view, note) {
  const api = botsApi();
  if (!api) return { error: "This version of Dash can't run it again." };
  if (api.rerunStep) {
    try {
      const r = await api.rerunStep(job.id, view.stepId, note);
      if (r && r.ok) {
        return { note: `${view.botName} is running again, in this job.` };
      }
      return { error: (r && r.error) || "It couldn't be run again." };
    } catch (e) {
      if (!NO_HANDLER.test(String((e && e.message) || e))) {
        return { error: (e && e.message) || "It couldn't be run again." };
      }
    }
  }
  const extra = [`Your last try failed: ${view.reason}.`, note]
    .filter(Boolean)
    .join("\n\n");
  if (view.botId === job.leadId && api.askLead) {
    await api.askLead(job.leadId, `${job.request || job.title}\n\n${extra}`);
  } else if (api.run) {
    await api.run(view.botId, `${job.title || ""}\n\n${extra}`.trim());
  } else {
    return { error: "This version of Dash can't run it again." };
  }
  return { note: `${view.botName} is starting again — it shows as a new job.` };
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
          label={`A note for ${view.botName}: it gets this with its next try.`}
          rows={2}
          value={text}
          onChange={(v) => setText(v)}
        />
      ) : null}
      <div className="flex flex-row flex-wrap items-center gap-2">
        {sending ? (
          <>
            <Button
              title={`Send back to ${view.botName}`}
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
                  title={`Run again from ${view.botName}`}
                  size="sm"
                  disabled={busy}
                  onClick={() => again()}
                />
              ) : (
                <Button2
                  title={`Run again from ${view.botName}`}
                  size="sm"
                  disabled={busy}
                  onClick={() => again()}
                />
              )
            ) : null}
            {view.rerun ? (
              <Button3
                title={`Send back to ${view.botName} with a note`}
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
