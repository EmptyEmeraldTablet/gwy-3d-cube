import * as THREE from 'three';
import type { NetPreferences } from './netVariants';

/** 立方体六个面的标识，按 BoxGeometry 材质组的固定顺序。 */
export type FaceId = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

/** 与 THREE.BoxGeometry 的 material groups 顺序一致：+X,-X,+Y,-Y,+Z,-Z。 */
export const FACE_ORDER: FaceId[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export const FACE_LABELS: Record<FaceId, string> = { pz: 'A', px: 'B', nz: 'C', nx: 'D', py: 'E', ny: 'F' };
export const FACE_NAMES: Record<FaceId, string> = { pz: '前', px: '右', nz: '后', nx: '左', py: '上', ny: '下' };

/** 每个面对应的局部法线（未旋转前）。 */
export const LOCAL_NORMALS: Record<FaceId, THREE.Vector3> = {
  px: new THREE.Vector3(1, 0, 0),
  nx: new THREE.Vector3(-1, 0, 0),
  py: new THREE.Vector3(0, 1, 0),
  ny: new THREE.Vector3(0, -1, 0),
  pz: new THREE.Vector3(0, 0, 1),
  nz: new THREE.Vector3(0, 0, -1),
};

/** 单个可绘制面：持有独立的 2D 绘制源与回写 3D 的纹理。 */
export interface Face {
  id: FaceId;
  canvas: HTMLCanvasElement; // 绘制源，默认 256×256
  texture: THREE.CanvasTexture; // 回写 3D 材质
}

export interface GridPos {
  x: number;
  y: number;
  z: number;
}

export interface Rotation {
  x: number; // 90 的倍数
  y: number;
  z: number;
}

/** 一个立方体实例。 */
export interface Cube {
  id: string;
  gridPos: GridPos; // 图层内的本地网格坐标（吸附为整数）
  size: number; // 边长，默认 1
  rotation: Rotation; // 三轴 90° 倍数（图层内的本地旋转）
  faces: Record<FaceId, Face>;
  mesh: THREE.Mesh;
  layerId: string; // 所属图层
  color?: string; // 统一底色（hex）；undefined 表示使用默认逐面灰底
  net?: NetPreferences;
}

/**
 * 空间图层：一组立方体共享的整体变换。
 * pos 为整层平移（整数格），rotation 为整层旋转（90° 倍数）。
 * 不同图层允许在空间上重叠/穿插（仅视觉重叠，不做几何合并）。
 */
export interface Layer {
  id: string;
  name: string;
  pos: GridPos; // 整层平移（整数格）
  rotation: Rotation; // 整层旋转（90° 倍数）
  visible: boolean;
  opacity: number; // 0..1
}

/** 整个场景的可序列化数据。 */
export interface SceneModel {
  cubes: Cube[];
  layers: Layer[];
  activeLayerId: string;
  gridSize: number; // 网格单位边长
}

export const DEFAULT_LAYER_ID = 'layer-default';

let layerCounter = 0;
const usedLayerIds = new Set<string>();
export function nextLayerId(): string {
  do { layerCounter += 1; } while (usedLayerIds.has(`layer-${layerCounter}`));
  const id = `layer-${layerCounter}`;
  usedLayerIds.add(id);
  return id;
}

/**
 * 加载场景后同步计数器，避免后续 nextLayerId() 生成与已加载图层冲突的ID。
 * 扫描形如 layer-N 的 id，将内部计数器提升到最大 N（layer-default 不计）。
 */
export function syncLayerIdCounter(ids: string[]): void {
  let max = layerCounter;
  for (const id of ids) {
    usedLayerIds.add(id);
    const m = /^layer-(\d+)$/.exec(id);
    if (m && Number(m[1]) < 1e9) max = Math.max(max, Number(m[1]));
  }
  layerCounter = max;
}

/** 创建默认图层（场景初始唯一图层）。 */
export function createDefaultLayer(): Layer {
  return {
    id: DEFAULT_LAYER_ID,
    name: '图层 1',
    pos: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    visible: true,
    opacity: 1,
  };
}

export const FACE_SIZE = 256;

let cubeCounter = 0;
const usedCubeIds = new Set<string>();
export function nextCubeId(): string {
  do { cubeCounter += 1; } while (usedCubeIds.has(`cube-${cubeCounter}`));
  const id = `cube-${cubeCounter}`; usedCubeIds.add(id); return id;
}

export function syncCubeIdCounter(ids: string[]): void {
  for (const id of ids) {
    usedCubeIds.add(id);
    const match = /^cube-(\d+)$/.exec(id);
    if (match && Number(match[1]) < 1e9) cubeCounter = Math.max(cubeCounter, Number(match[1]));
  }
}
