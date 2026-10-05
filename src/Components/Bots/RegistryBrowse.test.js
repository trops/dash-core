import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RegistryBrowse } from "./RegistryBrowse";

const results = [
  {
    ref: "trops/daily-brief-test",
    displayName: "Daily Brief (test)",
    author: "trops",
    description: "Morning brief",
    type: "bot-team",
    version: "1.0.0",
    visibility: "private",
    providerTypes: ["google-calendar", "gmail"],
    team: {
      members: [
        { role: "agenda", name: "Agenda" },
        { role: "inbox", name: "Inbox" },
      ],
    },
  },
  {
    ref: "trops/inbox",
    displayName: "Inbox",
    author: "trops",
    description: "",
    type: "bot",
    version: "1.0.0",
    visibility: "public",
    providerTypes: ["gmail"],
    bot: { name: "Inbox" },
  },
];

function setup(search = jest.fn().mockResolvedValue(results)) {
  window.mainApi = { bots: { searchRegistry: search } };
  const onPick = jest.fn();
  const onClose = jest.fn();
  render(<RegistryBrowse onPick={onPick} onClose={onClose} />);
  return { search, onPick, onClose };
}

afterEach(() => {
  delete window.mainApi;
});

describe("RegistryBrowse (TEAM-007 slice 3b)", () => {
  it("lists bots and teams from the registry", async () => {
    const { search } = setup();
    expect(await screen.findByText("Daily Brief (test)")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith({ query: "", type: null });
    expect(
      screen.getByText("Team · 2 bots · by trops · v1.0.0 · private"),
    ).toBeInTheDocument();
    expect(screen.getByText("Bot · by trops · v1.0.0")).toBeInTheDocument();
    expect(
      screen.getByText("Needs: google-calendar, gmail"),
    ).toBeInTheDocument();
    expect(screen.getByText("Bots: Agenda, Inbox")).toBeInTheDocument();
  });

  it("searches as you type and filters by type", async () => {
    const { search } = setup();
    await screen.findByText("Inbox");
    fireEvent.change(screen.getByPlaceholderText("Search bots and teams"), {
      target: { value: "gmail" },
    });
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith({ query: "gmail", type: null }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Teams" }));
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith({
        query: "gmail",
        type: "bot-team",
      }),
    );
  });

  it("opens a package for review", async () => {
    const { onPick } = setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Review Inbox" }),
    );
    expect(onPick).toHaveBeenCalledWith("trops/inbox");
  });

  it("says when nothing matches, and when the registry can't be reached", async () => {
    setup(jest.fn().mockResolvedValue([]));
    expect(
      await screen.findByText(/No bots or teams found/),
    ).toBeInTheDocument();
  });

  it("shows an error from the registry", async () => {
    setup(jest.fn().mockRejectedValue(new Error("offline")));
    expect(
      await screen.findByText(/Couldn.t search the registry: offline/),
    ).toBeInTheDocument();
  });

  it("can be closed", async () => {
    const { onClose } = setup();
    await screen.findByText("Inbox");
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
