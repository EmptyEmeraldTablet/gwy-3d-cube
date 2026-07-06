export interface Command {
  undo(): void;
  redo(): void;
  /** 可选：当该命令因历史栈裁剪/清空而被丢弃时调用，用于释放其持有的重资源（如 GPU 资源、canvas 副本）。 */
  dispose?(): void;
}

/** 同步复制一个 canvas 的像素内容。 */
export function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

/** 把 src 的内容还原到 dst。 */
export function restoreCanvas(dst: HTMLCanvasElement, src: HTMLCanvasElement): void {
  const ctx = dst.getContext('2d')!;
  ctx.clearRect(0, 0, dst.width, dst.height);
  ctx.drawImage(src, 0, 0);
}

/** 历史栈上限：超过后丢弃最旧命令并释放其资源，防止内存无限增长。 */
const MAX_HISTORY = 100;

/**
 * 撤销/重做管理器（命令模式）。
 * 每次操作执行后 push 一个 Command；undo/redo 在两条栈之间搬运。
 * 栈有上限，超出时丢弃最旧命令并调用其 dispose() 释放资源。
 */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly onChange?: () => void;

  constructor(onChange?: () => void) {
    this.onChange = onChange;
  }

  push(cmd: Command): void {
    this.undoStack.push(cmd);
    // 新操作清空 redo 栈，其持有的资源不再可用，需释放
    for (const c of this.redoStack) c.dispose?.();
    this.redoStack = [];
    this.trim();
    this.onChange?.();
  }

  /** 裁剪 undoStack 超出上限的旧命令并释放资源。 */
  private trim(): void {
    while (this.undoStack.length > MAX_HISTORY) {
      const old = this.undoStack.shift()!;
      old.dispose?.();
    }
  }

  undo(): void {
    const c = this.undoStack.pop();
    if (!c) return;
    c.undo();
    this.redoStack.push(c);
    this.onChange?.();
  }

  redo(): void {
    const c = this.redoStack.pop();
    if (!c) return;
    c.redo();
    this.undoStack.push(c);
    this.onChange?.();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    for (const c of this.undoStack) c.dispose?.();
    for (const c of this.redoStack) c.dispose?.();
    this.undoStack = [];
    this.redoStack = [];
    this.onChange?.();
  }
}
