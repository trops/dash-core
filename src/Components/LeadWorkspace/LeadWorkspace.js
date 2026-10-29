import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Button3,
  ButtonIcon3,
  ChatComposer,
  FontAwesomeIcon,
  ListRow,
  Modal,
  ResizeHandle,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useResizableWidth,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { useAllBots } from "../AppPages/useAllBots";
import { useTeamLeads } from "../AiAssistant/components/RecipientPicker";
import { AskStep } from "../Create/AskStep";
import { BotChat } from "../Bots/BotChat";
import { BotAvatar } from "../Bots/BotAvatar";
import { questionThreads } from "../Create/recentRows";
import {
  contactGroups,
  contactThreads,
  findContact,
} from "./workspaceContacts";
import { WorkspaceSide } from "./WorkspaceSide";

const EMPTY = [];
const TICK_MS = 60000;
const SIDE_MIN = 320;
const SIDE_MAX = 900;

function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

/** Recent's entries, live (questions are the conversations). */
function useRecentEntries() {
  const [entries, setEntries] = useState(EMPTY);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const b = botsApi();
    if (!b || !b.listCreateRecent) return undefined;
    let alive = true;
    const load = () =>
      Promise.resolve(b.listCreateRecent())
        .then((l) => {
          if (!alive) return;
          setEntries(Array.isArray(l) ? l : EMPTY);
          setNow(Date.now());
        })
        .catch(() => {});
    load();
    const id = b.onCreateRecent ? b.onCreateRecent(load) : null;
    return () => {
      alive = false;
      if (id != null && b.removeListener) b.removeListener(id);
    };
  }, []);
  return { entries, now };
}

/** The start of a conversation: who this is, and a few things to ask. */
function startText(contact) {
  if (!contact) return { title: "", text: "", starters: [] };
  if (contact.kind === "dashlead") {
    return {
      title: "Ask the Dash team",
      text: "The Dash Lead passes your question to the Planner, Scout, Builder or Checker and sums up the answer — about your dashboards and bots, or what something new would take.",
      starters: [
        "What did my bots do today?",
        "Do I already have a weather widget?",
        "What would a smart home dashboard need?",
      ],
    };
  }
  const first = contact.members[0];
  return {
    title: `Ask ${contact.name}`,
    text: contact.members.length
      ? `${contact.name} knows what this dashboard's ${contact.members.length === 1 ? "bot does" : `${contact.members.length} bots do`}, and asks ${contact.members.length === 1 ? "it" : "them"} for you.`
      : `${contact.name} is ready — this dashboard has no bots yet.`,
    starters: [
      "What did my bots do today?",
      "Is anything waiting on me?",
      ...(first ? [`Ask ${first.name} to run now`] : []),
    ],
  };
}

/**
 * LeadWorkspace — talking to a team through its lead (lead-workspace PRD,
 * release 2). A large window: on the left, who you're talking to (the Dash
 * Lead, a dashboard's lead, or a bot on no dashboard) and their
 * conversations; in the middle, the conversation (AskStep — with each
 * hand-off as a step); on the right, the team's outputs and what each bot
 * is doing (WorkspaceSide), resizable.
 *
 * A conversation always stays with the lead it was started with: switching
 * lead shows that lead's own conversations.
 *
 * @param {{ key?: string }|null} request  who to open on ("role:dashlead",
 *   "lead:<botId>", "bot:<botId>"); default the Dash Lead
 * @param {() => void} onClose
 */
