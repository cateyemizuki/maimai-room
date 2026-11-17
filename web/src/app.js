import * as THREE from '../upstream/vendor/three.module.js';
import { createWorld } from './room-world.js';
import { RoomActor } from './actor.js';
import { mountRoomMedia } from './media.js';
import { mountRoomChat } from './chat.js';
import { mountGarden } from './garden-client.js';
import { FollowCameraGuard } from './follow-camera.js';
import { RoomVisibility,roofAt } from './room-visibility.js';
import roomLogo from '../../room-logo.webp';

function mountRoom({root,signal,request,onRelease,clientConfig={},resourceCache=new Map(),isVisible=()=>!document.hidden}){
const nodes=new Map(Array.from(root.querySelectorAll('[id]'),node=>[node.id,node]));
const $=id=>nodes.get(id);
for(const id of ['roomLogo','loadingLogo'])if($(id))$(id).src=roomLogo;
const timers=new Set();
function setTimeout(callback,delay){
  if(signal.aborted)return 0;
  const id=window.setTimeout(()=>{timers.delete(id);callback();},delay);
  timers.add(id);return id;
}
function clearTimeout(id){window.clearTimeout(id);timers.delete(id);}
function delay(ms){
  if(signal.aborted)return Promise.resolve();
  return new Promise(resolve=>{
    const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};
    const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});
  });
}
const clamp=THREE.MathUtils.clamp;
const text=(element,value)=>{element.textContent=String(value??'—');};
const roomNames={living:'客厅',kitchen:'厨房',dining:'餐厅',her_room:'卧室',corridor:'走廊',bathroom:'卫生间',laundry:'家政间',balcony:'阳台',foyer:'玄关',garden:'菜园',yard:'屋外小径'};
const sourceNames={webui:'面板操作',qq:'QQ 指令',tool:'自主调节',garden:'照料菜园','life-api':'生活插件','life-schedule':'生活日程','life-activity':'生活活动','room-routine':'固定作息',user:'手动设置',default:'默认','activity-inference':'活动推断',unavailable:'未接入'};
const actionNames={stand:'在家里站一会儿',walk:'正往目的地走',sit:'坐下来休息',sleep:'正在睡觉',wake:'醒来了'};
const expressionNames={neutral:'自然',happy:'开心',sleepy:'困倦',angry:'生气',sad:'低落',relaxed:'放松',surprised:'惊讶'};
const PRESETS={
  living:{center:[6.3,4.3],az:-.72,elev:.8,r:8.2},kitchen:{center:[2,2.1],az:.65,elev:.78,r:7},
  dining:{center:[2.1,5.1],az:.55,elev:.78,r:6.8},her_room:{center:[10.8,2.2],az:-.75,elev:.78,r:7.6},
  corridor:{center:[10.4,5],az:.55,elev:.8,r:6},bathroom:{center:[12,6.9],az:-.6,elev:.76,r:5.4},
  laundry:{center:[9.6,6.5],az:.5,elev:.78,r:5.2},balcony:{center:[4.6,8.2],az:.15,elev:.72,r:7},
  foyer:{center:[1,6.2],az:-.55,elev:.76,r:5.2},
  garden:{center:[6.6,-3.8],az:-2.92,elev:.85,r:20},yard:{center:[-.65,3],az:-1.8,elev:.75,r:7},
};


