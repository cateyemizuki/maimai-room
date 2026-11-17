export function mountRoomChat({request,signal,delay,$,isModelLoading,getName,isVisible=()=>!document.hidden}){
  let enabled=false,sending=false,watching=false,lastStatus='idle',afterSeq=0;
  const seen=new Set();
  function line(role,message,id=''){
    if(id&&seen.has(id))return;
    if(id)seen.add(id);
    const row=document.createElement('div');row.className='chat-message '+role;
    if(role!=='notice'){const label=document.createElement('span');label.className='sender';label.textContent=role==='user'?'你':getName();row.append(label);}
    const content=document.createElement('span');content.textContent=message;row.append(content);$('chatMessages').append(row);
    row.dataset.messageId=id;
    while($('chatMessages').children.length>100){
      const old=$('chatMessages').firstElementChild;seen.delete(old.dataset.messageId);old.remove();
    }
    $('chatMessages').scrollTop=$('chatMessages').scrollHeight;return content;
  }
  async function refresh(){
    const result=await request('query','chat_history',{after_seq:afterSeq});
    for(const message of result.messages||[]){
      afterSeq=Math.max(afterSeq,Number(message.seq)||0);
      line(message.role==='assistant'?'assistant':'user',message.text||'',message.id);
      if(message.role==='assistant')lastStatus='replied';
    }
  }
  async function watch(){
    if(watching)return;watching=true;
    try{
      while(enabled&&!signal.aborted&&!$('chatPanel').hidden){
        if(!isModelLoading()&&isVisible()){
          try{await refresh();if(enabled)$('chatSource').textContent='麦麦的小屋专属聊天流，聊天记录保存在宿主。';}catch(error){if(enabled&&!signal.aborted)$('chatSource').textContent='专属聊天暂不可用：'+(error.message||error);}
        }
        await delay(1500);
      }
    }finally{watching=false;}
  }
  async function receipt(id,notice){
    for(let i=0;i<30&&!signal.aborted;i++){
      await delay(1500);if(signal.aborted)return;
      const result=await request('query','chat_status',{request_id:id});
      lastStatus=result.status;
      notice.textContent=result.notice||'消息已送入专属聊天流';
      if(result.status!=='queued')return;
    }
  }
  async function send(){
    const text=$('chatInput').value.trim();if(!text||sending||!enabled)return;
    const id=globalThis.crypto?.randomUUID?.()||'room-chat-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    sending=true;$('chatSend').disabled=true;$('chatInput').value='';
    line('user',text,'room-'+id);
    const notice=line('notice','正在投递到麦麦的小屋专属聊天流');
    try{
      const result=await request('action','chat_send',{text,request_id:id});
      if(result.status==='error')throw Error(result.notice||'宿主没有接收这条消息');
      lastStatus=result.status;notice.textContent=result.notice||'专属聊天正在处理';
      void receipt(id,notice).catch(error=>{notice.textContent='投递状态待确认：'+error.message;});
      void watch();
    }catch(error){lastStatus='error';notice.textContent='消息未能提交：'+error.message;}
    finally{sending=false;if(!signal.aborted){$('chatSend').disabled=!enabled;if(enabled&&!$('chatPanel').hidden)$('chatInput').focus();}}
  }
  $('chatToggle').addEventListener('click',()=>{
    $('chatPanel').hidden=false;
    if(innerWidth<=1100){document.body.classList.remove('details-open');$('detailsToggle').setAttribute('aria-expanded','false');}
    $('chatSource').textContent='麦麦的小屋专属聊天流，聊天记录保存在宿主。';
    $('chatInput').focus();void watch();
  });
  $('closeChat').addEventListener('click',()=>{$('chatPanel').hidden=true;});
  $('chatSend').addEventListener('click',send);
  $('chatInput').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();void send();}});
  function setEnabled(value){
    const changed=enabled!==value;enabled=value;
    $('chatToggle').disabled=!enabled;$('chatInput').disabled=!enabled;$('chatSend').disabled=!enabled||sending;
    if(!enabled)$('chatSource').textContent='房间聊天操作已关闭';
    else if(changed&&!$('chatPanel').hidden)void watch();
  }
  setEnabled(false);
  return {setEnabled,inspect:()=>({sending,lastStatus,pending:watching,messages:$('chatMessages').children.length})};
}
