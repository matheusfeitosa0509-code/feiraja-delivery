const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const htmlSource = fs.readFileSync(path.join(process.cwd(), "loja.html"), "utf8");
  const panelHtmlSource = fs.readFileSync(path.join(process.cwd(), "painel.html"), "utf8");
  const helperSource = fs.readFileSync(path.join(process.cwd(), "loja-delivery-ui.js"), "utf8").replace(/\bexport\s+/g, "");
  const calendarSource = fs.readFileSync(path.join(process.cwd(), "supabase/functions/_shared/commercial-calendar.js"), "utf8").replace(/\bexport\s+/g, "");
  const scheduleSource = fs.readFileSync(path.join(process.cwd(), "supabase/functions/_shared/store-schedule.js"), "utf8").replace(/^import .*commercial-calendar\.js.*;\s*/m, "").replace(/\bexport\s+/g, "");
  const bannerRows = [{"id":"b1","title":"Oferta de teste","subtitle":"Subtítulo da oferta","button_text":"Montar pedido","action_type":"products","action_value":null,"theme":"green","audience":"new_customers","starts_at":"2026-01-01T00:00:00Z","ends_at":"DYNAMIC_4_DAYS","rules_text":"Regras de teste","is_active":true,"sort_order":1,"promo_code":"PRIMEIRA_ENTREGA","image_url":"https://example.test/banner-1.webp"},{"id":"b2","title":"Assistente","subtitle":"Ajuda por voz ou texto","button_text":"Abrir assistente","action_type":"assistant","theme":"yellow","audience":"all","starts_at":"2026-01-01T00:00:00Z","ends_at":null,"is_active":true,"sort_order":2,"promo_code":null,"image_url":"https://example.test/banner-2.webp"},{"id":"b3","title":"Pedir produto","subtitle":"Envie o nome","button_text":"Pedir","action_type":"request_product","theme":"orange","audience":"all","starts_at":"2026-01-01T00:00:00Z","ends_at":null,"is_active":true,"sort_order":3,"promo_code":null},{"id":"b4","title":"Retire na feira","subtitle":"Av. Lourenço da Silva Braga, 700","button_text":"Como chegar","action_type":"maps","theme":"red","audience":"all","starts_at":"2026-01-01T00:00:00Z","ends_at":null,"is_active":true,"sort_order":4,"promo_code":null}];
  const bootstrap = "<script>" +
    "window.__testBannerRows=" + JSON.stringify(bannerRows.map(row=>({...row,ends_at:row.ends_at==="DYNAMIC_4_DAYS"?new Date(Date.now()+4*86400000).toISOString():row.ends_at}))) + ";window.__testSupabase={" +
    "auth:{getSession:async()=>({data:{session:window.__testSession||null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}," +
    "from:table=>{const q={select(){return q},eq(){return q},neq(){return q},in(){return q},order(){return q},limit(){return q},range(){return q},gte(){return q},lte(){return q},or(){return q},not(){return q},is(){return q},insert(){return q},update(){return q},delete(){return q},upsert(){return q},maybeSingle:async()=>({data:null,error:null}),single:async()=>({data:null,error:null}),then(ok,fail){return Promise.resolve({data:table===\"store_banners\"?window.__testBannerRows:table===\"orders\"?(window.__testOrders||[]):[],error:null}).then(ok,fail)}};return q;}," +
    "rpc:async()=>({data:{enabled:window.__testPromoEnabled!==false,min_subtotal:50,ends_at:\"2026-12-31T23:59:00-04:00\"},error:null}),functions:{invoke:async()=>({data:{},error:null})}," +
    "storage:{from:()=>({upload:async()=>({data:{},error:null}),remove:async()=>({data:[],error:null}),getPublicUrl:()=>({data:{publicUrl:''}})})}," +
    "channel:()=>({on(){return this},subscribe(){return this}}),removeChannel:async()=>({})" +
    "};window.FeiraTurnstile={create:()=>({init(){},getToken:()=>'',reset(){}})};" +
    "window.FeiraLalamoveMap={mountAll(){}};" +
    "</script>";
  let html = htmlSource
    .replace(/<script>[\s\S]*?serviceWorker\.register[\s\S]*?<\/script>/i, "")
    .replace(/<link rel="manifest"[^>]*>/gi, "")
    .replace(/<link rel="preconnect"[^>]*>/gi, "")
    .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/gi, "")
    .replace(/<script src="\.\/turnstile\.js" defer><\/script>/i, "")
    .replace(/<script src="\.\/lalamove-map\.js"><\/script>/i, "");
  html = html.replace(/<script type="module">([\s\S]*?)<\/script>/i, (_all, code) => {
    code = code.replace(/^\s*import\s*\{\s*createClient\s*\}\s*from\s*['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2\.117\.1['"];\s*/m, "");
    code = code.replace(/^\s*import\s*\{[^}]+\}\s*from\s*['"]\.\/loja-delivery-ui\.js[^'"]*['"];\s*/m, "");
    code = code.replace(/^\s*import\s*\{\s*getStoreSchedule\s*\}\s*from\s*['"]\.\/supabase\/functions\/_shared\/store-schedule\.js[^'"]*['"];\s*/m, "");
    code = code.replace(/^\s*import\s*\{\s*getCommercialSchedule\s*\}\s*from\s*['"]\.\/supabase\/functions\/_shared\/commercial-calendar\.js[^'"]*['"];\s*/m, "");
    code = code.replace(/const supabase=createClient\([\s\S]*?\);\s*/, "const supabase=window.__testSupabase;\n");
    return "<script>" + code + "</script>";
  });
  html = html.replace("<body", bootstrap + "<script>" + calendarSource + "</script><script>" + scheduleSource + "</script><script>" + helperSource + "</script><body");
  const browser = await chromium.launch({ headless: true });
  try {
    fs.mkdirSync(path.join(process.cwd(), "artifacts"), { recursive: true });
    for (const width of [360, 412, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
      const runtimeErrors = [];
      await page.addInitScript(() => { try { localStorage.setItem("feira_cookie_consent_v1","accepted"); } catch (_) {} });
      page.on("pageerror", error => runtimeErrors.push("pageerror: " + error.message));
      page.on("console", message => { if (message.type() === "error") runtimeErrors.push("console.error: " + message.text()); });
      await page.route("**/*", route => route.fulfill({ status: 200, body: "" }));
      await page.route("**/rest/v1/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
      await page.route("**/functions/v1/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      await page.route("http://127.0.0.1/loja.html", route => route.fulfill({ status: 200, contentType: "text/html", body: html }));
      await page.goto("http://127.0.0.1/loja.html", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelectorAll("#storeBannersTrack .store-banner-slide").length === 4, null, { timeout: 10000 });
      const banners = page.locator("#storeBannersTrack .store-banner-slide");
      if (await banners.count() !== 4) throw new Error("Carrossel deve renderizar os quatro banners retornados.");
      const bannerImages = page.locator("#storeBannersTrack .store-banner-image");
      if (await bannerImages.count() !== 2) throw new Error("Somente banners com image_url devem renderizar imagem.");
      if (await bannerImages.nth(0).getAttribute("loading") !== "eager" || await bannerImages.nth(0).getAttribute("width") !== "1200" || await bannerImages.nth(0).getAttribute("height") !== "400") throw new Error("Primeira imagem deve carregar eager com dimensões 1200×400.");
      if (await bannerImages.nth(1).getAttribute("loading") !== "lazy") throw new Error("Imagens seguintes devem usar loading=lazy.");
      const desktopImagePlacement = await banners.first().evaluate(el => { const img=el.querySelector(".store-banner-image").getBoundingClientRect(); const copy=el.querySelector(".store-banner-copy").getBoundingClientRect(); return {imageLeft:img.left,copyRight:copy.right}; });
      if (width >= 700 && desktopImagePlacement.imageLeft <= desktopImagePlacement.copyRight - 12) throw new Error("No desktop a imagem deve ficar à direita do texto.");
      await page.screenshot({ path: path.join(process.cwd(), "artifacts", "store-banners-" + width + ".png"), fullPage: false });
      await page.evaluate(async () => { window.__testBannerRows=window.__testBannerRows.map(({image_url,...row})=>row); await window.loadStoreBanners(); });
      if (await page.locator("#storeBannersTrack .store-banner-slide").count() !== 4 || await page.locator("#storeBannersTrack .store-banner-image").count() !== 0) throw new Error("Os quatro banners sem image_url devem continuar como banners somente texto.");
      const textOnlyMinHeight = await page.locator("#storeBannersTrack .store-banner-slide").first().evaluate(el => getComputedStyle(el).minHeight);
      if (textOnlyMinHeight !== "142px") throw new Error("Banners sem imagem devem manter a altura mínima original de 142px.");
      if (!(await banners.nth(0).evaluate(el=>el.classList.contains("has-image"))) || await banners.nth(2).locator(".store-banner-image").count()) throw new Error("Banner com imagem e banner só texto não foram preservados.");
      for (const [index, theme] of ["green","yellow","orange","red"].entries()) { if (!(await banners.nth(index).evaluate((el, expectedTheme) => el.classList.contains("theme-"+expectedTheme), theme))) throw new Error("Tema "+theme+" não aplicado."); }
      if (await page.locator("#storeBannersDots button").count() !== 4) throw new Error("Carrossel com múltiplos banners deve exibir bolinhas.");
      if (!(await page.locator("#storeBannersTrack").innerText()).includes("Termina em 4 dias!")) throw new Error("Contagem regressiva de até sete dias ausente.");
      const order = await page.evaluate(() => ["#storeBannersCarousel",".home-info-strip","#homeBubbles","#homeProductSections"].map(selector => document.querySelector(selector)?.getBoundingClientRect().top ?? -1));
      if (!(order[0] < order[1] && order[1] < order[2] && order[2] < order[3])) throw new Error("Ordem visual incorreta: "+order.join(","));
      await page.locator(".store-banner-rules-link").first().click();
      if (!(await page.locator("#storeBannerRulesSheet").evaluate(el => el.classList.contains("open")))) throw new Error("Bottom sheet de regras não abriu.");
      if (!(await page.locator("#storeBannerRulesText").innerText()).includes("Regras de teste")) throw new Error("Texto das regras não foi exibido.");
      await page.locator("#storeBannerRulesClose").click();
      if (await page.locator("#storeBannerRulesSheet").evaluate(el => el.classList.contains("open"))) throw new Error("Bottom sheet não fechou.");
      await page.evaluate(() => { window.__bannerScrollTarget = false; document.getElementById("homeProductSections").scrollIntoView = () => { window.__bannerScrollTarget = true; }; });
      await banners.first().locator(".store-banner-cta").click();
      if (!(await page.evaluate(() => window.__bannerScrollTarget))) throw new Error("Ação products não rolou até os produtos.");
      if (await page.locator("#homeBanners").count()) throw new Error("Carrossel Destaques antigo ainda existe.");
      if (await page.locator("#firstDeliveryPromoBanner").count()) throw new Error("Banner fixo antigo ainda existe.");
      await page.evaluate(async () => { window.__testSession={user:{id:"returning-customer"}}; window.__testOrders=[{status:"Pagamento Confirmado",payment_method:"Pix",is_test_order:false}]; await window.loadStoreBanners(); });
      if (await page.locator("#storeBannersTrack .store-banner-slide").count() !== 3) throw new Error("Cliente com pedido pago deve ver returning + all, sem new_customers.");
      await page.evaluate(async () => { window.__testOrders=[]; await window.loadStoreBanners(); });
      if (await page.locator("#storeBannersTrack .store-banner-slide").count() !== 4) throw new Error("Cliente sem pedido pago deve ver new_customers + all.");
      await page.evaluate(async () => { window.__testPromoEnabled=false; await window.loadFirstDeliveryPromoOffer(); });
      if (await page.locator("#storeBannersTrack .store-banner-slide").count() !== 3) throw new Error("Banner com promo_code deve sumir quando a promoção estiver desligada.");
      if (runtimeErrors.length) throw new Error("Erros JS/console na loja "+width+"px: "+runtimeErrors.join(" | "));
      if (runtimeErrors.length) throw new Error("Erros JS/console na loja " + width + "px:\n" + runtimeErrors.join("\n"));
      await page.close();
    }
    const panelManagerScript = panelHtmlSource.split('<script type="module">').map(part=>part.split('</script>')[0]).find(part=>part.includes('storeBannerNew')&&part.includes('storeBannerForm'));
    const imagePreparer = panelManagerScript?.match(/async function prepareBannerImage\\(file\\)\\{[\\s\\S]*?\\n \\}/);
    const imageUploader = panelManagerScript?.match(/async function uploadBannerImage\\(blob\\)\\{[\\s\\S]*?\\n \\}/);
    if (!imagePreparer || !imageUploader) throw new Error("Helpers de WebP/upload não encontrados no painel.");
    const uploadPage = await browser.newPage();
    await uploadPage.setContent("<!doctype html><html><body></body></html>");
    await uploadPage.addScriptTag({content:"window.prepareBannerImage = "+imagePreparer[0]+"; window.uploadBannerImage = "+imageUploader[0]+";"});
    const imageResult = await uploadPage.evaluate(async()=>{
      const source=document.createElement("canvas");source.width=1600;source.height=900;
      const ctx=source.getContext("2d");const gradient=ctx.createLinearGradient(0,0,1600,900);gradient.addColorStop(0,"#1f7a36");gradient.addColorStop(1,"#f0bf36");ctx.fillStyle=gradient;ctx.fillRect(0,0,1600,900);
      const png=await new Promise(resolve=>source.toBlob(resolve,"image/png"));
      const webp=await window.prepareBannerImage(new File([png],"banner-test.png",{type:"image/png"}));
      const bitmap=await createImageBitmap(webp);
      window.__preparedBannerBlob=webp;
      window.db={storage:{from:bucket=>({upload:async(path,blob,options)=>{window.__uploadCheck={bucket,path,size:blob.size,type:blob.type,options};return {error:null};},getPublicUrl:path=>({data:{publicUrl:"https://juhwdevvwstmyxyyagzh.supabase.co/storage/v1/object/public/product-photos/"+path}}),remove:async()=>({error:null})})}};
      const url=await window.uploadBannerImage(webp);
      const result={type:webp.type,size:webp.size,width:bitmap.width,height:bitmap.height,url,upload:window.__uploadCheck};
      bitmap.close();return result;
    });
    if (imageResult.type!=="image/webp" || imageResult.size>80*1024 || imageResult.width!==1200 || imageResult.height!==400) throw new Error("Conversão WebP não respeitou formato, limite de 80 KB ou dimensão 1200×400: "+JSON.stringify(imageResult));
    if (imageResult.upload.bucket!=="product-photos" || !imageResult.upload.path.startsWith("banners/") || imageResult.upload.type!=="image/webp" || imageResult.upload.options.contentType!=="image/webp") throw new Error("Upload não usou o bucket product-photos com MIME WebP.");
    await uploadPage.close();
  } finally {
    await browser.close();
  }
  console.log("Loja HTML completo: zero pageerror/console.error em 360px, 412px e 1280px com Supabase mockado; screenshots em artifacts/.");
})().catch(error => { console.error(error); process.exit(1); });
