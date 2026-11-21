import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.1';

(() => {
  const db = createClient(
    'https://juhwdevvwstmyxyyagzh.supabase.co',
    'sb_publishable_Hkv-6zE28sUHkhutD3TmGg_JIgOXCAW',
    { auth: { persistSession:true, autoRefreshToken:false, detectSessionInUrl:false } }
  );
  const $ = id => document.getElementById(id);
  const labels = [
    ['visit','Visitas'],['add_to_cart','Adicionou ao carrinho'],['checkout_open','Abriu checkout'],
    ['login_screen','Tela de login'],['order_created','Pedido criado'],['order_paid','Pedido pago']
  ];
  const moneyless = value => Number(value || 0).toLocaleString('pt-BR');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let activePeriod = 'today';

  function periodRange(period) {
    const end = new Date(), start = new Date(end);
    start.setHours(0,0,0,0);
    if (period === 'yesterday') { start.setDate(start.getDate()-1); end.setTime(start.getTime()+86400000); }
    else if (period === 'week') { const day=(start.getDay()+6)%7; start.setDate(start.getDate()-day); }
    else if (period === 'month') start.setDate(1);
    else end.setTime(start.getTime()+86400000);
    return { p_start:start.toISOString(), p_end:end.toISOString() };
  }
  function originLabel(row) {
    const all=[row.utm_source,row.utm_medium,row.utm_campaign].filter(Boolean).join(' ').toLowerCase();
    if (all.includes('whatsapp') || all.includes('wa.me')) return 'WhatsApp';
    if (all.includes('bio') || all.includes('linktree')) return 'Bio';
    if (/(cpc|paid|ads|anuncio|anúncio|facebook|instagram_ads)/i.test(all)) return 'Anúncio';
    if (row.utm_source === 'direto') return 'Direto';
    return row.utm_source || 'Outros';
  }
  function render(data) {
    const counts=data?.counts||{};
    const max=Math.max(1,Number(counts.visit)||0);
    const funnel=$('funnelStages');
    funnel.innerHTML=labels.map(([key,label],index)=>{
      const value=Number(counts[key]||0);
      const previous=index?Number(counts[labels[index-1][0]]||0):null;
      const conversion=index? (previous>0?((value/previous)*100).toFixed(1).replace('.',',')+'%':'—') : 'Base';
      const width=Math.max(0,Math.min(100,(value/max)*100));
      return '<div class="funnel-stage"><div class="funnel-stage-head"><strong>'+label+'</strong><span>'+moneyless(value)+' · '+conversion+'</span></div><div class="funnel-track"><span style="width:'+width+'%"></span></div></div>';
    }).join('');
    const grouped=new Map();
    for(const row of (data?.origins||[])) {
      const label=originLabel(row), current=grouped.get(label)||{visits:0,cart:0,orders:0,paid:0};
      current.visits+=Number(row.visits||0); current.cart+=Number(row.add_to_cart||0);
      current.orders+=Number(row.order_created||0); current.paid+=Number(row.order_paid||0);
      grouped.set(label,current);
    }
    const rows=[...grouped.entries()].sort((a,b)=>b[1].visits-a[1].visits);
    $('funnelOrigins').innerHTML=rows.length?rows.map(([label,row])=>'<tr><td>'+escapeHtml(label)+'</td><td>'+moneyless(row.visits)+'</td><td>'+moneyless(row.cart)+'</td><td>'+moneyless(row.orders)+'</td><td>'+moneyless(row.paid)+'</td></tr>').join(''):'<tr><td colspan="5">Sem dados neste período.</td></tr>';
    $('funnelMessage').textContent='Dados anônimos · '+rows.length+' origem(ns).';
  }
  async function load() {
    const button=$('funnelRefresh');
    button.disabled=true; $('funnelMessage').textContent='Carregando…';
    try {
      const range=periodRange(activePeriod);
      const {data,error}=await db.rpc('admin_get_store_funnel',range);
      if(error) throw error;
      render(data);
    } catch(error) {
      $('funnelMessage').textContent=error?.message||'Não foi possível carregar o funil.';
      $('funnelStages').replaceChildren(); $('funnelOrigins').innerHTML='<tr><td colspan="5">Sem dados disponíveis.</td></tr>';
    } finally { button.disabled=false; }
  }
  document.querySelectorAll('[data-funnel-period]').forEach(button=>button.addEventListener('click',()=>{
    activePeriod=button.dataset.funnelPeriod;
    document.querySelectorAll('[data-funnel-period]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    void load();
  }));
  $('funnelRefresh')?.addEventListener('click',load);
  $('tabFunnel')?.addEventListener('click',load);
})();