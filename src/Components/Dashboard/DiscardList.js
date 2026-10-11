import React, { useContext } from "react";
import { SectionLabel } from "@trops/dash-react";
import { ThemeContext } from "../../Context";

/**
 * DiscardList — the body of the editor's "Discard unsaved changes?" prompt
 * (create-entry phase 1e, CRE-006 AC7): what Cancel will undo, and what it
 * keeps. `changes` comes from describeEditChanges.
 */
export const DiscardList = ({ changes }) => {
  const { currentTheme = {} } = useContext(ThemeContext);
  const text = currentTheme["text-primary-light"] || "";
  const muted = currentTheme["text-primary-medium"] || "";
  return (
    <div className="flex flex-col gap-3 text-sm">
      <span className={text}>These changes haven't been saved:</span>
      <ul
        aria-label="Changes that will be discarded"
        className={`flex flex-col gap-1 pl-4 list-disc ${text}`}
      >
        {changes.discarded.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {changes.kept.length > 0 && (
        <div className="flex flex-col gap-1">
          <SectionLabel>Kept</SectionLabel>
          {changes.kept.map((line, i) => (
            <span key={i} className={muted}>
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
