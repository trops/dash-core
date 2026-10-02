/**
 * safeMarkdown.test.js — AI replies are Markdown that can quote untrusted
 * content (emails, web pages). Rendered to HTML for display, they must never
 * run script in the app window.
 */
import { renderSafeMarkdown } from "./safeMarkdown";

const html = (md) => renderSafeMarkdown(md);

describe("renderSafeMarkdown — strips anything that can run", () => {
  it("removes <script> elements", () => {
    const out = html("Hi <script>window.pwned = 1</script> there");
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/pwned/);
    expect(out).toMatch(/Hi/);
  });

  it("removes event-handler attributes", () => {
    const out = html('<img src="x" onerror="document.title=\'pwned\'">');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/pwned/);
  });

  it("removes javascript: and data: links", () => {
    expect(html("[click](javascript:alert(1))")).not.toMatch(/javascript:/i);
    expect(html('<a href="data:text/html,<b>x</b>">x</a>')).not.toMatch(
      /href="data:/i,
    );
  });

  it("removes iframes, objects, embeds, forms, styles and inline style", () => {
    const out = html(
      '<iframe src="https://evil"></iframe><object data="x"></object>' +
        '<embed src="x"><form action="https://evil"><input></form>' +
        '<style>body{display:none}</style><p style="position:fixed">x</p>',
    );
    for (const bad of [
      /<iframe/i,
      /<object/i,
      /<embed/i,
      /<form/i,
      /<style/i,
      /style=/i,
    ]) {
      expect(out).not.toMatch(bad);
    }
  });

  it("returns an empty string for empty input", () => {
    expect(html("")).toBe("");
    expect(html(null)).toBe("");
  });
});

describe("renderSafeMarkdown — keeps normal Markdown", () => {
  it("renders headings, emphasis, lists, code and tables", () => {
    const out = html(
      "## Title\n\n**bold** and `code`\n\n- one\n- two\n\n" +
        "| a | b |\n|---|---|\n| 1 | 2 |\n\n```\nconst x = 1;\n```",
    );
    expect(out).toMatch(/<h2[^>]*>Title<\/h2>/);
    expect(out).toMatch(/<strong>bold<\/strong>/);
    expect(out).toMatch(/<code>code<\/code>/);
    expect(out).toMatch(/<li>one<\/li>/);
    expect(out).toMatch(/<table>/);
    expect(out).toMatch(/const x = 1;/);
  });

  it("keeps https links, opening safely", () => {
    const out = html("[docs](https://example.com)");
    expect(out).toMatch(/href="https:\/\/example\.com"/);
    expect(out).toMatch(/rel="noopener noreferrer"/);
  });

  it("keeps line breaks (breaks: true)", () => {
    expect(html("line one\nline two")).toMatch(/<br>/);
  });
});
