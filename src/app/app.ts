/**
 * App (对应 tile_map_editor_imgui 的 App)：三栏布局与分栏拖拽、全局快捷键、文件导入、弹窗与提示消息。
 * 拥有 ViewModel、EditorContext 和所有面板；自身不修改文档，只调用 ViewModel。
 */

import { ZONE_CONFIG, ALL_ZONES, MaskTool } from '../types';
import { hasSavedProject } from '../core/storage';
import { Header } from '../panels/Header';
import { PalettePanel } from '../panels/PalettePanel';
import { MaskPanel } from '../panels/MaskPanel';
import { MaskToolsPanel } from '../panels/MaskToolsPanel';
import { RealtimePreview } from '../panels/RealtimePreview';
import { CanvasPanel } from '../panels/canvas/CanvasPanel';
import { ReplaceColorModal } from '../panels/modals/ReplaceColorModal';
import { ConfirmModal } from '../panels/modals/ConfirmModal';
import { StudioEvents } from '../command/events';
import { EditorSession } from '../model/session';
import { ViewModel } from './viewModel';
import { EditorContext } from './editorContext';
import { Toaster } from './toaster';
import { ImportCoordinator } from './controllers/ImportCoordinator';

export class App implements StudioEvents {
  readonly vm = new ViewModel();
  private readonly ctx = new EditorContext(() => this.vm.onContextChanged());
  private readonly importCoordinator: ImportCoordinator;
  private header!: Header;
  private replaceColorModal!: ReplaceColorModal;
  private confirmModal!: ConfirmModal;
  private palettePanel!: PalettePanel;
  private maskToolsPanel!: MaskToolsPanel;
  private canvasPanel!: CanvasPanel;
  private realtimePreview!: RealtimePreview;
  private maskPanel!: MaskPanel;
  private toaster!: Toaster;
  private palettePanelWrapper!: HTMLElement;
  private maskToolsPanelWrapper!: HTMLElement;
  private fKeyDownTime = 0;
  private abortController = new AbortController();
  private isDisposed = false;

  constructor() {
    this.importCoordinator = new ImportCoordinator({
      loadProject: (data) => this.vm.loadProject(data),
      importImage: (image) => this.vm.importImage(image),
      notify: (msg, lvl) => this.vm.notify(msg, lvl),
    });

    this.buildDomLayout();
    this.createPanels();
    this.setupSplitterDragging();
    window.addEventListener('keydown', (e) => this.handleShortcut(e), { signal: this.abortController.signal });
    window.addEventListener('keyup', (e) => this.handleKeyUp(e), { signal: this.abortController.signal });
    window.addEventListener('blur', () => { this.fKeyDownTime = 0; }, { signal: this.abortController.signal });
    window.addEventListener('pagehide', () => { this.vm.flushAutosave(); }, { signal: this.abortController.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.vm.flushAutosave();
      }
    }, { signal: this.abortController.signal });

