const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "painel.html"), "utf8");
  const style = source.match(/<style>([\\s\\S]*?)<\\/style>/);
  if (!style) throw new Error("CSS do painel não encontrado");
  const renderStart = source.indexOf("function lalamoveStatusLabel(status){");
  const renderEnd = source.indexOf("async function lalamoveErrorMessage", renderStart);
  if (renderStart < 0 || renderEnd < 0) throw new Error("Renderizadores reais do painel não encontrados");
  const renderSource = source.slice(renderStart, renderEnd);
  if (!source.includes("data-lalamove-feedback") || !source.includes("setLalamoveFeedback(orderId")) {
    throw new Error("Feedback de entrega dentro do cartão não encontrado");
  }
  const pageHtml = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
    style[1] + '</style></head><body><main class="wrap"><input id="search" value=""><select id="filter"><option value="">Todos</option></select>' +
    '<strong id="count"></strong><strong id="pending"></strong><strong id="active"></strong><strong id="sum"></strong>' +
    '<div id="orders" class="orders"></div></main></body></html>';
  const order = {
    id: "FEIRA-TESTE-4BCCB4BF", is_test_order: true, status: "Pagamento Confirmado",
    delivery_type: "delivery", delivery_address: { street: "Rua Japiassu", number: "140", neighborhood: "Lago Azul" },
    customer_address: "Rua Japiassu, 140, Lago Azul, Manaus", customer_name: "Cliente de teste",
    customer_phone: "(92) 99999-0000", customer_email: "cliente.teste@example.com",
    payment_method: "Pix", delivery_vehicle: "MOTO", delivery_weight_kg: 3,
    delivery_fee: 15, subtotal: 39.96, total: 54.96, pickup_code: "ABCD",
    items: [{ id: "feiraja_agua_de_coco_unidade", name: "Coco (un)", unit: "un", price: 9.99, qty: 4, substitution_preference: "call", item_note: "Maduro" }],
    separated_items: [], market_checklist: { notes: "Se faltar, me chamar." }
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
        const separatedKeysFor = order => Array.isArray(order.separated_items) ? order.separated_items : [];
        const itemSeparationKey = (item, occurrence) => String(item.id || item.name) + ":" + occurrence;
        const formatOrderItemDescription = item => "Coco — 4 un";
        const noop = () => {};
        const render = new Function("allOrders", "$", "statuses", "normalizeOrderStatus", "esc", "money", "shortOrderNumber", "orderItemTotal", "separatedKeysFor", "itemSeparationKey", "formatOrderItemDescription", "saveStatus", "markRefundDone", "toggleSeparatedItem", "startLalamoveQuote", "cancelLalamoveDelivery", renderSource + "\\nreturn render;")(
          [order], $, statuses, normalizeOrderStatus, esc, money, shortOrderNumber, orderItemTotal,
          separatedKeysFor, itemSeparationKey, formatOrderItemDescription, noop, noop, noop, noop, noop
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
      if (await page.locator(".lalamove-feedback").count() !== 1) throw new Error("Feedback da entrega não está no cartão");
      if (await page.locator("#count").textContent() !== "0") throw new Error("Pedido de teste entrou no contador");
      await page.screenshot({ path: "artifacts/painel-" + width + "-resumo.png", fullPage: true });
      await page.locator("[data-order-toggle]").click();
      if (!(await page.locator(".order-content").isVisible())) throw new Error("O cartão não expandiu");
      const marker = page.locator(".separation-check");
      const markerBox = await marker.boundingBox();
      const circleBox = await page.locator(".separation-check-mark").boundingBox();
      const nameBox = await page.locator(".separation-name").boundingBox();
      const noteBox = await page.locator(".separation-detail .separation-preference").first().boundingBox();
      const preferenceBox = await page.locator(".separation-detail .separation-preference").nth(1).boundingBox();
      if (!markerBox || markerBox.width < 44 || markerBox.height < 44) throw new Error("Área de toque do marcador menor que 44px em " + width + "px");
      if (!circleBox || Math.abs(circleBox.width - 26) > 1 || Math.abs(circleBox.height - 26) > 1) throw new Error("Círculo visual não tem 26px em " + width + "px");
      if (markerBox.x + markerBox.width > nameBox.x + 1) throw new Error("Marcador sobrepõe o nome em " + width + "px");
      if (Math.abs(noteBox.x - nameBox.x) > 1 || Math.abs(preferenceBox.x - nameBox.x) > 1) throw new Error("Observação/preferência desalinhada com o nome em " + width + "px");
      if (await page.locator(".separation-name").textContent() !== "Coco — 4 un") throw new Error("Descrição/quantidade incorreta");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) throw new Error("Há rolagem horizontal em " + width + "px");
      await page.screenshot({ path: "artifacts/painel-" + width + "-expandido.png", fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log("Playwright: renderizadores reais, marcador circular/44px sem sobreposição, notas alinhadas e feedback no cartão aprovados em 360px e 412px.");
})().catch(error => { console.error(error); process.exit(1); });
