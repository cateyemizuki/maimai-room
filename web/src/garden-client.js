// MaiBot bridge for the garden state, controls and 3D presentation.
import * as THREE from '../upstream/vendor/three.module.js';
import { createGardenWorld, GARDEN_PLOTS } from './garden-world.js';
import { mountGardenUI } from './garden-ui.js';

export function mountGarden({world,renderer,camera,hostQuery,hostAction,onError=()=>{},onOpen=()=>{},onClose=()=>{},onSnapshot=()=>{}}) {
  let model=null,ui=null,shown=false,checkedAt=-Infinity,painted=null;
  const gardenBounds=new THREE.Box3(new THREE.Vector3(-1.1,-.3,-7.7),new THREE.Vector3(13.2,2.3,-.25));
  const frustum=new THREE.Frustum(),projection=new THREE.Matrix4();
  let view=null,opened=false,selected=0,busy=false,disposed=false;
  const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
  function showModel(){
    model??=createGardenWorld(world,renderer,{quality:world.quality||'balanced'});
    if(view&&view!==painted){model.update(view);painted=view;}
    model.setSelected(opened?selected:-1);
  }
  function select(id){if(!Number.isInteger(id)||id<0||id>7)return;selected=id;model?.setSelected(id);ui?.selectPlot(id);}
  function update(garden){
    if(disposed||!garden||!Array.isArray(garden.plots))return;
    view=garden;if(opened)ui?.setView(garden);
    if(model&&(opened||shown))showModel();
  }
  function accept(result){
    const snapshot=result?.snapshot||((result?.schemaVersion===1&&result?.character)?result:null);
    const garden=snapshot?.garden||result?.garden;
    if(snapshot)onSnapshot(snapshot);
    else if(garden)update(garden);
    return result;
  }
  async function act(input){
    if(busy)return {ok:false,message:'上一项安排还在保存，请稍等'};
    if(view?.controlsEnabled===false){return {ok:false,message:'房间操作已关闭'};}
    const type=input.type;
    const action=type==='auto'?(input.enabled?'auto_on':'auto_off'):
      type==='careNow'&&input.decision?(input.decision==='force'?'careForce':'careDefer'):type;
    const args={action,plot:Number.isInteger(input.plotId)?input.plotId:-1,
      crop:typeof input.cropId==='string'?input.cropId:'',quantity:input.quantity===undefined?1:input.quantity,
      request_id:globalThis.crypto?.randomUUID?.()||`garden-${Date.now()}-${Math.random().toString(36).slice(2,12)}`};
    busy=true;
    try{
      const result=accept(await hostAction('garden',args));
      if(Number.isInteger(input.plotId))select(input.plotId);
      return result;
    }catch(error){
      const message=String(error?.message||error||'菜园安排暂未确认，请等待同步后查看').slice(0,180);
      return {ok:false,message};
    }finally{busy=false;}
  }
  async function homeAction(command){
    if(busy)return {ok:false,message:'上一项安排还在保存，请稍等'};
    busy=true;
    try{return accept(await hostAction('interact',{command,request_id:globalThis.crypto?.randomUUID?.()||`garden-home-${Date.now()}`}));}
    catch(error){return {ok:false,message:String(error?.message||error).slice(0,180)};}
    finally{busy=false;}
  }
  async function refresh(){
    if(!hostQuery||busy||disposed)return;
    try{accept(await hostQuery('summary',{}));}catch(error){onError(String(error?.message||error).slice(0,180));}
  }
  function setOpen(value){
    if(disposed)return;
    if(opened===!!value)return;
    opened=!!value;
    if(opened){
      ui??=mountGardenUI({onAction:act,onControl:act,onSelectPlot:select,onClose:()=>setOpen(false),onHomeAction:homeAction});
      showModel();ui.selectPlot(selected);if(view)ui.setView(view);
    }
    ui?.setOpen(opened);model?.setSelected(opened?selected:-1);
    if(opened){onOpen();if(!view)refresh();}else onClose();
  }
  function handlePointer(event){
    if(disposed||!model||!model.group.visible)return false;
    const rect=renderer.domElement.getBoundingClientRect();
    ndc.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    ray.setFromCamera(ndc,camera);
    const hit=ray.intersectObjects(model.pickables,true)[0];
    if(!hit)return false;
    const id=hit.object.userData.gardenPlot;
    if(Number.isInteger(id)){setOpen(true);select(id);}
    return true;
  }
  function updateCharacter(character,position,heading,grip){
    if(!character||!model||(!opened&&!shown))return;
    const task=view?.care?.task;
    const reported=character.gardenWork;
    const work=character.source==='garden'&&task?.phase==='working'&&reported?.phase==='working'&&reported.id===task.id?reported:null;
    const point=position||{x:character.position?.x??character.position?.[0],y:character.elevation||0,z:character.position?.z??character.position?.[1]};
    model.updateCharacter({gardenWork:work,walking:character.walking,asleep:character.pose==='lie',
      kind:work?'garden_'+work.type:''},point,heading===undefined?Math.PI-(Number(character.facing)||0)*Math.PI/180:heading,grip);
  }
  function tick(now){
    if(now-checkedAt>=250||opened&&!shown){
      checkedAt=now;
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
      shown=opened||frustum.intersectsBox(gardenBounds);
      if(shown&&view&&(!model||painted!==view))showModel();
      if(model)model.group.visible=shown;
    }
    if(model&&shown)model.animateCharacter(now);
  }
  return {update,setOpen,toggle:()=>setOpen(!opened),get isOpen(){return opened;},handlePointer,
    tick,updateCharacter,refresh,selectPlot:select,
    inspect:()=>({open:opened,selected,busy,view,plots:GARDEN_PLOTS.length,meshes:model?.group.children.length||0,grip:model?.inspectGrip()}),
    destroy(){disposed=true;ui?.destroy();model?.dispose();}};
}
