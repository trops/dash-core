/**
 * BotDetail — "Folders it works in" is a boundary (DASH-47): the hint says
 * so, and a bot with built-in tools but no folders gets a warning.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { BotDetail } from "./BotDetail";

const BOT = {
  id: "bot_1",
  name: "Coder",
  instructions: "Code tickets",
  provider: "claude-code",
};
const WARNING = /No folders yet: its built-in tools aren't limited/;

describe("BotDetail — folders it works in (DASH-47)", () => {
  test("says its built-in tools stay in its folders", () => {
    render(<BotDetail bot={BOT} providers={{}} section="access" />);
    expect(
      screen.getByText(/can only read, change and run commands/),
    ).toBeInTheDocument();
  });

  test("warns when built-in tools are on and it has no folders", () => {
    render(<BotDetail bot={BOT} providers={{}} section="access" />);
    expect(screen.getByText(WARNING)).toBeInTheDocument();
  });

  test("no warning once it has folders", () => {
    render(
      <BotDetail
        bot={{ ...BOT, projects: ["/Users/x/dev/repo"] }}
        providers={{}}
        section="access"
      />,
    );
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  test("no warning for a bot without built-in tools", () => {
    render(
      <BotDetail
        bot={{ ...BOT, builtinTools: "none" }}
        providers={{}}
        section="access"
      />,
    );
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});
