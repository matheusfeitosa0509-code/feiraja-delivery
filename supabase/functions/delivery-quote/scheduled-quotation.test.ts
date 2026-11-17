function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error("Expected " + String(expected) + ", received " + String(actual));
}
import { buildQuotationBody, requestSandboxQuotation } from "../_shared/delivery-quote.ts";
import { getStoreSchedule } from "../_shared/store-schedule.js";

Deno.test("fora do horário, calcula o próximo início de funcionamento em UTC", () => {
  const schedule = getStoreSchedule(new Date("2026-11-17T23:40:00.000Z"));
  assertEquals(schedule.within, false);
  assertEquals(schedule.scheduledFor, "2026-11-18T10:00:00.000Z");
});

Deno.test("quotation body inclui scheduleAt UTC apenas para entrega agendada", () => {
  const coordinates = {
    origin: { lat: "-3.1300", lng: "-60.0200" },
    dropoff: { lat: "-3.0900", lng: "-59.9900" },
  };
  const scheduled = buildQuotationBody("LALAGO", "Rua Acácia-do-Nilo, 45, Novo Aleixo, Manaus - AM", coordinates, "2026-11-18T10:00:00.000Z");
  assertEquals(scheduled.data.scheduleAt, "2026-11-18T10:00:00.000Z");
  const immediate = buildQuotationBody("LALAGO", "Rua Acácia-do-Nilo, 45, Novo Aleixo, Manaus - AM", coordinates);
  assertEquals("scheduleAt" in immediate.data, false);
});

Deno.test("request mockada envia scheduleAt no payload assinado", async () => {
  let sentBody: any = null;
  const mockFetch: typeof fetch = async (_input, init) => {
    sentBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({ data: { quotationId: "mock", expiresAt: "2026-11-18T10:05:00.000Z" } }), { status: 201 });
  };
  await requestSandboxQuotation(
    "pk_test_mock", "sk_test_mock", "LALAGO", "Rua Acácia-do-Nilo, 45, Novo Aleixo, Manaus - AM",
    { origin: { lat: "-3.1300", lng: "-60.0200" }, dropoff: { lat: "-3.0900", lng: "-59.9900" } },
    mockFetch, "sandbox", "2026-11-18T10:00:00.000Z",
  );
  assertEquals(sentBody.data.scheduleAt, "2026-11-18T10:00:00.000Z");
});
