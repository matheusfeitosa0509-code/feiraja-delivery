const WEEKDAY_BY_SHORT = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
const WEEKDAY_NAME_PT = Object.freeze({ 1: "segunda", 2: "terça", 3: "quarta", 4: "quinta", 5: "sexta", 6: "sábado" });

function getManausParts(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Manaus", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const weekday = WEEKDAY_BY_SHORT[parts.find((part) => part.type === "weekday")?.value || ""];
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return { weekday, minutes: hour * 60 + minute };
}

/** Window: previous operating day 13:00 through kit weekday 13:00 (Manaus). */
export function getDailyRecipeKitWindowStatus(kit, now = new Date()) {
  if (!kit || kit.is_active !== true || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return { available: false, label: "", deliveryLabel: "" };
  }
  const target = Number(kit.weekday);
  if (!Number.isInteger(target) || target < 1 || target > 6) return { available: false, label: "", deliveryLabel: "" };
  const { weekday, minutes } = getManausParts(now);
  if (!Number.isInteger(weekday) || !Number.isFinite(minutes)) return { available: false, label: "", deliveryLabel: "" };

  const isKitDay = weekday === target && minutes < 13 * 60;
  const isPreviousDay = target === 1
    ? ((weekday === 6 && minutes >= 13 * 60) || weekday === 0)
    : (weekday === target - 1 && minutes >= 13 * 60);
  const available = isKitDay || isPreviousDay;
  const deliveryLabel = WEEKDAY_NAME_PT[target] + " cedo";
  const name = String(kit.name || "Kit do dia");
  let label = "";
  if (available) {
    if (isKitDay) label = "Hoje: " + name;
    else if (target === 1 && weekday === 6) label = "Segunda cedo: " + name + " — peça hoje e receba segunda cedo";
    else label = "Amanhã: " + name + " — peça hoje e receba " + deliveryLabel;
  }
  return { available, label, deliveryLabel };
}

export function isDailyRecipeKitAvailable(kit, now = new Date()) {
  return getDailyRecipeKitWindowStatus(kit, now).available;
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
