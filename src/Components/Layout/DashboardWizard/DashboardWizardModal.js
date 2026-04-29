import React, { useEffect, useCallback, useRef } from "react";
import { Modal, Stepper, Button } from "@trops/dash-react";
import { useWizardState } from "../../../hooks/useWizardState";
import { WizardDiscoverStep } from "./steps/WizardDiscoverStep";
import { WizardCustomizeStep } from "./steps/WizardCustomizeStep";

// Step 0 (Discover) is the browse phase — no stepper entry, no
// numbered position. The numbered wizard begins once the user has
// selected a dashboard or widgets and clicks Next.
const STEP_LABELS = [
  { label: "Name", description: "Pick a name" },
  { label: "Folder", description: "Where it lives" },
  { label: "Theme", description: "How it looks" },
  { label: "Review", description: "Confirm & create" },
];

/**
 * DashboardWizardModal
 *
 * Top-level modal that hosts all wizard steps with a Stepper header.
 * Provides Back/Next/Create navigation with step-aware validation.
 * Resets wizard state cleanly on close.
 */
export const DashboardWizardModal = ({
  open,
  setIsOpen,
  menuItems = [],
  onSaveMenuItem = null,
  onCreateWorkspace = null,
  onInstallDashboard = null,
  onOpenDashboard = null,
  onReloadWorkspaces = null,
  appId,
}) => {
  const createHandlerRef = useRef(null);

  const { state, dispatch, nextStep, prevStep, canProceed } = useWizardState();

  // Reset wizard state when modal opens
  useEffect(() => {
    if (open) {
      dispatch({ type: "RESET" });
    }
  }, [open, dispatch]);

  function handleClose() {
    setIsOpen(false);
  }

  const handleStepChange = useCallback(
    (newStep) => {
      // Stepper only allows going backwards; forward is via Next button
      if (newStep < state.step) {
        prevStep();
      }
    },
    [state.step, prevStep],
  );

  const handleNext = useCallback(() => {
    if (!canProceed) return;
    nextStep();
  }, [canProceed, nextStep]);

  const isDiscover = state.step === 0;
  const isLastStep = state.step === 4;
  const isCreating = createHandlerRef.current?.creating ?? false;
  const isCreated = !!createHandlerRef.current?.createdDashboard;
  // Create only fires when every prior step has been validated. The
  // Review step (canProceed=true by design) doesn't tell us whether
  // Name/Folder/Theme were filled, so we re-check the underlying
  // customization here — belt-and-suspenders for clicks that race
  // the stepper.
  const customizationComplete =
    state.customization.name.trim().length > 0 &&
    state.customization.menuId !== null &&
    !!state.customization.theme;
  const canCreate = customizationComplete && !isCreating;

  return (
    <Modal
      isOpen={open}
      setIsOpen={setIsOpen}
      width="w-full max-w-5xl"
      height="h-5/6"
    >
      <div className="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
        {/* Header with close button */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0">
          <h2 className="text-lg font-semibold text-gray-200">
            Dashboard Wizard
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content — Stepper renders only for the 4 numbered steps
            (Name/Folder/Theme/Review). Discover is a browse phase
            without a numbered position so users aren't told they're
            "in step 1 of N" before they've even chosen what to
            create. */}
        <div className="flex flex-col flex-1 min-h-0 px-6 py-4">
          {isDiscover ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <WizardDiscoverStep state={state} dispatch={dispatch} />
            </div>
          ) : (
            <Stepper
              activeStep={state.step - 1}
              onStepChange={(s) => handleStepChange(s + 1)}
              showNavigation={false}
              className="flex-1 min-h-0"
            >
              {STEP_LABELS.map((label) => (
                <Stepper.Step
                  key={label.label}
                  label={label.label}
                  description={label.description}
                >
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <WizardCustomizeStep
                      state={state}
                      dispatch={dispatch}
                      menuItems={menuItems}
                      onSaveMenuItem={onSaveMenuItem}
                      onCreateWorkspace={onCreateWorkspace}
                      onInstallDashboard={onInstallDashboard}
                      onOpenDashboard={(ws) => {
                        handleClose();
                        if (onOpenDashboard) onOpenDashboard(ws);
                        if (onReloadWorkspaces) onReloadWorkspaces();
                      }}
                      appId={appId}
                      createHandlerRef={createHandlerRef}
                    />
                  </div>
                </Stepper.Step>
              ))}
            </Stepper>
          )}

          {/* Custom navigation footer — hidden once the dashboard has
              been created so the success state's "Open Dashboard" CTA
              is the only call-to-action and the footer Create button
              can't accidentally re-fire the install. */}
          {!isCreated && (
            <div className="flex flex-row justify-between items-center pt-4 mt-4 border-t border-gray-700/50">
              <Button
                onClick={state.step === 0 ? handleClose : prevStep}
                title={state.step === 0 ? "Cancel" : "Back"}
                textSize="text-sm"
                padding="py-2 px-4"
                backgroundColor="bg-gray-700"
                textColor="text-gray-300"
                hoverTextColor="hover:text-white"
                hoverBackgroundColor="hover:bg-gray-600"
              />
              <span className="text-xs text-gray-500">
                {isDiscover
                  ? "Browse"
                  : `Step ${state.step} of ${STEP_LABELS.length}`}
              </span>
              {isLastStep ? (
                <Button
                  onClick={() => createHandlerRef.current?.handleCreate?.()}
                  title={isCreating ? "Creating..." : "Create Dashboard"}
                  textSize="text-sm"
                  padding="py-2 px-4"
                  backgroundColor={canCreate ? "bg-green-600" : "bg-gray-700"}
                  textColor={canCreate ? "text-white" : "text-gray-500"}
                  hoverTextColor={
                    canCreate ? "hover:text-white" : "hover:text-gray-500"
                  }
                  hoverBackgroundColor={
                    canCreate ? "hover:bg-green-500" : "hover:bg-gray-700"
                  }
                  disabled={!canCreate}
                  icon={isCreating ? "spinner" : "plus"}
                />
              ) : (
                <Button
                  onClick={handleNext}
                  title="Next"
                  textSize="text-sm"
                  padding="py-2 px-4"
                  backgroundColor={canProceed ? "bg-blue-600" : "bg-gray-700"}
                  textColor={canProceed ? "text-white" : "text-gray-500"}
                  hoverTextColor={
                    canProceed ? "hover:text-white" : "hover:text-gray-500"
                  }
                  hoverBackgroundColor={
                    canProceed ? "hover:bg-blue-500" : "hover:bg-gray-700"
                  }
                  disabled={!canProceed}
                  icon="arrow-right"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
