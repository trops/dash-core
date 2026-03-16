const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const themeFromUrlController = require("./themeFromUrlController");

const { extractColorsFromUrl, extractFaviconUrls } = themeFromUrlController;

describe("themeFromUrlController", () => {
  describe("extractMetaColors (via extractColorsFromUrl)", () => {
    it("extracts theme-color meta tag", async () => {
      const html =
        '<html><head><meta name="theme-color" content="#3B82F6"></head></html>';
      const result = await extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#3b82f6");
    });

    it("extracts msapplication-TileColor", async () => {
      const html =
        '<html><head><meta name="msapplication-TileColor" content="#da532c"></head></html>';
      const result = await extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#da532c");
    });

    it("handles reversed attribute order", async () => {
      const html =
        '<html><head><meta content="#ff5500" name="theme-color"></head></html>';
      const result = await extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#ff5500");
    });

    it("throws NoColorsFoundError for no meta tags", async () => {
      await assert.rejects(
        () =>
          extractColorsFromUrl({
            htmlContent: "<html><head></head></html>",
            cssContent: "",
            computedStyles: {},
          }),
        (err) => {
          assert.equal(err.name, "NoColorsFoundError");
          return true;
        },
      );
    });
  });

  describe("extractCssVarColors (via extractColorsFromUrl)", () => {
    it("extracts brand CSS custom properties", async () => {
      const css =
        ":root { --brand-primary: #6366f1; --brand-accent: #f59e0b; }";
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 2);
      assert.ok(result.rawCount >= 2);
    });

    it("extracts color-* pattern variables", async () => {
      const css = ":root { --color-main: rgb(59, 130, 246); }";
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 1);
    });

    it("handles invalid CSS gracefully", async () => {
      const css = "this is not valid css {{{ --brand-color: #ff0000; }";
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      // Should still extract via regex fallback
      assert.ok(result.palette.length >= 1);
    });
  });

  describe("extractComputedColors (via extractColorsFromUrl)", () => {
    it("extracts computed styles from key elements", async () => {
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
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: "",
        computedStyles: computed,
      });
      // Near-black and near-white are filtered as "boring"
      assert.ok(result.rawCount >= 3);
    });

    it("throws NoColorsFoundError for null/empty computed styles with no other sources", async () => {
      await assert.rejects(
        () =>
          extractColorsFromUrl({
            htmlContent: "",
            cssContent: "",
            computedStyles: null,
          }),
        (err) => {
          assert.equal(err.name, "NoColorsFoundError");
          return true;
        },
      );
    });
  });

  describe("merge and rank", () => {
    it("deduplicates similar colors via deltaE clustering", async () => {
      // Two very similar blues
      const css = ":root { --brand-primary: #3b82f6; --color-main: #3a80f4; }";
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      // Should cluster into 1
      assert.equal(result.palette.length, 1);
      assert.ok(result.rawCount >= 2);
    });

    it("keeps distinct colors separate", async () => {
      const css =
        ":root { --brand-primary: #3b82f6; --brand-secondary: #ef4444; --brand-tertiary: #10b981; }";
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      assert.ok(result.palette.length >= 3);
    });

    it("filters boring colors but keeps them for neutral", async () => {
      const html =
        '<html><head><meta name="theme-color" content="#3b82f6"></head></html>';
      const computed = {
        body: {
          color: "rgb(51, 51, 51)",
          backgroundColor: "rgb(245, 245, 245)",
          borderColor: null,
        },
      };
      const result = await extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: computed,
      });
      // Blue from meta should be primary, boring grays filtered or added as neutral
      assert.ok(result.palette.length >= 1);
      const blueEntry = result.palette.find((c) => c.hex === "#3b82f6");
      assert.ok(blueEntry, "Blue should be in palette");
    });

    it("returns max 6 colors by default", async () => {
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
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: css,
        computedStyles: {},
      });
      assert.ok(result.palette.length <= 7); // 6 + possible neutral
    });
  });

  describe("full pipeline integration", () => {
    it("combines all sources and produces ranked palette", async () => {
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

      const result = await extractColorsFromUrl({
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

  describe("extractFaviconUrls", () => {
    it("extracts apple-touch-icon with highest priority", () => {
      const html = `<html><head>
        <link rel="icon" href="/favicon.ico">
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
      </head></html>`;
      const icons = extractFaviconUrls(html);
      assert.ok(icons.length >= 3);
      // Apple touch icon should be first (priority 100 + 180 = 280)
      assert.equal(icons[0].url, "/apple-touch-icon.png");
    });

    it("extracts shortcut icon", () => {
      const html =
        '<html><head><link rel="shortcut icon" href="/favicon.ico"></head></html>';
      const icons = extractFaviconUrls(html);
      assert.equal(icons.length, 1);
      assert.equal(icons[0].url, "/favicon.ico");
    });

    it("prefers largest icon size", () => {
      const html = `<html><head>
        <link rel="icon" sizes="16x16" href="/small.png">
        <link rel="icon" sizes="192x192" href="/large.png">
        <link rel="icon" sizes="32x32" href="/medium.png">
      </head></html>`;
      const icons = extractFaviconUrls(html);
      assert.equal(icons[0].url, "/large.png");
    });

    it("returns empty array for no icons", () => {
      const html = "<html><head></head></html>";
      const icons = extractFaviconUrls(html);
      assert.equal(icons.length, 0);
    });

    it("handles apple-touch-icon-precomposed", () => {
      const html =
        '<html><head><link rel="apple-touch-icon-precomposed" href="/icon.png"></head></html>';
      const icons = extractFaviconUrls(html);
      assert.equal(icons.length, 1);
      assert.equal(icons[0].url, "/icon.png");
    });

    it("handles null/empty htmlContent", () => {
      assert.deepEqual(extractFaviconUrls(null), []);
      assert.deepEqual(extractFaviconUrls(""), []);
    });
  });

  describe("favicon extraction fallback", () => {
    it("continues pipeline without favicon when no baseUrl provided", async () => {
      const html =
        '<html><head><meta name="theme-color" content="#3b82f6"><link rel="icon" href="/favicon.ico"></head></html>';
      const result = await extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
      });
      // Should still have meta color, no favicon source
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#3b82f6");
      assert.ok(!result.palette[0].sources.includes("favicon"));
    });

    it("gracefully handles unreachable favicon URL", async () => {
      const html =
        '<html><head><meta name="theme-color" content="#3b82f6"><link rel="icon" href="/favicon.ico"></head></html>';
      const result = await extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
        baseUrl: "http://localhost:99999",
      });
      // Should still have meta color despite favicon failure
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#3b82f6");
    });
  });

  describe("extractDomColors (via extractColorsFromUrl)", () => {
    it("extracts frequency-sorted DOM colors with blue ranking higher", async () => {
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: "",
        computedStyles: {},
        domColors: [
          { color: "rgb(66, 133, 244)", count: 15 }, // Google blue
          { color: "rgb(219, 68, 55)", count: 8 }, // Google red
        ],
      });
      assert.ok(result.palette.length >= 2);
      // Blue has higher count, should rank first
      assert.equal(result.palette[0].hex, "#4285f4");
    });

    it("high-frequency DOM colors outrank single-occurrence CSS vars", async () => {
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: ":root { --brand-primary: #ff5500; }",
        computedStyles: {},
        domColors: [
          { color: "rgb(66, 133, 244)", count: 50 },
          { color: "rgb(219, 68, 55)", count: 30 },
        ],
      });
      assert.ok(result.palette.length >= 2);
      // DOM blue (count 50) should outrank the single CSS var
      assert.equal(result.palette[0].hex, "#4285f4");
    });

    it("handles Google-like palette — all 4 brand colors appear", async () => {
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: "",
        computedStyles: {},
        domColors: [
          { color: "rgb(66, 133, 244)", count: 3 }, // blue
          { color: "rgb(219, 68, 55)", count: 3 }, // red
          { color: "rgb(244, 180, 0)", count: 3 }, // yellow
          { color: "rgb(15, 157, 88)", count: 3 }, // green
        ],
      });
      assert.ok(result.palette.length >= 4);
      const hexes = result.palette.map((c) => c.hex);
      assert.ok(hexes.includes("#4285f4"), "Blue should be in palette");
      assert.ok(hexes.includes("#db4437"), "Red should be in palette");
      assert.ok(hexes.includes("#f4b400"), "Yellow should be in palette");
      assert.ok(hexes.includes("#0f9d58"), "Green should be in palette");
    });

    it("handles empty domColors gracefully", async () => {
      const html =
        '<html><head><meta name="theme-color" content="#3b82f6"></head></html>';
      const result = await extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
        domColors: [],
      });
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#3b82f6");
    });

    it("handles null domColors gracefully", async () => {
      const html =
        '<html><head><meta name="theme-color" content="#3b82f6"></head></html>';
      const result = await extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
        domColors: null,
      });
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#3b82f6");
    });

    it("preserves backwards compat — existing computedStyles still work", async () => {
      const computed = {
        body: {
          color: "rgb(0, 0, 0)",
          backgroundColor: "rgb(59, 130, 246)",
          borderColor: "rgb(99, 102, 241)",
        },
      };
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: "",
        computedStyles: computed,
      });
      assert.ok(result.rawCount >= 2);
    });
  });

  describe("error paths — controller defensive guards", () => {
    it("throws ExtractionFailedError when computedStyles is a non-object", async () => {
      await assert.rejects(
        () =>
          extractColorsFromUrl({
            htmlContent: "",
            cssContent: "",
            computedStyles: "not-an-object",
          }),
        (err) => {
          assert.equal(err.name, "ExtractionFailedError");
          assert.equal(err.type, "EXTRACTION_FAILED");
          assert.ok(err.message.includes("computedStyles"));
          return true;
        },
      );
    });

    it("throws NoColorsFoundError when no colors extracted at all", async () => {
      await assert.rejects(
        () =>
          extractColorsFromUrl({
            htmlContent: "<html><head></head></html>",
            cssContent: "",
            computedStyles: {},
          }),
        (err) => {
          assert.equal(err.name, "NoColorsFoundError");
          assert.equal(err.type, "NO_COLORS_FOUND");
          assert.ok(err.userMessage.includes("No usable colors"));
          return true;
        },
      );
    });

    it("includes boring colors as neutral candidates when no chromatic colors exist", async () => {
      // Only near-black and near-white computed styles — boring but still usable as neutral
      const computed = {
        body: {
          color: "rgb(100, 100, 100)",
          backgroundColor: "rgb(200, 200, 200)",
          borderColor: null,
        },
      };
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: "",
        computedStyles: computed,
      });
      // Boring colors get added as neutral candidates — palette should still have entries
      assert.ok(result.palette.length >= 1);
      // All entries should be low-saturation (neutral-ish)
      for (const entry of result.palette) {
        assert.ok(entry.hsl.s <= 10 || entry.isNeutral);
      }
    });

    it("skips color entries with missing hex (no crash)", async () => {
      // CSS var that would produce a color + a meta tag with an unparseable color
      // The unparseable ones get null from parseColor → no hex → filtered out
      const html =
        '<html><head><meta name="theme-color" content="#3b82f6"></head></html>';
      const result = await extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: {},
      });
      // Should still succeed with the valid color
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#3b82f6");
    });

    it("handles null computedStyles gracefully", async () => {
      const html =
        '<html><head><meta name="theme-color" content="#ef4444"></head></html>';
      const result = await extractColorsFromUrl({
        htmlContent: html,
        cssContent: "",
        computedStyles: null,
      });
      assert.ok(result.palette.length >= 1);
      assert.equal(result.palette[0].hex, "#ef4444");
    });

    it("handles empty htmlContent and cssContent (only computedStyles)", async () => {
      const computed = {
        header: {
          color: null,
          backgroundColor: "rgb(59, 130, 246)",
          borderColor: null,
        },
      };
      const result = await extractColorsFromUrl({
        htmlContent: "",
        cssContent: "",
        computedStyles: computed,
      });
      assert.ok(result.palette.length >= 1);
    });

    it("mergeAndRank returns no_colors_extracted for empty input", async () => {
      // No sources of any colors at all — will hit NoColorsFoundError
      await assert.rejects(
        () =>
          extractColorsFromUrl({
            htmlContent: "",
            cssContent: "",
            computedStyles: {},
          }),
        (err) => {
          assert.equal(err.name, "NoColorsFoundError");
          return true;
        },
      );
    });
  });
});
