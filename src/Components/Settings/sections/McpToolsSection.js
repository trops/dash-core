import React, { useCallback, useEffect, useState } from "react";
import { Button3, Checkbox, Switch, Tag } from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

/**
 * Settings › MCP Server › Tools (DASH-37): every tool Dash's MCP server
 * offers, in groups, each with its own switch. A tool that's off isn't
 * offered to clients at all. Bots come first, with the bot tools' own
 * settings: the task passphrase before a bot is made or changed, and which
 * teams' bots MCP clients may see and change.
 *
 * @param {object[]} [workspaces]  dashboards (the teams to choose from)
 */

function mcpApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.mcpDashServer
    : null;
}
function botsApi() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

// A tool's description, to its first sentence.
const firstSentence = (text) => {
  const t = String(text || "");
  const i = t.indexOf(". ");
  return i < 0 ? t : t.slice(0, i + 1);
};

const countText = (list) =>
  `${list.filter((t) => t.on).length} of ${list.length} on`;

const ToolRow = ({ tool, onToggle }) => {
  const { muted, strong, hairline } = useConfigTokens();
  return (
    <div
      className={`flex flex-row items-center justify-between gap-3 py-2 border-t ${hairline}`}
      data-testid={`mcp-tool-${tool.name}`}
    >
      <div className="flex flex-col min-w-0">
        <span className={`text-sm font-medium font-mono ${strong}`}>
          {tool.name}
        </span>
        <span className={`text-xs ${muted}`}>
          {firstSentence(tool.description)}
        </span>
      </div>
      <Switch
        checked={!!tool.on}
        onChange={(on) => onToggle(tool.name, on)}
        ariaLabel={tool.name}
      />
    </div>
  );
};

const GroupHeader = ({ label, list, badge = null, children = null }) => {
  const { muted, strong } = useConfigTokens();
  return (
    <div className="flex flex-row items-center gap-2">
      <span className={`text-sm font-semibold ${strong}`}>{label}</span>
      {badge}
      <span className="flex-1" />
      <span
        className={`text-xs ${muted}`}
        data-testid={`mcp-tools-count-${label}`}
      >
        {countText(list)}
      </span>
      {children}
    </div>
  );
};

