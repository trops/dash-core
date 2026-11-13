/**
 * The events every widget sends, sent by Dash (the approved "Widget, step
 * by step" Talks to step): readComplete, readFailed, renderComplete — on
 * the widget's own name, stamped with its dashboard.
 */
import { DashboardPublisher } from "../DashboardPublisher";
import {
  RESERVED_WIDGET_EVENTS,
  classifyTool,
  resultText,
  sendReadEvent,
  sendRenderEvent,
  widgetEventName,
} from "./widgetEvents";

jest.mock("../DashboardPublisher", () => ({
  DashboardPublisher: { pub: jest.fn() },
}));

const widget = { componentName: "Calendar", id: 12, dashboardId: 7 };

beforeEach(() => DashboardPublisher.pub.mockClear());

describe("widget events sent by Dash", () => {
  test("the three, by name", () => {
    expect(RESERVED_WIDGET_EVENTS).toEqual([
      "readComplete",
      "renderComplete",
      "readFailed",
    ]);
  });

  test("a widget event's name: Component[item id].event", () => {
    expect(widgetEventName("Calendar", 12, "readComplete")).toBe(
      "Calendar[12].readComplete",
    );
    expect(widgetEventName("Calendar", 0, "x")).toBe("Calendar[0].x");
    expect(widgetEventName("", 12, "x")).toBeNull();
    expect(widgetEventName("Calendar", null, "x")).toBeNull();
  });

  test("a read that worked: readComplete with the tool and what it read", () => {
    sendReadEvent(widget, {
      provider: "Google Calendar",
      tool: "list-events",
      result: { content: [{ type: "text", text: "Standup 9:00" }] },
    });
    expect(DashboardPublisher.pub).toHaveBeenCalledWith(
      "Calendar[12].readComplete",
      expect.objectContaining({
        provider: "Google Calendar",
        tool: "list-events",
        result: "Standup 9:00",
      }),
      { workspaceId: 7 },
    );
  });

  test("a read that failed: readFailed with what went wrong", () => {
    sendReadEvent(widget, {
      provider: "Google Calendar",
      tool: "list-events",
      error: "not signed in",
    });
    expect(DashboardPublisher.pub).toHaveBeenCalledWith(
      "Calendar[12].readFailed",
      expect.objectContaining({ tool: "list-events", error: "not signed in" }),
      { workspaceId: 7 },
    );
  });

  test("a call that changes things isn't a read: nothing is sent", () => {
    sendReadEvent(widget, { tool: "create-event", result: {} });
    sendReadEvent(widget, { tool: "ha_add_todo_item", error: "no" });
    expect(DashboardPublisher.pub).not.toHaveBeenCalled();
  });

  test("on screen: renderComplete", () => {
    sendRenderEvent(widget);
    expect(DashboardPublisher.pub).toHaveBeenCalledWith(
      "Calendar[12].renderComplete",
      expect.objectContaining({ at: expect.any(String) }),
      { workspaceId: 7 },
    );
  });

  test("no name, nothing sent; a failing bus never breaks the widget", () => {
    sendRenderEvent({ id: 3 });
    expect(DashboardPublisher.pub).not.toHaveBeenCalled();
    DashboardPublisher.pub.mockImplementationOnce(() => {
      throw new Error("bus down");
    });
    expect(() => sendRenderEvent(widget)).not.toThrow();
  });

  test("what it read is kept short", () => {
    const long = "x".repeat(5000);
    expect(
      resultText({ content: [{ type: "text", text: long }] }),
    ).toHaveLength(2001);
    expect(resultText(null)).toBe("");
  });
});

describe("classifyTool (as roleTools.classifyTool)", () => {
  test("the first verb decides; the read-only flag wins", () => {
    expect(classifyTool("list-events")).toBe("read");
    expect(classifyTool("ha_config_get_calendar_events")).toBe("read");
    expect(classifyTool("create-event")).toBe("change");
    expect(classifyTool("ha_add_todo_item")).toBe("change");
    expect(classifyTool("frobnicate")).toBe("unknown");
    expect(
      classifyTool({ name: "create-x", annotations: { readOnlyHint: true } }),
    ).toBe("read");
  });

  test("the verbs are the same as the main process's", () => {
    const fs = require("fs");
    const path = require("path");
    const verbs = (file) => {
      const src = fs.readFileSync(path.join(__dirname, file), "utf8");
      return [...src.matchAll(/new Set\(\s*"([^"]+)"/g)].map((m) => m[1]);
    };
    const main = verbs("../../electron/bots/roleTools.js");
    expect(main).toHaveLength(2);
    expect(verbs("./widgetEvents.js")).toEqual(main);
  });

  test("the names are the same as the main process's", () => {
    // eslint-disable-next-line global-require
    const main = require("../../electron/bots/widgetEvents");
    expect(main.RESERVED_WIDGET_EVENTS).toEqual(RESERVED_WIDGET_EVENTS);
  });
});
