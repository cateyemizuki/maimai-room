import * as THREE from '../upstream/vendor/three.module.js';
import {ROOF_AREAS,SITE_BOUNDS} from './room-visibility.js';

const TAU = Math.PI * 2;
const HALF = Math.PI / 2;

// A small indexed, vertex-coloured mesh builder. All transforms are baked at build time.
export class Woodshop {
  constructor() {
    this.vertices = []; this.normals = []; this.colours = []; this.indices = [];
    this.matrix = new THREE.Matrix4(); this.colourTable = new Map();
  }
  at(x,y,z,rx,ry,rz,fn) {
    const previous = this.matrix;
    const local = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx,ry,rz,'YXZ'));
    local.setPosition(x,y,z);
    this.matrix = new THREE.Matrix4().multiplyMatrices(previous,local);
    try { fn(this); } finally { this.matrix = previous; }
  }
  point(x,y,z,nx,ny,nz,paint) {
    const e=this.matrix.elements, i=this.vertices.length/3;
    this.vertices.push(e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]);
    this.normals.push(e[0]*nx+e[4]*ny+e[8]*nz,e[1]*nx+e[5]*ny+e[9]*nz,e[2]*nx+e[6]*ny+e[10]*nz);
    let c=this.colourTable.get(paint);
    if(!c){c=new THREE.Color(paint);this.colourTable.set(paint,c);}
    this.colours.push(c.r,c.g,c.b);return i;
  }
  face(points,paint) {
    const [a,b,c]=points, ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    const n=Math.hypot(nx,ny,nz)||1;nx/=n;ny/=n;nz/=n;
    const first=this.vertices.length/3;
    for(const p of points)this.point(...p,nx,ny,nz,paint);
    for(let i=1;i<points.length-1;i++)this.indices.push(first,first+i,first+i+1);
  }
  box(x,y,z,w,h,d,c) {
    const l=x-w/2,r=x+w/2,b=y-h/2,t=y+h/2,f=z+d/2,k=z-d/2;
    this.face([[l,b,f],[r,b,f],[r,t,f],[l,t,f]],c);this.face([[r,b,k],[l,b,k],[l,t,k],[r,t,k]],c);
    this.face([[l,b,k],[l,b,f],[l,t,f],[l,t,k]],c);this.face([[r,b,f],[r,b,k],[r,t,k],[r,t,f]],c);
    this.face([[l,t,f],[r,t,f],[r,t,k],[l,t,k]],c);this.face([[l,b,k],[r,b,k],[r,b,f],[l,b,f]],c);
  }
  // Soft horizontal slabs, pillows and ceramic blocks with separately shaded caps.
  pad(x,y,z,w,h,d,c,r=.07,edge=.015,n=2) {
    r=Math.max(.001,Math.min(r,w*.49,d*.49));edge=Math.min(edge,h*.32,r*.65);
    const lower=y-h/2,upper=y+h/2;const ring=[];
    for(let q=0;q<4;q++){
      const cx=x+(q===0||q===3?1:-1)*(w/2-r),cz=z+(q<2?1:-1)*(d/2-r);
      for(let j=0;j<=n;j++){const ang=(q+j/n)*HALF;ring.push([cx,cz,Math.cos(ang),Math.sin(ang)]);}
    }
    const layer=(yy,radius,normalY,normalR)=>ring.map(([cx,cz,dx,dz])=>this.point(cx+dx*radius,yy,cz+dz*radius,dx*normalR,normalY,dz*normalR,c));
    const layers=edge>.0001?[layer(lower,r-edge,-.72,.694),layer(lower+edge,r,0,1),layer(upper-edge,r,0,1),layer(upper,r-edge,.72,.694)]:[layer(lower,r,0,1),layer(upper,r,0,1)];
    for(let k=1;k<layers.length;k++)for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length,a=layers[k-1],b=layers[k];this.indices.push(a[i],b[i],b[j],a[i],b[j],a[j]);}
    for(const [height,sgn] of [[lower,-1],[upper,1]]) {
      const cap=layer(height,r-edge,sgn,0);
      for(let i=1;i<cap.length-1;i++)this.indices.push(cap[0],cap[sgn===1?i+1:i],cap[sgn===1?i:i+1]);
    }
  }
  // Lathed profile of a bowl, shade, jar, leg or wheel. Profile runs bottom to top.
  spin(x,y,z,profile,c,n=12,stretch=1,caps=true) {
    const rows=profile.map(([r,h],k)=>{
      const low=profile[Math.max(0,k-1)],high=profile[Math.min(profile.length-1,k+1)];
      const dh=high[1]-low[1],dr=high[0]-low[0];const row=[];
      for(let j=0;j<n;j++){const a=TAU*j/n,dx=Math.cos(a),dz=Math.sin(a);let nx=dh*dx,ny=-dr,nz=dh*dz/stretch;const norm=Math.hypot(nx,ny,nz)||1;row.push(this.point(x+r*dx,y+h,z+r*dz*stretch,nx/norm,ny/norm,nz/norm,c));}return row;
    });
    for(let k=1;k<rows.length;k++)for(let i=0;i<n;i++){const j=(i+1)%n;this.indices.push(rows[k-1][i],rows[k][i],rows[k][j],rows[k-1][i],rows[k][j],rows[k-1][j]);}
    if(!caps)return;
    for(const k of [0,rows.length-1]){
      const [r,h]=profile[k];if(r<=.0001)continue;
      const s=k===0?-1:1,cap=[];for(let i=0;i<n;i++){const a=TAU*i/n;cap.push(this.point(x+r*Math.cos(a),y+h,z+r*stretch*Math.sin(a),0,s,0,c));}
      for(let i=1;i<n-1;i++)this.indices.push(cap[0],cap[s>0?i+1:i],cap[s>0?i:i+1]);
    }
  }
  globe(x,y,z,rx,ry,rz,c,n=10,lat=5) {
    const rows=[];for(let j=0;j<=lat;j++){const v=Math.PI*j/lat-HALF,sv=Math.sin(v),cv=Math.cos(v);const row=[];
      for(let i=0;i<n;i++){const a=TAU*i/n,dx=cv*Math.cos(a),dz=cv*Math.sin(a);let nx=dx/rx,ny=sv/ry,nz=dz/rz;const norm=Math.hypot(nx,ny,nz);row.push(this.point(x+rx*dx,y+ry*sv,z+rz*dz,nx/norm,ny/norm,nz/norm,c));}rows.push(row);}
    for(let k=1;k<=lat;k++)for(let i=0;i<n;i++){const j=(i+1)%n;if(k!==lat)this.indices.push(rows[k-1][i],rows[k][i],rows[k][j]);if(k!==1)this.indices.push(rows[k-1][i],rows[k][j],rows[k-1][j]);}
  }
  stem(ax,ay,az,bx,by,bz,r,c,n=6,r2=r) {
    const dx=bx-ax,dy=by-ay,dz=bz-az,L=Math.hypot(dx,dy,dz);if(!L)return;
    const yaw=Math.atan2(dx,dz),tilt=Math.atan2(Math.hypot(dx,dz),dy);
    this.at(ax,ay,az,tilt,yaw,0,b=>b.spin(0,0,0,[[r,0],[r2,L]],c,n,1,false));
  }
  leaf(x,y,z,angle,length,width,rise,c) {
    this.at(x,y,z,0,angle,0,b=>{
      const base=[0,0,0],l=[-width*.5,rise*.59,length*.45],r=[width*.5,rise*.59,length*.45],sp=[0,rise*.67+width*.17,length*.47],tip=[0,rise,length];
      b.face([base,l,sp],c);b.face([l,tip,sp],c);b.face([sp,tip,r],c);b.face([base,sp,r],c);
      b.face([base,r,tip,l],c);
    });
  }
  mesh(mat,name) {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(this.vertices,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(this.normals,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(this.colours,3));
    g.setIndex(this.indices);g.computeBoundingSphere();g.computeBoundingBox();
    const m=new THREE.Mesh(g,mat);m.name=name;m.receiveShadow=true;return m;
  }
}

