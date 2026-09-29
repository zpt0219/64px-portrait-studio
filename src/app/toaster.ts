/**
 * 右下角提示消息：订阅 ViewModel 的 onNotify (对应 imgui 版的 LogView)
 */

import { StudioEvents, ToastLevel } from '../command/events';

export class Toaster implements StudioEvents {
  constructor(private readonly container: HTMLElement) {}

  onNotify(message: string, level: ToastLevel): void {
    const toast = document.createElement('div');
    toast.className = `toast toast-${level}`;
    toast.textContent = message;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }
}
