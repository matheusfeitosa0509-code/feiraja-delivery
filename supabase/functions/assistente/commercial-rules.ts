export function commercialScheduleContext(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Manaus", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const values: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") values[part.type] = part.value;
  const dayIndex = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }[String(values.weekday).toLowerCase()] ?? -1;
  const within = dayIndex >= 1 && dayIndex <= 6 && Number(values.hour) >= 6 && Number(values.hour) < 13;
  const next = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  if (!within) do { next.setUTCDate(next.getUTCDate() + 1); } while (next.getUTCDay() === 0);
  const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long" }).format(next);
  const dateLabel = String(next.getUTCDate()).padStart(2, "0") + "/" + String(next.getUTCMonth() + 1).padStart(2, "0");
  const nextWorkingDay = within ? "hoje" : weekday + ", " + dateLabel;
  const localDateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Manaus", dateStyle: "full", timeStyle: "short" }).format(now);
  return { data_hora_manaus: localDateTime, dentro_horario: within, proximo_dia_funcionamento: nextWorkingDay, pronto_a_partir_de: within ? "hoje, até 13h" : nextWorkingDay + " a partir das 6h" };
}

export function formatResaleLabel(enabled: unknown, price: unknown, minQty: unknown, unit: unknown): string | null {
  const amount = Number(price);
  const minimum = Number(minQty);
  const saleUnit = unit === "kg" ? "kg" : unit === "un" ? "un" : "";
  if (enabled !== true || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(minimum) || minimum <= 0 || !saleUnit) return null;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount).replace(/\u00A0/g, " ");
  const quantity = Number.isInteger(minimum) ? String(minimum) : String(minimum).replace(".", ",");
  return "a partir de " + quantity + " " + saleUnit + ": " + money;
}

