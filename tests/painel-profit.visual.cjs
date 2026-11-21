const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "painel.html"), "utf8");
  const style = source.match(/<style>([\s\S]*?)<\/style>/);
  const funnelStyle = source.match(/<style id="storeFunnelStyles">([\s\S]*?)<\/style>/);
  if (!style) throw new Error("CSS do painel não encontrado");

  const tabsStart = source.indexOf('<div class="main-tabs"');
  const tabsEnd = source.indexOf("</div>", tabsStart) + 6;
  const funnelStart = source.indexOf('<section id="funnelTab"');
  const funnelEnd = source.indexOf('\n<section id="ordersTab"', funnelStart);
  const ordersStart = source.indexOf('<section id="ordersTab"');
  const settingsStart = source.indexOf('<section id="settingsTab"');
  const settingsEnd = source.indexOf('</section>\n<section id="productTools"', settingsStart) + 10;
  const ordersEnd = source.indexOf('</section>\n<section id="settingsTab"', ordersStart) + 10;
  if ([tabsStart, tabsEnd, funnelStart, funnelEnd, ordersStart, settingsStart, settingsEnd, ordersEnd].some(x => x < 0)) {
    throw new Error("Estrutura das três abas não encontrada");
  }

  const normalizeStart = source.indexOf("function normalizeOrderStatus(status){");
  const normalizeEnd = source.indexOf("\nlet allOrders=", normalizeStart);
  const filterStart = source.indexOf("function matchesOrderFilter(order,filter){");
  const filterEnd = source.indexOf("\nfunction renderOrderItemProfit", filterStart);
  const itemProfitStart = source.indexOf("function renderOrderItemProfit(snapshot,item){");
  const itemProfitEnd = source.indexOf("\nfunction renderOrderProfitMarkup", itemProfitStart);
  const orderProfitStart = source.indexOf("function renderOrderProfitMarkup(data,totalItems){");
  const orderProfitEnd = source.indexOf("\nfunction renderDailySummary", orderProfitStart);
  const tabStart = source.indexOf("function selectMainTab(tab){");
  const tabEnd = source.indexOf("\nfunction selectProductSection", tabStart);
  if ([normalizeStart,normalizeEnd,filterStart,filterEnd,itemProfitStart,itemProfitEnd,orderProfitStart,orderProfitEnd,tabStart,tabEnd].some(x => x < 0)) {
    throw new Error("Helpers reais do painel não encontrados");
  }
  const normalizeSource = source.slice(normalizeStart, normalizeEnd);
  const filterSource = source.slice(filterStart, filterEnd);
  const itemProfitSource = source.slice(itemProfitStart, itemProfitEnd);
  const orderProfitSource = source.slice(orderProfitStart, orderProfitEnd);
  const tabSource = source.slice(tabStart, tabEnd);

  const requiredControls = [
    "refresh","pushToggle","logout","shoppingListButton","loadMore","deliveryActivationToggle",
    "lalamoveEnvironmentSelect","openNewProduct","btnSave","btnUpdatePrice","btnConfirmPrice",
    "btnPreviewResale","btnConfirmResale","btnPreviewProductEdit","btnConfirmProductEdit",
    "toggleAvailability","refreshProducts","refreshProductRequests"
  ];
  for (const id of requiredControls) {
    if (!source.includes('id="' + id + '"')) throw new Error("Controle existente removido: #" + id);
  }

  const money = value => "R$ " + Number(value || 0).toFixed(2).replace(".", ",");
  const normalize = new Function(normalizeSource + "\nreturn normalizeOrderStatus;")();
  const matches = new Function("normalizeOrderStatus", filterSource + "\nreturn matchesOrderFilter;")(normalize);
  const renderItem = new Function("money", itemProfitSource + "\nreturn renderOrderItemProfit;")(money);
  const renderOrder = new Function("money", orderProfitSource + "\nreturn renderOrderProfitMarkup;")(money);

  const orders = [
    { status: "Pagamento Confirmado", is_test_order: false },
    { status: "Preparando", is_test_order: false },
    { status: "Pronto para Retirada", is_test_order: false },
    { status: "Saiu para Entrega", is_test_order: false },
    { status: "Pagamento Pendente", is_test_order: false },
    { status: "Entregue", is_test_order: false },
    { status: "Cancelada", is_test_order: false },
    { status: "Pagamento Expirado", is_test_order: false },
    { status: "Preparando", is_test_order: true }
  ];
  for (const order of orders.slice(0,4)) if (!matches(order,"active")) throw new Error("Pedido ativo foi excluído do filtro padrão");
  for (const order of orders.slice(4)) if (matches(order,"active")) throw new Error("Pedido pendente/concluído/cancelado/teste entrou no padrão");
  if (!matches(orders[4],"pending") || !matches(orders[5],"completed") || !matches(orders[6],"cancelled") || !matches(orders[7],"cancelled") || !matches(orders[8],"tests")) {
    throw new Error("Um dos filtros de pedidos não corresponde ao status");
  }
  if (orders.some(order => !matches(order,"all"))) throw new Error("Filtro Todos omitiu pedido");
  const positive = renderItem({quantity:2,sale_total:20,unit_cost:8,preco_balcao:8,preco_pago:6,cost_total:12,profit:8,profit_on_counter:4,cost_status:"ok"},{price:10,qty:2});
  const missing = renderItem({quantity:1,sale_total:5,unit_cost:null,preco_balcao:null,preco_pago:null,cost_status:"missing_cost"},{price:5,qty:1});
  const paidOnly = renderItem({quantity:2,sale_total:20,unit_cost:6,preco_balcao:null,preco_pago:6,cost_total:12,profit:8,cost_status:"ok"},{price:10,qty:2});
  const negative = renderItem({quantity:1,sale_total:10,unit_cost:12,preco_balcao:12,preco_pago:12,cost_total:12,profit:-2,cost_status:"ok"},{price:10,qty:1});
  if (!positive.includes("Lucro real: R$ 8,00") || !positive.includes("Lucro sobre balcão: R$ 4,00") || !positive.includes("profit-positive")) throw new Error("Lucro real e sobre balcão não foram renderizados");
  if (!missing.includes("sem preço de custo") || !missing.includes("missing")) throw new Error("Item sem preço de custo não foi sinalizado em cinza");
  if (!paidOnly.includes("Lucro real: R$ 8,00") || paidOnly.includes("Lucro sobre balcão")) throw new Error("Preço pago sem balcão foi incorretamente tratado como preço de balcão");
  if (!negative.includes("Lucro real: R$ -2,00") || !negative.includes("Lucro sobre balcão: R$ -2,00") || !negative.includes("profit-negative")) throw new Error("Prejuízo real e sobre balcão não foram renderizados em vermelho");
  const partial = renderOrder({calculated_items:1,total_items:2,profit:4,profit_on_counter_total:null,delivery_covered:3},2);
  const counterUnknown = renderOrder({calculated_items:1,total_items:1,profit:4,profit_on_counter_total:null},1);
  if (!counterUnknown.includes("Lucro sobre balcão: —")) throw new Error("Lucro sobre balcão desconhecido foi exibido como zero");
  if (!partial.includes("Lucro real parcial (1 de 2 itens)") || !partial.includes("Inclui R$ 3,00 de entrega coberta") || !partial.includes("Lucro sobre balcão")) {
    throw new Error("Lucro parcial ou abatimento da entrega coberta não foi exibido");
  }

  const markup = source.slice(tabsStart,tabsEnd) +
    source.slice(funnelStart,funnelEnd) +
    source.slice(ordersStart,ordersEnd) +
    source.slice(settingsStart,settingsEnd) +
    '<section id="productTools" class="hidden" role="tabpanel"></section>';
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360,412]) {
      const page = await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
      const errors = [];
      page.on("pageerror",error=>errors.push(error.message));
      page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
      await page.setContent('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+style[1]+'</style></head><body><main class="wrap">'+markup+'</main></body></html>');
      await page.evaluate(tabSource=>{
        const selectMainTab = new Function("document",tabSource+"\nreturn selectMainTab;")(document);
        document.getElementById("tabOrders").addEventListener("click",()=>selectMainTab("orders"));
        document.getElementById("tabProducts").addEventListener("click",()=>selectMainTab("products"));
        document.getElementById("tabSettings").addEventListener("click",()=>selectMainTab("settings"));
        document.getElementById("tabFunnel").addEventListener("click",()=>selectMainTab("funnel"));
      },tabSource);
      if (await page.locator(".daily-stats .stat").count()!==5) throw new Error("Resumo não tem cinco cards em "+width+"px");
      if (await page.locator("#ordersTab #upcomingHolidaysCard").count()!==0 || await page.locator("#ordersTab #lalamoveSettingsCard").count()!==0) {
        throw new Error("Configurações ainda aparecem na aba Pedidos");
      }
      if (await page.locator("#settingsTab #upcomingHolidaysCard").count()!==1 || await page.locator("#settingsTab #lalamoveSettingsCard").count()!==1) {
        throw new Error("Feriados/configurações de entrega não foram movidos");
      }
      await page.locator("#tabFunnel").click();
      const funnelState=await page.evaluate(()=>({ordersHidden:document.getElementById("ordersTab").classList.contains("hidden"),productsHidden:document.getElementById("productTools").classList.contains("hidden"),settingsHidden:document.getElementById("settingsTab").classList.contains("hidden"),funnelHidden:document.getElementById("funnelTab").classList.contains("hidden"),selected:document.getElementById("tabFunnel").getAttribute("aria-selected"),columns:getComputedStyle(document.querySelector(".main-tabs")).gridTemplateColumns.split(" ").length}));
      if (!funnelState.ordersHidden || !funnelState.productsHidden || !funnelState.settingsHidden || funnelState.funnelHidden || funnelState.selected!=="true") throw new Error("Aba Funil não alternou em "+width+"px: "+JSON.stringify(funnelState));
      if(funnelState.columns!==2)throw new Error("Abas principais não quebraram em duas colunas no celular "+width+"px");
      await page.locator("#tabSettings").click();
      if (!(await page.locator("#settingsTab").isVisible()) || await page.locator("#ordersTab").isVisible()) throw new Error("Aba Configurações não alternou");
      await page.locator("#tabProducts").click();
      const productState=await page.evaluate(()=>({ordersHidden:document.getElementById("ordersTab").classList.contains("hidden"),productsHidden:document.getElementById("productTools").classList.contains("hidden"),settingsHidden:document.getElementById("settingsTab").classList.contains("hidden")}));
      if (!productState.ordersHidden || productState.productsHidden || !productState.settingsHidden) throw new Error("Aba Produtos não alternou: "+JSON.stringify(productState));
      await page.locator("#tabOrders").click();
      const ordersState=await page.evaluate(()=>({ordersHidden:document.getElementById("ordersTab").classList.contains("hidden"),productsHidden:document.getElementById("productTools").classList.contains("hidden"),settingsHidden:document.getElementById("settingsTab").classList.contains("hidden")}));
      if (ordersState.ordersHidden || !ordersState.productsHidden || !ordersState.settingsHidden) throw new Error("Aba Pedidos não alternou: "+JSON.stringify(ordersState));
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      if(overflow)throw new Error("Rolagem horizontal em "+width+"px");
      if(errors.length)throw new Error("Console/page errors em "+width+"px: "+errors.join(" | "));
      await page.close();
    }
  } finally { await browser.close(); }
  console.log("Painel admin Playwright: abas Pedidos/Produtos/Configurações/Funil, filtros, lucro e layout 360/412px aprovados; controles existentes preservados.");
})().catch(error=>{console.error(error);process.exit(1);});
