const { test, expect } = require('@playwright/test');

const BASE = 'https://www.feiraondelivery.com.br';
const viewports = [{ width: 360, height: 800 }, { width: 412, height: 915 }];

for (const viewport of viewports) {
  test(`vigia loja, carrinho, mínimo, conta, assistente e painel — ${viewport.width}px`, async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({ viewport, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', error => consoleErrors.push(error.message));

    const failAt = (stage, detail) => {
      throw new Error(`FALHA [${stage}]: ${detail}`);
    };

    try {
      await page.goto(`${BASE}/loja.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await expect(page.locator('#pageHome')).toHaveClass(/active/, { timeout: 15000 })
        .catch(() => failAt('loja', 'a página inicial da loja não abriu'));
      await expect(page.locator('#homeProductSections')).toBeVisible({ timeout: 45000 })
        .catch(() => failAt('catálogo', 'as seções de produtos da página inicial não ficaram visíveis'));
      await expect.poll(async () => page.locator('#homeProductSections [data-card-change][data-d="1"]').count(), { timeout: 45000 })
        .toBeGreaterThan(0).catch(() => failAt('catálogo', 'nenhum produto com botão de adicionar apareceu'));
      if (await page.locator('#homeProductSections [data-card-change][data-d="1"]').count() === 0) failAt('catálogo', 'produtos não carregaram');

      const addButton = page.locator('#homeProductSections [data-card-change][data-d="1"]').first();
      await addButton.click();
      await expect(page.locator('#cartbar')).not.toHaveClass(/hide/, { timeout: 10000 })
        .catch(() => failAt('adicionar produto', 'o carrinho não atualizou após adicionar item'));

      await page.locator('#cartbar').click();
      await expect(page.locator('#pageCart')).toHaveClass(/active/, { timeout: 10000 })
        .catch(() => failAt('abrir carrinho', 'a tela do carrinho não abriu'));
      const checkout = page.locator('#checkout');
      await expect(checkout).toBeEnabled({ timeout: 10000 });

      const subtotalText = await page.locator('#subtotal').innerText();
      const subtotal = Number(subtotalText.replace(/[^0-9,]/g, '').replace(',', '.'));
      if (subtotal >= 30) failAt('mínimo abaixo de R$ 30', `produto inicial totalizou R$ ${subtotalText}; esperado abaixo de R$ 30`);
      await checkout.click();
      await expect(page.locator('#storeConfirmTitle')).toHaveText('Falta pouco!', { timeout: 10000 })
        .catch(() => failAt('sheet mínimo', 'o aviso "Falta pouco!" não abriu abaixo de R$ 30'));
      await page.locator('#storeConfirmAccept').click();

      await page.locator('#pageHome').locator('button[data-page="Home"]').count().then(async () => {
        const homeTab = page.locator('.mobile-nav [data-page="Home"]');
        if (await homeTab.count()) await homeTab.click();
      });
      const chosen = page.locator('#homeProductSections [data-card-change][data-d="1"]').first();
      for (let i = 0; i < 30; i++) {
        const current = Number((await page.locator('#cartbarTotal').innerText()).replace(/[^0-9,]/g, '').replace(',', '.'));
        if (current >= 30) break;
        await chosen.click();
      }
      await page.locator('#cartbar').click();
      await expect(page.locator('#subtotal')).toContainText(/R\$/);
      const finalSubtotal = Number((await page.locator('#subtotal').innerText()).replace(/[^0-9,]/g, '').replace(',', '.'));
      if (finalSubtotal < 30) failAt('mínimo acima de R$ 30', `não foi possível alcançar R$ 30; subtotal R$ ${finalSubtotal}`);
      await expect(checkout).toHaveText(/Continuar/);
      await checkout.click();
      await expect(page.locator('#accountModal')).toHaveClass(/open/, { timeout: 10000 })
        .catch(() => failAt('checkout sem login', 'não abriu "Entre na sua conta"'));
      await expect(page.locator('#accountModal')).toContainText('Entre na sua conta')
        .catch(() => failAt('login obrigatório', 'texto "Entre na sua conta" não apareceu'));
      await page.locator('#accountClose').click();

      await page.locator('#assistantNavButton').click();
      await expect.poll(async () => {
        const assistantOpen = await page.locator('#assistantSheet').evaluate(el => el.classList.contains('open'));
        const loginGateOpen = await page.locator('#accountModal').evaluate(el => el.classList.contains('open'));
        return assistantOpen || loginGateOpen;
      }, { timeout: 20000 }).toBe(true)
        .catch(() => failAt('assistente', 'o assistente e sua tela de autenticação não abriram'));
      if (await page.locator('#assistantSheet').evaluate(el => el.classList.contains('open'))) {
        await page.locator('#assistantClose').click();
      } else {
        await page.locator('#accountClose').click();
      }

      await page.goto(`${BASE}/painel.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await expect(page.locator('input[type="email"], input[name="email"], input[autocomplete="username"]')).toBeVisible({ timeout: 20000 })
        .catch(() => failAt('painel', 'tela de login não carregou'));
      await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10000 })
        .catch(() => failAt('painel', 'campo de senha não apareceu'));

      if (consoleErrors.length) failAt('console', consoleErrors.join(' | '));
    } catch (error) {
      if (error.message.startsWith('FALHA [')) throw error;
      throw new Error(`FALHA [${viewport.width}px]: ${error.message}`);
    } finally {
      await context.close().catch(() => {});
    }
  });
}


