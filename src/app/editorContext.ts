/**
 * EditorContext (对应 tile_map_editor_imgui 的 EditorContext)：
 * 多个面板共享、但既不属于文档也不属于会话的纯界面状态。不存档、不进撤销。
 */

export class EditorContext {
  /** 在画布上高亮的色板索引 (悬停色板色块或选区统计行时) */
  private highlighted: number | null = null;
  /** 画中画原寸预览是否打开 (载入头像后才实际显示) */
  private previewOpen = true;

  constructor(private readonly onChange: () => void) {}

  get highlightedPaletteIndex(): number | null {
    return this.highlighted;
  }

  setHighlightedPaletteIndex(index: number | null): void {
    if (this.highlighted === index) return;
    this.highlighted = index;
    this.onChange();
  }

  get previewVisible(): boolean {
    return this.previewOpen;
  }

  setPreviewVisible(visible: boolean): void {
    if (this.previewOpen === visible) return;
    this.previewOpen = visible;
    this.onChange();
  }
}
