import { getCommercialSchedule, upcomingHolidays, proximaAbertura, HOLIDAYS } from "../_shared/commercial-calendar.js";
export const OFFICIAL_HOLIDAYS: Record<string, string> = Object.fromEntries(
  upcomingHolidays(new Date("2026-01-01T12:00:00.000Z"), 40).map(item => [item.date, item.name])
);
export function commercialScheduleContext(now: Date = new Date()) {
  const schedule=getCommercialSchedule(now);
  const localDateTime=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Manaus",dateStyle:"full",timeStyle:"short"}).format(now);
  const nextOpening=proximaAbertura(now);
  const nextOpeningSchedule=nextOpening?getCommercialSchedule(nextOpening):schedule;
  const nextOpeningKey=nextOpening?new Intl.DateTimeFormat("en-CA",{timeZone:"America/Manaus",year:"numeric",month:"2-digit",day:"2-digit"}).format(nextOpening):null;
  const nextHoliday=nextOpeningKey?HOLIDAYS[nextOpeningKey]?.name||null:null;
  const nextWorkingDay=schedule.label;
  return {
    data_hora_manaus:localDateTime,
    dentro_horario:schedule.within,
    feriado:schedule.holiday,
    horario_de_hoje:schedule.hours,
    proximo_dia_funcionamento:nextWorkingDay,
    horario_do_proximo_dia:nextOpeningSchedule.hours,
    nome_do_proximo_feriado:nextHoliday?.name || null,
    pronto_a_partir_de:schedule.within ? "hoje, até " + (schedule.hours.includes("11h")?"11h":"13h") : nextWorkingDay + " a partir das 6h",
  };
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
