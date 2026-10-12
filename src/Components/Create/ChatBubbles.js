import React, { useContext } from "react";
import { Caption2, ThemeContext } from "@trops/dash-react";

/**
 * Chat bubbles for Create's conversations with the Dash team (plans and
 * Ask), drawn like the AI Assistant's (AiAssistant MessageBubble): theme
 * surfaces and text, so they follow light and dark themes.
 */
function useBubbleTokens() {
  const { currentTheme } = useContext(ThemeContext) || {};
  return {
    reply:
      currentTheme?.["bg-secondary-dark"] ||
      currentTheme?.["bg-primary-dark"] ||
      "",
    you: currentTheme?.["bg-primary-medium"] || "",
    text: currentTheme?.["text-primary-medium"] || "",
  };
}

/** What the user said, right-aligned. */
export const YouBubble = ({ children }) => {
  const t = useBubbleTokens();
  return (
    <div className="flex justify-end">
      <div className="max-w-xl">
        <Caption2
          block
          className="font-semibold uppercase tracking-wider mb-1 text-right"
        >
          You
        </Caption2>
        <div
          className={`px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words leading-relaxed ${t.you} ${t.text}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

/**
 * A team member's reply: its label ("Planner"), an optional meta line
 * (model · tokens), the text, and anything below it (a button).
 */
export const TeamBubble = ({
  label = "Planner",
  meta = null,
  muted = false,
  testId,
  children,
  footer = null,
}) => {
  const t = useBubbleTokens();
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex flex-row items-center gap-2">
        <Caption2 className="font-semibold uppercase tracking-wider">
          {label}
        </Caption2>
        {meta ? <Caption2>{meta}</Caption2> : null}
      </div>
      <div
        className={`px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words leading-relaxed ${t.reply} ${t.text} ${
          muted ? "opacity-70 italic" : ""
        }`}
      >
        {children}
      </div>
      {footer}
    </div>
  );
};
