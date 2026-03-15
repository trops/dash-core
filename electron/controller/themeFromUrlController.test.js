const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const themeFromUrlController = require("./themeFromUrlController");

const { extractColorsFromUrl } = themeFromUrlController;

describe("themeFromUrlController", () => {
  describe("extractMetaColors (via extractColorsFromUrl)", () => {
    it("extracts theme-color meta tag", () => {
      const html =
        '<html><head><meta name="theme-color" content="#3B82F6"></head></html>';
      const result = extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#3b82f6");
    });

    it("extracts msapplication-TileColor", () => {
      const html =
        '<html><head><meta name="msapplication-TileColor" content="#da532c"></head></html>';
      const result = extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#da532c");
    });

    it("handles reversed attribute order", () => {
      const html =
        '<html><head><meta content="#ff5500" name="theme-color"></head></html>';
      const result = extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#ff5500");
    });

    it("returns empty palette for no meta tags", () => {
      const result = extractColorsFromUrl({
        htmlContent: "<html><head></head></html>",
        cssContent: "",
        computedStyles: {},
      });
      assert.equal(result.palette.length, 0);
      assert.equal(result.rawCount, 0);
    });
  });

  describe("extractCssVarColors (via extractColorsFromUrl)", () => {
    it("extracts brand CSS custom properties", () => {
      const css =
        ":root { --brand-primary: #6366f1; --brand-accent: #f59e0b; }";
      const result = extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 2);
      assert.ok(result.rawCount >= 2);
    });

    it("extracts color-* pattern variables", () => {
      const css = ":root { --color-main: rgb(59, 130, 246); }";
      const result = extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 1);
    });

    it("handles invalid CSS gracefully", () => {
      const css = "this is not valid css {{{ --brand-color: #ff0000; }";
      const result = extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      // Should still extract via regex fallback
      assert.ok(result.palette.length >= 1);
    });
  });

  describe("extractComputedColors (via extractColorsFromUrl)", () => {
    it("extracts computed styles from key elements", () => {
      const computed = {
        body: {
          color: "rgb(0, 0, 0)",
          backgroundColor: "rgb(59, 130, 246)",
          borderColor: "rgb(99, 102, 241)",
        },
        header: {
          color: "rgb(255, 255, 255)",
          backgroundColor: "rgb(30, 64, 175)",
          borderColor: null,
        },
      };
      const result = extractColorsFromUrl({
        htmlContent: "",
        cssContent: "",
        computedStyles: computed,
      });
      // Near-black and near-white are filtered as "boring"
      assert.ok(result.rawCount >= 3);
    });

    it("handles null/empty computed styles", () => {
      const result = extractColorsFromUrl({
        htmlContent: "",
        cssContent: "",
        computedStyles: null,
      });
      assert.equal(result.palette.length, 0);
    });
  });

  describe("merge and rank", () => {
    it("deduplicates similar colors via deltaE clustering", () => {
      // Two very similar blues
      const css = ":root { --brand-primary: #3b82f6; --color-main: #3a80f4; }";
      const result = extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      // Should cluster into 1
      assert.equal(result.palette.length, 1);
      assert.ok(result.rawCount >= 2);
    });

    it("keeps distinct colors separate", () => {
      const css =
        ":root { --brand-primary: #3b82f6; --brand-secondary: #ef4444; --brand-tertiary: #10b981; }";
      const result = extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 3);
    });

    it("filters boring colors but keeps them for neutral", () => {
      const html =
        '<html><head><meta name="theme-color" content="#3b82f6"></head></html>';
      const computed = {
        body: {
          color: "rgb(51, 51, 51)",
          backgroundColor: "rgb(245, 245, 245)",
          borderColor: null,
        },
      };
      const result = extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: computed,
      });
      // Blue from meta should be primary, boring grays filtered or added as neutral
      assert.ok(result.palette.length >= 1);
      const blueEntry = result.palette.find((c) => c.hex === "#3b82f6");
      assert.ok(blueEntry, "Blue should be in palette");
    });

    it("returns max 6 colors by default", () => {
      const css = `:root {
                --brand-1: #ef4444;
                --brand-2: #f97316;
                --brand-3: #eab308;
                --brand-4: #22c55e;
                --brand-5: #3b82f6;
                --brand-6: #8b5cf6;
                --brand-7: #ec4899;
                --brand-8: #14b8a6;
            }`;
      const result = extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      assert.ok(result.palette.length <= 7); // 6 + possible neutral
    });
  });

  describe("full pipeline integration", () => {
    it("combines all sources and produces ranked palette", () => {
      const html =
        '<html><head><meta name="theme-color" content="#6366f1"></head></html>';
      const css =
        ":root { --brand-primary: #6366f1; --brand-accent: #f59e0b; }";
      const computed = {
        a: {
          color: "rgb(99, 102, 241)",
          backgroundColor: null,
          borderColor: null,
        },
      };

      const result = extractColorsFromUrl({
        htmlContent: html,
        cssContent: css,
        computedStyles: computed,
      });

      // Indigo appears in all 3 sources — should be top ranked
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#6366f1");
      assert.ok(result.palette[0].confidence > 0);
      assert.ok(result.palette[0].sources.length >= 1);
    });
  });
});
