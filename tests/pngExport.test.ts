import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob, canvasToBlob, exportProjectPng, exportProjectZip } from '../src/app/browser/projectImportExport';
import { createValidDocument } from './helpers/documentFixture';
import { createTestViewModel } from './helpers/viewModelFixture';
import { SemanticZone } from '../src/core/types';

describe('PNG Export & Blob Safety (T06 / B6)', () => {
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];
  let originalDocument: any;
  let originalUrl: any;

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];
    originalDocument = globalThis.document;
    originalUrl = globalThis.URL;

    const mockBody = {
      appendChild: vi.fn((child) => child),
      removeChild: vi.fn((child) => child),
    };

    const mockDocument = {
      body: mockBody,
      createElement: vi.fn((tag: string) => {
        if (tag === 'a') {
          return {
            href: '',
            download: '',
            click: vi.fn(),
          };
        }
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: vi.fn(() => ({
              createImageData: vi.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })),
              putImageData: vi.fn(),
              drawImage: vi.fn(),
              imageSmoothingEnabled: false,
            })),
            toBlob: vi.fn((cb: BlobCallback) => cb(new Blob(['mock-blob'], { type: 'image/png' }))),
          };
        }
        return {};
      }),
    };

    globalThis.document = mockDocument as any;

    const mockURL = {
      createObjectURL: vi.fn((_blob: Blob) => {
        const url = `blob:mock-url-${Math.random()}`;
        createdUrls.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url);
      }),
    };

    globalThis.URL = mockURL as any;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
    vi.restoreAllMocks();
  });

  describe('downloadBlob lifecycle & memory leak prevention', () => {
    it('creates object URL and always revokes it in finally block upon success', () => {
      const blob = new Blob(['test data'], { type: 'image/png' });
      const appendSpy = vi.spyOn(document.body, 'appendChild');
      const removeSpy = vi.spyOn(document.body, 'removeChild');

      downloadBlob(blob, 'test.png');

      expect(createdUrls).toHaveLength(1);
      expect(revokedUrls).toEqual(createdUrls);
      expect(appendSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();
    });

    it('revokes object URL even if DOM interaction throws an exception', () => {
      const blob = new Blob(['test data'], { type: 'image/png' });
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
        throw new Error('Simulated DOM failure');
      });

      expect(() => downloadBlob(blob, 'test.png')).toThrow('Simulated DOM failure');

      expect(createdUrls).toHaveLength(1);
      expect(revokedUrls).toEqual(createdUrls);
    });
  });

  describe('canvasToBlob error handling', () => {
    it('resolves with Blob when canvas.toBlob succeeds', async () => {
      const mockBlob = new Blob(['png-bytes'], { type: 'image/png' });
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      canvas.toBlob = vi.fn((callback: BlobCallback) => {
        callback(mockBlob);
      });

      const result = await canvasToBlob(canvas);
      expect(result).toBe(mockBlob);
    });

    it('rejects with descriptive Error when canvas.toBlob returns null (B6)', async () => {
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      canvas.toBlob = vi.fn((callback: BlobCallback) => {
        callback(null);
      });

      await expect(canvasToBlob(canvas)).rejects.toThrow('Canvas 导出 Blob 失败');
    });

    it('rejects when canvas.toBlob throws synchronously', async () => {
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      canvas.toBlob = vi.fn(() => {
        throw new Error('Canvas context lost');
      });

      await expect(canvasToBlob(canvas)).rejects.toThrow('Canvas context lost');
    });
  });

  describe('exportProjectPng core function', () => {
    it('exports 64x64 minimal indexed PNG and passes blob to downloader', async () => {
      const doc = createValidDocument({
        pixels: (set) => {
          set(0, 0, 5, SemanticZone.Hair);
        },
      });

      const downloader = vi.fn();
      await exportProjectPng(doc, downloader);

      expect(downloader).toHaveBeenCalledTimes(1);
      const [blob, filename] = downloader.mock.calls[0];
      expect(blob).toBeInstanceOf(Blob);
      expect(filename).toMatch(/^avatar_36color_64x64_\d+\.png$/);
    });
  });

  describe('ViewModel export orchestration & notifications', () => {
    it('does not export if document is not loaded', async () => {
      const exportPngFn = vi.fn();
      const vm = createTestViewModel({ exports: { exportPng: exportPngFn, exportZip: vi.fn() } });
      vm.patchSession({ isLoaded: false });
      const notifySpy = vi.fn();
      vm.registerListener({ onNotify: notifySpy });

      await vm.exportPng();

      expect(exportPngFn).not.toHaveBeenCalled();
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it('flushes autosave before exporting PNG to maintain persistence sync', async () => {
      const order: string[] = [];
      const fakeAutosave = {
        flush: vi.fn(() => {
          order.push('flush');
          return null;
        }),
        dispose: vi.fn(),
        cancel: vi.fn(),
        saveDebounced: vi.fn(),
        hasSaved: vi.fn(() => false),
      } as any;
      const fakeExports = {
        exportPng: vi.fn(async () => {
          order.push('export');
        }),
        exportZip: vi.fn(),
      };
      const vm = createTestViewModel({ autosave: fakeAutosave, exports: fakeExports });
      vm.patchSession({ isLoaded: true });

      await vm.exportPng();

      expect(order).toEqual(['flush', 'export']);
    });

    it('notifies success when PNG export succeeds', async () => {
      const exportPngFn = vi.fn().mockResolvedValue(undefined);
      const vm = createTestViewModel({ exports: { exportPng: exportPngFn, exportZip: vi.fn() } });
      vm.patchSession({ isLoaded: true });
      const notifySpy = vi.fn();
      vm.registerListener({ onNotify: notifySpy });

      await vm.exportPng();

      expect(notifySpy).toHaveBeenCalledWith('🎉 PNG 导出成功！', 'success');
    });

    it('notifies error when PNG export fails (catches rejected Promise)', async () => {
      const exportPngFn = vi.fn().mockRejectedValue(new Error('Disk quota exceeded'));
      const vm = createTestViewModel({ exports: { exportPng: exportPngFn, exportZip: vi.fn() } });
      vm.patchSession({ isLoaded: true });
      const notifySpy = vi.fn();
      vm.registerListener({ onNotify: notifySpy });

      await vm.exportPng();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.stringContaining('PNG 导出失败: Disk quota exceeded'),
        'error'
      );
    });

    it('flushes autosave and exports ZIP successfully', async () => {
      const exportZipFn = vi.fn().mockResolvedValue(undefined);
      const vm = createTestViewModel({ exports: { exportPng: vi.fn(), exportZip: exportZipFn } });
      vm.patchSession({ isLoaded: true });
      const notifySpy = vi.fn();
      vm.registerListener({ onNotify: notifySpy });

      await vm.exportZip();

      expect(exportZipFn).toHaveBeenCalledTimes(1);
      expect(notifySpy).toHaveBeenCalledWith('🎉 成功导出完整工程 ZIP 包！', 'success');
    });
  });
});

