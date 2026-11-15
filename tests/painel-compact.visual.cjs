const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "painel.html"), "utf8");
  const style = source.match(/<style>([\s\S]*?)<\/style>/);
  if (!style) throw new Error("CSS do painel não encontrado");
  const renderStart = source.indexOf("function renderLalamoveDelivery(order,currentStatus){");
  const renderEnd = source.indexOf("async function startLalamoveQuote", renderStart);
  if (renderStart < 0 || renderEnd < 0) throw new Error("Renderizador real do painel não encontrado");
  const renderSource = source.slice(renderStart, renderEnd);
  if (!source.includes("confirmButton.disabled=true") || !source.includes("Cotação salva. Para criar a corrida")) {
    throw new Error("Regra visual de bloqueio da corrida não encontrada");
  }
  const pageHtml = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
    style[1] + '</style></head><body><main class="wrap"><input id="search" value=""><select id="filter"><option value="">Todos</option></select>' +
    '<strong id="count"></strong><strong id="pending"></strong><strong id="active"></strong><strong id="sum"></strong>' +
    '<div id="orders" class="orders"></div></main></body></html>';
  const order = {
    id: "TESTE4BCCB4BF", is_test_order: true, status: "Pagamento Confirmado",
    delivery_type: "delivery", delivery_address: { street: "Rua Teste", number: "700", neighborhood: "Centro" },
    customer_address: "Rua Teste, 700, Centro, Manaus", customer_name: "Cliente de teste",
    customer_phone: "(92) 99999-0000", customer_email: "cliente.teste@example.com",
    payment_method: "Pix", delivery_vehicle: "MOTO", delivery_weight_kg: 3,
    delivery_fee: 15, subtotal: 124.95, total: 139.95, pickup_code: "ABCD",
    items: [{ id: "i1", name: "Banana prata", unit: "kg", price: 6, quantity: 2, substitution_preference: "replace", item_note: "madura" }],
    market_checklist: { notes: "Se faltar, me chamar." }
  };
  fs.mkdirSync("artifacts", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
      await page.setContent(pageHtml, { waitUntil: "domcontentloaded" });
      await page.evaluate(({ renderSource, order }) => {
        const $ = id => document.getElementById(id);
        const statuses = ["Pedido Recebido", "Pagamento Pendente", "Pagamento Confirmado", "Preparando", "Pronto para Retirada", "Entregue", "Cancelada"];
        const normalizeOrderStatus = status => {
          const s = String(status || "").trim().toLowerCase();
          if (s === "pronto") return "Pronto para Retirada";
          if (s === "pago" || s === "pagamento confirmado") return "Pagamento Confirmado";
          if (s === "preparando") return "Preparando";
          if (s === "cancelada" || s === "cancelado") return "Cancelada";
          return "Pagamento Pendente";
        };
        const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
        const money = value => "R$ " + Number(value || 0).toFixed(2).replace(".", ",");
        const shortOrderNumber = id => String(id).slice(-8);
        const orderItemTotal = (price, quantity) => money(Number(price || 0) * Number(quantity || 1));
        const separatedKeysFor = () => [];
        const itemSeparationKey = (item, occurrence) => String(item.id || item.name) + ":" + occurrence;
        const formatOrderItemDescription = item => item.name || "Item";
        const lalamoveStatusLabel = status => String(status || "");
        const allOrders = [order];
        const render = new Function("allOrders", "$", "statuses", "normalizeOrderStatus", "esc", "money", "shortOrderNumber", "orderItemTotal", "separatedKeysFor", "itemSeparationKey", "formatOrderItemDescription", "lalamoveStatusLabel", renderSource + "\nreturn render;")(
          allOrders, $, statuses, normalizeOrderStatus, esc, money, shortOrderNumber, orderItemTotal, separatedKeysFor, itemSeparationKey, formatOrderItemDescription, lalamoveStatusLabel
        );
        render();
      }, { renderSource, order });
      const contactY = await page.locator(".order-contact").evaluate(el => {
        const nodes = [el.querySelector("strong"), el.querySelector("a"), el.querySelector("summary")];
        return nodes.map(node => node.getBoundingClientRect().y);
      });
      if (Math.max(...contactY) - Math.min(...contactY) > 3) throw new Error("Contato quebrou linha em " + width + "px: " + contactY);
      const chipY = await page.locator(".order-chip").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y));
      if (Math.max(...chipY) - Math.min(...chipY) > 3) throw new Error("Chips não ficaram lado a lado em " + width + "px");
      if (await page.locator(".order-content").isVisible()) throw new Error("Detalhes deveriam iniciar recolhidos");
      if (await page.locator(".lalamove-address").count() !== 1) throw new Error("Endereço deve aparecer uma única vez");
      if (await page.locator(".order-extra").count() !== 0) throw new Error("Código de retirada/endereço duplicado apareceu em entrega");
      if (await page.locator("#count").textContent() !== "0") throw new Error("Pedido de teste entrou no contador");
      await page.screenshot({ path: "artifacts/painel-" + width + "-resumo.png", fullPage: true });
      await page.locator("[data-order-toggle]").click();
      if (!(await page.locator(".order-content").isVisible())) throw new Error("O cartão não expandiu");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) throw new Error("Há rolagem horizontal em " + width + "px");
      await page.screenshot({ path: "artifacts/painel-" + width + "-expandido.png", fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log("Playwright: renderizador real do painel aprovado em 360px e 412px; quatro capturas geradas.");
})().catch(error => { console.error(error); process.exit(1); });
