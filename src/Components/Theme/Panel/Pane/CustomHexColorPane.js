/**
 * CustomHexColorPane — hex input + live preview swatch + WCAG
 * contrast warning. Used by both `AvailableMainColorsPane` (wizard)
 * and `AvailableColorsGridPane` (editor) to give users a path to
 * brand colors outside the 22-color Tailwind palette.
 *
 * The parent receives a validated, normalized `#rrggbb` string via
 * `onApply(hex)`. This component owns its input state and resets
 * after a successful apply.
 *
 * PRD: arbitrary-color-themes.md US-001 + US-005 (Phase 3).
 */
import React, { useState, useMemo } from "react";
import {
  Button,
  InputText,
  Caption,
  Caption2,
  isHexColor,
  normalizeHex,
  contrastRatio,
} from "@trops/dash-react";

const AA_RATIO = 4.5;

const CustomHexColorPane = ({ onApply, label = "Custom hex color" }) => {
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);

  const normalized = useMemo(() => normalizeHex(input), [input]);
  const isValid = !!normalized;

  // Contrast vs. white — the most common "text on a colored fill"
  // case for primary buttons / active channels. Low contrast means
  // light text on the picked color will be hard to read.
  const contrastVsWhite = useMemo(
    () => (isValid ? contrastRatio(normalized, "#ffffff") : null),
    [normalized, isValid],
  );
  const contrastVsBlack = useMemo(
    () => (isValid ? contrastRatio(normalized, "#000000") : null),
    [normalized, isValid],
  );
  const bestContrast = contrastVsWhite
    ? Math.max(contrastVsWhite, contrastVsBlack)
    : null;
  const warning =
    bestContrast !== null && bestContrast < AA_RATIO
      ? `Best contrast ${bestContrast.toFixed(1)}:1 — below WCAG AA target (4.5:1). Text overlaid on this color may be hard to read.`
      : null;

  function handleApply() {
    if (!normalized) {
      setError("Invalid hex (try #4A154B)");
      return;
    }
    setError(null);
    onApply(normalized);
    setInput("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && isValid) {
      e.preventDefault();
      handleApply();
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 border-t border-gray-700">
      <span className="text-xs uppercase font-bold tracking-wider text-gray-400">
        {label}
      </span>
      <div className="flex flex-row items-center gap-2">
        <InputText
          value={input}
          onChange={(value) => {
            // dispatchInputChange unwraps the event to a string
            setInput(
              typeof value === "string" ? value : value?.target?.value || "",
            );
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="#4A154B"
        />
        <div
          className="w-10 h-10 rounded flex-shrink-0"
          style={{
            backgroundColor: normalized || "transparent",
            border: "1px solid rgba(255,255,255,0.15)",
          }}
          aria-label="Color preview"
        />
        <Button title="Apply" onClick={handleApply} disabled={!isValid} />
      </div>
      {error && <Caption2 text={error} />}
      {warning && <Caption text={warning} />}
    </div>
  );
};

export default CustomHexColorPane;
