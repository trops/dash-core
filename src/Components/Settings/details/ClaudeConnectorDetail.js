import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertBanner,
  Button,
  Button2,
  Checkbox,
  EmptyState,
  FontAwesomeIcon,
  StatusBadge,
  SubHeading3,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { TextLink } from "../../LeadWorkspace/WidgetWizard/TextLink";
import {
  CLAUDE_CONNECTORS_URL,
  connectorDiagnosis,
  diagnosisText,
} from "./connectorDiagnosis";

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

// What was tried for each connector this session (Reconnect, claude.ai),
// so the end of the line is reached once — never a loop.
const triedBy = new Map();

const STATUS_WORDS = {
  connected: ["success", "Connected"],
  pending: ["neutral", "Connecting"],
  "needs-auth": ["warning", "Sign in on claude.ai"],
  failed: ["error", "Couldn't connect"],
  disabled: ["neutral", "Turned off"],
};

const at = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
};

/**
 * Why Dash can't use this connector, and the one thing to do (approved
 * mockup "A connector Dash can't find says why"): the cause and its fix,
 * Reconnect, the end of the line when every fix failed, what Dash checked
 * (Copy details) and every connector in that Claude account.
 */
export const ConnectorWhy = ({
  providerName,
  server,
  claude,
  signInIssue = null,
  onRebind = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const [tried, setTried] = useState(() => triedBy.get(server) || {});
  const [copied, setCopied] = useState(false);
  const note = (key) => {
    const next = {
      ...(triedBy.get(server) || {}),
      [key]: new Date().toISOString(),
    };
    triedBy.set(server, next);
    setTried(next);
  };
  const result = (claude && claude.result) || null;
  const loading = !!(claude && claude.loading);
  const d = connectorDiagnosis({
    providerName,
    server,
    result,
    signInIssue,
    tried,
  });
  // Every fix tried, still failing: stop trying (once).
  const gaveUp = useRef(false);
  useEffect(() => {
    if (d.giveUp && !gaveUp.current && claude && claude.giveUp) {
      gaveUp.current = true;
      claude.giveUp(server, true);
    }
  }, [d.giveUp, claude, server]);
  // Working again: what was tried is forgotten.
  const fine = d.badge && d.badge.state === "success";
  useEffect(() => {
    if (fine && triedBy.has(server)) {
      triedBy.delete(server);
      setTried({});
      gaveUp.current = false;
    }
  }, [fine, server]);

  const reconnect = () => {
    note("reconnectedAt");
    if (claude && claude.reconnect) claude.reconnect(server);
  };
  const openClaude = () => {
    note("openedClaudeAt");
    if (window.mainApi && window.mainApi.shell) {
      window.mainApi.shell.openExternal(CLAUDE_CONNECTORS_URL);
    }
  };
  const act = (a) => {
    if (!a) return;
    if (a.kind === "reconnect") reconnect();
    else if (a.kind === "claude-ai") openClaude();
    else if (a.kind === "rebind" && onRebind) onRebind(a.arg);
    else if (a.kind === "use-cli" && claude && claude.useCli)
      claude.useCli(a.arg);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        diagnosisText({ providerName, server, result, diagnosis: d }),
      );
      setCopied(true);
    } catch (_e) {
      setCopied(false);
    }
  };
  const tone = (t) => statusTokens[t] || {};
  const tick = (ok) => (
    <FontAwesomeIcon
      icon={ok === true ? "check" : ok === false ? "xmark" : "exclamation"}
      className={`h-3 w-3 mt-1 flex-shrink-0 ${
        tone(ok === true ? "success" : ok === false ? "error" : "warning")
          .icon || ""
      }`}
    />
  );
  const google = /google|gmail|calendar|drive/i.test(
    `${providerName} ${server}`,
  );

  return (
    <div className="flex flex-col gap-4" data-testid="connector-why">
      {d.cause ? (
        <div
          className={`flex flex-col gap-1 rounded-xl border px-4 py-3 ${tone("warning").bg || ""} ${tone("warning").border || ""}`}
          data-testid="connector-cause"
        >
          <span className={`text-sm font-semibold ${strong}`}>
            {d.cause.title}
          </span>
          <span className={`text-sm ${muted}`}>{d.cause.text}</span>
          <div className="flex flex-row flex-wrap gap-2 pt-2">
            <Button
              title={
                loading && d.cause.action.kind === "reconnect"
                  ? "Reconnecting…"
                  : d.cause.action.label
              }
              size="sm"
              disabled={loading}
              onClick={() => act(d.cause.action)}
            />
            {d.cause.action.kind !== "reconnect" ? (
              <Button2
                title={loading ? "Reconnecting…" : "Reconnect"}
                size="sm"
                disabled={loading}
                onClick={reconnect}
              />
            ) : null}
          </div>
          <span className={`text-xs ${muted}`}>
            Reconnect starts a fresh link to your Claude account and waits for
            every connector — the last answer isn&apos;t reused.
          </span>
        </div>
      ) : null}

      {d.stuck ? (
        <div
          className={`flex flex-col gap-2 rounded-xl border px-4 py-3 ${tone("error").bg || ""} ${tone("error").border || ""}`}
          data-testid="connector-stuck"
        >
          <span className={`text-sm font-semibold ${strong}`}>
            {providerName} still can&apos;t connect — Dash has stopped trying
          </span>
          <span className={`text-sm ${muted}`}>
            Every fix Dash and Claude have was tried, and it still fails. That
            usually means the service or Claude is having trouble right now —
            not something on this computer. Bots that use {providerName} leave
            it out and say so in their answer.
            {d.stuck.retryAt
              ? ` Dash tries once more by itself at ${at(d.stuck.retryAt)}.`
              : ""}
          </span>
          <div className={`flex flex-col rounded-lg border ${hairline}`}>
            {d.stuck.tried.map((t, i) => (
              <div
                key={i}
                className={`flex flex-row items-start gap-3 px-3 py-2 text-sm ${i ? `border-t ${hairline}` : ""}`}
              >
                {tick(t.ok)}
                <span className={`flex-1 ${strong}`}>{t.what}</span>
                <span className={`text-xs ${muted}`}>{at(t.at)}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-row flex-wrap items-center gap-2">
            <Button2
              title={loading ? "Trying…" : "Try once more now"}
              size="sm"
              disabled={loading}
              onClick={() => {
                triedBy.delete(server);
                setTried({});
                gaveUp.current = false;
                if (claude && claude.giveUp) claude.giveUp(server, false);
              }}
            />
            {google ? (
              <TextLink
                title="Google Workspace status"
                onClick={() =>
                  window.mainApi &&
                  window.mainApi.shell &&
                  window.mainApi.shell.openExternal(
                    "https://www.google.com/appsstatus/dashboard/",
                  )
                }
              />
            ) : null}
            <TextLink
              title="Claude status"
              onClick={() =>
                window.mainApi &&
                window.mainApi.shell &&
                window.mainApi.shell.openExternal("https://status.claude.com")
              }
            />
          </div>
        </div>
      ) : null}

      {d.facts.length ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-row items-center gap-2">
            <span
              className={`flex-1 text-xs font-semibold uppercase tracking-wider ${muted}`}
            >
              What Dash checked
              {result && result.checkedAt ? ` · ${at(result.checkedAt)}` : ""}
            </span>
            <TextLink
              title={copied ? "Copied" : "Copy details"}
              onClick={copy}
            />
          </div>
          <div
            className={`dr-chat-card flex flex-col rounded-xl border ${hairline}`}
          >
            {d.facts.map((f, i) => (
              <div
                key={f.label}
                className={`flex flex-row items-start gap-3 px-4 py-2 ${i ? `border-t ${hairline}` : ""}`}
                data-testid="connector-fact"
              >
                {tick(f.ok)}
                <span className={`w-40 flex-shrink-0 text-sm ${muted}`}>
                  {f.label}
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className={`text-sm ${strong}`}>{f.value}</span>
                  {f.sub ? (
                    <span className={`text-xs break-all ${muted}`}>
                      {f.sub}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {d.seen.length ? (
        <section className="flex flex-col gap-2">
          <span
            className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
          >
            Connectors in that Claude account · {d.seen.length}
          </span>
          <div
            className={`dr-chat-card flex flex-col rounded-xl border ${hairline}`}
          >
            {d.seen.map((c, i) => {
              const [state, label] = STATUS_WORDS[c.status] || [
                "neutral",
                c.status,
              ];
              return (
                <div
                  key={c.server}
                  className={`flex flex-row items-center gap-3 px-4 py-2 ${i ? `border-t ${hairline}` : ""}`}
                  data-testid="connector-seen"
                >
                  <span className={`flex-1 text-sm font-semibold ${strong}`}>
                    {c.name}
                  </span>
                  {c.isPick && onRebind ? (
                    <TextLink
                      title={`This is my ${providerName}`}
                      onClick={() => onRebind(c.server)}
                    />
                  ) : null}
                  <StatusBadge state={state} label={label} />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
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
  // Why it can't be used (connector details): the account's connectors
  // (useClaudeConnectors), an open sign-in Issue, and use another of them.
  claude = null,
  signInIssue = null,
  onRebind = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const server = provider && provider.mcpConfig && provider.mcpConfig.server;
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
        {!adding && server && claude ? (
          <ConnectorWhy
            providerName={connectorLabel(providerName, provider)}
            server={server}
            claude={claude}
            signInIssue={signInIssue}
            onRebind={onRebind}
          />
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
            <div className="flex-1" />
            {claude ? (
              <Button2
                title="Reconnect on claude.ai"
                size="sm"
                onClick={() => {
                  if (window.mainApi && window.mainApi.shell) {
                    window.mainApi.shell.openExternal(CLAUDE_CONNECTORS_URL);
                  }
                }}
              />
            ) : null}
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
