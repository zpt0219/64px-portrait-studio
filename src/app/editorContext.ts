/**
 * EditorContext (对应 tile_map_editor_imgui 的 EditorContext)：
 * 多个面板共享、但既不属于文档也不属于会话的纯界面状态。不存档、不进撤销。
 */

export class EditorContext {
  /** 在画布上高亮的色板索引或索引列表 (悬停色板色块、发色高亮或选区统计行时) */
  private highlighted: number | number[] | null = null;
  /** 画中画原寸预览是否打开 (载入头像后才实际显示) */
  private previewOpen = true;
  /** 发色高亮是否锁定/常驻 */
  private hairHighlightPinned = false;

  constructor(private readonly onChange: () => void) {}

  get isHairHighlightPinned(): boolean {
    return this.hairHighlightPinned;
  }

  setHairHighlightPinned(pinned: boolean): void {
    if (this.hairHighlightPinned === pinned) return;
    this.hairHighlightPinned = pinned;
    this.onChange();
  }

  get highlightedPaletteIndex(): number | number[] | null {
    return this.highlighted;
  }

  setHighlightedPaletteIndex(index: number | number[] | null): void {
    if (this.isEqual(this.highlighted, index)) return;
    this.highlighted = index;
    this.onChange();
  }

  private isEqual(a: number | number[] | null, b: number | number[] | null): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => v === b[i]);
    }
    return false;
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
