import React, { useEffect, useCallback } from "react";
import { Modal, Stepper, Button } from "@trops/dash-react";
import { useWizardState } from "../../../hooks/useWizardState";
import { WizardDiscoverStep } from "./steps/WizardDiscoverStep";
import { WizardLayoutPreviewStep } from "./steps/WizardLayoutPreviewStep";
import { WizardCustomizeStep } from "./steps/WizardCustomizeStep";

const STEP_LABELS = [
  { label: "Discover", description: "Search & select" },
  { label: "Layout", description: "Arrange your widgets" },
  { label: "Customize", description: "Name, folder & theme" },
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
  const {
    state,
    dispatch,
    nextStep,
    prevStep,
    goToStep,
    canProceed,
    isPrebuiltPath,
  } = useWizardState();

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
        goToStep(newStep);
      }
    },
    [state.step, goToStep],
  );

  // Skip layout step for prebuilt path
  const handleNext = useCallback(() => {
    if (!canProceed) return;
    if (state.step === 0 && isPrebuiltPath) {
      // Skip layout step (1), go straight to customize (2)
      goToStep(2);
    } else {
      nextStep();
    }
  }, [canProceed, state.step, isPrebuiltPath, goToStep, nextStep]);

  const handleBack = useCallback(() => {
    if (state.step === 2 && isPrebuiltPath) {
      // Skip back over layout step (1), go to discover (0)
      goToStep(0);
    } else {
      prevStep();
    }
  }, [state.step, isPrebuiltPath, goToStep, prevStep]);

  const isLastStep = state.step === 2;
  const isSuccessState = state.step === 2 && state._created;

  return (
    <Modal isOpen={open} setIsOpen={setIsOpen} width="w-5/6" height="h-5/6">
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

        {/* Stepper + content */}
        <div className="flex flex-col flex-1 min-h-0 px-6 py-4">
          <Stepper
            activeStep={state.step}
            onStepChange={handleStepChange}
            showNavigation={false}
            className="flex-1 min-h-0"
          >
            <Stepper.Step
              label={STEP_LABELS[0].label}
              description={STEP_LABELS[0].description}
            >
              <div className="flex-1 min-h-0 overflow-y-auto">
                <WizardDiscoverStep state={state} dispatch={dispatch} />
              </div>
            </Stepper.Step>

            <Stepper.Step
              label={STEP_LABELS[1].label}
              description={STEP_LABELS[1].description}
            >
              <div className="flex-1 min-h-0 overflow-y-auto">
                <WizardLayoutPreviewStep state={state} dispatch={dispatch} />
              </div>
            </Stepper.Step>

            <Stepper.Step
              label={STEP_LABELS[2].label}
              description={STEP_LABELS[2].description}
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
                />
              </div>
            </Stepper.Step>
          </Stepper>

          {/* Custom navigation footer */}
          <div className="flex flex-row justify-between items-center pt-4 mt-4 border-t border-gray-700/50">
            <Button
              onClick={state.step === 0 ? handleClose : handleBack}
              title={state.step === 0 ? "Cancel" : "Back"}
              textSize="text-sm"
              padding="py-2 px-4"
              backgroundColor="bg-gray-700"
              textColor="text-gray-300"
              hoverTextColor="hover:text-white"
              hoverBackgroundColor="hover:bg-gray-600"
            />
            <span className="text-xs text-gray-500">
              Step {state.step + 1} of {STEP_LABELS.length}
            </span>
            {!isLastStep ? (
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
            ) : (
              <div />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
