import * as THREE from 'three';
import { Viewer } from './scene/Viewer';
import {
  createCube,
  createCubeFromData,
  syncMeshTransform,
  setCubeColor,
  applyLayerStyle,
  markFaceDirty,
  setCubeHighlight,
  rotateWorldAxis,
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
} from './scene/layerMath';
import { FaceEditor } from './draw/FaceEditor';
import { NetEditor } from './draw/NetEditor';
import { Toolbar } from './ui/Toolbar';
import { LayerPanel, LayerPanelActions, LayerPanelState } from './ui/LayerPanel';
import { History, copyCanvas, restoreCanvas } from './core/History';
import { downloadScene, readSceneFile } from './model/serialize';
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
} from './model/types';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const viewer = new Viewer(canvas);
const faceEditor = new FaceEditor();
const netEditor = new NetEditor();
const SIZE = viewer.getGridSize();

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
});

// ---------- 图层辅助 ----------
function layerById(id: string): Layer | undefined {
  return layers.find((l) => l.id === id);
}
function getActiveLayer(): Layer {
  return layerById(activeLayerId) ?? layers[0];
}
function layerVisible(id: string): boolean {
  return layerById(id)?.visible !== false;
}

// ---------- DEBUG：图层状态快照（排查合并后多图层高亮问题）----------
// function dbgLayers(label: string): void {
//   const byId = new Map<string, string[]>();
//   for (const l of layers) {
//     const arr = byId.get(l.id) ?? [];
//     arr.push(l.name);
//     byId.set(l.id, arr);
//   }
//   const dups = [...byId.entries()].filter(([, names]) => names.length > 1);
//   if (dups.length) {
//     console.warn(`[DBG] ⚠️ 检测到重复图层ID @ ${label}:`, dups);
//   }
//   console.log(`[DBG] ── ${label} ── activeLayerId=${activeLayerId}`);
//   console.table(
//     layers.map((l, i) => ({
//       idx: i,
//       id: l.id,
//       name: l.name,
//       cubes: cubes.filter((c) => c.layerId === l.id).length,
//       pos: `${l.pos.x},${l.pos.y},${l.pos.z}`,
//       rot: `${l.rotation.x},${l.rotation.y},${l.rotation.z}`,
//     }))
//   );
// }
/** 严格隔离：仅当前活动图层中可见的立方体可被拾取。 */
function pickableCubes(): Cube[] {
  return cubes.filter((c) => c.layerId === activeLayerId && layerVisible(c.layerId));
}
function refreshPicker(): void {
  picker.setCubes(pickableCubes());
}
/** 切换活动图层：刷新可拾取集合并取消不属于该层的残留选中（严格隔离）。 */
function setActiveLayer(id: string): void {
  // const matches = layers.filter((l) => l.id === id);
  // if (matches.length !== 1) {
  //   console.warn(
  //     `[DBG] setActiveLayer(${id}) 匹配到 ${matches.length} 个图层（应为1）！`,
  //     matches.map((l) => `${l.id}(${l.name})`)
  //   );
  // }
  activeLayerId = id;
  refreshPicker();
  if (selected && selected.layerId !== id) deselect();
  viewer.clearPreview();
  updateCenterMarker();
  // dbgLayers(`setActiveLayer(${id})`);
}
/** 把立方体本地变换 + 所属图层变换合成为世界变换并写入 Mesh，并应用图层显隐/不透明度。 */
function syncCube(cube: Cube): void {
  const layer = layerById(cube.layerId);
  const world = layer ? worldTransform(cube, layer) : undefined;
  syncMeshTransform(cube, world);
  if (layer) applyLayerStyle(cube, layer.visible, layer.opacity);
  viewer.requestRender();
}
/** 按图层顺序设置 renderOrder（最前图层渲染在最上层）。 */
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

function normRotation(r: Rotation): Rotation {
  const n = (v: number) => {
    let x = Math.round(v / 90) * 90;
    x = (((x + 180) % 360) + 360) % 360 - 180;
    return x;
  };
  return { x: n(r.x), y: n(r.y), z: n(r.z) };
}