    if (hasSavedProject()) {
      this.vm.notify('检测到上次未完成的编辑进度，可点击中心卡片快速恢复', 'info');
    }
  }

  private buildDomLayout(): void {
    const appEl = document.getElementById('app');
    if (!appEl) throw new Error('Missing #app root element in index.html');

    appEl.innerHTML = `
      <div class="studio-layout">
        <div id="header-mount"></div>
        <main class="studio-main-body" id="studio-main-body">
          <div id="palette-mount" class="main-sidebar-pane palette-sidebar">
            <div id="palette-panel-wrapper" style="height: 100%;"></div>
            <div id="mask-tools-panel-wrapper" style="height: 100%; display: none;"></div>
          </div>
          <div class="column-splitter" id="splitter-left" title="拖动调整左栏宽度">
            <div class="splitter-handle"></div>
          </div>
          <div id="canvas-mount" class="main-canvas-pane"></div>
          <div class="column-splitter" id="splitter-right" title="拖动调整右栏宽度">
            <div class="splitter-handle"></div>
          </div>
          <div id="mask-mount" class="main-sidebar-pane mask-sidebar"></div>
        </main>
      </div>
      <div class="toast-container" id="toast-container"></div>
    `;
  }

  private createPanels(): void {
    const vm = this.vm;
    const byId = (id: string) => document.getElementById(id)!;
    this.palettePanelWrapper = byId('palette-panel-wrapper');
    this.maskToolsPanelWrapper = byId('mask-tools-panel-wrapper');

    this.toaster = new Toaster(byId('toast-container'));
    vm.registerListener(this.toaster);
    vm.registerListener(this);

    this.confirmModal = new ConfirmModal(document.body);
    vm.setPrompts({
      confirm: (options) => {
        this.replaceColorModal?.close();
        this.confirmModal.show(options);
      },
      dismiss: () => this.confirmModal.dismiss(),
    });
    this.replaceColorModal = new ReplaceColorModal(document.body, {
      onConfirm: (fromIdx, toIdx, scope) => vm.replaceColor(fromIdx, toIdx, scope),
    });

    this.header = new Header(byId('header-mount'), vm, (file) => this.handleIncomingFile(file));
    this.palettePanel = new PalettePanel(this.palettePanelWrapper, vm, this.ctx);
    this.maskToolsPanel = new MaskToolsPanel(this.maskToolsPanelWrapper, vm);
    this.canvasPanel = new CanvasPanel(byId('canvas-mount'), vm, this.ctx, {
      onFileDrop: (file) => this.handleIncomingFile(file),
      onTriggerUpload: () => this.header.triggerUpload(),
      onTogglePreview: () => this.toggleRealtimePreview(),
      onOpenReplaceColor: () => this.openReplaceColorModal(),
    });
    this.realtimePreview = new RealtimePreview(this.canvasPanel.getViewportElement(), vm, this.ctx);
    this.maskPanel = new MaskPanel(byId('mask-mount'), vm);
  }

  /** 左栏在像素模式显示色板面板，在遮罩模式显示遮罩工具箱 */
  onSessionChanged(keys: (keyof EditorSession)[]): void {
    if (!keys.includes('activeMode')) return;
    const isMask = this.vm.session.activeMode === 'mask';
    this.palettePanelWrapper.style.display = isMask ? 'none' : '';
    this.maskToolsPanelWrapper.style.display = isMask ? '' : 'none';
  }

  onDocumentReplaced(): void {
    this.importCoordinator.cancelPending();
    this.confirmModal.dismiss();
    this.replaceColorModal.close();
  }

  // ===================== 文件导入 =====================

  /** 处理拖入或选择的文件：工程 ZIP 完整恢复，普通图片作为新项目载入 */
  private async handleIncomingFile(file: File): Promise<void> {
    if (this.isDisposed) return;
    await this.importCoordinator.handleFile(file);
  }

  // ===================== 弹窗与画中画 =====================

  private openReplaceColorModal(): void {
    const vm = this.vm;
    if (!vm.session.isLoaded) {
      vm.notify('请先载入头像后再使用颜色替换功能', 'warning');
      return;
    }
    vm.setMode('pixel', () => {
      const { session, doc } = vm;
      this.replaceColorModal.open(
        { palette: doc.palette, activePaletteIndex: session.activePaletteIndex, bgPaletteIndex: session.bgPaletteIndex },
        session.selection
      );
    });
  }

  private toggleRealtimePreview(): void {
    if (!this.vm.session.isLoaded) {
      this.vm.notify('请先载入 64×64 像素头像后再开启原寸预览', 'warning');
      return;
    }
    const visible = !this.ctx.previewVisible;
    this.ctx.setPreviewVisible(visible);
    this.vm.notify(visible ? '👁️ 原寸实时预览已开启' : '👁️ 原寸实时预览已隐藏');
  }

  // ===================== 列宽拖拽调整 =====================

  private setupSplitterDragging(): void {
    const splitterLeft = document.getElementById('splitter-left')!;
    const splitterRight = document.getElementById('splitter-right')!;
    const paletteMount = document.getElementById('palette-mount')!;
    const maskMount = document.getElementById('mask-mount')!;

    // 恢复本地存储的列宽偏好
    const savedWidth = (key: string, min: number, max: number): number | null => {
      try {
        const val = localStorage.getItem(key);
        const w = parseInt(val ?? '', 10);
        return !isNaN(w) && w >= min && w <= max ? w : null;
      } catch {
        return null;
      }
    };
    paletteMount.style.width = `${savedWidth('imagegem_layout_left_width', 220, 480) ?? 280}px`;
    const rightWidth = savedWidth('imagegem_layout_right_width', 220, 520);
    if (rightWidth !== null) maskMount.style.width = `${rightWidth}px`;

    const makeDraggable = (splitter: HTMLElement, pane: HTMLElement, direction: 1 | -1, min: number, max: number, storageKey: string) => {
      let dragging = false;
      let startX = 0;
      let startWidth = 0;
      splitter.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startWidth = pane.offsetWidth;
        splitter.classList.add('is-active');
        document.body.classList.add('is-resizing');
      }, { signal: this.abortController.signal });
      if (typeof window !== 'undefined') {
        window.addEventListener('mousemove', (e) => {
          if (!dragging) return;
          const width = Math.max(min, Math.min(max, startWidth + direction * (e.clientX - startX)));
          pane.style.width = `${width}px`;
        }, { signal: this.abortController.signal });
        window.addEventListener('mouseup', () => {
          if (!dragging) return;
          dragging = false;
          splitter.classList.remove('is-active');
          document.body.classList.remove('is-resizing');
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(storageKey, pane.offsetWidth.toString());
            }
          } catch {
            // ignore storage error
          }
        }, { signal: this.abortController.signal });
      }
    };
    makeDraggable(splitterLeft, paletteMount, 1, 200, 480, 'imagegem_layout_left_width');
    makeDraggable(splitterRight, maskMount, -1, 220, 520, 'imagegem_layout_right_width');
  }

  // ===================== 全局快捷键 =====================

  /**
   * 按以下顺序匹配，命中即停止：
   * 1. Shift+字母 (不论是否按 Ctrl)  2. Ctrl/Cmd+字母  3. Esc / Delete
   * 4. 其余带 Ctrl/Alt 的组合一律忽略  5. 单键 (工具、模式、分区)
   * 同时匹配 e.key 与 e.code，兼容中文输入法与 CapsLock。
   */
  private handleShortcut(e: KeyboardEvent): void {
    if (this.isDisposed || e.defaultPrevented) return;
    // 只在真正的文本输入中屏蔽快捷键；滑杆、复选框等非文本控件不阻塞
    const target = e.target as HTMLElement | null;
    if (target) {
      if (target.isContentEditable || target.tagName === 'TEXTAREA') return;
      if (target.tagName === 'INPUT') {
        const type = ((target as HTMLInputElement).type || 'text').toLowerCase();
        if (!['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset'].includes(type)) return;
      }
    }
    // 弹窗打开期间由弹窗自己处理按键
    if (this.replaceColorModal.getIsOpen() || this.confirmModal.getIsOpen()) return;

    const vm = this.vm;
    const s = vm.session;
    const key = e.key.toLowerCase();
    const is = (...names: string[]) => names.includes(key) || names.includes(e.code);
    const letter = (ch: string) => is(ch, `Key${ch.toUpperCase()}`);
    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    const inMask = s.activeMode === 'mask';

    type Action = () => void;
    // Shift+字母：画布变换
    const shiftActions: [string, Action][] = [
      ['r', () => this.openReplaceColorModal()],
      ['h', () => vm.flipContent('horizontal')],
      ['v', () => vm.flipContent('vertical')],
      ['t', () => vm.rotateContentCW()],
    ];
    if (e.shiftKey) {
      for (const [ch, run] of shiftActions) {
        if (letter(ch)) {
          e.preventDefault();
          run();
          return;
        }
      }
    }

    // Ctrl/Cmd+字母：返回 false 表示不拦截浏览器默认行为
    const ctrlActions: [string, () => boolean][] = [
      ['z', () => (e.shiftKey ? vm.redo() : vm.undo(), true)],
      ['y', () => (vm.redo(), true)],
      ['s', () => (vm.exportZip(), true)],
      ['c', () => {
        if (!s.selection) return false;
        if (vm.copySelection()) vm.notify('📋 已复制选区内容到剪贴板');
        return true;
      }],
      ['x', () => {
        if (!s.selection) return false;
        if (vm.cutSelection()) vm.notify('✂️ 已剪切选区内容到剪贴板');
        return true;
      }],
      ['v', () => {
        if (!vm.hasClipboard()) return false;
        if (vm.pasteClipboard()) vm.notify('📋 已从剪贴板粘贴选区');
        return true;
      }],
      ['d', () => (this.clearSelectionWithToast(), true)],
      ['a', () => (vm.selectAll(), vm.notify('已全选整张画布 (64×64)'), true)],
      // 拦截 Ctrl+P 避免调出打印窗口，顺便切换为画笔
      ['p', () => (vm.setActiveTool('pen'), vm.notify('✏️ 已切换为画笔工具 (左键绘制前景色，右键绘制背景色)'), true)],
    ];
    if (ctrlOrCmd) {
      for (const [ch, run] of ctrlActions) {
        if (letter(ch)) {
          if (run()) e.preventDefault();
          return;
        }
      }
    }

    if (is('escape', 'Escape')) {
      this.clearSelectionWithToast();
      return;
    }
    if (is('delete', 'backspace', 'Delete', 'Backspace') && s.selection) {
      e.preventDefault();
      if (vm.deleteSelectionContent()) vm.notify('🧼 已将选区内容清空为透明像素');
      return;
    }

    // 避免 Ctrl/Alt/Shift 组合误触单键快捷键
    if (ctrlOrCmd || e.altKey || e.shiftKey) return;

    // 遮罩模式下 [ / ] 调整画笔/橡皮尺寸 (仅在画笔或橡皮工具下有效)
    if (inMask && (s.activeMaskTool === 'pen' || s.activeMaskTool === 'eraser')) {
      if (is('[', 'BracketLeft')) return vm.changeMaskBrushSize(-1);
      if (is(']', 'BracketRight')) return vm.changeMaskBrushSize(1);
    }

    // 同一个键在像素模式与遮罩模式下分别对应的工具
    const toolKey = (maskTool: MaskTool, maskToast: string, pixelAction: Action) => () => {
      if (inMask) {
        vm.setActiveMaskTool(maskTool);
        vm.notify(maskToast);
      } else {
        pixelAction();
      }
    };

    const singleKeyActions: [string[], Action][] = [
      [['q'], () => vm.setMode('pixel')],
      [['w'], () => vm.setMode('mask')],
      [['m', 's'], toolKey('box_select', '🔲 已切换为智能框选 (左键加匹配色，Shift去杂色，Alt去匹配色，右键去所有色)', () => {
        vm.setActiveTool('select');
        vm.notify('⬚ 矩形选区工具：拖拽框选，选区内拖动平移 (原位透明)，按住 Ctrl 复制');
      })],
      [['p'], toolKey('pen', '✏️ 已切换为遮罩画笔', () => {
        vm.setActiveTool('pen');
        vm.notify('✏️ 已切换为画笔工具 (左键绘制前景色，右键绘制背景色)');
      })],
      [['b'], () => {
        if (inMask) {
          vm.setActiveMaskTool('bucket');
          vm.notify(`🪣 已切换为遮罩油漆桶 (${s.bucketConnectivity} 邻居连通，按住 Shift 全图同色生效)`);
        } else if (s.activeTool === 'bucket') {
          // 已是油漆桶时再按一次切换 8/4 连通
          vm.setBucketConnectivity(s.bucketConnectivity === 8 ? 4 : 8);
        } else {
          vm.setActiveTool('bucket');
          vm.notify(`🪣 已切换为油漆桶工具 (当前：${s.bucketConnectivity} 邻居连通)`);
        }
      }],
      [['f'], () => {
        if (e.repeat) return;
        this.fKeyDownTime = Date.now();
        this.toggleHairHighlight();
      }],
      [['e'], toolKey('eraser', '🧼 已切换为遮罩橡皮擦 (擦除为背景 0)', () => {
        vm.setActiveTool('eraser');
        vm.notify('🧼 已切换为橡皮擦工具 (原生透明删除)');
      })],
      [['i'], () => {
        if (inMask) vm.notify('吸管工具仅在像素画图模式下有效 (按 Q 切换)', 'info');
        else vm.setActiveTool('eyedropper');
      }],
      [['g'], () => vm.setGrid(!s.showGrid)],
      [['x'], () => vm.swapFgBgColors()],
      [['v'], () => this.toggleRealtimePreview()],
    ];
    for (const [letters, run] of singleKeyActions) {
      if (letters.some(letter)) {
        run();
        return;
      }
    }

    // 0~4 选择遮罩分区
    for (const zone of ALL_ZONES) {
      const digit = ZONE_CONFIG[zone].hotkey;
      if (is(digit, `Digit${digit}`, `Numpad${digit}`)) {
        vm.setActiveZone(zone);
        vm.notify(`🎭 已选择${ZONE_CONFIG[zone].shortName}遮罩 [${digit}]`);
        return;
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (this.isDisposed) return;
    const key = e.key.toLowerCase();
    const is = (...names: string[]) => names.includes(key) || names.includes(e.code);
    if (is('f', 'KeyF')) {
      if (this.fKeyDownTime > 0) {
        const duration = Date.now() - this.fKeyDownTime;
        this.fKeyDownTime = 0;
        // 长按模式 (按住 >= 250ms)：松开按键时自动退出高亮
        if (duration >= 250 && this.ctx.isHairHighlightPinned) {
          this.ctx.setHairHighlightPinned(false);
          this.ctx.setHighlightedPaletteIndex(null);
        }
      }
    }
  }

  /** 切换当前发色全高亮探针状态 (快捷键 F 触发) */
  private toggleHairHighlight(): void {
    if (!this.vm.session.isLoaded) return;
    const isPinned = this.ctx.isHairHighlightPinned;
    if (isPinned) {
      this.ctx.setHairHighlightPinned(false);
      this.ctx.setHighlightedPaletteIndex(null);
      this.vm.notify('✨ 已关闭发色高亮');
    } else {
      const indices = this.vm.getHairRampIndices();
      this.ctx.setHairHighlightPinned(true);
      this.ctx.setHighlightedPaletteIndex(indices);
      this.vm.notify('✨ 已开启全发色高亮 (按住预览，或短按 F / Esc 关闭)');
    }
  }

  private clearSelectionWithToast(): void {
    let clearedHighlight = false;
    if (this.ctx.isHairHighlightPinned || this.ctx.highlightedPaletteIndex !== null) {
      this.ctx.setHairHighlightPinned(false);
      this.ctx.setHighlightedPaletteIndex(null);
      clearedHighlight = true;
    }
    if (this.vm.clearSelection()) {
      this.vm.notify('已取消矩形选区');
    } else if (clearedHighlight) {
      this.vm.notify('✨ 已关闭发色高亮');
    }
  }

  /** 幂等销毁：释放所有子面板、全局监听器、作废挂起导入并终结 ViewModel */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.abortController.abort();
    document.body.classList.remove('is-resizing');

    this.importCoordinator.cancelPending();

    this.toaster?.dispose();
    this.header?.dispose();
    this.palettePanel?.dispose();
    this.maskToolsPanel?.dispose();
    this.canvasPanel?.dispose();
    this.realtimePreview?.dispose();
    this.maskPanel?.dispose();
    this.confirmModal?.dispose();
    this.replaceColorModal?.dispose();

    this.vm.unregisterListener(this);
    this.vm.dispose();
  }
}
