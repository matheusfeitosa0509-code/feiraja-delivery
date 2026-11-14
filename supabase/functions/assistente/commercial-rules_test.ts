import { assertEquals } from "jsr:@std/assert@1";
import { commercialScheduleContext, formatResaleLabel } from "./commercial-rules.ts";

Deno.test("sábado após o fechamento aponta segunda-feira", () => {
  const result = commercialScheduleContext(new Date("2026-11-14T22:30:00.000Z"));
  assertEquals(result.dentro_horario, false);
  assertEquals(result.proximo_dia_funcionamento, "segunda-feira, 16/11");
  assertEquals(result.pronto_a_partir_de, "segunda-feira, 16/11 a partir das 6h");
});

Deno.test("sábado durante o funcionamento aponta hoje", () => {
  const result = commercialScheduleContext(new Date("2026-11-14T14:00:00.000Z"));
  assertEquals(result.dentro_horario, true);
  assertEquals(result.proximo_dia_funcionamento, "hoje");
  assertEquals(result.pronto_a_partir_de, "hoje, até 13h");
});

Deno.test("domingo aponta segunda-feira", () => {
  const result = commercialScheduleContext(new Date("2026-11-15T14:00:00.000Z"));
  assertEquals(result.proximo_dia_funcionamento, "segunda-feira, 16/11");
});

Deno.test("formata revenda por unidade e por kg", () => {
  assertEquals(formatResaleLabel(true, 5.99, 10, "un"), "a partir de 10 un: R$ 5,99");
  assertEquals(formatResaleLabel(true, 19.5, 2.5, "kg"), "a partir de 2,5 kg: R$ 19,50");
  assertEquals(formatResaleLabel(false, 5.99, 10, "un"), null);
});

Deno.test("contexto inclui data e hora local de Manaus", () => {
  const result = commercialScheduleContext(new Date("2026-11-14T22:30:00.000Z"));
  assertEquals(result.data_hora_manaus, "sábado, 14 de novembro de 2026 às 18:30");
});

Deno.test("revenda usa espaço comum após o símbolo da moeda", () => {
  const label = formatResaleLabel(true, 5.99, 10, "un");
  assertEquals(label?.includes("R$ 5,99"), true);
});
