import { Cube, FaceId, FACE_ORDER, GridPos, Layer, Rotation, createDefaultLayer } from './types';
import { NetPreferences, cloneNetPreferences, validNetState } from './netVariants';

export interface SerializedCube {
  id: string;
  gridPos: GridPos;
  size: number;
  rotation: Rotation;
  layerId: string;
  color?: string;
  legacyTint?: boolean;
  net?: NetPreferences;
  faces: Record<FaceId, string>; // 每面 canvas 的 dataURL
}

export interface SerializedLayer {
  id: string;
  name: string;
  pos: GridPos;
  rotation: Rotation;
  visible: boolean;
  opacity: number;
}

export interface SerializedScene {
  version: number;
  gridSize: number;
  layers: SerializedLayer[];
  activeLayerId: string;
  cubes: SerializedCube[];
  view?: SavedView;
  rotationCenters?: Record<string, GridPos>;
}

export interface SavedView { projection: 'perspective' | 'orthographic'; position: number[]; target: number[]; up: number[]; zoom: number; orthoHeight: number; }
export type SceneExtras = Pick<SerializedScene, 'view' | 'rotationCenters'>;

/** 把当前场景（含图层与立方体颜色）序列化为 JSON 友好的结构。 */
export function serializeScene(
  cubes: Cube[],
  layers: Layer[],
  activeLayerId: string,
  gridSize: number,
  extras: SceneExtras = {}
): SerializedScene {
  return {
    version: 3,
    ...extras,
    gridSize,
    layers: layers.map((l) => ({
      id: l.id,
      name: l.name,
      pos: { ...l.pos },
      rotation: { ...l.rotation },
      visible: l.visible,
      opacity: l.opacity,
    })),
    activeLayerId,
    cubes: cubes.map((c) => ({
      id: c.id,
      gridPos: { ...c.gridPos },
      size: c.size,
      rotation: { ...c.rotation },
      layerId: c.layerId,
      color: c.color,
      net: cloneNetPreferences(c.net),
      faces: Object.fromEntries(
        FACE_ORDER.map((f) => [f, c.faces[f].canvas.toDataURL('image/png')])
      ) as Record<FaceId, string>,
    })),
  };
}

