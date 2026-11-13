/**
 * Your answer on top: after you send, the conversation puts your message at
 * the top of the view, with room below it that the team's work fills. It
 * stays put until that work no longer fits, then follows the newest part —
 * unless you scrolled away to read something.
 */

/** Room above your message, so it isn't flush with the edge. */
export const TOP_GAP = 12;
/** How near counts as "where we put you" / "at the bottom". */
export const NEAR_PX = 48;

/**
 * Was this change a send of yours? The newest "you" message is new and at
 * the end — not a saved conversation loading all at once.
 * @param {number} prevLength  messages before the change
 * @param {Array}  messages    messages now
 * @returns {number} the index of your new message, or -1
 */
export function sentIndex(prevLength, messages) {
  const list = Array.isArray(messages) ? messages : [];
  const grew = list.length - prevLength;
  if (grew < 1 || grew > 2) return -1;
  // Yours is the newest, apart from the step lines that go with it (a saved
  // one's reply would come after).
  for (let i = list.length - 1; i >= prevLength; i -= 1) {
    const who = list[i] && list[i].who;
    if (who === "you") return i;
    if (who !== "step" && who !== "note") return -1;
  }
  return -1;
}

/**
 * Where the view goes, and the room below the content that lets your
 * message reach the top.
 * @param {object} p
 * @param {number} p.anchorTop      your message's top, in the content
 * @param {number} p.contentHeight  the conversation's height (no room added)
 * @param {number} p.viewHeight     the view's height
 * @param {boolean} p.away          you scrolled away from where it put you
 * @returns {{room: number, scrollTop: (number|null)}}
 */
export function placeAnswer({ anchorTop, contentHeight, viewHeight, away }) {
  const top = Math.max(0, anchorTop - TOP_GAP);
  const below = contentHeight - top;
  const room = Math.max(0, viewHeight - below);
  if (away) return { room, scrollTop: null };
  return {
    room,
    scrollTop: below <= viewHeight ? top : contentHeight - viewHeight,
  };
}
