/**
 * The parts of a theme the Edit theme window can change, in plain words.
 *
 * A part is one or more dash-react theme keys (Card covers card, card-2 and
 * card-3) and the properties you can set on it. A change is saved the way
 * themes always kept per-component colours —
 * `theme[variant][key][styleName] = token` — with the token naming one of
 * the theme's own colours at a fixed shade (`bg-tertiary-700`, which
 * ThemeModel resolves for both Dark and Light).
 *
 * The Aurora design paints some parts itself (buttons, cards, panels,
 * inputs, switches, tabs, headings, body text) with `!important`, so a
 * colour the theme gives them would never show. For those parts
 * `themePartsCss` writes the theme's choices as rules that win over
 * Aurora's: for the app theme across the app, for a dashboard's own theme
 * inside that dashboard, for the editor inside its preview.
 */
import { deepCopy } from "@trops/dash-react";

export const SHADES = [
  { n: 100, name: "Lightest" },
  { n: 300, name: "Light" },
  { n: 500, name: "Middle" },
  { n: 700, name: "Dark" },
  { n: 900, name: "Darkest" },
];

export const CHANNELS = [
  { key: "primary", name: "Main", use: "Buttons, links" },
  { key: "secondary", name: "Second", use: "Tags, charts" },
  { key: "tertiary", name: "Highlight", use: "Badges, accents" },
  { key: "neutral", name: "Greys", use: "Text, lines" },
];

const HOVER = ":hover:not(:disabled)";

const FILL = {
  id: "fill",
  label: "Fill",
  style: "backgroundColor",
  prefix: "bg",
  css: "background",
  none: true,
};
const TEXT = {
  id: "text",
  label: "Text",
  style: "textColor",
  prefix: "text",
  css: "color",
};
const OUTLINE = {
  id: "outline",
  label: "Outline",
  style: "borderColor",
  prefix: "border",
  css: "border-color",
  none: true,
};
const FILL_HOVER = {
  id: "fillHover",
  label: "Fill on hover",
  style: "hoverBackgroundColor",
  prefix: "hover-bg",
  css: "background",
  state: HOVER,
  none: true,
};
const TEXT_HOVER = {
  id: "textHover",
  label: "Text on hover",
  style: "hoverTextColor",
  prefix: "hover-text",
  css: "color",
  state: HOVER,
};
const OUTLINE_HOVER = {
  id: "outlineHover",
  label: "Outline on hover",
  style: "hoverBorderColor",
  prefix: "hover-border",
  css: "border-color",
  state: HOVER,
  none: true,
};

const BUTTON_PROPS = [FILL, TEXT, OUTLINE, FILL_HOVER, TEXT_HOVER];

/**
 * `selector`: what Aurora paints (null — the theme's classes already show).
 * A property's own `selector` replaces the part's.
 */
