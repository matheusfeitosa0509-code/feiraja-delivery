import { getManausDayHour } from "./daily-category-discounts.js";

export function isDailyRecipeKitAvailable(kit, now = new Date()) {
  if (!kit || kit.is_active !== true) return false;
  const { weekday, hour } = getManausDayHour(now);
  return Number(kit.weekday) === weekday && hour >= 6 && hour < 13;
}

export function areDailyRecipeKitItemsAvailable(items, products) {
  if (!Array.isArray(items) || items.length === 0 || !Array.isArray(products)) return false;
  const byId = new Map(products.map((product) => [String(product.id), product]));
  return items.every((item) => {
    const product = byId.get(String(item.product_id));
    const quantity = Number(item.quantity);
    return !!product && product.available === true && Number.isFinite(quantity) && quantity > 0 && quantity <= 100;
  });
}