let state=null,receivedAt=0,host=null,online=false,modelLoading=false,actionLoading=false;
let lastDisplayedCharacter=null;
const motionOffset=new THREE.Vector2();let motionCorrectedAt=0;
let modelQuality='mobile',requestedModelQuality='mobile',modelGeneration=0;
let environmentKey='',paused=false,polling=false;
let quality=innerWidth<700?'low':'balanced',selectedRoom='living',moveMode=false;
let cameraMode=innerWidth<680?'follow':'overview';
const view={target:new THREE.Vector3(6.7,.35,4.6),az:-.62,elev:1.02,radius:19.2,full:true};
const eyeView={yaw:0,pitch:0};
const canvas=$('scene');
let renderer,world,actor,camera;
let roomMedia=null,roomChat=null,garden=null,gardenDetailsWasOpen=false;
let followGuard=null,roomVisibility=null;
const followTargets={head:new THREE.Vector3(),chest:new THREE.Vector3()};
const handAnchor={position:new THREE.Vector3(),quaternion:new THREE.Quaternion()};
const desiredPos=new THREE.Vector3(),desiredLook=new THREE.Vector3(),look=new THREE.Vector3(6.7,.35,4.6);
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
const floor=new THREE.Plane(new THREE.Vector3(0,1,0),-.02);
const marker=new THREE.Mesh(new THREE.RingGeometry(.14,.20,32),new THREE.MeshBasicMaterial({color:0xf0ddb2,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));
marker.rotation.x=-Math.PI/2;marker.visible=false;
let markerUntil=0;

function reportError(message=''){text($('interactionError'),message);$('interactionError').hidden=!message;}
function connection(mode,label){$('connection').className='status '+mode;text($('connection').querySelector('span'),label);$('connection').title=label;}
function progress(value,label){$('loadBar').style.width=clamp(value,0,100)+'%';text($('loadText'),label);}
function failModel(message){$('modelStatus').hidden=false;text($('modelStatus').querySelector('span'),message);}
function safeError(error){return String(error?.message||error||'暂时不可用').slice(0,180);}

function applySnapshot(result){
  if(signal.aborted)return;
  const value=result?.snapshot||result;
  if(!value?.character?.position||value.schemaVersion!==1)throw new Error('房间状态格式不匹配');
  const p=value.character.position;
  if(!Number.isFinite(Number(p.x))||!Number.isFinite(Number(p.z)))throw new Error('房间位置无效');
  if(state&&Number(value.serverTime)<Number(state.serverTime)&&Number(value.revision)<=Number(state.revision))return;
  const previous=state,before=previous?predictedCharacter().position:null;
  state=value;receivedAt=performance.now();motionCorrectedAt=receivedAt;motionOffset.set(0,0);online=true;
  const oldNext=previous?.character?.path?.[0],newNext=value.character.path?.[0];
  const sameLeg=before&&previous.character.walking&&value.character.walking&&
    previous.character.source===value.character.source&&previous.character.target?.id===value.character.target?.id&&
    previous.character.target?.arrivalAction===value.character.target?.arrivalAction&&
    Array.isArray(oldNext)&&Array.isArray(newNext)&&oldNext[0]===newNext[0]&&oldNext[1]===newNext[1];
  if(sameLeg){
    const fresh=predictedCharacter().position;
    motionOffset.set(before[0]-fresh[0],before[1]-fresh[1]).clampLength(0,Math.min(.18,(Number(value.movementSpeed)||1.15)*.12));
  }
  connection('online','已同步');renderStatus();
  if(value.garden)garden?.update({...value.garden,controlsEnabled:value.controlsEnabled});
  roomMedia?.updateSnapshot(value);
}

function renderStatus(){
  if(!state||signal.aborted)return;
  const c=state.character,l=state.life||{},activity=l.activity,expression=c.expression||{};
  const name=c.name||'麦麦';text(document.querySelector('.brand h1'),name+'的家');document.title=name+'的家';
  text($('activity'),activity?.name||activity?.description||actionNames[c.action]||'在家里待一会儿');
  text($('location'),(roomNames[c.room]||c.room||'家里')+(c.target?.label?' · '+c.target.label:''));
  text($('actionSource'),sourceNames[c.source]||c.source||'房间状态');
  const mood=l.mood||{};
  text($('lifeMood'),mood.available?(mood.label||'已接入'):(mood.label||'未接入生活情绪'));
  $('lifeMood').title=mood.available?'来源：'+(sourceNames[mood.source]||mood.source):'当前没有可用的生活情绪 API 数据';
  text($('expression'),(expressionNames[expression.name]||expression.name||'自然')+(expression.source&&expression.source!=='default'?' · '+(sourceNames[expression.source]||expression.source):''));
  text($('scheduleSource'),l.available?(sourceNames[l.source]||l.source||'已接入日程'):'暂未接入');
  text($('scheduleNow'),activity?.name||activity?.description||(l.available?'没有正在进行的安排':'没有可用日程'));
  text($('lifeHint'),l.source==='room-routine'?'按上海时区的房间固定作息活动。':l.available?'活动由已接入的日程接口提供。':'当前使用房间独立活动。');
  const rows=Array.isArray(l.schedule)?l.schedule.slice(0,4):[];
  $('scheduleList').replaceChildren(...rows.map(row=>{const div=document.createElement('div');div.className='schedule-item';const t=document.createElement('time');text(t,(row.day_offset?'明天 ':'')+(row.time||''));const span=document.createElement('span');text(span,row.activity||row.name);div.append(t,span);return div;}));
  const events=Array.isArray(state.room?.events)?state.room.events.slice(-2).reverse():[];
  $('events').replaceChildren(...events.map(event=>{const div=document.createElement('div');text(div,typeof event==='string'?event:event.text||event.message||event.command||'');return div;}));
  $('lamp').setAttribute('aria-pressed',String(state.room?.lamp!==false));
  $('lamp').title=state.room?.lamp!==false?'当前已开灯，点击关闭':'当前已关灯，点击打开';
  $('chatToggle').disabled=state.chat?.enabled===false||state.controlsEnabled===false;
  if(cameraMode==='follow')selectedRoom=c.room;
  document.querySelectorAll('[data-command],#lamp,#objectGo,#objectUse,#moveMode').forEach(button=>button.disabled=state.controlsEnabled===false||actionLoading);
}

async function poll(){
  if(!host||!isVisible()||signal.aborted||polling)return;
  polling=true;
  try{applySnapshot(await request('query','summary'));}
  catch(error){if(!signal.aborted){online=false;connection('error','同步中断');$('connection').title=safeError(error);}}
  finally{polling=false;}
}

async function interact(command,target=''){
  reportError();
  if(!host){reportError('请从 MaiBot 的插件自定义页面打开');return;}
  if(actionLoading||state?.controlsEnabled===false)return;
  actionLoading=true;renderStatus();
  const requestId=globalThis.crypto?.randomUUID?.()||'room-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  try{
    const result=await request('action','interact',{command,target,request_id:requestId});
    applySnapshot(result);
    if(result.ok===false)reportError(result.message||'操作未能完成');
  }catch(error){reportError('操作没有完成：'+safeError(error));}
  finally{actionLoading=false;if(!signal.aborted)renderStatus();}
}

