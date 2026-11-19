/**
 * BotTestOutput — a bot an Ask AI build made, tested before it's saved
 * (bot-test-run TST-003; mockup "Test a bot", frame C1). In the outputs
 * panel, like a widget's preview: what it runs on and uses, Test it with,
 * Test, what came back (TestResult), then Save the bot — only once a test
 * finished, keeping that test as its sample — or Change something, which
 * goes to the Planner.
 */
import React, { useState } from "react";
import { Button, Button3, InputText, Tag, TextArea } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useBotTest } from "../Bots/useBotTest";
import { TestResult } from "../Bots/TestResult";
import { scheduleLabel } from "../Create/planChecklist";

const chip = { padding: "px-2 py-0.5", textSize: "text-xs" };

/** "Runs every weekday at 8:00 AM", "Uses Google Calendar", "Shows Reminders". */
export function botFacts(definition) {
  const d = definition || {};
  const out = [];
  const cron = d.schedules && d.schedules[0] && d.schedules[0].cron;
  const when = cron ? scheduleLabel(cron) : "";
  if (when) out.push(`Runs ${when}`);
  else if ((d.subscriptions || []).length) out.push("Runs when triggered");
  else out.push("Runs when asked");
  const uses = d.mcpServers || [];
  if (uses.length) out.push(`Uses ${uses.join(", ")}`);
  const shows = (d.publishes || []).map((p) => p.label || p.name);
  if (shows.length) out.push(`Shows ${shows.join(", ")}`);
  return out;
}

/**
 * @param {{ step: object, pb: object, onChange?: (text: string) => void }} props
 *   step: the build's waiting testbot step ({ id, label, definition });
 *   pb: usePlanBuild (approve, actionError); onChange: a change, to the
 *   Planner (null when the plan can't change here).
 */
export const BotTestOutput = ({ step, pb, onChange = null }) => {
  const { muted, strong } = useConfigTokens();
  const botTest = useBotTest();
  const [prompt, setPrompt] = useState("");
  const [changing, setChanging] = useState(false);
  const [change, setChange] = useState("");
  const [saving, setSaving] = useState(false);
  const definition = step && step.definition;
  const name =
    (definition && definition.name) ||
    String((step && step.label) || "").replace(/^Test /, "") ||
    "This bot";
  const schedulePrompt =
    (definition &&
      definition.schedules &&
      definition.schedules[0] &&
      definition.schedules[0].prompt) ||
    "";

  if (!definition) {
    return (
      <span className={`text-sm ${muted}`}>
        {name} can&apos;t be tested here. Carry on building to try again.
      </span>
    );
  }
  // A build saved before Dash last closed can't save until it carries on:
  // a test now would be a run for nothing.
  if (pb && pb.restored) {
    return (
      <span className={`text-sm ${muted}`} data-testid="bot-test-restored">
        This build was saved before Dash last closed. Carry on building in the
        chat, then test {name} here.
      </span>
    );
  }
  const testing = botTest.phase === "testing";
  const test = () => botTest.start(definition, prompt);
  const save = async () => {
    if (!botTest.sample || saving) return;
    setSaving(true);
    try {
      await pb.approve(step.id, { sample: botTest.sample });
    } finally {
      setSaving(false);
    }
  };
  const sendChange = () => {
    const text = change.trim();
    if (!text || !onChange) return;
    onChange(`Change ${name}: ${text}`);
    setChange("");
    setChanging(false);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="bot-test-output">
      <div className="flex flex-col gap-2">
        <span className={`text-xs ${muted}`}>Bot · not saved yet</span>
        <span className={`text-lg font-semibold ${strong}`}>
          {`Test ${name}`}
        </span>
        <div className="flex flex-row flex-wrap gap-2">
          {botFacts(definition).map((f) => (
            <Tag key={f} text={f} {...chip} />
          ))}
        </div>
      </div>
      <InputText
        label="Test it with (optional)"
        value={prompt}
        onChange={setPrompt}
        placeholder={
          schedulePrompt
            ? `What it's asked on its schedule: ${schedulePrompt}`
            : "What to ask it"
        }
      />
      <TestResult
        test={botTest}
        botName={name}
        onStop={botTest.stop}
        onTestAgain={test}
      />
      {changing ? (
        <div className="flex flex-col gap-2">
          <TextArea
            label="What should change?"
            value={change}
            onChange={setChange}
            rows={3}
            placeholder="e.g. only meetings with other people"
          />
          <div className="flex flex-row gap-2">
            <Button
              title="Send to the Planner"
              size="sm"
              onClick={sendChange}
              disabled={!change.trim()}
            />
            <Button3
              title="Cancel"
              size="sm"
              onClick={() => setChanging(false)}
            />
          </div>
        </div>
      ) : null}
      {pb && pb.actionError ? (
        <span className="text-sm text-red-500">{pb.actionError}</span>
      ) : null}
      <div className="flex flex-row flex-wrap items-center justify-end gap-2">
        {!botTest.sample ? (
          <span className={`text-xs ${muted}`}>
            Test it first: Save turns on once a test finishes.
          </span>
        ) : null}
        {onChange && !changing ? (
          <Button3
            title="Change something"
            size="sm"
            onClick={() => setChanging(true)}
          />
        ) : null}
        <Button
          title={
            testing
              ? "Testing…"
              : botTest.phase === "idle"
                ? "Test"
                : "Test again"
          }
          size="sm"
          onClick={test}
          disabled={testing}
        />
        <Button
          title={saving ? "Saving…" : "Save the bot"}
          size="sm"
          onClick={save}
          disabled={!botTest.sample || testing || saving}
        />
      </div>
    </div>
  );
};

export default BotTestOutput;
