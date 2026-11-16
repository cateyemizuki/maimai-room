import * as THREE from '../upstream/vendor/three.module.js';
import {Woodshop,seeded,clover,basket,potted} from './room-world.js';

const HALF=Math.PI/2,TAU=Math.PI*2;
const OAK=0xb1845e, RIM=0xc6a17a, DARK=0x786345, SAGE=0x788d75, CREAM=0xeaddbb;
export const GARDEN_PLOTS=Array.from({length:8},(_,id)=>({id,x:2+(id%4)*2.7,z:id<4?-2.2:-5,width:2.05,depth:1.65}));

function turf(b) {
  b.pad(6.05,-.110,-3.94,14.2,.206,7.29,0x97a68a,.23,.027,3);
  b.pad(-.63,-.084,3.28,.92,.15,7.04,0xa2aa88,.09,.012,2);
  function lane(x,z,w,d,alongX) {
    b.pad(x,.002,z,w,.024,d,0xb6b393,.046,.004,1);
    const length=alongX?w:d,width=alongX?d:w;
    const n=Math.max(1,Math.round(length/.63));const size=length/n;
    for(let i=0;i<n;i++){
      const offset=(i-(n-1)/2)*size;
      const sw=alongX?size-.032:width-.041,sd=alongX?width-.041:size-.032;
      b.pad(x+(alongX?offset:0),.020,z+(alongX?0:offset),sw,.021,sd,[0xd4cdb3,0xc8c6ab,0xd9d2b9,0xc9c4a9][(i+Math.round(length))%4],.055,0,1);
    }
  }
  lane(-.64,1.42,.69,10.46,false);lane(.72,-3.76,.60,6.59,false);
  lane(6.28,-.88,10.50,.61,true);lane(5.52,-3.61,12.02,.66,true);lane(6.34,-6.36,10.68,.60,true);
  for(const x of [3.36,6.05,8.76,11.48])for(const z of [-2.22,-4.96])lane(x,z,.41,1.98,false);
  // Small low grass groups live at the margins of the paths.
  for(let i=0;i<60;i++){
    const x=i%2===0?-.90+seeded(i)*.30:12.29+seeded(i)*.53,z=-.48-seeded(i+41)*6.79;
    for(let j=0;j<3;j++)b.leaf(x,.001,z,i+j*2.12,.045+.064*seeded(i+j),.028,.079+.031*seeded(i+1),[0x849971,0xb2b58b,0x7a9271][j]);
  }
}
function post(b,x,z,h,w=.071,c=0xe4d6b6){
  b.box(x,h*.47,z,w,h*.94,w,c);
  b.spin(x,h*.92,z,[[w*.77,0],[.001,h*.115]],c,4);
}
function fenceLine(b,x0,z0,x1,z1) {
  const dx=x1-x0,dz=z1-z0,length=Math.hypot(dx,dz),n=Math.ceil(length/.52),ang=Math.atan2(dx,dz);
  for(let i=0;i<=n;i++)post(b,x0+dx*i/n,z0+dz*i/n,.58);
  b.at((x0+x1)/2,0,(z0+z1)/2,0,ang,0,q=>{
    for(const y of [.19,.404])q.box(0,y,0,.047,.065,length+.016,0xbe9d74);
  });
}
function lantern(b,x,z) {
  b.spin(x,.004,z,[[.106,0],[.103,.034],[.039,.074]],DARK,8);
  b.spin(x,.078,z,[[.032,0],[.028,.89]],DARK,7);
  b.spin(x,.966,z,[[.111,0],[.115,.023],[.098,.037]],DARK,8);
  b.spin(x,1.004,z,[[.082,0],[.1,.166]],0xf5daa0,8);
  for(const s of [-1,1])for(const t of [-1,1])b.stem(x+.056*s,1.0,z+.056*t,x+.069*s,1.17,z+.069*t,.009,DARK,4);
  b.spin(x,1.17,z,[[.136,0],[.145,.019],[.067,.108],[.023,.12]],0x5d7163,8);
}
function trellis(b) {
  const z=-3.59;
  for(const s of [-1,1]){
    const zz=z+s*.481;b.box(.138,.78,zz,.099,1.56,.096,OAK);
    b.box(.14,1.49,zz,.32,.063,.082,RIM);
    for(let j=0;j<5;j++){
      const y=.51+j*.205,ang=j*.85+s;
      b.stem(.141,y-.18,zz,.145+.047*Math.sin(ang),y,zz+s*.025,.013,0x7c8661,5);
      b.leaf(.145,y,zz,ang,.135,.084,.034,0x78946c);
    }
  }
  b.box(.141,1.54,z,.09,.098,1.16,OAK);
  for(const side of [-1,1])b.box(.141+side*.149,1.584,z,.053,.064,1.25,RIM);
  for(let i=-2;i<=2;i++)b.box(.141,1.631,z+i*.228,.427,.042,.049,RIM);
  b.at(.153,1.52,z,0,-HALF,0,q=>{q.box(0,-.109,0,.376,.151,.037,0x648470);q.at(0,-.114,.021,HALF,0,0,f=>clover(f,0,0,0,.093,CREAM));});
}
function shedTable(b) {
  b.at(2,0,-7.035,0,0,0,q=>{
    for(const sx of [-1,1])for(const sz of [-1,1])q.box(sx*.77,.41,sz*.232,.073,.82,.071,OAK);
    q.box(0,.21,0,1.61,.055,.511,OAK);q.pad(0,.713,0,1.73,.079,.596,RIM,.057,.009,2);
    for(const s of [-1,1]){q.box(s*.779,1.03,-.206,.064,.794,.068,OAK);q.box(s*.781,1.411,-.058,.052,.053,.421,OAK);}
    for(let i=0;i<7;i++)q.box((i-3)*.225,1.006,-.238,.193,.449,.035,0xc19a72);
    q.at(0,1.512,-.02,.16,0,0,f=>{
      for(let i=0;i<8;i++){
        const x=(i-3.5)*.222,colour=i%2?0xd0b58a:0x7d9983;
        f.box(x,0,0,.224,.043,.775,colour);f.pad(x,-.065,.36,.223,.121,.044,colour,.019,.006,1);
      }
    });
    const tones=[0xdca772,0xa6af83,0xc68c76];
    for(let i=0;i<3;i++)q.at(-.56+i*.249,.76,-.027,0,.065*(i-1),.07*(i-1),f=>{
      f.box(0,.096,0,.174,.191,.044,0xe4cea5);f.box(0,.11,.026,.127,.106,.008,tones[i]);
      f.at(0,.105,.031,HALF,0,0,g=>clover(g,0,0,0,.076,CREAM));
    });
    basket(q,.38,.755,-.003,.38,.172,.243);
    q.spin(.53,.249,.014,[[.108,0],[.121,.261],[.112,.282]],0xaf8964,10);
  });
}
function wateringCan(b,x,y,z,size=1) {
  b.at(x,y,z,0,0,0,q=>{
    const s=size;
    q.spin(0,0,0,[[.087*s,0],[.136*s,.026*s],[.129*s,.209*s],[.091*s,.243*s]],0x7a9e96,12,.82);
    q.spin(0,.242*s,0,[[.078*s,0],[.074*s,.008*s]],0x566e65,10,.72);
    q.stem(-.106*s,.049*s,0,-.243*s,.211*s,0,.041*s,0x91b4a7,8,.028*s);
    q.stem(-.244*s,.209*s,0,-.281*s,.240*s,0,.046*s,0xb8b59b,8,.059*s);
    const a=[[.101,.045],[.177,.081],[.208,.172],[.177,.234],[.108,.238]];
    for(let i=1;i<a.length;i++)q.stem(a[i-1][0]*s,a[i-1][1]*s,0,a[i][0]*s,a[i][1]*s,0,.014*s,0x75968b,6);
  });
}
function market(b){
  b.at(4.70,0,-7.055,0,0,0,q=>{
    for(const s of [-1,1])for(const d of [-1,1])q.box(s*.534,.24,d*.20,.061,.475,.062,DARK);
    q.box(0,.465,0,1.23,.064,.51,RIM);q.box(0,.19,0,1.16,.053,.471,OAK);
    for(const s of [-1,1]){
      basket(q,s*.313,.501,0,.551,.168,.382);
      for(let j=0;j<5;j++){const x=s*.313+(j%3-1)*.125,z=(Math.floor(j/3)-.5)*.108;
        q.globe(x,.706,z,.058,.056,.055,s<0?0xcb7c5b:0xdac087,8,4);
        q.leaf(x,.755,z,j*1.8,.045,.029,.011,SAGE);
      }
    }
    wateringCan(q,-.22,.222,.018,.68);
  });
}
function compost(b){
  b.at(12.14,0,-6.57,0,-.11,0,q=>{
    q.box(0,.28,0,.78,.548,.729,0x7e7758);
    for(let i=0;i<4;i++){
      for(const s of [-1,1]){
        q.box(0,.106+i*.151,s*.376,.871,.109,.05,i%2?0xa1855e:0xb3976a);
        q.box(s*.42,.106+i*.151,0,.051,.109,.748,i%2?0x957f5a:0xa68e66);
      }
    }
    for(const sx of [-1,1])for(const sz of [-1,1])q.box(sx*.397,.34,sz*.36,.062,.65,.066,DARK);
    q.at(0,.682,0,.052,0,0,f=>{for(let i=0;i<5;i++)f.box((i-2)*.17,0,0,.161,.056,.847,SAGE);f.box(0,.047,-.013,.151,.037,.044,DARK);});
    q.box(0,.36,.407,.222,.177,.026,0xe4cfa6);
    q.at(0,.363,.426,HALF,0,0,f=>clover(f,0,0,0,.12,0x778364));
  });
  b.spin(12.31,0,-1.31,[[.232,0],[.276,.106],[.285,.557],[.259,.63]],0x7d9d97,14);
  for(const hh of [.131,.466,.625])b.spin(12.31,hh,-1.31,[[.281,0],[.282,.032]],0x667a70,14);
  b.spin(12.31,.658,-1.31,[[.269,0],[.269,.041]],OAK,14);
  wateringCan(b,12.03,.002,-1.15,.88);
}
function digit(b,num,x,y,z,scale,flip) {
  const seg=[[0,.071,.062,.011],[.031,.037,.010,.063],[.031,-.037,.010,.063],[0,-.071,.062,.011],[-.031,-.037,.010,.063],[-.031,.037,.010,.063],[0,0,.062,.011]];
  const bits=['012345','12','01643','01236','5612','05623','054623','012','0123456','012356'][num];
  for(const i of bits){const [xx,yy,w,h]=seg[Number(i)];b.box(x+(flip?-xx:xx)*scale,y+yy*scale,z,w*scale,h*scale,.006,DARK);}
}
function bedFrames(b,p){
  const {x,z,width:w,depth:d,id}=p;
  b.pad(x,.060,z,w+.1,.108,d+.105,0x827c5c,.065,.009,1);
  for(const side of [-1,1]){
    b.box(x,.135,z+side*(d/2-.034),w,.181,.074,id%3===0?0xb38c60:OAK);
    b.box(x+side*(w/2-.035),.135,z,.073,.181,d-.066,id%3===0?0xaa865c:0x987751);
    b.box(x,.229,z+side*(d/2-.034),w,.015,.081,RIM);
    b.box(x+side*(w/2-.034),.229,z,.08,.015,d-.068,RIM);
  }
  for(const sx of [-1,1])for(const sz of [-1,1])b.box(x+sx*(w/2-.055),.164,z+sz*(d/2-.056),.116,.225,.116,0x725d43);
  const lx=x-.697,lz=z+d/2-.117;b.box(lx,.312,lz,.035,.262,.045,OAK);
  b.pad(lx,.454,lz,.218,.169,.042,CREAM,.013,.004,1);
  digit(b,id+1,lx,.453,lz+.023,.72,false);digit(b,id+1,lx,.453,lz-.023,.72,true);
}
function flowers(b,x,z,seed){
  for(let i=0;i<4;i++){const a=seeded(i+seed)*TAU,rr=.03+.09*seeded(i+seed+65),xx=x+Math.sin(a)*rr,zz=z+Math.cos(a)*rr,h=.26+seeded(i+seed+9)*.16;
    b.stem(x,.13,z,xx,h,zz,.007,SAGE,4);
    for(let j=0;j<5;j++){const a2=j*TAU/5;b.globe(xx+Math.sin(a2)*.028,h,zz+Math.cos(a2)*.028,.027,.016,.031,i%2?0xe9be73:0xf0dfac,6,3);}
    b.globe(xx,h+.012,zz,.018,.017,.018,0xbb8554,6,3);
  }
}


