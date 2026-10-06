/**
 * ChatInput — @ shortcut to pick a team lead (bot-teams TEAM-013 AC6).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "./ChatInput";

const leads = [
  {
    botId: "lead_1",
    leadName: "Daily Brief Lead",
    dashboardName: "Daily Brief",
    dashboardLabel: "Daily Brief",
  },
  {
    botId: "lead_2",
    leadName: "Sales Lead",
    dashboardName: "Sales",
    dashboardLabel: "Sales",
  },
];

function setup(props = {}) {
  const onSend = jest.fn();
  const onPickRecipient = jest.fn();
  render(
    <ChatInput
      onSend={onSend}
      isLoading={false}
      leads={leads}
      onPickRecipient={onPickRecipient}
      {...props}
    />,
  );
  const box = screen.getByPlaceholderText("Type a message...");
  const type = (value) => fireEvent.change(box, { target: { value } });
  const key = (k) => fireEvent.keyDown(box, { key: k, code: k });
  return { box, type, key, onSend, onPickRecipient };
}

describe("ChatInput @ shortcut", () => {
  test("@ at the start opens the list with the Assistant and every lead", () => {
    const { type } = setup();
    type("@");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Assistant",
      "Daily Brief Lead · Daily Brief",
      "Sales Lead · Sales",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  test("text after @ filters the list", () => {
    const { type } = setup();
    type("@sal");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Sales Lead · Sales",
    ]);
  });

  test("↓ then Enter picks the highlighted lead, clears the box, and does not send", () => {
    const { type, key, box, onSend, onPickRecipient } = setup();
    type("@");
    key("ArrowDown");
    key("Enter");
    expect(onPickRecipient).toHaveBeenCalledWith(leads[0]);
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("Tab also picks; choosing Assistant passes null", () => {
    const { type, key, onPickRecipient } = setup();
    type("@");
    key("Tab");
    expect(onPickRecipient).toHaveBeenCalledWith(null);
  });

  test("clicking an option picks it", () => {
    const { type, onPickRecipient } = setup();
    type("@");
    fireEvent.mouseDown(screen.getByText("Sales Lead · Sales"));
    expect(onPickRecipient).toHaveBeenCalledWith(leads[1]);
  });

  test("Esc closes the list and keeps the text", () => {
    const { type, key, box, onPickRecipient } = setup();
    type("@dai");
    key("Escape");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(box).toHaveValue("@dai");
    expect(onPickRecipient).not.toHaveBeenCalled();
  });

  test("an @ later in the message (e.g. an email) does nothing", () => {
    const { type } = setup();
    type("mail me at a@b.com");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("no match shows a hint, and Enter sends nothing", () => {
    const { type, key, onSend, onPickRecipient } = setup();
    type("@zzz");
    expect(screen.getByText("No team lead matches.")).toBeInTheDocument();
    key("Enter");
    expect(onSend).not.toHaveBeenCalled();
    expect(onPickRecipient).not.toHaveBeenCalled();
  });

  test("without onPickRecipient the @ shortcut is off", () => {
    setup({ onPickRecipient: undefined });
    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "@" },
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
