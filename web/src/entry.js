// Only this small loader and the inert UI template belong to the dashboard entry.
const assets = __ROOM_ASSETS__;
const template = document.getElementById('room-template');
const status = document.getElementById('room-entry-status');
let inView = false, pageActive = true, session = null, queue = Promise.resolve();
let starts = 0, stops = 0, chunks = 0, lastRelease = null;
let releaseAt = 0, releaseTimer = 0, renderGraceSeconds = 600;
let clientConfig = {renderGraceSeconds:600,desktopFps:60};
const resourceCache = new Map();
const cancelled = () => new DOMException('Room closed', 'AbortError');

function stop() {
  if (!session) return;
  const old = session;
  session = null;
  old.controller.abort();
  old.root.remove();
  document.body.classList.remove('details-open','details-closed');
  delete window.__maisakaRoom;
  stops++;
  resourceCache.clear();
  status.hidden = true;
}

async function start() {
  const controller = new AbortController();
  const {signal} = controller;
  const root = document.createElement('div');
  session = {controller,root};
  starts++;
  const active = () => !signal.aborted && pageActive && ((!document.hidden && inView) || (releaseAt > Date.now()));
  const guard = () => { if (!active()) throw cancelled(); };
  function request(kind,name,args={},timing=null) {
    const run = async () => {
      guard();
      if(timing)timing.startedAt=performance.now();
      const result = await window.maibot[kind](name,args);
      if(timing)timing.finishedAt=performance.now();
      guard();
      return result;
    };
    const next = queue.then(run,run);
    queue = next.then(()=>{},()=>{});
    return next;
  }
  let timeout;
  const abort = new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(cancelled()),{once:true}));
  function fail(error){
    if(signal.aborted)return;
    stop();
    status.hidden=false;
    status.textContent=(error?.message||'打开房间失败')+'，点此重试';
  }
  try {
    status.hidden = false; status.textContent = '正在进入麦麦的小屋';
    if (!window.maibot?.ready) throw Error('请从 MaiBot 的插件页面打开房间');
    await Promise.race([window.maibot.ready,abort,new Promise((_,reject)=>{
      timeout = setTimeout(()=>reject(Error('宿主握手超时')),10000);
    })]);
    clearTimeout(timeout);
    guard();
    clientConfig = await request('query','client_config');
    renderGraceSeconds = Math.max(0, Math.min(3600, Number(clientConfig.renderGraceSeconds) || 0));
    const encoding = typeof DecompressionStream === 'function' ? 'gzip' : 'plain';
    const {size,sha256} = assets[encoding];
    const bytes = new Uint8Array(size);
    const step = 196608;
    for (let index=0,offset=0; offset<size; index++,offset+=step) {
      const part = await request('query','runtime_chunk',{encoding,index});
      chunks++;
      if (part.index!==index || part.size!==size) throw Error('房间文件已更新，请重新进入');
      const binary=atob(part.data);
      if(binary.length!==Math.min(size-offset,step)) throw Error('房间文件不完整');
      for(let i=0;i<binary.length;i++) bytes[offset+i]=binary.charCodeAt(i);
    }
    if(globalThis.crypto?.subtle){
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      if(Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')!==sha256)throw Error('房间文件校验失败');
    }
    const source = encoding==='plain' ? new TextDecoder().decode(bytes) :
      await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    guard();
    root.append(template.content.cloneNode(true));
    document.body.append(root);
    const script=document.createElement('script');
    script.textContent=source;
    let mounted=false;
    window.__attachMaisaka = mount => {
      guard();mounted=true;
      const controls=mount({root,signal,request,clientConfig,resourceCache,isVisible:()=>!document.hidden&&inView,onFailure:fail,onRelease:value=>{lastRelease=value;}});
      if(session?.controller===controller)session.resume=controls?.resume;
    };
    try { document.head.append(script); }
    finally { script.remove(); delete window.__attachMaisaka; }
    if (!mounted) throw Error('房间场景未能启动');
    if(!signal.aborted)status.hidden=true;
  } catch (error) {
    fail(error);
  } finally { clearTimeout(timeout); }
}

function sync() {
  if (!pageActive) { stop(); return; }
  if (releaseAt && Date.now() >= releaseAt) { clearTimeout(releaseTimer); releaseAt=0; stop(); }
  if (document.hidden || !inView) {
    if(session && !releaseAt){
      releaseAt=Date.now()+renderGraceSeconds*1000;
      releaseTimer=setTimeout(()=>{releaseAt=0;stop();},renderGraceSeconds*1000);
    }
    return;
  }
  const resuming=!!releaseAt;
  clearTimeout(releaseTimer); releaseAt=0;
  if (!session) void start();
  else if(resuming)session.resume?.();
}
const observer=new IntersectionObserver(entries=>{
  const last=entries[entries.length-1];
  inView=last.isIntersecting && last.intersectionRect.width>0 && last.intersectionRect.height>0;
  sync();
});
observer.observe(document.documentElement);
status.addEventListener('click',sync);
document.addEventListener('visibilitychange',sync);
function leave(){pageActive=false;clearTimeout(releaseTimer);releaseAt=0;stop();}
window.addEventListener('pagehide',leave);
document.addEventListener('freeze',sync);
window.addEventListener('pageshow',()=>{pageActive=true;sync();});
document.addEventListener('resume',()=>{pageActive=true;sync();});
window.__maisakaLifecycle=()=>({active:!!session,inView,starts,stops,chunks,lastRelease,releaseAt,renderGraceSeconds});
