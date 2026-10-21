import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListenersMap, NotificationsList } from "./ConfigLists";

/**
 * Dashboard Config's whole-dashboard lists (consolidation Phase 3P): what's
 * wired and who notifies, each widget handed to the edit panel.
 */

describe("ListenersMap", () => {
  const emitters = [
    { component: "trops.a.Box", itemId: "4", label: "Search Box" },
  ];
  const receivers = [
    { component: "trops.a.Hits", itemId: "5", label: "Hits", key: "h" },
    { component: "trops.a.Stats", itemId: "6", label: "Stats", key: "s" },
  ];
  const wiring = [
    {
      receiverComponent: "trops.a.Hits",
      receiverItemId: "5",
      handlerName: "onQueryChanged",
      sourceComponent: "trops.a.Box",
      sourceItemId: "4",
      eventName: "queryChanged",
    },
  ];

  test("one row per wiring; a widget that listens to nothing says so", () => {
    render(
      <ListenersMap
        emitters={emitters}
        receivers={receivers}
        wiring={wiring}
        onEditInPanel={() => {}}
      />,
    );
    expect(screen.getByText("Search Box")).toBeInTheDocument();
    expect(screen.getByText("query changed")).toBeInTheDocument();
    expect(screen.getByText("Hits")).toBeInTheDocument();
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
  });

  test("Edit in panel hands the listening widget over, at Listens for", () => {
    const onEditInPanel = jest.fn();
    render(
      <ListenersMap
        emitters={emitters}
        receivers={receivers}
        wiring={wiring}
        onEditInPanel={onEditInPanel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Hits in panel" }));
    expect(onEditInPanel).toHaveBeenCalledWith({
      component: "trops.a.Hits",
      itemId: "5",
      section: "handlers",
    });
  });

  test("nothing can listen: says so", () => {
    render(<ListenersMap onEditInPanel={() => {}} />);
    expect(
      screen.getByText(
        "No widget on this dashboard can listen for events yet.",
      ),
    ).toBeInTheDocument();
  });
});

describe("NotificationsList", () => {
  test("each widget, what it notifies about, and Edit in panel", () => {
    const onEditInPanel = jest.fn();
    render(
      <NotificationsList
        widgets={[
          {
            uuid: "7-r-3",
            component: "ai-built.report.Report",
            itemId: 3,
            title: "Daily Report",
            notifications: [
              { key: "ready", displayName: "Report ready" },
              { key: "failed", displayName: "Report failed" },
            ],
          },
        ]}
        onEditInPanel={onEditInPanel}
      />,
    );
    expect(
      screen.getByText("Report ready · Report failed"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Daily Report in panel" }),
    );
    expect(onEditInPanel).toHaveBeenCalledWith({
      uuid: "7-r-3",
      component: "ai-built.report.Report",
      itemId: 3,
      section: "notifications",
    });
  });

  test("no widget notifies: says so", () => {
    render(<NotificationsList onEditInPanel={() => {}} />);
    expect(
      screen.getByText("No widget on this dashboard sends notifications."),
    ).toBeInTheDocument();
  });
});
