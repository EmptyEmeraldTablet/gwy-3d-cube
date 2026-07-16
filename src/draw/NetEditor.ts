import { Cube, FACE_ORDER, FACE_SIZE, FaceId } from '../model/types';
import { NET_TEMPLATES, NetTemplate } from '../model/net';
import { Painter, DrawTool } from './Painter';
import { markFaceDirty } from '../scene/CubeFactory';

interface OpenOptions {
  onMerge: (cube: Cube) => void;
  onCancel: () => void;
}

/**
 * 平面展开编辑器：将选中立方体的 6 个面按所选模板平铺到一张大画布上，
 * 支持与单面相同的绘制操作；点击「合并」把每张格子内容还原回对应面。
 */
export class NetEditor {
  private overlay: HTMLDivElement | null = null;
  private painter: Painter | null = null;
  private template: NetTemplate = NET_TEMPLATES[0];
  // 视图变换（仅影响展开图的显示朝向，不改变像素缓冲与合并回拼逻辑）
  private viewRot = 0; // 0 / 90 / 180 / 270
  private viewMirror = false;

  open(cube: Cube, opts: OpenOptions): void {
    this.template = NET_TEMPLATES[0];
    this.viewRot = 0;
    this.viewMirror = false;

    const overlay = document.createElement('div');
    overlay.className = 'face-editor-overlay';
    overlay.innerHTML = `
      <div class="net-editor">
        <h3>平面展开：<code>${cube.id}</code></h3>
        <div class="template-row">
          <span class="group-label">展开图</span>
          <select data-role="template"></select>
          <span class="group-label">视图</span>
          <button class="btn" data-view="rotate">旋转 90°</button>
          <button class="btn" data-view="mirror">水平镜像</button>
          <button class="btn" data-view="reset">复位</button>
        </div>
        <div class="tools">
          <span class="group-label">绘制</span>
          <button class="btn active" data-tool="line">线段</button>
          <button class="btn" data-tool="rect">矩形</button>
          <button class="btn" data-tool="circle">圆</button>
          <button class="btn" data-tool="text">文字</button>
          <button class="btn" data-tool="eraser">橡皮擦</button>
          <input type="text" class="text-input" data-role="text" value="文字" placeholder="文字内容" />
          <button class="btn" data-tool="image">导入图片</button>
          <input type="file" accept="image/*" data-role="file" />
          <span class="group-label">选区</span>
          <button class="btn" data-tool="select-rect">矩形选区</button>
          <button class="btn" data-tool="select-ellipse">椭圆选区</button>
          <button class="btn" data-tool="select-free">套索</button>
          <button class="btn" data-tool="fill">填充</button>
          <button class="btn" data-action="clear-sel">取消选区</button>
          <span class="group-label">粗细</span>
          <input type="range" min="1" max="40" value="6" class="width-slider" data-role="width" />
        </div>
        <div class="canvas-wrap"></div>
        <div class="actions">
          <button class="btn" data-action="cancel">取消</button>
          <button class="btn active" data-action="merge">合并为立方体</button>
        </div>
      </div>`;

    const select = overlay.querySelector<HTMLSelectElement>('[data-role="template"]')!;
    for (const t of NET_TEMPLATES) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      select.appendChild(o);
    }

    const netCanvas = document.createElement('canvas');
    overlay.querySelector('.canvas-wrap')!.appendChild(netCanvas);

    const painter = new Painter(netCanvas);
    this.renderNet(cube, this.template, netCanvas);
    painter.begin();
    this.painter = painter;

    select.addEventListener('change', () => {
      const tpl = NET_TEMPLATES.find((t) => t.id === select.value)!;
      this.template = tpl;
      painter.end();
      this.renderNet(cube, tpl, netCanvas);
      painter.begin();
      this.applyView(netCanvas);
    });

    // 视图变换：旋转 / 镜像 / 复位（纯显示层，不影响合并回拼）
    overlay
      .querySelector<HTMLButtonElement>('[data-view="rotate"]')!
      .addEventListener('click', () => {
        this.viewRot = (this.viewRot + 90) % 360;
        this.applyView(netCanvas);
      });
    overlay
      .querySelector<HTMLButtonElement>('[data-view="mirror"]')!
      .addEventListener('click', () => {
        this.viewMirror = !this.viewMirror;
        this.applyView(netCanvas);
      });
    overlay
      .querySelector<HTMLButtonElement>('[data-view="reset"]')!
      .addEventListener('click', () => {
        this.viewRot = 0;
        this.viewMirror = false;
        this.applyView(netCanvas);
      });
    this.applyView(netCanvas);

