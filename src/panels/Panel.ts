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
  for (const panel of panels) panel.render();
}

export abstract class Panel {
  constructor(protected readonly vm: ViewModel) {
    // 子类按需实现 StudioEvents 的方法 (接口全部可选，基类本身不含任何事件方法)
    vm.registerListener(this as StudioEvents);
  }

  protected markDirty(): void {
    dirtyPanels.add(this);
    if (!frameRequested) {
      frameRequested = true;
      requestAnimationFrame(flush);
    }
  }

  /** 从 ViewModel 读取状态刷新 DOM (≈ ImGui 面板的 draw()) */
  abstract render(): void;
}
