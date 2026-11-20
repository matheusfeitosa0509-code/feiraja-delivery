import { assertEquals } from "jsr:@std/assert@1.0.14";
import { handleAsaasWebhook } from "./index.ts";

type Order = {
  id: string;
  status: string;
  total: number;
  payment_id: string | null;
  payment_provider: string;
  created_at: string;
  refund_pending?: boolean;
  delivery_type?: string;
  pickup_code?: string | null;
  is_test_order?: boolean;
};

function makeDb(initialOrder: Order | null) {
  let order = initialOrder ? structuredClone(initialOrder) : null;
  const updates: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      let operation: "select" | "update" | "insert" = "select";
      let patch: Record<string, unknown> = {};
      const filters: Array<[string, string, unknown]> = [];
      const builder: any = {
        select() { return builder; },
        update(value: Record<string, unknown>) { operation = "update"; patch = value; return builder; },
        insert(value: Record<string, unknown>) { operation = "insert"; patch = value; return builder; },
        eq(column: string, value: unknown) { filters.push(["eq", column, value]); return builder; },
        is(column: string, value: unknown) { filters.push(["is", column, value]); return builder; },
        in(column: string, value: unknown) { filters.push(["in", column, value]); return builder; },
        async maybeSingle() { return execute(); },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return execute().then(resolve, reject);
        },
      };
      async function execute() {
        if (table === "admin_alerts") {
          if (operation === "insert") {
            const duplicate = alerts.some((row) => row.tipo === patch.tipo && (patch.order_id ? row.order_id === patch.order_id : row.asaas_payment_id === patch.asaas_payment_id));
            if (duplicate) return { data: null, error: { code: "23505" } };
            alerts.push(structuredClone(patch));
            return { data: null, error: null };
          }
          return { data: null, error: null };
        }
        if (table === "admin_users") return { data: [{ user_id: "admin-1" }], error: null };
        if (table === "push_subscriptions") {
          return { data: [{ endpoint: "https://push.invalid", p256dh: "p", auth_secret: "a" }], error: null };
        }
        if (table !== "orders") return { data: null, error: null };
        const matches = () => Boolean(order) && filters.every(([kind, column, value]) => {
          const actual = (order as any)[column];
          if (kind === "eq") return actual === value;
          if (kind === "is") return actual === value;
          if (kind === "in") return Array.isArray(value) && value.includes(actual);
          return false;
        });
        if (!matches()) return { data: null, error: null };
        if (operation === "update") {
          Object.assign(order!, patch);
          updates.push(structuredClone(patch));
          return { data: { id: order!.id }, error: null };
        }
        return { data: structuredClone(order), error: null };
      }
      return builder;
    },
  };
  return {
    db,
    updates,
    alerts,
    getOrder: () => order ? structuredClone(order) : null,
  };
}

const validPayment = {
  id: "pay_123",
  externalReference: "ORDER-123",
  billingType: "PIX",
  status: "CONFIRMED",
  value: 30,
};

function makeRequest() {
  return new Request("https://webhook.test/asaas", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "asaas-access-token": "test-webhook-token",
    },
    body: JSON.stringify({
      event: "PAYMENT_RECEIVED",
      payment: { ...validPayment },
    }),
  });
}

function makeDependencies(db: ReturnType<typeof makeDb>, payment = validPayment) {
  const values: Record<string, string> = {
    ASAAS_ENABLED: "true",
    ASAAS_WEBHOOK_AUTH_TOKEN: "test-webhook-token",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    ASAAS_BASE_URL: "https://api.asaas.com",
    ASAAS_API_KEY: "test-asaas-key",
    VAPID_PUBLIC_KEY: "test-public",
    VAPID_PRIVATE_KEY: "test-private",
    VAPID_SUBJECT: "mailto:test@example.test",
  };
  let pushCount = 0;
  const deps = {
    env: { get: (name: string) => values[name] },
    createClient: (() => db.db) as any,
    fetch: (async () => new Response(JSON.stringify(payment), { status: 200 })) as typeof fetch,
    webpush: {
      setVapidDetails() {},
      async sendNotification() { pushCount++; },
    } as any,
    now: () => Date.parse("2026-11-13T12:00:00Z"),
  };
  return { deps, pushCount: () => pushCount };
}

async function invoke(db: ReturnType<typeof makeDb>, payment = validPayment) {
  const deps = makeDependencies(db, payment);
  const response = await handleAsaasWebhook(makeRequest(), deps.deps);
  return { response, body: await response.json(), pushCount: deps.pushCount() };
}

function cancelled(paymentId: string | null): Order {
  return {
    id: "ORDER-123",
    status: "Cancelada",
    total: 30,
    payment_id: paymentId,
    payment_provider: "asaas",
    created_at: "2026-11-13T11:00:00Z",
  };
}

