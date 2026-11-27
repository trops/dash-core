/**
 * TrackerSetting — the form part of a "tracker" setting (DASH-135, mockups
 * 2 and 8): where a bot's tickets come from, picked rather than typed.
 *
 *   1. the source: Jira / GitHub Issues / Linear / None;
 *   2. a connection row: "✓ Jira connected" with Change, or "Connect Jira";
 *   3. pickers: project (repo, team), status, assigned to, optional label,
 *      the projects filled from the connected provider when Dash can list
 *      them (a running provider with a known tool), else a plain field;
 *   4. a preview, when Dash can search the tracker: "Right now this
 *      matches N tickets. Next up: …";
 *   5. Jira only: "Advanced: edit as a Jira search (JQL)".
 *
 * Controlled: value + onChange(value). The value's shape and its words for
 * the bot are in src/utils/trackerSetting.js.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Button3,
  InputText,
  SegmentedControl,
  SelectInput,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { openProviderSetup } from "../Provider/providerSetupEvent";
import {
  ASSIGNEE_LABELS,
  TRACKER_ASSIGNEES,
  TRACKER_INFO,
  parseTrackerPreview,
  parseTrackerProjects,
  sourceLabel,
  trackerJql,
  trackerEmpty,
  trackerProblemText,
  trackerProviders,
  trackerTool,
} from "../../utils/trackerSetting";

const SOURCE_OPTIONS = [
  { value: "jira", label: "Jira" },
  { value: "github", label: "GitHub Issues" },
  { value: "linear", label: "Linear" },
  { value: "none", label: "None: I'll hand it tickets myself" },
];

// The provider type the Providers page creates for "Connect <tracker>".
const CONNECT_TYPE = { jira: "atlassian", github: "github", linear: "linear" };

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** The user's providers (bots.listToolSources), reloaded when one is added. */
function useToolSources(workspaceId) {
  const [sources, setSources] = useState(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const reload = () => setNonce((n) => n + 1);
    window.addEventListener("dash:provider-installed", reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("dash:provider-installed", reload);
      window.removeEventListener("focus", reload);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const api = window.mainApi && window.mainApi.bots;
    if (!api || !api.listToolSources) {
      setSources([]);
      return undefined;
    }
    Promise.resolve(api.listToolSources(workspaceId || null))
      .then((s) => alive && setSources(Array.isArray(s) ? s : []))
      .catch(() => alive && setSources([]));
    return () => {
      alive = false;
    };
  }, [workspaceId, nonce]);
  return sources;
}

/** One tool call on a running provider; null when it can't be made. */
async function callTracker(provider, spec, value, workspaceId) {
  const mcp = window.mainApi && window.mainApi.mcp;
  if (!mcp || !mcp.callTool || !spec) return null;
  try {
    const res = await mcp.callTool(
      provider.name,
      spec.tool,
      spec.args(value),
      null,
      null,
      workspaceId || null,
    );
    if (!res || res.error) return null;
    return res;
  } catch (_e) {
    return null;
  }
}

