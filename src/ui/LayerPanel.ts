import { GridPos, Layer, Rotation } from '../model/types';

export interface LayerPanelActions {
  addLayer: () => void;
  deleteLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  /** dir = +1 上移（朝前），dir = -1 下移（朝后）。 */
  moveLayer: (id: string, dir: 1 | -1) => void;
  toggleVisible: (id: string) => void;
  setOpacity: (id: string, opacity: number, commit?: boolean) => void;
  selectLayer: (id: string) => void;
  translateLayer: (id: string, axis: keyof GridPos, delta: -1 | 1) => void;
  rotateLayer: (id: string, axis: keyof Rotation, delta: number) => void;
  // 新增：向下合并
  mergeDown: () => void;
  // 新增：旋转中心（临时可视化）
  setRotationCenter: (pos: GridPos) => void;
  pickRotationCenter: () => void;
  centerToGeometry: () => void;
  resetRotationCenter: () => void;
  // 新增：悬停预览（可选，避免对既有调用产生硬性依赖）
  previewTranslate?: (axis: keyof GridPos, delta: -1 | 1) => void;
  previewRotate?: (axis: keyof Rotation, delta: number) => void;
  cancelPreview?: () => void;
}

export interface LayerPanelState {
  /** 显示顺序：index 0 = 最前（列表顶部），last = 最后。 */
  layers: Layer[];
  activeLayerId: string;
  counts: Record<string, number>;
  /** 活动图层的旋转中心（本地网格坐标）。 */
  rotationCenter: GridPos;
  /** 活动图层在列表中的索引。 */
  activeIndex: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(
  label: string,
  onClick: () => void,
  cls = 'lp-btn',
  hover?: { onEnter?: () => void; onLeave?: () => void }
): HTMLButtonElement {
  const b = el('button', cls, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  if (hover?.onEnter) b.addEventListener('mouseenter', hover.onEnter);
  if (hover?.onLeave) b.addEventListener('mouseleave', hover.onLeave);
  return b;
}

/**
 * 右侧常驻“空间图层”管理面板（玻璃拟态）。
 * 负责：层列表（增删/重命名/重排/显隐/不透明度）、活动层整层平移旋转。
 * 所有操作通过 actions 回调到 main.ts，并由 refresh() 重绘以反映外部变化。
 */
export class LayerPanel {
  private readonly root: HTMLDivElement;
  private readonly actions: LayerPanelActions;
  private readonly getState: () => LayerPanelState;

  constructor(actions: LayerPanelActions, getState: () => LayerPanelState) {
    this.actions = actions;
    this.getState = getState;
    this.root = el('div', 'layer-panel');
    document.body.appendChild(this.root);
    this.render();
  }

  /** 外部状态变化时重绘面板。 */
  refresh(): void {
    this.render();
  }

  private render(): void {
    const state = this.getState();
    this.root.replaceChildren();

    // 头部：标题 + 新增
    const header = el('div', 'lp-header');
    header.append(el('span', 'lp-title', '组件组 / 图层'));
    header.append(btn('+ 新增图层', () => this.actions.addLayer(), 'lp-add'));
    this.root.append(header);

    // 列表
    const list = el('div', 'lp-list');
    const total = state.layers.length;
    state.layers.forEach((layer, idx) => {
      list.append(this.renderRow(layer, idx, state, total));
    });
    this.root.append(list);

    // 活动层变换控制台
    const active = state.layers.find((l) => l.id === state.activeLayerId);
    if (active) {
      const idx = state.layers.findIndex((l) => l.id === active.id);
      this.root.append(this.renderTransform(active, idx, state));
    }
  }

  private renderRow(
    layer: Layer,
    idx: number,
    state: LayerPanelState,
    total: number
  ): HTMLDivElement {
    const row = el('div', 'lp-row');
    if (layer.id === state.activeLayerId) row.classList.add('active');
    row.addEventListener('click', () => this.actions.selectLayer(layer.id));

    // 上/下移动
    const order = el('div', 'lp-order');
    order.append(
      btn('↑', () => this.actions.moveLayer(layer.id, 1), 'lp-icon'),
      btn('↓', () => this.actions.moveLayer(layer.id, -1), 'lp-icon')
    );
    (order.firstChild as HTMLButtonElement).disabled = idx === 0;
    (order.lastChild as HTMLButtonElement).disabled = idx === total - 1;
    row.append(order);

    // 名称（双击重命名）
    const name = el('div', 'lp-name', layer.name);
    name.title = '双击重命名';
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.startRename(layer, name);
    });
    row.append(name);
    const rename = btn('改名', () => this.startRename(layer, name), 'lp-icon lp-rename-button'); rename.setAttribute('aria-label', `重命名 ${layer.name}`); row.append(rename);

    const count = el('div', 'lp-count', `${state.counts[layer.id] ?? 0}`);
    row.append(count);

    // 显隐
    const vis = btn(layer.visible ? '显' : '隐', () => this.actions.toggleVisible(layer.id), 'lp-icon');
    vis.title = '显示 / 隐藏';
    row.append(vis);

    // 不透明度
    const op = el('input', 'lp-opacity') as HTMLInputElement;
    op.type = 'range';
    op.min = '0';
    op.max = '100';
    op.value = String(Math.round(layer.opacity * 100));
    op.title = '不透明度';
    op.setAttribute('aria-label', `${layer.name} 不透明度`);
    op.addEventListener('click', (e) => e.stopPropagation());
    op.addEventListener('input', () =>
      this.actions.setOpacity(layer.id, Number(op.value) / 100)
    );
    op.addEventListener('change', () =>
      this.actions.setOpacity(layer.id, Number(op.value) / 100, true)
    );
    row.append(op);

    // 删除
    const del = btn('✕', () => this.actions.deleteLayer(layer.id), 'lp-icon lp-del');
    del.title = '删除图层';
    del.disabled = total <= 1;
    row.append(del);

    return row;
  }

