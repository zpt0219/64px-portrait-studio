/**
 * 命令队列与撤销 / 重做栈 (对应 tile_map_editor_imgui 的 TileMapCommandHandler)。
 *
 * execute(cmd)：先尝试并入栈顶 → init() → execute() → 截掉重做分支 → 入栈 → 超出上限时丢弃最旧的一条。
 * 没有产生任何变化的命令不入栈。笔划这类跨多个鼠标事件的手势由调用方先 init、逐步执行，
 * 结束时用 commitExecuted() 入栈。
 */

import { Command, CommandContext } from './command';

export const UNDO_LIMIT = 40;

export class CommandHandler {
  private history: Command[] = [];
  /** 最后一条已执行命令的下标；-1 表示没有可撤销的命令 */
  private cursor = -1;
  private shouldTryMerge = true;

  constructor(private readonly ctx: CommandContext) {}

  execute(cmd: Command): boolean {
    const top = this.history[this.cursor];
    if (this.shouldTryMerge && top && top.mergeWith(cmd, this.ctx)) return true;
    if (!cmd.init(this.ctx)) return false;
    if (!cmd.execute(this.ctx)) return false;
    this.push(cmd);
    return true;
  }

  /** 手势类命令已经执行完毕 (init 与修改由调用方完成)，只负责入栈 */
  commitExecuted(cmd: Command): void {
    this.push(cmd);
  }

  undo(): boolean {
    if (this.cursor < 0) return false;
    this.history[this.cursor].undo(this.ctx);
    this.cursor--;
    this.shouldTryMerge = false;
    this.ctx.events.onHistoryChanged?.();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) return false;
    this.cursor++;
    this.history[this.cursor].redo(this.ctx);
    this.shouldTryMerge = false;
    this.ctx.events.onHistoryChanged?.();
    return true;
  }

  /** 文档被整体替换 (载入 / 重置) 后调用：旧命令的快照已无意义 */
  clearHistory(): void {
    this.history = [];
    this.cursor = -1;
    this.shouldTryMerge = false;
    this.ctx.events.onHistoryChanged?.();
  }

  canUndo(): boolean {
    return this.cursor >= 0;
  }

  canRedo(): boolean {
    return this.cursor + 1 < this.history.length;
  }

  private push(cmd: Command): void {
    this.history.length = this.cursor + 1; // 丢弃重做分支
    this.history.push(cmd);
    if (this.history.length > UNDO_LIMIT) this.history.shift();
    this.cursor = this.history.length - 1;
    this.shouldTryMerge = true;
    this.ctx.events.onHistoryChanged?.();
  }
}