export function seeded(i){const n=Math.sin(i*127.1+311.7)*43758.5453123;return n-Math.floor(n);}
export function clover(b,x,y,z,size,col,stemCol=col){
  b.at(x,y,z,0,.24,0,p=>{
    for(let i=0;i<4;i++)p.at(0,0,0,0,i*HALF,0,q=>{
      const s=size,outline=[[0,0,0],[-.31*s,0,.37*s],[-.28*s,0,.56*s],[-.12*s,0,.63*s],[0,0,.53*s],[.12*s,0,.63*s],[.28*s,0,.56*s],[.31*s,0,.37*s]];
      for(let k=1;k<outline.length-1;k++)q.face([outline[0],outline[k],outline[k+1]],col);
    });
    p.stem(0,-.001,0,-size*.58,.001,-size*.76,size*.041,stemCol,4);
  });
}
export function basket(b,x,y,z,w,h,d) {
  const cane=0xc39862,light=0xe5be88,edge=0x88623d;
  b.pad(x,y+h*.48,z,w,h*.94,d,cane,.055,.012,1);
  for(let i=0;i<4;i++)b.pad(x,y+h*(.16+.22*i),z,w+.015,.022,d+.015,i%2?light:edge,.054,.004,1);
  const n=Math.floor(w/.083);
  for(let i=0;i<n;i++){const xx=x+((i+.5)/n-.5)*(w-.055);for(const s of [-1,1])b.box(xx,y+h*.48,z+s*(d/2+.004),.018,h*.91,.012,light);}
  b.pad(x,y+h*.98,z,w+.032,.035,d+.032,edge,.055,.008,1);
  b.pad(x,y+h+.01,z,w-.047,.018,d-.047,0x674d35,.04,.003,1);
}
export function potted(b,x,y,z,size,variant=0) {
  const ceramic=[0xc57d59,0x75917a,0xdfb883,0x637e79][variant%4];
  const w=size*.24,h=size*.43;
  b.spin(x,y,z,[[w*.69,0],[w*.76,.04*size],[w,h*.88],[w*.99,h]],ceramic,10);
  b.spin(x,y+h-.015,z,[[w*1.04,0],[w*1.04,.033]],ceramic,10);
  b.spin(x,y+h+.018,z,[[w*.93,0],[w*.93,.009]],0x61533f,10);
  const greens=[0x627d4c,0x819760,0x426c53,0x789561,0x99a774];
  for(let i=0;i<8;i++){
    const a=i*2.4+variant,r=size*(.09+.12*seeded(i+variant)),height=size*(.22+.48*seeded(i+13+variant));
    const ex=x+Math.sin(a)*r,ez=z+Math.cos(a)*r;b.stem(x,y+h,z,ex,y+h+height,ez,size*.009,0x79815b,4);
    b.leaf(ex,y+h+height,ez,a,size*(.18+.08*seeded(i)),size*(.13+.10*seeded(i+2)),size*(.04-.12*seeded(i+7)),greens[i%5]);
  }
}
function dinnerware(b,x,y,z,c=0xf4e8ce,scale=1) {
  b.spin(x,y,z,[[.05*scale,0],[.065*scale,.018*scale],[.077*scale,.115*scale],[.073*scale,.128*scale]],c,12);
  b.spin(x,y+.125*scale,z,[[.064*scale,0],[.064*scale,.002]],0x684b36,12);
  b.stem(x+.061*scale,y+.04*scale,z,x+.10*scale,y+.05*scale,z,.012*scale,c);b.stem(x+.10*scale,y+.05*scale,z,x+.10*scale,y+.09*scale,z,.011*scale,c);b.stem(x+.10*scale,y+.09*scale,z,x+.066*scale,y+.10*scale,z,.011*scale,c);
}
function bear(b,x,y,z,s,c=0xbd8056) {
  b.globe(x,y+s*.23,z,s*.20,s*.23,s*.16,c,10,5);b.globe(x,y+s*.51,z,s*.236,s*.204,s*.185,c,12,6);
  for(const sign of [-1,1]) {
    b.globe(x+sign*s*.178,y+s*.672,z,s*.096,s*.090,s*.068,c,8,4);
    b.globe(x+sign*s*.178,y+s*.67,z+s*.049,s*.057,s*.053,s*.027,0xe3b084,8,4);
    b.globe(x+sign*s*.087,y+s*.54,z+s*.164,s*.022,s*.024,s*.017,0x382e27,7,4);
    b.globe(x+sign*s*.135,y+s*.078,z+s*.09,s*.082,s*.083,s*.096,c,8,4);
  }
  b.globe(x,y+s*.469,z+s*.165,s*.114,s*.075,s*.045,0xf0d7aa,9,4);
  b.globe(x,y+s*.487,z+s*.201,s*.039,s*.026,s*.024,0x473931,8,4);
  b.pad(x,y+s*.354,z,s*.32,s*.054,s*.29,0x768a77,s*.062,s*.008,1);
}
function furnitureLegs(b,x,y,z,w,h,d,c,ch=.04) {
  for(const sx of [-1,1])for(const sz of [-1,1])b.stem(x+sx*w/2,y,z+sz*d/2,x+sx*(w/2-ch),y+h,z+sz*(d/2-ch),ch*.78,c,6,ch);
}
const OAK=0xc58a59, HONEY=0xd8a16d, WALNUT=0x895e41, MILK=0xf1e6cf, FLAX=0xd8c6a5, SAGE=0x889b77, DEEP=0x526f62, BRASS=0xba965b;


