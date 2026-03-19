/**
 * DashboardPublisher.test.js
 *
 * Tests for the core pub/sub event system that powers inter-widget communication.
 * Covers: subscribe, publish, listener dedup, multi-subscriber, registerListeners,
 * cross-provider isolation, and payload shape.
 */

import { DashboardPublisher } from "./DashboardPublisher";

// Silence console.log output from DashboardPublisher internals
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  // Clear all listeners between tests
  DashboardPublisher.listeners().clear();
  // Stub window.mainApi so pub() doesn't throw
  delete window.mainApi;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DashboardPublisher — basic pub/sub", () => {
  test("sub registers a handler and pub delivers the payload", () => {
    const handler = jest.fn();
    const uuid = "widget-aaa";
    const eventType = "SlackListChannels[1].channelSelected";

    DashboardPublisher.sub(eventType, handler, uuid);
    DashboardPublisher.pub(eventType, {
      id: "C123",
      name: "#general",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const call = handler.mock.calls[0][0];
    expect(call.message).toEqual({ id: "C123", name: "#general" });
    expect(call.event).toBe(eventType);
    expect(call.uuid).toBe(uuid);
  });

  test("pub with no subscribers does not throw", () => {
    expect(() => {
      DashboardPublisher.pub("NoWidget[99].noEvent", { id: "x" });
    }).not.toThrow();
  });

  test("multiple subscribers receive the same event", () => {
    const handlerA = jest.fn();
    const handlerB = jest.fn();
    const eventType = "GDriveFileList[2].fileSelected";

    DashboardPublisher.sub(eventType, handlerA, "widget-aaa");
    DashboardPublisher.sub(eventType, handlerB, "widget-bbb");

    DashboardPublisher.pub(eventType, { id: "file-1", name: "doc.pdf" });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  test("duplicate sub from same uuid replaces (not duplicates) handler", () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    const uuid = "widget-aaa";
    const eventType = "GmailInbox[3].emailSelected";

    DashboardPublisher.sub(eventType, handler1, uuid);
    DashboardPublisher.sub(eventType, handler2, uuid);

    DashboardPublisher.pub(eventType, { id: "msg-1" });

    // Only the latest handler should fire
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);

    // Only one entry for this uuid
    const entries = DashboardPublisher.listeners().get(eventType);
    expect(entries.length).toBe(1);
  });
});