const paidOrderFixture = {
  id: 'a2a00000-0000-4000-8000-000000000001',
  created_at: '2026-11-19T12:00:00.000Z',
  items: [{ name: 'Banana', qty: 1, price: 5 }],
  total: 5,
  status: 'Pagamento Confirmado',
  payment_method: 'Pix',
  delivery_type: 'pickup_store',
  pickup_code: null,
  delivery_address: null,
  delivery_vehicle: null,
  delivery_fee: 0,
  lalamove_status: null,
  lalamove_tracking_url: null,
  is_test_order: false,
  separation_started_at: null,
  separation_started_legacy: false,
};

async function preparePaidOrderPage(context, page, options = {}) {
  const user = {
    id: 'a2a00000-0000-4000-8000-000000000099',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'push-test@example.invalid',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Cliente de teste' },
    created_at: '2026-01-01T00:00:00.000Z',
  };
  await context.addInitScript(({ user, mockPush, mockPermission }) => {
    localStorage.setItem('sb-juhwdevvwstmyxyyagzh-auth-token', JSON.stringify({
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    }));
    if (mockPermission) {
      Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: mockPermission, requestPermission: async () => mockPermission } });
    }
    if (mockPush) {
      const subscription = {
        endpoint: 'https://push.example.invalid/subscription',
        toJSON: () => ({ keys: { p256dh: 'mock-p256dh', auth: 'mock-auth' } }),
        unsubscribe: async () => true,
      };
      const registration = { pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription } };
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { ready: Promise.resolve(registration), register: async () => ({ update: async () => {} }) },
      });
    }
  }, { user, mockPush: !!options.mockPush, mockPermission: options.mockPermission || null });

  let claimCalls = 0;
  await page.route('**/rest/v1/orders**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'content-range': '0-0/1' },
    body: JSON.stringify([paidOrderFixture]),
  }));
  await page.route('**/rest/v1/customer_profiles**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ full_name: 'Cliente de teste', phone: '92999999999', address: 'Manaus' }]),
  }));
  await page.route('**/rest/v1/rpc/claim_push_subscription', async route => {
    claimCalls++;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto(`${BASE}/loja.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.mobile-nav [data-page="Orders"]').click();
  await expect(page.locator('#ordersList .order-card')).toBeVisible({ timeout: 30000 });
  return { claimCalls: () => claimCalls };
}

for (const viewport of viewports) {
  test(`pedido pago: convite de avisos, recusa persistente e permissão ativa — ${viewport.width}px`, async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({ viewport, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', error => consoleErrors.push(error.message));
    try {
      await preparePaidOrderPage(context, page, { mockPermission: 'default' });
      await expect(page.locator('#storeConfirmModal')).toHaveClass(/open/, { timeout: 10000 });
      await expect(page.locator('#storeConfirmTitle')).toHaveText('Quer ser avisada do seu pedido?');
      await expect(page.locator('#storeConfirmMessage')).toHaveText('Avisamos quando ele estiver pronto para retirada ou saindo para entrega.');
      await expect(page.locator('#storeConfirmAccept')).toHaveText('Ativar avisos');
      await expect(page.locator('#storeConfirmCancel')).toHaveText('Agora não');
      await page.locator('#storeConfirmCancel').click();
      await expect(page.locator('#storeConfirmModal')).not.toHaveClass(/open/);
      await expect.poll(() => page.evaluate(() => localStorage.getItem('feira_order_push_dismissed_v1:a2a00000-0000-4000-8000-000000000001'))).toBe('1');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.mobile-nav [data-page="Orders"]').click();
      await expect(page.locator('#ordersList .order-card')).toBeVisible({ timeout: 30000 });
      await expect(page.locator('#storeConfirmModal')).not.toHaveClass(/open/);
      if (consoleErrors.length) throw new Error(`FALHA [console ${viewport.width}px]: ${consoleErrors.join(' | ')}`);
    } finally {
      await context.close().catch(() => {});
    }

    const grantedContext = await browser.newContext({ viewport, storageState: { cookies: [], origins: [] } });
    await grantedContext.grantPermissions(['notifications'], { origin: BASE });
    const grantedPage = await grantedContext.newPage();
    const grantedErrors = [];
    grantedPage.on('console', msg => { if (msg.type() === 'error') grantedErrors.push(msg.text()); });
    grantedPage.on('pageerror', error => grantedErrors.push(error.message));
    try {
      const result = await preparePaidOrderPage(grantedContext, grantedPage, { mockPush: true });
      await expect(grantedPage.locator('#storeConfirmModal')).not.toHaveClass(/open/);
      await expect.poll(result.claimCalls).toBeGreaterThan(0);
      if (grantedErrors.length) throw new Error(`FALHA [console granted ${viewport.width}px]: ${grantedErrors.join(' | ')}`);
    } finally {
      await grantedContext.close().catch(() => {});
    }
  });
}
