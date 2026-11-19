const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const base = process.env.PAGES_BASE_URL || 'https://www.feiraondelivery.com.br';
  const failures = [];
  try {
    for (const path of ['/loja.html', '/painel.html']) {
      const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
      const errors = [];
      page.on('response', response => { if(response.status()===401 && !response.url().includes('/rpc/admin_get_low_margin_percent')) errors.push('HTTP 401 '+response.url()); });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const response = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (!response || response.status() !== 200) failures.push(path + ': HTTP ' + (response && response.status()));
      if (path === '/loja.html') {
        try {
          await page.waitForFunction(() => {
            const root = document.querySelector('#homeProductSections');
            return !!root && root.querySelectorAll('.product:not(.skeleton-card)').length > 0;
          }, { timeout: 45000 });
        } catch (_) { failures.push('/loja.html: produtos não carregaram'); }
      }
      await page.waitForTimeout(1200);
      if (errors.length) failures.push(path + ': console/page errors: ' + errors.join(' | '));
      await page.close();
    }

    // Cache com 25h deve ser ignorado e a falha da revalidação deve exibir o aviso.
    const cachePage = await browser.newPage({ viewport: { width: 360, height: 800 } });
    let productFetches = 0;
    await cachePage.addInitScript(() => {
      localStorage.setItem('feira_storefront_catalog_v1', JSON.stringify({
        version: 1, updatedAt: Date.now() - 25 * 60 * 60 * 1000,
        products: [{ id: 'expired-cache-probe', name: 'CACHE VENCIDO', price: 1, category: 'Teste' }],
        rules: []
      }));
  });
    await cachePage.route('**/rest/v1/products**', async route => {
      productFetches++;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"offline test"}' });
    });
    await cachePage.goto(base + '/loja.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await cachePage.waitForTimeout(2500);
    if (!productFetches) failures.push('cache 25h: catálogo vencido não provocou busca no servidor');
    if (await cachePage.locator('text=CACHE VENCIDO').count()) failures.push('cache 25h: produtos vencidos foram exibidos');
    if (!(await cachePage.locator('#catalogStaleNotice').isVisible().catch(() => false))) failures.push('falha de revalidação: aviso não exibido');
    await cachePage.close();
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('Post-deploy Playwright: loja/painel HTTP 200, produtos carregados, sem erros; cache 25h ignorado e aviso de revalidação validado.');
})().catch(error => { console.error(error); process.exit(1); });
