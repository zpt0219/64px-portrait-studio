/**
 * 多标签页管理 ViewModel (TabViewModel)：
 * - 维护工作区内所有 Tab (TabState 列表) 与 activeTabId；
 * - 协调 Tab 创建、切换 (原地数据覆写 + 撤销历史隔离)、关闭与重命名；
 * - 保持 ViewModel 职责轻量与整洁。
 */

import { PortraitDocument, cloneDocument, createEmptyDocument } from '../core/document';
import { EditorSession } from '../core/session';
import { CommandHandler } from '../command/commandHandler';
import {
  TabState,
  TabSummary,
  MAX_TAB_COUNT,
  createTabId,
  generateTabName,
  extractTabSession,
  applyTabSession,
  syncDocumentInPlace,
} from '../core/workspace';
import { ToastLevel } from '../command/events';
import { PromptOptions } from './ports';

export interface TabContext {
  readonly doc: PortraitDocument;
  readonly session: EditorSession;
  readonly isDisposed: boolean;
  getCommandHandler(): CommandHandler;
  setCommandHandler(handler: CommandHandler): void;
  createCommandHandler(): CommandHandler;
  incrementGeneration(): number;
  endStroke(): void;
  notify(msg: string, level?: ToastLevel): void;
  confirm(options: PromptOptions): void;
  onTabsChanged(): void;
  onDocumentReplaced(): void;
  onHistoryChanged(): void;
  onSessionChanged(keys: (keyof EditorSession)[]): void;
  cleanSubViewModels(): void;
  checkCanExit(callback: (allowed: boolean) => void): void;
  saveDebounced(): void;
}

export class TabViewModel {
  private tabs: TabState[] = [];
  private activeTabId: string | null = null;
  private unnamedCounter = 0;

  constructor(private readonly ctx: TabContext) {}

  /** 初始化工作区首个空白 Tab (未载入状态) */
  initInitialTab(): TabState {
    this.unnamedCounter = 1;
    const tab: TabState = {
      id: createTabId(),
      name: '未命名-1',
      doc: cloneDocument(this.ctx.doc),
      session: extractTabSession(this.ctx.session),
      handler: this.ctx.getCommandHandler(),
    };
    this.tabs = [tab];
    this.activeTabId = tab.id;
    return tab;
  }

