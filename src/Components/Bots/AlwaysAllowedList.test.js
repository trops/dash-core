/**
 * AlwaysAllowedList — a bot's "Runs without asking": widen a provider's
 * remembered tools to anywhere in its files (DASH-30), and allow all of a
 * provider's tools ahead of time (DASH-29).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AlwaysAllowedList } from "./AlwaysAllowedList";

const folderRow = {
  kind: "tool",
  provider: "Sawhorse",
  tool: "read_model",
  folders: ["Spool Shelf"],
};

function withApi(rows) {
  const calls = [];
  window.mainApi = {
    bots: {
      listAlwaysAllowed: jest.fn(async () => rows),
      forgetAlwaysAllowed: jest.fn(async () => []),
      changeAlwaysAllowed: jest.fn(async (botId, provider, action) => {
        calls.push([botId, provider, action]);
        return action === "anywhere"
          ? [{ ...folderRow, folders: ["Spool Shelf", ".", "."] }]
          : [folderRow, { ...folderRow, tool: "*", folders: ["."] }];
      }),
    },
  };
  return calls;
}

afterEach(() => {
  delete window.mainApi;
});

test("a folder grant widens to anywhere in the provider's files", async () => {
  const calls = withApi([folderRow]);
  render(<AlwaysAllowedList botId="b1" providers={["Sawhorse"]} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Allow its Sawhorse tools anywhere in Sawhorse.s files/,
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByText("Anywhere in Sawhorse's files"),
    ).toBeInTheDocument(),
  );
  expect(calls).toEqual([["b1", "Sawhorse", "anywhere"]]);
  // Widened, it can go back to its folders.
  expect(
    screen.getByRole("button", { name: /only in their folders/ }),
  ).toBeInTheDocument();
});

test("each provider it uses can have all its tools allowed ahead of time", async () => {
  const calls = withApi([]);
  render(<AlwaysAllowedList botId="b1" providers={["Sawhorse"]} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Always allow all of Sawhorse's tools",
    }),
  );
  await waitFor(() =>
    expect(screen.getByText("All its tools · Sawhorse")).toBeInTheDocument(),
  );
  expect(calls).toEqual([["b1", "Sawhorse", "all-tools"]]);
  // Once allowed, it isn't offered again.
  expect(screen.queryByTestId("bot-allow-ahead")).not.toBeInTheDocument();
});

test("nothing to show: no rows and no providers", async () => {
  withApi([]);
  const { container } = render(<AlwaysAllowedList botId="b1" />);
  await waitFor(() =>
    expect(window.mainApi.bots.listAlwaysAllowed).toHaveBeenCalled(),
  );
  expect(container).toBeEmptyDOMElement();
});
