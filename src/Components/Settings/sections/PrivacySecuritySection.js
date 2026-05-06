import React, { useEffect, useState, useCallback, useContext } from "react";
import {
  Button,
  SubHeading3,
  FontAwesomeIcon,
  Switch,
  Tabs3,
} from "@trops/dash-react";
import { GrantManuallyModal } from "./GrantManuallyModal";
import { AppContext } from "../../../Context/App/AppContext";
import { SectionLayout } from "../SectionLayout";
import { groupRowsByPackage } from "./groupRowsByPackage";
import { PrivacySecurityList } from "./PrivacySecurityList";
import { WidgetPackageDetail } from "../details/WidgetPackageDetail";
import { WidgetGrantRow, GrantOriginBadge } from "./WidgetGrantRow";

/**
 * Privacy & Security
 *
 * Audit panel for per-widget MCP grants. Lists EVERY installed widget,
 * grouped by state:
 *   - declared + granted    (developer asked, user approved)
 *   - declared + ungranted  (developer asked, user hasn't decided yet)
 *   - undeclared + granted  (manual grant or scanner-discovered grant)
 *   - undeclared + ungranted (no manifest at all — "Grant manually" button)
 *
 * The grantOrigin field on each grant ("declared"/"discovered"/"manual"
 * /null-legacy) is surfaced as a small badge so users can see which
 * grants were approved against the developer's declaration vs against a
 * scanner guess vs typed by hand.
 *
 * Reads `window.mainApi.widgetMcp.{listAll,revoke,revokeServer,setGrant}`
 * exposed by dash-electron's preload.
 */
