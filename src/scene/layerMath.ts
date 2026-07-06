import * as THREE from 'three';
import { Cube, GridPos, Layer, Rotation } from '../model/types';

const DEG = THREE.MathUtils.degToRad;

/** 把欧拉角（90° 倍数）规整回 [-180,180] 区间的 90° 整数倍。 */
function normDeg(rad: number): number {
  let v = Math.round(THREE.MathUtils.radToDeg(rad) / 90) * 90;
  v = (((v + 180) % 360) + 360) % 360 - 180;
  return v;
}

function eulerOf(r: Rotation): THREE.Euler {
  return new THREE.Euler(DEG(r.x), DEG(r.y), DEG(r.z));
}

function quatOf(r: Rotation): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(eulerOf(r));
}

/** 合成两个 90° 旋转：结果 = a ∘ b（先应用 b，再应用 a）。 */
export function composeRotation(a: Rotation, b: Rotation): Rotation {
  const q = quatOf(a).multiply(quatOf(b));
  const e = new THREE.Euler().setFromQuaternion(q);
  return { x: normDeg(e.x), y: normDeg(e.y), z: normDeg(e.z) };
}

/** 把网格坐标（整数）按 90° 旋转旋转，结果取整（仍为整数格）。 */
export function rotateGridPos(g: GridPos, r: Rotation): GridPos {
  const v = new THREE.Vector3(g.x, g.y, g.z).applyEuler(eulerOf(r));
  return { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) };
}

/** 逆向旋转（用于把世界坐标反算回图层本地坐标）。 */
export function invertRotation(r: Rotation): Rotation {
  return { x: -r.x, y: -r.y, z: -r.z };
}

/**
 * 计算立方体在图层变换下的世界位置与旋转：
 *   worldPos = rotateGridPos(layer.rotation, cube.gridPos) + layer.pos
 *   worldRotation = composeRotation(layer.rotation, cube.rotation)
 * 由于层与立方体旋转均为 90° 倍数，结果仍轴对齐，无浮点漂移。
 */
export function worldTransform(
  cube: Cube,
  layer: Layer
): { pos: GridPos; rotation: Rotation } {
  const rotated = rotateGridPos(cube.gridPos, layer.rotation);
  return {
    pos: {
      x: rotated.x + layer.pos.x,
      y: rotated.y + layer.pos.y,
      z: rotated.z + layer.pos.z,
    },
    rotation: composeRotation(layer.rotation, cube.rotation),
  };
}

/** 把世界网格坐标反算为该图层内的本地网格坐标。 */
export function worldToLocal(g: GridPos, layer: Layer): GridPos {
  const rel = { x: g.x - layer.pos.x, y: g.y - layer.pos.y, z: g.z - layer.pos.z };
  return rotateGridPos(rel, invertRotation(layer.rotation));
}

/** 把图层本地网格坐标（如旋转中心）转换为世界网格坐标。 */
export function layerPointToWorld(local: GridPos, layer: Layer): GridPos {
  const rotated = rotateGridPos(local, layer.rotation);
  return {
    x: rotated.x + layer.pos.x,
    y: rotated.y + layer.pos.y,
    z: rotated.z + layer.pos.z,
  };
}
