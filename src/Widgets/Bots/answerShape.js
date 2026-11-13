/**
 * answerShape — a bot's answer read as its structure, for the Bot results
 * widget (approved mockup "Bot widgets that look like Dash"): the line that
 * leads the list ("7 unread — 3 that matter"), one item per list entry (who
 * or what, the gist, the action asked for), headings and notes between them
 * kept where they were, and what follows. Any bot that answers in a list
 * gets rows; a short answer is said large; anything else stays text. The
 * whole answer is always kept (`paragraphs`). Pure.
 */

// A list entry, and how far it's indented (a nested one joins its parent).
const ITEM = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
// "Action: reply" — only where a sentence or clause starts, never mid-way.
const ACTION_AT =
  /(?:^|[.;!?]\s+|\s[—–-]\s+)(?:action(?:\s+needed)?|to do|next step)\s*:\s*(.+?)\s*\.?\s*$/i;
const ACTION_PAREN =
  /\s*\((?:action(?:\s+needed)?|to do|next step)\s*:\s*([^)]+)\)\s*/i;
// Longer than this, it's words, not a badge.
const ACTION_MAX = 40;
// Short enough to say large, on its own.
const SHORT = 200;
// A bot telling what it's about to do, not what it found.
const NARRATION =
  /^(?:i['’]ll|i will|i['’]m|i am|let me|searching|checking|looking|reading|fetching|first,|ok(?:ay)?[,.]|sure[,.])/i;
// Email subject prefixes: "Re: Invoice 443" is one title.
const PREFIX = /^(?:re|fwd?|fw|aw|sv)$/i;

