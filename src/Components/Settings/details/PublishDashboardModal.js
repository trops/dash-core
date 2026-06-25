import React, { useState, useEffect, useContext } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  Modal,
  Stepper,
  TextArea,
  Button2,
  Button3,
  Tag3,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { ComponentManager } from "../../../ComponentManager";
import { useRegistryAuthGate } from "../../../hooks/useRegistryAuthGate";
import { IconPicker } from "./IconPicker";

const DASHBOARD_TAGS = [
  "productivity",
  "monitoring",
  "analytics",
  "communication",
  "developer",
  "sales",
  "marketing",
  "finance",
  "project-management",
  "social",
  "news",
  "utilities",
];

const BUMP_OPTIONS = [
  { value: "patch", label: "Patch (bug fix)" },
  { value: "minor", label: "Minor (new feature)" },
  { value: "major", label: "Major (breaking change)" },
  { value: "none", label: "Keep current version" },
];

// Parse "@scope/name" → { scope, packageName }. Returns empty strings
// for unscoped names so callers can use the || fallback chain.
function parseScopeAndName(sourcePackage) {
  if (!sourcePackage) return { scope: "", packageName: "" };
  const m = sourcePackage.match(/^@([^/]+)\/(.+)$/);
  if (m) return { scope: m[1], packageName: m[2] };
  return { scope: "", packageName: sourcePackage };
}

// Pulled out as a small helper so the Dependencies loader and the
// dashboard publish call share the same shape. Widgets registered from
// a package (via `_sourcePackage`) inherit scope + packageName from that
// package ID — otherwise the main-process resolver has no way to map a
// bare component name to its owning package.
function collectComponentConfigs() {
  const configMap = ComponentManager.componentMap();
  const componentConfigs = {};
  for (const [key, config] of Object.entries(configMap)) {
    if (!config || config.type !== "widget") continue;
    const hasExplicit =
      config.id || config.scope || config.packageName || config._sourcePackage;
    if (!hasExplicit) continue;
    const parsed = parseScopeAndName(config._sourcePackage);
    const entry = {
      id: config.id || null,
      scope: config.scope || parsed.scope || "",
      packageName: config.packageName || parsed.packageName || "",
    };
    // Key by the ComponentManager registration key (what layouts
    // actually store) AND by config.name (display name). The layout
    // writes the component name, so keying only by config.name broke
    // registry lookup for widgets whose display name differs from
    // their component name (common for AI-built widgets).
    componentConfigs[key] = entry;
    if (config.name && config.name !== key) {
      componentConfigs[config.name] = entry;
    }
  }
  return componentConfigs;
}

// Build default per-dependency selections. Owned dependencies default
// to "include + patch bump" unless the local version is newer than what's
// in the registry (then "include + use local"). Third-party refs get a
// fixed "reference" entry.
function seedSelections(plan, dashboardVisibility) {
  const selections = {};
  for (const w of plan.widgets || []) {
    if (!w.scope || !w.packageName) continue;
    const key = `${w.scope}/${w.packageName}`;
    const reg = w.registry;
    // Widgets under a local-only scope (@ai-built/*) are always owned
    // by the publisher for the purposes of this flow — the backend
    // republishes them under the caller's scope. Force include=true.
    const owned = w.requiresRepublish ? true : reg?.ownedByMe || !reg?.exists;
    selections[key] = {
      kind: "widget",
      owned,
      // Default: include owned rows, skip third-party. Always include
      // when the widget requires republishing (can't ship a dashboard
      // pointing at a scope the installer can't resolve).
      include: w.requiresRepublish ? true : !!owned,
      // Bump default: none if not yet in registry (publish local version as-is),
      // patch if already in registry at same version
      bump:
        !reg?.exists || reg.latestVersion !== w.localVersion ? "none" : "patch",
      // Per-widget visibility inherits dashboard visibility by default
      visibility: reg?.visibility || dashboardVisibility || "public",
    };
  }
  if (plan.theme && plan.theme.scope && plan.theme.name) {
    const key = `${plan.theme.scope}/${plan.theme.name}`;
    const reg = plan.theme.registry;
    const owned = reg?.ownedByMe || !reg?.exists;
    selections[key] = {
      kind: "theme",
      owned,
      include: !!owned,
      bump:
        !reg?.exists || reg.latestVersion !== plan.theme.localVersion
          ? "none"
          : "patch",
      visibility: reg?.visibility || dashboardVisibility || "public",
    };
  }
  return selections;
}

/**
 * PublishDashboardModal — multi-step stepper for preparing a dashboard
 * for registry publishing.
 *
 * Steps:
 *   0. Account — Auth check, sign-in prompt, profile display
 *   1. Details — Author name (pre-filled from profile) + description (textarea)
 *   2. Tags — Predefined tag selection with toggle-pill styling
 *   3. Icon — Full icon picker with search
 *   4. Publish — Review summary, publish action, result display
 */
