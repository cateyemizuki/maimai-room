import layoutData from '../../layout.json' with {type:'json'};

const rooms=layoutData.layout.rooms;
const roofIds=new Set(['kitchen','dining','living','her_room','corridor','bathroom','laundry']);
export const ROOF_AREAS=rooms.filter(room=>roofIds.has(room.id));
export const SITE_BOUNDS=Object.freeze({
  minX:Math.min(...rooms.map(room=>room.bounds[0]))-.3,
  minZ:Math.min(...rooms.map(room=>room.bounds[1]))-.3,
  maxX:Math.max(...rooms.map(room=>room.bounds[2]))+.3,
  maxZ:Math.max(...rooms.map(room=>room.bounds[3]))+.3,
  top:-.008,bottom:-.24,
});

function contains(area,x,z,margin=0){
  const [x0,z0,x1,z1]=area.bounds;
  return x>=x0-margin&&x<=x1+margin&&z>=z0-margin&&z<=z1+margin;
}

export function roofAt(position,previous=''){
  const x=position[0],z=position[1];
  const held=ROOF_AREAS.find(area=>area.id===previous);
  if(held&&contains(held,x,z,.025))return held.id;
  return ROOF_AREAS.find(area=>contains(area,x,z))?.id||'';
}

// Test the finite camera-to-character segment, including height and openings.
// Walls beyond the character and rays above the wall cannot block the character.
export function wallBlocks(wall,from,to){
  const horizontal=wall.axis==='x';
  const a=horizontal?from.z:from.x,b=horizontal?to.z:to.x;
  const delta=b-a;
  if(Math.abs(delta)<1e-7)return false;
  const t=(wall.fixed-a)/delta;
  if(t<=.001||t>=.999)return false;
  const along=horizontal?from.x+(to.x-from.x)*t:from.z+(to.z-from.z)*t;
  const height=from.y+(to.y-from.y)*t;
  if(along<wall.from-.02||along>wall.to+.02||height<0||height>(wall.height||2.83))return false;
  for(const [start,end,low,high,type] of wall.openings||[]){
    if(along<=start+.055||along>=end-.055||height<=low+.035||height>=high-.035)continue;
    if(type==='window'&&(Math.abs(along-(start+end)/2)<.026||Math.abs(height-(low+(high-low)*.66))<.024))continue;
    return false;
  }
  return true;
}

function opacity(mesh,value){
  const material=mesh.material;
  const faded=value<.998;
  if(material.transparent!==faded){material.transparent=faded;material.needsUpdate=true;}
  material.opacity=value;material.depthWrite=!faded;
  mesh.visible=value>.003;
  const shadow=!faded;
  const changed=mesh.castShadow!==shadow;
  mesh.castShadow=shadow;
  return changed;
}

export class RoomVisibility {
  constructor(walls,roofs){
    this.walls=walls;this.roofs=roofs;this.room='';this.firstPerson=false;
    this.samples=Array.from({length:7},()=>({x:0,y:0,z:0}));
    this.weights=[3,3,1,1,1,1,1];
    this.totalWeight=this.weights.reduce((a,b)=>a+b,0);
    for(const wall of walls){wall.opacity=1;wall.targetOpacity=1;wall.coverage=0;wall.clearFor=0;}
    for(const roof of roofs){roof.opacity=1;roof.targetOpacity=1;}
  }
  update(camera,targets,character,{dt=.016,firstPerson=false}={}){
    this.firstPerson=firstPerson;
    this.room=roofAt(character.position,this.room);
    const {head,chest}=targets;
    const dx=head.x-camera.x,dz=head.z-camera.z,length=Math.hypot(dx,dz)||1;
    const rightX=dz/length,rightZ=-dx/length;
    const s=this.samples;
    Object.assign(s[0],head);Object.assign(s[1],chest);
    Object.assign(s[2],{x:chest.x,y:Math.max(character.elevation+.12,chest.y-.24),z:chest.z});
    for(let i=0;i<4;i++){
      const point=i<2?head:chest,side=i%2?1:-1,width=i<2?.24:.17;
      Object.assign(s[i+3],{x:point.x+rightX*side*width,y:point.y,z:point.z+rightZ*side*width});
    }
    const blend=1-Math.exp(-Math.min(.12,Math.max(0,dt))*10);
    let shadowDirty=false;
    for(const wall of this.walls){
      let covered=0;
      if(!firstPerson)for(let i=0;i<s.length;i++)if(wallBlocks(wall,camera,s[i]))covered+=this.weights[i];
      wall.coverage=covered/this.totalWeight;
      if(covered){wall.clearFor=0;wall.targetOpacity=.08+.36*(1-wall.coverage);}
      else{
        wall.clearFor+=dt;
        if(firstPerson||wall.clearFor>.12)wall.targetOpacity=1;
      }
      wall.opacity+= (wall.targetOpacity-wall.opacity)*blend;
      if(Math.abs(wall.opacity-wall.targetOpacity)<.003)wall.opacity=wall.targetOpacity;
      shadowDirty=opacity(wall.mesh,wall.opacity)||shadowDirty;
    }
    for(const roof of this.roofs){
      roof.targetOpacity=!firstPerson&&roof.id===this.room?0:1;
      roof.opacity+=(roof.targetOpacity-roof.opacity)*blend;
      if(Math.abs(roof.opacity-roof.targetOpacity)<.003)roof.opacity=roof.targetOpacity;
      shadowDirty=opacity(roof.mesh,roof.opacity)||shadowDirty;
    }
    return shadowDirty;
  }
  inspect(){
    return {room:this.room,openRoof:this.firstPerson?'':this.room,
      walls:this.walls.map(w=>({axis:w.axis,fixed:w.fixed,from:w.from,to:w.to,coverage:w.coverage,opacity:w.opacity,targetOpacity:w.targetOpacity})),
      roofs:this.roofs.map(r=>({id:r.id,opacity:r.opacity,targetOpacity:r.targetOpacity,visible:r.mesh.visible}))};
  }
}
