import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * A widget's settings, checked as they're set (widget side panel, approved
 * mockup frames 2 and 4): a URL that isn't one says so with what it
 * probably meant, required is enforced, numbers keep what was typed, and a
 * type Dash doesn't know is still shown.
 */

let mockUserConfig = {};
jest.mock("../../../../../ComponentManager", () => ({
  ComponentManager: {
    getComponent: () => ({ userConfig: mockUserConfig }),
  },
}));
jest.mock("../../../../../utils/layout", () => ({
  replaceItemInLayout: (layout) => layout,
}));
jest.mock("../../../../../Models", () => ({
  WorkspaceModel: (ws) => ({ ...ws }),
}));

const { PanelEditItem } = require("./PanelEditItem");

const itemWith = (userPrefs) => ({
  id: 2,
  uuid: "u-2",
  component: "ai-built.player.Player",
  userPrefs,
});
const workspace = { id: 1, layout: [] };

const field = (label) => screen.getByLabelText(label);

test("a URL that already fails says so at once, with what it meant", () => {
  mockUserConfig = {
    haBaseUrl: {
      type: "url",
      displayName: "Home Assistant URL",
      instructions: "e.g. http://10.0.0.107",
    },
  };
  const onDraft = jest.fn();
  render(
    <PanelEditItem
      item={itemWith({ haBaseUrl: "http//10.0.0.107" })}
      workspace={workspace}
      onUpdate={() => {}}
      onDraft={onDraft}
    />,
  );
  expect(
    screen.getByText(
      "Not a web address. It should look like http://10.0.0.107",
    ),
  ).toBeInTheDocument();
  expect(field("Home Assistant URL")).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByText("Did you mean http://10.0.0.107?"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use this" }));
  expect(field("Home Assistant URL")).toHaveValue("http://10.0.0.107");
  expect(onDraft).toHaveBeenLastCalledWith({ haBaseUrl: "http://10.0.0.107" });
  expect(screen.queryByText(/Not a web address/)).toBeNull();
});

test("a fresh field is checked when it's left, not on the first keystroke", () => {
  mockUserConfig = { site: { type: "url", displayName: "Site" } };
  render(
    <PanelEditItem
      item={itemWith({ site: "" })}
      workspace={workspace}
      onUpdate={() => {}}
    />,
  );
  fireEvent.change(field("Site"), { target: { value: "h" } });
  expect(screen.queryByText(/Not a web address/)).toBeNull();
  fireEvent.blur(field("Site"));
  expect(screen.getByText(/Not a web address/)).toBeInTheDocument();
});

test("a pause in typing shows the check while the cursor is still in the field", () => {
  jest.useFakeTimers();
  try {
    mockUserConfig = { site: { type: "url", displayName: "Site" } };
    render(
      <PanelEditItem
        item={itemWith({ site: "" })}
        workspace={workspace}
        onUpdate={() => {}}
      />,
    );
    fireEvent.change(field("Site"), { target: { value: "http//10.0.0.107" } });
    expect(screen.queryByText(/Not a web address/)).toBeNull();
    React.act(() => {
      jest.advanceTimersByTime(800);
    });
    expect(screen.getByText(/Not a web address/)).toBeInTheDocument();
    expect(
      screen.getByText("Did you mean http://10.0.0.107?"),
    ).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

test('a widget made before the "url" type: its text URL setting is checked as one', () => {
  mockUserConfig = {
    haBaseUrl: {
      type: "text",
      displayName: "Home Assistant URL",
    },
  };
  render(
    <PanelEditItem
      item={itemWith({ haBaseUrl: "" })}
      workspace={workspace}
      onUpdate={() => {}}
    />,
  );
  fireEvent.change(field("Home Assistant URL"), {
    target: { value: "http//10.0.0.107" },
  });
  fireEvent.blur(field("Home Assistant URL"));
  expect(screen.getByText(/Not a web address/)).toBeInTheDocument();
  expect(
    screen.getByText("Did you mean http://10.0.0.107?"),
  ).toBeInTheDocument();
});

test("required, and a Save held back shows every failing field", () => {
  mockUserConfig = {
    player: { type: "text", displayName: "Player name", required: true },
  };
  render(
    <PanelEditItem
      item={itemWith({ player: "" })}
      workspace={workspace}
      onUpdate={() => {}}
      showAllErrors
    />,
  );
  expect(screen.getByText("Player name is required.")).toBeInTheDocument();
});

test("a number keeps what was typed and says what's wrong", () => {
  mockUserConfig = {
    every: {
      type: "number",
      displayName: "Refresh every (seconds)",
      min: 2,
      max: 60,
    },
  };
  const onDraft = jest.fn();
  render(
    <PanelEditItem
      item={itemWith({ every: 5 })}
      workspace={workspace}
      onUpdate={() => {}}
      onDraft={onDraft}
    />,
  );
  fireEvent.change(field("Refresh every (seconds)"), {
    target: { value: "300" },
  });
  expect(onDraft).toHaveBeenLastCalledWith({ every: 300 });
  fireEvent.blur(field("Refresh every (seconds)"));
  expect(screen.getByText("Must be between 2 and 60.")).toBeInTheDocument();
  fireEvent.change(field("Refresh every (seconds)"), {
    target: { value: "1x" },
  });
  expect(onDraft).toHaveBeenLastCalledWith({ every: "1x" });
  expect(field("Refresh every (seconds)")).toHaveValue("1x");
});

test("a type Dash doesn't know is still shown, as text", () => {
  mockUserConfig = { color: { type: "colour", displayName: "Colour" } };
  render(
    <PanelEditItem
      item={itemWith({ color: "red" })}
      workspace={workspace}
      onUpdate={() => {}}
    />,
  );
  expect(field("Colour")).toHaveValue("red");
  expect(screen.getByText(/asked for a “colour” setting/)).toBeInTheDocument();
});

describe("review fixes", () => {
  test("a yes/no setting is a switch, and stays a boolean", () => {
    mockUserConfig = { shuffle: { type: "boolean", displayName: "Shuffle" } };
    const onDraft = jest.fn();
    render(
      <PanelEditItem
        item={itemWith({ shuffle: true })}
        workspace={workspace}
        onUpdate={() => {}}
        onDraft={onDraft}
      />,
    );
    const sw = screen.getByRole("switch");
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(onDraft).toHaveBeenLastCalledWith({ shuffle: false });
    expect(screen.queryByText(/Dash doesn't know/)).toBeNull();
  });

  test("an unknown setting holding a list isn't flattened to text", () => {
    mockUserConfig = { rooms: { type: "rooms", displayName: "Rooms" } };
    render(
      <PanelEditItem
        item={itemWith({ rooms: ["Kitchen", "Den"] })}
        workspace={workspace}
        onUpdate={() => {}}
      />,
    );
    expect(screen.getByText('["Kitchen","Den"]')).toBeInTheDocument();
    expect(screen.getByText(/Advanced: raw settings/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("leaving with a number that isn't one keeps the last good value", () => {
    mockUserConfig = {
      rows: { type: "number", displayName: "Rows", min: 1, max: 10 },
    };
    const onUpdate = jest.fn();
    const { unmount } = render(
      <PanelEditItem
        item={itemWith({ rows: 3 })}
        workspace={{ id: 1, layout: [itemWith({ rows: 3 })] }}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.change(screen.getByLabelText("Rows"), {
      target: { value: "9999" },
    });
    unmount();
    expect(onUpdate).toHaveBeenCalled();
    expect(
      onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0].userPrefs,
    ).toEqual({ rows: 3 });
  });
});
