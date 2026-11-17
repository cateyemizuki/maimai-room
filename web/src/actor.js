// MaiSaka actor. All state comes from the plugin; animation is presentation only.
import * as THREE from '../upstream/vendor/three.module.js';
import { GLTFLoader } from '../upstream/vendor/GLTFLoader.js';
import spriteUrl from '../assets/maisaka-sprite.webp';
import {InteractionRig,expressionWeights} from './actor-interactions.js';

const HEIGHT = 1.42;
const ALIASES = {
  idle: ['idle', 'stand', 'standing', 'breathing', '待机', '站立'],
  walk: ['walk', 'walking', 'run', 'running', '走路', '行走'],
  sit: ['sit', 'sitting', 'seated', '坐', '坐下'],
  sleep: ['sleep', 'sleeping', 'lie', 'lying', '躺下', '睡眠'],
  dance: ['dance','dancing','跳舞'],stretch: ['stretch','伸懒腰'],bow: ['bow','curtsy','行礼'],
};
const findClip = (clips, type) => clips.find(c => ALIASES[type].includes(c.name.toLowerCase()))
  || clips.find(c => ALIASES[type].some(a => c.name.toLowerCase().includes(a)));

function releaseModel(root) {
  const resources=new Set();
  root?.traverse(node=>{
    if(!node.isMesh)return;
    resources.add(node.geometry);
    if(node.skeleton)resources.add(node.skeleton);
    for(const mat of [].concat(node.material||[])){
      resources.add(mat);
      for(const value of Object.values(mat))if(value?.isTexture)resources.add(value);
    }
  });
  for(const resource of resources)resource?.dispose();
}

