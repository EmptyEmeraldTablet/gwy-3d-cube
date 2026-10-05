import * as THREE from 'three';
import { Viewer } from './scene/Viewer';
import {
  createCube,
  createCubeFromData,
  syncMeshTransform,
  setCubeColor,
  applyLayerStyle,
  markFaceDirty,
  disposeCube,
} from './scene/CubeFactory';
import { Picker } from './scene/Picker';
import { attachGridPos, attachInLayer } from './scene/Stacking';
import {
  worldTransform,
  worldToLocal,
  composeRotation,
  invertRotation,
  rotateGridPos,
  layerPointToWorld,
  rotateLayerAround,
  rotateInLayer,
  dominantAxis,
} from './scene/layerMath';
import { faceBackground } from './draw/faceAppearance';
import { Toolbar } from './ui/Toolbar';
import { LayerPanel, LayerPanelActions, LayerPanelState } from './ui/LayerPanel';
import { History, copyCanvas, restoreCanvas } from './core/History';
import { downloadScene, readSceneFile, serializeScene, validateScene, SceneExtras } from './model/serialize';
import { readAutosave, writeAutosave } from './model/autosave';
import { createViewBar } from './ui/ViewBar';
import { cloneNetPreferences } from './model/netVariants';
import { Modal } from './ui/Modal';
import {
  Cube,
  FaceId,
  FACE_ORDER,
  GridPos,
  Layer,
  Rotation,
  DEFAULT_LAYER_ID,
  createDefaultLayer,
  nextLayerId,
  syncLayerIdCounter,
  syncCubeIdCounter,
  FACE_LABELS,
} from './model/types';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const viewer = new Viewer(canvas);
let openingEditor = false;
const SIZE = viewer.getGridSize();
const status = document.createElement('div'); status.className = 'scene-status'; status.setAttribute('role', 'status'); document.body.append(status);
function notify(message: string): void { status.textContent = message; }
const saveStatus = document.createElement('span'); saveStatus.className = 'save-status'; saveStatus.setAttribute('role', 'status'); document.body.append(saveStatus);
let saveTimer = 0, saving = false, saveAgain = false;
function sceneExtras(): SceneExtras { return { view: viewer.saveView(), rotationCenters: Object.fromEntries([...rotationCenterByLayer].filter(([id]) => layerById(id)).map(([id, point]) => [id, { ...point }])) }; }
function scheduleAutosave(): void {
  clearTimeout(saveTimer); saveStatus.textContent = '等待自动保存…';
  saveTimer = window.setTimeout(() => { void autosave(); }, 900);
}
async function autosave(): Promise<void> {
  if (saving) { saveAgain = true; return; } saving = true;
  try { await writeAutosave(serializeScene(cubes, layers, activeLayerId, SIZE, sceneExtras())); saveStatus.textContent = '已自动保存到本机'; }
  catch { saveStatus.textContent = '自动保存失败，请使用“保存”下载作品'; }
  finally { saving = false; if (saveAgain) { saveAgain = false; scheduleAutosave(); } }
}
async function recoverAutosave(): Promise<void> {
  try {
    const saved = await readAutosave(); if (!saved) { notify('本机还没有自动保存的作品。'); return; }
    const modal = new Modal('face-editor', '恢复本机作品', () => modal.close());
    const message = document.createElement('p'); message.textContent = `本机作品保存于 ${new Date(saved.savedAt).toLocaleString()}，包含 ${saved.scene.cubes.length} 个单体。恢复会替换当前场景。`;
    const recover = document.createElement('button'); recover.className = 'btn'; recover.textContent = '恢复这份作品'; recover.onclick = () => { modal.close(); void loadSceneFromFile(saved.scene); };
    const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = '取消'; cancel.onclick = () => modal.close(); modal.panel.append(message, recover, cancel); modal.mount();
  } catch { notify('无法读取本机自动保存，请使用项目文件恢复。'); }
}
async function openTool(load: () => Promise<void>): Promise<void> {
  if (openingEditor || document.querySelector('[role="dialog"]')) return;
  openingEditor = true;
  try { await load(); } catch { notify('工具加载失败，请刷新后重试。'); }
  finally { openingEditor = false; }
}

const cubes: Cube[] = [];
const picker = new Picker(viewer, cubes);

// ---------- 图层状态 ----------
const layers: Layer[] = [createDefaultLayer()]; // index 0 = 最前（列表顶部）
let activeLayerId = DEFAULT_LAYER_ID;

let selected: Cube | null = null;
let selectedFace: FaceId | null = null;

// ---------- 旋转中心（临时可视化，不持久化）----------
const rotationCenterByLayer = new Map<string, GridPos>(); // 缺省 {0,0,0}
let pickingCenter = false; // 拾取模式标志

