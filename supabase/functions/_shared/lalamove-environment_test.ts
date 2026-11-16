import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  lalamoveBaseUrl, lalamoveCredentialNames, normalizeLalamoveEnvironment,
  readLalamoveCredentials,
} from "./lalamove-environment.ts";

Deno.test("ambiente sandbox seleciona endpoint e secrets de teste", () => {
  assertEquals(lalamoveBaseUrl("sandbox"), "https://rest.sandbox.lalamove.com");
  assertEquals(lalamoveCredentialNames("sandbox"), {
    key: "LALAMOVE_SANDBOX_API_KEY", secret: "LALAMOVE_SANDBOX_API_SECRET",
  });
  assertEquals(readLalamoveCredentials("sandbox", (name) => ({
    LALAMOVE_SANDBOX_API_KEY: "pk_test_mock",
    LALAMOVE_SANDBOX_API_SECRET: "sk_test_mock",
  } as Record<string, string>)[name]).baseUrl, "https://rest.sandbox.lalamove.com");
});

Deno.test("ambiente producao seleciona endpoint e secrets live", () => {
  assertEquals(lalamoveBaseUrl("producao"), "https://rest.lalamove.com");
  assertEquals(lalamoveCredentialNames("producao"), {
    key: "LALAMOVE_PROD_API_KEY", secret: "LALAMOVE_PROD_API_SECRET",
  });
  assertEquals(readLalamoveCredentials("producao", (name) => ({
    LALAMOVE_PROD_API_KEY: "pk_live_mock",
    LALAMOVE_PROD_API_SECRET: "sk_live_mock",
  } as Record<string, string>)[name]).baseUrl, "https://rest.lalamove.com");
});

Deno.test("credenciais live ausentes geram erro claro e não recorrem ao sandbox", () => {
  let code = "";
  try { readLalamoveCredentials("producao", () => undefined); }
  catch (error) { code = error instanceof Error ? error.message : ""; }
  assertEquals(code, "PRODUCTION_CREDENTIALS_REQUIRED");
});

Deno.test("ambiente inválido não é convertido silenciosamente em sandbox", () => {
  let code = "";
  try { normalizeLalamoveEnvironment("live"); }
  catch (error) { code = error instanceof Error ? error.message : ""; }
  assertEquals(code, "INVALID_LALAMOVE_ENVIRONMENT");
});