// ---------- 场景增删辅助 ----------
function register(cube: Cube): void {
  cubes.push(cube);
  viewer.scene.add(cube.mesh);
  syncCube(cube);
  applyLayerOrders();
  refreshPicker();
  viewer.requestRender();
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
    const hit = picker.pick(viewer.toNDC(e.clientX, e.clientY));
    if (hit) commitRotationCenter(getActiveLayer(), { ...hit.cube.gridPos });
    return;
  }
  if (moved > 5) return; // 视为轨道拖拽，不拾取
  const hit = picker.pick(viewer.toNDC(e.clientX, e.clientY));
  if (!hit) {
    deselect();
    return;
  }
  select(hit.cube, hit.faceId);
});

function select(cube: Cube, face: FaceId): void {
  if (selected && selected !== cube) setCubeHighlight(selected, false);
  selected = cube;
  selectedFace = face;
  setCubeHighlight(cube, true);
  toolbar.setHasSelection(true);
  toolbar.setColorValue(cube.color);
  viewer.requestRender();
}

function deselect(): void {
  if (selected) setCubeHighlight(selected, false);
  selected = null;
  selectedFace = null;
  toolbar.setHasSelection(false);
  viewer.requestRender();
}

function freeGridPos(): GridPos {
  const occupied = new Set(cubes.map((c) => `${c.gridPos.x},${c.gridPos.y},${c.gridPos.z}`));
  if (!occupied.has('0,0,0')) return { x: 0, y: 0, z: 0 };
  for (let x = 1; ; x++) {
    if (!occupied.has(`${x},0,0`)) return { x, y: 0, z: 0 };
  }
}

