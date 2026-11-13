import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Button,
  Button2,
  Button3,
  CodeEditorVS,
  FontAwesomeIcon,
  InputText,
  SegmentedControl,
  SelectInput,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { PanelEditForm } from "../../Context/Modal/Panel/PanelEditForm";
import { getWidgetPreviewRenderer } from "../../utils/widgetPreviewRenderer";
import { getUserConfigurableProviders } from "../../utils/providerUtils";
import { previewProviders, defaultProps } from "../AppPages/WidgetPreview";
import { lineDiff } from "./editCreate";
import { normalizeUserConfig } from "../../utils/userConfigFields";
import { MarkSpots, MAX_SPOTS } from "./MarkSpots";

/**
 * The provider each type starts on: what the plan said ({ type: name } or a
 * name), when the user has it.
 */
export function plannedProviders(planned, needs = [], appProviders = {}) {
  const out = {};
  if (!planned) return out;
  for (const n of needs) {
    const want =
      typeof planned === "string"
        ? planned
        : planned[n.type] || planned[String(n.type).toLowerCase()] || null;
    if (want && (appProviders || {})[want]) out[n.type] = want;
  }
  return out;
}

// How long a run may take to show its widget before the preview says so.
export const PREVIEW_START_TIMEOUT_MS = 10000;

/**
 * CellPreview — a cell build's widget, running, before it's installed or
 * placed (consolidation Phase 2b). The user picks its inputs — a connection
 * per provider it needs, and its settings (its own userConfig, through the
 * same form Edit uses), started from the plan — runs it, and decides:
 *   Looks good        onApprove({ providers, settings }) — install, then place
 *   Change something  onRevise(note, marks) — back to the Builder (built
 *                     ones only); Mark a spot draws numbered boxes on the
 *                     running preview, and marks = { rect, spots } (the
 *                     preview's place in the window, the boxes in it) so the
 *                     app can take a picture for the Builder
 *   Discard           onDiscard() — the cell stays empty; a built widget
 *                     is never installed (a registry one already was, to
 *                     preview it — it stays installed)
 * Runs on click, in the host's sandbox: a live preview calls real APIs.
 *
 * @param {object} made  the build's piece: { draft?, package?, component?,
 *   preview: { componentName, userConfig, providers, provider, settings } }
 *
 * A change to a widget (consolidation Phase 3) passes its own words
 * (approveLabel, discardLabel, inputsNote) and the widget as it was
 * (original: { componentCode, configCode }): the draft then gets Code (the
 * Widget Builder's code view, read-only) and What changed beside Preview.
 */
