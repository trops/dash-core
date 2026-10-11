/**
 * WidgetConfigPanel — a selected widget's settings inline in the edit panel
 * (create-entry PRD CRE-006 AC4/AC5).
 *
 * Pins: the inline sections (Providers only when declared; notifications /
 * schedule behind "More settings…"), each change committed to the
 * dashboard, a working copy the dashboard's echo doesn't reset, a reload
 * when the page changed some other way, and Settings applied on blur.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

let mockSections = [];
jest.mock("../Layout/Builder/Modal/LayoutBuilderConfigModal", () => ({
  getSections: () => mockSections,
}));
jest.mock("../Layout/Builder/Modal/Panel/PanelEditItem", () => ({
  __esModule: true,
  default: ({ item, onUpdate, flushRef }) => {
    // Applies its pending edit only when flushed (like the real one).
    if (flushRef) {
      flushRef.current = () =>
        onUpdate(
          { ...item, userPrefs: { title: "typed" } },
          { id: 1, layout: ["after-settings"] },
        );
    }
    return (
      <div data-testid="settings">
        settings for {item.label}
        <input aria-label="Title" />
      </div>
    );
  },
}));
jest.mock("../Layout/Builder/Modal/Panel", () => ({
  PanelEditItemHandlers: ({ stacked, onUpdate, item }) => (
    <div data-testid="listeners">
      listeners {stacked ? "stacked" : "side-by-side"}
      <button onClick={() => onUpdate(item, { id: 1, layout: ["after-wire"] })}>
        wire
      </button>
    </div>
  ),
  PanelEditItemProviders: () => <div data-testid="providers">providers</div>,
}));
jest.mock("../Layout/Builder/Modal/Panel/PanelCode", () => ({
  __esModule: true,
  default: ({ item }) => <div data-testid="code">code for {item.label}</div>,
}));

import { WidgetConfigPanel, widgetConfigSections } from "./WidgetConfigPanel";

const S = (key, label) => ({ key, label });
const BASE = [
  S("edit", "Settings"),
  S("handlers", "Listeners"),
  S("code", "Code"),
];
const item = { uuid: "w1", label: "Inbox" };
const ws = (layout) => ({ id: 1, layout });

function setup(props = {}) {
  const onCommit = jest.fn();
  const onSectionChange = jest.fn();
  const utils = render(
    <WidgetConfigPanel
      item={item}
      workspace={ws(["start"])}
      onCommit={onCommit}
      onSectionChange={onSectionChange}
      {...props}
    />,
  );
  return { ...utils, onCommit, onSectionChange };
}

beforeEach(() => {
  mockSections = BASE;
});

describe("widgetConfigSections", () => {
  test("keeps Settings / Listeners / Providers / Code inline; others are 'more'", () => {
    mockSections = [
      ...BASE,
      S("providers", "Providers"),
      S("schedule", "Schedule"),
    ];
    const out = widgetConfigSections(item);
    expect(out.inline.map((s) => s.key)).toEqual([
      "edit",
      "handlers",
      "code",
      "providers",
    ]);
    expect(out.hasMore).toBe(true);
  });
});

describe("WidgetConfigPanel", () => {
  test("opens on Settings with a tab per inline section", () => {
    setup();
    expect(screen.getByTestId("settings")).toHaveTextContent("Inbox");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Settings",
      "Listeners",
      "Code",
    ]);
    expect(screen.queryByRole("tab", { name: "Providers" })).toBeNull();
    expect(screen.queryByText("More settings…")).toBeNull();
  });

  test("a section asked for opens; tabs report the change", () => {
    const { onSectionChange } = setup({ section: "handlers" });
    expect(screen.getByTestId("listeners")).toHaveTextContent("stacked");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Code" }));
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(onSectionChange).toHaveBeenCalledWith("code");
  });

  test("an unknown section falls back to Settings", () => {
    setup({ section: "providers" });
    expect(screen.getByTestId("settings")).toBeInTheDocument();
  });

  test("a change is committed to the dashboard right away", () => {
    const { onCommit } = setup({ section: "handlers" });
    fireEvent.click(screen.getByText("wire"));
    expect(onCommit).toHaveBeenCalledWith(ws(["after-wire"]));
  });

  test("Settings applies its edit when the field loses focus", () => {
    const { onCommit } = setup();
    fireEvent.blur(screen.getByLabelText("Title"));
    expect(onCommit).toHaveBeenCalledWith(ws(["after-settings"]));
  });

  test("the dashboard echoing our change doesn't reset the working copy; an outside change does", () => {
    const { onCommit, rerender } = setup({ section: "code" });
    expect(screen.getByTestId("code")).toHaveTextContent("Inbox");
    // Commit a change through Listeners first, then switch back to Code.
    rerender(
      <WidgetConfigPanel
        item={item}
        workspace={ws(["start"])}
        section="handlers"
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByText("wire"));
    const committed = onCommit.mock.calls[0][0];
    // The dashboard hands back our own layout with a re-prepared item.
    rerender(
      <WidgetConfigPanel
        item={{ ...item, label: "Re-prepared" }}
        workspace={committed}
        section="code"
        onCommit={onCommit}
      />,
    );
    expect(screen.getByTestId("code")).toHaveTextContent("Inbox");
    // Something else changed the page (a move): reload from it.
    rerender(
      <WidgetConfigPanel
        item={{ ...item, label: "Moved" }}
        workspace={ws(["moved"])}
        section="code"
        onCommit={onCommit}
      />,
    );
    expect(screen.getByTestId("code")).toHaveTextContent("Moved");
  });

  test("other sections are behind More settings…", () => {
    mockSections = [...BASE, S("notifications", "Notifications")];
    const onOpenMore = jest.fn();
    setup({ onOpenMore });
    fireEvent.click(screen.getByText("More settings…"));
    expect(onOpenMore).toHaveBeenCalled();
  });
});
