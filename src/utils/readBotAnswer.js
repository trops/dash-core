/**
 * readBotAnswer.js — reads a bot's final answer (plain text, often Markdown)
 * and returns one normalized shape a widget can render, whatever format the
 * bot chose: bullet / numbered / task lists, GitHub pipe tables, JSON (fenced
 * or bare), and Markdown headings (as sections).
 *
 *   readBotAnswer(text) → {
 *     kind: "list" | "table" | "json" | "text",
 *     items: [{ text, title, detail, image, link, links, checked }],
 *     table: { headers, rows } | null,
 *     json: <parsed value> | null,
 *     sections: [{ heading, level, kind, items, table, text }],
 *     links: [{ text, url }],
 *     images: [{ alt, url }],
 *     text: <original text, trimmed>,
 *   }
 *
 * Pure, dependency-free, never throws. Only http(s) URLs are ever returned
 * as links or images (javascript:, data:, file:, … are dropped).
 */

const MAX_INPUT = 200000;
// Inline link/image parsing only looks at the first LINE_CAP chars of a
// line; the rest is kept as plain text.
const LINE_CAP = 2000;

// Every scan below is linear: labels/targets are bounded and cannot contain
// the bracket that starts the next attempt, so a run like "[[[[…" fails at
// each "[" in O(1) instead of re-scanning the line.
const IMG_MD =
  /!\[([^[\]\n]{0,500})\]\([ \t]{0,10}<?([^\s()<>[\]]{1,2000})>?(?:[ \t]{1,10}["'][^"'\n]{0,300}["'])?[ \t]{0,10}\)/g;
const LINK_MD =
  /\[([^[\]\n]{0,500})\]\([ \t]{0,10}<?([^\s)<>[\]]{1,2000})>?(?:[ \t]{1,10}["'][^"'\n]{0,300}["'])?[ \t]{0,10}\)/g;
