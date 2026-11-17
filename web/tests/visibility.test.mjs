import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../upstream/vendor/three.module.js';
import {RoomVisibility,ROOF_AREAS,SITE_BOUNDS,roofAt,wallBlocks} from '../src/room-visibility.js';
import {createWorld} from '../src/room-world.js';
import {FollowCameraGuard} from '../src/follow-camera.js';

const wall=(fixed,extra={})=>({axis:'x',fixed,from:-2,to:2,height:2.8,openings:[],...extra});
const mesh=()=>({visible:true,castShadow:true,material:{transparent:false,opacity:1,depthWrite:true}});
const from={x:0,y:1.4,z:-4},head={x:0,y:1.3,z:0},chest={x:0,y:.8,z:0};

test('only a wall between the camera and the character blocks the view',()=>{
  assert.equal(wallBlocks(wall(-2),from,head),true);
  assert.equal(wallBlocks(wall(1),from,head),false);
  assert.equal(wallBlocks(wall(-5),from,head),false);
});
test('rays above walls, outside wall spans and parallel to walls do not fade them',()=>{
  assert.equal(wallBlocks(wall(-2),{x:0,y:6,z:-4},head),false);
  assert.equal(wallBlocks(wall(-2,{from:2,to:4}),from,head),false);
  assert.equal(wallBlocks(wall(-2),{x:0,y:1,z:0},head),false);
});
test('door openings pass sightlines while their frames and lintels remain solid',()=>{
  const doorway=wall(-2,{openings:[[-.5,.5,0,2.2,'door']]});
  assert.equal(wallBlocks(doorway,from,head),false);
  assert.equal(wallBlocks(doorway,{x:.49,y:1.4,z:-4},{x:.49,y:1.3,z:0}),true);
  assert.equal(wallBlocks(doorway,{x:0,y:2.4,z:-4},{x:0,y:2.4,z:0}),true);
});
test('window apertures pass sightlines without treating their mullions as empty',()=>{
  const window=wall(-2,{openings:[[-.8,.8,1,2.1,'window']]});
  assert.equal(wallBlocks(window,{x:.3,y:1.3,z:-4},{x:.3,y:1.3,z:0}),false);
  assert.equal(wallBlocks(window,{x:0,y:1.3,z:-4},{x:0,y:1.3,z:0}),true);
});
test('walls perpendicular to the other horizontal axis use the same finite test',()=>{
  const partition={...wall(-2),axis:'z'};
  assert.equal(wallBlocks(partition,{x:-4,y:1.4,z:0},head),true);
  assert.equal(wallBlocks({...partition,fixed:1},{x:-4,y:1.4,z:0},head),false);
});
test('roof selection follows physical position and releases outside the house',()=>{
  assert.equal(roofAt([9.5,3.15]),'her_room');
  assert.equal(roofAt([6.3,3.2]),'living');
  assert.equal(roofAt([2,-.9],'her_room'),'');
  assert.equal(roofAt([8.41,2],'living'),'living');
  assert.equal(roofAt([8.44,2],'living'),'her_room');
});
test('blocked walls fade as a whole, rear walls stay opaque and clear walls recover',()=>{
  const front={...wall(-2),mesh:mesh()},rear={...wall(1),mesh:mesh()};
  const visibility=new RoomVisibility([front,rear],[]);
  const character={position:[0,0],elevation:0};
  for(let i=0;i<50;i++)visibility.update(from,{head,chest},character,{dt:.02});
  assert.ok(front.opacity<.1);
  assert.equal(front.mesh.material.depthWrite,false);
  assert.equal(rear.opacity,1);
  assert.equal(rear.mesh.material.transparent,false);
  assert.equal(front.mesh.visible,true);
  for(let i=0;i<60;i++)visibility.update({x:0,y:1.4,z:-.5},{head,chest},character,{dt:.02});
  assert.equal(front.opacity,1);
  assert.equal(front.mesh.material.depthWrite,true);
});
test('partial silhouette coverage gives a higher opacity than full coverage',()=>{
  const full={...wall(-2),mesh:mesh()},partial={...wall(-2,{from:.025}),mesh:mesh()};
  const visibility=new RoomVisibility([full,partial],[]);
  visibility.update(from,{head,chest},{position:[0,0],elevation:0},{dt:.02});
  assert.ok(full.coverage>partial.coverage&&partial.coverage>0);
  assert.ok(full.targetOpacity<partial.targetOpacity);
});
test('only the occupied room opens its roof; first-person retains the interior ceiling',()=>{
  const roofs=ROOF_AREAS.map(area=>({id:area.id,mesh:mesh()}));
  const visibility=new RoomVisibility([],roofs);
  for(let i=0;i<50;i++)visibility.update(from,{head,chest},{position:[9.5,3.15],elevation:0},{dt:.02});
  assert.deepEqual(roofs.filter(r=>r.opacity<.99).map(r=>r.id),['her_room']);
  for(let i=0;i<50;i++)visibility.update(from,{head,chest},{position:[6.3,3.2],elevation:0},{dt:.02});
  assert.deepEqual(roofs.filter(r=>r.opacity<.99).map(r=>r.id),['living']);
  for(let i=0;i<50;i++)visibility.update(from,{head,chest},{position:[6.3,3.2],elevation:0},{dt:.02,firstPerson:true});
  assert.ok(roofs.every(r=>r.opacity===1));
});
test('one foundation mesh covers the house, garden, connector and side path',t=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>({getContext:()=>null})};
  t.after(()=>{globalThis.document=previous;});
  const world=createWorld(null);
  t.after(()=>world.dispose());
  assert.equal(world.root.children.filter(mesh=>mesh===world.foundation).length,1);
  assert.equal(world.foundation.geometry.index.count,36);
  world.root.updateMatrixWorld(true);
  const ray=new THREE.Raycaster();
  for(const [x,z] of [[6,2],[6,-4],[6,-.14],[-.6,3]]){
    ray.set(new THREE.Vector3(x,1,z),new THREE.Vector3(0,-1,0));
    const hit=ray.intersectObject(world.foundation,false)[0];
    assert.ok(hit,`foundation missing at ${x},${z}`);
    assert.ok(Math.abs(hit.point.y-SITE_BOUNDS.top)<1e-6);
  }
  assert.equal(world.roofs.length,ROOF_AREAS.length);
  assert.ok(SITE_BOUNDS.minZ< -7.55&&SITE_BOUNDS.maxZ>9);
  const guard=new FollowCameraGuard(world);
  const targets={head:new THREE.Vector3(9.5,1.3,3.15),chest:new THREE.Vector3(9.5,.8,3.15)};
  const camera=new THREE.Vector3(5.5,3.3,3.15);
  guard.setRoom('her_room');
  assert.equal(guard.clearRoofs(camera,targets),false);
  guard.protectRoofView(camera,targets);
  assert.equal(guard.clearRoofs(camera,targets),true);
  assert.ok(camera.y>3.3);
  const desired=new THREE.Vector3();
  guard.resolve({focus:new THREE.Vector3(9.5,.75,3.15),az:-Math.PI/2,elev:.56,radius:4.6,targets,dt:.02},desired);
  assert.ok(guard.inspect(desired,targets).offsetElev<0);
  assert.equal(guard.clear(desired,targets),true);
});