export class RoomActor {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'maisaka';
    scene.add(this.group);
    this.normal = new THREE.Group();
    this.group.add(this.normal);
    this.model = null;
    this.mixer = null;
    this.actions = {};
    this.active = null;
    this.meshes = [];
    this.morphs = [];
    this.hips = null;
    this.ready = false;
    this.t = 0;
    this.blinkAt = 2.8;
    this.blinkStart = -10;
    this.expression = 'neutral';
    this.pose = 'stand';
    this.yOffset = 0;
    this.position = new THREE.Vector2(6.3, 4.2);
    this.presented=false;this.postureOffset=new THREE.Vector2();
    this.info = {};
    this.mode='3d';this.spriteReady=false;this.spriteMap=null;
    this.bones={};this.interactions=null;this.hipPoint=new THREE.Vector3();this.faceToken='';this.faceStartedAt=0;
    this.spritePlane=new THREE.Mesh(new THREE.PlaneGeometry(HEIGHT*2/3,HEIGHT),new THREE.MeshBasicMaterial({transparent:true,alphaTest:.03,side:THREE.DoubleSide,depthWrite:false}));
    this.spritePlane.position.y=HEIGHT/2;this.spritePlane.visible=false;this.spritePlane.name='maisaka-approved-illustration';this.group.add(this.spritePlane);
    this.dragGhost=this.spritePlane.clone();this.dragGhost.material=this.spritePlane.material.clone();this.dragGhost.material.opacity=.48;this.dragGhost.visible=false;this.dragGhost.name='drag-destination-preview';scene.add(this.dragGhost);

    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64,64,3,64,64,62);
    g.addColorStop(0,'rgba(15,23,25,.45)');g.addColorStop(1,'rgba(15,23,25,0)');
    ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(.8,.58),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,opacity:.65}));
    this.shadow.rotation.x=-Math.PI/2;this.shadow.position.y=.015;scene.add(this.shadow);
    this.interactions=new InteractionRig(scene,this);
  }

  async load(buffer,isCurrent=()=>true) {
    const loader = new GLTFLoader();
    // The sandbox allows img blob:, but connect-src 'none' forbids the fetch
    // performed by ImageBitmapLoader even for blob URLs. TextureLoader uses img.
    loader.register(parser => {
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
      parser.textureLoader.setCrossOrigin('anonymous');
      return { name: 'MAISAKA_SANDBOX_TEXTURES' };
    });
    const gltf = await new Promise((resolve,reject)=>loader.parse(buffer,'',resolve,reject));
    if(!isCurrent()){releaseModel(gltf.scene);return null;}
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root,true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = HEIGHT / Math.max(.001,size.y);
    this.disposeModel();
    this.normal.scale.setScalar(scale);
    this.normal.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);
    this.normal.add(root);
    this.model = root;
    this.mixer = new THREE.AnimationMixer(root);
    root.traverse(o=>{
      if(o.isBone)this.bones[o.name]=o;
      if (o.isBone && /(^hips?$|pelvis|mixamorig.?hips)/i.test(o.name)) this.hips ||= o;
      if (!o.isMesh) return;
      this.meshes.push(o);o.castShadow=false;o.receiveShadow=true;
      const materials=Array.isArray(o.material)?o.material:[o.material];
      for(const m of materials){if(m) m.envMapIntensity=.75;}
      if(o.morphTargetDictionary && o.morphTargetInfluences) this.morphs.push(o);
    });
    this.interactions=new InteractionRig(this.scene,this);
    for(const type of Object.keys(ALIASES)) {
      const clip=findClip(gltf.animations,type);
      if(clip){const action=this.mixer.clipAction(clip);action.setLoop(['stretch','bow'].includes(type)?THREE.LoopOnce:THREE.LoopRepeat,['stretch','bow'].includes(type)?1:Infinity);action.clampWhenFinished=['stretch','bow'].includes(type);this.actions[type]=action;}
    }
    this.ready=true;this.active=null;this.yOffset=0;
    this.info={height:HEIGHT,scale,clips:gltf.animations.map(c=>c.name),skinned:this.meshes.some(o=>o.isSkinnedMesh),morphs:[...new Set(this.morphs.flatMap(o=>Object.keys(o.morphTargetDictionary)))],meshes:this.meshes.length};
    this.setAnimation('idle');
    return this.info;
  }

  setAnimation(type) {
    const action=this.actions[type];
    if(this.active===type) return;
    const previous=this.actions[this.active];
    if(action){action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();if(previous&&previous!==action)action.crossFadeFrom(previous,.22,false);}
    else if(previous) previous.fadeOut(.2);
    this.active=type;this.poseChangedAt=this.t;
  }

  update(dt,camera,state,mode) {
    this.t+=dt;
    const {position=[6.3,4.2],pose='stand',walking=false,elevation=0,facing=0,expression='neutral',spot='',gesture=null}=state;
    const changingPose=this.presented&&this.pose!==pose&&this.mode==='3d'&&this.hips;
    const previousHip=changingPose?this.hips.getWorldPosition(new THREE.Vector3()):null;
    this.position.set(position[0],position[1]);
    this.pose=pose;this.expression=expression;
    const sleeping=pose==='lie'||pose==='sleep';
    const sitting=pose==='sit';
    const baseAnim=walking?'walk':sleeping?'sleep':sitting?'sit':'idle';
    const gestureClip=this.mode==='3d'&&!walking&&!sleeping&&!sitting&&gesture&&this.actions[gesture.name]?gesture.name:null;
    const anim=gestureClip||baseAnim;
    const changed=this.active!==anim,restart=gestureClip&&(this.gestureToken!==gesture.startedAt||changed);
    this.setAnimation(anim);
    if(restart){
      const action=this.actions[anim];if(!changed)action.reset().play();action.time=Math.min(Number(gesture.elapsed)||0,action.getClip().duration-.0001);
      this.gestureToken=gesture.startedAt;
    }
    if(walking&&this.actions.walk){
      const rate=Number.isFinite(state.motionSpeed)?state.motionSpeed/(Number(state.walkSpeed)||1.15):1;
      this.actions.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(rate,0,2.2));
    }
    this.interactions?.restore();this.interactions?.clearSprite();
    this.mixer?.update(dt);
    const clip=!!this.actions[anim]&&this.mode==='3d';
    // Engine facing: 0=north(-Z), 90=east(+X); glTF front is +Z.
    let yaw=Math.PI-facing*Math.PI/180;
    if(this.mode==='2d'&&!sleeping)yaw=Math.atan2(camera.position.x-position[0],camera.position.z-position[1]);
    let delta=THREE.MathUtils.euclideanModulo(yaw-this.group.rotation.y+Math.PI,Math.PI*2)-Math.PI;
    this.group.rotation.y+=delta*Math.min(1,dt*9);

    let baseY=Number(elevation)||0,anchorX=position[0],anchorZ=position[1],hipOffsetX=0,hipOffsetZ=0;
    if(sitting&&clip&&this.hips) {
      const p=this.hips.getWorldPosition(this.hipPoint);
      this.group.worldToLocal(p);
      // The source state's historical elevations predate the refined cushions:
      // sofa top=.48, desk chair top=.52. Put the pelvis near the front edge,
      // so a genuine bent leg hangs in front instead of inside the cushion.
      if(spot==='sofa'){baseY=.48;anchorZ=4.87;}
      else if(spot==='desk'){baseY=.52;anchorX=9.40;anchorZ=3.12;}
      else if(spot==='dining'){baseY=.516;anchorX=2.1;anchorZ=5.41;}
      else if(spot==='chair'){baseY=.374;anchorX=7.60;anchorZ=8.42;}
      baseY=baseY-p.y+.09;
      const yaw=this.group.rotation.y;
      hipOffsetX=p.x*Math.cos(yaw)+p.z*Math.sin(yaw);
      hipOffsetZ=-p.x*Math.sin(yaw)+p.z*Math.cos(yaw);
    } else if(sleeping&&clip) {
      // Sleep clips already contain a flat skeleton; never rotate them again.
      // The original bed cover is y=.65 (snapshot elevation=.52).
      if(this.t-this.poseChangedAt>.3 && this.sleepOffsetFor!==this.poseChangedAt) {
        this.group.updateMatrixWorld(true);
        const b=new THREE.Box3().setFromObject(this.normal,true);
        const relativeBottom=b.min.y-this.group.position.y;
        this.sleepOffset=-(Number.isFinite(relativeBottom)?relativeBottom:0);
        this.sleepOffsetFor=this.poseChangedAt;
      }
      baseY+=.13+(this.sleepOffset||0);
    } else if(sitting) baseY=Math.max(0,baseY-.28);
    else if(sleeping) baseY+=.34;

    const bob=walking&&!clip?(state.motionSpeed===0?0:Math.abs(Math.sin(this.t*11))*.025):!clip?Math.sin(this.t*1.7)*.004:0;
    this.yOffset+=(baseY-this.yOffset)*Math.min(1,dt*10);
    this.group.position.set(anchorX-hipOffsetX,this.yOffset+bob,anchorZ-hipOffsetZ+(sleeping && !clip ? .3 : 0));
    const rotX=clip?0:sleeping?-Math.PI/2:sitting?-.10:walking?-.08:0;
    this.group.rotation.x+=(rotX-this.group.rotation.x)*Math.min(1,dt*8);
    const scaleY=sitting && !clip ? .84 : 1;
    this.group.scale.y+=(scaleY-this.group.scale.y)*Math.min(1,dt*8);
    if(previousHip){
      this.group.updateWorldMatrix(true,true);
      const next=this.hips.getWorldPosition(new THREE.Vector3());
      this.postureOffset.set(previousHip.x-next.x,previousHip.z-next.z);
    }else this.postureOffset.multiplyScalar(Math.exp(-dt*10));
    this.group.position.x+=this.postureOffset.x;this.group.position.z+=this.postureOffset.y;
    this.presented=true;
    this.shadow.position.set(position[0],sleeping?elevation+.15:sitting?elevation+.012:.015,position[1]);
    this.shadow.scale.set(sleeping?1.6:1,sleeping?2:1,1);
    this.shadow.visible=mode!=='eyes';this.group.visible=mode!=='eyes'||this.mode==='3d';
    for(const mesh of this.meshes)mesh.visible=mode!=='eyes'||!/head|expression/i.test(mesh.name);
    this.normal.visible=this.mode==='3d';this.spritePlane.visible=this.mode==='2d'&&this.spriteReady;
    this.group.updateWorldMatrix(true,true);
    this.interactions?.apply(gesture,{walking,sleeping,sitting,native:!!gestureClip});
    const token=expression+':'+String(state.expressionAt||0);
    if(token!==this.faceToken){this.faceToken=token;this.faceStartedAt=this.t;}
    this.updateExpression(dt,sleeping,expression,walking?null:gesture);
  }

  ensureSprite(){if(this.spriteMap)return;this.spriteMap=new THREE.TextureLoader().load(spriteUrl,()=>{this.spriteReady=true;});this.spriteMap.colorSpace=THREE.SRGBColorSpace;for(const m of [this.spritePlane.material,this.dragGhost.material]){m.map=this.spriteMap;m.needsUpdate=true;}}
  setMode(mode){this.mode=mode==='2d'?'2d':'3d';if(this.mode==='2d')this.ensureSprite();this.normal.visible=this.mode==='3d';this.spritePlane.visible=this.mode==='2d';if(this.mode==='3d'){this.group.rotation.x=0;this.group.scale.y=1;this.sleepOffsetFor=null;this.poseChangedAt=this.t;}}
  previewDestination(point,camera){if(!point){this.dragGhost.visible=false;return;}this.ensureSprite();this.dragGhost.visible=true;this.dragGhost.position.set(point[0],HEIGHT/2+.04,point[1]);this.dragGhost.rotation.set(0,Math.atan2(camera.position.x-point[0],camera.position.z-point[1]),0);}

  updateExpression(dt,sleeping,expression,gesture) {
    if(this.t>this.blinkAt){this.blinkStart=this.t;this.blinkAt=this.t+3.1+Math.random()*3;}
    const phase=(this.t-this.blinkStart)/.16;
    const blink=phase>=0&&phase<1?Math.sin(phase*Math.PI):0;
    const weights=expressionWeights(expression,blink,{sleeping,faceAge:this.t-this.faceStartedAt,gesture});
    for(const mesh of this.morphs){
      for(const [name,index]of Object.entries(mesh.morphTargetDictionary)){
        const key=name.toLowerCase().replace(/[_\s.-]/g,'');
        if(!(key in weights))continue;
        const weight=weights[key];
        const current=mesh.morphTargetInfluences[index]||0;
        mesh.morphTargetInfluences[index]=current+(weight-current)*Math.min(1,dt*(key.startsWith('blink')?35:['aa','ih','ou','ee','oh'].includes(key)?18:8));
      }
    }
  }

  disposeModel(){
    this.interactions?.dispose();this.interactions=null;
    if(this.model){this.mixer?.stopAllAction();this.mixer?.uncacheRoot(this.model);this.model.removeFromParent();releaseModel(this.model);}
    this.meshes=[];this.morphs=[];this.actions={};this.bones={};this.model=null;this.mixer=null;this.hips=null;this.ready=false;
  }
  dispose(){
    this.disposeModel();
    this.group.removeFromParent();this.dragGhost.removeFromParent();this.shadow.removeFromParent();
    this.spriteMap?.dispose();this.spritePlane.geometry.dispose();this.spritePlane.material.dispose();this.dragGhost.material.dispose();
    releaseModel(this.shadow);
  }
}
