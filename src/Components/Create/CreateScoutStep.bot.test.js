/**
 * CreateScoutStep, looking for a bot (consolidation Phase 2c-1): the Scout
 * searches bots; each match is "Use on <dashboard>"; Skip / None of these
 * plan a new one.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateScoutStep } from "./CreateScoutStep";

jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => null,
}));

const scout = { id: "b_scout", role: "scout", name: "Scout", paused: false };

function setup(record, where = "Morning Brief") {
  window.mainApi = {
    bots: {
      listDashTeam: jest.fn().mockResolvedValue([scout]),
      onStream: jest.fn(() => 1),
      removeListener: jest.fn(),
      run: jest.fn(() =>
        record ? Promise.resolve(record) : new Promise(() => {}),
      ),
    },
  };
  const onBuildNew = jest.fn();
  const onUse = jest.fn();
  render(
    <CreateScoutStep
      prompt="summarize my unread email"
      bot={{ where }}
      onBuildNew={onBuildNew}
      onUse={onUse}
    />,
  );
  return { onBuildNew, onUse };
}

afterEach(() => {
  delete window.mainApi;
});

const found = {
  status: "completed",
  output: `Two fit.
<matches>[{"kind":"bot","source":"Yours","name":"Inbox Digest","package":"bot_1","why":"on Work · summarizes unread Gmail at 9:00"},{"kind":"bot","source":"Registry","name":"Triage Summary","package":"@trops/inbox-triage","why":"in the Inbox Triage starter"},{"source":"Yours","name":"Unmarked Bot","package":"bot_2"}]</matches>`,
};

test("asks the Scout for bots, and Skip plans a new one while it looks", async () => {
  const { onBuildNew } = setup(null);
  await screen.findByText("Looking through your bots and the registry's…");
  const [, request] = window.mainApi.bots.run.mock.calls[0];
  expect(request).toMatch(/search_library with what: "bots"/);
  fireEvent.click(
    screen.getByRole("button", { name: "Skip — plan a new one" }),
  );
  expect(onBuildNew).toHaveBeenCalled();
});

test("each bot it found is Use on <dashboard> — one the Scout left unmarked too", async () => {
  const { onUse } = setup(found);
  await screen.findByText(
    "Here's what you already have, or could add, that fits:",
  );
  const uses = screen.getAllByRole("button", { name: "Use on Morning Brief" });
  expect(uses).toHaveLength(3);
  expect(screen.getByText("Unmarked Bot")).toBeInTheDocument();
  // Each row says where it is.
  expect(screen.getByTestId("scout-matches")).toHaveTextContent(
    "Yours · on Work · summarizes unread Gmail at 9:00",
  );
  fireEvent.click(uses[0]);
  expect(onUse).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "bot",
      name: "Inbox Digest",
      package: "bot_1",
    }),
  );
  expect(
    screen.getByRole("button", { name: "None of these — plan a new one" }),
  ).toBeInTheDocument();
});

test("with no dashboard, a match is Use a copy", async () => {
  setup(found, null);
  expect(
    await screen.findAllByRole("button", { name: "Use a copy" }),
  ).toHaveLength(3);
});
