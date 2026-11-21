import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.1';

(() => {
  const db = createClient(
    'https://juhwdevvwstmyxyyagzh.supabase.co',
    'sb_publishable_Hkv-6zE28sUHkhutD3TmGg_JIgOXCAW',
    { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } }
  );
  const params = new URLSearchParams(location.search);
  const hasUtm = ['utm_source','utm_medium','utm_campaign'].some(key => params.has(key));
  const attribution = {
    p_utm_source: hasUtm ? (params.get('utm_source') || 'não informado') : 'direto',
    p_utm_medium: params.get('utm_medium') || null,
    p_utm_campaign: params.get('utm_campaign') || null,
    p_device: (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) || window.innerWidth < 768 ? 'celular' : 'computador'
  };
  const seen = { added:false, checkout:false, login:false, created:false, paid:false };
  let queue = Promise.resolve();
  const record = event => {
    queue = queue.then(() => db.rpc('record_store_funnel_event', {
      p_event:event, ...attribution
    })).catch(() => null);
  };
  record('visit');

  document.addEventListener('click', event => {
    const button = event.target && event.target.closest
      ? event.target.closest('[data-add],[data-home-add],[data-card-change],[data-home-card-change],[data-value-add]')
      : null;
    if (button && !seen.added) { seen.added = true; record('add_to_cart'); }
  }, true);

  const inspect = () => {
    const checkout = document.getElementById('modal');
    const checkoutForm = document.getElementById('checkoutForm');
    const checkoutOpen = !!(checkout && checkout.classList.contains('open') && checkoutForm && !checkoutForm.classList.contains('hidden'));
    if (checkoutOpen && !seen.checkout) { seen.checkout = true; record('checkout_open'); }

    const account = document.getElementById('accountModal');
    const authForm = document.getElementById('authForm');
    const loginOpen = !!(account && account.classList.contains('open') && authForm && !authForm.classList.contains('hidden'));
    if (loginOpen && !seen.login) { seen.login = true; record('login_screen'); }

    const result = (document.getElementById('result')?.textContent || '').toLocaleLowerCase('pt-BR');
    if (!seen.created && (result.includes('pedido registrado') || result.includes('pix gerado'))) {
      seen.created = true; record('order_created');
    }
    const paymentStatus = (document.getElementById('pixStatus')?.textContent || '').toLocaleLowerCase('pt-BR');
    if (!seen.paid && (paymentStatus.includes('pagamento concluído') || paymentStatus.includes('pagamento concluido'))) {
      seen.paid = true; record('order_paid');
    }
  };

  const start = () => {
    if (!document.body) return;
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['class','hidden','aria-hidden'] });
    inspect();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();