function getRotationCenter(id: string): GridPos {
  return rotationCenterByLayer.get(id) ?? { x: 0, y: 0, z: 0 };
}

/** 把 90° 倍数 Rotation 转为 THREE.Euler（预览线框用）。 */
function eulerOfRotation(r: Rotation): THREE.Euler {
  const d = THREE.MathUtils.degToRad;
  return new THREE.Euler(d(r.x), d(r.y), d(r.z));
}

/** 把活动图层的旋转中心标记同步到世界位置（本地中心经图层变换）。 */
function updateCenterMarker(): void {
  const layer = getActiveLayer();
  if (!layer) {
    viewer.setCenterMarkerVisible(false);
    return;
  }
  const center = getRotationCenter(layer.id);
  const world = layerPointToWorld(center, layer);
  viewer.setCenterMarkerWorld(
    new THREE.Vector3(world.x * SIZE, world.y * SIZE, world.z * SIZE)
  );
  viewer.setCenterMarkerVisible(true);
}

/** 设定某图层的旋转中心并记入历史（可撤销）。 */
function commitRotationCenter(layer: Layer, after: GridPos): void {
  const before = getRotationCenter(layer.id);
  rotationCenterByLayer.set(layer.id, { ...after });
  updateCenterMarker();
  layerPanel.refresh();
  history.push({
    undo: () => {
      rotationCenterByLayer.set(layer.id, { ...before });
      updateCenterMarker();
      layerPanel.refresh();
    },
    redo: () => {
      rotationCenterByLayer.set(layer.id, { ...after });
      updateCenterMarker();
      layerPanel.refresh();
    },
  });
}

let toolbar: Toolbar;
// 历史栈变更（push/undo/redo/clear）后同步按钮状态并请求重绘
const history = new History(() => {
  toolbar.setHistory(history.canUndo(), history.canRedo());
  viewer.requestRender();
  layerPanel.refresh();
  scheduleAutosave();
});

// ---------- 图层辅助 ----------
function layerById(id: string): Layer | undefined {
  return layers.find((l) => l.id === id);
}
function getActiveLayer(): Layer {
  return layerById(activeLayerId) ?? layers[0];
}
function layerVisible(id: string): boolean {
  const layer = layerById(id);
  return !!layer && layer.visible && layer.opacity > 0;
}

/** 严格隔离：仅当前活动图层中可见的立方体可被拾取。 */
function pickableCubes(): Cube[] {
  return cubes.filter((c) => c.layerId === activeLayerId && layerVisible(c.layerId));
}
function refreshPicker(): void {
  picker.setCubes(pickableCubes());
  if (selected && (!layerVisible(selected.layerId) || selected.layerId !== activeLayerId)) deselect();
}
function pickAt(x: number, y: number) { return picker.pick(viewer.toNDC(x, y), cubes.filter(c => layerVisible(c.layerId))); }
/** 切换活动图层：刷新可拾取集合并取消不属于该层的残留选中（严格隔离）。 */
function setActiveLayer(id: string): void {
  activeLayerId = id;
  refreshPicker();
  if (selected && selected.layerId !== id) deselect();
  viewer.clearPreview();
  updateCenterMarker();
}
/** 把立方体本地变换 + 所属图层变换合成为世界变换并写入 Mesh，并应用图层显隐/不透明度。 */
function syncCube(cube: Cube): void {
  const layer = layerById(cube.layerId);
  const world = layer ? worldTransform(cube, layer) : undefined;
  syncMeshTransform(cube, world);
  if (layer) applyLayerStyle(cube, layer.visible, layer.opacity);
  if (selected === cube) viewer.setFaceSelection(cube, selectedFace ?? undefined);
  viewer.requestRender();
}
/** 列表顺序用于重合表面的稳定排序，空间遮挡仍由深度决定。 */
function applyLayerOrders(): void {
  layers.forEach((layer, idx) => {
    const order = layers.length - 1 - idx;
    for (const c of cubes) if (c.layerId === layer.id) c.mesh.renderOrder = order;
  });
  viewer.requestRender();
}
function syncLayer(layer: Layer): void {
  for (const c of cubes) if (c.layerId === layer.id) syncCube(c);
  applyLayerOrders();
  updateCenterMarker();
}