export const PART_GROUPS = [
  {
    name: "Buttons",
    parts: [
      {
        id: "button",
        label: "Button",
        about:
          "The main button: the one action that matters most, like Save or Add widget.",
        keys: ["button"],
        selector: [".dr-btn.dr-btn-primary:not(.dr-btn-danger)"],
        props: BUTTON_PROPS,
      },
      {
        id: "button-2",
        label: "Button 2",
        about:
          "The second button: actions next to the main one, like Share or Export.",
        keys: ["button-2"],
        selector: [".dr-btn.dr-btn-secondary:not(.dr-btn-danger)"],
        props: BUTTON_PROPS,
      },
      {
        id: "button-3",
        label: "Button 3",
        about: "The quiet button: small actions like Edit or Cancel.",
        keys: ["button-3"],
        selector: [".dr-btn.dr-btn-ghost:not(.dr-btn-danger)"],
        props: BUTTON_PROPS,
      },
      {
        id: "icon-buttons",
        label: "Icon buttons",
        about: "Buttons that are only an icon, like close or more.",
        keys: ["button-icon", "button-icon-2", "button-icon-3"],
        selector: [".dr-btn-icon:not([aria-pressed])"],
        props: BUTTON_PROPS,
      },
    ],
  },
  {
    name: "Cards & panels",
    parts: [
      {
        id: "card",
        label: "Card",
        about: "The boxes lists and widgets sit in.",
        keys: ["card", "card-2", "card-3"],
        selector: ['.dr-card:not([aria-pressed="true"])'],
        props: [FILL, TEXT, OUTLINE, OUTLINE_HOVER],
      },
      {
        id: "panel",
        label: "Panel",
        about: "Larger areas that hold a whole section.",
        keys: ["panel", "panel-2", "panel-3"],
        selector: [".dr-panel"],
        props: [FILL, TEXT, OUTLINE],
      },
    ],
  },
  {
    name: "Tags",
    parts: [
      {
        id: "tag",
        label: "Tag",
        about: "Small labels, like Work.",
        keys: ["tag"],
        selector: null,
        props: [FILL, TEXT, FILL_HOVER, TEXT_HOVER],
      },
      {
        id: "tag-2",
        label: "Tag 2",
        about: "The second kind of label, like Personal.",
        keys: ["tag-2"],
        selector: null,
        props: [FILL, TEXT, FILL_HOVER, TEXT_HOVER],
      },
      {
        id: "tag-3",
        label: "Tag 3",
        about: "The third kind of label, like Health.",
        keys: ["tag-3"],
        selector: null,
        props: [FILL, TEXT, FILL_HOVER, TEXT_HOVER],
      },
    ],
  },
  {
    name: "Text",
    parts: [
      {
        id: "headings",
        label: "Headings",
        about: "Titles at the top of a page or section.",
        keys: [
          "heading",
          "heading-2",
          "heading-3",
          "subheading",
          "subheading-2",
          "subheading-3",
        ],
        selector: [".dr-heading", ".dr-subheading"],
        props: [TEXT],
      },
      {
        id: "body-text",
        label: "Body text",
        about: "Sentences and descriptions.",
        keys: ["paragraph", "paragraph-2", "paragraph-3"],
        selector: [".dr-paragraph"],
        props: [TEXT],
      },
    ],
  },
  {
    name: "Inputs",
    parts: [
      {
        id: "text-box",
        label: "Text box",
        about: "Where you type, like a search or a name.",
        keys: ["input-text", "textarea", "search-input"],
        selector: [".dr-input"],
        props: [FILL, TEXT, OUTLINE],
      },
      {
        id: "switch",
        label: "Switch",
        about: "On / off choices.",
        keys: ["switch"],
        selector: [".dr-switch"],
        props: [
          {
            ...FILL,
            label: "Fill when off",
            selector: ['.dr-switch:not([data-checked="true"])'],
            none: false,
          },
          {
            id: "fillOn",
            label: "Fill when on",
            style: "activeBackgroundColor",
            prefix: "bg",
            css: "background",
            selector: ['.dr-switch[data-checked="true"]'],
          },
        ],
      },
    ],
  },
  {
    name: "Tabs & menus",
    parts: [
      {
        id: "tabs",
        label: "Tabs",
        about: "The row of choices across the top of a page or widget.",
        keys: ["tabs-trigger"],
        selector: [".dr-tabs-trigger", ".dr-tab"],
        props: [
          {
            ...TEXT,
            selector: [
              ".dr-tabs-trigger:not(.dr-tabs-trigger-active)",
              ".dr-tab:not(.dr-tab-active)",
            ],
          },
          {
            id: "textOn",
            label: "Text when picked",
            style: "activeTextColor",
            prefix: "text",
            css: "color",
            selector: [".dr-tabs-trigger-active", ".dr-tab-active"],
          },
        ],
      },
      {
        id: "menu",
        label: "Menu",
        about: "The rows in a menu or a list you pick from.",
        keys: ["menu-item", "menu-item-2", "menu-item-3"],
        selector: null,
        props: [FILL, TEXT, FILL_HOVER, TEXT_HOVER],
      },
    ],
  },
  {
    name: "Alerts & status",
    parts: [
      {
        id: "alert",
        label: "Alert",
        about: "A message that needs attention.",
        keys: ["alert", "alert-2", "alert-3"],
        selector: null,
        props: [FILL, TEXT, OUTLINE],
      },
      {
        id: "progress",
        label: "Progress",
        about: "How far along something is.",
        keys: ["progress-bar", "progress-bar-2", "progress-bar-3"],
        selector: null,
        props: [FILL, OUTLINE],
      },
    ],
  },
];

export const PARTS = PART_GROUPS.flatMap((g) =>
  g.parts.map((p) => ({ ...p, group: g.name })),
);

export const partById = (id) => PARTS.find((p) => p.id === id) || null;

const TOKEN_RE =
  /^(?:hover-)?(?:bg|text|border)-(primary|secondary|tertiary|neutral)-(\d+)$/;

