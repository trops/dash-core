/**
 * flowWarnings.js
 *
 * How a flow could fool itself (flows PRD, frame 7). Dash looks at every
 * step for three things — what it reads and writes, what checks it, and
 * what it can't argue with — plus steps that can't run at all. Each
 * warning says what's wrong in a sentence and offers its fix.
 *
 * Pure: the caller says which bots act on the world (send, post, change).
 */
"use strict";

const { chain, nextStep, prevStep, inputStep } = require("./flowModel");

/**
 * @param {object} flow
 * @param {{ botName?: (botId) => string|null,
 *           botExists?: (botId) => boolean,
 *           actsOutward?: (botId) => boolean }} deps
 * @returns {Array<{ id, stepId, title, body, fix: { type, label, … } }>}
 */
function flowWarnings(flow, deps = {}) {
  const out = [];
  const order = chain(flow);
  const exists = deps.botExists || (() => true);
  const acts = deps.actsOutward || (() => false);
  const onChain = new Set();
  {
    // The chain as the "next" edges really run, from the first step.
    let cur = order[0];
    while (cur && !onChain.has(cur.id)) {
      onChain.add(cur.id);
      cur = nextStep(flow, cur.id);
    }
  }

  for (const step of order) {
    const after = nextStep(flow, step.id);
    const before = prevStep(flow, step.id);

    if (
      (step.kind === "bot" || step.kind === "source") &&
      (!step.botId || !exists(step.botId))
    ) {
      out.push({
        id: `no-bot:${step.id}`,
        stepId: step.id,
        title: `${step.name} has no bot`,
        body: step.botId
          ? "Its bot was deleted, so nothing does this step. Choose another bot."
          : "Nothing does this step yet. Choose the bot that does it.",
        fix: { type: "open-step", label: "Choose a bot", stepId: step.id },
      });
    }

    if (step.kind === "check" && (!step.check || !step.check.kind)) {
      out.push({
        id: `no-check:${step.id}`,
        stepId: step.id,
        title: `${step.name} isn't set up`,
        body: "It has no rules, command, script or tool call yet, so it can't pass anything.",
        fix: { type: "open-step", label: "Set it up", stepId: step.id },
      });
    }

    if (!onChain.has(step.id)) {
      out.push({
        id: `orphan:${step.id}`,
        stepId: step.id,
        title: `Nobody hands work to ${step.name}`,
        body: "It isn't on the way from the first step to the last, so it never runs.",
        fix: { type: "remove-step", label: "Remove it", stepId: step.id },
      });
      continue;
    }

    if (step.kind === "bot") {
      // Its work is taken by the next step: that must be a check or you.
      // The last step's work is final: fine when you or a check came
      // before it (a send you approved), not when nothing did.
      let checked;
      if (after) {
        checked = after.kind === "check" || after.kind === "you";
      } else {
        checked = false;
        const seen = new Set();
        for (
          let cur = before;
          cur && !seen.has(cur.id);
          cur = prevStep(flow, cur.id)
        ) {
          seen.add(cur.id);
          if (cur.kind === "you" || cur.kind === "check") {
            checked = true;
            break;
          }
        }
      }
      if (!checked && !step.judgment) {
        out.push({
          id: `unchecked:${step.id}`,
          stepId: step.id,
          title: `Nothing checks ${step.name}'s work`,
          body: after
            ? `${after.name} takes whatever ${step.name} makes. Add a check between them, or have it come to you first.`
            : `Whatever ${step.name} makes is final. Add a check after it, or have it come to you.`,
          fix: {
            type: "add-check",
            label: "Add a check",
            from: step.id,
            to: after ? after.id : null,
          },
        });
      }
      if (after && !(step.outputs && step.outputs.length)) {
        out.push({
          id: `no-fields:${step.id}`,
          stepId: step.id,
          title: `${step.name}'s record has no fields`,
          body: `The steps after it can't tell what they get, or a finished record from a half-written one. Say what ${step.name}'s record must have.`,
          fix: {
            type: "open-fields",
            label: "Add its fields",
            stepId: step.id,
          },
        });
      }
      if (step.judgment) {
        const det = before && before.kind === "check";
        if (!det) {
          out.push({
            id: `judgment-alone:${step.id}`,
            stepId: step.id,
            title: `${step.name} only judges`,
            body: "A judgment step never passes work on its own: it comes after a check that can't be argued with.",
            fix: {
              type: "add-check",
              label: "Add a check before it",
              from: before ? before.id : null,
              to: step.id,
            },
          });
        }
      }
      if (step.botId && acts(step.botId)) {
        // What it does reaches outside Dash: something before it must be
        // fact (a check) or you.
        let cur = before;
        let anchored = false;
        const seen = new Set();
        while (cur && !seen.has(cur.id)) {
          seen.add(cur.id);
          if (cur.kind === "you") {
            anchored = true;
            break;
          }
          if (cur.kind === "check" && cur === before) {
            // A check right before it makes the work safe, but nobody
            // approves what it sends.
            break;
          }
          cur = prevStep(flow, cur.id);
        }
        if (!anchored) {
          out.push({
            id: `unanchored:${step.id}`,
            stepId: step.id,
            title: `${step.name} has nothing it can't argue with`,
            body: `What it does reaches outside Dash. Ask you before it acts, so nothing goes out that you haven't seen.`,
            fix: {
              type: "add-you",
              label: "Ask me before it acts",
              from: before ? before.id : null,
              to: step.id,
            },
          });
        }
      }
    }

    if (step.kind === "check" && !inputStep(flow, step.id)) {
      out.push({
        id: `no-input:${step.id}`,
        stepId: step.id,
        title: `${step.name} has nothing to check`,
        body: "No step before it makes anything, so its input is empty.",
        fix: { type: "remove-step", label: "Remove it", stepId: step.id },
      });
    }
  }
  return out;
}

/**
 * What's right about a flow — shown with ✓ once a warning is fixed (frame
 * 14): each bot step's work is checked, and has a done status.
 */
function flowGood(flow, deps = {}) {
  const warnings = flowWarnings(flow, deps);
  const ids = new Set(warnings.map((w) => w.id));
  const good = [];
  for (const step of chain(flow)) {
    if (step.kind !== "bot") continue;
    if (!ids.has(`unchecked:${step.id}`)) {
      good.push({
        id: `checked:${step.id}`,
        text: `${step.name}'s work is checked before it goes on`,
      });
    }
  }
  return good;
}

module.exports = { flowWarnings, flowGood };
