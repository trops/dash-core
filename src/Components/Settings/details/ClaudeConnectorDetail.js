import React, { useMemo, useState } from "react";
import {
  AlertBanner,
  Button,
  Checkbox,
  EmptyState,
  FontAwesomeIcon,
  StatusBadge,
  SubHeading3,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** A connector's status in the user's Claude account, as a badge. */
export function connectorBadge(status) {
  if (status === "connected") return { state: "success", label: "Connected" };
  if (status === "needs-auth") {
    return { state: "warning", label: "Sign in on claude.ai" };
  }
  if (status === "failed") return { state: "error", label: "Couldn't connect" };
  if (status === "absent") {
    return { state: "warning", label: "Not in your Claude account" };
  }
  if (status === "pending") return { state: "neutral", label: "Connecting" };
  if (status === "disabled") {
    return { state: "neutral", label: "Turned off in Claude Code" };
  }
  return null;
}

/** "30 tools · 6 read-only" */
export function connectorToolsText(connector) {
  const tools = (connector && connector.tools) || [];
  if (!tools.length) return "No tools listed";
  const ro = tools.filter((t) => t.readOnly).length;
  return `${plural(tools.length, "tool")} · ${ro} read-only`;
}

/** What a tool does to your account: Read-only / Changes things / Deletes. */
export function toolKind(tool) {
  if (tool && tool.destructive) return { state: "error", label: "Deletes" };
  if (tool && tool.readOnly) return { state: "neutral", label: "Read-only" };
  return { state: "warning", label: "Changes things" };
}

/**
 * A new connector provider's name: the connector's own ("Gmail"), or
 * "Gmail (Claude connector)" when another provider is already called Gmail.
 */
export function connectorProviderName(connector, providers) {
  const base = (connector && connector.name) || "Claude connector";
  const taken = (n) => !!(providers && providers[n]);
  if (!taken(base)) return base;
  const marked = `${base} (Claude connector)`;
  if (!taken(marked)) return marked;
  for (let i = 2; ; i++) {
    if (!taken(`${marked} ${i}`)) return `${marked} ${i}`;
  }
}

/**
 * What a connector provider is shown as: the connector's name ("Google
 * Calendar") — the Claude connector chip beside it says what it is.
 */
export function connectorLabel(name, provider) {
  const server = provider && provider.mcpConfig && provider.mcpConfig.server;
  return server ? String(server).replace(/^claude\.ai\s+/i, "") : name;
}

/**
 * ClaudeConnectorPicker — Providers › New › Claude connector: the
 * connectors in the user's Claude account (read from their signed-in
 * Claude Code CLI), each with Add. One already added says so.
 *
 * @param {{ connectors: ReturnType<useClaudeConnectors>, providers: object,
 *   onAdd: (connector) => void, onOpen: (providerName) => void,
 *   onBack?: () => void }} props
 */
export const ClaudeConnectorPicker = ({
  connectors,
  providers = {},
  onAdd,
  onOpen,
  onBack = null,
  error = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const { result, loading, refresh } = connectors || {};
  // Which provider already holds each connector.
  const addedAs = (server) =>
    Object.entries(providers || {}).find(
      ([, p]) =>
        p &&
        p.providerClass === "connector" &&
        p.mcpConfig &&
        p.mcpConfig.server === server,
    )?.[0] || null;

  const state = result ? result.state : null;
  const list = (result && result.connectors) || [];

  let body;
  if (!result) {
    body = (
      <span className={`text-sm ${muted}`}>
        Reading your Claude connectors…
      </span>
    );
  } else if (state === "not-installed" || state === "not-signed-in") {
    body = (
      <EmptyState
        testId="claude-connectors-signin"
        icon={<FontAwesomeIcon icon="plug" className="h-6 w-6" />}
        title={
          state === "not-installed"
            ? "Claude Code isn't installed"
            : "Claude Code isn't signed in"
        }
        description={
          state === "not-installed"
            ? "Claude connectors come from the Claude Code CLI. Install Claude Code, sign in with your Claude account, then click Check again."
            : "Claude connectors come from your Claude Code CLI. In a terminal, run claude and sign in with your Claude account, then click Check again. They don't work with an Anthropic API key."
        }
      >
        <Button
          title={loading ? "Checking…" : "Check again"}
          size="sm"
          disabled={loading}
          onClick={refresh}
        />
      </EmptyState>
    );
  } else if (state === "error") {
    body = (
      <div className="flex flex-col gap-3">
        <AlertBanner
          variant="error"
          size="compact"
          message={result.message || "Couldn't read your Claude connectors."}
        />
        <div>
          <Button
            title={loading ? "Checking…" : "Check again"}
            size="sm"
            disabled={loading}
            onClick={refresh}
          />
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex flex-row items-center gap-3">
          <StatusBadge state="success" label="Signed in to Claude Code" />
          <span className={`flex-1 text-xs ${muted}`}>
            {plural(list.length, "connector")}
          </span>
          <Button
            title={loading ? "Checking…" : "Check again"}
            size="sm"
            disabled={loading}
            onClick={refresh}
          />
        </div>
        {list.length ? (
          <div role="list" className="flex flex-col">
            {list.map((c) => {
              const added = addedAs(c.server);
              const badge = connectorBadge(c.status);
              const usable = c.status === "connected";
              return (
                <div
                  role="listitem"
                  key={c.server}
                  data-testid="claude-connector-row"
                  className={`flex flex-row items-center gap-3 py-3 border-t ${hairline}`}
                >
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className={`text-sm font-medium ${strong}`}>
                      {c.name}
                    </span>
                    <span className={`text-xs ${muted}`}>
                      {usable
                        ? connectorToolsText(c)
                        : "Sign in to it again on claude.ai to use it"}
                    </span>
                  </span>
                  {badge ? (
                    <StatusBadge state={badge.state} label={badge.label} />
                  ) : null}
                  {added ? (
                    <Button
                      title="Open"
                      size="sm"
                      ariaLabel={`Open ${connectorLabel(added, providers[added])}`}
                      onClick={() => onOpen && onOpen(added)}
                    />
                  ) : usable ? (
                    <Button
                      title="Add"
                      size="sm"
                      ariaLabel={`Add ${c.name}`}
                      onClick={() => onAdd && onAdd(c)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <span className={`text-sm ${muted}`}>
            No connectors in your Claude account yet.
          </span>
        )}
        <span className={`text-xs ${muted}`}>
          To add a connector or sign in to one, use claude.ai › Settings ›
          Connectors, then click Check again.
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      data-testid="claude-connector-picker"
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-sm opacity-60 hover:opacity-100 transition-opacity"
          >
            <FontAwesomeIcon icon="chevron-left" className="h-3 w-3" />
            Back
          </button>
        ) : null}
        <SubHeading3 title="Claude connectors" padding={false} />
        {error ? (
          <AlertBanner variant="error" size="compact" message={error} />
        ) : null}
        <p className={`text-sm ${muted}`}>
          The connectors in the Claude account your Claude Code CLI is signed in
          to. Add one and your bots can use it, through your Claude
          subscription. Dash never sees your Claude or Google sign-in.
        </p>
        {body}
      </div>
    </div>
  );
};

/**
 * ClaudeConnectorDetail — a Claude connector provider: its status in the
 * Claude account and which of its tools bots may use (the provider's
 * limit; each bot picks within it).
 *
 * Adding one (`adding`): the same page before anything is saved — its
 * tools (read-only ones ticked), Back and Add provider.
 *
 * @param {{ providerName, provider, connector: object|null, status: string|null,
 *   onSave: (allowedTools: string[]) => Promise|void,
 *   onDelete: (name) => void, adding?: boolean,
 *   onBack?: () => void, error?: string|null }} props
 */
export const ClaudeConnectorDetail = ({
  providerName,
  provider,
  connector,
  status,
  onSave,
  onDelete,
  adding = false,
  onBack = null,
  error = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const tools = useMemo(
    () => (connector && connector.tools) || [],
    [connector],
  );
  const saved = adding
    ? tools.filter((t) => t.readOnly).map((t) => t.name)
    : Array.isArray(provider && provider.allowedTools)
      ? provider.allowedTools
      : tools.map((t) => t.name);
  const [picked, setPicked] = useState(() => new Set(saved));
  const [saving, setSaving] = useState(false);
  const changed =
    picked.size !== saved.length || saved.some((n) => !picked.has(n));
  const badge = connectorBadge(status);

  const toggle = (name, on) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      // In the account's order.
      const allowed = tools.map((t) => t.name).filter((n) => picked.has(n));
      await onSave(allowed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      data-testid="claude-connector-detail"
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-sm opacity-60 hover:opacity-100 transition-opacity"
          >
            <FontAwesomeIcon icon="chevron-left" className="h-3 w-3" />
            Back
          </button>
        ) : null}
        <div className="flex flex-row items-center gap-3 flex-wrap">
          <SubHeading3
            title={
              adding
                ? `Add ${connector ? connector.name : providerName}`
                : connectorLabel(providerName, provider)
            }
            padding={false}
          />
          <StatusBadge state="info" label="Claude connector" />
          {badge ? (
            <StatusBadge state={badge.state} label={badge.label} />
          ) : null}
        </div>
        <AlertBanner
          variant="info"
          size="compact"
          message="From your Claude account. Bots can use it when they run on your Claude subscription. Widgets can't use it yet, and bots on an API key can't either."
        />
        {error ? (
          <AlertBanner variant="error" size="compact" message={error} />
        ) : null}
        {tools.length ? (
          <section className="flex flex-col gap-2">
            <div className="flex flex-row items-center gap-2">
              <span className={`flex-1 text-sm font-semibold ${strong}`}>
                Tools bots may use
              </span>
              <span className={`text-xs ${muted}`}>
                {picked.size} of {tools.length} on
              </span>
              <Button
                title="Read-only only"
                size="sm"
                onClick={() =>
                  setPicked(
                    new Set(tools.filter((t) => t.readOnly).map((t) => t.name)),
                  )
                }
              />
              <Button
                title="Select all"
                size="sm"
                onClick={() => setPicked(new Set(tools.map((t) => t.name)))}
              />
            </div>
            <p className={`text-sm ${muted}`}>
              Each bot picks from these. Tools that change things still ask you
              first, unless the bot is set to run without asking.
            </p>
            <div role="list" className="flex flex-col">
              {tools.map((t) => {
                const kind = toolKind(t);
                return (
                  <div
                    role="listitem"
                    key={t.name}
                    className={`flex flex-row items-center gap-3 py-2 border-t ${hairline}`}
                  >
                    <Checkbox
                      label={t.name}
                      checked={picked.has(t.name)}
                      onChange={(on) => toggle(t.name, on)}
                    />
                    <span
                      className={`flex-1 min-w-0 text-xs truncate ${muted}`}
                    >
                      {t.description}
                    </span>
                    <StatusBadge state={kind.state} label={kind.label} />
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <span className={`text-sm ${muted}`}>
            {status === "connected" || !status
              ? "Its tools show here once Dash has read your Claude connectors."
              : "Its tools show here once it's connected in your Claude account."}
          </span>
        )}
      </div>
      <div
        className={`flex flex-row justify-end gap-2 p-4 border-t ${hairline}`}
      >
        {adding ? (
          <>
            {onBack ? <Button title="Back" size="sm" onClick={onBack} /> : null}
            <Button
              title={saving ? "Adding…" : "Add provider"}
              size="sm"
              disabled={!picked.size || saving}
              onClick={save}
            />
          </>
        ) : (
          <>
            <Button
              title="Remove from Dash"
              size="sm"
              onClick={() => onDelete && onDelete(providerName)}
            />
            <Button
              title={saving ? "Saving…" : "Save"}
              size="sm"
              disabled={!changed || saving || !tools.length}
              onClick={save}
            />
          </>
        )}
      </div>
    </div>
  );
};