async function loadModel(nextQuality=requestedModelQuality){
  if(!host)return;
  if(typeof nextQuality!=='string')nextQuality=requestedModelQuality;
  if(!['mobile','high'].includes(nextQuality))return;
  const generation=++modelGeneration;requestedModelQuality=nextQuality;
  const isCurrent=()=>!signal.aborted&&generation===modelGeneration;
  const checkCurrent=()=>{if(!isCurrent())throw new Error('MODEL_LOAD_SUPERSEDED');};
  modelLoading=true;$('retryModel').disabled=true;$('modelStatus').hidden=true;
  text($('modelQualityState'),(nextQuality==='high'?'精细':'标准')+'模型读取中');
  text($('modelQuality'),nextQuality==='high'?'改用标准模型':'改用精细模型');
  try{
    const encoding=typeof DecompressionStream==='function'?'gzip':'plain';
    const info=await request('query','model_info',{asset:'maisaka.glb',quality:nextQuality,encoding});checkCurrent();
    const size=Number(info.size),chunks=Number(info.chunks),chunkSize=Number(info.chunkSize);
    if(!Number.isInteger(size)||size<=0||size>20*1024*1024||!Number.isInteger(chunks)||chunks<1||chunks>107||chunkSize!==196608||Math.ceil(size/chunkSize)!==chunks)throw new Error('模型分页信息无效');
    const cacheKey=nextQuality+':'+info.revision+':'+encoding,cached=resourceCache.get(cacheKey);
    const bytes=cached||new Uint8Array(size);let offset=cached?size:0;
    for(let index=0;!cached&&index<chunks;index++){
      const part=await request('query','model_chunk',{asset:'maisaka.glb',quality:nextQuality,encoding,index});checkCurrent();
      if((info.quality&&info.quality!==nextQuality)||(part.quality&&part.quality!==nextQuality))throw new Error('模型精度与请求不匹配');
      if(part.index!==index||part.asset!=='maisaka.glb'||(part.revision&&info.revision&&part.revision!==info.revision))throw new Error('模型读取期间发生变化，请重试');
      const binary=atob(part.data||'');
      if(binary.length!==Math.min(chunkSize,size-offset))throw new Error('模型分块长度不匹配');
      for(let i=0;i<binary.length;i++)bytes[offset+i]=binary.charCodeAt(i);
      offset+=binary.length;progress(20+65*(index+1)/chunks,'正在把麦麦接到房间 · '+Math.round((index+1)/chunks*100)+'%');
    }
    if(offset!==size)throw new Error('模型数据不完整');
    // In opaque srcdoc origins SubtleCrypto may be unavailable. Length, asset,
    // revision and chunk identity are always checked; verify SHA when supported.
    if(info.sha256&&globalThis.crypto?.subtle){const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==info.sha256.toLowerCase())throw new Error('模型校验未通过');}
    checkCurrent();
    if(!cached){if(resourceCache.size>=2)resourceCache.delete(resourceCache.keys().next().value);resourceCache.set(cacheKey,bytes);}
    progress(92,'正在整理模型与动作');
    const decoded=encoding==='gzip'?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():bytes.buffer;
    if(decoded.byteLength>20*1024*1024)throw new Error('模型解压大小无效');
    checkCurrent();await actor.load(decoded,isCurrent);checkCurrent();modelQuality=nextQuality;
    $('modelStatus').hidden=true;progress(100,'房间准备好了');
  }catch(error){if(isCurrent()){failModel('角色模型暂不可用：'+safeError(error));progress(100,actor.ready?'继续使用原有模型':'房间已就绪，角色加载失败');}}
  finally{if(isCurrent()){modelLoading=false;requestedModelQuality=modelQuality;$('retryModel').disabled=false;text($('modelQualityState'),(modelQuality==='high'?'精细':'标准')+'模型');text($('modelQuality'),modelQuality==='high'?'切换标准模型':'切换精细模型');setTimeout(()=>$('loading').classList.add('hide'),200);await poll();}}
}

function predictedCharacter(){
  if(!online&&lastDisplayedCharacter)return {...lastDisplayedCharacter,walking:false,gesture:null};
  const c=state?.character;
  if(!c)return {position:[6.3,1.5],pose:'stand',elevation:0,facing:180,walking:false,expression:'neutral'};
  let pos=[Number(c.position.x),Number(c.position.z)],facing=Number(c.facing)||0;
  const path=Array.isArray(c.path)?c.path:[];
  if(c.walking&&online){
    let distance=Math.min(2.4,Math.max(0,(performance.now()-receivedAt)/1000))*(Number(state.movementSpeed)||1.15);
    for(const point of path){
      if(!Array.isArray(point)||!Number.isFinite(point[0])||!Number.isFinite(point[1]))break;
      const d=Math.hypot(point[0]-pos[0],point[1]-pos[1]);
      if(d>.0001)facing=Math.atan2(point[0]-pos[0],-(point[1]-pos[1]))*180/Math.PI;
      if(d<=distance){pos=point.slice();distance-=d;}else{pos=[pos[0]+(point[0]-pos[0])*distance/d,pos[1]+(point[1]-pos[1])*distance/d];break;}
    }
  }
  if(c.walking&&motionOffset.lengthSq()>1e-10){
    const blend=Math.exp(-Math.max(0,performance.now()-motionCorrectedAt)/180);
    pos[0]+=motionOffset.x*blend;pos[1]+=motionOffset.y*blend;
  }
  let expression=c.expression?.name||'neutral';
  // Only consume an actual life mood when it explicitly declares availability.
  const mood=state.life?.mood;
  if(expression==='neutral'&&mood?.available){const label=String(mood.label||'');if(/开心|高兴|愉快|happy/i.test(label))expression='happy';else if(/低落|伤心|sad/i.test(label))expression='sad';else if(/生气|愤怒|angry/i.test(label))expression='angry';else if(/放松|平静|relax/i.test(label))expression='relaxed';}
  const serverNow=(Number(state.serverTime)||Date.now())+performance.now()-receivedAt;
  const gesture=c.gesture?.name&&Number(c.gesture.expiresAt)>serverNow?{...c.gesture,elapsed:Math.max(0,(serverNow-Number(c.gesture.startedAt))/1000)}:null;
  return {position:pos,pose:c.pose||'stand',elevation:Number(c.elevation)||0,facing,walking:!!c.walking,expression,spot:c.target?.key||'',room:c.room,gesture,gardenWork:c.gardenWork};
}

