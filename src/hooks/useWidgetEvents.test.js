/**
 * useWidgetEvents.test.js — Inter-widget event pub/sub wiring tests
 *
 * DASH-171: Test inter-widget event pub/sub wiring
 *
 * Tests the DashboardPublisher and event system that underpins all
 * inter-widget communication across provider widget sets:
 *   - Slack: channelSelected chain
 *   - Google Drive: fileSelected chain
 *   - Gmail: emailSelected chain
 *   - Google Calendar: eventSelected chain
 *   - GitHub: repoSelected + issueSelected chains
 *   - Gong: callSelected chain
 *
 * Also verifies:
 *   - Correct payload shape { id, name, ...metadata }
 *   - Graceful handling of missing/stale events
 *   - Cross-provider event isolation
 *   - Multiple instances of same widget type
 */

import { DashboardPublisher } from "../DashboardPublisher";

// Suppress console.log noise from DashboardPublisher.emit
beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  // Clear all event subscriptions between tests
  DashboardPublisher.listeners().clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a formatted event name matching useWidgetEvents convention:
 *   ComponentName[id].eventName
 */
function eventName(component, id, event) {
  return `${component}[${id}].${event}`;
}

/**
 * Subscribe a widget to listen for events via registerListeners
 * (mirrors what useWidgetEvents.listen() does internally).
 */
function wireListener(handlerKey, eventStrings, handler, uuid) {
  const listeners = { [handlerKey]: eventStrings };
  const handlerMap = { [handlerKey]: handler };
  DashboardPublisher.registerListeners(listeners, handlerMap, uuid);
}

// ===========================================================================
// 1. SLACK: channelSelected chain
//    ListChannels → ChannelMessages, PostMessage
// ===========================================================================

