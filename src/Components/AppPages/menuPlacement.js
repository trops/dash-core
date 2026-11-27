/**
 * menuPlacement — where a small menu opened from a button goes so it stays
 * on screen (DASH-118 follow-up: the team "⋯" menu ran off the left edge,
 * under the sidebar, in a narrow window).
 *
 * The menu lines up with one of the button's edges: "right" (its right edge
 * on the button's right edge, growing left) or "left" (growing right). It
 * keeps the preferred side when the menu fits there, flips to the other when
 * that one fits, and otherwise takes the side with more room. Likewise it
 * opens below the button unless it only fits (or fits better) above.
 *
 * @param {object} p
 * @param {{left:number,right:number,top:number,bottom:number}} p.anchor
 *        the button's rect
 * @param {{width:number,height:number}} p.menu  the menu's size
 * @param {{left:number,right:number,top:number,bottom:number}} p.bounds
 *        the visible area (the window, cut by any clipping container)
 * @param {"left"|"right"} [p.prefer="right"]
 * @param {number} [p.gap=4]  space between button and menu
 * @returns {{ align: "left"|"right", direction: "down"|"up" }}
 */
export function placeMenu({ anchor, menu, bounds, prefer = "right", gap = 4 }) {
  const fallback = {
    align: prefer === "left" ? "left" : "right",
    direction: "down",
  };
  if (!anchor || !menu || !bounds) return fallback;

  // Room on each side when lined up with the button's right / left edge.
  const roomRight = anchor.right - bounds.left; // grows left
  const roomLeft = bounds.right - anchor.left; // grows right
  const fits = {
    right: roomRight >= menu.width,
    left: roomLeft >= menu.width,
  };
  const other = fallback.align === "right" ? "left" : "right";
  let align = fallback.align;
  if (!fits[align]) {
    if (fits[other]) align = other;
    else {
      const room = { right: roomRight, left: roomLeft };
      align = room[other] > room[align] ? other : align;
    }
  }

  const below = bounds.bottom - anchor.bottom - gap;
  const above = anchor.top - bounds.top - gap;
  const direction = below >= menu.height || below >= above ? "down" : "up";

  return { align, direction };
}

/**
 * The part of the window an element's content can be seen in: the window,
 * cut by every ancestor that clips its overflow. DOM only (not unit-tested;
 * placeMenu is).
 */
export function visibleBounds(el) {
  const win = typeof window !== "undefined" ? window : null;
  const b = {
    left: 0,
    top: 0,
    right: win ? win.innerWidth : 0,
    bottom: win ? win.innerHeight : 0,
  };
  if (!el || !win || !win.getComputedStyle) return b;
  for (
    let p = el.parentElement;
    p && p !== document.body;
    p = p.parentElement
  ) {
    const s = win.getComputedStyle(p);
    const clips = /(hidden|auto|scroll|clip)/.test(
      `${s.overflow} ${s.overflowX} ${s.overflowY}`,
    );
    if (!clips) continue;
    const r = p.getBoundingClientRect();
    if (!r || !(r.width > 0) || !(r.height > 0)) continue;
    b.left = Math.max(b.left, r.left);
    b.top = Math.max(b.top, r.top);
    b.right = Math.min(b.right, r.right);
    b.bottom = Math.min(b.bottom, r.bottom);
  }
  return b;
}
