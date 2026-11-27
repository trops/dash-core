/**
 * AddCheckScreen (DASH-110): suggestions labelled by where they come
 * from, one click adds; a described check can only be saved once Try it
 * passed on it.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddCheckScreen, canSave, SOURCE_LABELS } from "./AddCheckScreen";

describe("AddCheckScreen", () => {
  afterEach(() => {
    delete window.mainApi;
  });

  it("can save only a draft Try it passed on, as it is now", () => {
    const d = { file: "a.js", code: "x" };
    expect(canSave(d, null)).toBe(false);
    expect(canSave(d, { ok: false, for: "x" })).toBe(false);
    expect(canSave(d, { ok: true, for: "x" })).toBe(true);
    expect(canSave({ ...d, code: "y" }, { ok: true, for: "x" })).toBe(false);
  });

  it("shows suggestions with their source, and adds one in a click", async () => {
    const step = {
      kind: "check",
      name: "validate passes",
      check: { kind: "repo", name: "validate" },
    };
    window.mainApi = {
      bots: {
        suggestChecks: jest.fn().mockResolvedValue({
          suggestions: [
            {
              id: "repo:validate",
              label: ".dash/checks/validate",
              why: "In the repo",
              source: "repo",
              step,
            },
          ],
          repos: [{ key: "a", slug: "trops/a" }],
        }),
      },
    };
    const onAdd = jest.fn();
    render(
      <AddCheckScreen
        bot={{ id: "b1", name: "Coder" }}
        onAdd={onAdd}
        onCancel={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(".dash/checks/validate")).toBeInTheDocument(),
    );
    expect(screen.getByText(SOURCE_LABELS.repo)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).toHaveBeenCalledWith(step);
  });
});
