import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const encoder = new TextEncoder();
const MAX_TOKEN_BYTES = 4096;

function constantTimeEqual(received: string, expected: string): boolean {
  const a = encoder.encode(received);
  const b = encoder.encode(expected);

  // Fixed iteration count avoids revealing the first differing byte or length
  // through an early return. Overlong values are always rejected.
  let diff = a.length ^ b.length;
  if (a.length > MAX_TOKEN_BYTES || b.length > MAX_TOKEN_BYTES) {
    diff |= 1;
  }

  for (let i = 0; i < MAX_TOKEN_BYTES; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }

  return diff === 0;
}

function jsonResponse(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

Deno.serve((req: Request): Response => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        "allow": "POST",
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const expectedToken = Deno.env.get("ASAAS_SAQUE_AUTH_TOKEN");
  if (!expectedToken) {
    console.warn("[asaas-saque-validacao] segredo ausente; saque recusado por falha segura");
    return jsonResponse(503, { error: "Validação indisponível" });
  }

  const receivedToken = req.headers.get("asaas-access-token") ?? "";
  if (!constantTimeEqual(receivedToken, expectedToken)) {
    console.warn("[asaas-saque-validacao] autenticação recusada; dados omitidos");
    return jsonResponse(401, { error: "Não autorizado" });
  }

  // Deliberately do not parse or log the withdrawal payload.
  // This endpoint never returns APPROVED.
  console.warn("[asaas-saque-validacao] saque recusado; detalhes omitidos");
  return jsonResponse(200, {
    status: "REFUSED",
    refuseReason: "Saques via API bloqueados",
  });
});
