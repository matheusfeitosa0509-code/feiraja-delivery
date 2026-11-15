import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQuotationBody, chooseVehicle, estimateLoad, formatDropoff, isQuoteAllowed,
  parseQuotation, requestSandboxQuotation,
} from "../_shared/delivery-quote.ts";

const products = [
  { id: "unit", delivery_unit_weight_kg: 0.5, delivery_bulky: false, sale_unit: "unidade" },
  { id: "kg", delivery_unit_weight_kg: 3, delivery_bulky: false, sale_unit: "kg" },
  { id: "bulk", delivery_unit_weight_kg: 2, delivery_bulky: true, sale_unit: "unidade" },
  { id: "unknown", delivery_unit_weight_kg: null, delivery_bulky: false, sale_unit: "unidade" },
];
const dropoff = formatDropoff({ street: "Rua A", number: "10", neighborhood: "Centro" });
const mockQuote = (total = "8.32", status = 200) => async (input: RequestInfo | URL, init?: RequestInit) => {
  assertEquals(String(input).startsWith("https://rest.sandbox.lalamove.com/v3/quotations"), true);
  assertEquals(init?.method, "POST");
  const body = JSON.parse(String(init?.body));
  assertEquals(body.data.stops[0].address.includes("Av. Lourenço da Silva Braga, 700"), true);
  return new Response(JSON.stringify(status === 200 ? {
    data: { expiresAt: new Date(Date.now() + 60_000).toISOString(),
      priceBreakdown: { total, currency: "BRL" } },
  } : { message: "ERR_OUT_OF_SERVICE_AREA" }), { status });
};

Deno.test("Lalamove MOCKADA: peso leve usa serviço LALAGO (MOTO)", async () => {
  const load = estimateLoad([{ product_id: "unit", quantity: 2 }], products);
  const vehicle = chooseVehicle(load.weightKg, load.bulky, 8);
  assertEquals(vehicle, "MOTO");
  let called = false;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    called = true;
    const body = JSON.parse(String(init?.body));
    assertEquals(body.data.serviceType, "LALAGO");
    return mockQuote("8.32")(input, init);
  };
  const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "LALAGO", dropoff, fetcher);
  const result = await response.json();
  assertEquals(called, true);
  assertEquals(parseQuotation(result.data, vehicle, load.weightKg).fee, 9);
});
Deno.test("Lalamove MOCKADA: peso acima do limite usa serviço CAR", async () => {
  const load = estimateLoad([{ product_id: "kg", quantity: 9 }], products);
  const vehicle = chooseVehicle(load.weightKg, load.bulky, 8);
  assertEquals(vehicle, "CAR");
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    assertEquals(JSON.parse(String(init?.body)).data.serviceType, "CAR");
    return mockQuote("13.90")(input, init);
  };
  const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "CAR", dropoff, fetcher);
  assertEquals(parseQuotation((await response.json()).data, vehicle, load.weightKg).fee, 14);
});
Deno.test("Lalamove MOCKADA: produto volumoso força CAR mesmo abaixo do limite", async () => {
  const load = estimateLoad([{ product_id: "bulk", quantity: 1 }], products);
  const vehicle = chooseVehicle(load.weightKg, load.bulky, 8);
  assertEquals(vehicle, "CAR");
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    assertEquals(JSON.parse(String(init?.body)).data.serviceType, "CAR");
    return mockQuote("13.01")(input, init);
  };
  const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "CAR", dropoff, fetcher);
  assertEquals(parseQuotation((await response.json()).data, vehicle, load.weightKg).fee, 14);
});
Deno.test("Lalamove MOCKADA: endereço fora da área retorna 422 sem expor custo", async () => {
  const fetcher = async () => new Response(JSON.stringify({ message: "ERR_OUT_OF_SERVICE_AREA" }), { status: 422 });
  const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "LALAGO", dropoff, fetcher);
  assertEquals(response.status, 422);
  assertEquals((await response.json()).message, "ERR_OUT_OF_SERVICE_AREA");
});
Deno.test("não-admin recebe bloqueio quando entrega está desligada", () => {
  assertEquals(isQuoteAllowed(false, false), false);
  assertEquals(isQuoteAllowed(false, true), true);
  assertEquals(isQuoteAllowed(true, false), true);
});
Deno.test("produto kg usa quantidade; sem peso usa 1 kg/un", () => {
  assertEquals(estimateLoad([{ product_id: "unknown", quantity: 3 }], products).weightKg, 3);
  assertEquals(estimateLoad([{ product_id: "kg", quantity: 2 }], products).weightKg, 2);
});
Deno.test("taxa arredonda para cima e resposta pública contém apenas campos permitidos", () => {
  const parsed = parseQuotation({ expiresAt: new Date(Date.now() + 60_000).toISOString(),
    priceBreakdown: { total: "8.32", currency: "BRL" } }, "MOTO", 1);
  assertEquals(parsed.fee, 9);
  assertEquals(Object.keys(parsed).sort(), ["fee", "validUntil", "vehicle", "weightKg"]);
});