function classify(id){
  const n=String(id||'').toLowerCase();
  if(/tomato|番茄|西红柿/.test(n))return 'tomato';
  if(/pepper|chili|椒/.test(n))return 'pepper';
  if(/eggplant|aubergine|茄/.test(n))return 'eggplant';
  if(/cucumber|bean|pea|cucum|豆角|黄瓜|豌豆/.test(n))return 'vine';
  if(/corn|maize|玉米/.test(n))return 'corn';
  if(/wheat|rice|稻|麦/.test(n))return 'grain';
  if(/carrot|胡萝卜/.test(n))return 'carrot';
  if(/radish|turnip|beet|萝卜|甜菜/.test(n))return 'radish';
  if(/potato|yam|土豆|薯/.test(n))return 'potato';
  if(/pumpkin|melon|南瓜|瓜/.test(n))return 'pumpkin';
  if(/berry|莓/.test(n))return 'berry';
  if(/onion|garlic|leek|葱|蒜/.test(n))return 'onion';
  if(/cabbage|卷心菜|包菜/.test(n))return 'cabbage';
  if(/flower|sunflower|花/.test(n))return 'flower';
  return 'leaf';
}
function foliage(b,x,y,z,angle,n,length,width,rise,cols) {
  for(let i=0;i<n;i++)b.leaf(x,y,z,angle+i*TAU/n,length*(.86+.14*seeded(i+n)),width,rise*(.84+.16*seeded(i+1)),cols[i%cols.length]);
}
function stalk(b,x,y,z,h,ink=0x789267){b.stem(x,y,z,x,y+h,z,.012,ink,5,.009);}
function crop(b,kind,x,z,stage,seed) {
  const y=.205,a=seeded(seed+41)*TAU;
  const leaf=[0x718a5d,0x91a365,0xa6b077],deep=[0x608665,0x82a075,0x9cae78];
  if(stage===0){foliage(b,x,y,z,a,3,.069,.036,.066,deep);return;}
  const growth=[.30,.52,.77,1][stage]||1,t=growth;
  if(kind==='leaf'){
    for(let layer=0;layer<3;layer++){const L=(.232-layer*.067)*t,wide=(.174-layer*.028)*t,ht=(.051+layer*.065)*t;
      foliage(b,x,y+.008*layer,z,a+layer*.68,5-layer%2,L,wide,ht,layer===2?[0xaeba7e,0xc0c79a]:leaf);
    }
  }else if(kind==='cabbage'){
    foliage(b,x,y+.012,z,a,6,.205*t,.165*t,.068*t,[0x73967e,0x8eac8c,0xa4b99a]);
    b.globe(x,y+.106*t,z,.149*t,.128*t,.144*t,stage===3?0xb8c7a0:0xa6b999,10,5);
    for(let i=0;i<4;i++){const u=a+i*HALF;b.leaf(x+.059*t*Math.sin(u),y+.125*t,z+.059*t*Math.cos(u),u,.082*t,.101*t,.064*t,0x9cb694);}
  }else if(kind==='radish'||kind==='carrot'){
    if(stage>=2)b.globe(x,y+.012,z,(kind==='radish'?.089:.058)*t,.073*t,(kind==='radish'?.087:.058)*t,kind==='radish'?0xc47685:0xd99050,9,4);
    if(kind==='radish')foliage(b,x,y+.056*t,z,a,6,.168*t,.089*t,.132*t,deep);
    else for(let j=0;j<5;j++){
      const angle=a+j*TAU/5,ex=x+Math.sin(angle)*.082*t,ez=z+Math.cos(angle)*.082*t,h=.21*t;
      b.stem(x,y+.025,z,ex,y+h,ez,.007,0x83a06e,4);
      for(let k=1;k<=3;k++){const f=k/3;for(const s of [-1,1])b.leaf(x+(ex-x)*f,y+h*f,z+(ez-z)*f,angle+s*.86,.052*t,.025*t,.037*t,leaf[k%3]);}
    }
  }else if(kind==='potato'||kind==='berry'||kind==='pumpkin'){
    foliage(b,x,y+.033,z,a,7,.205*t,.114*t,.11*t,deep);
    if(kind==='potato')foliage(b,x,y+.036,z,a+.4,4,.101*t,.066*t,.144*t,leaf);
    if(stage>=2)for(let j=0;j<(kind==='pumpkin'?2:3);j++){
      const angle=a+j*2.2,r=.104*t,xx=x+Math.sin(angle)*r,zz=z+Math.cos(angle)*r;
      if(kind==='pumpkin'){
        for(let k=0;k<5;k++)b.globe(xx+Math.sin(k*TAU/5)*.043*t,y+.056*t,zz+Math.cos(k*TAU/5)*.043*t,.056*t,.071*t,.054*t,stage===3?0xd4914c:0xadb377,7,4);
        b.stem(xx,y+.12*t,zz,xx+.007,y+.153*t,zz,.012*t,DARK,5);
      }else if(kind==='berry'){b.globe(xx,y+.082*t,zz,.042*t,.054*t,.039*t,stage===3?0xcf6e62:0xb8a087,8,4);foliage(b,xx,y+.126*t,zz,angle,3,.031*t,.022*t,.002,leaf);}
      else if(stage===3)b.globe(xx,y+.057*t,zz,.053*t,.044*t,.038*t,0xbba27c,8,4);
    }
  }else if(kind==='corn'||kind==='grain'||kind==='onion'||kind==='flower'){
    const h=(kind==='corn'?.72:kind==='grain'?.47:kind==='flower'?.49:.28)*t;stalk(b,x,y,z,h);
    if(kind==='onion'){
      if(stage>=2)b.globe(x,y+.021,z,.062*t,.048*t,.056*t,0xe1c797,8,4);
      foliage(b,x,y+.018,z,a,6,.098*t,.031*t,h,deep);
    }else for(let j=0;j<5;j++){const ht=.10+.13*j;b.leaf(x,y+h*ht,z,a+j*2.31,(kind==='corn'?.21:.106)*t,(kind==='corn'?.089:.047)*t,h*.23,leaf[j%3]);}
    if(stage>=2&&kind==='corn'){
      b.globe(x+.026*t,y+h*.62,z,.042*t,.091*t,.046*t,stage===3?0xe3bd61:0xa4ae74,8,4);
      foliage(b,x,y+h*.94,z,a,4,.062*t,.014*t,.078*t,[0xc8ad77]);
    }
    if(stage>=2&&kind==='grain')for(let k=0;k<5;k++)b.globe(x+(.014*t*(k%2?1:-1)),y+h+k*.015*t,z,.015*t,.024*t,.012*t,0xcfb16d,6,3);
    if(stage>=2&&kind==='flower'){
      for(let j=0;j<7;j++)b.globe(x+Math.sin(j*TAU/7)*.042*t,y+h,z+Math.cos(j*TAU/7)*.042*t,.035*t,.022*t,.034*t,0xe1b254,7,3);
      b.globe(x,y+h+.014*t,z,.032*t,.020*t,.032*t,0x9e714b,8,3);
    }
  }else{
    const h=(kind==='vine'?.67:.52)*t;stalk(b,x,y,z,h);
    for(let j=0;j<5;j++){
      const angle=a+j*2.28,at=y+h*(.23+.14*j),xx=x+Math.sin(angle)*.071*t,zz=z+Math.cos(angle)*.071*t;
      b.stem(x,at,z,xx,at+.039*t,zz,.006,0x698367,4);b.leaf(xx,at+.039*t,zz,angle,.112*t,.069*t,.033*t,deep[j%3]);
      if(stage>=2&&j%2===0){
        const colour=stage===2?0xa1aa74:{tomato:0xd5735c,pepper:0xd9aa57,eggplant:0x826b8a,vine:0x719365}[kind];
        const r=(kind==='tomato'?.061:kind==='vine'?.028:.040)*t;
        b.globe(xx,at-.014*t,zz,r,(kind==='vine'?.102:kind==='eggplant'?.082:.058)*t,r,colour||0xb9956c,8,4);
      }
    }
  }
}
function soilAndCrops(p,state,material) {
  const b=new Woodshop(),{x,z,width:w,depth:d,id}=p;
  const moisture=Math.max(0,Math.min(1,Number(state.moisture)||0)),m=Math.round(moisture*5);
  const light=[0xb29673,0xaa8c67,0x9e805d,0x917554,0x836c50,0x77634b],dark=[0x9a7e60,0x947853,0x896d50,0x7b634a,0x725c45,0x655540];
  b.pad(0,.147,0,w-.161,.090,d-.156,light[m],.06,.007,1);
  for(let i=0;i<3;i++){
    const xx=(i-1)*.60;
    if(state.tilled||state.cropId)b.pad(xx,.188,0,.368,.029,d-.237,dark[m],.104,.007,2);
    for(let j=0;j<4;j++){
      const n=id*41+i*13+j,zz=(j-1.5)*.32;
      const rx=xx+(seeded(n)-.5)*.34,rz=zz+(seeded(n+1)-.5)*.098;
      b.globe(rx,.202,rz,.020+seeded(n+11)*.018,.008,.017,light[Math.max(0,m-1)],5,3);
      if(state.fertilized&&j%2===0)b.globe(rx+.031,.209,rz+.019,.013,.009,.011,0xceba86,5,3);
    }
  }
  const kind=classify(state.cropId),stage=state.mature?3:Math.min(3,Math.max(0,Math.floor(Number(state.stage)||0)));
  if(state.cropId){
    for(let i=0;i<3;i++)for(let j=0;j<2;j++){
      const xx=(i-1)*.60,zz=(j-.5)*.63;
      if(kind==='vine'&&stage>=2)b.stem(xx+.046,.19,zz+.041,xx+.049,.91,zz+.086,.014,RIM,5);
      crop(b,kind,xx,zz,stage,id*47+i*3+j);
    }
  }else if(!state.tilled)for(let j=0;j<3;j++){
    const xx=(seeded(id*9+j)-.50)*1.46,zz=(seeded(id+j+40)-.50)*1.17;
    foliage(b,xx,.20,zz,j,3,.048,.020,.038,[0xa3a37a,0x939b72]);
  }
  const mesh=b.mesh(material,'Bed '+(id+1)+' soil and vegetables');mesh.position.set(x,0,z);mesh.userData.gardenPlot=id;return mesh;
}
function selectedBed(material) {
  const b=new Woodshop();
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const x=sx*.995,z=sz*.791;
    b.box(x-sx*.104,.254,z,.266,.038,.061,0xf3cd75);b.box(x,.254,z-sz*.113,.061,.038,.269,0xf3cd75);
  }
  const m=b.mesh(material,'Selected bed corner caps');m.visible=false;return m;
}
function handTools(material) {
  const can=new Woodshop();wateringCan(can,0,0,0,.82);const water=can.mesh(material,'Garden watering can');
  const hoe=new Woodshop();hoe.stem(0,-.22,0,0,.17,0,.014,RIM,7);hoe.box(.019,-.22,0,.046,.028,.042,DARK);hoe.box(.055,-.241,0,.063,.059,.087,0x79877a);
  const spade=hoe.mesh(material,'Hand hoe');const crate=new Woodshop();basket(crate,0,-.056,0,.293,.152,.211);const handle=[[-.125,.09],[-.12,.18],[-.06,.255],[0,.27],[.06,.255],[.12,.18],[.125,.09]];
  for(let i=1;i<handle.length;i++)crate.stem(handle[i-1][0],handle[i-1][1],0,handle[i][0],handle[i][1],0,.012,RIM,6);
  const harvest=crate.mesh(material,'Harvest basket');
  const root=new THREE.Group();root.add(water,spade,harvest);root.visible=false;
  return {root,water,spade,harvest};
}
export function createGardenWorld(world,renderer,{quality='balanced'}={}) {
  const group=new THREE.Group();group.name='Clover allotment';world.root.add(group);
  const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,metalness:0});
  const land=new Woodshop();turf(land);group.add(land.mesh(mat,'Gravel lanes and meadow'));
  const joinery=new Woodshop();for(const p of GARDEN_PLOTS)bedFrames(joinery,p);
  fenceLine(joinery,.13,-7.40,12.99,-7.40);fenceLine(joinery,12.99,-7.40,12.99,-.51);
  fenceLine(joinery,.13,-7.40,.13,-4.081);fenceLine(joinery,.13,-3.108,.13,-.49);trellis(joinery);
  lantern(joinery,.27,-6.27);lantern(joinery,11.83,-3.89);group.add(joinery.mesh(mat,'Raised bed frames, gate, fence and lanterns'));
  const yard=new Woodshop();shedTable(yard);market(yard);compost(yard);
  for(const [x,z,s,v] of [[.61,-7.02,.42,0],[3.44,-7.11,.36,1],[7.10,-7.08,.40,2],[8.44,-7.06,.46,0],[12.65,-4.49,.47,3]]){
    potted(yard,x,0,z,s,v);flowers(yard,x,z,Math.round(x*21));
  }group.add(yard.mesh(mat,'Seed shop, produce stand and compost'));
  const pickMat=new THREE.MeshBasicMaterial({visible:false}),unit=new THREE.BoxGeometry(1,1,1);
  const pickables=GARDEN_PLOTS.map(p=>{const m=new THREE.Mesh(unit,pickMat);m.position.set(p.x,.115,p.z);m.scale.set(p.width,.23,p.depth);m.userData.gardenPlot=p.id;m.name='Cultivation bed '+(p.id+1);group.add(m);return m;});
  const plots=new Array(8),keys=new Array(8);const selected=selectedBed(mat);group.add(selected);const tools=handTools(mat);group.add(tools.root);
  const activity={y:0,action:'',grip:null,hand:new THREE.Vector3(),baseInverse:new THREE.Quaternion(),toolStart:new THREE.Quaternion(),handRotation:new THREE.Quaternion()};
  const gripPoints={water:new THREE.Vector3(.16,.14,0),harvest:new THREE.Vector3(0,.27,0),spade:new THREE.Vector3(0,.12,0)};
  const tilt=new THREE.Quaternion(),pivot=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),side=new THREE.Vector3(1,0,0),pourAxis=new THREE.Vector3(0,0,1);
  let disposed=false;
  function update(view={}) {
    if(disposed)return;const data=Array.isArray(view?.plots)?view.plots:[];
    for(const p of GARDEN_PLOTS){
      const s=data.find(s=>s&&Number(s.id)===p.id)||data[p.id]||{};
      const key=[Boolean(s.tilled),s.cropId||'',s.mature?3:Number(s.stage)||0,Boolean(s.fertilized),Math.round(Math.max(0,Math.min(1,Number(s.moisture)||0))*5)].join('/');
      if(keys[p.id]===key)continue;keys[p.id]=key;
      const old=plots[p.id];if(old){old.removeFromParent();old.geometry.dispose();}
      plots[p.id]=soilAndCrops(p,s,mat);group.add(plots[p.id]);
    }
  }
  update();
  return {group,pickables,update,
    inspectGrip(){
      if(!tools.root.visible||!activity.grip)return {active:false,error:null};
      const point=tools.water.visible?gripPoints.water:tools.harvest.visible?gripPoints.harvest:gripPoints.spade;
      tools.root.updateWorldMatrix(true,false);
      const actual=point.clone().applyMatrix4(tools.root.matrixWorld);
      return {active:true,kind:tools.water.visible?'water':tools.harvest.visible?'basket':'hoe',error:actual.distanceTo(activity.hand)};
    },
    setSelected(id){const n=typeof id==='number'||(typeof id==='string'&&id.trim()!=='')?Number(id):-1,p=GARDEN_PLOTS[n];selected.visible=Boolean(p);if(p)selected.position.set(p.x,0,p.z);},
    updateCharacter({gardenWork,walking,asleep,kind}={},position,heading=0,grip=null){
      const active=Boolean(gardenWork)&&!walking&&!asleep&&position&&position.z<-.15;
      tools.root.visible=Boolean(active);if(!active){activity.action='';return;}
      const action=String(typeof gardenWork==='string'?gardenWork:gardenWork.action?.type||gardenWork.action?.kind||(typeof gardenWork.action==='string'?gardenWork.action:'')||gardenWork.kind||gardenWork.type||kind||'').toLowerCase();
      if(!/^(water|harvest|sow|plant|till|fertilize|clear)$/.test(action)){tools.root.visible=false;return;}
      const ang=Number(heading)||0;activity.y=position.y||0;
      activity.grip=grip;
      if(grip){
        if(activity.action!==action){activity.baseInverse.copy(grip.quaternion).invert();activity.toolStart.setFromAxisAngle(up,ang+(/water/.test(action)?Math.PI/2:0));}
        activity.hand.copy(grip.position);activity.handRotation.copy(grip.quaternion);
      }
      activity.action=action;
      tools.water.visible=/water|浇/.test(action);tools.harvest.visible=/harvest|plant|sow|收/.test(action);tools.spade.visible=!tools.water.visible&&!tools.harvest.visible;
      tools.root.position.set(position.x+.20*Math.cos(ang)-.13*Math.sin(ang),activity.y+.47,position.z-.20*Math.sin(ang)-.13*Math.cos(ang));tools.root.rotation.set(0,ang,0);
    },
    animateCharacter(nowMs){
      if(!group.visible||!tools.root.visible)return;
      const k=Math.sin(nowMs*.004),angle=(tools.water.visible?.32:.12)+k*.14;
      if(activity.grip){
        const point=tools.water.visible?gripPoints.water:tools.harvest.visible?gripPoints.harvest:gripPoints.spade;
        tools.root.quaternion.copy(activity.handRotation).multiply(activity.baseInverse).multiply(activity.toolStart);
        tools.root.quaternion.multiply(tilt.setFromAxisAngle(tools.water.visible?pourAxis:side,angle));
        pivot.copy(point).applyQuaternion(tools.root.quaternion);
        tools.root.position.copy(activity.hand).sub(pivot);
      }else{
        tools.root.rotation.x=angle;tools.root.position.y=activity.y+.465+.019*k;
      }
    },
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();const geometry=new Set();group.traverse(o=>{if(o.geometry)geometry.add(o.geometry);});geometry.forEach(g=>g.dispose());mat.dispose();pickMat.dispose();}
  };
}

