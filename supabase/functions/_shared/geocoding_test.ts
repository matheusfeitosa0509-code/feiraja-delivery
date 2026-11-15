import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  formatManausGeocodeQuery, geocodeManausAddress, validateManausGeocodeResult,
} from "./geocoding.ts";

const validResult = (lat = -3.10, lng = -60.02) => ({
  types: ["street_address"],
  address_components: [
    { long_name: "Manaus", short_name: "Manaus", types: ["locality", "political"] },
    { long_name: "Amazonas", short_name: "AM", types: ["administrative_area_level_1", "political"] },
    { long_name: "Brasil", short_name: "BR", types: ["country", "political"] },
  ],
  geometry: { location: { lat, lng } },
});

Deno.test("consulta sempre completa o endereço com Manaus - AM, Brasil", () => {
  assertEquals(formatManausGeocodeQuery("Rua Japiassu, 140 - Viver Melhor 2"), "Rua Japiassu, 140 - Viver Melhor 2, Manaus - AM, Brasil");
  assertEquals(formatManausGeocodeQuery("Rua A, 1, Manaus - AM"), "Rua A, 1, Manaus - AM, Brasil");
  assertEquals(formatManausGeocodeQuery("Rua A, 1, Manaus - AM, Brasil"), "Rua A, 1, Manaus - AM, Brasil");
});

Deno.test("aceita coordenadas de endereço em Manaus e devolve lat/lng como texto", () => {
  assertEquals(validateManausGeocodeResult(validResult()), { lat: "-3.1", lng: "-60.02" });
});

Deno.test("rejeita resultados fora de Manaus mesmo dentro do Brasil", () => {
  const result = validResult(-3.1, -60.02);
  result.address_components[0].long_name = "Iranduba";
  assertThrows(() => validateManausGeocodeResult(result), Error, "ADDRESS_OUTSIDE_MANAUS");
});

Deno.test("rejeita coordenadas fora dos limites de Manaus", () => {
  assertThrows(() => validateManausGeocodeResult(validResult(-3.9, -60.02)), Error, "ADDRESS_OUTSIDE_MANAUS");
});

Deno.test("ZERO_RESULTS vira endereço não encontrado", async () => {
  const fetcher = async () => new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 });
  await assertRejects(() => geocodeManausAddress("Rua Inexistente, 1", "google-test", fetcher), Error, "ADDRESS_NOT_FOUND");
});

Deno.test("erro do Google não vaza chave e vira indisponibilidade do geocodificador", async () => {
  const fetcher = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assertEquals(url.searchParams.get("key"), "google-test");
    return new Response(JSON.stringify({ status: "REQUEST_DENIED", results: [] }), { status: 200 });
  };
  await assertRejects(() => geocodeManausAddress("Rua A, 1", "google-test", fetcher), Error, "GEOCODER_UNAVAILABLE");
});

Deno.test("sem chave Google não tenta consulta externa", async () => {
  let called = false;
  const fetcher = async () => { called = true; return new Response("{}"); };
  await assertRejects(() => geocodeManausAddress("Rua A, 1", "", fetcher), Error, "GEOCODER_NOT_CONFIGURED");
  assertEquals(called, false);
});

Deno.test("não aceita somente o centro da rua como se fosse número residencial exato", () => {
  const result = validResult();
  result.types = ["route"];
  assertThrows(() => validateManausGeocodeResult(result), Error, "ADDRESS_NOT_FOUND");
});