Deno.test("handler: Pix pago após cancelamento com payment_id igual mantém cancelada e marca devolução", async () => {
  const mock = makeDb(cancelled("pay_123"));
  const result = await invoke(mock);
  assertEquals(result.response.status, 200);
  assertEquals(result.body.refund_pending, true);
  assertEquals(mock.getOrder()?.status, "Cancelada");
  assertEquals(mock.getOrder()?.refund_pending, true);
  assertEquals(mock.getOrder()?.payment_id, "pay_123");
});

Deno.test("handler: Pix pago após cancelamento com ID diferente preserva o payment_id antigo", async () => {
  const mock = makeDb(cancelled("pay_old"));
  const result = await invoke(mock);
  assertEquals(result.response.status, 200);
  assertEquals(result.body.refund_pending, true);
  assertEquals(mock.getOrder()?.status, "Cancelada");
  assertEquals(mock.getOrder()?.payment_id, "pay_old");
  assertEquals(mock.getOrder()?.refund_pending, true);
});

Deno.test("handler: Pix pago após cancelamento sem payment_id grava o ID validado", async () => {
  const mock = makeDb(cancelled(null));
  const result = await invoke(mock);
  assertEquals(result.response.status, 200);
  assertEquals(mock.getOrder()?.status, "Cancelada");
  assertEquals(mock.getOrder()?.payment_id, "pay_123");
  assertEquals(mock.getOrder()?.refund_pending, true);
});

Deno.test("handler: webhook repetido permanece idempotente e não reativa pedido", async () => {
  const mock = makeDb(cancelled("pay_123"));
  const first = await invoke(mock);
  const second = await invoke(mock);
  assertEquals(first.body.refund_pending, true);
  assertEquals(second.body.refund_pending, true);
  assertEquals(mock.getOrder()?.status, "Cancelada");
  assertEquals(mock.getOrder()?.refund_pending, true);
  assertEquals(mock.getOrder()?.payment_id, "pay_123");
});

Deno.test("handler: cobrança confirmada sem pedido não altera pedido e envia aviso administrativo simulado", async () => {
  const mock = makeDb(null);
  const result = await invoke(mock);
  assertEquals(result.response.status, 200);
  assertEquals(result.body.reason, "pedido_nao_encontrado_ou_nao_asaas");
  assertEquals(mock.getOrder(), null);
  assertEquals(result.pushCount, 0);
  assertEquals(mock.alerts.length, 1);
  assertEquals(mock.alerts[0].tipo, "asaas_pagamento_sem_pedido");
  assertEquals(mock.alerts[0].order_id, null);
  assertEquals(mock.alerts[0].asaas_payment_id, "pay_123");
});

Deno.test("handler: fluxo normal de pedido não cancelado continua confirmando pagamento com ID correspondente", async () => {
  const mock = makeDb({
    id: "ORDER-123",
    status: "Pagamento Pendente",
    total: 30,
    payment_id: "pay_123",
    payment_provider: "asaas",
    created_at: "2026-11-13T11:55:00Z",
  });
  const result = await invoke(mock);
  assertEquals(result.response.status, 200);
  assertEquals(result.body.received, true);
  assertEquals(mock.getOrder()?.status, "Pagamento Confirmado");
  assertEquals(mock.getOrder()?.payment_id, "pay_123");
  assertEquals(mock.getOrder()?.refund_pending, undefined);
  assertEquals(mock.updates, [{ status: "Pagamento Confirmado" }]);
});


function stalePending(status = "Pagamento Pendente"): Order {
  return { id: "ORDER-123", status, total: 30, payment_id: null,
    payment_provider: "asaas", created_at: "2026-11-13T11:00:00Z" };
}
function staleRequest() {
  return new Request("https://webhook.test/asaas", { method: "POST",
    headers: { "content-type": "application/json", "asaas-access-token": "test-webhook-token" },
    body: JSON.stringify({ event: "PAYMENT_RECEIVED", payment: { ...validPayment } }) });
}
function staleDependencies(mock: ReturnType<typeof makeDb>, apiPayment: any, apiStatus = 200) {
  const base = makeDependencies(mock);
  base.deps.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/v3/payments?externalReference=")) {
      return new Response(JSON.stringify({ data: apiPayment ? [apiPayment] : [] }), { status: apiStatus });
    }
    return new Response(JSON.stringify(apiPayment), { status: 200 });
  }) as typeof fetch;
  return base.deps;
}
Deno.test("webhook atrasado: pago vincula payment_id e confirma pedido", async () => {
  const mock = makeDb(stalePending());
  const response = await handleAsaasWebhook(staleRequest(), staleDependencies(mock, validPayment));
  assertEquals(response.status, 200);
  assertEquals(mock.getOrder()?.payment_id, "pay_123");
  assertEquals(mock.getOrder()?.status, "Pagamento Confirmado");
});
Deno.test("webhook atrasado: não pago mantém pedido pendente", async () => {
  const mock = makeDb(stalePending());
  const response = await handleAsaasWebhook(staleRequest(), staleDependencies(mock, { ...validPayment, status: "PENDING" }));
  assertEquals(response.status, 200);
  assertEquals(mock.getOrder()?.payment_id, null);
  assertEquals(mock.getOrder()?.status, "Pagamento Pendente");
});
Deno.test("webhook atrasado duplicado: segunda notificação é ignorada", async () => {
  const mock = makeDb(stalePending());
  const deps = staleDependencies(mock, validPayment);
  const first = await handleAsaasWebhook(staleRequest(), deps);
  const second = await handleAsaasWebhook(staleRequest(), deps);
  assertEquals(first.status, 200);
  assertEquals(second.status, 200);
  assertEquals(mock.getOrder()?.payment_id, "pay_123");
  assertEquals(mock.getOrder()?.status, "Pagamento Confirmado");
});
Deno.test("webhook atrasado: API Asaas fora do ar retorna erro para retry", async () => {
  const mock = makeDb(stalePending());
  const response = await handleAsaasWebhook(staleRequest(), staleDependencies(mock, validPayment, 503));
  assertEquals(response.status, 503);
  assertEquals(mock.getOrder()?.payment_id, null);
  assertEquals(mock.getOrder()?.status, "Pagamento Pendente");
});


