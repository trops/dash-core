import React from "react";
import { toDisplayColor } from "../../utils/colorUtils";

/**
 * ThemeColorDots — renders 3 small rounded color squares for a theme.
 *
 * Accepts either:
 *   - A theme object with `primary`, `secondary`, `tertiary` (Tailwind names or hex)
 *   - A colors object with `primary`, `secondary`, `tertiary` (hex values)
 */
export const ThemeColorDots = ({ theme, colors, size = "h-2.5 w-2.5" }) => {
    const c = colors || {};
    const values = [
        toDisplayColor(c.primary || theme?.primary || ""),
        toDisplayColor(c.secondary || theme?.secondary || ""),
        toDisplayColor(c.tertiary || theme?.tertiary || ""),
    ].filter(Boolean);

    if (values.length === 0) return null;

    return (
        <span className="flex items-center gap-0.5">
            {values.map((color, i) => (
                <span
                    key={i}
                    className={`${size} rounded-sm border border-white/20 flex-shrink-0`}
                    style={{ backgroundColor: color }}
                />
            ))}
        </span>
    );
};
