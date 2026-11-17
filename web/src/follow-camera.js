import * as THREE from '../upstream/vendor/three.module.js';

const eyeTurn=new THREE.Quaternion();
const eyeAngles=new THREE.Euler(0,0,0,'YXZ');
const cameraForward=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);

// Preserve the complete head-local frame through an upward-facing sleep pose.
// A world-up lookAt would flip the screen axes when the gaze crosses vertical.
export function eyeCameraOrientation(head,yaw,pitch,out){
  eyeAngles.set(-pitch,yaw,0,'YXZ');
  return out.copy(head).multiply(eyeTurn.setFromEuler(eyeAngles)).multiply(cameraForward).normalize();
}

// Reuse the scene's furniture bounds. Walls use
// character-based transparency. No triangle raycasts run in the frame loop.

export class FollowCameraGuard {
  constructor(world) {
    this.bounds=world.occluders||[];
    this.ray=new THREE.Ray();this.direction=new THREE.Vector3();this.hit=new THREE.Vector3();
    this.basePosition=new THREE.Vector3();this.heldPosition=new THREE.Vector3();
    this.offsetAz=0;this.offsetElev=0;this.clearFor=0;
    this.last={adjusted:false,protectedTransition:false,offsetAz:0,offsetElev:0};
  }
  reset(){this.offsetAz=0;this.offsetElev=0;this.clearFor=0;}
  obstruction(from,to) {
    this.direction.subVectors(to,from);const length=this.direction.length();
    if(length<.02)return null;
    this.ray.set(from,this.direction.multiplyScalar(1/length));
    for(const item of this.bounds){
      if(item.box.containsPoint(from))return item.name;
      const hit=this.ray.intersectBox(item.box,this.hit);
      // Ignore a small contact region at the character itself, e.g. a cushion.
      if(hit&&hit.distanceTo(from)<length-.10)return item.name;
    }
    return null;
  }
  clear(position,targets){return !this.obstruction(position,targets.head)&&!this.obstruction(position,targets.chest);}
  position(focus,az,elev,radius,out=new THREE.Vector3()){
    return out.set(focus.x+Math.sin(az)*radius*Math.cos(elev),focus.y+Math.sin(elev)*radius,focus.z+Math.cos(az)*radius*Math.cos(elev));
  }
  resolve({focus,az,elev,radius,targets,dt,manual=false},out){
    const base=this.position(focus,az,elev,radius,this.basePosition);
    const baseClear=this.clear(base,targets);
    this.clearFor=baseClear?this.clearFor+dt:0;
    const held=this.position(focus,az+this.offsetAz,Math.min(1.35,elev+this.offsetElev),radius,this.heldPosition);
    const hasOffset=Math.abs(this.offsetAz)+Math.abs(this.offsetElev)>.001;
    // A clear sector is retained while walking past an edge. Manual rotation
    // still updates the requested angle, and releases the correction sooner.
    if(hasOffset&&this.clear(held,targets)&&(!baseClear||this.clearFor<(manual ? .22 : .75))){
      out.copy(held);
    }else if(baseClear){
      this.offsetAz=0;this.offsetElev=0;out.copy(base);
    }else{
      const choices=[];
      for(const lift of [.18,.36,.58,.82])choices.push({az:0,elev:Math.min(1.35,elev+lift)-elev,cost:lift*2.8});
      for(const turn of [.44,-.44,.88,-.88,1.32,-1.32,Math.PI])choices.push({az:turn,elev:0,cost:Math.abs(turn)});
      // Combine modest side motion with an elevated view for tall joinery.
      for(const turn of [.65,-.65,1.3,-1.3])choices.push({az:turn,elev:Math.min(1.35,elev+.35)-elev,cost:Math.abs(turn)+.56});
      choices.sort((a,b)=>a.cost-b.cost);
      let chosen=null;
      for(const choice of choices){
        this.position(focus,az+choice.az,elev+choice.elev,radius,out);
        if(this.clear(out,targets)){chosen=choice;break;}
      }
      if(chosen){this.offsetAz=chosen.az;this.offsetElev=chosen.elev;}
      else{this.offsetAz=0;this.offsetElev=Math.max(0,1.35-elev);this.position(focus,az,1.35,radius,out);}
    }
    this.last={adjusted:Math.abs(this.offsetAz)+Math.abs(this.offsetElev)>.001,protectedTransition:false,offsetAz:this.offsetAz,offsetElev:this.offsetElev};
    return out;
  }
  protectTransition(position,targets,desired){
    if(this.clear(position,targets))return;
    const y=position.y;
    // A straight interpolation between two clear sectors can cut through the
    // television. Clear the current frame vertically before continuing damping.
    for(const lift of [.18,.4,.7,1.1,1.7,2.5,3.6,5]){
      position.y=y+lift;
      if(this.clear(position,targets)){this.last.protectedTransition=true;return;}
    }
    if(this.clear(desired,targets))position.copy(desired);
    this.last.protectedTransition=true;
  }
  inspect(position,targets){return {...this.last,occluders:this.bounds.length,headClear:!this.obstruction(position,targets.head),chestClear:!this.obstruction(position,targets.chest),headTarget:targets.head.toArray(),chestTarget:targets.chest.toArray()};}
}
