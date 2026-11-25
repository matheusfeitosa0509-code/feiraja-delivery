const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const base = process.env.PAGES_BASE_URL || 'https://www.feiraondelivery.com.br';
  const failures = [];
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];
  const bannerResponses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => {
    if (response.status() >= 500) errors.push('HTTP ' + response.status() + ' ' + response.url());
    if (response.url().includes('/rest/v1/store_banners')) bannerResponses.push('HTTP ' + response.status());
  });
  const expectOpen = async (selector, label) => {
    try { await page.waitForFunction(s => { const el=document.querySelector(s); return !!el && (el.classList.contains('open') || el.getAttribute('aria-hidden')==='false'); }, selector, { timeout: 5000 }); }
    catch { failures.push(label + ': não abriu ' + selector); }
  };
  const closeAccount = async () => {
    if (await page.locator('#accountModal.open').count()) await page.locator('#accountClose').click();
  };
  // Search every slide in the carousel; do not require the target banner to be the active/visible slide.
  const clickBannerAction = async (title) => {
    const target = page.locator('#storeBannersTrack .store-banner-slide').filter({ hasText: title });
    assert.equal(await target.count(), 1, 'banner ausente ou duplicado no carrossel: ' + title);
    await target.locator('.store-banner-cta').evaluate(button => button.click());
  };
  try {
    const response = await page.goto(base + '/loja.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    assert.equal(response && response.status(), 200, 'loja publicada não retornou HTTP 200');
    await page.route('**/www.clarity.ms/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.__clarityPostDeployLoaded = true;' }));
    await page.route('**/connect.facebook.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.__pixelPostDeployLoaded = true;' }));
    await page.waitForFunction(() => !!document.querySelector('#cookieConsent') && !document.querySelector('#cookieConsent').hidden, null, { timeout: 15000 });
    assert.equal(await page.locator('#cartbar').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'barra do carrinho deve ficar oculta enquanto o consentimento está aberto');
    assert.equal(await page.locator('#cookieAccept').isVisible(), true, 'botão Aceitar deve estar visível');
    assert.equal(await page.locator('#cookieReject').isVisible(), true, 'botão Recusar deve estar visível');
    await page.locator('#cookieAccept').click();
    await page.waitForFunction(() => document.querySelector('#cookieConsent')?.hidden === true, null, { timeout: 5000 });
    await page.waitForFunction(() => !!document.querySelector('script[src*="clarity.ms"]') && !!document.querySelector('script[src*="connect.facebook.net"]'), null, { timeout: 15000 });
    assert.notEqual(await page.locator('#cartbar').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'barra do carrinho deve voltar após aceitar');

    await page.waitForFunction(() => document.querySelectorAll('#homeProductSections .product:not(.skeleton-card)').length > 0, { timeout: 45000 });

    // O bundle separado precisa existir no Pages: antes desta correção, a importação dinâmica retornava 404.
    const runtimeResponse = await page.request.get(base + '/assistant-runtime.js?v=post-deploy-check');
    assert.equal(runtimeResponse.status(), 200, 'assistant-runtime.js não foi publicado no Pages');
    const speechResponse = await page.request.get(base + '/assistant-speech.js?v=post-deploy-check');
    assert.equal(speechResponse.status(), 200, 'assistant-speech.js não foi publicado no Pages');

    await page.waitForFunction(() => document.querySelectorAll('#storeBannersTrack .store-banner-slide').length > 0, null, { timeout: 15000 }).catch(() => {});
    console.log('POST_DEPLOY_BANNER_DEBUG', JSON.stringify({ slideCount: await page.locator('#storeBannersTrack .store-banner-slide').count(), trackText: await page.locator('#storeBannersTrack').innerText().catch(() => ''), bannerResponses, errors }));
    await clickBannerAction('Fale com o Assistente');
    await expectOpen('#accountModal', 'Abrir assistente pelo banner (visitante sem login)');
    await closeAccount();
    await page.locator('#assistantNavButton').click();
    await expectOpen('#accountModal', 'Abrir assistente pela barra (visitante sem login)');
    await closeAccount();

    await clickBannerAction('Não achou o produto?');
    await expectOpen('#accountModal', 'Pedir um produto pelo banner (visitante sem login)');
    await closeAccount();
    const categories = page.locator('#homeBubbles button');
    const categoryCount = await categories.count();
    assert.ok(categoryCount > 0, 'nenhuma categoria foi carregada');
    for (let i = 0; i < categoryCount; i++) await categories.nth(i).click();

    const verTodos = page.getByRole('button', { name: /ver tudo|ver todos/i }).first();
    if (await verTodos.isVisible().catch(() => false)) {
      await verTodos.click();
      assert.ok(await page.locator('#pageHome.active').count() && await page.locator('#homeProductSections .product:not(.skeleton-card)').count() > 0, 'Ver todos não manteve a vitrine completa aberta');
    } else {
      // The legacy link is hidden by the current storefront layout; still exercise its registered navigation handler.
      await verTodos.evaluate(button => button.click());
      assert.ok(await page.locator('#pageHome.active').count() && await page.locator('#homeProductSections .product:not(.skeleton-card)').count() > 0, 'Ver tudo não manteve a vitrine completa aberta');
    }

    const plus = page.locator('#homeProductSections .product:not(.skeleton-card) [data-card-change][data-d="1"]').first();
    await plus.click();
    assert.ok(Number((await page.locator('#tabCartCount').textContent()).trim()) > 0, '+ do produto não adicionou ao carrinho');
    const valueButton = page.locator('button[data-value-open]:visible').first();
    if (await valueButton.count()) {
      await expect(valueButton).toContainText('Pedir por valor');
      await valueButton.click();
      await expectOpen('#valueSaleSheet', 'Pedir por valor');
      assert.ok(await page.locator('#valueSaleSheet').isVisible(), 'Pedir por valor: modal não ficou visível');
      await page.locator('#valueSaleClose').click();
    } else failures.push('Pedir por valor: nenhum botão visível data-value-open disponível no catálogo para teste');

    await page.locator('.mobile-nav [data-page="Cart"]').click();
    assert.ok(await page.locator('#pageCart.active').count(), 'Carrinho não abriu');
    assert.match(await page.locator('#subtotal').innerText(), /R\$/);

    await page.locator('.mobile-nav [data-page="Orders"]').click();
    assert.ok(await page.locator('#pageOrders.active').count(), 'Pedidos não abriu');
    await page.locator('#accountBtn').click();
    await expectOpen('#accountModal', 'Conta');
    await closeAccount();

    if (errors.length) failures.push('erros de console/page/HTTP: ' + errors.join(' | '));
  } catch (error) {
    failures.push(error.stack || error.message);
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('Post-deploy storefront actions: assistant banner/nav, product request, categories, Ver todos, add-to-cart, value sale, cart, orders and account; no order/payment/ride created.');
})().catch(error => { console.error(error); process.exit(1); });
