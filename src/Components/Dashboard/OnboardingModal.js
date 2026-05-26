import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Modal,
  Button,
  Heading2,
  SubHeading,
  Paragraph,
  FontAwesomeIcon,
  ThemeContext,
} from "@trops/dash-react";

/**
 * OnboardingModal — Phase 3A of the MVP launch audit.
 *
 * First-run modal that walks a new user through installing the
 * curated "trops/kitchen-sink" dashboard from the registry. Four
 * logical states drive the body:
 *
 *   welcome    → one-line value prop + "Install Kitchen Sink" CTA +
 *                "Skip for now" escape hatch
 *   installing → per-step progress list streamed from the
 *                DASHBOARD_CONFIG_INSTALL_PROGRESS IPC channel
 *   done       → "Open Kitchen Sink" CTA that opens the installed
 *                workspace and marks onboarding completed
 *   error      → install failed; retry or skip
 *
 * Both the success path and the skip path call
 * `window.mainApi.onboarding.markCompleted` so the modal never
 * re-shows. The renderer-side gating (workspaces empty + packages
 * empty + flag unset) is owned by DashboardStage; this component
 * focuses on driving the install + writing the completion flag.
 *
 * The Kitchen Sink slug is centralized as a constant so future
 * onboarding variants can swap it without touching the install
 * plumbing.
 */

const KITCHEN_SINK_PACKAGE = "trops/kitchen-sink";

const STATE = {
  WELCOME: "welcome",
  INSTALLING: "installing",
  DONE: "done",
  ERROR: "error",
};

