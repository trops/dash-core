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

  it("draws the user's message as dash-react's ChatMessage (yours)", () => {
    const { getByText } = renderUser();
    expect(
      getByText("whats the latest?").closest('[data-chat-role="you"]'),
    ).not.toBeNull();
  });

  it("a message sent to a team lead says who it went to", () => {
    const { getByText } = renderUser({
      to: {
        botId: "l",
        leadName: "Algolia Search Lead",
        dashboardName: "Algolia Search",
        dashboardLabel: "Algolia Search",
      },
    });
    const bubble = getByText("whats the latest?").closest(
      '[data-chat-role="you"]',
    );
    expect(bubble).not.toBeNull();
    expect(bubble.textContent).toMatch(/^To Algolia Search Lead/);
  });
});

describe("MessageBubble (assistant, code hidden)", () => {
  // ChatCore hideCodeBlocks — the Widget Builder shows code in its Code tab.
  const reply = "Done:\n\n```jsx\nexport default function A() {}\n```";

  it("shows a note instead of the code when codeNote is set", () => {
    const { container } = render(
      <MessageBubble
        message={assistant(reply)}
        codeNote="Code updated — see the Code tab."
      />,
    );
    expect(container).toHaveTextContent("Done:");
    expect(container).toHaveTextContent("Code updated — see the Code tab.");
    expect(container).not.toHaveTextContent("export default");
  });

  it("shows the code when codeNote isn't set", () => {
    const { container } = render(<MessageBubble message={assistant(reply)} />);
    expect(container).toHaveTextContent("export default");
  });
});