// ---------- 场景增删辅助 ----------
function register(cube: Cube): void {
  if (occupied(cube.gridPos, cube.layerId)) throw new Error('这个位置已有单体');
  cubes.push(cube);
  viewer.scene.add(cube.mesh);
  syncCube(cube);
  applyLayerOrders();
  refreshPicker();
  viewer.requestRender();
  layerPanel.refresh();
}
function unregister(cube: Cube): void {
  viewer.scene.remove(cube.mesh);
  const i = cubes.indexOf(cube);
  if (i >= 0) cubes.splice(i, 1);
  refreshPicker();
  if (selected === cube) deselect();
  viewer.requestRender();
}

// ---------- 选择 / 拾取（区分点击与拖拽）----------
let downX = 0;
let downY = 0;
canvas.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  // 拾取旋转中心模式：点击立方体即以其本地坐标设为中心，不触选拔
  if (pickingCenter) {
    if (moved > 5) return; // 拖拽保持模式，不取消
    pickingCenter = false;
    canvas.style.cursor = '';
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) commitRotationCenter(getActiveLayer(), { ...hit.cube.gridPos });
    return;
  }
  if (moved > 5) return; // 视为轨道拖拽，不拾取
  const hit = pickAt(e.clientX, e.clientY);
  if (!hit) {
    deselect();
    return;
  }
  select(hit.cube, hit.faceId);
});

function select(cube: Cube, face: FaceId): void {
  selected = cube;
  selectedFace = face;
  viewer.setFaceSelection(cube, face);
  toolbar.setSelection(cube.id, FACE_LABELS[face]);
  toolbar.setColorValue(cube.color);
  notify(`选中 ${cube.id} · 面 ${FACE_LABELS[face]} · 仅编辑活动组件组`);
  viewer.requestRender();
}

function deselect(): void {
  viewer.setFaceSelection(null);
  selected = null;
  selectedFace = null;
  toolbar.setHasSelection(false);
  viewer.requestRender();
}

function freeGridPos(): GridPos {
  const used = new Set(cubes.filter(c => c.layerId === activeLayerId).map((c) => `${c.gridPos.x},${c.gridPos.y},${c.gridPos.z}`));
  if (!used.has('0,0,0')) return { x: 0, y: 0, z: 0 };
  for (let x = 1; ; x++) {
    if (!used.has(`${x},0,0`)) return { x, y: 0, z: 0 };
  }
}

function occupied(pos: GridPos, layerId: string): boolean {
  return cubes.some(c => c.layerId === layerId && c.gridPos.x === pos.x && c.gridPos.y === pos.y && c.gridPos.z === pos.z);
}
const opacityStarts = new Map<string, number>();
function holdCubes(items: Cube[]) { return items.map(cube => ({ key: cube, release: () => { if (!cube.mesh.parent) disposeCube(cube); } })); }

