/**
 * proposals.js
 *
 * A proposed flow (flows PRD, frames 22–24): from a starter, or from the
 * Dash Lead, who answers with the flow as JSON inside <flow></flow>. Nothing
 * is made until the user says "Make this flow". This file reads a proposal,
 * says what Dash checked about it and what it will do, and turns it into a
 * flow once its bots exist.
 *
 * Pure: no Electron, no I/O.
 */
"use strict";

const { normalizeFlow, STEP_KINDS } = require("./flowModel");
const { flowWarnings } = require("./flowWarnings");

const KEY = /^[A-Za-z][A-Za-z0-9_-]{0,30}$/;

/** A proposal from the Lead's answer: the JSON in <flow>…</flow>, or null. */
function readProposal(text) {
  const m = /<flow>([\s\S]*?)<\/flow>/i.exec(String(text || ""));
  if (!m) return null;
  const body = m[1].trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let p;
  try {
    p = JSON.parse(body);
  } catch (_e) {
    return null;
  }
  return cleanProposal(p);
}

/** A proposal with only what a flow can hold, or null if it has no steps. */
function cleanProposal(p) {
  if (!p || typeof p !== "object" || !Array.isArray(p.steps)) return null;
  const keys = new Set();
  const steps = [];
  for (const [i, s] of p.steps.slice(0, 20).entries()) {
    if (!s || !STEP_KINDS.includes(s.kind)) continue;
    let key = KEY.test(String(s.key || "")) ? String(s.key) : `s${i + 1}`;
    while (keys.has(key)) key = `${key}x`;
    keys.add(key);
    const step = {
      key,
      kind: s.kind,
      name: String(s.name || "").slice(0, 80) || `Step ${i + 1}`,
      note: String(s.note || "").slice(0, 300),
    };
    if (s.botId) step.botId = String(s.botId);
    if (s.bot && typeof s.bot === "object" && !s.botId) {
      step.bot = {
        name: String(s.bot.name || step.name).slice(0, 80),
        instructions: String(s.bot.instructions || "").slice(0, 4000),
        schedules: Array.isArray(s.bot.schedules)
          ? s.bot.schedules
              .filter((x) => x && typeof x.cron === "string")
              .slice(0, 3)
              .map((x) => ({ cron: x.cron }))
          : [],
        readOnly: s.bot.readOnly === true,
        acts: s.bot.acts === true,
        ...(s.bot.commands && typeof s.bot.commands === "object"
          ? {
              commands: {
                allowed: (s.bot.commands.allowed || [])
                  .map(String)
                  .slice(0, 50),
                blocked: (s.bot.commands.blocked || [])
                  .map(String)
                  .slice(0, 50),
              },
            }
          : {}),
      };
    }
    if (Array.isArray(s.outputs)) step.outputs = s.outputs;
    if (s.kind === "check" && s.check) step.check = s.check;
    if (s.judgment === true) step.judgment = true;
    if (s.action) step.action = String(s.action).slice(0, 120);
    steps.push(step);
  }
  if (!steps.length) return null;
  const edges = (Array.isArray(p.edges) ? p.edges : [])
    .filter((e) => e && keys.has(e.from) && keys.has(e.to))
    .map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind === "fail" ? "fail" : "next",
      label: String(e.label || "").slice(0, 60),
    }));
  // No edges given: one after another, in order.
  if (!edges.some((e) => e.kind === "next")) {
    for (let i = 0; i + 1 < steps.length; i++) {
      edges.push({
        from: steps[i].key,
        to: steps[i + 1].key,
        kind: "next",
        label: "",
      });
    }
  }
  return {
    name: String(p.name || "New flow").slice(0, 80),
    brief: String(p.brief || "").slice(0, 300),
    maxRounds: p.maxRounds,
    needs:
      p.needs && typeof p.needs === "object"
        ? p.needs
        : { providers: [], folder: false },
    steps,
    edges,
  };
}

