/**
 * readBotAnswer.test.js — a widget gets a bot's final answer as plain text
 * in whatever format the bot chose; readBotAnswer turns it into one shape.
 */
import { readBotAnswer } from "./readBotAnswer";

describe("readBotAnswer — lists", () => {
  it("reads a shopping list with images and buy links", () => {
    const out = readBotAnswer(
      [
        "Here is your shopping list:",
        "",
        "- ![Milk](https://img.example.com/milk.png) **Whole milk** — [Buy](https://shop.example.com/milk)",
        "- ![Eggs](https://img.example.com/eggs.jpg?w=200) Eggs (12) - [Buy here](https://shop.example.com/eggs)",
      ].join("\n"),
    );
    expect(out.kind).toBe("list");
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({
      title: "Whole milk",
      image: "https://img.example.com/milk.png",
      link: "https://shop.example.com/milk",
      checked: null,
    });
    expect(out.items[0].links).toEqual([
      { text: "Buy", url: "https://shop.example.com/milk" },
    ]);
    expect(out.items[1].title).toBe("Eggs (12)");
    expect(out.items[1].image).toBe("https://img.example.com/eggs.jpg?w=200");
    expect(out.images).toHaveLength(2);
    expect(out.links).toHaveLength(2);
  });

  it("reads a list without images", () => {
    const out = readBotAnswer("* Apples\n* Bread\n+ Cheese");
    expect(out.kind).toBe("list");
    expect(out.items.map((i) => i.title)).toEqual([
      "Apples",
      "Bread",
      "Cheese",
    ]);
    expect(out.items.every((i) => i.image === null && i.link === null)).toBe(
      true,
    );
  });

  it("keeps link text in the title when it is the item name", () => {
    const out = readBotAnswer(
      "- [Organic milk](https://shop.example.com/m) — 2L",
    );
    expect(out.items[0].title).toBe("Organic milk — 2L");
    expect(out.items[0].text).toBe("Organic milk — 2L");
    expect(out.items[0].link).toBe("https://shop.example.com/m");
  });

  it("reads a numbered list (1. and 1))", () => {
    const out = readBotAnswer("1. First step\n2) Second step\n3. Third step");
    expect(out.kind).toBe("list");
    expect(out.items.map((i) => i.title)).toEqual([
      "First step",
      "Second step",
      "Third step",
    ]);
  });

  it("reads a task list", () => {
    const out = readBotAnswer("- [ ] Buy milk\n- [x] Call mom\n- [X] Pay rent");
    expect(out.items.map((i) => [i.title, i.checked])).toEqual([
      ["Buy milk", false],
      ["Call mom", true],
      ["Pay rent", true],
    ]);
  });

  it("flattens nested items into the parent's detail", () => {
    const out = readBotAnswer(
      [
        "- Milk",
        "  - 2 litres",
        "  - semi-skimmed",
        "- Bread",
        "    * sourdough, see https://bakery.example.com/loaf",
      ].join("\n"),
    );
    expect(out.items).toHaveLength(2);
    expect(out.items[0].detail).toBe("2 litres · semi-skimmed");
    expect(out.items[1].detail).toMatch(/^sourdough/);
    expect(out.items[1].link).toBe("https://bakery.example.com/loaf");
  });

  it("strips bold/italic and trailing separators from titles", () => {
    const out = readBotAnswer("- **Bananas** _ripe_ :\n- *Kiwi* |");
    expect(out.items[0].title).toBe("Bananas ripe");
    expect(out.items[1].title).toBe("Kiwi");
  });

  it("an intro paragraph plus a list is a list", () => {
    const out = readBotAnswer(
      "I checked three stores and found these.\n\n- Rice\n- Beans\n\nLet me know!",
    );
    expect(out.kind).toBe("list");
    expect(out.items.map((i) => i.title)).toEqual(["Rice", "Beans"]);
  });

  it("does not treat a horizontal rule as a list item", () => {
    const out = readBotAnswer("Intro\n\n* * *\n\nMore text");
    expect(out.kind).toBe("text");
  });
});

