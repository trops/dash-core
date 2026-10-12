/**
 * CreateScoutStep — the Scout looks before Create builds a widget
 * (create-entry CRE-009 AC1/AC2/AC6, CRE-011 AC2; phase 3 slice 4).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateScoutStep } from "./CreateScoutStep";

const scout = { id: "b_scout", role: "scout", name: "Scout", paused: false };

function setup({ team = [scout], record, pending = false } = {}) {
  let resolveRun;
  window.mainApi = {
    bots: {
      listDashTeam: jest.fn().mockResolvedValue(team),
      onStream: jest.fn(() => 1),
      removeListener: jest.fn(),
      run: jest.fn(() =>
        pending
          ? new Promise((r) => {
              resolveRun = r;
            })
          : Promise.resolve(record),
      ),
    },
  };
  const onBuildNew = jest.fn();
  const onUse = jest.fn();
  render(
    <CreateScoutStep
      prompt="an Algolia search widget"
      onBuildNew={onBuildNew}
      onUse={onUse}
    />,
  );
  return { onBuildNew, onUse, resolveRun: (r) => resolveRun(r) };
}

afterEach(() => {
  delete window.mainApi;
});

const found = {
  status: "completed",
  model: "claude-haiku-4-5",
  usage: { inputTokens: 4000, outputTokens: 600 },
  cost: { usd: 0, includedInPlan: true, estimated: false },
  output: `Algolia Search fits.
<matches>[{"source":"Yours","name":"Inbox count","package":"@ai-built/inboxcount","why":"close"},{"source":"Registry","name":"Algolia Search","package":"@trops/algolia","why":"search box"}]</matches>`,
};

test("while looking, Skip builds right away", async () => {
  const { onBuildNew } = setup({ pending: true });
  expect(
    await screen.findByText("Looking through your widgets and the registry…"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Skip — just build it"));
  expect(onBuildNew).toHaveBeenCalled();
});

test("shows each match with where it's from, and the run's model and tokens", async () => {
  const { onUse, onBuildNew } = setup({ record: found });
  await screen.findByTestId("scout-matches");
  expect(screen.getByText("Yours")).toBeInTheDocument();
  expect(screen.getByText("Registry · install")).toBeInTheDocument();
  expect(
    screen.getByText(/Haiku · 4\.6k tokens · included in your plan/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Use this"));
  expect(onUse).toHaveBeenCalledWith(
    expect.objectContaining({
      source: "Yours",
      package: "@ai-built/inboxcount",
    }),
  );
  fireEvent.click(screen.getByText("Install"));
  expect(onUse).toHaveBeenLastCalledWith(
    expect.objectContaining({ source: "Registry", package: "@trops/algolia" }),
  );
  fireEvent.click(screen.getByText("Build new instead"));
  expect(onBuildNew).toHaveBeenCalled();
});

test("nothing found: its words and Build it", async () => {
  setup({
    record: {
      status: "completed",
      output: "Nothing fits.\n<matches>[]</matches>",
    },
  });
  expect(await screen.findByTestId("scout-prose")).toHaveTextContent(
    "Nothing fits.",
  );
  expect(screen.getByText("Build it")).toBeInTheDocument();
});

test("a paused Scout goes straight to building", async () => {
  const { onBuildNew } = setup({ team: [{ ...scout, paused: true }] });
  await waitFor(() => expect(onBuildNew).toHaveBeenCalled());
});

test("a failed search says so and still offers Build it", async () => {
  setup({ record: { status: "failed", error: "CLI not signed in" } });
  expect(await screen.findByText(/CLI not signed in/)).toBeInTheDocument();
  expect(screen.getByText("Build it")).toBeInTheDocument();
});
