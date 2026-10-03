import { createTestViewModel } from './helpers/viewModelFixture';
import { describe, it, expect, vi } from 'vitest';
import { ImportCoordinator, ImportCoordinatorHost, ImportLoaders } from '../src/app/controllers/ImportCoordinator';
import { SemanticZone } from '../src/types';
import { VALID_HAIR_PRESET_KEYS } from './helpers/documentFixture';

describe('ImportCoordinator & Mode Cancellation Atomicity (T08)', () => {
  describe('ImportCoordinator race-condition & cancellation defense', () => {
    it('discards delayed earlier import when newer import resolves first', async () => {
      const appliedProjects: string[] = [];
      const notifications: string[] = [];

      const host: ImportCoordinatorHost = {
        loadProject: vi.fn((data: any) => {
          appliedProjects.push(data.hairPreset);
        }),
        importImage: vi.fn(),
        notify: vi.fn((msg: string) => {
          notifications.push(msg);
        }),
      };

      let resolveA!: (data: any) => void;
      const promiseA = new Promise<any>((r) => {
        resolveA = r;
      });

      let resolveB!: (data: any) => void;
      const promiseB = new Promise<any>((r) => {
        resolveB = r;
      });

      const loaders: ImportLoaders = {
        importProjectZip: vi.fn((file: File) => {
          if (file.name === 'projectA.zip') return promiseA;
          if (file.name === 'projectB.zip') return promiseB;
          return Promise.reject(new Error('Unknown file'));
        }),
        decodeImageFile: vi.fn(),
      };

      const coordinator = new ImportCoordinator(host, loaders);

      const fileA = new File([''], 'projectA.zip');
      const fileB = new File([''], 'projectB.zip');

      // User initiates import A, then import B
      const opA = coordinator.handleFile(fileA);
      const opB = coordinator.handleFile(fileB);

      // B finishes first
      resolveB({ hairPreset: 'Project_B' });
      await opB;

      expect(appliedProjects).toEqual(['Project_B']);
      expect(notifications).toContain('🎉 成功载入工程 ZIP！已完整恢复画布、遮罩与色板');

      // Now A finishes late
      resolveA({ hairPreset: 'Project_A' });
      await opA;

      // Project_A must be discarded and NOT applied!
      expect(appliedProjects).toEqual(['Project_B']);
    });

    it('suppresses error notifications from superseded expired requests', async () => {
      const notifications: Array<{ msg: string; level?: string }> = [];

      const host: ImportCoordinatorHost = {
        loadProject: vi.fn(),
        importImage: vi.fn(),
        notify: vi.fn((msg: string, level?: any) => {
          notifications.push({ msg, level });
        }),
      };

      let rejectA!: (err: any) => void;
      const promiseA = new Promise<any>((_, rej) => {
        rejectA = rej;
      });

      const loaders: ImportLoaders = {
        importProjectZip: vi.fn(() => promiseA),
        decodeImageFile: vi.fn(),
      };

      const coordinator = new ImportCoordinator(host, loaders);

      const fileA = new File([''], 'projectA.zip');
      const opA = coordinator.handleFile(fileA);

      // User starts a new action and cancels pending imports
      coordinator.cancelPending();

      // Request A fails
      rejectA(new Error('Corrupted zip archive'));
      await opA;

      // Error must NOT be reported to user because request A was canceled/superseded
      expect(notifications).toHaveLength(0);
    });

    it('cancels pending import when cancelPending is explicitly called', async () => {
      const appliedProjects: any[] = [];
      const host: ImportCoordinatorHost = {
        loadProject: vi.fn((d) => appliedProjects.push(d)),
        importImage: vi.fn(),
        notify: vi.fn(),
      };

      let resolveZip!: (data: any) => void;
      const promise = new Promise<any>((r) => {
        resolveZip = r;
      });

      const loaders: ImportLoaders = {
        importProjectZip: vi.fn(() => promise),
        decodeImageFile: vi.fn(),
      };

      const coordinator = new ImportCoordinator(host, loaders);
      const op = coordinator.handleFile(new File([''], 'project.zip'));

      // User reset / cancel
      coordinator.cancelPending();

      resolveZip({ hairPreset: 'ShouldBeDiscarded' });
      await op;

      expect(appliedProjects).toHaveLength(0);
    });
  });

  describe('Mode cancellation atomicity on hiding last mask zone (T08)', () => {
    it('preserves full session state and mask visibility if user cancels hair draft confirmation', () => {
      const vm = createTestViewModel();
      const presetKey = VALID_HAIR_PRESET_KEYS[0];

      // Setup document with hair pixels
      vm.patchSession({ isLoaded: true });
      vm.doc.pixelIndices[5 * 64 + 5] = 1;
      vm.doc.semanticMask[5 * 64 + 5] = SemanticZone.Hair;

      // Enter mask mode and start hair draft
      vm.setMode('mask');
      vm.applyHairPreset(presetKey);

      expect(vm.session.activeMode).toBe('mask');
      expect(vm.session.hairDraftPreset).toBe(presetKey);

      // Setup mock prompt: user cancels
      let confirmCallCount = 0;
      vm.setPrompts({
        confirm: (options) => {
          confirmCallCount++;
          // Simulate user clicking cancel button or closing modal
          const cancelBtn = options.buttons.find((b) => b.label.includes('取消') || b.label.includes('继续试色'));
          cancelBtn?.onClick();
        },
      });

      // Keep only Hair visible
      vm.patchSession({ visibleMaskZones: [SemanticZone.Hair], showMaskOverlay: true });

      // Now uncheck Hair (the last visible mask)
      vm.toggleZoneVisibility(SemanticZone.Hair, false);

      // Dialog was shown
      expect(confirmCallCount).toBe(1);

      // CRITICAL ATOMICITY CHECK:
      // Because user canceled, visibleMaskZones must NOT have been wiped,
      // and activeMode must still be 'mask', hairDraftPreset must still be present!
      expect(vm.session.activeMode).toBe('mask');
      expect(vm.session.visibleMaskZones).toEqual([SemanticZone.Hair]);
      expect(vm.session.showMaskOverlay).toBe(true);
      expect(vm.session.hairDraftPreset).toBe(presetKey);
    });

    it('switches mode and hides masks atomically if user confirms hair draft', () => {
      const vm = createTestViewModel();
      const presetKey = VALID_HAIR_PRESET_KEYS[0];

      vm.patchSession({ isLoaded: true });
      vm.doc.pixelIndices[5 * 64 + 5] = 1;
      vm.doc.semanticMask[5 * 64 + 5] = SemanticZone.Hair;

      vm.setMode('mask');
      vm.applyHairPreset(presetKey);

      // User confirms application
      vm.setPrompts({
        confirm: (options) => {
          const applyBtn = options.buttons.find((b) => b.label.includes('确认') || b.label.includes('应用'));
          applyBtn?.onClick();
        },
      });

      // Only keep Hair visible
      vm.patchSession({ visibleMaskZones: [SemanticZone.Hair], showMaskOverlay: true });

      // Uncheck Hair
      vm.toggleZoneVisibility(SemanticZone.Hair, false);

      // Mode changed to pixel and masks hidden atomically
      expect(vm.session.activeMode).toBe('pixel');
      expect(vm.session.visibleMaskZones).toEqual([]);
      expect(vm.session.showMaskOverlay).toBe(false);
      expect(vm.session.hairDraftPreset).toBeNull();
    });
  });
});
