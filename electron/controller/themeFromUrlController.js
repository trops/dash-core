/**
 * themeFromUrlController.js
 *
 * Color extraction pipeline for generating themes from a website URL.
 * Extracts brand colors from HTML meta tags, CSS custom properties,
 * computed styles, and favicon/logo images (via node-vibrant).
 */
const css = require("css");
const { Vibrant } = require("node-vibrant/node");
const https = require("https");
const http = require("http");
const { URL } = require("url");

// ─── Color conversion helpers ───────────────────────────────────────────────

/**
 * Parse a CSS color string (hex, rgb, rgba, hsl, hsla) into { r, g, b } (0–255).
 * Returns null if unparseable.
 */
function parseColor(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim().toLowerCase();

  // hex
  const hexMatch = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .slice(0, 3)
        .split("")
        .map((c) => c + c)
        .join("");
    } else {
      hex = hex.slice(0, 6);
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  // rgb / rgba
  const rgbMatch = s.match(
    /^rgba?\(\s*(\d{1,3})\s*[,/\s]\s*(\d{1,3})\s*[,/\s]\s*(\d{1,3})/,
  );
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }

  // hsl / hsla
  const hslMatch = s.match(
    /^hsla?\(\s*([\d.]+)\s*[,/\s]\s*([\d.]+)%\s*[,/\s]\s*([\d.]+)%/,
  );
  if (hslMatch) {
    return hslToRgb(
      parseFloat(hslMatch[1]),
      parseFloat(hslMatch[2]),
      parseFloat(hslMatch[3]),
    );
  }

  return null;
}

/** HSL (h: 0-360, s: 0-100, l: 0-100) → { r, g, b } (0-255) */
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return {
    r: Math.round(f(0) * 255),
    g: Math.round(f(8) * 255),
    b: Math.round(f(4) * 255),
  };
}