function floorboards(b,x0,z0,x1,z1,h=0,palette=[0xd6a16e,0xc89163,0xe1af7e,0xd9a677,0xcea074]) {
  const course=.29,n=Math.ceil((z1-z0)/course);
  for(let row=0;row<n;row++){
    const near=z0+row*course,far=Math.min(z1,near+course),z=(near+far)/2;
    let start=x0;let k=0;while(start<x1-.001){
      const stop=Math.min(x1,start+(k?1.45+seeded(row*39+k)*.91:.63+seeded(row+3)*1.53));
      const w=stop-start-.009,c=palette[Math.floor(seeded(row*83+k+1)*palette.length)];
      if(w>.001)b.face([[start+.004,h+.0005,far-.004],[stop-.004,h+.0005,far-.004],[stop-.004,h+.0005,near+.004],[start+.004,h+.0005,near+.004]],c);
      if(w>.68&&(row+k)%4===0) {
        const gx=start+w*.30,gz=z+.045*(seeded(k+row)-.5);
        b.face([[gx,h+.0018,gz],[gx+w*.22,h+.0018,gz+.008],[gx+w*.40,h+.0018,gz-.008],[gx+w*.22,h+.0018,gz-.002]],0xbf906a);
      }
      start=stop;k++;
    }
  }
}
function tilefloor(b,x0,z0,x1,z1,unit,colors) {
  b.face([[x0,.0001,z1],[x1,.0001,z1],[x1,.0001,z0],[x0,.0001,z0]],0xbeb7a5);
  for(let i=0;x0+i*unit<x1-.001;i++)for(let j=0;z0+j*unit<z1-.001;j++){
    const l=x0+i*unit,k=z0+j*unit,w=Math.min(unit,x1-l),d=Math.min(unit,z1-k);
    b.face([[l+.007,.003,k+d-.007],[l+w-.007,.003,k+d-.007],[l+w-.007,.003,k+.007],[l+.007,.003,k+.007]],colors[(i+3*j)%colors.length]);
  }
}
function drawRug(b,x,z,w,d,tone,trim) {
  b.pad(x,.017,z,w,.028,d,trim,.12,.003,2);b.pad(x,.030,z,w-.09,.018,d-.09,tone,.092,.002,2);
  const y=.04,c=0xe1cdab;
  for(const sign of [-1,1]){
    b.box(x,y,z+sign*(d/2-.17),w-.14,.006,.032,c);
    b.box(x,y,z+sign*(d/2-.232),w-.17,.006,.017,c);
    const count=Math.floor(w/.118);
    for(let i=0;i<count;i++){
      const xx=x+(i-(count-1)/2)*.118;
      b.box(xx,.011,z+sign*(d/2+.033),.026,.016,.078,c);
    }
  }
  for(const sign of [-1,1])b.box(x+sign*(w/2-.14),y,z,.02,.006,d-.30,c);
  for(let i=-2;i<=2;i++)for(const s of [-1,1]){
    const xx=x+i*w*.143,zz=z+s*d*.26,r=.092;
    b.face([[xx-r,.043,zz],[xx,.043,zz+r*.72],[xx+r,.043,zz],[xx,.043,zz-r*.72]],trim);
    b.face([[xx-r*.52,.044,zz],[xx,.044,zz+r*.34],[xx+r*.52,.044,zz],[xx,.044,zz-r*.34]],tone);
  }
}
function sofa(b) {
  const x=6.3,z=5.13;
  furnitureLegs(b,x,.012,z,1.89,.156,.60,WALNUT,.067);
  b.pad(x,.188,z,2.06,.118,.79,OAK,.104,.018,3);
  b.pad(x,.30,z,2.12,.195,.84,DEEP,.12,.025,3);
  for(const side of [-1,1]){
    const xx=x+side*.452;
    b.pad(xx,.399,5.077,.894,.146,.643,0xa2ad83,.102,.035,3);
    b.pad(xx,.451,5.077,.894,.018,.642,0xc0c29f,.101,.005,3);
    b.pad(xx,.465,5.077,.878,.03,.627,0xa6b08c,.098,.009,3);
    b.at(xx,.695,5.412,-.125,0,0,q=>{
      q.pad(0,0,0,.90,.449,.191,0x829676,.073,.031,3);
      for(const a of [-1,1])q.globe(a*.207,.017,-.096,.019,.018,.007,0x74896e,6,3);
    });
    const ax=x+side*.996;
    b.pad(ax,.495,5.139,.191,.422,.811,0x829676,.071,.028,3);
    b.pad(ax,.703,5.121,.205,.077,.820,0xa2ae8a,.085,.018,3);
    // Cane facing has a solid wood surround and individually cut diagonal reeds.
    b.pad(ax+side*.097,.47,5.13,.025,.282,.588,WALNUT,.009,.005,1);
    b.box(ax+side*.114,.469,5.13,.012,.239,.537,0xc7a676);
    for(let k=-4;k<=4;k++)for(const diag of [-1,1]){
      const center=k*.085,span=.115;
      const a=Math.max(-span,(-.258-center)/.74),e=Math.min(span,(.258-center)/.74);
      if(e>a)b.stem(ax+side*.122,.469+a*diag,5.13+center+a*.74,ax+side*.122,.469+e*diag,5.13+center+e*.74,.0068,0xefd4a3,4);
    }
  }
  // A cream jacquard throw folds over the front corner. Keep the centre seat clear.
  const tx=5.72;
  b.pad(tx,.487,4.989,.303,.016,.427,0xe8d7b6,.021,.003,1);
  b.box(tx,.385,4.769,.303,.210,.018,0xe1cfaa);
  for(let i=-2;i<=2;i++){
    b.box(tx+i*.052,.498,4.985,.010,.004,.40,i%2?0xb2966c:0xc9b38e);
    b.box(tx+i*.052,.380,4.756,.010,.208,.004,0xb69d78);
    b.box(tx+i*.052,.252,4.761,.014,.068,.012,0xd6bf96);
  }
  for(const s of [-1,1]){
    b.at(x+s*.663,.686,5.244,-.15,0,s*.12,q=>{
      q.pad(0,0,0,.32,.302,.107,s<0?0xcc9468:0xf0d9ad,.044,.017,2);
      q.at(0,0,-.056,-HALF,0,0,f=>clover(f,0,0,0,.118,s<0?0xe5c295:DEEP));
    });
  }
}
function chair(b,x,z,top,rot=0) {
  b.at(x,0,z,0,rot,0,q=>{
    furnitureLegs(q,0,.012,0,.373,top-.078,.355,WALNUT,.035);
    q.pad(0,top-.056,0,.447,.066,.42,OAK,.063,.011,2);
    q.pad(0,top-.014,0,.417,.029,.386,0xa3aa87,.056,.006,2);
    for(const side of [-1,1])q.stem(side*.174,top-.078,.171,side*.184,top+.38,.198,.024,OAK,7);
    q.pad(0,top+.31,.192,.424,.132,.053,HONEY,.025,.01,2);
    for(let i=-2;i<=2;i++)q.stem(i*.056,top+.012,.174,i*.056,top+.254,.196,.009,0xe2bc83,5);
  });
}
function floorLamp(b,x,z,h=1.49){
  b.spin(x,.004,z,[[.153,0],[.164,.032],[.14,.052],[.073,.062]],WALNUT,14);
  b.spin(x,.062,z,[[.021,0],[.018,h-.33]],BRASS,8);
  b.spin(x,h-.32,z,[[.19,0],[.194,.018],[.125,.235],[.115,.25]],0xf5dcb1,16);
  b.spin(x,h-.322,z,[[.194,0],[.194,.013]],0xcab184,16);
  b.globe(x,h-.31,z,.064,.051,.064,0xffedca,10,4);
}
function coffeeTable(b){
  const x=5.68,z=3.80;
  furnitureLegs(b,x,.045,z,.79,.268,.35,WALNUT,.046);
  b.pad(x,.312,z,1.00,.084,.53,HONEY,.18,.014,3);
  b.pad(x-.19,.368,z+.035,.288,.027,.20,0x698d83,.016,.003,1);
  b.at(x-.18,.391,z+.028,0,.1,0,q=>q.pad(0,0,0,.269,.02,.188,0xe1c399,.011,.003,1));
  b.pad(x+.32,.367,z+.052,.081,.02,.172,0x585345,.014,.004,1);
  dinnerware(b,x+.115,.354,z-.064,0xf8edd9,.75);
}
function mediaBench(b) {
  const x=6.3,z=.435;
  furnitureLegs(b,x,.006,z,2.33,.181,.444,WALNUT,.048);
  b.pad(x,.35,z,2.58,.346,.545,0xbb865c,.055,.012,2);
  b.pad(x,.526,z,2.62,.046,.567,HONEY,.065,.008,2);
  for(const side of [-1,1]){
    const xx=x+side*.87;b.box(xx,.347,.713,.704,.26,.028,0xcfaa7c);
    for(let i=-4;i<=4;i++)b.box(xx+i*.07,.347,.737,.014,.228,.014,0xb58b5e);
    b.box(xx-side*.24,.387,.749,.089,.016,.020,BRASS);
  }
  b.box(x,.349,.713,.866,.245,.019,0x715944);
  b.box(x,.312,.735,.866,.022,.047,OAK);
  for(let i=0;i<4;i++)b.box(x-.17+i*.09,.385,.736,.069,.12+.018*(i%2),.032,[SAGE,FLAX,0xc07d63,0xa3ada3][i]);
  b.box(x,.57,z,.537,.033,.19,0x585447);b.box(x,.673,z,.07,.191,.062,0x4f5147);
  b.pad(x,1.19,z,1.847,1.045,.081,0x3f4943,.035,.009,2);
  potted(b,5.05,.551,.42,.40,1);
  b.at(7.49,.55,.39,0,-.22,0,q=>bear(q,0,0,0,.35));
}
function bookcase(b){
  b.at(8.13,0,1.83,0,-HALF,0,q=>{
    q.box(0,.901,-.135,1.49,1.716,.04,0xb58d67);
    for(const s of [-1,1])q.box(s*.737,.90,0,.048,1.79,.303,OAK);
    for(let i=0;i<5;i++)q.box(0,.105+i*.421,0,1.524,.047,.362,HONEY);
    const inks=[0x889c88,0xe4d2ad,0xbf826b,0x617d76,0xccaa6d,0x9b8b80];
    for(const [row,offset,count] of [[0,-.61,7],[1,.04,6],[2,-.65,6],[3,-.48,3]]){
      for(let j=0;j<count;j++){const xx=offset+j*.086,hh=.20+.104*seeded(row*22+j);
        q.at(xx,.131+row*.421,0,0,0,j===count-1?-.13:0,f=>{
          f.box(0,hh/2,0,.071,hh,.241,inks[(row+j)%6]);
          f.box(0,hh*.73,.122,.048,.014,.009,FLAX);
        });
      }
    }
    basket(q,.395,.13,.006,.47,.226,.232);potted(q,-.39,.553,.004,.41,2);
    bear(q,.38,.973,.018,.38);q.spin(.22,1.4,0,[[.075,0],[.111,.093],[.067,.175],[.043,.195]],0xc78869,10);
  });
}
function kitchen(b) {
  b.pad(2.15,.086,.51,3.49,.145,.693,0x98785d,.045,.008,1);
  b.pad(2.15,.473,.49,3.56,.704,.687,0xa4ad87,.048,.013,2);
  b.pad(2.15,.844,.499,3.68,.082,.752,0xe8dec8,.065,.012,2);
  for(let i=0;i<5;i++){const x=.716+i*.711;
    b.box(x,.48,.844,.665,.636,.032,0xb4bc96);
    b.box(x,.483,.867,.562,.505,.014,0xaab38f);
    b.box(x,.723,.887,.151,.022,.031,BRASS);
  }
  b.pad(1.27,.890,.515,.681,.027,.499,0x8c9b8d,.079,.004,2);
  b.pad(1.27,.906,.518,.566,.01,.391,0x748984,.061,.002,2);
  b.spin(1.265,.911,.51,[[.027,0],[.027,.002]],0x4e615c,9);
  b.stem(1.27,.88,.245,1.27,1.147,.245,.018,BRASS,7);
  b.stem(1.27,1.147,.245,1.27,1.181,.32,.018,BRASS,7);b.stem(1.27,1.181,.32,1.27,1.164,.422,.018,BRASS,7);
  b.pad(2.86,.904,.505,.696,.026,.50,0x4a5550,.045,.005,2);
  for(const s of [-1,1]){b.spin(2.86+s*.166,.92,.498,[[.126,0],[.126,.006]],0x6c7770,12);b.spin(2.86+s*.166,.928,.498,[[.096,0],[.096,.004]],0x49544e,12);}
  b.spin(3.018,.939,.497,[[.095,0],[.113,.028],[.109,.103],[.092,.114]],0xab7156,12);
  b.spin(3.018,1.054,.497,[[.112,0],[.091,.013],[.027,.035]],0xc4a376,12);
  b.box(3.152,1.013,.50,.108,.026,.031,WALNUT);
  b.pad(2.85,1.817,.31,.716,.122,.435,0x7d9485,.052,.009,2);
  b.box(2.85,2.08,.266,.292,.417,.269,0x94a699);
  b.box(1.40,1.648,.236,1.63,.071,.313,OAK);b.box(1.38,2.045,.226,1.59,.065,.289,HONEY);
  for(let i=0;i<4;i++){const x=.81+i*.245;
    b.spin(x,1.684,.258,[[.065,0],[.084,.032],[.084,.16],[.065,.182]],i%2?0xc9ae83:0xe1cdb0,9);
    b.spin(x,1.865,.258,[[.071,0],[.071,.019]],WALNUT,9);
  }
  for(let i=0;i<3;i++)dinnerware(b,1.08+i*.27,2.08,.24,[0xe9c18e,0x8a9c85,MILK][i],.90);
  potted(b,3.59,.886,.47,.33,0);
  b.at(.54,0,2.62,0,HALF,0,q=>{
    q.pad(0,.85,0,.865,1.70,.714,0x93a994,.12,.027,3);
    q.pad(0,.40,.364,.847,.728,.09,0xabb9a3,.041,.012,2);
    q.pad(0,1.226,.367,.847,.879,.098,0xb5c1aa,.042,.016,2);
    q.box(-.275,1.07,.43,.045,.246,.032,BRASS);q.box(-.275,.621,.428,.046,.123,.034,BRASS);
    q.at(.130,1.41,.421,0,0,-.083,f=>{f.box(0,0,0,.149,.19,.012,0xf1dfb8);f.box(0,.036,.009,.092,.008,.007,0xb29775);f.box(-.018,.003,.009,.055,.006,.007,0xb29775);f.globe(0,.084,.016,.024,.024,.015,0xc48962,7,4);});
  });
}
function dining(b) {
  const x=2.1,z=4.74;furnitureLegs(b,x,.012,z,1.27,.682,.70,WALNUT,.052);
  b.pad(x,.73,z,1.53,.093,.902,HONEY,.172,.014,3);
  b.pad(x,.782,z,.421,.01,.903,0xa7ac87,.016,.002,1);
  for(const s of [-1,1]){
    b.spin(x+s*.441,.785,z,[[.137,0],[.142,.014],[.116,.025]],0xf3e5ca,12);
    b.spin(x+s*.441,.81,z,[[.085,0],[.085,.004]],0xe6d4b3,12);
  }
  b.spin(x,.787,z,[[.061,0],[.099,.083],[.069,.143],[.041,.166]],0xb37855,10);
  for(let i=0;i<4;i++){const a=i*2.43,ex=x+Math.sin(a)*.091,ez=z+Math.cos(a)*.083;
    b.stem(x,.939,z,ex,1.09+i*.019,ez,.006,DEEP,4);
    b.globe(ex,1.10+i*.019,ez,.036,.033,.035,[0xeabb65,0xe8a37c,MILK][i%3],7,4);
  }
  chair(b,2.1,5.41,.516);chair(b,2.10,4.065,.516,Math.PI);
  b.spin(x,2.70,z,[[.062,0],[.062,.070]],WALNUT,9);
  b.stem(x,2.29,z,x,2.71,z,.008,WALNUT,5);
  b.spin(x,2.008,z,[[.243,0],[.248,.018],[.223,.064],[.153,.171],[.074,.231],[.049,.244]],0xdcbb88,16);
  for(let j=0;j<12;j++){const a=j*TAU/12,s=Math.sin(a),c=Math.cos(a);
    b.stem(x+s*.246,2.022,z+c*.246,x+s*.157,2.17,z+c*.157,.007,0xc4a076,4);
    b.stem(x+s*.157,2.17,z+c*.157,x+s*.069,2.24,z+c*.069,.007,0xc4a076,4);
  }
  b.spin(x,1.997,z,[[.204,0],[.237,.013]],0xf1ddb2,16);
  b.globe(x,2.001,z,.062,.043,.062,0xffebc4,8,4);
}


