/**
 * GeneralSection — "Bots in the background" (bot-factory US-018 AC1-AC4):
 * keep bots running with the window closed, start at login, keep awake.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GeneralSection } from "./GeneralSection";
import { AppContext } from "../../../Context/App/AppContext";

beforeEach(() => {
  window.mainApi = {
    bots: {
      getSettings: jest.fn().mockResolvedValue({
        autoLeads: true,
        background: true,
        startAtLogin: true,
        keepAwake: false,
      }),
      setSettings: jest.fn().mockResolvedValue({}),
    },
  };
});
afterEach(() => {
  delete window.mainApi;
});

const sw = (name) => screen.getByRole("switch", { name });

test("shows the saved background settings", async () => {
  render(<GeneralSection />);
  expect(await screen.findByText("Bots in the background")).toBeInTheDocument();
  await waitFor(() =>
    expect(sw("Keep bots running when the window is closed")).toBeChecked(),
  );
  expect(sw("Start Dash at login")).toBeChecked();
  expect(sw("Keep the computer awake for scheduled bots")).not.toBeChecked();
});

test("a switch saves its setting", async () => {
  render(<GeneralSection />);
  await waitFor(() =>
    expect(sw("Keep bots running when the window is closed")).toBeChecked(),
  );
  fireEvent.click(sw("Keep the computer awake for scheduled bots"));
  expect(window.mainApi.bots.setSettings).toHaveBeenCalledWith({
    keepAwake: true,
  });
  await waitFor(() =>
    expect(sw("Keep the computer awake for scheduled bots")).toBeChecked(),
  );
});

test("with background off, login and keep-awake don't apply and are hidden", async () => {
  window.mainApi.bots.getSettings.mockResolvedValue({
    background: false,
    startAtLogin: true,
    keepAwake: true,
  });
  render(<GeneralSection />);
  await waitFor(() =>
    expect(sw("Keep bots running when the window is closed")).not.toBeChecked(),
  );
  expect(
    screen.queryByRole("switch", { name: "Start Dash at login" }),
  ).toBeNull();
  expect(
    screen.queryByRole("switch", {
      name: "Keep the computer awake for scheduled bots",
    }),
  ).toBeNull();
});

test("without the bots API the group is hidden", () => {
  delete window.mainApi;
  render(<GeneralSection />);
  expect(screen.queryByText("Bots in the background")).toBeNull();
});

// Design audit follow-up: App info showed no version.
test("App info shows the version the app reports", async () => {
  window.mainApi.app = { getVersion: jest.fn().mockResolvedValue("0.0.1027") };
  render(<GeneralSection />);
  expect(await screen.findByText("0.0.1027")).toBeInTheDocument();
  expect(screen.getByText("Version")).toBeInTheDocument();
});

test("a version passed in is shown without asking", async () => {
  window.mainApi.app = { getVersion: jest.fn() };
  render(
    <AppContext.Provider
      value={{ credentials: { appId: "a", version: "9.9.9" } }}
    >
      <GeneralSection />
    </AppContext.Provider>,
  );
  expect(await screen.findByText("9.9.9")).toBeInTheDocument();
  expect(window.mainApi.app.getVersion).not.toHaveBeenCalled();
});

test("no version handler: no Version row", async () => {
  render(<GeneralSection />);
  await screen.findByText("App info");
  expect(screen.queryByText("Version")).toBeNull();
});
