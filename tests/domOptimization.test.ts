import { describe, it, expect, vi } from 'vitest';
import { SelectionStatsPanel } from '../src/panels/canvas/SelectionStatsPanel';
import { HoverInfoBar } from '../src/panels/canvas/HoverInfoBar';
import { StrokeCommand, StrokeParams } from '../src/command/pixelCommands';
import { CommandContext } from '../src/command/command';
import { ViewModel } from '../src/app/viewModel';
import { SemanticZone } from '../src/types';
import { TRANSPARENT_INDEX } from '../src/data/palette';
import { createValidDocument } from './helpers/documentFixture';
import { createInitialSession } from '../src/model/session';

describe('DOM Refresh & Event Optimization (T10)', () => {
  describe('SelectionStatsPanel DOM Caching', () => {
    function createMockPanelElement() {
      let innerHTMLValue = '';
      const rows: any[] = [];

      const el: any = {
        style: { display: '' },
        get innerHTML() {
          return innerHTMLValue;
        },
        set innerHTML(val: string) {
          innerHTMLValue = val;
          // When HTML is set, simulate creating mock row elements if rows were generated
          rows.length = 0;
          if (val.includes('stats-color-row')) {
            // Create mock rows with data-index 0, 1, etc.
            const matches = val.matchAll(/data-index="(\d+)"/g);
            for (const match of matches) {
              const idx = parseInt(match[1], 10);
              const classListSet = new Set(['stats-color-row']);
              const rowEl = {
                getAttribute: vi.fn((attr: string) => (attr === 'data-index' ? String(idx) : null)),
                classList: {
                  toggle: vi.fn((cls: string, force?: boolean) => {
                    if (force) classListSet.add(cls);
                    else classListSet.delete(cls);
                  }),
                  contains: (cls: string) => classListSet.has(cls),
                },
              };
              rows.push(rowEl);
            }
          }
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        querySelectorAll: vi.fn((sel: string) => {
          if (sel === '.stats-color-row') return rows;
          return [];
        }),
      };
      return { el, getRows: () => rows };
    }

    it('builds HTML on initial selection, and toggles classes without rebuilding DOM when only active palette index changes', () => {
      const { el, getRows } = createMockPanelElement();
      const innerHTMLSpy = vi.spyOn(el, 'innerHTML', 'set');
      const panel = new SelectionStatsPanel(el, {
        onColorPick: vi.fn(),
        onHighlight: vi.fn(),
      });

      const doc = createValidDocument();
      // Set some pixels inside selection [0, 0, 4, 4]
      doc.pixelIndices[0] = 1;
      doc.pixelIndices[1] = 2;
      const session = createInitialSession();
      session.activePaletteIndex = 1;
      session.bgPaletteIndex = 0;

      const sel = { x: 0, y: 0, w: 4, h: 4 };

      // 1. Initial selection update
      panel.update(doc, session, sel);
      expect(innerHTMLSpy).toHaveBeenCalledTimes(1);
      expect(el.style.display).toBe('flex');
      expect(getRows().length).toBeGreaterThan(0);

      const initialRowCount = innerHTMLSpy.mock.calls.length;

      // 2. Change only activePaletteIndex (no change to pixels or selection)
      const updatedSession = { ...session, activePaletteIndex: 2 };
      panel.update(doc, updatedSession, sel);

      // DOM must NOT be rebuilt
      expect(innerHTMLSpy).toHaveBeenCalledTimes(initialRowCount);

      // Existing rows must receive class updates in-place
      const rows = getRows();
      const rowForColor2 = rows.find((r) => r.getAttribute('data-index') === '2');
      expect(rowForColor2).toBeDefined();
      expect(rowForColor2.classList.toggle).toHaveBeenCalledWith('is-active-fg', true);

      // 3. Mutating a pixel inside the selection DOES trigger a rebuild
      doc.pixelIndices[0] = 5;
      panel.update(doc, updatedSession, sel);
      expect(innerHTMLSpy).toHaveBeenCalledTimes(initialRowCount + 1);

      // 4. Clearing selection hides the panel
      panel.update(doc, updatedSession, null);
      expect(el.style.display).toBe('none');
    });
  });

  describe('HoverInfoBar Fixed DOM Structure', () => {
    function createMockBarContainer() {
      let innerHTMLValue = '';
      const children: any = {};

      const container: any = {
        style: { display: '' },
        get innerHTML() {
          return innerHTMLValue;
        },
        set innerHTML(val: string) {
          innerHTMLValue = val;
        },
        querySelector: vi.fn((sel: string) => {
          if (!children[sel]) {
            children[sel] = {
              style: {},
              textContent: '',
              innerHTML: '',
              className: '',
              removeAttribute: vi.fn(),
              setAttribute: vi.fn(),
              classList: {
                toggle: vi.fn(),
                add: vi.fn(),
                remove: vi.fn(),
              },
            };
          }
          return children[sel];
        }),
      };
      return { container, children };
    }

    it('initializes fixed DOM once and updates textContent/style without rewriting innerHTML on hover', () => {
      const { container } = createMockBarContainer();
      const innerHTMLSpy = vi.spyOn(container, 'innerHTML', 'set');

      const bar = new HoverInfoBar(container);
      expect(innerHTMLSpy).toHaveBeenCalledTimes(1); // Set exactly once during construction

      // Hover over pixel
      bar.showPixel(10, 20, 1, '#1a1a1a', false, { name: '头发', color: '#e06666' });
      expect(innerHTMLSpy).toHaveBeenCalledTimes(1); // Not rewritten!

      // Hover over another pixel
      bar.showPixel(11, 20, 2, '#2b2b2b', false, { name: '皮肤', color: '#f6b26b' });
      expect(innerHTMLSpy).toHaveBeenCalledTimes(1); // Not rewritten!

      // Moving selection state
      bar.showMoving([5, -3], true);
      expect(innerHTMLSpy).toHaveBeenCalledTimes(1); // Not rewritten!

      // Clear state
      bar.clear();
      expect(innerHTMLSpy).toHaveBeenCalledTimes(1); // Not rewritten!
    });
  });

  describe('StrokeCommand Bucket Mask Notification Minimization', () => {
    function createStrokeContext(doc = createValidDocument()) {
      const session = createInitialSession();
      const onPixelsChanged = vi.fn();
      const onMaskChanged = vi.fn();
      const events = {
        onPixelsChanged,
        onMaskChanged,
        onPaletteChanged: vi.fn(),
        onHairPresetChanged: vi.fn(),
        onSessionChanged: vi.fn(),
      };
      return {
        ctx: { doc, session, events } as unknown as CommandContext,
        onPixelsChanged,
        onMaskChanged,
      };
    }

    it('does NOT emit onMaskChanged when bucket filling opaque color to another opaque color', () => {
      const doc = createValidDocument();
      // Ensure doc has color 1 in a 4x4 region and non-background mask (Hair)
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          doc.pixelIndices[y * 64 + x] = 1;
          doc.semanticMask[y * 64 + x] = SemanticZone.Hair;
        }
      }

      const { ctx, onPixelsChanged, onMaskChanged } = createStrokeContext(doc);

      const params: StrokeParams = {
        mode: 'pixel',
        pixelTool: 'bucket',
        maskTool: 'pen',
        button: 0,
        replaceAll: false,
        fg: 2,
        bg: 0,
        zone: SemanticZone.Hair,
        lockedZones: [],
        brushSize: 1,
        selection: null,
        diagonal: false,
      };

      const cmd = new StrokeCommand(params);
      cmd.init(ctx);
      cmd.dab(ctx, 0, 0);
      cmd.end(ctx);

      expect(onPixelsChanged).toHaveBeenCalled();
      // Mask was not modified, so onMaskChanged must NOT be fired
      expect(onMaskChanged).not.toHaveBeenCalled();
      expect(doc.pixelIndices[0]).toBe(2);
      expect(doc.semanticMask[0]).toBe(SemanticZone.Hair);
    });

    it('DOES emit onMaskChanged when bucket filling with TRANSPARENT_INDEX and mask is cleared', () => {
      const doc = createValidDocument();
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          doc.pixelIndices[y * 64 + x] = 1;
          doc.semanticMask[y * 64 + x] = SemanticZone.Hair;
        }
      }

      const { ctx, onPixelsChanged, onMaskChanged } = createStrokeContext(doc);

      const params: StrokeParams = {
        mode: 'pixel',
        pixelTool: 'bucket',
        maskTool: 'pen',
        button: 0,
        replaceAll: false,
        fg: TRANSPARENT_INDEX,
        bg: 0,
        zone: SemanticZone.Hair,
        lockedZones: [],
        brushSize: 1,
        selection: null,
        diagonal: false,
      };

      const cmd = new StrokeCommand(params);
      cmd.init(ctx);
      cmd.dab(ctx, 0, 0);
      cmd.end(ctx);

      expect(onPixelsChanged).toHaveBeenCalled();
      expect(onMaskChanged).toHaveBeenCalled();
      expect(doc.pixelIndices[0]).toBe(TRANSPARENT_INDEX);
      expect(doc.semanticMask[0]).toBe(SemanticZone.Background);
    });
  });

  describe('assignColorToZone Transparent Protection', () => {
    it('rejects assigning TRANSPARENT_INDEX to non-background zones and notifies error', () => {
      const vm = new ViewModel();
      const notifySpy = vi.fn();
      vm.registerListener({ onNotify: notifySpy });

      vm.session.activeZone = SemanticZone.Hair;
      vm.assignColorToZone(TRANSPARENT_INDEX);

      expect(notifySpy).toHaveBeenCalledWith('透明像素不可划入非背景遮罩', 'error');
      // Verify mask was not modified
      expect(vm.doc.semanticMask[0]).toBe(SemanticZone.Background);
    });
  });
});
