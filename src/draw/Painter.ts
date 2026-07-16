export type DrawTool =
  | 'line'
  | 'rect'
  | 'circle'
  | 'text'
  | 'image'
  | 'select-rect'
  | 'select-ellipse'
  | 'select-free'
  | 'fill'
  | 'eraser';

export type Selection =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; x: number; y: number; w: number; h: number }
  | { kind: 'free'; points: { x: number; y: number }[] };

/** 当前绘制色（填充 / 橡皮 / 描边共用），由工具栏取色控件驱动。 */
let drawColor = '#1f6feb';
/** 当前线宽（描边 / 橡皮共用）。 */
let lineWidth = 6;

export function setDrawColor(hex: string): void {
  drawColor = hex;
}
export function getDrawColor(): string {
  return drawColor;
}
export function setLineWidthGlobal(w: number): void {
  lineWidth = Math.max(1, Math.min(40, Math.round(w)));
}
export function getLineWidth(): number {
  return lineWidth;
}

/**
 * 通用画布绘制核心：在任意尺寸的 canvas 上提供
 * 线段 / 矩形 / 圆 / 文字 / 导入图片 / 旋转内容 / 选区 / 油漆桶填充 / 橡皮 能力，
 * 并维护「已提交基线」(base) 以便取消还原与预览。
 * FaceEditor 与 NetEditor 共用此逻辑。
 *
 * 选区轮廓与拖拽预览均绘制在独立的覆盖层 canvas 上（pointer-events:none），
 * 绝不写入 data canvas 像素，从而保证展开图 mergeNet / 面合并逻辑零影响。
 */
export class Painter {
  readonly canvas: HTMLCanvasElement;
  private base: HTMLCanvasElement | null = null;
  tool: DrawTool = 'line';
  private textValue = '文字';
  private drawing = false;
  private dragging = false; // 是否正在框选
  private start = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private selection: Selection | null = null;
  private dragSel: Selection | null = null; // 拖拽中的临时选区

  // 覆盖层（蚂蚁线）
  private overlay: HTMLCanvasElement | null = null;
  private animFrame = 0;

  private readonly onDown = (e: PointerEvent) => this.handleDown(e);
  private readonly onMove = (e: PointerEvent) => this.handleMove(e);
  private readonly onUp = (e: PointerEvent) => this.handleUp(e);
  private readonly onResize = () => this.layoutOverlay();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /** 开始编辑：快照当前画布作为已提交基线，建立覆盖层并绑定指针事件。 */
  begin(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.base = document.createElement('canvas');
    this.base.width = w;
    this.base.height = h;
    this.base.getContext('2d')!.drawImage(this.canvas, 0, 0);

    // 覆盖层：与 data canvas 同分辨率，叠在其上用于画蚂蚁线，不拦截事件
    const ov = document.createElement('canvas');
    ov.className = 'painter-overlay';
    ov.width = w;
    ov.height = h;
    ov.style.pointerEvents = 'none';
    this.canvas.parentElement?.appendChild(ov);
    this.overlay = ov;
    this.layoutOverlay();

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('resize', this.onResize);
    this.startAnts();
  }

  /** 结束编辑：解绑事件、停止蚂蚁线动画并移除覆盖层。 */
  end(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('resize', this.onResize);
    this.stopAnts();
    this.overlay?.remove();
    this.overlay = null;
    this.base = null;
    this.selection = null;
    this.dragSel = null;
  }

  setTool(t: DrawTool): void {
    this.tool = t;
  }

  setText(v: string): void {
    this.textValue = v || '文字';
  }

  setDrawColor(hex: string): void {
    drawColor = hex;
  }

  setLineWidth(w: number): void {
    lineWidth = Math.max(1, Math.min(40, Math.round(w)));
  }

  /** 清除当前选区（旋转/导入图片等会改动像素，需先清选区避免错位）。 */
  clearSelection(): void {
    this.selection = null;
    this.dragSel = null;
    this.dragging = false;
  }

  /** 设置视图变换：data canvas 与覆盖层同步，保证旋转/镜像下对齐。 */
  setViewTransform(css: string): void {
    this.canvas.style.transform = css;
    this.canvas.style.transformOrigin = 'center';
    if (this.overlay) {
      this.overlay.style.transform = css;
      this.overlay.style.transformOrigin = 'center';
    }
    this.layoutOverlay();
  }

  /** 在模态框挂载到 DOM 后调用，依据当前布局重排覆盖层（首帧 begin 时父级可能尚未入 DOM）。 */
  relayout(): void {
    this.layoutOverlay();
  }

  /** 将覆盖层定位/缩放到与 data canvas 的布局盒一致（不受 CSS 变换影响）。 */
  private layoutOverlay(): void {
    if (!this.overlay) return;
    this.overlay.style.left = `${this.canvas.offsetLeft}px`;
    this.overlay.style.top = `${this.canvas.offsetTop}px`;
    this.overlay.style.width = `${this.canvas.offsetWidth}px`;
    this.overlay.style.height = `${this.canvas.offsetHeight}px`;
  }

  private pos(e: PointerEvent): { x: number; y: number } {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    const transform = getComputedStyle(c).transform;
    // 画布若被施加了 CSS 变换（如展开图的旋转/镜像预览），需用逆矩阵把
    // 屏幕坐标映射回画布像素坐标，保证在变换后的视图下仍能准确绘制。
    if (transform && transform !== 'none') {
      const m = new DOMMatrix(transform).inverse();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const p = new DOMPoint(e.clientX - cx, e.clientY - cy).matrixTransform(m);
      const cssW = c.offsetWidth || rect.width;
      const cssH = c.offsetHeight || rect.height;
      return {
        x: ((p.x + cssW / 2) / cssW) * c.width,
        y: ((p.y + cssH / 2) / cssH) * c.height,
      };
    }
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  }

