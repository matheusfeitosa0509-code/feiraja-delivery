(()=> {
 'use strict';
 const instances=new Map();let leafletPromise=null;
 function loadLeaflet(){
  if(window.L)return Promise.resolve(window.L);
  if(leafletPromise)return leafletPromise;
  leafletPromise=new Promise((resolve,reject)=>{
   if(!document.querySelector('link[data-feira-leaflet]')){const link=document.createElement('link');link.rel='stylesheet';link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';link.dataset.feiraLeaflet='1';document.head.append(link);}
   const script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.dataset.feiraLeaflet='1';script.onload=()=>window.L?resolve(window.L):reject(new Error('LEAFLET_UNAVAILABLE'));script.onerror=()=>{leafletPromise=null;reject(new Error('LEAFLET_UNAVAILABLE'));};document.head.append(script);
  });return leafletPromise;
 }
 function addStyles(){if(document.getElementById('feira-delivery-map-style'))return;const style=document.createElement('style');style.id='feira-delivery-map-style';style.textContent='.feira-delivery-tracking{display:grid;gap:9px;margin:12px 0;min-width:0}.feira-delivery-map{height:45vh;min-height:220px;max-height:420px;width:100%;border-radius:18px;overflow:hidden;border:1px solid #dce4df;background:#f3f5f2}.feira-delivery-map[hidden]{display:none!important}.feira-delivery-status{margin:0;font-size:13px;line-height:1.45;color:#365b45;font-weight:750}.feira-driver-card{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e1e8dc;border-radius:12px;background:#f8fbf6;min-width:0}.feira-driver-card[hidden]{display:none!important}.feira-driver-card img{width:44px;height:44px;border-radius:50%;object-fit:cover;flex:none}.feira-driver-card strong{display:block;overflow-wrap:anywhere}.feira-driver-card small{display:block;color:#607467;overflow-wrap:anywhere}.feira-delivery-map .leaflet-control-attribution{font-size:9px}.feira-delivery-tracking.is-admin .feira-delivery-map{height:205px;min-height:205px;max-height:none}.feira-map-marker{display:flex;align-items:center;justify-content:center;width:42px;height:42px;background:transparent;filter:drop-shadow(0 2px 3px #0004)}.feira-map-marker svg{display:block;width:100%;height:100%}.feira-delivery-actions{display:flex;gap:8px;flex-wrap:wrap}.feira-delivery-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 14px;border-radius:10px;background:#176b3a;color:white;text-decoration:none;font-weight:800;font-size:13px}.feira-delivery-actions a.admin{background:#344b3a}';
 document.head.append(style);}
 function point(value){const lat=Number(value?.lat),lng=Number(value?.lng);return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180?{lat,lng}:null;}
 function safePhoto(value){try{const url=new URL(String(value||''));return url.protocol==='https:'?url.href:'';}catch{return '';}}
 function firstName(value){return String(value||'Entregador').trim().split(/\s+/)[0]||'Entregador';}
 function bearing(from,to){const rad=Math.PI/180,lat1=from.lat*rad,lat2=to.lat*rad,dLng=(to.lng-from.lng)*rad;return (Math.atan2(Math.sin(dLng)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng))*180/Math.PI+360)%360;}
 function iconSvg(kind,angle=0){
  if(kind==='store')return '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="#fff" stroke="#1E6B3A" stroke-width="3"/><path d="M11 20h26l-2-8H13l-2 8Z" fill="#F4C542" stroke="#1E6B3A" stroke-width="2" stroke-linejoin="round"/><path d="M13 20v16h22V20M19 36V25h10v11M11 20c0 5 7 5 7 0 0 5 7 5 7 0 0 5 7 5 7 0 0 5 7 5 7 0" fill="none" stroke="#1E6B3A" stroke-width="2" stroke-linejoin="round"/><path d="M17 8l2-3m12 3-2-3" stroke="#1E6B3A" stroke-width="2" stroke-linecap="round"/></svg>';
  if(kind==='home')return '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="#fff" stroke="#F2C744" stroke-width="3"/><path d="M9 23 24 10l15 13" fill="none" stroke="#1E6B3A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 21v16h20V21M21 37V26h7v11" fill="#F2C744" stroke="#1E6B3A" stroke-width="2.5" stroke-linejoin="round"/></svg>';
  return '<svg viewBox="0 0 48 48" aria-hidden="true"><g transform="rotate('+Number(angle||0)+' 24 24)"><circle cx="24" cy="24" r="22" fill="#fff" stroke="#1E6B3A" stroke-width="3"/><path d="m24 5 8 12-8-3-8 3 8-12Z" fill="#F2C744" stroke="#14532D" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 30h5l4-7h7l5 7h3l-2 6H14l-2-6Z" fill="#1E6B3A" stroke="#14532D" stroke-width="1.5" stroke-linejoin="round"/><circle cx="18" cy="36" r="3" fill="#fff" stroke="#14532D" stroke-width="2"/><circle cx="31" cy="36" r="3" fill="#fff" stroke="#14532D" stroke-width="2"/></g></svg>';
 }
 function marker(L,kind,label,angle=0){return L.divIcon({className:'',html:'<span class="feira-map-marker" role="img" aria-label="'+label+'">'+iconSvg(kind,angle)+'</span>',iconSize:[42,42],iconAnchor:[21,21]});}
 function projectedPoint(store,home,driver){
  const dx=home.lng-store.lng,dy=home.lat-store.lat,den=dx*dx+dy*dy;if(!den)return store;
  const t=Math.max(0,Math.min(1,((driver.lng-store.lng)*dx+(driver.lat-store.lat)*dy)/den));
  return {lat:store.lat+t*dy,lng:store.lng+t*dx};
 }
 function mount(container,fetchTracking,options={}){
  if(!container||typeof fetchTracking!=='function'||instances.has(container))return null;addStyles();
  const root=document.createElement('section');root.className='feira-delivery-tracking'+(options.admin?' is-admin':'');
  const status=document.createElement('p');status.className='feira-delivery-status';status.setAttribute('role','status');status.textContent='Carregando acompanhamento da entrega…';
  const driverCard=document.createElement('div');driverCard.className='feira-driver-card';driverCard.hidden=true;
  const mapEl=document.createElement('div');mapEl.className='feira-delivery-map';mapEl.setAttribute('role','application');mapEl.setAttribute('aria-label','Mapa da entrega');mapEl.hidden=true;
  const actions=document.createElement('div');actions.className='feira-delivery-actions';
  if(options.admin){const open=document.createElement('a');open.className='admin';open.target='_blank';open.rel='noopener noreferrer';open.textContent='Abrir na Lalamove';open.hidden=true;actions.append(open);}
  else{const contact=document.createElement('a');contact.href=options.whatsappUrl||'https://wa.me/559294444989';contact.target='_blank';contact.rel='noopener noreferrer';contact.textContent='Falar com a Feira On';actions.append(contact);}
  root.append(status,driverCard,mapEl,actions);container.replaceChildren(root);
  const state={container,root,status,driverCard,mapEl,map:null,store:null,home:null,driver:null,route:null,progress:null,driverIncludedInBounds:false,timer:null,observer:null,animation:0,lastPoint:null,inFlight:false,stopped:false};
  function stop(){if(state.timer){clearInterval(state.timer);state.timer=null;}if(state.animation)cancelAnimationFrame(state.animation);state.animation=0;}
  function destroy(){stop();state.stopped=true;state.observer?.disconnect();state.map?.remove();instances.delete(container);}
  function renderDriver(driver,vehicle){
   driverCard.replaceChildren();const photo=safePhoto(driver?.photo);if(photo){const img=document.createElement('img');img.src=photo;img.alt='Foto do entregador';img.loading='lazy';driverCard.append(img);}
   const copy=document.createElement('div'),name=document.createElement('strong'),details=document.createElement('small');name.textContent=firstName(driver?.name);details.textContent=[vehicle==='CAR'?'Carro':'Moto',driver?.plateNumber?'Placa '+driver.plateNumber:''].filter(Boolean).join(' · ');copy.append(name,details);driverCard.append(copy);driverCard.hidden=false;
   if(options.admin&&driver?.phone){const phone=document.createElement('small');phone.textContent='Telefone: '+String(driver.phone);copy.append(phone);}
  }
  function updateProgress(driver){
   if(!state.progress||!driver||!state.store||!state.home)return;
   const end=projectedPoint(state.store,state.home,driver);state.progress.setLatLngs([[state.store.lat,state.store.lng],[end.lat,end.lng]]);
  }
  function animateDriver(target){
   if(!state.driver){state.driver=window.L.marker([target.lat,target.lng],{icon:marker(window.L,'moto','Entregador',0),zIndexOffset:1000}).addTo(state.map);state.lastPoint={...target};updateProgress(target);if(!state.driverIncludedInBounds){state.map.fitBounds([[state.store.lat,state.store.lng],[state.home.lat,state.home.lng],[target.lat,target.lng]],{padding:[36,36],maxZoom:16});state.driverIncludedInBounds=true;}return;}
   if(!state.lastPoint){state.driver.setLatLng([target.lat,target.lng]);state.lastPoint={...target};updateProgress(target);return;}
   if(state.animation)cancelAnimationFrame(state.animation);const from={...state.lastPoint},to={...target},angle=bearing(from,to);let start=0;const duration=2500;
   const frame=now=>{if(!start)start=now;const t=Math.min(1,(now-start)/duration),e=t*t*(3-2*t);const current={lat:from.lat+(to.lat-from.lat)*e,lng:from.lng+(to.lng-from.lng)*e};state.driver.setLatLng([current.lat,current.lng]);updateProgress(current);if(t<1)state.animation=requestAnimationFrame(frame);else{state.animation=0;state.lastPoint={...to};if(state.driver.setIcon)state.driver.setIcon(marker(window.L,'moto','Entregador',angle));}};
   state.animation=requestAnimationFrame(frame);
  }
  async function renderMap(data){
   const L=await loadLeaflet(),store=point(data.store),home=point(data.customer),driver=point(data.driver?.coordinates);if(!store||!home)throw new Error('COORDINATES_UNAVAILABLE');mapEl.hidden=false;
   if(!state.map){
    state.map=L.map(mapEl,{zoomControl:!!options.admin,scrollWheelZoom:!!options.admin}).setView([store.lat,store.lng],14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:20,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>'}).addTo(state.map);
    state.route=L.polyline([[store.lat,store.lng],[home.lat,home.lng]],{color:'#1E6B3A',weight:5,opacity:.9,lineCap:'round'}).addTo(state.map);
    state.progress=L.polyline([[store.lat,store.lng],[store.lat,store.lng]],{color:'#14532D',weight:6,opacity:1,lineCap:'round'}).addTo(state.map);
    state.store=L.marker([store.lat,store.lng],{icon:marker(L,'store','Feira On')}).addTo(state.map);
    state.home=L.marker([home.lat,home.lng],{icon:marker(L,'home','Casa da cliente')}).addTo(state.map);
    if(driver){state.driver=L.marker([driver.lat,driver.lng],{icon:marker(L,'moto','Entregador'),zIndexOffset:1000}).addTo(state.map);state.lastPoint={...driver};state.driverIncludedInBounds=true;updateProgress(driver);}
    state.map.fitBounds([[store.lat,store.lng],[home.lat,home.lng],...(driver?[[driver.lat,driver.lng]]:[])],{padding:[36,36],maxZoom:16});
   }else{
    state.store.setLatLng([store.lat,store.lng]);state.home.setLatLng([home.lat,home.lng]);state.route.setLatLngs([[store.lat,store.lng],[home.lat,home.lng]]);
    if(driver)animateDriver(driver);else if(state.driver){state.map.removeLayer(state.driver);state.driver=null;state.lastPoint=null;state.driverIncludedInBounds=false;state.progress.setLatLngs([[store.lat,store.lng],[store.lat,store.lng]]);}
   }
   if(driver){renderDriver(data.driver,data.vehicle);status.textContent=data.eta?'Previsão de chegada: '+(/^\d+(?:[.,]\d+)?$/.test(String(data.eta).trim())?String(data.eta)+' min':String(data.eta)):data.status==='picked_up'?'O entregador está a caminho do seu endereço.':'O entregador está a caminho da feira.';}
   else{driverCard.hidden=true;status.textContent=data.status==='searching'?'Procurando entregador.':data.status==='picked_up'?'O entregador saiu para entrega.':'Entregador a caminho da feira.';}
   if(options.admin){const link=actions.querySelector('a.admin'),url=String(data.tracking_url||'');if(url.startsWith('https://')){link.href=url;link.hidden=false;}}
   setTimeout(()=>state.map?.invalidateSize(),80);
  }
  function syncStatus(data){
   const value=String(data?.status||'').toLowerCase(),card=container.closest('.order-card');if(!card)return;
   const heading=card.querySelector('.order-status-top b'),subtitle=card.querySelector('.order-subtitle'),timeline=card.querySelector('.order-timeline'),detail=timeline?.querySelector('.order-timeline-detail');
   const terminal=['delivered','completed','cancelled','canceled'];if(terminal.includes(value)){stop();container.hidden=true;return;}
   const index=value==='picked_up'?4:['assigned','enroute_pickup'].includes(value)?3:value==='searching'?2:-1;
   if(value==='picked_up'){if(heading)heading.textContent='Saiu para entrega';if(subtitle)subtitle.textContent='Seu pedido está a caminho.';if(detail)detail.textContent='O entregador está levando seu pedido.';}
   else if(value==='assigned'||value==='enroute_pickup'){if(heading)heading.textContent='Entregador a caminho da feira';if(subtitle)subtitle.textContent='O entregador está indo buscar seu pedido.';if(detail)detail.textContent='Entregador a caminho da feira.';}
   else if(value==='searching'){if(heading)heading.textContent='Procurando entregador';if(subtitle)subtitle.textContent='Estamos buscando um entregador para seu pedido.';if(detail)detail.textContent='Procurando entregador.';}
   if(timeline){[...timeline.querySelectorAll('li')].forEach((step,i)=>{step.classList.toggle('done',index>=0&&i<index);step.classList.toggle('now',index>=0&&i===index);});}
  }
  async function refresh(){if(state.stopped||!container.isConnected||state.inFlight)return;state.inFlight=true;try{const data=await fetchTracking(String(container.dataset.orderId||''));syncStatus(data);const terminal=['delivered','completed','cancelled','canceled'].includes(String(data?.status||'').toLowerCase());if(!data||terminal||data.active===false){stop();status.textContent=terminal?'Entrega encerrada.':'Acompanhamento encerrado.';mapEl.hidden=true;driverCard.hidden=true;container.hidden=true;return;}container.hidden=false;await renderMap(data);}catch(_){if(options.admin){status.textContent='Acompanhamento indisponível no momento.';mapEl.hidden=true;driverCard.hidden=true;}else{stop();container.hidden=true;}}finally{state.inFlight=false;}}
  function start(){if(state.stopped||state.timer||document.visibilityState==='hidden'||!container.getClientRects().length)return;void refresh();state.timer=setInterval(()=>void refresh(),options.pollIntervalMs||30000);}
  function visibility(){if(document.visibilityState==='hidden'||!container.getClientRects().length)stop();else start();}
  state.refresh=refresh;state.destroy=destroy;
  if('IntersectionObserver'in window){state.observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))start();else stop();});state.observer.observe(container);}else start();
  document.addEventListener('visibilitychange',visibility);state.cleanup=()=>document.removeEventListener('visibilitychange',visibility);instances.set(container,state);return state;
 }
 const observer=new MutationObserver(()=>{for(const [el,state] of instances)if(!el.isConnected){state.cleanup?.();state.destroy();}});
 if(document.documentElement)observer.observe(document.documentElement,{childList:true,subtree:true});
 window.addEventListener('pagehide',()=>{for(const state of instances.values()){state.cleanup?.();state.destroy();}});
 window.FeiraLalamoveMap={mount,mountAll(selector,fetcher,options){document.querySelectorAll(selector||'[data-delivery-map]').forEach(el=>mount(el,fetcher,options));},destroy(container){const state=instances.get(container);if(state){state.cleanup?.();state.destroy();}}};
})();