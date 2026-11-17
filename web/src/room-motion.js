const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

export function route(points){
  const clean=[];
  for(const p of points||[])if(Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&(!clean.length||distance(clean.at(-1),p)>1e-7))clean.push([p[0],p[1]]);
  const lengths=[0];
  for(let i=1;i<clean.length;i++)lengths.push(lengths[i-1]+distance(clean[i-1],clean[i]));
  return {points:clean,lengths,total:lengths.at(-1)||0};
}
export function at(r,arc){
  if(!r.points.length)return [0,0];
  const s=clamp(arc,0,r.total);
  for(let i=1;i<r.points.length;i++)if(s<=r.lengths[i]){
    const t=(s-r.lengths[i-1])/(r.lengths[i]-r.lengths[i-1]);
    return r.points[i-1].map((v,j)=>v+(r.points[i][j]-v)*t);
  }
  return [...r.points.at(-1)];
}
export function project(r,p,hint=0){
  let best={arc:0,distance:Infinity,point:r.points[0]||p};
  if(r.points.length===1)return {arc:0,distance:distance(p,r.points[0]),point:r.points[0]};
  for(let i=1;i<r.points.length;i++){
    const a=r.points[i-1],b=r.points[i],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz),0,1);
    const point=[a[0]+dx*t,a[1]+dz*t],d=distance(p,point),arc=r.lengths[i-1]+(r.lengths[i]-r.lengths[i-1])*t;
    if(d<best.distance-1e-6||Math.abs(d-best.distance)<1e-6&&Math.abs(arc-hint)<Math.abs(best.arc-hint))best={arc,distance:d,point};
  }
  return best;
}
export function between(r,from,to){
  const a=Math.min(from,to),b=Math.max(from,to),points=[at(r,a)];
  for(let i=1;i<r.points.length-1;i++)if(r.lengths[i]>a+1e-7&&r.lengths[i]<b-1e-7)points.push(r.points[i]);
  points.push(at(r,b));
  return from<=to?points:points.reverse();
}
function join(previous,arc,next,endArc){
  const origin=next.points[0];
  const match=Number.isFinite(endArc)&&distance(at(previous,endArc),origin)<.08?
    {arc:clamp(endArc,0,previous.total),distance:0}:project(previous,origin,arc);
  if(match.distance>.08)return null;
  const prefix=route([...between(previous,arc,match.arc),origin]);
  return {path:route([...prefix.points,...next.points.slice(1)]),offset:prefix.total};
}
function authoritativeArc(character,path,point,hint=0){
  if(Number.isFinite(character.motion?.arc))return clamp(character.motion.arc,0,path.total);
  if(!character.walking)return path.total;
  if(Array.isArray(character.path))return clamp(path.total-route([point,...character.path]).total,0,path.total);
  return project(path,point,hint).arc;
}

