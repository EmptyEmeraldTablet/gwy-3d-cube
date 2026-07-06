import * as THREE from 'three';
import { FaceId, GridPos, Layer, LOCAL_NORMALS, Rotation } from '../model/types';
import { worldToLocal } from './layerMath';

/**
 * 计算某个面在其立方体当前旋转下，在世界坐标系中指向的轴对齐法线。
 * 由于旋转仅取 90° 倍数，结果必为某一轴向整数向量。
 */
export function worldNormal(rotation: Rotation, faceId: FaceId): THREE.Vector3 {
  const local = LOCAL_NORMALS[faceId];
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rotation.x),
    THREE.MathUtils.degToRad(rotation.y),
    THREE.MathUtils.degToRad(rotation.z)
  );
  return local.clone().applyEuler(euler).round();
}

/**
 * 在“世界旋转”下的 faceId 面上贴面时，返回该相邻位置相对当前位置的网格索引偏移
 * （单位 ±1，按网格索引计，世界位置 = (worldPos + 偏移) * size）。
 * 传入的 rotation 应为立方体在图层变换合成后的世界旋转。
 */
export function attachGridPos(worldRotation: Rotation, faceId: FaceId): GridPos {
  const n = worldNormal(worldRotation, faceId);
  return { x: n.x, y: n.y, z: n.z };
}

/**
 * 把“世界相邻网格位置”反算为某个图层内的本地网格坐标。
 * 用于贴面堆叠：新立方体被加入目标（活动）图层，需要落在活动层的本地坐标系。
 */
export function attachInLayer(worldAdjacent: GridPos, layer: Layer): GridPos {
  return worldToLocal(worldAdjacent, layer);
}

/**
 * 把世界坐标吸附到网格（取 size 整数倍）。
 * 用于根据命中点放置，但本 MVP 主要用 attachGridPos 做对齐堆叠。
 */
export function snapToGrid(world: THREE.Vector3, size: number): GridPos {
  return {
    x: Math.round(world.x / size),
    y: Math.round(world.y / size),
    z: Math.round(world.z / size),
  };
}

/** 浅比较网格坐标是否相等。 */
export function sameGridPos(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
