import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const loja=readFileSync(resolve(here,'../../loja.html'),'utf8');
const start=loja.indexOf('async function fetchMyOrdersWithSeparationFallback(userId){');
const end=loja.indexOf('\nasync function loadMyOrders(knownUser){',start);
assert.notEqual(start,-1,'helper de fallback precisa existir em loja.html');
assert.notEqual(end,-1,'helper precisa terminar antes de loadMyOrders');
const helper=loja.slice(start,end);
assert.match(loja,/const separationStarted=!!o\.separation_started_at\|\|o\.separation_started_legacy===true;/);
assert.ok(loja.includes('Seu pedido já está sendo separado e não pode mais ser cancelado. Se precisar, fale com a loja.'));
assert.ok(loja.includes('Em separação'));

function mockSupabase(existing){
 const calls=[];
 const supabase={from(table){
  assert.equal(table,'orders');
  return {select(columns){
   calls.push(columns);
   const requested=columns.split(',').filter(c=>c.startsWith('separation_started_'));
   const missing=requested.find(column=>!existing.includes(column));
   return {eq(){return this;},order(){return this;},limit(){
    if(missing)return Promise.resolve({data:null,error:{code:'PGRST204',message:"Could not find the '"+missing+"' column in the schema cache"}});
    return Promise.resolve({data:[{id:'order-test'}],error:null});
   }};
  }};
 }};
 return {supabase,calls};
}
async function runCase(label,existing,expectedSelection,expectedAttempts){
 const {supabase,calls}=mockSupabase(existing);
 const fetchOrders=runInNewContext('('+helper+'); fetchMyOrdersWithSeparationFallback',{supabase});
 const result=await fetchOrders('user-test');
 assert.equal(result.error,null,label+': consulta deve concluir sem erro');
 assert.equal(result.data[0].id,'order-test',label+': deve retornar o pedido');
 assert.deepEqual(calls,expectedAttempts,label+': sequência de tentativas incorreta');
 assert.equal(calls.at(-1),expectedSelection,label+': seleção final incorreta');
 console.log('PASS:',label);
}

const base='id,created_at,items,total,status,payment_method,delivery_type,pickup_code';
const both=base+',separation_started_at,separation_started_legacy';
const timestamp=base+',separation_started_at';
const legacy=base+',separation_started_legacy';

await runCase('1. as duas colunas existem',['separation_started_at','separation_started_legacy'],both,[both]);
await runCase('2. somente separation_started_at existe',['separation_started_at'],timestamp,[both,timestamp]);
await runCase('3. somente separation_started_legacy existe',['separation_started_legacy'],legacy,[both,timestamp,legacy]);
await runCase('4. nenhuma coluna opcional existe',[],base,[both,timestamp,legacy,base]);

// A quarta condição pedida ("apenas uma das duas") é exercitada nos dois sentidos:
for(const [label,existing,expected,attempts] of [
 ['4a. apenas a coluna de data', ['separation_started_at'], timestamp, [both,timestamp]],
 ['4b. apenas a coluna legada', ['separation_started_legacy'], legacy, [both,timestamp,legacy]]
]){
 await runCase('Cenário adicional: '+label,existing,expected,attempts);
}
console.log('PASS: fallback independente das colunas de separação');
