/**
 * 命令基类 (对应 tile_map_editor_imgui 的 TileMapCommand)。
 * 生命周期：init() 捕获目标与旧值 → execute() 修改文档 → 可选 undo() / redo()。
 * 所有文档修改都必须经过命令，撤销 / 重做与事件广播才能保持一致。
 */

import { RectSelection, HairPresetKey } from '../core/types';
import { PortraitDocument } from '../core/document';
import { EditorSession } from '../core/session';
import { StudioEvents } from './events';

export interface CommandContext {
  doc: PortraitDocument;
  session: EditorSession;
  events: StudioEvents;
}

export abstract class Command {
  /** 日志用名称；mergeWith 也用它判断是否同类 */
  abstract readonly name: string;

  /** 捕获目标与旧值；返回 false 表示拒绝执行 (不入撤销栈) */
  init(_ctx: CommandContext): boolean {
    return true;
  }

  /** 修改文档并广播事件；返回 false 表示没有任何变化 (不入撤销栈) */
  abstract execute(ctx: CommandContext): boolean;

  abstract undo(ctx: CommandContext): void;

  redo(ctx: CommandContext): void {
    this.execute(ctx);
  }

  /** 把紧随其后的同类命令并入自己 (例如拖动取色器)，返回 true 表示已合并 */
  mergeWith(_next: Command, _ctx: CommandContext): boolean {
    return false;
  }
}

/** 撤销快照：文档加选区 (选区随撤销一起恢复) */
interface DocumentMemento {
  pixels: Uint8Array;
  mask: Uint8Array;
  palette: string[];
  hairPreset: HairPresetKey | null;
  selection: RectSelection | null;
}

function captureMemento({ doc, session }: CommandContext): DocumentMemento {
  return {
    pixels: new Uint8Array(doc.pixelIndices),
    mask: new Uint8Array(doc.semanticMask),
    palette: [...doc.palette],
    hairPreset: doc.currentHairPreset,
    selection: session.selection ? { ...session.selection } : null,
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function paletteEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const rectEqual = (a: RectSelection | null, b: RectSelection | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** 比较两份快照，按变化的部分发出事件；返回是否有任何变化 */
function emitDiff(events: StudioEvents, a: DocumentMemento, b: DocumentMemento): boolean {
  const pixels = !bytesEqual(a.pixels, b.pixels);
  const mask = !bytesEqual(a.mask, b.mask);
  const palette = !paletteEqual(a.palette, b.palette);
  const hairPreset = a.hairPreset !== b.hairPreset;
  const selection = !rectEqual(a.selection, b.selection);
  if (pixels) events.onPixelsChanged?.();
  if (mask) events.onMaskChanged?.();
  if (palette) events.onPaletteChanged?.();
  if (hairPreset) events.onHairPresetChanged?.();
  if (selection) events.onSessionChanged?.(['selection']);
  return pixels || mask || palette || hairPreset || selection;
}

function restoreMemento(ctx: CommandContext, m: DocumentMemento): void {
  const current = captureMemento(ctx);
  ctx.doc.pixelIndices.set(m.pixels);
  ctx.doc.semanticMask.set(m.mask);
  ctx.doc.palette = [...m.palette];
  ctx.doc.currentHairPreset = m.hairPreset;
  ctx.session.selection = m.selection ? { ...m.selection } : null;
  emitDiff(ctx.events, current, m);
}

/**
 * 快照式撤销：init 拍下修改前的快照，修改后再拍一次；undo / redo 直接还原对应快照。
 * 64×64 的像素加遮罩只有 8 KB，整份快照最简单，也保证 redo 还原的是结果而不是重跑算法。
 * 子类只需实现 apply()。
 */
export abstract class SnapshotCommand extends Command {
  private before: DocumentMemento | null = null;
  private after: DocumentMemento | null = null;

  init(ctx: CommandContext): boolean {
    this.before = captureMemento(ctx);
    return true;
  }

  execute(ctx: CommandContext): boolean {
    this.apply(ctx);
    return this.finish(ctx, true);
  }

  /** 修改文档 (无需自行发事件，finish 会按快照差异统一发出) */
  protected abstract apply(ctx: CommandContext): void;

  /** 拍下修改后的快照；emit 为 true 时按差异发事件。返回是否有变化 */
  protected finish(ctx: CommandContext, emit: boolean): boolean {
    this.after = captureMemento(ctx);
    const before = this.before!;
    return emit ? emitDiff(ctx.events, before, this.after) : emitDiff({}, before, this.after);
  }

  undo(ctx: CommandContext): void {
    restoreMemento(ctx, this.before!);
  }

  redo(ctx: CommandContext): void {
    restoreMemento(ctx, this.after!);
  }
}
