import { downloadBlob } from '../src/app/utils/download';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canvasToBlob, exportProjectPng, exportProjectZip, exportMaskPng } from '../src/app/browser/projectArchive';
import { ExportService, ExportPorts } from '../src/app/controllers/ExportService';
import { createValidDocument } from './helpers/documentFixture';
import { SemanticZone } from '../src/types';

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

  describe('exportProjectPng & exportMaskPng core functions', () => {
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

    it('exports composite mask PNG at specified scale', async () => {
      const doc = createValidDocument({
        pixels: (set) => {
          set(10, 10, 8, SemanticZone.Skin);
        },
      });

      const downloader = vi.fn();
      await exportMaskPng(doc, 8, downloader);

      expect(downloader).toHaveBeenCalledTimes(1);
      const [blob, filename] = downloader.mock.calls[0];
      expect(blob).toBeInstanceOf(Blob);
      expect(filename).toMatch(/^mask_composite_8x_\d+\.png$/);
    });
  });

  describe('ExportService UI orchestration & notifications', () => {
    function createMockVm(options?: { isLoaded?: boolean; hairDraftPreset?: any }) {
      const doc = createValidDocument();
      const notifications: Array<{ message: string; type: string }> = [];

      const ports: ExportPorts = {
        exportPng: exportProjectPng, exportZip: exportProjectZip, exportMaskPng,
        isLoaded: () => options?.isLoaded ?? true,
        hasHairDraft: () => (options?.hairDraftPreset ?? null) !== null,
        hairDraftName: () => '红发预设',
        confirmHairDraft: vi.fn(),
        captureDocument: () => doc,
        notify: vi.fn((message: string, type?: any) => {
          notifications.push({ message, type: type ?? 'info' });
        }),
      };

      return { vm: ports, doc, notifications };
    }

    it('does not export if document is not loaded', async () => {
      const { vm } = createMockVm({ isLoaded: false });
      const service = new ExportService(vm);

      await service.exportPng();
      await service.exportMaskPng();

      expect(vm.notify).not.toHaveBeenCalled();
    });

    it('notifies success when PNG export succeeds', async () => {
      const { vm } = createMockVm({ isLoaded: true });
      const service = new ExportService(vm);

      await service.exportPng();

      expect(vm.notify).toHaveBeenCalledWith('🎉 PNG 导出成功！', 'success');
    });

    it('notifies error when PNG export fails (catches rejected Promise)', async () => {
      const { vm } = createMockVm({ isLoaded: true });
      const service = new ExportService(vm);

      // Force canvasToBlob / exportProjectPng to fail
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => {
        throw new Error('Disk quota exceeded');
      });

      await service.exportPng();

      expect(vm.notify).toHaveBeenCalledWith(
        expect.stringContaining('PNG 导出失败: Disk quota exceeded'),
        'error'
      );
    });

    it('notifies error when Mask PNG export fails', async () => {
      const { vm } = createMockVm({ isLoaded: true });
      const service = new ExportService(vm);

      // Make canvas.toBlob fail with null
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
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
            toBlob: vi.fn((cb: BlobCallback) => cb(null)),
          } as any;
        }
        return {} as any;
      });

      await service.exportMaskPng(1);

      expect(vm.notify).toHaveBeenCalledWith(
        expect.stringContaining('PNG 导出失败: Canvas 导出 Blob 失败'),
        'error'
      );
    });

    it('prompts user if hair draft preset is active during exportPng', async () => {
      const { vm } = createMockVm({
        isLoaded: true,
        hairDraftPreset: 'preset_red',
      });
      const service = new ExportService(vm);

      (vm.confirmHairDraft as any).mockImplementation(({ onApplied }: any) => {
        onApplied();
      });

      await service.exportPng();

      expect(vm.confirmHairDraft).toHaveBeenCalledTimes(1);
      expect(vm.notify).toHaveBeenCalledWith('🎉 PNG 导出成功！', 'success');
    });

    it('aborts export if user cancels hair draft prompt', async () => {
      const { vm } = createMockVm({
        isLoaded: true,
        hairDraftPreset: 'preset_red',
      });
      const service = new ExportService(vm);

      (vm.confirmHairDraft as any).mockImplementation(({ onCancel }: any) => {
        onCancel();
      });

      await service.exportPng();

      expect(vm.confirmHairDraft).toHaveBeenCalledTimes(1);
      expect(vm.notify).not.toHaveBeenCalled();
    });
  });
});
