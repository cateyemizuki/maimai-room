import * as THREE from '../upstream/vendor/three.module.js';

// Reuse the scene's furniture bounds and cache room roofs once. Walls use
// character-based transparency. No triangle raycasts run in the frame loop.

export class FollowCameraGuard {
  constructor(world) {
    this.bounds=world.occluders||[];
    world.root.updateMatrixWorld(true);
    this.roofBounds=(world.roofs||[]).map(roof=>({name:'Roof '+roof.id,room:roof.id,box:new THREE.Box3().setFromObject(roof.mesh)}));
    this.obstacles=[...this.bounds,...this.roofBounds];
    this.openRoof='';
    this.ray=new THREE.Ray();this.direction=new THREE.Vector3();this.hit=new THREE.Vector3();
    this.basePosition=new THREE.Vector3();this.heldPosition=new THREE.Vector3();
    this.offsetAz=0;this.offsetElev=0;this.clearFor=0;
    this.last={adjusted:false,protectedTransition:false,offsetAz:0,offsetElev:0};
  }
  reset(){this.offsetAz=0;this.offsetElev=0;this.clearFor=0;}
  setRoom(room){this.openRoof=room;}
  obstruction(from,to,roofsOnly=false) {
    this.direction.subVectors(to,from);const length=this.direction.length();
    if(length<.02)return null;
    this.ray.set(from,this.direction.multiplyScalar(1/length));
    for(const item of roofsOnly?this.roofBounds:this.obstacles){
      if(item.room&&item.room===this.openRoof)continue;
      if(item.box.containsPoint(from))return item.name;
      const hit=this.ray.intersectBox(item.box,this.hit);
      // Ignore a small contact region at the character itself, e.g. a cushion.
      if(hit&&hit.distanceTo(from)<length-.10)return item.name;
    }
    return null;
  }
  clear(position,targets){return !this.obstruction(position,targets.head)&&!this.obstruction(position,targets.chest);}
  clearRoofs(position,targets){return !this.obstruction(position,targets.head,true)&&!this.obstruction(position,targets.chest,true);}
  protectRoofView(position,targets){
    if(this.clearRoofs(position,targets))return;
    const y=position.y;
    for(const lift of [.25,.5,1,2,4,8,16,32]){
      position.y=y+lift;
      if(this.clearRoofs(position,targets))return;
    }
  }
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
      // A neighbouring ceiling can be avoided from below while its walls fade.
      // Prefer this to turning a close portrait into a steep overhead view.
      if(!this.clearRoofs(base,targets))for(const drop of [.16,.3,.45]){
        choices.push({az:0,elev:Math.max(.12,elev-drop)-elev,cost:drop*.8});
      }
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
    if(!this.clearRoofs(position,targets)&&this.clear(desired,targets)){
      position.copy(desired);this.last.protectedTransition=true;return;
    }
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
