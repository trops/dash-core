/**
 * ThemeModel
 *
 * Expands a saved theme (`{ primary: "blue", secondary: "indigo", … }`)
 * into a per-variant token map (`{ dark: {...}, light: {...} }`) of
 * Tailwind class strings.
 *
 * Each color channel can be either:
 *   - A Tailwind color family name (e.g. `"blue"`) — emits class
 *     strings like `bg-blue-700`. The Tailwind safelist already
 *     covers these.
 *   - A hex color (e.g. `"#4A154B"`) — emits arbitrary-value class
 *     strings like `bg-[var(--primary-700)]` and accumulates the
 *     derived `--{channel}-{50..950}` CSS variables on the variant's
 *     `cssVars` sub-object. `ThemePreviewProvider` writes these to
 *     `document.documentElement.style` on theme activation.
 *
 * PRD: `arbitrary-color-themes.md` FR-002.
 */
import {
  deepCopy,
  colorTypes,
  isHexColor,
  deriveShades,
} from "@trops/dash-react";

/**
 * getNextLevel
 * Need to generate the levels for tailwind
 * @param {int} currentLevel
 */
function getNextLevel(currentLevel) {
  const next = currentLevel + 100;
  return next <= 900 ? next : currentLevel;
}

function invert(shade) {
  return 900 - parseInt(shade, 10);
}

/**
 * Build a tailwind class string for the given prefix + type + numeric
 * shade. Routes to the arbitrary-value syntax (`bg-[var(--type-shade)]`)
 * when the channel's value is a hex.
 *
 * @param {"bg"|"text"|"border"} prefix
 * @param {string} type             channel name (primary | secondary | …)
 * @param {number} shade            tailwind shade (100..950)
 * @param {string} channelValue     either a tailwind color name or a hex
 * @param {boolean} hover           emit a `hover:` variant
 */
function classFor(prefix, type, shade, channelValue, hover = false) {
  const h = hover ? "hover:" : "";
  if (isHexColor(channelValue)) {
    return `${h}${prefix}-[var(--${type}-${shade})]`;
  }
  return `${h}${prefix}-${channelValue}-${shade}`;
}

function gradientFor(
  direction,
  type,
  fromShade,
  viaShade,
  toShade,
  channelValue,
) {
  if (isHexColor(channelValue)) {
    return `bg-gradient-to-${direction} from-[var(--${type}-${fromShade})] via-[var(--${type}-${viaShade})] to-[var(--${type}-${toShade})]`;
  }
  return `bg-gradient-to-${direction} from-${channelValue}-${fromShade} via-${channelValue}-${viaShade} to-${channelValue}-${toShade}`;
}

