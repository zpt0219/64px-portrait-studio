/**
 * 浏览器 DOM、Canvas 与文件异步操作工具
 */

/**
 * 触发浏览器文件直接下载 (动态创建 a 标签并及时释放 URL)
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 将 Canvas 转为 PNG Blob (支持异步 Promise 异常捕获)
 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas 导出 Blob 失败'));
      }, 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 根据文件名或 File.type 推断图像 MIME 类型
 */
export function guessMimeType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.bmp')) return 'image/bmp';
  return 'image/png';
}

/**
 * 将二进制图片 ArrayBuffer 异步解码为 HTMLImageElement
 */
export function loadImage(buffer: ArrayBuffer, mimeType: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}