export const TrackerSetting = ({
  setting: s,
  value = null,
  onChange,
  botName = null,
  workspaceId = null,
  disabled = false,
  title = null,
}) => {
  const { muted, hairline } = useConfigTokens();
  const status = useStatusTokens();
  const v = isObj(value) ? value : {};
  const source = v.source || "";
  const info = TRACKER_INFO[source] || null;
  const sources = useToolSources(workspaceId);
  const found = useMemo(
    () => (source ? trackerProviders(source, sources || []) : []),
    [source, sources],
  );
  const provider = found.find((p) => p.name === v.provider) || found[0] || null;
  const [projects, setProjects] = useState(null);
  const [preview, setPreview] = useState(null);
  const [advanced, setAdvanced] = useState(!!v.query);

  const set = (patch) => onChange && onChange({ ...v, ...patch });
  const pickSource = (next) => {
    if (next === source) return;
    if (next === "none") {
      onChange && onChange({ source: "none" });
      return;
    }
    const nextInfo = TRACKER_INFO[next];
    const p = trackerProviders(next, sources || [])[0];
    onChange &&
      onChange({
        source: next,
        status: (nextInfo.statuses && nextInfo.statuses[0]) || "",
        assignee: v.assignee || "anyone",
        ...(v.label ? { label: v.label } : {}),
        ...(p ? { provider: p.name } : {}),
      });
    setAdvanced(false);
  };

  // The projects, from the provider when Dash can list them.
  const projectsSpec = provider
    ? trackerTool(source, "projects", provider)
    : null;
  useEffect(() => {
    let alive = true;
    setProjects(null);
    if (!projectsSpec) return undefined;
    callTracker(provider, projectsSpec, v, workspaceId).then((res) => {
      if (!alive) return;
      const list = res ? parseTrackerProjects(res) : [];
      setProjects(list.length ? list : null);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, provider && provider.name, !!projectsSpec, workspaceId]);

  // The preview, when Dash can search the tracker.
  const searchSpec = provider ? trackerTool(source, "search", provider) : null;
  const filled = !trackerEmpty(v) && source !== "none";
  const searchKey = filled ? JSON.stringify(v) : "";
  useEffect(() => {
    let alive = true;
    setPreview(null);
    if (!searchSpec || !searchKey) return undefined;
    const t = setTimeout(() => {
      callTracker(provider, searchSpec, v, workspaceId).then((res) => {
        if (alive) setPreview(res ? parseTrackerPreview(res) : null);
      });
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, !!searchSpec, provider && provider.name, workspaceId]);

  const label = sourceLabel(source);
  const problem = trackerProblemText(v);
  const projectOptions = projects
    ? [
        { value: "", label: `Choose a ${info.project.toLowerCase()}…` },
        ...projects,
        ...(v.project && !projects.some((p) => p.value === v.project)
          ? [{ value: v.project, label: v.project }]
          : []),
      ]
    : null;
  const statuses = (info && info.statuses) || [];
  const statusOptions = [
    { value: "", label: source === "github" ? "Open or closed" : "Any status" },
    ...statuses.map((x) => ({
      value: x,
      label: source === "github" && x === "open" ? "Open" : x,
    })),
    ...(source === "github" ? [{ value: "closed", label: "Closed" }] : []),
    ...(v.status &&
    !statuses.includes(v.status) &&
    !(source === "github" && v.status === "closed")
      ? [{ value: v.status, label: v.status }]
      : []),
  ];
  const who = botName || "This bot";

  return (
    <div
      className="flex flex-col gap-2 max-w-2xl"
      data-testid={`team-setting-${s.name}`}
    >
      {title || (
        <span className="text-sm font-medium">{s.label || s.name}</span>
      )}
      <SegmentedControl
        ariaLabel={s.label || "Ticket source"}
        value={source || null}
        onChange={(next) => !disabled && pickSource(next)}
        options={SOURCE_OPTIONS}
      />
      {source === "none" ? (
        <span className={`text-xs ${muted}`}>
          {`${who} doesn't look for tickets: its jobs start only from a task you give it.`}
        </span>
      ) : null}
      {info && source !== "none" ? (
        provider ? (
          <div
            className={`flex flex-row flex-wrap gap-2 items-center rounded-lg border px-3 py-2 text-sm ${status.success.border} ${status.success.bg}`}
            data-testid={`tracker-${s.name}-connected`}
          >
            <span className={`font-medium ${status.success.text}`}>
              {`✓ ${label} connected`}
            </span>
            <span className={`flex-1 min-w-0 truncate text-xs ${muted}`}>
              {provider.connector
                ? `${provider.name} (your Claude account)`
                : provider.name}
            </span>
            {found.length > 1 ? (
              <SelectInput
                ariaLabel={`${label} provider`}
                value={provider.name}
                onChange={(name) => set({ provider: name })}
                options={found.map((p) => ({ value: p.name, label: p.name }))}
              />
            ) : null}
            <Button3
              title="Change"
              size="sm"
              disabled={disabled}
              onClick={() => openProviderSetup(provider.name)}
            />
          </div>
        ) : (
          <div
            className={`flex flex-row flex-wrap gap-2 items-center rounded-lg border px-3 py-2 text-sm ${status.warning.border} ${status.warning.bg}`}
            data-testid={`tracker-${s.name}-not-connected`}
          >
            <span className={`flex-1 min-w-0 ${status.warning.text}`}>
              {sources === null
                ? `Looking for ${label}…`
                : `${label} isn't connected on this computer yet.`}
            </span>
            <Button3
              title={`Connect ${label}`}
              size="sm"
              disabled={disabled}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("dash:open-settings-create-provider", {
                    detail: {
                      type: CONNECT_TYPE[source],
                      providerClass: "mcp",
                    },
                  }),
                )
              }
            />
          </div>
        )
      ) : null}
      {info && source !== "none" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-xs font-medium">{info.project}</span>
            {projectOptions ? (
              <SelectInput
                ariaLabel={info.project}
                value={v.project || ""}
                onChange={(p) => set({ project: p })}
                options={projectOptions}
              />
            ) : (
              <InputText
                ariaLabel={info.project}
                value={v.project || ""}
                placeholder={info.projectHint}
                disabled={disabled}
                onChange={(p) => set({ project: p })}
              />
            )}
            {!projectOptions ? (
              <span className={`text-xs ${muted}`}>
                {provider && provider.connector
                  ? `${info.projectHint}. Dash can't list them through a Claude connector.`
                  : provider && !provider.running && source !== "linear"
                    ? `${info.projectHint}. While ${provider.name} is running in Dash, they're listed here.`
                    : `${info.projectHint}.`}
              </span>
            ) : null}
          </div>
          <SelectInput
            label="Status"
            value={v.status || ""}
            onChange={(x) => set({ status: x })}
            options={statusOptions}
          />
          <SelectInput
            label="Assigned to"
            value={v.assignee || "anyone"}
            onChange={(x) => set({ assignee: x })}
            options={TRACKER_ASSIGNEES.map((a) => ({
              value: a,
              label: ASSIGNEE_LABELS[a],
            }))}
          />
          <InputText
            label="With label (optional)"
            value={v.label || ""}
            placeholder="e.g. bot"
            disabled={disabled}
            onChange={(x) => set({ label: x })}
          />
        </div>
      ) : null}
      {source === "jira" ? (
        <div className="flex flex-col gap-1">
          <div>
            <Button3
              title={
                advanced
                  ? "Hide the Jira search"
                  : "Advanced: edit as a Jira search (JQL)"
              }
              size="xs"
              disabled={disabled}
              onClick={() => setAdvanced((a) => !a)}
            />
          </div>
          {advanced ? (
            <div
              className="flex flex-col gap-1"
              data-testid={`tracker-${s.name}-jql`}
            >
              <InputText
                ariaLabel="Jira search (JQL)"
                value={v.query || trackerJql(v)}
                placeholder='project = "SANDBOX" AND status = "To Do"'
                disabled={disabled}
                onChange={(q) => set({ query: q })}
              />
              <span className={`text-xs ${muted}`}>
                {v.query
                  ? "This search replaces the choices above."
                  : "Built from the choices above. Editing it replaces them."}
              </span>
              {v.query ? (
                <div>
                  <Button3
                    title="Use the choices instead"
                    size="xs"
                    disabled={disabled}
                    onClick={() => {
                      const { query: _q, ...rest } = v;
                      onChange && onChange(rest);
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {preview ? (
        <span className="text-xs" data-testid={`tracker-${s.name}-preview`}>
          {preview.count === 0
            ? "Right now this matches no tickets."
            : `Right now this matches ${preview.count} ticket${preview.count === 1 ? "" : "s"}.${preview.next ? ` Next up: ${preview.next}` : ""}`}
        </span>
      ) : null}
      {s.description ? (
        <span className={`text-xs ${muted}`}>{s.description}</span>
      ) : null}
      <span className={`text-xs ${muted}`}>
        {`${botName ? `${botName} uses it` : "Bots use it"} as {${s.name}}: the choice in words, with the search to run.`}
      </span>
      {problem ? (
        <span className={`text-xs ${status.warning.text}`}>
          {`${problem.charAt(0).toUpperCase()}${problem.slice(1)} yet: ${who} can't do its job until it has one.`}
        </span>
      ) : null}
    </div>
  );
};

export default TrackerSetting;
