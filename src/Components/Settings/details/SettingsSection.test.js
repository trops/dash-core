import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  SETTINGS_SECTIONS,
  SettingsSection,
  startOpen,
  toggleOpen,
} from "./SettingsSection";

// A bot's Settings tab as an accordion (DASH-127, screen 7b).

describe("startOpen / toggleOpen", () => {
  it("all closed, but the first with something to fill in", () => {
    expect(startOpen()).toEqual([]);
    expect(startOpen({ needs: { job: true } })).toEqual(["job"]);
    expect(startOpen({ needs: { job: true, instructions: true } })).toEqual([
      "instructions",
    ]);
  });

  it("a focused field opens its section", () => {
    expect(startOpen({ focus: "commands", needs: { job: true } })).toEqual([
      "access",
    ]);
  });

  it("more than one can be open", () => {
    expect(toggleOpen(["access"], "sends")).toEqual(["access", "sends"]);
    expect(toggleOpen(["access", "sends"], "access")).toEqual(["sends"]);
    expect(toggleOpen(null, "job")).toEqual(["job"]);
  });

  it("the sections, in order", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.title)).toEqual([
      "Instructions, model and engine",
      "Approval policy, folders and shell commands",
      "Sends its work to",
      "Budget and schedule",
      "Settings for its job",
    ]);
  });
});

describe("SettingsSection", () => {
  it("its title row opens and closes it; closed, its settings stay mounted", () => {
    const onToggle = jest.fn();
    const { rerender } = render(
      <SettingsSection id="sends" title="Sends its work to" onToggle={onToggle}>
        <span>inside</span>
      </SettingsSection>,
    );
    const head = screen.getByRole("button", { name: /Sends its work to/ });
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("inside").parentElement).toHaveClass("hidden");
    fireEvent.click(head);
    expect(onToggle).toHaveBeenCalledWith("sends");
    rerender(
      <SettingsSection id="sends" title="Sends its work to" open>
        <span>inside</span>
      </SettingsSection>,
    );
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("inside").parentElement).not.toHaveClass("hidden");
  });
});