Deno.test("webhook atrasado: pagamento confirmado vincula ID sem regredir status administrativo", async () => {
  const mock = makeDb(stalePending("Preparando"));
  const response = await handleAsaasWebhook(staleRequest(), staleDependencies(mock, validPayment));
  assertEquals(response.status, 200);
  assertEquals(mock.getOrder()?.payment_id, "pay_123");
  assertEquals(mock.getOrder()?.status, "Preparando");
});

Deno.test("pickup_store: confirmação Pix gera código de retirada de quatro dígitos", async () => {
  const mock = makeDb({
    id: "ORDER-123",
    status: "Pagamento Pendente",
    total: 30,
    payment_id: "pay_123",
    payment_provider: "asaas",
    created_at: "2026-11-19T10:00:00Z",
    delivery_type: "pickup_store",
    pickup_code: null,
  });
  const result = await invoke(mock);
  assertEquals(result.response.status, 200);
  assertEquals(mock.getOrder()?.status, "Pagamento Confirmado");
  assertEquals(/^\d{4}$/.test(String(mock.getOrder()?.pickup_code || "")), true);
  assertEquals(mock.updates.length, 1);
  assertEquals(typeof mock.updates[0].pickup_code, "string");
});

Deno.test("handler: reenvio de pagamento sem pedido não duplica alerta", async () => {
  const mock = makeDb(null);
  await invoke(mock);
  await invoke(mock);
  assertEquals(mock.alerts.length, 1);
});

Deno.test("handler: pedido de teste nunca gera alerta de pagamento", async () => {
  const mock = makeDb({
    id: "ORDER-123", status: "Pagamento Pendente", total: 30,
    payment_id: "pay_123", payment_provider: "mercado_pago",
    created_at: "2026-11-13T11:55:00Z", is_test_order: true,
  });
  await invoke(mock);
  assertEquals(mock.alerts.length, 0);
});

Deno.test("handler: token inválido não cria alerta", async () => {
  const mock = makeDb(null);
  const request = new Request("https://webhook.test/asaas", {
    method: "POST",
    headers: { "content-type": "application/json", "asaas-access-token": "invalid-token" },
    body: JSON.stringify({ event: "PAYMENT_RECEIVED", payment: { ...validPayment } }),
  });
  const deps = makeDependencies(mock);
  const response = await handleAsaasWebhook(request, deps.deps);
  assertEquals(response.status, 401);
  assertEquals(mock.alerts.length, 0);
});

Deno.test("handler: divergência de valor gera exatamente um alerta administrativo", async () => {
  const mock = makeDb({
    id: "ORDER-123", status: "Pagamento Pendente", total: 30,
    payment_id: "pay_123", payment_provider: "asaas",
    created_at: "2026-11-13T11:55:00Z", is_test_order: false,
  });
  const result = await invoke(mock, { ...validPayment, value: 31 });
  assertEquals(result.response.status, 200);
  assertEquals(result.body.reason, "divergencia_permanente");
  assertEquals(mock.alerts.length, 1);
  assertEquals(mock.alerts[0].tipo, "asaas_pagamento_erro");
  assertEquals(mock.alerts[0].order_id, "ORDER-123");
  assertEquals(mock.getOrder()?.status, "Pagamento Pendente");
});

Deno.test("handler: exceção ao validar pagamento gera alerta administrativo sem mudar o pedido", async () => {
  const mock = makeDb({
    id: "ORDER-123", status: "Pagamento Pendente", total: 30,
    payment_id: "pay_123", payment_provider: "asaas",
    created_at: "2026-11-13T11:55:00Z", is_test_order: false,
  });
  const deps = makeDependencies(mock).deps;
  deps.fetch = (async () => { throw new Error("simulated network failure"); }) as typeof fetch;
  const response = await handleAsaasWebhook(makeRequest(), deps);
  assertEquals(response.status, 503);
  assertEquals(mock.alerts.length, 1);
  assertEquals(mock.alerts[0].tipo, "asaas_pagamento_erro");
  assertEquals(mock.getOrder()?.status, "Pagamento Pendente");
});