export const OnboardingModal = ({
  open,
  appId,
  onOpenDashboard,
  onDismiss,
  onComplete,
}) => {
  const { currentTheme } = useContext(ThemeContext) || {};
  const [state, setState] = useState(STATE.WELCOME);
  const [progressItems, setProgressItems] = useState([]);
  const [installError, setInstallError] = useState(null);
  const installResultRef = useRef(null);
  const cleanupProgressRef = useRef(null);

  useEffect(() => {
    if (open) {
      setState(STATE.WELCOME);
      setProgressItems([]);
      setInstallError(null);
      installResultRef.current = null;
    }
    return () => {
      if (cleanupProgressRef.current) {
        cleanupProgressRef.current();
        cleanupProgressRef.current = null;
      }
    };
  }, [open]);

  const markCompletedAndClose = useCallback(
    async (source) => {
      try {
        await window.mainApi?.onboarding?.markCompleted?.({ source });
      } catch (err) {
        // Best-effort — modal still dismisses. Worst case: next launch
        // re-shows the modal.
        console.error("[OnboardingModal] markCompleted failed:", err);
      }
      if (onComplete) onComplete({ source });
    },
    [onComplete],
  );

  const handleSkip = useCallback(async () => {
    await markCompletedAndClose("dismissed");
    if (onDismiss) onDismiss();
  }, [markCompletedAndClose, onDismiss]);

  const handleInstall = useCallback(async () => {
    if (!appId) {
      setInstallError(
        "Cannot install — application not initialized. Try again in a moment.",
      );
      setState(STATE.ERROR);
      return;
    }
    setState(STATE.INSTALLING);
    setProgressItems([]);
    setInstallError(null);

    if (cleanupProgressRef.current) cleanupProgressRef.current();
    cleanupProgressRef.current =
      window.mainApi?.dashboardConfig?.onInstallProgress?.((data) => {
        setProgressItems((prev) => {
          const next = prev.length > 0 ? [...prev] : [];
          if (next.length === 0 && typeof data.total === "number") {
            for (let i = 0; i < data.total; i += 1) {
              next.push({
                packageName: i === data.index ? data.packageName : "",
                displayName: i === data.index ? data.displayName : "",
                status: "pending",
              });
            }
          }
          if (
            typeof data.index === "number" &&
            data.index >= 0 &&
            data.index < next.length
          ) {
            next[data.index] = {
              packageName: data.packageName || next[data.index].packageName,
              displayName:
                data.displayName ||
                next[data.index].displayName ||
                data.packageName ||
                "",
              status: data.status || next[data.index].status,
              error: data.error || null,
            };
          }
          return next;
        });
      });

    try {
      const result =
        await window.mainApi?.dashboardConfig?.installDashboardFromRegistry?.(
          appId,
          KITCHEN_SINK_PACKAGE,
          {},
        );
      if (cleanupProgressRef.current) {
        cleanupProgressRef.current();
        cleanupProgressRef.current = null;
      }
      if (!result || !result.success) {
        setInstallError(
          result?.error ||
            "Failed to install Kitchen Sink. Check your internet connection and try again.",
        );
        setState(STATE.ERROR);
        return;
      }
      installResultRef.current = result;
      setState(STATE.DONE);
    } catch (err) {
      console.error("[OnboardingModal] install failed:", err);
      if (cleanupProgressRef.current) {
        cleanupProgressRef.current();
        cleanupProgressRef.current = null;
      }
      setInstallError(err?.message || "Installation failed.");
      setState(STATE.ERROR);
    }
  }, [appId]);

  const handleOpen = useCallback(async () => {
    const workspace = installResultRef.current?.workspace || null;
    await markCompletedAndClose("kitchen-sink");
    if (workspace && onOpenDashboard) {
      onOpenDashboard(workspace);
    }
  }, [markCompletedAndClose, onOpenDashboard]);

  const handleRetry = useCallback(() => {
    setInstallError(null);
    handleInstall();
  }, [handleInstall]);

  // The Modal dispatches setIsOpen(false) on Escape / backdrop click.
  // Route any close attempt through handleSkip so the completion flag
  // is always stamped (otherwise Escape would silently re-show the
  // modal on the next launch).
  const handleSetIsOpen = useCallback(
    (next) => {
      if (next === false) handleSkip();
    },
    [handleSkip],
  );

  const bgPanel = currentTheme?.["bg-primary-medium"] || "bg-gray-900";
  const textPrimary = currentTheme?.["text-primary-light"] || "text-gray-100";
  const textMuted = currentTheme?.["text-primary-medium"] || "text-gray-400";
  const borderPanel =
    currentTheme?.["border-primary-medium"] || "border-gray-700";

  return (
    <Modal
      isOpen={open}
      setIsOpen={handleSetIsOpen}
      width="w-full max-w-2xl"
      height="h-auto"
    >
      <div
        className={`flex flex-col ${bgPanel} ${textPrimary} rounded-lg overflow-hidden p-8`}
        data-testid="onboarding-modal"
      >
        {state === STATE.WELCOME && (
          <WelcomeBody
            onInstall={handleInstall}
            onSkip={handleSkip}
            textMuted={textMuted}
          />
        )}
        {state === STATE.INSTALLING && (
          <InstallingBody
            items={progressItems}
            borderPanel={borderPanel}
            textMuted={textMuted}
          />
        )}
        {state === STATE.DONE && (
          <DoneBody onOpen={handleOpen} textMuted={textMuted} />
        )}
        {state === STATE.ERROR && (
          <ErrorBody
            message={installError}
            onRetry={handleRetry}
            onSkip={handleSkip}
            textMuted={textMuted}
          />
        )}
      </div>
    </Modal>
  );
};

function WelcomeBody({ onInstall, onSkip, textMuted }) {
  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <FontAwesomeIcon icon="sink" className="text-2xl" />
        <Heading2 title="Welcome to Dash" />
      </div>
      <Paragraph className={`${textMuted} mb-6`}>
        Get started with the <strong>Kitchen Sink</strong> dashboard — a curated
        set of widgets that shows what Dash can do. You can swap anything out,
        or build your own from scratch later.
      </Paragraph>
      <div className="flex items-center justify-end gap-3 mt-2">
        <Button
          onClick={onSkip}
          title="Skip for now"
          textSize="text-sm"
          padding="py-2 px-4"
          backgroundColor="bg-gray-700"
          textColor="text-gray-300"
          hoverTextColor="hover:text-white"
          hoverBackgroundColor="hover:bg-gray-600"
          data-testid="onboarding-skip-button"
        />
        <Button
          onClick={onInstall}
          title="Install Kitchen Sink"
          textSize="text-sm"
          padding="py-2 px-4"
          backgroundColor="bg-blue-600"
          textColor="text-white"
          hoverTextColor="hover:text-white"
          hoverBackgroundColor="hover:bg-blue-500"
          icon="download"
          data-testid="onboarding-install-button"
        />
      </div>
    </>
  );
}