function setCamera(mode,room){
  cameraMode=mode;
  if(room)selectedRoom=room;
  else if(mode==='follow'&&state?.character?.room)selectedRoom=state.character.room;
  if(mode==='overview'){
    if(room){const p=PRESETS[room]||PRESETS.living;view.target.set(p.center[0],.5,p.center[1]);view.az=p.az;view.elev=p.elev;view.radius=p.r;view.full=false;}
    else{view.target.set(6.7,.35,4.6);view.az=-.62;view.elev=1.02;view.radius=19.2;view.full=true;}
  }else if(mode==='eyes'){
    eyeView.yaw=0;eyeView.pitch=0;
  }else if(mode==='follow'){const char=predictedCharacter();view.az=char.pose==='lie'?-.75:Math.PI-char.facing*Math.PI/180+.42;view.elev=.56;view.radius=4.6;view.full=false;followPose=char.pose;followGuard?.reset();}
  if(camera){camera.near=mode==='eyes'?.04:.08;camera.fov=mode==='eyes'?60:40;camera.updateProjectionMatrix();}
  document.querySelectorAll('[data-camera]').forEach(b=>b.classList.toggle('active',b.dataset.camera===mode));
  $('objectCard').hidden=true;
}

let followPose='';
function characterSightTargets(char){
  const head=actor?.bones.head,chest=actor?.bones.chest;
  if(actor?.ready&&actor.mode==='3d'&&actor.pose===char.pose&&head&&chest){
    head.getWorldPosition(followTargets.head);chest.getWorldPosition(followTargets.chest);
    const dx=char.position[0]-actor.position.x,dz=char.position[1]-actor.position.y;
    followTargets.head.x+=dx;followTargets.head.y+=.14;followTargets.head.z+=dz;
    followTargets.chest.x+=dx;followTargets.chest.y+=.04;followTargets.chest.z+=dz;
  }else{
    followTargets.head.set(char.position[0],char.elevation+(char.pose==='lie'?.45:1.05),char.position[1]);
    followTargets.chest.set(char.position[0],char.elevation+(char.pose==='lie'?.3:.63),char.position[1]);
  }
  return followTargets;
}
function updateCamera(dt,char){
  followGuard.setRoom(roofAt(char.position,roomVisibility.room));
  const aspect=canvas.clientWidth/Math.max(1,canvas.clientHeight);
  if(cameraMode==='eyes'){
    const targets=characterSightTargets(char);
    desiredPos.copy(targets.head);
    const yaw=Math.PI-char.facing*Math.PI/180+eyeView.yaw;
    const direction=new THREE.Vector3(Math.sin(yaw)*Math.cos(eyeView.pitch),Math.sin(eyeView.pitch),Math.cos(yaw)*Math.cos(eyeView.pitch));
    desiredPos.addScaledVector(direction,.08);
    desiredLook.copy(desiredPos).addScaledVector(direction,4);
  }else{
    if(cameraMode==='follow'){
      if(followPose!==char.pose){view.az=char.pose==='lie'?-.75:Math.PI-char.facing*Math.PI/180+.42;view.elev=char.pose==='lie'?.73:.56;followPose=char.pose;followGuard?.reset();}
      view.target.set(char.position[0],char.elevation+(char.pose==='lie'?.35:.75),char.position[1]);
    }
    const radius=view.radius*(garden?.isOpen?Math.max(1,1.18/aspect):view.full?Math.max(1,1.4/aspect):Math.max(1,.68/aspect));
    desiredPos.set(view.target.x+Math.sin(view.az)*radius*Math.cos(view.elev),view.target.y+Math.sin(view.elev)*radius,view.target.z+Math.cos(view.az)*radius*Math.cos(view.elev));
    if(cameraMode==='follow')followGuard?.resolve({focus:view.target,az:view.az,elev:view.elev,radius,targets:characterSightTargets(char),dt,manual:!!drag},desiredPos);
    desiredLook.copy(view.target);
  }
  if(cameraMode==='overview')followGuard.protectRoofView(desiredPos,characterSightTargets(char));
  camera.position.lerp(desiredPos,1-Math.exp(-dt*5.5));look.lerp(desiredLook,1-Math.exp(-dt*6));camera.lookAt(look);
  if(cameraMode==='follow'){followGuard?.protectTransition(camera.position,followTargets,desiredPos);camera.lookAt(look);}
  if(cameraMode==='overview'){followGuard.protectRoofView(camera.position,followTargets);camera.lookAt(look);}
  if(world.scene.fog){world.scene.fog.near=Math.max(38,camera.position.distanceTo(desiredLook)+12);world.scene.fog.far=world.scene.fog.near+80;}
  if(roomVisibility.update(camera.position,characterSightTargets(char),char,{dt,firstPerson:cameraMode==='eyes'}))renderer.shadowMap.needsUpdate=true;
}

