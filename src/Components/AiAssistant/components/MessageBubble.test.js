/**
 * MessageBubble — assistant Markdown is sanitized before it becomes HTML.
 * A reply can quote untrusted content (emails, web pages); nothing in it may
 * run in the app window.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import { MessageBubble } from "./MessageBubble";
import { ThemeContext } from "@trops/dash-react";

const assistant = (text) => ({ role: "assistant", content: text });

describe("MessageBubble (assistant)", () => {
  it("renders Markdown formatting", () => {
    const { container } = render(
      <MessageBubble
        message={assistant("**bold** and a [link](https://example.com)")}
      />,
    );
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("strips event handlers and scripts from the reply", () => {
    const { container } = render(
      <MessageBubble
        message={assistant(
          'Quoted email: <img src="x" onerror="window.__pwned=1"> <script>window.__pwned=2</script>',
        )}
      />,
    );
    expect(container.innerHTML).not.toMatch(/onerror/i);
    expect(container.querySelector("script")).toBeNull();
    expect(window.__pwned).toBeUndefined();
  });

  it("drops javascript: links", () => {
    const { container } = render(
      <MessageBubble message={assistant("[click me](javascript:alert(1))")} />,
    );
    expect(container.innerHTML).not.toMatch(/javascript:/i);
  });
});

describe("MessageBubble (user)", () => {
  // Real theme keys (ThemeModel); "bg-primary-bright"/"bg-primary" don't
  // exist, which left the user's bubble with no background.
  const theme = {
    "bg-primary-medium": "bg-theme-user",
    "bg-secondary-dark": "bg-theme-assistant",
    "text-primary-medium": "text-theme-body",
  };
  const renderUser = (message) =>
    render(
      <ThemeContext.Provider value={{ currentTheme: theme }}>
        <MessageBubble
          message={{ role: "user", content: "whats the latest?", ...message }}
        />
      </ThemeContext.Provider>,
    );

  it("draws the user's message in a themed rounded bubble", () => {
    const { getByText } = renderUser();
    const bubble = getByText("whats the latest?");
    expect(bubble.className).toMatch(/bg-theme-user/);
    expect(bubble.className).toMatch(/rounded-lg/);
    expect(bubble.className).toMatch(/text-theme-body/);
  });

  it("keeps the bubble for messages sent to a team lead", () => {
    const { getByText } = renderUser({
      to: {
        botId: "l",
        leadName: "Algolia Search Lead",
        dashboardName: "Algolia Search",
        dashboardLabel: "Algolia Search",
      },
    });
    expect(getByText("whats the latest?").className).toMatch(/bg-theme-user/);
  });
});
