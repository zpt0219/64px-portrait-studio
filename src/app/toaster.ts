/**
 * 右下角提示消息：订阅 ViewModel 的 onNotify (对应 imgui 版的 LogView)
 */

import { StudioEvents, ToastLevel } from '../command/events';

export class Toaster implements StudioEvents {
  private activeTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private _isDisposed = false;

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  constructor(private readonly container: HTMLElement) {}

  onNotify(message: string, level: ToastLevel): void {
    if (this._isDisposed) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${level}`;
    toast.textContent = message;
    this.container.appendChild(toast);

    let t2: ReturnType<typeof setTimeout> | null = null;
    const t1 = setTimeout(() => {
      this.activeTimeouts.delete(t1);
      if (this._isDisposed) return;
      toast.classList.add('fade-out');
      t2 = setTimeout(() => {
        if (t2) this.activeTimeouts.delete(t2);
        toast.remove();
      }, 300);
      this.activeTimeouts.add(t2);
    }, 2800);
    this.activeTimeouts.add(t1);
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    for (const t of this.activeTimeouts) {
      clearTimeout(t);
    }
    this.activeTimeouts.clear();
    this.container.innerHTML = '';
  }
}
