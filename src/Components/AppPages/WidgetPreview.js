import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  Button3,
  FontAwesomeIcon,
  SelectInput,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { getWidgetPreviewRenderer } from "../../utils/widgetPreviewRenderer";
import { resolveProviderName } from "../../utils/providerResolution";
import { getUserConfigurableProviders } from "../../utils/providerUtils";
import { normalizeUserConfig } from "../../utils/userConfigFields";
import { providerLabel } from "../Create/planChecklist";

/**
 * The providers a preview runs with: for each type the widget needs, the one
 * chosen in the preview, else the user's default for that type (the rule
 * dashboards use), else the only provider of that type.
 * @returns {{
 *   needs: Array<{ type, providerClass, required, options: string[], selected }>,
 *   selected: { [type]: name },
 *   missing: null|{ type, providerClass },   a required type with no provider
 *   unchosen: null|{ type },                 a required type to pick
 * }}
 */
export function previewProviders(widget, appProviders, chosen = {}) {
  const needs = [];
  const selected = {};
  let missing = null;
  let unchosen = null;
  for (const p of getUserConfigurableProviders(widget && widget.providers)) {
    if (!p || !p.type || needs.some((n) => n.type === p.type)) continue;
    const options = Object.entries(appProviders || {})
      .filter(
        ([, data]) =>
          data &&
          data.type === p.type &&
          // Only providers of the class the widget declares (credentials
          // vs MCP vs WebSocket); undeclared means any.
          (!p.providerClass ||
            (data.providerClass || "credential") === p.providerClass),
      )
      .map(([n]) => n)
      .sort((x, y) => x.localeCompare(y));
    const byDefault = resolveProviderName({
      providerType: p.type,
      appProviders,
    });
    const pick =
      (chosen[p.type] && options.includes(chosen[p.type]) && chosen[p.type]) ||
      (options.includes(byDefault) ? byDefault : null) ||
      (options.length === 1 ? options[0] : null);
    const required = p.required !== false;
    needs.push({
      type: p.type,
      providerClass: p.providerClass || null,
      required,
      options,
      selected: pick,
    });
    if (pick) selected[p.type] = pick;
    else if (required && !options.length && !missing) {
      missing = { type: p.type, providerClass: p.providerClass || null };
    } else if (required && options.length && !unchosen) {
      unchosen = { type: p.type };
    }
  }
  return { needs, selected, missing, unchosen };
}

/** A widget's userConfig defaults, as props. */
export function defaultProps(config) {
  const out = {};
  for (const [key, field] of Object.entries(
    normalizeUserConfig(config && config.userConfig),
  )) {
    if (field && field.defaultValue !== undefined)
      out[key] = field.defaultValue;
  }
  return out;
}

/**
 * The component to mount from the bundle: its registered name's last
 * segment ("trops.algolia.AlgoliaAnalyticsWidget" → "AlgoliaAnalyticsWidget").
 * Package-level entries are named by the package ("@trops/gmail"), so use
 * their first registered component instead.
 */
export function componentToMount(widget) {
  const names = (widget && widget.componentNames) || [];
  const registered =
    names.find((n) => n && !String(n).startsWith("@")) ||
    (widget && widget.name) ||
    "";
  return String(registered).split("/").pop().split(".").pop();
}

/**
 * Whether the preview would start a server: a chosen provider that's an
 * MCP server (declared so, or set up so). Such a preview waits for a click
 * (consolidation Phase 4b); the rest start by themselves.
 */
export function startsServer(needs, appProviders) {
  return (needs || []).some(
    (n) =>
      n.selected &&
      (n.providerClass === "mcp" ||
        ((appProviders || {})[n.selected] || {}).providerClass === "mcp"),
  );
}

/**
 * WidgetPreview — the selected widget rendered live (app-navigation PRD
 * NAV-011), inside the host's sandbox (getWidgetPreviewRenderer — the Widget
 * Builder's iframe in dash-electron), so a broken widget can't affect the
 * app. It runs as soon as it can (consolidation Phase 4b), except when it
 * would start a server (an MCP provider): that one runs on Start preview,
 * since it launches the server and calls the real service. Stop stays
 * stopped until Reload.
 */