export const LeadWorkspace = ({ request = null, onClose }) => {
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const all = useAllBots();
  const { leads, loaded: leadsLoaded } = useTeamLeads(true);
  const { entries, now } = useRecentEntries();

  const groups = useMemo(
    () => contactGroups({ dashTeam: all.dashTeam, leads, bots: all.bots }),
    [all.dashTeam, leads, all.bots],
  );
  const [key, setKey] = useState((request && request.key) || "role:dashlead");
  // Until the lists are in, nothing is asked: a question must never go to a
  // stand-in while the lead you picked is still loading.
  const loading = !!all.loading || !leadsLoaded;
  const picked = findContact(groups, key);
  const missing = !loading && !picked;
  const contact = loading ? null : picked;
  const [switchOpen, setSwitchOpen] = useState(false);
  // What's open in the middle: a thread ({ recentId }), a new question just
  // sent ({ question }), or nothing yet (the start).
  const [open, setOpen] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState(EMPTY);
  const [wide, setWide] = useState(false);
  const { width: sideWidth, handleProps } = useResizableWidth({
    defaultWidth: 420,
    min: SIDE_MIN,
    max: SIDE_MAX,
    edge: "left",
    storageKey: "dash:leadWorkspace:sideWidth",
  });

  const threads = useMemo(
    () => questionThreads(contactThreads(entries, contact && contact.key), now),
    [entries, now, contact],
  );

  const switchTo = (next) => {
    setSwitchOpen(false);
    if (next === key) return;
    setKey(next);
    setOpen(null);
    setSelectedId(null);
    setMessages(EMPTY);
  };
  const startNew = () => {
    setOpen(null);
    setSelectedId(null);
    setMessages(EMPTY);
  };
  const ask = (text) => {
    const q = String(text || draft).trim();
    if (!q || !contact) return;
    setDraft("");
    setOpen({ key: `new:${Date.now()}`, question: q });
  };

  const isBot = contact && contact.kind === "bot";
  const lone = isBot ? all.bots.find((b) => b.id === contact.botId) : null;
  const start = startText(contact);
  const title = isBot
    ? `Your conversation with ${contact.name}`
    : open
      ? (threads.find((t) => t.id === selectedId) || {}).title ||
        open.question ||
        "Conversation"
      : "New conversation";

  return (
    <Modal
      isOpen
      setIsOpen={(v) => {
        if (!v) onClose();
      }}
      width="w-11/12"
      height="h-5/6"
    >
      <div
        className={`relative flex flex-row h-full w-full rounded-xl overflow-hidden border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="lead-workspace"
      >
        {/* Left: who you're talking to, and their conversations */}
        <nav
          aria-label="Conversations"
          onKeyDown={(e) => {
            if (e.key === "Escape") setSwitchOpen(false);
          }}
          className={`relative w-64 flex-shrink-0 flex flex-col gap-1 border-r p-3 min-h-0 ${hairline}`}
        >
          <button
            type="button"
            onClick={() => setSwitchOpen((v) => !v)}
            aria-expanded={switchOpen}
            aria-haspopup="menu"
            className={`flex flex-row items-center gap-3 rounded-lg border p-2 text-left ${hairline} ${selectedBg}`}
            data-testid="workspace-switcher"
          >
            {contact ? (
              <BotAvatar
                bot={{ id: contact.botId, name: contact.name }}
                icon={contact.kind === "dashlead" ? "people-group" : undefined}
              />
            ) : null}
            <span className="flex-1 min-w-0 flex flex-col">
              <span className={`text-sm font-semibold truncate ${strong}`}>
                {contact ? contact.name : "No one to talk to yet"}
              </span>
              <span className={`text-xs truncate ${muted}`}>
                {contact ? contact.sub : ""}
              </span>
            </span>
            <FontAwesomeIcon
              icon="chevron-down"
              className={`h-3 w-3 ${muted}`}
            />
          </button>
          {switchOpen ? (
            <div
              role="menu"
              className={`absolute left-3 right-3 z-30 flex flex-col gap-1 rounded-lg border p-2 shadow-lg ${hairline} ${panel.backgroundColor || ""}`}
              // Below the switcher, never over it.
              style={{ top: 76 }}
              data-testid="workspace-switcher-menu"
            >
              {groups.map((g) => (
                <div key={g.label} className="flex flex-col gap-0.5">
                  <span className={`px-2 pt-1 text-xs ${muted}`}>
                    {g.label}
                  </span>
                  {g.items.map((c) => (
                    <ListRow
                      key={c.key}
                      testId="workspace-switcher-item"
                      title={c.name}
                      meta={c.sub}
                      selected={c.key === (contact && contact.key)}
                      onClick={() => switchTo(c.key)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {isBot ? null : (
            <>
              <div className="mt-2">
                <Button3
                  size="sm"
                  title="+ New conversation"
                  onClick={startNew}
                />
              </div>
              <span className={`px-2 pt-3 pb-1 text-xs ${muted}`}>Recents</span>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                {threads.length ? (
                  threads.map((t) => (
                    <ListRow
                      key={t.id}
                      testId="workspace-thread"
                      title={t.title}
                      // Its age; "asked <this lead>" would repeat on every row.
                      meta={String(t.sub || "").split(" · ")[0]}
                      selected={t.id === selectedId}
                      onClick={() => {
                        if (open && t.id === selectedId) return;
                        setSelectedId(t.id);
                        setMessages(EMPTY);
                        setOpen({ key: t.id, recentId: t.id });
                      }}
                    />
                  ))
                ) : (
                  <span className={`px-2 py-2 text-xs ${muted}`}>
                    Your conversations with {contact ? contact.name : "them"}{" "}
                    show here.
                  </span>
                )}
              </div>
            </>
          )}
        </nav>

        {/* Middle: the conversation */}
        <section
          aria-label="Conversation"
          className="flex-1 min-w-0 flex flex-col min-h-0"
        >
          <header
            className={`flex-shrink-0 flex flex-row items-center px-6 py-3 border-b ${hairline}`}
          >
            <span className={`text-sm font-semibold truncate ${strong}`}>
              {title}
            </span>
          </header>
          {loading ? (
            <div
              className={`flex-1 flex items-center justify-center text-sm ${muted}`}
              data-testid="workspace-loading"
            >
              Loading…
            </div>
          ) : missing ? (
            <div
              className={`flex-1 flex flex-col items-center justify-center gap-2 px-6 text-sm ${muted}`}
              data-testid="workspace-missing"
            >
              <span>That lead or bot isn&apos;t available any more.</span>
              <span>Pick who to talk to at the top left.</span>
            </div>
          ) : isBot && lone ? (
            <BotChat key={lone.id} bot={lone} />
          ) : open && contact ? (
            <AskStep
              // A new lead is a new conversation (never a carried-over one).
              key={`${contact.key}:${open.key}`}
              question={open.question || ""}
              recentId={open.recentId || null}
              recipient={contact.recipient}
              hideTo
              approvalBots={[
                { id: contact.botId, name: contact.name },
                ...contact.members,
              ]}
              onStarted={setSelectedId}
              onMessagesChange={setMessages}
            />
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-center px-6">
                <div
                  className="flex flex-col gap-4 max-w-xl"
                  data-testid="workspace-start"
                >
                  <span className={`text-2xl font-semibold ${strong}`}>
                    {start.title}
                  </span>
                  <span className={`text-sm ${muted}`}>{start.text}</span>
                  <div className="flex flex-row flex-wrap gap-2">
                    {start.starters.map((s) => (
                      <Button3
                        key={s}
                        size="sm"
                        title={s}
                        onClick={() => ask(s)}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <ChatComposer
                ariaLabel={contact ? `Ask ${contact.name}` : "Ask"}
                value={draft}
                onChange={(v) => setDraft(v)}
                onSend={() => ask()}
                placeholder={contact ? `Ask ${contact.name}…` : "Ask…"}
                sendLabel="Ask"
                className="flex-shrink-0"
              />
            </>
          )}
        </section>

        {/* Right: outputs and the team, resizable */}
        <ResizeHandle {...handleProps} ariaLabel="Resize outputs" />
        <aside
          aria-label="Outputs"
          className={`flex-shrink-0 flex flex-col min-h-0 border-l ${hairline}`}
          style={{
            // Expanded, it never squeezes the conversation out.
            width: wide
              ? Math.min(
                  SIDE_MAX,
                  Math.round(
                    (typeof window !== "undefined" ? window.innerWidth : 1600) *
                      0.55,
                  ),
                )
              : sideWidth,
          }}
        >
          {/* The window's close, in its own row above the column. */}
          <div
            className={`flex-shrink-0 flex flex-row items-center justify-end px-3 py-2 border-b ${hairline}`}
          >
            <ButtonIcon3 icon="xmark" ariaLabel="Close" onClick={onClose} />
          </div>
          {contact ? (
            <WorkspaceSide
              contact={contact}
              messages={messages}
              statusOf={all.statusOf}
              wide={wide}
              onToggleWide={() => setWide((v) => !v)}
            />
          ) : null}
        </aside>
      </div>
    </Modal>
  );
};

export default LeadWorkspace;
