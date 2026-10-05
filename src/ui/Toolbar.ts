export interface ToolbarActions {
  addCube: () => void;
  rotate: (dir: 'left' | 'right' | 'up' | 'down') => void;
  attachStack: () => void;
  editFace: () => void;
  removeSelected: () => void;
  openNet: () => void;
  setColor: (color: string | null) => void;
  undo: () => void;
  redo: () => void;
  save: () => void;
  load: (file: File) => void;
  screenshot: () => void;
  previewAdd?: () => void;
  previewAttach?: () => void;
  cancelPreview?: () => void;
}

/** Primary tasks stay visible; secondary object settings have one explicit entry. */
export class Toolbar {
  private readonly root = document.createElement('div');
  private readonly dependent: (HTMLButtonElement | HTMLInputElement)[] = [];
  private readonly historyButtons: HTMLButtonElement[] = [];
  private readonly selectionLabel = document.createElement('strong');
  private readonly help = document.createElement('span');
  private readonly faceCaption = document.createElement('small');
  private readonly colorInput = document.createElement('input');
  private readonly loadInput = document.createElement('input');
  private readonly settings = document.createElement('details');
  private readonly defaultHelp = '添加：放到活动组的空闲格。堆叠：紧贴当前选中面新增一个。';

  constructor(private readonly actions: ToolbarActions) {
    this.root.className = 'toolbar task-toolbar';
    const main = document.createElement('div'); main.className = 'toolbar-primary';
    const group = (name: string) => { const g = document.createElement('div'); g.className = 'task-group'; const title = document.createElement('span'); title.className = 'task-group-label'; title.textContent = name; g.append(title); main.append(g); return g; };
    const construction = group('搭建立体');
    this.taskButton('添加立方体', '放到空闲格', '在活动组件组的空闲格新增；位置不跟随选中面，也不复制已有图案。', actions.addCube, construction, false, actions.previewAdd);
    this.taskButton('贴面堆叠', '紧贴选中面', '沿选中面的外侧新增一个立方体，继承底色；相邻格已占用时不会重复添加。', actions.attachStack, construction, true, actions.previewAttach);
    const paint = group('绘制图案');
    const face = this.taskButton('编辑选中面', '', '放大编辑当前选中的一个面；完成后同步到立体及展开图。', actions.editFace, paint, true);
    this.faceCaption.textContent = '先选择一个面'; face.append(this.faceCaption);
    this.taskButton('展开选中', '六面联动编辑', '展开六个面、绘图或调整布局；也可在展开编辑器内放大编辑一个面。', actions.openNet, paint, true).classList.add('primary-action');
    const more = group('调整');
    this.settings.className = 'toolbar-settings'; const summary = document.createElement('summary'); summary.className = 'btn'; summary.textContent = '单体设置'; this.settings.append(summary);
    const body = document.createElement('div'); body.className = 'toolbar-settings-body'; this.settings.append(body); more.append(this.settings);
    const rotation = document.createElement('div'); rotation.className = 'setting-row'; rotation.append(this.text('转动选中立方体'));
    for (const [dir, name] of [['left', '↺ 左转'], ['right', '↻ 右转'], ['up', '⤴ 上翻'], ['down', '⤵ 下翻']] as const) { const b = this.button(name, () => actions.rotate(dir)); this.dependent.push(b); rotation.append(b); } body.append(rotation);
    const colorRow = document.createElement('div'); colorRow.className = 'setting-row'; colorRow.append(this.text('六面底色'));
    for (const hex of ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#212121', '#ffffff']) { const b = this.button('', () => { actions.setColor(hex); this.colorInput.value = hex; }); b.className = 'tb-swatch'; b.style.background = hex; b.title = `底色 ${hex}`; b.setAttribute('aria-label', `底色 ${hex}`); this.dependent.push(b); colorRow.append(b); }
    this.colorInput.type = 'color'; this.colorInput.className = 'tb-color'; this.colorInput.setAttribute('aria-label', '自定义面底色'); this.colorInput.onchange = () => actions.setColor(this.colorInput.value);
    const clear = this.button('清除色', () => actions.setColor(null)); colorRow.append(this.colorInput, clear); this.dependent.push(this.colorInput, clear); body.append(colorRow);
    const note = document.createElement('p'); note.textContent = '底色不会改变笔画颜色。物体转向与相机观察方向分别控制。'; body.append(note);
    const remove = this.button('删除选中', actions.removeSelected); remove.classList.add('danger-action'); this.dependent.push(remove); body.append(remove);
    this.settings.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.settings.open = false; summary.focus(); } });
    document.addEventListener('pointerdown', e => { if (!this.settings.contains(e.target as Node)) this.settings.open = false; });
    const history = group('历史');
    for (const [name, fn] of [['↶ 撤销', actions.undo], ['↷ 重做', actions.redo]] as const) { const b = this.button(name, fn); history.append(b); this.historyButtons.push(b); }
    const project = group('作品'); project.append(this.button('保存', actions.save), this.button('读取', () => this.loadInput.click()));
    const exportMenu = document.createElement('details'); exportMenu.className = 'toolbar-settings'; const exportTitle = document.createElement('summary'); exportTitle.className = 'btn'; exportTitle.textContent = '导出'; exportMenu.append(exportTitle);
    const exportBody = document.createElement('div'); exportBody.className = 'toolbar-settings-body'; exportBody.append(this.button('导出当前视图', () => { exportMenu.open = false; actions.screenshot(); })); exportMenu.append(exportBody); project.append(exportMenu);
    exportMenu.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); exportMenu.open = false; exportTitle.focus(); } });
    document.addEventListener('pointerdown', e => { if (!exportMenu.contains(e.target as Node)) exportMenu.open = false; });
    this.loadInput.type = 'file'; this.loadInput.accept = '.json,application/json'; this.loadInput.hidden = true; this.loadInput.onchange = () => { const f = this.loadInput.files?.[0]; if (f) actions.load(f); this.loadInput.value = ''; };
    const context = document.createElement('div'); context.className = 'toolbar-context'; this.help.id = 'construction-help'; this.help.textContent = this.defaultHelp; context.append(this.selectionLabel, this.help);
    this.root.append(main, context, this.loadInput); document.body.append(this.root); this.setHasSelection(false); this.setHistory(false, false);
  }
  private text(value: string): HTMLElement { const s = document.createElement('span'); s.className = 'setting-label'; s.textContent = value; return s; }
  private button(name: string, action: () => void): HTMLButtonElement { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = name; b.onclick = action; return b; }
  private taskButton(name: string, caption: string, description: string, action: () => void, parent: HTMLElement, dependent = false, preview?: () => void): HTMLButtonElement {
    const b = this.button('', action); b.classList.add('task-button'); b.setAttribute('aria-label', name); b.setAttribute('aria-describedby', 'construction-help'); b.title = description;
    const title = document.createElement('span'); title.textContent = name; b.append(title); if (caption) { const small = document.createElement('small'); small.textContent = caption; b.append(small); }
    const enter = () => { this.help.textContent = description; preview?.(); };
    const leave = () => { this.help.textContent = this.defaultHelp; this.actions.cancelPreview?.(); };
    b.addEventListener('pointerenter', enter); b.addEventListener('pointerleave', leave); b.addEventListener('focus', enter); b.addEventListener('blur', leave);
    if (dependent) this.dependent.push(b); parent.append(b); return b;
  }
  setHasSelection(has: boolean): void { for (const b of this.dependent) b.disabled = !has; if (!has) { this.selectionLabel.textContent = '未选中 · 点击立方体的一个面'; this.faceCaption.textContent = '先选择一个面'; this.settings.open = false; } }
  setSelection(cubeId: string, faceLabel: string): void { this.setHasSelection(true); this.selectionLabel.textContent = `${cubeId} · 面 ${faceLabel}`; this.faceCaption.textContent = `只编辑面 ${faceLabel}`; }
  setHistory(undo: boolean, redo: boolean): void { this.historyButtons[0].disabled = !undo; this.historyButtons[1].disabled = !redo; }
  setColorValue(color?: string): void { this.colorInput.value = color ?? '#f2f4f9'; }
  addCube(): void { this.actions.addCube(); }
}