export const McpToolsSection = ({ workspaces = [] }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [tools, setTools] = useState(null);
  // Bot tools' settings: { asksPassphrase, teams: [ids] }.
  const [botSettings, setBotSettings] = useState(null);
  // They couldn't be read: said so, rather than leaving the switches out.
  const [botSettingsFailed, setBotSettingsFailed] = useState(false);
  const [open, setOpen] = useState({});
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    const api = mcpApi();
    if (api && api.listTools) {
      Promise.resolve(api.listTools())
        .then((list) => setTools(Array.isArray(list) ? list : []))
        .catch(() => setTools([]));
    }
    const bots = botsApi();
    if (bots && bots.getMcpBotSettings) {
      Promise.resolve(bots.getMcpBotSettings())
        .then((s) => {
          setBotSettings(s || null);
          setBotSettingsFailed(!s);
        })
        .catch(() => {
          setBotSettings(null);
          setBotSettingsFailed(true);
        });
    } else {
      setBotSettingsFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleTool = async (name, on) => {
    const api = mcpApi();
    if (!api || !api.setToolOn) return;
    setNotice(null);
    // Shown at once; the main process's list then settles it.
    setTools((list) =>
      (list || []).map((t) => (t.name === name ? { ...t, on } : t)),
    );
    try {
      const list = await api.setToolOn(name, on);
      if (Array.isArray(list)) setTools(list);
    } catch (_e) {
      setNotice(`Couldn't turn ${name} ${on ? "on" : "off"}. Try again.`);
      load();
    }
  };

  const changeBots = async (call) => {
    setNotice(null);
    try {
      const s = await call();
      if (s && typeof s === "object") setBotSettings(s);
      else load();
    } catch (_e) {
      setNotice("Couldn't change that. Try again.");
      load();
    }
  };

  if (!tools) return null;

  const groups = [];
  for (const t of tools) {
    let g = groups.find((x) => x.id === t.group);
    if (!g) {
      g = { id: t.group, label: t.groupLabel || t.group, tools: [] };
      groups.push(g);
    }
    g.tools.push(t);
  }
  const bots = botsApi();
  const chosen = new Set(
    ((botSettings && botSettings.teams) || []).map(String),
  );

  return (
    <section
      aria-label="Tools"
      className={`flex flex-col gap-3 rounded-xl border p-5 ${hairline}`}
      data-testid="mcp-tools-section"
    >
      <div className="flex flex-row items-center justify-between gap-3">
        <h4
          className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
        >
          Tools
        </h4>
        <span className={`text-xs ${muted}`} data-testid="mcp-tools-count">
          {countText(tools)}
        </span>
      </div>
      <p className={`text-sm leading-relaxed ${strong}`}>
        What MCP clients connected to Dash can do. A tool that&apos;s off
        isn&apos;t offered to them at all.
      </p>

      {groups.map((g) =>
        g.id === "bots" ? (
          <div
            key={g.id}
            className={`flex flex-col gap-1 border-t pt-3 ${hairline}`}
            data-testid="mcp-tools-group-bots"
          >
            <GroupHeader
              label={g.label}
              list={g.tools}
              badge={<Tag text="New · off by default" />}
            />
            <span className={`text-xs ${muted}`}>
              Let an app outside Dash see your bots, and make or change them.
            </span>
            {g.tools.map((t) => (
              <ToolRow key={t.name} tool={t} onToggle={toggleTool} />
            ))}
            {botSettings && bots ? (
              <>
                <div
                  className={`flex flex-row items-center justify-between gap-3 py-2 border-t ${hairline}`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className={`text-sm font-medium ${strong}`}>
                      Ask for the task passphrase to create or change a bot
                    </span>
                    <span className={`text-xs ${muted}`}>
                      The app shows you what it will do and asks you for your
                      task passphrase first.
                    </span>
                  </div>
                  <Switch
                    checked={!!botSettings.asksPassphrase}
                    onChange={(on) =>
                      changeBots(() => bots.setAsksBotPassphrase(on))
                    }
                    ariaLabel="Ask for the task passphrase to create or change a bot"
                  />
                </div>
                <div
                  className={`flex flex-col gap-1 py-2 border-t ${hairline}`}
                  data-testid="mcp-bot-teams"
                >
                  <span className={`text-sm font-medium ${strong}`}>
                    Which teams
                  </span>
                  <span className={`text-xs ${muted}`}>
                    Only these teams&apos; bots can be listed, made or changed.
                    Dash team bots never can.
                  </span>
                  {workspaces.length ? (
                    workspaces.map((w) => (
                      <Checkbox
                        key={w.id}
                        label={w.name || "Untitled"}
                        checked={chosen.has(String(w.id))}
                        onChange={(on) =>
                          changeBots(() => bots.setTakesMcpBots(w.id, on))
                        }
                      />
                    ))
                  ) : (
                    <span className={`text-xs ${muted}`}>
                      No dashboards yet.
                    </span>
                  )}
                </div>
              </>
            ) : botSettingsFailed ? (
              <span
                className={`text-xs py-2 ${muted}`}
                data-testid="mcp-bot-settings-failed"
              >
                Couldn&apos;t load the passphrase and team settings for bots.
                Close Settings and open it again to try again.
              </span>
            ) : null}
          </div>
        ) : (
          <div
            key={g.id}
            className={`flex flex-col gap-1 border-t pt-3 ${hairline}`}
            data-testid={`mcp-tools-group-${g.id}`}
          >
            <GroupHeader label={g.label} list={g.tools}>
              <Button3
                title={open[g.id] ? "Done" : "Choose"}
                size="sm"
                onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
              />
            </GroupHeader>
            {open[g.id]
              ? g.tools.map((t) => (
                  <ToolRow key={t.name} tool={t} onToggle={toggleTool} />
                ))
              : null}
          </div>
        ),
      )}

      {notice ? (
        <span className={`text-xs ${muted}`} role="alert">
          {notice}
        </span>
      ) : null}
    </section>
  );
};

export default McpToolsSection;