describe("readBotAnswer — links and images", () => {
  it("reads a bare image URL as the item image", () => {
    const out = readBotAnswer("- Tomatoes https://cdn.example.com/t.webp?v=2");
    expect(out.items[0].image).toBe("https://cdn.example.com/t.webp?v=2");
    expect(out.items[0].link).toBeNull();
    expect(out.items[0].title).toBe("Tomatoes");
  });

  it("an image URL as a link target becomes the image", () => {
    const out = readBotAnswer("- Lemon [photo](https://cdn.example.com/l.svg)");
    expect(out.items[0].image).toBe("https://cdn.example.com/l.svg");
    expect(out.items[0].links).toEqual([]);
  });

  it("reads <url> autolinks", () => {
    const out = readBotAnswer("- Docs <https://docs.example.com/start>");
    expect(out.items[0].link).toBe("https://docs.example.com/start");
    expect(out.items[0].title).toBe("Docs");
  });

  it("drops unsafe URLs (javascript:, data:, file:)", () => {
    const out = readBotAnswer(
      [
        "- [Click](javascript:alert(1)) evil",
        "- ![x](data:image/png;base64,AAAA) pic",
        "- [file](file:///etc/passwd) local",
      ].join("\n"),
    );
    expect(out.items).toHaveLength(3);
    out.items.forEach((i) => {
      expect(i.image).toBeNull();
      expect(i.link).toBeNull();
      expect(i.links).toEqual([]);
    });
    expect(out.links).toEqual([]);
    expect(out.images).toEqual([]);
  });

  it("collects every link and image once, in order", () => {
    const out = readBotAnswer(
      "See [A](https://a.example.com) and https://b.example.com, again [A](https://a.example.com). ![p](https://p.example.com/p.gif)",
    );
    expect(out.links.map((l) => l.url)).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
    expect(out.images).toEqual([
      { alt: "p", url: "https://p.example.com/p.gif" },
    ]);
  });

  it("trims trailing punctuation off bare URLs", () => {
    const out = readBotAnswer("Go to https://example.com/page.");
    expect(out.links[0].url).toBe("https://example.com/page");
  });
});

describe("readBotAnswer — tables", () => {
  const table = [
    "| Item | Amount | Link |",
    "|------|-------:|:----:|",
    "| Milk | 2 L | [Buy](https://shop.example.com/milk) |",
    "| Eggs | 12 | https://shop.example.com/eggs |",
    "| Flour ![f](https://img.example.com/f.png) | 1 kg | |",
  ].join("\n");

  it("reads headers and rows", () => {
    const out = readBotAnswer(table);
    expect(out.kind).toBe("table");
    expect(out.table.headers).toEqual(["Item", "Amount", "Link"]);
    expect(out.table.rows).toHaveLength(3);
    expect(out.table.rows[1]).toEqual([
      "Eggs",
      "12",
      "https://shop.example.com/eggs",
    ]);
  });

  it("maps rows to items by header name", () => {
    const out = readBotAnswer(table);
    expect(out.items[0]).toMatchObject({
      title: "Milk",
      detail: "Amount: 2 L",
      link: "https://shop.example.com/milk",
      image: null,
    });
    expect(out.items[1].link).toBe("https://shop.example.com/eggs");
    expect(out.items[2].title).toBe("Flour");
    expect(out.items[2].image).toBe("https://img.example.com/f.png");
    expect(out.items[2].link).toBeNull();
  });

  it("uses image and name columns, and the first column without a name column", () => {
    const out = readBotAnswer(
      "| Product | Photo | Price |\n|---|---|---|\n| Mug | https://i.example.com/mug.jpg | $5 |",
    );
    expect(out.items[0]).toMatchObject({
      title: "Mug",
      image: "https://i.example.com/mug.jpg",
      detail: "Price: $5",
    });
    const noName = readBotAnswer("| City | Temp |\n|---|---|\n| Oslo | 3°C |");
    expect(noName.items[0].title).toBe("Oslo");
    expect(noName.items[0].detail).toBe("Temp: 3°C");
  });

  it("handles escaped pipes in cells", () => {
    const out = readBotAnswer("| A | B |\n|---|---|\n| x \\| y | z |");
    expect(out.table.rows[0]).toEqual(["x | y", "z"]);
  });
});

