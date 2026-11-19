export function generatePickupCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 10_000).padStart(4, "0");
}
