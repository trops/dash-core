import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { InstallProgressModal } from "./InstallProgressModal";

// A refused install lists every problem (consolidation Phase 1a): the
// reason is shown whole, line breaks kept — not cut to one line.
test("a failed install shows its whole reason", () => {
  const reason =
    "@x/y wasn't installed — it didn't pass its checks:\n- Hello: one\n- Hello: two";
  render(
    <InstallProgressModal
      isOpen
      setIsOpen={() => {}}
      isComplete
      onDone={() => {}}
      widgets={[
        {
          packageName: "@x/y",
          displayName: "Y",
          status: "failed",
          error: reason,
        },
      ]}
    />,
  );
  const shown = screen.getByText(/didn't pass its checks/);
  expect(shown.textContent).toBe(reason);
  expect(shown).not.toHaveClass("truncate");
  expect(shown).toHaveClass("whitespace-pre-wrap");
  // Readable on a light panel too (text-red-400 was too faint).
  expect(shown).toHaveClass("text-red-500");
});

// A folder load says what happened in its own words (Phase 1a-2).
test.each([
  [["failed"], "Not loaded"],
  [["installed", "failed"], "Loaded 1 of 2"],
  [["installed"], "Loaded"],
])("a folder load's title (%j)", (statuses, title) => {
  render(
    <InstallProgressModal
      isOpen
      setIsOpen={() => {}}
      isComplete
      action="load"
      onDone={() => {}}
      widgets={statuses.map((status, i) => ({
        packageName: `p${i}`,
        displayName: `P${i}`,
        status,
      }))}
    />,
  );
  expect(screen.getByText(title)).toBeInTheDocument();
});

test.each([
  [["failed"], "Not installed"],
  [["installed", "failed"], "Installed 1 of 2"],
  [["installed", "already-installed"], "Installation Complete"],
])("the finished title says what happened (%j)", (statuses, title) => {
  render(
    <InstallProgressModal
      isOpen
      setIsOpen={() => {}}
      isComplete
      onDone={() => {}}
      widgets={statuses.map((status, i) => ({
        packageName: `p${i}`,
        displayName: `P${i}`,
        status,
      }))}
    />,
  );
  expect(screen.getByText(title)).toBeInTheDocument();
});
