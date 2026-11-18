export function mountAssistantRuntime(api){
 const $=api.$;
 let assistantHistory=[];
let assistantProposal=[];
let assistantMissingName='';
let assistantRecognition=null;
let assistantListening=false;
let assistantPhoto=null;
let assistantPhotoPreviewUrl='';
function clearAssistantPhoto(){
 assistantPhoto=null;
 if(assistantPhotoPreviewUrl)URL.revokeObjectURL(assistantPhotoPreviewUrl);
 assistantPhotoPreviewUrl='';
 const preview=$('#assistantPhotoPreview');
 const image=preview.querySelector('img');
 if(image)image.removeAttribute('src');
 preview.hidden=true;
 $('#assistantPhotoInput').value='';
}
async function prepareAssistantPhoto(file){
 try{
  let source;
  if(typeof createImageBitmap==='function'){
   try{source=await createImageBitmap(file,{imageOrientation:'from-image'});}
   catch{source=await createImageBitmap(file);}
  }else{
   const sourceUrl=URL.createObjectURL(file);
   source=await new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>{URL.revokeObjectURL(sourceUrl);resolve(image);};
    image.onerror=()=>{URL.revokeObjectURL(sourceUrl);reject(new Error('read'));};
    image.src=sourceUrl;
   });
  }
  const width=source.width||source.naturalWidth;
  const height=source.height||source.naturalHeight;
  if(!width||!height)throw new Error('read');
  const scale=Math.min(1,1280/Math.max(width,height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));
  canvas.height=Math.max(1,Math.round(height*scale));
  const context=canvas.getContext('2d');
  if(!context)throw new Error('encode');
  context.drawImage(source,0,0,canvas.width,canvas.height);
  if(typeof source.close==='function')source.close();
  const encode=quality=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('encode')),'image/jpeg',quality));
  let blob=await encode(0.7);
  if(blob.size>400*1024)blob=await encode(0.55);
  if(blob.size>400*1024)blob=await encode(0.45);
  if(blob.size>450*1024)throw new Error('size');
  const dataUrl=await new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>resolve(String(reader.result||''));
   reader.onerror=()=>reject(new Error('read'));
   reader.readAsDataURL(blob);
  });
  const data=String(dataUrl).split(',')[1]||'';
  if(!data)throw new Error('encode');
  const nextPreviewUrl=URL.createObjectURL(blob);
  if(assistantPhotoPreviewUrl)URL.revokeObjectURL(assistantPhotoPreviewUrl);
  assistantPhotoPreviewUrl=nextPreviewUrl;
  $('#assistantPhotoPreview').querySelector('img').src=nextPreviewUrl;
  $('#assistantPhotoPreview').hidden=false;
  assistantPhoto={media_type:'image/jpeg',data};
  $('#assistantPhotoInput').value='';
  setAssistantStatus('');
 }catch{
  $('#assistantPhotoInput').value='';
  setAssistantStatus('Não consegui usar essa foto. Tire outra ou escolha outra.',true);
 }
}

