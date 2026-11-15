import { assertEquals } from "jsr:@std/assert@1.0.14";

Deno.test("proxy usa Places API New, restrição geográfica e token de sessão", async () => {
  const source = await Deno.readTextFile("supabase/functions/delivery-address/index.ts");
  for (const required of [
    "https://places.googleapis.com/v1/places:autocomplete",
    "https://places.googleapis.com/v1/places/",
    "sessionToken", "includedRegionCodes: [\"br\"]", "locationRestriction",
    "GOOGLE_PLACES_API_KEY", "GOOGLE_GEOCODING_API_KEY",
    "authData.user.is_anonymous", "consume_delivery_quote_rate_limit",
  ]) assertEquals(source.includes(required), true, "missing proxy guard: " + required);
});

Deno.test("proxy não retorna nem grava a chave Google no navegador", async () => {
  const source = await Deno.readTextFile("supabase/functions/delivery-address/index.ts");
  assertEquals(source.includes("X-Goog-Api-Key"), true);
  assertEquals(source.includes("apiKey:") || source.includes("google_key:"), false);
  assertEquals(source.includes("console.error(\"google_places\", { stage: \"autocomplete\", http_status:"), true);
});
