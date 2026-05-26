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
import { useRegistryAuth } from "../../hooks/useRegistryAuth";

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
  // AUTH_REQUIRED replaces the generic "Install Failed" screen when
  // the registry returns `authRequired: true`. Surfaces a
  // benefits-driven sign-in CTA instead of asking the user to
  // figure out why install died.
  AUTH_REQUIRED: "auth-required",
  INSTALLING: "installing",
  DONE: "done",
  ERROR: "error",
};

/**
 * Returns the first workspace that was installed from the Kitchen
 * Sink package, or null. Used for the modal's dedupe check so we
 * never create a second Kitchen Sink when one already exists.
 *
 * Workspaces installed via the registry carry a
 * `_dashboardConfig.registryPackage` field — historically the
 * unscoped name ("kitchen-sink"), more recently the scoped form
 * ("trops/kitchen-sink"). Match on either trailing segment.
 */
function findExistingKitchenSink(workspaces) {
  if (!Array.isArray(workspaces)) return null;
  return (
    workspaces.find((ws) => {
      const pkg = ws?._dashboardConfig?.registryPackage;
      if (typeof pkg !== "string") return false;
      const trailing = pkg.includes("/") ? pkg.split("/").pop() : pkg;
      return trailing === "kitchen-sink";
    }) || null
  );
}

export const OnboardingModal = ({
  open,
  appId,
  workspaces = [],
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

  // Reused device-code OAuth state machine (same hook AppUpdatesModal
  // uses). `authFlow` carries the user code + verification URL once
  // initiateAuth fires; while non-null we render the polling panel.
  const { isAuthenticating, authFlow, authError, initiateAuth, cancelAuth } =
    useRegistryAuth();

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

    // Dedupe: if the user already has a Kitchen Sink workspace
    // installed from the registry, skip the install entirely and
    // route them to the existing one. Without this, the modal
    // could be re-triggered (e.g. after clearing the
    // onboarding.completed flag) and would silently create
    // "Kitchen Sink 2", "Kitchen Sink 3", etc.
    const existing = findExistingKitchenSink(workspaces);
    if (existing) {
      installResultRef.current = { success: true, workspace: existing };
      setState(STATE.DONE);
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
        // Auth-required is a distinct UX from a generic install
        // failure: it's recoverable in one click via the sign-in
        // CTA. Route to its own state with the benefits panel
        // instead of dumping a "Not authenticated with registry"
        // error string on the user.
        if (result?.authRequired) {
          setState(STATE.AUTH_REQUIRED);
          return;
        }
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
  }, [appId, workspaces]);

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

  // From the AUTH_REQUIRED state: kick off device-code OAuth. The
  // hook opens the browser, polls in the background, and fires our
  // onAuthorized callback on success. We auto-retry the install
  // there so the user lands on the DONE state without a second
  // click.
  const handleSignIn = useCallback(() => {
    initiateAuth(() => {
      handleInstall();
    });
  }, [initiateAuth, handleInstall]);

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
        {state === STATE.AUTH_REQUIRED && (
          <AuthRequiredBody
            onSignIn={handleSignIn}
            onCancelAuth={cancelAuth}
            onSkip={handleSkip}
            isAuthenticating={isAuthenticating}
            authFlow={authFlow}
            authError={authError}
            textMuted={textMuted}
            borderPanel={borderPanel}
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
      {/* Paragraph wraps children in a flex-row LayoutContainer, so
          mixing text nodes + a <strong> renders each as its own
          flex item (text wraps into a narrow column beside the
          bold span). Wrapping the entire content in a single
          <span> turns it back into one inline child that flows
          through normal text layout. */}
      <Paragraph className={`${textMuted} mb-6`}>
        <span>
          Get started with the <strong>Kitchen Sink</strong> dashboard — a
          curated set of widgets that shows what Dash can do. You can swap
          anything out, or build your own from scratch later.
        </span>
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

function BenefitRow({ icon, title, description, textMuted }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 w-7 h-7 flex items-center justify-center mt-0.5">
        <FontAwesomeIcon icon={icon} className="text-base opacity-70" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className={`text-xs ${textMuted}`}>{description}</span>
      </div>
    </div>
  );
}

function AuthRequiredBody({
  onSignIn,
  onCancelAuth,
  onSkip,
  isAuthenticating,
  authFlow,
  authError,
  textMuted,
  borderPanel,
}) {
  // While the device-code flow is polling, swap the benefits panel
  // for the user-code + verification-URL display so the user knows
  // what to enter in the browser tab we just opened.
  if (isAuthenticating && authFlow) {
    return (
      <>
        <div className="flex items-center gap-3 mb-2">
          <FontAwesomeIcon
            icon="circle-notch"
            className="text-2xl animate-spin"
          />
          <Heading2 title="Waiting for browser sign-in" />
        </div>
        <Paragraph className={`${textMuted} mb-4`}>
          <span>
            We opened a browser tab where you can sign in to the Dash Registry.
            Enter this code if prompted:
          </span>
        </Paragraph>
        <div
          className={`border ${borderPanel} rounded-md p-4 mb-4 text-center`}
          data-testid="onboarding-auth-user-code"
        >
          <div className="text-2xl font-mono tracking-widest">
            {authFlow.userCode || "—"}
          </div>
          <div className={`text-xs ${textMuted} mt-2 break-all`}>
            {authFlow.verificationUrlComplete || authFlow.verificationUrl || ""}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          <Button
            onClick={onCancelAuth}
            title="Cancel"
            textSize="text-sm"
            padding="py-2 px-4"
            backgroundColor="bg-gray-700"
            textColor="text-gray-300"
            hoverTextColor="hover:text-white"
            hoverBackgroundColor="hover:bg-gray-600"
            data-testid="onboarding-auth-cancel-button"
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <FontAwesomeIcon icon="user-plus" className="text-2xl" />
        <Heading2 title="Sign in to the Dash Registry" />
      </div>
      <Paragraph className={`${textMuted} mb-5`}>
        <span>
          A free Dash account unlocks the community ecosystem. Sign in to
          continue installing Kitchen Sink — and to use everything else the
          registry offers.
        </span>
      </Paragraph>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <BenefitRow
          icon="cube"
          title="Install widgets"
          description="Browse and one-click install community widgets"
          textMuted={textMuted}
        />
        <BenefitRow
          icon="table-cells"
          title="Discover dashboards"
          description="Like Kitchen Sink — curated starters built by others"
          textMuted={textMuted}
        />
        <BenefitRow
          icon="palette"
          title="Apply themes"
          description="Community-built themes for any taste"
          textMuted={textMuted}
        />
        <BenefitRow
          icon="upload"
          title="Publish your own"
          description="Share your widgets and dashboards with the Dash community"
          textMuted={textMuted}
        />
      </div>
      {authError && (
        <Paragraph className="text-red-400 mb-4">
          <span>{authError}</span>
        </Paragraph>
      )}
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
          data-testid="onboarding-auth-skip-button"
        />
        <Button
          onClick={onSignIn}
          title="Sign in to Registry"
          textSize="text-sm"
          padding="py-2 px-4"
          backgroundColor="bg-blue-600"
          textColor="text-white"
          hoverTextColor="hover:text-white"
          hoverBackgroundColor="hover:bg-blue-500"
          icon="arrow-up-right-from-square"
          data-testid="onboarding-auth-signin-button"
        />
      </div>
    </>
  );
}

export default OnboardingModal;
