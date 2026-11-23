const { chromium } = require('playwright');
const fs = require('node:fs');

(async () => {
  const source = fs.readFileSync('loja.html', 'utf8');
  const cssStart = source.indexOf('.pix-generation-wait{');
  const cssEnd = source.indexOf('/* Compra por valor nos cards', cssStart);
  const markupStart = source.indexOf('<div id="pixGenerationWait"');
  const markupEndToken = '</section></div>';
  const markupEnd = source.indexOf(markupEndToken, markupStart);
  if (cssStart < 0 || cssEnd < 0 || markupStart < 0 || markupEnd < 0) {
    throw new Error('Não foi possível localizar o CSS ou o HTML da espera do Pix.');
  }
  const css = source.slice(cssStart, cssEnd);
  const markup = source.slice(markupStart, markupEnd + markupEndToken.length);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      await page.setContent('<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><style>' + css + '</style></head><body>' + markup + '</body></html>');
      await page.locator('#pixGenerationWait').evaluate(el => { el.hidden = false; });
      await page.locator('#pixGenerationWait').waitFor({ state: 'visible' });
      const layout = await page.locator('.pix-generation-sheet').evaluate(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width, viewport: innerWidth };
      });
      if (layout.left < 0 || layout.right > width + 1 || layout.width > width) {
        throw new Error('Bottom sheet ultrapassa a tela em ' + width + 'px: ' + JSON.stringify(layout));
      }
      await page.mouse.click(8, 8);
      if (!(await page.locator('#pixGenerationWait').isVisible())) {
        throw new Error('A espera fechou ao tocar fora em ' + width + 'px.');
      }
      const labels = await page.locator('.pix-generation-steps').innerText();
      for (const label of ['Conferindo seus produtos', 'Calculando a entrega', 'Gerando seu Pix']) {
        if (!labels.includes(label)) throw new Error('Etapa ausente em ' + width + 'px: ' + label);
      }
      await page.locator('.pix-generation-progress').evaluate(el => {
        el.setAttribute('aria-valuenow', '92');
        el.querySelector('span').style.width = '92%';
      });
      const progress = await page.locator('.pix-generation-progress span').evaluate(el => parseFloat(el.style.width));
      if (progress >= 100) throw new Error('A barra chegou a 100% antes do Pix em ' + width + 'px.');
      await page.close();
      console.log('PASSOU | espera Pix | ' + width + 'px | toque fora mantém aberta');
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