  private startRename(layer: Layer, nameEl: HTMLDivElement): void {
    const input = el('input', 'lp-rename') as HTMLInputElement;
    input.value = layer.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = input.value.trim() || layer.name;
      this.actions.renameLayer(layer.id, v);
      // 由 refresh 重建，无需手动还原
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') { input.removeEventListener('blur', commit); this.actions.selectLayer(layer.id); }
    });
  }

  private renderTransform(layer: Layer, idx: number, state: LayerPanelState): HTMLDivElement {
    const box = el('div', 'lp-transform');
    box.append(el('div', 'lp-transform-title', `活动层 · ${layer.name}`));

    // 平移（悬停预览目标位置）
    const tGroup = el('div', 'lp-ctl-group');
    tGroup.append(el('span', 'lp-ctl-label', '平移'));
    (['x', 'y', 'z'] as const).forEach((axis) => {
      const line = el('div', 'lp-ctl-line');
      line.append(el('span', 'lp-axis', axis.toUpperCase()));
      line.append(
        btn('−', () => this.actions.translateLayer(layer.id, axis, -1), 'lp-step', {
          onEnter: () => this.actions.previewTranslate?.(axis, -1),
          onLeave: () => this.actions.cancelPreview?.(),
        })
      );
      const val = el('span', 'lp-val', String(layer.pos[axis]));
      line.append(val);
      line.append(
        btn('+', () => this.actions.translateLayer(layer.id, axis, 1), 'lp-step', {
          onEnter: () => this.actions.previewTranslate?.(axis, 1),
          onLeave: () => this.actions.cancelPreview?.(),
        })
      );
      tGroup.append(line);
    });
    box.append(tGroup);

    // 旋转（悬停预览目标姿态）
    const rGroup = el('div', 'lp-ctl-group');
    rGroup.append(el('span', 'lp-ctl-label', '旋转'));
    (['x', 'y', 'z'] as const).forEach((axis) => {
      const line = el('div', 'lp-ctl-line');
      line.append(el('span', 'lp-axis', axis.toUpperCase()));
      line.append(
        btn('↺', () => this.actions.rotateLayer(layer.id, axis, -90), 'lp-step', {
          onEnter: () => this.actions.previewRotate?.(axis, -90),
          onLeave: () => this.actions.cancelPreview?.(),
        })
      );
      const val = el('span', 'lp-val', `${layer.rotation[axis]}°`);
      line.append(val);
      line.append(
        btn('↻', () => this.actions.rotateLayer(layer.id, axis, 90), 'lp-step', {
          onEnter: () => this.actions.previewRotate?.(axis, 90),
          onLeave: () => this.actions.cancelPreview?.(),
        })
      );
      rGroup.append(line);
    });
    box.append(rGroup);

    // 旋转中心（临时可视化标记）
    const cGroup = el('div', 'lp-ctl-group');
    cGroup.append(el('span', 'lp-ctl-label', '网格旋转枢轴（本地坐标）'));
    (['x', 'y', 'z'] as const).forEach((axis) => {
      const line = el('div', 'lp-ctl-line');
      line.append(el('span', 'lp-axis', axis.toUpperCase()));
      const input = el('input', 'lp-val-input') as HTMLInputElement;
      input.type = 'number';
      input.value = String(state.rotationCenter[axis]);
      input.title = '旋转中心在组件组内的网格坐标，随作品保存';
      input.addEventListener('change', () => {
        const v = Math.round(Number(input.value) || 0);
        const pos = { ...state.rotationCenter, [axis]: v };
        this.actions.setRotationCenter(pos);
      });
      line.append(input);
      cGroup.append(line);
    });
    const cBtns = el('div', 'lp-ctl-line');
    cBtns.append(btn('拾取立方体', () => this.actions.pickRotationCenter(), 'lp-btn lp-rc-btn'));
    cBtns.append(btn('中心吸附', () => this.actions.centerToGeometry(), 'lp-btn lp-rc-btn'));
    cBtns.append(btn('重置原点', () => this.actions.resetRotationCenter(), 'lp-btn lp-rc-btn'));
    cGroup.append(cBtns);
    box.append(cGroup);

    // 向下合并到下一图层（末层禁用）
    const merge = btn('向下合并到下一图层', () => this.actions.mergeDown(), 'lp-merge');
    const isLast = idx === state.layers.length - 1;
    merge.disabled = isLast;
    merge.title = isLast ? '已是最后一层，无法向下合并' : '将本图层立方体合并到下一图层';
    box.append(merge);

    return box;
  }
}
