/**
 * JobChecksWindow — a bot's checks window opened over whatever opened it
 * (a job's step, the team page, the conversation; DASH-124 screen 4b).
 * Close, Cancel and Save all leave you where you were. Only its checks
 * change here; an edit applies from the bot's next run, so a step already
 * waiting keeps waiting on you.
 */
import React, { useEffect, useState } from "react";
import { BotChecksModal } from "../Bots/BotChecksModal";

const botsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

/** "Changes apply from Planner's next run." */
export const nextRunNote = (botName) =>
  `Changes apply from ${botName || "the bot"}'s next run.`;

export const JobChecksWindow = ({ botId, onClose }) => {
  const [bot, setBot] = useState(null);
  const [members, setMembers] = useState([]);
  useEffect(() => {
    let alive = true;
    const api = botsApi();
    if (!api || !botId) return undefined;
    (async () => {
      try {
        const found = api.get ? await api.get(botId) : null;
        if (!alive || !found) return;
        // Its team: who can review ("A bot reviews" lists bots on it).
        const all = api.list ? await api.list() : [];
        if (!alive) return;
        setMembers(
          (Array.isArray(all) ? all : []).filter(
            (b) =>
              b &&
              b.role !== "lead" &&
              String(b.workspaceId) === String(found.workspaceId),
          ),
        );
        setBot(found);
      } catch (_e) {
        if (alive) onClose();
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);
  if (!bot) return null;
  return (
    <BotChecksModal
      bot={bot}
      members={members}
      handsOn={false}
      footerNote={nextRunNote(bot.name)}
      onSave={async ({ checks }) => {
        const api = botsApi();
        if (!api || !api.save) throw new Error("bot not found");
        await api.save({ id: bot.id, checks });
        onClose();
      }}
      onClose={onClose}
    />
  );
};

export default JobChecksWindow;
