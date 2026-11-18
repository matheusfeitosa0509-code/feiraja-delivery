const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const source=fs.readFileSync(path.join(__dirname,"../supabase/functions/_shared/commercial-calendar.js"),"utf8");
const cases=[
 ["19/11 22h -> 20/11 6h","2026-11-20T02:00:00.000Z","2026-11-20T10:00:00.000Z",false],
 ["20/11 11h30 -> 21/11 6h","2026-11-20T15:30:00.000Z","2026-11-21T10:00:00.000Z",false],
 ["24/12 12h -> 26/12 6h","2026-12-24T16:00:00.000Z","2026-12-26T10:00:00.000Z",false],
 ["31/12 12h -> 02/01 6h","2026-12-31T16:00:00.000Z","2027-01-02T10:00:00.000Z",false],
 ["sábado 14h -> segunda 6h","2026-11-14T18:00:00.000Z","2026-11-16T10:00:00.000Z",false]
];
(async()=>{
 const browser=await chromium.launch({headless:true});
 const errors=[];
 try{
  for(const width of [360,412]){
   const page=await browser.newPage({viewport:{width,height:820}});
   page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
   page.on("pageerror",e=>errors.push(e.message));
   await page.setContent('<main><h1>Calendário comercial</h1><p id="result"></p></main>');
   await page.addScriptTag({type:"module",content:source+"\nwindow.calendar={estaAberto,proximaAbertura};"});
   for(const [label,now,expected,expectedOpen] of cases){
    const actual=await page.evaluate(({now})=>({next:window.calendar.proximaAbertura(new Date(now))?.toISOString()||null,open:window.calendar.estaAberto(new Date(now))}),{now});
    assert.equal(actual.next,expected,width+"px "+label);
    assert.equal(actual.open,expectedOpen,width+"px "+label+" estado aberto/fechado");
   }
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log("holiday-calendar Playwright: 360px + 412px; 5 cenários; zero erros de console");
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
