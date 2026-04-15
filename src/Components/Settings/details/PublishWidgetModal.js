import React, { useState, useEffect, useContext } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  Modal,
  Button2,
  Button3,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";

const BUMP_OPTIONS = [
  { value: "none", label: "Keep current version" },
  { value: "patch", label: "Patch (bug fix)" },
  { value: "minor", label: "Minor (new feature)" },
  { value: "major", label: "Major (breaking change)" },
];

// Local copy of the pure semver bumper so the modal can show a preview of
// the new version without another IPC round-trip. Must stay in sync with
// electron/schema/widgetPublishManifest.js.
function bumpPreview(current, type) {
  if (!current || typeof current !== "string") return "1.0.0";
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return current;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      return current;
  }
}

/**
 * PublishWidgetModal — focused single-widget publish.
 *
 * Single-form (no stepper) because the widget's package.json already has
 * most metadata. User picks a bump level + visibility and clicks Publish.
 * Wraps mainApi.registry.publishWidget.
 */
export const PublishWidgetModal = ({ isOpen, setIsOpen, appId, widget }) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const [authStatus, setAuthStatus] = useState("loading");
  const [authError, setAuthError] = useState(null);
  const [username, setUsername] = useState(null);
  const [bump, setBump] = useState("patch");
  const [visibility, setVisibility] = useState("public");
  const [isPublishing, setIsPublishing] = useState(false);
  const [result, setResult] = useState(null);
  const [packageInfo, setPackageInfo] = useState(null);

  // Reset modal state on open
  useEffect(() => {
    if (!isOpen) return;
    setAuthError(null);
    setBump("patch");
    setVisibility("public");
    setIsPublishing(false);
    setResult(null);
    setPackageInfo(null);
  }, [isOpen]);

  // Inspect the package to get its metadata + component list
  useEffect(() => {
    if (!isOpen || !widget) return;
    let cancelled = false;
    const packageId = widget?.packageId || widget?.name;
    if (!packageId) return;
    window.mainApi.registry
      .inspectWidgetPackage(packageId)
      .then((res) => {
        if (cancelled) return;
        if (res?.success) setPackageInfo(res);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, widget]);

  // Check auth status + fetch username for the "publishing as" preview
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await window.mainApi.registryAuth.getStatus();
        if (cancelled) return;
        if (status?.authenticated) {
          const profile = await window.mainApi.registryAuth.getProfile();
          if (cancelled) return;
          setUsername(profile?.username || null);
          setAuthStatus(
            profile?.username ? "authenticated" : "unauthenticated",
          );
        } else {
          setAuthStatus("unauthenticated");
        }
      } catch {
        if (!cancelled) setAuthStatus("unauthenticated");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  function handleClose() {
    setIsOpen(false);
  }

  async function handleSignIn() {
    setAuthError(null);
    try {
      const flow = await window.mainApi.registryAuth.initiateLogin();
      if (flow?.verificationUrlComplete) {
        window.mainApi.shell.openExternal(flow.verificationUrlComplete);
      }
      // Poll for completion
      const pollInterval = (flow?.interval || 5) * 1000;
      const deadline = Date.now() + (flow?.expiresIn || 600) * 1000;
      const poll = async () => {
        while (Date.now() < deadline) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, pollInterval));
          // eslint-disable-next-line no-await-in-loop
          const res = await window.mainApi.registryAuth.pollToken(
            flow.deviceCode,
          );
          if (res?.status === "authorized") {
            setAuthStatus("authenticated");
            return;
          }
          if (res?.status === "error") {
            setAuthError(res.error || "Sign-in failed");
            return;
          }
        }
        setAuthError("Sign-in timed out");
      };
      poll();
    } catch (err) {
      setAuthError(err.message || "Sign-in failed");
    }
  }

  async function handlePublish() {
    if (!widget) return;
    setIsPublishing(true);
    setResult(null);
    try {
      const options = {
        visibility,
        ...(bump && bump !== "none" ? { bump } : {}),
      };
      const packageId = widget.packageId || widget.name;
      const res = await window.mainApi.registry.publishWidget(
        appId,
        packageId,
        options,
      );
      setResult(res);
    } catch (err) {
      setResult({
        success: false,
        error: err.message || "Publish failed",
      });
    } finally {
      setIsPublishing(false);
    }
  }

  if (!widget) return null;

  const currentVersion = widget.version || "1.0.0";
  const newVersion = bumpPreview(currentVersion, bump);
  const canPublish =
    authStatus === "authenticated" && !isPublishing && !result?.success;

  return (
    <Modal isOpen={isOpen} setIsOpen={handleClose} width="w-full max-w-lg">
      <div
        className={`flex flex-col rounded-lg overflow-clip border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex flex-row items-center justify-between p-4 border-b border-white/10">
          <span className="text-lg font-semibold truncate">
            Publish{" "}
            <span className="font-mono text-base">
              {packageInfo?.localScope
                ? `@${packageInfo.localScope}/${packageInfo.name}`
                : widget.packageId || widget.name}
            </span>
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <FontAwesomeIcon icon="xmark" className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {authStatus === "loading" && (
            <div className="text-sm opacity-60 text-center py-4">
              Checking registry connection…
            </div>
          )}

          {authStatus === "unauthenticated" && (
            <div className="space-y-3">
              <div className="p-3 bg-amber-900/20 border border-amber-700/40 rounded text-sm text-amber-200">
                You need to sign in to the Dash Registry to publish.
              </div>
              <Button2 title="Sign in to Registry" onClick={handleSignIn} />
              {authError && (
                <div className="text-xs text-red-300">{authError}</div>
              )}
            </div>
          )}

          {authStatus === "authenticated" && !result && (
            <>
              {/* Package summary */}
              <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm">
                <div className="flex gap-2">
                  <span className="opacity-50 w-28 flex-shrink-0">Local</span>
                  <span className="font-mono text-xs opacity-80">
                    {packageInfo?.localScope
                      ? `@${packageInfo.localScope}/${packageInfo.name}`
                      : widget.packageId || widget.name}
                  </span>
                </div>
                <div className="flex gap-2 mt-1">
                  <span className="opacity-50 w-28 flex-shrink-0">
                    Publishing as
                  </span>
                  <span className="font-mono text-xs text-indigo-300">
                    {username ? `@${username}/` : ""}
                    {packageInfo?.name ||
                      (widget.name || "").replace(/^@[^/]+\//, "")}
                    <span className="text-gray-400"> v{newVersion}</span>
                  </span>
                </div>
                <div className="flex gap-2 mt-1">
                  <span className="opacity-50 w-28 flex-shrink-0">Current</span>
                  <span>v{currentVersion}</span>
                </div>
              </div>

              {/* Components bundled inside this package */}
              {packageInfo?.components && packageInfo.components.length > 0 && (
                <div>
                  <label className="block text-sm font-medium opacity-70 mb-2">
                    Widgets in this package ({packageInfo.components.length})
                  </label>
                  <div className="bg-white/5 border border-white/10 rounded-lg divide-y divide-white/10 max-h-48 overflow-y-auto">
                    {packageInfo.components.map((c) => (
                      <div
                        key={c.name}
                        className="flex items-center gap-2 px-3 py-2 text-sm"
                      >
                        <FontAwesomeIcon
                          icon={c.icon || "square"}
                          className="h-3.5 w-3.5 opacity-60 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {c.displayName || c.name}
                          </div>
                          {c.description && (
                            <div className="text-xs opacity-60 truncate">
                              {c.description}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Version bump */}
              <div>
                <label className="block text-sm font-medium opacity-70 mb-2">
                  Version Bump
                </label>
                <select
                  value={bump}
                  onChange={(e) => setBump(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded px-3 py-2 text-sm"
                >
                  {BUMP_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-sm font-medium opacity-70 mb-2">
                  Visibility
                </label>
                <div className="space-y-2">
                  {[
                    {
                      value: "public",
                      label: "Public",
                      desc: "Anyone can find and install this widget.",
                    },
                    {
                      value: "private",
                      label: "Private",
                      desc: "Only you and users you grant access to can install.",
                    },
                  ].map((opt) => {
                    const active = visibility === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setVisibility(opt.value)}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
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
            </>
          )}

          {result?.success && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon
                  icon="circle-check"
                  className="h-4 w-4 text-green-400"
                />
                <span className="text-sm">
                  Published v{result.newVersion || result.manifest?.version}
                </span>
              </div>
              {result.registryResult?.registryUrl && (
                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                  <div className="text-xs opacity-50 mb-1">
                    Registry Package
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      window.mainApi.shell.openExternal(
                        result.registryResult.registryUrl,
                      )
                    }
                    className="text-sm text-indigo-300 hover:underline truncate block w-full text-left"
                  >
                    {result.registryResult.registryUrl}
                  </button>
                </div>
              )}
            </div>
          )}

          {result && !result.success && (
            <div className="p-3 bg-red-900/20 border border-red-700/40 rounded text-sm text-red-200">
              <div className="font-semibold mb-1">Publish failed</div>
              <div className="text-xs opacity-80">{result.error}</div>
              {Array.isArray(result.details) && result.details.length > 0 && (
                <ul className="text-xs opacity-70 mt-2 list-disc list-inside space-y-0.5">
                  {result.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex flex-row justify-end gap-2 p-4 border-t border-white/10">
          <Button3
            title={result?.success ? "Close" : "Cancel"}
            onClick={handleClose}
          />
          {!result?.success && (
            <Button2
              title={isPublishing ? "Publishing…" : "Publish"}
              onClick={handlePublish}
              disabled={!canPublish}
            />
          )}
        </div>
      </div>
    </Modal>
  );
};
