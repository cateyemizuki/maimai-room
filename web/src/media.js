import * as THREE from '../upstream/vendor/three.module.js';

export function mountRoomMedia({world,reportError,capture,getSnapshot,onOpen,request,signal,delay,setTimeout,$}){
  const screen=world.tvScreen;
  const original={map:screen.material.map,emissiveMap:screen.material.emissiveMap};
  let canvas,ctx,texture;
  function prepareTexture(){
    if(texture)return;
    canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
    ctx=canvas.getContext('2d');texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  }
  let active=false,kind='',url='',stream=null,lastDraw=0,canShare=false;
  let capturedFrame=null,saveEnabled=false,reviewEnabled=false,frameBusy=false,frameStatus='idle',reviewUntil=0;
  let remoteState=null,remoteId='',remoteRevision=-1,loadGeneration=0,seekRevision=-1;
  let cancelRemoteLoad=null;
  const video=$('mediaVideo'),image=$('mediaImage');
  function status(value){$('mediaStatus').textContent=value;}
  function detectSharing(){
    const policy=document.permissionsPolicy||document.featurePolicy;
    const permitted=!policy?.allowsFeature||policy.allowsFeature('display-capture');
    canShare=!!navigator.mediaDevices?.getDisplayMedia&&permitted&&isSecureContext;
    $('shareScreen').disabled=!canShare;
    $('screenShareInfo').textContent=canShare?'屏幕共享会先请求浏览器授权。':'当前宿主没有开放屏幕共享；可以选择本地照片或视频。';
  }
  function draw(){
    const source=kind==='image'?image:video;
    const width=source.videoWidth||source.naturalWidth,height=source.videoHeight||source.naturalHeight;
    if(!width||!height)return;
    const scale=Math.min(canvas.width/width,canvas.height/height),w=width*scale,h=height*scale;
    ctx.fillStyle='#10191f';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,(canvas.width-w)/2,(canvas.height-h)/2,w,h);texture.needsUpdate=true;
  }
  function activate(type){
    if(signal.aborted)return;
    prepareTexture();
    kind=type;active=true;screen.material.map=texture;screen.material.emissiveMap=texture;screen.material.emissiveIntensity=.85;screen.material.needsUpdate=true;
    $('mediaStop').hidden=false;$('mediaPause').hidden=type==='image';
    $('mediaPause').textContent='暂停';draw();
    updateFrameControls();
  }
  function stop(showStatus=true){
    loadGeneration++;
    remoteId='';
    cancelRemoteLoad?.();cancelRemoteLoad=null;
    active=false;kind='';video.pause();video.removeAttribute('src');video.srcObject=null;video.load();image.removeAttribute('src');video.hidden=true;image.hidden=true;
    stream?.getTracks().forEach(track=>track.stop());stream=null;if(url){URL.revokeObjectURL(url);url='';}
    screen.material.map=original.map;screen.material.emissiveMap=original.emissiveMap;screen.material.needsUpdate=true;
    $('mediaStop').hidden=true;$('mediaPause').hidden=true;if(showStatus)status('已恢复房间原来的电视画面');
    updateFrameControls();
  }
  async function choose(file){
    if(!file)return;
    if(!/^(image\/(png|jpeg|webp)|video\/(mp4|webm|ogg))$/i.test(file.type)){status('目前支持 PNG / JPEG / WebP 照片，以及 MP4 / WebM / Ogg 视频');return;}
    stop(false);url=URL.createObjectURL(file);
    try{
      if(file.type.startsWith('image/')){
        await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('照片无法读取'));image.src=url;});image.hidden=false;activate('image');status('正在电视里展示：'+file.name);
      }else{
        await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('浏览器无法解码这个视频'));video.src=url;video.loop=true;video.muted=true;video.load();});
        video.hidden=false;activate('video');await video.play();status('正在电视里播放：'+file.name);
      }
    }catch(error){stop(false);status(error.message||'本地媒体没有打开');}
  }
  async function share(){
    if(!canShare){status('宿主没有开放屏幕共享，请选择本地照片或视频');return;}
    try{
      const granted=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
      if(signal.aborted){granted.getTracks().forEach(track=>track.stop());return;}
      stop(false);stream=granted;video.srcObject=stream;video.muted=true;video.hidden=false;await video.play();activate('screen');status('正在电视里展示授权共享的屏幕');stream?.getVideoTracks()[0]?.addEventListener('ended',()=>stop(),{signal});
    }catch(error){status(error.name==='NotAllowedError'?'屏幕共享未获授权。可以选择本地照片或视频。':'当前环境无法共享屏幕：'+(error.message||error.name));}
  }
  function closeSmallDetails(){if(innerWidth<=1100){document.body.classList.remove('details-open');$('detailsToggle').setAttribute('aria-expanded','false');}}
  function showTv(){detectSharing();$('objectCard').hidden=true;closeSmallDetails();onOpen?.();$('tvPanel').hidden=false;}
  $('tvToggle').addEventListener('click',showTv);$('objectTv').addEventListener('click',showTv);$('closeTv').addEventListener('click',()=>{$('tvPanel').hidden=true;});
  $('pickMedia').addEventListener('click',()=>$('mediaFile').click());$('mediaFile').addEventListener('change',event=>{choose(event.target.files?.[0]);event.target.value='';});
  $('shareScreen').addEventListener('click',share);$('mediaStop').addEventListener('click',()=>stop());
  $('mediaSize').addEventListener('change',()=>{$('tvPanel').dataset.size=$('mediaSize').value;});
  $('companionSize').addEventListener('change',()=>{$('companionPanel').dataset.size=$('companionSize').value;});
  function updateFrameControls(){
    $('captureTvFrame').disabled=!active||frameBusy;
    $('saveTvFrame').disabled=!capturedFrame||!saveEnabled||frameBusy;
    $('reviewTvFrame').disabled=!capturedFrame||!reviewEnabled||frameBusy||Date.now()<reviewUntil;
  }
  function setCapabilities(snapshot){
    const capabilities=snapshot?.tv||{};saveEnabled=capabilities.saveEnabled===true&&snapshot.controlsEnabled!==false;reviewEnabled=capabilities.reviewEnabled===true&&snapshot.controlsEnabled!==false;
    $('tvReviewInfo').textContent='单帧点评会把上面这一帧发给宿主已配置的 vlm 视觉模型，可能产生调用费用。只在你点“发送此帧点评”后发送。'+(reviewEnabled?'':' 当前视觉点评不可用。');
    updateFrameControls();
    syncPlayback(capabilities.playback);
  }
  function applyRemoteControls(){
    const desired=remoteState;
    if(!desired||remoteId!==desired.id||kind!=='video')return;
    video.loop=!!desired.loop;video.muted=desired.muted!==false;video.volume=Math.max(0,Math.min(1,Number(desired.volume)||0));
    if(seekRevision!==desired.seekRevision){seekRevision=desired.seekRevision;if(Number.isFinite(desired.position))video.currentTime=desired.position;}
    if(desired.paused){video.pause();$('mediaPause').textContent='继续播放';}
    else video.play().then(()=>{$('mediaPause').textContent='暂停';}).catch(()=>{status('浏览器需要一次点击才能播放，请点“继续播放”');$('mediaPause').textContent='继续播放';});
  }
  async function receiveRemote(desired){
    stop(false);const generation=loadGeneration;remoteId=desired.id;seekRevision=-1;
    const current=()=>!signal.aborted&&generation===loadGeneration&&remoteState?.id===desired.id;
    try{
      const size=Number(desired.size),step=Number(desired.chunkSize),count=Number(desired.chunks);
      if(!Number.isSafeInteger(size)||size<=0||size>256*1024*1024||step!==196608||Math.ceil(size/step)!==count)throw Error('媒体分页信息无效');
      const bytes=new Uint8Array(size);
      for(let index=0;index<count;index++){
        if(!current())return;
        const part=await request('query','media_chunk',{media_id:desired.id,index});if(!current())return;
        const decoded=atob(part.data||'');
        if(part.id!==desired.id||part.index!==index||decoded.length!==Math.min(step,size-index*step))throw Error('媒体分块已变化');
        for(let n=0;n<decoded.length;n++)bytes[index*step+n]=decoded.charCodeAt(n);
        status('正在接收 '+desired.title+' · '+Math.round((index+1)/count*100)+'%');
      }
      if(desired.sha256&&globalThis.crypto?.subtle){
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
        if(hash!==desired.sha256)throw Error('媒体校验失败');
      }
      if(!current())return;
      url=URL.createObjectURL(new Blob([bytes],{type:desired.mime}));
      await new Promise((resolve,reject)=>{
        const finish=error=>{video.onloadeddata=null;video.onerror=null;cancelRemoteLoad=null;error?reject(error):resolve();};
        cancelRemoteLoad=()=>finish(new DOMException('媒体已取消','AbortError'));
        video.onloadeddata=()=>finish();video.onerror=()=>finish(Error('浏览器无法解码该媒体'));video.src=url;video.load();
      });
      if(!current())return;
      video.hidden=false;activate('video');applyRemoteControls();status('正在播放：'+desired.title);
    }catch(error){if(current()){stop(false);status('插件指定的视频暂不可用：'+error.message);}}
  }
  function syncPlayback(desired){
    if(!desired||desired.revision===remoteRevision)return;
    remoteRevision=desired.revision;remoteState=desired;
    if(desired.status==='stopped'){if(remoteId){stop(false);remoteId='';}return;}
    if(desired.status==='error'){if(remoteId){stop(false);remoteId='';}status(desired.error||'插件指定的视频准备失败');return;}
    if(desired.status==='loading'){status('正在准备：'+desired.title);return;}
    if(desired.status==='ready'){
      if(remoteId!==desired.id)void receiveRemote(desired);
      else applyRemoteControls();
    }
  }
  function captureFrame(){
    if(!active)return;draw();
    let data='',width=512,height=288;
    for(const candidate of [512,384,256]){
      width=candidate;height=Math.round(candidate*9/16);const frame=document.createElement('canvas');frame.width=width;frame.height=height;frame.getContext('2d').drawImage(canvas,0,0,width,height);
      for(const q of [.82,.68,.52,.36]){data=frame.toDataURL('image/webp',q);if(data.length<=48000)break;}
      if(data.length<=48000)break;
    }
    if(!data.startsWith('data:image/webp;base64,')||data.length>48000){$('tvFrameStatus').textContent='这帧暂时无法压缩到宿主接收范围，请换一帧再试';return;}
    capturedFrame={image_data:data,width,height,source:kind,capturedAt:Date.now()};$('tvFrameImage').src=data;$('tvFrameBox').hidden=false;$('tvFrameCaption').textContent=`${width} × ${height} · 当前电视单帧，仅在页面预览`;$('tvFrameStatus').textContent='单帧已截取，尚未发送或保存';frameStatus='captured';updateFrameControls();
  }
  async function submitFrame(review){
    if(!capturedFrame||frameBusy||(review?!reviewEnabled:!saveEnabled))return;
    const id=globalThis.crypto?.randomUUID?.()||'tv-frame-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    frameBusy=true;frameStatus='queued';updateFrameControls();$('tvFrameStatus').textContent=review?'正在把这一帧交给宿主视觉模型':'正在保存这一帧到房间插件';
    try{
      let result=await request('action',review?'tv_review':'tv_save_frame',{image_data:capturedFrame.image_data,request_id:id});
      if(review){reviewUntil=Date.now()+30000;setTimeout(updateFrameControls,30100);}
      for(let attempt=0;attempt<40;attempt++){
        if(result.requestId&&result.requestId!==id)throw new Error('单帧请求编号不一致');
        frameStatus=result.status||'queued';
        if(frameStatus==='complete'){
          $('tvFrameStatus').textContent=review?(result.reply||result.notice||'这帧的点评已完成'):(result.notice||('已保存到房间：'+(result.filename||result.receipt?.filename||'tv_frames')));return;
        }
        if(['error','missing','unknown'].includes(frameStatus))throw new Error(result.notice||'宿主未能确认这次单帧处理');
        $('tvFrameStatus').textContent=result.notice||(review?'宿主视觉模型正在处理这一帧':'宿主正在保存这一帧');
        await delay(1500);if(signal.aborted)return;result=await request('query','tv_status',{request_id:id});
      }
      $('tvFrameStatus').textContent='宿主仍在处理这一帧，请稍后在房间状态中查看';
    }catch(error){frameStatus='error';$('tvFrameStatus').textContent=(review?'单帧点评暂不可用：':'单帧未能保存：')+(error.message||error);}
    finally{frameBusy=false;updateFrameControls();}
  }
  $('captureTvFrame').addEventListener('click',captureFrame);$('saveTvFrame').addEventListener('click',()=>submitFrame(false));$('reviewTvFrame').addEventListener('click',()=>submitFrame(true));
  $('mediaPause').addEventListener('click',async()=>{if(video.paused){try{await video.play();$('mediaPause').textContent='暂停';}catch(error){status(error.message);}}else{video.pause();$('mediaPause').textContent='继续播放';}});
  function companion(){const state=getSnapshot();$('companionTitle').textContent=(state?.character?.name||'麦麦')+'在家';$('companionCaption').textContent=(state?.life?.activity?.name||'在家里待一会儿')+' · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});try{$('companionImage').src=capture();closeSmallDetails();$('companionPanel').hidden=false;}catch(error){reportError('这次画面没有留下：'+error.message);}}
  $('companionToggle').addEventListener('click',companion);$('refreshCompanion').addEventListener('click',companion);$('closeCompanion').addEventListener('click',()=>{$('companionPanel').hidden=true;});
  detectSharing();
  return {get active(){return active;},updateSnapshot:setCapabilities,animate(now){if(active&&kind!=='image'&&!video.paused&&video.readyState>=2&&now-lastDraw>42){draw();lastDraw=now;}},inspect:()=>({active,kind,screenSharingAllowed:canShare,mapOnTv:!!texture&&screen.material.map===texture,textureReady:active&&texture.image.width===960,paused:video.paused,frame:capturedFrame?{width:capturedFrame.width,height:capturedFrame.height,length:capturedFrame.image_data.length,source:capturedFrame.source}:null,saveEnabled,reviewEnabled,frameStatus,frameBusy}),dispose(){stop(false);texture?.dispose();if(canvas){canvas.width=canvas.height=1;}capturedFrame=null;video.onloadeddata=null;video.onerror=null;image.onload=null;image.onerror=null;},closePanels(){for(const id of ['tvPanel','companionPanel'])$(id).hidden=true;}};
}
