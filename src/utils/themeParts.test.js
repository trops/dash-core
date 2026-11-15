import { ThemeModel } from "../Models/ThemeModel";
import {
  PARTS,
  changedParts,
  partById,
  resetProp,
  setProp,
  themePartsCss,
  tokenFor,
  tokenLabel,
} from "./themeParts";

const OCEAN = {
  id: "ocean",
  name: "Ocean",
  primary: "blue",
  secondary: "indigo",
  tertiary: "rose",
  neutral: "gray",
  dark: {},
  light: {},
};

const button2 = partById("button-2");
const fill = button2.props.find((p) => p.id === "fill");

describe("themeParts", () => {
  test("every part has keys, words and properties", () => {
    for (const p of PARTS) {
      expect(p.keys.length).toBeGreaterThan(0);
      expect(p.label).toBeTruthy();
      expect(p.about).toBeTruthy();
      expect(p.props.length).toBeGreaterThan(0);
    }
  });

  test("tokens read in plain words", () => {
    expect(tokenLabel("bg-tertiary-700")).toBe("Highlight · Dark");
    expect(tokenLabel("hover-text-primary-100")).toBe("Main · Lightest");
    expect(tokenLabel("bg-none")).toBe("None");
    expect(tokenLabel("bg-primary-medium")).toBe("From the theme");
    expect(tokenLabel(null)).toBe(null);
  });

  test("a fixed shade is the same colour in Dark and Light", () => {
    const m = ThemeModel(OCEAN);
    expect(m.dark["bg-tertiary-700"]).toBe("bg-rose-700");
    expect(m.light["bg-tertiary-700"]).toBe("bg-rose-700");
    expect(m.dark["hover-bg-primary-300"]).toBe("hover:bg-blue-300");
    expect(m.dark.cssValue["bg-tertiary-700"]).toBe(
      m.light.cssValue["bg-tertiary-700"],
    );
  });

  test("hex themes get fixed shades through their CSS variables", () => {
    const m = ThemeModel({ ...OCEAN, tertiary: "#f43f5e" });
    expect(m.dark["text-tertiary-900"]).toBe("text-[var(--tertiary-900)]");
    expect(m.dark.cssValue["text-tertiary-900"]).toMatch(/^#/);
  });

  test("set, count and reset a change", () => {
    const token = tokenFor(fill, "tertiary", 700);
    const draft = setProp(OCEAN, button2, fill, token);
    expect(draft.dark["button-2"].backgroundColor).toBe("bg-tertiary-700");
    expect(draft.light["button-2"].backgroundColor).toBe("bg-tertiary-700");
    expect(OCEAN.dark["button-2"]).toBeUndefined();
    const changes = changedParts(OCEAN, draft);
    expect(changes).toHaveLength(1);
    expect(changes[0].part.id).toBe("button-2");
    expect(changes[0].props.map((p) => p.id)).toEqual(["fill"]);
    const back = resetProp(draft, OCEAN, button2, fill);
    expect(back.dark["button-2"]).toBeUndefined();
    expect(changedParts(OCEAN, back)).toHaveLength(0);
  });

  test("Dark only leaves Light alone", () => {
    const draft = setProp(OCEAN, button2, fill, "bg-tertiary-700", ["dark"]);
    expect(draft.dark["button-2"].backgroundColor).toBe("bg-tertiary-700");
    expect(draft.light["button-2"]).toBeUndefined();
  });

  test("a part with several keys changes them all", () => {
    const card = partById("card");
    const draft = setProp(OCEAN, card, card.props[0], "bg-neutral-900");
    for (const k of ["card", "card-2", "card-3"]) {
      expect(draft.dark[k].backgroundColor).toBe("bg-neutral-900");
    }
  });

  test("reset keeps what the theme had before", () => {
    const had = { ...OCEAN, dark: { "button-2": { textColor: "text-x" } } };
    const text = button2.props.find((p) => p.id === "text");
    const draft = setProp(had, button2, text, "text-primary-100");
    const back = resetProp(draft, had, button2, null);
    expect(back.dark["button-2"]).toEqual({ textColor: "text-x" });
  });

  test("Aurora-painted parts get rules that win, scoped or app-wide", () => {
    const draft = setProp(OCEAN, button2, fill, "bg-tertiary-700");
    const v = ThemeModel(draft).dark;
    const app = themePartsCss(v, null);
    expect(app).toContain(
      '[data-design="aurora"] .dr-btn.dr-btn-secondary:not(.dr-btn-danger):not([data-own-theme] *)',
    );
    expect(app).toContain(
      `background: ${v.cssValue["bg-tertiary-700"]} !important`,
    );
    const scoped = themePartsCss(v, "edit-preview");
    expect(scoped).toContain(
      '[data-design="aurora"] [data-own-theme="edit-preview"] .dr-btn.dr-btn-secondary',
    );
    expect(scoped).not.toContain(":not([data-own-theme] *)");
  });

  test("older per-component colours keep their old look (no rules)", () => {
    const legacy = {
      ...OCEAN,
      dark: {
        panel: { borderColor: "border-primary-very-dark" },
        card: { backgroundColor: "bg-primary-dark" },
      },
    };
    expect(themePartsCss(ThemeModel(legacy).dark)).toBe("");
  });

  test("No fill is a rule too", () => {
    const draft = setProp(OCEAN, button2, fill, "bg-none");
    expect(themePartsCss(ThemeModel(draft).dark)).toContain(
      "background: transparent !important",
    );
  });

  test("no rules for an untouched theme or for class-painted parts", () => {
    expect(themePartsCss(ThemeModel(OCEAN).dark)).toBe("");
    const tag = partById("tag");
    const draft = setProp(OCEAN, tag, tag.props[0], "bg-secondary-300");
    expect(themePartsCss(ThemeModel(draft).dark)).toBe("");
  });

  test("a tag change keeps the readable tag text", () => {
    const tag = partById("tag");
    const draft = setProp(OCEAN, tag, tag.props[0], "bg-secondary-300");
    const m = ThemeModel(draft);
    expect(m.dark.tag.backgroundColor).toBe("bg-secondary-300");
    expect(m.dark.tag.textColor).toBe("text-primary-medium");
  });
});
