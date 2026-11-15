const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const source = fs.readFileSync(path.join(process.cwd(), "painel.html"), "utf8");
  const style = source.match(/<style>([\\s\\S]*?)<\\/style>/);
  if (!style) throw new Error("CSS do painel não encontrado");
  const fixture = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style[1]}</style></head><body><main class="wrap">
  <article class="order">
    <div class="order-summary">
      <div class="order-summary-top"><div><h3>Pedido 4BCCB4BF</h3><small class="muted">15/11/2026, 12:03</small></div><strong class="total">R$ 139,95</strong><span class="pill">Pagamento Confirmado</span><span class="lalamove-test-badge">TESTE</span><button type="button" class="order-expand" data-order-toggle="4BCCB4BF" aria-expanded="false">Expandir</button></div>
      <div class="order-contact"><strong>Cliente de teste</strong><span>·</span><a class="order-phone" href="https://wa.me/5592999990000"> (92) 99999-0000</a><details class="order-email"><summary>E-mail</summary><span>cliente.teste@example.com</span></details></div>
      <div class="order-chips"><span class="order-chip">Entrega em casa (Lalamove)</span><span class="order-chip">Pix</span></div>
    </div>
    <div class="order-content" data-order-content="4BCCB4BF" hidden>
      <section class="lalamove-admin"><div class="lalamove-admin-head"><strong>Entrega Lalamove</strong></div><div class="lalamove-address"><small>ENDEREÇO</small><strong>Rua Teste, 700, Centro, Manaus - AM, Brasil</strong><a href="https://maps.google.com">Abrir no mapa</a></div><div class="lalamove-facts"><span>Veículo: <b>Moto</b></span><span>Peso: <b>3 kg</b></span><span>Taxa: <b>R$ 15,00</b></span></div><button>Chamar entregador</button><div class="lalamove-quote-box"><strong>Nova cotação Lalamove — Sandbox</strong><p>Moto: R$ 9,00</p><p>Carro: R$ 16,00</p><p class="lalamove-ready-warning">Cotação salva. Para criar a corrida, primeiro altere o status do pedido para “Pronto para Retirada”.</p><button disabled>Confirmar e criar corrida</button></div></section>
      <div class="order-observation"><small>OBSERVAÇÕES DO CLIENTE</small><span>Se faltar, me chamar pelo WhatsApp.</span></div>
      <div class="items"><div class="separation-header"><strong>Itens do pedido</strong><span>0 de 2 separados</span></div><div class="separation-item"><button class="separation-check"> </button><span class="separation-name">Banana prata — 2 kg</span><small class="separation-preference">Se faltar: substituir por similar</small><strong>R$ 12,00</strong></div><div class="item"><span>Subtotal</span><span>R$ 124,95</span></div><div class="item"><span>Taxa</span><span>R$ 15,00</span></div><div class="item item-total"><strong>Total</strong><strong>R$ 139,95</strong></div></div>
      <div class="statusrow"><div><label>Status</label><select><option>Pagamento Confirmado</option><option>Pronto para Retirada</option></select></div><button>Salvar</button></div>
    </div>
  </article></main><script>document.querySelector('[data-order-toggle]').addEventListener('click',e=>{const c=document.querySelector('[data-order-content]');c.hidden=!c.hidden;e.currentTarget.textContent=c.hidden?'Expandir':'Recolher';});</script></body></html>`;
  fs.mkdirSync("artifacts", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
      await page.setContent(fixture, { waitUntil: "domcontentloaded" });
      const contactY = await page.locator(".order-contact").evaluate(el => {
        const nodes = [el.querySelector("strong"), el.querySelector("a"), el.querySelector("summary")];
        return nodes.map(node => node.getBoundingClientRect().y);
      });
      if (Math.max(...contactY) - Math.min(...contactY) > 3) throw new Error(`Contato quebrou linha em ${width}px: ${contactY}`);
      const chipY = await page.locator(".order-chip").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y));
      if (Math.max(...chipY) - Math.min(...chipY) > 3) throw new Error(`Chips não ficaram lado a lado em ${width}px`);
      if (await page.locator(".order-content").isVisible()) throw new Error("Detalhes deveriam iniciar recolhidos");
      if (await page.locator(".lalamove-address").count() !== 1) throw new Error("Endereço deve aparecer uma única vez");
      await page.screenshot({ path: `artifacts/painel-${width}-resumo.png`, fullPage: true });
      await page.locator("[data-order-toggle]").click();
      if (!(await page.locator(".order-content").isVisible())) throw new Error("O cartão não expandiu");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) throw new Error(`Há rolagem horizontal em ${width}px`);
      await page.screenshot({ path: `artifacts/painel-${width}-expandido.png`, fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log("Playwright: cartões compactos aprovados em 360px e 412px; quatro capturas geradas.");
})().catch(error => { console.error(error); process.exit(1); });