export const ThemeModel = (themeItem = {}) => {
  try {
    const obj = deepCopy(themeItem);

    const overrideDark = "dark" in themeItem ? themeItem["dark"] : null;
    const overrideLight = "light" in themeItem ? themeItem["light"] : null;

    const theme = {};

    theme.id = "id" in obj ? obj["id"] : null;
    theme.name = "name" in obj ? obj["name"] : "My Theme";

    // for each of the color types we should set...
    colorTypes.forEach((type) => {
      theme[type] = type in obj ? obj[type] : "gray";
    });

    // theme.primary = 'primary' in obj ? obj['primary'] : 'gray';
    // theme.secondary = 'secondary' in obj ? obj['secondary'] : 'blue';
    // theme.tertiary = 'tertiary' in obj ? obj['tertiary'] : 'indigo';

    theme.shadeFrom = "shadeFrom" in obj ? obj["shadeFrom"] : 100;

    // unused from
    theme.shadeBackgroundFrom =
      "shadeBackgroundFrom" in obj ? obj["shadeBackgroundFrom"] : 100;
    theme.shadeTextFrom = "shadeTextFrom" in obj ? obj["shadeTextFrom"] : 100;
    theme.shadeBorderFrom =
      "shadeBorderFrom" in obj ? obj["shadeBorderFrom"] : 100;
    theme.shadeTo = "shadeTo" in obj ? obj["shadeTo"] : 700;

    // somehow generate the colors based on the theme inputs...
    // light, medium, dark for each?
    // example: bg-primary-light, bg-primary-medium, bg-primary-dark,

    const variants = {
      light: {
        "very-light": 100,
        light: 200,
        medium: 300,
        dark: 200,
        "very-dark": 100,
      },
      dark: {
        "very-light": 500,
        light: 600,
        medium: 700,
        dark: 800,
        "very-dark": 900,
      },
    };

    // iterate over each color type "primary, secondary, tertiary ..."
    // and generate the colors necessary (shades) based on tailwind
    colorTypes.forEach((type) => {
      const channelValue = theme[type];
      Object.keys(variants).forEach((variant) => {
        if (variant in theme === false) {
          theme[variant] = {};
        }
        Object.keys(variants[variant]).forEach((shade) => {
          const numShade = variants[variant][shade];
          const hoverShade = getNextLevel(numShade);
          const textShade = invert(numShade);
          theme[variant][`bg-${type}-${shade}`] = classFor(
            "bg",
            type,
            numShade,
            channelValue,
          );
          theme[variant][`hover-bg-${type}-${shade}`] = classFor(
            "bg",
            type,
            hoverShade,
            channelValue,
            true,
          );
          theme[variant][`hover-border-${type}-${shade}`] = classFor(
            "border",
            type,
            hoverShade,
            channelValue,
            true,
          );
          theme[variant][`border-${type}-${shade}`] = classFor(
            "border",
            type,
            numShade,
            channelValue,
          );
          // we should be "flipping" these so dark text on light and light on dark...
          theme[variant][`text-${type}-${shade}`] = classFor(
            "text",
            type,
            textShade,
            channelValue,
          );
          theme[variant][`hover-text-${type}-${shade}`] = classFor(
            "text",
            type,
            textShade,
            channelValue,
            true,
          );
        });
      });
    });

    // Gradients — primary/secondary/tertiary, 8 directions × 2 variants.
    // Each gradient goes from the variant's medium shade via medium to dark.
    // For hex channels, the gradient stops use `from-[var(--type-shade)]` etc.
    const gradientDirs = {
      right: "r",
      bottom: "b",
      "bottom-right": "br",
      "bottom-left": "bl",
      left: "l",
      top: "t",
      "top-right": "tr",
      "top-left": "tl",
    };
    ["primary", "secondary", "tertiary"].forEach((type) => {
      const channelValue = theme[type];
      Object.keys(variants).forEach((variant) => {
        const fromShade = variants[variant]["medium"];
        const viaShade = variants[variant]["medium"];
        const toShade = variants[variant]["dark"];
        Object.entries(gradientDirs).forEach(([suffix, dirCode]) => {
          theme[variant][`bg-${type}-gradient-${suffix}`] = gradientFor(
            dirCode,
            type,
            fromShade,
            viaShade,
            toShade,
            channelValue,
          );
        });
      });
    });

    // now for the overrides!
    if (overrideDark !== null) {
      Object.keys(overrideDark).forEach((key) => {
        theme["dark"][key] = overrideDark[key];
      });
    }

    if (overrideLight !== null) {
      // Strip stale light overrides from pre-fix saved themes.
      // These were band-aids for the old linear shade mapping and
      // conflict with the corrected light variant (100-300 range).
      const staleKeys = ["bg-primary-very-light", "bg-primary-very-dark"];
      Object.keys(overrideLight).forEach((key) => {
        if (!staleKeys.includes(key)) {
          theme["light"][key] = overrideLight[key];
        }
      });
    }

    // Primary, secondary, etc..
    theme["light"]["name"] = theme.name;

    colorTypes.forEach((type) => {
      theme["light"][type] = theme[type];
    });

    colorTypes.forEach((type) => {
      theme["dark"][type] = theme[type];
    });

    theme["dark"]["name"] = theme.name;

    // Darkest shade (950 dark / 50 light) for stage backgrounds.
    // Added outside the variant loop to avoid generating invalid text/border
    // classes (invert(950) would be negative).
    colorTypes.forEach((type) => {
      const channelValue = theme[type];
      theme["dark"][`bg-${type}-darkest`] = classFor(
        "bg",
        type,
        950,
        channelValue,
      );
      theme["light"][`bg-${type}-darkest`] = classFor(
        "bg",
        type,
        50,
        channelValue,
      );
    });

    // Accumulate CSS custom properties for any hex-color channels.
    // ThemePreviewProvider reads `currentTheme.cssVars` and writes
    // these to `document.documentElement.style` on theme activation
    // (PRD `arbitrary-color-themes.md` FR-003).
    const cssVarsAll = {};
    let hasAnyHex = false;
    colorTypes.forEach((type) => {
      const channelValue = theme[type];
      if (isHexColor(channelValue)) {
        hasAnyHex = true;
        const shades = deriveShades(channelValue);
        if (shades) {
          for (const [shade, hex] of Object.entries(shades)) {
            cssVarsAll[`--${type}-${shade}`] = hex;
          }
        }
      }
    });
    if (hasAnyHex) {
      // Attach to both variants so whichever is active on theme switch
      // delivers the same CSS variable set to :root.
      theme["dark"].cssVars = cssVarsAll;
      theme["light"].cssVars = cssVarsAll;
    }

    // transparent colors
    theme["dark"]["bg-none"] = "bg-transparent";
    theme["dark"]["border-none"] = "border-transparent";
    theme["dark"]["hover-border-none"] = "hover:border-transparent";
    theme["dark"]["hover-bg-none"] = "hover:bg-transparent";
    theme["dark"]["hover-text-none"] = "hover:text-transparent";

    theme["light"]["bg-none"] = "bg-transparent";
    theme["light"]["border-none"] = "border-transparent";
    theme["light"]["hover-border-none"] = "hover:border-transparent";
    theme["light"]["hover-bg-none"] = "hover:bg-transparent";
    theme["light"]["hover-text-none"] = "hover:text-transparent";

    return theme;
  } catch (e) {
    console.log("ThemeModel ", e.message);
    return {};
  }
};
