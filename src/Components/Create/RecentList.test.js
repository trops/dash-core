/**
 * RecentList (dock and Create's start screen): rows are dash-react ListRows
 * — title, then status · age — with Remove (×) for questions and plans only
 * (screen audit, October 2026; design guide "List rows").
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecentList, rowRemoveCopy } from "./RecentList";

const now = Date.now();
const SECTIONS = {
  conversations: [
    {
      key: "plan:p1",
      id: "p1",
      kind: "plan",
      title: "Morning Brief",
      status: "Draft plan",
      updatedAt: now - 60_000,
    },
  ],
  drafts: [
    {
      key: "draft:d1",
      id: "d1",
      kind: "widget-draft",
      title: "Tokyo clock",
      status: "Continue in Widget Builder",
      updatedAt: now - 5 * 60_000,
    },
  ],
  moreDrafts: 0,
};

test("each row: title, then status · age; opening passes the row", () => {
  const onOpen = jest.fn();
  render(<RecentList sections={SECTIONS} onOpen={onOpen} />);
  const rows = screen.getAllByTestId("recent-row");
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringMatching(/Morning BriefDraft plan · 1m ago/),
    expect.stringMatching(/Tokyo clockContinue in Widget Builder · 5m ago/),
  ]);
  fireEvent.click(screen.getByRole("button", { name: /Tokyo clock/ }));
  expect(onOpen).toHaveBeenCalledWith(SECTIONS.drafts[0]);
});

test("Remove sits outside the row, for questions and plans only", () => {
  const onRemove = jest.fn();
  render(
    <RecentList sections={SECTIONS} onOpen={() => {}} onRemove={onRemove} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Morning Brief from Recent" }),
  );
  // Asks first; removes only on confirm.
  expect(onRemove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(onRemove).toHaveBeenCalledWith(SECTIONS.conversations[0]);
  expect(
    screen.queryByRole("button", { name: "Remove Tokyo clock from Recent" }),
  ).toBeNull();
});

test("the confirm says what goes: a built plan keeps its dashboard; a question its answer", () => {
  expect(
    rowRemoveCopy({ kind: "plan", title: "PR Review", status: "Built" }),
  ).toEqual({
    action: "Remove from Recent",
    title: "Remove “PR Review” from Recent?",
    message:
      "It leaves Recent and its notes are forgotten. The dashboard it built stays.",
  });
  expect(
    rowRemoveCopy({ kind: "plan", title: "PR Review", status: "Draft plan" }),
  ).toMatchObject({ action: "Discard", title: "Discard “PR Review”?" });
  expect(
    rowRemoveCopy({ kind: "question", title: "What ran?", status: "Answered" }),
  ).toMatchObject({
    action: "Remove",
    message: "The question and its answer leave Recent.",
  });
});

test("nothing to list: the caller's empty state", () => {
  render(
    <RecentList
      sections={{ conversations: [], drafts: [] }}
      onOpen={() => {}}
      empty={<span>Nothing here yet</span>}
    />,
  );
  expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
  expect(screen.queryByTestId("create-recent")).toBeNull();
});
