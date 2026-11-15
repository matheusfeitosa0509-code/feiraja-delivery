import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { chooseVehicle, estimateLoad, formatDropoff, isQuoteAllowed, parseQuotation, requestSandboxQuotation } from "../_shared/delivery-quote.ts";
import { geocodeManausAddress } from "../_shared/geocoding.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const SANDBOX_URL = "https://rest.sandbox.lalamove.com";
const PATH = "/v3/quotations";
const ORIGIN = "Av. Lourenço da Silva Braga, 700 - Centro, Manaus - AM, Brasil";

async function signRequest(key: string, secret: string, body: string) {
  const timestamp = String(Date.now());
  const raw = timestamp + "\r\nPOST\r\n" + PATH + "\r\n\r\n" + body;
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
  return { timestamp, authorization: "hmac " + key + ":" + timestamp + ":" + hex };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Configuração interna incompleta." }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!accessToken) return json({ error: "Sessão necessária." }, 401);
    const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(accessToken);
    if (authError || !authData?.user || authData.user.is_anonymous) return json({ error: "Sessão válida necessária." }, 401);

    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: adminRow, error: adminError }, { data: settings, error: settingsError }] = await Promise.all([
      db.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle(),
      db.from("delivery_settings").select("delivery_ativa,moto_limite_kg").eq("singleton", true).maybeSingle(),
    ]);
    if (adminError || settingsError) return json({ error: "Não foi possível validar a configuração de entrega." }, 500);
    const isAdmin = !!adminRow;
    if (!isQuoteAllowed(settings?.delivery_ativa === true, isAdmin)) return json({ error: "Entrega indisponível." }, 403);

    const { data: allowed, error: rateError } = await db.rpc("consume_delivery_quote_rate_limit", {
      p_user_id: authData.user.id, p_max_requests: 5, p_window_seconds: 60,
    });
    if (rateError) return json({ error: "Limite de cotações temporariamente indisponível." }, 503);
    if (allowed !== true) return json({ error: "Muitas cotações. Aguarde um minuto." }, 429);

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Requisição inválida." }, 400);
    const dropoff = formatDropoff(body.address);
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) return json({ error: "Carrinho inválido." }, 400);
    const ids: string[] = [...new Set<string>(body.items.map((i: any) => String(i?.product_id || "")))];
    if (ids.some((id) => !id || id.length > 100)) return json({ error: "Carrinho inválido." }, 400);
    const [{ data: products, error: productsError }, { data: rules, error: rulesError }] = await Promise.all([
      db.from("products").select("id,delivery_unit_weight_kg,delivery_bulky").in("id", ids),
      db.from("product_sales_rules").select("product_id,sale_unit").in("product_id", ids),
    ]);
    if (productsError || rulesError || !products || products.length !== ids.length) return json({ error: "Não foi possível validar os produtos do carrinho." }, 400);
    const saleUnits = new Map((rules || []).map((r: any) => [r.product_id, r.sale_unit]));
    const load = estimateLoad(body.items, products.map((p: any) => ({
      id: p.id, delivery_unit_weight_kg: p.delivery_unit_weight_kg == null ? null : Number(p.delivery_unit_weight_kg),
      delivery_bulky: p.delivery_bulky === true, sale_unit: saleUnits.get(p.id) || null,
    })));
    const vehicle = chooseVehicle(load.weightKg, load.bulky, Number(settings?.moto_limite_kg || 8));
    const apiKey = Deno.env.get("LALAMOVE_SANDBOX_API_KEY") || "";
    const apiSecret = Deno.env.get("LALAMOVE_SANDBOX_API_SECRET") || "";
    if (!apiKey.startsWith("pk_test") || !apiSecret.startsWith("sk_test")) {
      return json({ error: "Credenciais Lalamove Sandbox ausentes ou inválidas." }, 503);
    }
    const serviceType = vehicle === "MOTO" ? "LALAGO" : "CAR";
    const geocodingKey = Deno.env.get("GOOGLE_GEOCODING_API_KEY") || "";
    const [originCoordinates, dropoffCoordinates] = await Promise.all([
      geocodeManausAddress(ORIGIN, geocodingKey),
      geocodeManausAddress(dropoff, geocodingKey),
    ]);
    const response = await requestSandboxQuotation(apiKey, apiSecret, serviceType, dropoff, {
      origin: originCoordinates, dropoff: dropoffCoordinates,
    });
    const result = await response.json().catch(() => ({}));
    const upstreamCode = String(result?.message || "");
    if (upstreamCode === "ERR_OUT_OF_SERVICE_AREA") {
      return json({ error: "Endereço localizado, mas a Lalamove não atende esta região.", code: "LALAMOVE_OUT_OF_SERVICE_AREA" }, 422);
    }
    if (upstreamCode === "ERR_REVERSE_GEOCODE_FAILURE") {
      console.error("delivery-quote", { stage: "lalamove_quote", status: response.status, code: "ERR_REVERSE_GEOCODE_FAILURE" });
      return json({ error: "A Lalamove não conseguiu validar a rota mesmo com as coordenadas. Tente novamente.", code: "LALAMOVE_REVERSE_GEOCODE_FAILURE" }, 502);
    }
    if (!response.ok) {
      const code = response.status === 429 ? "LALAMOVE_RATE_LIMIT" : "LALAMOVE_QUOTE_FAILED";
      console.error("delivery-quote", { stage: "lalamove_quote", status: response.status, code: upstreamCode.slice(0, 80) || code });
      return json({ error: "A localização foi encontrada, mas a Lalamove não concluiu a cotação. Tente novamente.", code }, response.status === 429 ? 429 : 502);
    }
    const quote = parseQuotation(result?.data, vehicle, load.weightKg);
    return json({ vehicle: quote.vehicle, estimated_weight_kg: quote.weightKg, fee: quote.fee, valid_until: quote.validUntil });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "INVALID_ADDRESS") return json({ error: "Informe rua, número e bairro.", code }, 400);
    if (code === "ADDRESS_NOT_FOUND") return json({ error: "Endereço não encontrado. Confira a rua, o número e o bairro.", code }, 400);
    if (code === "ADDRESS_OUTSIDE_MANAUS") return json({ error: "Este endereço fica fora de Manaus - AM. Informe um endereço dentro de Manaus.", code }, 422);
    if (code === "GEOCODER_NOT_CONFIGURED") return json({ error: "Serviço de localização não configurado. Falta o Secret GOOGLE_GEOCODING_API_KEY no Supabase.", code }, 503);
    if (code === "GEOCODER_UNAVAILABLE") return json({ error: "Não foi possível localizar o endereço agora. Tente novamente em instantes.", code }, 503);
    if (code === "INVALID_ITEMS") return json({ error: "Itens ou quantidades inválidos.", code }, 400);
    if (code === "INVALID_QUOTE_PRICE" || code === "INVALID_QUOTE_RESPONSE") return json({ error: "Resposta de cotação inválida." }, 502);
    console.error("delivery-quote", { stage: "request", code });
    return json({ error: "Erro interno ao calcular a entrega." }, 500);
  }
});
