import { assertEquals } from "jsr:@std/assert@1.0.14";
import { calculateServerDelivery, orderTotals, validateCheckoutDelivery } from "./delivery-order.ts";

const products = [
  { id: "banana", delivery_unit_weight_kg: 0.5, delivery_bulky: false, sale_unit: "unidade" },
  { id: "melancia", delivery_unit_weight_kg: 2, delivery_bulky: true, sale_unit: "unidade" },
];
const address = { street: "Rua A", number: "10", neighborhood: "Centro" };
const mockGeocoder = async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  assertEquals(url.hostname, "maps.googleapis.com");
  assertEquals(url.searchParams.get("address")?.includes("Manaus - AM, Brasil"), true);
  return new Response(JSON.stringify({ status: "OK", results: [{
    types: ["street_address"],
    address_components: [
      { long_name: "Manaus", short_name: "Manaus", types: ["locality", "political"] },
      { long_name: "Amazonas", short_name: "AM", types: ["administrative_area_level_1", "political"] },
      { long_name: "Brasil", short_name: "BR", types: ["country", "political"] },
    ],
    geometry: { location: { lat: -3.1, lng: -60.02 } },
  }] }), { status: 200 });
};
const mockLalamove = (total = "8.32", environment: "sandbox" | "producao" = "sandbox") => async (input: RequestInfo | URL, init?: RequestInit) => {
  assertEquals(String(input), environment === "producao"
    ? "https://rest.lalamove.com/v3/quotations"
    : "https://rest.sandbox.lalamove.com/v3/quotations");
  const body = JSON.parse(String(init?.body));
  assertEquals(body.data.stops[0].address.includes("Av. Lourenço da Silva Braga, 700"), true);
  assertEquals(body.data.stops[1].address.includes("Rua A, 10"), true);
  assertEquals(body.data.stops[0].coordinates, { lat: "-3.100000", lng: "-60.020000" });
  assertEquals(body.data.stops[1].coordinates, { lat: "-3.100000", lng: "-60.020000" });
  assertEquals(body.data.serviceType, "LALAGO");
  return new Response(JSON.stringify({
    data: { expiresAt: new Date(Date.now() + 60_000).toISOString(),
      priceBreakdown: { total, currency: "BRL" } },
  }), { status: 200 });
};

Deno.test("checkout envia scheduleAt ao recalcular entrega fora do horário", async () => {
  let sentScheduleAt = "";
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    sentScheduleAt = String(JSON.parse(String(init?.body)).data.scheduleAt || "");
    return new Response(JSON.stringify({ data: { expiresAt: new Date(Date.now() + 60_000).toISOString(), priceBreakdown: { total: "8.32", currency: "BRL" } } }), { status: 201 });
  };
  const quote = await calculateServerDelivery({
    items: [{ product_id: "banana", quantity: 2 }], products, address, motoLimitKg: 8,
    apiKey: "pk_test_demo", apiSecret: "sk_test_demo", geocodingApiKey: "google-test",
    scheduleAt: "2026-11-18T10:00:00.000Z", geocodeFetcher: mockGeocoder, fetcher,
  });
  assertEquals(sentScheduleAt, "2026-11-18T10:00:00.000Z");
  assertEquals(quote.scheduleAt, "2026-11-18T10:00:00.000Z");
});

Deno.test("cotação de checkout usa as coordenadas do pino confirmado sem geocodificar o destino", async () => {
  const pin = { lat: "-3.123456", lng: "-60.987654" };
  const geocodedAddresses: string[] = [];
  const geocoder = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    geocodedAddresses.push(String(url.searchParams.get("address") || ""));
    return new Response(JSON.stringify({ status: "OK", results: [{
      types: ["street_address"], address_components: [
        { long_name: "Manaus", short_name: "Manaus", types: ["locality", "political"] },
        { long_name: "Amazonas", short_name: "AM", types: ["administrative_area_level_1", "political"] },
        { long_name: "Brasil", short_name: "BR", types: ["country", "political"] },
      ], geometry: { location: { lat: -3.1, lng: -60.02 } },
    }] }), { status: 200 });
  };
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assertEquals(body.data.stops[1].coordinates, pin);
    assertEquals(body.data.stops[0].coordinates, { lat: "-3.100000", lng: "-60.020000" });
    return new Response(JSON.stringify({ data: { expiresAt: new Date(Date.now() + 60_000).toISOString(), priceBreakdown: { total: "8.32", currency: "BRL" } } }), { status: 201 });
  };
  await calculateServerDelivery({
    items: [{ product_id: "banana", quantity: 2 }], products, address, motoLimitKg: 8,
    apiKey: "pk_test_demo", apiSecret: "sk_test_demo", geocodingApiKey: "google-test",
    coordinates: pin, geocodeFetcher: geocoder, fetcher,
  });
  assertEquals(geocodedAddresses.length, 1, "only the origin is geocoded; the destination comes from the confirmed pin");
});