export const PrivacySecuritySection = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [manualGrantWidgetId, setManualGrantWidgetId] = useState(null);
  const [knownServerNames, setKnownServerNames] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grouped");
  const [selectedPackageKey, setSelectedPackageKey] = useState(null);
  // Two top-level tabs so the inline `HowThisWorksPanel` (which carries
  // example fixtures and is intentionally tall) doesn't push the
  // package list/detail below the viewport. "permissions" is the
  // default and contains the actual UI users came here to use.
  const [activeTab, setActiveTab] = useState("permissions");

  const reload = useCallback(async () => {
    setError(null);
    try {
      const api = typeof window !== "undefined" ? window.mainApi : null;
      if (!api?.widgetMcp?.listAll) {
        setRows([]);
        setLoading(false);
        return;
      }
      const result = await api.widgetMcp.listAll();
      setRows(Array.isArray(result) ? result : []);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = typeof window !== "undefined" ? window.mainApi : null;
        const result = await api?.mcp?.getCatalog?.();
        const servers = result?.catalog || [];
        if (!cancelled && Array.isArray(servers)) {
          setKnownServerNames(
            servers.map((s) => s?.name).filter((n) => typeof n === "string"),
          );
        }
      } catch {
        // optional hint, ignore failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const revokeWidget = async (widgetId) => {
    try {
      await window.mainApi?.widgetMcp?.revoke?.(widgetId);
      reload();
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const revokeServer = async (widgetId, serverName) => {
    try {
      await window.mainApi?.widgetMcp?.revokeServer?.(widgetId, serverName);
      reload();
    } catch (e) {
      setError(e?.message || String(e));
    }
  };

  const revokePackage = async (packageGroup) => {
    // Sequential revoke so a mid-loop failure surfaces clearly and
    // doesn't leave the UI in a half-applied state. The reload at the
    // end picks up whatever did succeed.
    try {
      for (const w of packageGroup.widgets) {
        if (!w.granted) continue;
        await window.mainApi?.widgetMcp?.revoke?.(w.widgetId);
      }
      reload();
    } catch (e) {
      setError(e?.message || String(e));
      reload();
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col p-6">
        <span className="text-sm opacity-60">Loading…</span>
      </div>
    );
  }

  const packageGroups = groupRowsByPackage(rows);
  const selectedGroup =
    selectedPackageKey == null
      ? null
      : packageGroups.find((g) =>
          g.packageId == null
            ? selectedPackageKey === "__ungrouped__"
            : g.packageId === selectedPackageKey,
        ) || null;

  const listContent = (
    <PrivacySecurityList
      packageGroups={packageGroups}
      selectedPackageKey={selectedPackageKey}
      onSelectPackage={setSelectedPackageKey}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
    />
  );

  const detailContent = selectedGroup ? (
    <WidgetPackageDetail
      packageGroup={selectedGroup}
      onRevokeWidget={revokeWidget}
      onRevokeServer={revokeServer}
      onGrantManually={(widgetId) => setManualGrantWidgetId(widgetId)}
      onRevokePackage={revokePackage}
    />
  ) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-shrink-0 flex flex-col space-y-3 px-6 pt-6 pb-3 border-b border-gray-800">
        <div className="flex flex-col space-y-2">
          <SubHeading3 title="Widget MCP permissions" padding={false} />
          <span className="text-xs opacity-60">
            Granting access here is a trust signal about the widget — not a
            per-dashboard switch.
          </span>
        </div>
        <Tabs3
          value={activeTab}
          onValueChange={setActiveTab}
          backgroundColor="bg-transparent"
          spacing="p-0"
        >
          <Tabs3.List spacing="p-0.5">
            <Tabs3.Trigger value="permissions">Permissions</Tabs3.Trigger>
            <Tabs3.Trigger value="help">Help</Tabs3.Trigger>
          </Tabs3.List>
        </Tabs3>
        {error && (
          <div className="text-xs text-red-400 bg-red-900 bg-opacity-20 border border-red-700 rounded p-3">
            {error}
          </div>
        )}
      </div>

      {activeTab === "permissions" ? (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex-shrink-0 px-6 py-4 border-b border-gray-800">
            <EnforcementToggles />
          </div>
          <SectionLayout
            listContent={listContent}
            detailContent={detailContent}
            emptyDetailMessage="Select a package to view its grants"
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <HowThisWorksPanel />
        </div>
      )}

      <GrantManuallyModal
        isOpen={!!manualGrantWidgetId}
        setIsOpen={(open) => {
          if (!open) setManualGrantWidgetId(null);
        }}
        widgetId={manualGrantWidgetId}
        knownServerNames={knownServerNames}
        onGranted={() => {
          setManualGrantWidgetId(null);
          reload();
        }}
      />
    </div>
  );
};

/**
 * UI controls for the two security flags that gate the rest of this
 * stack. Without UI, users would have to hand-edit
 * userData/Dashboard/settings.json — fine for the dev who shipped the
 * feature, hostile to anyone else. Both flags are read on every gate
 * call (settings.json is re-read each time), so toggling takes effect
 * immediately for new tool calls; in-flight calls aren't interrupted.
 */
const EnforcementToggles = () => {
  const appContext = useContext(AppContext);
  const settings = appContext?.settings || {};
  const security = settings.security || {};
  // Default-on semantics — anything except explicit `false` is treated
  // as enabled. Mirrors electron/utils/securityFlags.js so the UI shows
  // the same state the runtime sees.
  const enforceEnabled = security.enforceWidgetMcpPermissions !== false;
  const jitEnabled = security.enableJitConsent !== false;

  // pendingDisable: { flag: 'enforce' | 'jit' } | null
  // When the user toggles a flag from ON → OFF, we open a confirm modal
  // before persisting. ON → ON or OFF → ON go through immediately.
  const [pendingDisable, setPendingDisable] = useState(null);

  // lastTestResult: feedback for the "Test prompt" button. Tells the
  // user whether their JIT response was actually persisted, so they
  // don't have to interpret the post-grant "server not connected"
  // error as failure.
  const [lastTestResult, setLastTestResult] = useState(null);

  // Auto-clear the test result after 30 seconds so it doesn't linger
  // forever after a successful test.
  useEffect(() => {
    if (!lastTestResult) return;
    const timer = setTimeout(() => setLastTestResult(null), 30_000);
    return () => clearTimeout(timer);
  }, [lastTestResult]);

  const writeSecurity = (updates) => {
    if (!appContext?.changeSettings) return;
    const next = {
      ...settings,
      security: { ...security, ...updates },
    };
    appContext.changeSettings(next);
  };

  const handleEnforceToggle = (v) => {
    if (v === false && enforceEnabled) {
      setPendingDisable({ flag: "enforce" });
      return;
    }
    writeSecurity({ enforceWidgetMcpPermissions: v });
  };

  const handleJitToggle = (v) => {
    if (v === false && jitEnabled) {
      setPendingDisable({ flag: "jit" });
      return;
    }
    writeSecurity({ enableJitConsent: v });
  };

  const confirmDisable = () => {
    if (!pendingDisable) return;
    if (pendingDisable.flag === "enforce") {
      writeSecurity({ enforceWidgetMcpPermissions: false });
    } else if (pendingDisable.flag === "jit") {
      writeSecurity({ enableJitConsent: false });
    }
    setPendingDisable(null);
  };

  // One-click JIT trigger for testing. Calls the gate via a fake widget
  // identity that has no grant — the gate denies, JIT escalates, the
  // modal pops. We classify the outcome so the user knows whether their
  // JIT response was actually persisted (vs whether the test ran at all).
  //
  // Outcome classification:
  //   message includes "Server not connected" → granted
  //     (gate passed, post-gate server lookup expectedly failed because
  //     "test-server" doesn't exist — the goal is the consent flow, not
  //     the server response)
  //   message includes "user declined" → denied
  //   message includes "JIT consent timed out" → timeout
  //   anything else → unknown error
  const triggerTestJitPrompt = async () => {
    setLastTestResult({ status: "pending", message: "Waiting for response…" });
    try {
      const result = await window.mainApi?.mcp?.callTool?.(
        "test-server",
        "test_tool",
        { path: "/tmp/jit-probe.txt" },
        null,
        "@test/jit-probe",
      );
      // callTool resolves to { error, message } on the main side; classify.
      const msg = result?.message || JSON.stringify(result || {});
      if (/server not connected/i.test(msg)) {
        setLastTestResult({
          status: "granted",
          message:
            "Granted — your response was saved as a 'live' grant for @test/jit-probe.",
        });
      } else if (/user declined/i.test(msg)) {
        setLastTestResult({
          status: "denied",
          message: "Denied — no grant written.",
        });
      } else if (/timed out/i.test(msg)) {
        setLastTestResult({
          status: "timeout",
          message: "Timed out — no response within 60s.",
        });
      } else {
        setLastTestResult({
          status: "unknown",
          message: "Unexpected: " + msg,
        });
      }
    } catch (e) {
      setLastTestResult({
        status: "error",
        message: "Test threw: " + (e?.message || String(e)),
      });
    }
  };

  const TEST_RESULT_STYLE = {
    pending: "text-gray-400",
    granted: "text-green-400",
    denied: "text-amber-400",
    timeout: "text-amber-400",
    unknown: "text-red-400",
    error: "text-red-400",
  };

  return (
    <div className="flex flex-col space-y-4 border border-gray-700 rounded p-4">
      <div className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-200">
            Enforce widget MCP permissions
          </span>
          <span className="text-xs text-gray-400 mt-1">
            When ON, every widget MCP tool call goes through the runtime gate.
            Calls without a matching grant are denied. When OFF, widgets can
            call any MCP server (legacy behavior).
          </span>
        </div>
        <Switch checked={enforceEnabled} onChange={handleEnforceToggle} />
      </div>

      <div className="flex flex-row items-start justify-between gap-4 border-t border-gray-800 pt-4">
        <div className="flex flex-col">
          <span
            className={`text-sm font-medium ${
              enforceEnabled ? "text-gray-200" : "text-gray-500"
            }`}
          >
            Just-in-time consent prompts
          </span>
          <span className="text-xs text-gray-400 mt-1">
            When ON (and enforcement is also ON), a "no grant" denial pauses the
            call and prompts you with the exact tool/path the widget is
            requesting. Approve once and the grant is saved. When OFF, denials
            are silent — widgets just get an error.
          </span>
        </div>
        <Switch
          checked={jitEnabled && enforceEnabled}
          onChange={handleJitToggle}
          disabled={!enforceEnabled}
        />
      </div>

      <ConfirmDisableInline
        pending={pendingDisable}
        onCancel={() => setPendingDisable(null)}
        onConfirm={confirmDisable}
      />

      {enforceEnabled && jitEnabled && (
        <div className="flex flex-col gap-2 border-t border-gray-800 pt-4">
          <div className="flex flex-row items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-200">
                Test JIT consent prompt
              </span>
              <span className="text-xs text-gray-400 mt-1">
                Fires a fake tool call from <code>@test/jit-probe</code> to{" "}
                <code>test-server</code>. The gate runs first (no real server
                needed), so you'll see the JIT modal exactly as it appears in
                production. The post-gate server lookup expectedly fails —
                that's fine; the goal here is to exercise the consent flow.
              </span>
            </div>
            <Button title="Test prompt" onClick={triggerTestJitPrompt} />
          </div>
          {lastTestResult && (
            <div
              className={`text-xs font-medium ${
                TEST_RESULT_STYLE[lastTestResult.status] || "text-gray-400"
              }`}
            >
              Last test ({lastTestResult.status}): {lastTestResult.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const DISABLE_COPY = {
  enforce: {
    title: "Disable widget MCP permissions enforcement?",
    body:
      "Widgets will be able to call any MCP server with any tool or path. " +
      "Granted paths in this panel will no longer matter — the runtime gate " +
      "becomes a no-op. This is the pre-security-stack behavior. " +
      "You can re-enable any time.",
    confirmLabel: "Disable enforcement",
  },
  jit: {
    title: "Disable just-in-time consent prompts?",
    body:
      'Tool calls without an existing grant will fail silently with a "no grant" error. ' +
      "You'll need to grant in this panel manually before the widget retries. " +
      "Enforcement stays on; you just stop being prompted at runtime.",
    confirmLabel: "Disable prompts",
  },
};

/**
 * Inline confirmation prompt — rendered directly under the toggles
 * inside the EnforcementToggles container, NOT as a nested Modal.
 *
 * Why inline: the Settings panel itself is already a Modal, so a
 * nested Modal positions relative to the panel's content area rather
 * than the viewport, landing visibly off-center. Inline avoids the
 * nesting entirely; the user keeps context and the warning is
 * impossible to miss right where the toggle lives.
 */
const ConfirmDisableInline = ({ pending, onCancel, onConfirm }) => {
  if (!pending) return null;
  const copy = DISABLE_COPY[pending.flag];
  if (!copy) return null;
  return (
    <div className="flex flex-col gap-3 border-2 border-amber-500 rounded p-3 mt-2">
      <div className="flex flex-row items-center gap-2">
        <FontAwesomeIcon
          icon="triangle-exclamation"
          className="h-4 w-4 text-amber-500"
        />
        <span className="text-sm font-semibold text-gray-100">
          {copy.title}
        </span>
      </div>
      <div className="text-xs text-gray-300 leading-relaxed">{copy.body}</div>
      <div className="flex justify-end gap-2">
        <Button title="Cancel" onClick={onCancel} />
        <Button title={copy.confirmLabel} onClick={onConfirm} />
      </div>
    </div>
  );
};

// Mock fixtures for the "Example rows" section. These use the same
// WidgetGrantRow component the real rows use, so the preview always
// reflects the real rendering. Click handlers are no-ops — the panel is
// for visualization only.
const EXAMPLE_FIXTURES = [
  {
    caption: "Declared by the developer and granted by the user.",
    widgetId: "@example/notes-summarizer",
    hasManifest: true,
    grantOrigin: "declared",
    declared: {
      servers: {
        filesystem: {
          tools: ["read_file", "list_directory"],
          readPaths: ["~/Documents/notes"],
          writePaths: [],
        },
      },
    },
    granted: {
      grantOrigin: "declared",
      servers: {
        filesystem: {
          tools: ["read_file", "list_directory"],
          readPaths: ["~/Documents/notes"],
          writePaths: [],
        },
      },
    },
  },
  {
    caption: "Declared by the developer — the user hasn't decided yet.",
    widgetId: "@example/code-search",
    hasManifest: true,
    grantOrigin: null,
    declared: {
      servers: {
        github: { tools: ["search_repositories", "get_file_contents"] },
      },
    },
    granted: null,
  },
  {
    caption: "Detected by the install-time scanner and granted.",
    widgetId: "@example/file-helper",
    hasManifest: false,
    grantOrigin: "discovered",
    declared: null,
    granted: {
      grantOrigin: "discovered",
      servers: {
        filesystem: { tools: ["read_file"], readPaths: [], writePaths: [] },
      },
    },
  },
  {
    caption: "Granted manually because the widget had no manifest.",
    widgetId: "@example/legacy-widget",
    hasManifest: false,
    grantOrigin: "manual",
    declared: null,
    granted: {
      grantOrigin: "manual",
      servers: {
        filesystem: {
          tools: ["read_file", "write_file"],
          readPaths: ["~/Downloads"],
          writePaths: ["/tmp/widget-output"],
        },
      },
    },
  },
  {
    caption:
      "Granted live, when the widget triggered a tool call without a pre-existing grant (just-in-time consent prompt).",
    widgetId: "@example/just-in-time-widget",
    hasManifest: false,
    grantOrigin: "live",
    declared: null,
    granted: {
      grantOrigin: "live",
      servers: {
        filesystem: {
          tools: ["read_file"],
          readPaths: ["~/Documents/notes/today.md"],
          writePaths: [],
        },
      },
    },
  },
  {
    caption:
      "Phase 2 fs grant — widget granted access to a specific data file via JIT consent on saveData/readData.",
    widgetId: "@example/fs-domain-widget",
    hasManifest: false,
    grantOrigin: "live",
    declared: null,
    granted: {
      grantOrigin: "live",
      servers: {},
      domains: {
        fs: {
          readPaths: ["notes-state.json"],
          writePaths: ["notes-state.json"],
        },
      },
    },
  },
  {
    caption:
      "Stale grant — the widget upgraded and dropped readPaths from its manifest, but the user's grant is still present.",
    widgetId: "@example/upgraded-widget",
    hasManifest: true,
    grantOrigin: "declared",
    declared: {
      // Manifest now declares only the tool, no paths.
      servers: {
        filesystem: { tools: ["read_file"], readPaths: [], writePaths: [] },
      },
    },
    granted: {
      grantOrigin: "declared",
      servers: {
        filesystem: {
          tools: ["read_file"],
          readPaths: ["~/Documents/old-notes"],
          writePaths: [],
        },
      },
    },
  },
];

const noop = () => {};

/**
 * Collapsible explainer that documents how grants flow per-widget vs
 * per-dashboard, with a concrete example table and rendered preview rows
 * for each grant state. Default-expanded so the example rows
 * (including the live-grant fixture) are visible without an extra click;
 * users who don't want the wall of text collapse manually.
 */
const HowThisWorksPanel = () => {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-gray-700 rounded">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex flex-row items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-800"
      >
        <span>How widget MCP permissions work</span>
        <FontAwesomeIcon
          icon={open ? "chevron-up" : "chevron-down"}
          className="h-3 w-3 opacity-60"
        />
      </button>

      {open && (
        <div className="flex flex-col space-y-4 px-3 py-3 border-t border-gray-800 text-xs leading-relaxed">
          <div className="space-y-2">
            <p>
              <span className="font-semibold">
                The grant is about the widget, not the dashboard.
              </span>{" "}
              When you grant <code>@trops/notes-summarizer</code> access to{" "}
              <code>~/Documents</code>, you're saying "I trust this widget with
              this path, anywhere." Grants live one-per-widget, regardless of
              how many dashboards use it.
            </p>
            <p>
              <span className="font-semibold">
                Each dashboard automatically scopes its servers.
              </span>{" "}
              When you open a dashboard, Dash spawns a separate MCP server
              process per dashboard. That server is configured with only the
              paths granted to widgets actually on that dashboard — nothing
              else. Two dashboards using the same widget share the same grant;
              two dashboards using different widgets get different effective
              scopes.
            </p>
            <p>
              <span className="font-semibold">What this doesn't do.</span>{" "}
              There's no way today to say "this widget can use filesystem on
              Dashboard 1 but not Dashboard 2." Grants are per-widget;
              per-(widget, dashboard) granularity would need a bigger UX rework.
              If you don't want a widget to access a path on a particular
              dashboard, the workaround is to remove it from that dashboard or
              revoke the grant entirely.
            </p>
          </div>

          <div className="space-y-2">
            <div className="font-semibold">
              Example: widget A granted <code>/Documents</code>, widget B
              granted <code>/Code</code>
            </div>
            <table className="w-full text-xs border border-gray-800">
              <thead>
                <tr className="bg-gray-900">
                  <th className="text-left px-2 py-1 border-b border-gray-800">
                    Scenario
                  </th>
                  <th className="text-left px-2 py-1 border-b border-gray-800">
                    Dashboard 1 sees
                  </th>
                  <th className="text-left px-2 py-1 border-b border-gray-800">
                    Dashboard 2 sees
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-2 py-1 border-b border-gray-800">
                    A on Dash 1, B on Dash 2
                  </td>
                  <td className="px-2 py-1 border-b border-gray-800 font-mono">
                    /Documents
                  </td>
                  <td className="px-2 py-1 border-b border-gray-800 font-mono">
                    /Code
                  </td>
                </tr>
                <tr>
                  <td className="px-2 py-1 border-b border-gray-800">
                    A on both, B on Dash 2
                  </td>
                  <td className="px-2 py-1 border-b border-gray-800 font-mono">
                    /Documents
                  </td>
                  <td className="px-2 py-1 border-b border-gray-800 font-mono">
                    /Documents, /Code
                  </td>
                </tr>
                <tr>
                  <td className="px-2 py-1">A + B both on Dash 1</td>
                  <td className="px-2 py-1 font-mono">/Documents, /Code</td>
                  <td className="px-2 py-1 opacity-60">(no server)</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="font-semibold">What each row state looks like</div>
            {EXAMPLE_FIXTURES.map((f) => (
              <div key={f.widgetId} className="space-y-1">
                <div className="italic opacity-60">{f.caption}</div>
                <WidgetGrantRow
                  widgetId={f.widgetId}
                  declared={f.declared}
                  granted={f.granted}
                  hasManifest={f.hasManifest}
                  grantOrigin={f.grantOrigin}
                  onRevokeWidget={noop}
                  onRevokeServer={noop}
                  onGrantManually={noop}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
