const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const storeHtml = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
assert.equal(storeHtml.includes('id="payPixTestOption"'), false, 'Pix de teste não pode estar no HTML inicial');
assert.equal(storeHtml.includes('id="payPixTest"'), false, 'radio de teste não pode existir antes da confirmação admin');
assert.equal(storeHtml.includes('<option value="pix_test">'), false, 'opção do select não pode existir antes da confirmação admin');
assert.equal(storeHtml.includes('#deliveryUberOption[hidden]'), false, 'Uber não pode depender de CSS hidden');
assert.equal(storeHtml.includes('syncUberPickupOption({'), true, 'Uber deve ser removido do DOM e do select');
assert.equal(storeHtml.includes("const uberRadio=$('#deliveryUber');if(uberRadio)uberRadio.checked=delivery==='pickup_uber';"), true, 'syncDeliverySelection deve tolerar o rádio Uber ausente');
assert.equal(storeHtml.includes("$('#deliveryUber')?.addEventListener('change'"), true, 'listener do Uber deve tolerar o card removido');
const safeUberListener = "$('#deliveryUber')?.addEventListener('change',()=>{if($('#deliveryUber')?.checked){$('#delivery').value='pickup_uber';$('#delivery').dispatchEvent(new Event('change'));}});";
assert.equal(storeHtml.includes(safeUberListener), true, 'listener completo do Uber deve permanecer protegido');
const scheduleMessageStart = storeHtml.indexOf('function checkoutScheduleMessage(');
const scheduleMessageEnd = storeHtml.indexOf('\nfunction updateCheckoutScheduleNotice()', scheduleMessageStart);
const scheduleMessageSource = scheduleMessageStart >= 0 && scheduleMessageEnd > scheduleMessageStart ? storeHtml.slice(scheduleMessageStart, scheduleMessageEnd) : '';
if (!scheduleMessageSource) throw new Error('checkoutScheduleMessage source missing');

