/**
 * 画布顶部工具栏：缩放、网格、原寸预览开关、扣外围白底 (对应 tile_map_editor_imgui 的 ToolbarPanel)。
 * 右侧的悬停坐标条由 CanvasPanel 按鼠标位置直接更新。
 */

import { ZOOM_STEPS, DEFAULT_ZOOM } from '../../model/session';
import { ViewModel } from '../../app/viewModel';
import { EditorContext } from '../../app/editorContext';
import { Panel } from '../Panel';

export class CanvasToolbar extends Panel {
  constructor(
    private readonly el: HTMLElement,
    vm: ViewModel,
    private readonly ctx: EditorContext,
    onTogglePreview: () => void
  ) {
    super(vm);
    const zoomSlider = el.querySelector('#zoom-range-slider') as HTMLInputElement;
    zoomSlider.addEventListener('input', () => {
      this.vm.setZoom(ZOOM_STEPS[parseInt(zoomSlider.value, 10)] ?? DEFAULT_ZOOM);
    });
    zoomSlider.addEventListener('change', () => zoomSlider.blur());

    el.querySelector('#btn-zoom-fit')?.addEventListener('click', () => this.vm.setZoom(DEFAULT_ZOOM));
    el.querySelector('#btn-toggle-grid')?.addEventListener('click', () => this.vm.setGrid(!this.vm.session.showGrid));
    el.querySelector('#btn-toggle-preview')?.addEventListener('click', onTogglePreview);
    el.querySelector('#btn-remove-outer-white')?.addEventListener('click', () => this.vm.removeOuterWhite());
    this.markDirty();
  }

  onSessionChanged(): void {
    this.markDirty();
  }
  onContextChanged(): void {
    this.markDirty();
  }

  render(): void {
    const { zoomLevel, showGrid, isLoaded } = this.vm.session;
    const zoomText = this.el.querySelector('#zoom-text');
    if (zoomText) zoomText.textContent = `${zoomLevel}×`;

    const zoomSlider = this.el.querySelector('#zoom-range-slider') as HTMLInputElement;
    const idx = ZOOM_STEPS.indexOf(zoomLevel as (typeof ZOOM_STEPS)[number]);
    if (idx !== -1) zoomSlider.value = idx.toString();

    this.el.querySelector('#btn-toggle-grid')?.classList.toggle('active', showGrid);

    const previewBtn = this.el.querySelector('#btn-toggle-preview') as HTMLElement;
    previewBtn.classList.toggle('active', isLoaded && this.ctx.previewVisible);
    previewBtn.style.opacity = isLoaded ? '1' : '0.5';
    previewBtn.style.cursor = isLoaded ? 'pointer' : 'not-allowed';
    previewBtn.title = isLoaded ? '切换 1:1 原寸画中画实时预览 (快捷键 V)' : '请先载入头像以开启原寸预览 (快捷键 V)';
  }
}
