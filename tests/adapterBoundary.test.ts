/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import JSZip from 'jszip';
import { createValidDocument } from './helpers/documentFixture';
import { createMemoryStore } from './helpers/viewModelFixture';
import { documentToProjectData } from '../src/core/projectData';
import { AutosaveService } from '../src/app/services/AutosaveService';
import { ExportBackend } from '../src/app/ports';
import { PortraitDocument } from '../src/model/document';

const sources = import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

function resolveImport(from: string, target: string): string | undefined {
  if (!target.startsWith('.')) return;
  const parts = from.split('/');
  parts.pop();
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  const base = parts.join('/');
  const path = [base, `${base}.ts`, `${base}/index.ts`].find(key => key in sources);
  if (!path) throw new Error(`Unresolved local dependency: ${from} -> ${target}`);
  return path;
}

function inspectGraph(entries: string[]): string[] {
  const visited = new Set<string>();
  function inspect(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    expect(file).not.toMatch(/\/app\/(browser|adapters)\/|\/panels\/|\/app\/(app|utils\/download)\.ts$/);
    const ast = ts.createSourceFile(file, sources[file], ts.ScriptTarget.Latest, true);
    function walk(node: ts.Node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const dependency = resolveImport(file, node.moduleSpecifier.text);
        if (dependency) inspect(dependency);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
        const dependency = resolveImport(file, node.arguments[0].text);
        if (dependency) inspect(dependency);
      }
      if (ts.isIdentifier(node) && ['window', 'localStorage', 'HTMLCanvasElement', 'CanvasRenderingContext2D', 'HTMLImageElement'].includes(node.text)) {
        throw new Error(`Browser dependency ${node.text} in ${file}`);
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && ['document', 'globalThis'].includes(node.expression.text)) {
        throw new Error(`Global environment access ${node.getText(ast)} in ${file}`);
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Image') {
        throw new Error(`Browser Image constructor in ${file}`);
      }
      if (file.startsWith('../src/core/') && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'console') {
        throw new Error(`Logging side effect in pure core: ${file}`);
      }
      ts.forEachChild(node, walk);
    }
    walk(ast);
  }
  for (const entry of entries) inspect(entry);
  return [...visited];
}

describe('T07 dependency boundary and injected capabilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps the full domain and ViewModel import graph free of browser implementations', () => {
    const entries = Object.keys(sources).filter(path => /\/src\/(core|model|command)\//.test(path) || /\/app\/controllers\//.test(path));
    const graph = inspectGraph([...entries, '../src/app/viewModel.ts', '../src/app/ports.ts', '../src/app/services/AutosaveService.ts']);
    expect(graph).toContain('../src/core/imageImport.ts');
    expect(graph).toContain('../src/core/projectArchive.ts');
    for (const path of Object.keys(sources).filter(path => /\/app\/controllers\//.test(path))) {
      expect(sources[path]).not.toMatch(/from\s+['"][^'"]*viewModel['"]/);
    }
  });

  it('imports, constructs and edits headlessly without reading browser globals or reporting saved', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const globals = ['window', 'document', 'localStorage', 'Image'] as const;
    const descriptors = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    const access = vi.fn(() => { throw new Error('browser access forbidden'); });
    globals.forEach(key => Object.defineProperty(globalThis, key, { configurable: true, get: access }));
    try {
      vi.resetModules();
      const { ViewModel } = await import('../src/app/viewModel');
      const vm = new ViewModel();
      const statuses: string[] = [];
      const notices: string[] = [];
      vm.registerListener({ onSaveStatus: status => statuses.push(status), onNotify: message => notices.push(message) });
      vm.loadProject(documentToProjectData(createValidDocument()));
      vm.setPaletteColor(0, '#123456');
      vi.advanceTimersByTime(300);
      expect(vm.doc.palette[0]).toBe('#123456');
      expect(vm.hasSavedProject()).toBe(false);
      expect(statuses).toContain('error');
      expect(statuses).not.toContain('saved');
      await vm.exportPng();
      await vm.exportZip();
      await vm.exportMaskPng();
      expect(notices.filter(message => message.includes('导出服务未配置'))).toHaveLength(2);
      expect(notices).toContain('导出工程 ZIP 失败，请重试');
      vm.dispose();
      expect(access).not.toHaveBeenCalled();
    } finally {
      globals.forEach((key, i) => {
        const descriptor = descriptors[i];
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
  });

  it('uses class-based export ports with their receiver intact and fresh document snapshots', async () => {
    const { ViewModel } = await import('../src/app/viewModel');
    class Backend implements ExportBackend {
      calls: { format: string; doc: PortraitDocument; scale?: number }[] = [];
      async exportPng(doc: PortraitDocument) { this.calls.push({ format: 'png', doc }); }
      async exportZip(doc: PortraitDocument) { this.calls.push({ format: 'zip', doc }); }
      async exportMaskPng(doc: PortraitDocument, scale: number) { this.calls.push({ format: 'mask', doc, scale }); }
    }
    const backend = new Backend();
    const vm = new ViewModel({ autosave: new AutosaveService(createMemoryStore()), exports: backend });
    vm.loadProject(documentToProjectData(createValidDocument({ pixels: set => set(0, 0, 5) })));
    await vm.exportPng();
    vm.loadProject(documentToProjectData(createValidDocument({ pixels: set => set(0, 0, 8) })));
    await vm.exportZip();
    await vm.exportMaskPng(8);
    expect(backend.calls.map(call => call.format)).toEqual(['png', 'zip', 'mask']);
    expect(backend.calls.map(call => call.doc.pixelIndices[0])).toEqual([5, 8, 8]);
    expect(backend.calls[2].scale).toBe(8);
    expect(backend.calls[2].doc).not.toBe(vm.doc);
    vm.doc.pixelIndices[0] = 1;
    expect(backend.calls[2].doc.pixelIndices[0]).toBe(8);
    vm.dispose();
  });

  it('reads a ZIP from bytes without File, Canvas or a browser storage adapter', async () => {
    const { importProjectZip } = await import('../src/core/projectArchive');
    const data = documentToProjectData(createValidDocument(), 1700000000);
    const zip = new JSZip();
    zip.file('imagegem_project.json', JSON.stringify(data));
    expect(await importProjectZip(await zip.generateAsync({ type: 'uint8array' }))).toEqual(data);
  });
});