function InstallingBody({ items, borderPanel, textMuted }) {
  return (
    <>
      <SubHeading title="Installing Kitchen Sink…" />
      <Paragraph className={`${textMuted} mt-2 mb-4`}>
        Downloading widgets, theme, and dashboard configuration from the
        registry. This usually takes a few seconds.
      </Paragraph>
      <div
        className={`border ${borderPanel} rounded-md max-h-64 overflow-y-auto`}
        data-testid="onboarding-progress-list"
      >
        {items.length === 0 && (
          <div className={`p-3 ${textMuted}`}>Starting install…</div>
        )}
        {items.map((item, idx) => (
          <div
            key={`${item.packageName || "slot"}-${idx}`}
            className="flex items-center justify-between px-3 py-2"
            data-status={item.status}
          >
            <span className="truncate">
              {item.displayName || item.packageName || `Item ${idx + 1}`}
            </span>
            <StatusBadge status={item.status} />
          </div>
        ))}
      </div>
    </>
  );
}

function StatusBadge({ status }) {
  switch (status) {
    case "installed":
    case "already-installed":
      return (
        <FontAwesomeIcon
          icon="check"
          className="text-green-500"
          data-testid="status-installed"
        />
      );
    case "failed":
      return (
        <FontAwesomeIcon
          icon="xmark"
          className="text-red-500"
          data-testid="status-failed"
        />
      );
    case "downloading":
    case "pending":
    default:
      return (
        <FontAwesomeIcon
          icon="circle-notch"
          className="animate-spin"
          data-testid={`status-${status || "pending"}`}
        />
      );
  }
}

function DoneBody({ onOpen, textMuted }) {
  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <FontAwesomeIcon icon="check" className="text-2xl text-green-500" />
        <Heading2 title="Kitchen Sink Installed" />
      </div>
      <Paragraph className={`${textMuted} mb-6`}>
        Your first dashboard is ready. Open it to explore — every widget and the
        theme are now installed locally.
      </Paragraph>
      <div className="flex items-center justify-end">
        <Button
          onClick={onOpen}
          title="Open Kitchen Sink"
          textSize="text-sm"
          padding="py-2 px-4"
          backgroundColor="bg-green-600"
          textColor="text-white"
          hoverTextColor="hover:text-white"
          hoverBackgroundColor="hover:bg-green-500"
          icon="arrow-right"
          data-testid="onboarding-open-button"
        />
      </div>
    </>
  );
}

function ErrorBody({ message, onRetry, onSkip, textMuted }) {
  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <FontAwesomeIcon
          icon="triangle-exclamation"
          className="text-2xl text-red-500"
        />
        <Heading2 title="Install Failed" />
      </div>
      <Paragraph className={`${textMuted} mb-6`}>
        {message || "Something went wrong installing Kitchen Sink."}
      </Paragraph>
      <div className="flex items-center justify-end gap-3">
        <Button
          onClick={onSkip}
          title="Skip for now"
          textSize="text-sm"
          padding="py-2 px-4"
          backgroundColor="bg-gray-700"
          textColor="text-gray-300"
          hoverTextColor="hover:text-white"
          hoverBackgroundColor="hover:bg-gray-600"
          data-testid="onboarding-skip-after-error-button"
        />
        <Button
          onClick={onRetry}
          title="Try again"
          textSize="text-sm"
          padding="py-2 px-4"
          backgroundColor="bg-blue-600"
          textColor="text-white"
          hoverTextColor="hover:text-white"
          hoverBackgroundColor="hover:bg-blue-500"
          icon="rotate-right"
          data-testid="onboarding-retry-button"
        />
      </div>
    </>
  );
}

export default OnboardingModal;
