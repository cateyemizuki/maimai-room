import * as THREE from '../upstream/vendor/three.module.js';

const clamp=THREE.MathUtils.clamp;
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const envelope=(t,start=.22,end=.78)=>smooth(t/start)*(1-smooth((t-end)/(1-end)));
const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const q=(x=0,y=0,z=0)=>new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z));
const MOUTH=v(-.0024,.0823,.238);
const GRIPS={right:v(-.004,.028,-.010),left:v(.004,.028,-.010)};
const CUP_GRIP=v(-.05-.031*Math.SQRT1_2,.045,-.05-.031*Math.SQRT1_2);
const CUP_LIP=v(0,.085,-.047),SNACK_GRIP=v(-.055,-.035,-.07),SNACK_LIP=v(0,0,-.035);

export function expressionWeights(expression,blink=0,{sleeping=false,faceAge=0,gesture=null}={}){
  const w={blink:0,blinkleft:0,blinkright:0,happy:0,angry:0,sad:0,relaxed:0,surprised:0,aa:0,ih:0,ou:0,ee:0,oh:0};
  if(sleeping){w.blink=1;return w;}
  w.blink=blink;
  if(expression==='happy'){w.happy=1;w.blink=.4;}
  else if(expression==='sleepy'){w.blink=1;w.relaxed=.2;}
  else if(expression==='angry'){w.angry=.85;w.ee=.12;}
  else if(expression==='sad'){w.sad=.85;w.oh=.12;}
  else if(expression==='relaxed'){w.relaxed=.85;w.blink=Math.max(blink,.12);}
  else if(expression==='surprised'){w.surprised=.85;w.oh=.5;}
  else if(expression==='delighted'){w.happy=.55;w.surprised=.45;w.oh=.32;}
  else if(expression==='pout'){w.sad=.65;w.ou=.55;w.blink=Math.max(blink,.12);}
  else if(expression==='wink'){
    const phase=faceAge%3.1,pulse=phase<.65?Math.sin(phase/.65*Math.PI):0;
    w.happy=.2;w.blink=0;w.blinkleft=Math.max(.88*pulse,.88*blink);w.blinkright=.88*blink;
  }
  if(gesture){
    const age=Number(gesture.elapsed)||0,duration=Math.max(.1,(gesture.expiresAt-gesture.startedAt)/1000),t=clamp(age/duration,0,1),e=envelope(t);
    if(gesture.name==='pet'){w.happy=Math.max(w.happy,.65*e);w.relaxed=Math.max(w.relaxed,.35*e);w.blink=Math.max(w.blink,.50*e);}
    if(gesture.name==='poke'){w.surprised=Math.max(w.surprised,.9*e);w.oh=Math.max(w.oh,.3*e);}
    if(gesture.name==='feed'&&t>.25&&t<.76){w.aa=Math.max(w.aa,.20*Math.abs(Math.sin(age*12))*e);w.ih=Math.max(w.ih,.17*Math.abs(Math.cos(age*12))*e);}
    if(gesture.name==='water'){w.ou=Math.max(w.ou,.45*e);w.oh=Math.max(w.oh,.12*e);}
    if(gesture.name==='play'||gesture.name==='dance')w.happy=Math.max(w.happy,.7*e);
    if(gesture.name==='stretch')w.relaxed=Math.max(w.relaxed,.65*e);
  }
  for(const name of Object.keys(w))w[name]=clamp(w[name],0,1);
  return w;
}

function mesh(geometry,material,position){const m=new THREE.Mesh(geometry,material);if(position)m.position.copy(position);return m;}
function dispose(root){const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)ms.add(o.material);});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());}

