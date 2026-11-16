const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const storeHtml = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
assert.equal(storeHtml.includes('id="payPixTestOption"'), false, 'Pix de teste não pode estar no HTML inicial');
assert.equal(storeHtml.includes('id="payPixTest"'), false, 'radio de teste não pode existir antes da confirmação admin');
assert.equal(storeHtml.includes('<option value="pix_test">'), false, 'opção do select não pode existir antes da confirmação admin');
const helperSource = fs.readFileSync(path.join(root, 'loja-delivery-ui.js'), 'utf8').replace(/^export\s+/gm, '');
const styleStart = storeHtml.indexOf('/* Checkout option cards —');
const styleEnd = storeHtml.indexOf('</style>', styleStart);
if (styleStart < 0 || styleEnd < 0) throw new Error('checkout card CSS missing from loja.html');
const checkoutCss = [
  '.checkout-choice-card.is-disabled{opacity:.52;filter:grayscale(.35);cursor:not-allowed;background:#f4f5f1!important;border-style:dashed!important}',
  '.choice-radio{position:absolute;opacity:0;width:1px;height:1px}',
  storeHtml.slice(styleStart, styleEnd),
  'body{margin:0;padding:16px;background:#f4f7f2;font-family:Arial,sans-serif}',
  '.checkout-screen{max-width:520px;margin:0 auto}',
  '.checkout-choice-card{width:100%;padding:14px;border:1px solid #d9e2d6;border-radius:14px;background:#fff}',
].join('\n');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
        '<main class="checkout-screen"><form id="checkoutForm">' +
        '<label class="opt checkout-choice-card is-disabled" id="deliveryHomeOption" for="deliveryHome" aria-disabled="true">' +
        '<input class="choice-radio" id="deliveryHome" type="radio" name="deliveryChoice" disabled>' +
        '<span class="checkout-choice-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10H3V10Z"></path></svg></span>' +
        '<span class="checkout-choice-copy"><b>Entrega Feira On</b><span class="s" id="deliveryHomeDescription">Receba em casa sem precisar pedir Uber.</span></span>' +
        '<span class="checkout-choice-end" id="deliveryStartingPrice">Em breve</span><span class="r" aria-hidden="true"></span>' +
        '</label><section class="checkout-card"><div class="checkout-choice-list" id="checkoutPaymentChoices">' +
        '<label class="opt checkout-choice-card" for="payPix"><input class="choice-radio" id="payPix" type="radio" name="paymentChoice"><span class="checkout-choice-copy"><b>Pix</b></span><span class="r"></span></label>' +
        '<label class="opt checkout-choice-card" for="payCash"><input class="choice-radio" id="payCash" type="radio" name="paymentChoice"><span class="checkout-choice-copy"><b>Dinheiro na retirada</b></span><span class="r"></span></label>' +
        '</div><select id="payment"><option value="pix">Pix</option><option value="cash">Dinheiro</option></select></section></form></main></body></html>');
      await page.addStyleTag({ content: checkoutCss });
      await page.addScriptTag({ content: helperSource +
        '\nwindow.FeiraDeliveryAccess = { loadDeliveryAccessState, renderDeliveryOption, syncAdminTestPaymentOption };' });

      const syncTestPayment = state => page.evaluate(value => window.FeiraDeliveryAccess.syncAdminTestPaymentOption({
        container: document.querySelector('#checkoutPaymentChoices'),
        paymentSelect: document.querySelector('#payment'),
        ...value,
        onSelect: () => { window.__testPaymentSelected = true; document.querySelector('#payment').value = 'pix_test'; },
      }), state);
      const testPaymentSnapshot = () => page.evaluate(() => ({
        label: document.querySelector('#payPixTestOption')?.textContent || null,
        radio: !!document.querySelector('#payPixTest'),
        option: !!document.querySelector('#payment option[value="pix_test"]'),
        hidden: document.querySelector('#payPixTestOption')?.hidden ?? null,
        textPresent: document.querySelector('#checkoutPaymentChoices').textContent.includes('Pix de teste (admin)'),
      }));

      // Visitor, common account and pending admin check: no test-payment DOM at all.
      for (const state of [
        { isAdminConfirmed: false, deliveryType: 'delivery' },
        { isAdminConfirmed: false, deliveryType: 'delivery' },
        { isAdminConfirmed: false, deliveryType: 'delivery' },
        { isAdminConfirmed: true, deliveryType: 'pickup_store' },
      ]) {
        assert.equal(await syncTestPayment(state), false);
        assert.deepEqual(await testPaymentSnapshot(), { label: null, radio: false, option: false, hidden: null, textPresent: false });
      }
      // Only a server-confirmed admin in the delivery checkout gets a real DOM option.
      assert.equal(await syncTestPayment({ isAdminConfirmed: true, deliveryType: 'delivery' }), true);
      let testPayment = await testPaymentSnapshot();
      assert.equal(testPayment.radio, true);
      assert.equal(testPayment.option, true);
      assert.equal(testPayment.hidden, false);
      assert.equal(testPayment.textPresent, true);
      await page.locator('#payPixTest').check();
      await page.locator('#payPixTest').dispatchEvent('change');
      assert.equal(await page.evaluate(() => window.__testPaymentSelected === true), true);
      assert.equal(await page.locator('#payment').inputValue(), 'pix_test');
      // Sign-out, RPC failure, or any loss of confirmed admin status removes both nodes.
      assert.equal(await syncTestPayment({ isAdminConfirmed: false, deliveryType: 'delivery' }), false);
      testPayment = await testPaymentSnapshot();
      assert.deepEqual(testPayment, { label: null, radio: false, option: false, hidden: null, textPresent: false });

      const render = state => page.evaluate(value => {
        return window.FeiraDeliveryAccess.renderDeliveryOption({
          option: document.querySelector('#deliveryHomeOption'),
          radio: document.querySelector('#deliveryHome'),
          starting: document.querySelector('#deliveryStartingPrice'),
          description: document.querySelector('#deliveryHomeDescription'),
          ...value,
        });
      }, state);
      const snapshot = () => page.evaluate(() => ({
        disabled: document.querySelector('#deliveryHome').disabled,
        ariaDisabled: document.querySelector('#deliveryHomeOption').getAttribute('aria-disabled'),
        disabledClass: document.querySelector('#deliveryHomeOption').classList.contains('is-disabled'),
        label: document.querySelector('#deliveryStartingPrice').textContent.trim(),
        badgeCount: document.querySelectorAll('#deliveryStartingPrice .checkout-test-badge').length,
        description: document.querySelector('#deliveryHomeDescription').textContent,
        clamp: getComputedStyle(document.querySelector('#deliveryHomeDescription')).webkitLineClamp,
        badgeWhiteSpace: document.querySelector('.checkout-test-badge') ? getComputedStyle(document.querySelector('.checkout-test-badge')).whiteSpace : null,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        badgeRight: document.querySelector('#deliveryStartingPrice').getBoundingClientRect().right,
        cardRight: document.querySelector('#deliveryHomeOption').getBoundingClientRect().right,
      }));

      // Initial/pending: never briefly selectable.
      await render({ isAdmin: false, adminCheckComplete: false, deliveryActive: false });
      let view = await snapshot();
      assert.equal(view.disabled, true);
      assert.equal(view.label, 'Em breve');
      assert.equal(view.badgeCount, 0);

      // Anonymous: no privileged RPC call is made.
      const anonymous = await page.evaluate(async () => {
        let calls = 0;
        const state = await window.FeiraDeliveryAccess.loadDeliveryAccessState(
          { id: 'anonymous', is_anonymous: true },
          async () => { calls++; return { data: true, error: null }; },
        );
        return { state, calls };
      });
      assert.deepEqual(anonymous, {
        state: { adminCheckComplete: false, isAdmin: false, deliveryActive: false },
        calls: 0,
      });
      await render(anonymous.state);
      view = await snapshot();
      assert.equal(view.disabled, true);
      assert.equal(view.label, 'Em breve');

      // Ordinary account remains blocked even when delivery_ativa is true.
      const common = await page.evaluate(() => window.FeiraDeliveryAccess.loadDeliveryAccessState(
        { id: 'ordinary-user' },
        async name => name === 'is_current_user_admin'
          ? { data: false, error: null }
          : { data: true, error: null },
      ));
      assert.deepEqual(common, { adminCheckComplete: true, isAdmin: false, deliveryActive: true });
      await render(common);
      view = await snapshot();
      assert.equal(view.disabled, true);
      assert.equal(view.label, 'Em breve');
      assert.equal(view.description.includes('Consulte o valor'), false);

      // Delayed admin response: remain disabled until the positive answer.
      await page.evaluate(() => {
        window.__pendingAdminAccess = window.FeiraDeliveryAccess.loadDeliveryAccessState(
          { id: 'confirmed-admin' },
          name => name === 'is_current_user_admin'
            ? new Promise(resolve => { window.__resolveAdminRpc = resolve; })
            : Promise.resolve({ data: false, error: null }),
        );
      });
      await page.waitForFunction(() => typeof window.__resolveAdminRpc === 'function');
      view = await snapshot();
      assert.equal(view.disabled, true);
      assert.equal(view.label, 'Em breve');
      await page.evaluate(() => window.__resolveAdminRpc({ data: true, error: null }));
      const adminInactive = await page.evaluate(() => window.__pendingAdminAccess);
      assert.deepEqual(adminInactive, { adminCheckComplete: true, isAdmin: true, deliveryActive: false });
      await render(adminInactive);
      view = await snapshot();
      assert.equal(view.disabled, false);
      assert.equal(view.label, 'TESTE');
      assert.equal(view.badgeCount, 1);
      assert.equal(view.description.includes('Consulte o valor'), false);

      // Only the active flag adds the quote hint; the TESTE badge remains.
      const adminActive = await page.evaluate(() => window.FeiraDeliveryAccess.loadDeliveryAccessState(
        { id: 'confirmed-admin' }, async () => ({ data: true, error: null }),
      ));
      await render(adminActive);
      view = await snapshot();
      assert.equal(view.disabled, false);
      assert.equal(view.label, 'TESTE');
      assert.equal(view.badgeCount, 1);
      assert.equal(view.description.includes('Consulte o valor'), true);

      // RPC returning an error and RPC throwing a network error both fail closed.
      const rpcError = await page.evaluate(() => window.FeiraDeliveryAccess.loadDeliveryAccessState(
        { id: 'admin-rpc-error' },
        async name => name === 'is_current_user_admin'
          ? { data: null, error: { message: 'RPC unavailable' } }
          : { data: true, error: null },
      ));
      await render(rpcError);
      view = await snapshot();
      assert.equal(view.disabled, true);
      assert.equal(view.label, 'Em breve');
      assert.equal(view.badgeCount, 0);
      assert.equal(view.description.includes('Consulte o valor'), false);

      const networkError = await page.evaluate(() => window.FeiraDeliveryAccess.loadDeliveryAccessState(
        { id: 'admin-network-error' },
        async name => {
          if (name === 'is_current_user_admin') throw new Error('network failure');
          return { data: true, error: null };
        },
      ));
      await render(networkError);
      view = await snapshot();
      assert.equal(view.disabled, true);
      assert.equal(view.label, 'Em breve');
      assert.equal(view.badgeCount, 0);
      assert.equal(view.description.includes('Consulte o valor'), false);

      // Badge stays on one line at the right; description is capped at two.
      await render(adminActive);
      view = await snapshot();
      assert.equal(view.clamp, '2');
      assert.equal(view.badgeWhiteSpace, 'nowrap');
      assert.equal(view.noHorizontalOverflow, true);
      assert.ok(view.badgeRight <= view.cardRight + 1);
      fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'artifacts', 'checkout-delivery-admin-' + width + '.png'), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  process.stdout.write('Checkout delivery admin access: anonymous/common/admin, delayed RPC, RPC/network errors and 360px/412px layout passed.\n');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
