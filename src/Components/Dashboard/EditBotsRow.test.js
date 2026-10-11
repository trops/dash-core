import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditBotsRow } from "./EditBotsRow";
import { ThemeContext } from "../../Context";

jest.mock("../../Context", () => ({
  ThemeContext: require("react").createContext({ currentTheme: {} }),
}));

const bots = [
  { id: "bot_t", name: "Triage", model: "claude-sonnet-5-5" },
  { id: "bot_r", name: "Reader", model: null },
];
const spend = { "bot:bot_t": { usd: 14.2 } };

function renderRow(props = {}) {
  const onSelect = jest.fn();
  render(
    <ThemeContext.Provider value={{ currentTheme: {} }}>
      <EditBotsRow
        bots={bots}
        spend={spend}
        selection={null}
        related={{ widgets: new Set(), bots: new Set() }}
        onSelect={onSelect}
        {...props}
      />
    </ThemeContext.Provider>,
  );
  return onSelect;
}

describe("EditBotsRow (phase 1c)", () => {
  test("lists the dashboard's bots with model and cost this month", () => {
    renderRow();
    expect(screen.getByText("Bots on this dashboard")).toBeInTheDocument();
    expect(screen.getByText("Triage")).toBeInTheDocument();
    expect(screen.getByText("Sonnet · $14.20 this month")).toBeInTheDocument();
    expect(
      screen.getByText("Default model · No runs this month"),
    ).toBeInTheDocument();
  });

  test("clicking a bot selects it", () => {
    const onSelect = renderRow();
    fireEvent.click(screen.getByRole("button", { name: /Triage/ }));
    expect(onSelect).toHaveBeenCalledWith({
      kind: "bot",
      botId: "bot_t",
      label: "Triage",
    });
  });

  test("marks the selected bot and the bots related to a selected widget", () => {
    renderRow({
      selection: { kind: "widget", uuid: "w1" },
      related: { widgets: new Set(), bots: new Set(["bot_t"]) },
    });
    expect(screen.getByRole("button", { name: /Triage/ })).toHaveAttribute(
      "data-state",
      "related",
    );
    expect(screen.getByRole("button", { name: /Reader/ })).toHaveAttribute(
      "data-state",
      "dimmed",
    );
  });

  test("a selected bot is pressed", () => {
    renderRow({ selection: { kind: "bot", botId: "bot_r" } });
    expect(screen.getByRole("button", { name: /Reader/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("renders nothing for a dashboard without bots", () => {
    const { container } = render(
      <ThemeContext.Provider value={{ currentTheme: {} }}>
        <EditBotsRow bots={[]} />
      </ThemeContext.Provider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
