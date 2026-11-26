import { assertEquals } from "jsr:@std/assert@1.0.14";

Deno.test("proxy usa Places API New, restrição geográfica e token de sessão", async () => {
  const source = await Deno.readTextFile("supabase/functions/delivery-address/index.ts");
  for (const required of [
    "https://places.googleapis.com/v1/places:autocomplete",
    "https://places.googleapis.com/v1/places/",
    "sessionToken", "includedRegionCodes: [\"br\"]", "locationBias", "radius: 30000",
    "GOOGLE_PLACES_API_KEY", "GOOGLE_GEOCODING_API_KEY",
    "allowAddressRequest", "current.count <= 30", "displayName", "place.displayName?.text",
  ]) assertEquals(source.includes(required), true, "missing proxy guard: " + required);
});

Deno.test("proxy não retorna nem grava a chave Google no navegador", async () => {
  const source = await Deno.readTextFile("supabase/functions/delivery-address/index.ts");
  assertEquals(source.includes("X-Goog-Api-Key"), true);
  assertEquals(source.includes("apiKey:") || source.includes("google_key:"), false);
  assertEquals(source.includes("console.error(\"google_places\", { stage: \"autocomplete\", http_status:"), true);
});

Deno.test("Places usa viés de Manaus e não exige número de rua para pontos de interesse", async () => {
  const source = await Deno.readTextFile("supabase/functions/delivery-address/index.ts");
  assertEquals(source.includes("locationBias: { circle:"), true);
  assertEquals(source.includes("locationRestriction"), false);
  assertEquals(source.includes("place.displayName?.text"), true);
  assertEquals(source.includes("street_number"), true);
});

