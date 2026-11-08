import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateLineTotalCents,
  isValidSalesQuantity,
  selectEffectiveUnitPriceCents,
  sumDecimalQuantities,
} from "./sales-rules.js";

const halfKgRule = {
  sale_unit: "kg",
  quantity_step: 0.5,
  min_quantity: 0.5,
  max_quantity: 100,
};

test("0.5 kg × R$ 10,99 rounds half cent upward to R$ 5,50", () => {
  assert.equal(isValidSalesQuantity(0.5, halfKgRule), true);
  assert.equal(calculateLineTotalCents(1099, 0.5), 550);
});

test("10.5 kg uses resale price R$ 38,00 and totals R$ 399,00", () => {
  assert.equal(isValidSalesQuantity(10.5, halfKgRule), true);
  const effective = selectEffectiveUnitPriceCents(4500, 3800, true, 10, 10.5);
  assert.equal(effective, 3800);
  assert.equal(calculateLineTotalCents(effective, 10.5), 39900);
});

test("whole quantities 1 and 2 remain valid without a rule", () => {
  assert.equal(isValidSalesQuantity(1), true);
  assert.equal(isValidSalesQuantity(2), true);
  assert.equal(calculateLineTotalCents(1099, 1), 1099);
  assert.equal(calculateLineTotalCents(1099, 2), 2198);
});

test("0.3 is rejected because it is not a multiple of 0.5", () => {
  assert.equal(isValidSalesQuantity(0.3, halfKgRule), false);
});

test("101 is rejected above the configured maximum", () => {
  assert.equal(isValidSalesQuantity(101, halfKgRule), false);
  assert.equal(isValidSalesQuantity(101), false);
});

test("a product without a rule still rejects 0.5", () => {
  assert.equal(isValidSalesQuantity(0.5), false);
});

test("duplicate decimal quantities are summed using integer decimal arithmetic", () => {
  assert.equal(sumDecimalQuantities([0.1, 0.2]), 0.3);
  assert.equal(sumDecimalQuantities([0.5, 0.5]), 1);
});
