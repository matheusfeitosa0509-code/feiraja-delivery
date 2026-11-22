import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { persistCreatedLalamoveDispatch, shouldCallLalamovePartner } from "./dispatch-persistence.ts";

Deno.test("recusa da reserva impede chamada ao parceiro", async () => {
  let partnerCalls=0;
  const start={started:false,state:"blocked"};
  if (shouldCallLalamovePartner(start)) partnerCalls++;
  assertEquals(partnerCalls,0);
  assertEquals(shouldCallLalamovePartner({started:true,state:"creating"}),true);
  assertEquals(shouldCallLalamovePartner({started:true}),true);
});

Deno.test("corrida órfã: alerta com IDs e uma única retentativa salva o despacho", async () => {
  let saves=0, alerts:any[]=[];
  const db={
    rpc: async (_name:string,_args:any)=>({data:null,error:++saves===1?{code:"XX001"}:null}),
    from: (_table:string)=>({
      insert: async (row:any)=>{alerts.push(row);return {error:null};},
      select: (_cols:string)=>({eq: (_key:string,_value:string)=>({maybeSingle:async()=>({data:saves>=2?{lalamove_order_id:"PARTNER-1"}:null,error:null})})}),
    }),
  };
  const result=await persistCreatedLalamoveDispatch(db,{orderId:"ORDER-1",lalamoveOrderId:"PARTNER-1",actualCost:24.42,status:"searching",trackingUrl:"",driver:{}});
  assertEquals(result,{persisted:true,retried:true});
  assertEquals(saves,2); assertEquals(alerts.length,1);
  assertEquals(alerts[0].tipo,"dispatch_orphan");
  assertEquals(alerts[0].order_id,"ORDER-1");
  assertEquals(alerts[0].mensagem.includes("PARTNER-1"),true);
});

Deno.test("vigia: alerta dispatch_stale só cobre corrida ativa com mais de duas horas", async () => {
  const migration=await Deno.readTextFile("supabase/migrations/20261122073000_lalamove_dispatch_history_alerts.sql");
  assertEquals(migration.includes("select 'dispatch_stale'"),true);
  assertEquals(migration.includes("interval '2 hours'"),true);
  assertEquals(migration.includes("in ('searching','assigned','enroute_pickup','picked_up')"),true);
});

Deno.test("corrida órfã: falha após uma retentativa não chama o parceiro novamente", async () => {
  let saves=0;
  const db={
    rpc: async ()=>{saves++;return {data:null,error:{code:"XX001"}};},
    from: (_table:string)=>({
      insert: async ()=>({error:null}),
      select: (_cols:string)=>({eq: (_key:string,_value:string)=>({maybeSingle:async()=>({data:null,error:null})})}),
    }),
  };
  const result=await persistCreatedLalamoveDispatch(db,{orderId:"ORDER-2",lalamoveOrderId:"PARTNER-2",actualCost:20,status:"searching",trackingUrl:"",driver:{}});
  assertEquals(result,{persisted:false,retried:true});
  assertEquals(saves,2);
});