function bed(b) {
  const x=11.4,z=1.36;
  furnitureLegs(b,x,.012,z,1.58,.215,2.09,WALNUT,.061);
  b.pad(x,.263,z,1.74,.224,2.26,OAK,.103,.018,3);
  b.pad(x,.423,z,1.691,.194,2.19,0xf3dfbe,.145,.035,3);
  b.pad(x,.629,.278,1.80,.694,.115,HONEY,.049,.013,2);
  b.pad(x,.686,.351,1.636,.445,.082,0xb9b997,.038,.014,2);
  for(const s of [-1,1]){
    b.at(x+s*.391,.565,.59,0,s*.047,0,q=>{
      q.pad(0,0,0,.729,.138,.346,MILK,.125,.039,3);
      q.box(s*.25,.637-.565,0,.016,.005,.228,FLAX);
    });
  }
  b.pad(x,.581,1.594,1.716,.138,1.594,0xb88363,.117,.028,3);
  b.pad(x,.649,.921,1.679,.038,.242,0xe4bd95,.07,.01,2);
  for(const s of [-1,1])b.box(x+s*.705,.652,1.661,.026,.005,1.234,0xd4ab88);
  for(let i=0;i<5;i++)for(let j=0;j<4;j++){
    const xx=x+(i-2)*.258+(j%2)*.062,zz=1.165+j*.318;
    b.face([[xx-.04,.652,zz],[xx,.652,zz+.052],[xx+.04,.652,zz],[xx,.652,zz-.052]],0xc99775);
  }
  b.pad(10.18,.319,.534,.51,.59,.50,0xa58160,.048,.014,2);
  b.pad(10.18,.635,.53,.572,.051,.543,HONEY,.055,.009,2);
  b.box(10.18,.433,.787,.423,.223,.02,0xc59a71);b.globe(10.18,.434,.808,.027,.023,.02,BRASS,7,4);
  b.spin(10.20,.662,.53,[[.095,0],[.12,.031],[.095,.114],[.032,.181]],0x8a9d87,11);
  b.spin(10.20,.823,.53,[[.153,0],[.153,.015],[.088,.181]],0xf3dcaf,12);
}
function deskAndWardrobe(b) {
  b.at(8.89,0,3.14,0,HALF,0,q=>{
    furnitureLegs(q,0,.012,0,1.04,.67,.44,WALNUT,.044);
    q.pad(0,.725,0,1.23,.080,.594,HONEY,.068,.012,2);
    q.box(.277,.585,.016,.453,.189,.416,OAK);q.box(.27,.587,.229,.095,.018,.02,BRASS);
    q.pad(-.135,.774,.031,.463,.016,.301,0xb3b69a,.035,.004,1);
    q.at(-.105,.79,.011,0,-.087,0,f=>{f.box(-.054,0,0,.106,.019,.134,0xefdfc3);f.box(.054,.003,0,.104,.017,.134,MILK);});
    q.spin(-.435,.766,-.104,[[.044,0],[.052,.103]],0xbf8967,9);
    for(let i=0;i<3;i++)q.stem(-.448+i*.017,.84,-.11,-.456+i*.028,.949+i*.008,-.11,.007,[WALNUT,SAGE,0xc58365][i],4);
    q.spin(.404,.766,-.109,[[.077,0],[.076,.027],[.024,.043]],BRASS,9);
    q.stem(.405,.805,-.11,.405,1.071,-.11,.011,BRASS,6);q.stem(.405,1.071,-.11,.31,1.104,-.10,.011,BRASS,6);
    q.spin(.30,1.039,-.10,[[.074,0],[.064,.044],[.021,.074]],DEEP,9);
  });chair(b,9.40,3.12,.52,HALF);
  b.at(12.06,0,4.079,0,Math.PI,0,q=>{
    q.pad(0,.912,0,1.46,1.8,.506,0xa38767,.045,.013,2);
    for(const side of [-1,1]){q.box(side*.357,.925,.265,.681,1.65,.035,0xc29d74);
      q.box(side*.357,.981,.286,.552,1.40,.014,0xd2b087);
      q.stem(side*.066,.83,.31,side*.066,1.03,.31,.012,BRASS,6);
    }q.pad(0,1.844,0,1.50,.064,.549,HONEY,.038,.009,2);
  });
}
function serviceRooms(b) {
  b.at(10.30,0,6.69,0,-HALF,0,q=>{
    q.pad(0,.48,0,.781,.949,.683,0xd5d6c5,.074,.015,2);
    q.box(0,.817,.346,.68,.134,.024,0xecead7);
    q.box(-.173,.814,.366,.177,.051,.015,0x64736d);q.globe(.221,.816,.371,.039,.040,.019,BRASS,8,4);
    q.at(0,.435,.341,HALF,0,0,f=>{
      f.spin(0,0,0,[[.271,0],[.285,.037],[.261,.069]],0x9baaa0,16);
      f.spin(0,.069,0,[[.222,0],[.210,.018]],0x5c726e,16);
      f.spin(0,.09,0,[[.170,0],[.164,.006]],0x7e9691,14);
    });
    basket(q,-.045,.96,-.04,.403,.182,.279);
  });
  // Birch drying rail with a folded striped tea towel.
  b.stem(8.62,1.63,6.89,8.62,1.63,7.38,.018,OAK,7);
  for(const ending of [6.89,7.38])b.stem(8.47,1.63,ending,8.62,1.63,ending,.015,BRASS,6);
  b.box(8.63,1.43,7.15,.035,.390,.245,0xccb797);
  for(const zz of [7.075,7.101,7.20])b.box(8.652,1.425,zz,.009,.37,.012,0x8a9b87);
  b.at(12.87,0,6.53,0,-HALF,0,q=>{
    q.pad(0,.423,0,.848,.753,.482,0x8a9e90,.049,.012,2);
    q.pad(0,.822,0,.89,.065,.509,MILK,.063,.01,2);
    q.spin(0,.854,0,[[.129,0],[.202,.061],[.214,.102]],0xf4ecda,12,.80);
    q.spin(0,.958,0,[[.180,0],[.18,.002]],0xd4d4c1,12,.79);
    q.stem(0,.854,-.191,0,1.054,-.191,.014,BRASS,6);q.stem(0,1.054,-.191,0,1.055,-.061,.015,BRASS,6);
    q.box(0,.533,.246,.683,.364,.018,0x9faf9a);q.box(0,.647,.268,.126,.018,.036,BRASS);
  });
  b.at(11.75,0,6.06,0,-HALF,0,q=>{
    q.spin(0,.022,0,[[.141,0],[.123,.14],[.168,.25]],0xe1e1ce,12,1.19);
    q.spin(0,.249,0,[[.161,0],[.210,.105],[.204,.139]],0xf0edda,14,1.23);
    q.spin(0,.391,0,[[.198,0],[.198,.018]],0xe5e4cf,14,1.24);
    q.pad(0,.49,-.205,.356,.38,.181,0xe5e4d0,.051,.016,2);
  });
  b.pad(11.55,.043,7.62,1.15,.078,.89,0xbbbda8,.09,.01,2);
  b.pad(11.55,.084,7.62,1.04,.016,.79,0xd8d7c2,.07,.003,2);
  b.spin(11.50,.092,7.71,[[.039,0],[.039,.004]],0x879588,8);
  b.stem(11.52,.66,8.045,11.52,1.94,8.045,.016,BRASS,6);
  b.stem(11.52,1.94,8.045,11.52,1.94,7.826,.017,BRASS,6);
  b.spin(11.52,1.895,7.826,[[.076,0],[.073,.019],[.029,.044]],0xa19573,9);
  // The slatted splash divider stands beside the shower, away from the doorway.
  for(let i=0;i<6;i++)b.box(10.979,1.027,7.34+i*.114,.043,1.987,.045,0xb99d77);
}
function balconyAndEntry(b) {
  b.at(.325,0,5.31,0,HALF,0,q=>{
    q.pad(0,.32,0,.729,.574,.342,0xb4815d,.041,.01,2);q.pad(0,.62,0,.787,.048,.38,HONEY,.05,.01,2);
    for(const yy of [.21,.431]){q.box(0,yy,.183,.64,.17,.022,0xc69b76);q.box(0,yy+.048,.202,.094,.013,.019,BRASS);}
    bowlKeys(q,0,.646,.003);
  });
  drawRug(b,.91,6.21,.80,.80,0xb39c7a,0xcbb28a);
  b.at(7.60,0,8.28,0,Math.PI,0,q=>{
    furnitureLegs(q,0,.011,0,.49,.264,.647,WALNUT,.036);
    q.pad(0,.302,0,.595,.103,.683,0xc59b71,.047,.012,2);
    q.pad(0,.35,-.024,.525,.048,.581,0xabb297,.036,.009,2);
    q.at(0,.591,.293,-.27,0,0,f=>{f.pad(0,0,0,.557,.49,.079,HONEY,.031,.009,2);f.box(0,.002,-.043,.448,.404,.023,0xa2ac8a);for(let i=-2;i<=2;i++)f.box(i*.071,.002,-.057,.019,.387,.008,FLAX);});
  });
  for(const [x,z,h,v] of [[.59,8.32,.76,0],[1.58,8.73,.51,1],[5.33,8.77,.65,2],[7.93,7.96,.47,1],[4.66,.53,.90,1]])potted(b,x,0,z,h,v);
  b.spin(7.03,.005,8.66,[[.135,0],[.133,.02],[.044,.045],[.032,.34],[.237,.353],[.25,.387]],HONEY,11);
  dinnerware(b,7.03,.393,8.64,MILK,.59);
  for(let i=0;i<=16;i++)b.box(.08+i*.50,.477,8.94,.041,.932,.043,0x789087);
  b.box(4.09,.96,8.94,8.17,.074,.082,OAK);b.box(4.09,.249,8.94,8.13,.037,.049,0x879b8e);
  for(const x of [.055,8.145]){
    for(let i=0;i<=3;i++)b.box(x,.477,7.64+i*.43,.043,.932,.041,0x789087);
    b.box(x,.96,8.29,.082,.074,1.38,OAK);b.box(x,.249,8.29,.049,.037,1.38,0x879b8e);
  }
}
function bowlKeys(b,x,y,z){
  b.spin(x,y,z,[[.061,0],[.086,.014],[.094,.038]],0x7a9681,10,.84);
  b.box(x+.013,y+.041,z,.062,.007,.013,BRASS);
}
function dispenser(b) {
  b.pad(4.53,.394,4.59,.397,.775,.397,0xe1decc,.05,.012,2);
  b.box(4.53,.549,4.797,.257,.279,.02,0x91a299);
  for(const s of [-1,1])b.box(4.53+s*.062,.601,4.823,.035,.057,.036,s<0?0x877b66:0x8a9fa0);
  b.spin(4.53,.782,4.59,[[.103,0],[.144,.036],[.156,.089],[.156,.302],[.125,.339],[.085,.35]],0x91afac,12);
}
function art(b,x,y,z,w,h,variant=0) {
  b.box(x,y,z,w,h,.037,WALNUT);b.box(x,y,z+.022,w-.040,h-.04,.014,0xf2e6cb);
  b.box(x,y,z+.035,w-.101,h-.108,.009,[0xc4cead,0xe7c8a0,0xa7bab0][variant%3]);
  b.at(x,y,z+.042,HALF,0,0,q=>{
    if(variant%3===0){
      q.globe(-w*.19,.001,-h*.17,w*.115,.003,w*.115,0xebc887,12,3);
      for(let i=0;i<3;i++){
        const px=(i-1)*w*.185,zz=h*.22;
        q.stem(px,0,zz,px+w*.048,.002,-h*(.07+.06*i),.007,DEEP,4);
        q.leaf(px,.002,zz-.075,-1.95,.10,.055,.003,DEEP);
        q.leaf(px+.014,.003,zz-.13,1.65,.094,.049,.003,0x79906b);
      }
    }else if(variant%3===1)clover(q,0,.002,0,Math.min(w,h)*.49,0x688975);
    else {
      q.globe(0,.001,-h*.035,w*.224,.004,h*.169,0xc38c68,12,3);
      for(const s of [-1,1]){
        q.globe(s*w*.169,.003,-h*.16,w*.079,.003,h*.078,0xc38c68,8,3);
        q.globe(s*w*.073,.009,-h*.048,w*.018,.003,h*.018,WALNUT,7,3);
      }
      q.globe(0,.008,h*.018,w*.082,.004,h*.052,0xe5c9a5,9,3);
    }
  });
}


