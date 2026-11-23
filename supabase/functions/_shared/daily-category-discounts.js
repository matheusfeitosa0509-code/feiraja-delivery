export function getManausDayHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Manaus", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  return { weekday: weekdays[weekdayName] ?? 0, hour };
}
export function getActiveDailyCategoryDiscount(rules, category, productId, now = new Date()) {
  const { weekday, hour } = getManausDayHour(now);
  if (weekday < 1 || weekday > 6 || hour < 6 || hour >= 13) return null;
  const rule = (Array.isArray(rules) ? rules : []).find((row) => row?.is_active === true && Number(row.weekday) === weekday && String(row.category || "") === String(category || ""));
  if (!rule) return null;
  const excluded = Array.isArray(rule.excluded_product_ids) ? rule.excluded_product_ids.map(String) : [];
  if (excluded.includes(String(productId))) return null;
  const percent = Number(rule.percent);
  return Number.isFinite(percent) && percent > 0 && percent <= 90 ? percent : null;
}
export function calculateDailyDiscountedPriceCents(currentPriceCents, oldPriceCents, percent) {
  const current = Number(currentPriceCents), old = Number(oldPriceCents), discount = Number(percent);
  if (!Number.isSafeInteger(current) || current <= 0 || !Number.isFinite(discount) || discount <= 0 || discount > 90) return current;
  const reference = Number.isSafeInteger(old) && old > current ? old : current;
  return Math.min(current, Math.round(reference * (100 - discount) / 100));
}

/** @param {number} currentPriceCents @param {number | null} oldPriceCents @param {number | null} percent @param {number | null} resalePriceCents @returns {number} */
export function calculateBestUnitPriceCents(currentPriceCents, oldPriceCents, percent, resalePriceCents = null) {
  const current = Number(currentPriceCents);
  const daily = percent == null ? current : calculateDailyDiscountedPriceCents(current, oldPriceCents, percent);
  const resale = Number(resalePriceCents);
  return Number.isSafeInteger(resale) && resale > 0 && resale < current
    ? Math.min(current, daily, resale)
    : Math.min(current, daily);
}