/** { r, g, b } → hex string "#rrggbb" */
function rgbToHex({ r, g, b }) {
  return (
    "#" +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** { r, g, b } (0-255) → { h, s, l } (h: 0-360, s/l: 0-100) */
function rgbToHsl({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** { r, g, b } (0-255) → { L, a, b } in CIELAB space */
function rgbToLab({ r, g, b }) {
  // sRGB → linear
  let rr = r / 255;
  let gg = g / 255;
  let bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  // linear RGB → XYZ (D65)
  let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  let y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.072175;
  let z = (rr * 0.0193339 + gg * 0.119192 + bb * 0.9503041) / 1.08883;

  // XYZ → Lab
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);

  return {
    L: 116 * y - 16,
    a: 500 * (x - y),
    b: 200 * (y - z),
  };
}

/** CIE76 deltaE between two Lab colors */
function deltaE(lab1, lab2) {
  return Math.sqrt(
    Math.pow(lab1.L - lab2.L, 2) +
      Math.pow(lab1.a - lab2.a, 2) +
      Math.pow(lab1.b - lab2.b, 2),
  );
}

// ─── Extraction stages ──────────────────────────────────────────────────────

/**
 * Extract colors from HTML meta tags (theme-color, msapplication-TileColor).
 * @param {string} htmlContent - Raw HTML string
 * @returns {Array<{hex: string, source: string, confidence: number}>}
 */
function extractMetaColors(htmlContent) {
  if (!htmlContent) return [];
  const results = [];

  // theme-color
  const themeColorMatch = htmlContent.match(
    /<meta[^>]*name\s*=\s*["']theme-color["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
  );
  if (themeColorMatch) {
    const rgb = parseColor(themeColorMatch[1]);
    if (rgb)
      results.push({
        hex: rgbToHex(rgb),
        source: "meta",
        confidence: 1.0,
      });
  }

  // Also check reversed attribute order
  const themeColorMatch2 = htmlContent.match(
    /<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']theme-color["'][^>]*>/i,
  );
  if (themeColorMatch2) {
    const rgb = parseColor(themeColorMatch2[1]);
    if (rgb)
      results.push({
        hex: rgbToHex(rgb),
        source: "meta",
        confidence: 1.0,
      });
  }

  // msapplication-TileColor
  const tileColorMatch = htmlContent.match(
    /<meta[^>]*name\s*=\s*["']msapplication-TileColor["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
  );
  if (tileColorMatch) {
    const rgb = parseColor(tileColorMatch[1]);
    if (rgb)
      results.push({
        hex: rgbToHex(rgb),
        source: "meta",
        confidence: 0.9,
      });
  }

  // Reversed order
  const tileColorMatch2 = htmlContent.match(
    /<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']msapplication-TileColor["'][^>]*>/i,
  );
  if (tileColorMatch2) {
    const rgb = parseColor(tileColorMatch2[1]);
    if (rgb)
      results.push({
        hex: rgbToHex(rgb),
        source: "meta",
        confidence: 0.9,
      });
  }

  return results;
}

/**
 * Extract colors from CSS custom properties (variables).
 * Matches patterns: --brand-*, --primary-*, --color-*, --theme-*
 * @param {string} cssContent - Raw CSS string
 * @returns {Array<{hex: string, source: string, confidence: number}>}
 */
function extractCssVarColors(cssContent) {
  if (!cssContent) return [];
  const results = [];
  const varPattern =
    /--(?:brand|primary|secondary|tertiary|color|theme|accent|main|base)[-\w]*\s*:\s*([^;]+)/gi;

  let match;
  while ((match = varPattern.exec(cssContent)) !== null) {
    const value = match[1].trim();
    const rgb = parseColor(value);
    if (rgb) {
      results.push({
        hex: rgbToHex(rgb),
        source: "cssvar",
        confidence: 0.8,
      });
    }
  }

  // Also try parsing with the css AST parser for more structured extraction
  try {
    const ast = css.parse(cssContent, { silent: true });
    if (ast && ast.stylesheet && ast.stylesheet.rules) {
      for (const rule of ast.stylesheet.rules) {
        if (!rule.declarations) continue;
        for (const decl of rule.declarations) {
          if (!decl.property || !decl.value) continue;
          if (
            /^--(?:brand|primary|secondary|tertiary|color|theme|accent|main|base)/i.test(
              decl.property,
            )
          ) {
            const rgb = parseColor(decl.value);
            if (rgb) {
              results.push({
                hex: rgbToHex(rgb),
                source: "cssvar",
                confidence: 0.8,
              });
            }
          }
        }
      }
    }
  } catch (e) {
    // CSS parse errors are expected for partial/invalid CSS — regex results still valid
    console.warn("[themeFromUrlController] CSS AST parse warning:", e.message);
  }

  return results;
}

/**
 * Extract colors from computed styles of key DOM elements.
 * @param {Object} computedStyles - Map of element selector → { color, backgroundColor, borderColor }
 * @returns {Array<{hex: string, source: string, confidence: number}>}
 */
function extractComputedColors(computedStyles) {
  if (!computedStyles || typeof computedStyles !== "object") return [];
  const results = [];
  const props = ["color", "backgroundColor", "borderColor"];

  for (const [selector, styles] of Object.entries(computedStyles)) {
    if (!styles) continue;
    for (const prop of props) {
      if (!styles[prop]) continue;
      const rgb = parseColor(styles[prop]);
      if (rgb) {
        results.push({
          hex: rgbToHex(rgb),
          source: "computed",
          confidence: 0.6,
        });
      }
    }
  }

  return results;
}

// ─── Favicon extraction ──────────────────────────────────────────────────────

/**
 * Parse HTML to find favicon and apple-touch-icon URLs.
 * Prefers apple-touch-icon (higher resolution) and largest available sizes.
 * @param {string} htmlContent - Raw HTML string
 * @returns {Array<{url: string, priority: number}>} Sorted by priority (highest first)
 */
function extractFaviconUrls(htmlContent) {
  if (!htmlContent) return [];
  const icons = [];

  // apple-touch-icon (higher resolution, best for extraction)
  const appleTouchPattern =
    /<link[^>]*rel\s*=\s*["']apple-touch-icon(?:-precomposed)?["'][^>]*>/gi;
  let match;
  while ((match = appleTouchPattern.exec(htmlContent)) !== null) {
    const hrefMatch = match[0].match(/href\s*=\s*["']([^"']+)["']/i);
    if (hrefMatch) {
      const sizesMatch = match[0].match(/sizes\s*=\s*["'](\d+)x(\d+)["']/i);
      const size = sizesMatch ? parseInt(sizesMatch[1], 10) : 180; // apple-touch-icon defaults to 180
      icons.push({ url: hrefMatch[1], priority: 100 + size });
    }
  }

  // Standard favicon link tags (icon, shortcut icon)
  const iconPattern =
    /<link[^>]*rel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]*>/gi;
  while ((match = iconPattern.exec(htmlContent)) !== null) {
    const hrefMatch = match[0].match(/href\s*=\s*["']([^"']+)["']/i);
    if (hrefMatch) {
      const sizesMatch = match[0].match(/sizes\s*=\s*["'](\d+)x(\d+)["']/i);
      const size = sizesMatch ? parseInt(sizesMatch[1], 10) : 16;
      icons.push({ url: hrefMatch[1], priority: size });
    }
  }

  // Sort by priority descending (prefer largest / apple-touch-icon)
  icons.sort((a, b) => b.priority - a.priority);
  return icons;
}

/**
 * Resolve a potentially relative URL against a base URL.
 * @param {string} href - The href from the HTML (may be relative)
 * @param {string} baseUrl - The page URL to resolve against
 * @returns {string|null} Absolute URL or null if invalid
 */
function resolveUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Fetch a URL and return the response as a Buffer.
 * Follows redirects (up to 5). Times out after 10 seconds.
 * @param {string} url - Absolute URL to fetch
 * @returns {Promise<Buffer>}
 */
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const request = client.get(
      url,
      { timeout: 10000, headers: { "User-Agent": "Dash/1.0" } },
      (res) => {
        // Follow redirects
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const redirectUrl = resolveUrl(res.headers.location, url);
          if (redirectUrl) {
            fetchBuffer(redirectUrl).then(resolve).catch(reject);
            return;
          }
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
    );
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Timeout"));
    });
  });
}

/**
 * Extract colors from favicon/logo images using node-vibrant.
 * Tries icons in priority order (apple-touch-icon first, largest first).
 * Returns on the first successful extraction.
 *
 * @param {string} htmlContent - Raw HTML to parse for icon URLs
 * @param {string} baseUrl - Page URL for resolving relative icon paths
 * @returns {Promise<Array<{hex: string, source: string, confidence: number}>>}
 */
async function extractFaviconColors(htmlContent, baseUrl) {
  const iconEntries = extractFaviconUrls(htmlContent);
  if (iconEntries.length === 0) {
    // Fallback: try /favicon.ico at the domain root
    try {
      const rootFavicon = new URL("/favicon.ico", baseUrl).href;
      iconEntries.push({ url: rootFavicon, priority: 1 });
    } catch {
      return [];
    }
  }

  for (const entry of iconEntries) {
    const absoluteUrl = resolveUrl(entry.url, baseUrl);
    if (!absoluteUrl) continue;

    try {
      const buffer = await fetchBuffer(absoluteUrl);
      const palette = await Vibrant.from(buffer).getPalette();

      const results = [];
      const swatchNames = [
        "Vibrant",
        "DarkVibrant",
        "LightVibrant",
        "Muted",
        "DarkMuted",
        "LightMuted",
      ];

      for (const name of swatchNames) {
        const swatch = palette[name];
        if (!swatch) continue;
        const [r, g, b] = swatch.rgb;
        const hex = rgbToHex({
          r: Math.round(r),
          g: Math.round(g),
          b: Math.round(b),
        });
        results.push({
          hex,
          source: "favicon",
          confidence: 0.7,
        });
      }

      if (results.length > 0) {
        console.log(
          `[themeFromUrlController] Favicon vibrant: ${results.length} swatches from ${absoluteUrl}`,
        );
        return results;
      }
    } catch (err) {
      console.warn(
        `[themeFromUrlController] Favicon extraction failed for ${absoluteUrl}: ${err.message}`,
      );
      // Try next icon
    }
  }

  return [];
}

// ─── Merge & rank ────────────────────────────────────────────────────────────

/**
 * Check if a color is "boring" — near-black, near-white, or very low saturation.
 * These are filtered from the primary palette but can still be used for neutral role.
 */
function isBoringColor(hex) {
  const rgb = parseColor(hex);
  if (!rgb) return true;
  const hsl = rgbToHsl(rgb);

  // Near-black or near-white
  if (hsl.l < 5 || hsl.l > 95) return true;

  // Very low saturation (near-gray)
  if (hsl.s < 5) return true;

  return false;
}

/**
 * Merge colors from all sources, deduplicate via clustering, and rank.
 * @param {Array<{hex, source, confidence}>} allColors - Colors from all extraction stages
 * @param {number} maxColors - Maximum palette size (default: 6)
 * @returns {Array<{hex, rgb, hsl, confidence, sources}>}
 */
function mergeAndRank(allColors, maxColors = 6) {
  if (!allColors || allColors.length === 0) return [];

  // Build clusters — group colors within deltaE < 10
  const clusters = [];
  const THRESHOLD = 10;

  for (const color of allColors) {
    const rgb = parseColor(color.hex);
    if (!rgb) continue;
    const lab = rgbToLab(rgb);

    let merged = false;
    for (const cluster of clusters) {
      if (deltaE(cluster.lab, lab) < THRESHOLD) {
        // Merge into existing cluster — keep the highest-confidence color as representative
        cluster.count++;
        cluster.sources.add(color.source);
        if (color.confidence > cluster.confidence) {
          cluster.hex = color.hex;
          cluster.rgb = rgb;
          cluster.lab = lab;
          cluster.confidence = color.confidence;
        }
        merged = true;
        break;
      }
    }

    if (!merged) {
      clusters.push({
        hex: color.hex,
        rgb,
        lab,
        confidence: color.confidence,
        count: 1,
        sources: new Set([color.source]),
      });
    }
  }

  // Separate boring from interesting colors
  const interesting = clusters.filter((c) => !isBoringColor(c.hex));
  const boring = clusters.filter((c) => isBoringColor(c.hex));

  // Score: confidence * frequency weight * saturation bonus
  const scored = interesting.map((c) => {
    const hsl = rgbToHsl(c.rgb);
    const freqWeight = Math.min(c.count / 3, 1.5); // cap frequency bonus
    const satBonus = 1 + hsl.s / 200; // slight boost for saturated colors
    return {
      ...c,
      hsl,
      score: c.confidence * freqWeight * satBonus,
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Take top N, optionally include best boring color for neutral
  const palette = scored.slice(0, maxColors).map((c) => ({
    hex: c.hex,
    rgb: { r: c.rgb.r, g: c.rgb.g, b: c.rgb.b },
    hsl: {
      h: Math.round(c.hsl.h),
      s: Math.round(c.hsl.s),
      l: Math.round(c.hsl.l),
    },
    confidence: Math.round(c.score * 100) / 100,
    sources: Array.from(c.sources),
  }));

  // If we have boring colors and the palette doesn't already have a neutral-ish color,
  // append the top boring color as a candidate for the neutral role
  if (boring.length > 0 && palette.length < maxColors) {
    const bestBoring = boring.sort((a, b) => b.confidence - a.confidence)[0];
    const hsl = rgbToHsl(bestBoring.rgb);
    palette.push({
      hex: bestBoring.hex,
      rgb: {
        r: bestBoring.rgb.r,
        g: bestBoring.rgb.g,
        b: bestBoring.rgb.b,
      },
      hsl: { h: Math.round(hsl.h), s: Math.round(hsl.s), l: Math.round(hsl.l) },
      confidence: Math.round(bestBoring.confidence * 100) / 100,
      sources: Array.from(bestBoring.sources),
      isNeutral: true,
    });
  }

  return palette;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Extract a ranked color palette from website content.
 *
 * When `baseUrl` is provided, also extracts colors from favicon/logo images
 * via node-vibrant (async). Without `baseUrl`, runs synchronously using only
 * meta tags, CSS vars, and computed styles.
 *
 * @param {Object} params
 * @param {string} params.htmlContent - Raw HTML of the page
 * @param {string} params.cssContent - Concatenated CSS content
 * @param {Object} params.computedStyles - Map of selector → { color, backgroundColor, borderColor }
 * @param {string} [params.baseUrl] - Page URL for resolving favicon paths (enables image extraction)
 * @returns {Promise<{ palette: Array, rawCount: number }>}
 */
async function extractColorsFromUrl({
  htmlContent,
  cssContent,
  computedStyles,
  baseUrl,
}) {
  console.log("[themeFromUrlController] Starting color extraction pipeline");

  const metaColors = extractMetaColors(htmlContent);
  console.log(
    `[themeFromUrlController] Meta tags: ${metaColors.length} colors`,
  );

  const cssVarColors = extractCssVarColors(cssContent);
  console.log(
    `[themeFromUrlController] CSS vars: ${cssVarColors.length} colors`,
  );

  const computedColors = extractComputedColors(computedStyles);
  console.log(
    `[themeFromUrlController] Computed styles: ${computedColors.length} colors`,
  );

  // Favicon extraction (async, requires baseUrl)
  let faviconColors = [];
  if (baseUrl) {
    try {
      faviconColors = await extractFaviconColors(htmlContent, baseUrl);
      console.log(
        `[themeFromUrlController] Favicon/logo: ${faviconColors.length} colors`,
      );
    } catch (err) {
      console.warn(
        `[themeFromUrlController] Favicon extraction failed: ${err.message}`,
      );
    }
  }

  const allColors = [
    ...metaColors,
    ...cssVarColors,
    ...computedColors,
    ...faviconColors,
  ];
  console.log(`[themeFromUrlController] Total raw colors: ${allColors.length}`);

  const palette = mergeAndRank(allColors);
  console.log(
    `[themeFromUrlController] Final palette: ${palette.length} colors`,
  );

  return {
    palette,
    rawCount: allColors.length,
  };
}

const themeFromUrlController = {
  extractColorsFromUrl,
  extractFaviconUrls,
  extractFaviconColors,
};

module.exports = themeFromUrlController;
