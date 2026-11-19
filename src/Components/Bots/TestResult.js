/**
 * TestResult — a test of a bot from its form (bot-test-run PRD; mockup
 * "Test a bot", frames A): while it runs (what it's doing, its answer as
 * it's written, Stop, and anything it asks before it acts), then what came
 * back — its answer and its shape, the results it would have sent — or why
 * it didn't finish.
 */
import React, { useEffect, useState } from "react";
import {
  Button,
  Button3,
  FontAwesomeIcon,
  StatusBadge,
  Tag,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { DashTeamApprovals } from "./DashTeamApprovals";
import { errorLine } from "./BotNotifications/needsYou";
import {
  answerToShow,
  itemsText,
  ranText,
  shapeRows,
  shapeTag,
  testedNote,
} from "./testResultText";

const chip = { padding: "px-1.5 py-0", textSize: "text-xs" };

/** Seconds since `from`, ticking while shown. */
function useElapsed(from, running) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return from ? Math.max(0, Math.round((now - from) / 1000)) : 0;
}

function Running({ test, botName, onStop }) {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const seconds = useElapsed(test.startedAt, true);
  const tail = String(test.text || "").slice(-600);
  return (
    <div className="flex flex-col gap-2" data-testid="bot-test-running">
      <div className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}>
        <div className="flex flex-row items-center gap-2">
          <FontAwesomeIcon icon="spinner" className="animate-spin" />
          <span className={`flex-1 text-sm font-semibold ${strong}`}>
            {`Testing ${botName || "this bot"}…`}
          </span>
          <Button3 title="Stop" size="sm" onClick={onStop} />
        </div>
        <span className={`text-xs ${muted}`}>
          {`${test.activity || "Starting"} · ${seconds}s`}
        </span>
        {tail ? (
          <pre
            className={`m-0 rounded p-2 text-xs font-mono whitespace-pre-wrap break-words ${fieldBg} ${strong}`}
          >
            {tail.length < String(test.text || "").length ? `…${tail}` : tail}
          </pre>
        ) : null}
      </div>
      {/* A tool that acts asks first, as in a real run. */}
      <DashTeamApprovals
        compact
        bots={[{ id: test.testId, name: botName || "This bot" }]}
        allowAlways={false}
        note="This is a test, but what it does is real if you allow it."
      />
      <span className={`text-xs ${muted}`}>
        Its answer shows here as it&apos;s written. Testing is never required to
        save.
      </span>
    </div>
  );
}

function ShapePanel({ shape }) {
  const { muted, strong } = useConfigTokens();
  const rows = shapeRows(shape);
  return (
    <div className="flex flex-col gap-1.5" data-testid="bot-test-shape">
      <span
        className={`text-xs font-semibold uppercase tracking-wide ${muted}`}
      >
        Its shape
      </span>
      {rows.length ? (
        rows.map((r) => (
          <span
            key={r.key}
            className={`flex flex-row flex-wrap items-center gap-1.5 text-sm ${strong} ${
              r.depth >= 2 ? "pl-8" : r.depth === 1 ? "pl-4" : ""
            }`}
          >
            <span className="font-mono">{r.name}</span>
            <Tag text={r.kind} {...chip} />
            {r.note ? (
              <span className={`text-xs ${muted}`}>{r.note}</span>
            ) : null}
          </span>
        ))
      ) : (
        <span className={`text-xs ${muted}`}>No fields.</span>
      )}
    </div>
  );
}

function Answer({ result }) {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const [raw, setRaw] = useState(false);
  const shape = result.shape || { kind: "empty" };
  const json = shape.kind === "json";
  return (
    <div
      className={`flex flex-col rounded-lg border ${hairline}`}
      data-testid="bot-test-answer"
    >
      <div
        className={`flex flex-row items-center gap-2 border-b px-3 py-2 ${hairline}`}
      >
        <span className={`text-sm font-semibold ${strong}`}>Its answer</span>
        <Tag text={shapeTag(shape)} {...chip} />
        <span className="flex-1" />
        {json ? (
          <Button3
            title={raw ? "Show as JSON" : "Show as text"}
            size="xs"
            onClick={() => setRaw((v) => !v)}
          />
        ) : null}
      </div>
      <div className="flex flex-row flex-wrap gap-3 p-3">
        {shape.kind === "empty" ? (
          <span className={`text-sm ${muted}`}>It gave no answer.</span>
        ) : (
          <pre
            className={`m-0 flex-1 min-w-64 max-h-80 overflow-auto rounded p-2 text-xs font-mono whitespace-pre-wrap break-words ${fieldBg} ${strong}`}
          >
            {answerToShow(result.answer, shape, { raw })}
          </pre>
        )}
        {json ? (
          <div className="w-64 flex-shrink-0">
            <ShapePanel shape={shape} />
          </div>
        ) : null}
      </div>
      {result.answerCut ? (
        <span className={`px-3 pb-2 text-xs ${muted}`}>
          Its answer was long: only the first 32 KB is kept.
        </span>
      ) : null}
      {shape.kind === "text" ? (
        <span className={`px-3 pb-3 text-xs ${muted}`}>
          Text has no fields to read; checks can match words, length or lines.
          Ask for JSON in its instructions if checks need its parts.
        </span>
      ) : null}
    </div>
  );
}

