import { copyCanvas, restoreCanvas } from '../core/History';

export type DrawTool = 'inspect' | 'line' | 'rect' | 'circle' | 'text' | 'image' | 'select-rect' | 'select-ellipse' | 'select-free' | 'fill' | 'eraser';
export type Selection = { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'ellipse'; x: number; y: number; w: number; h: number } | { kind: 'free'; points: Point[] };
interface Point { x: number; y: number; }
export interface PainterOptions {
  changed?: () => void;
  pick?: (point: Point) => void;
  hover?: (point: Point | null) => void;
  validPoint?: (point: Point) => boolean;
  mask?: (ctx: CanvasRenderingContext2D) => void;
  decorate?: (ctx: CanvasRenderingContext2D) => void;
  error?: (message: string) => void;
}
let drawColor = '#1f6feb';
let lineWidth = 6;
export function setDrawColor(value: string): void { drawColor = value; }
export function getDrawColor(): string { return drawColor; }
export function setLineWidthGlobal(value: number): void { lineWidth = Math.max(1, Math.min(40, Math.round(value))); }
export function getLineWidth(): number { return lineWidth; }

export class Painter {
  tool: DrawTool = 'line';
  private base: HTMLCanvasElement | null = null;
  private original: HTMLCanvasElement | null = null;
  private stroke: HTMLCanvasElement | null = null;
  private overlay: HTMLCanvasElement | null = null;
  private selection: Selection | null = null;
  private dragSelection: Selection | null = null;
  private pointer: number | null = null;
  private start: Point = { x: 0, y: 0 };
  private last: Point = { x: 0, y: 0 };
  private text = '文字';
  private frame = 0;
  private generation = 0;
  private resize: ResizeObserver | null = null;
  private readonly down = (e: PointerEvent) => this.onDown(e);
  private readonly move = (e: PointerEvent) => this.onMove(e);
  private readonly up = (e: PointerEvent) => this.onUp(e);
  private readonly cancel = () => this.cancelStroke();
  private readonly leave = () => this.options.hover?.(null);

  constructor(readonly canvas: HTMLCanvasElement, private readonly options: PainterOptions = {}) {}

