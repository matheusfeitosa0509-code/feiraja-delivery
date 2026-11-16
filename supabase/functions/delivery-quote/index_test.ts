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
const coordinates = { origin: { lat: "-3.10", lng: "-60.02" }, dropoff: { lat: "-3.11", lng: "-60.03" } };
const mockQuote = (total = "8.32", status = 200) => async (input: RequestInfo | URL, init?: RequestInit) => {
  assertEquals(String(input).startsWith("https://rest.sandbox.lalamove.com/v3/quotations"), true);
  assertEquals(init?.method, "POST");
  const body = JSON.parse(String(init?.body));
  assertEquals(body.data.stops[0].address.includes("Av. Lourenço da Silva Braga, 700"), true);
  assertEquals(body.data.stops[0].coordinates, coordinates.origin);
  assertEquals(body.data.stops[1].coordinates, coordinates.dropoff);
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
  const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "LALAGO", dropoff, coordinates, fetcher);
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
  const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "CAR", dropoff, coordinates, fetcher);
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
  const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "CAR", dropoff, coordinates, fetcher);
  assertEquals(parseQuotation((await response.json()).data, vehicle, load.weightKg).fee, 14);
});
Deno.test("Lalamove MOCKADA: endereço fora da área retorna 422 sem expor custo", async () => {
  const fetcher = async () => new Response(JSON.stringify({ message: "ERR_OUT_OF_SERVICE_AREA" }), { status: 422 });
  const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "LALAGO", dropoff, coordinates, fetcher);
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

Deno.test("melancia M e G forçam CAR pela regra de produto volumoso", async () => {
  const melancias = [
    { id: "feiraja_melancia_m", delivery_unit_weight_kg: 5, delivery_bulky: true, sale_unit: "unidade" },
    { id: "feiraja_melancia_g", delivery_unit_weight_kg: 8, delivery_bulky: true, sale_unit: "unidade" },
  ];
  for (const product of melancias) {
    const load = estimateLoad([{ product_id: product.id, quantity: 1 }], [product]);
    assertEquals(load.bulky, true);
    assertEquals(chooseVehicle(load.weightKg, load.bulky, 8), "CAR");
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      assertEquals(JSON.parse(String(init?.body)).data.serviceType, "CAR");
      return mockQuote("13.90")(input, init);
    };
    const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "CAR", dropoff, coordinates, fetcher);
    assertEquals(parseQuotation((await response.json()).data, "CAR", load.weightKg).fee, 14);
  }
});


Deno.test("Lalamove MOCKADA: cotação moto e carro de produção usa host live e credenciais live", async () => {
  const services: string[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    assertEquals(String(input), "https://rest.lalamove.com/v3/quotations");
    assertEquals(init?.method, "POST");
    assertEquals(new Headers(init?.headers).get("Authorization")?.startsWith("hmac pk_prod_mock:"), true);
    services.push(JSON.parse(String(init?.body)).data.serviceType);
    return new Response(JSON.stringify({ data: {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      priceBreakdown: { total: "10.25", currency: "BRL" },
    } }), { status: 200 });
  };
  const moto = await requestSandboxQuotation("pk_prod_mock", "sk_prod_mock", "LALAGO",
    dropoff, coordinates, fetcher, "producao");
  const car = await requestSandboxQuotation("pk_prod_mock", "sk_prod_mock", "CAR",
    dropoff, coordinates, fetcher, "producao");
  assertEquals(services, ["LALAGO", "CAR"]);
  assertEquals(parseQuotation((await moto.json()).data, "MOTO", 2).fee, 11);
  assertEquals(parseQuotation((await car.json()).data, "CAR", 3).fee, 11);
});

Deno.test("credenciais de produção ausentes falham sem fallback ao Sandbox", async () => {
  let code = "";
  try {
    await requestSandboxQuotation("pk_test_mock", "sk_test_mock", "LALAGO",
      dropoff, coordinates, mockQuote(), "producao");
  } catch (error) {
    code = error instanceof Error ? error.message : "";
  }
  assertEquals(code, "PRODUCTION_CREDENTIALS_REQUIRED");
});


Deno.test("limite de moto de 12 kg: 12 kg aceita moto e acima direciona para carro", () => {
  assertEquals(chooseVehicle(12, false, 12), "MOTO");
  assertEquals(chooseVehicle(12.001, false, 12), "CAR");
  assertEquals(chooseVehicle(3, true, 12), "CAR");
});
