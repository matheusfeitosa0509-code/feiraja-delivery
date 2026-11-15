(()=> {
 'use strict';
 const instances=new Map();
 let leafletPromise=null;
 function loadLeaflet(){
  if(window.L)return Promise.resolve(window.L);
  if(leafletPromise)return leafletPromise;
  leafletPromise=new Promise((resolve,reject)=>{
   if(!document.querySelector('link[data-feira-tracking-leaflet]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';link.dataset.feiraTrackingLeaflet='1';document.head.append(link);
   }
   const script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
   script.onload=()=>resolve(window.L);script.onerror=()=>{leafletPromise=null;reject(new Error('LEAFLET_UNAVAILABLE'));};document.head.append(script);
  });
  return leafletPromise;
 }
 function addStyles(){
  if(document.getElementById('feira-lalamove-map-style'))return;
  const style=document.createElement('style');style.id='feira-lalamove-map-style';
  style.textContent='.feira-lalamove-map{display:grid;gap:7px;margin:10px 0;min-width:0}.feira-lalamove-map-canvas{height:220px;min-height:190px;width:100%;border-radius:13px;overflow:hidden;background:#e9eee4;border:1px solid #dce7d8}.feira-lalamove-map-status{margin:0;font-size:11px;line-height:1.4;color:#526b59}.feira-lalamove-tracking-fallback{font-size:10px;color:#176b3a;font-weight:800;text-decoration:underline}.feira-lalamove-driver-info{display:flex;align-items:center;gap:9px;min-width:0;font-size:11px;line-height:1.35;color:#294a34}.feira-lalamove-driver-info img{width:38px;height:38px;object-fit:cover;border-radius:50%;flex:none}.feira-lalamove-driver-info strong{display:block}.feira-lalamove-driver-info small{display:block;color:#607467}.feira-map-pin{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border:2px solid white;border-radius:50%;background:#fff;box-shadow:0 2px 8px #0003;font-size:20px}.feira-map-pin.driver{width:40px;height:40px;font-size:24px;border-color:#277b3e}.feira-lalamove-map a{font-size:10px;color:#176b3a;font-weight:800;text-decoration:underline}';
  document.head.append(style);
 }
 function point(value){
  const lat=Number(value?.lat),lng=Number(value?.lng);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180?[lat,lng]:null;
 }
 function safePhoto(value){
  try{const url=new URL(String(value||''));return url.protocol==='https:'?url.href:'';}catch{return '';}
 }
 function icon(L,emoji,driver=false){
  return L.divIcon({className:'',html:'<span class="feira-map-pin'+(driver?' driver':'')+'">'+emoji+'</span>',iconSize:driver?[40,40]:[34,34],iconAnchor:driver?[20,20]:[17,17]});
 }
 function mount(container,fetchTracking,options={}){
  if(!container||typeof fetchTracking!=='function')return null;
  if(instances.has(container))return instances.get(container);
  addStyles();
  const orderId=String(container.dataset.orderId||'');
  const root=document.createElement('div');root.className='feira-lalamove-map';
  const status=document.createElement('p');status.className='feira-lalamove-map-status';status.setAttribute('role','status');status.textContent='Carregando localização do entregador…';
  const canvas=document.createElement('div');canvas.className='feira-lalamove-map-canvas';canvas.setAttribute('aria-label','Mapa da entrega');canvas.hidden=true;
  const driverInfo=document.createElement('div');driverInfo.className='feira-lalamove-driver-info';driverInfo.hidden=true;
  const fallback=document.createElement('a');fallback.className='feira-lalamove-tracking-fallback';fallback.textContent='Abrir rastreio da Lalamove';fallback.target='_blank';fallback.rel='noopener noreferrer';fallback.hidden=true;
  root.append(status,canvas,driverInfo,fallback);container.replaceChildren(root);
  const state={container,root,status,canvas,driverInfo,orderId,fetchTracking,map:null,storeMarker:null,homeMarker:null,driverMarker:null,route:null,timer:null,observer:null,animation:0,stopped:false,refresh:null};
  function stop(){if(state.timer){clearInterval(state.timer);state.timer=null;}if(state.animation)cancelAnimationFrame(state.animation);state.animation=0;}
  function destroy(){stop();state.stopped=true;if(state.observer)state.observer.disconnect();if(state.map){state.map.remove();state.map=null;}instances.delete(container);}
  function animateDriver(target){
   if(!state.driverMarker)return;
   if(state.animation)cancelAnimationFrame(state.animation);
   const from=state.driverMarker.getLatLng(),to={lat:target[0],lng:target[1]},duration=Math.max(250,Number(options.animationDurationMs)||14000);
   let start=0;
   const frame=now=>{if(!start)start=now;const t=Math.min(1,(now-start)/duration);const lat=from.lat+(to.lat-from.lat)*t,lng=from.lng+(to.lng-from.lng)*t;state.driverMarker.setLatLng([lat,lng]);if(t<1)state.animation=requestAnimationFrame(frame);else state.animation=0;};
   state.animation=requestAnimationFrame(frame);
  }
  function updateDriverInfo(driver,vehicle){
   driverInfo.replaceChildren();
   const photo=safePhoto(driver?.photo);
   if(photo){const img=document.createElement('img');img.src=photo;img.alt='Foto do entregador';img.loading='lazy';driverInfo.append(img);}
   const copy=document.createElement('div');const name=document.createElement('strong');name.textContent=String(driver?.name||'Entregador da Lalamove');
   const details=document.createElement('small');details.textContent=[vehicle==='CAR'?'Carro':'Moto',driver?.plateNumber?'Placa '+String(driver.plateNumber):''].filter(Boolean).join(' · ');
   copy.append(name,details);driverInfo.append(copy);driverInfo.hidden=false;
  }
  async function ensureMap(data){
   const L=await loadLeaflet();
   const store=point(data.store),home=point(data.customer);
   if(!store||!home)throw new Error('COORDINATES_UNAVAILABLE');
   if(!state.map){
    state.canvas.hidden=false;
    state.map=L.map(state.canvas,{scrollWheelZoom:false,zoomControl:true,attributionControl:true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(state.map);
    state.storeMarker=L.marker(store,{icon:icon(L,'🏪')}).addTo(state.map).bindPopup('Feira On Delivery · Loja');
    state.homeMarker=L.marker(home,{icon:icon(L,'🏠')}).addTo(state.map).bindPopup('Endereço de entrega');
    state.route=L.polyline([store,home],{color:'#2f8a4c',weight:4,opacity:.65,dashArray:'7 7'}).addTo(state.map);
    state.map.fitBounds(L.latLngBounds([store,home]).pad(.22));
    setTimeout(()=>state.map&&state.map.invalidateSize(),120);
   }
   const driverPoint=point(data.driver?.coordinates);
   if(driverPoint){
    if(!state.driverMarker)state.driverMarker=L.marker(driverPoint,{icon:icon(L,data.vehicle==='CAR'?'🚗':'🛵',true),zIndexOffset:1000}).addTo(state.map);
    else animateDriver(driverPoint);
    updateDriverInfo(data.driver,data.vehicle);
    status.textContent=data.driver?.name?data.driver.name+' está em deslocamento. Posição atualizada pela Lalamove.':'Posição do entregador atualizada pela Lalamove.';
   }else{
    status.textContent='Motorista atribuído. Aguardando a primeira posição compartilhada pela Lalamove…';
    if(data.driver&&(data.driver.name||data.driver.plateNumber))updateDriverInfo(data.driver,data.vehicle);
   }
  }
  function syncOrderUI(data){
   const value=String(data?.status||'');
   const card=container.closest('.order-card');
   const statusLabel=container.closest('.lalamove-admin')?.querySelector('[data-lalamove-status-label]');
   const labels={searching:'Procurando motorista',assigned:'A caminho',enroute_pickup:'A caminho',picked_up:'Coletado',delivered:'Entregue',cancelled:'Entrega cancelada',rejected:'Entrega recusada',expired:'Nenhum motorista aceitou — chame de novo'};
   if(statusLabel&&labels[value])statusLabel.textContent=labels[value];
   const terminal=['cancelled','rejected','expired'].includes(value);
   if(!card)return;
   if(terminal||value==='delivered'){const section=container.closest('.customer-lalamove-tracking');if(section)section.hidden=true;container.hidden=true;}
   const heading=card.querySelector('.order-status-top b');
   const subtitle=card.querySelector('.order-subtitle');
   const timeline=card.querySelector('.order-timeline');
   if(!timeline)return;
   const detail=timeline.querySelector('.order-timeline-detail');
   const index=value==='delivered'?3:value==='picked_up'||value==='assigned'||value==='enroute_pickup'?2:value==='searching'?1:-1;
   timeline.classList.toggle('is-terminal',terminal);
   [...timeline.querySelectorAll('li')].forEach((step,i)=>{
    step.classList.toggle('done',!terminal&&index>=0&&i<index);
    step.classList.toggle('now',!terminal&&index>=0&&i===index);
   });
   if(value==='searching'){if(heading)heading.textContent='Preparando seu pedido';if(subtitle)subtitle.textContent='Procurando entregador…';if(detail)detail.textContent='Procurando entregador…';}
   else if(value==='assigned'||value==='enroute_pickup'){if(heading)heading.textContent='A caminho';if(subtitle)subtitle.textContent='O motorista está a caminho da loja.';if(detail)detail.textContent='Motorista a caminho da loja.';}
   else if(value==='picked_up'){const name=String(data.driver?.name||'O entregador');if(heading)heading.textContent='A caminho';if(subtitle)subtitle.textContent=name+' está levando seu pedido.';if(detail)detail.textContent=name+' está levando seu pedido.';}
   else if(value==='delivered'){if(heading)heading.textContent='Entregue';if(subtitle)subtitle.textContent='Seu pedido chegou.';if(detail)detail.textContent='Entrega concluída.';}
   else if(value==='expired'){if(heading)heading.textContent='Estamos chamando outro entregador';if(subtitle)subtitle.textContent='A solicitação anterior expirou.';if(detail)detail.textContent='A solicitação expirou. Estamos chamando outro entregador.';}
   else if(value==='cancelled'||value==='rejected'){if(heading)heading.textContent='Entrega cancelada';if(subtitle)subtitle.textContent='A entrega foi cancelada.';if(detail)detail.textContent='A entrega foi cancelada. Fale com a loja se precisar de ajuda.';}
  }
  async function refresh(){
   if(state.stopped||!container.isConnected)return;
   try{
    const data=await fetchTracking(orderId);
    syncOrderUI(data);
    const existingFallback=container.parentElement?.querySelector('.customer-tracking-fallback,.lalamove-tracking-link');
    if(data?.tracking_url){if(existingFallback){existingFallback.href=String(data.tracking_url);existingFallback.hidden=false;}else{fallback.href=String(data.tracking_url);fallback.hidden=false;}}
    if(!data||data.active===false){
     stop();status.textContent=data?.status==='delivered'?'Entrega concluída.':data?.status==='expired'?'A solicitação expirou.':data?.status==='cancelled'?'Entrega cancelada.':'O rastreio não está ativo neste momento.';
     if(state.map){state.map.remove();state.map=null;}\n     canvas.hidden=true;driverInfo.hidden=true;return;
    }
    if(!data.driver_assigned){status.textContent='Procurando entregador… O mapa aparecerá quando um motorista aceitar.';return;}
    await ensureMap(data);
   }catch(error){
    status.textContent='Não foi possível atualizar o mapa agora. Use “Abrir rastreio da Lalamove” como alternativa.';
   }
  }
  function start(){if(state.stopped||state.timer||document.visibilityState==='hidden'||!container.getClientRects().length)return;void refresh();state.timer=setInterval(()=>void refresh(),Math.max(15000,Number(options.pollIntervalMs)||15000));}
  function visibility(){if(document.visibilityState==='hidden'||!container.getClientRects().length)stop();else start();}
  state.refresh=refresh;state.destroy=destroy;
  if('IntersectionObserver'in window){state.observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))start();else stop();});state.observer.observe(container);}else start();
  document.addEventListener('visibilitychange',visibility);
  state.cleanupVisibility=()=>document.removeEventListener('visibilitychange',visibility);
  instances.set(container,state);
  return state;
 }
 const cleanupObserver=new MutationObserver(()=>{for(const [el,state] of instances){if(!el.isConnected){state.cleanupVisibility?.();state.destroy();}}});
 if(document.documentElement)cleanupObserver.observe(document.documentElement,{childList:true,subtree:true});
 window.addEventListener('pagehide',()=>{for(const state of instances.values()){state.cleanupVisibility?.();state.destroy();}});
 window.FeiraLalamoveMap={mount,destroy(container){const state=instances.get(container);if(state){state.cleanupVisibility?.();state.destroy();}},mountAll(selector,fetcher,options){document.querySelectorAll(selector||'[data-lalamove-map]').forEach(el=>mount(el,fetcher,options));}};
})();