describe("readBotAnswer — JSON", () => {
  it("reads a fenced JSON array of objects", () => {
    const out = readBotAnswer(
      [
        "Here you go:",
        "```json",
        '[{"name":"Milk","quantity":2,"image":"https://i.example.com/m.png","url":"https://s.example.com/m"},',
        ' {"name":"Eggs","qty":"12","price":"$3"}]',
        "```",
      ].join("\n"),
    );
    expect(out.kind).toBe("json");
    expect(Array.isArray(out.json)).toBe(true);
    expect(out.items[0]).toMatchObject({
      title: "Milk",
      detail: "Quantity: 2",
      image: "https://i.example.com/m.png",
      link: "https://s.example.com/m",
    });
    expect(out.items[1].detail).toBe("Qty: 12 · Price: $3");
  });

  it("reads a whole-text JSON object with one items array", () => {
    const out = readBotAnswer(
      JSON.stringify({
        store: "Corner shop",
        items: [
          { title: "Apples", amount: "1 kg", done: true },
          { title: "Pears", link: "javascript:alert(1)" },
        ],
      }),
    );
    expect(out.kind).toBe("json");
    expect(out.json.store).toBe("Corner shop");
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({
      title: "Apples",
      detail: "Amount: 1 kg",
      checked: true,
    });
    expect(out.items[1].link).toBeNull();
  });

  it("a JSON object with no array is kind json with no items", () => {
    const out = readBotAnswer('{"temperature": 21, "unit": "C"}');
    expect(out.kind).toBe("json");
    expect(out.json).toEqual({ temperature: 21, unit: "C" });
    expect(out.items).toEqual([]);
  });

  it("a JSON array of strings becomes items", () => {
    const out = readBotAnswer('["Milk", "Eggs https://i.example.com/e.png"]');
    expect(out.items.map((i) => i.title)).toEqual(["Milk", "Eggs"]);
    expect(out.items[1].image).toBe("https://i.example.com/e.png");
  });

  it("broken JSON falls back to text", () => {
    const out = readBotAnswer('{"name": "Milk", ');
    expect(out.kind).toBe("text");
    expect(out.json).toBeNull();
  });

  it("does not read list-looking lines inside code fences", () => {
    const out = readBotAnswer("```\n- not an item\n- nor this\n```");
    expect(out.kind).toBe("text");
    expect(out.items).toEqual([]);
  });
});

describe("readBotAnswer — sections", () => {
  it("splits headings into sections, each with its own shape", () => {
    const out = readBotAnswer(
      [
        "# Groceries",
        "## Fruit",
        "- Apples",
        "- Pears",
        "## Dairy",
        "- Milk",
        "- Cheese",
        "- Yogurt",
        "## Notes",
        "Shop before 6pm.",
      ].join("\n"),
    );
    expect(out.kind).toBe("list");
    expect(out.items).toHaveLength(5);
    expect(out.sections.map((s) => [s.heading, s.level, s.kind])).toEqual([
      ["Fruit", 2, "list"],
      ["Dairy", 2, "list"],
      ["Notes", 2, "text"],
    ]);
    expect(out.sections[1].items.map((i) => i.title)).toEqual([
      "Milk",
      "Cheese",
      "Yogurt",
    ]);
    expect(out.sections[2].text).toBe("Shop before 6pm.");
  });

  it("the largest structure wins the main kind", () => {
    const out = readBotAnswer(
      [
        "## Summary",
        "- One point",
        "## Data",
        "| Name | Score |",
        "|---|---|",
        "| A | 1 |",
        "| B | 2 |",
        "| C | 3 |",
      ].join("\n"),
    );
    expect(out.kind).toBe("table");
    expect(out.items.map((i) => i.title)).toEqual(["A", "B", "C"]);
    expect(out.sections[0].kind).toBe("list");
    expect(out.sections[1].kind).toBe("table");
  });

  it("no headings means no sections", () => {
    expect(readBotAnswer("- a\n- b").sections).toEqual([]);
  });
});