describe("Slack: channelSelected event chain", () => {
  const CHANNEL_PAYLOAD = {
    id: "C01ABC",
    name: "general",
    topic: "Company-wide announcements",
  };

  test("SlackListChannels publishes channelSelected to SlackChannelMessages", () => {
    const received = [];
    const channelMessagesUuid = "dash-1-SlackChannelMessages-1";
    const listChannelsEvent = eventName(
      "SlackListChannels",
      1,
      "channelSelected",
    );

    wireListener(
      "channelSelected",
      [listChannelsEvent],
      (data) => received.push(data),
      channelMessagesUuid,
    );

    DashboardPublisher.pub(listChannelsEvent, CHANNEL_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message).toEqual(CHANNEL_PAYLOAD);
    expect(received[0].message.id).toBe("C01ABC");
    expect(received[0].message.name).toBe("general");
  });

  test("SlackListChannels publishes channelSelected to SlackPostMessage", () => {
    const received = [];
    const postMessageUuid = "dash-1-SlackPostMessage-1";
    const listChannelsEvent = eventName(
      "SlackListChannels",
      1,
      "channelSelected",
    );

    wireListener(
      "channelSelected",
      [listChannelsEvent],
      (data) => received.push(data),
      postMessageUuid,
    );

    DashboardPublisher.pub(listChannelsEvent, CHANNEL_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe("C01ABC");
  });

  test("both ChannelMessages and PostMessage receive the same event", () => {
    const messagesReceived = [];
    const postReceived = [];
    const listChannelsEvent = eventName(
      "SlackListChannels",
      1,
      "channelSelected",
    );

    wireListener(
      "channelSelected",
      [listChannelsEvent],
      (data) => messagesReceived.push(data),
      "dash-1-SlackChannelMessages-1",
    );
    wireListener(
      "channelSelected",
      [listChannelsEvent],
      (data) => postReceived.push(data),
      "dash-1-SlackPostMessage-1",
    );

    DashboardPublisher.pub(listChannelsEvent, CHANNEL_PAYLOAD);

    expect(messagesReceived).toHaveLength(1);
    expect(postReceived).toHaveLength(1);
    expect(messagesReceived[0].message).toEqual(postReceived[0].message);
  });
});

// ===========================================================================
// 2. GOOGLE DRIVE: fileSelected chain
//    FileList / FileSearch → FilePreview
// ===========================================================================

describe("Google Drive: fileSelected event chain", () => {
  const FILE_PAYLOAD = {
    id: "file-abc123",
    name: "Project Roadmap.pdf",
    mimeType: "application/pdf",
  };

  test("GDriveFileList publishes fileSelected to GDriveFilePreview", () => {
    const received = [];
    const fileListEvent = eventName("GDriveFileList", 1, "fileSelected");

    wireListener(
      "fileSelected",
      [fileListEvent],
      (data) => received.push(data),
      "dash-1-GDriveFilePreview-1",
    );

    DashboardPublisher.pub(fileListEvent, FILE_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe("file-abc123");
    expect(received[0].message.name).toBe("Project Roadmap.pdf");
    expect(received[0].message.mimeType).toBe("application/pdf");
  });

  test("GDriveFileSearch publishes fileSelected to GDriveFilePreview", () => {
    const received = [];
    const fileSearchEvent = eventName("GDriveFileSearch", 1, "fileSelected");

    wireListener(
      "fileSelected",
      [fileSearchEvent],
      (data) => received.push(data),
      "dash-1-GDriveFilePreview-1",
    );

    DashboardPublisher.pub(fileSearchEvent, FILE_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message).toEqual(FILE_PAYLOAD);
  });

  test("FilePreview can listen to both FileList and FileSearch simultaneously", () => {
    const received = [];
    const fileListEvent = eventName("GDriveFileList", 1, "fileSelected");
    const fileSearchEvent = eventName("GDriveFileSearch", 1, "fileSelected");

    wireListener(
      "fileSelected",
      [fileListEvent, fileSearchEvent],
      (data) => received.push(data),
      "dash-1-GDriveFilePreview-1",
    );

    DashboardPublisher.pub(fileListEvent, FILE_PAYLOAD);
    DashboardPublisher.pub(fileSearchEvent, {
      ...FILE_PAYLOAD,
      name: "Budget.xlsx",
    });

    expect(received).toHaveLength(2);
    expect(received[0].message.name).toBe("Project Roadmap.pdf");
    expect(received[1].message.name).toBe("Budget.xlsx");
  });
});

// ===========================================================================
// 3. GMAIL: emailSelected chain
//    Inbox / Search → MessageView, Compose
// ===========================================================================

describe("Gmail: emailSelected event chain", () => {
  const EMAIL_PAYLOAD = {
    id: "msg-xyz789",
    name: "Re: Q4 Planning",
    from: "alice@example.com",
    threadId: "thread-001",
  };

  test("GmailInbox publishes emailSelected to GmailMessageView", () => {
    const received = [];
    const inboxEvent = eventName("GmailInbox", 1, "emailSelected");

    wireListener(
      "emailSelected",
      [inboxEvent],
      (data) => received.push(data),
      "dash-1-GmailMessageView-1",
    );

    DashboardPublisher.pub(inboxEvent, EMAIL_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe("msg-xyz789");
    expect(received[0].message.name).toBe("Re: Q4 Planning");
    expect(received[0].message.from).toBe("alice@example.com");
  });

  test("GmailSearch publishes emailSelected to GmailMessageView", () => {
    const received = [];
    const searchEvent = eventName("GmailSearch", 1, "emailSelected");

    wireListener(
      "emailSelected",
      [searchEvent],
      (data) => received.push(data),
      "dash-1-GmailMessageView-1",
    );

    DashboardPublisher.pub(searchEvent, EMAIL_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message).toEqual(EMAIL_PAYLOAD);
  });

  test("GmailInbox publishes emailSelected to GmailCompose (reply context)", () => {
    const received = [];
    const inboxEvent = eventName("GmailInbox", 1, "emailSelected");

    wireListener(
      "emailSelected",
      [inboxEvent],
      (data) => received.push(data),
      "dash-1-GmailCompose-1",
    );

    DashboardPublisher.pub(inboxEvent, EMAIL_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.threadId).toBe("thread-001");
  });
});

// ===========================================================================
// 4. GOOGLE CALENDAR: eventSelected chain
//    Upcoming → EventDetail
// ===========================================================================

describe("Google Calendar: eventSelected event chain", () => {
  const CALENDAR_PAYLOAD = {
    id: "evt-cal-456",
    name: "Sprint Planning",
    start: "2026-03-20T10:00:00Z",
    end: "2026-03-20T11:00:00Z",
  };

  test("GoogleCalendarUpcoming publishes eventSelected to GoogleCalendarEventDetail", () => {
    const received = [];
    const upcomingEvent = eventName(
      "GoogleCalendarUpcoming",
      1,
      "eventSelected",
    );

    wireListener(
      "eventSelected",
      [upcomingEvent],
      (data) => received.push(data),
      "dash-1-GoogleCalendarEventDetail-1",
    );

    DashboardPublisher.pub(upcomingEvent, CALENDAR_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe("evt-cal-456");
    expect(received[0].message.name).toBe("Sprint Planning");
    expect(received[0].message.start).toBe("2026-03-20T10:00:00Z");
  });
});

// ===========================================================================
// 5. GITHUB: repoSelected + issueSelected chains
//    RepoList → IssueList, PRList
//    IssueList → IssueDetail
// ===========================================================================

describe("GitHub: repoSelected event chain", () => {
  const REPO_PAYLOAD = {
    id: 12345,
    name: "dash-core",
    fullName: "trops/dash-core",
    defaultBranch: "master",
  };

  test("GitHubRepoList publishes repoSelected to GitHubIssueList", () => {
    const received = [];
    const repoEvent = eventName("GitHubRepoList", 1, "repoSelected");

    wireListener(
      "repoSelected",
      [repoEvent],
      (data) => received.push(data),
      "dash-1-GitHubIssueList-1",
    );

    DashboardPublisher.pub(repoEvent, REPO_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe(12345);
    expect(received[0].message.fullName).toBe("trops/dash-core");
  });

  test("GitHubRepoList publishes repoSelected to GitHubPRList", () => {
    const received = [];
    const repoEvent = eventName("GitHubRepoList", 1, "repoSelected");

    wireListener(
      "repoSelected",
      [repoEvent],
      (data) => received.push(data),
      "dash-1-GitHubPRList-1",
    );

    DashboardPublisher.pub(repoEvent, REPO_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.fullName).toBe("trops/dash-core");
  });

  test("both IssueList and PRList receive repoSelected from same publish", () => {
    const issueReceived = [];
    const prReceived = [];
    const repoEvent = eventName("GitHubRepoList", 1, "repoSelected");

    wireListener(
      "repoSelected",
      [repoEvent],
      (data) => issueReceived.push(data),
      "dash-1-GitHubIssueList-1",
    );
    wireListener(
      "repoSelected",
      [repoEvent],
      (data) => prReceived.push(data),
      "dash-1-GitHubPRList-1",
    );

    DashboardPublisher.pub(repoEvent, REPO_PAYLOAD);

    expect(issueReceived).toHaveLength(1);
    expect(prReceived).toHaveLength(1);
    expect(issueReceived[0].message).toEqual(prReceived[0].message);
  });
});

describe("GitHub: issueSelected event chain", () => {
  const ISSUE_PAYLOAD = {
    id: 9876,
    name: "Fix login bug",
    number: 42,
    repo: "trops/dash-core",
  };

  test("GitHubIssueList publishes issueSelected to GitHubIssueDetail", () => {
    const received = [];
    const issueEvent = eventName("GitHubIssueList", 1, "issueSelected");

    wireListener(
      "issueSelected",
      [issueEvent],
      (data) => received.push(data),
      "dash-1-GitHubIssueDetail-1",
    );

    DashboardPublisher.pub(issueEvent, ISSUE_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe(9876);
    expect(received[0].message.number).toBe(42);
    expect(received[0].message.name).toBe("Fix login bug");
    expect(received[0].message.repo).toBe("trops/dash-core");
  });
});

// ===========================================================================
// 6. GONG: callSelected chain
//    GongCallSearch / GongLibraryFolders → GongCallDetail, GongCallSummary, GongCallTranscript
// ===========================================================================

describe("Gong: callSelected event chain", () => {
  const CALL_PAYLOAD = {
    id: "call-123",
    title: "Q4 Strategy Review",
    date: "2026-03-15T14:00:00Z",
    duration: 1800,
    scope: "external",
  };

  test("GongCallSearch publishes callSelected to GongCallDetail", () => {
    const received = [];
    const callEvent = eventName("GongCallSearch", 1, "callSelected");

    wireListener(
      "callSelected",
      [callEvent],
      (data) => received.push(data),
      "dash-1-GongCallDetail-1",
    );

    DashboardPublisher.pub(callEvent, CALL_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe("call-123");
    expect(received[0].message.title).toBe("Q4 Strategy Review");
    expect(received[0].message.duration).toBe(1800);
    expect(received[0].message.scope).toBe("external");
  });

  test("GongCallSearch publishes callSelected to GongCallSummary", () => {
    const received = [];
    const callEvent = eventName("GongCallSearch", 1, "callSelected");

    wireListener(
      "callSelected",
      [callEvent],
      (data) => received.push(data),
      "dash-1-GongCallSummary-1",
    );

    DashboardPublisher.pub(callEvent, CALL_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe("call-123");
    expect(received[0].message.title).toBe("Q4 Strategy Review");
  });

  test("GongCallSearch publishes callSelected to GongCallTranscript", () => {
    const received = [];
    const callEvent = eventName("GongCallSearch", 1, "callSelected");

    wireListener(
      "callSelected",
      [callEvent],
      (data) => received.push(data),
      "dash-1-GongCallTranscript-1",
    );

    DashboardPublisher.pub(callEvent, CALL_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe("call-123");
    expect(received[0].message.title).toBe("Q4 Strategy Review");
    expect(received[0].message.date).toBe("2026-03-15T14:00:00Z");
  });

  test("all three Gong receivers get the same callSelected event", () => {
    const detailRx = [];
    const summaryRx = [];
    const transcriptRx = [];
    const callEvent = eventName("GongCallSearch", 1, "callSelected");

    wireListener(
      "callSelected",
      [callEvent],
      (d) => detailRx.push(d),
      "dash-1-GongCallDetail-1",
    );
    wireListener(
      "callSelected",
      [callEvent],
      (d) => summaryRx.push(d),
      "dash-1-GongCallSummary-1",
    );
    wireListener(
      "callSelected",
      [callEvent],
      (d) => transcriptRx.push(d),
      "dash-1-GongCallTranscript-1",
    );

    DashboardPublisher.pub(callEvent, CALL_PAYLOAD);

    expect(detailRx).toHaveLength(1);
    expect(summaryRx).toHaveLength(1);
    expect(transcriptRx).toHaveLength(1);
    expect(detailRx[0].message).toEqual(summaryRx[0].message);
    expect(summaryRx[0].message).toEqual(transcriptRx[0].message);
  });

  test("GongLibraryFolders publishes callSelected to GongCallDetail", () => {
    const received = [];
    const folderEvent = eventName("GongLibraryFolders", 1, "callSelected");

    wireListener(
      "callSelected",
      [folderEvent],
      (data) => received.push(data),
      "dash-1-GongCallDetail-1",
    );

    DashboardPublisher.pub(folderEvent, CALL_PAYLOAD);

    expect(received).toHaveLength(1);
    expect(received[0].message.id).toBe("call-123");
  });

  test("GongCallDetail can listen to both GongCallSearch and GongLibraryFolders", () => {
    const received = [];
    const searchEvent = eventName("GongCallSearch", 1, "callSelected");
    const folderEvent = eventName("GongLibraryFolders", 1, "callSelected");

    wireListener(
      "callSelected",
      [searchEvent, folderEvent],
      (data) => received.push(data),
      "dash-1-GongCallDetail-1",
    );

    DashboardPublisher.pub(searchEvent, CALL_PAYLOAD);
    DashboardPublisher.pub(folderEvent, {
      ...CALL_PAYLOAD,
      id: "call-456",
      title: "Sprint Retro",
    });

    expect(received).toHaveLength(2);
    expect(received[0].message.id).toBe("call-123");
    expect(received[1].message.id).toBe("call-456");
  });
});

// ===========================================================================
// 7. PAYLOAD SHAPE VERIFICATION
//    Events carry correct shape { id, name, ...metadata }
// ===========================================================================

describe("Event payload shape verification", () => {
  test("payload includes id and name fields", () => {
    const received = [];
    const ev = eventName("TestWidget", 1, "itemSelected");

    wireListener(
      "itemSelected",
      [ev],
      (data) => received.push(data),
      "uuid-listener",
    );

    DashboardPublisher.pub(ev, { id: "abc", name: "Test Item" });

    expect(received[0].message).toHaveProperty("id", "abc");
    expect(received[0].message).toHaveProperty("name", "Test Item");
  });

  test("payload preserves additional metadata fields", () => {
    const received = [];
    const ev = eventName("TestWidget", 1, "itemSelected");

    wireListener(
      "itemSelected",
      [ev],
      (data) => received.push(data),
      "uuid-listener",
    );

    const payload = {
      id: "item-1",
      name: "Widget",
      mimeType: "text/plain",
      size: 1024,
      nested: { key: "value" },
    };
    DashboardPublisher.pub(ev, payload);

    expect(received[0].message).toEqual(payload);
    expect(received[0].message.nested.key).toBe("value");
  });

  test("event wrapper includes event name and subscriber uuid", () => {
    const received = [];
    const ev = eventName("TestWidget", 1, "itemSelected");
    const subscriberUuid = "uuid-sub-123";

    wireListener(
      "itemSelected",
      [ev],
      (data) => received.push(data),
      subscriberUuid,
    );

    DashboardPublisher.pub(ev, { id: "1", name: "test" });

    expect(received[0].event).toBe(ev);
    expect(received[0].uuid).toBe(subscriberUuid);
  });
});

// ===========================================================================
// 8. GRACEFUL HANDLING OF MISSING / STALE EVENTS
// ===========================================================================

describe("Graceful handling of missing and stale events", () => {
  test("publishing to an event with no subscribers does not throw", () => {
    expect(() => {
      DashboardPublisher.pub(eventName("Orphan", 1, "neverSubscribed"), {
        id: "1",
        name: "orphan",
      });
    }).not.toThrow();
  });

  test("subscribing to an event that never fires leaves handler uncalled", () => {
    const received = [];
    wireListener(
      "ghostEvent",
      [eventName("NonExistent", 99, "ghostEvent")],
      (data) => received.push(data),
      "uuid-waiting",
    );

    // No event published — handler should not fire
    expect(received).toHaveLength(0);
  });

  test("registerListeners with undefined listeners does not throw", () => {
    expect(() => {
      DashboardPublisher.registerListeners(undefined, {}, "uuid-safety");
    }).not.toThrow();
  });

  test("registerListeners with non-object listeners does not throw", () => {
    expect(() => {
      DashboardPublisher.registerListeners("not-an-object", {}, "uuid-safety");
    }).not.toThrow();
  });

  test("re-registering same uuid replaces the previous handler", () => {
    const firstReceived = [];
    const secondReceived = [];
    const ev = eventName("Widget", 1, "update");
    const uuid = "uuid-same";

    wireListener("update", [ev], (data) => firstReceived.push(data), uuid);
    wireListener("update", [ev], (data) => secondReceived.push(data), uuid);

    DashboardPublisher.pub(ev, { id: "1", name: "test" });

    expect(firstReceived).toHaveLength(0);
    expect(secondReceived).toHaveLength(1);
  });
});

// ===========================================================================
// 9. CROSS-PROVIDER EVENT ISOLATION
//    Slack events must not leak to Gmail/Drive/Calendar/GitHub/Gong widgets
// ===========================================================================

describe("Cross-provider event isolation", () => {
  test("Slack channelSelected does not reach Gmail listener", () => {
    const gmailReceived = [];
    const slackEvent = eventName("SlackListChannels", 1, "channelSelected");
    const gmailEvent = eventName("GmailInbox", 1, "emailSelected");

    // Gmail widget listens for emailSelected from GmailInbox, NOT Slack
    wireListener(
      "emailSelected",
      [gmailEvent],
      (data) => gmailReceived.push(data),
      "dash-1-GmailMessageView-1",
    );

    // Slack publishes channelSelected
    DashboardPublisher.pub(slackEvent, {
      id: "C01",
      name: "random",
    });

    expect(gmailReceived).toHaveLength(0);
  });

  test("GitHub repoSelected does not reach Google Drive listener", () => {
    const driveReceived = [];
    const repoEvent = eventName("GitHubRepoList", 1, "repoSelected");
    const driveEvent = eventName("GDriveFileList", 1, "fileSelected");

    wireListener(
      "fileSelected",
      [driveEvent],
      (data) => driveReceived.push(data),
      "dash-1-GDriveFilePreview-1",
    );

    DashboardPublisher.pub(repoEvent, {
      id: 123,
      name: "dash-core",
      fullName: "trops/dash-core",
    });

    expect(driveReceived).toHaveLength(0);
  });

  test("Gmail emailSelected does not reach Google Calendar listener", () => {
    const calReceived = [];
    const emailEvent = eventName("GmailInbox", 1, "emailSelected");
    const calEvent = eventName("GoogleCalendarUpcoming", 1, "eventSelected");

    wireListener(
      "eventSelected",
      [calEvent],
      (data) => calReceived.push(data),
      "dash-1-GoogleCalendarEventDetail-1",
    );

    DashboardPublisher.pub(emailEvent, {
      id: "msg-1",
      name: "Hello",
    });

    expect(calReceived).toHaveLength(0);
  });

  test("Gong callSelected does not reach Slack listener", () => {
    const slackReceived = [];
    const gongEvent = eventName("GongCallSearch", 1, "callSelected");
    const slackEvent = eventName("SlackListChannels", 1, "channelSelected");

    wireListener(
      "channelSelected",
      [slackEvent],
      (data) => slackReceived.push(data),
      "dash-1-SlackChannelMessages-1",
    );

    DashboardPublisher.pub(gongEvent, {
      id: "call-123",
      title: "Q4 Review",
    });

    expect(slackReceived).toHaveLength(0);
  });

  test("Gong callSelected does not reach Gmail listener", () => {
    const gmailReceived = [];
    const gongEvent = eventName("GongCallSearch", 1, "callSelected");
    const gmailEvent = eventName("GmailInbox", 1, "emailSelected");

    wireListener(
      "emailSelected",
      [gmailEvent],
      (data) => gmailReceived.push(data),
      "dash-1-GmailMessageView-1",
    );

    DashboardPublisher.pub(gongEvent, {
      id: "call-123",
      title: "Q4 Review",
    });

    expect(gmailReceived).toHaveLength(0);
  });

  test("six providers publishing simultaneously stay isolated", () => {
    const slackRx = [];
    const driveRx = [];
    const gmailRx = [];
    const calRx = [];
    const githubRx = [];
    const gongRx = [];

    // Each provider widget listens ONLY to its own source event
    wireListener(
      "channelSelected",
      [eventName("SlackListChannels", 1, "channelSelected")],
      (d) => slackRx.push(d),
      "uuid-slack",
    );
    wireListener(
      "fileSelected",
      [eventName("GDriveFileList", 1, "fileSelected")],
      (d) => driveRx.push(d),
      "uuid-drive",
    );
    wireListener(
      "emailSelected",
      [eventName("GmailInbox", 1, "emailSelected")],
      (d) => gmailRx.push(d),
      "uuid-gmail",
    );
    wireListener(
      "eventSelected",
      [eventName("GoogleCalendarUpcoming", 1, "eventSelected")],
      (d) => calRx.push(d),
      "uuid-cal",
    );
    wireListener(
      "repoSelected",
      [eventName("GitHubRepoList", 1, "repoSelected")],
      (d) => githubRx.push(d),
      "uuid-github",
    );
    wireListener(
      "callSelected",
      [eventName("GongCallSearch", 1, "callSelected")],
      (d) => gongRx.push(d),
      "uuid-gong",
    );

    // Publish one event per provider
    DashboardPublisher.pub(
      eventName("SlackListChannels", 1, "channelSelected"),
      { id: "C01", name: "general" },
    );
    DashboardPublisher.pub(eventName("GDriveFileList", 1, "fileSelected"), {
      id: "f01",
      name: "doc.pdf",
    });
    DashboardPublisher.pub(eventName("GmailInbox", 1, "emailSelected"), {
      id: "m01",
      name: "Hello",
    });
    DashboardPublisher.pub(
      eventName("GoogleCalendarUpcoming", 1, "eventSelected"),
      { id: "e01", name: "Standup" },
    );
    DashboardPublisher.pub(eventName("GitHubRepoList", 1, "repoSelected"), {
      id: 1,
      name: "dash-core",
    });
    DashboardPublisher.pub(eventName("GongCallSearch", 1, "callSelected"), {
      id: "call-01",
      title: "Q4 Review",
    });

    // Each listener received exactly one event — its own
    expect(slackRx).toHaveLength(1);
    expect(driveRx).toHaveLength(1);
    expect(gmailRx).toHaveLength(1);
    expect(calRx).toHaveLength(1);
    expect(githubRx).toHaveLength(1);
    expect(gongRx).toHaveLength(1);

    // Verify each got the correct payload
    expect(slackRx[0].message.name).toBe("general");
    expect(driveRx[0].message.name).toBe("doc.pdf");
    expect(gmailRx[0].message.name).toBe("Hello");
    expect(calRx[0].message.name).toBe("Standup");
    expect(githubRx[0].message.name).toBe("dash-core");
    expect(gongRx[0].message.title).toBe("Q4 Review");
  });
});

// ===========================================================================
// 10. MULTIPLE INSTANCES OF SAME WIDGET TYPE
// ===========================================================================

describe("Multiple instances of same widget type", () => {
  test("two SlackListChannels instances publish independently", () => {
    const listener1Rx = [];
    const listener2Rx = [];

    const ev1 = eventName("SlackListChannels", 1, "channelSelected");
    const ev2 = eventName("SlackListChannels", 2, "channelSelected");

    wireListener(
      "channelSelected",
      [ev1],
      (d) => listener1Rx.push(d),
      "uuid-messages-1",
    );
    wireListener(
      "channelSelected",
      [ev2],
      (d) => listener2Rx.push(d),
      "uuid-messages-2",
    );

    DashboardPublisher.pub(ev1, { id: "C01", name: "general" });

    expect(listener1Rx).toHaveLength(1);
    expect(listener2Rx).toHaveLength(0);

    DashboardPublisher.pub(ev2, { id: "C02", name: "random" });

    expect(listener1Rx).toHaveLength(1);
    expect(listener2Rx).toHaveLength(1);
  });

  test("one listener can subscribe to multiple instances of same widget type", () => {
    const received = [];
    const ev1 = eventName("GitHubRepoList", 1, "repoSelected");
    const ev2 = eventName("GitHubRepoList", 2, "repoSelected");

    wireListener(
      "repoSelected",
      [ev1, ev2],
      (d) => received.push(d),
      "uuid-issue-list",
    );

    DashboardPublisher.pub(ev1, { id: 1, name: "repo-a" });
    DashboardPublisher.pub(ev2, { id: 2, name: "repo-b" });

    expect(received).toHaveLength(2);
    expect(received[0].message.name).toBe("repo-a");
    expect(received[1].message.name).toBe("repo-b");
  });
});
