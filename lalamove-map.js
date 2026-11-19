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
 function addStyles(){if(document.getElementById('feira-delivery-map-style'))return;const style=document.createElement('style');style.id='feira-delivery-map-style';style.textContent='.feira-delivery-tracking{display:grid;gap:9px;margin:12px 0;min-width:0}.feira-delivery-map{height:230px;min-height:190px;width:100%;border-radius:14px;overflow:hidden;border:1px solid #dce4df;background:#eef1ef}.feira-delivery-map[hidden]{display:none!important}.feira-delivery-status{margin:0;font-size:13px;line-height:1.45;color:#365b45;font-weight:750}.feira-driver-card{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e1e8dc;border-radius:12px;background:#f8fbf6;min-width:0}.feira-driver-card[hidden]{display:none!important}.feira-driver-card img{width:44px;height:44px;border-radius:50%;object-fit:cover;flex:none}.feira-driver-card strong{display:block;overflow-wrap:anywhere}.feira-driver-card small{display:block;color:#607467;overflow-wrap:anywhere}.feira-delivery-map .leaflet-control-attribution{font-size:9px}.feira-map-marker{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border:2px solid white;border-radius:50%;background:white;box-shadow:0 2px 8px #0003;font-size:20px}.feira-map-marker.driver{width:42px;height:42px;font-size:26px}.feira-delivery-actions{display:flex;gap:8px;flex-wrap:wrap}.feira-delivery-actions a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 14px;border-radius:10px;background:#176b3a;color:white;text-decoration:none;font-weight:800;font-size:13px}.feira-delivery-actions a.admin{background:#344b3a}';
 document.head.append(style);}
 function point(value){const lat=Number(value?.lat),lng=Number(value?.lng);return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180?{lat,lng}:null;}
 function safePhoto(value){try{const url=new URL(String(value||''));return url.protocol==='https:'?url.href:'';}catch{return '';}}
 function firstName(value){return String(value||'Entregador').trim().split(/\\s+/)[0]||'Entregador';}
 function marker(L,emoji,label,driver=false){return L.divIcon({className:'',html:'<span class="feira-map-marker'+(driver?' driver':'')+'" role="img" aria-label="'+label+'">'+emoji+'</span>',iconSize:driver?[42,42]:[34,34],iconAnchor:driver?[21,21]:[17,17]});}
 function mount(container,fetchTracking,options={}){
  if(!container||typeof fetchTracking!=='function'||instances.has(container))return null;addStyles();
  const root=document.createElement('section');root.className='feira-delivery-tracking';
  const status=document.createElement('p');status.className='feira-delivery-status';status.setAttribute('role','status');status.textContent='Carregando acompanhamento da entrega…';
  const driverCard=document.createElement('div');driverCard.className='feira-driver-card';driverCard.hidden=true;
  const mapEl=document.createElement('div');mapEl.className='feira-delivery-map';mapEl.setAttribute('role','application');mapEl.setAttribute('aria-label','Mapa da entrega');mapEl.hidden=true;
  const actions=document.createElement('div');actions.className='feira-delivery-actions';
  if(options.admin){const open=document.createElement('a');open.className='admin';open.target='_blank';open.rel='noopener noreferrer';open.textContent='Abrir na Lalamove';open.hidden=true;actions.append(open);}
  else{const contact=document.createElement('a');contact.href=options.whatsappUrl||'https://wa.me/559294444989';contact.target='_blank';contact.rel='noopener noreferrer';contact.textContent='Falar com a Feira On';actions.append(contact);}
  root.append(status,driverCard,mapEl,actions);container.replaceChildren(root);
  const state={container,root,status,driverCard,mapEl,actions,map:null,store:null,home:null,driver:null,timer:null,observer:null,animation:0,lastPoint:null,inFlight:false,stopped:false};
  function stop(){if(state.timer){clearInterval(state.timer);state.timer=null;}if(state.animation)cancelAnimationFrame(state.animation);state.animation=0;}
  function destroy(){stop();state.stopped=true;state.observer?.disconnect();state.map?.remove();instances.delete(container);}
  function renderDriver(driver,vehicle){
   driverCard.replaceChildren();const photo=safePhoto(driver?.photo);if(photo){const img=document.createElement('img');img.src=photo;img.alt='Foto do entregador';img.loading='lazy';driverCard.append(img);}
   const copy=document.createElement('div'),name=document.createElement('strong'),details=document.createElement('small');name.textContent=firstName(driver?.name);details.textContent=[vehicle==='CAR'?'Carro':'Moto',driver?.plateNumber?'Placa '+driver.plateNumber:''].filter(Boolean).join(' · ');copy.append(name,details);driverCard.append(copy);driverCard.hidden=false;
   if(options.admin&&driver?.phone){const phone=document.createElement('small');phone.textContent='Telefone: '+String(driver.phone);copy.append(phone);}
  }
  function animateDriver(target){
   if(!state.driver||!state.lastPoint){state.driver?.setLatLng([target.lat,target.lng]);state.lastPoint={...target};return;}
   if(state.animation)cancelAnimationFrame(state.animation);const from={...state.lastPoint},to={...target};let start=0;const duration=1000;
   const frame=now=>{if(!start)start=now;const t=Math.min(1,(now-start)/duration),e=t*t*(3-2*t);state.driver.setLatLng([from.lat+(to.lat-from.lat)*e,from.lng+(to.lng-from.lng)*e]);if(t<1)state.animation=requestAnimationFrame(frame);else{state.animation=0;state.lastPoint={...to};}};state.animation=requestAnimationFrame(frame);
  }
  async function renderMap(data){
   const L=await loadLeaflet(),store=point(data.store),home=point(data.customer),driver=point(data.driver?.coordinates);if(!store||!home)throw new Error('COORDINATES_UNAVAILABLE');mapEl.hidden=false;
   if(!state.map){state.map=L.map(mapEl,{zoomControl:true,scrollWheelZoom:false}).setView([store.lat,store.lng],13);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(state.map);state.store=L.marker([store.lat,store.lng],{icon:marker(L,'🏪','Feira On')}).addTo(state.map);state.home=L.marker([home.lat,home.lng],{icon:marker(L,'🏠','Sua casa')}).addTo(state.map);if(driver){state.driver=L.marker([driver.lat,driver.lng],{icon:marker(L,data.vehicle==='CAR'?'🚗':'🛵','Entregador',true),zIndexOffset:1000}).addTo(state.map);state.lastPoint={...driver};}state.map.fitBounds([[store.lat,store.lng],[home.lat,home.lng],...(driver?[[driver.lat,driver.lng]]:[])],{padding:[24,24],maxZoom:15});}
   else{state.store.setLatLng([store.lat,store.lng]);state.home.setLatLng([home.lat,home.lng]);if(driver){if(!state.driver){state.driver=L.marker([driver.lat,driver.lng],{icon:marker(L,data.vehicle==='CAR'?'🚗':'🛵','Entregador',true),zIndexOffset:1000}).addTo(state.map);state.lastPoint={...driver};}else animateDriver(driver);}}
   if(driver){renderDriver(data.driver,data.vehicle);status.textContent=data.eta?'Previsão de chegada: '+String(data.eta):data.status==='picked_up'?'O entregador está a caminho do seu endereço.':'O entregador está a caminho da feira.';}
   else{status.textContent='Entregador atribuído. Aguardando a primeira localização.';if(data.driver?.name)renderDriver(data.driver,data.vehicle);}
   if(options.admin){const link=actions.querySelector('a.admin');const url=String(data.tracking_url||'');if(url&&/^https:\\/\\//i.test(url)){link.href=url;link.hidden=false;}}
   setTimeout(()=>state.map?.invalidateSize(),80);
  }
  function syncStatus(data){
   const value=String(data?.status||''),card=container.closest('.order-card');if(!card)return;
   const heading=card.querySelector('.order-status-top b'),subtitle=card.querySelector('.order-subtitle'),timeline=card.querySelector('.order-timeline'),detail=timeline?.querySelector('.order-timeline-detail');
   const labels=['Pago','Separando','Procurando entregador','Entregador a caminho da feira','Saiu para entrega','Entregue'];
   let index=value==='delivered'?5:value==='picked_up'?4:['assigned','enroute_pickup'].includes(value)?3:value==='searching'?2:-1;
   if(value==='delivered'){if(heading)heading.textContent='Pedido entregue';if(subtitle)subtitle.textContent='Sua entrega foi concluída.';if(detail)detail.textContent='Seu pedido chegou.';}
   else if(value==='picked_up'){if(heading)heading.textContent='Saiu para entrega';if(subtitle)subtitle.textContent='Seu pedido está a caminho.';if(detail)detail.textContent='O entregador está levando seu pedido.';}
   else if(value==='assigned'||value==='enroute_pickup'){if(heading)heading.textContent='Entregador a caminho da feira';if(subtitle)subtitle.textContent='O entregador está indo buscar seu pedido.';if(detail)detail.textContent='Entregador a caminho da feira.';}
   else if(value==='searching'){if(heading)heading.textContent='Procurando entregador';if(subtitle)subtitle.textContent='Estamos buscando um entregador para seu pedido.';if(detail)detail.textContent='Procurando entregador.';}
   if(timeline){[...timeline.querySelectorAll('li')].forEach((step,i)=>{step.classList.toggle('done',index>=0&&i<index);step.classList.toggle('now',index>=0&&i===index);});}
   if(index===5){stop();container.hidden=true;}
  }
  async function refresh(){if(state.stopped||!container.isConnected||state.inFlight)return;state.inFlight=true;try{const data=await fetchTracking(String(container.dataset.orderId||''));syncStatus(data);if(!data||data.active===false){stop();status.textContent=data?.status==='delivered'?'Entrega concluída.':'Acompanhamento encerrado.';mapEl.hidden=true;driverCard.hidden=true;container.hidden=true;return;}if(!data.driver_assigned){status.textContent='Procurando entregador…';mapEl.hidden=true;driverCard.hidden=true;return;}await renderMap(data);}catch(_){if(options.admin){status.textContent='Acompanhamento indisponível no momento.';mapEl.hidden=true;driverCard.hidden=true;}else{stop();container.hidden=true;}}finally{state.inFlight=false;}}
  function start(){if(state.stopped||state.timer||document.visibilityState==='hidden'||!container.getClientRects().length)return;void refresh();state.timer=setInterval(()=>void refresh(),30000);}
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