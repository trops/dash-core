import { useReducer, useCallback, useMemo } from "react";

const TOTAL_STEPS = 6; // Steps 0-5

const initialState = {
  step: 0,
  intent: [],
  providers: [],
  selectedWidgets: [],
  selectedDashboard: null,
  layout: {
    templateKey: null,
    widgetOrder: [],
  },
  customization: {
    name: "",
    menuId: null,
    theme: null,
  },
  path: null,
};

function wizardReducer(state, action) {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.payload };

    case "SET_INTENT":
      return { ...state, intent: action.payload };

    case "TOGGLE_INTENT": {
      const intent = state.intent.includes(action.payload)
        ? state.intent.filter((i) => i !== action.payload)
        : [...state.intent, action.payload];
      return { ...state, intent };
    }

    case "SET_PROVIDERS":
      return { ...state, providers: action.payload };

    case "TOGGLE_PROVIDER": {
      const providers = state.providers.includes(action.payload)
        ? state.providers.filter((p) => p !== action.payload)
        : [...state.providers, action.payload];
      return { ...state, providers };
    }

    case "SET_SELECTED_WIDGETS":
      return { ...state, selectedWidgets: action.payload };

    case "TOGGLE_WIDGET": {
      const exists = state.selectedWidgets.some(
        (w) => w.name === action.payload.name,
      );
      const selectedWidgets = exists
        ? state.selectedWidgets.filter((w) => w.name !== action.payload.name)
        : [...state.selectedWidgets, action.payload];
      return { ...state, selectedWidgets };
    }

    case "SET_SELECTED_DASHBOARD":
      return { ...state, selectedDashboard: action.payload };

    case "SET_PATH":
      return { ...state, path: action.payload };

    case "SET_LAYOUT":
      return { ...state, layout: action.payload };

    case "REORDER_WIDGETS":
      return {
        ...state,
        layout: { ...state.layout, widgetOrder: action.payload },
      };

    case "SET_CUSTOMIZATION":
      return {
        ...state,
        customization: { ...state.customization, ...action.payload },
      };

    case "RESET":
      return { ...initialState };

    default:
      return state;
  }
}

export function widgetCountToTemplate(count) {
  if (count <= 1) return "single";
  if (count === 2) return "two-columns";
  if (count === 3) return "three-columns";
  if (count === 4) return "two-by-two";
  if (count <= 6) return "two-by-three";
  return "three-by-three";
}

function getCanProceed(state) {
  switch (state.step) {
    case 0:
      return state.intent.length > 0;
    case 1:
      return state.providers.length > 0;
    case 2:
      return state.path === "prebuilt"
        ? state.selectedDashboard !== null
        : state.selectedWidgets.length > 0;
    case 3:
      return state.layout.templateKey !== null;
    case 4:
      return state.customization.name.trim().length > 0;
    case 5:
      return true;
    default:
      return false;
  }
}

export const useWizardState = () => {
  const [state, dispatch] = useReducer(wizardReducer, initialState);

  const canProceed = useMemo(() => getCanProceed(state), [state]);

  const selectedCount = useMemo(
    () => state.selectedWidgets.length,
    [state.selectedWidgets],
  );

  const isPrebuiltPath = state.path === "prebuilt";
  const isCustomPath = state.path === "custom";

  const nextStep = useCallback(() => {
    if (getCanProceed(state) && state.step < TOTAL_STEPS - 1) {
      dispatch({ type: "SET_STEP", payload: state.step + 1 });
    }
  }, [state]);

  const prevStep = useCallback(() => {
    if (state.step > 0) {
      dispatch({ type: "SET_STEP", payload: state.step - 1 });
    }
  }, [state.step]);

  const goToStep = useCallback((n) => {
    if (n >= 0 && n < TOTAL_STEPS) {
      dispatch({ type: "SET_STEP", payload: n });
    }
  }, []);

  return {
    state,
    dispatch,
    nextStep,
    prevStep,
    goToStep,
    canProceed,
    selectedCount,
    isPrebuiltPath,
    isCustomPath,
    widgetCountToTemplate,
  };
};
