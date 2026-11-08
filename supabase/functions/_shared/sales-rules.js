// Shared pure rules for sales quantities and line totals.
// Keep this module browser-compatible so the store can reuse it in Fase 2B.

function decimalParts(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;

  const raw = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return null;

  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] || "";
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 9) return null;

  let scale = fraction.length - exponent;
  let coefficient = BigInt((match[2] + fraction) || "0") * sign;

  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  if (scale > 9) return null;

  return { coefficient, scale };
}

function alignDecimal(parts, scale) {
  return parts.coefficient * (10n ** BigInt(scale - parts.scale));
}

export function sumDecimalQuantities(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const parts = values.map(decimalParts);
  if (parts.some((part) => part === null)) return null;

  const scale = Math.max(...parts.map((part) => part.scale));
  if (scale > 9) return null;

  const total = parts.reduce((sum, part) => sum + alignDecimal(part, scale), 0n);
  const result = Number(total) / (10 ** scale);
  return Number.isFinite(result) && result > 0 ? result : null;
}

export function isValidSalesQuantity(quantity, rule = null) {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) return false;

  if (!rule) {
    return Number.isInteger(quantity) && quantity >= 1 && quantity <= 100;
  }

  const qtyParts = decimalParts(quantity);
  const stepParts = decimalParts(rule.quantity_step);
  const minParts = decimalParts(rule.min_quantity);
  const maxParts = decimalParts(rule.max_quantity);
  if (!qtyParts || !stepParts || !minParts || !maxParts) return false;

  const scale = Math.max(
    qtyParts.scale,
    stepParts.scale,
    minParts.scale,
    maxParts.scale,
  );
  if (scale > 9) return false;

  const qty = alignDecimal(qtyParts, scale);
  const step = alignDecimal(stepParts, scale);
  const minimum = alignDecimal(minParts, scale);
  const maximum = alignDecimal(maxParts, scale);

  return step > 0n &&
    minimum > 0n &&
    maximum >= minimum &&
    qty >= minimum &&
    qty <= maximum &&
    qty % step === 0n;
}

export function selectEffectiveUnitPriceCents(
  normalPriceCents,
  resalePriceCents,
  resaleEnabled,
  resaleMinQty,
  quantity,
) {
  return resaleEnabled === true && quantity >= resaleMinQty
    ? resalePriceCents
    : normalPriceCents;
}

export function calculateLineTotalCents(effectiveUnitPriceCents, quantity) {
  if (!Number.isSafeInteger(effectiveUnitPriceCents) || effectiveUnitPriceCents < 0) {
    return null;
  }
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  const lineTotalCents = Math.round(effectiveUnitPriceCents * quantity);
  return Number.isSafeInteger(lineTotalCents) ? lineTotalCents : null;
}
