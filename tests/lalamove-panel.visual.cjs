const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "painel.html"), "utf8");
  const style = source.match(/<style>([\s\S]*?)<\/style>/);
  if (!style) throw new Error("CSS do painel não encontrado");
  const orderStart = source.indexOf("function lalamoveStatusLabel(status){");
  const orderEnd = source.indexOf("function render(){", orderStart);
  const flowStart = source.indexOf("async function lalamoveErrorMessage");
  const flowEnd = source.indexOf("async function refreshLalamoveStatus", flowStart);
  const confirmStart = source.indexOf("function appConfirm(message,options={})");
  const confirmEnd = source.indexOf("\n\n</script>", confirmStart);
  const showStart = source.indexOf("async function show(){");
  const showEnd = source.indexOf("\nasync function load(quiet=false)", showStart);
  const showSource = source.slice(showStart, showEnd);
  if ([orderStart,orderEnd,flowStart,flowEnd,confirmStart,confirmEnd,showStart,showEnd].some(x => x < 0)) {
    throw new Error("Funções reais de ambiente, entrega e modal não encontradas");
  }
  const orderSource = source.slice(orderStart, orderEnd);
  const flowSource = source.slice(flowStart, flowEnd);
  const confirmSource = source.slice(confirmStart, confirmEnd);
  const settingsMarkup = source.slice(source.indexOf('<section class="card lalamove-settings"'), source.indexOf('</section>', source.indexOf('<section class="card lalamove-settings"')) + 10);
  const browser = await chromium.launch({ headless: true });
  fs.mkdirSync("artifacts", { recursive: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
      const order = {
        id: "TEST-LALAMOVE-" + width, is_test_order: true, status: "Preparando",
        delivery_type: "delivery", delivery_address: { street: "Rua Japiassu", number: "140", neighborhood: "Lago Azul" },
        customer_address: "Rua Japiassu, 140, Lago Azul, Manaus", customer_name: "Cliente de teste",
        customer_phone: "(92) 99999-0000", payment_method: "Pix", delivery_vehicle: "MOTO",
        delivery_weight_kg: 3, delivery_fee: 15, items: []
      };
      const readyOrder = { ...order, id: order.id + "-READY", status: "Pronto" };
      const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
        style[1] + '</style></head><body><main class="wrap">' + settingsMarkup +
        '<div id="orders" class="orders"></div><div id="priceEditor" class="hide"></div><div id="resaleEditor" class="hide"></div><div id="productEdit" class="hide"></div><div id="message"></div></main><div id="appDialogBackdrop" class="app-dialog-backdrop" hidden><section class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle" aria-describedby="appDialogMessage"><h2 id="appDialogTitle">Confirmar ação</h2><p id="appDialogMessage"></p><div class="app-dialog-actions"><button id="appDialogBack" type="button" class="app-dialog-back">Voltar</button><button id="appDialogConfirm" type="button" class="app-dialog-confirm">Confirmar</button></div></section></div></body></html>';
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.evaluate(async ({ order, readyOrder, orderSource, flowSource, confirmSource, showSource }) => {
        const $ = id => document.getElementById(id);
        const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]);
        const money = value => "R$ " + Number(value || 0).toFixed(2).replace(".", ",");
        const normalizeOrderStatus = status => {
          const s = String(status || "").trim().toLowerCase();
          if (s === "pronto") return "Pronto para Retirada";
          if (s === "preparando") return "Preparando";
          return s;
        };
        let lalamoveEnvironment = "sandbox";
        let allOrders = [order, readyOrder];
        const calls = [];
        const adminUserId = "admin-test-session-282";
        const db = {
          auth: { getSession: async () => ({ data: { session: { user: { id: adminUserId, is_anonymous: false } } }, error: null }) },
          from: table => {
            if (table === "admin_users") return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: adminUserId }, error: null }) }) })
            };
            return {
              select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { lalamove_ambiente: lalamoveEnvironment }, error: null }) }) }),
              update: values => ({ eq: () => ({ select: () => ({ maybeSingle: async () => {
                lalamoveEnvironment = values.lalamove_ambiente;
                return { data: { lalamove_ambiente: lalamoveEnvironment }, error: null };
              } }) }) })
            };
          },
          functions: { invoke: async (name, options) => {
            calls.push({ name, action: options.body.action });
            if (options.body.action === "quote") return { error: null, data: {
              environment: "producao", quote_session_id: "00000000-0000-4000-8000-000000000001",
              selected_vehicle: "MOTO", moto: { fee: 12.05, difference: -2.95 }, car: { fee: 14.40, difference: -0.60 }
            }};
            if (options.body.action === "create") return { error: null, data: { created: true, vehicle: options.body.vehicle } };
            return { error: null, data: {} };
          }}
        };
        const appConfirm = new Function("$", confirmSource + "; return appConfirm;")($);
        const renderSource = orderSource;
        const renderOrder = new Function("order","currentStatus","lalamoveEnvironment","esc","money",renderSource+
          "\nreturn renderLalamoveDelivery(order,currentStatus);")(order,"Preparando",lalamoveEnvironment,esc,money);
        const renderReady = new Function("order","currentStatus","lalamoveEnvironment","esc","money",renderSource+
          "\nreturn renderLalamoveDelivery(order,currentStatus);")(readyOrder,"Pronto para Retirada",lalamoveEnvironment,esc,money);
        $("orders").innerHTML = renderOrder + renderReady;
        let loggedIn = false;
        const flow = new Function("db","$","esc","money","appConfirm","normalizeOrderStatus","allOrders","load","CSS","document","lalamoveEnvironment","orderSource","flowSource","calls",
          "let lalamoveEnvironmentReady=false,lalamoveEnvironmentLoadError='';const render=()=>{const badge=$('lalamoveSettingsBadge');badge.className='lalamove-env-badge '+lalamoveEnvironment;badge.textContent=lalamoveEnvironment==='producao'?'PRODUÇÃO':'SANDBOX';$('orders').innerHTML=new Function('order','currentStatus','lalamoveEnvironment','esc','money',orderSource+';return renderLalamoveDelivery(order,currentStatus);')(allOrders[0],'Preparando',lalamoveEnvironment,esc,money)+new Function('order','currentStatus','lalamoveEnvironment','esc','money',orderSource+';return renderLalamoveDelivery(order,currentStatus);')(allOrders[1],'Pronto para Retirada',lalamoveEnvironment,esc,money);};"+orderSource+"\n"+confirmSource+"\n"+flowSource+
          "\nreturn {changeLalamoveEnvironment,handleLalamoveQuoteClick,loadLalamoveEnvironment,renderOrder: (o,s)=>new Function('order','currentStatus','lalamoveEnvironment','esc','money',orderSource+';return renderLalamoveDelivery(order,currentStatus);')(o,s,lalamoveEnvironment,esc,money),getCalls:()=>calls,getEnvironment:()=>lalamoveEnvironment,setEnvironmentError:(msg)=>{lalamoveEnvironmentReady=false;lalamoveEnvironmentLoadError=msg;}};"
        )(db,$,esc,money,appConfirm,normalizeOrderStatus,allOrders,async()=>{},CSS,document,lalamoveEnvironment,orderSource,flowSource,calls);
        const showAdmin = new Function("db","$","setLoggedIn","initPanelPush","loadLalamoveEnvironment","load","loadAdminProducts","loadProductRequests","loadCostReport","cleanupPanelPushAndSignOut","showSource",
          "let panelCurrentUser=null;"+showSource+";return show;"
        )(db,$,value=>{loggedIn=value;},async()=>{},flow.loadLalamoveEnvironment,async()=>{},async()=>{},async()=>{},async()=>{},async()=>{},showSource);
        await showAdmin();
        if(!loggedIn) throw new Error("Sessão autenticada não foi reconhecida como administrador em "+width+"px");
        window.testHooks = flow;
        window.testOrders = { order, readyOrder };
      }, { order, readyOrder, orderSource, flowSource, confirmSource, showSource });
      await page.waitForFunction(() => document.getElementById("lalamoveSettingsMessage").textContent.includes("Ambiente atual"));
      await page.locator("#lalamoveEnvironmentSelect").selectOption("producao");
      await page.getByRole("dialog").getByRole("button", { name: "Confirmar Produção" }).click();
      await page.waitForFunction(() => document.getElementById("lalamoveSettingsBadge").textContent === "PRODUÇÃO");
      if (await page.locator(".lalamove-env-badge").count() < 3) throw new Error("Badge de ambiente ausente nos pedidos/configurações em " + width + "px");
      if (await page.locator('[data-lalamove-quote]').count() !== 2) throw new Error("Botão de chamar entregador não aparece em Preparando e Pronto em " + width + "px");
      const callButton = page.locator('[data-lalamove-quote="' + order.id + '"]');
      await callButton.click();
      if (await callButton.textContent() !== "Carregando…") throw new Error("Botão não mostrou estado Carregando em "+width+"px");
      const prepDialog = page.getByRole("dialog");
      if (!(await prepDialog.locator("#appDialogMessage").textContent()).includes("O entregador costuma chegar em ~10 min")) {
        throw new Error("Aviso de Preparando não apareceu em " + width + "px");
      }
      await prepDialog.getByRole("button", { name: "Continuar" }).click();
      await page.locator('[data-lalamove-quote-box="' + order.id + '"]').waitFor({ state: "visible" });
      const quoteBoxText = await page.locator('[data-lalamove-quote-box="' + order.id + '"]').textContent();
      if (!quoteBoxText.includes("Produção")) throw new Error("Cotação não identificou Produção em " + width + "px: " + JSON.stringify({ quoteBoxText, environment: await page.evaluate(() => window.testHooks.getEnvironment()) }));
      await page.locator('[data-lalamove-quote-box="' + order.id + '"] [data-lalamove-vehicle="CAR"]').click();
      await page.locator('[data-lalamove-quote-box="' + order.id + '"] [data-lalamove-confirm]').click();
      const productionDialog = page.getByRole("dialog");
      const confirmText = await productionDialog.locator("#appDialogMessage").textContent();
      if (!confirmText.includes("R$ 14,40") || !confirmText.includes("Carro")) throw new Error("Confirmação não mostra preço real e veículo em " + width + "px");
      await productionDialog.getByRole("button", { name: "Criar corrida real" }).click();
      await page.waitForFunction(() => document.querySelector('[data-lalamove-feedback]')?.textContent.includes("Corrida criada") || document.querySelector('[data-lalamove-feedback]')?.textContent.includes("Corrida criada no Sandbox") || document.querySelector('[data-lalamove-feedback]')?.textContent.includes("Acompanhamento"));
      const calls = await page.evaluate(() => window.testHooks.getCalls());
      if (calls.filter(x => x.action === "quote").length !== 1 || calls.filter(x => x.action === "create").length !== 1) {
        throw new Error("A API mockada não recebeu exatamente uma cotação e uma criação em " + width + "px");
      }
      await page.locator("#lalamoveEnvironmentSelect").selectOption("sandbox");
      await page.waitForFunction(() => document.getElementById("lalamoveSettingsBadge").textContent === "SANDBOX");
      await page.evaluate(() => window.testHooks.setEnvironmentError("permission denied for table delivery_settings"));
      await page.locator('[data-lalamove-quote="' + readyOrder.id + '"]').click();
      await page.locator('[data-lalamove-feedback="' + readyOrder.id + '"]').waitFor({ state: "visible" });
      const environmentError = await page.locator('[data-lalamove-feedback="' + readyOrder.id + '"]').textContent();
      if (!environmentError.includes("permission denied")) throw new Error("Erro de ambiente não foi exibido no pedido em "+width+"px");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) throw new Error("Rolagem horizontal em " + width + "px");
      await page.screenshot({ path: "artifacts/lalamove-panel-" + width + ".png", fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log("Playwright Lalamove: seletor, badge, modal de Produção, aviso Preparando, botão em Preparando/Pronto e API mockada aprovados em 360px e 412px.");
})().catch(error => { console.error(error); process.exit(1); });