  // ---------------- 指针交互 ----------------

  private handleDown(e: PointerEvent): void {
    const p = this.pos(e);
    switch (this.tool) {
      case 'select-rect':
      case 'select-ellipse':
        this.dragging = true;
        this.start = p;
        this.dragSel = { kind: this.tool === 'select-rect' ? 'rect' : 'ellipse', x: p.x, y: p.y, w: 0, h: 0 };
        break;
      case 'select-free':
        this.dragging = true;
        this.dragSel = { kind: 'free', points: [p] };
        break;
      case 'fill':
        this.fill();
        break;
      case 'text':
        this.commitText(p);
        break;
      case 'image':
        break; // 由文件输入触发
      case 'eraser':
        this.drawing = true;
        this.last = p;
        this.eraseSegment(p, p);
        break;
      default: // line / rect / circle
        this.drawing = true;
        this.start = p;
        this.last = { ...p };
        break;
    }
  }

  private handleMove(e: PointerEvent): void {
    const p = this.pos(e);
    if (this.dragging && this.dragSel) {
      if (this.dragSel.kind === 'free') {
        const pts = this.dragSel.points;
        const lastP = pts[pts.length - 1];
        if (Math.hypot(p.x - lastP.x, p.y - lastP.y) >= 3) pts.push(p);
      } else {
        this.dragSel.x = Math.min(this.start.x, p.x);
        this.dragSel.y = Math.min(this.start.y, p.y);
        this.dragSel.w = Math.abs(p.x - this.start.x);
        this.dragSel.h = Math.abs(p.y - this.start.y);
      }
      return; // 预览由蚂蚁线 rAF 渲染在覆盖层
    }
    if (this.drawing) {
      if (this.tool === 'eraser') {
        this.eraseSegment(this.last, p);
        this.last = p;
      } else {
        this.last = p;
        this.preview();
      }
    }
  }

  private handleUp(_e: PointerEvent): void {
    if (this.dragging && this.dragSel) {
      const s = this.dragSel;
      const valid =
        s.kind === 'free' ? s.points.length >= 2 : s.w >= 2 || s.h >= 2;
      this.selection = valid ? s : null;
      this.dragSel = null;
      this.dragging = false;
      return;
    }
    if (this.drawing) {
      this.drawing = false;
      const bctx = this.base!.getContext('2d')!;
      this.drawShape(bctx, this.start, this.last);
      this.syncFromBase();
    }
  }

  // ---------------- 形状 / 文字 / 擦除 ----------------

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

  private styleStroke(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  private eraseSegment(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const targets: CanvasRenderingContext2D[] = [this.canvas.getContext('2d')!];
    if (this.base) targets.push(this.base.getContext('2d')!);
    for (const ctx of targets) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  private commitText(p: { x: number; y: number }): void {
    const bctx = this.base!.getContext('2d')!;
    this.drawText(bctx, p);
    const fctx = this.canvas.getContext('2d')!;
    fctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fctx.drawImage(this.base!, 0, 0);
  }

  private drawText(ctx: CanvasRenderingContext2D, p: { x: number; y: number }): void {
    ctx.fillStyle = drawColor;
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.textValue, p.x, p.y);
  }

  // ---------------- 选区 / 填充 ----------------

  private buildPath(ctx: CanvasRenderingContext2D, sel: Selection): void {
    if (sel.kind === 'rect') {
      ctx.rect(sel.x, sel.y, sel.w, sel.h);
    } else if (sel.kind === 'ellipse') {
      ctx.ellipse(sel.x + sel.w / 2, sel.y + sel.h / 2, sel.w / 2, sel.h / 2, 0, 0, Math.PI * 2);
    } else {
      const pts = sel.points;
      if (pts.length < 2) return;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    }
  }

  /** 油漆桶填充：有选区则仅填充选区内，否则填充整张画布。 */
  fill(): void {
    if (!this.base) return;
    const ctx = this.canvas.getContext('2d')!;
    ctx.save();
    ctx.fillStyle = drawColor;
    if (this.selection) {
      ctx.beginPath();
      this.buildPath(ctx, this.selection);
      ctx.clip();
    }
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    // 提交进基线
    const bctx = this.base.getContext('2d')!;
    bctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    bctx.drawImage(this.canvas, 0, 0);
    this.syncFromBase();
  }

  private syncFromBase(): void {
    if (!this.base) return;
    const fctx = this.canvas.getContext('2d')!;
    fctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fctx.drawImage(this.base, 0, 0);
  }

  // ---------------- 覆盖层蚂蚁线 ----------------

  private activeSelection(): Selection | null {
    return this.dragSel ?? this.selection;
  }

  private startAnts(): void {
    const loop = () => {
      this.renderOverlay();
      this.animFrame = requestAnimationFrame(loop);
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  private stopAnts(): void {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = 0;
  }

  private renderOverlay(): void {
    const o = this.overlay;
    if (!o) return;
    const octx = o.getContext('2d')!;
    octx.clearRect(0, 0, o.width, o.height);
    const sel = this.activeSelection();
    if (!sel) return;
    octx.save();
    octx.beginPath();
    this.buildPath(octx, sel);
    octx.setLineDash([6, 4]);
    octx.lineWidth = 2;
    const off = -(performance.now() / 50) % 10;
    octx.lineDashOffset = off;
    octx.strokeStyle = '#000';
    octx.stroke();
    octx.lineDashOffset = off + 3;
    octx.strokeStyle = '#fff';
    octx.stroke();
    octx.restore();
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
      this.clearSelection();
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
    this.clearSelection();
  }

  /** 取消：把画布还原为基线，并清除选区。 */
  restore(): void {
    if (!this.base) return;
    this.clearSelection();
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
  }
}
