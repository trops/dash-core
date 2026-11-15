import React from "react";
import { AlertBanner, Button3 } from "@trops/dash-react";
import { JOB_ROWS } from "./sections/aiSettingsText";
import { familyName, latestOf, resolveModel } from "./modelChoices";

/** "A", "A and B", "A, B and C". */
function listWords(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What follows a family now: the jobs whose default is "Latest <family>",
 * and the bots on it (their own, or the Bots default). Widgets come from
 * the saved-model scan when given (`widgetCount`).
 */
export function followersOf(family, { ai, bots = [], widgetCount = null }) {
  const alias = latestOf(family);
  const defaults = (ai && ai.defaults) || {};
  const jobs = JOB_ROWS.filter(
    ({ job }) => defaults[job] && defaults[job].model === alias,
  ).map((r) => r.name);
  const botsDefault = defaults.bots && defaults.bots.model === alias;
  const botCount = bots.filter((b) =>
    b.model ? b.model === alias : botsDefault,
  ).length;
  const widgets = typeof widgetCount === "function" ? widgetCount(alias) : 0;
  const out = [...jobs];
  if (botCount) out.push(`${botCount} ${botCount === 1 ? "bot" : "bots"}`);
  if (widgets) out.push(`${widgets} ${widgets === 1 ? "widget" : "widgets"}`);
  return out;
}

/** The notice's title and text for the models that just came out. */
export function newModelText(models, added, context) {
  const fresh = (added || [])
    .map((id) => resolveModel(models, id))
    .filter(Boolean);
  if (!fresh.length) return null;
  const title = `${listWords(fresh.map((m) => m.label || m.value))} ${
    fresh.length === 1 ? "is" : "are"
  } out`;
  const families = [...new Set(fresh.map((m) => m.family).filter(Boolean))];
  const latest = listWords(families.map((f) => `Latest ${familyName(f)}`));
  const following = families.flatMap((f) => followersOf(f, context));
  const lines = [
    `${fresh.length === 1 ? "It's" : "They're"} in every model list now.`,
  ];
  if (latest) {
    lines.push(`Anything set to ${latest} moves to it on its next run.`);
  }
  if (families.length) {
    lines.push(
      following.length
        ? `Moving to it: ${listWords(following)}.`
        : `None of your defaults, bots or widgets use ${listWords(
            families.map(familyName),
          )}, so nothing changed.`,
    );
  }
  return { title, message: lines.join(" ") };
}

/**
 * NewModelNotice — Settings › AI, once a new model comes out: it's in every
 * list, and what (if anything) moves to it. Dismiss once seen.
 */
export function NewModelNotice({
  models,
  added,
  ai,
  bots,
  widgetCount = null,
  onDismiss,
}) {
  const text = newModelText(models, added, { ai, bots, widgetCount });
  if (!text) return null;
  return (
    <div data-testid="ai-new-model">
      <AlertBanner variant="info" title={text.title} message={text.message}>
        <div className="flex flex-row pt-2">
          <Button3 title="Dismiss" size="sm" onClick={onDismiss} />
        </div>
      </AlertBanner>
    </div>
  );
}

export default NewModelNotice;
