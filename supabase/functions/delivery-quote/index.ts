import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { readLalamoveCredentials, readLalamoveEnvironment } from "../_shared/lalamove-environment.ts";
import { chooseVehicle, classifyLalamoveQuoteError, estimateLoad, expandKitQuoteItems, formatDropoff, isQuoteAllowed, parseQuotation, requestSandboxQuotation, retryLalamove429, startParallelVehicleQuotes } from "../_shared/delivery-quote.ts";
import { geocodeManausAddress, resolveDeliveryCoordinates } from "../_shared/geocoding.ts";
import { getCommercialSchedule } from "../_shared/commercial-calendar.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const PATH = "/v3/quotations";
const ORIGIN = "Av. Lourenço da Silva Braga, 700 - Centro, Manaus - AM, Brasil";
let originCoordinatesPromise: Promise<{ lat: string; lng: string }> | null = null;

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
  const requestStarted = performance.now();
  const timings: Record<string, number> = {};

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const authStarted = performance.now();
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
    timings.auth_ms = Math.round(performance.now() - authStarted);

    const accessStarted = performance.now();
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: adminRow, error: adminError }, { data: settings, error: settingsError }] = await Promise.all([
      db.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle(),
      db.from("delivery_settings").select("delivery_ativa,moto_limite_kg,lalamove_ambiente").eq("singleton", true).maybeSingle(),
    ]);
    if (adminError || settingsError) return json({ error: "Não foi possível validar a configuração de entrega." }, 500);
    const isAdmin = !!adminRow;
    if (!isQuoteAllowed(settings?.delivery_ativa === true, isAdmin)) return json({ error: "Entrega indisponível." }, 403);
    timings.access_ms = Math.round(performance.now() - accessStarted);

    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Requisição inválida." }, 400);
    const dropoff = formatDropoff(body.address);
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) return json({ error: "Carrinho inválido." }, 400);
    const normalizedCart = body.items.map((item: any) => {
      const rawId = String(item?.product_id || item?.id || "");
      const prefixedKitId = rawId.match(/^kit:([0-9a-f-]{36})$/i)?.[1] || "";
      const kitId = String(item?.kit_id || prefixedKitId ||
        ((item?.is_kit === true || String(item?.type || "").toLowerCase() === "kit" ||
          String(item?.sale_mode || "").toLowerCase() === "kit") ? rawId : ""));
      const quantity = Number(item?.quantity ?? item?.qty ?? 1);
      return { productId: rawId, kitId, quantity };
    });
    if (normalizedCart.some((item: any) => !item.productId || item.productId.length > 100 ||
      !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1000)) {
      return json({ error: "Carrinho inválido." }, 400);
    }
    const kitCart = normalizedCart.filter((item: any) => !!item.kitId);
    const regularCart = normalizedCart.filter((item: any) => !item.kitId);
    const kitIds = [...new Set<string>(kitCart.map((item: any) => item.kitId))];
    if (kitIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return json({ error: "Kit inválido no carrinho." }, 400);

    const productsStarted = performance.now();
    let expandedItems: Array<{ product_id: string; quantity: number }> = regularCart.map((item: any) => ({
      product_id: item.productId, quantity: item.quantity,
    }));
    if (kitIds.length) {
      const { data: kitRows, error: kitItemsError } = await db.from("daily_recipe_kit_items")
        .select("kit_id,product_id,quantity").in("kit_id", kitIds);
      if (kitItemsError || !kitRows?.length || kitIds.some((id) =>
        !kitRows.some((component: any) => String(component.kit_id) === id))) {
        return json({ error: "Não foi possível validar a composição do kit para calcular a entrega." }, 400);
      }
      try {
        expandedItems = expandKitQuoteItems(normalizedCart.map((item: any) => ({
          product_id: item.productId, kit_id: item.kitId || null, quantity: item.quantity,
        })), kitRows);
      } catch {
        return json({ error: "Composição de kit inválida para calcular a entrega." }, 400);
      }
    }
    const ids: string[] = [...new Set<string>(expandedItems.map((item) => item.product_id))];
    if (!ids.length || ids.some((id) => !id || id.length > 100)) return json({ error: "Carrinho inválido." }, 400);
    const [{ data: products, error: productsError }, { data: rules, error: rulesError }] = await Promise.all([
      db.from("products").select("id,delivery_unit_weight_kg,delivery_bulky").in("id", ids),
      db.from("product_sales_rules").select("product_id,sale_unit").in("product_id", ids),
    ]);
    if (productsError || rulesError || !products || products.length !== ids.length) return json({ error: "Não foi possível validar os produtos do carrinho." }, 400);
    const saleUnits = new Map((rules || []).map((r: any) => [String(r.product_id), r.sale_unit]));
    const load = estimateLoad(expandedItems, products.map((p: any) => ({
      id: String(p.id), delivery_unit_weight_kg: p.delivery_unit_weight_kg == null ? null : Number(p.delivery_unit_weight_kg),
      delivery_bulky: p.delivery_bulky === true, sale_unit: saleUnits.get(String(p.id)) || null,
    })));
    const vehicle = chooseVehicle(load.weightKg, load.bulky, Number(settings?.moto_limite_kg || 12));
    timings.products_weight_ms = Math.round(performance.now() - productsStarted);
    const rateStarted = performance.now();
    const { data: allowed, error: rateError } = await db.rpc("consume_delivery_quote_rate_limit", {
      p_user_id: authData.user.id, p_max_requests: 30, p_window_seconds: 60,
    });
    if (rateError) return json({ error: "Limite de cotações temporariamente indisponível. Tente novamente em instantes.", code: "QUOTE_RATE_LIMIT_UNAVAILABLE" }, 503);
    if (allowed !== true) return json({ error: "Muitas consultas agora, tente em alguns segundos.", code: "QUOTE_RATE_LIMIT" }, 429);
    timings.rate_limit_ms = Math.round(performance.now() - rateStarted);

    const environmentStarted = performance.now();
    const environment = await readLalamoveEnvironment(db);
    const credentials = readLalamoveCredentials(environment, (name) => Deno.env.get(name));
    const { apiKey, apiSecret } = credentials;
    timings.environment_ms = Math.round(performance.now() - environmentStarted);
    const geocodingKey = Deno.env.get("GOOGLE_GEOCODING_API_KEY") || "";
    const geocodingStarted = performance.now();
    if (!originCoordinatesPromise) originCoordinatesPromise = geocodeManausAddress(ORIGIN, geocodingKey);
    const originPromise = originCoordinatesPromise;
    void originPromise.catch(() => {
      if (originCoordinatesPromise === originPromise) originCoordinatesPromise = null;
    });
    const [dropoffCoordinates, originCoordinates] = await Promise.all([
      resolveDeliveryCoordinates(
        dropoff,
        body.coordinates && typeof body.coordinates === "object" ? body.coordinates : null,
        (address) => geocodeManausAddress(address, geocodingKey),
      ),
      originPromise,
    ]);
    timings.geocoding_ms = Math.round(performance.now() - geocodingStarted);
    const quoteFetch: typeof fetch = (input, init) => retryLalamove429(fetch, input, init);
    const scheduleAt = getCommercialSchedule().scheduledFor || undefined;
    const quoteVehicle = async (requestedVehicle: "MOTO" | "CAR") => {
      const stageStarted = performance.now();
      try {
        const response = await requestSandboxQuotation(apiKey, apiSecret,
          requestedVehicle === "MOTO" ? "LALAGO" : "CAR", dropoff,
          { origin: originCoordinates, dropoff: dropoffCoordinates },
          quoteFetch, environment, scheduleAt);
        const responseBody = await response.text();
        let result: any = {};
        try { result = JSON.parse(responseBody); } catch { result = {}; }
        const elapsed = Math.round(performance.now() - stageStarted);
        const stage = requestedVehicle === "MOTO" ? "lalamove_moto_ms" : "lalamove_car_ms";
        timings[stage] = elapsed;
        console.info("delivery-quote-stage", { stage, duration_ms: elapsed, status: response.status });
        return { response, responseBody, result, quote: response.ok ? parseQuotation(result?.data, requestedVehicle, load.weightKg) : null };
      } catch (error) {
        const elapsed = Math.round(performance.now() - stageStarted);
        const stage = requestedVehicle === "MOTO" ? "lalamove_moto_ms" : "lalamove_car_ms";
        timings[stage] = elapsed;
        console.info("delivery-quote-stage", { stage, duration_ms: elapsed, error: error instanceof Error ? error.message : "UNKNOWN" });
        throw error;
      }
    };
    const parallelQuotes = startParallelVehicleQuotes(vehicle, quoteVehicle);
    void parallelQuotes.background.catch((error) => {
      console.warn("delivery-quote-background-vehicle", {
        vehicle: vehicle === "MOTO" ? "CAR" : "MOTO",
        error: error instanceof Error ? error.message : "UNKNOWN",
      });
    });
    const selectedQuote = await parallelQuotes.selected;
    const { response, responseBody, result } = selectedQuote;
    const upstreamFailure = classifyLalamoveQuoteError(response.status, result);
    const upstreamCode = upstreamFailure.upstreamCode;
    if (upstreamCode === "ERR_OUT_OF_SERVICE_AREA") {
      return json({ error: "Endereço localizado, mas a Lalamove não atende esta região.", code: "LALAMOVE_OUT_OF_SERVICE_AREA" }, 422);
    }
    if (upstreamCode === "ERR_INVALID_SCHEDULE_TIME") {
      console.error("delivery-quote", { stage: "lalamove_quote", status: response.status, upstream_message: upstreamCode });
      return json({ error: "A Lalamove recusou o horário agendado. Tente novamente em instantes.", code: "LALAMOVE_INVALID_SCHEDULE_TIME" }, 502);
    }
    if (upstreamCode === "ERR_INVALID_SERVICE_TYPE") {
      console.error("delivery-quote", { stage: "lalamove_quote", status: response.status, upstream_message: upstreamCode });
      return json({ error: "A Lalamove não oferece o tipo de veículo selecionado para esta rota. Tente novamente ou escolha retirada.", code: "LALAMOVE_INVALID_SERVICE_TYPE" }, 422);
    }
    if (upstreamCode === "ERR_INVALID_MARKET") {
      console.error("delivery-quote", { stage: "lalamove_quote", status: response.status, upstream_message: upstreamCode });
      return json({ error: "A Lalamove não reconheceu a região de atendimento desta rota. Confira o endereço.", code: "LALAMOVE_INVALID_MARKET" }, 422);
    }
    if (upstreamCode === "ERR_REVERSE_GEOCODE_FAILURE") {
      console.error("delivery-quote", { stage: "lalamove_quote", status: response.status, code: "ERR_REVERSE_GEOCODE_FAILURE" });
      return json({ error: "A Lalamove não conseguiu validar a rota mesmo com as coordenadas. Tente novamente.", code: "LALAMOVE_REVERSE_GEOCODE_FAILURE" }, 502);
    }
    if (!response.ok) {
      const code = upstreamFailure.code;
      const messages: Record<string, string> = {
        LALAMOVE_INVALID_COORDINATES: "Não foi possível validar o ponto marcado no mapa. Ajuste o pino e tente novamente.",
        LALAMOVE_INVALID_ADDRESS: "Endereço não encontrado. Confira rua, número e bairro.",
        LALAMOVE_INVALID_REQUEST: "A Lalamove recusou os dados do endereço ou da rota. Revise rua, número e ponto do mapa.",
        LALAMOVE_RATE_LIMIT: "Muitas consultas agora, tente em alguns segundos.",
      };
      // Corpo integral: necessário para diagnosticar respostas inesperadas do provedor.
      console.error("delivery-quote", {
        stage: "lalamove_quote", status: response.status,
        upstream_code: upstreamCode || null, upstream_detail: upstreamFailure.detail || null,
        upstream_body: responseBody, code,
      });
      return json({ error: messages[code] || "Não foi possível calcular a entrega por um erro inesperado. Tente novamente.", code },
        response.status === 429 ? 429 : response.status === 422 ? 422 : 502);
    }
    const quote = selectedQuote.quote || parseQuotation(result?.data, vehicle, load.weightKg);
    return json({ vehicle: quote.vehicle, estimated_weight_kg: quote.weightKg, fee: quote.fee, valid_until: quote.validUntil, schedule_at: scheduleAt || null, ambiente: environment });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "INVALID_SCHEDULE_TIME") return json({ error: "Não foi possível agendar a cotação para o próximo horário de funcionamento. Tente novamente.", code }, 502);
    if (code === "INVALID_ADDRESS") return json({ error: "Informe rua, número e bairro.", code }, 400);
    if (code === "ADDRESS_NOT_FOUND") return json({ error: "Endereço não encontrado. Confira a rua, o número e o bairro.", code }, 400);
    if (code === "ADDRESS_OUTSIDE_MANAUS") return json({ error: "Este endereço fica fora de Manaus - AM. Informe um endereço dentro de Manaus.", code }, 422);
    if (code === "PRODUCTION_CREDENTIALS_REQUIRED") return json({ error: "Credenciais Lalamove de produção ausentes ou inválidas. Configure LALAMOVE_PROD_API_KEY e LALAMOVE_PROD_API_SECRET no Supabase; nenhuma cobrança foi criada.", code }, 503);
    if (code === "SANDBOX_CREDENTIALS_REQUIRED") return json({ error: "Credenciais Sandbox da Lalamove ausentes ou inválidas. Verifique LALAMOVE_SANDBOX_API_KEY e LALAMOVE_SANDBOX_API_SECRET no Supabase.", code }, 503);
    if (code === "LALAMOVE_ENVIRONMENT_UNAVAILABLE") return json({ error: "Não foi possível ler o ambiente Lalamove configurado. Tente novamente.", code }, 503);
    if (code === "INVALID_LALAMOVE_ENVIRONMENT") return json({ error: "O ambiente da Lalamove está inválido. Verifique a configuração no painel.", code }, 503);
    if (code === "GEOCODER_NOT_CONFIGURED") return json({ error: "Serviço de localização não configurado. Falta o Secret GOOGLE_GEOCODING_API_KEY no Supabase.", code }, 503);
    if (code === "GEOCODER_UNAVAILABLE") return json({ error: "Não foi possível localizar o endereço agora. Tente novamente em instantes.", code }, 503);
    if (code === "INVALID_ITEMS") return json({ error: "Itens ou quantidades inválidos.", code }, 400);
    if (code === "INVALID_QUOTE_PRICE" || code === "INVALID_QUOTE_RESPONSE") return json({ error: "A Lalamove retornou um preço inválido. Tente calcular novamente.", code }, 502);
    console.error("delivery-quote", {
      stage: "request", code,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack || null } : String(error),
    });
    return json({ error: "Erro interno ao calcular a entrega." }, 500);
  } finally {
    console.info("delivery-quote-timing", { ...timings, total_ms: Math.round(performance.now() - requestStarted) });
  }
});
