import { assertEquals } from "jsr:@std/assert@1.0.14";
import { estaAberto, proximaAbertura, getCommercialSchedule, HOLIDAYS } from "./commercial-calendar.js";
const iso = (value: Date | null) => value?.toISOString() ?? null;
Deno.test("19/11 à noite agenda 20/11 às 6h", () => {
 const d=new Date("2026-11-20T02:00:00.000Z");
 assertEquals(estaAberto(d),false); assertEquals(iso(proximaAbertura(d)),"2026-11-20T10:00:00.000Z");
});
Deno.test("20/11 às 11h30 agenda 21/11 às 6h", () => {
 const d=new Date("2026-11-20T15:30:00.000Z");
 assertEquals(estaAberto(d),false); assertEquals(iso(proximaAbertura(d)),"2026-11-21T10:00:00.000Z");
});
Deno.test("24/12 às 12h agenda 26/12 às 6h", () => {
 const d=new Date("2026-12-24T16:00:00.000Z");
 assertEquals(estaAberto(d),false); assertEquals(iso(proximaAbertura(d)),"2026-12-26T10:00:00.000Z");
});
Deno.test("31/12 às 12h agenda 02/01/2027 às 6h", () => {
 const d=new Date("2026-12-31T16:00:00.000Z");
 assertEquals(estaAberto(d),false); assertEquals(iso(proximaAbertura(d)),"2027-01-02T10:00:00.000Z");
});
Deno.test("sábado às 14h agenda segunda às 6h", () => {
 const d=new Date("2026-11-14T18:00:00.000Z");
 assertEquals(estaAberto(d),false); assertEquals(iso(proximaAbertura(d)),"2026-11-16T10:00:00.000Z");
});
Deno.test("sexta de feriado abre até 11h e domingo continua fechado", () => {
 assertEquals(estaAberto(new Date("2026-11-20T14:00:00.000Z")),true);
 assertEquals(estaAberto(new Date("2026-11-20T15:00:00.000Z")),false);
 assertEquals(estaAberto(new Date("2026-11-15T13:00:00.000Z")),false);
});
Deno.test("Natal e Ano Novo ficam fechados", () => {
 assertEquals(getCommercialSchedule(new Date("2026-12-25T14:00:00.000Z")).hours,"fechado");
 assertEquals(getCommercialSchedule(new Date("2027-01-01T14:00:00.000Z")).hours,"fechado");
 assertEquals(getCommercialSchedule(new Date("2026-11-15T14:00:00.000Z")).hours,"fechado");
});

Deno.test("Carnaval, Sexta-feira Santa e Corpus Christi são calculados pela Páscoa", () => {
 assertEquals(HOLIDAYS["2026-02-16"]?.name,"Carnaval (segunda-feira)");
 assertEquals(HOLIDAYS["2026-02-17"]?.name,"Carnaval (terça-feira)");
 assertEquals(HOLIDAYS["2026-04-03"]?.name,"Sexta-feira Santa");
 assertEquals(HOLIDAYS["2026-06-04"]?.name,"Corpus Christi");
 assertEquals(HOLIDAYS["2027-02-08"]?.name,"Carnaval (segunda-feira)");
 assertEquals(HOLIDAYS["2027-02-09"]?.name,"Carnaval (terça-feira)");
 assertEquals(HOLIDAYS["2027-03-26"]?.name,"Sexta-feira Santa");
 assertEquals(HOLIDAYS["2027-05-27"]?.name,"Corpus Christi");
});