function inspectObject(data){
  selectedObject=data;text($('objectTitle'),data.title);text($('objectDescription'),data.sub);$('objectCard').hidden=false;
  const rest=['sofa','bed','desk','dining','chair','toilet','rug','tv'].includes(data.spot);
  $('objectUse').hidden=!rest;text($('objectUse'),data.spot==='bed'?'去这里睡觉':'坐下来');
  $('objectTv').hidden=data.spot!=='tv';
}
let selectedObject=null;
function objectTarget(data){return data.room+'.'+data.spot;}

function bindUI(){
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(button&&!button.disabled)emitInteraction('button',{control:button.id||button.dataset.command||button.dataset.camera||'garden-control',camera:button.dataset.camera||'',command:button.dataset.command||'',target:button.dataset.target||''});
  },{signal,capture:true});
  document.addEventListener('change',event=>{
    const control=event.target;
    if(control.matches('select,input[type=checkbox],input[type=range]')){
      emitInteraction('control.change',{control:control.id,kind:control.type==='checkbox'?(control.checked?'on':'off'):String(control.value)});
    }else if(control.id==='mediaFile'&&control.files?.length){
      emitInteraction('media.select',{control:'mediaFile',kind:control.files[0].type});
    }
  },{signal});

  document.querySelectorAll('[data-command]').forEach(b=>b.addEventListener('click',()=>interact(b.dataset.command,b.dataset.target||'')));
  $('lamp').addEventListener('click',()=>interact('lamp'));
  $('retryModel').addEventListener('click',()=>loadModel());
  $('modelQuality').addEventListener('click',()=>loadModel(requestedModelQuality==='high'?'mobile':'high'));
  $('charMode').addEventListener('click',()=>{const mode=actor.mode==='3d'?'2d':'3d';actor.setMode(mode);text($('charMode'),mode==='2d'?'切换 3D':'切换立绘');});
  const toggleDetails=()=>{const small=innerWidth<=1100;const show=small?!document.body.classList.contains('details-open'):document.body.classList.contains('details-closed');document.body.classList.toggle('details-open',show);document.body.classList.toggle('details-closed',!show);$('detailsToggle').setAttribute('aria-expanded',String(show));};
  $('detailsToggle').addEventListener('click',toggleDetails);$('closeDetails').addEventListener('click',toggleDetails);
  $('detailsToggle').setAttribute('aria-expanded',String(innerWidth>1100));
  $('helpToggle').addEventListener('click',()=>{$('help').hidden=!$('help').hidden;});$('closeHelp').addEventListener('click',()=>{$('help').hidden=true;});
  $('closeObject').addEventListener('click',()=>{$('objectCard').hidden=true;});
  $('objectGo').addEventListener('click',()=>{if(selectedObject)interact('walk',objectTarget(selectedObject));});
  $('objectUse').addEventListener('click',()=>{if(selectedObject)interact(selectedObject.spot==='bed'?'sleep':'sit',objectTarget(selectedObject));});
  document.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.camera,b.dataset.camera==='eyes'?state?.character?.room:null)));
  $('moveMode').addEventListener('click',()=>{moveMode=!moveMode;canvas.classList.toggle('picking',moveMode);$('moveMode').setAttribute('aria-pressed',String(moveMode));});
  $('quality').addEventListener('click',()=>{quality=quality==='low'?'balanced':'low';applyQuality();});
  window.addEventListener('keydown',event=>{
    if(event.key==='Escape'){$('help').hidden=true;$('objectCard').hidden=true;document.body.classList.remove('details-open');roomMedia?.closePanels();$('chatPanel').hidden=true;garden?.setOpen(false);}
  },{signal});
}

