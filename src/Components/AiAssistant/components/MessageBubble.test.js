/**
 * MessageBubble — assistant Markdown is sanitized before it becomes HTML.
 * A reply can quote untrusted content (emails, web pages); nothing in it may
 * run in the app window.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import { MessageBubble } from "./MessageBubble";

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
