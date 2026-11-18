import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQuotationBody, chooseVehicle, classifyLalamoveQuoteError, estimateLoad, formatDropoff, isQuoteAllowed,
  parseQuotation, requestSandboxQuotation, retryLalamove429, startParallelVehicleQuotes,
} from "../_shared/delivery-quote.ts";
import { getStoreSchedule } from "../_shared/store-schedule.js";
import { validateManausCoordinates } from "../_shared/geocoding.ts";

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

Deno.test("fora do horário, scheduleAt aponta para a próxima abertura em UTC", () => {
  const schedule = getStoreSchedule(new Date("2026-11-17T23:40:00.000Z"));
  assertEquals(schedule.within, false);
  assertEquals(schedule.scheduledFor, "2026-11-18T10:00:00.000Z");
});

Deno.test("endereço Lalamove mantém POI como referência separada e envia apenas endereço postal", () => {
  const address = formatDropoff({ street: "Avenida Noel Nutels", number: "1762", neighborhood: "Cidade Nova",
    reference: "Sumaúma Park Shopping" });
  assertEquals(address, "Avenida Noel Nutels, 1762, Cidade Nova, Manaus - AM, Brasil");
  assertEquals(address.includes("Sumaúma Park Shopping"), false);
});

Deno.test("coordenadas de mapa são normalizadas para seis casas decimais; três cotações seguidas passam", async () => {
  const precise = {
    origin: validateManausCoordinates(-3.119000123456789, -60.021700987654321),
    dropoff: validateManausCoordinates(-3.123456789012345, -60.098765432109876),
  };
  assertEquals(precise.dropoff.lat, "-3.123457");
  assertEquals(precise.dropoff.lng, "-60.098765");
  let calls = 0;
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    for (const stop of body.data.stops) {
      assertEquals(/^-?\d{1,2}(?:\.\d{1,6})?$/.test(stop.coordinates.lat), true);
      assertEquals(/^-?\d{1,2}(?:\.\d{1,6})?$/.test(stop.coordinates.lng), true);
    }
    return new Response(JSON.stringify({ data: {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      priceBreakdown: { total: "8.32", currency: "BRL" },
    } }), { status: 201 });
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "LALAGO",
      dropoff, precise, fetcher, "sandbox");
    assertEquals(response.status, 201);
  }
  assertEquals(calls, 3);
});

Deno.test("resposta 422 ERR_INVALID_FIELD da Lalamove é classificada como coordenada inválida", () => {
  const failure = classifyLalamoveQuoteError(422, {
    errors: [{ id: "ERR_INVALID_FIELD", message: "does not match coordinate pattern",
      detail: "/data/stops/1/coordinates/lat" }],
  });
  assertEquals(failure.code, "LALAMOVE_INVALID_COORDINATES");
  assertEquals(classifyLalamoveQuoteError(422, { message: "ERR_OUT_OF_SERVICE_AREA" }).code,
    "LALAMOVE_OUT_OF_SERVICE_AREA");
});

Deno.test("buildQuotationBody envia scheduleAt apenas para cotação agendada", () => {
  const scheduled = buildQuotationBody("LALAGO", dropoff, coordinates, "2026-11-18T10:00:00.000Z");
  assertEquals(scheduled.data.scheduleAt, "2026-11-18T10:00:00.000Z");
  const immediate = buildQuotationBody("LALAGO", dropoff, coordinates);
  assertEquals("scheduleAt" in immediate.data, false);
});

Deno.test("Lalamove MOCKADA recebe scheduleAt UTC na cotação agendada", async () => {
  let sentScheduleAt = "";
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    sentScheduleAt = String(JSON.parse(String(init?.body)).data.scheduleAt || "");
    return new Response(JSON.stringify({ data: { expiresAt: new Date(Date.now() + 60_000).toISOString(), priceBreakdown: { total: "8.32", currency: "BRL" } } }), { status: 201 });
  };
  const response = await requestSandboxQuotation("pk_test_demo", "sk_test_demo", "LALAGO", dropoff, coordinates, fetcher, "sandbox", "2026-11-18T10:00:00.000Z");
  assertEquals(response.status, 201);
  assertEquals(sentScheduleAt, "2026-11-18T10:00:00.000Z");
});

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


Deno.test("Lalamove HTTP 429 repete automaticamente duas vezes com espera crescente", async () => {
  let calls = 0;
  const waits: number[] = [];
  const response = await retryLalamove429(async () => {
    calls++;
    return new Response("{}", { status: calls < 3 ? 429 : 200 });
  }, "https://rest.lalamove.com/v3/quotations", { method: "POST" }, async (ms) => { waits.push(ms); });
  assertEquals(response.status, 200);
  assertEquals(calls, 3);
  assertEquals(waits, [250, 500]);
});


Deno.test("MOTO e CAR são iniciados em paralelo; o veículo selecionado é o resultado principal", async () => {
  const started: string[] = [];
  const tasks = startParallelVehicleQuotes("MOTO", async (vehicle) => {
    started.push(vehicle);
    await Promise.resolve();
    return vehicle;
  });
  const [selected, background] = await Promise.all([tasks.selected, tasks.background]);
  assertEquals(started.sort(), ["CAR", "MOTO"]);
  assertEquals(selected, "MOTO");
  assertEquals(background, "CAR");
});

Deno.test("Lalamove HTTP 5xx repete com espera curta", async () => {
  let calls = 0;
  const waits: number[] = [];
  const response = await retryLalamove429(async () => {
    calls++;
    return new Response("{}", { status: calls < 3 ? 503 : 200 });
  }, "https://rest.lalamove.com/v3/quotations", { method: "POST" }, async (ms) => { waits.push(ms); });
  assertEquals(response.status, 200);
  assertEquals(calls, 3);
  assertEquals(waits, [250, 500]);
});

Deno.test("Lalamove HTTP 4xx não repete", async () => {
  let calls = 0;
  const waits: number[] = [];
  const response = await retryLalamove429(async () => {
    calls++;
    return new Response("{}", { status: 422 });
  }, "https://rest.lalamove.com/v3/quotations", { method: "POST" }, async (ms) => { waits.push(ms); });
  assertEquals(response.status, 422);
  assertEquals(calls, 1);
  assertEquals(waits, []);
});
