/**
 * @jest-environment jsdom
 *
 * McpServerSection — a failed start (port in use) keeps its error on
 * screen through the status poll, and a port typed while the server is
 * stopped is the one the next start uses (QA 2026-10-22).
 */

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@trops/dash-react", () => ({
  Switch: ({ checked, onChange }) => (
    <button data-testid="toggle" onClick={() => onChange(!checked)}>
      {checked ? "on" : "off"}
    </button>
  ),
  SubHeading3: ({ title }) => <h3>{title}</h3>,
  Button: ({ title, onClick }) => <button onClick={onClick}>{title}</button>,
  DataList: Object.assign(({ children }) => <dl>{children}</dl>, {
    Item: ({ label, value }) => (
      <div>
        {label}: {value}
      </div>
    ),
  }),
  FontAwesomeIcon: () => null,
}));

import { McpServerSection } from "./McpServerSection";

const stopped = {
  running: false,
  enabled: false,
  port: 3141,
  connectionCount: 0,
  uptime: 0,
  toolCount: 0,
  resourceCount: 0,
};

function installApi(startServer) {
  const getStatus = jest.fn().mockResolvedValue(stopped);
  window.mainApi = {
    mcpDashServer: {
      getStatus,
      getToken: jest.fn().mockResolvedValue("tok"),
      startServer,
      stopServer: jest.fn().mockResolvedValue({ success: true }),
    },
  };
  return getStatus;
}

async function renderSection() {
  render(<McpServerSection />);
  await screen.findByText("Port");
}

afterEach(() => {
  jest.useRealTimers();
  delete window.mainApi;
});

describe("McpServerSection", () => {
  it("keeps a failed start's error through the status poll", async () => {
    jest.useFakeTimers();
    const startServer = jest.fn().mockResolvedValue({
      success: false,
      error: "Port 3141 is already in use",
    });
    const getStatus = installApi(startServer);
    await renderSection();

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });
    expect(screen.getByText("Port 3141 is already in use")).toBeInTheDocument();

    const polls = getStatus.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(3100);
    });
    expect(getStatus.mock.calls.length).toBeGreaterThan(polls);
    expect(screen.getByText("Port 3141 is already in use")).toBeInTheDocument();
  });

  it("starts on a port typed while the server is stopped", async () => {
    const startServer = jest.fn().mockResolvedValue({ success: true });
    installApi(startServer);
    await renderSection();

    const input = screen.getByDisplayValue("3141");
    fireEvent.change(input, { target: { value: "3150" } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue("3150")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle"));
    });
    expect(startServer).toHaveBeenCalledWith(3150);
  });
});
