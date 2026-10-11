/**
 * BotDetail in the edit panel's bot tabs (create-entry PRD CRE-006 AC5):
 * `section` shows only the Instructions or Access parts, and
 * `stageChanges` drops the form's own Save — each valid change goes to
 * onChange(definition, opened) for the dashboard's Save.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { BotDetail } from "./BotDetail";

const BOT = {
  id: "bot_1",
  name: "Inbox triage",
  instructions: "Sort my inbox",
  provider: "claude-code",
};

describe("BotDetail — sections", () => {
  test("instructions shows the bot's job, not its access", () => {
    render(<BotDetail bot={BOT} providers={{}} section="instructions" />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Instructions")).toBeInTheDocument();
    expect(screen.getByText("AI model")).toBeInTheDocument();
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(screen.queryByText("Providers")).toBeNull();
    expect(screen.queryByLabelText("Approval policy")).toBeNull();
  });

  test("access shows providers and the approval policy only", () => {
    render(<BotDetail bot={BOT} providers={{}} section="access" />);
    expect(screen.getByText("Providers")).toBeInTheDocument();
    expect(screen.getByLabelText("Approval policy")).toBeInTheDocument();
    expect(screen.queryByText("Name")).toBeNull();
    expect(screen.queryByText("Schedule")).toBeNull();
  });

  test("no section shows everything, with Save, as before", () => {
    render(<BotDetail bot={BOT} providers={{}} onSave={jest.fn()} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Providers")).toBeInTheDocument();
    expect(screen.getByTestId("bot-detail-footer")).toBeInTheDocument();
  });
});

describe("BotDetail — staged changes", () => {
  test("no Save/Discard/Delete footer", () => {
    render(
      <BotDetail
        bot={BOT}
        providers={{}}
        stageChanges
        onChange={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("bot-detail-footer")).toBeNull();
    expect(screen.queryByText("Save")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
  });

  test("each change goes to onChange with the form as it opened", () => {
    const onChange = jest.fn();
    render(
      <BotDetail bot={BOT} providers={{}} stageChanges onChange={onChange} />,
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("What should this bot do?"), {
      target: { value: "Sort my inbox and flag invoices" },
    });
    const [definition, opened] = onChange.mock.calls.at(-1);
    expect(definition.instructions).toBe("Sort my inbox and flag invoices");
    expect(opened.instructions).toBe("Sort my inbox");
  });

  test("an invalid form (no name) isn't staged", () => {
    const onChange = jest.fn();
    render(
      <BotDetail bot={BOT} providers={{}} stageChanges onChange={onChange} />,
    );
    fireEvent.change(screen.getByPlaceholderText("e.g. PR Digest"), {
      target: { value: "  " },
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
