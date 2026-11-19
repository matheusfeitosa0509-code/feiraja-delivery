/* Build 2026-11-18-storefront-static-cache-v1. HTML e APIs permanecem sempre na rede. */
const STATIC_CACHE='feira-static-v20261118-2';
const STATIC_ORIGINS=new Set([self.location.origin,'https://fonts.googleapis.com','https://fonts.gstatic.com','https://unpkg.com']);
const STATIC_ASSET=/\.(?:js|css|mjs|woff2?|ttf|otf|svg|png|jpe?g|webp|ico)(?:\?.*)?$/i;
self.addEventListener('fetch',function(event){
 const request=event.request;
 if(request.method!=='GET'||request.mode==='navigate')return;
 const url=new URL(request.url);
 const isGoogleFontCss=url.origin==='https://fonts.googleapis.com'&&url.pathname.startsWith('/css');
 if(!STATIC_ORIGINS.has(url.origin)||(!STATIC_ASSET.test(url.pathname+url.search)&&!isGoogleFontCss))return;
 const cachePromise=caches.open(STATIC_CACHE);
 const networkPromise=cachePromise.then(async cache=>{
  const response=await fetch(request);
  if(response&&(response.ok||response.type==='opaque')){try{await cache.put(request,response.clone());}catch(_){}}
  return response;
 });
 event.waitUntil(networkPromise.then(()=>undefined).catch(()=>undefined));
 event.respondWith(cachePromise.then(async cache=>{
  const cached=await cache.match(request);
  return cached||networkPromise;
 }));
});
self.addEventListener('install', function (event) {
  event.waitUntil((async()=>{const names=await caches.keys();await Promise.all(names.filter(name=>name.startsWith('feira-static-')&&name!==STATIC_CACHE).map(name=>caches.delete(name)));await self.skipWaiting();})());
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});


self.addEventListener('push', function (event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const requestedUrl = payload && payload.url;
  const safeCustomerUrl = typeof requestedUrl === 'string' && /^\.\/loja\.html\?pedido=[A-Za-z0-9_%.-]{1,384}(?:#[A-Za-z0-9_-]+)?$/.test(requestedUrl);
  const targetUrl = requestedUrl === '/painel.html' ? '/painel.html' : safeCustomerUrl ? requestedUrl : '/loja.html';
  const body = typeof payload.body === 'string' && payload.body.trim()
    ? payload.body.trim()
    : 'Você tem uma atualização.';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'feira-on-delivery';
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : 'Feira On Delivery';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      tag: tag,
      icon: './icons/icon-192.png',
      data: { url: targetUrl }
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const requestedUrl = event.notification && event.notification.data
    ? event.notification.data.url
    : '/loja.html';
  const safeCustomerUrl = typeof requestedUrl === 'string' && /^\.\/loja\.html\?pedido=[A-Za-z0-9_%.-]{1,384}(?:#[A-Za-z0-9_-]+)?$/.test(requestedUrl);
  const targetUrl = requestedUrl === '/painel.html' ? '/painel.html' : safeCustomerUrl ? requestedUrl : '/loja.html';
  const absoluteTarget = new URL(targetUrl, self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (const client of windowClients) {
        if (client.url === absoluteTarget) {
          return client.focus();
        }
      }
      return self.clients.openWindow(absoluteTarget);
    })
  );
});