export const PublishDashboardModal = ({
  isOpen,
  setIsOpen,
  appId,
  workspaceId,
  workspaceName,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  // Validate auth before the (multi-step) publish batch so an expired token
  // pops the sign-in gate up front rather than aborting mid-batch with a
  // generic error after some widgets already published.
  const { ensureAuthed, authGate } = useRegistryAuthGate();
  // Stepper state
  const [step, setStep] = useState(0);

  // Step 0: Account / Auth
  const [authStatus, setAuthStatus] = useState("loading"); // "loading" | "authenticated" | "unauthenticated"
  const [profile, setProfile] = useState(null);
  const [authFlow, setAuthFlow] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Step 1: Details
  const [authorName, setAuthorName] = useState("");
  const [description, setDescription] = useState("");

  // Step 2: Tags
  const [selectedTags, setSelectedTags] = useState([]);

  // Step 3: Icon
  const [icon, setIcon] = useState("grip");

  // Publish preview (widget names)
  const [preview, setPreview] = useState(null);

  // Step 4: Dependencies — enriched plan (local + registry state) + per-dep user selections
  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState(null);
  // selections keyed by `${scope}/${name}`: { include, bump, visibility }
  const [depSelections, setDepSelections] = useState({});

  // Step 5: Defaults verification — surfaced values from each owned
  // widget package's `.dash.js` userConfig[field].defaultValue. Lets
  // the publisher review (and optionally blank/edit) values set
  // during development before the ZIP ships.
  //   defaultsByPackage: { [packageId]: Array<{widgetName, field, currentDefault, displayName, type, instructions}> }
  //   defaultsOverrides: { [packageId]: { [widgetName]: { [field]: newValue } } }
  //     — only fields the user actually edited appear here. Undefined
  //     = "no change"; explicit empty-string = "blank it out".
  const [defaultsByPackage, setDefaultsByPackage] = useState({});
  const [defaultsLoading, setDefaultsLoading] = useState(false);
  const [defaultsOverrides, setDefaultsOverrides] = useState({});

  // Step 6: Publish
  const [isPublishing, setIsPublishing] = useState(false);
  const [result, setResult] = useState(null);
  // Per-step progress during batch publish
  const [publishSteps, setPublishSteps] = useState([]);

  // Visibility — chosen on the Details step. Defaults to public.
  const [visibility, setVisibility] = useState("public");

  // Dashboard version bump — chosen on the Details step. Defaults to
  // "patch" so repeat-publishes auto-increment the registry's
  // latestVersion. Without this, every republish used the same
  // version string, the registry never saw a new version, and update
  // notifications never fired on installers.
  const [dashboardBump, setDashboardBump] = useState("patch");

  // Fetch publish preview (widget names) on open
  useEffect(() => {
    if (!isOpen || !appId || !workspaceId) return;
    window.mainApi.dashboardConfig
      .getPublishPreview(appId, workspaceId)
      .then((res) => {
        if (res.success) setPreview(res);
      })
      .catch(console.error);
  }, [isOpen, appId, workspaceId]);

  // Check auth status on mount
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function checkAuth() {
      try {
        const status = await window.mainApi.registryAuth.getStatus();
        if (cancelled) return;

        if (status.authenticated) {
          const userProfile = await window.mainApi.registryAuth.getProfile();
          if (cancelled) return;
          if (userProfile) {
            setProfile(userProfile);
            setAuthStatus("authenticated");
            setAuthorName(
              userProfile.displayName || userProfile.username || "",
            );
          } else {
            // Token expired or invalid — treat as unauthenticated
            setAuthStatus("unauthenticated");
          }
        } else {
          setAuthStatus("unauthenticated");
        }
      } catch {
        if (!cancelled) setAuthStatus("unauthenticated");
      }
    }

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  function resetState() {
    setStep(0);
    setAuthStatus("loading");
    setProfile(null);
    setAuthFlow(null);
    setIsPolling(false);
    setAuthError(null);
    setAuthorName("");
    setDescription("");
    setSelectedTags([]);
    setIcon("grip");
    setPreview(null);
    setIsPublishing(false);
    setResult(null);
    setVisibility("public");
    setPlan(null);
    setPlanLoading(false);
    setPlanError(null);
    setDepSelections({});
    setPublishSteps([]);
  }

  function handleClose() {
    setIsOpen(false);
    setTimeout(resetState, 200);
  }

  function handleStepChange(nextStep) {
    if (step === 0 && nextStep > 0 && authStatus !== "authenticated") return;
    if (step === 1 && nextStep > 1 && !authorName.trim()) return;
    if (step === 2 && nextStep > 2 && selectedTags.length === 0) return;
    setStep(nextStep);
  }

  // Load the enriched dependency plan when user enters the Dependencies
  // step. Seeds per-dep selections: owned + not published OR owned + upstream
  // changed → include. Third-party refs stay read-only.
  useEffect(() => {
    if (!isOpen || step !== 4 || plan || planLoading) return;
    setPlanLoading(true);
    setPlanError(null);
    window.mainApi.dashboardConfig
      .getDashboardPublishPlan(appId, workspaceId, {
        componentConfigs: collectComponentConfigs(),
      })
      .then((res) => {
        if (!res?.success) {
          setPlanError(res?.error || "Failed to load publish plan");
          setPlanLoading(false);
          return;
        }
        setPlan(res);
        setDepSelections(seedSelections(res, visibility));
        setPlanLoading(false);
      })
      .catch((err) => {
        console.error("[PublishDashboardModal] plan error:", err);
        setPlanError(err.message || "Failed to load publish plan");
        setPlanLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isOpen]);

  // Load per-package default-value scans when the user arrives at the
  // Defaults step. We only scan packages that are actually going to be
  // republished (include + owned) to keep the step focused — a
  // third-party package the user isn't republishing can't have its
  // defaults changed anyway.
  useEffect(() => {
    if (!isOpen || step !== 5 || !plan || defaultsLoading) return;
    const packagesToScan = [];
    for (const w of plan.widgets || []) {
      if (!w.scope || !w.packageName) continue;
      const key = `${w.scope}/${w.packageName}`;
      const sel = depSelections[key];
      if (!sel?.include || !sel?.owned) continue;
      // Resolve the local package id the scanner expects — same shape
      // the inspect IPC already takes.
      const localPkgId = w.packageId || `@${w.scope}/${w.packageName}`;
      if (!defaultsByPackage[localPkgId]) packagesToScan.push(localPkgId);
    }
    if (packagesToScan.length === 0) return;
    setDefaultsLoading(true);
    Promise.all(
      packagesToScan.map((pkgId) =>
        window.mainApi.registry
          .scanWidgetDefaults(pkgId)
          .then((res) => ({ pkgId, res }))
          .catch((err) => ({
            pkgId,
            res: { success: false, error: err?.message || String(err) },
          })),
      ),
    ).then((results) => {
      setDefaultsByPackage((prev) => {
        const next = { ...prev };
        for (const { pkgId, res } of results) {
          next[pkgId] = res?.success ? res.defaults || [] : [];
        }
        return next;
      });
      setDefaultsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isOpen, plan, depSelections]);

  function setDefaultOverride(packageId, widgetName, field, newValue) {
    setDefaultsOverrides((prev) => {
      const next = { ...prev };
      const forPkg = { ...(next[packageId] || {}) };
      const forWidget = { ...(forPkg[widgetName] || {}) };
      if (newValue === undefined) {
        delete forWidget[field];
      } else {
        forWidget[field] = newValue;
      }
      if (Object.keys(forWidget).length === 0) {
        delete forPkg[widgetName];
      } else {
        forPkg[widgetName] = forWidget;
      }
      if (Object.keys(forPkg).length === 0) {
        delete next[packageId];
      } else {
        next[packageId] = forPkg;
      }
      return next;
    });
  }

  function updateDepSelection(key, patch) {
    setDepSelections((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }

  function toggleTag(tag) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  async function handlePublish() {
    if (!appId || !workspaceId) return;
    if (
      !(await ensureAuthed({
        message: "Sign in to the registry to publish this dashboard.",
      }))
    )
      return;
    setIsPublishing(true);
    setResult(null);

    // Build the ordered step list: one step per unique widget package,
    // then theme, then the dashboard itself. Third-party deps aren't
    // published — they're just referenced by the manifest.
    const steps = [];
    if (plan) {
      const seenPackages = new Set();
      for (const w of plan.widgets || []) {
        if (!w.scope || !w.packageName) continue;
        const key = `${w.scope}/${w.packageName}`;
        if (seenPackages.has(key)) continue;
        const sel = depSelections[key];
        if (!sel || !sel.owned || !sel.include) continue;
        seenPackages.add(key);
        steps.push({
          kind: "widget",
          key,
          label: `Publish widget ${key}`,
          packageId: w.packageId || `${w.scope}/${w.packageName}`,
          selection: sel,
        });
      }
      if (plan.theme && plan.theme.scope && plan.theme.name) {
        const key = `${plan.theme.scope}/${plan.theme.name}`;
        const sel = depSelections[key];
        if (sel?.owned && sel.include) {
          steps.push({
            kind: "theme",
            key,
            label: `Publish theme ${plan.theme.themeKey || key}`,
            themeKey: plan.theme.themeKey,
            selection: sel,
          });
        }
      }
    }
    steps.push({
      kind: "dashboard",
      key: "dashboard",
      label: `Publish dashboard`,
    });

    // Initialize progress state (pending for all)
    setPublishSteps(
      steps.map((s) => ({ ...s, status: "pending", message: null })),
    );

    const updateStep = (idx, patch) => {
      setPublishSteps((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });
    };

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        updateStep(i, { status: "running" });

        if (step.kind === "widget") {
          const bump = step.selection.bump;
          const options = {
            ...(bump && bump !== "none" ? { bump } : {}),
            visibility: step.selection.visibility,
            // Plumb the publisher's display name through to the widget
            // publish call so the manifest — and the rewritten dash.json
            // inside the zipped package — records the actual human who
            // published, not the AI Widget Builder's "AI Assistant"
            // placeholder.
            authorName: authorName.trim() || undefined,
            // Per-widget, per-field userConfig defaults the publisher
            // verified on the Defaults step. Absent keys preserve the
            // existing defaultValue; explicit empty string blanks it.
            // The electron side stages a copy of the package under
            // os.tmpdir(), rewrites the .dash.js entries, and zips
            // from that — the publisher's source files stay untouched.
            ...(defaultsOverrides[step.packageId]
              ? { defaultsOverride: defaultsOverrides[step.packageId] }
              : {}),
          };
          const res = await window.mainApi.registry.publishWidget(
            appId,
            step.packageId,
            options,
          );
          if (!res?.success) {
            updateStep(i, {
              status: "error",
              message: res?.error || "Publish failed",
            });
            setResult({
              success: false,
              error: `Failed to publish widget ${step.key}: ${res?.error || "unknown error"}`,
            });
            setIsPublishing(false);
            return;
          }
          updateStep(i, {
            status: "complete",
            message: `v${res.newVersion || res.manifest?.version}`,
          });
        } else if (step.kind === "theme") {
          const res = await window.mainApi.themes.publishTheme(
            appId,
            step.themeKey,
            { visibility: step.selection.visibility },
          );
          if (!res?.success) {
            updateStep(i, {
              status: "error",
              message: res?.error || "Theme publish failed",
            });
            setResult({
              success: false,
              error: `Failed to publish theme ${step.themeKey}: ${res?.error || "unknown error"}`,
            });
            setIsPublishing(false);
            return;
          }
          updateStep(i, {
            status: "complete",
            message: "published",
          });
        } else if (step.kind === "dashboard") {
          const options = {
            authorName: authorName.trim(),
            description: description.trim() || undefined,
            tags: selectedTags,
            icon: icon || undefined,
            visibility,
            componentConfigs: collectComponentConfigs(),
            // Thread the bump through. "none" means keep the current
            // version (caller should pass nothing). Any other value
            // goes to resolveNextVersion backend-side.
            ...(dashboardBump && dashboardBump !== "none"
              ? { bump: dashboardBump }
              : {}),
          };
          const res =
            await window.mainApi.dashboardConfig.prepareDashboardForPublish(
              appId,
              workspaceId,
              options,
            );
          if (!res?.success) {
            updateStep(i, {
              status: "error",
              message: res?.error || "Dashboard publish failed",
            });
            setResult({
              success: false,
              error: res?.error || "Failed to publish dashboard",
            });
            setIsPublishing(false);
            return;
          }
          updateStep(i, { status: "complete", message: "published" });
          setResult(res);
        }
      }
    } catch (err) {
      console.error("[PublishDashboardModal] Publish error:", err);
      setResult({
        success: false,
        error: err.message || "Failed to prepare dashboard for publish.",
      });
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleSignIn() {
    setAuthError(null);
    try {
      const flow = await window.mainApi.registryAuth.initiateLogin();
      setAuthFlow(flow);

      // Open verification URL in browser
      if (flow.verificationUrlComplete) {
        window.mainApi.shell.openExternal(flow.verificationUrlComplete);
      }

      // Start polling
      setIsPolling(true);
      const interval = (flow.interval || 5) * 1000;
      const poll = setInterval(async () => {
        try {
          const pollResult = await window.mainApi.registryAuth.pollToken(
            flow.deviceCode,
          );
          if (pollResult.status === "authorized") {
            clearInterval(poll);
            setIsPolling(false);
            setAuthFlow(null);
            // Fetch profile and update auth state
            const userProfile = await window.mainApi.registryAuth.getProfile();
            setProfile(userProfile);
            setAuthStatus("authenticated");
            if (userProfile?.displayName && !authorName) {
              setAuthorName(userProfile.displayName);
            }
          } else if (pollResult.status === "expired") {
            clearInterval(poll);
            setIsPolling(false);
            setAuthFlow(null);
          }
        } catch {
          clearInterval(poll);
          setIsPolling(false);
        }
      }, interval);
    } catch (err) {
      console.error("[PublishDashboardModal] Sign-in error:", err);
      setAuthError(
        "Could not reach the registry. Check your connection and try again.",
      );
    }
  }

  async function handleSignOut() {
    try {
      await window.mainApi.registryAuth.logout();
      setAuthStatus("unauthenticated");
      setProfile(null);
    } catch (err) {
      console.error("[PublishDashboardModal] Sign-out error:", err);
    }
  }

  // Steps: 0=Account, 1=Details, 2=Tags, 3=Icon, 4=Dependencies, 5=Defaults, 6=Publish
  const isLastStep = step === 6;
  const canAdvance =
    step === 0
      ? authStatus === "authenticated"
      : step === 1
        ? !!authorName.trim()
        : step === 2
          ? selectedTags.length > 0
          : step === 4
            ? !planLoading
            : step === 5
              ? !defaultsLoading
              : true;

  return (
    <>
      <Modal
        isOpen={isOpen}
        setIsOpen={handleClose}
        width="w-full max-w-2xl"
        height="h-[70vh]"
      >
        <div
          className={`flex flex-col h-full rounded-lg overflow-clip border ${panelStyles.backgroundColor || ""} ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
        >
          {/* Header */}
          <div className="flex-shrink-0 flex flex-row items-center justify-between p-4 border-b border-white/10">
            <span className="text-lg font-semibold">
              Publish "{workspaceName || "Dashboard"}"
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
            >
              <FontAwesomeIcon icon="xmark" className="h-5 w-5" />
            </button>
          </div>

          {/* Body — Stepper */}
          <Stepper
            activeStep={step}
            onStepChange={handleStepChange}
            showNavigation={false}
            className="flex-1 min-h-0 flex flex-col px-6 pt-2"
          >
            {/* Step 0: Account */}
            <Stepper.Step label="Account">
              <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-5">
                {authStatus === "loading" && (
                  <div className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-3 text-sm opacity-60">
                      <FontAwesomeIcon
                        icon="spinner"
                        className="h-4 w-4 animate-spin"
                      />
                      <span>Checking account status...</span>
                    </div>
                  </div>
                )}
                {authStatus === "authenticated" && profile && (
                  <div className="space-y-4">
                    <p className="text-sm opacity-70">
                      You're signed in and ready to publish.
                    </p>
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4 flex items-center gap-4">
                      <div className="flex items-center justify-center h-10 w-10 rounded-full bg-green-500/20 border border-green-500/30">
                        <FontAwesomeIcon
                          icon="circle-check"
                          className="h-5 w-5 text-green-400"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {profile.displayName || profile.username}
                        </div>
                        <div className="text-xs opacity-50 truncate">
                          @{profile.username}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="text-xs opacity-40 hover:opacity-70 transition-opacity cursor-pointer"
                    >
                      Sign out
                    </button>
                  </div>
                )}
                {authStatus === "unauthenticated" && (
                  <div className="space-y-4">
                    <p className="text-sm opacity-70">
                      Sign in to the Dash Registry to publish your dashboard.
                    </p>
                    {!authFlow && !isPolling && (
                      <>
                        <button
                          type="button"
                          onClick={handleSignIn}
                          className="px-4 py-2 rounded-lg text-sm bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-colors cursor-pointer"
                        >
                          Sign in to Registry
                        </button>
                        {authError && (
                          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                              <FontAwesomeIcon
                                icon="circle-xmark"
                                className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0"
                              />
                              <span className="text-xs text-red-300/90">
                                {authError}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {authFlow && isPolling && (
                      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-3">
                        <p className="text-xs text-blue-300/90">
                          Enter this code in your browser:
                        </p>
                        <div className="text-center">
                          <span className="text-2xl font-mono font-bold tracking-widest text-white">
                            {authFlow.userCode}
                          </span>
                        </div>
                        <p className="text-xs text-blue-300/70 text-center">
                          Waiting for authorization...
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Stepper.Step>

            {/* Step 1: Details */}
            <Stepper.Step label="Details">
              <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-5">
                <p className="text-sm opacity-70">
                  Provide details about your dashboard for the registry listing.
                </p>
                <div>
                  <label className="block text-sm font-medium opacity-70 mb-1">
                    Author Name
                  </label>
                  <div className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm opacity-80">
                    {authorName || "—"}
                  </div>
                </div>
                {preview &&
                  preview.componentNames &&
                  preview.componentNames.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium opacity-70 mb-2">
                        Widgets Included
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {preview.componentNames.map((name) => (
                          <Tag3 key={name} text={name} />
                        ))}
                      </div>
                    </div>
                  )}
                <TextArea
                  label="Description"
                  value={description}
                  onChange={setDescription}
                  placeholder="A brief description of this dashboard..."
                  rows={3}
                />
                {/* Version bump — controls what version the registry
                  publishes under. "Patch" is the default so a
                  republish bumps latestVersion and triggers update
                  notifications on installers. "Keep current version"
                  is an escape hatch for typo-fix republishes. */}
                <div>
                  <label className="block text-sm font-medium opacity-70 mb-2">
                    Version Bump
                  </label>
                  <select
                    value={dashboardBump}
                    onChange={(e) => setDashboardBump(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm"
                  >
                    {BUMP_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium opacity-70 mb-2">
                    Visibility
                  </label>
                  <div className="space-y-2">
                    {[
                      {
                        value: "public",
                        label: "Public",
                        desc: "Anyone can find and install this dashboard.",
                      },
                      {
                        value: "private",
                        label: "Private",
                        desc: "Only you and users you grant access to can install. The package is hidden from search and listings.",
                      },
                    ].map((opt) => {
                      const active = visibility === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setVisibility(opt.value)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                            active
                              ? "bg-indigo-900/20 border-indigo-500/60"
                              : "bg-white/5 border-white/10 hover:bg-white/10"
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <div
                              className={`mt-0.5 h-4 w-4 rounded-full border flex-shrink-0 ${
                                active
                                  ? "border-indigo-400 bg-indigo-500"
                                  : "border-white/30"
                              }`}
                            >
                              {active && (
                                <div className="h-full w-full rounded-full border-2 border-gray-900" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium">
                                {opt.label}
                              </div>
                              <div className="text-xs opacity-60 mt-0.5">
                                {opt.desc}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Stepper.Step>

            {/* Step 2: Tags */}
            <Stepper.Step label="Tags">
              <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-5">
                <p className="text-sm opacity-70">
                  Select at least one tag to categorize your dashboard.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {DASHBOARD_TAGS.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-white/15 border-white/30 text-white"
                            : "bg-transparent border-white/10 text-white/60 hover:border-white/20 hover:text-white/80"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Stepper.Step>

            {/* Step 3: Icon */}
            <Stepper.Step label="Icon">
              <div className="flex-1 min-h-0 flex flex-col pb-4">
                <IconPicker selectedIcon={icon} onSelectIcon={setIcon} />
              </div>
            </Stepper.Step>

            {/* Step 4: Dependencies */}
            <Stepper.Step label="Dependencies">
              <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-4">
                <p className="text-sm opacity-70">
                  Choose which owned widgets + theme to publish alongside this
                  dashboard. Third-party dependencies are referenced only —
                  users install them separately.
                </p>

                {planLoading && (
                  <div className="text-sm opacity-60 py-6 text-center">
                    Resolving dependencies…
                  </div>
                )}

                {planError && (
                  <div className="p-3 bg-red-900/20 border border-red-700/40 rounded text-sm text-red-200">
                    {planError}
                  </div>
                )}

                {plan?.registryError && (
                  <div className="p-2 bg-amber-900/20 border border-amber-700/40 rounded text-xs text-amber-200">
                    Registry lookup failed: {plan.registryError}. Dependencies
                    shown are local-only.
                  </div>
                )}

                {plan && !planLoading && (
                  <DependencyTable
                    plan={plan}
                    selections={depSelections}
                    onChange={updateDepSelection}
                  />
                )}
              </div>
            </Stepper.Step>

            {/* Step 5: Defaults — verify per-field defaultValue entries
              across every owned widget package about to be republished.
              Edits here stage into a temp copy at publish time; the
              publisher's source files stay untouched. */}
            <Stepper.Step label="Defaults">
              <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-4">
                <p className="text-sm opacity-70">
                  Review <code>userConfig</code> default values the widget's
                  dev-time dash.js ships. Anything you leave as-is gets
                  published as the current default. Values you blank or edit
                  here get rewritten in a staged copy before the ZIP is built —
                  your local source files are untouched.
                </p>
                {defaultsLoading && (
                  <div className="text-sm opacity-60 py-6 text-center">
                    Scanning widget configs for default values…
                  </div>
                )}
                {!defaultsLoading && (
                  <DefaultsReviewList
                    plan={plan}
                    depSelections={depSelections}
                    defaultsByPackage={defaultsByPackage}
                    overrides={defaultsOverrides}
                    onChange={setDefaultOverride}
                  />
                )}
              </div>
            </Stepper.Step>

            {/* Step 6: Publish */}
            <Stepper.Step label="Publish">
              <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-4">
                {/* Show live per-step progress during batch publish */}
                {(isPublishing || publishSteps.length > 0) && (
                  <PublishProgressList steps={publishSteps} />
                )}
                {!result && !isPublishing && publishSteps.length === 0 ? (
                  <>
                    <p className="text-sm opacity-70">
                      Review your dashboard details before publishing.
                    </p>
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex gap-2">
                        <span className="opacity-50 w-20 flex-shrink-0">
                          Author
                        </span>
                        <span>{authorName}</span>
                      </div>
                      {description.trim() && (
                        <div className="flex gap-2">
                          <span className="opacity-50 w-20 flex-shrink-0">
                            Description
                          </span>
                          <span>{description}</span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <span className="opacity-50 w-20 flex-shrink-0">
                          Tags
                        </span>
                        <span>
                          {selectedTags.length > 0
                            ? selectedTags.join(", ")
                            : "None"}
                        </span>
                      </div>
                      <div className="flex gap-2 items-center">
                        <span className="opacity-50 w-20 flex-shrink-0">
                          Icon
                        </span>
                        <FontAwesomeIcon
                          icon={icon || "grip"}
                          className="h-4 w-4"
                        />
                        <span className="opacity-70">{icon || "grip"}</span>
                      </div>
                      {preview &&
                        preview.componentNames &&
                        preview.componentNames.length > 0 && (
                          <div className="flex gap-2">
                            <span className="opacity-50 w-20 flex-shrink-0">
                              Widgets
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {preview.componentNames.map((name) => (
                                <Tag3 key={name} text={name} />
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  </>
                ) : result?.success ? (
                  <div className="space-y-3">
                    {/* Registry publish result */}
                    {result.registrySubmission?.success ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon
                            icon="circle-check"
                            className="h-4 w-4 text-green-400"
                          />
                          <span className="text-sm">
                            Published to Dash Registry
                          </span>
                        </div>
                        {result.registrySubmission.registryUrl && (
                          <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                            <div className="text-xs opacity-50 mb-1">
                              Shareable Link
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                window.mainApi.shell.openExternal(
                                  result.registrySubmission.registryUrl,
                                )
                              }
                              className="text-sm text-blue-400 hover:underline cursor-pointer break-all text-left"
                            >
                              {result.registrySubmission.registryUrl}
                            </button>
                          </div>
                        )}
                        {result.registrySubmission.version && (
                          <div className="text-xs opacity-50">
                            Version: v{result.registrySubmission.version}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <FontAwesomeIcon
                            icon="circle-check"
                            className="h-4 w-4 text-green-400"
                          />
                          <span className="text-sm">
                            Dashboard prepared for publishing.
                          </span>
                        </div>
                        {result.registrySubmission?.error && (
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                              <FontAwesomeIcon
                                icon="triangle-exclamation"
                                className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0"
                              />
                              <span className="text-xs text-amber-300/90">
                                Registry upload failed:{" "}
                                {result.registrySubmission.error}. Your
                                dashboard was saved locally.
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {result.filePath && (
                      <div className="text-xs opacity-50 break-all">
                        Saved to: {result.filePath}
                      </div>
                    )}
                    {result.warnings && result.warnings.length > 0 && (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <FontAwesomeIcon
                            icon="triangle-exclamation"
                            className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0"
                          />
                          <span className="text-xs text-amber-300/90">
                            The following widgets are not currently on the
                            registry. This may be intentional if they are
                            private. Dashboards referencing these widgets can
                            only be installed by users who already have them.
                          </span>
                        </div>
                        <div className="space-y-2 mt-1">
                          {result.warnings.map((w) => (
                            <div key={w.package}>
                              <div className="text-xs font-semibold opacity-60">
                                {w.package}
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {w.widgets.map((name) => (
                                  <Tag3 key={name} text={name} />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {result.registryCheckFailed && (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <FontAwesomeIcon
                            icon="triangle-exclamation"
                            className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0"
                          />
                          <span className="text-xs text-amber-300/90">
                            Unable to reach the registry to verify widget
                            availability. Your dashboard was still prepared
                            successfully.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : result ? (
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon
                      icon="circle-xmark"
                      className="h-4 w-4 text-red-400"
                    />
                    <span className="text-sm text-red-400">
                      {result.error || "Publish preparation failed."}
                    </span>
                  </div>
                ) : null}
              </div>
            </Stepper.Step>
          </Stepper>

          {/* Footer */}
          <div className="flex-shrink-0 flex flex-row items-center px-6 py-4 border-t border-white/10">
            <div className="flex flex-row gap-2">
              <Button3
                title={step === 0 ? "Cancel" : "Back"}
                onClick={step === 0 ? handleClose : () => setStep(step - 1)}
                disabled={isPublishing}
              />
            </div>
            <div className="flex-1 text-center">
              <span className="text-xs opacity-40">Step {step + 1} of 7</span>
            </div>
            <div className="flex flex-row gap-2">
              {result?.success ? (
                <Button2 title="Done" onClick={handleClose} />
              ) : isLastStep ? (
                <Button2
                  title={isPublishing ? "Publishing..." : "Publish"}
                  onClick={handlePublish}
                  disabled={isPublishing}
                />
              ) : (
                <Button2
                  title="Next"
                  onClick={() => handleStepChange(step + 1)}
                  disabled={!canAdvance}
                />
              )}
            </div>
          </div>
        </div>
      </Modal>
      {authGate}
    </>
  );
};

/**
 * Compact per-step progress list shown during batch publish.
 */
function PublishProgressList({ steps }) {
  if (!steps || steps.length === 0) return null;
  const iconFor = (status) => {
    switch (status) {
      case "complete":
        return { icon: "circle-check", color: "text-green-400" };
      case "running":
        return { icon: "spinner", color: "text-indigo-400 animate-spin" };
      case "error":
        return { icon: "circle-xmark", color: "text-red-400" };
      default:
        return { icon: "circle", color: "opacity-30" };
    }
  };
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-1.5 text-sm">
      {steps.map((s, i) => {
        const { icon, color } = iconFor(s.status);
        return (
          <div key={i} className="flex items-center gap-2">
            <FontAwesomeIcon icon={icon} className={`h-3.5 w-3.5 ${color}`} />
            <span className="flex-1 truncate">{s.label}</span>
            {s.message && (
              <span
                className={`text-xs ${
                  s.status === "error" ? "text-red-300" : "opacity-60"
                }`}
              >
                {s.message}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Table of widget + theme dependencies. Owned rows are editable (include,
 * bump, visibility). Third-party rows show as read-only references.
 */
function DependencyTable({ plan, selections, onChange }) {
  // Dedupe: multiple widgets from the same package collapse into a single
  // row. Each row shows the list of component widgets that live inside it
  // so the user knows what's getting published.
  const byKey = new Map();
  for (const w of plan.widgets || []) {
    if (!w.scope || !w.packageName) continue;
    const key = `${w.scope}/${w.packageName}`;
    const entry = byKey.get(key) || {
      key,
      kind: "widget",
      data: w,
      widgetNames: new Set(),
    };
    if (w.component) entry.widgetNames.add(w.component);
    byKey.set(key, entry);
  }
  const rows = Array.from(byKey.values()).map((e) => ({
    ...e,
    widgetNames: Array.from(e.widgetNames).sort(),
  }));
  if (plan.theme && plan.theme.scope && plan.theme.name) {
    const key = `${plan.theme.scope}/${plan.theme.name}`;
    rows.push({ key, kind: "theme", data: plan.theme, widgetNames: [] });
  }

  if (rows.length === 0) {
    return (
      <div className="text-sm opacity-60 py-6 text-center">
        No dependencies detected.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map(({ key, kind, data, widgetNames }) => {
        const sel = selections[key];
        if (!sel) return null;
        const reg = data.registry;
        return (
          <div
            key={key}
            className="bg-white/5 border border-white/10 rounded-lg p-3"
          >
            <div className="flex items-start gap-3">
              {/* Include toggle — only for owned deps. Widgets under
                  a local-only scope (e.g. @ai-built/*) MUST be
                  republished under the publisher's scope, otherwise
                  the dashboard's dep ref won't resolve for installers.
                  For those, the checkbox is forced-checked and
                  disabled — treat as mandatory, not opt-in. */}
              <div className="pt-0.5">
                {data?.requiresRepublish && sel.owned ? (
                  <input
                    type="checkbox"
                    checked
                    disabled
                    className="h-4 w-4 accent-indigo-500 cursor-not-allowed opacity-80"
                    title="Required — this widget only exists under a local scope and must be republished under your registry scope for installers to resolve it."
                  />
                ) : sel.owned ? (
                  <input
                    type="checkbox"
                    checked={sel.include}
                    onChange={(e) =>
                      onChange(key, { include: e.target.checked })
                    }
                    className="h-4 w-4 accent-indigo-500 cursor-pointer"
                  />
                ) : (
                  <FontAwesomeIcon
                    icon="lock"
                    className="h-3 w-3 opacity-40"
                    title="Third-party — referenced only"
                  />
                )}
              </div>

              <div className="flex-1 min-w-0">
                {/* Name row — show publish identity (what ends up in the
                    registry) as primary, with the local identity as a
                    subtle annotation when it differs. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-sm font-medium truncate font-mono">
                    @{data.publishScope || data.scope}/
                    {data.packageName || data.name}
                  </div>
                  {data.publishScope &&
                    data.scope &&
                    data.publishScope !== data.scope && (
                      <span className="text-[10px] opacity-50 font-mono">
                        (local @{data.scope}/{data.packageName})
                      </span>
                    )}
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      kind === "theme"
                        ? "bg-purple-900/30 text-purple-200"
                        : "bg-blue-900/30 text-blue-200"
                    }`}
                  >
                    {kind}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      sel.owned
                        ? "bg-emerald-900/30 text-emerald-200"
                        : "bg-gray-700/40 text-gray-300"
                    }`}
                  >
                    {sel.owned ? "owned" : "third-party"}
                  </span>
                </div>

                {/* Version state row */}
                <div className="text-xs opacity-60 mt-1">
                  Local v{data.localVersion || "?"}
                  {reg?.exists ? (
                    <>
                      {" "}
                      · Registry v{reg.latestVersion} ({reg.visibility})
                    </>
                  ) : (
                    <> · Not yet in registry</>
                  )}
                </div>

                {/* Bundled widgets (only for widget packages) */}
                {kind === "widget" && widgetNames && widgetNames.length > 0 && (
                  <div className="text-[11px] opacity-60 mt-1">
                    Bundles {widgetNames.length} widget
                    {widgetNames.length === 1 ? "" : "s"}:{" "}
                    <span className="opacity-80">{widgetNames.join(", ")}</span>
                  </div>
                )}

                {/* Edit controls (owned only) */}
                {sel.owned && sel.include && (
                  <div className="mt-2 flex items-center gap-3 flex-wrap">
                    <label className="text-xs opacity-60 flex items-center gap-2">
                      Bump
                      <select
                        value={sel.bump}
                        onChange={(e) =>
                          onChange(key, { bump: e.target.value })
                        }
                        className="text-xs bg-gray-800 border border-white/10 rounded px-2 py-1"
                      >
                        {BUMP_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs opacity-60 flex items-center gap-2">
                      Visibility
                      <select
                        value={sel.visibility}
                        onChange={(e) =>
                          onChange(key, { visibility: e.target.value })
                        }
                        className="text-xs bg-gray-800 border border-white/10 rounded px-2 py-1"
                      >
                        <option value="public">public</option>
                        <option value="private">private</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Per-package editable list of every non-empty userConfig default.
 * Renders once per owned package selected for republish. Edits are
 * two-way: typing into a field stages an override; hitting "Reset"
 * clears the override so the original defaultValue ships. The
 * outside world treats `overrides[packageId][widgetName][field]` as
 * the source of truth for the publish call.
 */
function DefaultsReviewList({
  plan,
  depSelections,
  defaultsByPackage,
  overrides,
  onChange,
}) {
  // Collect the packages we're actually about to republish so the UI
  // stays aligned with Dependencies — no surprises about WHICH
  // package's defaults you're editing.
  const rows = [];
  for (const w of plan?.widgets || []) {
    if (!w.scope || !w.packageName) continue;
    const key = `${w.scope}/${w.packageName}`;
    const sel = depSelections[key];
    if (!sel?.include || !sel?.owned) continue;
    const localPkgId = w.packageId || `@${w.scope}/${w.packageName}`;
    const defaults = defaultsByPackage[localPkgId];
    if (!Array.isArray(defaults)) continue;
    rows.push({
      key,
      localPkgId,
      label: `@${w.scope}/${w.packageName}`,
      defaults,
    });
  }

  if (rows.length === 0) {
    return (
      <div className="text-sm opacity-60 py-6 text-center">
        No non-empty defaults found in any owned widget. Nothing to review.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.map(({ key, localPkgId, label, defaults }) => {
        if (defaults.length === 0) {
          return (
            <div
              key={key}
              className="border border-white/10 rounded-lg px-4 py-3 bg-white/5"
            >
              <div className="text-sm font-semibold font-mono">{label}</div>
              <div className="text-xs opacity-60 mt-1">
                No non-empty <code>defaultValue</code> entries detected.
              </div>
            </div>
          );
        }
        return (
          <div
            key={key}
            className="border border-white/10 rounded-lg px-4 py-3 bg-white/5"
          >
            <div className="text-sm font-semibold font-mono mb-2">{label}</div>
            <div className="flex flex-col gap-3">
              {defaults.map((d) => {
                const overriddenValue =
                  overrides?.[localPkgId]?.[d.widgetName]?.[d.field];
                const isOverridden = overriddenValue !== undefined;
                const displayValue = isOverridden
                  ? String(overriddenValue ?? "")
                  : String(d.currentDefault ?? "");
                return (
                  <div
                    key={`${d.widgetName}|${d.field}`}
                    className="flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs opacity-70">
                        {d.widgetName}.{d.field}
                      </code>
                      <span className="text-[10px] opacity-50">({d.type})</span>
                      <span className="text-[10px] opacity-50">
                        {d.displayName}
                      </span>
                      {isOverridden && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-200">
                          edited
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={displayValue}
                        onChange={(e) =>
                          onChange(
                            localPkgId,
                            d.widgetName,
                            d.field,
                            e.target.value,
                          )
                        }
                        className="flex-1 bg-gray-900 border border-white/10 rounded px-2 py-1 text-xs font-mono"
                      />
                      {isOverridden && (
                        <button
                          type="button"
                          onClick={() =>
                            onChange(
                              localPkgId,
                              d.widgetName,
                              d.field,
                              undefined,
                            )
                          }
                          className="text-xs opacity-60 hover:opacity-100 underline underline-offset-2"
                          title="Discard edit — ship the original defaultValue"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    {d.instructions && (
                      <div className="text-[10px] opacity-50">
                        {d.instructions}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
