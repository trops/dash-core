/**
 * AuditLogView — Manage › Bots › Log (bot-factory US-003 AC5, US-014 AC9,
 * US-019 AC6).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuditLogView } from "./AuditLogView";

const entry = (id, extra) => ({
  id,
  at: "2026-10-15T12:00:00.000Z",
  botId: "b1",
  botName: "Writer",
  ...extra,
});

afterEach(() => {
  delete window.mainApi;
});

test("shows entries as sentences, newest first, with when and kind", async () => {
  const auditLog = jest.fn().mockResolvedValue({
    entries: [
      entry("2", {
        type: "ran-read-only",
        kind: "auto",
        tool: "search_emails",
        provider: "Gmail",
      }),
      entry("1", { type: "pause-bot", kind: "pause" }),
    ],
    more: false,
  });
  window.mainApi = { bots: { auditLog } };
  render(<AuditLogView bots={[{ id: "b1", name: "Writer" }]} />);
  const rows = await screen.findAllByTestId("audit-log-row");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent(
    "Writer ran read-only search_emails on Gmail without asking",
  );
  expect(rows[0]).toHaveTextContent("Ran without asking");
  expect(rows[1]).toHaveTextContent("Paused Writer");
  expect(auditLog).toHaveBeenCalledWith({ botIds: [], kinds: [], limit: 50 });
});

test("filters by the bot it was opened for", async () => {
  const auditLog = jest.fn().mockResolvedValue({ entries: [], more: false });
  window.mainApi = { bots: { auditLog } };
  render(<AuditLogView bots={[]} botIds={["b1"]} />);
  await waitFor(() =>
    expect(auditLog).toHaveBeenCalledWith({
      botIds: ["b1"],
      kinds: [],
      limit: 50,
    }),
  );
  expect(await screen.findByTestId("audit-log-empty")).toHaveTextContent(
    "Nothing in the log matches these filters.",
  );
});

test("Show older pages back from the last entry shown", async () => {
  const auditLog = jest
    .fn()
    .mockResolvedValueOnce({
      entries: [entry("2", { type: "resume-bot", kind: "pause" })],
      more: true,
    })
    .mockResolvedValueOnce({
      entries: [entry("1", { type: "pause-bot", kind: "pause" })],
      more: false,
    });
  window.mainApi = { bots: { auditLog } };
  render(<AuditLogView bots={[]} />);
  fireEvent.click(await screen.findByText("Show older"));
  await waitFor(() =>
    expect(screen.getAllByTestId("audit-log-row")).toHaveLength(2),
  );
  expect(auditLog).toHaveBeenLastCalledWith({
    botIds: [],
    kinds: [],
    before: "2",
    limit: 50,
  });
  expect(screen.queryByText("Show older")).not.toBeInTheDocument();
});

test("an empty log says what will show there", async () => {
  window.mainApi = {
    bots: {
      auditLog: jest.fn().mockResolvedValue({ entries: [], more: false }),
    },
  };
  render(<AuditLogView />);
  expect(await screen.findByTestId("audit-log-empty")).toHaveTextContent(
    "Nothing logged yet.",
  );
});

test("a read failure says so", async () => {
  window.mainApi = {
    bots: { auditLog: jest.fn().mockRejectedValue(new Error("nope")) },
  };
  render(<AuditLogView />);
  expect(await screen.findByTestId("audit-log-error")).toHaveTextContent(
    "Couldn't read the log.",
  );
});