const syncSelectionStart = storeHtml.indexOf('function syncDeliverySelection()');
const syncSelectionEnd = storeHtml.indexOf('\nfunction totals()', syncSelectionStart);
const syncSelectionSource = syncSelectionStart >= 0 && syncSelectionEnd > syncSelectionStart ? storeHtml.slice(syncSelectionStart, syncSelectionEnd) : '';
if (!syncSelectionSource) throw new Error('syncDeliverySelection source missing');

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
      const consoleErrors = [];
      page.on('pageerror', error => consoleErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' +
        '<main class="checkout-screen"><p id="checkoutSubtitle">Confira seus dados, a retirada e o pagamento.</p><form id="checkoutForm">' +
        '<label class="opt checkout-choice-card is-disabled" id="deliveryHomeOption" for="deliveryHome" aria-disabled="true">' +
        '<input class="choice-radio" id="deliveryHome" type="radio" name="deliveryChoice" disabled>' +
        '<span class="checkout-choice-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10H3V10Z"></path></svg></span>' +
        '<span class="checkout-choice-copy"><b>Entrega Feira On</b><span class="s" id="deliveryHomeDescription">Receba em casa sem precisar pedir Uber.</span></span>' +
        '<span class="checkout-choice-end" id="deliveryStartingPrice">Em breve</span><span class="r" aria-hidden="true"></span>' +
        '</label><label class="opt checkout-choice-card" id="deliveryUberOption"><input id="deliveryUber" type="radio" name="deliveryChoice"><span class="checkout-choice-copy"><b>Receber com seu Uber</b></span></label><select id="delivery"><option value="pickup_store">Retirada</option><option value="pickup_uber">Uber</option><option value="delivery">Entrega</option></select><section class="checkout-card"><div class="checkout-choice-list" id="checkoutPaymentChoices">' +
        '<label class="opt checkout-choice-card" for="payPix"><input class="choice-radio" id="payPix" type="radio" name="paymentChoice"><span class="checkout-choice-copy"><b>Pix</b></span><span class="r"></span></label>' +
        '<label class="opt checkout-choice-card" for="payCash"><input class="choice-radio" id="payCash" type="radio" name="paymentChoice"><span class="checkout-choice-copy"><b>Dinheiro na retirada</b></span><span class="r"></span></label>' +
        '</div><select id="payment"><option value="pix">Pix</option><option value="cash">Dinheiro</option></select></section></form></main></body></html>');
      await page.addStyleTag({ content: checkoutCss });
      await page.addScriptTag({ content: helperSource +
        '\nwindow.FeiraDeliveryAccess = { loadDeliveryAccessState, renderDeliveryOption, syncAdminTestPaymentOption, canShowUberPickupOption, syncUberPickupOption, deliveryQuoteErrorMessage };' });

      await page.evaluate(() => {
        window.__uberCard = document.querySelector('#deliveryUberOption');
        window.__uberSelectOption = document.querySelector('#delivery option[value="pickup_uber"]');
      });
      const syncUber = active => page.evaluate(deliveryActive => window.FeiraDeliveryAccess.syncUberPickupOption({
        option: window.__uberCard,
        selectOption: window.__uberSelectOption,
        select: document.querySelector('#delivery'),
        beforeOption: document.querySelector('#deliveryHomeOption'),
        deliveryActive,
      }), active);
      for (const actor of ['cliente', 'admin']) {
        assert.equal(await syncUber(true), false, actor + ': Uber deve ser removido com entrega_ativa=true');
        assert.deepEqual(await page.evaluate(() => ({
          card: !!document.querySelector('#deliveryUberOption'),
          option: !!document.querySelector('#delivery option[value="pickup_uber"]'),
          text: document.querySelector('main').textContent.includes('Receber com seu Uber'),
        })), { card: false, option: false, text: false });
        assert.equal(await syncUber(false), true, actor + ': Uber deve voltar com entrega_ativa=false');
        assert.deepEqual(await page.evaluate(() => ({
          card: !!document.querySelector('#deliveryUberOption'),
          option: !!document.querySelector('#delivery option[value="pickup_uber"]'),
        })), { card: true, option: true });
      }

      // Reproduz Continuar → checkout sem o card/radio Uber no DOM.
      await page.evaluate(() => {
        document.querySelector('#deliveryUberOption')?.remove();
        document.querySelector('#delivery option[value="pickup_uber"]')?.remove();
        const store = document.createElement('label'); store.className = 'opt'; store.innerHTML = '<input id="deliveryStore" type="radio" name="deliveryChoice">';
        document.querySelector('#checkoutForm').prepend(store);
        const address = document.createElement('div'); address.id = 'deliveryAddressFields'; document.querySelector('#checkoutForm').append(address);
        const continueButton = document.createElement('button'); continueButton.id = 'checkout'; continueButton.textContent = 'Continuar · R$ 49,95'; document.body.append(continueButton);
        const modal = document.createElement('div'); modal.id = 'modal'; document.body.append(modal);
        window.$ = selector => document.querySelector(selector);
        window.deliveryQuote = null; window.deliveryQuoteSequence = 0; window.deliveryQuoteTimer = null;
        window.getDeliveryAddress = () => null;
        window.syncPickupPaymentOptions = () => {};
        window.updateCheckoutTotals = () => {};
        window.updateCheckoutScheduleNotice = () => {};
        window.scheduleDeliveryQuote = () => {};
        window.setDeliveryQuoteStatus = () => {};
        window.renderCart = () => {};
        window.cart = { coco: 5 };
        continueButton.addEventListener('click', () => {
          if (!Object.keys(window.cart).length) return;
          window.syncDeliverySelection();
          modal.classList.add('open');
        });
      });
      await page.addScriptTag({ content: syncSelectionSource + '\nwindow.syncDeliverySelection = syncDeliverySelection;' });
      await page.addScriptTag({ content: "$('#delivery').addEventListener('change',()=>{syncDeliverySelection();renderCart()});" });
      await page.addScriptTag({ content: safeUberListener });
      await page.evaluate(() => { window.pickupEstimate = () => ({ within: false, label: 'terça, 17/11' }); });
      await page.addScriptTag({ content: scheduleMessageSource + '\nwindow.checkoutScheduleMessage = checkoutScheduleMessage;' });
      assert.equal(await page.evaluate(() => window.checkoutScheduleMessage(new Date(), false)), 'Estamos fechados agora. Seu pedido fica pronto para retirada na terça, 17/11 a partir das 6h.');
      assert.equal(await page.evaluate(() => window.checkoutScheduleMessage(new Date(), true)), 'Estamos fechados agora. Sua entrega sai na terça, 17/11, a partir das 6h.');
      await page.evaluate(() => { window.pickupEstimate = () => ({ within: true, label: 'hoje' }); });
      assert.equal(await page.evaluate(() => window.checkoutScheduleMessage(new Date(), false)), 'Pedidos ficam prontos ainda hoje, até 13h.');
      assert.equal(await page.evaluate(() => window.checkoutScheduleMessage(new Date(), true)), 'A entrega sai quando o pedido estiver pronto, durante o horário da loja.');
      assert.equal(await page.evaluate(() => typeof window.syncDeliverySelection), 'function', 'syncDeliverySelection deve estar disponível');
      const syncProbe = await page.evaluate(() => { try { window.syncDeliverySelection(); return 'ok'; } catch (error) { return error.stack || error.message; } });
      assert.equal(syncProbe, 'ok', width + 'px: falha ao sincronizar checkout sem Uber: ' + syncProbe);
      await page.locator('#checkout').click();
      assert.equal(await page.locator('#modal').evaluate(el => el.classList.contains('open')), true, width + 'px: Continuar deve abrir checkout');
      for (const deliveryType of ['pickup_store', 'delivery']) {
        await page.locator('#delivery').selectOption(deliveryType);
        await page.locator('#delivery').dispatchEvent('change');
        const selected = await page.evaluate(() => ({
          delivery: document.querySelector('#delivery').value,
          store: document.querySelector('#deliveryStore').checked,
          home: document.querySelector('#deliveryHome').checked,
          uber: !!document.querySelector('#deliveryUber'),
        }));
        assert.equal(selected.delivery, deliveryType);
        assert.equal(selected.store, deliveryType === 'pickup_store');
        assert.equal(selected.home, deliveryType === 'delivery');
        assert.equal(selected.uber, false);
        assert.equal(await page.locator('#checkoutSubtitle').textContent(), deliveryType === 'delivery' ? 'Confira seus dados, a entrega e o pagamento' : 'Confira seus dados, a retirada e o pagamento.');
      }
      // Com entrega_ativa=false, o mesmo helper restaura o card e a opção.
      assert.equal(await page.evaluate(() => window.FeiraDeliveryAccess.syncUberPickupOption({
        option: window.__uberCard,
        selectOption: window.__uberSelectOption,
        select: document.querySelector('#delivery'),
        beforeOption: document.querySelector('#deliveryHomeOption'),
        deliveryActive: false,
      })), true);
      assert.equal(await page.locator('#deliveryUber').count(), 1);
      assert.equal(await page.locator('#delivery option[value="pickup_uber"]').count(), 1);
      await page.locator('#delivery').selectOption('pickup_store');
      await page.locator('#delivery').dispatchEvent('change');
      assert.equal(await page.locator('#deliveryStore').isChecked(), true);
      await page.locator('#delivery').selectOption('delivery');
      await page.locator('#delivery').dispatchEvent('change');
      assert.equal(await page.locator('#deliveryHome').isChecked(), true);
      await page.locator('#delivery').selectOption('pickup_uber');
      await page.locator('#delivery').dispatchEvent('change');
      assert.equal(await page.locator('#deliveryUber').isChecked(), true);

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
        { isAdminConfirmed: false, deliveryType: 'delivery' }, // visitante
        { isAdminConfirmed: false, deliveryType: 'delivery' }, // cliente comum
        { isAdminConfirmed: false, deliveryType: 'delivery' }, // admin ainda pendente/erro
      ]) {
        assert.equal(await syncTestPayment(state), false);
        assert.deepEqual(await testPaymentSnapshot(), { label: null, radio: false, option: false, hidden: null, textPresent: false });
      }
      // Admin confirmado pode testar Entrega Feira On e Retirar na loja.
      for (const deliveryType of ['delivery', 'pickup_store']) {
        assert.equal(await syncTestPayment({ isAdminConfirmed: true, deliveryType }), true);
        const adminOption = await testPaymentSnapshot();
        assert.equal(adminOption.radio, true);
        assert.equal(adminOption.option, true);
        assert.equal(adminOption.hidden, false);
        assert.equal(adminOption.textPresent, true);
        assert.equal(await syncTestPayment({ isAdminConfirmed: false, deliveryType }), false);
        assert.deepEqual(await testPaymentSnapshot(), { label: null, radio: false, option: false, hidden: null, textPresent: false });
      }
      assert.equal(await syncTestPayment({ isAdminConfirmed: true, deliveryType: 'delivery' }), true);
      let testPayment = await testPaymentSnapshot();
      assert.equal(testPayment.radio, true);
      assert.equal(testPayment.option, true);
      assert.equal(testPayment.hidden, false);
      assert.equal(testPayment.textPresent, true);
      await page.locator('#payPixTestOption').click();
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
        deliveryBadge: document.querySelector('#deliveryStartingPrice .checkout-delivery-badge')?.textContent || null,
        schedule: document.querySelector('#deliveryHomeDescription .checkout-delivery-schedule')?.textContent || null,
        titleOneLine: getComputedStyle(document.querySelector('#deliveryHomeOption .checkout-choice-copy>b')).whiteSpace === 'nowrap',
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

      // Cliente comum confirmado vê a entrega quando a flag está ligada.
      const common = await page.evaluate(() => window.FeiraDeliveryAccess.loadDeliveryAccessState(
        { id: 'ordinary-user' },
        async name => name === 'is_current_user_admin'
          ? { data: false, error: null }
          : { data: true, error: null },
      ));
      assert.deepEqual(common, { adminCheckComplete: true, isAdmin: false, deliveryActive: true });
      await render(common);
      view = await snapshot();
      assert.equal(view.disabled, false);
      assert.equal(view.label, 'Calcular taxa');
      assert.equal(view.badgeCount, 0);
      assert.equal(view.description.includes('Taxa por distância'), true);
      await page.evaluate(() => { document.querySelector('#deliveryUberOption').hidden = !window.FeiraDeliveryAccess.canShowUberPickupOption(true); });
      assert.equal(await page.locator('#deliveryUberOption').evaluate(el => el.hidden), true);
      await page.evaluate(() => { document.querySelector('#deliveryUberOption').hidden = !window.FeiraDeliveryAccess.canShowUberPickupOption(false); });
      assert.equal(await page.locator('#deliveryUberOption').evaluate(el => el.hidden), false);
      assert.equal(await page.evaluate(() => window.FeiraDeliveryAccess.deliveryQuoteErrorMessage(502, 'LALAMOVE_QUOTE_FAILED')),
        'Entrega indisponível no momento.');

      // Fora do horário, a opção continua selecionável e informa o próximo dia útil.
      await render({ ...common, withinHours: false, scheduleLabel: 'terça, 17/11' });
      view = await snapshot();
      assert.equal(view.disabled, false);
      assert.equal(view.description.startsWith('Taxa por distância, paga com Pix junto do pedido.'), true);
      assert.equal(view.label, 'Ter. de manhã');
      assert.equal(view.deliveryBadge, 'Ter. de manhã');
      assert.equal(view.schedule, 'Entrega a partir de terça, 17/11 pela manhã.');
      assert.equal(view.titleOneLine, true);
      assert.equal(view.noHorizontalOverflow, true);

      // Delayed admin response: remain disabled until the positive answer.
      await render({ isAdmin: false, adminCheckComplete: false, deliveryActive: false, withinHours: true });
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
      await render({ ...adminInactive, withinHours: false });
      view = await snapshot();
      assert.equal(view.disabled, false);
      assert.equal(view.label, 'TESTE');

      // Com a flag ligada, inclusive o administrador vê a opção normal, sem selo TESTE.
      const adminActive = await page.evaluate(() => window.FeiraDeliveryAccess.loadDeliveryAccessState(
        { id: 'confirmed-admin' }, async name => name === 'is_current_user_admin'
          ? { data: true, error: null }
          : { data: true, error: null },
      ));
      await render(adminActive);
      view = await snapshot();
      assert.equal(view.disabled, false);
      assert.equal(view.label, 'Calcular taxa');
      assert.equal(view.badgeCount, 0);
      assert.equal(view.description.includes('Taxa por distância'), true);

      // Erro no RPC admin remove somente o modo TESTE; a entrega ativa continua pública.
      const rpcError = await page.evaluate(() => window.FeiraDeliveryAccess.loadDeliveryAccessState(
        { id: 'admin-rpc-error' },
        async name => name === 'is_current_user_admin'
          ? { data: null, error: { message: 'RPC unavailable' } }
          : { data: true, error: null },
      ));
      await render(rpcError);
      view = await snapshot();
      assert.equal(view.disabled, false);
      assert.equal(view.label, 'Calcular taxa');
      assert.equal(view.badgeCount, 0);
      assert.equal(view.description.includes('Taxa por distância'), true);

      const networkError = await page.evaluate(() => window.FeiraDeliveryAccess.loadDeliveryAccessState(
        { id: 'admin-network-error' },
        async name => {
          if (name === 'is_current_user_admin') throw new Error('network failure');
          return { data: true, error: null };
        },
      ));
      await render(networkError);
      view = await snapshot();
      assert.equal(view.disabled, false);
      assert.equal(view.label, 'Calcular taxa');
      assert.equal(view.badgeCount, 0);
      assert.equal(view.description.includes('Taxa por distância'), true);

      // O texto da entrega não é truncado; o selo TESTE continua em uma linha no celular.
      await render(adminInactive);
      view = await snapshot();
      assert.equal(view.clamp, 'none');
      assert.equal(view.badgeWhiteSpace, 'nowrap');
      assert.equal(view.noHorizontalOverflow, true);
      assert.ok(view.badgeRight <= view.cardRight + 1);
      await render(adminActive);
      view = await snapshot();
      assert.equal(view.label, 'Calcular taxa');
      assert.equal(view.badgeCount, 0);
      fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'artifacts', 'checkout-delivery-admin-' + width + '.png'), fullPage: true });
      assert.deepEqual(consoleErrors, [], width + 'px: erros de console');
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
