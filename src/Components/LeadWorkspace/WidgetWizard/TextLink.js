import React from "react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";

/**
 * A link inside a sentence ("+ Add a setting", "Describe it"), in the
 * theme's accent (the approved mockups draw these as bold links). dash-react
 * has no inline text link — Button3 reads as muted, disabled text there —
 * so this is a plain button with the theme's role classes.
 */
export const TextLink = ({ title, onClick, disabled = false, ariaLabel }) => {
  const { accent } = useConfigTokens();
  return (
    <button
      type="button"
      className={`inline text-left text-xs font-semibold hover:underline ${accent}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {title}
    </button>
  );
};

export default TextLink;
