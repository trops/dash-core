/**
 * cronBuilder.js — turn friendly schedule dropdowns into a cron expression and
 * back, so a non-technical user never has to type cron. Pure (no React / no
 * Electron) and unit-tested.
 *
 * Supported frequencies map to a 5-field cron (`min hour dom month dow`):
 *   off      → "" (no schedule)
 *   hourly   → "0 * * * *"           (top of every hour)
 *   daily    → "m h * * *"
 *   weekday  → "m h * * 1-5"         (Mon–Fri)
 *   weekly   → "m h * * <dow>"
 *   monthly  → "m h <dom> * *"
 *
 * `parseCron` round-trips a cron we generated back to dropdown state, and falls
 * back to `{ frequency: "custom" }` for anything hand-written — the form then
 * shows the raw cron in its Advanced field.
 */

export const FREQUENCIES = [
  { value: "off", label: "Off — run manually only" },
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekday", label: "Every weekday (Mon–Fri)" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

// cron day-of-week: 0 = Sunday … 6 = Saturday. Monday-first for display.
export const DAYS_OF_WEEK = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Days 1–28 only, so "monthly on the Nth" is valid in every month.
export const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: ordinal(i + 1),
}));

function label12(h, m) {
  const ampm = h < 12 ? "AM" : "PM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Half-hour increments across the day: value "HH:MM" (24h), label "h:MM AM/PM".
export const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      opts.push({
        value: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        label: label12(h, m),
      });
    }
  }
  return opts;
})();

export const DEFAULT_SCHEDULE = {
  frequency: "off",
  time: "09:00",
  dayOfWeek: "1",
  dayOfMonth: "1",
};

function parseHM(time) {
  const [h, m] = String(time || "09:00")
    .split(":")
    .map((n) => parseInt(n, 10));
  return [Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0];
}

/**
 * @param {{frequency:string, time?:string, dayOfWeek?:string, dayOfMonth?:string}} s
 * @returns {string} cron expression, or "" for "off"
 */
export function buildCron(s = {}) {
  const { frequency, time = "09:00", dayOfWeek = "1", dayOfMonth = "1" } = s;
  const [h, m] = parseHM(time);
  switch (frequency) {
    case "hourly":
      return "0 * * * *";
    case "daily":
      return `${m} ${h} * * *`;
    case "weekday":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${dayOfWeek}`;
    case "monthly":
      return `${m} ${h} ${dayOfMonth} * *`;
    case "off":
    default:
      return "";
  }
}

/**
 * Best-effort inverse of buildCron for edit mode.
 * @param {string} cron
 * @returns {{frequency:string, time?:string, dayOfWeek?:string, dayOfMonth?:string}}
 */
export function parseCron(cron) {
  if (!cron || !String(cron).trim()) return { frequency: "off" };
  const parts = String(cron).trim().split(/\s+/);
  if (parts.length !== 5) return { frequency: "custom" };
  const [min, hour, dom, month, dow] = parts;

  if (
    hour === "*" &&
    min === "0" &&
    dom === "*" &&
    month === "*" &&
    dow === "*"
  )
    return { frequency: "hourly" };

  const m = parseInt(min, 10);
  const h = parseInt(hour, 10);
  if (!Number.isFinite(m) || !Number.isFinite(h) || month !== "*")
    return { frequency: "custom" };
  const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

  if (dom === "*" && dow === "*") return { frequency: "daily", time };
  if (dom === "*" && dow === "1-5") return { frequency: "weekday", time };
  if (dom === "*" && /^[0-6]$/.test(dow))
    return { frequency: "weekly", time, dayOfWeek: dow };
  if (/^([1-9]|1[0-9]|2[0-8])$/.test(dom) && dow === "*")
    return { frequency: "monthly", time, dayOfMonth: dom };

  return { frequency: "custom" };
}
