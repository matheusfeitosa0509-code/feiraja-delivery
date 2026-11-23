const WEEKDAY_BY_SHORT = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

function parseTimeMinutes(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Optional schedule for a store banner. Null schedule fields preserve legacy visibility. */
export function isStoreBannerScheduleActive(banner, now = new Date()) {
  if (!banner || !(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Manaus",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value || "";
  const weekday = WEEKDAY_BY_SHORT[weekdayName];
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (weekday == null || !Number.isInteger(hour) || !Number.isInteger(minute)) return false;

  if (banner.weekdays != null) {
    if (!Array.isArray(banner.weekdays) || banner.weekdays.length === 0) return false;
    if (!banner.weekdays.some((value) => Number(value) === weekday)) return false;
  }

  const hasStart = banner.start_time != null && banner.start_time !== "";
  const hasEnd = banner.end_time != null && banner.end_time !== "";
  if (hasStart !== hasEnd) return false;
  if (!hasStart) return true;

  const start = parseTimeMinutes(String(banner.start_time));
  const end = parseTimeMinutes(String(banner.end_time));
  if (start == null || end == null || end <= start) return false;
  const current = hour * 60 + minute;
  return current >= start && current < end;
}
