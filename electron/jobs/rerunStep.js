/**
 * rerunStep.js — what a failed step's bot is told when you run the job
 * again from that step (DASH-122): what the job is, the work it was handed
 * (the step before it's answer and handoff), why its last try failed, and
 * your note. A lead's step gets what it was asked. Pure.
 */
"use strict";

const MAX_PROMPT = 12000;
const MAX_HANDOFF = 6000;

const str = (v) => (typeof v === "string" ? v.trim() : "");

/** The done step before `step` whose work it was handed, or null. */
function handedFrom(job, step) {
  const steps = (job && job.steps) || [];
  const at = steps.findIndex((s) => s && s.id === step.id);
  const before = at === -1 ? [] : steps.slice(0, at);
  return (
    [...before]
      .reverse()
      .find((s) => s && s.status === "done" && s.botId !== step.botId) || null
  );
}

/**
 * @param {{ job: object, step: object, note?: string }} args
 * @returns {string}
 */
function rerunPrompt({ job, step, note = "" } = {}) {
  if (!job || !step) return "";
  const parts = [];
  const why = str(step.failed) || str(step.summary);
  const lead = !!job.leadId && step.botId === job.leadId;
  if (lead) {
    parts.push(str(job.request) || str(job.title));
  } else {
    parts.push(
      `You're running your step of this job again: ${str(job.title) || "a job"}.`,
    );
    const item = job.item || null;
    if (item && item.id) {
      parts.push(
        `Work item: ${item.id}${item.title ? ` · ${item.title}` : ""}${
          item.url ? ` (${item.url})` : ""
        }`,
      );
    }
    const ws = job.workspace || null;
    if (ws && ws.dir) {
      parts.push(`Workspace: ${ws.dir}${ws.branch ? ` on ${ws.branch}` : ""}`);
    }
    const from = handedFrom(job, step);
    if (from) {
      const said = str(from.summary);
      if (said)
        parts.push(`${from.botName || "A bot"} handed you this work:\n${said}`);
      if (from.handoff && typeof from.handoff === "object") {
        let json = "";
        try {
          json = JSON.stringify(from.handoff, null, 2);
        } catch (_e) {
          json = "";
        }
        if (json && json.length <= MAX_HANDOFF) {
          parts.push(`Its handoff:\n\`\`\`json\n${json}\n\`\`\``);
        }
      }
    }
  }
  if (why) parts.push(`Your last try failed: ${why}`);
  const n = str(note);
  if (n) parts.push(`A note from the user: ${n}`);
  const text = parts.filter(Boolean).join("\n\n");
  return text.length > MAX_PROMPT ? `${text.slice(0, MAX_PROMPT - 1)}…` : text;
}

module.exports = { rerunPrompt, handedFrom };