const stepIdOf = (key) =>
  `step_${
    String(key)
      .replace(/[^A-Za-z0-9]/g, "")
      .toLowerCase() || "x"
  }`;

/**
 * The flow a proposal makes, once its new bots exist.
 * @param {object} proposal
 * @param {Record<string, string>} botIdsByKey  step key → the bot it made
 */
function proposalToFlow(proposal, botIdsByKey = {}, workspaceId = null) {
  const ids = {};
  for (const s of proposal.steps) ids[s.key] = stepIdOf(s.key);
  return normalizeFlow({
    workspaceId,
    name: proposal.name,
    brief: proposal.brief,
    maxRounds: proposal.maxRounds,
    steps: proposal.steps.map((s) => ({
      id: ids[s.key],
      kind: s.kind,
      name: s.name,
      note: s.note,
      botId: s.botId || botIdsByKey[s.key] || null,
      outputs: s.outputs,
      check: s.check,
      judgment: s.judgment,
      action: s.action,
    })),
    edges: proposal.edges.map((e) => ({
      from: ids[e.from],
      to: ids[e.to],
      kind: e.kind,
      label: e.label,
    })),
  });
}

/**
 * "Dash checked this flow" (frame 23): the three things that keep it
 * honest, each ✓ or not.
 */
function dashChecked(proposal, { actsOutward = () => false } = {}) {
  const keyActs = new Map();
  for (const s of proposal.steps) {
    if (s.bot) keyActs.set(stepIdOf(s.key), !!s.bot.acts);
  }
  const flow = proposalToFlow(
    proposal,
    Object.fromEntries(
      proposal.steps.map((s) => [s.key, s.botId || `new:${s.key}`]),
    ),
  );
  const warnings = flowWarnings(flow, {
    botExists: () => true,
    actsOutward: (botId) =>
      String(botId).startsWith("new:")
        ? !!keyActs.get(stepIdOf(String(botId).slice(4)))
        : actsOutward(botId),
  });
  const has = (prefix) => warnings.some((w) => w.id.startsWith(prefix));
  const checks = proposal.steps.filter((s) => s.kind === "check");
  const readOnly = checks.every(
    (s) =>
      !s.check ||
      s.check.kind === "rules" ||
      s.check.kind === "script" ||
      s.check.kind === "tool" ||
      s.check.kind === "command",
  );
  const you = proposal.steps.some((s) => s.kind === "you");
  return [
    {
      ok: !has("unchecked:") && !has("judgment-alone:"),
      text: "Every AI step is checked by something",
    },
    { ok: readOnly, text: "Every check can only read" },
    {
      ok: you && !has("unanchored:"),
      text: you
        ? "You approve before anything goes out"
        : "Nothing waits for you",
    },
  ];
}

/**
 * "It will" (frame 23): the bots it makes, the providers it uses (and
 * whether they're connected), and the folder it works in.
 * @param {{ providers?: Array<{ name, type }> }} have
 */
function itWill(proposal, { providers = [] } = {}) {
  const make = proposal.steps.filter((s) => s.bot).map((s) => s.bot.name);
  const uses = ((proposal.needs && proposal.needs.providers) || []).map(
    (need) => {
      const any = (need.anyOf || []).map((t) => String(t).toLowerCase());
      const match = providers.find((p) => {
        const type = String(p.type || "").toLowerCase();
        const name = String(p.name || "").toLowerCase();
        return any.includes(type) || any.some((t) => name.includes(t));
      });
      return {
        label: need.label,
        connected: !!match,
        provider: match ? match.name : null,
      };
    },
  );
  return {
    makeBots: make,
    uses,
    folder: !!(proposal.needs && proposal.needs.folder),
  };
}

module.exports = {
  readProposal,
  cleanProposal,
  proposalToFlow,
  dashChecked,
  itWill,
  stepIdOf,
};