  begin(): void {
    this.end();
    this.original = copyCanvas(this.canvas);
    this.base = copyCanvas(this.canvas);
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'painter-overlay';
    this.canvas.parentElement?.append(this.overlay);
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.cancel);
    this.canvas.addEventListener('lostpointercapture', this.cancel);
    this.canvas.addEventListener('pointerleave', this.leave);
    window.addEventListener('blur', this.cancel);
    this.resize = new ResizeObserver(() => this.relayout());
    this.resize.observe(this.canvas);
    this.relayout();
  }

  end(): void {
    this.cancelStroke();
    this.generation++;
    cancelAnimationFrame(this.frame); this.frame = 0;
    this.resize?.disconnect(); this.resize = null;
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    this.canvas.removeEventListener('lostpointercapture', this.cancel);
    this.canvas.removeEventListener('pointerleave', this.leave);
    window.removeEventListener('blur', this.cancel);
    this.overlay?.remove(); this.overlay = null;
    this.base = this.original = this.stroke = null;
    this.selection = this.dragSelection = null;
  }

  reload(): void {
    this.cancelStroke();
    this.generation++;
    this.base = copyCanvas(this.canvas);
    this.clearSelection();
    this.relayout();
  }
  setTool(tool: DrawTool): void { this.cancelStroke(); this.tool = tool; this.canvas.style.cursor = tool === 'inspect' ? 'pointer' : 'crosshair'; }
  setText(text: string): void { this.text = text || '文字'; }
  setDrawColor(value: string): void { setDrawColor(value); }
  setLineWidth(value: number): void { setLineWidthGlobal(value); }
  clearSelection(): void { this.selection = this.dragSelection = null; this.requestOverlay(); }
  setViewTransform(css: string): void {
    this.canvas.style.transform = css;
    if (this.overlay) this.overlay.style.transform = css;
    this.relayout();
  }
  relayout(): void {
    if (!this.overlay) return;
    const c = this.canvas, o = this.overlay;
    if (o.width !== c.width) o.width = c.width;
    if (o.height !== c.height) o.height = c.height;
    Object.assign(o.style, { left: `${c.offsetLeft}px`, top: `${c.offsetTop}px`, width: `${c.offsetWidth}px`, height: `${c.offsetHeight}px`, transform: c.style.transform, transformOrigin: 'center' });
    this.requestOverlay();
  }

  point(e: PointerEvent): Point {
    const c = this.canvas, rect = c.getBoundingClientRect(), transform = getComputedStyle(c).transform;
    const inverse = new DOMMatrix(transform === 'none' ? undefined : transform).inverse();
    const point = new DOMPoint(e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2).matrixTransform(inverse);
    return { x: (point.x / c.offsetWidth + .5) * c.width, y: (point.y / c.offsetHeight + .5) * c.height };
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 || this.pointer !== null || !this.base) return;
    const p = this.point(e);
    if (this.options.validPoint && !this.options.validPoint(p)) return;
    e.preventDefault(); this.canvas.focus(); this.options.pick?.(p);
    if (this.tool === 'inspect' || this.tool === 'image') return;
    if (this.tool === 'fill') { this.fill(); return; }
    if (this.tool === 'text') {
      this.paint(this.base.getContext('2d')!, ctx => { ctx.fillStyle = drawColor; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(this.text, p.x, p.y); });
      this.commit(); return;
    }
    this.pointer = e.pointerId; this.start = this.last = p; this.stroke = copyCanvas(this.canvas);
    this.canvas.setPointerCapture(e.pointerId);
    if (this.tool === 'select-free') this.dragSelection = { kind: 'free', points: [p] };
    else if (this.tool.startsWith('select-')) this.dragSelection = { kind: this.tool === 'select-rect' ? 'rect' : 'ellipse', x: p.x, y: p.y, w: 0, h: 0 };
    else if (this.tool === 'eraser') this.erase(p, p);
    this.requestOverlay();
  }

  private onMove(e: PointerEvent): void {
    const p = this.point(e); this.options.hover?.(p);
    if (this.pointer !== e.pointerId) return;
    if (this.dragSelection) {
      const s = this.dragSelection;
      if (s.kind === 'free') { if (Math.hypot(p.x - this.last.x, p.y - this.last.y) >= 2) s.points.push(p); }
      else Object.assign(s, { x: Math.min(p.x, this.start.x), y: Math.min(p.y, this.start.y), w: Math.abs(p.x - this.start.x), h: Math.abs(p.y - this.start.y) });
      this.requestOverlay();
    } else if (this.tool === 'eraser') this.erase(this.last, p);
    else { restoreCanvas(this.canvas, this.base!); this.shape(this.canvas.getContext('2d')!, this.start, p); }
    this.last = p;
  }

  private onUp(e: PointerEvent): void {
    if (this.pointer !== e.pointerId) return;
    this.onMove(e);
    this.pointer = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.dragSelection) {
      const s = this.dragSelection;
      this.selection = s.kind === 'free' ? (s.points.length >= 3 ? s : null) : (s.w >= 2 && s.h >= 2 ? s : null);
      this.dragSelection = null; this.requestOverlay();
    } else {
      if (this.tool !== 'eraser') this.shape(this.base!.getContext('2d')!, this.start, this.last);
      this.commit();
    }
    this.stroke = null;
  }

  cancelStroke(): void {
    if (this.pointer === null) return;
    const id = this.pointer; this.pointer = null;
    if (this.stroke && this.base) { restoreCanvas(this.canvas, this.stroke); restoreCanvas(this.base, this.stroke); }
    if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.stroke = null; this.dragSelection = null; this.requestOverlay();
  }

  private selectionPath(ctx: CanvasRenderingContext2D, s: Selection): void {
    if (s.kind === 'rect') ctx.rect(s.x, s.y, s.w, s.h);
    else if (s.kind === 'ellipse') ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
    else { s.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); }
  }
  private paint(ctx: CanvasRenderingContext2D, draw: (ctx: CanvasRenderingContext2D) => void): void {
    ctx.save();
    if (this.options.mask) { ctx.beginPath(); this.options.mask(ctx); ctx.clip(); }
    if (this.selection) { ctx.beginPath(); this.selectionPath(ctx, this.selection); ctx.clip(); }
    draw(ctx); ctx.restore();
  }
  private shape(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
    this.paint(ctx, ctx => {
      ctx.strokeStyle = drawColor; ctx.lineWidth = lineWidth; ctx.lineCap = ctx.lineJoin = 'round'; ctx.beginPath();
      if (this.tool === 'line') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      else if (this.tool === 'rect') ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      else if (this.tool === 'circle') ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
  private erase(a: Point, b: Point): void {
    this.paint(this.base!.getContext('2d')!, ctx => { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = lineWidth; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
    restoreCanvas(this.canvas, this.base!);
  }
  private commit(): void { if (this.base) restoreCanvas(this.canvas, this.base); this.options.changed?.(); }
  fill(): void {
    if (!this.base) return;
    this.paint(this.base.getContext('2d')!, ctx => { ctx.fillStyle = drawColor; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); });
    this.commit();
  }
  rotateContent(degrees: number): void {
    if (!this.base) return;
    const source = copyCanvas(this.base), ctx = this.base.getContext('2d')!;
    ctx.clearRect(0, 0, source.width, source.height); ctx.save(); ctx.translate(source.width / 2, source.height / 2); ctx.rotate(degrees * Math.PI / 180); ctx.drawImage(source, -source.width / 2, -source.height / 2); ctx.restore();
    this.clearSelection(); this.commit();
  }
  async importImage(file: File): Promise<void> {
    const token = this.generation;
    if (!this.base || !file) return;
    try {
      const image = await createImageBitmap(file);
      if (token !== this.generation || !this.base) { image.close(); return; }
      const scale = Math.min(this.canvas.width / image.width, this.canvas.height / image.height);
      this.paint(this.base.getContext('2d')!, ctx => ctx.drawImage(image, (this.canvas.width - image.width * scale) / 2, (this.canvas.height - image.height * scale) / 2, image.width * scale, image.height * scale));
      image.close(); this.commit();
    } catch { if (token === this.generation) this.options.error?.('图片无法读取，请选择有效的图片文件。'); }
  }
  restore(): void { if (this.original) { restoreCanvas(this.canvas, this.original); this.reload(); } }

  requestOverlay(): void {
    if (!this.overlay || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.overlay) return;
      const ctx = this.overlay.getContext('2d')!; ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      this.options.decorate?.(ctx);
      const s = this.dragSelection ?? this.selection;
      if (s) {
        ctx.save(); ctx.beginPath(); this.selectionPath(ctx, s); ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
        ctx.lineDashOffset = -(performance.now() / 50) % 10; ctx.strokeStyle = '#111'; ctx.stroke(); ctx.lineDashOffset += 5; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore();
        this.requestOverlay();
      }
    });
  }
}
