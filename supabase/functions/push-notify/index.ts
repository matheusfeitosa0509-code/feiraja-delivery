import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

type PushKind = "admin" | "customer";

type RequestPayload = {
  timestamp: string;
  order_id: string;
  kind: PushKind;
  new_status: string;
  signature: string;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
};

const KNOWN_STATUSES = new Set([
  "Pedido Recebido",
  "Pagamento Pendente",
  "Aguardando Pagamento Pix",
  "Pagamento Confirmado",
  "Preparando",
  "Pronto para Retirada",
  "Saiu para Entrega",
  "Entregue",
  "Cancelada",
  "Pagamento cancelado",
  "Pagamento em análise",
  "Pagamento reembolsado",
  "Pagamento contestado",
  "Preparando pedido",
  "Recebido",
  "received",
]);

const CUSTOMER_MESSAGES: Record<string, string> = {
  "Pedido Recebido": "Recebemos seu pedido.",
  "Recebido": "Recebemos seu pedido.",
  "received": "Recebemos seu pedido.",
  "Pagamento Pendente": "Aguardando a confirmação do pagamento.",
  "Aguardando Pagamento Pix": "Aguardando a confirmação do pagamento.",
  "Pagamento em análise": "Aguardando a confirmação do pagamento.",
  "Pagamento Confirmado": "Pagamento confirmado!",
  "Preparando": "Estamos separando seu pedido.",
  "Preparando pedido": "Estamos separando seu pedido.",
  "Pronto para Retirada": "Seu pedido está pronto para retirada.",
  "Saiu para Entrega": "Seu pedido saiu para entrega.",
  "Entregue": "Pedido entregue. Obrigado!",
  "Cancelada": "Seu pedido foi cancelado.",
  "Pagamento cancelado": "Seu pedido foi cancelado.",
  "Pagamento reembolsado": "Houve uma atualização do seu pedido.",
  "Pagamento contestado": "Houve uma atualização do seu pedido.",
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

async function verifyHmac(
  secret: string,
  timestamp: string,
  orderId: string,
  kind: PushKind,
  newStatus: string,
  suppliedSignature: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(suppliedSignature)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const message = `${timestamp}.${orderId}.${kind}.${newStatus}`;
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );

  return constantTimeEqual(bytesToHex(digest), suppliedSignature.toLowerCase());
}

function getNotificationText(kind: PushKind, status: string): string | null {
  if (kind === "admin") {
    if (status === "Pedido Recebido") return "Novo pedido recebido";
    if (status === "Pagamento Confirmado") return "Pagamento Pix confirmado";
    return null;
  }
  return CUSTOMER_MESSAGES[status] ?? null;
}

