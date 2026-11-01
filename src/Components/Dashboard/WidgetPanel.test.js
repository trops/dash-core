import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { WidgetPanel } from "./WidgetPanel";
import {
  notePictureFailed,
  _resetPictures,
} from "../../Widget/pictureProblems";

/**
 * The edit panel's widget panel (consolidation Phase 3P): Settings,
 * Connections, Listens for and Advanced, read top to bottom, each saying so
 * when empty; raw settings fold away; a request opens and shows a section;
 * every change goes to onCommit for the dashboard's Save.
 */

let mockConfig = null;
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: () => mockConfig },
}));
jest.mock("../Layout/Builder/Modal/Panel/PanelEditItem", () => ({
  __esModule: true,
  settingFieldId: (key) => `widget-setting-${key}`,
  default: ({ item, workspace, onUpdate, flushRef, onDraft }) => {
    // Like the real one: the panel can apply what is typed via flushRef.
    if (flushRef) {
      flushRef.current = () =>
        onUpdate(
          { ...item, userPrefs: { title: "Typed" } },
          {
            ...workspace,
            layout: [{ ...item, userPrefs: { title: "Typed" } }],
          },
        );
    }
    return (
      <>
        <button
          type="button"
          onClick={() => onDraft && onDraft({ title: "http//10.0.0.107" })}
        >
          type a bad address
        </button>
        <button
          type="button"
          onClick={() => onDraft && onDraft({ title: "Typing" })}
        >
          type a title
        </button>
        <input id="widget-setting-title" aria-label="title field" />
        <button
          type="button"
          onClick={() =>
            onUpdate(
              { ...item, userPrefs: { title: "Edited" } },
              {
                ...workspace,
                layout: [{ ...item, userPrefs: { title: "Edited" } }],
              },
            )
          }
        >
          settings form
        </button>
      </>
    );
  },
}));
jest.mock("../Layout/Builder/Modal/Panel", () => ({
  PanelEditItemProviders: () => <div>connections form</div>,
}));
jest.mock("../Layout/Builder/Modal/Panel/PanelCode", () => ({
  __esModule: true,
  default: () => <div>raw settings editor</div>,
}));
// Cancel puts the widget back as it was selected: one item swapped in its
// page's layout (the real helpers pull in the whole builder).
jest.mock("../../utils/layout", () => ({
  replaceItemInLayout: (layout, id, it) =>
    (layout || []).map((x) => (x.id === id ? it : x)),
}));
jest.mock("../../Models", () => ({
  WorkspaceModel: (ws) => ({ ...ws }),
}));
jest.mock("./ListensFor", () => ({
  ListensFor: ({ name }) => <div>listens for {name}</div>,
}));

const item = {
  id: 3,
  uuid: "7-c-3",
  component: "ai-built.counter.Counter",
  type: "widget",
  userPrefs: { title: "My Counter" },
};
const workspace = { id: 7, layout: [item] };

beforeEach(() => {
  mockConfig = null;
  _resetPictures();
});

test("an empty widget says so in each section", () => {
  mockConfig = { userConfig: {} };
  render(<WidgetPanel item={item} workspace={workspace} name="Counter" />);
  expect(screen.getByText("Counter has no settings.")).toBeInTheDocument();
  expect(screen.getByText("Counter doesn't use any.")).toBeInTheDocument();
  expect(screen.getByText("listens for Counter")).toBeInTheDocument();
  expect(screen.queryByText("raw settings editor")).toBeNull();
});

test("a full widget shows its settings and connections", () => {
  mockConfig = {
    userConfig: { title: { type: "text" } },
    providers: [{ type: "algolia", providerClass: "credential" }],
  };
  render(<WidgetPanel item={item} workspace={workspace} name="Hits" />);
  expect(screen.getByText("settings form")).toBeInTheDocument();
  expect(screen.getByText("connections form")).toBeInTheDocument();
  for (const label of ["Settings", "Connections", "Listens for", "Advanced"]) {
    expect(screen.getByRole("region", { name: label })).toBeInTheDocument();
  }
});

test("raw settings fold away under Advanced", () => {
  render(<WidgetPanel item={item} workspace={workspace} name="Counter" />);
  fireEvent.click(screen.getByRole("button", { name: "Show raw settings" }));
  expect(screen.getByText("raw settings editor")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Hide raw settings" }));
  expect(screen.queryByText("raw settings editor")).toBeNull();
});

test("a request for the raw settings opens them", () => {
  render(
    <WidgetPanel
      item={item}
      workspace={workspace}
      name="Counter"
      focus={{ section: "code", request: 1 }}
    />,
  );
  expect(screen.getByText("raw settings editor")).toBeInTheDocument();
});

test("a change goes to onCommit, for the dashboard's Save", () => {
  mockConfig = { userConfig: { title: { type: "text" } } };
  const onCommit = jest.fn();
  render(
    <WidgetPanel
      item={item}
      workspace={workspace}
      name="Counter"
      onCommit={onCommit}
    />,
  );
  fireEvent.click(screen.getByText("settings form"));
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit.mock.calls[0][0].layout[0].userPrefs).toEqual({
    title: "Edited",
  });
});

