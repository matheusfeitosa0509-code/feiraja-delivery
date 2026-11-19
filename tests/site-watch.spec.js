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
      await expect(page.locator('#assistantSheet')).toHaveClass(/open/, { timeout: 20000 })
        .catch(() => failAt('assistente', 'o assistente não abriu'));
      await page.locator('#assistantSheet [aria-label="Fechar"], #assistantSheet .close').first().click().catch(() => {});

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
