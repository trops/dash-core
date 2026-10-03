import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { ConfigListRow } from "./ConfigListRow";

const theme = {
  "text-neutral-medium": "tok-muted",
  "border-neutral-dark": "tok-hairline",
  "bg-neutral-very-dark": "tok-selected-bg",
  "border-primary-dark": "tok-selected-border",
};

const withTheme = (ui) =>
  render(
    <ThemeContext.Provider value={{ currentTheme: theme }}>
      {ui}
    </ThemeContext.Provider>,
  );

describe("ConfigListRow", () => {
  it("shows the title, subtitle and meta, and calls onClick", () => {
    const onClick = jest.fn();
    withTheme(
      <ConfigListRow
        title="slack"
        subtitle="trops.slack.SlackWidget"
        meta="3 widgets"
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /slack/ }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByText("trops.slack.SlackWidget")).toBeInTheDocument();
    expect(screen.getByText("3 widgets")).toHaveClass("tok-muted");
  });

  it("marks the active row like the Bots view's team list (theme tokens)", () => {
    withTheme(<ConfigListRow title="slack" active onClick={() => {}} />);
    const row = screen.getByRole("button", { name: /slack/ });
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveClass(
      "rounded-lg",
      "tok-selected-bg",
      "tok-selected-border",
    );
  });

  it("an inactive row has a transparent border and no aria-current", () => {
    withTheme(<ConfigListRow title="gmail" onClick={() => {}} />);
    const row = screen.getByRole("button", { name: /gmail/ });
    expect(row).not.toHaveAttribute("aria-current");
    expect(row).toHaveClass("border-transparent");
    expect(row).not.toHaveClass("tok-selected-bg");
  });

  it("renders an optional badge next to the title", () => {
    withTheme(
      <ConfigListRow
        title="github"
        badge={<span>needs 1</span>}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("needs 1")).toBeInTheDocument();
  });

  it("falls back to plain Tailwind colours without a theme", () => {
    render(<ConfigListRow title="notion" active onClick={() => {}} />);
    expect(screen.getByRole("button", { name: /notion/ })).toHaveClass(
      "bg-gray-800",
      "border-gray-600",
    );
  });
});
