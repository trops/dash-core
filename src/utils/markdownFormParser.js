/**
 * markdownFormParser.js
 *
 * Generic markdown-to-structured-blocks parser with type detection.
 * No React, no widget-specific logic — pure utility.
 *
 * parse(markdown) → Block[]
 * serialize(blocks) → markdown string
 *
 * Block types: heading, table, paragraph, list, blockquote, comment, hr, empty
 * Table columns auto-detect input types: enum, text, longtext, date, rownum
 */

/**
 * Detect if a string is a slash-separated enum pattern.
 * Matches: "H/M/L", "Crit/High/Med/Low", "Champion / EB / Technical"
 * Returns array of options or null.
 */
function parseEnumPattern(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.includes("/")) return null;
  const parts = trimmed
    .split(/\s*\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 8) return null;
  if (parts.some((p) => p.length > 30 || p.includes(". "))) return null;
  return parts;
}

/**
 * Detect column type from header name and cell values.
 */
function detectColumnType(header, cellValues) {
  const h = header.trim().toLowerCase();

  // Row number column
  if (h === "#" || h === "no" || h === "no.") {
    return { type: "rownum" };
  }

  // Check if any cell has an enum pattern (template placeholders)
  for (const val of cellValues) {
    const options = parseEnumPattern(val);
    if (options) {
      // Include all unique existing cell values as valid options
      const allOptions = new Set(options);
      for (const v of cellValues) {
        const trimmed = v.trim();
        if (trimmed) allOptions.add(trimmed);
      }
      return { type: "enum", options: [...allOptions] };
    }
  }

  // Date columns — by header name
  if (h === "date" || h === "updated" || h === "due" || h === "created") {
    return { type: "date" };
  }

  // Date columns — by value pattern
  const datePattern = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
  const nonEmptyValues = cellValues.filter((v) => v.trim());
  if (
    nonEmptyValues.length > 0 &&
    nonEmptyValues.every((v) => datePattern.test(v.trim()))
  ) {
    return { type: "date" };
  }

  // Long text detection
  if (nonEmptyValues.some((v) => v.length > 80)) {
    return { type: "longtext" };
  }

  return { type: "text" };
}

/**
 * Parse a markdown string into an array of typed blocks.
 *
 * @param {string} markdown - Raw markdown string
 * @returns {Array<Object>} Array of block objects
 */
export function parse(markdown) {
  if (!markdown) return [];

  const lines = markdown.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // HTML comment (single or multi-line)
    if (line.trim().startsWith("<!--")) {
      let commentText = line;
      if (!line.includes("-->")) {
        i++;
        while (i < lines.length && !lines[i].includes("-->")) {
          commentText += "\n" + lines[i];
          i++;
        }
        if (i < lines.length) {
          commentText += "\n" + lines[i];
        }
      }
      blocks.push({ type: "comment", text: commentText });
      i++;
      continue;
    }

    // Horizontal rule
    if (line.trim() === "---") {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // Table — starts with | and next line is separator
    if (
      line.trim().startsWith("|") &&
      i + 1 < lines.length &&
      lines[i + 1].match(/^\|[\s-:|]+\|$/)
    ) {
      const headerCells = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      i += 2; // Skip header + separator

      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i]
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        rows.push(cells);
        i++;
      }

      const columnTypes = headerCells.map((header, colIdx) => {
        const colValues = rows.map((row) => row[colIdx] || "");
        return detectColumnType(header, colValues);
      });

      blocks.push({
        type: "table",
        columns: headerCells,
        rows,
        columnTypes,
      });
      continue;
    }

    // List items
    if (line.match(/^[-*]\s+/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      let quoteText = line.slice(2);
      i++;
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteText += "\n" + lines[i].slice(2);
        i++;
      }
      blocks.push({ type: "blockquote", text: quoteText });
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      blocks.push({ type: "empty" });
      i++;
      continue;
    }

    // Paragraph
    let paraText = line;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("#") &&
      !lines[i].trim().startsWith("|") &&
      !lines[i].trim().startsWith("<!--") &&
      !lines[i].trim().startsWith("> ") &&
      !lines[i].match(/^[-*]\s+/) &&
      lines[i].trim() !== "---"
    ) {
      paraText += "\n" + lines[i];
      i++;
    }
    blocks.push({ type: "paragraph", text: paraText });
  }

  return blocks;
}

/**
 * Serialize a block array back to a markdown string.
 *
 * @param {Array<Object>} blocks - Array of block objects from parse()
 * @returns {string} Markdown string
 */
export function serialize(blocks) {
  const parts = [];

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        parts.push("#".repeat(block.level) + " " + block.text);
        break;

      case "table": {
        parts.push("| " + block.columns.join(" | ") + " |");
        parts.push("| " + block.columns.map(() => "------").join(" | ") + " |");
        for (const row of block.rows) {
          const paddedRow = block.columns.map((_, idx) => row[idx] || "");
          parts.push("| " + paddedRow.join(" | ") + " |");
        }
        break;
      }

      case "list":
        for (const item of block.items) {
          parts.push("- " + item);
        }
        break;

      case "blockquote":
        for (const line of block.text.split("\n")) {
          parts.push("> " + line);
        }
        break;

      case "comment":
        parts.push(block.text);
        break;

      case "paragraph":
        parts.push(block.text);
        break;

      case "hr":
        parts.push("---");
        break;

      case "empty":
        parts.push("");
        break;

      default:
        if (block.text) parts.push(block.text);
        break;
    }
  }

  return parts.join("\n");
}