// ---------- 图层管理动作 ----------
const layerActions: LayerPanelActions = {
  addLayer: () => {
    if (layers.length >= 100) { notify('最多支持 100 个组件组。'); return; }
    const layer: Layer = {
      id: nextLayerId(),
      name: `图层 ${layers.length + 1}`,
      pos: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      visible: true,
      opacity: 1,
    };
    layers.unshift(layer);
    setActiveLayer(layer.id);
    applyLayerOrders();
    layerPanel.refresh();
    history.push({
      undo: () => {
        const i = layers.findIndex((l) => l.id === layer.id);
        if (i >= 0) layers.splice(i, 1);
        if (activeLayerId === layer.id) setActiveLayer(layers[0]?.id ?? '');
        applyLayerOrders();
        layerPanel.refresh();
      },
      redo: () => {
        layers.unshift(layer);
        setActiveLayer(layer.id);
        applyLayerOrders();
        layerPanel.refresh();
      },
    });
  },
  deleteLayer: (id) => {
    if (layers.length <= 1) return;
    const idx = layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const removed = layers[idx];
    const affected = cubes.filter((c) => c.layerId === id);
    const prevActive = activeLayerId;
    const doDelete = () => {
      for (const c of affected) unregister(c);
      const i = layers.findIndex((l) => l.id === id);
      if (i >= 0) layers.splice(i, 1);
      if (activeLayerId === id) setActiveLayer(layers[0].id);
      applyLayerOrders();
      layerPanel.refresh();
    };
    const doRestore = () => {
      layers.splice(Math.min(idx, layers.length), 0, removed);
      for (const c of affected) register(c);
      setActiveLayer(prevActive);
      applyLayerOrders();
      layerPanel.refresh();
    };
    doDelete();
    history.push({
      undo: doRestore,
      redo: doDelete,
      resources: holdCubes(affected), bytes: affected.length * 3 * 1024 * 1024,
    });
  },
  renameLayer: (id, name) => {
    const l = layerById(id);
    if (!l) return;
    const before = l.name;
    l.name = name;
    layerPanel.refresh();
    history.push({
      undo: () => {
        l.name = before;
        layerPanel.refresh();
      },
      redo: () => {
        l.name = name;
        layerPanel.refresh();
      },
    });
  },
  moveLayer: (id, dir) => {
    const idx = layers.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const ni = idx + (dir === 1 ? -1 : 1); // dir=1 上移朝前（index 减小）
    if (ni < 0 || ni >= layers.length) return;
    const item = layers[idx];
    const doMove = () => {
      const j = layers.findIndex((l) => l.id === id);
      layers.splice(j, 1);
      layers.splice(ni, 0, item);
      applyLayerOrders();
      layerPanel.refresh();
    };
    const doUndo = () => {
      const j = layers.findIndex((l) => l.id === id);
      layers.splice(j, 1);
      layers.splice(idx, 0, item);
      applyLayerOrders();
      layerPanel.refresh();
    };
    doMove();
    history.push({ undo: doUndo, redo: doMove });
  },
  toggleVisible: (id) => {
    const l = layerById(id);
    if (!l) return;
    l.visible = !l.visible;
    syncLayer(l);
    refreshPicker();
    layerPanel.refresh();
    history.push({
      undo: () => {
        l.visible = !l.visible;
        syncLayer(l);
        refreshPicker();
        layerPanel.refresh();
      },
      redo: () => {
        l.visible = !l.visible;
        syncLayer(l);
        refreshPicker();
        layerPanel.refresh();
      },
    });
  },
  setOpacity: (id, opacity, commit) => {
    const l = layerById(id);
    if (!l) return;
    if (!opacityStarts.has(id)) opacityStarts.set(id, l.opacity);
    const before = opacityStarts.get(id)!;
    l.opacity = opacity;
    syncLayer(l);
    refreshPicker();
    if (commit) {
      opacityStarts.delete(id);
      if (before === opacity) return;
      history.push({
        undo: () => {
          l.opacity = before;
          syncLayer(l);
          refreshPicker();
          layerPanel.refresh();
        },
        redo: () => {
          l.opacity = opacity;
          syncLayer(l);
          refreshPicker();
          layerPanel.refresh();
        },
      });
    }
  },
  selectLayer: (id) => {
    setActiveLayer(id);
    layerPanel.refresh();
  },
  translateLayer: (id, axis, delta) => {
    const l = layerById(id);
    if (!l) return;
    const before = { ...l.pos };
    l.pos = { ...l.pos, [axis]: l.pos[axis] + delta };
    syncLayer(l);
    layerPanel.refresh();
    viewer.clearPreview();
    history.push({
      undo: () => {
        l.pos = before;
        syncLayer(l);
        layerPanel.refresh();
      },
      redo: () => {
        l.pos = { ...before, [axis]: before[axis] + delta };
        syncLayer(l);
        layerPanel.refresh();
      },
    });
  },
  rotateLayer: (id, axis, delta) => {
    const l = layerById(id);
    if (!l) return;
    const before = { rotation: { ...l.rotation }, pos: { ...l.pos } };
    // 用四元数 world-frame 复合累加旋转，消除欧拉分量累加的万向锁/顺序不一致
    const { rotation: newRot, pos: newPos } = rotateLayerAround(l, getRotationCenter(id), axis, delta);
    l.rotation = newRot;
    l.pos = newPos;
    syncLayer(l);
    layerPanel.refresh();
    viewer.clearPreview();
    history.push({
      undo: () => {
        l.rotation = before.rotation;
        l.pos = before.pos;
        syncLayer(l);
        layerPanel.refresh();
      },
      redo: () => {
        l.rotation = newRot;
        l.pos = newPos;
        syncLayer(l);
        layerPanel.refresh();
      },
    });
  },

  // ---------- 新增：向下合并 ----------
  mergeDown: () => {
    const idx = layers.findIndex((l) => l.id === activeLayerId);
    if (idx < 0 || idx >= layers.length - 1) return; // 末层或无活动层
    const active = layers[idx];
    const below = layers[idx + 1];

    const activeCubes = cubes.filter((c) => c.layerId === active.id);
    const belowCubes = cubes.filter((c) => c.layerId === below.id);

    // 预计算：每个 active 立方体转入 below 本地系的目标坐标
    const transformed = activeCubes.map((cube) => {
      const w = worldTransform(cube, active);
      const localPos = worldToLocal(w.pos, below);
      const localRot = composeRotation(invertRotation(below.rotation), w.rotation);
      return {
        cube,
        orig: {
          layerId: cube.layerId,
          gridPos: { ...cube.gridPos },
          rotation: { ...cube.rotation },
        },
        localPos,
        localRot,
      };
    });

    // 顶层优先：active 立方体占据的本地位置集合
    const activeKeys = new Set(
      transformed.map((t) => `${t.localPos.x},${t.localPos.y},${t.localPos.z}`)
    );
    // 被覆盖的 below 立方体（同位置丢弃，6 面直接丢弃）
    const discarded = belowCubes.filter((c) =>
      activeKeys.has(`${c.gridPos.x},${c.gridPos.y},${c.gridPos.z}`)
    );
    if (discarded.length && !window.confirm(`合并将覆盖下层 ${discarded.length} 个同位置单体及其六面图案，合并后使用下层的显示与透明度。此操作可以撤销。继续合并？`)) return;

    const doMerge = () => {
      for (const t of transformed) {
        t.cube.layerId = below.id;
        t.cube.gridPos = { ...t.localPos };
        t.cube.rotation = { ...t.localRot };
        syncCube(t.cube);
      }
      for (const d of discarded) unregister(d);
      const i = layers.findIndex((l) => l.id === active.id);
      if (i >= 0) layers.splice(i, 1);
      setActiveLayer(below.id);
      applyLayerOrders();
      layerPanel.refresh();
    };
    const doUndo = () => {
      const i = layers.findIndex((l) => l.id === below.id);
      layers.splice(i, 0, active); // 插回 below 之前（原 idx）
      for (const t of transformed) {
        t.cube.layerId = t.orig.layerId;
        t.cube.gridPos = { ...t.orig.gridPos };
        t.cube.rotation = { ...t.orig.rotation };
        syncCube(t.cube);
      }
      for (const d of discarded) register(d);
      setActiveLayer(active.id);
      applyLayerOrders();
      layerPanel.refresh();
    };

    doMerge();
    history.push({
      undo: doUndo,
      redo: doMerge,
      resources: holdCubes([...activeCubes, ...discarded]), bytes: discarded.length * 3 * 1024 * 1024,
    });
  },

  // ---------- 新增：旋转中心设定 ----------
  setRotationCenter: (pos) => {
    const layer = getActiveLayer();
    if (!layer) return;
    commitRotationCenter(layer, { ...pos });
  },
  pickRotationCenter: () => {
    pickingCenter = true;
    canvas.style.cursor = 'crosshair';
  },
  centerToGeometry: () => {
    const layer = getActiveLayer();
    if (!layer) return;
    const layerCubes = cubes.filter((c) => c.layerId === layer.id);
    if (!layerCubes.length) return;
    const min: GridPos = { x: Infinity, y: Infinity, z: Infinity };
    const max: GridPos = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const c of layerCubes) {
      for (const k of ['x', 'y', 'z'] as const) {
        min[k] = Math.min(min[k], c.gridPos[k]);
        max[k] = Math.max(max[k], c.gridPos[k]);
      }
    }
    const center: GridPos = {
      x: Math.round((min.x + max.x) / 2),
      y: Math.round((min.y + max.y) / 2),
      z: Math.round((min.z + max.z) / 2),
    };
    commitRotationCenter(layer, center);
    notify(`包围盒中心已吸附到网格枢轴：${center.x}, ${center.y}, ${center.z}`);
  },
  resetRotationCenter: () => {
    const layer = getActiveLayer();
    if (!layer) return;
    commitRotationCenter(layer, { x: 0, y: 0, z: 0 });
  },

  // ---------- 新增：悬停预览（不修改状态）----------
  previewTranslate: (axis, delta) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const previewPos = { ...layer.pos, [axis]: layer.pos[axis] + delta };
    const items = cubes
      .filter((c) => c.layerId === layer.id)
      .map((c) => {
        const g = rotateGridPos(c.gridPos, layer.rotation);
        const world: GridPos = {
          x: g.x + previewPos.x,
          y: g.y + previewPos.y,
          z: g.z + previewPos.z,
        };
        const rot = composeRotation(layer.rotation, c.rotation);
        return {
          pos: new THREE.Vector3(world.x * SIZE, world.y * SIZE, world.z * SIZE),
          rot: eulerOfRotation(rot),
        };
      });
    viewer.showPreviewCubes(items);
  },
  previewRotate: (axis, delta) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const preview = rotateLayerAround(layer, getRotationCenter(layer.id), axis, delta);
    const previewRot = preview.rotation;
    const items = cubes
      .filter((c) => c.layerId === layer.id)
      .map((c) => {
        const g = rotateGridPos(c.gridPos, previewRot);
        const world: GridPos = {
          x: g.x + preview.pos.x,
          y: g.y + preview.pos.y,
          z: g.z + preview.pos.z,
        };
        const rot = composeRotation(previewRot, c.rotation);
        return {
          pos: new THREE.Vector3(world.x * SIZE, world.y * SIZE, world.z * SIZE),
          rot: eulerOfRotation(rot),
        };
      });
    viewer.showPreviewCubes(items);
  },
  cancelPreview: () => {
    viewer.clearPreview();
  },
};