const touches=new Map();let drag=null,pinch=0;
function cast(event){const r=canvas.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);}
function floorPoint(event){cast(event);const p=raycaster.ray.intersectPlane(floor,new THREE.Vector3());if(!p)return null;const rooms=[[0,0,4.2,7.6],[4.2,0,8.4,7.6],[8.4,0,13.2,8.2],[0,7.6,8.2,9],[-1.05,-7.55,13.15,-.25],[-1.05,-.25,-.2,7]];return rooms.some(([x0,z0,x1,z1])=>p.x>=x0&&p.x<=x1&&p.z>=z0&&p.z<=z1)?[p.x,p.z]:null;}
function emitInteraction(name,detail={}){
  if(signal.aborted||!host)return;
  const request_id=globalThis.crypto?.randomUUID?.()||'click-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  void request('action','ui_event',{name,detail:JSON.stringify(detail),request_id}).catch(()=>{});
}
function selectObjectAt(event){
  cast(event);
  let wallDistance=Infinity;
  for(const wall of world.walls){
    if(wall.opacity<.55)continue;
    for(const crossing of raycaster.intersectObject(wall.mesh,false)){
      wallDistance=Math.min(wallDistance,crossing.distance);
    }
  }
  for(const roof of world.roofs)if(roof.mesh.visible&&roof.opacity>=.55){
    for(const crossing of raycaster.intersectObject(roof.mesh,false))wallDistance=Math.min(wallDistance,crossing.distance);
  }
  const hit=raycaster.intersectObjects(world.hotspots,false).find(row=>row.distance<=wallDistance+.04);
  if(hit){inspectObject(hit.object.userData.hotspot);emitInteraction('object.select',{room:hit.object.userData.hotspot.room,spot:hit.object.userData.hotspot.spot});}
  else $('objectCard').hidden=true;
}
function guideAt(event){
  if(garden?.handlePointer(event)){emitInteraction('garden.plot',{plot:garden.inspect().selected});return;}
  const point=floorPoint(event);
  if(!point){reportError('请点可行走的地面');return;}
  marker.position.set(point[0],.03,point[1]);marker.visible=true;markerUntil=performance.now()+2000;
  emitInteraction('ground.guide',{target:point.map(v=>v.toFixed(2)).join(',')});
  void interact('walk',point.map(v=>v.toFixed(2)).join(','));
}
function freeFromCurrentCamera(){
  if(cameraMode==='overview')return;
  const focus=look.clone(),delta=camera.position.clone().sub(focus),radius=Math.max(.5,delta.length());
  setCamera('overview');
  view.target.copy(focus);view.radius=radius;view.az=Math.atan2(delta.x,delta.z);view.elev=Math.asin(clamp(delta.y/radius,-1,1));view.full=false;
}
function bindCanvas(){
  let singleTimer=0,wheelTimer=0,lastMiddle=null;
  canvas.addEventListener('auxclick',event=>event.preventDefault());
  window.addEventListener('blur',()=>{drag=null;touches.clear();lastMiddle=null;clearTimeout(singleTimer);},{signal});
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.button!==1)return;
    e.preventDefault();clearTimeout(singleTimer);
    touches.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);
    drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,button:e.button};
    if(touches.size===2){const[a,b]=[...touches.values()];pinch=Math.hypot(a.x-b.x,a.y-b.y);drag.moved=true;}
  });
  canvas.addEventListener('pointermove',e=>{
    if(!touches.has(e.pointerId)||!drag)return;
    touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touches.size===2){
      const[a,b]=[...touches.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);
      if(pinch>0)view.radius=clamp(view.radius*pinch/Math.max(1,distance),2.3,33);
      pinch=distance;drag.moved=true;drag.kind="pinch";return;
    }
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>4)drag.moved=true;
    if(drag.moved&&drag.button===1){
      freeFromCurrentCamera();
      const scale=2*camera.position.distanceTo(view.target)*Math.tan(camera.fov*Math.PI/360)/Math.max(1,canvas.clientHeight);
      const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);right.y=0;right.normalize();
      const forward=new THREE.Vector3(-right.z,0,right.x);
      view.target.addScaledVector(right,-dx*scale).addScaledVector(forward,dy*scale);
      view.target.x=clamp(view.target.x,-12,24);view.target.z=clamp(view.target.z,-18,18);view.full=false;
    }else if(drag.moved&&cameraMode==='eyes'){
      eyeView.yaw-=dx*.004;eyeView.pitch=clamp(eyeView.pitch-dy*.003,-.9,.9);
    }else if(drag.moved){
      view.az-=dx*.006;view.elev=clamp(view.elev+dy*.004,.08,1.45);
    }
    drag.x=e.clientX;drag.y=e.clientY;
  });
  canvas.addEventListener('pointerup',e=>{
    touches.delete(e.pointerId);
    if(!drag)return;
    const completed=drag;
    if(!completed.moved&&touches.size===0){
      if(completed.button===1){
        const now=performance.now();
        if(lastMiddle&&now-lastMiddle.time<350&&Math.hypot(e.clientX-lastMiddle.x,e.clientY-lastMiddle.y)<8){
          selectObjectAt(e);lastMiddle=null;
        }else lastMiddle={time:now,x:e.clientX,y:e.clientY};
      }else{
        const event={clientX:e.clientX,clientY:e.clientY};
        singleTimer=setTimeout(()=>{
          if(moveMode){guideAt(event);return;}
          if(garden?.handlePointer(event)){emitInteraction('garden.plot',{plot:garden.inspect().selected});return;}
          cast(event);
          const hit=actor.ready&&raycaster.intersectObject(actor.group,true).some(row=>row.object.isMesh);
          if(hit){emitInteraction('character.pet');void interact('pet');}
        },260);
      }
    }else if(completed.moved){lastMiddle=null;if(!touches.size)emitInteraction(completed.kind==='pinch'?'camera.zoom':completed.button===1?'camera.pan':'camera.orbit',{camera:cameraMode});}
    if(!touches.size){drag=null;pinch=0;}else{const p=[...touches.values()][0];drag.x=p.x;drag.y=p.y;drag.moved=true;}
  });
  canvas.addEventListener('pointercancel',e=>{touches.delete(e.pointerId);drag=null;pinch=0;});
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    if(cameraMode==='eyes'){camera.fov=clamp(camera.fov+e.deltaY*.008,35,75);camera.updateProjectionMatrix();}
    else view.radius=clamp(view.radius*Math.exp(e.deltaY*.001),2.3,33);
    clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>emitInteraction('camera.zoom',{camera:cameraMode}),180);
  },{passive:false});
  canvas.addEventListener('dblclick',e=>{if(e.button===0){e.preventDefault();clearTimeout(singleTimer);guideAt(e);}});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();failModel('图形渲染已暂停，请刷新页面恢复');paused=true;});
}

