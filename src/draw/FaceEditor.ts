import { Face } from '../model/types';
import { Painter, DrawTool } from './Painter';

interface OpenOptions {
  onCommit: (face: Face) => void;
  onCancel: () => void;
}

/**
 * 二维面编辑器：在覆盖层中展示某个 Face 的 canvas，并提供
 * 导入图片 / 线段 / 矩形 / 圆 / 文字 / 旋转 能力（绘制核心由 Painter 提供）。
 * 直接在该 face.canvas 上绘制；取消时由 Painter 还原基线。
 */
export class FaceEditor {
  private overlay: HTMLDivElement | null = null;
  private painter: Painter | null = null;

  open(face: Face, opts: OpenOptions): void {
    const overlay = document.createElement('div');
    overlay.className = 'face-editor-overlay';
    overlay.innerHTML = `
      <div class="face-editor">
        <h3>编辑面：<code>${face.id}</code></h3>
        <div class="tools">
          <span class="group-label">绘制</span>
          <button class="btn active" data-tool="line">线段</button>
          <button class="btn" data-tool="rect">矩形</button>
          <button class="btn" data-tool="circle">圆</button>
          <button class="btn" data-tool="text">文字</button>
          <button class="btn" data-tool="eraser">橡皮擦</button>
          <button class="btn" data-action="rotate">旋转 90°</button>
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
          <button class="btn active" data-action="ok">完成</button>
        </div>
      </div>`;

    const wrap = overlay.querySelector('.canvas-wrap')!;
    wrap.appendChild(face.canvas); // 直接复用 face.canvas 作为编辑画布

    const painter = new Painter(face.canvas);
    painter.begin();

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

    overlay
      .querySelector<HTMLButtonElement>('[data-action="rotate"]')!
      .addEventListener('click', () => painter.rotateContent(90));

    overlay.querySelector<HTMLButtonElement>('[data-action="ok"]')!.addEventListener(
      'click',
      () => {
        opts.onCommit(face);
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
    painter.relayout(); // 模态框入 DOM 后重排覆盖层，修正首帧 0 尺寸
    this.overlay = overlay;
    this.painter = painter;
  }

  private close(): void {
    this.painter?.end();
    this.overlay?.remove();
    this.overlay = null;
    this.painter = null;
  }
}
