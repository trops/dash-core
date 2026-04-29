import { useReducer, useCallback, useMemo } from "react";

const TOTAL_STEPS = 2; // Steps 0-1: Discover, Customize

const initialState = {
  step: 0,
  filters: {
    categories: [],
    providers: [],
    query: "",
  },
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

    case "SET_FILTERS":
      return {
        ...state,
        filters: { ...state.filters, ...action.payload },
      };

    case "TOGGLE_FILTER_CATEGORY": {
      const categories = state.filters.categories.includes(action.payload)
        ? state.filters.categories.filter((c) => c !== action.payload)
        : [...state.filters.categories, action.payload];
      return {
        ...state,
        filters: { ...state.filters, categories },
      };
    }

    case "TOGGLE_FILTER_PROVIDER": {
      const providers = state.filters.providers.includes(action.payload)
        ? state.filters.providers.filter((p) => p !== action.payload)
        : [...state.filters.providers, action.payload];
      return {
        ...state,
        filters: { ...state.filters, providers },
      };
    }

    case "SET_SEARCH_QUERY":
      return {
        ...state,
        filters: { ...state.filters, query: action.payload },
      };

    case "SET_SELECTED_WIDGETS": {
      const templateKey = widgetCountToTemplate(action.payload.length);
      const widgetOrder = action.payload.map((w) => w.name || w.key);
      return {
        ...state,
        selectedWidgets: action.payload,
        layout: { templateKey, widgetOrder },
      };
    }

    case "TOGGLE_WIDGET": {
      const exists = state.selectedWidgets.some(
        (w) => w.name === action.payload.name,
      );
      const selectedWidgets = exists
        ? state.selectedWidgets.filter((w) => w.name !== action.payload.name)
        : [...state.selectedWidgets, action.payload];
      const toggleTemplateKey = widgetCountToTemplate(selectedWidgets.length);
      const toggleWidgetOrder = selectedWidgets.map((w) => w.name || w.key);
      return {
        ...state,
        selectedWidgets,
        layout: {
          templateKey: toggleTemplateKey,
          widgetOrder: toggleWidgetOrder,
        },
      };
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
      return (
        state.selectedDashboard !== null || state.selectedWidgets.length > 0
      );
    case 1:
      // Create can fire only when the user has both a name and a theme.
      // The wizard auto-defaults theme to the user's active app theme,
      // so this gate is mostly belt-and-suspenders — but it locks the
      // contract so a future refactor that drops the auto-default
      // can't quietly let the Create button enable on name alone.
      return (
        state.customization.name.trim().length > 0 &&
        !!state.customization.theme
      );
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
