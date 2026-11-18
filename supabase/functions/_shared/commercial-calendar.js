export const STORE_TIME_ZONE = "America/Manaus";
function easterSunday(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(Date.UTC(year,month-1,day));
}
const addDays=(date,days)=>new Date(date.getTime()+days*86400000);
const dateKeyUTC=(date)=>date.getUTCFullYear()+"-"+String(date.getUTCMonth()+1).padStart(2,"0")+"-"+String(date.getUTCDate()).padStart(2,"0");
const movableHolidays: Record<string, { name: string; closed: boolean }> = {};
for(const year of [2026,2027]){
  const easter=easterSunday(year);
  movableHolidays[dateKeyUTC(addDays(easter,-48))]={name:"Carnaval (segunda-feira)",closed:false};
  movableHolidays[dateKeyUTC(addDays(easter,-47))]={name:"Carnaval (terça-feira)",closed:false};
  movableHolidays[dateKeyUTC(addDays(easter,-2))]={name:"Sexta-feira Santa",closed:false};
  movableHolidays[dateKeyUTC(addDays(easter,60))]={name:"Corpus Christi",closed:false};
}
export const HOLIDAYS: Readonly<Record<string, { name: string; closed: boolean }>> = Object.freeze({
  "2026-01-01": { name: "Confraternização Universal", closed: true },
  "2026-04-21": { name: "Tiradentes", closed: false },
  "2026-05-01": { name: "Dia do Trabalho", closed: false },
  "2026-09-05": { name: "Elevação do Amazonas à categoria de Província", closed: false },
  "2026-09-07": { name: "Independência do Brasil", closed: false },
  "2026-10-12": { name: "Nossa Senhora Aparecida", closed: false },
  "2026-10-24": { name: "Aniversário de Manaus", closed: false },
  "2026-11-02": { name: "Finados", closed: false },
  "2026-11-15": { name: "Proclamação da República", closed: false },
  "2026-11-20": { name: "Consciência Negra", closed: false },
  "2026-12-08": { name: "Nossa Senhora da Conceição", closed: false },
  "2026-12-25": { name: "Natal", closed: true },
  "2027-01-01": { name: "Confraternização Universal", closed: true },
  "2027-04-21": { name: "Tiradentes", closed: false },
  "2027-05-01": { name: "Dia do Trabalho", closed: false },
  "2027-09-05": { name: "Elevação do Amazonas à categoria de Província", closed: false },
  "2027-09-07": { name: "Independência do Brasil", closed: false },
  "2027-10-12": { name: "Nossa Senhora Aparecida", closed: false },
  "2027-10-24": { name: "Aniversário de Manaus", closed: false },
  "2027-11-02": { name: "Finados", closed: false },
  "2027-11-15": { name: "Proclamação da República", closed: false },
  "2027-11-20": { name: "Consciência Negra", closed: false },
  "2027-12-08": { name: "Nossa Senhora da Conceição", closed: false },
  "2027-12-25": { name: "Natal", closed: true },
  ...movableHolidays
});
const parts = (date) => {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return { year:+values.year, month:+values.month, day:+values.day, weekday:values.weekday, hour:+values.hour, minute:+values.minute };
};
const key = (y,m,d) => y+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");
const localDay = (p) => new Date(Date.UTC(p.year,p.month-1,p.day));
const specialDay = (k) => k.endsWith("-12-24") || k.endsWith("-12-31") || !!HOLIDAYS[k] && !HOLIDAYS[k].closed;
const openFor = (p) => {
  const k=key(p.year,p.month,p.day), sunday=p.weekday==="Sun", holiday=HOLIDAYS[k];
  if(sunday || holiday?.closed) return false;
  const close=specialDay(k)?11:13, minutes=p.hour*60+p.minute;
  return minutes>=360 && minutes<close*60;
};
export function estaAberto(data = new Date()) { return openFor(parts(data instanceof Date ? data : new Date(data))); }
export function proximaAbertura(data = new Date()) {
  const now=data instanceof Date?data:new Date(data);
  const p=parts(now), cursor=localDay(p), nowMinutes=p.hour*60+p.minute;
  for(let i=0;i<370;i++){
    const y=cursor.getUTCFullYear(),m=cursor.getUTCMonth()+1,d=cursor.getUTCDate(),k=key(y,m,d);
    const weekday=new Intl.DateTimeFormat("en-US",{timeZone:"UTC",weekday:"short"}).format(cursor);
    const holiday=HOLIDAYS[k], closed=weekday==="Sun"||holiday?.closed;
    const closing=specialDay(k)?11:13;
    if(!closed && (i>0 || nowMinutes<360) ) return new Date(Date.UTC(y,m-1,d,10,0,0));
    if(!closed && i===0 && nowMinutes>=360 && nowMinutes<closing*60) return null;
    if(!closed && i===0 && nowMinutes<closing*60 && nowMinutes<360) return new Date(Date.UTC(y,m-1,d,10,0,0));
    cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  throw new Error("NEXT_OPENING_NOT_FOUND");
}
export function getCommercialSchedule(data = new Date()) {
  const now=data instanceof Date?data:new Date(data), p=parts(now), k=key(p.year,p.month,p.day);
  const holiday=HOLIDAYS[k], special=specialDay(k), within=estaAberto(now), next=proximaAbertura(now);
  const label=next?new Intl.DateTimeFormat("pt-BR",{timeZone:STORE_TIME_ZONE,weekday:"long",day:"2-digit",month:"2-digit"}).format(next).replace("-feira",""):"hoje";
  return { within, holiday:holiday?.name||((k.endsWith("-12-24")||k.endsWith("-12-31"))?"Véspera de Natal/Ano Novo":null), hours:p.weekday==="Sun"||holiday?.closed?"fechado":special?"6h às 11h":"6h às 13h", label, scheduledFor:next?.toISOString()||null };
}
export function upcomingHolidays(from = new Date(), limit = 8) {
  const today=parts(from), todayKey=key(today.year,today.month,today.day);
  const entries=[...Object.entries(HOLIDAYS),["2026-12-24",{name:"Véspera de Natal",closed:false}],["2026-12-31",{name:"Véspera de Ano Novo",closed:false}],["2027-12-24",{name:"Véspera de Natal",closed:false}],["2027-12-31",{name:"Véspera de Ano Novo",closed:false}]];
  return entries.filter(([date])=>date>=todayKey).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)
    .map(([date,item])=>({date,name:item.name,hours:item.closed||new Date(date+"T12:00:00Z").getUTCDay()===0?"Fechado":"6h às 11h"}));
}