function applyQuality(){
  const low=quality==='low';renderer.setPixelRatio(Math.min(devicePixelRatio||1,low?1:1.5));renderer.shadowMap.enabled=!low;renderer.shadowMap.needsUpdate=true;world.quality=quality;text($('quality'),low?'省电画质':'标准画质');resize();
}
function resize(){const width=canvas.clientWidth||innerWidth,height=canvas.clientHeight||innerHeight;renderer.setSize(width,height,false);camera.aspect=width/Math.max(1,height);camera.clearViewOffset();if(garden?.isOpen){const panel=$('garden-panel');if(width>900)camera.setViewOffset(width,height,(panel?.getBoundingClientRect().width||360)*.52,0,width,height);else camera.setViewOffset(width,height,0,height*.23,width,height);}camera.updateProjectionMatrix();$('detailsToggle').setAttribute('aria-expanded',String(innerWidth>1100?!document.body.classList.contains('details-closed'):document.body.classList.contains('details-open')));}
let lastTime=performance.now(),nextFrameAt=0,frameCount=0,frameId=0,observer=null;
function animate(now){
  if(paused||signal.aborted)return;
  frameId=requestAnimationFrame(animate);
  if(!isVisible()){lastTime=now;return;}
  const fps=quality==='low'?24:Math.max(24,Math.min(120,Number(clientConfig.desktopFps)||60));
  const period=1000/fps;
  if(now<nextFrameAt-.5)return;
  nextFrameAt=now-nextFrameAt>period*2?now+period:nextFrameAt+period;
  const dt=Math.min(.12,Math.max(.001,(now-lastTime)/1000));lastTime=now;
  const char=predictedCharacter();lastDisplayedCharacter=char;
  if(actor.ready||actor.mode==='2d')actor.update(dt,camera,char,cameraMode);updateCamera(dt,char);roomMedia?.animate(now);
  const hand=actor.mode==='3d'?actor.bones.rightHand:null;
  if(hand){hand.localToWorld(handAnchor.position.set(0,.035,0));hand.getWorldQuaternion(handAnchor.quaternion);}
  garden?.updateCharacter(char,actor.group.position,actor.group.rotation.y,hand?handAnchor:null);garden?.tick(now);
  if(marker.visible&&now>markerUntil)marker.visible=false;
  if(frameCount++%25===0){
    const date=new Date();text($('clock'),date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}));
    world.setClock(date.getHours(),date.getMinutes());
    const hour=Number.isFinite(state?.room?.hour)?state.room.hour:date.getHours()+date.getMinutes()/60;
    const asleep=char.pose==='lie';const kind=roomMedia?.active?'tv':asleep?'sleep':state?.character?.target?.key==='desk'?'desk':state?.character?.target?.key==='sofa'?'tv':'idle';
    const key=[Math.floor(hour*20),state?.room?.lamp,asleep,kind,roomMedia?.active].join(':');
    if(key!==environmentKey){environmentKey=key;const update=world.updateEnvironment({hour,lamp:state?.room?.lamp!==false,asleep,kind});if(update.shadowDirty)renderer.shadowMap.needsUpdate=true;}
    if(online&&now-receivedAt>11000){online=false;connection('error','状态已过期');}
  }
  renderer.render(world.scene,camera);
}

async function boot(){
  try{
    progress(5,'正在摆好房间里的家具');
    renderer=new THREE.WebGLRenderer({canvas,antialias:quality!=='low',alpha:false,powerPreference:quality==='low'?'low-power':'default'});
    renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.04;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
    world=createWorld(renderer,{quality});followGuard=new FollowCameraGuard(world);roomVisibility=new RoomVisibility(world.walls,world.roofs);world.scene.add(marker);actor=new RoomActor(world.scene);
    camera=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.08,160);camera.position.set(-3,15,18);
    setCamera(cameraMode);applyQuality();bindUI();bindCanvas();
    roomMedia=mountRoomMedia({world,reportError,request,signal,delay,setTimeout,$,getSnapshot:()=>state,onOpen:()=>{garden?.setOpen(false);setCamera('overview','living');view.target.set(6.3,1.1,.55);view.az=0;view.elev=.17;view.radius=4.7;},capture:()=>{renderer.render(world.scene,camera);return canvas.toDataURL('image/png');}});
    roomChat=mountRoomChat({request,signal,delay,$,isVisible,isModelLoading:()=>modelLoading,getName:()=>state?.character?.name||'麦麦'});
    garden=mountGarden({world,renderer,camera,hostQuery:(name,args)=>request('query',name,args),hostAction:(name,args)=>request('action',name,args),onError:reportError,onSnapshot:applySnapshot,onOpen:()=>{gardenDetailsWasOpen=getComputedStyle($('details')).display!=='none';document.body.classList.add('details-closed');document.body.classList.remove('details-open');setCamera('overview','garden');resize();},onClose:()=>{if(gardenDetailsWasOpen&&innerWidth>1100)document.body.classList.remove('details-closed');resize();}});
    window.addEventListener('resize',resize,{signal});observer=new ResizeObserver(()=>{if(!signal.aborted)resize();});observer.observe(canvas);
    progress(18,'等待 MaiBot 房间桥接');frameId=requestAnimationFrame(animate);
    host=window.maibot;
    if(!host?.ready||!host.query||!host.action)throw new Error('请从 MaiBot 的插件自定义页面打开');
    await poll();if(signal.aborted)return;await loadModel();
    async function nextPoll(){if(signal.aborted)return;await poll();setTimeout(nextPoll,2000);}
    setTimeout(nextPoll,2000);
  }catch(error){connection('error','未连接');failModel(safeError(error));text($('activity'),'房间尚未连接');text($('lifeHint'),safeError(error));progress(100,'场景已就绪');$('loading').classList.add('hide');}
}

