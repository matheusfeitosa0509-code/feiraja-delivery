import { createClient } from "npm:@supabase/supabase-js@2.57.4";

function isValidCpf(value: string) { const cpf = String(value || "").replace(/\D/g, ""); if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false; const calc = (base: string, factor: number) => { let sum = 0; for (const digit of base) sum += Number(digit) * factor--; const mod = (sum * 10) % 11; return mod === 10 ? 0 : mod; }; return calc(cpf.slice(0, 9), 10) === Number(cpf[9]) && calc(cpf.slice(0, 10), 11) === Number(cpf[10]); }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const earlyNoticeType = String(url.searchParams.get("type") || url.searchParams.get("topic") || "");
  if (earlyNoticeType && earlyNoticeType !== "payment") return json({ received: true, ignored: true });
  const earlyBody = req.method === "POST" ? await req.clone().json().catch(() => ({})) : {};
  const earlyBodyType = String(earlyBody?.type || earlyBody?.topic || "");
  if (earlyBodyType && earlyBodyType !== "payment") return json({ received: true, ignored: true });
  if (req.method === "GET") {
    const orderId = url.searchParams.get("order_id");
    if (!orderId || orderId.length > 100) return json({ error: "Pedido inválido." }, 400);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "Configuração interna incompleta." }, 500);
    const bearer = req.headers.get("Authorization") || "";
    const accessToken = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (!accessToken) return json({ error: "Sessão necessária." }, 401);
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData?.user) return json({ error: "Sessão inválida." }, 401);
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from("orders").select("id,status,user_id").eq("id", orderId).maybeSingle();
    if (error) return json({ error: "Não foi possível consultar o pedido." }, 500);
    if (!data) return json({ error: "Pedido não encontrado." }, 404);
    const { data: adminMembership } = await db.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
    const isAdmin = !!adminMembership;
    if (data.user_id !== authData.user.id && !isAdmin) return json({ error: "Acesso negado." }, 403);
    return json({ orderId: data.id, status: data.status });
  }
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const mpToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "Configuração interna do servidor incompleta." }, 500);
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const body = await req.json().catch(() => ({}));
    const noticeType = String(url.searchParams.get("type") || url.searchParams.get("topic") || body?.type || body?.topic || "");
    const paymentIdFromNotice = String(url.searchParams.get("data.id") || url.searchParams.get("id") || body?.data?.id || "");
    if (noticeType && noticeType !== "payment") return json({ received: true, ignored: true });
    if (noticeType === "payment" && !paymentIdFromNotice) return json({ received: true, ignored: true });
    if (noticeType === "payment" && paymentIdFromNotice) {
      // Webhooks must be signed. Never process payment notices without the configured secret.
      const webhookSecret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET");
      if (!webhookSecret) {
        console.error("MERCADO_PAGO_WEBHOOK_SECRET não configurado.");
        return json({ error: "Webhook não configurado." }, 503);
      }
      {
        const signatureHeader = req.headers.get("x-signature") || "";
        const requestId = req.headers.get("x-request-id") || "";
        const parts = Object.fromEntries(signatureHeader.split(",").map((part) => {
          const index = part.indexOf("=");
          return index > -1 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ["", ""];
        }).filter(([key]) => key));
        const ts = parts.ts || "";
        const suppliedSignature = (parts.v1 || "").toLowerCase();
        if (!ts || !suppliedSignature || !requestId) {
          return json({ error: "Assinatura do webhook ausente." }, 401);
        }
        const manifest = `id:${paymentIdFromNotice};request-id:${requestId};ts:${ts};`;
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(webhookSecret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
        const expectedSignature = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
        // Constant-time comparison for equal-length hexadecimal signatures.
        let signatureDiff = expectedSignature.length ^ suppliedSignature.length;
        const compareLength = Math.max(expectedSignature.length, suppliedSignature.length);
        for (let i = 0; i < compareLength; i++) {
          signatureDiff |= (expectedSignature.charCodeAt(i) || 0) ^ (suppliedSignature.charCodeAt(i) || 0);
        }
        if (signatureDiff !== 0) return json({ error: "Assinatura do webhook inválida." }, 401);
      }
      if (!mpToken) return json({ error: "Mercado Pago não configurado." }, 503);
      const mpCheck = await fetch("https://api.mercadopago.com/v1/payments/" + encodeURIComponent(paymentIdFromNotice), {
        headers: { Authorization: "Bearer " + mpToken },
      });
      const verifiedPayment = await mpCheck.json().catch(() => ({}));
      if (!mpCheck.ok || String(verifiedPayment?.id) !== paymentIdFromNotice || !verifiedPayment?.external_reference) {
        return json({ received: true, ignored: true });
      }
      if (String(verifiedPayment.currency_id || "").toUpperCase() !== "BRL" ||
          String(verifiedPayment.payment_method_id || "").toLowerCase() !== "pix" ||
          !Number.isFinite(Number(verifiedPayment.transaction_amount))) {
        return json({ received: true, ignored: true });
      }
      const { data: linkedOrder, error: orderReadError } = await db.from("orders")
        .select("id,status,total,payment_id")
        .eq("id", String(verifiedPayment.external_reference))
        .maybeSingle();
      if (orderReadError) return json({ error: "Falha ao conferir pedido." }, 500);
      if (!linkedOrder || (linkedOrder.payment_id && String(linkedOrder.payment_id) !== paymentIdFromNotice)) {
        return json({ received: true, ignored: true });
      }
      const paidAmount = Math.round(Number(verifiedPayment.transaction_amount) * 100);
      const expectedAmount = Math.round(Number(linkedOrder.total) * 100);
      if (!Number.isFinite(expectedAmount) || paidAmount !== expectedAmount) {
        console.error("Valor do pagamento não corresponde ao pedido:", linkedOrder.id);
        return json({ received: true, ignored: true });
      }
      const incomingStatus = String(verifiedPayment.status || "");
      const protectedAdministrativeStatuses = new Set(["saiu para entrega", "cancelada", "cancelado", "preparando", "pronto para retirada", "entregue", "preparando pedido", "concluído", "concluido", "received", "recebido"]);
      if (incomingStatus === "approved" && protectedAdministrativeStatuses.has(String(linkedOrder.status || "").trim().toLowerCase())) {
        return json({ received: true, ignored: true, reason: "status_administrativo_preservado" });
      }
      const statusMap: Record<string, string> = {
        approved: "Pagamento Confirmado",
        pending: "Pagamento Pendente",
        in_process: "Pagamento Pendente",
        rejected: "Cancelada",
        cancelled: "Cancelada",
        refunded: "Cancelada",
        expired: "Cancelada",
        charged_back: "Cancelada",
      };
      const nextStatus = statusMap[incomingStatus];
      if (!nextStatus) return json({ received: true, ignored: true });
      // Ignore delayed non-final events after approval, but keep refunds and chargebacks visible.
      const nonFinalStatuses = new Set(["pending", "in_process", "rejected", "cancelled"]);
      if (["Pagamento Confirmado", "Saiu para Entrega", "Cancelada"].includes(linkedOrder.status) && nonFinalStatuses.has(incomingStatus)) {
        return json({ received: true, ignored: true });
      }
      const { error: updateError } = await db.from("orders")
        .update({ status: nextStatus, payment_id: paymentIdFromNotice })
        .eq("id", linkedOrder.id);
      if (updateError) {
        console.error("Falha ao atualizar status do pedido:", updateError.message);
        return json({ error: "Falha ao atualizar pedido." }, 500);
      }
      return json({ received: true });
    }
    const bearer = req.headers.get("Authorization") || "";
    const accessToken = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (!accessToken) return json({ error: "Sessão inválida. Entre novamente e tente o pedido." }, 401);
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (authError || !authData?.user) return json({ error: "Sessão expirada. Entre novamente e tente o pedido." }, 401);
    if (authData.user.is_anonymous) return json({ error: 'Crie uma conta ou entre na sua conta antes de concluir o pedido, para manter seu histórico salvo.' }, 403);
    const orderUserId = authData.user.id;

    const customer = body?.customer;
    const requestedItems = body?.items;
    const paymentMethod = String(body?.paymentMethod || "pix").toLowerCase();
    if (!["pix", "cash", "card_on_delivery"].includes(paymentMethod)) return json({ error: "Forma de pagamento inválida." }, 400);
    if (paymentMethod === "pix" && !mpToken) return json({ error: "Pagamento Pix ainda não está configurado." }, 503);
    if (!customer || !Array.isArray(requestedItems) || requestedItems.length < 1 || requestedItems.length > 50) {
      return json({ error: "Pedido inválido: informe os dados do cliente e os produtos." }, 400);
    }
    const name = String(customer.name ?? "").trim().slice(0, 120);
    const phone = String(customer.phone ?? "").trim().slice(0, 40);
    const cpf = paymentMethod === "pix" ? String(customer.cpf ?? "").replace(/\D/g, "").slice(0, 11) : "";
    const email = String(customer.email ?? "").trim().toLowerCase().slice(0, 254);
    const deliveryType = customer.deliveryType === "pickup" ? "pickup" : "delivery";
    const address = deliveryType === "pickup" ? "Retirada na Feira" : String(customer.address ?? "").trim().slice(0, 300);
    if (!name || phone.replace(/\D/g, "").length < 8 || (paymentMethod === "pix" && (!isValidCpf(cpf) || !/^\S+@\S+\.\S+$/.test(email))) || (email && !/^\S+@\S+\.\S+$/.test(email)) || (deliveryType === "delivery" && !address)) {
      return json({ error: "Confira nome, telefone, CPF, e-mail e endereço de entrega." }, 400);
    }
    const accountEmail = String(authData.user.email || "").trim().toLowerCase();
    if (paymentMethod === "pix" && accountEmail && email !== accountEmail) {
      return json({ error: "Use o mesmo e-mail da sua conta para gerar o Pix." }, 400);
    }

    if (paymentMethod === "pix" && !isValidCpf(cpf)) return json({ error: "Informe um CPF válido para gerar o Pix." }, 400);
    const { count: recentOrderCount, error: rateLimitError } = await db.from("orders").select("id", { count: "exact", head: true }).eq("user_id", orderUserId).gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
    if (rateLimitError) return json({ error: "Não foi possível validar o limite de pedidos. Tente novamente." }, 503);
    if ((recentOrderCount || 0) >= 5) return json({ error: "Limite de 5 pedidos em 10 minutos atingido. Aguarde antes de tentar novamente." }, 429);

    const qtyById = new Map<string, number>();
    for (const item of requestedItems) {
      const id = String(item?.id ?? "").trim();
      const qty = Number(item?.qty);
      if (!id || !Number.isInteger(qty) || qty < 1 || qty > 100) return json({ error: "Quantidade ou produto inválido." }, 400);
      const accumulatedQty = (qtyById.get(id) ?? 0) + qty;
      if (accumulatedQty > 100) return json({ error: "A quantidade total de cada produto não pode passar de 100 unidades." }, 400);
      qtyById.set(id, accumulatedQty);
    }
    const ids = [...qtyById.keys()];
    const { data: products, error: productsError } = await db.from("products")
      .select("id,name,price,category,image,available").in("id", ids);
    if (productsError) throw productsError;
    if (!products || products.length !== ids.length) return json({ error: "Um ou mais produtos não existem mais. Atualize a feira e tente novamente." }, 409);
    if (products.some((p: any) => p.available === false)) return json({ error: "Um dos produtos está indisponível. Atualize a feira e tente novamente." }, 409);

    if (products.some((p: any) => !Number.isFinite(Number(p.price)) || Number(p.price) < 0)) {
      console.error('Preço inválido cadastrado em products.');
      return json({ error: 'Um produto está com preço inválido. Avise a loja antes de tentar novamente.' }, 409);
    }
    const items = products.map((p: any) => ({
      id: p.id, name: p.name, category: p.category, image: p.image,
      price: Number(p.price), qty: qtyById.get(p.id)!,
    }));
    const subtotal = Math.round(items.reduce((sum: number, item: any) => sum + item.price * item.qty, 0) * 100) / 100;
    const deliveryFee = deliveryType === "delivery" ? 5 : 0;
    const total = Math.round((subtotal + deliveryFee) * 100) / 100;
    if (!Number.isFinite(total) || total <= 0 || total > 100000) return json({ error: "Valor total inválido." }, 400);

    const orderId = `FEIRA-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    if (paymentMethod !== "pix") {
      const orderPayload = {
        id: orderId, user_id: orderUserId, customer_name: name, customer_phone: phone,
        customer_cpf: null, customer_email: email || null, customer_address: address,
        delivery_type: deliveryType,
        payment_method: paymentMethod === "cash" ? "Dinheiro na entrega" : "Cartão na entrega",
        items, subtotal, delivery_fee: deliveryFee, total, status: "Pedido Recebido",
        market_checklist: { notes: String(body?.notes ?? "").trim().slice(0, 1000) },
      };
      const { data: savedOrder, error: insertError } = await db.from("orders").insert(orderPayload).select("id,status,total").single();
      if (insertError) {
        console.error("Falha ao salvar pedido sem Pix:", insertError.message);
        return json({ error: "Não foi possível registrar o pedido." }, 500);
      }
      return json({ order: savedOrder, id: savedOrder.id, paymentStatus: savedOrder.status });
    }
    // Save the order before creating the Pix payment so a provider/database failure
    // cannot leave a payment with no corresponding order record.
    const draftOrder = {
      id: orderId, user_id: orderUserId, customer_name: name, customer_phone: phone,
      customer_cpf: cpf, customer_email: email, customer_address: address,
      delivery_type: deliveryType, payment_method: "Mercado Pago Pix",
      items, subtotal, delivery_fee: deliveryFee, total, status: "Pagamento Pendente",
      market_checklist: { items: items.map((item: any) => ({ id: item.id, name: item.name, qty: item.qty, bought: false })), notes: String(body?.notes ?? "").trim().slice(0, 500) },
    };
    const { error: draftError } = await db.from("orders").insert(draftOrder);
    if (draftError) {
      console.error("Falha ao salvar pedido antes de criar Pix:", draftError.message);
      return json({ error: "Não foi possível registrar o pedido. Nenhum Pix foi criado." }, 500);
    }

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": orderId,
      },
      body: JSON.stringify({
        transaction_amount: total,
        description: `FeiraJá - Pedido ${orderId}`,
        payment_method_id: "pix",
        payer: { email, first_name: name.split(" ")[0], last_name: name.split(" ").slice(1).join(" ") || name.split(" ")[0], identification: { type: "CPF", number: cpf } },
        date_of_expiration: new Date(Date.now() + 30 * 60 * 1000 - 4 * 60 * 60 * 1000).toISOString().slice(0, -1) + "-04:00",
        notification_url: "https://juhwdevvwstmyxyyagzh.supabase.co/functions/v1/super-worker",
        external_reference: orderId,
        metadata: { order_id: orderId },
      }),
    });
    const payment = await mpResponse.json();
    if (!mpResponse.ok) {
      await db.from("orders").update({ status: "Cancelada" }).eq("id", orderId).eq("status", "Pagamento Pendente");
      console.error("Mercado Pago recusou a criação do Pix:", payment?.message ?? mpResponse.status);
      return json({ error: "O Mercado Pago não conseguiu gerar o Pix. O pedido foi marcado como cancelado; tente novamente." }, 502);
    }
    const tx = payment?.point_of_interaction?.transaction_data;
    if (!payment?.id || !tx?.qr_code) {
      await db.from("orders").update({ status: "Cancelada" }).eq("id", orderId).eq("status", "Pagamento Pendente");
      return json({ error: "O Mercado Pago não retornou os dados do Pix. O pedido foi marcado como cancelado." }, 502);
    }

    const { data: savedOrder, error: savePaymentError } = await db.from("orders")
      .update({
        payment_id: String(payment.id),
        pix_qr_code: tx.qr_code,
        pix_qr_code_base64: tx.qr_code_base64 ?? null,
      })
      .eq("id", orderId)
      .select("id,status,total")
      .single();
    if (savePaymentError || !savedOrder) {
      console.error("Pix criado; metadados pendentes de reconciliação para o pedido:", orderId);
      return json({ error: "O Pix foi iniciado e o pedido está salvo com o código " + orderId + ". Atualize seus pedidos ou fale com a loja se os dados do Pix não aparecerem." }, 500);
    }
    const initialStatus = payment.status === "approved" ? "Pagamento Confirmado" :
      (["rejected", "cancelled"].includes(String(payment.status)) ? "Cancelada" : "Pagamento Pendente");
    if (initialStatus !== "Pagamento Pendente") {
      await db.from("orders").update({ status: initialStatus })
        .eq("id", orderId).eq("status", "Pagamento Pendente");
    }
    const { data: finalOrder } = await db.from("orders").select("id,status,total").eq("id", orderId).single();
    const responseOrder = finalOrder || savedOrder;
    return json({
      order: responseOrder,
      paymentId: String(payment.id),
      qrCode: tx.qr_code,
      qrCodeBase64: tx.qr_code_base64 ?? null,
      paymentStatus: payment.status,
    });
  } catch (error) {
    console.error("Erro interno super-worker:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Erro interno ao processar o pedido. Tente novamente." }, 500);
  }
});
