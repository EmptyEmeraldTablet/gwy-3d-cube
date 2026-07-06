export type DrawTool = 'line' | 'rect' | 'circle' | 'text' | 'image';

/**
 * 通用画布绘制核心：在任意尺寸的 canvas 上提供
 * 线段 / 矩形 / 圆 / 文字 / 导入图片 / 旋转内容 能力，
 * 并维护「已提交基线」(base) 以便取消还原与预览。
 * FaceEditor 与 NetEditor 共用此逻辑。
 */
export class Painter {
  readonly canvas: HTMLCanvasElement;
  private base: HTMLCanvasElement | null = null;
  tool: DrawTool = 'line';
  private textValue = '文字';
  private drawing = false;
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };

  private readonly onDown = (e: PointerEvent) => this.handleDown(e);
  private readonly onMove = (e: PointerEvent) => this.handleMove(e);
  private readonly onUp = (e: PointerEvent) => this.handleUp(e);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /** 开始编辑：快照当前画布作为已提交基线，并绑定指针事件。 */
  begin(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.base = document.createElement('canvas');
    this.base.width = w;
    this.base.height = h;
    this.base.getContext('2d')!.drawImage(this.canvas, 0, 0);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  /** 结束编辑：解绑事件并清空基线。 */
  end(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.base = null;
  }

  setTool(t: DrawTool): void {
    this.tool = t;
  }

  setText(v: string): void {
    this.textValue = v || '文字';
  }

  private pos(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * this.canvas.height,
    };
  }

  /** face.canvas 上绘制：基线 base + 当前预览笔画。 */
  private preview(): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base!, 0, 0);
    this.drawShape(ctx, this.start, this.last);
  }

  private drawShape(
    ctx: CanvasRenderingContext2D,
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): void {
    if (this.tool === 'line') {
      this.styleStroke(ctx);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (this.tool === 'rect') {
      this.styleStroke(ctx);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    } else if (this.tool === 'circle') {
      this.styleStroke(ctx);
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      ctx.beginPath();
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private handleDown(e: PointerEvent): void {
    if (this.tool === 'text') {
      this.commitText(this.pos(e));
      return;
    }
    if (this.tool === 'image') return; // 由文件输入触发
    this.drawing = true;
    this.start = this.pos(e);
    this.last = { ...this.start };
  }

  private handleMove(e: PointerEvent): void {
    if (!this.drawing) return;
    this.last = this.pos(e);
    this.preview();
  }

  private handleUp(_e: PointerEvent): void {
    if (!this.drawing) return;
    this.drawing = false;
    // 将本笔画提交进 base，使后续笔画可叠加
    const bctx = this.base!.getContext('2d')!;
    this.drawShape(bctx, this.start, this.last);
    const fctx = this.canvas.getContext('2d')!;
    fctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fctx.drawImage(this.base!, 0, 0);
  }

  private commitText(p: { x: number; y: number }): void {
    const bctx = this.base!.getContext('2d')!;
    this.drawText(bctx, p);
    const fctx = this.canvas.getContext('2d')!;
    fctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fctx.drawImage(this.base!, 0, 0);
  }

  private drawText(ctx: CanvasRenderingContext2D, p: { x: number; y: number }): void {
    ctx.font = 'bold 40px sans-serif';
    ctx.fillStyle = '#222';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.textValue, p.x, p.y);
  }

  private styleStroke(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#1f6feb';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  /** 导入图片：铺满当前画布，并同步写回 base。 */
  importImage(file: File): void {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const fctx = this.canvas.getContext('2d')!;
      fctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
      this.base!.getContext('2d')!.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  /** 将当前画布内容整体旋转 deg 度，并同步 base。 */
  rotateContent(deg: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext('2d')!;
    tctx.translate(w / 2, h / 2);
    tctx.rotate((deg * Math.PI) / 180);
    tctx.translate(-w / 2, -h / 2);
    tctx.drawImage(this.canvas, 0, 0);

    const bctx = this.base!.getContext('2d')!;
    bctx.clearRect(0, 0, w, h);
    bctx.drawImage(tmp, 0, 0);

    const fctx = this.canvas.getContext('2d')!;
    fctx.clearRect(0, 0, w, h);
    fctx.drawImage(tmp, 0, 0);
  }

  /** 取消：把画布还原为基线。 */
  restore(): void {
    if (!this.base) return;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
  }
}
