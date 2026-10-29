'use strict'
const message=document.querySelector('#email-message'),csrf=document.querySelector('#email-csrf').value
const requestForm=document.querySelector('#email-request'),consumeForm=document.querySelector('#email-consume')
let token=new URLSearchParams(location.hash.slice(1)).get('token')||''
history.replaceState(null,'','/email-login')
if(token){requestForm.hidden=true;consumeForm.hidden=false}
async function post(path,data,form){
 const button=form.querySelector('button');button.disabled=true;message.textContent='Проверяем…'
 try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,csrf})});const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось выполнить запрос');return d}
 catch(e){message.textContent=e.message;return null}finally{button.disabled=false}
}
requestForm.onsubmit=async e=>{e.preventDefault();const d=await post('/api/email/request',{email:requestForm.email.value},requestForm);if(d)message.textContent=d.message}
consumeForm.onsubmit=async e=>{e.preventDefault();const d=await post('/api/email/consume',{token},consumeForm);if(d){token='';location.assign(d.next)}else{token='';consumeForm.hidden=true;requestForm.hidden=false}}
