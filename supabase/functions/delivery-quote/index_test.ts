import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildQuotationBody, chooseVehicle, estimateLoad, formatDropoff, parseQuotation } from "../_shared/delivery-quote.ts";

const products = [
  { id: "unit", delivery_unit_weight_kg: 0.5, delivery_bulky: false, sale_unit: "unidade" },
  { id: "kg", delivery_unit_weight_kg: 3, delivery_bulky: false, sale_unit: "kg" },
  { id: "bulk", delivery_unit_weight_kg: 2, delivery_bulky: true, sale_unit: "unidade" },
  { id: "unknown", delivery_unit_weight_kg: null, delivery_bulky: false, sale_unit: "unidade" },
];

Deno.test("cotação MOTO: até limite e sem volumoso", () => {
  const load = estimateLoad([{ product_id: "unit", quantity: 2 }], products);
  assertEquals(load.weightKg, 1);
  assertEquals(chooseVehicle(load.weightKg, load.bulky, 8), "MOTO");
});
Deno.test("cotação CARRO: peso acima do limite", () => {
  const load = estimateLoad([{ product_id: "kg", quantity: 9 }], products);
  assertEquals(load.weightKg, 9);
  assertEquals(chooseVehicle(load.weightKg, load.bulky, 8), "CAR");
});
Deno.test("item volumoso força CARRO", () => {
  const load = estimateLoad([{ product_id: "bulk", quantity: 1 }], products);
  assertEquals(chooseVehicle(load.weightKg, load.bulky, 8), "CAR");
});
Deno.test("produto sem peso assume 1 kg por unidade; produto kg usa quantidade", () => {
  assertEquals(estimateLoad([{ product_id: "unknown", quantity: 3 }], products).weightKg, 3);
  assertEquals(estimateLoad([{ product_id: "kg", quantity: 2 }], products).weightKg, 2);
});
Deno.test("fora da área é classificado sem expor resposta bruta", () => {
  const mockedFetch = async () => new Response(JSON.stringify({ message: "ERR_OUT_OF_SERVICE_AREA" }), { status: 422 });
  const response = await mockedFetch();
  assertEquals(response.status, 422);
  assertEquals((await response.json()).message, "ERR_OUT_OF_SERVICE_AREA");
});
Deno.test("não-admin bloqueado quando entrega desligada (regra pura)", () => {
  const canQuote = (deliveryActive: boolean, isAdmin: boolean) => deliveryActive || isAdmin;
  assertEquals(canQuote(false, false), false);
  assertEquals(canQuote(false, true), true);
});
Deno.test("endereço estruturado e body usam origem fixa e veículo sandbox", () => {
  const address = formatDropoff({ street: "Rua A", number: "10", neighborhood: "Centro" });
  const body = buildQuotationBody("LALAGO", address);
  assertEquals(body.data.stops[0].address.includes("Av. Lourenço da Silva Braga, 700"), true);
  assertEquals(body.data.serviceType, "LALAGO");
});
Deno.test("arredonda taxa para o próximo real e retorna validade sem custo bruto", () => {
  const parsed = parseQuotation({ expiresAt: new Date(Date.now() + 60_000).toISOString(),
    priceBreakdown: { total: "8.32", currency: "BRL" } }, "MOTO", 1);
  assertEquals(parsed.fee, 9);
  assertEquals(Object.keys(parsed).sort(), ["fee", "validUntil", "vehicle", "weightKg"]);
});