function isGoneProviderError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  }

  // Secrets are read only from the Edge Function environment.
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const hmacSecret = Deno.env.get("PUSH_HMAC_SECRET");

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject || !hmacSecret) {
    return jsonResponse(500, { error: "SERVER_CONFIGURATION_ERROR" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: "SERVER_CONFIGURATION_ERROR" });
  }

  let payload: RequestPayload;
  try {
    const rawBody = await req.text();
    if (rawBody.length > 16_384) {
      return jsonResponse(400, { error: "INVALID_REQUEST" });
    }
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse(400, { error: "INVALID_REQUEST" });
    }
    payload = parsed as RequestPayload;
  } catch {
    return jsonResponse(400, { error: "INVALID_REQUEST" });
  }

  const { timestamp, order_id, kind, new_status, signature } = payload;
  if (
    typeof timestamp !== "string" ||
    !/^\d{10}$/.test(timestamp) ||
    typeof order_id !== "string" ||
    order_id.length < 1 ||
    order_id.length > 128 ||
    typeof kind !== "string" ||
    (kind !== "admin" && kind !== "customer") ||
    typeof new_status !== "string" ||
    !KNOWN_STATUSES.has(new_status) ||
    typeof signature !== "string"
  ) {
    return jsonResponse(400, { error: "INVALID_REQUEST" });
  }

  const timestampSeconds = Number(timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > 300
  ) {
    return jsonResponse(401, { error: "UNAUTHORIZED" });
  }

  let signatureIsValid = false;
  try {
    signatureIsValid = await verifyHmac(
      hmacSecret,
      timestamp,
      order_id,
      kind,
      new_status,
      signature,
    );
  } catch {
    return jsonResponse(401, { error: "UNAUTHORIZED" });
  }
  if (!signatureIsValid) {
    return jsonResponse(401, { error: "UNAUTHORIZED" });
  }

  const message = getNotificationText(kind, new_status);
  if (!message) {
    return jsonResponse(400, { error: "INVALID_REQUEST" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let eventWasInserted = false;
  let successfulSends = 0;

  let stage = "order_lookup";

  try {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,user_id,status")
      .eq("id", order_id)
      .maybeSingle();

    if (orderError) throw new Error("ORDER_LOOKUP_FAILED");
    if (!order) return jsonResponse(404, { error: "ORDER_NOT_FOUND" });

    // A delayed event must not notify about a status that is no longer current.
    if (order.status !== new_status) {
      return jsonResponse(200, { ok: true, skipped: "STALE_EVENT" });
    }

    stage = "event_insert";
    const { data: insertedEvent, error: eventError } = await supabase
      .from("push_events")
      .insert({ order_id, kind, status: new_status })
      .select("id")
      .single();

    if (eventError) {
      if (eventError.code === "23505") {
        return jsonResponse(200, { ok: true, skipped: "DUPLICATE" });
      }
      return jsonResponse(500, { error: "EVENT_INSERT_FAILED" });
    }
    if (!insertedEvent) {
      return jsonResponse(500, { error: "EVENT_INSERT_FAILED" });
    }
    eventWasInserted = true;

    let recipientUserIds: string[] = [];

    if (kind === "customer") {
      if (order.user_id) recipientUserIds = [order.user_id];
    } else {
      stage = "admin_lookup";
      const { data: admins, error: adminsError } = await supabase
        .from("admin_users")
        .select("user_id");
      if (adminsError) throw new Error("ADMIN_LOOKUP_FAILED");
      recipientUserIds = [
        ...new Set(
          (admins ?? [])
            .map((row: { user_id: string | null }) => row.user_id)
            .filter((id: string | null): id is string => Boolean(id)),
        ),
      ];
    }

    stage = "subscription_lookup";
    let subscriptions: PushSubscriptionRow[] = [];
    if (recipientUserIds.length > 0) {
      const { data, error: subscriptionsError } = await supabase
        .from("push_subscriptions")
        .select("id,user_id,endpoint,p256dh,auth_secret")
        .eq("ativo", true)
        .in("user_id", recipientUserIds);

      if (subscriptionsError) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");
      subscriptions = (data ?? []) as PushSubscriptionRow[];
    }

    stage = "vapid_configuration";
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    stage = "push_send";
    const notificationUrl = kind === "admin" ? "/painel.html" : "/loja.html";
    const notificationPayload = JSON.stringify({
      title: "Feira On Delivery",
      body: message,
      url: notificationUrl,
      tag: `feira-${kind}-${order_id}-${new_status}`,
    });

    let serverSideSendErrors = false;

    for (const subscriptionRow of subscriptions) {
      const subscription = {
        endpoint: subscriptionRow.endpoint,
        keys: {
          p256dh: subscriptionRow.p256dh,
          auth: subscriptionRow.auth_secret,
        },
      };

      try {
        await webpush.sendNotification(subscription, notificationPayload, {
          TTL: 3600,
        });
        successfulSends++;
      } catch (error) {
        if (isGoneProviderError(error)) {
          const { error: deleteError } = await supabase
            .from("push_subscriptions")
            .delete()
            .eq("id", subscriptionRow.id);
          if (deleteError) {
            // Never log endpoint, subscription keys, provider response, or signature.
            console.error("push_expired_subscription_cleanup_failed");
          }
        } else {
          serverSideSendErrors = true;
          console.error("push_provider_send_failed");
        }
      }
    }

    if (successfulSends === 0 && serverSideSendErrors) {
      const { error: cleanupError } = await supabase
        .from("push_events")
        .delete()
        .eq("order_id", order_id)
        .eq("kind", kind)
        .eq("status", new_status);

      if (cleanupError) {
        console.error("push_event_cleanup_failed");
        return jsonResponse(500, { error: "PUSH_PROCESSING_FAILED" });
      }
      return jsonResponse(500, { error: "PUSH_DELIVERY_FAILED" });
    }

    return jsonResponse(200, {
      ok: true,
      sent: successfulSends,
      attempted: subscriptions.length,
    });
  } catch (error: unknown) {
    // If processing failed before any delivery succeeded, release the idempotency
    // claim so a later retry can process the event again.
    if (eventWasInserted && successfulSends === 0) {
      const { error: cleanupError } = await supabase
        .from("push_events")
        .delete()
        .eq("order_id", order_id)
        .eq("kind", kind)
        .eq("status", new_status);
      if (cleanupError) console.error("push_event_cleanup_failed");
    }
    // Only standard error names and exact, fixed web-push messages are logged.
    const allowedErrorNames = new Set(["Error", "TypeError", "RangeError", "URIError", "SyntaxError"]);
    const errorName = error instanceof Error && allowedErrorNames.has(error.name)
      ? error.name
      : "UnknownError";
    const rawMessage = error instanceof Error ? error.message : "";
    const safeMessagePrefixes = [
      "Vapid subject is not a valid URL.",
      "Vapid public key should be 65 bytes long when decoded.",
      "Vapid private key should be 32 bytes long when decoded.",
      "Public key must be a Uint8Array or string.",
      "Private key must be a Uint8Array or string.",
    ];
    const errorMessagePrefix = safeMessagePrefixes.find((message) => rawMessage === message) ?? null;
    console.error("push_notification_processing_failed", {
      stage,
      error_name: errorName,
      error_message_prefix: errorMessagePrefix,
    });
    return jsonResponse(500, { error: "PUSH_PROCESSING_FAILED" });
  }
});