function Results({ result }) {
  const { muted, strong, hairline, fieldBg } = useConfigTokens();
  const [open, setOpen] = useState(null);
  const shapes = result.resultsShape || [];
  if (!shapes.length) return null;
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
      data-testid="bot-test-results"
    >
      <div className="flex flex-row flex-wrap items-baseline gap-2">
        <span className={`text-sm font-semibold ${strong}`}>
          Results it would have sent
        </span>
        <span className={`text-xs ${muted}`}>
          to widgets showing {shapes.map((r) => `"${r.label}"`).join(", ")}
        </span>
      </div>
      {shapes.map((r) => {
        const sent = (result.results || []).find((x) => x.name === r.name);
        return (
          <div key={r.name} className="flex flex-col gap-1.5">
            <div
              className={`flex flex-row flex-wrap items-center gap-1.5 text-sm ${strong}`}
            >
              <span className="font-mono">{r.name}</span>
              <span className={muted}>
                {`· ${itemsText(r.count)}${r.fields.length ? " · each has" : ""}`}
              </span>
              {r.fields.map((f) => (
                <Tag key={f} text={f} {...chip} />
              ))}
              <span className="flex-1" />
              {r.count ? (
                <Button3
                  title={open === r.name ? "Hide items" : "Show items"}
                  size="xs"
                  onClick={() => setOpen((v) => (v === r.name ? null : r.name))}
                />
              ) : null}
            </div>
            {open === r.name && sent ? (
              <pre
                className={`m-0 max-h-60 overflow-auto rounded p-2 text-xs font-mono whitespace-pre-wrap break-words ${fieldBg} ${strong}`}
              >
                {JSON.stringify(sent.items, null, 2)}
              </pre>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Finished({ test, botName, isCreating }) {
  const { muted, strong } = useConfigTokens();
  const result = test.result || {};
  return (
    <div className="flex flex-col gap-3" data-testid="bot-test-done">
      <div className="flex flex-row flex-wrap items-center gap-2">
        <StatusBadge state="success" compact label="Tested" />
        <span className={`text-sm font-semibold ${strong}`}>
          {`What ${botName || "it"} returned`}
        </span>
        <span className={`text-xs ${muted}`}>{ranText(result)}</span>
      </div>
      <span className={`text-xs ${muted}`}>
        {testedNote({
          name: botName,
          sampleKept: !!result.sampleKept,
          isCreating,
        })}
      </span>
      <Answer result={result} />
      <Results result={result} />
    </div>
  );
}

function NotFinished({ test, onTestAgain }) {
  const { muted, strong, hairline } = useConfigTokens();
  const stopped = test.phase === "stopped";
  const result = test.result || {};
  const took = ranText(result).split(" · ")[0];
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
      data-testid="bot-test-failed"
    >
      <div className="flex flex-row flex-wrap items-center gap-2">
        <StatusBadge
          state={stopped ? "neutral" : "error"}
          compact
          label={stopped ? "Stopped" : "Didn't finish"}
        />
        {took && result.startedAt ? (
          <span className={`text-sm ${strong}`}>{`after ${took}`}</span>
        ) : null}
      </div>
      {stopped ? (
        <span className={`text-sm ${muted}`}>
          You stopped the test before it answered.
        </span>
      ) : (
        <span className={`text-sm ${strong}`}>
          {errorLine(test.error, 400) || "The test didn't finish."}
        </span>
      )}
      <div className="flex flex-row gap-2">
        <Button title="Test again" size="sm" onClick={onTestAgain} />
      </div>
      <span className={`text-xs ${muted}`}>
        A test that doesn&apos;t finish keeps the last good sample, if there is
        one.
      </span>
    </div>
  );
}

/**
 * @param {{ test: object, botName: string, isCreating?: boolean,
 *           onStop: () => void, onTestAgain: () => void }} props
 *   `test` is useBotTest's state.
 */
export const TestResult = ({
  test,
  botName,
  isCreating = false,
  onStop,
  onTestAgain,
}) => {
  if (!test || test.phase === "idle") return null;
  return (
    <div className="flex flex-col gap-2" data-testid="bot-test">
      {test.phase === "testing" ? (
        <Running test={test} botName={botName} onStop={onStop} />
      ) : test.phase === "done" ? (
        <Finished test={test} botName={botName} isCreating={isCreating} />
      ) : (
        <NotFinished test={test} onTestAgain={onTestAgain} />
      )}
    </div>
  );
};

export default TestResult;