Deno.test("entrega admin com Pix de teste: autoriza, calcula cotação Sandbox e taxa no servidor", async () => {
  assertEquals(validateCheckoutDelivery({
    deliveryType: "delivery", paymentMethod: "pix_test", isAdmin: true, deliveryActive: false,
  }), { ok: true });
  const quote = await calculateServerDelivery({
    items: [{ product_id: "banana", quantity: 2 }],
    products, address, motoLimitKg: 8,
    apiKey: "pk_test_demo", apiSecret: "sk_test_demo", geocodingApiKey: "google-test",
    geocodeFetcher: mockGeocoder, fetcher: mockLalamove("8.32"),
  });
  assertEquals(quote.vehicle, "MOTO");
  assertEquals(quote.weightKg, 1);
  assertEquals(quote.fee, 9);
});

Deno.test("servidor recusa Pix de teste para não-admin em qualquer modalidade", () => {
  for (const deliveryType of ["pickup_store", "pickup_uber", "delivery"]) {
    assertEquals(validateCheckoutDelivery({
      deliveryType, paymentMethod: "pix_test", isAdmin: false, deliveryActive: true,
    }), { ok: false, status: 403, error: "Pix de teste disponível somente para administradores." });
  }
});

Deno.test("cliente comum pode pagar com Pix quando a Entrega Feira On está ativa", () => {
  assertEquals(validateCheckoutDelivery({
    deliveryType: "delivery", paymentMethod: "pix", isAdmin: false, deliveryActive: true,
  }), { ok: true });
});

Deno.test("não-admin bloqueado quando entrega está desligada", () => {
  assertEquals(validateCheckoutDelivery({
    deliveryType: "delivery", paymentMethod: "pix", isAdmin: false, deliveryActive: false,
  }), { ok: false, status: 403, error: "A Entrega Feira On está temporariamente desativada." });
});

Deno.test("novos pedidos com Uber são recusados quando Entrega Feira On está ativa", () => {
  assertEquals(validateCheckoutDelivery({
    deliveryType: "pickup_uber", paymentMethod: "pix", isAdmin: false, deliveryActive: true,
  }), {
    ok: false, status: 400, error: "Essa modalidade de retirada não está disponível enquanto a Entrega Feira On estiver ativa.",
  });
  assertEquals(validateCheckoutDelivery({
    deliveryType: "pickup_uber", paymentMethod: "pix", isAdmin: false, deliveryActive: false,
  }), { ok: true });
});

Deno.test("dinheiro e cartão são recusados para entrega", () => {
  for (const paymentMethod of ["cash", "card_on_delivery"]) {
    assertEquals(validateCheckoutDelivery({
      deliveryType: "delivery", paymentMethod, isAdmin: true, deliveryActive: true,
    }).ok, false);
  }
});

Deno.test("taxa enviada pelo navegador não participa do total: usa apenas taxa do servidor", () => {
  // The browser's arbitrary R$ 0.01 is not passed to orderTotals.
  const totals = orderTotals(10_000, 9, "delivery");
  assertEquals(totals.deliveryFee, 9);
  assertEquals(totals.total, 109);
});

Deno.test("entrega nunca aceita taxa ausente ou zero", () => {
  let zeroRejected = false;
  let missingRejected = false;
  try { orderTotals(10_000, 0, "delivery"); } catch { zeroRejected = true; }
  try { orderTotals(10_000, Number.NaN, "delivery"); } catch { missingRejected = true; }
  assertEquals(zeroRejected, true);
  assertEquals(missingRejected, true);
});

Deno.test("retirada mantém taxa zero e total igual ao subtotal", () => {
  assertEquals(orderTotals(10_000, 999, "pickup_store"), {
    deliveryFee: 0, totalCents: 10_000, total: 100,
  });
  assertEquals(validateCheckoutDelivery({
    deliveryType: "pickup_store", paymentMethod: "cash", isAdmin: false, deliveryActive: false,
  }), { ok: true });
});

Deno.test("produto volumoso força CAR na cotação real mockada", async () => {
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    assertEquals(JSON.parse(String(init?.body)).data.serviceType, "CAR");
    return new Response(JSON.stringify({
      data: { expiresAt: new Date(Date.now() + 60_000).toISOString(),
        priceBreakdown: { total: "13.90", currency: "BRL" } },
    }), { status: 200 });
  };
  const quote = await calculateServerDelivery({
    items: [{ product_id: "melancia", quantity: 1 }],
    products, address, motoLimitKg: 8,
    apiKey: "pk_test_demo", apiSecret: "sk_test_demo", geocodingApiKey: "google-test",
    geocodeFetcher: mockGeocoder, fetcher,
  });
  assertEquals(quote.vehicle, "CAR");
  assertEquals(quote.fee, 14);
});

Deno.test("checkout recalcula cotação no ambiente Lalamove configurado e arredonda no servidor", async () => {
  const quote = await calculateServerDelivery({
    items: [{ product_id: "banana", quantity: 2 }],
    products, address, motoLimitKg: 12,
    apiKey: "pk_prod_demo", apiSecret: "sk_prod_demo", geocodingApiKey: "google-test",
    environment: "producao",
    geocodeFetcher: mockGeocoder, fetcher: mockLalamove("10.25", "producao"),
  });
  assertEquals(quote.vehicle, "MOTO");
  assertEquals(quote.fee, 11);
});