export const WidgetPreview = ({
  widget,
  appProviders = {},
  getWidgetConfig = null,
  onSetUpProvider = null,
}) => {
  const { muted, hairline } = useConfigTokens();
  // idle | loading | running | failed
  const [state, setState] = useState("idle");
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState(null);
  const [runId, setRunId] = useState(0);
  // Providers picked in the preview (by type) — preview only.
  const [chosen, setChosen] = useState({});

  const Renderer = getWidgetPreviewRenderer();
  const { needs, selected, missing, unchosen } = previewProviders(
    widget,
    appProviders,
    chosen,
  );
  const names = Object.values(selected).join(", ");
  const usesText = names ? `Uses ${names}.` : "";

  // Each run (and Stop) takes a new token; a load that finishes after a
  // newer one started is dropped (Reload, StrictMode's double effect).
  const runToken = useRef(0);
  const run = async () => {
    const token = ++runToken.current;
    setState("loading");
    setError(null);
    setRunId((n) => n + 1);
    try {
      const api = window.mainApi && window.mainApi.widgets;
      const result =
        api && api.readBundle
          ? await api.readBundle(widget.packageId || widget.name)
          : { success: false, error: "not available" };
      if (token !== runToken.current) return;
      if (!result || !result.success || !result.source) {
        setError(
          `Couldn't load this widget's code: ${
            (result && result.error) || "no bundle"
          }`,
        );
        setState("failed");
        return;
      }
      setBundle(result.source);
      setState("running");
    } catch (err) {
      if (token !== runToken.current) return;
      setError(
        `Couldn't load this widget's code: ${(err && err.message) || err}`,
      );
      setState("failed");
    }
  };

  const stop = () => {
    runToken.current += 1;
    setState("idle");
    setBundle(null);
    setError(null);
  };

  const server = startsServer(needs, appProviders);
  const canRun =
    !!Renderer &&
    !(widget && widget.source === "builtin") &&
    !missing &&
    !unchosen;
  // Runs by itself when it can and starts no server — on open, and again
  // after a provider is picked (picking stops it). Stop isn't undone: the
  // key only changes with the widget or its providers.
  const autoKey = `${widget && widget.name}|${Object.entries(selected)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
  useEffect(() => {
    if (canRun && !server) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, canRun, server]);

  // What the sandbox may use: the provider types, plus its "mcp" namespace
  // when a chosen provider is an MCP server (the sandbox's mainApi gate
  // blocks undeclared credentialed namespaces).
  const declared = Object.keys(selected);
  if (server && !declared.includes("mcp")) declared.push("mcp");
  const serverTypes = needs
    .filter(
      (n) =>
        n.selected &&
        (n.providerClass === "mcp" ||
          ((appProviders || {})[n.selected] || {}).providerClass === "mcp"),
    )
    .map((n) => providerLabel(n.type))
    .join(" and ");

  let body;
  if (widget && widget.source === "builtin") {
    body = (
      <span className={`text-sm ${muted}`}>
        Preview isn't available for built-in widgets.
      </span>
    );
  } else if (!Renderer) {
    body = (
      <span className={`text-sm ${muted}`}>
        Live preview isn't available in this app.
      </span>
    );
  } else if (missing) {
    body = (
      <div className="flex flex-row flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-amber-400">
          {`Needs a ${missing.type} provider to show live data.`}
        </span>
        {onSetUpProvider ? (
          <Button3
            title="Set up"
            size="xs"
            onClick={() => onSetUpProvider(missing.type, missing.providerClass)}
          />
        ) : null}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {needs.some((n) => n.options.length) ? (
          <div className="flex flex-row flex-wrap gap-3">
            {needs
              .filter((n) => n.options.length)
              .map((n) => (
                <div key={n.type} className="w-64">
                  <SelectInput
                    label={`${n.type} provider`}
                    value={n.selected || ""}
                    placeholder="Choose a provider"
                    options={n.options.map((o) => ({ label: o, value: o }))}
                    onChange={(value) => {
                      // The same one again changes nothing.
                      if (value === n.selected) return;
                      setChosen((prev) => ({ ...prev, [n.type]: value }));
                      // A running preview restarts on the new provider.
                      stop();
                    }}
                  />
                </div>
              ))}
          </div>
        ) : null}
        {unchosen ? (
          <span className="text-sm text-amber-400">
            {`Choose a ${unchosen.type} provider to run the preview.`}
          </span>
        ) : null}
        <div className="flex flex-row flex-wrap items-center justify-between gap-3">
          <span className={`text-xs ${muted}`} data-testid="preview-status">
            {state === "idle" && server && !unchosen
              ? `This preview starts your ${serverTypes} server and calls the real service. ${usesText}`.trim()
              : state === "running" && names
                ? `Running with ${names}.`
                : usesText}
          </span>
          <span className="flex flex-row gap-2">
            {state === "idle" ? (
              unchosen ? null : server ? (
                <Button title="Start preview" size="sm" onClick={run} />
              ) : (
                <Button3 title="Reload" size="xs" onClick={run} />
              )
            ) : (
              <>
                <Button3
                  title={state === "failed" ? "Try again" : "Reload"}
                  size="xs"
                  onClick={run}
                />
                <Button3 title="Stop" size="xs" onClick={stop} />
              </>
            )}
          </span>
        </div>
        {state === "loading" ? (
          <span className={`text-sm ${muted}`}>Starting preview…</span>
        ) : null}
        {error ? (
          <span className="flex flex-row items-center gap-2 text-sm text-red-400">
            <FontAwesomeIcon icon="circle-exclamation" />
            {error}
          </span>
        ) : null}
        {state === "running" && bundle ? (
          <div
            data-testid="widget-preview-frame"
            className={`rounded-lg border overflow-hidden ${hairline}`}
            // A fixed height (no h-80 in the prebuilt CSS); widgets fill it.
            style={{ height: 360 }}
          >
            <Renderer
              key={runId}
              bundleSource={bundle}
              componentName={componentToMount(widget)}
              declaredProviders={declared}
              widgetData={{
                providers: getUserConfigurableProviders(widget.providers),
                selectedProviders: selected,
                userPrefs: null,
                uuidString: `preview-${widget.name}`,
              }}
              props={defaultProps(
                getWidgetConfig ? getWidgetConfig(widget.name) : null,
              )}
              onMounted={() => setError(null)}
              onError={(e) =>
                setError(
                  `This widget hit an error: ${(e && e.message) || "unknown"}`,
                )
              }
            />
          </div>
        ) : null}
      </div>
    );
  }

  return <div className="flex flex-col gap-2">{body}</div>;
};

export default WidgetPreview;