describe("DashboardPublisher — registerListeners", () => {
  test("registers listeners from a handler map and listener config", () => {
    const handler = jest.fn();
    const uuid = "widget-ccc";
    const listeners = {
      handleChannelSelected: ["SlackListChannels[1].channelSelected"],
    };
    const handlerMap = { handleChannelSelected: handler };

    DashboardPublisher.registerListeners(listeners, handlerMap, uuid);
    DashboardPublisher.pub("SlackListChannels[1].channelSelected", {
      id: "C456",
      name: "#random",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].message.id).toBe("C456");
  });

  test("registers multiple events for a single handler", () => {
    const handler = jest.fn();
    const uuid = "widget-ddd";
    const listeners = {
      handleEmail: ["GmailInbox[3].emailSelected", "GmailSearch[4].emailFound"],
    };

    DashboardPublisher.registerListeners(
      listeners,
      { handleEmail: handler },
      uuid,
    );

    DashboardPublisher.pub("GmailInbox[3].emailSelected", {
      id: "msg-1",
    });
    DashboardPublisher.pub("GmailSearch[4].emailFound", {
      id: "msg-2",
    });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  test("handles undefined listeners gracefully", () => {
    expect(() => {
      DashboardPublisher.registerListeners(undefined, {}, "uuid");
    }).not.toThrow();
  });

  test("handles non-object listeners gracefully", () => {
    expect(() => {
      DashboardPublisher.registerListeners("not-object", {}, "uuid");
    }).not.toThrow();
  });
});

describe("DashboardPublisher — payload shape", () => {
  test("payload arrives with { message, event, uuid } wrapper", () => {
    const handler = jest.fn();
    const eventType = "GCalUpcoming[5].eventSelected";

    DashboardPublisher.sub(eventType, handler, "widget-eee");
    DashboardPublisher.pub(eventType, {
      id: "evt-1",
      name: "Team Standup",
      startTime: "2026-03-19T10:00:00Z",
    });

    const received = handler.mock.calls[0][0];
    expect(received).toHaveProperty("message");
    expect(received).toHaveProperty("event", eventType);
    expect(received).toHaveProperty("uuid", "widget-eee");
    expect(received.message).toEqual({
      id: "evt-1",
      name: "Team Standup",
      startTime: "2026-03-19T10:00:00Z",
    });
  });

  test("payload with minimal { id, name } shape is delivered intact", () => {
    const handler = jest.fn();
    const eventType = "GitHubRepoList[6].repoSelected";

    DashboardPublisher.sub(eventType, handler, "widget-fff");
    DashboardPublisher.pub(eventType, { id: "repo-1", name: "dash-core" });

    expect(handler.mock.calls[0][0].message).toEqual({
      id: "repo-1",
      name: "dash-core",
    });
  });
});

describe("DashboardPublisher — cross-provider event isolation", () => {
  test("Slack events do not trigger Gmail handlers", () => {
    const slackHandler = jest.fn();
    const gmailHandler = jest.fn();

    DashboardPublisher.sub(
      "SlackListChannels[1].channelSelected",
      slackHandler,
      "slack-widget",
    );
    DashboardPublisher.sub(
      "GmailInbox[3].emailSelected",
      gmailHandler,
      "gmail-widget",
    );

    DashboardPublisher.pub("SlackListChannels[1].channelSelected", {
      id: "C123",
      name: "#general",
    });

    expect(slackHandler).toHaveBeenCalledTimes(1);
    expect(gmailHandler).not.toHaveBeenCalled();
  });

  test("GitHub events do not trigger Google Calendar handlers", () => {
    const githubHandler = jest.fn();
    const gcalHandler = jest.fn();

    DashboardPublisher.sub(
      "GitHubRepoList[6].repoSelected",
      githubHandler,
      "gh-widget",
    );
    DashboardPublisher.sub(
      "GCalUpcoming[5].eventSelected",
      gcalHandler,
      "gcal-widget",
    );

    DashboardPublisher.pub("GitHubRepoList[6].repoSelected", {
      id: "repo-1",
    });

    expect(githubHandler).toHaveBeenCalledTimes(1);
    expect(gcalHandler).not.toHaveBeenCalled();
  });

  test("Google Drive events do not trigger Slack handlers", () => {
    const driveHandler = jest.fn();
    const slackHandler = jest.fn();

    DashboardPublisher.sub(
      "GDriveFileList[2].fileSelected",
      driveHandler,
      "drive-widget",
    );
    DashboardPublisher.sub(
      "SlackChannelMessages[10].messageSelected",
      slackHandler,
      "slack-widget",
    );

    DashboardPublisher.pub("GDriveFileList[2].fileSelected", {
      id: "file-1",
    });

    expect(driveHandler).toHaveBeenCalledTimes(1);
    expect(slackHandler).not.toHaveBeenCalled();
  });
});

describe("DashboardPublisher — multiple instances of same widget type", () => {
  test("two instances of the same widget type can subscribe independently", () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    // Instance 1 subscribes to instance 1's events
    DashboardPublisher.sub(
      "SlackListChannels[1].channelSelected",
      handler1,
      "instance-1",
    );
    // Instance 2 subscribes to instance 2's events
    DashboardPublisher.sub(
      "SlackListChannels[2].channelSelected",
      handler2,
      "instance-2",
    );

    DashboardPublisher.pub("SlackListChannels[1].channelSelected", {
      id: "C1",
    });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).not.toHaveBeenCalled();
  });

  test("two instances subscribing to the same event both receive it", () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    // Both instances listen to the same source event
    DashboardPublisher.sub(
      "GitHubRepoList[6].repoSelected",
      handler1,
      "issue-list-a",
    );
    DashboardPublisher.sub(
      "GitHubRepoList[6].repoSelected",
      handler2,
      "pr-list-b",
    );

    DashboardPublisher.pub("GitHubRepoList[6].repoSelected", {
      id: "repo-1",
      name: "dash-core",
    });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});

describe("DashboardPublisher — IPC bridge", () => {
  test("enableIpcBridge does not throw when mainApi is absent", () => {
    expect(() => DashboardPublisher.enableIpcBridge()).not.toThrow();
  });

  test("disableIpcBridge does not throw when no listener registered", () => {
    expect(() => DashboardPublisher.disableIpcBridge()).not.toThrow();
  });

  test("pub forwards to mainApi.widgetEvent.publish when available", () => {
    const publishSpy = jest.fn();
    window.mainApi = { widgetEvent: { publish: publishSpy } };

    DashboardPublisher.pub("TestWidget[1].testEvent", { id: "1" });

    expect(publishSpy).toHaveBeenCalledWith("TestWidget[1].testEvent", {
      id: "1",
    });
  });
});
