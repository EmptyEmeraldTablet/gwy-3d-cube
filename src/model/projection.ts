import * as THREE from 'three';
import { Cube, FaceId, FACE_ORDER, Layer, LOCAL_NORMALS } from './types';
import { FACE_FRAMES } from './netVariants';
import { worldTransform } from '../scene/layerMath';

export const PROJECTION_VIEWS = {
  front: { name: '正视图', axes: '右 +X · 上 +Y · 从前向后看', right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] },
  top: { name: '俯视图', axes: '右 +X · 上 −Z · 从上向下看', right: [1, 0, 0], up: [0, 0, -1], normal: [0, 1, 0] },
  right: { name: '右视图', axes: '右 −Z · 上 +Y · 从右向左看', right: [0, 0, -1], up: [0, 1, 0], normal: [1, 0, 0] },
} as const;
export type ProjectionView = keyof typeof PROJECTION_VIEWS;
export interface ProjectionSource { cubeId: string; face: FaceId; depth: number; imageMatrix: [number, number, number, number]; }
export interface ProjectionCell { x: number; y: number; sources: ProjectionSource[]; depthCount: number; }
export interface Projection { view: ProjectionView; cells: ProjectionCell[]; minX: number; maxX: number; minY: number; maxY: number; }

/** Project world grid occupancy, preserving every source along each viewing ray. */
export function projectCubes(cubes: Cube[], layers: Layer[], view: ProjectionView): Projection {
  const spec = PROJECTION_VIEWS[view], right = new THREE.Vector3(...spec.right), up = new THREE.Vector3(...spec.up), normal = new THREE.Vector3(...spec.normal);
  const cells = new Map<string, ProjectionCell>(), byId = new Map(layers.map(l => [l.id, l]));
  for (const cube of cubes) {
    const layer = byId.get(cube.layerId); if (!layer?.visible || layer.opacity <= 0) continue;
    const world = worldTransform(cube, layer), point = new THREE.Vector3(world.pos.x, world.pos.y, world.pos.z);
    const euler = new THREE.Euler(...[world.rotation.x, world.rotation.y, world.rotation.z].map(THREE.MathUtils.degToRad) as [number, number, number]);
    const x = Math.round(point.dot(right)), y = Math.round(point.dot(up)), depth = Math.round(point.dot(normal));
    const face = FACE_ORDER.find(f => LOCAL_NORMALS[f].clone().applyEuler(euler).dot(normal) > .99)!;
    const r = FACE_FRAMES[face].right.clone().applyEuler(euler), u = FACE_FRAMES[face].up.clone().applyEuler(euler);
    const source: ProjectionSource = { cubeId: cube.id, face, depth, imageMatrix: [r.dot(right), -r.dot(up), -u.dot(right), u.dot(up)].map(Math.round) as [number, number, number, number] };
    const key = `${x},${y}`, cell = cells.get(key) ?? { x, y, sources: [], depthCount: 0 };
    cell.sources.push(source); cells.set(key, cell);
  }
  const list = [...cells.values()];
  for (const cell of list) { cell.sources.sort((a, b) => b.depth - a.depth || layers.findIndex(l => l.id === cubes.find(c => c.id === a.cubeId)!.layerId) - layers.findIndex(l => l.id === cubes.find(c => c.id === b.cubeId)!.layerId)); cell.depthCount = new Set(cell.sources.map(s => s.depth)).size; }
  return { view, cells: list, minX: list.length ? Math.min(...list.map(c => c.x)) : 0, maxX: list.length ? Math.max(...list.map(c => c.x)) : 0, minY: list.length ? Math.min(...list.map(c => c.y)) : 0, maxY: list.length ? Math.max(...list.map(c => c.y)) : 0 };
}
