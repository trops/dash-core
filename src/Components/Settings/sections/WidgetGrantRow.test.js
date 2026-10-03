/**
 * WidgetGrantRow — shared by Dashboard Config › Permissions, Settings ›
 * Privacy & Security and the widget package detail. Restyle slice 2 gives
 * it the Bots view's card (theme hairline, rounded-lg) and quiet buttons;
 * these pin that the revoke flows still work.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { WidgetGrantRow } from "./WidgetGrantRow";

const theme = {
  "border-neutral-dark": "tok-hairline",
  "text-neutral-medium": "tok-muted",
};

const props = {
  widgetId: "trops.slack.SlackWidget",
  hasManifest: true,
  declared: { servers: { slack: { tools: ["send_message"] } } },
  granted: { servers: { slack: { tools: ["send_message"] } } },
};

function setup(extra = {}) {
  const handlers = {
    onRevokeWidget: jest.fn(),
    onRevokeServer: jest.fn(),
    onToggleTool: jest.fn(),
    onToggleAllForServer: jest.fn(),
  };
  const utils = render(
    <ThemeContext.Provider value={{ currentTheme: theme }}>
      <WidgetGrantRow {...props} {...handlers} {...extra} />
    </ThemeContext.Provider>,
  );
  return { ...handlers, ...utils };
}

describe("WidgetGrantRow — Bots-view card", () => {
  it("is a rounded card with the theme's hairline border", () => {
    setup();
    const card = screen.getByTestId("widget-grant-row");
    expect(card).toHaveClass("rounded-lg", "tok-hairline");
    expect(card.className).not.toMatch(/border-gray-/);
  });

  it("server sections are divided by the theme's hairline", () => {
    setup();
    const section = screen.getByTestId("grant-server-slack");
    expect(section).toHaveClass("border-t", "tok-hairline");
  });
});

describe("WidgetGrantRow — revoke flows unchanged", () => {
  it("Revoke all asks first, then revokes the widget", () => {
    const { onRevokeWidget } = setup();
    fireEvent.click(screen.getByText("Revoke all"));
    expect(onRevokeWidget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm"));
    expect(onRevokeWidget).toHaveBeenCalled();
  });

  it("Revoke server asks first, then revokes that server", () => {
    const { onRevokeServer } = setup();
    fireEvent.click(screen.getByText("Revoke server"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onRevokeServer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Revoke server"));
    fireEvent.click(screen.getByText("Confirm"));
    expect(onRevokeServer).toHaveBeenCalledWith("slack");
  });
});
