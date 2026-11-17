(()=> {
 'use strict';
 const instances=new Map();
 let mapLibrePromise=null;
 const STYLE='https://tiles.openfreemap.org/styles/positron';
 function loadMapLibre(){
  if(window.maplibregl)return Promise.resolve(window.maplibregl);
  if(mapLibrePromise)return mapLibrePromise;
  mapLibrePromise=new Promise((resolve,reject)=>{
   if(!document.querySelector('link[data-feira-tracking-maplibre]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.css';link.dataset.feiraTrackingMaplibre='1';document.head.append(link);
   }
   const script=document.createElement('script');script.src='https://unpkg.com/maplibre-gl@5.6.2/dist/maplibre-gl.js';script.dataset.feiraTrackingMaplibre='1';
   script.onload=()=>window.maplibregl?resolve(window.maplibregl):reject(new Error('MAPLIBRE_UNAVAILABLE'));
   script.onerror=()=>{mapLibrePromise=null;reject(new Error('MAPLIBRE_UNAVAILABLE'));};document.head.append(script);
  });
  return mapLibrePromise;
 }
 function addStyles(){
  if(document.getElementById('feira-lalamove-map-style'))return;
  const style=document.createElement('style');style.id='feira-lalamove-map-style';
  style.textContent='.feira-lalamove-map{display:grid;gap:8px;margin:10px 0;min-width:0;width:100%}.feira-lalamove-map-canvas{height:230px;min-height:190px;width:100%;max-width:100%;border-radius:14px;overflow:hidden;background:#eef1ef;border:1px solid #dce4df;position:relative}.feira-lalamove-map-canvas[hidden]{display:none!important}.feira-lalamove-map-status{margin:0;font-size:12px;line-height:1.4;color:#365b45;font-weight:750;overflow-wrap:anywhere}.feira-lalamove-tracking-fallback{display:inline-flex;align-items:center;justify-content:center;min-height:38px;width:max-content;max-width:100%;padding:0 14px;border-radius:10px;background:#e9f3eb;color:#176b3a;font-size:12px;font-weight:850;text-decoration:none}.feira-lalamove-tracking-fallback[hidden]{display:none!important}.feira-lalamove-driver-info{display:flex;align-items:center;gap:9px;min-width:0;font-size:12px;line-height:1.35;color:#294a34}.feira-lalamove-driver-info img{width:38px;height:38px;object-fit:cover;border-radius:50%;flex:none}.feira-lalamove-driver-info strong{display:block;overflow-wrap:anywhere}.feira-lalamove-driver-info small{display:block;color:#607467;overflow-wrap:anywhere}.feira-map-pin{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border:2px solid #fff;border-radius:50%;background:#fff;box-shadow:0 2px 8px #0003;font-size:19px;line-height:1}.feira-map-pin.driver{width:42px;height:42px;font-size:25px;border:2px solid #fff;box-shadow:0 2px 10px #0004}.feira-lalamove-map .maplibregl-ctrl-attrib{font-size:9px}.feira-lalamove-map .maplibregl-ctrl-bottom-right{right:3px;bottom:2px}.feira-lalamove-map .maplibregl-ctrl-attrib.maplibregl-compact{min-height:18px}.feira-lalamove-map .maplibregl-canvas{outline:0}';
  document.head.append(style);
 }
 function point(value){
  const lat=Number(value?.lat),lng=Number(value?.lng);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180?{lat,lng}:null;
 }
 function safePhoto(value){
  try{const url=new URL(String(value||''));return url.protocol==='https:'?url.href:'';}catch{return '';}
 }
 function bearing(from,to){
  const rad=Math.PI/180,lat1=from.lat*rad,lat2=to.lat*rad,dLng=(to.lng-from.lng)*rad;
  const y=Math.sin(dLng)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
 }
 function makeMarkerElement(emoji,driver=false,label=''){
  const el=document.createElement('span');el.className='feira-map-pin'+(driver?' driver':'');el.textContent=emoji;el.setAttribute('role','img');el.setAttribute('aria-label',label);return el;
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
  const fallback=document.createElement('a');fallback.className='feira-lalamove-tracking-fallback';fallback.textContent='Abrir rastreio';fallback.target='_blank';fallback.rel='noopener noreferrer';fallback.hidden=true;
  root.append(status,canvas,driverInfo,fallback);container.replaceChildren(root);
  const state={container,root,status,canvas,driverInfo,orderId,fetchTracking,map:null,storeMarker:null,homeMarker:null,driverMarker:null,driverElement:null,routeSource:false,timer:null,observer:null,animation:0,stopped:false,refresh:null,lastDriverPoint:null};
  function stop(){if(state.timer){clearInterval(state.timer);state.timer=null;}if(state.animation)cancelAnimationFrame(state.animation);state.animation=0;}
  function destroy(){stop();state.stopped=true;if(state.observer)state.observer.disconnect();if(state.map){state.map.remove();state.map=null;}instances.delete(container);}
  function fitMap(driver,home,store){
   if(!state.map||!driver||!home)return;
   const lib=window.maplibregl,bounds=new lib.LngLatBounds();
   [driver,home,store].filter(Boolean).forEach(p=>bounds.extend([p.lng,p.lat]));
   state.map.fitBounds(bounds,{padding:{top:28,bottom:34,left:28,right:28},maxZoom:15,duration:0});
  }
  function animateDriver(target){
   if(!state.driverMarker||!state.lastDriverPoint){return;}
   if(state.animation)cancelAnimationFrame(state.animation);
   const from={...state.lastDriverPoint},to={...target},duration=Math.max(1000,Math.min(14500,Number(options.animationDurationMs)||14000));
   const heading=bearing(from,to);let start=0;
   const frame=now=>{
    if(!start)start=now;
    const t=Math.min(1,(now-start)/duration),ease=t*t*(3-2*t);
    const lat=from.lat+(to.lat-from.lat)*ease,lng=from.lng+(to.lng-from.lng)*ease;
    state.driverMarker.setLngLat([lng,lat]);state.driverMarker.setRotation(heading);
    if(t<1)state.animation=requestAnimationFrame(frame);else{state.animation=0;state.lastDriverPoint={...to};}
   };
   state.animation=requestAnimationFrame(frame);
  }
  function updateDriverInfo(driver,vehicle){
   driverInfo.replaceChildren();
   const photo=safePhoto(driver?.photo);
   if(photo){const img=document.createElement('img');img.src=photo;img.alt='Foto do entregador';img.loading='lazy';driverInfo.append(img);}
   const copy=document.createElement('div'),name=document.createElement('strong'),details=document.createElement('small');
   name.textContent=String(driver?.name||'Motorista da Lalamove');
   details.textContent=[vehicle==='CAR'?'Carro':'Moto',driver?.plateNumber?'Placa '+String(driver.plateNumber):''].filter(Boolean).join(' · ');
   copy.append(name,details);driverInfo.append(copy);driverInfo.hidden=false;
  }
  async function ensureMap(data){
   const lib=await loadMapLibre(),store=point(data.store),home=point(data.customer),driver=point(data.driver?.coordinates);
   if(!store||!home)throw new Error('COORDINATES_UNAVAILABLE');
   canvas.hidden=false;
   if(!state.map){
    state.map=new lib.Map({container:canvas,style:STYLE,center:[(store.lng+home.lng)/2,(store.lat+home.lat)/2],zoom:12,attributionControl:false,dragRotate:false,pitchWithRotate:false});
    if(lib.AttributionControl)state.map.addControl(new lib.AttributionControl({compact:true,customAttribution:'© OpenFreeMap · © OpenStreetMap contributors'}),'bottom-right');
    await new Promise((resolve,reject)=>{
     if(state.map.loaded?.()){resolve();return;}
     state.map.once('load',resolve);state.map.once('error',event=>reject(event?.error||new Error('MAP_STYLE_FAILED')));
    });
    state.storeMarker=new lib.Marker({element:makeMarkerElement('🏪',false,'Loja Feira On'),anchor:'center'}).setLngLat([store.lng,store.lat]).addTo(state.map);
    state.homeMarker=new lib.Marker({element:makeMarkerElement('🏠',false,'Endereço do cliente'),anchor:'center'}).setLngLat([home.lng,home.lat]).addTo(state.map);
    if(driver){state.driverElement=makeMarkerElement(data.vehicle==='CAR'?'🚗':'🛵',true,'Veículo do entregador');state.driverMarker=new lib.Marker({element:state.driverElement,anchor:'center',rotationAlignment:'map',pitchAlignment:'map'}).setLngLat([driver.lng,driver.lat]).setRotation(0).addTo(state.map);state.lastDriverPoint={...driver};}
    state.map.addSource('feira-delivery-route',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[store.lng,store.lat],[home.lng,home.lat]]}}});
    state.map.addLayer({id:'feira-delivery-route-line',type:'line',source:'feira-delivery-route',paint:{'line-color':'#398451','line-width':3,'line-opacity':0.55,'line-dasharray':[2,2]}});
    fitMap(driver||home,home,store);
    setTimeout(()=>{if(state.map){state.map.resize();fitMap(driver||home,home,store);}},120);
   }else{
    state.storeMarker?.setLngLat([store.lng,store.lat]);state.homeMarker?.setLngLat([home.lng,home.lat]);
    const source=state.map.getSource?.('feira-delivery-route');
    source?.setData({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[store.lng,store.lat],[home.lng,home.lat]]}});
    if(state.driverElement)state.driverElement.textContent=data.vehicle==='CAR'?'🚗':'🛵';
    if(driver){
     if(!state.driverMarker){state.driverElement=makeMarkerElement(data.vehicle==='CAR'?'🚗':'🛵',true,'Veículo do entregador');state.driverMarker=new lib.Marker({element:state.driverElement,anchor:'center',rotationAlignment:'map',pitchAlignment:'map'}).setLngLat([driver.lng,driver.lat]).setRotation(0).addTo(state.map);state.lastDriverPoint={...driver};fitMap(driver,home,store);}
     else animateDriver(driver);
    }
   }
   if(driver){
    updateDriverInfo(data.driver,data.vehicle);
    status.textContent=data.status==='picked_up'?'Motorista a caminho do seu endereço.':'Motorista a caminho da loja.';
   }else{
    status.textContent='Motorista atribuído. Aguardando a primeira posição compartilhada pela Lalamove…';
    if(data.driver&&(data.driver.name||data.driver.plateNumber))updateDriverInfo(data.driver,data.vehicle);
   }
  }
  function syncOrderUI(data){
   const value=String(data?.status||''),card=container.closest('.order-card');
   const statusLabel=container.closest('.lalamove-admin')?.querySelector('[data-lalamove-status-label]');
   const labels={searching:'Procurando motorista',assigned:'A caminho',enroute_pickup:'A caminho',picked_up:'Coletado',delivered:'Entregue',cancelled:'Entrega cancelada',rejected:'Entrega recusada',expired:'Nenhum motorista aceitou — chame de novo'};
   if(statusLabel&&labels[value])statusLabel.textContent=labels[value];
   const terminal=['cancelled','rejected','expired'].includes(value);
   if(terminal||value==='delivered'){const section=container.closest('.customer-lalamove-tracking');if(section)section.hidden=true;container.hidden=true;}
   if(!card)return;
   const heading=card.querySelector('.order-status-top b'),subtitle=card.querySelector('.order-subtitle'),timeline=card.querySelector('.order-timeline');
   if(!timeline)return;
   const detail=timeline.querySelector('.order-timeline-detail'),index=value==='delivered'?3:value==='picked_up'||value==='assigned'||value==='enroute_pickup'?2:value==='searching'?1:-1;
   timeline.classList.toggle('is-terminal',terminal);
   [...timeline.querySelectorAll('li')].forEach((step,i)=>{step.classList.toggle('done',!terminal&&index>=0&&i<index);step.classList.toggle('now',!terminal&&index>=0&&i===index);});
   if(value==='searching'){if(heading)heading.textContent='Preparando seu pedido';if(subtitle)subtitle.textContent='Procurando entregador…';if(detail)detail.textContent='Procurando entregador…';}
   else if(value==='assigned'||value==='enroute_pickup'){if(heading)heading.textContent='A caminho';if(subtitle)subtitle.textContent='O motorista está a caminho da loja.';if(detail)detail.textContent='Motorista a caminho da loja.';}
   else if(value==='picked_up'){const name=String(data.driver?.name||'O entregador');if(heading)heading.textContent='A caminho';if(subtitle)subtitle.textContent=name+' está levando seu pedido.';if(detail)detail.textContent=name+' está levando seu pedido.';}
   else if(value==='delivered'){if(heading)heading.textContent='Entregue';if(subtitle)subtitle.textContent='Seu pedido chegou.';if(detail)detail.textContent='Entrega concluída.';}
   else if(value==='expired'){if(heading)heading.textContent='Estamos chamando outro entregador';if(subtitle)subtitle.textContent='A solicitação anterior expirou.';if(detail)detail.textContent='A solicitação expirou. Estamos chamando outro entregador.';}
   else if(value==='cancelled'||value==='rejected'){if(heading)heading.textContent='Entrega cancelada';if(subtitle)subtitle.textContent='A entrega foi cancelada.';if(detail)detail.textContent='A entrega foi cancelada. Fale com a loja se precisar de ajuda.';}
  }
  async function refresh(){
   if(state.stopped||!container.isConnected||state.inFlight)return;
   state.inFlight=true;
   try{
    const data=await fetchTracking(orderId);syncOrderUI(data);
    const existingFallback=container.parentElement?.querySelector('.customer-tracking-fallback,.lalamove-tracking-link');
    if(data?.tracking_url){if(existingFallback){existingFallback.href=String(data.tracking_url);existingFallback.hidden=false;}else{fallback.href=String(data.tracking_url);fallback.hidden=false;}}
    if(!data||data.active===false){
     stop();status.textContent=data?.status==='delivered'?'Entrega concluída.':data?.status==='expired'?'A solicitação expirou.':data?.status==='cancelled'?'Entrega cancelada.':'O rastreio não está ativo neste momento.';
     if(state.map){state.map.remove();state.map=null;}canvas.hidden=true;driverInfo.hidden=true;container.hidden=true;return;
    }
    if(!data.driver_assigned){
     status.textContent='Procurando entregador…';canvas.hidden=true;driverInfo.hidden=true;
     if(state.map){state.map.remove();state.map=null;state.driverMarker=null;state.lastDriverPoint=null;}
     return;
    }
    await ensureMap(data);
   }catch(error){
    if(options.admin){status.textContent='Rastreio indisponível no momento. Atualize o status ou tente novamente.';canvas.hidden=true;driverInfo.hidden=true;}
    else{stop();if(state.map){state.map.remove();state.map=null;}container.hidden=true;}
   }finally{state.inFlight=false;}
  }
  function start(){if(state.stopped||state.timer||document.visibilityState==='hidden'||!container.getClientRects().length)return;void refresh();state.timer=setInterval(()=>void refresh(),Math.max(15000,Math.min(15000,Number(options.pollIntervalMs)||15000)));}
  function visibility(){if(document.visibilityState==='hidden'||!container.getClientRects().length)stop();else start();}
  state.refresh=refresh;state.destroy=destroy;
  if('IntersectionObserver'in window){state.observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))start();else stop();});state.observer.observe(container);}else start();
  document.addEventListener('visibilitychange',visibility);state.cleanupVisibility=()=>document.removeEventListener('visibilitychange',visibility);
  instances.set(container,state);return state;
 }
 const cleanupObserver=new MutationObserver(()=>{for(const [el,state] of instances){if(!el.isConnected){state.cleanupVisibility?.();state.destroy();}}});
 if(document.documentElement)cleanupObserver.observe(document.documentElement,{childList:true,subtree:true});
 window.addEventListener('pagehide',()=>{for(const state of instances.values()){state.cleanupVisibility?.();state.destroy();}});
 window.FeiraLalamoveMap={mount,destroy(container){const state=instances.get(container);if(state){state.cleanupVisibility?.();state.destroy();}},mountAll(selector,fetcher,options){document.querySelectorAll(selector||'[data-lalamove-map]').forEach(el=>mount(el,fetcher,options));}};
})();