import { copyCanvas, restoreCanvas } from '../core/History';

interface Snapshot<S> { state: S; pixels: HTMLCanvasElement[]; }

/** Immutable pixel snapshots are shared by layout-only operations. Budget counts unique buffers. */
export class EditSession<S> {
  readonly canvases: HTMLCanvasElement[];
  state: S;
  private entries: Snapshot<S>[] = [];
  private index = -1;
  private readonly budget = 48 * 1024 * 1024;
  constructor(sources: HTMLCanvasElement[], initial: S) {
    this.canvases = sources.map(copyCanvas);
    this.state = structuredClone(initial);
    this.checkpoint(true);
  }
  checkpoint(pixelsChanged = false): void {
    this.entries.splice(this.index + 1);
    const pixels = pixelsChanged || this.index < 0 ? this.canvases.map(copyCanvas) : this.entries[this.index].pixels;
    this.entries.push({ state: structuredClone(this.state), pixels });
    this.index++;
    const bytes = () => [...new Set(this.entries.flatMap(s => s.pixels))].reduce((n, c) => n + c.width * c.height * 4, 0);
    while (this.entries.length > 1 && (this.entries.length > 100 || bytes() > this.budget)) { this.entries.shift(); this.index--; }
  }
  undo(): boolean { if (!this.canUndo()) return false; this.restore(--this.index); return true; }
  redo(): boolean { if (!this.canRedo()) return false; this.restore(++this.index); return true; }
  canUndo(): boolean { return this.index > 0; }
  canRedo(): boolean { return this.index + 1 < this.entries.length; }
  private restore(index: number): void {
    const entry = this.entries[index];
    this.state = structuredClone(entry.state);
    this.canvases.forEach((canvas, i) => restoreCanvas(canvas, entry.pixels[i]));
  }
  dispose(): void { this.entries = []; }
}