const layerState = (): LayerPanelState => ({
  layers: layers.map((l) => ({ ...l })),
  activeLayerId,
  counts: Object.fromEntries(
    layers.map((l) => [l.id, cubes.filter((c) => c.layerId === l.id).length])
  ),
  rotationCenter: getRotationCenter(activeLayerId),
  activeIndex: layers.findIndex((l) => l.id === activeLayerId),
});

const layerPanel = new LayerPanel(layerActions, layerState);

// ---------- 工具栏动作 ----------
toolbar = new Toolbar({
  addCube: () => {
    if (cubes.length >= 1000) { notify('最多支持 1000 个单体，请拆分保存作品。'); return; }
    if (!layerVisible(activeLayerId)) { notify('请先显示活动组件组，再添加单体。'); return; }
    const pos = freeGridPos();
    const cube = createCube(pos, SIZE, { layerId: activeLayerId });
    register(cube);
    select(cube, 'px');
    viewer.clearPreview();
    notify(`已添加 ${cube.id}：放在活动组空闲格 (${pos.x}, ${pos.y}, ${pos.z})。要贴着某个面新增，请选面后用“贴面堆叠”。`);
    history.push({
      undo: () => unregister(cube),
      redo: () => register(cube),
      resources: holdCubes([cube]), bytes: 3 * 1024 * 1024,
    });
  },
  rotate: (dir) => {
    if (!selected) return;
    const cube = selected;
    const before = { ...cube.rotation };
    const { up, right } = viewer.getScreenAxes();
    const axis = dir === 'left' || dir === 'right' ? up : right;
    cube.rotation = rotateInLayer(cube.rotation, layerById(cube.layerId)!.rotation, axis, dir === 'left' || dir === 'up' ? 90 : -90);
    const snapped = dominantAxis(axis); const axisName = Math.abs(snapped.x) ? 'X' : Math.abs(snapped.y) ? 'Y' : 'Z';
    notify(`单体围绕世界 ${axisName} 主轴转动 90°；相机方向保持不变。`);
    syncCube(cube);
    const after = { ...cube.rotation };
    history.push({
      resources: holdCubes([cube]),
      undo: () => {
        cube.rotation = { ...before };
        syncCube(cube);
      },
      redo: () => {
        cube.rotation = { ...after };
        syncCube(cube);
      },
    });
  },
  attachStack: () => {
    if (cubes.length >= 1000) { notify('最多支持 1000 个单体，请拆分保存作品。'); return; }
    if (!selected || !selectedFace) return;
    const srcLayer = layerById(selected.layerId)!;
    const w = worldTransform(selected, srcLayer);
    const n = attachGridPos(w.rotation, selectedFace); // 单位网格索引偏移
    const worldAdj: GridPos = {
      x: w.pos.x + n.x,
      y: w.pos.y + n.y,
      z: w.pos.z + n.z,
    };
    const active = getActiveLayer();
    const local = attachInLayer(worldAdj, active);
    if (occupied(local, active.id)) { viewer.clearPreview(); notify('该面相邻位置已有单体，无法重复堆叠。'); return; }
    const sourceName = `${selected.id} 的面 ${FACE_LABELS[selectedFace]}`;
    const cube = createCube(local, SIZE, {
      layerId: active.id,
      color: selected.color,
    });
    register(cube);
    select(cube, 'px');
    viewer.clearPreview();
    notify(`已贴面堆叠：${cube.id} 紧贴 ${sourceName}，继承底色。`);
    history.push({
      undo: () => unregister(cube),
      redo: () => register(cube),
      resources: holdCubes([cube]), bytes: 3 * 1024 * 1024,
    });
  },
  editFace: async () => {
    if (!selected || !selectedFace || openingEditor) return;
    openingEditor = true;
    let faceEditor: import('./draw/FaceEditor').FaceEditor;
    try { faceEditor = new (await import('./draw/FaceEditor')).FaceEditor(); }
    catch { notify('编辑器加载失败，请刷新后重试。'); return; }
    finally { openingEditor = false; }
    if (!selected || !selectedFace || document.querySelector('[role="dialog"]')) return;
    const cube = selected;
    const fid = selectedFace;
    const face = cube.faces[fid];
    const before = copyCanvas(face.canvas);
    faceEditor.open(face, {
      cubeName: cube.id,
      background: faceBackground(fid, cube.color),
      onCommit: () => {
        markFaceDirty(cube, fid);
        const after = copyCanvas(face.canvas);
        history.push({
          resources: holdCubes([cube]), bytes: 2 * 256 * 256 * 4,
          undo: () => {
            restoreCanvas(face.canvas, before);
            markFaceDirty(cube, fid);
            viewer.requestRender();
          },
          redo: () => {
            restoreCanvas(face.canvas, after);
            markFaceDirty(cube, fid);
            viewer.requestRender();
          },
        });
      },
      onCancel: () => {},
    });
  },
  removeSelected: () => {
    if (!selected) return;
    const cube = selected;
    const fid = selectedFace ?? 'px';
    unregister(cube);
    history.push({
      undo: () => {
        register(cube);
        select(cube, fid);
      },
      redo: () => unregister(cube),
      resources: holdCubes([cube]), bytes: 3 * 1024 * 1024,
    });
  },
  openNet: async () => {
    if (!selected || openingEditor) return;
    openingEditor = true;
    let netEditor: import('./draw/NetEditor').NetEditor;
    try { netEditor = new (await import('./draw/NetEditor')).NetEditor(); }
    catch { notify('编辑器加载失败，请刷新后重试。'); return; }
    finally { openingEditor = false; }
    if (!selected || document.querySelector('[role="dialog"]')) return;
    const cube = selected;
    const before = FACE_ORDER.map((f) => copyCanvas(cube.faces[f].canvas));
    const beforeNet = cloneNetPreferences(cube.net);
    netEditor.open(cube, {
      selectedFace: selectedFace ?? undefined,
      onMerge: () => {
        const after = FACE_ORDER.map((f) => copyCanvas(cube.faces[f].canvas));
        const afterNet = cloneNetPreferences(cube.net);
        history.push({
          resources: holdCubes([cube]), bytes: 12 * 256 * 256 * 4,
          undo: () => {
            cube.net = cloneNetPreferences(beforeNet);
            FACE_ORDER.forEach((f, i) => {
              restoreCanvas(cube.faces[f].canvas, before[i]);
              markFaceDirty(cube, f);
            });
            viewer.requestRender();
          },
          redo: () => {
            cube.net = cloneNetPreferences(afterNet);
            FACE_ORDER.forEach((f, i) => {
              restoreCanvas(cube.faces[f].canvas, after[i]);
              markFaceDirty(cube, f);
            });
            viewer.requestRender();
          },
        });
      },
      onCancel: () => {},
    });
  },
  setColor: (color) => {
    if (!selected) return;
    const cube = selected;
    const before = cube.color;
    setCubeColor(cube, color ?? undefined);
    const after = cube.color;
    if (before === after) return;
    history.push({
      resources: holdCubes([cube]),
      undo: () => {
        setCubeColor(cube, before);
        toolbar.setColorValue(before);
      },
      redo: () => {
        setCubeColor(cube, after);
        toolbar.setColorValue(after);
      },
    });
  },
  undo: () => history.undo(),
  redo: () => history.redo(),
  save: () => downloadScene(cubes, layers, activeLayerId, SIZE, 'scene.json', sceneExtras()),
  load: (file) => {
    void loadSceneFromFile(file);
  },
  screenshot: () => {
    const url = viewer.takeScreenshot();
    const a = document.createElement('a');
    a.href = url;
    a.download = `screenshot-${Date.now()}.png`;
    a.click();
  },
  previewAttach: () => {
    if (!selected || !selectedFace) return;
    const srcLayer = layerById(selected.layerId)!;
    const w = worldTransform(selected, srcLayer);
    const n = attachGridPos(w.rotation, selectedFace);
    const worldAdj: GridPos = {
      x: w.pos.x + n.x,
      y: w.pos.y + n.y,
      z: w.pos.z + n.z,
    };
    const active = getActiveLayer();
    const local = attachInLayer(worldAdj, active);
    if (occupied(local, active.id)) { viewer.clearPreview(); notify('目标网格已占用。'); return; }
    const world = layerPointToWorld(local, active);
    viewer.showPreviewCubes([
      {
        pos: new THREE.Vector3(world.x * SIZE, world.y * SIZE, world.z * SIZE),
        rot: eulerOfRotation(active.rotation),
      },
    ]);
  },
  previewAdd: () => {
    if (!layerVisible(activeLayerId)) return;
    const layer = getActiveLayer(), world = layerPointToWorld(freeGridPos(), layer);
    viewer.showPreviewCubes([{ pos: new THREE.Vector3(world.x * SIZE, world.y * SIZE, world.z * SIZE), rot: eulerOfRotation(layer.rotation) }]);
  },
  cancelPreview: () => {
    viewer.clearPreview();
  },
});

