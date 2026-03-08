import React, { useState, useEffect, useContext } from "react";
import {
  ThemeContext,
  FontAwesomeIcon,
  Modal,
  Stepper,
  InputText,
  TextArea,
  Button2,
  Button3,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
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
  // Stepper state
  const [step, setStep] = useState(0);

  // Step 0: Account / Auth
  const [authStatus, setAuthStatus] = useState("loading"); // "loading" | "authenticated" | "unauthenticated"
  const [profile, setProfile] = useState(null);
  const [authFlow, setAuthFlow] = useState(null);
  const [isPolling, setIsPolling] = useState(false);

  // Step 1: Details
  const [authorName, setAuthorName] = useState("");
  const [description, setDescription] = useState("");

  // Step 2: Tags
  const [selectedTags, setSelectedTags] = useState([]);

  // Step 3: Icon
  const [icon, setIcon] = useState("grip");

  // Step 4: Publish
  const [isPublishing, setIsPublishing] = useState(false);
  const [result, setResult] = useState(null);

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
          setProfile(userProfile);
          setAuthStatus("authenticated");
          if (userProfile?.displayName && !authorName) {
            setAuthorName(userProfile.displayName);
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
    setAuthorName("");
    setDescription("");
    setSelectedTags([]);
    setIcon("grip");
    setIsPublishing(false);
    setResult(null);
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

  function toggleTag(tag) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  async function handlePublish() {
    if (!appId || !workspaceId) return;
    setIsPublishing(true);
    setResult(null);
    try {
      const options = {
        authorName: authorName.trim(),
        description: description.trim() || undefined,
        tags: selectedTags,
        icon: icon || undefined,
      };
      const res =
        await window.mainApi.dashboardConfig.prepareDashboardForPublish(
          appId,
          workspaceId,
          options,
        );
      setResult(res);
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

  const isLastStep = step === 4;
  const canAdvance =
    step === 0
      ? authStatus === "authenticated"
      : step === 1
        ? !!authorName.trim()
        : step === 2
          ? selectedTags.length > 0
          : true;

  return (
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
                    <button
                      type="button"
                      onClick={handleSignIn}
                      className="px-4 py-2 rounded-lg text-sm bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-colors cursor-pointer"
                    >
                      Sign in to Registry
                    </button>
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
              <InputText
                label="Author Name *"
                value={authorName}
                onChange={setAuthorName}
                placeholder="Your name"
              />
              <TextArea
                label="Description"
                value={description}
                onChange={setDescription}
                placeholder="A brief description of this dashboard..."
                rows={3}
              />
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

          {/* Step 4: Publish */}
          <Stepper.Step label="Publish">
            <div className="flex-1 min-h-0 overflow-y-auto pb-4 space-y-4">
              {!result ? (
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
                  </div>
                </>
              ) : result.success ? (
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
                              {result.registrySubmission.error}. Your dashboard
                              was saved locally.
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
                          registry. This may be intentional if they are private.
                          Dashboards referencing these widgets can only be
                          installed by users who already have them.
                        </span>
                      </div>
                      <ul className="text-xs opacity-60 pl-5 list-disc space-y-0.5">
                        {result.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
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
              ) : (
                <div className="flex items-center gap-2">
                  <FontAwesomeIcon
                    icon="circle-xmark"
                    className="h-4 w-4 text-red-400"
                  />
                  <span className="text-sm text-red-400">
                    {result.error || "Publish preparation failed."}
                  </span>
                </div>
              )}
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
            <span className="text-xs opacity-40">Step {step + 1} of 5</span>
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
  );
};
