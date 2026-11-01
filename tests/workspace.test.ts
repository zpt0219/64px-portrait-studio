import { describe, it, expect } from 'vitest';
import {
  extractTabSession,
  applyTabSession,
  syncDocumentInPlace,
  generateTabName,
  remapPatch,
  MAX_TAB_COUNT,
} from '../src/core/workspace';
import { createEmptyDocument } from '../src/core/document';
import { createInitialSession } from '../src/core/session';
import { ViewModel } from '../src/app/viewModel';
import { PRESET_AVATAR_NAME } from '../src/core/presetAvatar';
import { SemanticZone } from '../src/core/types';
import { AutosaveService, KeyValueStore } from '../src/app/services/AutosaveService';

describe('Multi-Tab Workspace Core & ViewModel (P0 - P4)', () => {
  it('generateTabName deduplicates names with sequential numbers', () => {
    const existing = ['头像', '头像 (2)', '未命名'];
    expect(generateTabName('头像', existing)).toBe('头像 (3)');
    expect(generateTabName('女骑士.png', existing)).toBe('女骑士');
    expect(generateTabName('头像 (2).png', existing)).toBe('头像 (3)');
    expect(generateTabName('', existing)).toBe('未命名 (2)');
  });

  it('syncDocumentInPlace updates target buffers in-place without replacing reference', () => {
    const target = createEmptyDocument();
    const targetPixelsRef = target.pixelIndices;
    const targetMaskRef = target.semanticMask;

    const source = createEmptyDocument();
    source.pixelIndices[10] = 5;
    source.semanticMask[10] = SemanticZone.Hair;
    source.palette[0] = '#ff00ff';

    syncDocumentInPlace(target, source);

    expect(target.pixelIndices).toBe(targetPixelsRef);
    expect(target.semanticMask).toBe(targetMaskRef);
    expect(target.pixelIndices[10]).toBe(5);
    expect(target.semanticMask[10]).toBe(SemanticZone.Hair);
    expect(target.palette[0]).toBe('#ff00ff');
  });

  it('extractTabSession and applyTabSession accurately round-trip tab session fields', () => {
    const session = createInitialSession();
    session.isLoaded = true;
    session.activeMode = 'mask';
    session.activeZone = SemanticZone.Skin;
    session.activePaletteIndex = 7;
    session.selection = { x: 10, y: 12, w: 20, h: 25 };

    const tabSession = extractTabSession(session);
    expect(tabSession.activeZone).toBe(SemanticZone.Skin);
    expect(tabSession.selection).toEqual({ x: 10, y: 12, w: 20, h: 25 });

    const newSession = createInitialSession();
    applyTabSession(newSession, tabSession);

    expect(newSession.isLoaded).toBe(true);
    expect(newSession.activeMode).toBe('mask');
    expect(newSession.activeZone).toBe(SemanticZone.Skin);
    expect(newSession.activePaletteIndex).toBe(7);
    expect(newSession.selection).toEqual({ x: 10, y: 12, w: 20, h: 25 });
  });

  it('remapPatch maps colors identically when palettes are identical', () => {
    const pal = ['#000000', '#ffffff', '#ff0000'];
    const patch = {
      w: 2,
      h: 2,
      pixels: new Uint8Array([0, 1, 2, 255]),
      mask: new Uint8Array([SemanticZone.Hair, SemanticZone.Skin, SemanticZone.Clothes, SemanticZone.None]),
    };

    const res = remapPatch(patch, pal, pal);
    expect(res.approximatedCount).toBe(0);
    expect(Array.from(res.patch.pixels)).toEqual([0, 1, 2, 255]);
    expect(Array.from(res.patch.mask)).toEqual([
      SemanticZone.Hair,
      SemanticZone.Skin,
      SemanticZone.Clothes,
      SemanticZone.None,
    ]);
  });

  it('remapPatch finds exact hex match or OKLab nearest color when palettes differ', () => {
    const srcPal = ['#111111', '#ee0000'];
    const dstPal = ['#000000', '#111111', '#dd0000']; // #111111 exact at 1; #ee0000 closest to #dd0000 at 2
    const patch = {
      w: 2,
      h: 1,
      pixels: new Uint8Array([0, 1]),
      mask: new Uint8Array([SemanticZone.None, SemanticZone.None]),
    };

    const res = remapPatch(patch, srcPal, dstPal);
    expect(res.patch.pixels[0]).toBe(1); // exact match
    expect(res.patch.pixels[1]).toBe(2); // approximate nearest match
    expect(res.approximatedCount).toBe(1);
  });

  it('ViewModel supports multiple tabs, opens new tabs, and isolates history', () => {
    const vm = new ViewModel();

    // 初始应有 1 个空 Tab
    expect(vm.getTabs()).toHaveLength(1);
    expect(vm.getActiveTabName()).toBe('未命名-1');

    // 载入预设金发骑士
    vm.loadPresetAvatar();
    expect(vm.getTabs()).toHaveLength(1); // 首次从空状态复用首个 Tab
    expect(vm.session.isLoaded).toBe(true);
    expect(vm.getActiveTabName()).toBe(PRESET_AVATAR_NAME);

    // 再次载入预设 -> 应开新 Tab 且不弹覆盖确认
    vm.loadPresetAvatar();
    expect(vm.getTabs()).toHaveLength(2);
    expect(vm.getActiveTabName()).toBe(`${PRESET_AVATAR_NAME} (2)`);

    // 新建空白画布 -> 开第 3 个 Tab
    vm.newBlankProject();
    expect(vm.getTabs()).toHaveLength(3);
    const tabs = vm.getTabs();
    expect(tabs[2].name).toMatch(/^未命名-\d+$/);

    // 在第 3 个 Tab 画一笔 (测试历史隔离)
    const tab3Id = tabs[2].id;
    const tab2Id = tabs[1].id;
    vm.patchSession({ activeTool: 'pen' });
    vm.beginStroke(0, false);
    vm.strokeAt(10, 10);
    vm.strokeAt(11, 10);
    vm.endStroke();

    expect(vm.canUndo()).toBe(true);

    // 切换到第 2 个 Tab (无新画笔历史)
    vm.switchTab(tab2Id);
    expect(vm.getActiveTabId()).toBe(tab2Id);
    expect(vm.canUndo()).toBe(false);

    // 切回第 3 个 Tab，历史依然可用
    vm.switchTab(tab3Id);
    expect(vm.getActiveTabId()).toBe(tab3Id);
    expect(vm.canUndo()).toBe(true);

    // 撤销笔划
    vm.undo();
    expect(vm.canUndo()).toBe(false);
  });

  it('supports cross-tab copy from Tab 1 and paste into Tab 2', () => {
    const vm = new ViewModel();

    // Tab 1: 载入预设
    vm.loadPresetAvatar();
    const tab1Id = vm.getActiveTabId()!;

    // 选中一块区域并复制
    vm.setSelection({ x: 20, y: 20, w: 10, h: 10 });
    expect(vm.pixel.copySelection()).toBe(true);
    expect(vm.pixel.hasClipboard()).toBe(true);

    // 创建 Tab 2: 空白画布
    vm.newBlankProject();
    const tab2Id = vm.getActiveTabId()!;
    expect(tab2Id).not.toBe(tab1Id);

    // 在 Tab 2 中粘贴
    expect(vm.pixel.pasteClipboard()).toBe(true);

    // Tab 2 的选区应自动对准粘贴的 patch
    expect(vm.session.selection).not.toBeNull();
    expect(vm.session.selection?.w).toBe(10);
    expect(vm.session.selection?.h).toBe(10);

    // 撤销在 Tab 2 中成功移除粘贴
    expect(vm.canUndo()).toBe(true);
    vm.undo();
    expect(vm.canUndo()).toBe(false);

    // 切回 Tab 1，原预设文档完好无损
    vm.switchTab(tab1Id);
    expect(vm.getActiveTabId()).toBe(tab1Id);
  });

  it('closeTab prompts confirmation only when tab has undo history', () => {
    let promptCaptured: any = null;
    const vm = new ViewModel();
    vm.setPrompts({ confirm: (p) => { promptCaptured = p; } });

    // 新建 2 个空白 Tab
    vm.newBlankProject();
    vm.newBlankProject();
    expect(vm.getTabs()).toHaveLength(2);

    const tabs = vm.getTabs();
    const tab1 = tabs[0];
    const tab2 = tabs[1];

    // 在 Tab 2 画笔产生历史
    vm.beginStroke(0, false);
    vm.strokeAt(5, 5);
    vm.endStroke();
    expect(vm.canUndo()).toBe(true);

    // 关闭 Tab 1 (无历史) -> 无弹窗直接关闭
    vm.closeTab(tab1.id);
    expect(promptCaptured).toBeNull();
    expect(vm.getTabs()).toHaveLength(1);

    // 关闭 Tab 2 (有历史) -> 触发确认弹窗
    vm.closeTab(tab2.id);
    expect(promptCaptured).not.toBeNull();
    expect(promptCaptured.title).toContain('关闭标签页确认');

    // 取消关闭
    promptCaptured.buttons[1].onClick();
    expect(vm.getTabs()).toHaveLength(1);

    // 再次请求关闭并点击确认 -> 成功关闭
    promptCaptured = null;
    vm.closeTab(tab2.id);
    expect(promptCaptured).not.toBeNull();
    promptCaptured.buttons[0].onClick();
    expect(vm.getTabs()).toHaveLength(1); // 关掉最后一个后自动进入空状态新 Tab
    expect(vm.session.isLoaded).toBe(false);
  });

  it('renames tab and enforces unique names', () => {
    const vm = new ViewModel();
    vm.newBlankProject();
    vm.newBlankProject();

    const tabs = vm.getTabs();
    expect(vm.renameTab(tabs[0].id, '我的肖像')).toBe(true);
    expect(vm.getTabs()[0].name).toBe('我的肖像');

    // 试图重命名第二个也叫「我的肖像」，自动编号为「我的肖像 (2)」
    expect(vm.renameTab(tabs[1].id, '我的肖像')).toBe(true);
    expect(vm.getTabs()[1].name).toBe('我的肖像 (2)');
  });

  it('enforces MAX_TAB_COUNT limit of 12', () => {
    const vm = new ViewModel();
    for (let i = 0; i < MAX_TAB_COUNT + 5; i++) {
      vm.newBlankProject();
    }
    expect(vm.getTabs().length).toBeLessThanOrEqual(MAX_TAB_COUNT);
  });

  it('workspace autosave round-trips v3 multi-tab records and migrates v2 legacy stores', () => {
    const map = new Map<string, string>();
    const store: KeyValueStore = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => { map.set(k, v); },
      removeItem: (k) => { map.delete(k); },
    };

    const service = new AutosaveService(store);

    // 1. 模拟写入 v2 单工程
    const doc = createEmptyDocument();
    doc.pixelIndices[0] = 3;
    service.saveImmediate(doc);

    expect(service.hasSaved()).toBe(true);
    const legacyMigration = service.loadWorkspace();
    expect(legacyMigration).not.toBeNull();
    expect(legacyMigration?.tabs).toHaveLength(1);
    expect(legacyMigration?.tabs[0].name).toBe('已恢复工程');

    // 2. 模拟写入 v3 多标签页工作区
    const doc2 = createEmptyDocument();
    doc2.pixelIndices[0] = 7;
    service.saveWorkspaceImmediate({
      activeId: 'tab_2',
      tabs: [
        { id: 'tab_1', name: '角色A', doc },
        { id: 'tab_2', name: '角色B', doc: doc2 },
      ],
    });

    const wsLoaded = service.loadWorkspace();
    expect(wsLoaded).not.toBeNull();
    expect(wsLoaded?.activeId).toBe('tab_2');
    expect(wsLoaded?.tabs).toHaveLength(2);
    expect(wsLoaded?.tabs[0].name).toBe('角色A');
    expect(wsLoaded?.tabs[1].name).toBe('角色B');
  });
});