let cancelLoading: (() => void) | undefined;
async function loadSceneFromFile(file: unknown): Promise<void> {
  cancelLoading?.();
  let cancelled = false;
  const temporary: Cube[] = [];
  const cancel = () => { cancelled = true; modal.close(); notify('读取已取消，原作品已保留。'); };
  cancelLoading = cancel;
  const modal = new Modal('face-editor', '读取场景', cancel);
  const message = document.createElement('p'); message.textContent = '正在校验场景…';
  const button = document.createElement('button'); button.className = 'btn'; button.textContent = '取消读取'; button.addEventListener('click', cancel);
  modal.panel.append(message, button); modal.mount();
  try {
    const data = file instanceof File ? await readSceneFile(file) : validateScene(file);
    for (const item of data.cubes) {
      if (cancelled) return;
      message.textContent = `正在读取图案 ${temporary.length + 1} / ${data.cubes.length}…`;
      temporary.push(await createCubeFromData(item));
    }
    if (cancelled) return;
    // Only a fully decoded and validated scene can replace the current document.
    deselect();
    for (const old of cubes) { viewer.scene.remove(old.mesh); disposeCube(old); }
    cubes.length = 0;
    layers.splice(0, layers.length, ...data.layers.map(l => ({ ...l, pos: { ...l.pos }, rotation: { ...l.rotation } })));
    activeLayerId = data.activeLayerId;
    syncLayerIdCounter(layers.map(l => l.id)); syncCubeIdCounter(data.cubes.map(c => c.id));
    for (const cube of temporary) { cubes.push(cube); viewer.scene.add(cube.mesh); syncCube(cube); }
    temporary.length = 0;
    rotationCenterByLayer.clear(); opacityStarts.clear(); viewer.clearPreview();
    for (const [id, point] of Object.entries(data.rotationCenters ?? {})) rotationCenterByLayer.set(id, point);
    applyLayerOrders(); refreshPicker(); updateCenterMarker(); layerPanel.refresh(); history.clear();
    viewer.fit();
    if (data.view) viewer.restoreView(data.view);
    notify(`已读取 ${cubes.length} 个单体，展开状态已恢复。`);
  } catch (error) {
    if (!cancelled) notify(`读取失败，原作品已保留：${error instanceof Error ? error.message : '未知错误'}`);
  } finally {
    for (const cube of temporary) disposeCube(cube);
    modal.close(); if (cancelLoading === cancel) cancelLoading = undefined;
  }
}