  getTabs(): TabSummary[] {
    return this.tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      isActive: tab.id === this.activeTabId,
      isLoaded: tab.session.isLoaded,
    }));
  }

  getActiveTab(): TabState | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  getActiveTabName(): string {
    return this.getActiveTab()?.name ?? '未命名';
  }

  getTabCount(): number {
    return this.tabs.length;
  }

  /** 获取所有现有 Tab 的名称列表 */
  private getExistingNames(): string[] {
    return this.tabs.map((t) => t.name);
  }

  nextDefaultName(forReuse = false): string {
    if (forReuse && this.canReuseInitialEmptyTab()) {
      return this.tabs[0].name;
    }
    this.unnamedCounter++;
    return generateTabName(`未命名-${this.unnamedCounter}`, this.getExistingNames());
  }

  /**
   * 判断当前是否仅有一个尚未编辑的初始空 Tab (可直接原地复用)
   */
  canReuseInitialEmptyTab(): boolean {
    if (this.tabs.length !== 1) return false;
    const tab = this.tabs[0];
    return !tab.session.isLoaded && !tab.handler.canUndo();
  }

  /**
   * 同步当前激活 Tab 的最新内存数据
   */
  syncActiveTabSnapshot(): void {
    const active = this.getActiveTab();
    if (!active) return;
    active.doc = cloneDocument(this.ctx.doc);
    active.session = extractTabSession(this.ctx.session);
  }

  /**
   * 打开新 Tab 并激活
   * @param rawName 建议名称 (如文件名或预设名)
   * @param doc 初始文档
   * @param sessionChanges 初始会话补丁
   * @param allowReuseEmpty 是否允许在仅有初始空白 Tab 时原地复用
   */
  openTab(
    rawName: string,
    doc: PortraitDocument,
    sessionChanges: Partial<EditorSession>,
    allowReuseEmpty = true
  ): TabState | null {
    if (this.ctx.isDisposed) return null;

    // 1. 若允许复用且仅有唯一的未载入初始空 Tab，则直接原地替换
    if (allowReuseEmpty && this.canReuseInitialEmptyTab()) {
      this.ctx.cleanSubViewModels();
      const active = this.tabs[0];
      active.name = generateTabName(rawName, []);
      active.doc = cloneDocument(doc);
      active.handler.clearHistory();

      syncDocumentInPlace(this.ctx.doc, doc);
      Object.assign(this.ctx.session, sessionChanges);
      active.session = extractTabSession(this.ctx.session);

      this.ctx.incrementGeneration();
      this.ctx.onDocumentReplaced();
      this.ctx.onTabsChanged();
      this.ctx.saveDebounced();
      return active;
    }

    // 2. 检查 Tab 数量上限
    if (this.tabs.length >= MAX_TAB_COUNT) {
      this.ctx.notify(`标签页已达上限 (${MAX_TAB_COUNT}个)，请先关闭不需要的标签页`, 'warning');
      return null;
    }

    // 3. 在切换前先清理模式状态并同步当前激活 Tab
    this.ctx.cleanSubViewModels();
    this.syncActiveTabSnapshot();

    const name = generateTabName(rawName, this.getExistingNames());
    const handler = this.ctx.createCommandHandler();

    // 4. 创建新 Tab
    const newTab: TabState = {
      id: createTabId(),
      name,
      doc: cloneDocument(doc),
      session: {
        ...extractTabSession(this.ctx.session),
        ...sessionChanges,
      },
      handler,
    };

    this.tabs.push(newTab);

    // 5. 切换至新 Tab
    this.doSwitchToTab(newTab);
    this.ctx.onTabsChanged();
    this.ctx.saveDebounced();
    return newTab;
  }

  /**
   * 切换至指定 Tab
   */
  switchTab(tabId: string): boolean {
    if (this.ctx.isDisposed || tabId === this.activeTabId) return true;
    const target = this.tabs.find((t) => t.id === tabId);
    if (!target) return false;

    // 检查当前模式是否允许退出 (如试色未固化)
    this.ctx.checkCanExit((allowed) => {
      if (!allowed) return;

      this.ctx.endStroke();
      this.ctx.cleanSubViewModels();

      // 保存当前活跃 Tab 状态
      this.syncActiveTabSnapshot();

      // 切换到目标 Tab
      this.doSwitchToTab(target);
      this.ctx.onTabsChanged();
    });

    return true;
  }

  private doSwitchToTab(target: TabState): void {
    this.activeTabId = target.id;

    // 原地更新全局单例 doc 与 session
    syncDocumentInPlace(this.ctx.doc, target.doc);
    applyTabSession(this.ctx.session, target.session);

    // 替换 CommandHandler
    this.ctx.setCommandHandler(target.handler);

    // 递增文档世代，使异步操作与挂起 prompt 失效
    this.ctx.incrementGeneration();

    // 广播重绘与会话更新事件
    this.ctx.onDocumentReplaced();
    this.ctx.onHistoryChanged();
    this.ctx.onSessionChanged(Object.keys(this.ctx.session) as (keyof EditorSession)[]);
  }

  /**
   * 关闭指定 Tab
   * 若有未保存编辑历史，弹出确认提示
   */
  closeTab(tabId: string): void {
    if (this.ctx.isDisposed) return;
    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    const tab = this.tabs[index];

    const performClose = () => {
      // 1. 如果关闭的是当前激活 Tab，先切换到邻近 Tab
      if (tab.id === this.activeTabId) {
        if (this.tabs.length > 1) {
          const nextIndex = index === this.tabs.length - 1 ? index - 1 : index + 1;
          const nextTab = this.tabs[nextIndex];
          this.doSwitchToTab(nextTab);
        } else {
          // 关闭了最后一个 Tab，重新初始化为空状态 Tab
          const emptyTab: TabState = {
            id: createTabId(),
            name: '未命名-1',
            doc: createEmptyDocument(),
            session: extractTabSession(this.ctx.session),
            handler: this.ctx.createCommandHandler(),
          };
          emptyTab.session.isLoaded = false;
          emptyTab.session.selection = null;

          this.tabs = [emptyTab];
          this.unnamedCounter = 1;
          this.doSwitchToTab(emptyTab);
          this.ctx.onTabsChanged();
          this.ctx.saveDebounced();
          return;
        }
      }

      // 2. 从列表中移除
      this.tabs = this.tabs.filter((t) => t.id !== tabId);
      this.ctx.onTabsChanged();
      this.ctx.saveDebounced();
    };

    // 若该 Tab 具有历史记录，需确认关闭
    if (tab.handler.canUndo()) {
      this.ctx.confirm({
        icon: '✕',
        title: '关闭标签页确认',
        message: `确定要关闭标签页【${tab.name}】吗？`,
        subMessage: '该标签页中未导出的像素修改将被丢弃。',
        buttons: [
          { label: '关闭标签页', className: 'btn-danger', onClick: performClose },
          { label: '取消', className: 'btn-ghost', onClick: () => {} },
        ],
      });
    } else {
      performClose();
    }
  }

  /**
   * 重命名 Tab
   */
  renameTab(tabId: string, newName: string): boolean {
    if (this.ctx.isDisposed) return false;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return false;

    const trimmed = newName.trim();
    if (!trimmed || trimmed === tab.name) return false;

    const otherNames = this.tabs.filter((t) => t.id !== tabId).map((t) => t.name);
    tab.name = generateTabName(trimmed, otherNames);
    this.ctx.onTabsChanged();
    return true;
  }

  /** 序列化整个工作区数据 (用于 v3 持久化) */
  getAllTabsForStorage(): TabState[] {
    this.syncActiveTabSnapshot();
    return this.tabs;
  }

  /** 从持久化工作区恢复所有 Tab */
  restoreTabs(tabs: TabState[], activeId: string): void {
    if (!tabs || tabs.length === 0) return;
    this.tabs = tabs;
    const target = tabs.find((t) => t.id === activeId) ?? tabs[0];
    this.doSwitchToTab(target);
    this.ctx.onTabsChanged();
  }
}
