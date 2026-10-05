import { describe, it, expect } from 'vitest';
import { CommandHandler, UNDO_LIMIT } from '../src/command/commandHandler';
import { Command, CommandContext } from '../src/command/command';
import { createEmptyDocument } from '../src/core/document';
import { createInitialSession } from '../src/core/session';

class MockCommand extends Command {
  readonly name: string;
  private changeValue: number;
  private previousValue = 0;
  executed = 0;
  undone = 0;

  constructor(name: string, changeValue: number) {
    super();
    this.name = name;
    this.changeValue = changeValue;
  }

  execute(ctx: CommandContext): boolean {
    this.previousValue = ctx.doc.pixelIndices[0];
    ctx.doc.pixelIndices[0] = this.changeValue;
    this.executed++;
    return true;
  }

  undo(ctx: CommandContext): void {
    ctx.doc.pixelIndices[0] = this.previousValue;
    this.undone++;
  }

  mergeWith(next: Command, ctx: CommandContext): boolean {
    if (next instanceof MockCommand && next.name === this.name) {
      this.changeValue = next.changeValue;
      ctx.doc.pixelIndices[0] = this.changeValue;
      return true;
    }
    return false;
  }
}

class NoopCommand extends Command {
  readonly name = 'Noop';
  execute(): boolean {
    return false; // Return false to indicate no changes
  }
  undo(): void {}
}

function createTestContext(): CommandContext {
  return {
    doc: createEmptyDocument(),
    session: createInitialSession(),
    events: {},
  };
}

describe('CommandHandler', () => {
  it('executes command, pushes to history, and supports undo/redo', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    expect(handler.canUndo()).toBe(false);
    expect(handler.canRedo()).toBe(false);

    const cmd1 = new MockCommand('cmd1', 10);
    handler.execute(cmd1);
    expect(ctx.doc.pixelIndices[0]).toBe(10);
    expect(handler.canUndo()).toBe(true);
    expect(handler.canRedo()).toBe(false);

    handler.undo();
    expect(ctx.doc.pixelIndices[0]).toBe(255); // Reset to transparent
    expect(handler.canUndo()).toBe(false);
    expect(handler.canRedo()).toBe(true);

    handler.redo();
    expect(ctx.doc.pixelIndices[0]).toBe(10);
    expect(handler.canUndo()).toBe(true);
    expect(handler.canRedo()).toBe(false);
  });

  it('drops redo branch when a new command is executed after undo', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    handler.execute(new MockCommand('cmd1', 1));
    handler.execute(new MockCommand('cmd2', 2));
    handler.undo(); // undo cmd2

    expect(handler.canRedo()).toBe(true);
    // Execute cmd3
    handler.execute(new MockCommand('cmd3', 3));
    expect(handler.canRedo()).toBe(false); // Redo branch dropped
    expect(ctx.doc.pixelIndices[0]).toBe(3);
  });

  it('does not push commands that return false in execute (no-op)', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    const success = handler.execute(new NoopCommand());
    expect(success).toBe(false);
    expect(handler.canUndo()).toBe(false);
  });

  it('merges consecutive mergeable commands', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    handler.execute(new MockCommand('mergeable', 1));
    handler.execute(new MockCommand('mergeable', 2));
    handler.execute(new MockCommand('mergeable', 3));

    expect(ctx.doc.pixelIndices[0]).toBe(3);
    // Because they merged into one, undoing once should undo the whole sequence
    handler.undo();
    expect(ctx.doc.pixelIndices[0]).toBe(255);
    expect(handler.canUndo()).toBe(false);
  });

  it('respects UNDO_LIMIT (40) by dropping oldest commands', () => {
    const ctx = createTestContext();
    const handler = new CommandHandler(ctx);

    for (let i = 0; i < 50; i++) {
      handler.execute(new MockCommand(`cmd_${i}`, i));
    }

    let undoCount = 0;
    while (handler.canUndo()) {
      handler.undo();
      undoCount++;
    }
    expect(undoCount).toBe(UNDO_LIMIT);
  });
});
