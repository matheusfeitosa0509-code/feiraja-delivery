const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const loja = fs.readFileSync(path.join(process.cwd(), "loja.html"), "utf8");
  const painel = fs.readFileSync(path.join(process.cwd(), "painel.html"), "utf8");
  const style = loja.match(/<style id="orderTrackingLayout">([\s\S]*?)<\/style>/);
  if (!style) throw new Error("CSS da linha do tempo não encontrado");
  const helperStart = loja.indexOf("function customerDeliveryPresentation(order){");
  const helperEnd = loja.indexOf("const timeline=(order)=>", helperStart);
  const timelineStart = helperEnd;
  const timelineEnd = loja.indexOf("const paidOrder=data.find", timelineStart);
  if ([helperStart, helperEnd, timelineEnd].some(x => x < 0)) throw new Error("Renderizador da linha do tempo não encontrado");
  const helperSource = loja.slice(helperStart, helperEnd);
  const timelineSource = loja.slice(timelineStart, timelineEnd);
  const panelStart = painel.indexOf("function lalamoveStatusLabel(status){");
  const panelEnd = painel.indexOf("function lalamoveEnvironmentBadge", panelStart);
  if (panelStart < 0 || panelEnd < 0) throw new Error("Rótulos do painel não encontrados");
  const panelSource = painel.slice(panelStart, panelEnd);
  const normalizeOrderStatus = value => {
    const s = String(value || "").trim().toLowerCase();
    if (["cancelada", "cancelado"].includes(s)) return "Cancelada";
    if (s === "entregue" || s === "concluído" || s === "concluido") return "Entregue";
    if (s === "pronto" || s === "pronto para retirada") return "Pronto para Retirada";
    if (s === "preparando") return "Preparando";
    if (s === "saiu para entrega") return "Saiu para Entrega";
    if (s === "pagamento reembolsado") return "Pagamento reembolsado";
    if (s === "pagamento contestado") return "Pagamento contestado";
    return value;
  };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]);
  const helper = new Function("normalizeOrderStatus", helperSource + "\nreturn customerDeliveryPresentation;")(normalizeOrderStatus);
  const timeline = new Function("normalizeOrderStatus", "esc", helperSource + "\n" + timelineSource + "\nreturn timeline;")(normalizeOrderStatus, esc);
  const panelLabel = new Function(panelSource + "\nreturn lalamoveStatusLabel;")();
  const expectations = {
    searching: "Procurando entregador",
    assigned: "Entregador a caminho da feira",
    enroute_pickup: "Entregador a caminho da feira",
    picked_up: "Saiu para entrega",
    delivered: "Entregue",
    completed: "Entregue"
  };
  for (const [status, label] of Object.entries(expectations)) {
    if (panelLabel(status) !== label) throw new Error("Painel: " + status + " deveria ser " + label);
  }
  const cases = [
    { name:"procurando", order:{status:"Pronto para Retirada",delivery_type:"delivery",lalamove_status:"searching"}, stage:"Buscando entregador" },
    { name:"a-caminho", order:{status:"Preparando",delivery_type:"delivery",lalamove_status:"assigned"}, stage:"A caminho da feira" },
    { name:"saiu", order:{status:"Saiu para Entrega",delivery_type:"delivery",lalamove_status:"picked_up"}, stage:"Saiu para entrega" },
    { name:"entregue", order:{status:"Entregue",delivery_type:"delivery",lalamove_status:"completed"}, stage:"Entregue" },
    { name:"entrega-cancelada-ativa", order:{status:"Preparando",delivery_type:"delivery",lalamove_status:"cancelled",separation_started_at:"2026-11-20T08:00:00Z"}, stage:"Buscando entregador", card:"delivery-retry" },
    { name:"pedido-cancelado", order:{status:"Cancelada",delivery_type:"delivery",lalamove_status:"cancelled",separation_started_at:"2026-11-20T08:00:00Z"}, stage:null, card:"order-cancelled" }
  ];
  fs.mkdirSync("artifacts", { recursive:true });
  const browser=await chromium.launch({headless:true});
  try {
    for (const width of [360,412]) {
      const page=await browser.newPage({viewport:{width,height:950},deviceScaleFactor:1});
      await page.setContent('<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;font:14px system-ui;color:#173525}.order-card{max-width:520px;margin:auto;padding:12px;border:1px solid #ddd;border-radius:14px}'+style[1]+'</style></head><body><main id="cases"></main></body></html>');
      for (const item of cases) {
        const presentation=helper(item.order);
        const markup= presentation.kind==="delivery-retry"
          ? '<div class="delivery-cancel-card is-delivery-retry"><b>'+presentation.title+'</b><span>'+presentation.message+'</span></div>'
          : presentation.kind==="order-cancelled"
          ? '<div class="delivery-cancel-card is-order-cancelled"><b>'+presentation.title+'</b><span>'+presentation.message+'</span></div>' : "";
        const timelineMarkup=presentation.hideTimeline?"":timeline(item.order);
        await page.locator("#cases").evaluate((root,{markup,timelineMarkup,name})=>{
          const card=document.createElement("article");card.className="order-card";card.dataset.case=name;card.innerHTML=markup+timelineMarkup;root.append(card);
        },{markup,timelineMarkup,name:item.name});
        const card=page.locator('[data-case="'+item.name+'"]');
        if (item.card==="delivery-retry") {
          if (!(await card.locator(".is-delivery-retry").isVisible())) throw new Error("Card amarelo ausente em "+item.name);
          if ((await card.textContent()).includes("A entrega foi cancelada")) throw new Error("Texto de cancelamento indevido para entrega cancelada");
          if (!(await card.locator(".order-timeline").isVisible())) throw new Error("Linha do tempo deve continuar para pedido ativo");
          if (!(await card.textContent()).includes("Seu pedido continua garantido.")) throw new Error("Garantia do pedido ausente");
        } else if (item.card==="order-cancelled") {
          if (!(await card.locator(".is-order-cancelled").isVisible())) throw new Error("Card vermelho ausente");
          if (await card.locator(".order-timeline").count()) throw new Error("Pedido cancelado não pode mostrar linha do tempo");
          if ((await card.textContent()).includes("Em separação") || (await card.textContent()).includes("não pode mais ser cancelado")) throw new Error("Pedido cancelado exibiu estado de pedido ativo");
        } else {
          if (!(await card.locator(".order-timeline").isVisible())) throw new Error("Linha do tempo ausente em "+item.name);
          if (!(await card.textContent()).includes(item.stage)) throw new Error("Etapa incorreta em "+item.name);
        }
        if (item.stage) {
          const labels=await card.locator(".timeline-label").allTextContents();
          if (item.name==="procurando" && labels[2]!=="Buscando entregador") throw new Error("Rótulo de busca incorreto");
          if (item.name==="a-caminho" && labels[3]!=="A caminho da feira") throw new Error("Rótulo de destino incorreto");
          if (item.name==="saiu" && labels[4]!=="Saiu para entrega") throw new Error("Rótulo de saída incorreto");
          if (item.name==="entregue" && labels[5]!=="Entregue") throw new Error("Rótulo de conclusão incorreto");
          if (item.name==="entrega-cancelada-ativa" && labels[2]!=="Buscando entregador") throw new Error("Entrega cancelada não voltou à busca");
          const active=card.locator(".timeline-label").filter({hasText:item.stage}).first();
          if (!(await active.evaluate(el=>el.closest("li").classList.contains("now")))) throw new Error("Etapa atual não está destacada em verde: "+item.name);
        }
      }
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      if(overflow)throw new Error("Rolagem horizontal em "+width+"px");
      const motoSvg=await page.locator(".order-timeline svg").first().evaluate(el=>el.outerHTML);
      if(!motoSvg.includes("viewBox"))throw new Error("SVG de ícone não renderizou");
      await page.screenshot({path:"artifacts/order-tracking-"+width+".png",fullPage:true});
      await page.close();
    }
  } finally { await browser.close(); }
  if (!loja.includes("Hoje (feriado): 6h às 11h · Seg a sáb, 6h às 13h")) throw new Error("Faixa de feriado não está configurada");
  console.log("Acompanhamento: status, cancelamentos, linha do tempo e responsividade aprovados em 360px e 412px.");
})().catch(error=>{console.error(error);process.exit(1);});
