const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const oldCnpj = '65.414.756/0001-22';
const oldName = 'Dr Alimentos';
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
      await page.setContent(cleanHtml(read('loja.html')), { waitUntil: 'domcontentloaded' });
      await page.locator('.legal-footer').waitFor({ state: 'visible' });
      assert.ok((await page.locator('.legal-brand').innerText()).includes('Feira On Delivery'), 'loja: marca visível');
      assert.equal((await page.locator('#legalDocumentValue').innerText()).trim(), oldCnpj, 'loja: CNPJ anterior restaurado');
      let metrics = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
      assert.ok(metrics.document <= width, 'loja sem overflow horizontal: ' + JSON.stringify(metrics));
      await page.screenshot({ path: path.join(root, 'artifacts', 'legal-store-' + width + '.png'), fullPage: true });

      for (const [file, label] of [['termos.html', 'Termos de Uso'], ['politica-privacidade.html', 'Política de Privacidade']]) {
        await page.setContent(cleanHtml(read(file)), { waitUntil: 'domcontentloaded' });
        const bodyText = await page.locator('body').innerText();
        assert.ok(bodyText.includes(label), file + ': título visível');
        assert.ok(bodyText.includes(oldName), file + ': razão social anterior restaurada');
        if (file === 'politica-privacidade.html') assert.ok(bodyText.includes(oldCnpj), file + ': CNPJ anterior restaurado');
        metrics = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
        assert.ok(metrics.document <= width, file + ' sem overflow horizontal: ' + JSON.stringify(metrics));
        await page.screenshot({ path: path.join(root, 'artifacts', (file === 'termos.html' ? 'legal-terms-' : 'legal-privacy-') + width + '.png'), fullPage: true });
      }
      await page.close();
    }
    console.log('OK: loja, termos e privacidade em 360px e 412px; identidade anterior restaurada e sem overflow horizontal.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
