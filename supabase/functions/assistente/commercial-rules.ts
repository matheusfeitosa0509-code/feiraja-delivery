import { OFFICIAL_HOLIDAYS, commercialScheduleContext } from "../_shared/commercial-schedule.js";
export { OFFICIAL_HOLIDAYS, commercialScheduleContext };

export function formatResaleLabel(enabled: unknown, price: unknown, minQty: unknown, unit: unknown): string | null {
  const amount = Number(price);
  const minimum = Number(minQty);
  const saleUnit = unit === "kg" ? "kg" : unit === "un" ? "un" : "";
  if (enabled !== true || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(minimum) || minimum <= 0 || !saleUnit) return null;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount).replace(/\u00A0/g, " ");
  const quantity = Number.isInteger(minimum) ? String(minimum) : String(minimum).replace(".", ",");
  return "a partir de " + quantity + " " + saleUnit + ": " + money;
}
