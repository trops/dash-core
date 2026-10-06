/**
 * LeadMentionMenu — the list the @ shortcut opens above the Assistant's
 * message box (bot-teams TEAM-013 AC6). Keyboard focus stays in the
 * textarea (ChatInput moves `activeIndex`), so this is a listbox, not a
 * focus-taking menu.
 */
import { useContext } from "react";
import { Caption2, ThemeContext } from "@trops/dash-react";
import { leadLabel } from "../leadMessages";

export const LeadMentionMenu = ({ options, activeIndex, onPick }) => {
  const { currentTheme } = useContext(ThemeContext) || {};
  const t = (key) => currentTheme?.[key] || "";

  return (
    <div
      role="listbox"
      aria-label="Send to"
      className={`mb-1 max-h-48 overflow-y-auto rounded-lg border shadow ${t(
        "bg-primary-dark",
      )} ${t("border-primary-dark")}`}
    >
      {options.length === 0 ? (
        <Caption2 block className="px-3 py-2 italic">
          No team lead matches.
        </Caption2>
      ) : (
        options.map((option, index) => {
          const active = index === activeIndex;
          return (
            <div
              key={option.botId || "assistant"}
              role="option"
              aria-selected={active}
              // mousedown so the textarea keeps focus.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(option);
              }}
              className={`px-3 py-1.5 text-xs cursor-pointer ${
                active
                  ? `${t("bg-secondary-dark")} ${t("text-secondary-light")}`
                  : `${t("text-primary-medium")} ${t("hover-bg-primary-dark")}`
              }`}
            >
              {option.isAssistant ? "Assistant" : leadLabel(option)}
            </div>
          );
        })
      )}
    </div>
  );
};
