/**
 * 帮助与快捷键弹窗：精简使用教程与全局快捷键一览
 */

export class HelpModal {
  private overlayEl: HTMLElement | null = null;
  private isOpen = false;
  private abortController = new AbortController();
  private _isDisposed = false;

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  constructor(private readonly container: HTMLElement) {
    this.render();
    this.setupEvents();
  }

  private render(): void {
    const overlay = document.createElement('div');
    overlay.className = 'help-modal-overlay';
    overlay.id = 'help-modal-overlay';
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <div class="help-modal-card" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
        <div class="help-modal-header">
          <div class="help-modal-title-group">
            <span class="help-modal-icon">📖</span>
            <span class="help-modal-title" id="help-modal-title">使用教程与快捷键一览</span>
          </div>
          <button class="help-modal-close-btn" id="help-modal-close" title="关闭 (Esc)">✕</button>
        </div>

        <div class="help-modal-body">
          <!-- 教程部分 -->
          <div class="help-section">
            <h3 class="help-section-title">🚀 精简使用教程</h3>
            <div class="help-grid-cards">
              <div class="help-guide-card">
                <div class="guide-card-header">🎨 1. 像素修图</div>
                <div class="guide-card-content">
                  选用 36 色经典二次元色板。鼠标<b>左键</b>绘制前景色，<b>右键</b>绘制背景色；使用油漆桶单点填充相邻同色区域；Alt+点击快速吸色。
                </div>
              </div>

              <div class="help-guide-card">
                <div class="guide-card-header">🎭 2. 语义遮罩与发色置换</div>
                <div class="guide-card-content">
                  点击顶栏【语义遮罩】切换模式。选择头发、皮肤、衣服等分区进行涂抹标注；标注头发后右栏自动激活 <b>9 大经典发色卡</b>，点击即可预览立体光影置换并固化！
                </div>
              </div>

              <div class="help-guide-card">
                <div class="guide-card-header">⬚ 3. 选区与高级变换</div>
                <div class="guide-card-content">
                  选区工具框选目标区域后，在选区内拖拽可<b>平移像素</b>（原位镂空），按住 <b>Ctrl 拖拽可复制副本</b>；悬浮工具栏支持水平/垂直翻转及<b>选区内局域颜色替换</b>。
                </div>
              </div>

              <div class="help-guide-card">
                <div class="guide-card-header">💾 4. 导出与暂存恢复</div>
                <div class="guide-card-content">
                  支持一键导出纯净 64×64 PNG 或包含全层图纸的工程 ZIP。系统在编辑时自动本地暂存，刷新网页后可从中心横幅一键恢复上次未完成进度。
                </div>
              </div>
            </div>
          </div>

          <!-- 快捷键速查表 -->
          <div class="help-section" style="margin-top: 20px;">
            <h3 class="help-section-title">⌨️ 全局快捷键速查</h3>
            <div class="help-shortcuts-table-wrap">
              <table class="help-shortcuts-table">
                <thead>
                  <tr>
                    <th>功能分类</th>
                    <th>操作说明</th>
                    <th>快捷键</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td rowspan="6" class="cat-cell">🎨 绘图工具</td>
                    <td>画笔工具</td>
                    <td><kbd>P</kbd></td>
                  </tr>
                  <tr>
                    <td>橡皮擦 (原生透明删除)</td>
                    <td><kbd>E</kbd></td>
                  </tr>
                  <tr>
                    <td>油漆桶填充 (再次按下切换 8/4 连通)</td>
                    <td><kbd>B</kbd></td>
                  </tr>
                  <tr>
                    <td>吸管工具取色</td>
                    <td><kbd>I</kbd> 或 画布 <kbd>Alt + 点击</kbd></td>
                  </tr>
                  <tr>
                    <td>矩形选区工具</td>
                    <td><kbd>M</kbd> 或 <kbd>S</kbd></td>
                  </tr>
                  <tr>
                    <td>交换前景色与背景色</td>
                    <td><kbd>X</kbd></td>
                  </tr>

                  <tr>
                    <td rowspan="6" class="cat-cell">⬚ 选区与变换</td>
                    <td>取消选区</td>
                    <td><kbd>Esc</kbd> 或 <kbd>Ctrl + D</kbd></td>
                  </tr>
                  <tr>
                    <td>全选画布 (64×64)</td>
                    <td><kbd>Ctrl + A</kbd></td>
                  </tr>
                  <tr>
                    <td>清空选区为透明</td>
                    <td><kbd>Delete</kbd> 或 <kbd>Backspace</kbd></td>
                  </tr>
                  <tr>
                    <td>选区水平翻转</td>
                    <td><kbd>Shift + H</kbd></td>
                  </tr>
                  <tr>
                    <td>选区垂直翻转</td>
                    <td><kbd>Shift + V</kbd></td>
                  </tr>
                  <tr>
                    <td>选区顺时针旋转 90°</td>
                    <td><kbd>Shift + T</kbd></td>
                  </tr>

                  <tr>
                    <td rowspan="5" class="cat-cell">🛠️ 视图与历史</td>
                    <td>撤销 (Undo)</td>
                    <td><kbd>Ctrl + Z</kbd></td>
                  </tr>
                  <tr>
                    <td>重做 (Redo)</td>
                    <td><kbd>Ctrl + Y</kbd> 或 <kbd>Ctrl + Shift + Z</kbd></td>
                  </tr>
                  <tr>
                    <td>全发色高亮探针</td>
                    <td><kbd>F</kbd> (按住预览 / 短按锁定)</td>
                  </tr>
                  <tr>
                    <td>切换像素网格</td>
                    <td><kbd>G</kbd></td>
                  </tr>
                  <tr>
                    <td>开启 / 隐藏原寸实时预览</td>
                    <td><kbd>V</kbd></td>
                  </tr>

                  <tr>
                    <td rowspan="2" class="cat-cell">🎭 遮罩辅助</td>
                    <td>调整遮罩画笔尺寸 (1~10px)</td>
                    <td><kbd>[</kbd> / <kbd>]</kbd></td>
                  </tr>
                  <tr>
                    <td>切换遮罩分区</td>
                    <td>数字键 <kbd>0</kbd> ~ <kbd>4</kbd> (0背景 1头发 2皮肤 3眼睛 4衣服)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="help-modal-footer">
          <button class="btn btn-primary" id="btn-help-modal-close-footer">我知道了</button>
        </div>
      </div>
    `;

    this.container.appendChild(overlay);
    this.overlayEl = overlay;
  }

  private setupEvents(): void {
    if (!this.overlayEl) return;

    const close = () => this.close();
    this.overlayEl.querySelector('#help-modal-close')?.addEventListener('click', close);
    this.overlayEl.querySelector('#btn-help-modal-close-footer')?.addEventListener('click', close);

    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) close();
    });

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }, { signal: this.abortController.signal });
  }

  open(): void {
    if (this._isDisposed || !this.overlayEl) return;
    this.isOpen = true;
    this.overlayEl.style.display = 'flex';
  }

  close(): void {
    if (!this.isOpen || !this.overlayEl) return;
    this.isOpen = false;
    this.overlayEl.style.display = 'none';
  }

  getIsOpen(): boolean {
    return this.isOpen;
  }

  dispose(): void {
    this._isDisposed = true;
    this.abortController.abort();
    this.overlayEl?.remove();
    this.overlayEl = null;
  }
}