// Read-only diagnostics for local and host acceptance. No action bypass exists.
window.__maisakaRoom={inspect:()=>({connected:online,modelLoading,modelQuality,requestedModelQuality,characterMode:actor?.mode,model:actor?.info||null,modelReady:!!actor?.ready,clip:actor?.active,camera:cameraMode,room:selectedRoom,quality,state,frame:frameCount,drawCalls:renderer?.info.render.calls,savedDrawCalls:world?.batchedDraws??0,triangles:renderer?.info.render.triangles,cameraSettled:camera?.position.distanceTo(desiredPos),cameraRequested:{az:view.az,elev:view.elev,radius:view.radius,target:view.target.toArray()},followSightlines:followGuard&&camera?followGuard.inspect(camera.position,characterSightTargets(predictedCharacter())):null,media:roomMedia?.inspect(),chat:roomChat?.inspect(),garden:garden?.inspect(),cameraPosition:camera?.position.toArray(),canvas:{width:canvas.clientWidth,height:canvas.clientHeight},scene:{visibility:roomVisibility?.inspect(),foundation:world?.siteBounds,ceiling:!!world?.ceiling.visible},actor:actor?{rightUpperArm:actor.bones.rightUpperArm?.quaternion.toArray(),rightHand:actor.bones.rightHand?.quaternion.toArray(),rightHandPosition:actor.bones.rightHand?.getWorldPosition(new THREE.Vector3()).toArray(),rightHandWorld:actor.bones.rightHand?.getWorldQuaternion(new THREE.Quaternion()).toArray(),position:actor.group.position.toArray(),rotation:actor.group.rotation.toArray(),pose:actor.pose,expression:actor.expression,hips:actor.hips?.quaternion.toArray(),hipsPosition:actor.hips?.getWorldPosition(new THREE.Vector3()).toArray(),footPosition:actor.model?.getObjectByName('leftFoot')?.getWorldPosition(new THREE.Vector3()).toArray(),head:actor.model?.getObjectByName('head')?.quaternion.toArray(),headPosition:actor.model?.getObjectByName('head')?.getWorldPosition(new THREE.Vector3()).toArray(),chestPosition:actor.model?.getObjectByName('chest')?.getWorldPosition(new THREE.Vector3()).toArray(),leg:actor.model?.getObjectByName('leftUpperLeg')?.quaternion.toArray(),morphs:actor.morphs.map(m=>({names:m.morphTargetDictionary,weights:[...m.morphTargetInfluences]}))}:null}),projectActor:()=>{if(!actor)return null;const p=actor.group.position.clone().add(new THREE.Vector3(0,1.05,0)).project(camera);return{x:(p.x*.5+.5)*canvas.clientWidth,y:(-p.y*.5+.5)*canvas.clientHeight};},projectPoint:point=>{const p=new THREE.Vector3(point[0],.02,point[1]).project(camera);return{x:(p.x*.5+.5)*canvas.clientWidth,y:(-p.y*.5+.5)*canvas.clientHeight};},projectHotspot:title=>{const h=world?.hotspots.find(o=>o.userData.hotspot?.title===title);if(!h)return null;const p=h.position.clone().project(camera);return{x:(p.x*.5+.5)*canvas.clientWidth,y:(-p.y*.5+.5)*canvas.clientHeight};}};
signal.addEventListener('abort',()=>{
  paused=true;modelGeneration++;cancelAnimationFrame(frameId);
  for(const id of timers)window.clearTimeout(id);
  timers.clear();observer?.disconnect();touches.clear();
  roomMedia?.dispose();garden?.destroy();actor?.dispose();world?.dispose();
  marker.removeFromParent();marker.geometry.dispose();marker.material.dispose();
  renderer?.dispose();renderer?.forceContextLoss();
  onRelease({frames:frameCount,contextLost:renderer?.getContext().isContextLost()??true,timers:timers.size});
},{once:true});
boot();
return {resume(){
  if(signal.aborted)return;
  lastTime=performance.now();nextFrameAt=0;online=false;
  connection('pending','正在同步');void poll();
}};
}
window.__attachMaisaka(mountRoom);