function appendAssistantBubble(role,message){
 const bubble=document.createElement('div');
 bubble.className='assistant-bubble '+(role==='user'?'user':'assistant');
 bubble.textContent=String(message||'');
 $('#assistantMessages').appendChild(bubble);
 $('#assistantMessages').scrollTop=$('#assistantMessages').scrollHeight;
}
function setAssistantStatus(message,isError=false){
 const el=$('#assistantStatus');
 el.textContent=message||'';
 el.hidden=!message;
 el.style.color=isError?'#b42318':'var(--mut)';
}
function renderAssistantProposal(items){
 const requested=Array.isArray(items)?items.slice(0,15):[];
 $('#assistantConfirmation').classList.add('hidden');
 assistantProposal=[];
 const section=$('#assistantProposal'),list=$('#assistantProposalItems');
 list.replaceChildren();
 requested.forEach(item=>{
  const product=api.products.find(p=>p.id===item.product_id&&p.available!==false);
  if(!product)return;
  const li=document.createElement('li');
  li.textContent=api.formatCartQuantity(item.quantidade,product)+' × '+String(product.name);
  list.appendChild(li);
  assistantProposal.push(item);
 });
 section.classList.toggle('hidden',assistantProposal.length===0);
 if(requested.length>assistantProposal.length)setAssistantStatus('Alguns produtos não estão mais disponíveis nesta lista. Atualize o catálogo antes de adicionar.',true);
}
async function openAssistantSheet(){
 try{
  const {data:{session},error}=await api.supabase.auth.getSession();
  if(error)throw error;
  if(!session?.user){api.openAccountScreen();return;}
  void ensureAssistantSpeechRecognition();
  if(!assistantHistory.length)appendAssistantBubble('assistant','Olá! Fale, digite ou mande uma foto da sua lista ou de um produto. Vou montar uma sugestão para você conferir.');
  document.querySelector('.assistant-examples').hidden=assistantHistory.some(item=>item.role==='user');
  $('#assistantSheet').setAttribute('aria-hidden','false');
  api.openPreviewModal('assistantSheet');
  requestAnimationFrame(()=>$('#assistantInput').focus());
 }catch(error){
  console.error('Falha ao verificar sessão do assistente.');
  setAssistantStatus('Não foi possível verificar seu login. Tente novamente.',true);
  $('#assistantSheet').setAttribute('aria-hidden','false');
  api.openPreviewModal('assistantSheet');
 }
}
function closeAssistantSheet(){
 if(assistantRecognition&&assistantListening){try{assistantRecognition.stop();}catch{}}
 $('#assistantSheet').classList.remove('open');
 $('#assistantSheet').setAttribute('aria-hidden','true');
}
$('#assistantClose').addEventListener('click',closeAssistantSheet);
$('#assistantSheet').addEventListener('click',event=>{if(event.target===$('#assistantSheet'))closeAssistantSheet();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#assistantSheet').classList.contains('open'))closeAssistantSheet();});

let assistantSpeechPromise=null;
async function ensureAssistantSpeechRecognition(){
 if(assistantRecognition)return assistantRecognition;
 if(assistantSpeechPromise)return assistantSpeechPromise;
 assistantSpeechPromise=import('./assistant-speech.js?v=20261118-lazy-assistant').then(({createAssistantSpeechRecognition})=>{
  assistantRecognition=createAssistantSpeechRecognition();
  if(!assistantRecognition)return null;
  assistantRecognition.onstart=()=>{assistantListening=true;$('#assistantMic').textContent='■';setAssistantStatus('Ouvindo seu pedido…');};
  assistantRecognition.onresult=event=>{const transcript=event.results?.[0]?.[0]?.transcript||'';if(transcript){$('#assistantInput').value=transcript.slice(0,300);$('#assistantInput').focus();setAssistantStatus('Texto reconhecido. Revise e toque em Enviar.');}};
  assistantRecognition.onerror=()=>setAssistantStatus('Não consegui reconhecer a fala. Você pode escrever o pedido.',true);
  assistantRecognition.onend=()=>{assistantListening=false;$('#assistantMic').innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>';};
  $('#assistantMic').hidden=false;
  $('#assistantMic').addEventListener('click',()=>{if(assistantListening){try{assistantRecognition.stop();}catch{}return;}try{assistantRecognition.start();}catch{setAssistantStatus('O microfone não está disponível agora.',true);}});
  return assistantRecognition;
 }).catch(error=>{assistantSpeechPromise=null;console.warn('Voz do assistente indisponível:',error);return null;});
 return assistantSpeechPromise;
}

document.querySelector('.assistant-examples').addEventListener('click',event=>{
 const chip=event.target.closest('[data-assistant-example]');
 if(!chip)return;
 $('#assistantInput').value=chip.dataset.assistantExample||'';
 $('#assistantSend').click();
});
$('#assistantCamera').addEventListener('click',()=>$('#assistantPhotoInput').click());
$('#assistantPhotoInput').addEventListener('change',async event=>{
 const file=event.target.files?.[0];
 if(!file)return;
 setAssistantStatus('Preparando foto…');
 await prepareAssistantPhoto(file);
});
$('#assistantPhotoRemove').addEventListener('click',()=>{clearAssistantPhoto();setAssistantStatus('Foto removida.');});
$('#assistantSend').addEventListener('click',async()=>{
 const input=$('#assistantInput');
 const message=input.value.trim();
 const photo=assistantPhoto;
 const button=$('#assistantSend');
 if(!message&&!photo){setAssistantStatus('Escreva, dite ou envie uma foto antes de enviar.',true);return;}
 if(message.length>300){setAssistantStatus('O pedido deve ter até 300 caracteres.',true);return;}
 const history=assistantHistory.slice(-6);
 const historyContent=photo?(message.slice(0,280)+(message?'\n':'')+'[foto enviada]'):message;

 document.querySelector('.assistant-examples').hidden=true;
 appendAssistantBubble('user',[message,photo?'📷 Foto enviada':''].filter(Boolean).join('\n')||'📷 Foto enviada');
 assistantHistory.push({role:'user',content:photo?historyContent:message});
 button.disabled=true;button.textContent='Montando…';
 setAssistantStatus(photo?'Analisando a foto…':'Montando sua sugestão…');
 let timer=null;
 const controller=new AbortController();
 const timeoutMs=photo?40000:20000;
 try{
  const body=photo
   ?{text:message,history,image:{media_type:'image/jpeg',data:photo.data}}
   :{text:message,history};
  const request=api.supabase.functions.invoke('assistente',{
   body,
   signal:controller.signal
  });
  const timeout=new Promise((_,reject)=>{
   timer=setTimeout(()=>{controller.abort();reject(new Error('O assistente demorou mais de '+(timeoutMs/1000)+' segundos. Tente novamente.'));},timeoutMs);
  });
  const result=await Promise.race([request,timeout]);
  if(result.error){
   let message=result.data?.error||'';
   if(!message&&result.error.context&&typeof result.error.context.json==='function'){
    try{const payload=await result.error.context.json();message=payload?.error||'';}catch{}
   }
   throw new Error(message||'Não consegui montar a sugestão agora. Tente novamente.');
  }
  const data=result.data||{};
  if(data.error)throw new Error(data.error);
  const responseText=String(data.resposta||'Posso ajudar a separar seus produtos.');
  const questions=Array.isArray(data.perguntas)?data.perguntas.filter(x=>typeof x==='string'):[];
  const missing=questions.filter(q=>q.startsWith('nao_encontrado:')).map(q=>q.slice('nao_encontrado:'.length).trim()).filter(Boolean);
  const regularQuestions=questions.filter(q=>!q.startsWith('nao_encontrado:'));
  appendAssistantBubble('assistant',responseText);
  if(regularQuestions.length)appendAssistantBubble('assistant',regularQuestions.join('\n'));
  if(missing.length){
   assistantMissingName=missing[0].slice(0,80);
   appendAssistantBubble('assistant','Não encontrei no catálogo: '+missing.join(', ')+'. Você pode pedir esse produto.');
   $('#assistantManualRequest').hidden=false;
  }else{
   assistantMissingName='';
   $('#assistantManualRequest').hidden=true;
  }
  assistantHistory.push({role:'assistant',content:[responseText,...questions].join('\n').slice(0,300)});
  renderAssistantProposal(data.itens);
  input.value='';
  if(photo&&assistantPhoto===photo)clearAssistantPhoto();
  setAssistantStatus(data.itens?.length&&!assistantProposal.length?'Alguns itens não puderam ser validados. Confira a pergunta antes de continuar.':'');
 }catch(error){
  setAssistantStatus(error.message||'Não consegui montar a sugestão agora. Tente novamente.',true);
 }finally{
  clearTimeout(timer);
  button.disabled=false;button.textContent='Enviar';
 }
});
$('#assistantManualRequest').addEventListener('click',()=>{
 const name=assistantMissingName;
 closeAssistantSheet();
 api.openProductRequestSheet(name);
});
$('#assistantCancel').addEventListener('click',()=>{
 assistantProposal=[];
 $('#assistantProposal').classList.add('hidden');
 setAssistantStatus('Sugestão cancelada.');
});
$('#assistantAdd').addEventListener('click',()=>{
 if(!assistantProposal.length)return;
 const valid=assistantProposal.every(item=>{
  const product=api.products.find(p=>p.id===item.product_id&&p.available!==false);
  return !!product&&api.isValidCartQuantity(product,item.quantidade)&&api.isValidCartQuantity(product,(api.cart[item.product_id]||0)+item.quantidade);
 });
 if(!valid){setAssistantStatus('Um item não está mais disponível ou ultrapassaria o limite do carrinho. Atualize a lista e tente novamente.',true);return;}
 const proposal=assistantProposal.slice();
 for(const item of proposal){api.cart[item.product_id]=(api.cart[item.product_id]||0)+item.quantidade;api.cartPreferences[item.product_id]={note:String(item.item_note||'').slice(0,100),substitution:['replace','remove'].includes(item.substitution_preference)?item.substitution_preference:'replace'};}
 api.persistCart();api.renderCart();api.renderProducts();api.safeRenderHomeProductSections();
 assistantProposal=[];
 $('#assistantProposal').classList.add('hidden');
 $('#assistantConfirmation').classList.remove('hidden');
 setAssistantStatus('');
});
$('#assistantViewCart').addEventListener('click',()=>{
 closeAssistantSheet();
 api.showAppPage('Cart');
});

 return {openAssistantSheet,closeAssistantSheet};
}
