import React, { useMemo, useState } from "react";
import {
  Button3,
  SegmentedControl,
  SelectInput,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { BotAvatar } from "./BotAvatar";
import {
  HANDS_ON,
  sendToSave,
  sendsWorkTo,
  stopSendingSave,
} from "./checksView";

const botsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

const WHAT_OPTIONS = [
  { value: "answer", label: "Its whole answer" },
  { value: "summary", label: "Only the summary" },
];

/**
 * SendsWorkTo — "Sends its work to" on a bot's Settings tab (DASH-127,
 * screen 7b; was "Hands on" in the checks window). The team bots that run
 * when this bot completes, with Remove and "+ Send to another bot". It's
 * the same link as an arrow on the team Diagram (the same trigger on the
 * other bot), so each change saves right away, apart from the form's Save.
 *
 * @param {object} bot
 * @param {object[]} bots  every bot (its team is picked from them)
 * @param {() => void} [onChanged]
 */
export const SendsWorkTo = ({ bot, bots = [], onChanged = null }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const status = useStatusTokens();
  // Saved here before the list catches up: the bot as it was saved.
  const [savedBots, setSavedBots] = useState({});
  const [handsOn, setHandsOn] = useState(
    bot && bot.checks && HANDS_ON.includes(bot.checks.handsOn)
      ? bot.checks.handsOn
      : "answer",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const team = useMemo(
    () =>
      (bots || [])
        .filter(
          (b) =>
            b &&
            bot &&
            b.workspaceId !== null &&
            b.workspaceId !== undefined &&
            String(b.workspaceId) === String(bot.workspaceId),
        )
        .map((b) => (savedBots[b.id] ? { ...b, ...savedBots[b.id] } : b)),
    [bots, bot, savedBots],
  );
  if (!bot) return null;
  const { targets, choices } = sendsWorkTo(bot, team);
  const hasChecks = !!(bot.checks && (bot.checks.steps || []).length);

  const run = async (fn) => {
    const api = botsApi();
    if (!api || !api.save) return;
    setBusy(true);
    setError("");
    try {
      await fn(api);
      if (onChanged) onChanged();
    } catch (err) {
      setError(`Couldn't save that: ${(err && err.message) || String(err)}.`);
    } finally {
      setBusy(false);
    }
  };
  // The other bot as saved right now (the list can be behind).
  const latest = async (api, id) => {
    const fresh =
      api.get && (await Promise.resolve(api.get(id)).catch(() => null));
    return fresh || team.find((b) => b.id === id) || null;
  };
  const saveTarget = async (api, change) => {
    await api.save(change);
    setSavedBots((m) => ({ ...m, [change.id]: change }));
  };

  const add = (key) =>
    run(async (api) => {
      const c = choices.find((x) => x.key === key);
      const target = c ? await latest(api, c.id) : null;
      if (!target) throw new Error("that bot no longer exists");
      await saveTarget(api, sendToSave(target, bot));
    });
  const remove = (t) =>
    run(async (api) => {
      const target = await latest(api, t.id);
      if (!target) throw new Error("that bot no longer exists");
      await saveTarget(api, stopSendingSave(target, t.eventType));
    });
  const changeWhat = (next) =>
    run(async (api) => {
      await api.save({ id: bot.id, checks: { ...bot.checks, handsOn: next } });
      setHandsOn(next);
    });

  return (
    <div className="flex flex-col gap-3" data-testid="sends-work-to">
      <span className={`text-sm ${muted}`}>
        {hasChecks
          ? `When ${bot.name}'s checks pass, its work goes to these bots.`
          : `When ${bot.name} finishes, its work goes to these bots.`}
      </span>
      {targets.length ? (
        <div className="flex flex-col gap-2 max-w-lg">
          {targets.map((t) => {
            const other = team.find((b) => b.id === t.id) || { name: t.name };
            return (
              <div
                key={t.key}
                className={`flex flex-row items-center gap-3 px-3 py-2 rounded-lg border ${hairline}`}
              >
                <BotAvatar bot={other} />
                <span className={`flex-1 min-w-0 text-sm truncate ${strong}`}>
                  {t.name}
                </span>
                <Button3
                  title="Remove"
                  size="sm"
                  ariaLabel={`Stop sending to ${t.name}`}
                  disabled={busy}
                  onClick={() => remove(t)}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <span className={`text-sm ${muted}`}>
          {`Nowhere yet: ${bot.name}'s work stays with it.`}
        </span>
      )}
      {choices.length ? (
        <div className="w-64">
          <SelectInput
            ariaLabel="Send to another bot"
            placeholder="+ Send to another bot"
            value=""
            options={choices.map((c) => ({ value: c.key, label: c.name }))}
            onChange={(key) => key && !busy && add(key)}
          />
        </div>
      ) : null}
      {hasChecks ? (
        <div className="flex flex-col gap-1">
          <span className={`text-xs font-semibold ${strong}`}>
            What it sends
          </span>
          <SegmentedControl
            ariaLabel="What it sends"
            size="sm"
            value={handsOn}
            onChange={(v) => v !== handsOn && !busy && changeWhat(v)}
            options={WHAT_OPTIONS}
          />
        </div>
      ) : null}
      <span className={`text-xs ${muted}`}>
        {targets.length
          ? `The same link shows as an arrow from ${bot.name} to ${targets[0].name} on the team Diagram, and can be changed there too. Widgets are connected there.`
          : "The same links show as arrows on the team Diagram, and can be changed there too. Widgets are connected there."}
      </span>
      {error ? (
        <span className={`text-sm ${status.error.text}`} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
};

export default SendsWorkTo;