test("the dashboard's Save can apply a setting still being typed", () => {
  mockConfig = { userConfig: { title: { type: "text" } } };
  const onCommit = jest.fn();
  const flushRef = { current: null };
  render(
    <WidgetPanel
      item={item}
      workspace={workspace}
      name="Counter"
      onCommit={onCommit}
      flushRef={flushRef}
    />,
  );
  expect(typeof flushRef.current).toBe("function");
  flushRef.current();
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit.mock.calls[0][0].layout[0].userPrefs).toEqual({
    title: "Typed",
  });
});

describe("the Save bar (widget side panel, frames 1-2)", () => {
  test("shows the moment something is typed — no Tab — and Save is the dashboard's", () => {
    mockConfig = { userConfig: { title: { type: "text" } } };
    const onSave = jest.fn();
    render(
      <WidgetPanel
        item={item}
        workspace={workspace}
        name="Counter"
        onSave={onSave}
      />,
    );
    expect(screen.queryByTestId("widget-save-bar")).toBeNull();
    fireEvent.click(screen.getByText("type a title"));
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("a setting that fails holds Save back and says so", () => {
    mockConfig = { userConfig: { title: { type: "url" } } };
    const onSave = jest.fn();
    const checkRef = { current: null };
    render(
      <WidgetPanel
        item={item}
        workspace={workspace}
        name="Counter"
        onSave={onSave}
        checkRef={checkRef}
      />,
    );
    fireEvent.click(screen.getByText("type a bad address"));
    expect(screen.getByText("Fix 1 setting first")).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    // The dashboard's own Save asks first, and is told 1 fails.
    let n;
    act(() => {
      n = checkRef.current();
    });
    expect(n).toBe(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  test("Cancel puts the widget back as it was selected", () => {
    mockConfig = { userConfig: { title: { type: "text" } } };
    const onCommit = jest.fn();
    render(
      <WidgetPanel
        item={item}
        workspace={workspace}
        name="Counter"
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByText("settings form"));
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const last = onCommit.mock.calls[onCommit.mock.calls.length - 1][0];
    expect(last.layout[0].userPrefs).toEqual({ title: "My Counter" });
    expect(screen.queryByTestId("widget-save-bar")).toBeNull();
  });
});

describe("a picture it couldn't show (frame 3)", () => {
  test("the exact address, why, and Copy link", () => {
    mockConfig = { userConfig: { title: { type: "url" } } };
    render(<WidgetPanel item={item} workspace={workspace} name="Counter" />);
    act(() => {
      notePictureFailed(
        "7-c-3",
        "http//10.0.0.107/api/media_player_proxy/x?token=1",
        "file:///x",
      );
    });
    expect(screen.getByText("1 picture didn't load")).toBeInTheDocument();
    expect(
      screen.getByText("http//10.0.0.107/api/media_player_proxy/x?token=1"),
    ).toBeInTheDocument();
    expect(screen.getByText(/missing ":" after http/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy link" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Go to the setting" }),
    ).toBeInTheDocument();
  });
});

describe("View code and Open larger (frames 4-5)", () => {
  test("View code shows the code running now, its version and Copy", () => {
    render(
      <WidgetPanel
        item={item}
        workspace={workspace}
        name="Counter"
        sources={{
          loading: false,
          error: null,
          version: "1.0.4",
          builtAt: null,
          files: [
            { name: "Counter.js", code: "export default 1;" },
            { name: "Counter.dash.js", code: "export default {};" },
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View code" }));
    expect(screen.getByText("Counter · v1.0.4")).toBeInTheDocument();
    expect(screen.getByText("The code running now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  test("Open larger shows the same sections in a modal", () => {
    mockConfig = { userConfig: { title: { type: "text" } } };
    render(<WidgetPanel item={item} workspace={workspace} name="Counter" />);
    fireEvent.click(screen.getByRole("button", { name: "Open larger" }));
    expect(
      screen.getByRole("dialog", { name: "Counter settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Open in the larger view.")).toBeInTheDocument();
    expect(screen.getByText("settings form")).toBeInTheDocument();
  });
});