function makeScreen() {
  const material=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0x161e1b,emissiveIntensity:.48,roughness:.88,metalness:0,toneMapped:false});
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=216;
  const c=canvas.getContext('2d');
  if(c){
    const fade=c.createLinearGradient(0,0,0,216);fade.addColorStop(0,'#8eb9b7');fade.addColorStop(.59,'#dec9a4');fade.addColorStop(1,'#a4b599');c.fillStyle=fade;c.fillRect(0,0,384,216);
    c.fillStyle='#f2d59e';c.beginPath();c.arc(269,69,30,0,TAU);c.fill();
    for(const [col,base,a,phase] of [['#9bad99',132,29,1.2],['#728f82',153,19,2.8],['#466f68',171,16,1.8],['#395b54',200,17,3.1]]){
      c.beginPath();c.moveTo(0,216);for(let x=0;x<=384;x+=4)c.lineTo(x,base+a*Math.sin(x*.011+phase)+a*.32*Math.sin(x*.022+phase));c.lineTo(384,216);c.fillStyle=col;c.fill();
    }
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;material.map=map;
  }return material;
}
function addWalls(root,mat) {
  const walls=[];
  function wall(axis,fixed,from,to,opts={}) {
    const b=new Woodshop(),width=to-from,halfW=width/2,H=2.80,d=.14,mid=(from+to)/2;
    const panel=opts.col||0xe9dcc0,cap=0x988770;
    const local=(a,h1,end,h2)=>{if(end>a+.001&&h2>h1+.001)b.box((a+end)/2,(h1+h2)/2,0,end-a,h2-h1,d,panel);};
    const cuts=(opts.open||[]).map(([a,end,low,high,type])=>[a-mid,end-mid,low,high,type]).sort((a,c)=>a[0]-c[0]);let start=-halfW;
    function solid(a,end){local(a,0,end,H);if(end>a+.01){
      for(const s of [-1,1])b.box((a+end)/2,.061,s*.077,end-a,.12,.022,0xc0a586);
    }}
    for(const [a,end,low,high,type] of cuts){
      solid(start,a);local(a,0,end,low);local(a,high,end,H);
      if(low>0)for(const side of [-1,1])b.box((a+end)/2,.061,side*.077,end-a,.12,.022,0xc0a586);
      if(type==='window'||type==='slider'){
        const frame=type==='slider'?DEEP:0xb29169;
        for(const x of [a+.026,end-.026])b.box(x,(low+high)/2,0,.052,high-low,.169,frame);
        for(const y of [low+.022,high-.022])b.box((a+end)/2,y,0,end-a,.05,.17,frame);
        if(type==='window'){
          b.box((a+end)/2,low,0,end-a+.12,.053,.236,HONEY);
          b.box((a+end)/2,(low+high)/2,0,.039,high-low,.077,frame);
          b.box((a+end)/2,low+(high-low)*.66,0,end-a,.033,.069,frame);
        }else for(const x of [a+.35,end-.35])b.box(x,(low+high)/2,0,.023,high-low,.075,frame);
      } else if(type==='door'){
        for(const x of [a-.022,end+.022])b.box(x,high/2,0,.060,high,.172,OAK);
        b.box((a+end)/2,high+.022,0,end-a+.14,.066,.17,OAK);
      }
      start=end;
    }
    solid(start,halfW);b.box(0,H+.008,0,width+.025,.028,d+.022,cap);
    if(opts.art)for(const [at,y,w,h,v,side] of opts.art){
      b.at(at-mid,y,.083*side,0,side===1?0:Math.PI,0,q=>art(q,0,0,0,w,h,v));
    }
    if(opts.mirror){const [at,y,side]=opts.mirror;b.at(at-mid,y,.082*side,0,side===1?0:Math.PI,0,q=>{q.box(0,0,0,.671,.652,.044,OAK);q.box(0,.004,.029,.607,.594,.016,0xb1c4bb);q.face([[-.237,-.171,.040],[-.196,-.193,.040],[.177,.210,.040],[.131,.216,.040]],0xc1d0c6);q.box(0,-.346,.054,.716,.034,.150,HONEY);});}
    if(opts.curtain)for(const [a,end,lo,hi,side] of opts.curtain) {
      b.stem(a-mid-.07,hi+.08,side*.11,end-mid+.07,hi+.08,side*.11,.016,BRASS,6);
      for(const [edge,dir] of [[a,1],[end,-1]])for(let i=0;i<3;i++){
        b.box(edge-mid+dir*(.024+i*.051),(lo+hi)/2,side*(.115+(i%2)*.029),.068,hi-lo+.012,.050,i%2?0xddcfac:0xede0c2);
      }
    }
    const wallMaterial=mat.clone();
    const m=b.mesh(wallMaterial,'Partition '+axis+' '+fixed+' '+from);m.position.set(axis==='x'?mid:fixed,0,axis==='x'?fixed:mid);if(axis==='z')m.rotation.y=-HALF;
    root.add(m);walls.push({mesh:m,axis,fixed,from,to,height:H+.022,openings:opts.open||[],material:wallMaterial});return m;
  }
  wall('x',0,0,4.2,{open:[[.40,2.26,1.08,1.54,'window']]});
  wall('x',0,4.2,8.4,{col:0xe9dcc0,art:[[7.77,1.59,.49,.68,0,1]]});
  wall('x',0,8.4,13.2,{art:[[11.40,1.68,.95,.54,0,1]]});
  wall('z',0,0,3.6,{open:[[1.04,1.97,1.12,1.97,'window']]});
  wall('z',0,3.6,7.6,{open:[[5.77,6.76,0,2.17,'door']]});
  wall('z',13.2,0,4.4,{open:[[1.33,3.03,.99,2.15,'window']],curtain:[[1.33,3.03,.90,2.16,1]]});
  wall('z',13.2,4.4,5.6);wall('z',13.2,5.6,8.2,{open:[[7.02,7.88,1.39,2.13,'window']],mirror:[6.50,1.49,1]});
  wall('z',8.4,0,4.4,{art:[[3.15,1.44,.53,.60,1,-1]]});
  wall('z',8.4,4.4,5.6,{open:[[4.52,5.49,0,2.19,'door']]});
  wall('x',4.4,8.4,13.2,{open:[[8.69,9.67,0,2.16,'door']],art:[[10.22,1.47,.46,.57,0,1],[10.86,1.56,.46,.57,1,1],[11.50,1.46,.46,.57,2,1]],col:0xe4cbb3});
  wall('x',5.6,8.4,10.8,{open:[[9.11,10.10,0,2.14,'door']]});
  wall('x',5.6,10.8,13.2,{open:[[11.89,12.81,0,2.15,'door']]});
  wall('z',8.4,5.6,7.6);wall('z',10.8,5.6,8.2);
  wall('x',7.6,0,4.2,{open:[[1.04,3.01,.91,2.02,'window']]});
  wall('x',7.6,4.2,8.4,{open:[[4.68,7.97,0,2.21,'slider']]});
  wall('x',7.6,8.4,10.8,{open:[[9.07,10.07,1.23,2.07,'window']]});
  wall('x',8.2,10.8,13.2);return walls;
}
function hotspotList(root,pickMat) {
  const defs=[
    ['kitchen','fridge',.54,.86,2.62,.90,1.72,.72,'厨房冰箱'],['kitchen','sink',1.27,.90,.51,.69,.20,.50,'厨房水槽'],
    ['kitchen','stove',2.86,.94,.5,.72,.26,.55,'厨房灶台'],['kitchen','dining',2.1,.71,4.74,1.52,.79,.89,'餐桌'],
    ['living','sofa',6.30,.49,5.13,2.13,.79,.84,'客厅沙发'],['living','water',4.53,.58,4.59,.43,1.13,.43,'饮水机'],
    ['living','shelf',8.13,.89,1.83,.38,1.79,1.53,'客厅书架'],['living','rug',6.23,.025,3.19,2.89,.02,2.60,'编织地毯'],
    ['living','tv',6.3,1.19,.49,1.87,1.05,.10,'客厅电视'],['her_room','bed',11.4,.43,1.39,1.76,.85,2.25,'卧室床铺'],
    ['her_room','bedside',10.18,.37,.53,.55,.73,.53,'床头柜'],['her_room','desk',8.89,.53,3.14,.63,.80,1.23,'卧室书桌'],
    ['her_room','wardrobe',12.06,.93,4.08,1.49,1.86,.56,'木衣柜'],['her_room','window',13.13,1.57,2.2,.14,1.14,1.72,'卧室窗边'],
    ['corridor','gallery',10.85,1.5,4.51,1.87,.76,.06,'走廊画廊'],['bathroom','sink',12.87,.56,6.53,.51,1.05,.9,'洗手台'],
    ['bathroom','toilet',11.75,.30,6.06,.54,.61,.44,'马桶'],['bathroom','shower',11.54,1.00,7.86,.75,1.96,.51,'淋浴间'],
    ['laundry','washer',10.3,.48,6.69,.70,.96,.79,'洗衣机'],['balcony','rail',3,.67,8.93,3.52,.70,.10,'阳台栏杆'],
    ['balcony','chair',7.60,.42,8.28,.61,.84,.72,'阳台躺椅'],['balcony','plant',.59,.39,8.32,.46,.79,.46,'阳台花盆'],
    ['foyer','door',.01,1.08,6.26,.10,2.16,.95,'玄关门口'],['foyer','shoe',.325,.35,5.31,.38,.70,.77,'鞋柜'],
    ['garden','gate',.14,1.47,-3.59,.42,.39,1.25,'菜园门廊'],['garden','shop',2,.77,-7.035,1.78,1.54,.79,'种子工作台'],
    ['garden','market',4.70,.395,-7.055,1.25,.79,.52,'收成篮'],['garden','compost',12.14,.37,-6.57,.90,.74,.86,'堆肥箱'],
    ['yard','path',-.64,.02,3,.65,.035,1.70,'屋外小径']
  ];
  const unit=new THREE.BoxGeometry(1,1,1);
  return defs.map(([room,spot,x,y,z,w,h,d,title])=>{
    const m=new THREE.Mesh(unit,pickMat);m.name=title;m.position.set(x,y,z);m.scale.set(w,h,d);m.userData.hotspot={room,spot,title,sub:title};root.add(m);return m;
  });
}
function timepiece(root,mat) {
  const x=6.31,y=2.19,z=.105,b=new Woodshop();
  b.at(0,0,0,HALF,0,0,q=>{q.spin(0,0,0,[[.171,0],[.178,.02],[.167,.044]],WALNUT,24);q.spin(0,.044,0,[[.148,0],[.148,.005]],MILK,24);});
  for(let i=0;i<12;i++){const a=i*TAU/12;b.at(Math.sin(a)*.118,Math.cos(a)*.118,.054,0,0,-a,q=>q.box(0,0,0,.008,i%3===0?.031:.015,.005,DEEP));}
  const dial=b.mesh(mat,'Oak kitchen clock');dial.position.set(x,y,z);root.add(dial);
  function hand(length,width,dz,ink) {
    const p=new Woodshop();p.box(0,length*.40,0,width,length,.009,ink);const mesh=p.mesh(mat,'Clock hand');mesh.position.set(x,y,z+dz);root.add(mesh);return mesh;
  }
  return {hour:hand(.082,.015,.065,WALNUT),minute:hand(.12,.010,.077,DEEP)};
}
function getBoxes() {
  const specs=[['Fridge',.54,.86,2.62,.74,1.72,.88],['Shelf',8.13,.90,1.83,.38,1.8,1.53],['Television',6.30,1.19,.44,1.85,1.05,.09],['Wardrobe',12.06,.93,4.08,1.50,1.86,.55],['Desk',8.89,.383,3.14,.6,.77,1.23],['Kitchen counter',2.15,.443,.50,3.68,.886,.75],['Washer',10.30,.48,6.69,.69,.96,.78]];
  return specs.map(([name,x,y,z,w,h,d])=>({name,box:new THREE.Box3(new THREE.Vector3(x-w/2,y-h/2,z-d/2),new THREE.Vector3(x+w/2,y+h/2,z+d/2))}));
}
function ownedResources(root) {
  const gs=new Set(),ms=new Set(),ts=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material){for(const mat of Array.isArray(o.material)?o.material:[o.material]){ms.add(mat);if(mat.map)ts.add(mat.map);}}});
  return ()=>{gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());};
}
export function createWorld(renderer,{quality='balanced'}={}) {
  const scene=new THREE.Scene(),root=new THREE.Group();root.name='Clover Cottage';scene.add(root);
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88,metalness:0});
  const pickMat=new THREE.MeshBasicMaterial({visible:false});
  const base=new Woodshop(),site=SITE_BOUNDS;
  base.box((site.minX+site.maxX)/2,(site.top+site.bottom)/2,(site.minZ+site.maxZ)/2,
    site.maxX-site.minX,site.top-site.bottom,site.maxZ-site.minZ,0x97a68a);
  const foundation=base.mesh(mat,'Continuous house and garden foundation');root.add(foundation);
  const architecture=new Woodshop();
  floorboards(architecture,0,3.60,4.2,7.60);floorboards(architecture,4.2,0,8.4,7.60);floorboards(architecture,8.4,0,13.2,4.40);
  floorboards(architecture,8.4,4.4,13.2,5.6);tilefloor(architecture,0,0,4.2,3.6,.44,[0xe2d8bd,0xede1c8,0xe8dcc1]);
  tilefloor(architecture,8.4,5.6,10.8,7.60,.37,[0xbfc6b2,0xcfd3c0,0xd1d4c3]);tilefloor(architecture,10.8,5.6,13.2,8.2,.34,[0xc3c9b9,0xd4d6c3,0xcbd2be]);
  floorboards(architecture,0,7.60,8.2,9,0,[0xb89771,0xc2a27b,0xccaf88]);root.add(architecture.mesh(mat,'Oiled oak, limestone and balcony boards'));
  const walls=addWalls(root,mat);
  const living=new Woodshop();drawRug(living,6.23,3.52,2.96,2.68,0xa8ad8b,0x788a73);sofa(living);floorLamp(living,7.63,4.85);coffeeTable(living);mediaBench(living);bookcase(living);dispenser(living);
  root.add(living.mesh(mat,'Living room upholstery, media cabinet and library'));
  const eating=new Woodshop();kitchen(eating);dining(eating);root.add(eating.mesh(mat,'Kitchen fittings and breakfast table'));
  const contact=new Woodshop();
  for(const [x,z,w,d,c,yy] of [[6.3,5.18,2.08,.83,0xba8e67,.005],[5.68,3.82,1.04,.55,0x959e81,.045],[2.1,4.76,1.52,.90,0xc1956c,.005],[11.4,1.37,1.83,2.33,0xbd916b,.005],[7.65,4.87,.36,.34,0xba906d,.005],[.54,2.63,.82,.92,0xd1c7ae,.007],[7.61,8.44,.70,.74,0xb79a77,.005]]){
    contact.pad(x,yy,z,w,.004,d,c,Math.min(w,d)*.39,0,2);
  }root.add(contact.mesh(mat,'Contact shade beneath furnishings'));
  const sleeping=new Woodshop();bed(sleeping);deskAndWardrobe(sleeping);drawRug(sleeping,10.17,2.33,.72,1.42,0xc9b597,0xa79475);root.add(sleeping.mesh(mat,'Sleeping room and writing desk'));
  const outer=new Woodshop();serviceRooms(outer);balconyAndEntry(outer);root.add(outer.mesh(mat,'Balcony, entry, bath and laundry'));
  const ceiling=new THREE.Group();ceiling.name='Room roofs';root.add(ceiling);
  const roofs=ROOF_AREAS.map(area=>{
    const [x0,z0,x1,z1]=area.bounds,b=new Woodshop();
    b.box((x0+x1)/2,2.842,(z0+z1)/2,x1-x0,.076,z1-z0,0xe0cfb1);
    const mesh=b.mesh(mat.clone(),'Roof '+area.id);ceiling.add(mesh);
    return {id:area.id,bounds:area.bounds,mesh};
  });
  const clockHands=timepiece(root,mat);
  const screenMat=makeScreen(),tvScreen=new THREE.Mesh(new THREE.PlaneGeometry(1.772,.995),screenMat);tvScreen.position.set(6.3,1.19,.478);tvScreen.name='Television picture';root.add(tvScreen);
  const hotspots=hotspotList(root,pickMat);const release=ownedResources(root);let disposed=false;
  const ambient=new THREE.HemisphereLight(0xffedcf,0xc5b7a0,1.47),sun=new THREE.DirectionalLight(0xffe1b8,2.0);
  sun.position.set(-2,11,-1.5);sun.target.position.set(6,0,2);scene.add(ambient,sun,sun.target);
  const fill=new THREE.DirectionalLight(0xd9e8dd,.51);fill.position.set(9,5,11);scene.add(fill);
  const state={hour:-1,lamp:null,asleep:null,kind:null};const sky=new THREE.Color();scene.background=sky.setHex(0x354b4b);
  return {scene,root,walls,hotspots,clockHands,ceiling,roofs,foundation,siteBounds:site,tvScreen,quality,occluders:getBoxes(),
    setClock(hours,minutes){clockHands.hour.rotation.z=-TAU*((hours%12)+minutes/60)/12;clockHands.minute.rotation.z=-TAU*minutes/60;},
    updateEnvironment({hour=12,lamp=false,asleep=false,kind=''}={}) {
      const h=Math.floor(hour);if(state.hour===h&&state.lamp===lamp&&state.asleep===asleep&&state.kind===kind)return {shadowDirty:false};
      const day=Math.max(0,Math.sin(Math.PI*(h-5.5)/13)),dusk=Math.max(0,1-Math.abs(h-17.7)/2.6);
      ambient.color.setHex(0xe8ecdc).lerp(new THREE.Color(0x9faecc),1-day);ambient.groundColor.setHex(0xe3c6a5);
      ambient.intensity=.99+.56*day+(lamp?.21:0);sun.intensity=.59+day*1.29+dusk*.28;sun.color.setHex(dusk>.4?0xffbb8a:day>.04?0xffdec0:0xc6d2ec);
      sun.position.set(-2+day*2,8+4*day,-3+day*2);fill.color.setHex(lamp?0xffdba6:0xe5edde);fill.intensity=lamp?.87:.55;
      sky.setHex(0x283f44).lerp(new THREE.Color(0x708584),day*.51);Object.assign(state,{hour:h,lamp,asleep,kind});return {shadowDirty:true};
    },
    dispose(){if(disposed)return;disposed=true;release();root.removeFromParent();ambient.removeFromParent();sun.removeFromParent();sun.target.removeFromParent();fill.removeFromParent();}
  };
}

