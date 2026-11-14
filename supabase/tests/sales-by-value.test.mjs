import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateLineTotalCents,
  calculateQuantityFromValueCents,
  calculateValueLineTotalCents,
  isValidSalesQuantity,
  isValidValueSale,
  isValueSaleEnabled,
} from "../functions/_shared/sales-rules.js";

const kgRule = {
  sale_unit: "kg",
  quantity_step: 0.5,
  min_quantity: 0.5,
  max_quantity: 100,
};

test("modo por kg mantém mínimo de 0,5 kg e passo de 0,5 kg", () => {
  assert.equal(isValidSalesQuantity(0.5, kgRule, "kg"), true);
  assert.equal(isValidSalesQuantity(1, kgRule, "kg"), true);
  assert.equal(isValidSalesQuantity(0.25, kgRule, "kg"), false);
  assert.equal(isValidSalesQuantity(0.75, kgRule, "kg"), false);
});

test("modo por valor aceita peso calculado abaixo de 0,5 kg e fora do passo", () => {
  assert.equal(isValidSalesQuantity(0.263, kgRule, "value"), true);
  assert.equal(isValidSalesQuantity(0.001, kgRule, "value"), true);
  assert.equal(isValidSalesQuantity(0.2631, kgRule, "value"), false);
  assert.equal(isValidSalesQuantity(100.001, kgRule, "value"), false);
});

test("R$ 5,00 a R$ 18,99/kg calcula 0,263 kg em três casas", () => {
  assert.equal(calculateQuantityFromValueCents(500, 1899, 100), 0.263);
});

test("valor exato não é recalculado a partir do peso arredondado", () => {
  const qty = calculateQuantityFromValueCents(500, 1899, 100);
  assert.equal(calculateLineTotalCents(1899, qty), 499);
  assert.equal(calculateValueLineTotalCents(500, 500, qty, kgRule), 500);
});

test("modo por valor aplica mínimo em reais e não o mínimo em kg", () => {
  const qty = calculateQuantityFromValueCents(500, 1899, 100);
  assert.equal(isValidValueSale(500, 500, qty, kgRule), true);
  assert.equal(isValidValueSale(499, 500, qty, kgRule), false);
  assert.equal(calculateValueLineTotalCents(499, 500, qty, kgRule), null);
});

test("100 kg é o limite máximo e valores acima são recusados", () => {
  assert.equal(calculateQuantityFromValueCents(189900, 1899, 100), 100);
  assert.equal(calculateQuantityFromValueCents(190000, 1899, 100), null);
  assert.equal(isValidSalesQuantity(100, kgRule, "value"), true);
  assert.equal(isValidSalesQuantity(100.001, kgRule, "value"), false);
});

test("preço de revenda é usado para calcular o peso quando o limite é atingido", () => {
  assert.equal(calculateQuantityFromValueCents(10000, 1000, 100), 10);
  assert.equal(calculateQuantityFromValueCents(10000, 800, 100), 12.5);
});

test("unidade comercial palma aceita quantidades inteiras e rejeita frações", () => {
  const palmaRule = { sale_unit: "maco", quantity_step: 1, min_quantity: 1, max_quantity: 100 };
  assert.equal(isValidSalesQuantity(1, palmaRule, "kg"), true);
  assert.equal(isValidSalesQuantity(2, palmaRule, "kg"), true);
  assert.equal(isValidSalesQuantity(1.5, palmaRule, "kg"), false);
});

test("modo por valor é recusado para produtos que não são vendidos por kg", () => {
  const unitRule = { sale_unit: "un", quantity_step: 1, min_quantity: 1, max_quantity: 100 };
  assert.equal(isValidSalesQuantity(1, unitRule, "value"), false);
  assert.equal(calculateValueLineTotalCents(500, 500, 1, unitRule), null);
});


test("compra por valor exige autorização individual explícita e produto por kg", () => {
  assert.equal(isValueSaleEnabled({ sale_unit: "kg" }), false);
  assert.equal(isValueSaleEnabled({ sale_unit: "kg", allow_value_sale: false }), false);
  assert.equal(isValueSaleEnabled({ sale_unit: "kg", allow_value_sale: true }), true);
  assert.equal(isValueSaleEnabled({ sale_unit: "un", allow_value_sale: true }), false);
  assert.equal(isValueSaleEnabled(null), false);
});
