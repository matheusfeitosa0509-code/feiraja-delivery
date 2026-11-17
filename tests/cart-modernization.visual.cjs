const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const normalizeText = value => String(value || '').replace(/\u00a0/g, ' ');

(async () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
  const helper = fs.readFileSync(path.join(root, 'loja-delivery-ui.js'), 'utf8').replace(/\bexport\s+/g, '');
  const schedule = fs.readFileSync(path.join(root, 'supabase/functions/_shared/store-schedule.js'), 'utf8').replace(/\bexport\s+/g, '');
  assert.equal(/\b(?:window\.)?(?:alert|confirm)\s*\(/.test(source), false, 'a loja não deve usar alert/confirm nativos');
  assert.equal(source.includes('Tudo da feira, retire ou receba em casa'), true);
  assert.equal(source.includes('cart-qty-control'), true);
  assert.equal(source.includes('cart-pref-substitution'), true);

  const product = {
    id: 'coco-un',
    name: 'Coco (un)',
    price: 9.99,
    old_price: null,
    category: 'Frutas',
    image: '',
    available: true,
    resale_enabled: false,
    resale_price: null,
    resale_min_qty: null,
    resale_unit: 'un',
  };
  const bootstrap = '<script>' +
    'window.__testSupabase={' +
    'auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},' +
    'from:table=>{const q={select(){return q},eq(){return q},neq(){return q},in(){return q},order(){return q},limit(){return q},range(){return q},gte(){return q},lte(){return q},or(){return q},not(){return q},is(){return q},insert(){return q},update(){return q},delete(){return q},upsert(){return q},maybeSingle:async()=>({data:null,error:null}),single:async()=>({data:null,error:null}),then(ok,fail){const data=table==="product_sales_rules"?[{product_id:"coco-un",sale_unit:"un",quantity_step:1,min_quantity:1,max_quantity:100,allow_value_sale:true,value_min_kg:1}]:[];return Promise.resolve({data,error:null}).then(ok,fail)}};return q;},' +
    'rpc:async()=>({data:false,error:null}),functions:{invoke:async()=>({data:{},error:null})},' +
    'storage:{from:()=>({upload:async()=>({data:{},error:null}),remove:async()=>({data:[],error:null}),getPublicUrl:()=>({data:{publicUrl:""}})})},' +
    'channel:()=>({on(){return this},subscribe(){return this}}),removeChannel:async()=>({})' +
    '};window.FeiraTurnstile={create:()=>({init(){},getToken:()=>"",reset(){},setRequired(){},isRequired:()=>false})};' +
    'window.FeiraLalamoveMap={mountAll(){}};' +
    '</script>';

  let html = source
    .replace(/<script>[\s\S]*?serviceWorker\.register[\s\S]*?<\/script>/i, '')
    .replace(/<link rel="manifest"[^>]*>/gi, '')
    .replace(/<link rel="preconnect"[^>]*>/gi, '')
    .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/gi, '')
    .replace(/<script src="\.\/turnstile\.js" defer><\/script>/i, '')
    .replace(/<script src="\.\/lalamove-map\.js"><\/script>/i, '');
  html = html.replace(/<script type="module">([\s\S]*?)<\/script>/i, (_all, code) => {
    code = code.replace(/^\s*import\s*\{\s*createClient\s*\}\s*from\s*['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2\.117\.1['"];\s*/m, '');
    code = code.replace(/^\s*import\s*\{[^}]+\}\s*from\s*['"]\.\/loja-delivery-ui\.js[^'"]*['"];\s*/m, '');
    code = code.replace(/^\s*import\s*\{\s*getStoreSchedule\s*\}\s*from\s*['"]\.\/supabase\/functions\/_shared\/store-schedule\.js[^'"]*['"];\s*/m, '');
    code = code.replace(/const supabase=createClient\([\s\S]*?\);\s*/, 'const supabase=window.__testSupabase;\n');
    return '<script>' + code + '</script>';
  });
  html = html.replace('<body', bootstrap + '<script>' + schedule + '</script><script>' + helper + '</script><body');

  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const errors = [];
      const dialogs = [];
      page.on('pageerror', error => errors.push('pageerror: ' + error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push('console.error: ' + message.text()); });
      page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
      await page.addInitScript(() => {
        localStorage.setItem('feiraja_cart_v1', JSON.stringify({ 'coco-un': 5 }));
        localStorage.setItem('feiraja_cart_modes_v1', '{}');
        localStorage.setItem('feiraja_cart_value_cents_v1', '{}');
        localStorage.setItem('feiraja_cart_preferences_v1', '{}');
      });
      await page.route('**/*', route => route.fulfill({ status: 200, body: '' }));
      await page.route(url => url.hostname === 'juhwdevvwstmyxyyagzh.supabase.co' && url.pathname.endsWith('/rest/v1/products'),
        route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([product]) }));
      await page.route('http://127.0.0.1/loja.html', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
      await page.goto('http://127.0.0.1/loja.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('#cartItems .cart-item').length === 1, null, { timeout: 10000 });
      await page.locator('.tab-button[data-page="Cart"]').click();
      await page.waitForFunction(() => document.querySelector('#pageCart')?.classList.contains('active'));
      const card = page.locator('#cartItems .cart-item');
      assert.equal(await card.count(), 1, width + 'px: um item no carrinho');
      assert.equal((await card.locator('.cart-qty-value').textContent()).trim(), '5 un');
      assert.equal(normalizeText((await page.locator('#checkout').textContent()).trim()), 'Continuar · R$ 49,95');
      assert.equal(normalizeText((await page.locator('#subtotal').textContent()).trim()), 'R$ 49,95');
      assert.equal(await card.locator('.value-sale-open').textContent(), 'Pedir por valor R$');
      assert.equal(await card.locator('.cart-pref-chip').count(), 0, 'não deve duplicar sugestões como Maduro');
      assert.equal(await card.locator('.cart-pref-summary').count(), 0, 'não deve repetir a preferência abaixo do select');
      assert.equal(await card.locator('.cart-pref-substitution select').count(), 1);
      assert.equal(await card.locator('.cart-item-preference textarea').getAttribute('rows'), '1');

      await card.locator('[data-q][data-d="1"]').click();
      assert.equal((await page.locator('#cartItems .cart-qty-value').textContent()).trim(), '6 un');
      assert.equal(normalizeText((await page.locator('#checkout').textContent()).trim()), 'Continuar · R$ 59,94');
      await page.locator('#cartItems .cart-item [data-q][data-d="-1"]').click();
      assert.equal((await page.locator('#cartItems .cart-qty-value').textContent()).trim(), '5 un');

      const note = page.locator('#cartItems .cart-item-preference textarea');
      await note.fill('Bem maduro, firme ao toque, sem manchas e pronto para consumir nos próximos dias.');
      const noteHeight = await note.evaluate(el => parseFloat(getComputedStyle(el).height));
      assert.ok(noteHeight > 40, width + 'px: campo de preferência deve crescer ao digitar');
      await page.locator('#cartItems .cart-pref-substitution select').selectOption('replace');

      const layout = await page.evaluate(() => {
        const card = document.querySelector('#cartItems .cart-item');
        const summary = document.querySelector('#pageCart #cartPanel .sum');
        const footer = document.querySelector('#pageCart .cart-footer');
        const nav = document.querySelector('.mobile-nav');
        const a = summary.getBoundingClientRect(), b = footer.getBoundingClientRect(), c = nav.getBoundingClientRect();
        return {
          cardRadius: getComputedStyle(card).borderRadius,
          cardShadow: getComputedStyle(card).boxShadow,
          summaryPosition: getComputedStyle(summary).position,
          footerPosition: getComputedStyle(footer).position,
          summaryAboveButton: a.bottom <= b.top + 1,
          buttonAboveNav: b.bottom <= c.top + 1,
          summaryBottom: a.bottom,
          footerTop: b.top,
          footerBottom: b.bottom,
          navTop: c.top,
          navHeight: c.height,
          noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
      assert.equal(layout.summaryPosition, 'fixed');
      assert.equal(layout.footerPosition, 'fixed');
      assert.equal(layout.summaryAboveButton, true);
      assert.equal(layout.buttonAboveNav, true, JSON.stringify(layout));
      assert.equal(layout.noHorizontalOverflow, true);
      assert.notEqual(layout.cardShadow, 'none');
      assert.deepEqual(dialogs, [], width + 'px: sem alert/confirm nativos');
      assert.deepEqual(errors, [], width + 'px: zero erros de console');
      await page.close();
    }
  } finally {
    await browser.close();
  }
  process.stdout.write('Carrinho modernizado: quantidade, preferência expansível, compra por valor e resumo fixo aprovados em 360px e 412px; sem erros de console ou diálogos nativos.\n');
})().catch(error => { console.error(error); process.exit(1); });
