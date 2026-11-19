import postgres from "npm:postgres@3.4.7";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const expectedRpcs = [
  "consume_lalamove_tracking_rate_limit",
  "service_apply_lalamove_webhook",
  "service_begin_lalamove_dispatch",
  "service_cancel_lalamove_dispatch",
  "service_fail_lalamove_dispatch",
  "service_finish_lalamove_dispatch",
  "service_get_lalamove_dispatch",
  "service_store_lalamove_quotes",
  "service_sync_lalamove_dispatch",
  "service_update_lalamove_tracking_status",
];
const origin = {
  address: "Av. Lourenço da Silva Braga, 700 - Centro, Manaus - AM, Brasil",
  coordinates: { lat: "-3.135200", lng: "-60.025400" },
};
const destination = {
  address: "Arena da Amazônia, Av. Constantino Nery, 5001 - Flores, Manaus - AM, Brasil",
  coordinates: { lat: "-3.083400", lng: "-60.028600" },
};

function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
async function signLalamove(apiKey: string, apiSecret: string, body: string) {
  const path = "/v3/quotations";
  const timestamp = String(Date.now());
  const raw = timestamp + "\r\nPOST\r\n" + path + "\r\n\r\n" + body;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
  return { path, timestamp, authorization: "hmac " + apiKey + ":" + timestamp + ":" + hex };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return json({ ok: false, error: "Método não permitido." }, 405);
  const configuredToken = Deno.env.get("HEALTH_TOKEN") || "";
  const suppliedToken = req.headers.get("x-health-token") || "";
  if (!configuredToken || !suppliedToken || !safeEqual(configuredToken, suppliedToken)) {
    return json({ ok: false, error: "Não autorizado." }, 401);
  }

  const checks: Array<{ item: string; ok: boolean; message: string }> = [];
  const run = async (item: string, fn: () => Promise<string>) => {
    try {
      checks.push({ item, ok: true, message: await fn() });
    } catch (error) {
      checks.push({ item, ok: false, message: errorMessage(error).slice(0, 500) });
    }
  };

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL") || "";
  const healthToken = Deno.env.get("HEALTH_TOKEN") || "";
  const lalamoveKey = Deno.env.get("LALAMOVE_PROD_API_KEY") || "";
  const lalamoveSecret = Deno.env.get("LALAMOVE_PROD_API_SECRET") || "";
  const asaasKey = Deno.env.get("ASAAS_API_KEY") || "";
  const asaasBaseRaw = Deno.env.get("ASAAS_BASE_URL") || "";

  const requiredSecrets = [
    "HEALTH_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL",
    "LALAMOVE_PROD_API_KEY", "LALAMOVE_PROD_API_SECRET", "ASAAS_API_KEY", "ASAAS_BASE_URL",
  ];
  const missingSecrets = requiredSecrets.filter(name => !Deno.env.get(name)?.trim());

  let sql: ReturnType<typeof postgres> | null = null;
  if (databaseUrl) {
    try { sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 8, prepare: false }); }
    catch { sql = null; }
  }

  await run("a) banco responde", async () => {
    if (!sql) throw new Error("SUPABASE_DB_URL ausente ou conexão PostgreSQL indisponível.");
    const rows = await sql.unsafe("select 1 as ok");
    if (Number(rows[0]?.ok) !== 1) throw new Error("Consulta SELECT 1 não retornou 1.");
    return "SELECT 1 executado com sucesso no PostgreSQL.";
  });

  await run("b) permissões das 10 RPCs Lalamove", async () => {
    if (!sql) throw new Error("Sem conexão PostgreSQL para verificar privilégios.");
    const rows = await sql.unsafe(
      "select p.proname, has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1::text[]) order by p.proname",
      [expectedRpcs],
    );
    const grouped = new Map<string, any[]>();
    for (const row of rows) grouped.set(row.proname, [...(grouped.get(row.proname) || []), row]);
    const failures: string[] = [];
    for (const name of expectedRpcs) {
      const found = grouped.get(name) || [];
      if (found.length !== 1) {
        failures.push(name + ": " + (found.length ? "sobrecarga ambígua (" + found.length + ")" : "função ausente"));
        continue;
      }
      const row = found[0];
      if (row.service_role_execute !== true) failures.push(name + ": service_role sem EXECUTE");
      if (row.anon_execute !== false) failures.push(name + ": anon possui EXECUTE");
      if (row.authenticated_execute !== false) failures.push(name + ": authenticated possui EXECUTE");
    }
    if (failures.length) throw new Error(failures.join("; "));
    return "10/10 encontradas: EXECUTE permitido a service_role e negado a anon/authenticated.";
  });

  await run("c) secrets necessários", async () => {
    if (missingSecrets.length) throw new Error("Ausentes: " + missingSecrets.join(", "));
    if (!supabaseUrl.startsWith("https://") || !serviceKey || !healthToken) {
      throw new Error("Configuração Supabase/HEALTH_TOKEN inválida.");
    }
    if (!lalamoveKey.startsWith("pk_prod") || !lalamoveSecret.startsWith("sk_prod")) {
      throw new Error("LALAMOVE_PROD_API_KEY/SECRET não correspondem ao formato de produção.");
    }
    let asaasBase: URL;
    try { asaasBase = new URL(asaasBaseRaw); } catch { throw new Error("ASAAS_BASE_URL inválida."); }
    if (asaasBase.protocol !== "https:" || asaasBase.hostname !== "api.asaas.com" ||
        asaasBase.pathname !== "/" || asaasBase.search || asaasBase.hash) {
      throw new Error("ASAAS_BASE_URL não aponta para https://api.asaas.com.");
    }
    return "Presentes (somente nomes verificados): " + requiredSecrets.join(", ") + ".";
  });

  await run("d) cotação real Lalamove produção", async () => {
    if (!lalamoveKey.startsWith("pk_prod") || !lalamoveSecret.startsWith("sk_prod")) {
      throw new Error("Credenciais Lalamove de produção ausentes ou inválidas.");
    }
    const body = JSON.stringify({ data: {
      serviceType: "LALAGO",
      language: "pt_BR",
      stops: [
        { coordinates: origin.coordinates, address: origin.address },
        { coordinates: destination.coordinates, address: destination.address },
      ],
    } });
    const signed = await signLalamove(lalamoveKey, lalamoveSecret, body);
    const response = await fetch("https://rest.lalamove.com" + signed.path, {
      method: "POST",
      headers: {
        Authorization: signed.authorization,
        Market: "BR",
        "Request-ID": crypto.randomUUID(),
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const raw = await response.text();
    let payload: any = {};
    try { payload = JSON.parse(raw); } catch { /* keep provider status */ }
    if (!response.ok) {
      const first = Array.isArray(payload?.errors) ? payload.errors[0] : null;
      throw new Error("HTTP " + response.status + "; " +
        String(payload?.message || first?.id || "Lalamove recusou a cotação") +
        (first?.detail ? ": " + String(first.detail) : ""));
    }
    const quoteId = String(payload?.data?.quotationId || payload?.data?.id || "");
    const total = payload?.data?.priceBreakdown?.total ?? payload?.data?.total ?? null;
    if (!quoteId && total === null) throw new Error("HTTP " + response.status + "; resposta sem identificador/preço de cotação.");
    return "HTTP " + response.status + "; cotação de produção confirmada" +
      (quoteId ? "; quotationId " + quoteId : "") +
      (total !== null ? "; total " + String(total) : "") +
      ". Nenhuma corrida criada.";
  });

  await run("e) Asaas consulta somente leitura", async () => {
    if (!asaasKey) throw new Error("ASAAS_API_KEY ausente.");
    let base: URL;
    try { base = new URL(asaasBaseRaw); } catch { throw new Error("ASAAS_BASE_URL inválida."); }
    if (base.protocol !== "https:" || base.hostname !== "api.asaas.com" || base.pathname !== "/" || base.search || base.hash) {
      throw new Error("ASAAS_BASE_URL não aponta para a API de produção.");
    }
    const response = await fetch(base.origin + "/v3/myAccount/status", {
      method: "GET",
      headers: { access_token: asaasKey, Accept: "application/json", "User-Agent": "Feira On Delivery health-check" },
      signal: AbortSignal.timeout(12000),
    });
    const raw = await response.text();
    let payload: any = {};
    try { payload = JSON.parse(raw); } catch { /* use HTTP response */ }
    const detail = String(payload?.errors?.[0]?.description || payload?.errors?.[0]?.code ||
      payload?.message || payload?.status || response.statusText || "sem mensagem do provedor").slice(0, 300);
    if (!response.ok) throw new Error("HTTP " + response.status + "; " + detail);
    return "HTTP " + response.status + "; consulta de situação cadastral concluída; " + detail + ".";
  });

  if (sql) await sql.end({ timeout: 2 }).catch(() => {});
  const ok = checks.every(check => check.ok);
  return json({ ok, checks }, ok ? 200 : 503);
});