// The server retains full routes, so a popped waypoint or a new garden job
// does not require a world-space position reset. Only arc length is corrected.
export class RoomMotion {
  constructor(){this.reset();}
  reset(){this.path=null;this.sourcePath=null;this.offset=0;this.sourceArc=0;this.id='';this.arc=0;this.authority=null;this.lastNow=null;this.clock=null;this.minRtt=Infinity;this.position=null;this.facing=0;this.pending=null;this.recoveries=0;this.rebases=0;this.presentationPose='stand';this.presentationElevation=0;}
  serverNow(now){return this.clock===null?Date.now():now+this.clock;}
  accept(snapshot,timing={},connector=null){
    const now=Number.isFinite(timing.finishedAt)?timing.finishedAt:performance.now();
    const rtt=Number.isFinite(timing.startedAt)?clamp(now-timing.startedAt,0,4000):0;
    if(Number.isFinite(timing.startedAt))this.minRtt=Math.min(this.minRtt,rtt);
    const sampleTime=Number(snapshot.serverTime)||Date.now(),offset=sampleTime-now+(Number.isFinite(this.minRtt)?this.minRtt:0)/2;
    if(this.clock===null)this.clock=offset;
    else if(Number.isFinite(timing.startedAt))this.clock+=clamp(offset-this.clock,-120,120)*.25;
    const c=snapshot.character,p=[Number(c.position.x),Number(c.position.z)];
    const motion=c.motion;
    const id=motion?.id||[c.source,c.target?.id,c.target?.arrivalAction,c.walking?'walk':c.pose].join(':');
    const incoming=route(motion?.route||[p,...(c.path||[])]);
    if(!incoming.points.length)incoming.points.push(p);
    const bridge=connector?route(connector):null;
    if(this.path&&bridge?.points.length&&distance(bridge.points[0],this.position)<.08&&distance(bridge.points.at(-1),p)<.08){
      const anchor=authoritativeArc(c,incoming,p);
      this.path=route([...bridge.points,...between(incoming,anchor,incoming.total).slice(1)]);
      this.offset=bridge.total-anchor;this.sourcePath=incoming;this.sourceArc=anchor;this.arc=0;this.pending=null;this.recoveries++;
    }
    else if(!this.path){this.path=incoming;this.sourcePath=incoming;this.offset=0;this.arc=authoritativeArc(c,incoming,p);this.position=at(incoming,this.arc);}
    else if(id!==this.id){
      const chain=(motion?.history||[]),index=chain.findIndex(item=>item.id===this.id);
      const suffixes=index>=0?[index+1]:Array.from({length:chain.length+1},(_,i)=>i);
      let combined=null,offset=0;
      for(const suffix of suffixes){
        let candidate=this.path,arc=this.arc,candidateOffset=this.offset,prior=index>=0?chain[index]:null;
        for(const stage of [...chain.slice(suffix),{route:incoming.points}]){
          const next=join(candidate,arc,route(stage.route),prior?candidateOffset+prior.endArc:undefined);
          if(!next){candidate=null;break;}candidate=next.path;candidateOffset=next.offset;arc=0;prior=stage;
        }
        if(candidate){combined=candidate;offset=candidateOffset;break;}
      }
      if(combined){this.path=combined;this.offset=offset;this.arc=0;}
      else{
        const matched=project(incoming,this.position||p);
        if(matched.distance<=.08){this.path=route([this.position,...between(incoming,matched.arc,incoming.total)]);this.offset=distance(this.position,matched.point)-matched.arc;this.arc=0;}
        else{this.pending={x:this.position[0],z:this.position[1]};this.lastNow=now;return;}
      }
      this.sourcePath=incoming;this.sourceArc=0;
    }
    this.id=id;this.facing=this.authority?this.facing:Number(c.facing)||0;
    this.pending=null;
    this.sourceArc=authoritativeArc(c,this.sourcePath,p,this.sourceArc);
    this.authority={arc:clamp(this.offset+this.sourceArc,0,this.path.total),time:sampleTime,walking:!!c.walking,pose:c.pose||'stand',elevation:Number(c.elevation)||0,
      spot:c.target?.key||'',room:c.room,source:c.source,
      arrivalPose:c.target?.arrivalPose||c.pose||'stand',arrivalElevation:Number(c.target?.elev)||0,
      facing:Number(c.facing)||0,speed:clamp(Number(snapshot.movementSpeed)||1.15,.2,3)};
    this.lastNow=now;
  }
  sample(now=performance.now(),online=true){
    if(!this.path||!this.authority)return null;
    if(this.pending){this.lastNow=now;return {position:[...this.position],facing:this.facing,walking:false,pose:this.presentationPose,elevation:this.presentationElevation,spot:this.authority.spot,room:this.authority.room,source:this.authority.source,motionSpeed:0,syncing:true};}
    const dt=this.lastNow===null?0:clamp((now-this.lastNow)/1000,0,.15);this.lastNow=now;
    const step=Math.min(dt,.05);
    const a=this.authority,age=clamp((this.serverNow(now)-a.time)/1000,0,5);
    let target=Math.min(this.path.total,a.arc+(a.walking?age*a.speed:0));
    if(a.walking&&target<this.path.total-1e-6)target=Math.max(a.arc,target-a.speed*.06);
    const error=target-this.arc,before=at(this.path,this.arc);
    if(online&&error>0)this.arc+=Math.min(error,a.speed*clamp(1+error*.8,1,2.2)*step);
    else if(online&&!a.walking&&error<-.015)this.arc+=Math.max(error,-.25*step);
    const position=at(this.path,this.arc),moved=distance(before,position),complete=this.arc>=this.path.total-1e-5;
    if(moved>1e-5)this.facing=Math.atan2(position[0]-before[0],-(position[1]-before[1]))*180/Math.PI;
    const goal=a.walking?this.path.total:a.arc,transit=this.arc<goal-1e-5;
    const walking=online&&transit;
    if(!walking&&!a.walking&&Math.abs(error)<.025)this.facing=a.facing;
    this.position=position;
    this.presentationPose=transit?'stand':a.walking&&complete?a.arrivalPose:a.pose;
    this.presentationElevation=transit?0:a.walking&&complete?a.arrivalElevation:a.elevation;
    return {position,facing:this.facing,walking,pose:this.presentationPose,elevation:this.presentationElevation,
      motionSpeed:walking&&dt>0?moved/dt:0};
  }
  inspect(){return {id:this.id,arc:this.arc,total:this.path?.total||0,rebases:this.rebases,pending:!!this.pending,recoveries:this.recoveries};}
}
