/**
 * SelfTestSummary — the top of a team's self-test job (DASH-121): when it
 * ends done, "Self-test passed · N outward actions were skipped", what it
 * would have done (selfTestView.skippedList), and how to do it for real.
 * A failed one keeps its failure header; this lists what it skipped under
 * it. While it runs: what it has skipped so far.
 *
 *   SelfTestSummary  the job's summary
 *   SelfTestMarker   a step's small "Self-test" marker
 *   StepSkips        a step's "Skipped in this test: …" line
 */
import React from "react";
import { StatusBadge, useStatusTokens } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import {
  FOR_REAL_TEXT,
  selfTestSummary,
  skippedList,
  stepSkips,
} from "./selfTestView";

const SkipList = ({ items }) => {
  const { muted } = useConfigTokens();
  return (
    <ul className="flex flex-col gap-0.5 list-disc pl-5 text-sm">
      {items.map((s, i) => (
        <li key={i} title={s.raw} data-testid="self-test-skip">
          {s.text}
          {s.botName ? (
            <span className={`text-xs ${muted}`}>{` · ${s.botName}`}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
};

export const SelfTestSummary = ({ job }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  if (!job || !job.test) return null;
  const view = selfTestSummary(job);
  if (!view) {
    // Still going: what it has skipped so far.
    const items = skippedList(job);
    return (
      <div className="flex flex-col gap-1 text-xs" data-testid="job-self-test">
        <span className={`font-semibold ${strong}`}>
          A self-test: anything outward is skipped.
        </span>
        {items.length ? (
          <SkipList items={items} />
        ) : (
          <span className={muted}>Nothing outward yet.</span>
        )}
      </div>
    );
  }
  const tone = view.passed ? status.success : null;
  return (
    <div
      data-testid="job-self-test"
      className={`self-stretch flex flex-col gap-1.5 px-3 py-2 rounded-md border ${
        tone ? `${tone.accentBorder} ${tone.bg}` : hairline
      }`}
    >
      <span
        data-testid="job-self-test-title"
        className={`text-sm font-semibold ${tone ? tone.strongText : strong}`}
      >
        {view.title}
      </span>
      {view.items.length ? <SkipList items={view.items} /> : null}
      <span className={`text-xs ${muted}`}>{FOR_REAL_TEXT}</span>
    </div>
  );
};

export const SelfTestMarker = () => (
  <span data-testid="job-step-self-test">
    <StatusBadge state="info" label="Self-test" />
  </span>
);

export const StepSkips = ({ job, step }) => {
  const { muted } = useConfigTokens();
  const items = stepSkips(job, step);
  if (!items.length) return null;
  return (
    <span
      className={`text-xs ${muted}`}
      data-testid="job-step-skipped"
      title={items.map((s) => s.raw).join("\n")}
    >
      {`Skipped in this test: ${items.map((s) => s.text).join(" · ")}`}
    </span>
  );
};
