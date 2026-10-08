import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { DraftBanner } from "./DraftBanner";

const draft = {
  id: "d1",
  reasoning: "You asked for a morning summary of urgent mail.",
  definition: { name: "Morning Digest" },
  suggestions: [
    {
      provider: "Gmail New",
      tools: ["search_emails", "read_email"],
      toolsChecked: true,
    },
    { provider: "Slack", tools: ["post_message"], toolsChecked: false },
  ],
  missing: ["Notion"],
  dropped: ['Schedule "every morning" — not a valid schedule.'],
  duplicateOf: null,
};

function renderBanner(over = {}, props = {}) {
  const onDiscard = jest.fn();
  const onOpenSettings = jest.fn();
  render(
    <DraftBanner
      draft={{ ...draft, ...over }}
      onDiscard={onDiscard}
      onOpenSettings={onOpenSettings}
      {...props}
    />,
  );
  return { onDiscard, onOpenSettings };
}

describe("DraftBanner (TEAM-005)", () => {
  it("shows the lead's reasoning and that nothing is on yet", () => {
    renderBanner();
    expect(screen.getByText(/Drafted by your team lead/)).toBeInTheDocument();
    expect(screen.getByText(draft.reasoning)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Nothing is turned on until you accept it below and Save/,
      ),
    ).toBeInTheDocument();
  });

  it("lists suggested providers and tools, marking ones it couldn't check", () => {
    renderBanner();
    expect(
      screen.getByText("Gmail New: search_emails, read_email"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Slack: post_message \(couldn.t check these tools\)/),
    ).toBeInTheDocument();
  });

  it("flags missing providers with a way to Settings › Providers", () => {
    const { onOpenSettings } = renderBanner();
    expect(
      screen.getByText(/Needs a provider you don.t have: Notion/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Settings › Providers"));
    expect(onOpenSettings).toHaveBeenCalledWith("providers");
  });

  it("doesn't repeat needs the form lists as gaps (bot-capabilities CAP-004)", () => {
    renderBanner({
      missing: ["Notion", "download images"],
      gaps: [{ need: "download images", suggestions: [] }],
    });
    expect(
      screen.getByText(/Needs a provider you don.t have: Notion$/),
    ).toBeInTheDocument();
  });

  it("says what was left out, and warns about duplicates", () => {
    renderBanner({ duplicateOf: "Inbox Watch" });
    expect(screen.getByText(/not a valid schedule/)).toBeInTheDocument();
    expect(
      screen.getByText(/already has a bot named "Inbox Watch"/),
    ).toBeInTheDocument();
  });

  it("Discard draft", () => {
    const { onDiscard } = renderBanner();
    fireEvent.click(screen.getByText("Discard draft"));
    expect(onDiscard).toHaveBeenCalled();
  });

  it("keeps quiet sections hidden when empty", () => {
    renderBanner({ suggestions: [], missing: [], dropped: [] });
    expect(screen.queryByText(/Suggested/)).toBeNull();
    expect(screen.queryByText(/Needs a provider/)).toBeNull();
    expect(screen.queryByText(/Left out/)).toBeNull();
  });
});

describe("DraftBanner — notes from the lead", () => {
  it("shows the lead's notes", () => {
    render(
      <DraftBanner
        draft={{ ...draft, notes: ["Tell me which channel to post to."] }}
        onDiscard={() => {}}
      />,
    );
    expect(screen.getByText("Notes from the lead")).toBeInTheDocument();
    expect(
      screen.getByText("Tell me which channel to post to."),
    ).toBeInTheDocument();
  });

  it("adds no outer spacing of its own (it sits inside the form's padded scroll area)", () => {
    const { container } = render(
      <DraftBanner draft={draft} onDiscard={() => {}} />,
    );
    // mx-5 isn't in dash-electron's prebuilt bundle; the form supplies px-6.
    expect(container.innerHTML).not.toMatch(/\bmx-5\b/);
    expect(container.firstChild.className).toMatch(/\brounded-lg\b/);
  });
});
