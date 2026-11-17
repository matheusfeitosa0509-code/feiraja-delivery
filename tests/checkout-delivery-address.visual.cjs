const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const storeHtml = fs.readFileSync(path.join(root, 'loja.html'), 'utf8');
const helperSource = fs.readFileSync(path.join(root, 'loja-delivery-ui.js'), 'utf8').replace(/^export\s+/gm, '');
const addressFnStart = storeHtml.indexOf('function hideDeliverySuggestions(){');
const syncPresentationStart = storeHtml.indexOf('function syncDeliveryAddressPresentation(');
const syncPresentationEnd = storeHtml.indexOf('\nlet deliveryPlacesSessionToken', syncPresentationStart);
const mapFnStart = storeHtml.indexOf('function loadMapLibre(){');
const mapFnEnd = storeHtml.indexOf('function setDeliveryQuoteStatus', mapFnStart);
const quoteFnStart = storeHtml.indexOf('async function requestDeliveryQuote(){');
const quoteFnEnd = storeHtml.indexOf('function syncDeliverySelection(){', quoteFnStart);
if ([addressFnStart, syncPresentationStart, syncPresentationEnd, mapFnStart, mapFnEnd, quoteFnStart, quoteFnEnd].some(x => x < 0)) throw new Error('Delivery map functions not found');
const syncPresentationFn = storeHtml.slice(syncPresentationStart, syncPresentationEnd);
const addressFns = storeHtml.slice(addressFnStart, mapFnStart);
const mapFns = storeHtml.slice(mapFnStart, mapFnEnd);
const quoteFns = storeHtml.slice(quoteFnStart, quoteFnEnd);
const mapStyleStart = storeHtml.lastIndexOf('<style>', storeHtml.indexOf('.delivery-map-fullscreen{'));
const mapStyleEnd = storeHtml.indexOf('</style>', mapStyleStart);
const mapCss = storeHtml.slice(mapStyleStart + 7, mapStyleEnd);

for (const required of [
  'https://tiles.openfreemap.org/styles/positron', 'zoom:17', 'new lib.AttributionControl({compact:true})',
  'id="deliveryMapFullscreen"', 'id="deliveryMapFixedPin"', 'id="deliveryMapConfirm"',
  'id="deliveryMapPreview"', 'Endereço confirmado no mapa', 'deliveryNeedsExplicitConfirm)return;',
  'deliveryMapReversePromise=new Promise', 'await deliveryMapReversePromise', 'id="deliveryMapGps"',
]) assert.ok(storeHtml.includes(required), 'missing MapLibre delivery behavior: ' + required);
for (const removed of ['id="deliveryMapFallback"', 'id="deliveryMapPanel"', 'id="deliveryMapUse"', 'id="deliveryConfirmAddress"', 'loadLeaflet()', 'L.tileLayer']) {
  assert.ok(!storeHtml.includes(removed), 'legacy embedded map remains: ' + removed);
}
assert.ok(storeHtml.includes('places.googleapis.com') === false, 'Places API key must remain server-side');
assert.ok(helperSource.includes('deliveryQuoteErrorMessage'));

