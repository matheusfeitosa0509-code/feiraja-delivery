import { estaAberto, proximaAbertura, getCommercialSchedule } from "./commercial-calendar.js";
export { estaAberto, proximaAbertura };
export const STORE_TIME_ZONE = "America/Manaus";
export function formatStoreScheduleLabel(value) {
 const date=value instanceof Date?value:new Date(value);
 return new Intl.DateTimeFormat("pt-BR",{timeZone:STORE_TIME_ZONE,weekday:"long",day:"2-digit",month:"2-digit"}).format(date).replace("-feira","");
}
export function getStoreSchedule(date=new Date()) {
 const schedule=getCommercialSchedule(date);
 return {within:schedule.within,label:schedule.label,scheduledFor:schedule.scheduledFor};
}
