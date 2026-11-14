/**
 * auroraTokens — Aurora's surfaces and accent from a theme, at its strength,
 * with readability limits.
 */
import { auroraTokens, paletteOf, contrast } from "./auroraTokens";

const PAL = {
  rose: {
    50: "#fff1f2",
    100: "#ffe4e6",
    200: "#fecdd3",
    300: "#fda4af",
    400: "#fb7185",
    500: "#f43f5e",
    600: "#e11d48",
    700: "#be123c",
    800: "#9f1239",
    900: "#881337",
    950: "#4c0519",
  },
  teal: {
    50: "#f0fdfa",
    100: "#ccfbf1",
    200: "#99f6e4",
    300: "#5eead4",
    400: "#2dd4bf",
    500: "#14b8a6",
    600: "#0d9488",
    700: "#0f766e",
    800: "#115e59",
    900: "#134e4a",
    950: "#042f2e",
  },
  yellow: {
    50: "#fefce8",
    100: "#fef9c3",
    200: "#fef08a",
    300: "#fde047",
    400: "#facc15",
    500: "#eab308",
    600: "#ca8a04",
    700: "#a16207",
    800: "#854d0e",
    900: "#713f12",
    950: "#422006",
  },
  gray: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
    950: "#030712",
  },
  indigo: {
    50: "#eef2ff",
    100: "#e0e7ff",
    200: "#c7d2fe",
    300: "#a5b4fc",
    400: "#818cf8",
    500: "#6366f1",
    600: "#4f46e5",
    700: "#4338ca",
    800: "#3730a3",
    900: "#312e81",
    950: "#1e1b4b",
  },
};
const fillOf = (t) => t["--accent-grad"].match(/#[0-9a-f]{6}/i)[0];

test("button fills always read white text at 4.5:1", () => {
  for (const name of Object.keys(PAL)) {
    for (const mode of ["dark", "light"]) {
      const t = auroraTokens({ primary: PAL[name] }, mode, "balanced");
      expect(contrast(fillOf(t), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  }
  // Teal and yellow move a step darker to get there.
  expect(fillOf(auroraTokens({ primary: PAL.teal }, "dark", "balanced"))).toBe(
    "#0f766e",
  );
  expect(
    fillOf(auroraTokens({ primary: PAL.yellow }, "dark", "balanced")),
  ).toBe("#a16207");
});

// The tinted solid surface, as color-mix shows it.
const tinted = (t) => {
  const m = t["--solid"].match(/(#[0-9a-f]{6}) (\d+)%, (#[0-9a-f]{6})/i);
  const [a, pct, b] = [m[1], Number(m[2]) / 100, m[3]];
  const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return (
    "#" +
    [0, 1, 2]
      .map((i) => Math.round(ch(a, i) * pct + ch(b, i) * (1 - pct)))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
};

test("accent text reads on the tinted surface, at every strength and mode", () => {
  for (const name of ["rose", "teal", "yellow", "indigo", "gray"]) {
    for (const mode of ["dark", "light"]) {
      for (const strength of ["subtle", "balanced", "bold"]) {
        const t = auroraTokens({ primary: PAL[name] }, mode, strength);
        expect(contrast(t["--accent-text"], tinted(t))).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  }
});

test("slate counts as grey: the accent comes from the next colourful channel", () => {
  const slate = {
    50: "#f8fafc",
    100: "#f1f5f9",
    200: "#e2e8f0",
    300: "#cbd5e1",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a",
    950: "#020617",
  };
  const orange = { ...PAL.rose, 400: "#fb923c", 500: "#f97316" };
  const t = auroraTokens(
    { primary: PAL.gray, secondary: slate, tertiary: orange },
    "dark",
    "balanced",
  );
  expect(t["--accent"]).toBe("#fb923c");
});

test("a grey primary leaves the accent to the secondary colour", () => {
  const t = auroraTokens(
    { primary: PAL.gray, secondary: PAL.indigo },
    "dark",
    "balanced",
  );
  expect(t["--accent"]).toBe(PAL.indigo[400]);
  // Surfaces still tint from the primary.
  expect(t["--bg"]).toContain(PAL.gray[950]);
});

test("strength sets how much the surfaces take", () => {
  const pct = (s) => Number(s.match(/ (\d+)%/)[1]);
  const at = (strength) =>
    pct(auroraTokens({ primary: PAL.rose }, "dark", strength)["--raised"]);
  expect(at("subtle")).toBeLessThan(at("balanced"));
  expect(at("balanced")).toBeLessThan(at("bold"));
  expect(at("anything")).toBe(at("balanced"));
});

test("no primary, no tokens; paletteOf needs a 500", () => {
  expect(auroraTokens({}, "dark", "balanced")).toEqual({});
  expect(paletteOf(() => null, "primary")).toBeNull();
  const pal = paletteOf((t, s) => PAL.rose[s], "primary");
  expect(pal[500]).toBe("#f43f5e");
});
