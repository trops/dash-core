/**
 * PlanMenu — the "…" on an open plan (screen audit, October 2026): Discard
 * plan (or Remove from Recent once built), asked first; the view closes
 * before the remove so its autosave can't bring it back.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanMenu, planRemoveCopy } from "./PlanMenu";

beforeEach(() => {
  window.mainApi = {
    bots: { removeCreateRecent: jest.fn().mockResolvedValue({ ok: true }) },
  };
});
afterEach(() => {
  delete window.mainApi;
});

test("Discard plan asks first; Keep it does nothing", () => {
  const onRemoved = jest.fn();
  render(
    <PlanMenu recentId="plan_1" title="PR Review" onRemoved={onRemoved} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Discard plan/ }));
  expect(screen.getByTestId("confirmation-modal")).toHaveTextContent(
    "Discard “PR Review”?",
  );
  expect(screen.getByTestId("confirmation-modal")).toHaveTextContent(
    "Nothing has been built.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
  expect(onRemoved).not.toHaveBeenCalled();
  expect(window.mainApi.bots.removeCreateRecent).not.toHaveBeenCalled();
});

test("confirmed: the view closes, then the plan leaves Recent", async () => {
  const order = [];
  const onRemoved = jest.fn(() => order.push("closed"));
  window.mainApi.bots.removeCreateRecent.mockImplementation(async () => {
    order.push("removed");
  });
  render(
    <PlanMenu recentId="plan_1" title="PR Review" onRemoved={onRemoved} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Discard plan/ }));
  fireEvent.click(screen.getByRole("button", { name: "Discard plan" }));
  await waitFor(() =>
    expect(window.mainApi.bots.removeCreateRecent).toHaveBeenCalledWith(
      "plan_1",
    ),
  );
  expect(order).toEqual(["closed", "removed"]);
});

test("a built plan says Remove from Recent and that the dashboard stays", () => {
  render(<PlanMenu recentId="plan_1" title="PR Review" built />);
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Remove from Recent/ }));
  expect(screen.getByTestId("confirmation-modal")).toHaveTextContent(
    "The dashboard it built stays.",
  );
});

test("no saved plan yet: no menu", () => {
  const { container } = render(<PlanMenu recentId={null} />);
  expect(container).toBeEmptyDOMElement();
  expect(planRemoveCopy({ title: "" }).title).toBe("Discard this plan?");
});
