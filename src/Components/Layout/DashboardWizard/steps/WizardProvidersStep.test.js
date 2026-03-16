import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WizardProvidersStep } from "./WizardProvidersStep";
import { AppContext } from "../../../../Context/App/AppContext";

// Mock resolveIcon to pass through the string
jest.mock("../../../../utils/resolveIcon", () => ({
  resolveIcon: (name) => name,
}));

function renderWithProviders(state, dispatch, providersMap = {}) {
  return render(
    <AppContext.Provider value={{ providers: providersMap }}>
      <WizardProvidersStep state={state} dispatch={dispatch} />
    </AppContext.Provider>,
  );
}

describe("WizardProvidersStep", () => {
  let dispatch;

  beforeEach(() => {
    dispatch = jest.fn();
  });

  test("shows empty message when no providers exist", () => {
    renderWithProviders({ providers: [] }, dispatch, {});
    expect(
      screen.getByText(
        "No providers configured yet. Add providers in Settings first.",
      ),
    ).toBeInTheDocument();
  });

  test("renders provider cards from AppContext", () => {
    const providers = {
      github: {
        type: "github",
        name: "GitHub",
        icon: "github",
        credentials: { token: "abc" },
      },
      slack: {
        type: "slack",
        name: "Slack",
        icon: "slack",
        credentials: {},
      },
    };
    renderWithProviders({ providers: [] }, dispatch, providers);

    expect(screen.getByTestId("selectable-card-GitHub")).toBeInTheDocument();
    expect(screen.getByTestId("selectable-card-Slack")).toBeInTheDocument();
  });

  test("pre-selects configured providers on first render", () => {
    const providers = {
      github: {
        type: "github",
        name: "GitHub",
        icon: "github",
        credentials: { token: "abc" },
      },
      slack: {
        type: "slack",
        name: "Slack",
        icon: "slack",
        credentials: {},
      },
    };
    renderWithProviders({ providers: [] }, dispatch, providers);

    // Should dispatch SET_PROVIDERS with configured provider keys
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_PROVIDERS",
      payload: ["github"],
    });
  });

  test("does not re-dispatch if providers already selected", () => {
    const providers = {
      github: {
        type: "github",
        name: "GitHub",
        icon: "github",
        credentials: { token: "abc" },
      },
    };
    renderWithProviders({ providers: ["github"] }, dispatch, providers);

    // Should NOT dispatch SET_PROVIDERS since providers.length > 0
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_PROVIDERS" }),
    );
  });

  test("clicking a provider card dispatches TOGGLE_PROVIDER", () => {
    const providers = {
      github: {
        type: "github",
        name: "GitHub",
        icon: "github",
        credentials: { token: "abc" },
      },
    };
    renderWithProviders({ providers: ["github"] }, dispatch, providers);

    fireEvent.click(screen.getByTestId("selectable-card-GitHub"));
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_PROVIDER",
      payload: "github",
    });
  });

  test("shows 'Needs setup' for selected unconfigured providers", () => {
    const providers = {
      jira: {
        type: "jira",
        name: "Jira",
        icon: "jira",
        credentials: {},
      },
    };
    renderWithProviders({ providers: ["jira"] }, dispatch, providers);

    expect(screen.getByText("Needs setup")).toBeInTheDocument();
  });

  test("does not show 'Needs setup' for configured selected providers", () => {
    const providers = {
      github: {
        type: "github",
        name: "GitHub",
        icon: "github",
        credentials: { token: "abc" },
      },
    };
    renderWithProviders({ providers: ["github"] }, dispatch, providers);

    expect(screen.queryByText("Needs setup")).not.toBeInTheDocument();
  });

  test("renders step header", () => {
    renderWithProviders({ providers: [] }, dispatch, {
      github: {
        type: "github",
        name: "GitHub",
        icon: "github",
        credentials: {},
      },
    });
    expect(
      screen.getByText("Which tools and services do you use?"),
    ).toBeInTheDocument();
  });
});
