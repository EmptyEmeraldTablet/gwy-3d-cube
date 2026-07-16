export interface ToolbarActions {
  addCube: () => void;
  rotate: (dir: 'left' | 'right' | 'up' | 'down') => void;
  attachStack: () => void;
  editFace: () => void;
  removeSelected: () => void;
  openNet: () => void;
  setColor: (color: string | null) => void;
  /** 设定当前绘制色（填充/橡皮/描边共用），由取色控件驱动。 */
  setDrawColor: (color: string) => void;
  undo: () => void;
  redo: () => void;
  save: () => void;
  load: (file: File) => void;
  screenshot: () => void;
  // 新增：贴面堆叠悬停预览（可选）
  previewAttach?: () => void;
  cancelPreview?: () => void;
}

/**
 * 顶部 DOM 工具栏，仅负责界面与事件分发。
 * 选中状态相关按钮的可用性由 setHasSelection 控制；
 * 撤销/重做按钮由 setHistory 控制。
 */
export class Toolbar {
  /** 常用颜色列表（点击直接应用为选中立方体的统一底色）。 */
  private static readonly PRESET_COLORS: readonly string[] = [
    '#e53935', // 红
    '#fb8c00', // 橙
    '#fdd835', // 黄
    '#43a047', // 绿
    '#00acc1', // 青
    '#1e88e5', // 蓝
    '#3949ab', // 靛
    '#8e24aa', // 紫
    '#d81b60', // 品红
    '#6d4c41', // 棕
    '#9e9e9e', // 灰
    '#212121', // 黑
    '#ffffff', // 白
  ];

  private readonly root: HTMLDivElement;
  private readonly dependentButtons: HTMLButtonElement[] = [];
  private readonly historyButtons: HTMLButtonElement[] = [];
  private readonly actions: ToolbarActions;
  private readonly loadInput: HTMLInputElement;
  private colorInput!: HTMLInputElement;

  constructor(actions: ToolbarActions) {
    this.actions = actions;
    this.root = document.createElement('div');
    this.root.className = 'toolbar';

    this.root.appendChild(this.group([{ label: '添加立方体', onClick: actions.addCube }]));

    this.root.appendChild(
      this.group(
        [
          { label: '↺ 左转', onClick: () => actions.rotate('left') },
          { label: '↻ 右转', onClick: () => actions.rotate('right') },
          { label: '⤴ 上翻', onClick: () => actions.rotate('up') },
          { label: '⤵ 下翻', onClick: () => actions.rotate('down') },
        ],
        '旋转(依视角)'
      )
    );

    const attach = this.button('贴面堆叠', actions.attachStack, {
      onEnter: () => actions.previewAttach?.(),
      onLeave: () => actions.cancelPreview?.(),
    });
    const edit = this.button('编辑选中面', actions.editFace);
    const remove = this.button('删除选中', actions.removeSelected);
    this.dependentButtons.push(attach, edit, remove);
    const op = document.createElement('div');
    op.className = 'group';
    op.append(attach, edit, remove);
    this.root.appendChild(op);

    // 单色（统一底色）控件：常用色板 + 自定义颜色 + 清除
    const swatches = document.createElement('div');
    swatches.className = 'tb-swatches';
    for (const hex of Toolbar.PRESET_COLORS) {
      const s = document.createElement('button');
      s.className = 'tb-swatch';
      s.style.background = hex;
      s.title = hex;
      s.addEventListener('click', () => {
        actions.setColor(hex);
        actions.setDrawColor(hex);
        this.colorInput.value = hex;
      });
      this.dependentButtons.push(s);
      swatches.appendChild(s);
    }

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'tb-color';
    colorInput.value = '#4a7dff';
    colorInput.title = '自定义颜色（统一底色，保留逐面绘制）';
    colorInput.addEventListener('input', () => {
      actions.setColor(colorInput.value);
      actions.setDrawColor(colorInput.value);
    });
    this.colorInput = colorInput;
    const clearColor = this.button('清除色', () => {
      actions.setColor(null);
    });
    this.dependentButtons.push(colorInput as unknown as HTMLButtonElement, clearColor);
    const colorGroup = document.createElement('div');
    colorGroup.className = 'group';
    const cl = document.createElement('span');
    cl.className = 'group-label';
    cl.textContent = '色彩';
    colorGroup.append(cl, swatches, colorInput, clearColor);
    this.root.appendChild(colorGroup);

    this.root.appendChild(
      this.group([{ label: '展开选中', onClick: actions.openNet }], '展开')
    );

    const undoBtn = this.button('↶ 撤销', actions.undo);
    const redoBtn = this.button('↷ 重做', actions.redo);
    this.historyButtons.push(undoBtn, redoBtn);
    const hist = document.createElement('div');
    hist.className = 'group';
    hist.append(undoBtn, redoBtn);
    this.root.appendChild(hist);

    const saveBtn = this.button('保存', actions.save);
    const loadBtn = this.button('读取', () => this.loadInput.click());
    const shotBtn = this.button('拍照', actions.screenshot);
    const fileGroup = document.createElement('div');
    fileGroup.className = 'group';
    fileGroup.append(saveBtn, loadBtn, shotBtn);
    this.root.appendChild(fileGroup);

    this.loadInput = document.createElement('input');
    this.loadInput.type = 'file';
    this.loadInput.accept = '.json,application/json';
    this.loadInput.style.display = 'none';
    this.loadInput.addEventListener('change', () => {
      const f = this.loadInput.files?.[0];
      if (f) actions.load(f);
      this.loadInput.value = '';
    });
    this.root.appendChild(this.loadInput);

    document.body.appendChild(this.root);
    this.setHasSelection(false);
    this.setHistory(false, false);
  }

  private group(
    btns: { label: string; onClick: () => void }[],
    label?: string
  ): HTMLDivElement {
    const g = document.createElement('div');
    g.className = 'group';
    if (label) {
      const l = document.createElement('span');
      l.className = 'group-label';
      l.textContent = label;
      g.appendChild(l);
    }
    for (const b of btns) g.appendChild(this.button(b.label, b.onClick));
    return g;
  }

  private button(
    label: string,
    onClick: () => void,
    hover?: { onEnter?: () => void; onLeave?: () => void }
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    if (hover?.onEnter) b.addEventListener('mouseenter', hover.onEnter);
    if (hover?.onLeave) b.addEventListener('mouseleave', hover.onLeave);
    return b;
  }

  /** 是否有已选中的立方体，控制依赖按钮可用性。 */
  setHasSelection(has: boolean): void {
    for (const b of this.dependentButtons) b.disabled = !has;
  }

  /** 撤销/重做可用性。 */
  setHistory(canUndo: boolean, canRedo: boolean): void {
    this.historyButtons[0].disabled = !canUndo;
    this.historyButtons[1].disabled = !canRedo;
  }

  /** 同步当前选中立方体的底色到颜色输入（选中变化/撤销重做时调用）。 */
  setColorValue(color?: string): void {
    if (this.colorInput) this.colorInput.value = color ?? '#4a7dff';
  }

  /** 供外部触发“添加立方体”。 */
  addCube(): void {
    this.actions.addCube();
  }
}