/** 触发浏览器下载场景为 .json 文件。 */
export function downloadScene(
  cubes: Cube[],
  layers: Layer[],
  activeLayerId: string,
  gridSize: number,
  filename = 'scene.json',
  extras: SceneExtras = {}
): void {
  const data = JSON.stringify(serializeScene(cubes, layers, activeLayerId, gridSize, extras));
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 读取 .json 文件并解析为场景结构。 */
export function readSceneFile(file: File): Promise<SerializedScene> {
  if (file.size > 32 * 1024 * 1024) return Promise.reject(new Error('场景文件超过 32 MB，请减少图片或单体数量。'));
  return file.text().then(t => {
    let value: unknown;
    try { value = JSON.parse(t); } catch { throw new Error('文件不是有效的 JSON 场景。'); }
    return validateScene(value);
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 格式不正确`);
  return value as Record<string, unknown>;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error(`${label} 必须是有效且唯一的标识`);
  return value;
}
function coordinates(value: unknown, rotation = false): GridPos {
  const data = record(value, rotation ? '旋转' : '坐标');
  for (const axis of ['x', 'y', 'z']) if (typeof data[axis] !== 'number' || !Number.isSafeInteger(data[axis]) || Math.abs(data[axis] as number) > 10000 || (rotation && (data[axis] as number) % 90 !== 0)) throw new Error(rotation ? '旋转必须为 90° 的整数倍' : '坐标必须为范围内的整数');
  return { x: data.x as number, y: data.y as number, z: data.z as number };
}
export function validateScene(value: unknown): SerializedScene {
  const data = record(value, '场景');
  const version = data.version ?? 1;
  if (version !== 1 && version !== 2 && version !== 3) throw new Error('不支持这个场景版本');
  if (data.gridSize !== undefined && data.gridSize !== 1) throw new Error('当前场景仅支持边长为 1 的统一网格');
  if (!Array.isArray(data.cubes) || data.cubes.length > 1000) throw new Error('场景需要有效的单体列表（最多 1000 个）');
  if (data.layers !== undefined && !Array.isArray(data.layers)) throw new Error('组件组列表格式不正确');
  const rawLayers = Array.isArray(data.layers) && data.layers.length ? data.layers : [createDefaultLayer()];
  if (rawLayers.length > 100) throw new Error('组件组数量不能超过 100');
  const layerIds = new Set<string>();
  const layers: SerializedLayer[] = rawLayers.map(value => {
    const l = record(value, '组件组'), id = identifier(l.id, '组件组 ID');
    if (layerIds.has(id)) throw new Error('组件组 ID 重复'); layerIds.add(id);
    if (typeof l.name !== 'string' || l.name.length > 100) throw new Error('组件组名称无效');
    if (l.opacity !== undefined && (typeof l.opacity !== 'number' || !Number.isFinite(l.opacity) || l.opacity < 0 || l.opacity > 1)) throw new Error('不透明度必须在 0 到 1 之间');
    if (l.visible !== undefined && typeof l.visible !== 'boolean') throw new Error('组件组显示状态无效');
    return { id, name: l.name, pos: coordinates(l.pos), rotation: coordinates(l.rotation, true), visible: l.visible !== false, opacity: l.opacity as number ?? 1 };
  });
  const activeLayerId = data.activeLayerId === undefined ? layers[0].id : identifier(data.activeLayerId, '活动组件组');
  if (!layerIds.has(activeLayerId)) throw new Error('活动组件组不存在');
  const cubeIds = new Set<string>(), occupied = new Set<string>();
  const cubes: SerializedCube[] = data.cubes.map(value => {
    const c = record(value, '单体'), id = identifier(c.id, '单体 ID');
    if (cubeIds.has(id)) throw new Error('单体 ID 重复'); cubeIds.add(id);
    const gridPos = coordinates(c.gridPos), rotation = coordinates(c.rotation, true);
    if (c.size !== 1) throw new Error('当前只支持单位立方体');
    const layerId = c.layerId === undefined ? layers[0].id : identifier(c.layerId, '所属组件组');
    if (!layerIds.has(layerId)) throw new Error('单体引用了不存在的组件组');
    const key = `${layerId}:${gridPos.x},${gridPos.y},${gridPos.z}`;
    if (occupied.has(key)) throw new Error('同一组件组中存在重叠单体'); occupied.add(key);
    if (c.color !== undefined && (typeof c.color !== 'string' || !/^#[\da-f]{6}$/i.test(c.color))) throw new Error('单体颜色无效');
    const inputFaces = record(c.faces, '面图案'), faces = {} as Record<FaceId, string>;
    for (const face of FACE_ORDER) {
      const image = inputFaces[face];
      if (typeof image !== 'string' || image.length > 4 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image)) throw new Error(`面 ${face} 的图片数据无效`);
      faces[face] = image;
    }
    let net: NetPreferences | undefined;
    if (c.net !== undefined) {
      const n = record(c.net, '展开状态');
      if (n.version !== 1 || !validNetState(n.current) || (n.drawing !== undefined && !validNetState(n.drawing)) || !Array.isArray(n.bookmarks) || n.bookmarks.length > 12 || !n.bookmarks.every(validNetState)) throw new Error('保存的展开状态无效');
      net = cloneNetPreferences(n as unknown as NetPreferences);
    }
    return { id, gridPos, rotation, size: 1, layerId, color: c.color as string | undefined, legacyTint: version < 3, net, faces };
  });
  let view: SavedView | undefined;
  if (data.view !== undefined) {
    const v = record(data.view, '观察状态');
    for (const key of ['position', 'target', 'up']) if (!Array.isArray(v[key]) || (v[key] as unknown[]).length !== 3 || !(v[key] as unknown[]).every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 100000)) throw new Error('相机坐标无效');
    if (!['perspective', 'orthographic'].includes(v.projection as string) || typeof v.zoom !== 'number' || !Number.isFinite(v.zoom) || v.zoom < .001 || v.zoom > 10000 || typeof v.orthoHeight !== 'number' || !Number.isFinite(v.orthoHeight) || v.orthoHeight < .001 || v.orthoHeight > 100000) throw new Error('相机投影参数无效');
    const pos = v.position as number[], target = v.target as number[], up = v.up as number[];
    if (Math.hypot(...pos.map((n, i) => n - target[i])) < .001 || Math.abs(Math.hypot(...up) - 1) > .001) throw new Error('相机观察方向无效');
    view = { projection: v.projection as SavedView['projection'], position: [...pos], target: [...target], up: [...up], zoom: v.zoom, orthoHeight: v.orthoHeight };
  }
  const rotationCenters: Record<string, GridPos> = {};
  if (data.rotationCenters !== undefined) for (const [id, point] of Object.entries(record(data.rotationCenters, '旋转中心'))) { if (!layerIds.has(id)) throw new Error('旋转中心引用了不存在的组件组'); rotationCenters[id] = coordinates(point); }
  return { version: 3, gridSize: 1, layers, activeLayerId, cubes, view, rotationCenters };
}
