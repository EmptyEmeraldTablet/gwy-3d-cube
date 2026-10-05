import { Painter } from './Painter';

/** Scrollable display transform; source pixels are never resampled. */
export class CanvasViewport {
  readonly element = document.createElement('div');
  readonly controls = document.createElement('div');
  private readonly space = document.createElement('div');
  private readonly stage = document.createElement('div');
  private readonly zoomLabel = document.createElement('output');
  private readonly panButton: HTMLButtonElement;
  private readonly resize: ResizeObserver;
  private readonly events = new AbortController();
  private angle = 0;
  private scale = 1;
  private fitting = true;
  private panning = false;
  private drag: { id: number; x: number; y: number; left: number; top: number } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly painter: Painter) {
    this.element.className = 'drawing-viewport'; this.element.setAttribute('aria-label', '可缩放绘图区');
    this.space.className = 'drawing-viewport-space'; this.stage.className = 'drawing-stage';
    this.stage.append(canvas); this.space.append(this.stage); this.element.append(this.space);
    this.controls.className = 'canvas-view-controls';
    const button = (name: string, action: () => void) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = name; b.onclick = action; this.controls.append(b); return b; };
    button('缩小画板', () => this.zoom(1 / 1.25));
    this.zoomLabel.setAttribute('aria-label', '画板缩放比例'); this.controls.append(this.zoomLabel);
    button('放大画板', () => this.zoom(1.25));
    button('适应画板', () => { this.painter.cancelStroke(); this.fitting = true; this.layout(true); });
    const pan = button('拖动画板', () => this.setPanning(!this.panning)); this.panButton = pan;
    pan.setAttribute('aria-pressed', 'false'); pan.title = '开启后拖动只移动视野；关闭后继续绘图。也可使用滚动条。';
    const signal = this.events.signal;
    this.element.addEventListener('pointerdown', e => {
      if (!this.panning || e.button !== 0 || this.drag) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: this.element.scrollLeft, top: this.element.scrollTop }; this.element.setPointerCapture(e.pointerId);
    }, { capture: true, signal });
    this.element.addEventListener('pointermove', e => {
      if (this.drag?.id !== e.pointerId) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.element.scrollLeft = this.drag.left + this.drag.x - e.clientX; this.element.scrollTop = this.drag.top + this.drag.y - e.clientY;
    }, { capture: true, signal });
    const stop = () => { const id = this.drag?.id; this.drag = null; if (id !== undefined && this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id); };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.element.addEventListener(type, stop, { signal });
    window.addEventListener('blur', stop, { signal });
    this.resize = new ResizeObserver(() => this.layout()); this.resize.observe(this.element);
  }
  update(turn = 0, reset = false): void { this.painter.cancelStroke(); this.angle = turn * 90; if (reset) this.fitting = true; this.layout(true); }
  setPanning(enabled: boolean): void {
    this.painter.cancelStroke(); this.panning = enabled;
    this.panButton.setAttribute('aria-pressed', String(enabled)); this.panButton.classList.toggle('active', enabled); this.element.classList.toggle('panning', enabled);
  }
  private zoom(factor: number): void { this.painter.cancelStroke(); this.scale = Math.max(.1, Math.min(4, this.scale * factor)); this.fitting = false; this.layout(true); }
  private layout(center = false): void {
    const width = this.element.clientWidth, height = this.element.clientHeight; if (!width || !height) return;
    const odd = Math.abs(this.angle / 90) % 2, w = odd ? this.canvas.height : this.canvas.width, h = odd ? this.canvas.width : this.canvas.height;
    if (this.fitting) this.scale = Math.min(4, Math.max(.05, Math.min((width - 40) / w, (height - 40) / h)));
    const spaceW = Math.max(width, Math.ceil(w * this.scale + 40)), spaceH = Math.max(height, Math.ceil(h * this.scale + 40));
    const displayW = this.canvas.width * this.scale, displayH = this.canvas.height * this.scale;
    Object.assign(this.space.style, { width: `${spaceW}px`, height: `${spaceH}px` });
    Object.assign(this.stage.style, { width: `${displayW}px`, height: `${displayH}px`, left: `${(spaceW - displayW) / 2}px`, top: `${(spaceH - displayH) / 2}px` });
    Object.assign(this.canvas.style, { width: `${displayW}px`, height: `${displayH}px` });
    this.painter.setViewTransform(`rotate(${this.angle}deg)`); this.zoomLabel.value = `${Math.round(this.scale * 100)}%`;
    if (center || this.fitting) { this.element.scrollLeft = (spaceW - width) / 2; this.element.scrollTop = (spaceH - height) / 2; }
  }
  dispose(): void { this.resize.disconnect(); this.events.abort(); }
}
