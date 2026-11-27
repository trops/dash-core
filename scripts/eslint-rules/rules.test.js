/**
 * Dash's ESLint rules (DASH-157): scripts/eslint-rules/index.js.
 * Run: node --test scripts/eslint-rules/rules.test.js
 */
"use strict";

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");
const dash = require("./index");

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("dash/no-theme-key-classes", () => {
  tester.run("no-theme-key-classes", dash.rules["no-theme-key-classes"], {
    valid: [
      // Looking the key up is the point.
      'const c = `p-2 ${currentTheme["text-primary-medium"]}`;',
      'const c = <div className={currentTheme["bg-primary-dark"]} />;',
      'const c = <div className={`border ${t("border-primary-dark")}`} />;',
      // A lone key is a key reference (getStylesForItem, themeParts).
      'const part = { textColor: "text-primary-medium" };',
      'const key = "hover-bg-secondary-dark";',
      // Real Tailwind classes, and Aurora roles.
      'const c = <div className="text-sm dr-role-accent bg-transparent" />;',
      // A palette shade is the other rule's business.
      'const c = <div className="bg-neutral-700" />;',
    ],
    invalid: [
      {
        // The DASH-147 dry run.
        code: 'const c = <span className="text-primary-medium dr-role-accent" />;',
        errors: [{ messageId: "themeKey" }],
      },
      {
        code: 'const c = <span className="text-primary-medium" />;',
        errors: [{ messageId: "themeKey" }],
      },
      {
        code: "const c = `flex ${on ? 'x' : ''} bg-secondary-dark`;",
        errors: [{ messageId: "themeKey" }],
      },
      {
        code: 'const c = <b className={on ? "hover-bg-primary-dark" : ""} />;',
        errors: [{ messageId: "themeKey" }],
      },
      {
        code: 'const cls = "p-2 border-tertiary-500 hover:text-neutral-light";',
        errors: [{ messageId: "themeKey" }, { messageId: "themeKey" }],
      },
    ],
  });
});

describe("dash/no-palette-classes", () => {
  tester.run("no-palette-classes", dash.rules["no-palette-classes"], {
    valid: [
      'const c = <div className="dr-role-surface text-sm" />;',
      'const c = `${currentTheme["bg-primary-dark"]} p-2`;',
      'const c = { "bg-gray-800": 1 };',
      'const c = theme["text-gray-300"];',
      'const c = "gray-800";',
    ],
    invalid: [
      {
        code: 'const c = <div className="bg-gray-800 p-2" />;',
        errors: [{ messageId: "palette", data: { token: "bg-gray-800" } }],
      },
      {
        code: "const c = `md:hover:text-blue-300/50 ${x}`;",
        errors: [{ messageId: "palette" }],
      },
      {
        code: 'const c = { backgroundColor: "bg-neutral-900", ring: "ring-rose-50" };',
        errors: [{ messageId: "palette" }, { messageId: "palette" }],
      },
    ],
  });
});
