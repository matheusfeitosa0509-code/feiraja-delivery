// Shared commercial calendar and opening-hours rules.
// Imported by the Assistente (Deno) and the browser store (GitHub Pages).
export const OFFICIAL_HOLIDAYS = Object.freeze({
  "2026-01-01": "Confraternização Universal",
  "2026-02-17": "Carnaval (feriado municipal de Manaus)",
  "2026-04-03": "Paixão de Cristo",
  "2026-04-21": "Tiradentes",
  "2026-05-01": "Dia Mundial do Trabalho",
  "2026-06-04": "Corpus Christi",
  "2026-09-05": "Elevação do Amazonas à categoria de Província",
  "2026-09-07": "Independência do Brasil",
  "2026-10-12": "Nossa Senhora Aparecida",
  "2026-10-24": "Elevação de Manaus à categoria de Cidade",
  "2026-11-02": "Finados",
  "2026-11-15": "Proclamação da República",
  "2026-11-20": "Dia Nacional de Zumbi e da Consciência Negra",
  "2026-12-08": "Nossa Senhora da Conceição",
  "2026-12-25": "Natal",
});

function dateKey(date) {
  return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0");
}

function weekdayPt(date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long" }).format(date);
}

export function commercialScheduleContext(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Manaus", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const values = {};
  for (const part of parts) if (part.type !== "literal") values[part.type] = part.value;
  const dayIndex = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }[String(values.weekday).toLowerCase()] ?? -1;
  const today = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  const holidayName = OFFICIAL_HOLIDAYS[dateKey(today)] ?? null;
  const isSunday = dayIndex === 0;
  const closingHour = holidayName ? 11 : 13;
  const localMinutes = Number(values.hour) * 60 + Number(values.minute);
  const within = !isSunday && localMinutes >= 360 && localMinutes < closingHour * 60;
  const next = new Date(today);
  if (!within) do { next.setUTCDate(next.getUTCDate() + 1); } while (next.getUTCDay() === 0);
  const nextHoliday = OFFICIAL_HOLIDAYS[dateKey(next)] ?? null;
  const nextWorkingDay = within ? "hoje" : weekdayPt(next) + ", " + String(next.getUTCDate()).padStart(2, "0") + "/" + String(next.getUTCMonth() + 1).padStart(2, "0");
  const localDateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Manaus", dateStyle: "full", timeStyle: "short" }).format(now);
  return {
    data_hora_manaus: localDateTime,
    dentro_horario: within,
    feriado: holidayName,
    horario_de_hoje: isSunday ? "fechado" : holidayName ? "6h às 11h" : "6h às 13h",
    proximo_dia_funcionamento: nextWorkingDay,
    horario_do_proximo_dia: nextHoliday ? "6h às 11h" : "6h às 13h",
    nome_do_proximo_feriado: nextHoliday,
    pronto_a_partir_de: within ? (holidayName ? "hoje, até 11h" : "hoje, até 13h") : nextWorkingDay + " a partir das 6h",
  };
}
