/**
 * Dash's own ESLint rules (DASH-157), loaded by eslint.config.mjs as the
 * `dash` plugin:
 *
 *   dash/no-palette-classes    — a Tailwind palette shade (`bg-gray-800`,
 *                                `hover:text-blue-300/50`) in a string.
 *                                Use an Aurora role (`dr-role-*`), a
 *                                `currentTheme[...]` token or a dash-react
 *                                component instead.
 *   dash/no-theme-key-classes  — a key of the theme map (`text-primary-medium`,
 *                                `hover-bg-secondary-dark`) written as a
 *                                literal class. It isn't a Tailwind class, so
 *                                it renders nothing: look it up instead,
 *                                `${currentTheme["text-primary-medium"]}`.
 *
 * The theme map's keys are made by src/Models/ThemeModel.js (and the colour
 * names by dash-react's src/Utils/colors.js: colorTypes, themeVariants).
 */
"use strict";

// Tailwind's colour families (v3).
const PALETTE = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];
const COLOR_UTILITIES = [
  "bg",
  "text",
  "border(?:-[xytrblse])?",
  "ring",
  "ring-offset",
  "outline",
  "divide",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "placeholder",
  "shadow",
  "decoration",
  "accent",
  "caret",
];
// `md:hover:bg-gray-800/50` → variants, utility, family, shade, opacity.
const PALETTE_CLASS = new RegExp(
  `^(?:[a-z0-9-]+:)*!?(?:${COLOR_UTILITIES.join("|")})-(?:${PALETTE.join(
    "|",
  )})-(?:50|[1-9]00|950)(?:/\\d+)?$`,
);

// Keys of the theme map (ThemeModel.js): `{prefix}-{channel}-{level}`.
const THEME_CHANNELS = ["primary", "secondary", "tertiary", "neutral"];
const THEME_LEVELS = [
  "very-light",
  "light",
  "medium",
  "dark",
  "very-dark",
  "darkest",
  "gradient-[a-z-]+",
  "100",
  "300",
  "500",
  "700",
  "900",
];
const THEME_KEY = new RegExp(
  `^(?:[a-z0-9-]+:)*(?:hover-)?(?:bg|text|border)-(?:${THEME_CHANNELS.join(
    "|",
  )})-(?:${THEME_LEVELS.join("|")})$`,
);

/** A string's class-like tokens. */
function tokensOf(text) {
  return String(text)
    .split(/\s+/)
    .map((t) => t.replace(/^["'`]+|["'`,;]+$/g, ""))
    .filter(Boolean);
}

/** Whether a class token is a palette shade. */
function isPaletteClass(token) {
  return PALETTE_CLASS.test(token);
}

/**
 * Whether a class token is a theme-map key used as a class. A real Tailwind
 * palette class that happens to look like one (`bg-neutral-700`) is left to
 * no-palette-classes.
 */
function isThemeKeyClass(token) {
  return THEME_KEY.test(token) && !isPaletteClass(token);
}

/** A string literal used as a key, not a value: `x["…"]`, `{ "…": 1 }`. */
function isKeyPosition(node) {
  const p = node.parent;
  if (!p) return false;
  if (p.type === "MemberExpression" && p.property === node && p.computed) {
    return true;
  }
  if (p.type === "Property" && p.key === node) return true;
  if (
    p.type === "ImportDeclaration" ||
    p.type === "ExportNamedDeclaration" ||
    p.type === "ExportAllDeclaration" ||
    p.type === "ImportExpression"
  ) {
    return true;
  }
  if (
    p.type === "CallExpression" &&
    p.callee.type === "Identifier" &&
    p.callee.name === "require"
  ) {
    return true;
  }
  return false;
}

/** Whether the node sits inside a `className` (or `*ClassName`) attribute. */
function inClassNameAttribute(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === "JSXAttribute") {
      const name = n.name && n.name.name;
      return typeof name === "string" && /(^c|C)lassName$/.test(name);
    }
    if (n.type === "JSXElement" || n.type === "Program") return false;
  }
  return false;
}

/** Visit every string literal, JSX text attribute and template quasi. */
function eachString(context, visit) {
  return {
    Literal(node) {
      if (typeof node.value !== "string" || isKeyPosition(node)) return;
      visit(node, node.value, "literal");
    },
    TemplateElement(node) {
      const p = node.parent && node.parent.parent;
      if (p && p.type === "TaggedTemplateExpression") return;
      visit(node, node.value.cooked || node.value.raw, "template");
    },
  };
}

const noPaletteClasses = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Use Aurora roles or theme tokens, not Tailwind palette shades",
    },
    schema: [],
    messages: {
      palette:
        "`{{token}}` is a palette shade. Use an Aurora role (dr-role-*), a " +
        "currentTheme[...] token or a dash-react component (dash-react " +
        "docs/design-guide.html).",
    },
  },
  create(context) {
    return eachString(context, (node, text) => {
      for (const token of tokensOf(text)) {
        if (isPaletteClass(token)) {
          context.report({ node, messageId: "palette", data: { token } });
        }
      }
    });
  },
};

const noThemeKeyClasses = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A theme-map key (text-primary-medium) is not a class: look it up",
    },
    schema: [],
    messages: {
      themeKey:
        "`{{token}}` is a key of the theme map, not a Tailwind class, so it " +
        'renders nothing. Use its value: `${currentTheme["{{key}}"]}`.',
    },
  },
  create(context) {
    return eachString(context, (node, text, kind) => {
      const tokens = tokensOf(text);
      // A lone key in a plain string is a key *reference*
      // (`textColor: "text-primary-medium"` for getStylesForItem) unless
      // it's part of a className. A class list or a template is a class
      // string.
      // A lone key passed to a function is a lookup too: `t("bg-primary-dark")`.
      const lone = tokens.length === 1 && kind === "literal";
      const lookedUp =
        lone &&
        node.parent &&
        node.parent.type === "CallExpression" &&
        node.parent.arguments.includes(node);
      const classString =
        !lookedUp &&
        (kind === "template" ||
          tokens.length > 1 ||
          inClassNameAttribute(node));
      if (!classString) return;
      for (const token of tokens) {
        if (isThemeKeyClass(token)) {
          const key = token.replace(/^(?:[a-z0-9-]+:)*/, "");
          context.report({
            node,
            messageId: "themeKey",
            data: { token, key },
          });
        }
      }
    });
  },
};

module.exports = {
  meta: { name: "eslint-plugin-dash" },
  rules: {
    "no-palette-classes": noPaletteClasses,
    "no-theme-key-classes": noThemeKeyClasses,
  },
  isPaletteClass,
  isThemeKeyClass,
};
