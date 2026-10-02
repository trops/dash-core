import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TeamLeadSection } from "./TeamLeadSection";

const workspace = { id: 7, name: "Kitchen Sink" };
const lead = {
  id: "lead_7",
  name: "Kitchen Sink Lead",
  role: "lead",
  workspaceId: "7",
};

function setup({ bots = [lead], teamSettings = { leadEnabled: true } } = {}) {
  const api = {
    list: jest.fn().mockResolvedValue(bots),
    getTeamSettings: jest.fn().mockResolvedValue(teamSettings),
    dismissLeadIntro: jest.fn().mockResolvedValue({}),
    setLeadEnabled: jest.fn().mockResolvedValue({}),
    askLead: jest.fn().mockResolvedValue({ status: "completed", output: "ok" }),
    onStream: jest.fn().mockReturnValue("s1"),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots: api };
  render(<TeamLeadSection workspace={workspace} />);
  return api;
}

afterEach(() => {
  delete window.mainApi;
});

describe("TeamLeadSection", () => {
  it("shows the dashboard's lead and its one-time introduction", async () => {
    setup();
    expect(await screen.findByText("Kitchen Sink Lead")).toBeInTheDocument();
    expect(
      screen.getByText(/I'm this dashboard's team lead/),
    ).toBeInTheDocument();
  });

  it("dismissing the introduction remembers it for the dashboard", async () => {
    const api = setup();
    fireEvent.click(await screen.findByLabelText("Dismiss introduction"));
    expect(api.dismissLeadIntro).toHaveBeenCalledWith(7);
    expect(screen.queryByText(/I'm this dashboard's team lead/)).toBeNull();
  });

  it("no introduction once dismissed", async () => {
    setup({ teamSettings: { leadEnabled: true, introDismissed: true } });
    await screen.findByText("Kitchen Sink Lead");
    expect(screen.queryByText(/I'm this dashboard's team lead/)).toBeNull();
  });

  it("Ask the lead opens the chat", async () => {
    setup();
    fireEvent.click(await screen.findByText("Ask the lead"));
    expect(
      screen.getByPlaceholderText(/Ask the lead about this team/),
    ).toBeInTheDocument();
  });

  it("Turn off removes the lead for this dashboard", async () => {
    const api = setup();
    fireEvent.click(await screen.findByText("Turn off"));
    await waitFor(() =>
      expect(api.setLeadEnabled).toHaveBeenCalledWith(7, false, "Kitchen Sink"),
    );
  });

  it("a turned-off lead can be turned back on", async () => {
    const api = setup({ bots: [], teamSettings: { leadEnabled: false } });
    expect(await screen.findByText(/team lead is off/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Turn on"));
    await waitFor(() =>
      expect(api.setLeadEnabled).toHaveBeenCalledWith(7, true, "Kitchen Sink"),
    );
  });

  it("renders nothing without a dashboard", () => {
    window.mainApi = { bots: { list: jest.fn().mockResolvedValue([]) } };
    const { container } = render(<TeamLeadSection workspace={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
