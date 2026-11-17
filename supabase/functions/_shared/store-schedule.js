export const STORE_TIME_ZONE = "America/Manaus";
function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day), weekday: value.weekday, hour: Number(value.hour), minute: Number(value.minute) };
}
export function formatStoreScheduleLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: STORE_TIME_ZONE, weekday: "long", day: "2-digit", month: "2-digit" }).format(date).replace("-feira", "");
}
// Mirrors pickupEstimate: outside 06:00–13:00, advance one calendar day and skip Sunday.
// Official holidays are not modeled yet.
export function getStoreSchedule(date = new Date()) {
  const p = localParts(date);
  const weekdayIndex = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[p.weekday];
  const within = weekdayIndex >= 1 && weekdayIndex <= 6 && p.hour >= 6 && p.hour < 13;
  if (within) return { within: true, label: "hoje", scheduledFor: null };
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day));
  do { next.setUTCDate(next.getUTCDate() + 1); } while (next.getUTCDay() === 0);
  // Manaus is UTC-4; 06:00 local is 10:00 UTC.
  const scheduled = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 10, 0, 0));
  return { within: false, label: formatStoreScheduleLabel(scheduled), scheduledFor: scheduled.toISOString() };
}