// ---------- 图层管理动作 ----------
const layerActions: LayerPanelActions = {
  addLayer: () => {
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
    // dbgLayers(`addLayer 新增 ${layer.id}(${layer.name})`);
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
      dispose: () => {
        for (const c of affected) if (!c.mesh.parent) disposeCube(c);
      },
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
    const before = l.opacity;
    l.opacity = opacity;
    syncLayer(l);
    layerPanel.refresh();
    if (commit) {
      history.push({
        undo: () => {
          l.opacity = before;
          syncLayer(l);
          layerPanel.refresh();
        },
        redo: () => {
          l.opacity = opacity;
          syncLayer(l);
          layerPanel.refresh();
        },
      });
    }
  },
  selectLayer: (id) => {
    // console.log(`[DBG] selectLayer(${id}) 被点击`);
    setActiveLayer(id);
    layerPanel.refresh();
  },
  translateLayer: (id, axis, delta) => {
    const l = layerById(id);
    if (!l) return;
    // const affected = cubes.filter((c) => c.layerId === l.id);
    // console.log(
    //   `[DBG] translateLayer id=${id} 找到图层=${l.id}(${l.name}) axis=${axis} delta=${delta} 影响 ${affected.length} 个立方体:`,
    //   affected.map((c) => `${c.id}(layer=${c.layerId})`)
    // );
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
    const before = { ...l.rotation };
    l.rotation = normRotation({ ...l.rotation, [axis]: l.rotation[axis] + delta });
    syncLayer(l);
    layerPanel.refresh();
    viewer.clearPreview();
    history.push({
      undo: () => {
        l.rotation = before;
        syncLayer(l);
        layerPanel.refresh();
      },
      redo: () => {
        l.rotation = normRotation({ ...before, [axis]: before[axis] + delta });
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

    const doMerge = () => {
      // console.log(
      //   `[DBG] mergeDown.doMerge 开始: active=${active.id}(${active.name}) -> below=${below.id}(${below.name})`
      // );
      // console.log(`[DBG] transformed cubes (${transformed.length}):`);
      // console.table(
      //   transformed.map((t) => ({
      //     cubeId: t.cube.id,
      //     oldLayer: t.orig.layerId,
      //     newLayer: below.id,
      //     oldPos: `${t.orig.gridPos.x},${t.orig.gridPos.y},${t.orig.gridPos.z}`,
      //     newPos: `${t.localPos.x},${t.localPos.y},${t.localPos.z}`,
      //   }))
      // );
      // console.log(
      //   `[DBG] discarded below-cubes (${discarded.length}):`,
      //   discarded.map((d) => `${d.id}(layer=${d.layerId})`)
      // );
      for (const t of transformed) {
        t.cube.layerId = below.id;
        t.cube.gridPos = { ...t.localPos };
        t.cube.rotation = { ...t.localRot };
        syncCube(t.cube);
      }
      for (const d of discarded) unregister(d);
      const i = layers.findIndex((l) => l.id === active.id);
      // console.log(
      //   `[DBG] 移除活动图层 idx=${i} id=${active.id}(${active.name})`
      // );
      if (i >= 0) layers.splice(i, 1);
      setActiveLayer(below.id);
      applyLayerOrders();
      layerPanel.refresh();
      // dbgLayers('mergeDown.doMerge 完成');
    };
    const doUndo = () => {
      const i = layers.findIndex((l) => l.id === below.id);
      // console.log(
      //   `[DBG] mergeDown.doUndo: 在 below idx=${i} 前插回 active=${active.id}(${active.name})`
      // );
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
      // dbgLayers('mergeDown.doUndo 完成');
    };

    doMerge();
    history.push({
      undo: doUndo,
      redo: doMerge,
      dispose: () => {
        for (const d of discarded) if (!d.mesh.parent) disposeCube(d);
      },
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
    const previewRot = normRotation({ ...layer.rotation, [axis]: layer.rotation[axis] + delta });
    const items = cubes
      .filter((c) => c.layerId === layer.id)
      .map((c) => {
        const g = rotateGridPos(c.gridPos, previewRot);
        const world: GridPos = {
          x: g.x + layer.pos.x,
          y: g.y + layer.pos.y,
          z: g.z + layer.pos.z,
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
    const pos = freeGridPos();
    // const matchCount = layers.filter((l) => l.id === activeLayerId).length;
    // console.log(
    //   `[DBG] addCube 到活动层 ${activeLayerId}，当前匹配图层数=${matchCount}（应为1）`
    // );
    const cube = createCube(pos, SIZE, { layerId: activeLayerId });
    register(cube);
    select(cube, 'px');
    // dbgLayers('addCube 完成');
    history.push({
      undo: () => unregister(cube),
      redo: () => register(cube),
      dispose: () => {
        if (!cube.mesh.parent) disposeCube(cube);
      },
    });
  },
  rotate: (dir) => {
    if (!selected) return;
    const cube = selected;
    const before = { ...cube.rotation };
    const { up, right } = viewer.getScreenAxes();
    if (dir === 'left') rotateWorldAxis(cube, up, 90);
    else if (dir === 'right') rotateWorldAxis(cube, up, -90);
    else if (dir === 'up') rotateWorldAxis(cube, right, 90);
    else if (dir === 'down') rotateWorldAxis(cube, right, -90);
    syncCube(cube);
    const after = { ...cube.rotation };
    history.push({
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
    const cube = createCube(local, SIZE, {
      layerId: active.id,
      color: selected.color,
    });
    register(cube);
    select(cube, 'px');
    viewer.clearPreview();
    history.push({
      undo: () => unregister(cube),
      redo: () => register(cube),
      dispose: () => {
        if (!cube.mesh.parent) disposeCube(cube);
      },
    });
  },
  editFace: () => {
    if (!selected || !selectedFace) return;
    const cube = selected;
    const fid = selectedFace;
    const face = cube.faces[fid];
    const before = copyCanvas(face.canvas);
    faceEditor.open(face, {
      onCommit: () => {
        markFaceDirty(cube, fid);
        const after = copyCanvas(face.canvas);
        history.push({
          undo: () => {
            restoreCanvas(face.canvas, before);
            face.texture.needsUpdate = true;
            viewer.requestRender();
          },
          redo: () => {
            restoreCanvas(face.canvas, after);
            face.texture.needsUpdate = true;
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
      dispose: () => {
        if (!cube.mesh.parent) disposeCube(cube);
      },
    });
  },
  openNet: () => {
    if (!selected) return;
    const cube = selected;
    const before = FACE_ORDER.map((f) => copyCanvas(cube.faces[f].canvas));
    netEditor.open(cube, {
      onMerge: () => {
        const after = FACE_ORDER.map((f) => copyCanvas(cube.faces[f].canvas));
        history.push({
          undo: () => {
            FACE_ORDER.forEach((f, i) => {
              restoreCanvas(cube.faces[f].canvas, before[i]);
              cube.faces[f].texture.needsUpdate = true;
            });
            viewer.requestRender();
          },
          redo: () => {
            FACE_ORDER.forEach((f, i) => {
              restoreCanvas(cube.faces[f].canvas, after[i]);
              cube.faces[f].texture.needsUpdate = true;
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
    history.push({
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
  save: () => downloadScene(cubes, layers, activeLayerId, SIZE),
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
    const world = layerPointToWorld(local, active);
    viewer.showPreviewCubes([
      {
        pos: new THREE.Vector3(world.x * SIZE, world.y * SIZE, world.z * SIZE),
        rot: eulerOfRotation(active.rotation),
      },
    ]);
  },
  cancelPreview: () => {
    viewer.clearPreview();
  },
});

async function loadSceneFromFile(file: File): Promise<void> {
  const data = await readSceneFile(file);
  for (const c of [...cubes]) {
    viewer.scene.remove(c.mesh);
    disposeCube(c);
  }
  cubes.length = 0;
  picker.setCubes(cubes);
  deselect();
  // 重建图层（兼容旧文件：无 layers 时归入默认层）
  layers.length = 0;
  if (data.layers && data.layers.length) {
    for (const l of data.layers) {
      layers.push({
        id: l.id,
        name: l.name,
        pos: { ...l.pos },
        rotation: { ...l.rotation },
        visible: l.visible !== false,
        opacity: typeof l.opacity === 'number' ? l.opacity : 1,
      });
    }
  } else {
    layers.push(createDefaultLayer());
  }
  // 关键修复：把图层ID计数器对齐到已加载 id 的最大序号，避免后续 addLayer 重复生成 layer-1/2/3
  syncLayerIdCounter(layers.map((l) => l.id));
  activeLayerId = data.activeLayerId ?? layers[0].id;
  for (const cd of data.cubes) {
    const cube = await createCubeFromData(cd);
    cubes.push(cube);
    viewer.scene.add(cube.mesh);
    syncCube(cube);
  }
  applyLayerOrders();
  refreshPicker();
  rotationCenterByLayer.clear();
  updateCenterMarker();
  layerPanel.refresh();
  history.clear();
  // console.warn(
  //   `[DBG] loadSceneFromFile 完成 —— nextLayerId 计数器=${getLayerCounter()}，已加载图层ID=${layers
  //     .map((l) => l.id)
  //     .join(',')}。若计数器 < 已加载 layer-N 的最大N，后续 addLayer 会产生ID冲突`
  // );
  // dbgLayers('loadSceneFromFile 完成');
}

// ---------- 键盘快捷键 ----------
window.addEventListener('keydown', (e) => {
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
const hint = document.createElement('div');
hint.className = 'hint';
hint.innerHTML =
  '左键拖拽旋转视角 · 滚轮缩放 · 单击立方体选中（蓝色高亮）<br/>' +
  '选中后：旋转/贴面堆叠/编辑选中面/展开选中/删除<br/>' +
  '右侧图层面板：整层平移旋转、显隐、不透明度、单色<br/>' +
  '悬停平移/旋转/贴面堆叠按钮可预览（橙色线框）；图层面板可设旋转中心<br/>' +
  '仅可选中当前活动图层的立方体（图层隔离）<br/>' +
  'Ctrl+Z 撤销 · Ctrl+Y 或 Ctrl+Shift+Z 重做 · 保存/读取/拍照 · Esc 解除视角锁定';
document.body.appendChild(hint);

// ---------- 初始放置一个立方体（作为基线，不计入历史）----------
const init = createCube({ x: 0, y: 0, z: 0 }, SIZE, { layerId: DEFAULT_LAYER_ID });
register(init);
select(init, 'px');

// 初始显示活动层旋转中心标记
updateCenterMarker();

viewer.start();
