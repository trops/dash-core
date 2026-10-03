/**
 * ChatInput — auto-resize must not collapse the textarea.
 *
 * Regression: when the assistant panel mounts while hidden/collapsed, the
 * textarea's scrollHeight is 0, and the auto-resize effect wrote an inline
 * `height: 0px` that stuck once the panel became visible — the input rendered
 * as a thin sliver. jsdom always reports scrollHeight 0, which reproduces the
 * hidden-mount case exactly.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "./ChatInput";

describe("ChatInput auto-resize", () => {
  test("does not pin height to 0px when mounted while not measurable", () => {
    render(<ChatInput onSend={() => {}} isLoading={false} />);
    const textarea = screen.getByPlaceholderText("Type a message...");
    expect(textarea.style.height).not.toBe("0px");
  });

  test("still does not collapse after typing while not measurable", () => {
    render(<ChatInput onSend={() => {}} isLoading={false} />);
    const textarea = screen.getByPlaceholderText("Type a message...");
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(textarea.style.height).not.toBe("0px");
  });

  test("sizes to content once measurable (capped at 120px)", () => {
    render(<ChatInput onSend={() => {}} isLoading={false} />);
    const textarea = screen.getByPlaceholderText("Type a message...");
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => 300,
    });
    fireEvent.change(textarea, { target: { value: "a\nb\nc" } });
    expect(textarea.style.height).toBe("120px");
  });
});

describe("ChatInput sending", () => {
  const box = () => screen.getByPlaceholderText("Type a message...");
  const type = (value) => fireEvent.change(box(), { target: { value } });
  const enter = (opts = {}) =>
    fireEvent.keyDown(box(), { key: "Enter", code: "Enter", ...opts });
  const NOTE = "Sends when the current reply finishes";

  test("Enter sends immediately when idle and clears the box", () => {
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} isLoading={false} />);
    type("hello");
    enter();
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(box().value).toBe("");
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  test("Shift+Enter does not send", () => {
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} isLoading={false} />);
    type("hello");
    enter({ shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  test("Enter during a reply queues the message, then sends it when the reply finishes", () => {
    const onSend = jest.fn();
    const { rerender } = render(<ChatInput onSend={onSend} isLoading />);
    type("hello");
    enter();
    expect(onSend).not.toHaveBeenCalled();
    expect(box().value).toBe("hello");
    expect(screen.getByText(NOTE)).toBeInTheDocument();

    // Edits while waiting are what gets sent.
    type("hello there");
    rerender(<ChatInput onSend={onSend} isLoading={false} />);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello there");
    expect(box().value).toBe("");
    expect(screen.queryByText(NOTE)).toBeNull();

    // Nothing else goes out on later renders.
    rerender(<ChatInput onSend={onSend} isLoading={false} />);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test("clearing the box cancels a queued message", () => {
    const onSend = jest.fn();
    const { rerender } = render(<ChatInput onSend={onSend} isLoading />);
    type("hello");
    enter();
    type("");
    expect(screen.queryByText(NOTE)).toBeNull();
    rerender(<ChatInput onSend={onSend} isLoading={false} />);
    expect(onSend).not.toHaveBeenCalled();
  });

  test("Stop stays available during a reply", () => {
    const onStop = jest.fn();
    render(<ChatInput onSend={jest.fn()} onStop={onStop} isLoading />);
    type("hello");
    enter();
    fireEvent.click(screen.getByText("Stop"));
    expect(onStop).toHaveBeenCalled();
  });
});
