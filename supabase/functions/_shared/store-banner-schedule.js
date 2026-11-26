const WEEKDAY_BY_SHORT = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

function parseTimeMinutes(value) {
  if (typeof value !== "string") return null;
  const match = /^(\\d{2}):(\\d{2})(?::\\d{2}(?:\\.\\d+)?)?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function getManausClock(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Manaus", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  return {
    weekday: WEEKDAY_BY_SHORT[parts.find((part) => part.type === "weekday")?.value || ""],
    minutes: Number(parts.find((part) => part.type === "hour")?.value) * 60 +
      Number(parts.find((part) => part.type === "minute")?.value),
  };
}

function isDailyKitBannerWindowActive(target, weekday, minutes) {
  if (!Number.isInteger(target) || target < 1 || target > 6) return false;
  if (weekday === target) return minutes < 13 * 60;
  if (target === 1) return (weekday === 6 && minutes >= 13 * 60) || weekday === 0;
  return weekday === target - 1 && minutes >= 13 * 60;
}

/** Optional schedule for a store banner. Kit banners use the kit's advance-sale window. */
export function isStoreBannerScheduleActive(banner, now = new Date()) {
  if (!banner || !(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
  const { weekday, minutes } = getManausClock(now);
  if (!Number.isInteger(weekday) || !Number.isFinite(minutes)) return false;

  if (banner.action_type === "kit") {
    if (!Array.isArray(banner.weekdays) || banner.weekdays.length !== 1) return false;
    return isDailyKitBannerWindowActive(Number(banner.weekdays[0]), weekday, minutes);
  }

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
  return minutes >= start && minutes < end;
}
