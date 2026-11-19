export type LalamoveWebhookRpcArgs={p_event_id:string;p_event_type:string;p_event_at:string;p_lalamove_order_id:string;p_status:string;p_tracking_url:string;p_driver:unknown;p_cancel_reason?:string|null;p_ambiente:"sandbox"|"producao"};
export async function applyLalamoveWebhookEvent(db:{rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<any>},args:Partial<LalamoveWebhookRpcArgs>){
 const required:Array<keyof LalamoveWebhookRpcArgs>=["p_event_id","p_event_type","p_event_at","p_lalamove_order_id","p_status","p_ambiente"];
 const missingFields=required.filter(k=>args[k]===undefined||args[k]===null||String(args[k]).trim()==="");
 if(missingFields.length)return{missingFields,data:null,error:null};
 const result=await db.rpc("service_apply_lalamove_webhook",args as unknown as Record<string,unknown>);
 return{missingFields:[],data:result?.data??null,error:result?.error??null};
}

export function isSupportedLalamoveOrderEvent(eventType: unknown): boolean {
 return ["ORDER_STATUS_CHANGED","DRIVER_ASSIGNED"].includes(String(eventType || "").trim().toUpperCase());
}