describe("readBotAnswer — text and bad input", () => {
  it("a plain paragraph is text", () => {
    const out = readBotAnswer(
      "  The weather today is sunny with a high of 21°C.  ",
    );
    expect(out).toEqual({
      kind: "text",
      items: [],
      table: null,
      json: null,
      sections: [],
      links: [],
      images: [],
      text: "The weather today is sunny with a high of 21°C.",
    });
  });

  it.each([null, undefined, 42, {}, [], true])(
    "never throws on %p",
    (input) => {
      const out = readBotAnswer(input);
      expect(out.kind).toBe("text");
      expect(out.text).toBe("");
      expect(out.items).toEqual([]);
      expect(out.sections).toEqual([]);
    },
  );

  it("empty and whitespace-only strings are empty text", () => {
    expect(readBotAnswer("").text).toBe("");
    expect(readBotAnswer("   \n  ").kind).toBe("text");
  });

  it("reads an 8 KB list in full", () => {
    const lines = [];
    let size = 0;
    let n = 0;
    while (size < 8 * 1024) {
      const line = `- ![p${n}](https://img.example.com/${n}.png) **Item ${n}** — [Buy](https://shop.example.com/${n}) https://x.example.com/${n}`;
      lines.push(line);
      size += line.length + 1;
      n++;
    }
    const out = readBotAnswer(lines.join("\n"));
    expect(out.kind).toBe("list");
    expect(out.items).toHaveLength(n);
    expect(out.items[n - 1].title).toBe(`Item ${n - 1}`);
  });
});

// Speed guards. Limits are ~10x+ the measured time on their own, so they
// hold under a loaded parallel run but still catch a quadratic scan (the
// 40 000 "[" case alone took ~3.7 s before the scans were made linear).
describe("readBotAnswer — stays linear on hostile input", () => {
  const timed = (text) => {
    const start = Date.now();
    const out = readBotAnswer(text);
    return { out, ms: Date.now() - start };
  };

  it('40 000 "[" in a row', () => {
    const { out, ms } = timed("[".repeat(40000));
    expect(out.kind).toBe("text");
    expect(ms).toBeLessThan(500);
  });

  it("many lines of unclosed brackets, stars, fences and pipes", () => {
    const text = [
      ("[".repeat(1999) + "\n").repeat(20),
      ("- " + "[a".repeat(999) + "\n").repeat(100),
      "![](".repeat(20000),
      "**a".repeat(30000),
      "~~".repeat(40000),
      "```\n".repeat(5000),
      "# " + " ".repeat(50000) + "x",
      "- " + "-".repeat(50000) + "x",
      "https://a.example.com/" + ".".repeat(50000) + "x",
      "|".repeat(30000) + "\n|---|",
    ].join("\n");
    const { ms } = timed(text);
    expect(ms).toBeLessThan(1000);
  });

  it("a 200 KB mixed answer (sections, lists, tables, links)", () => {
    const parts = [];
    let size = 0;
    let n = 0;
    while (size < 200 * 1024) {
      const chunk = [
        `## Section ${n}`,
        `Intro ${n} with https://ex.example.com/${n} and *emphasis*.`,
        `- ![p${n}](https://img.example.com/${n}.png) **Item ${n}** — [Buy](https://shop.example.com/${n})`,
        `- [ ] task ${n}`,
        `  - nested ${n}`,
        "| Item | Amount | Link |",
        "|---|---|---|",
        `| Thing ${n} | ${n} | [Buy](https://s.example.com/${n}) |`,
        "",
      ].join("\n");
      parts.push(chunk);
      size += chunk.length;
      n++;
    }
    const { out, ms } = timed(parts.join("\n"));
    expect(out.sections.length).toBeGreaterThan(100);
    expect(out.links.length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(1500);
  });
});

describe("readBotAnswer — look-alike hosts (TD-009 review)", () => {
  it("drops links whose host isn't plain ASCII", () => {
    const out = readBotAnswer(
      "- [Bank](https://bank.example.com) and [Bad](https://bаnk.example.com) and [Wide](https://example．com/x)",
    );
    expect(out.links.map((l) => l.url)).toEqual(["https://bank.example.com"]);
  });
});
