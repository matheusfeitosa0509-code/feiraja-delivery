import { estaAberto } from '../supabase/functions/_shared/commercial-calendar.js';

const ROOMS = [
 {id:'ceo',title:'Sala da CEO',sub:'Roadmap',x:145,y:135,icon:'ceo'},
 {id:'tech',title:'Tecnologia',sub:'Executora',x:380,y:115,icon:'tech'},
 {id:'creation',title:'Criação',sub:'Marketing + Artes',x:615,y:135,icon:'creation'},
 {id:'support',title:'Atendimento',sub:'SAC',x:145,y:340,icon:'support'},
 {id:'meeting',title:'Reunião',sub:'Aprovações',x:380,y:325,icon:'meeting'},
 {id:'lounge',title:'Lounge',sub:'Agentes livres',x:615,y:340,icon:'lounge'},
 {id:'bedroom',title:'Dormitório',sub:'Fora do expediente',x:145,y:545,icon:'bed'},
 {id:'gym',title:'Academia',sub:'Regras atualizadas',x:380,y:530,icon:'gym'},
 {id:'reception',title:'Recepção',sub:'Pedidos + kit do dia',x:615,y:545,icon:'market'}
];
const STATUS = {trabalhando:'#24985a',esperando_dono:'#e1b431',travado:'#c84338',livre:'#aab3aa'};
const $ = (root,sel)=>root.querySelector(sel);
const svgIcon = {
 ceo:'<g shape-rendering="crispEdges"><rect x="-34" y="-54" width="68" height="17" fill="#a96d3f"/><rect x="-29" y="-64" width="58" height="13" fill="#e7c78d"/><rect x="-20" y="-77" width="40" height="14" fill="#416e50"/><rect x="-6" y="-87" width="12" height="10" fill="#d5e5bc"/></g>',
 tech:'<g shape-rendering="crispEdges"><rect x="-34" y="-88" width="68" height="42" fill="#315d66"/><rect x="-27" y="-81" width="54" height="28" fill="#9be1c1"/><rect x="-20" y="-73" width="13" height="9" fill="#2b8a72"/><rect x="2" y="-73" width="18" height="5" fill="#e7f6d4"/><rect x="-5" y="-46" width="10" height="8" fill="#315d66"/><rect x="-30" y="-37" width="60" height="8" fill="#c18b54"/></g>',
 creation:'<g shape-rendering="crispEdges"><circle cx="-12" cy="-61" r="24" fill="#e5bb79"/><rect x="-30" y="-78" width="14" height="14" fill="#d35b51"/><rect x="-8" y="-86" width="14" height="14" fill="#4b8c63"/><rect x="10" y="-70" width="14" height="14" fill="#4e82b9"/><rect x="-4" y="-55" width="14" height="14" fill="#f5e9ca"/><rect x="22" y="-96" width="7" height="36" fill="#95633d" transform="rotate(28 25 -78)"/></g>',
 support:'<g shape-rendering="crispEdges"><rect x="-38" y="-50" width="76" height="16" fill="#a66b43"/><rect x="-31" y="-70" width="62" height="20" fill="#f3dfb7"/><rect x="-22" y="-64" width="44" height="5" fill="#6b9a68"/><rect x="24" y="-101" width="33" height="22" rx="5" fill="#fff" stroke="#4e8b64" stroke-width="3"/><path d="M35 -79l-7 9 13-5" fill="#fff" stroke="#4e8b64" stroke-width="2"/></g>',
 meeting:'<g shape-rendering="crispEdges"><polygon points="-42,-59 0,-80 42,-59 0,-38" fill="#c28b54" stroke="#825735" stroke-width="3"/><rect x="-7" y="-77" width="14" height="8" fill="#dcebd2"/><rect x="-53" y="-61" width="13" height="18" fill="#4f8060"/><rect x="40" y="-61" width="13" height="18" fill="#4f8060"/></g>',
 lounge:'<g shape-rendering="crispEdges"><rect x="-43" y="-62" width="86" height="26" fill="#54866a"/><rect x="-37" y="-77" width="74" height="20" fill="#7eaf83"/><rect x="-43" y="-45" width="12" height="12" fill="#41664e"/><rect x="31" y="-45" width="12" height="12" fill="#41664e"/><rect x="-8" y="-74" width="16" height="14" fill="#f3e7ca"/></g>',
 bed:'<g shape-rendering="crispEdges"><rect x="-43" y="-71" width="86" height="34" fill="#d7e4d4" stroke="#62866a" stroke-width="3"/><rect x="-34" y="-66" width="24" height="15" fill="#fff8e9"/><rect x="-7" y="-65" width="42" height="21" fill="#86b3a1"/><rect x="-48" y="-38" width="96" height="7" fill="#956c4d"/></g>',
 gym:'<g shape-rendering="crispEdges"><rect x="-42" y="-69" width="84" height="6" fill="#5b6670"/><rect x="-54" y="-83" width="12" height="35" fill="#6c7982"/><rect x="-42" y="-77" width="10" height="22" fill="#9aa8a9"/><rect x="32" y="-77" width="10" height="22" fill="#9aa8a9"/><rect x="42" y="-83" width="12" height="35" fill="#6c7982"/></g>',
 market:'<g shape-rendering="crispEdges"><rect x="-40" y="-54" width="80" height="24" fill="#b67a47"/><path d="M-44 -91h88v24h-88z" fill="#fff8e9"/><path d="M-44 -91h22v24h-22zm44 0h22v24H0z" fill="#32814d"/><rect x="-29" y="-49" width="15" height="12" fill="#d75c45"/><rect x="-7" y="-52" width="15" height="15" fill="#7da94c"/><rect x="14" y="-48" width="16" height="11" fill="#e8bd49"/><rect x="-8" y="-103" width="16" height="12" fill="#e8f1dd"/></g>'
};
function roomMarkup(r,stats){
 const bubble = r.id==='support' ? '<g><rect x="29" y="-121" width="43" height="25" rx="8" fill="#fff" stroke="#4b8c63" stroke-width="3"/><text x="50" y="-103" text-anchor="middle" font-size="17" font-weight="900" fill="#245a38">'+escapeXml(stats.alerts||'0')+'</text></g>' : '';
 const detail = r.id==='meeting' ? (stats.approvals||0)+' pendente(s)' : r.id==='reception' ? (stats.paid||0)+' pagos · '+escapeXml(stats.kit||'sem kit') : r.id==='tech' ? escapeXml(stats.currentTask||'Sem tarefa ativa') : r.id==='ceo' ? (stats.tasks||0)+' tarefas no roadmap' : r.id==='creation' ? (stats.creationTasks||0)+' tarefas criativas' : r.id==='lounge' ? (stats.free||0)+' agente(s) livre(s)' : r.id==='gym' ? (stats.recentRules||0)+' regra(s) atualizada(s)' : r.id==='bedroom' ? 'Equipe descansando' : r.sub;
 return '<g class="office-room" data-room="'+r.id+'" transform="translate('+r.x+' '+r.y+')">'
 + '<polygon points="-102,-50 0,2 0,-58 -102,-110" fill="#dbe8d4" stroke="#6f9974" stroke-width="3"/>'
 + '<polygon points="0,2 102,-50 102,-110 0,-58" fill="#c5d9c2" stroke="#6f9974" stroke-width="3"/>'
 + '<polygon points="-102,-50 0,2 102,-50 0,-102" fill="#e9e6cb" stroke="#6f9974" stroke-width="3"/>'
 + '<path d="M-85 -52l85 43 85-43" fill="none" stroke="#d2cba9" stroke-width="3" stroke-dasharray="7 7"/>'
 + svgIcon[r.icon]
 + '<text class="room-title" x="0" y="-122" text-anchor="middle">'+escapeXml(r.title)+'</text>'
 + '<text class="room-sub" x="0" y="22" text-anchor="middle">'+escapeXml(detail)+'</text>'
 + bubble + '</g>';
}
function escapeXml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function isRecentRules(agent,now){if(!agent.rules_updated_at)return false;const age=now-new Date(agent.rules_updated_at).getTime();return age>=0&&age<=86400000;}
function destination(agent,approvals,sleeping,now){
 if(sleeping)return 'bedroom';
 if(isRecentRules(agent,now))return 'gym';
 if(agent.status==='esperando_dono'||approvals.some(a=>a.requested_by===agent.id))return 'meeting';
 if(agent.status==='livre')return 'lounge';
 if(agent.slug==='ceo')return 'ceo';
 if(agent.slug==='executora')return 'tech';
 if(agent.slug==='marketing'||agent.slug==='artes')return 'creation';
 return 'support';
}
function avatarMarkup(agent,x,y){
 const color=escapeXml(agent.color||'#4d8b61'),status=STATUS[agent.status]||STATUS.livre;
 return '<g class="pixel-agent" data-agent="'+escapeXml(agent.id)+'" role="button" tabindex="0" aria-label="Abrir agente '+escapeXml(agent.name)+'" transform="translate('+x+' '+y+') scale(1.15)">'
 + '<rect class="agent-name-bg" x="-39" y="-48" width="78" height="15" rx="3" fill="#fffdf3" stroke="#466c4e" stroke-width="2"/>'
 + '<text class="agent-name" x="0" y="-37" text-anchor="middle">'+escapeXml(agent.name)+'</text>'
 + '<rect x="-7" y="-29" width="14" height="12" fill="#e7b98d"/>'
 + '<rect x="-8" y="-33" width="16" height="6" fill="#594536"/>'
 + '<rect x="-10" y="-17" width="20" height="15" fill="'+color+'"/>'
 + '<rect x="-9" y="-2" width="7" height="10" fill="#4b4038"/>'
 + '<rect x="2" y="-2" width="7" height="10" fill="#4b4038"/>'
 + '<rect x="-15" y="-15" width="5" height="11" fill="#e7b98d"/>'
 + '<rect x="10" y="-15" width="5" height="11" fill="#e7b98d"/>'
 + '<circle cx="17" cy="-28" r="6" fill="'+status+'" stroke="#fff" stroke-width="2"/>'
 + '</g>';
}
function ensureMarkup(host){
 if(host.dataset.ready==='1')return;
 host.innerHTML='<div class="map-toolbar"><p class="map-note" id="mapNote">Organizando as salas…</p><div class="map-controls"><button type="button" data-zoom="out" aria-label="Diminuir mapa">−</button><button type="button" data-zoom="reset" aria-label="Centralizar mapa">↺</button><button type="button" data-zoom="in" aria-label="Aumentar mapa">+</button></div></div><div class="map-stage" id="mapStage"><svg class="office-map-svg" id="officeMapSvg" viewBox="0 0 760 650" role="img" aria-label="Mapa isométrico do Escritório Feira On"><defs><pattern id="mapGrid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#dbe7d5" stroke-width="1"/></pattern><linearGradient id="mapGround" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f9f4df"/><stop offset="1" stop-color="#e4efdc"/></linearGradient></defs><rect width="760" height="650" fill="url(#mapGround)"/><rect width="760" height="650" fill="url(#mapGrid)" opacity=".7"/><g id="roomLayer"></g><g id="avatarLayer"></g></svg></div><div class="map-legend"><span><i class="legend-dot working"></i> Trabalhando</span><span><i class="legend-dot waiting"></i> Esperando você</span><span><i class="legend-dot blocked"></i> Travado</span><span><i class="legend-dot free"></i> Livre</span></div><p class="map-hint">Toque em um boneco para abrir a sala do agente · arraste o mapa para navegar</p>';
 const svg=$(host,'#officeMapSvg'),layer=$(host,'#roomLayer');
 const stats={alerts:0,approvals:0,paid:0,kit:'—'};
 layer.innerHTML=ROOMS.map(r=>roomMarkup(r,stats)).join('');
 host.dataset.ready='1';host.dataset.zoom='1';
 host.addEventListener('click',e=>{const zoom=e.target.closest('[data-zoom]');if(zoom){changeZoom(host,zoom.dataset.zoom);return;}const person=e.target.closest('[data-agent]');if(person&&host._onAgentClick)host._onAgentClick(person.dataset.agent);});
 host.addEventListener('keydown',e=>{const person=e.target.closest('[data-agent]');if(person&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(host._onAgentClick)host._onAgentClick(person.dataset.agent);}});
 const stage=$(host,'#mapStage');let drag=null;
 stage.addEventListener('pointerdown',e=>{if(e.target.closest('[data-agent]'))return;drag={x:e.clientX,y:e.clientY,left:stage.scrollLeft,top:stage.scrollTop};stage.setPointerCapture(e.pointerId);});
 stage.addEventListener('pointermove',e=>{if(!drag)return;stage.scrollLeft=drag.left-(e.clientX-drag.x);stage.scrollTop=drag.top-(e.clientY-drag.y);});
 stage.addEventListener('pointerup',()=>{drag=null;});stage.addEventListener('pointercancel',()=>{drag=null;});
}
function changeZoom(host,action){const stage=$(host,'#mapStage'),svg=$(host,'#officeMapSvg');let scale=Number(host.dataset.zoom||1);scale=action==='in'?Math.min(1.8,scale+.2):action==='out'?Math.max(1,scale-.2):1;host.dataset.zoom=String(scale);svg.style.width=(scale*100)+'%';svg.style.minWidth=(scale>1?'720px':'0');stage.scrollLeft=(stage.scrollWidth-stage.clientWidth)/2;stage.scrollTop=(stage.scrollHeight-stage.clientHeight)/2;}
export function renderOfficeMap(host,agents,tasks,approvals,stats,onAgentClick){
 if(!host)return;ensureMarkup(host);host._onAgentClick=onAgentClick;
 const now=Date.now(),sleeping=!estaAberto(new Date(now));
 const note=$(host,'#mapNote');note.textContent=sleeping?'🌙 Fora do horário da loja · todos os agentes descansando':'☀️ Escritório em funcionamento · acompanhe a equipe';
 const currentStats={alerts:stats.alerts||0,approvals:approvals.length,paid:stats.paid||0,kit:stats.kit||'Sem kit'};
 $(host,'#roomLayer').innerHTML=ROOMS.map(r=>roomMarkup(r,currentStats)).join('');
 const grouped={};for(const a of agents){const room=destination(a,approvals,sleeping,now);(grouped[room]||(grouped[room]=[])).push(a);}
 const layer=$(host,'#avatarLayer'),existing=new Map([...layer.querySelectorAll('[data-agent]')].map(el=>[el.dataset.agent,el]));
 const live=new Set();
 for(const room of ROOMS){const list=grouped[room.id]||[];list.forEach((a,i)=>{live.add(a.id);const offset=(i-(list.length-1)/2)*22,x=room.x+offset,y=room.y-35+Math.floor(i/3)*8;let el=existing.get(a.id);if(!el){el=[...layer.querySelectorAll('[data-agent]')].find(n=>n.dataset.agent===a.id);if(!el){layer.insertAdjacentHTML('beforeend',avatarMarkup(a,x,y));el=[...layer.querySelectorAll('[data-agent]')].find(n=>n.dataset.agent===a.id);}}if(el){el.setAttribute('transform','translate('+x+' '+y+') scale(1.15)');el.setAttribute('data-room',room.id);el.onclick=()=>{if(host._onAgentClick)host._onAgentClick(a.id);};el.onkeydown=event=>{if((event.key==='Enter'||event.key===' ')&&host._onAgentClick){event.preventDefault();host._onAgentClick(a.id);}};el.querySelector('.agent-name').textContent=a.name;el.querySelector('.agent-name-bg').setAttribute('fill','#fffdf3');const dot=el.querySelector('circle');if(dot)dot.setAttribute('fill',STATUS[a.status]||STATUS.livre);}});}
 for(const [id,el] of existing){if(!live.has(id))el.remove();}
}
