/**
 * ESLint for dash-core (DASH-157): Dash's own rules, not a style guide.
 * Prettier formats; this catches what CLAUDE.md asks for in prose.
 *
 *   npm run lint                 what ci.sh runs
 *   npx eslint <file>            one file
 *
 * Existing violations are baselined in eslint-suppressions.json (errors,
 * counted per file and rule) and by --max-warnings in package.json's "lint"
 * (no-console warnings), so only new ones fail. Don't add to either to make
 * your change pass: fix the code. After a cleanup, `npm run lint:prune`
 * shrinks the baseline.
 */
import reactHooks from "eslint-plugin-react-hooks";
import dash from "./scripts/eslint-rules/index.js";

const TESTS = [
  "**/*.test.js",
  "**/*.test.jsx",
  "**/__mocks__/**",
  "**/testUtils/**",
  "src/setupTests.js",
];
const STORIES = ["**/*.stories.js", "**/*.stories.jsx"];

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "**/*.ts",
      "**/*.tsx",
    ],
  },
  {
    linterOptions: {
      // Disable comments for rules we don't run (no-await-in-loop, …) are
      // left alone.
      reportUnusedDisableDirectives: "off",
    },
  },

  // Renderer: ES modules + JSX.
  {
    files: ["src/**/*.js", "src/**/*.jsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks, dash },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // UI comes from @trops/dash-react (CLAUDE.md "UI Component Rule").
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@headlessui/*"],
              message:
                "Use the @trops/dash-react component (add it there first).",
            },
            {
              group: ["@fortawesome/*"],
              message:
                "Import FontAwesomeIcon from @trops/dash-react (icons: src/utils/resolveIcon.js).",
            },
            {
              group: ["**/ThemeContext", "**/ThemeContext.js"],
              message:
                'Import ThemeContext from "@trops/dash-react" (or the src/Context re-export), never a local file.',
            },
          ],
        },
      ],
      // src/ is ESM: import, not require.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='require']",
          message: "src/ is ES modules: use import, not require().",
        },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "dash/no-palette-classes": "error",
      "dash/no-theme-key-classes": "error",
    },
  },
  // The documented exceptions to the src/ rules.
  {
    // The one place that touches @fortawesome directly.
    files: ["src/utils/resolveIcon.js"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Loading widget bundles at run time needs require() (CommonJS bundles).
    files: ["src/utils/plugin-loader.js", "src/utils/widgetBundleLoader.js"],
    rules: { "no-restricted-syntax": "off" },
  },

  // Main process: CommonJS. electron/ may require() a few ESM-only
  // src/utils modules (botSettings, colorUtils, offCommands, themeGenerator,
  // themeStanding, trackerSetting): that works through rollup / Node's
  // require(esm), and is the documented exception.
  {
    files: ["electron/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration",
          message: "electron/ is CommonJS: use require(), not import.",
        },
        {
          selector:
            "ExportNamedDeclaration, ExportDefaultDeclaration, ExportAllDeclaration",
          message: "electron/ is CommonJS: use module.exports, not export.",
        },
      ],
      "no-console": "off",
    },
  },

  // Tests, mocks and stories: console and palette shades are fine there.
  {
    files: [...TESTS, ...STORIES],
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
      "dash/no-palette-classes": "off",
      "dash/no-theme-key-classes": "off",
    },
  },
];
