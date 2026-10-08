import { createTestViewModel } from './helpers/viewModelFixture';
import { describe, it, expect, vi } from 'vitest';
import { importAnyFile, UnsupportedFileError } from '../src/app/browser/projectImportExport';
import * as imageDecode from '../src/app/browser/imageDecode';
import { SemanticZone } from '../src/core/types';
import JSZip from 'jszip';
import { documentToProjectData } from '../src/core/projectData';
import { createEmptyDocument } from './helpers/documentFixture';

describe('projectImportExport.importAnyFile & Mode Cancellation Atomicity', () => {
  describe('importAnyFile routing & format validation', () => {
    it('throws UnsupportedFileError for non-zip and non-image files', async () => {
      const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
      await expect(importAnyFile(textFile)).rejects.toThrow(UnsupportedFileError);
    });

    it('routes zip files to importProjectZip', async () => {
      const zip = new JSZip();
      const projectData = documentToProjectData(createEmptyDocument());
      zip.file('imagegem_project.json', JSON.stringify(projectData));
      const blob = await zip.generateAsync({ type: 'blob' });
      const zipFile = new File([blob], 'avatar.zip', { type: 'application/zip' });

      const result = await importAnyFile(zipFile);
      expect(result.kind).toBe('project');
      if (result.kind === 'project') {
        expect(result.data.v).toBe(projectData.v);
      }
    });

    it('routes image files to decodeImageFile', async () => {
      const pngFile = new File(['fakepng'], 'portrait.png', { type: 'image/png' });
      const fakeImage = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) } as any;
      const spy = vi.spyOn(imageDecode, 'decodeImageFile').mockResolvedValue(fakeImage);

      const result = await importAnyFile(pngFile);
      expect(result).toEqual({ kind: 'image', image: fakeImage });
      expect(spy).toHaveBeenCalledWith(pngFile);
      spy.mockRestore();
    });

    it('throws error when decodeImageFile returns null', async () => {
      const corruptedPng = new File(['bad'], 'corrupted.png', { type: 'image/png' });
      const spy = vi.spyOn(imageDecode, 'decodeImageFile').mockResolvedValue(null);

      await expect(importAnyFile(corruptedPng)).rejects.toThrow('无法读取有效图片尺寸，请重试');
      spy.mockRestore();
    });
  });

  describe('Mode transition on hiding last mask zone (T08)', () => {
    it('switches mode to pixel and hides masks atomically when unchecking last visible mask zone', () => {
      const vm = createTestViewModel();
      vm.patchSession({ isLoaded: true, activeMode: 'mask', visibleMaskZones: [SemanticZone.Hair], showMaskOverlay: true });

      vm.toggleZoneVisibility(SemanticZone.Hair, false);

      expect(vm.session.activeMode).toBe('pixel');
      expect(vm.session.visibleMaskZones).toEqual([]);
      expect(vm.session.showMaskOverlay).toBe(false);
    });

    it('stays in mask mode with overlay enabled when other visible mask zones remain', () => {
      const vm = createTestViewModel();
      vm.patchSession({
        isLoaded: true,
        activeMode: 'mask',
        visibleMaskZones: [SemanticZone.Hair, SemanticZone.Skin],
        showMaskOverlay: true,
      });

      vm.toggleZoneVisibility(SemanticZone.Hair, false);

      expect(vm.session.activeMode).toBe('mask');
      expect(vm.session.visibleMaskZones).toEqual([SemanticZone.Skin]);
      expect(vm.session.showMaskOverlay).toBe(true);
    });
  });
});
