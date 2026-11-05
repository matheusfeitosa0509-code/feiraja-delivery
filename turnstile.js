(function(){
 'use strict';
 const SITE_KEY="0x4AAAAAAF1V0ABPCa4SDeRO";
 const SCRIPT_URL='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
 let scriptPromise=null;
 function loadScript(){
  if(window.turnstile)return Promise.resolve(window.turnstile);
  if(scriptPromise)return scriptPromise;
  scriptPromise=new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src=SCRIPT_URL;script.async=true;script.defer=true;
   script.onload=()=>window.turnstile?resolve(window.turnstile):reject(new Error('Turnstile indisponível.'));
   script.onerror=()=>{scriptPromise=null;reject(new Error('Não foi possível carregar o script de verificação.'));};
   document.head.appendChild(script);
  });
  return scriptPromise;
 }
 function create(config){
  const container=document.getElementById(config.containerId),button=document.getElementById(config.buttonId),message=document.getElementById(config.messageId),retryButton=document.getElementById(config.retryButtonId);
  let widgetId=null,token='',required=true,initializing=false,failed=false,api=null;
  function updateButton(){button.disabled=required&&!token&&!failed;}
  function setMessage(value){message.textContent=value;}
  function setFailure(){
   failed=true;token='';
   setMessage('Verificação indisponível. Você pode continuar ou tentar novamente.');
   retryButton.hidden=false;
   updateButton();
  }
  function setRequired(value){
   required=!!value;container.hidden=!required;
   retryButton.hidden=!required||!failed;
   if(!required){
    token='';setMessage('');
    if(api&&widgetId!==null){try{api.reset(widgetId);}catch(error){}}
   }else if(!token&&!failed)setMessage('Conclua a verificação ou envie sem token se ela falhar.');
   updateButton();
  }
  async function init(){
   if(!required||widgetId!==null||initializing||failed)return;
   initializing=true;container.hidden=false;updateButton();
   try{
    api=await loadScript();
    if(!required)return;
    widgetId=api.render(container,{sitekey:SITE_KEY,
     callback:function(value){token=value;failed=false;retryButton.hidden=true;setMessage('Verificação concluída.');updateButton();},
     'expired-callback':function(){token='';setMessage('A verificação expirou. Faça-a novamente.');updateButton();},
     'error-callback':setFailure
    });
   }catch(error){setFailure();}
   finally{initializing=false;}
  }
  function reset(){
   token='';
   if(api&&widgetId!==null&&!failed){
    try{api.reset(widgetId);}
    catch(error){setFailure();return;}
   }
   if(required&&!failed)setMessage('Verificação usada. Faça uma nova verificação ou envie sem token se ela falhar.');
   updateButton();
  }
  async function retry(){
   if(!required||initializing)return;
   failed=false;token='';retryButton.hidden=true;setMessage('Tentando carregar a verificação…');
   if(api&&widgetId!==null){
    try{api.reset(widgetId);updateButton();return;}
    catch(error){try{api.remove(widgetId);}catch(removeError){}widgetId=null;api=null;}
   }
   scriptPromise=null;widgetId=null;api=null;
   await init();
  }
  retryButton.addEventListener('click',retry);
  setRequired(true);
  return {init,reset,retry,setRequired,getToken:function(){return token;},isRequired:function(){return required;},hasFailed:function(){return failed;}};
 }
 window.FeiraTurnstile={create};
})();
