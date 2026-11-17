// Disjoint paving rectangles: intersections belong to the first path only.
export const GARDEN_LANES=[
  {x:-.64,z:1.355,w:.69,d:10.59,alongX:false},
  {x:.72,z:-3.76,w:.60,d:6.59,alongX:false},
  {x:6.28,z:-.88,w:10.50,d:.61,alongX:true},
  {x:5.2725,z:-3.61,w:12.515,d:.66,alongX:true},
  {x:6.34,z:-6.36,w:10.68,d:.60,alongX:true},
  ...[3.36,6.05,8.76,11.48].flatMap(x=>[-2.22,-4.96].map(z=>({x,z,w:.41,d:1.98,alongX:false}))),
];
const rect=(x,z,w,d)=>[x-w/2,z-d/2,x+w/2,z+d/2];
const valid=r=>r[2]-r[0]>1e-7&&r[3]-r[1]>1e-7;

export function subtractRect(area,cut){
  const x0=Math.max(area[0],cut[0]),z0=Math.max(area[1],cut[1]);
  const x1=Math.min(area[2],cut[2]),z1=Math.min(area[3],cut[3]);
  if(x1-x0<1e-7||z1-z0<1e-7)return [area];
  return [[area[0],area[1],x0,area[3]],[x1,area[1],area[2],area[3]],
    [x0,area[1],x1,z0],[x0,z1,x1,area[3]]].filter(valid);
}
function unclaimed(area,claimed){
  return claimed.reduce((parts,cut)=>parts.flatMap(part=>subtractRect(part,cut)),[area]);
}
export function pavingParts(lanes=GARDEN_LANES){
  const bases=[],tiles=[],claimed=[];
  for(const lane of lanes){
    const {x,z,w,d,alongX}=lane,area=rect(x,z,w,d);
    bases.push(...unclaimed(area,claimed));
    const length=alongX?w:d,width=alongX?d:w,n=Math.max(1,Math.round(length/.63)),size=length/n;
    for(let i=0;i<n;i++){
      const offset=(i-(n-1)/2)*size;
      const stone=rect(x+(alongX?offset:0),z+(alongX?0:offset),alongX?size-.032:width-.041,alongX?width-.041:size-.032);
      for(const part of unclaimed(stone,claimed))if(part[2]-part[0]>.015&&part[3]-part[1]>.015){
        tiles.push({bounds:part,tone:(i+Math.round(length))%4});
      }
    }
    claimed.push(area);
  }
  return {bases,tiles};
}
