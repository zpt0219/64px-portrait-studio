/**
 * 面板基类。DOM 是保留模式，不会像 ImGui 那样每帧重画，所以用「脏标记 + requestAnimationFrame」模拟：
 * 面板在事件回调里只调用 markDirty()，同一帧内的多次事件合并成一次 render()，render() 从 ViewModel 读取当前状态刷新 DOM。
 */

import { StudioEvents } from '../command/events';
import { ViewModel } from '../app/viewModel';

const dirtyPanels = new Set<Panel>();
let frameRequested = false;

function flush(): void {
  frameRequested = false;
  const panels = [...dirtyPanels];
  dirtyPanels.clear();
  for (const panel of panels) {
    if (!panel.isDisposed) {
      panel.render();
    }
  }
}

export abstract class Panel {
  protected _isDisposed = false;

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  constructor(protected readonly vm: ViewModel) {
    // 子类按需实现 StudioEvents 的方法 (接口全部可选，基类本身不含任何事件方法)
    vm.registerListener(this as StudioEvents);
  }

  protected markDirty(): void {
    if (this._isDisposed) return;
    dirtyPanels.add(this);
    if (!frameRequested) {
      frameRequested = true;
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(flush);
      } else {
        setTimeout(flush, 0);
      }
    }
  }

  /** 从 ViewModel 读取状态刷新 DOM (≈ ImGui 面板的 draw()) */
  abstract render(): void;

  /** 幂等销毁：注销 VM 监听，从脏标记队列移除，销毁后 markDirty 无效 */
  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    dirtyPanels.delete(this);
    this.vm.unregisterListener(this as StudioEvents);
    this.onDispose();
  }

  /** 子类重写以释放 DOM 节点、Timer、AbortController 等 */
  protected onDispose(): void {}
}

/** 测试辅助：刷新当前脏队列 */
export function flushDirtyPanelsForTest(): void {
  flush();
}

/** 测试辅助：获取当前脏队列大小 */
export function getDirtyPanelsCountForTest(): number {
  return dirtyPanels.size;
}

/** 测试辅助：清空脏队列 */
export function clearDirtyPanelsForTest(): void {
  dirtyPanels.clear();
  frameRequested = false;
}