const AUTOLINK = /<(https?:\/\/[^\s<>]+)>/gi;
const BARE_URL = /https?:\/\/[^\s<>()[\]"'`]+/gi;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const CTA_TEXT =
  /^(buy|shop|order|view|see|open|visit|get|read|learn|more|details|link|here|source|website|site|page|store|click|check|available|purchase|amazon)\b/i;

const LIST_LINE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;
const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function emptyResult(text) {
  return {
    kind: "text",
    items: [],
    table: null,
    json: null,
    sections: [],
    links: [],
    images: [],
    text,
  };
}

/** Returns the URL if it is a well-formed http(s) URL, else null. */
function safeUrl(raw) {
  if (typeof raw !== "string") return null;
  let url = raw.trim();
  let end = url.length;
  while (end > 0 && ".,;:!?".includes(url[end - 1])) end--;
  url = url.slice(0, end);
  // http(s) only, a plain host (no user:pass@ tricks), optional port, then
  // any non-space path. A regex rather than `new URL` — it is the protocol
  // check that matters, and `new URL` is slow under jsdom.
  if (url.length > 2048) return null;
  // ASCII hosts only (punycode for others): a look-alike character can't
  // make the link shown differ from where it goes.
  if (!/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?([/?#][^\s<>"]*)?$/i.test(url)) {
    return null;
  }
  return url;
}

function isImageUrl(url) {
  const path = String(url).split(/[?#]/)[0];
  return IMAGE_EXT.test(path);
}

function stripEmphasis(s) {
  return String(s)
    .replace(/\*\*([^*\n]{1,500})\*\*/g, "$1")
    .replace(/__([^_\n]{1,500})__/g, "$1")
    .replace(/~~([^~\n]{1,500})~~/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]*?[^\s*])\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_(?!\s)([^_\n]*?[^\s_])_(?!\w)/g, "$1$2")
    .replace(/\*\*/g, "");
}

function squash(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

const SEPARATORS = " \t\n\r-–—:|·,•";

function trimSeparators(s) {
  const str = String(s);
  let start = 0;
  let end = str.length;
  while (start < end && SEPARATORS.includes(str[start])) start++;
  while (end > start && SEPARATORS.includes(str[end - 1])) end--;
  return str.slice(start, end);
}

/** Drops a heading's optional closing hashes ("## Title ##"). */
function headingText(raw) {
  let s = String(raw).trim();
  let end = s.length;
  while (end > 0 && s[end - 1] === "#") end--;
  if (end < s.length && (end === 0 || /\s/.test(s[end - 1]))) {
    s = s.slice(0, end);
  }
  return s.trim();
}

function pushUnique(list, entry) {
  if (!list.some((e) => e.url === entry.url)) list.push(entry);
}

/**
 * Parses one line of inline Markdown: pulls out images and links and
 * returns the cleaned text plus a title (text minus image/link syntax,
 * call-to-action link text and bare URLs).
 */
function parseInline(raw) {
  const images = [];
  const links = [];
  let s = String(raw == null ? "" : raw);
  let tail = "";
  if (s.length > LINE_CAP) {
    tail = squash(s.slice(LINE_CAP));
    s = s.slice(0, LINE_CAP);
  }

  s = s.replace(IMG_MD, (m, alt, url) => {
    const u = safeUrl(url);
    if (u) pushUnique(images, { alt: squash(stripEmphasis(alt)), url: u });
    return " ";
  });

  // Two renderings of the remaining links: one for `text`, one for `title`.
  let forText = s;
  let forTitle = s;
  forText = forText.replace(LINK_MD, (m, label, url) => {
    const u = safeUrl(url);
    const t = squash(stripEmphasis(label));
    if (u && isImageUrl(u)) {
      pushUnique(images, { alt: t, url: u });
    } else if (u) {
      pushUnique(links, { text: t || u, url: u });
    }
    return t ? ` ${t} ` : " ";
  });
  forTitle = forTitle.replace(LINK_MD, (m, label, url) => {
    const t = squash(stripEmphasis(label));
    if (!t || CTA_TEXT.test(t) || /^https?:\/\//i.test(t)) return " ";
    return ` ${t} `;
  });

  forText = forText.replace(AUTOLINK, "$1");
  forTitle = forTitle.replace(AUTOLINK, " ");

  const bare = forText.match(BARE_URL) || [];
  for (const b of bare) {
    const u = safeUrl(b);
    if (!u) continue;
    if (isImageUrl(u)) pushUnique(images, { alt: "", url: u });
    else pushUnique(links, { text: u, url: u });
  }
  forTitle = forTitle.replace(BARE_URL, " ");

  const text = squash(stripEmphasis(forText) + " " + tail);
  let title = trimSeparators(squash(stripEmphasis(forTitle) + " " + tail));
  if (!title && links.length) title = links[0].text;
  if (!title && images.length) title = images[0].alt;

  return { text, title, images, links };
}

function makeItem(content, nestedLines, checked) {
  const main = parseInline(content);
  const images = main.images.slice();
  const links = main.links.slice();
  const details = [];
  for (const line of nestedLines) {
    const nested = parseInline(line);
    if (nested.text) details.push(nested.text);
    nested.images.forEach((img) => pushUnique(images, img));
    nested.links.forEach((l) => pushUnique(links, l));
  }
  return {
    text: main.text,
    title: main.title,
    detail: details.join(" · "),
    image: images.length ? images[0].url : null,
    link: links.length ? links[0].url : null,
    links,
    checked,
  };
}

function stripListMarker(content) {
  const m = LIST_LINE.exec(content);
  let s = m ? m[3] : content.trim();
  const task = TASK.exec(s);
  if (task) s = task[2];
  return s;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines, i) {
  const line = lines[i];
  const next = lines[i + 1];
  return (
    typeof next === "string" &&
    line.includes("|") &&
    next.includes("-") &&
    (next.includes("|") || line.trim().startsWith("|")) &&
    TABLE_SEP.test(next)
  );
}

/** Walks the lines (outside code fences) and collects lists, tables. */
function parseBlocks(lines) {
  const items = [];
  const tables = [];
  let inFence = false;
  let current = null; // { content, nested, checked }
  let baseIndent = null;
  let lastBlank = false;

  const flush = () => {
    if (current) {
      items.push(makeItem(current.content, current.nested, current.checked));
      current = null;
    }
  };
  const endList = () => {
    flush();
    baseIndent = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      inFence = !inFence;
      endList();
      continue;
    }
    if (inFence) continue;
    if (!line.trim()) {
      lastBlank = true;
      continue;
    }
    if (HEADING.test(line) || HR.test(line)) {
      endList();
      lastBlank = false;
      continue;
    }
    if (isTableStart(lines, i)) {
      endList();
      const headers = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const cells = splitRow(lines[i]);
        while (cells.length < headers.length) cells.push("");
        rows.push(cells.slice(0, headers.length));
        i++;
      }
      i--;
      tables.push({ headers, rows });
      lastBlank = false;
      continue;
    }
    const indent = (/^\s*/.exec(line)[0] || "").replace(/\t/g, "    ").length;
    const m = LIST_LINE.exec(line);
    if (m) {
      if (baseIndent === null) baseIndent = indent;
      if (current && indent >= baseIndent + 2) {
        current.nested.push(stripListMarker(line));
      } else {
        flush();
        if (indent < baseIndent) baseIndent = indent;
        let content = m[3];
        let checked = null;
        const task = TASK.exec(content);
        if (task) {
          checked = task[1] !== " ";
          content = task[2];
        }
        current = { content, nested: [], checked };
      }
    } else if (current && (indent >= 2 || !lastBlank)) {
      current.nested.push(line.trim());
    } else {
      endList();
    }
    lastBlank = false;
  }
  endList();
  return { items, tables };
}

function classifyHeader(h) {
  const k = String(h).toLowerCase();
  if (/(image|picture|photo|thumbnail|thumb|\bimg\b|\bpic\b)/.test(k)) {
    return "image";
  }
  if (/(link|url|\bbuy\b|source|href|\bstore\b|\bshop\b|website)/.test(k)) {
    return "link";
  }
  if (/(name|\bitems?\b|title|product|\bthing\b)/.test(k)) return "title";
  return "other";
}

function tableToItems(table) {
  const roles = table.headers.map(classifyHeader);
  let titleCol = roles.indexOf("title");
  if (titleCol === -1) titleCol = roles.indexOf("other");
  return table.rows.map((cells) => {
    const parsed = cells.map((c) => parseInline(c));
    const images = [];
    const links = [];
    let image = null;
    let link = null;
    const details = [];
    parsed.forEach((p, col) => {
      p.images.forEach((img) => pushUnique(images, img));
      p.links.forEach((l) => pushUnique(links, l));
      const role = roles[col];
      if (role === "image" && !image) {
        image = p.images.length
          ? p.images[0].url
          : p.links.length
            ? p.links[0].url
            : null;
      } else if (role === "link" && !link) {
        link = p.links.length ? p.links[0].url : null;
      } else if (col !== titleCol && role !== "image" && role !== "link") {
        if (p.text) details.push(`${squash(table.headers[col])}: ${p.text}`);
      }
    });
    if (!image && images.length) image = images[0].url;
    if (!link) {
      const first = links.find((l) => l.url !== image);
      link = first ? first.url : null;
    }
    const title =
      titleCol >= 0 && parsed[titleCol] ? parsed[titleCol].title : "";
    return {
      text: parsed
        .map((p) => p.text)
        .filter(Boolean)
        .join(" · "),
      title,
      detail: details.join(" · "),
      image,
      link,
      links: links.filter((l) => l.url !== image),
      checked: null,
    };
  });
}

function humanKey(k) {
  const s = String(k)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const JSON_DETAIL = /^(quantity|amount|qty|price|cost|count|unit|units|size)$/i;
const JSON_DESC = /^(description|desc|details?|notes?|summary)$/i;
const JSON_CHECK = /^(done|checked|completed|complete|purchased|bought)$/i;

function jsonObjectToItem(obj) {
  let title = "";
  let image = null;
  let link = null;
  let checked = null;
  const links = [];
  const descs = [];
  const details = [];
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const k = key.toLowerCase();
    if (JSON_CHECK.test(k) && typeof val === "boolean") {
      checked = val;
    } else if (/(image|picture|photo|thumbnail|img)/.test(k)) {
      const u = safeUrl(typeof val === "string" ? val : "");
      if (u && !image) image = u;
    } else if (/(url|link|href)/.test(k) || k === "buy" || k === "source") {
      const u = safeUrl(typeof val === "string" ? val : "");
      if (u && isImageUrl(u) && !image) image = u;
      else if (u) {
        pushUnique(links, { text: u, url: u });
        if (!link) link = u;
      }
    } else if (
      !title &&
      /^(name|title|item|product|label)$|name$|title$/.test(k) &&
      (typeof val === "string" || typeof val === "number")
    ) {
      title = squash(stripEmphasis(String(val)));
    } else if (JSON_DESC.test(k) && typeof val === "string") {
      descs.push(squash(val));
    } else if (
      JSON_DETAIL.test(k) &&
      (typeof val === "string" || typeof val === "number")
    ) {
      details.push(`${humanKey(key)}: ${val}`);
    }
  }
  const detail = descs.concat(details).filter(Boolean).join(" · ");
  return {
    text: [title, detail].filter(Boolean).join(" · "),
    title,
    detail,
    image,
    link,
    links,
    checked,
  };
}

function jsonToItems(value) {
  let arr = null;
  if (Array.isArray(value)) arr = value;
  else if (value && typeof value === "object") {
    const arrays = Object.keys(value).filter((k) => Array.isArray(value[k]));
    if (arrays.length === 1) arr = value[arrays[0]];
  }
  if (!arr) return [];
  const items = [];
  for (const el of arr) {
    if (el && typeof el === "object" && !Array.isArray(el)) {
      items.push(jsonObjectToItem(el));
    } else if (typeof el === "string" || typeof el === "number") {
      items.push(makeItem(String(el), [], null));
    }
  }
  return items;
}

function findJson(text) {
  const t = text.trim();
  if (/^[[{]/.test(t) && /[\]}]$/.test(t)) {
    try {
      return { value: JSON.parse(t), whole: true };
    } catch (e) {
      // not JSON; fall through
    }
  }
  // Line-based fence walk (a regex over the whole text re-scans to the end
  // for every unclosed ``` and goes quadratic).
  const blocks = [];
  let open = null;
  for (const line of text.split(/\r?\n/)) {
    const t2 = line.trim();
    if (open) {
      if (t2.startsWith("```")) {
        blocks.push(open);
        open = null;
      } else {
        open.lines.push(line);
      }
    } else if (t2.startsWith("```")) {
      const lang = (/^```[ \t]*([a-zA-Z]*)/.exec(t2) || [])[1] || "";
      open = { lang: lang.toLowerCase(), lines: [] };
    }
  }
  let fallback = null;
  for (const block of blocks) {
    const lang = block.lang;
    if (lang !== "json" && lang !== "" && lang !== "javascript") continue;
    const body = block.lines.join("\n").trim();
    if (!/^[[{]/.test(body)) continue;
    try {
      const value = JSON.parse(body);
      if (lang === "json") return { value, whole: false };
      if (!fallback) fallback = { value, whole: false };
    } catch (e) {
      // bad block; keep looking
    }
  }
  return fallback;
}

/** Reads one body of text (whole answer or one section). */
function analyze(text) {
  const found = findJson(text);
  const json = found ? found.value : null;
  const jsonItems = found ? jsonToItems(json) : [];
  const blocks =
    found && found.whole
      ? { items: [], tables: [] }
      : parseBlocks(text.split(/\r?\n/));

  let table = null;
  for (const tb of blocks.tables) {
    if (!table || tb.rows.length > table.rows.length) table = tb;
  }
  const tableItems = table ? tableToItems(table) : [];

  const candidates = [
    { kind: "json", items: jsonItems },
    { kind: "table", items: tableItems },
    { kind: "list", items: blocks.items },
  ];
  let best = null;
  for (const c of candidates) {
    if (c.items.length && (!best || c.items.length > best.items.length)) {
      best = c;
    }
  }
  if (!best) {
    best = json !== null ? { kind: "json", items: [] } : null;
    if (!best && table) best = { kind: "table", items: [] };
  }
  return {
    kind: best ? best.kind : "text",
    items: best ? best.items : [],
    table,
    json,
  };
}

function splitSections(lines) {
  const sections = [];
  let current = null;
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;
    const h = !inFence && HEADING.exec(line);
    if (h) {
      current = { heading: headingText(h[2]), level: h[1].length, lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

function collectLinks(text) {
  const links = [];
  const images = [];
  const seenLinks = new Set();
  const seenImages = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!/http/i.test(line)) continue;
    const p = parseInline(line);
    for (const l of p.links) {
      if (!seenLinks.has(l.url)) {
        seenLinks.add(l.url);
        links.push(l);
      }
    }
    for (const img of p.images) {
      if (!seenImages.has(img.url)) {
        seenImages.add(img.url);
        images.push(img);
      }
    }
  }
  return { links, images };
}

/**
 * Reads a bot's answer into a normalized, render-ready shape.
 * @param {string} input the bot's final answer
 * @returns {{kind: string, items: Array, table: object|null, json: any,
 *   sections: Array, links: Array, images: Array, text: string}}
 */
export function readBotAnswer(input) {
  if (typeof input !== "string") return emptyResult("");
  try {
    const text = input.trim();
    if (!text) return emptyResult("");
    const body = text.length > MAX_INPUT ? text.slice(0, MAX_INPUT) : text;

    const main = analyze(body);
    const lines = body.split(/\r?\n/);
    const sections = splitSections(lines)
      .map((sec) => {
        const secText = sec.lines.join("\n").trim();
        if (!secText) return null;
        const a = analyze(secText);
        return {
          heading: squash(stripEmphasis(parseInline(sec.heading).text)),
          level: sec.level,
          kind: a.kind,
          items: a.items,
          table: a.table,
          text: secText,
        };
      })
      .filter(Boolean);
    const { links, images } = collectLinks(body);

    return {
      kind: main.kind,
      items: main.items,
      table: main.table,
      json: main.json,
      sections,
      links,
      images,
      text,
    };
  } catch (e) {
    return emptyResult(typeof input === "string" ? input.trim() : "");
  }
}
