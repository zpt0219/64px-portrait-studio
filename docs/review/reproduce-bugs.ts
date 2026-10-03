/**
 * 历史审查诊断脚本 (已归档)：
 * 本脚本仅用于记录 2026-10-03 审查阶段发现的历史缺陷输出（非正式回归测试）。
 * 当前工程的所有正式回归断言均统一收敛于 Vitest 测试套件 (`tests/`) 中。
 * 运行方式详见 ../REFACTOR_PLAN_2026-10-03.md。
 */
import { ViewModel } from '../../src/app/viewModel';
import { SemanticZone } from '../../src/types';
import { createEmptyDocument } from '../../src/model/document';
import { setStorageAdapter, saveProjectDebounced, clearProjectStorage } from '../../src/core/storage';
import { validateProjectData, base64ToUint8Array, documentToProjectData, projectDataToDocument } from '../../src/core/projectData';
import { generateProjectZipBlob } from '../../src/core/zipExporter';
import JSZip from 'jszip';
import { hexToRgb } from '../../src/core/colorUtils';
const report = (id: string, value: unknown) => console.log(id, JSON.stringify(value));
function loaded() { const vm = new ViewModel(); vm.session.isLoaded = true; vm.doc.pixelIndices[0] = 5; vm.doc.semanticMask[0] = SemanticZone.Hair; return vm; }
setStorageAdapter({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
{
 const vm = loaded(); vm.selectPaletteIndex(255); vm.beginStroke(0, false); vm.strokeAt(0,0); vm.endStroke();
 const restored = projectDataToDocument(documentToProjectData(vm.doc)).document;
 report('B1-transparent-pen-roundtrip', {pixel:vm.doc.pixelIndices[0],maskBefore:vm.doc.semanticMask[0],maskRestored:restored.semanticMask[0]});
}
{
 const vm = loaded(); vm.toggleLockZone(SemanticZone.Hair); vm.setActiveTool('eraser'); vm.beginStroke(0,false); vm.strokeAt(0,0); vm.endStroke();
 const restored = projectDataToDocument(documentToProjectData(vm.doc)).document;
 report('B1-locked-erase-roundtrip', {pixel:vm.doc.pixelIndices[0],maskBefore:vm.doc.semanticMask[0],maskRestored:restored.semanticMask[0]});
}
{
 const vm = loaded(); vm.doc.semanticMask[0] = SemanticZone.Skin; vm.setActiveZone(SemanticZone.Hair); vm.toggleLockZone(SemanticZone.Hair); vm.setMaskMatchPreset('all_colors');
 vm.beginStroke(0,false); vm.strokeAt(0,0); vm.endStroke(); const pen = vm.doc.semanticMask[0];
 vm.maskBoxSelect({x:0,y:0,w:1,h:1},'add'); const box = vm.doc.semanticMask[0]; vm.undo(); vm.assignColorToZone(5);
 report('B2-locked-target', {pen,box,assign:vm.doc.semanticMask[0]});
}
{
 const vm = new ViewModel(); vm.session.isLoaded=true; vm.selectPaletteIndex(1); vm.beginStroke(0,false); vm.strokeAt(0,0); vm.endStroke();
 vm.selectPaletteIndex(2); vm.beginStroke(0,false); vm.strokeAt(1,0); vm.undo(); const afterUndo = Array.from(vm.doc.pixelIndices.slice(0,3));
 vm.strokeAt(2,0); vm.endStroke(); vm.undo(); const afterUndoStroke = Array.from(vm.doc.pixelIndices.slice(0,3));
 report('B3-undo-during-stroke', {afterUndo,afterUndoStroke});
}
{
 const vm = loaded(); vm.selectPaletteIndex(2); vm.beginStroke(0,false); vm.strokeAt(1,0);
 const next = createEmptyDocument(); next.pixelIndices[0]=8; vm.loadProject(documentToProjectData(next)); vm.endStroke(); const canUndo = vm.canUndo(); vm.undo();
 report('B3-document-replaced-during-stroke', {canUndo,firstPixelAfterUndo:vm.doc.pixelIndices[0]});
}
{
 clearProjectStorage(); const warnings: unknown[]=[]; const original=console.warn; console.warn=(...args)=>warnings.push(String(args[0]));
 setStorageAdapter({getItem:()=>null,setItem:()=>{throw new Error('quota exceeded');},removeItem:()=>{}});
 let onSaved=false; saveProjectDebounced(createEmptyDocument(),(result)=>onSaved=result.success); await new Promise(r=>setTimeout(r,320)); console.warn=original;
 report('B4-save-failure-reported-success', {onSaved,warnings});
 setStorageAdapter({getItem:()=>null,setItem:()=>{},removeItem:()=>{}});
}
{
 const data = documentToProjectData(createEmptyDocument()); data.hairPreset='not-a-preset';
 report('B5-invalid-preset-validation', validateProjectData(data).valid);
}
{
 const vm = loaded(); const notices: string[]=[]; vm.registerListener({onNotify:m=>notices.push(m)});
 const original=globalThis.CompressionStream; const rejections: string[]=[];
 process.once('unhandledRejection',(err: Error)=>rejections.push(err.message));
 globalThis.CompressionStream=class {constructor(){throw new Error('simulated encoder failure');}} as any;
 vm.exportPng(); await new Promise(r=>setTimeout(r,20)); globalThis.CompressionStream=original;
 report('B6-png-failure', {notices,rejections});
}
{
 class FakeCanvas {
   width=64; height=64; first:number[]=[];
   context={createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:(image:any)=>{this.first=Array.from(image.data.slice(0,4));},drawImage:(source:FakeCanvas)=>{this.first=[...source.first];},fillRect:()=>{},strokeRect:()=>{},fillText:()=>{}};
   getContext(){return this.context;}
   toBlob(callback:(blob:Blob)=>void){setTimeout(()=>callback(new Blob([JSON.stringify(this.first)])),0);}
 }
 globalThis.document={createElement:()=>new FakeCanvas()} as any;
 const doc=createEmptyDocument(); doc.pixelIndices[0]=1; const output=generateProjectZipBlob(doc); doc.pixelIndices[0]=2;
 const zip=await JSZip.loadAsync(await (await output).arrayBuffer());
 const saved=JSON.parse(await zip.file('imagegem_project.json')!.async('string'));
 const renderFirst=JSON.parse(await zip.file('renders/avatar_64x64_1x.png')!.async('string'));
 report('B7-zip-mixed-revisions',{jsonPixelIndex:base64ToUint8Array(saved.pixels)[0],renderFirst,expectedSavedRgba:[...hexToRgb(saved.palette[1]),255]});
}
clearProjectStorage();
