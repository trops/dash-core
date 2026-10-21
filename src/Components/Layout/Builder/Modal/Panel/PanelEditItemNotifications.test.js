import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PanelEditItemNotifications } from "./PanelEditItemNotifications";
import {
  PendingSettingsContext,
  createPendingSettings,
} from "../../../../Dashboard/pendingSettings";

/**
 * A widget's notification switches wait for the dashboard's Save while
 * editing (consolidation Phase 3P — they used to save at once, even on
 * Cancel); outside the editor they apply straight away.
 */

jest.mock("../../../../../ComponentManager", () => ({
  ComponentManager: {
    config: () => ({
      notifications: [
        { key: "ready", displayName: "Report ready", defaultEnabled: false },
      ],
    }),
  },
}));

const item = { uuid: "7-report-3", component: "ai-built.report.Report" };

beforeEach(() => {
  window.mainApi = {
    notifications: {
      getPreferences: jest.fn().mockResolvedValue({ instances: {} }),
      setPreferences: jest.fn(),
    },
  };
});

async function renderIt(store) {
  await act(async () => {
    render(
      <PendingSettingsContext.Provider value={store}>
        <PanelEditItemNotifications item={item} workspace={{ id: 7 }} />
      </PendingSettingsContext.Provider>,
    );
  });
}

test("while editing, a switch waits for Save", async () => {
  const store = createPendingSettings();
  await renderIt(store);
  fireEvent.click(screen.getByRole("switch"));
  expect(window.mainApi.notifications.setPreferences).not.toHaveBeenCalled();
  store.take().forEach((apply) => apply());
  expect(window.mainApi.notifications.setPreferences).toHaveBeenCalledWith(
    "7-report-3",
    { ready: true },
  );
});

test("Cancel drops it", async () => {
  const store = createPendingSettings();
  await renderIt(store);
  fireEvent.click(screen.getByRole("switch"));
  store.clear();
  expect(store.take()).toEqual([]);
  expect(window.mainApi.notifications.setPreferences).not.toHaveBeenCalled();
});

test("outside the editor it applies at once", async () => {
  await renderIt(null);
  fireEvent.click(screen.getByRole("switch"));
  expect(window.mainApi.notifications.setPreferences).toHaveBeenCalledWith(
    "7-report-3",
    { ready: true },
  );
});