export class InteractionRig {
  constructor(scene,actor){
    this.actor=actor;this.bones=actor.bones;this.applied=false;this.debug={active:false};
    this.owned=Object.entries(this.bones).filter(([name])=>/head|neck|spine|chest|arm|hand|shoulder|thumb|index|middle|ring|little/i.test(name))
      .map(([,bone])=>({bone,base:new THREE.Quaternion()}));
    this.props=new THREE.Group();this.props.name='Temporary interaction objects';this.props.visible=false;scene.add(this.props);
    this.items={};
  }
  restore(){if(!this.applied)return;for(const item of this.owned)item.bone.quaternion.copy(item.base);this.applied=false;}
  capture(){for(const item of this.owned)item.base.copy(item.bone.quaternion);this.applied=true;}
  bend(name,x=0,y=0,z=0){const bone=this.bones[name];if(bone)bone.quaternion.multiply(q(x,y,z)).normalize();}
  fingers(side,amount){
    for(const [name,bone] of Object.entries(this.bones))if(name.startsWith(side)&&/Index|Middle|Ring|Little/.test(name)){
      const strength=/Proximal/.test(name)?.48:/Intermediate/.test(name)?.32:.18;
      bone.quaternion.multiply(q(-strength*amount,0,0));
    }
    this.bend(side+'ThumbProximal',0,0,(side==='right'?-.25:.25)*amount);
  }
  turn(bone,from,to){
    if(from.lengthSq()<1e-10||to.lengthSq()<1e-10)return;
    const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const delta=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
    const local=parent.clone().invert().multiply(delta).multiply(parent);
    bone.quaternion.premultiply(local).normalize();bone.updateWorldMatrix(true,true);
  }
  solveGrip(side,target,orientation,blend){
    const upper=this.bones[side+'UpperArm'],lower=this.bones[side+'LowerArm'],hand=this.bones[side+'Hand'];
    if(!upper||!lower||!hand)return null;
    this.actor.group.updateWorldMatrix(true,true);
    if(blend<=1e-6)return hand.localToWorld(GRIPS[side].clone());
    const scale=hand.getWorldScale(v()).x;
    const initialGrip=hand.localToWorld(GRIPS[side].clone());
    const grip=initialGrip.lerp(target,blend);
    const handQ=hand.getWorldQuaternion(new THREE.Quaternion()).slerp(orientation,blend);
    const goal=grip.clone().sub(GRIPS[side].clone().multiplyScalar(scale).applyQuaternion(handQ));
    const origin=upper.getWorldPosition(v()),elbow=lower.getWorldPosition(v()),tip=hand.getWorldPosition(v());
    const l1=origin.distanceTo(elbow),l2=elbow.distanceTo(tip),axis=goal.clone().sub(origin);
    const d=clamp(axis.length(),Math.abs(l1-l2)+.0001*blend,l1+l2-.001*blend);axis.normalize();
    const headQ=this.bones.head.getWorldQuaternion(new THREE.Quaternion());
    const desiredPole=v(side==='right'?-.25:.25,-.35,-.15).applyQuaternion(headQ);
    desiredPole.addScaledVector(axis,-desiredPole.dot(axis)).normalize();
    const pole=elbow.clone().sub(origin);pole.addScaledVector(axis,-pole.dot(axis));
    if(pole.lengthSq()<1e-12)pole.copy(desiredPole);else pole.normalize();
    const turn=Math.atan2(axis.dot(pole.clone().cross(desiredPole)),clamp(pole.dot(desiredPole),-1,1));
    pole.applyAxisAngle(axis,turn*smooth(blend)).normalize();
    const along=(l1*l1+d*d-l2*l2)/(2*d),away=Math.sqrt(Math.max(0,l1*l1-along*along));
    const wantedElbow=origin.clone().addScaledVector(axis,along).addScaledVector(pole,away);
    this.turn(upper,elbow.clone().sub(origin),wantedElbow.sub(origin));
    const nextElbow=lower.getWorldPosition(v()),nextTip=hand.getWorldPosition(v());
    const reachable=origin.clone().addScaledVector(axis,d);
    this.turn(lower,nextTip.sub(nextElbow),reachable.sub(nextElbow));
    const parentQ=hand.parent.getWorldQuaternion(new THREE.Quaternion());
    hand.quaternion.copy(parentQ.invert().multiply(handQ));hand.updateWorldMatrix(true,true);
    return hand.localToWorld(GRIPS[side].clone());
  }
  item(kind){
    if(this.items[kind])return this.items[kind];
    const group=new THREE.Group();group.name='Interaction '+kind;
    const material=color=>new THREE.MeshStandardMaterial({color,roughness:.72,metalness:0});
    if(kind==='cup'){
      const porcelain=material(0xf3e8cf),tea=material(0x9a6336);
      group.add(mesh(new THREE.CylinderGeometry(.047,.039,.08,16,1,true),porcelain,v(0,.04,0)));
      group.add(mesh(new THREE.CylinderGeometry(.039,.039,.006,16),porcelain,v(0,.003,0)));
      const rim=mesh(new THREE.TorusGeometry(.047,.004,6,20),porcelain,v(0,.083,0));rim.rotation.x=Math.PI/2;group.add(rim);
      const handle=mesh(new THREE.TorusGeometry(.031,.007,6,20),porcelain,v(-.05,.045,-.05));handle.rotation.y=-Math.PI/4;group.add(handle);
      group.add(mesh(new THREE.CylinderGeometry(.043,.043,.003,16),tea,v(0,.068,0)));
    }else if(kind==='snack'){
      const cookie=mesh(new THREE.SphereGeometry(.038,12,8),material(0xd99c58));cookie.scale.y=.5;group.add(cookie);
      const chocolate=material(0x6c4634);
      for(const [x,z] of [[-.014,.012],[.014,.008],[0,-.016]])group.add(mesh(new THREE.SphereGeometry(.004,6,4),chocolate,v(x,.017,z)));
      const end=v(0,-.003,-.015),direction=end.clone().sub(SNACK_GRIP);
      const stick=mesh(new THREE.CylinderGeometry(.006,.006,direction.length(),6),material(0xc89962),SNACK_GRIP.clone().lerp(end,.5));
      stick.quaternion.setFromUnitVectors(v(0,1,0),direction.normalize());stick.name='Snack handle';group.add(stick);
    }else{
      group.add(mesh(new THREE.IcosahedronGeometry(.047,1),material(0xe8a65d)));
      const band=mesh(new THREE.TorusGeometry(.047,.005,5,16),material(0x7e9b7e));group.add(band);
    }
    this.props.add(group);this.items[kind]=group;return group;
  }
  placeItem(kind,hand,orientation,grip,scale){
    const item=this.item(kind);item.visible=true;item.quaternion.copy(orientation);item.scale.setScalar(scale);
    item.position.copy(hand).sub(grip.clone().multiplyScalar(scale).applyQuaternion(orientation));
    item.updateWorldMatrix(true,true);
    return item;
  }
  apply(gesture,{walking=false,sleeping=false,sitting=false,native=false}={}){
    this.props.visible=false;for(const item of Object.values(this.items))item.visible=false;
    this.debug={active:false};
    if(!gesture||walking||sleeping)return;
    const age=Number(gesture.elapsed)||0,duration=Math.max(.1,(gesture.expiresAt-gesture.startedAt)/1000),t=clamp(age/duration,0,1),e=envelope(t);
    this.debug={active:true,name:gesture.name,phase:t,prop:null,gripError:null,mouthError:null};
    if(this.actor.mode==='2d'){this.sprite(gesture.name,age,t,e);return;}
    if(native)return;
    this.capture();
    const name=gesture.name;
    if(name==='pet'){
      this.bend('head',.12*e,0,-.10*e);this.bend('neck',.04*e,0,0);
      this.actor.group.updateWorldMatrix(true,true);
      const head=this.bones.head,target=head.localToWorld(v(.17,.025,.08));
      this.solveGrip('left',target,head.getWorldQuaternion(new THREE.Quaternion()).multiply(q(0,Math.PI*.75,0)),e);
    }else if(name==='poke'){
      const recoil=Math.exp(-age*1.5)*Math.sin(Math.min(1,age/.2)*Math.PI/2);
      this.bend('chest',-.12*recoil,-.14*recoil,.08*recoil);this.bend('head',-.12*recoil,.20*recoil,0);
      this.bend('leftUpperArm',-.25*recoil,0,-.22*recoil);this.bend('rightUpperArm',-.25*recoil,0,.22*recoil);
      this.bend('leftLowerArm',-.45*recoil);this.bend('rightLowerArm',-.45*recoil);
    }else if(name==='feed'||name==='water'){
      this.bend('head',.04*e,0,.025*e);
      this.actor.group.updateWorldMatrix(true,true);
      const head=this.bones.head,scale=head.getWorldScale(v()).x,headQ=head.getWorldQuaternion(new THREE.Quaternion());
      const mouth=head.localToWorld(MOUTH.clone());
      const cup=name==='water',grip=cup?CUP_GRIP:SNACK_GRIP,lip=cup?CUP_LIP:SNACK_LIP;
      const tilt=cup?-.32*Math.sin(Math.PI*clamp((t-.28)/.42,0,1)):0;
      const propQ=headQ.clone().multiply(q(tilt,0,0)),handQ=propQ.clone().multiply(q(0,-Math.PI*.75,0));
      const wantedGrip=mouth.clone().sub(lip.clone().sub(grip).multiplyScalar(scale).applyQuaternion(propQ));
      const actual=this.solveGrip('right',wantedGrip,handQ,e);
      this.fingers('right',.7*e);
      if(actual&&(cup||t<.8)){
        const item=this.placeItem(cup?'cup':'snack',actual,propQ,grip,scale);
        this.props.visible=true;
        const measured=item.localToWorld(grip.clone()),contact=item.localToWorld(lip.clone());
        this.debug.prop=cup?'cup':'snack';this.debug.gripError=measured.distanceTo(actual);
        this.debug.mouthError=e>.99?contact.distanceTo(mouth):null;
        const local=item.worldToLocal(actual.clone());
        if(cup){
          local.sub(v(-.05,.045,-.05)).applyAxisAngle(v(0,1,0),Math.PI/4);
          this.debug.holdingSurfaceDistance=Math.max(0,Math.hypot(Math.hypot(local.x,local.y)-.031,local.z)-.007)*scale;
        }else{
          const end=v(0,-.003,-.015),segment=end.clone().sub(SNACK_GRIP),along=clamp(local.clone().sub(SNACK_GRIP).dot(segment)/segment.lengthSq(),0,1);
          this.debug.holdingSurfaceDistance=Math.max(0,local.distanceTo(SNACK_GRIP.clone().addScaledVector(segment,along))-.006)*scale;
        }
      }
    }else if(name==='play'){
      this.bend('chest',0,.05*Math.sin(age*3)*e,0);this.bend('head',0,.08*Math.sin(age*3)*e,0);
      this.actor.group.updateWorldMatrix(true,true);
      const head=this.bones.head,headQ=head.getWorldQuaternion(new THREE.Quaternion()),scale=head.getWorldScale(v()).x;
      const right=this.solveGrip('right',head.localToWorld(v(-.14,-.12,.18)),headQ.clone().multiply(q(0,-Math.PI/2,0)),e);
      const left=this.solveGrip('left',head.localToWorld(v(.14,-.12,.18)),headQ.clone().multiply(q(0,Math.PI/2,0)),e);
      if(right&&left){
        const cycle=Math.max(0,age-.3)/1.4,odd=Math.floor(cycle)%2,phase=cycle%1,u=clamp((phase-.2)/.6,0,1);
        const ball=this.item('ball');ball.visible=true;ball.scale.setScalar(scale);
        ball.position.copy(odd?left:right).lerp(odd?right:left,u).add(v(0,.16*scale*Math.sin(Math.PI*u),0).applyQuaternion(headQ));
        ball.rotation.set(age*2,age*3,0);this.props.visible=true;this.debug.prop='ball';
      }
    }else if(name==='dance'&&sitting){
      const beat=Math.sin(age*4);
      this.bend('chest',0,.09*beat*e,.09*beat*e);this.bend('head',0,0,-.06*beat*e);
      for(const side of ['left','right']){
        const sign=side==='left'?1:-1;
        this.bend(side+'UpperArm',(-.4+sign*.22*beat)*e,0,sign*.24*e);
        this.bend(side+'LowerArm',(-.55+.15*Math.cos(age*4))*e);
      }
    }else if(name==='stretch'||name==='wake'){
      this.bend('chest',-.10*e);this.bend('neck',-.06*e);
      this.actor.group.updateWorldMatrix(true,true);
      const head=this.bones.head,headQ=head.getWorldQuaternion(new THREE.Quaternion());
      for(const side of ['left','right']){
        const sign=side==='left'?1:-1;
        this.solveGrip(side,head.localToWorld(v(sign*.31,.06,-.04)),headQ.clone().multiply(q(0,0,-sign*Math.PI/2)),e);
      }
    }else if(name==='bow'){
      const bow=.28*Math.sin(Math.PI*t);
      this.bend('spine',bow*.4);this.bend('chest',bow*.4);this.bend('neck',bow*.2);
      for(const side of ['left','right']){this.bend(side+'UpperArm',-.2*e);this.bend(side+'LowerArm',-.28*e);}
    }
    this.actor.group.updateWorldMatrix(true,true);
  }
  sprite(name,age,t,e){
    const plane=this.actor.spritePlane;
    plane.rotation.z=(name==='poke'?-.10*Math.exp(-age*2):name==='dance'?.08*Math.sin(age*5):name==='bow'?-.08*Math.sin(Math.PI*t):name==='pet'?.04*e:0);
    plane.scale.set(name==='stretch'?1+.06*e:1,name==='stretch'?1+.08*e:name==='bow'?1-.06*e:1,1);
    plane.position.y=1.42/2+(name==='dance'?.025*Math.abs(Math.sin(age*5)):0);
    if(['feed','water','play'].includes(name)){
      this.actor.group.updateWorldMatrix(true,false);
      const kind=name==='feed'?'snack':name==='water'?'cup':'ball',item=this.item(kind);
      const point=v(name==='play'?.16*Math.sin(age*3)*e:-.13*(1-e),.57+.28*e+(name==='play'?.12*Math.abs(Math.cos(age*3))*e:0),.08);
      item.position.copy(this.actor.group.localToWorld(point));this.actor.group.getWorldQuaternion(item.quaternion);
      if(name!=='play')item.position.sub((name==='water'?CUP_LIP:SNACK_LIP).clone().applyQuaternion(item.quaternion));
      item.scale.setScalar(1);item.visible=true;this.props.visible=true;this.debug.prop=kind;
    }
  }
  clearSprite(){const p=this.actor.spritePlane;p.rotation.z=0;p.scale.set(1,1,1);p.position.y=1.42/2;}
  inspect(){return {...this.debug};}
  dispose(){this.restore();this.props.removeFromParent();dispose(this.props);}
}