const harness = `
const $ = selector => document.querySelector(selector);
let deliveryPlacesSessionToken='session-123',deliveryAutocompleteTimer=null,deliveryMap=null,deliveryMapCoordinates=null,deliveryMapReverseTimer=null,deliveryMapReverseSequence=0,deliveryMapReversePromise=Promise.resolve(),deliveryMapReverseError='',deliveryAddressManualEdits={street:false,number:false,neighborhood:false},deliveryQuoteTimeoutMs=80,deliveryNeedsExplicitConfirm=true,deliveryStreetHome=null,deliveryNumberHome=null,deliveryNeighborhoodHome=null,deliveryMapPlaceName='',deliveryQuoteTimer=null,deliveryQuoteSequence=0,deliveryQuote=null;
const deliveryQuoteCache=new Map();
const normalizeDeliveryAddress = value => ({street:String(value.street||'').trim(),number:String(value.number||'').trim(),neighborhood:String(value.neighborhood||'').trim(),complement:'',reference:''});
const getDeliveryAddress = () => normalizeDeliveryAddress({street:$('#deliveryStreet').value,number:$('#deliveryNumber').value,neighborhood:$('#deliveryNeighborhood').value});
let quoteCalls=0,quoteMode='success';
const currentUser=null;
const totals=()=>({sub:39.96,items:[{p:{id:'banana'},q:1}]});
const buildDeliveryQuoteItems=()=>[{product_id:'banana',quantity:1}];
const isValidDeliveryQuote=quote=>!!quote&&['MOTO','CAR'].includes(quote.vehicle)&&Number(quote.fee)>0&&Date.parse(quote.valid_until)>Date.now();
const deliveryQuoteLabel=(vehicle,fee)=>'Entrega de '+vehicle+': '+fee;
const deliveryQuoteErrorMessage=()=> 'Entrega indisponível no momento.';
const isDeliveryOutOfArea=()=>false;
const money=value=>'R$ '+Number(value).toFixed(2);
const saveDeliveryAddress=async()=>{};
const updateCheckoutTotals=()=>{const valid=isValidDeliveryQuote(deliveryQuote);$('#submitOrder').disabled=!valid;$('#submitOrder').textContent=valid?'Pagar com Pix · R$ 39,96':'Aguardando cálculo da entrega';};
const setDeliveryQuoteStatus=(message,isError=false,showRetry=false)=>{const box=$('#deliveryQuoteStatus');box.textContent=message||'';box.hidden=!message;box.dataset.error=String(!!isError);if(showRetry){const button=document.createElement('button');button.type='button';button.textContent='Tentar de novo';button.id='retryDeliveryQuote';button.addEventListener('click',()=>void requestDeliveryQuote());box.append(button);}};
const supabase={functions:{invoke:async(name,{body})=>{
 if(name==='delivery-quote'){quoteCalls++;if(quoteMode==='timeout')return await new Promise(()=>{});return {data:{vehicle:'MOTO',fee:9,valid_until:new Date(Date.now()+60000).toISOString()},error:null};}
 if(name!=='delivery-address')throw new Error('unexpected function '+name);
 if(body.action==='autocomplete')return {data:{suggestions:[{place_id:'place-test-123',description:'Mercado Teste, Centro, Manaus - AM'}]},error:null};
 if(body.action==='details')return {data:{address:{street:'Rua do Mercado',number:'123',neighborhood:'Centro',lat:'-3.10',lng:'-60.02',reference:'Mercado Teste'}},error:null};
 if(body.action==='reverse')return {data:{address:{street:'Rua do Mercado',number:'123',neighborhood:'Centro',lat:String(body.lat),lng:String(body.lng)}},error:null};
 throw new Error('unexpected action '+body.action);
}}};
window.maplibregl={
 Map:class{
  constructor(options){this.options=options;this.center={lng:options.center[0],lat:options.center[1]};this.events={};this.canvas=document.createElement('canvas');this.canvas.width=240;this.canvas.height=160;window.testMap=this;setTimeout(()=>this.fire('load'),0);}
  addControl(){} on(name,fn){(this.events[name]??=[]).push(fn);return this;} once(name,fn){this.events[name]??=[];this.events[name].push((...args)=>{this.events[name]=this.events[name].filter(x=>x!==fn);fn(...args);});return this;}
  fire(name){for(const fn of [...(this.events[name]||[])])fn({type:name});}
  getCenter(){return {lng:this.center.lng,lat:this.center.lat};} jumpTo(options){this.center={lng:options.center[0],lat:options.center[1]};this.fire('moveend');}
  resize(){} getCanvas(){return this.canvas;}
 },
 NavigationControl:class{},AttributionControl:class{}
};
const mapOverlayMarkup = '<div id="checkout"><button id="submitOrder" disabled>Aguardando cálculo da entrega</button><div id="minimumCheckoutNotice" class="hidden"></div><div id="checkoutProductsTotal"></div><div id="checkoutSummaryTotal"></div><div id="checkoutDeliveryTotal"></div><div id="checkoutDeliveryLabel"></div><div id="checkoutDeliveryMeta"></div><div id="modalTotal"></div><div id="deliveryAddressFields"><div id="deliveryStreetSearch"><label for="deliveryStreet">Rua</label><div class="checkout-address-input"><input id="deliveryStreet"></div><div id="deliveryStreetSuggestions" hidden></div></div><div id="deliveryAddressSummary" hidden><strong id="deliveryAddressSummaryStreet"></strong><span id="deliveryAddressSummaryNeighborhood"></span></div><div id="deliveryNumberField" class="field"><label for="deliveryNumber">Número</label><input id="deliveryNumber"></div><div id="deliveryNeighborhoodField" class="field"><label for="deliveryNeighborhood">Bairro</label><input id="deliveryNeighborhood"></div><input id="deliveryReference"></div><div id="deliveryMapPreview" hidden><img id="deliveryMapPreviewImage"><small id="deliveryMapPreviewAddress"></small></div><div id="deliveryMapFullscreen" class="delivery-map-fullscreen" hidden><header class="delivery-map-topbar"><button id="deliveryMapBack"></button><div id="deliveryMapSearchSlot"></div></header><div id="deliveryMap"></div><div class="delivery-map-fixed-pin"><span>📍</span><i></i></div><button id="deliveryMapGps" class="delivery-map-gps"></button><section class="delivery-map-sheet"><div class="delivery-map-sheet-handle"></div><strong id="deliveryMapAddress"></strong><div id="deliveryMapNumberSlot"></div><div id="deliveryMapNeighborhoodSlot"></div><p id="deliveryMapNeighborhood" class="delivery-map-neighborhood"></p><button id="deliveryMapConfirm" class="delivery-map-confirm"></button></section></div><button id="deliveryMapAdjust"></button><button id="deliveryMapChange"></button><button id="deliveryUseGps"></button><select id="delivery"><option value="delivery" selected>Entrega</option></select><p id="deliveryQuoteStatus"></p></div>';
document.body.innerHTML=mapOverlayMarkup;
`;
(async () => {
 const browser=await chromium.launch({headless:true});
 try {
  for (const width of [360,412]) {
   const page=await browser.newPage({viewport:{width,height:780}});
   const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}.hidden{display:none!important}body{margin:0;font:14px Arial}#deliveryMapFullscreen{position:fixed;inset:0;overflow:hidden;background:#eee}#deliveryMapFullscreen[hidden]{display:none}#deliveryMap{position:absolute;inset:0;width:100%;height:100%}.delivery-map-topbar{position:absolute;top:10px;left:10px;right:10px;display:flex}.delivery-map-sheet{position:absolute;bottom:0;left:0;right:0;background:white;border-radius:24px 24px 0 0;padding:16px}.delivery-map-fixed-pin{position:absolute;left:50%;top:50%;transform:translate(-50%,-100%)}.delivery-map-confirm{width:100%;min-height:54px}.delivery-map-gps{position:absolute;right:12px;bottom:220px}#deliveryStreetSearch,#deliveryNumberField{background:white;padding:8px}#deliveryStreetSuggestions{background:white}#deliveryStreetSuggestions button{display:block;width:100%;padding:12px}#deliveryQuoteStatus{overflow-wrap:anywhere}</style></head><body></body></html>');
   await page.addStyleTag({content:mapCss});
   await page.addScriptTag({content: `
    ${harness}
    ${syncPresentationFn}
    ${addressFns}
    ${mapFns}
    ${quoteFns}
    $('#deliveryStreetSuggestions').addEventListener('click',event=>{const button=event.target.closest('[data-place-id]');if(button)void chooseDeliveryPlace(button.dataset.placeId);});
    $('#deliveryMapBack').addEventListener('click',closeDeliveryMap);
    $('#deliveryMapConfirm').addEventListener('click',()=>void confirmDeliveryMapAddress());
    $('#deliveryMapGps').addEventListener('click',()=>void useDeliveryGps());
    $('#deliveryStreet').addEventListener('input',()=>deliveryAddressManualEdits.street=true);
    $('#deliveryNumber').addEventListener('input',()=>deliveryAddressManualEdits.number=true);
    $('#deliveryNeighborhood').addEventListener('input',()=>deliveryAddressManualEdits.neighborhood=true);
    window.startAutocomplete=async()=>{ $('#deliveryStreet').value='Mercado Teste';await requestDeliveryAutocomplete('Mercado Teste',deliveryPlacesSessionToken); };
    window.pickPlace=()=>chooseDeliveryPlace('place-test-123');
    window.dragMap=()=>{window.testMap.center={lat:-3.11,lng:-60.03};window.testMap.fire('dragstart');window.testMap.fire('moveend');window.testMap.fire('dragend');};
    window.confirmMap=confirmDeliveryMapAddress;
    window.runGps=useDeliveryGps;
    window.quoteCount=()=>quoteCalls;
    window.setQuoteMode=value=>{quoteMode=value;};
    window.runQuote=()=>{deliveryQuoteCache.clear();return requestDeliveryQuote();};
   `});
   await page.evaluate(()=>window.startAutocomplete());
   assert.equal(await page.locator('#deliveryStreetSuggestions button').count(),1,'establishment suggestion is shown');
   await page.evaluate(()=>window.pickPlace());
   await page.waitForFunction(()=>document.querySelector('#deliveryMapFullscreen').hidden===false);
   await page.waitForTimeout(850);
   assert.ok((await page.locator('#deliveryMapAddress').textContent()).includes('Mercado Teste'),'selected establishment name is displayed');
   const mapOptions=await page.evaluate(()=>({style:window.testMap.options.style,zoom:window.testMap.options.zoom,center:window.testMap.options.center}));
   assert.equal(mapOptions.style,'https://tiles.openfreemap.org/styles/positron');
   assert.equal(mapOptions.zoom,17);
   assert.deepEqual(mapOptions.center,[-60.02,-3.1]);
   await page.locator('#deliveryNumber').fill('130');
   await page.evaluate(()=>window.dragMap());
   await page.evaluate(()=>window.confirmMap());
   await page.waitForFunction(()=>document.querySelector('#deliveryMapFullscreen').hidden===true);
   await page.waitForTimeout(1550);
   assert.equal(await page.evaluate(()=>window.quoteCount()),1,'quote runs only after explicit confirmation');
   await page.waitForFunction(()=>document.querySelector('#submitOrder').disabled===false);
   assert.equal(await page.locator('#submitOrder').textContent(),'Pagar com Pix · R$ 39,96','Pix only unlocks after a positive live quote');
   await page.evaluate(()=>{window.setQuoteMode('timeout');window.runQuote();});
   await page.waitForFunction(()=>document.querySelector('#deliveryQuoteStatus').textContent.includes('mais de 15 segundos'));
   assert.equal(await page.locator('#submitOrder').isDisabled(),true,'timeout keeps Pix blocked');
   assert.equal(await page.locator('#submitOrder').textContent(),'Aguardando cálculo da entrega');
   assert.equal(await page.locator('#retryDeliveryQuote').textContent(),'Tentar de novo');
   await page.evaluate(()=>window.setQuoteMode('success'));
   await page.locator('#retryDeliveryQuote').click();
   await page.waitForFunction(()=>document.querySelector('#submitOrder').disabled===false);
   assert.equal(await page.evaluate(()=>window.quoteCount()),3,'retry requests a fresh quote');
   assert.equal(await page.locator('#deliveryStreet').inputValue(),'Rua do Mercado','reverse geocoding fills street before confirmation');
   assert.equal(await page.locator('#deliveryNumber').inputValue(),'130','reverse geocoding preserves the number typed by the customer');
   assert.equal(await page.locator('#deliveryNeighborhood').inputValue(),'Centro','reverse geocoding fills neighborhood before confirmation');
   assert.equal(await page.locator('#deliveryMapPreview').isVisible(),true,'confirmed map preview is shown');
   assert.equal(await page.locator('#deliveryMapPreviewAddress').textContent(),'Rua do Mercado · 130 · Centro','confirmed street, typed number and neighborhood remain visible');
   assert.equal(await page.locator('#deliveryAddressSummary').isVisible(),false,'duplicate edit summary is hidden after map confirmation');
   await page.evaluate(()=>{Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success,failure){failure(new Error('denied'));}}});window.runGps();});
   await page.waitForFunction(()=>document.querySelector('#deliveryQuoteStatus').textContent.includes('Não foi possível acessar o GPS'));
   await page.evaluate(()=>{Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(success){success({coords:{latitude:-3.12,longitude:-60.04}});}}});window.runGps();});
   await page.waitForFunction(()=>document.querySelector('#deliveryMapFullscreen').hidden===false);
   await page.waitForTimeout(850);
   const gpsPoint=await page.evaluate(()=>window.testMap.getCenter());
   assert.deepEqual(gpsPoint,{lng:-60.04,lat:-3.12});
   await page.evaluate(()=>window.confirmMap());
   await page.waitForTimeout(1550);
   assert.equal(await page.evaluate(()=>window.quoteCount()),4,'GPS point also requires confirmation and a fresh quote');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow at '+width+'px');
   assert.deepEqual(errors,[],'zero console/page errors at '+width+'px');
   await page.close();
  }
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