/** Markdown marks and headings off; the words kept. */
function plain(line) {
  return String(line || "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,:;!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Where the title ends: a dash first; else a colon that isn't "Re:". */
function splitTitle(text) {
  const dash = /\s+[—–]\s+|\s+-\s+/.exec(text);
  if (dash && dash.index > 0 && dash.index <= 80) {
    return [text.slice(0, dash.index), text.slice(dash.index + dash[0].length)];
  }
  const re = /:\s+/g;
  let m;
  while ((m = re.exec(text)) && m.index <= 60) {
    const before = text.slice(0, m.index);
    if (PREFIX.test(before.trim().split(/\s+/).pop() || "")) continue;
    return [before, text.slice(m.index + m[0].length)];
  }
  return null;
}

/**
 * One list entry: its title (a bold lead, or what comes before the first
 * " — " / ": "), the gist, and the action it asks for.
 */
export function itemOf(raw) {
  const text = String(raw || "").trim();
  let title = "";
  let rest = text;
  const bold = /^\*\*(.+?)\*\*\s*(?:[:—–-]\s*)?(.*)$/.exec(text);
  if (bold) {
    title = plain(bold[1])
      .replace(/[:—–-]\s*$/, "")
      .trim();
    rest = bold[2];
  } else {
    const flat = plain(text);
    const split = splitTitle(flat);
    if (split) {
      title = split[0].trim();
      rest = split[1];
    } else {
      rest = flat;
    }
  }
  let gist = plain(rest);
  let action = "";
  const p = ACTION_PAREN.exec(gist);
  if (p && p[1].trim().length <= ACTION_MAX) {
    action = capital(p[1].trim());
    gist =
      `${gist.slice(0, p.index)} ${gist.slice(p.index + p[0].length)}`.trim();
  } else {
    const a = ACTION_AT.exec(gist);
    const said = a ? a[1].trim().replace(/[.;,]+$/, "") : "";
    if (a && said && said.length <= ACTION_MAX) {
      action = capital(said);
      // Keep the sentence's own full stop.
      const cut = gist.slice(0, a.index + (/^[.;!?]/.test(a[0]) ? 1 : 0));
      gist = cut.trim();
    }
  }
  gist = gist.replace(/\s*[—–-]\s*$/, "").trim();
  if (!title) {
    title = gist;
    gist = "";
  }
  return { title, gist, action };
}

/**
 * @param {string} answer
 * @returns {{ kind: "list", lead, items, tail, paragraphs }
 *   | { kind: "short", text, paragraphs } | { kind: "text", paragraphs }
 *   | { kind: "none", paragraphs }}
 *   items: [{ title, gist, action } | { section } | { note }] in order
 */
export function answerShape(answer) {
  const lines = String(answer || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  // Paragraphs, headings and list entries, in order.
  const blocks = [];
  let para = [];
  const endPara = () => {
    if (para.length) blocks.push({ text: para.join(" ") });
    para = [];
  };
  const lastItem = () => {
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      if (blocks[i].item !== undefined) return blocks[i];
      if (blocks[i].text !== undefined || blocks[i].heading !== undefined) {
        return null;
      }
    }
    return null;
  };
  for (const line of lines) {
    const m = ITEM.exec(line);
    const h = HEADING.exec(line);
    if (m) {
      endPara();
      const parent = m[1].length >= 2 ? lastItem() : null;
      // A nested entry joins its parent's gist.
      if (parent) parent.children.push(plain(m[2]));
      else blocks.push({ item: m[2], children: [] });
    } else if (h) {
      endPara();
      blocks.push({ heading: plain(h[1]) });
    } else if (!line.trim()) {
      endPara();
    } else if (/^\s{2,}\S/.test(line) && !para.length && lastItem()) {
      // An item's own second line.
      lastItem().item += ` ${line.trim()}`;
    } else {
      para.push(line.trim());
    }
  }
  endPara();
  // The whole answer, as written: always reachable.
  const paragraphs = String(answer || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const first = blocks.findIndex((b) => b.item !== undefined);
  if (first < 0) {
    const texts = blocks
      .map((b) => plain(b.text !== undefined ? b.text : b.heading))
      .filter(Boolean);
    if (!texts.length) return { kind: "none", paragraphs };
    const last = texts[texts.length - 1];
    // Said large only when what came before is the bot saying what it's
    // about to do — never a result left out.
    const before = texts.slice(0, -1);
    return last.length <= SHORT && before.every((t) => NARRATION.test(t))
      ? { kind: "short", text: last, paragraphs }
      : { kind: "text", paragraphs: texts };
  }
  let end = first;
  blocks.forEach((b, i) => {
    if (b.item !== undefined) end = i;
  });
  const before = blocks
    .slice(0, first)
    .filter((b) => b.text !== undefined || b.heading !== undefined);
  const leadBlock = before[before.length - 1];
  const lead = leadBlock ? plain(leadBlock.text || leadBlock.heading) : "";
  const items = [];
  for (const b of blocks.slice(first, end + 1)) {
    if (b.item !== undefined) {
      const it = itemOf(b.item);
      if (b.children.length) {
        it.gist = [it.gist, ...b.children].filter(Boolean).join("; ");
      }
      if (it.title) items.push(it);
    } else if (b.heading !== undefined) {
      items.push({ section: b.heading });
    } else if (b.text) {
      items.push({ note: plain(b.text) });
    }
  }
  const tail = blocks
    .slice(end + 1)
    .map((b) => plain(b.text || b.heading))
    .filter(Boolean)
    .join(" ");
  return { kind: "list", lead, items, tail, paragraphs };
}

/**
 * The action's tone, for its badge: a reply or review waits on the user, a
 * date or bill is information, a security matter is urgent.
 */
export function actionState(action) {
  const a = String(action || "").toLowerCase();
  if (
    /secur|sign-?in|password|suspicious|fraud|urgent|check it was you/.test(a)
  )
    return "error";
  if (/repl|respond|answer|review|approve|sign\b|confirm|decide/.test(a))
    return "warning";
  if (/due|pay|bill|deadline|by\s+\w+|renew|book|schedule/.test(a))
    return "info";
  return "neutral";
}
