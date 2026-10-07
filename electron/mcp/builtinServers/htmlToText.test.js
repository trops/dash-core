/**
 * htmlToText.test.js — readable text from a web page for fetch_url.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { htmlToText } = require("./htmlToText");

describe("htmlToText", () => {
  it("drops scripts, styles and markup, keeping the readable text", () => {
    const out = htmlToText(
      "<html><head><title>Shoes</title><style>p{color:red}</style>" +
        "<script>alert(1)</script></head><body><h1>Red shoe</h1>" +
        "<p>Size 9 &amp; 10.</p></body></html>",
    );
    assert.equal(out, "# Shoes\n\n# Red shoe\n\nSize 9 & 10.");
  });

  it("keeps link targets and list items", () => {
    const out = htmlToText(
      '<ul><li><a href="https://x.test/a">First</a></li><li>Second</li></ul>',
    );
    assert.equal(out, "- [First](https://x.test/a)\n- Second");
  });

  it("decodes numeric and named entities and collapses whitespace", () => {
    assert.equal(
      htmlToText(
        "<p>a&nbsp;&nbsp;b   &#39;c&#x27; &quot;d&quot; &lt;e&gt;</p>",
      ),
      "a b 'c' \"d\" <e>",
    );
  });

  it("turns <br> and block ends into line breaks", () => {
    assert.equal(
      htmlToText("<div>one<br>two</div><div>three</div>"),
      "one\ntwo\n\nthree",
    );
  });
});