/** "bg-tertiary-700" → "Highlight · Dark"; "bg-none" → "None". */
export function tokenLabel(token) {
  if (typeof token !== "string" || !token) return null;
  if (/-none$/.test(token)) return "None";
  const m = token.match(TOKEN_RE);
  if (!m) return "From the theme";
  const channel = CHANNELS.find((c) => c.key === m[1]);
  const shade = SHADES.find((s) => String(s.n) === m[2]);
  return `${channel ? channel.name : m[1]} · ${shade ? shade.name : m[2]}`;
}

/** The token a property gets for a colour of the theme at a shade. */
export const tokenFor = (prop, channel, shade) =>
  `${prop.prefix}-${channel}-${shade}`;

/** The token for "No fill" / "No outline". */
export const noneToken = (prop) => `${prop.prefix}-none`;

const VARIANTS = ["dark", "light"];

/** The value a raw theme gives a part's property in a variant (or null). */
export function propValue(raw, part, prop, variant) {
  const bag = raw?.[variant]?.[part.keys[0]];
  return bag && typeof bag === "object" ? bag[prop.style] || null : null;
}

/** Which of a part's properties differ from the original, in either mode. */
export function changedProps(original, draft, part) {
  return part.props.filter((prop) =>
    VARIANTS.some(
      (v) =>
        propValue(original, part, prop, v) !== propValue(draft, part, prop, v),
    ),
  );
}

/** Every changed part: [{ part, props }]. */
export function changedParts(original, draft) {
  return PARTS.map((part) => ({
    part,
    props: changedProps(original, draft, part),
  })).filter((c) => c.props.length > 0);
}

/**
 * A copy of the raw theme with the property set to `token` on every key of
 * the part, in each of `variants`.
 */
export function setProp(raw, part, prop, token, variants = VARIANTS) {
  const next = deepCopy(raw || {});
  for (const v of variants) {
    if (!next[v] || typeof next[v] !== "object") next[v] = {};
    for (const key of part.keys) {
      const bag =
        next[v][key] && typeof next[v][key] === "object" ? next[v][key] : {};
      next[v][key] = { ...bag, [prop.style]: token };
    }
  }
  return next;
}

/**
 * A copy of the raw theme with the property back to what the original had
 * (both modes). `prop` null resets every property of the part.
 */
export function resetProp(
  raw,
  original,
  part,
  prop = null,
  variants = VARIANTS,
) {
  const next = deepCopy(raw || {});
  const styles = (prop ? [prop] : part.props).map((p) => p.style);
  for (const v of variants) {
    if (!next[v] || typeof next[v] !== "object") continue;
    for (const key of part.keys) {
      const was = original?.[v]?.[key];
      const bag =
        next[v][key] && typeof next[v][key] === "object"
          ? { ...next[v][key] }
          : null;
      if (!bag) continue;
      for (const s of styles) {
        if (was && typeof was === "object" && s in was) bag[s] = was[s];
        else delete bag[s];
      }
      if (Object.keys(bag).length) next[v][key] = bag;
      else delete next[v][key];
    }
  }
  return next;
}

const safeScope = (s) =>
  String(s).replace(/["\\\n]/g, (c) => (c === "\n" ? "" : `\\${c}`));

/**
 * CSS rules that paint the parts Aurora styles itself with a theme
 * variant's own choices. `scope` null: the app (everywhere outside a box
 * with its own theme); else only inside `[data-own-theme="<scope>"]`.
 *
 * @param {object} variantModel ThemeModel(raw)[variant]
 * @param {string|null} scope
 */
export function themePartsCss(variantModel, scope = null) {
  if (!variantModel || typeof variantModel !== "object") return "";
  const cssValue = variantModel.cssValue || {};
  const base = scope
    ? `[data-design="aurora"] [data-own-theme="${safeScope(scope)}"] `
    : `[data-design="aurora"] `;
  const outside = scope ? "" : ":not([data-own-theme] *)";
  const rules = [];
  for (const part of PARTS) {
    if (!part.selector) continue;
    const bag = variantModel[part.keys[0]];
    if (!bag || typeof bag !== "object") continue;
    for (const prop of part.props) {
      // Only what this window sets: a theme's older per-component colours
      // (level tokens) keep their old, Aurora-covered look.
      const token = bag[prop.style];
      const ours =
        typeof token === "string" &&
        (TOKEN_RE.test(token) || /-none$/.test(token));
      const value = ours ? cssValue[token] : null;
      if (!value) continue;
      const sels = (prop.selector || part.selector).map(
        (s) => `${base}${s}${outside}${prop.state || ""}`,
      );
      rules.push(`${sels.join(",\n")} { ${prop.css}: ${value} !important; }`);
    }
  }
  return rules.join("\n");
}
