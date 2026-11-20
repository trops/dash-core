/**
 * Which version a widget goes up as when a dashboard is published (DASH-22
 * follow-up). Three cases, told by whether the copy here changed since it
 * was last published or installed (electron/registry/widgetPublished.js):
 *
 *   unchanged — nothing new: not published again; the dashboard uses it.
 *   changed   — goes up as the next version above everything published.
 *   conflict  — changed, but the registry has a newer version than the one
 *               this copy started from (published from somewhere else):
 *               the user chooses — publish theirs above it ("mine"), or keep
 *               the registry's ("theirs").
 *   new       — not in the registry yet: goes up as it is.
 */

/** Whether version a is newer than b ("1.0.10" > "1.0.9"). */
export function newerVersion(a, b) {
  const p = (v) =>
    String(v || "")
      .split(/[.-]/)
      .slice(0, 3)
      .map((n) => Number(n) || 0);
  const x = p(a);
  const y = p(b);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

const core = (v) => {
  const m = String(v || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [1, 0, 0];
};

/** The patch after the higher of two versions ("2.0.0", "3.0.0" → "3.0.1"). */
export function nextAbove(a, b) {
  const top = b && newerVersion(b, a) ? b : a;
  const [x, y, z] = core(top);
  return `${x}.${y}.${z + 1}`;
}

/**
 * @param {{ mine: string, latest: string|null, changed: boolean|null,
 *   basedOn: string|null }} w — mine: this copy's version; latest: the
 *   registry's newest (null: not there); changed: since last published or
 *   installed (null: can't tell, so treated as changed); basedOn: the
 *   version this copy came from; sameAccount: that was published to the
 *   account publishing now.
 * @returns {{ case: "new"|"unchanged"|"changed"|"conflict", version:
 *   string|null, latest: string|null, basedOn: string }} — version: what
 *   goes up (the "mine" choice for a conflict), null when it's skipped.
 */
export function widgetVersionPlan({
  mine,
  latest,
  changed,
  basedOn,
  sameAccount = true,
}) {
  const base = basedOn || mine || "1.0.0";
  if (!latest) {
    return {
      case: "new",
      version: mine || "1.0.0",
      latest: null,
      basedOn: base,
    };
  }
  // Unchanged only when what it came from is this account's, and not newer
  // than the registry has (a version since deleted, say): else it goes up.
  if (changed === false && sameAccount && !newerVersion(base, latest)) {
    return { case: "unchanged", version: null, latest, basedOn: base };
  }
  return {
    case: newerVersion(latest, base) ? "conflict" : "changed",
    version: nextAbove(mine || base, latest),
    latest,
    basedOn: base,
  };
}

/** What the row says, and what the dashboard ends up using. */
export function versionLine(plan, choice = "mine") {
  if (!plan) return "";
  switch (plan.case) {
    case "new":
      return `New to the registry — goes up as ${plan.version}.`;
    case "unchanged":
      return `No changes since ${plan.basedOn} — not published again. The dashboard uses ${plan.basedOn}.`;
    case "changed":
      return `You've changed it since ${plan.basedOn} — your changes go up as ${plan.version}.`;
    case "conflict":
      return choice === "theirs"
        ? `Yours isn't published — the dashboard uses ${plan.latest}.`
        : `Yours goes up as ${plan.version} — anything that's only in ${plan.latest} won't be in it.`;
    default:
      return "";
  }
}
