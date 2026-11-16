const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const legalName = '68.329.968 Raimundo Matheus Ferreira Feitosa';
const cnpj = '68.329.968/0001-08';
const footerText = 'Feira On Delivery — ' + legalName + ' — CNPJ ' + cnpj;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const cleanHtml = html => html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const store = cleanHtml(read('loja.html'));
      await page.setContent(store, { waitUntil: 'domcontentloaded' });
      const footer = page.locator('.legal-footer');
      await footer.waitFor({ state: 'visible' });
      const brand = page.locator('.legal-footer .legal-brand');
      assert.equal((await brand.innerText()).trim(), footerText, 'rodapé deve mostrar exatamente o nome fantasia, razão social e CNPJ');
      assert.equal(await page.locator('#legalDocumentLine').count(), 0, 'não deve haver linha antiga/duplicada de CNPJ');
      const storeMetrics = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        footer: document.querySelector('.legal-footer').getBoundingClientRect().width,
        brand: document.querySelector('.legal-brand').getBoundingClientRect().width,
        brandScroll: document.querySelector('.legal-brand').scrollWidth,
      }));
      assert.ok(storeMetrics.document <= width, 'loja sem rolagem horizontal: ' + JSON.stringify(storeMetrics));
      assert.ok(storeMetrics.brandScroll <= storeMetrics.brand + 1, 'texto do rodapé não pode cortar horizontalmente: ' + JSON.stringify(storeMetrics));
      await page.screenshot({ path: path.join(root, 'artifacts', 'legal-store-' + width + '.png'), fullPage: true });

      for (const [file, label] of [['termos.html', 'Termos de Uso'], ['politica-privacidade.html', 'Política de Privacidade']]) {
        await page.setContent(cleanHtml(read(file)), { waitUntil: 'domcontentloaded' });
        const bodyText = await page.locator('body').innerText();
        assert.ok(bodyText.includes(label), file + ': título deve estar visível');
        assert.ok(bodyText.includes(legalName), file + ': razão social deve estar visível');
        assert.ok(bodyText.includes(cnpj), file + ': CNPJ deve estar visível');
        const metrics = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
        assert.ok(metrics.document <= width, file + ': sem rolagem horizontal: ' + JSON.stringify(metrics));
        await page.screenshot({ path: path.join(root, 'artifacts', (file === 'termos.html' ? 'legal-terms-' : 'legal-privacy-') + width + '.png'), fullPage: true });
      }
      await page.close();
    }
    console.log('OK: rodapé, termos e privacidade em 360px e 412px; razão social/CNPJ visíveis e sem overflow horizontal.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