// ---------- 键盘快捷键 ----------
window.addEventListener('keydown', (e) => {
  if (document.querySelector('[role="dialog"]')) return;
  const target = e.target as HTMLElement;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
  if (e.key === 'Escape') {
    // 解除可能卡死的视角拖拽锁定
    viewer.resetInteraction();
    if (pickingCenter) {
      pickingCenter = false;
      canvas.style.cursor = '';
    }
    return;
  }
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) history.redo();
    else history.undo();
  } else if (meta && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    history.redo();
  }
});

// ---------- 提示 ----------
const hint = document.createElement('details');
hint.className = 'hint';
hint.innerHTML = '<summary>操作帮助</summary><p>拖动旋转观察 · 滚轮缩放 · 点击选择面（蓝色描边）。仅活动组件组可编辑；列表顺序不代表空间前后。</p><p>观察工具控制相机；单体转向改变物体。展开编辑中可整体变换、切换类型、返回绘制布局。</p><p>Ctrl+Z 撤销 · Ctrl+Y 重做 · Esc 关闭编辑或恢复拖动。项目保存包含图案、布局、相机与旋转中心。</p>';
document.body.appendChild(hint);

createViewBar(viewer, {
  projections: () => { void openTool(async () => { const { openProjections } = await import('./ui/ProjectionPanel'); openProjections(cubes, layers, selected?.id, (cube, face) => { setActiveLayer(cube.layerId); select(cube, face); layerPanel.refresh(); }); }); },
  recover: () => { void openTool(recoverAutosave); },
  practice: () => { void openTool(async () => { const { openPractice } = await import('./ui/Practice'); openPractice(); }); },
});

// ---------- 初始放置一个立方体（作为基线，不计入历史）----------
const init = createCube({ x: 0, y: 0, z: 0 }, SIZE, { layerId: DEFAULT_LAYER_ID });
register(init);
select(init, 'px');

// 初始显示活动层旋转中心标记
updateCenterMarker();

viewer.start();
viewer.fit();
void readAutosave().then(saved => { if (saved && !saveTimer) saveStatus.textContent = '发现本机作品，可点击“恢复自动保存”'; }).catch(() => { saveStatus.textContent = '本机自动保存暂不可用'; });
