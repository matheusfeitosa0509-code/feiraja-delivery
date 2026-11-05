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
   script.onerror=()=>reject(new Error('Não foi possível carregar o script de verificação.'));
   document.head.appendChild(script);
  });
  return scriptPromise;
 }
 function create(config){
  const container=document.getElementById(config.containerId),button=document.getElementById(config.buttonId),message=document.getElementById(config.messageId);
  let widgetId=null,token='',required=true,initializing=false,failed=false,api=null;
  function updateButton(){button.disabled=required&&!token;}
  function setMessage(value){message.textContent=value;}
  function setRequired(value){
   required=!!value;container.hidden=!required;
   if(!required){
    token='';setMessage('');
    if(api&&widgetId!==null){try{api.reset(widgetId);}catch(error){}}
   }else if(!token)setMessage('Conclua a verificação de segurança para habilitar o envio.');
   updateButton();
  }
  async function init(){
   if(!required||widgetId!==null||initializing||failed)return;
   initializing=true;container.hidden=false;updateButton();
   try{
    api=await loadScript();
    if(!required)return;
    widgetId=api.render(container,{sitekey:SITE_KEY,
     callback:function(value){token=value;setMessage('Verificação concluída.');updateButton();},
     'expired-callback':function(){token='';setMessage('A verificação expirou. Faça-a novamente.');updateButton();},
     'error-callback':function(){token='';setMessage('A verificação falhou. Recarregue a página e tente novamente.');updateButton();}
    });
   }catch(error){failed=true;token='';setMessage('Não foi possível carregar a verificação de segurança. Verifique sua conexão e recarregue a página.');updateButton();}
   finally{initializing=false;}
  }
  function reset(){
   token='';
   if(api&&widgetId!==null){try{api.reset(widgetId);}catch(error){setMessage('A verificação precisa ser recarregada.');}}
   if(required)setMessage('Verificação usada. Faça uma nova verificação para continuar.');
   updateButton();
  }
  setRequired(true);
  return {init,reset,setRequired,getToken:function(){return token;},isRequired:function(){return required;}};
 }
 window.FeiraTurnstile={create};
})();