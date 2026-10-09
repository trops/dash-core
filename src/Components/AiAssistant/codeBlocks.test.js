/**
 * collapseCodeBlocks — ChatCore's `hideCodeBlocks` option. The Widget
 * Builder shows the code in its own Code tab, so the chat replaces each
 * fenced block with a one-line note instead of a wall of code.
 */
import { collapseCodeBlocks } from "./codeBlocks";

const NOTE = "Code updated — see the Code tab.";

describe("collapseCodeBlocks", () => {
  it("replaces a fenced block with the note and keeps the prose", () => {
    const text =
      "Here's your widget:\n\n```jsx\nexport default function A() {}\n```\n\nClick Install.";
    const out = collapseCodeBlocks(text, NOTE);
    expect(out).not.toMatch(/export default/);
    expect(out).toContain("Here's your widget:");
    expect(out).toContain(`_${NOTE}_`);
    expect(out).toContain("Click Install.");
  });

  it("shows the note once for back-to-back blocks", () => {
    const text = "A\n\n```jsx\none\n```\n\n```js\ntwo\n```\n\nB";
    const out = collapseCodeBlocks(text, NOTE);
    expect(out.split(NOTE)).toHaveLength(2);
    expect(out).toContain("A");
    expect(out).toContain("B");
  });

  it("drops the File: marker line that labels a block", () => {
    const text = "File: widgets/Clock.js\n```jsx\ncode\n```";
    const out = collapseCodeBlocks(text, NOTE);
    expect(out).not.toMatch(/File:/);
    expect(out).toContain(NOTE);
  });

  it("hides a block that is still being written", () => {
    const out = collapseCodeBlocks(
      "Writing it now:\n\n```jsx\nexport def",
      NOTE,
    );
    expect(out).not.toMatch(/export def/);
    expect(out).toContain("Writing it now:");
    expect(out).toContain("_Writing code…_");
  });

  it("leaves text without code alone", () => {
    expect(collapseCodeBlocks("Just words, `inline` ok.", NOTE)).toBe(
      "Just words, `inline` ok.",
    );
    expect(collapseCodeBlocks("", NOTE)).toBe("");
    expect(collapseCodeBlocks(null, NOTE)).toBe(null);
  });

  it("plain mode skips the Markdown italics (streaming view)", () => {
    const out = collapseCodeBlocks("A\n\n```jsx\nx", NOTE, { plain: true });
    expect(out).toContain("Writing code…");
    expect(out).not.toMatch(/_Writing/);
    const done = collapseCodeBlocks("```js\nx\n```", NOTE, { plain: true });
    expect(done).toBe(NOTE);
  });
});