export const CellPreview = ({
  made = {},
  name = "",
  cellLabel = "",
  onApprove,
  onRevise = null,
  onDiscard = null,
  deciding = false,
  // The Checker passed it (a built widget) — said beside the preview.
  checked = false,
  approveLabel = "Looks good — put it in the cell",
  discardLabel = "Discard — leave the cell empty",
  inputsNote = "Filled in from the plan · they go into the cell with the widget.",
  original = null,
  // A widget that shows what a bot sends (TD-009): { botId, botName, ref,
  // event, handlerName } — it's previewed with the bot's last message.
  wire = null,
}) => {
  const app = useContext(AppContext) || {};
  const appProviders = app.providers || {};
  const { muted, strong, hairline } = useConfigTokens();
  const preview = made.preview || {};
  const userConfig = normalizeUserConfig(preview.userConfig);
  const widget = { providers: preview.providers || [] };

  const [chosen, setChosen] = useState(() =>
    plannedProviders(
      preview.provider,
      getUserConfigurableProviders(widget.providers),
      appProviders,
    ),
  );
  const [settings, setSettings] = useState(() => ({
    ...defaultProps({ userConfig }),
    ...(preview.settings || {}),
  }));
  // idle | loading | running | failed
  const [run, setRun] = useState("idle");
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState(null);
  const [runId, setRunId] = useState(0);
  // The run whose widget has shown (onMounted). A run that never shows
  // gets a way out instead of a blank frame (QA 2026-10-22).
  const [mountedRunId, setMountedRunId] = useState(0);
  const [change, setChange] = useState("");
  // Mark a spot: drawing boxes on the running preview, and the boxes.
  const [marking, setMarking] = useState(false);
  const [spots, setSpots] = useState([]);
  const stage = useRef(null);
  const statusTokens = useStatusTokens();
  // A change's draft (Phase 3): Preview, its Code, or What changed.
  const showsCode = !!(original && made.draft);
  const [view, setView] = useState("preview");
  const [codeFile, setCodeFile] = useState("component");
  const [draftCode, setDraftCode] = useState(null);
  useEffect(() => {
    if (!showsCode) return undefined;
    const api = window.mainApi && window.mainApi.widgetBuilder;
    if (!api || !api.previewDraft) return undefined;
    let alive = true;
    Promise.resolve(api.previewDraft(made.draft))
      .then((r) => {
        if (alive && r && r.success) {
          setDraftCode({
            componentCode: r.componentCode || "",
            configCode: r.configCode || "",
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showsCode, made.draft]);

  // The bot's last message, handed to the widget's listener in the
  // preview as it is when the dashboard opens.
  const wireEvent =
    wire && wire.ref && wire.botId && wire.event && wire.handlerName
      ? `bot:${wire.ref}[${wire.botId}].${wire.event}`
      : null;
  const [botMessage, setBotMessage] = useState({ status: "none" });
  useEffect(() => {
    if (!wireEvent) return undefined;
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots || !bots.getLatestResult) return undefined;
    let alive = true;
    setBotMessage({ status: "loading" });
    Promise.resolve(bots.getLatestResult(wireEvent))
      .then(
        (message) =>
          alive &&
          setBotMessage(
            message ? { status: "ready", message } : { status: "none" },
          ),
      )
      .catch(() => alive && setBotMessage({ status: "none" }));
    return () => {
      alive = false;
    };
  }, [wireEvent]);
  const wireData =
    wireEvent && botMessage.status === "ready"
      ? {
          uuid: `cell-preview-${preview.componentName || name}`,
          listeners: { [wire.handlerName]: [wireEvent] },
          previewEvents: { [wireEvent]: botMessage.message },
        }
      : {};

  const Renderer = getWidgetPreviewRenderer();
  const { needs, selected, missing, unchosen } = previewProviders(
    widget,
    appProviders,
    chosen,
  );

  const start = async () => {
    setRun("loading");
    setError(null);
    setRunId((n) => n + 1);
    try {
      const api = window.mainApi || {};
      let source = null;
      let why = null;
      if (made.draft) {
        const r =
          api.widgetBuilder && api.widgetBuilder.previewDraft
            ? await api.widgetBuilder.previewDraft(made.draft)
            : null;
        source = r && r.success ? r.bundleSource : null;
        why = (r && r.error) || "this version can't preview a draft";
      } else if (preview.widgetName || made.package) {
        const r =
          api.widgets && api.widgets.readBundle
            ? await api.widgets.readBundle(preview.widgetName || made.package)
            : null;
        source = r && r.success ? r.source : null;
        why = (r && r.error) || "no bundle";
      }
      if (!source) {
        setError(`Couldn't load the widget: ${why}.`);
        setRun("failed");
        return;
      }
      setBundle(source);
      setRun("running");
    } catch (err) {
      setError(`Couldn't load the widget: ${(err && err.message) || err}.`);
      setRun("failed");
    }
  };

  // What the sandbox may use (as WidgetPreview): the chosen types, plus its
  // "mcp" namespace when a chosen provider is an MCP server.
  const declared = Object.keys(selected);
  if (
    needs.some(
      (n) =>
        n.selected &&
        (n.providerClass === "mcp" ||
          (appProviders[n.selected] || {}).providerClass === "mcp"),
    ) &&
    !declared.includes("mcp")
  ) {
    declared.push("mcp");
  }
  const usesText = [
    ...Object.values(selected),
    ...Object.entries(settings)
      .filter(([, v]) => v !== "" && v != null)
      .slice(0, 3)
      .map(([k, v]) => `${(userConfig[k] || {}).displayName || k}: ${v}`),
  ].join(" · ");
  const restart = () => {
    if (run !== "idle") start();
  };

  const canRun = !!Renderer && !missing && !unchosen;
  // Opening the preview is asking to see it: it runs as soon as it can —
  // once, so a stopped preview stays stopped. Run preview is for after a
  // provider is chosen or a run is stopped.
  const connects = needs.length > 0;
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || !canRun || run !== "idle") return;
    autoRan.current = true;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRun]);
  const hasSettings = Object.keys(userConfig).length > 0;
  const looksGood = () =>
    onApprove({
      providers: Object.keys(selected).length ? selected : null,
      settings: Object.keys(settings).length ? settings : null,
    });

  const running = run === "running" && bundle && Renderer;

  useEffect(() => {
    if (!running || mountedRunId === runId) return undefined;
    const timer = setTimeout(() => {
      setError("The preview didn't start. Use Run preview again.");
    }, PREVIEW_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [running, runId, mountedRunId]);
  const runButton = (title, size = "sm") =>
    Renderer ? (
      <Button title={title} size={size} onClick={start} disabled={!canRun} />
    ) : null;

  // A change's draft: its code (read-only) and what changed, per file.
  const fileName = preview.componentName || name;
  const codePane = showsCode ? (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-2 ${hairline}`}
      style={{ height: 440 }}
      data-testid="cell-preview-code"
    >
      <SegmentedControl
        ariaLabel="Which file"
        value={codeFile}
        onChange={setCodeFile}
        options={[
          { value: "component", label: `${fileName}.js` },
          { value: "config", label: `${fileName}.dash.js` },
        ]}
      />
      <div className="flex-1 min-h-0 relative">
        {draftCode ? (
          <div className="absolute inset-0">
            <CodeEditorVS
              key={codeFile}
              code={
                codeFile === "config"
                  ? draftCode.configCode
                  : draftCode.componentCode
              }
              language="javascript"
              readOnly
              onChange={() => {}}
              minimapEnabled={false}
              padding="p-0"
            />
          </div>
        ) : (
          <span className={`text-sm ${muted}`}>Loading the code…</span>
        )}
      </div>
    </div>
  ) : null;
  const diffs =
    showsCode && draftCode
      ? [
          {
            file: `${fileName}.js`,
            lines: lineDiff(original.componentCode, draftCode.componentCode),
          },
          {
            file: `${fileName}.dash.js`,
            lines: lineDiff(original.configCode, draftCode.configCode),
          },
        ]
      : null;
  const MARKS = { add: "+", del: "−", same: " ", gap: " " };
  const changesPane = showsCode ? (
    <div
      className={`flex flex-col gap-4 rounded-lg border p-3 overflow-auto ${hairline}`}
      style={{ height: 440 }}
      data-testid="cell-preview-changes"
    >
      {diffs ? (
        diffs.map((d) => {
          const changed = d.lines.some(
            (l) => l.type === "add" || l.type === "del",
          );
          return (
            <div key={d.file} className="flex flex-col gap-1">
              <span className={`text-sm font-semibold ${strong}`}>
                {d.file}
              </span>
              {changed ? (
                <div className="flex flex-col font-mono text-xs">
                  {d.lines.map((l, i) => (
                    <span
                      key={i}
                      className={`whitespace-pre ${
                        l.type === "add"
                          ? statusTokens.success.icon
                          : l.type === "del"
                            ? statusTokens.error.icon
                            : muted
                      }`}
                    >
                      {`${MARKS[l.type]} ${l.text}`}
                    </span>
                  ))}
                </div>
              ) : (
                <span className={`text-xs ${muted}`}>No changes.</span>
              )}
            </div>
          );
        })
      ) : (
        <span className={`text-sm ${muted}`}>Loading the code…</span>
      )}
    </div>
  ) : null;

  // As the mockup: the widget running on the left, large; its inputs and
  // what to do with it on the right (stacked when narrow).
  return (
    <div
      className="flex flex-row flex-wrap gap-6 min-w-0"
      data-testid="cell-preview"
    >
      <div
        className="flex flex-col gap-3 min-w-0"
        style={{ flex: "3 1 420px" }}
      >
        {showsCode ? (
          <SegmentedControl
            ariaLabel="Show"
            value={view}
            onChange={setView}
            options={[
              { value: "preview", label: "Preview" },
              { value: "code", label: "Code" },
              { value: "changes", label: "What changed" },
            ]}
          />
        ) : null}
        <div className="flex flex-row flex-wrap items-center justify-between gap-3">
          <span
            className={`text-xs font-semibold uppercase tracking-wider ${muted}`}
            data-testid="cell-preview-status"
          >
            {running
              ? usesText
                ? `Running · ${usesText}`
                : "Running"
              : made.draft
                ? "Not installed yet — nothing on your dashboard has changed"
                : "Not on your dashboard yet"}
          </span>
          <div className="flex flex-row items-center gap-2">
            {checked ? (
              <StatusBadge state="success" label="Checker passed" compact />
            ) : null}
            {onRevise && running && view === "preview" ? (
              marking ? (
                <Button
                  size="sm"
                  title="Marking… — done"
                  onClick={() => setMarking(false)}
                />
              ) : (
                <Button2
                  size="sm"
                  title="Mark a spot"
                  onClick={() => setMarking(true)}
                />
              )
            ) : null}
          </div>
        </div>
        {marking ? (
          <span
            className={`text-xs ${statusTokens.info.icon}`}
            data-testid="cell-preview-marking"
          >
            {spots.length >= MAX_SPOTS
              ? `That's ${MAX_SPOTS} spots — say what's wrong, then send.`
              : "Drag a box around what's wrong. You can mark more than one spot."}
          </span>
        ) : null}
        {view === "code" && codePane ? (
          codePane
        ) : view === "changes" && changesPane ? (
          changesPane
        ) : (
          <div
            ref={stage}
            className={`relative flex flex-col rounded-lg border overflow-hidden ${hairline}`}
            data-testid="cell-preview-stage"
            style={{ height: 440 }}
          >
            {wireEvent ? (
              <span
                data-testid="cell-preview-bot-message"
                className={`px-3 py-1.5 text-xs border-b ${hairline} ${muted}`}
              >
                {botMessage.status === "ready"
                  ? `With ${wire.botName || "the bot"}'s last message${
                      botMessage.message && botMessage.message.at
                        ? ` · ${new Date(botMessage.message.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                        : ""
                    }`
                  : botMessage.status === "loading"
                    ? `Getting ${wire.botName || "the bot"}'s last message…`
                    : `${wire.botName || "The bot"} has no message yet to preview with — it shows once it runs.`}
              </span>
            ) : null}
            {running ? (
              <div data-testid="cell-preview-frame" className="flex-1 min-h-0">
                <MarkSpots
                  active={marking}
                  spots={spots}
                  onAdd={(b) => setSpots((prev) => [...prev, b])}
                  onRemove={(i) =>
                    setSpots((prev) => prev.filter((_, j) => j !== i))
                  }
                />
                <Renderer
                  key={runId}
                  bundleSource={bundle}
                  componentName={preview.componentName || name}
                  declaredProviders={declared}
                  widgetData={{
                    providers: getUserConfigurableProviders(widget.providers),
                    selectedProviders: selected,
                    userPrefs: settings,
                    uuidString: `cell-preview-${preview.componentName || name}`,
                    ...wireData,
                  }}
                  props={settings}
                  onMounted={() => {
                    setError(null);
                    setMountedRunId(runId);
                  }}
                  onError={(e) =>
                    setError(
                      `It hit an error: ${(e && e.message) || "unknown"} — use Change something to have it fixed.`,
                    )
                  }
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <span className={`text-base font-semibold ${strong}`}>
                  {name}
                </span>
                {!Renderer ? (
                  <span className={`text-sm ${muted}`}>
                    Live preview isn't available in this app.
                  </span>
                ) : run === "loading" ? (
                  <span className={`text-sm ${muted}`}>
                    Loading the widget…
                  </span>
                ) : (
                  <>
                    <span className={`text-sm ${muted}`}>
                      {connects
                        ? "It runs with your real connections, so it starts when you ask."
                        : "Ready to run."}
                    </span>
                    {runButton("Run preview", "md")}
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {error ? (
          <span
            className="flex flex-row items-center gap-2 text-sm"
            data-testid="cell-preview-error"
          >
            <FontAwesomeIcon icon="circle-exclamation" />
            {error}
          </span>
        ) : null}
      </div>

      <div
        className="flex flex-col gap-4 min-w-0"
        style={{ flex: "2 1 300px" }}
      >
        <div
          className={`flex flex-col gap-3 rounded-lg border p-4 ${hairline}`}
          data-testid="cell-preview-inputs"
        >
          <span className={`text-base font-semibold ${strong}`}>Inputs</span>
          {needs
            .filter((n) => n.options.length)
            .map((n) => (
              <div key={n.type} className="w-full">
                <SelectInput
                  label={`${n.type} connection`}
                  value={n.selected || ""}
                  placeholder="Choose a connection"
                  options={n.options.map((o) => ({ label: o, value: o }))}
                  onChange={(value) => {
                    setChosen((prev) => ({ ...prev, [n.type]: value }));
                    setRun("idle");
                    setBundle(null);
                  }}
                />
              </div>
            ))}
          {missing ? (
            <span className="text-sm" data-testid="cell-preview-missing">
              {`It needs a ${missing.type} connection — set one up under Providers to preview it with real data.`}
            </span>
          ) : null}
          {unchosen ? (
            <span className="text-sm">{`Choose a ${unchosen.type} connection to run it.`}</span>
          ) : null}
          {hasSettings ? (
            <PanelEditForm
              userConfig={userConfig}
              userPrefs={settings}
              onFieldChange={(key, value) =>
                setSettings((prev) => ({ ...prev, [key]: value }))
              }
            />
          ) : (
            <span className={`text-xs ${muted}`}>
              {connects
                ? "It has no settings."
                : "Nothing to set — it has no settings or connections."}
            </span>
          )}
          {hasSettings || connects ? (
            <span className={`text-xs ${muted}`}>{inputsNote}</span>
          ) : null}
          {running ? (
            <div>
              <Button2 title="Run preview again" size="sm" onClick={restart} />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col" data-testid="cell-preview-decide">
          <Button
            title={approveLabel}
            onClick={looksGood}
            disabled={deciding || !!unchosen}
          />
        </div>

        {onRevise ? (
          <div className="flex flex-col gap-2">
            <span className={`text-sm font-semibold ${strong}`}>
              {spots.length
                ? `What's wrong ${spots.length === 1 ? "here" : "in these spots"}?`
                : "Change something"}
            </span>
            <div className="flex flex-row flex-wrap items-center gap-2">
              <div className="flex-1 min-w-0">
                <InputText
                  name="cell-preview-change"
                  value={change}
                  placeholder="e.g. smaller rows, show who replied last"
                  onChange={(v) => setChange(v)}
                  inputClassName="text-sm"
                />
              </div>
              <Button
                title="Send to the Builder"
                onClick={async () => {
                  const text = change.trim();
                  if (!text) return;
                  // The boxes stay drawn until the picture is taken.
                  let marks = null;
                  if (spots.length && stage.current) {
                    if (stage.current.scrollIntoView) {
                      stage.current.scrollIntoView({ block: "nearest" });
                    }
                    const r = stage.current.getBoundingClientRect();
                    marks = {
                      rect: {
                        x: r.left,
                        y: r.top,
                        width: r.width,
                        height: r.height,
                      },
                      spots,
                    };
                  }
                  await onRevise(text, marks);
                  setChange("");
                  setSpots([]);
                  setMarking(false);
                }}
                disabled={deciding || !change.trim()}
              />
            </div>
            <span className={`text-xs ${muted}`}>
              {spots.length
                ? "Your words and a picture of the marked spots go to the Builder. It changes only this — the rest of the widget stays."
                : "The Builder changes only this — the rest stays — the Checker checks it again, and you see it again here."}
            </span>
          </div>
        ) : null}

        {onDiscard ? (
          <div>
            <Button3
              title={discardLabel}
              onClick={onDiscard}
              disabled={deciding}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default CellPreview;
