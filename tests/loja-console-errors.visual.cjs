const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const htmlSource = fs.readFileSync(path.join(process.cwd(), "loja.html"), "utf8");
  const helperSource = fs.readFileSync(path.join(process.cwd(), "loja-delivery-ui.js"), "utf8").replace(/\bexport\s+/g, "");
  const bootstrap = "<script>" +
    "window.__testSupabase={" +
    "auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}," +
    "from:table=>{const q={select(){return q},eq(){return q},neq(){return q},in(){return q},order(){return q},limit(){return q},range(){return q},gte(){return q},lte(){return q},or(){return q},not(){return q},is(){return q},insert(){return q},update(){return q},delete(){return q},upsert(){return q},maybeSingle:async()=>({data:null,error:null}),single:async()=>({data:null,error:null}),then(ok,fail){return Promise.resolve({data:[],error:null}).then(ok,fail)}};return q;}," +
    "rpc:async()=>({data:false,error:null}),functions:{invoke:async()=>({data:{},error:null})}," +
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
    code = code.replace(/const supabase=createClient\([\s\S]*?\);\s*/, "const supabase=window.__testSupabase;\n");
    return "<script>" + code + "</script>";
  });
  html = html.replace("<body", bootstrap + "<script>" + helperSource + "</script><body");
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
      const runtimeErrors = [];
      page.on("pageerror", error => runtimeErrors.push("pageerror: " + error.message));
      page.on("console", message => { if (message.type() === "error") runtimeErrors.push("console.error: " + message.text()); });
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      if (runtimeErrors.length) throw new Error("Erros JS/console na loja " + width + "px:\n" + runtimeErrors.join("\n"));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log("Loja HTML completo: zero pageerror/console.error em 360px e 412px com Supabase mockado.");
})().catch(error => { console.error(error); process.exit(1); });