    overlay.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        painter.setTool(b.dataset.tool as DrawTool);
        overlay
          .querySelectorAll('[data-tool]')
          .forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
      });
    });

    overlay
      .querySelector<HTMLButtonElement>('[data-action="clear-sel"]')!
      .addEventListener('click', () => painter.clearSelection());

    const widthInput = overlay.querySelector<HTMLInputElement>('[data-role="width"]')!;
    widthInput.addEventListener('input', () => painter.setLineWidth(Number(widthInput.value)));

    const textInput = overlay.querySelector<HTMLInputElement>('[data-role="text"]')!;
    textInput.addEventListener('input', () => painter.setText(textInput.value));
    const fileInput = overlay.querySelector<HTMLInputElement>('[data-role="file"]')!;
    fileInput.addEventListener('change', () => {
      if (fileInput.files?.[0]) painter.importImage(fileInput.files[0]);
    });

    overlay.querySelector<HTMLButtonElement>('[data-action="merge"]')!.addEventListener(
      'click',
      () => {
        this.mergeNet(cube, this.template, netCanvas);
        FACE_ORDER.forEach((f) => markFaceDirty(cube, f));
        opts.onMerge(cube);
        this.close();
      }
    );
    overlay.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.addEventListener(
      'click',
      () => {
        painter.restore();
        opts.onCancel();
        this.close();
      }
    );

    document.body.appendChild(overlay);
    this.painter?.relayout(); // 模态框入 DOM 后重排覆盖层，修正首帧 0 尺寸
    this.overlay = overlay;
  }

  /**
   * 应用当前视图变换到画布的 CSS transform（仅改变显示朝向）。
   * 画布像素缓冲与 renderNet/mergeNet 的坐标完全不受影响，故绝不影响实际拼合；
   * Painter 会通过逆矩阵把指针坐标映射回画布像素，保证变换后仍能准确绘制。
   * 覆盖层（蚂蚁线）同步同一变换，确保旋转/镜像下选区与绘制坐标对齐。
   */
  private applyView(_canvas: HTMLCanvasElement): void {
    const parts: string[] = [];
    if (this.viewMirror) parts.push('scaleX(-1)');
    if (this.viewRot) parts.push(`rotate(${this.viewRot}deg)`);
    this.painter?.setViewTransform(parts.join(' '));
  }

  /** 将立方体各面按模板渲染到展开画布。 */
  private renderNet(cube: Cube, tpl: NetTemplate, canvas: HTMLCanvasElement): void {
    const S = FACE_SIZE;
    canvas.width = tpl.cols * S;
    canvas.height = tpl.rows * S;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const cell of tpl.cells) {
      ctx.save();
      ctx.translate(cell.col * S + S / 2, cell.row * S + S / 2);
      // 画布 y 轴向下，故用 -rot 抵消数学坐标系（y 向上）的朝向
      ctx.rotate((-cell.rot * Math.PI) / 180);
      ctx.translate(-S / 2, -S / 2);
      ctx.drawImage(cube.faces[cell.face].canvas, 0, 0);
      ctx.restore();
    }
  }

  /** 把展开画布中每个格子还原回对应面（按 -rot 逆向旋转）。 */
  private mergeNet(cube: Cube, tpl: NetTemplate, canvas: HTMLCanvasElement): void {
    const S = FACE_SIZE;
    for (const cell of tpl.cells) {
      const face = cube.faces[cell.face as FaceId];
      const out = document.createElement('canvas');
      out.width = S;
      out.height = S;
      const octx = out.getContext('2d')!;
      octx.clearRect(0, 0, S, S);
      octx.save();
      octx.translate(S / 2, S / 2);
      // 与展开渲染相反：用 +rot 将格子内容还原回对应面
      octx.rotate((cell.rot * Math.PI) / 180);
      octx.translate(-S / 2, -S / 2);
      octx.drawImage(canvas, cell.col * S, cell.row * S, S, S, 0, 0, S, S);
      octx.restore();
      const fctx = face.canvas.getContext('2d')!;
      fctx.clearRect(0, 0, S, S);
      fctx.drawImage(out, 0, 0);
    }
  }

  private close(): void {
    this.painter?.end();
    this.overlay?.remove();
    this.overlay = null;
    this.painter = null;
  }
}
