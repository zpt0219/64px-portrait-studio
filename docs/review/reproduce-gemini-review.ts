/**
 * Gemini 实现审查诊断（2026-10-03）。
 * 只使用内存存储与 DOM 替身，不读取浏览器工程、不触发下载。
 * 打印实际结果供审查；不是通过/失败断言，也不代替真实浏览器验收。
 * 运行方式见 docs/GEMINI_REVIEW_2026-10-03.md。
 */
import { ViewModel } from '../../src/app/viewModel';
import { SemanticZone } from '../../src/types';
import { createEmptyDocument } from '../../src/model/document';
import { documentToProjectData, base64ToUint8Array } from '../../src/core/projectData';
import { setStorageAdapter, cancelDebouncedSave } from '../../src/core/storage';
import { floodFillMask, FULL_CANVAS } from '../../src/core/editOps';
import { App } from '../../src/app/app';
import { ConfirmModal } from '../../src/panels/modals/ConfirmModal';
const reports: unknown[]=[];
const report=(id:string, detail:unknown)=>reports.push({id,detail});
let saves:string[]=[];
setStorageAdapter({getItem:()=>null,setItem:(_k,v)=>saves.push(v),removeItem:()=>{}});
function loaded(pixel=5) { const doc=createEmptyDocument();doc.pixelIndices[0]=pixel;doc.semanticMask[0]=SemanticZone.Hair;const vm=new ViewModel();vm.loadProject(documentToProjectData(doc));cancelDebouncedSave();return vm; }
{
 const vm=loaded(255);vm.selectPaletteIndex(1);vm.beginStroke(0,false);vm.strokeAt(0,0);vm.endStroke();
 vm.selectPaletteIndex(2);vm.beginStroke(0,false);vm.strokeAt(1,0);vm.undo();const afterUndo=[...vm.doc.pixelIndices.slice(0,3)];vm.strokeAt(2,0);vm.endStroke();vm.undo();
 report('stroke-undo',{afterUndo,afterSecondUndo:[...vm.doc.pixelIndices.slice(0,3)]});vm.dispose();
}
{
 const vm=loaded();vm.selectPaletteIndex(2);vm.beginStroke(0,false);vm.strokeAt(1,0);const next=createEmptyDocument();next.pixelIndices[0]=8;vm.loadProject(documentToProjectData(next));vm.endStroke();const canUndo=vm.canUndo();vm.undo();report('stroke-load',{canUndo,firstPixelAfterUndo:vm.doc.pixelIndices[0],expectedFirstPixel:8});vm.dispose();
}
{
 const doc=createEmptyDocument();doc.pixelIndices[0]=5;doc.pixelIndices[1]=5;doc.semanticMask[0]=SemanticZone.Hair;doc.semanticMask[1]=SemanticZone.Skin;
 const changed=floodFillMask({pixels:doc.pixelIndices,mask:doc.semanticMask,lockedZones:new Set()},0,0,SemanticZone.Hair,false,FULL_CANVAS);
 report('flood-start-target',{changed,neighbor:doc.semanticMask[1],expectedNeighbor:SemanticZone.Hair});
}
{
 const vm=loaded();vm.dispose();const before=vm.doc.palette[0];vm.setPaletteColor(0,'#123456');report('disposed-palette',{before,after:vm.doc.palette[0]});
}
{
 saves=[];const a=loaded(5),b=loaded(8);cancelDebouncedSave();const statusA:string[]=[],statusB:string[]=[];a.registerListener({onSaveStatus:s=>statusA.push(s)});b.registerListener({onSaveStatus:s=>statusB.push(s)});
 a.setPaletteColor(0,'#111111');b.setPaletteColor(0,'#222222');a.dispose();report('global-autosave',{savedPixels:saves.map(s=>base64ToUint8Array(JSON.parse(s).pixels)[0]),statusA,statusB});b.dispose();
}
{
 const vm=loaded();let prompt:any;vm.setPrompts({confirm:(p:any)=>prompt=p} as any);vm.requestReset();const next=createEmptyDocument();next.pixelIndices[0]=8;vm.loadProject(documentToProjectData(next));prompt.buttons[0].onClick();report('stale-reset',{pixelAfterOldConfirmation:vm.doc.pixelIndices[0],isLoaded:vm.session.isLoaded,expectedPixel:8});vm.dispose();
}
{
 const node=()=>({remove:()=>{},style:{},classList:{add:()=>{},remove:()=>{}},addEventListener:()=>{},appendChild:()=>{},querySelector:()=>node(),innerHTML:'',textContent:''});
 globalThis.document={createElement:()=>node(),getElementById:()=>node(),body:node()} as any;
 let dismissed=0;const modal=new ConfirmModal(node() as any);modal.show({title:'old',message:'old',buttons:[],onDismiss:()=>dismissed++});modal.show({title:'new',message:'new',buttons:[]});report('modal-replaced',{dismissed,expectedDismissed:1});modal.dispose();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new DOMException('Blocked','SecurityError');}});
 try {(App.prototype as any).setupSplitterDragging.call({abortController:new AbortController()});report('storage-startup',{throws:false});}catch(e:any){report('storage-startup',{throws:true,name:e.name});}
 delete (globalThis as any).localStorage;
}
cancelDebouncedSave();console.log(JSON.stringify(reports,null,2));
