import * as THREE from 'three';
import {
  Cube,
  DEFAULT_LAYER_ID,
  Face,
  FaceId,
  FACE_ORDER,
  FACE_SIZE,
  GridPos,
  Rotation,
  nextCubeId,
} from '../model/types';
import { SerializedCube } from '../model/serialize';

/** 每个面的默认底色（略带区分，便于观察）。 */
const FACE_BASE_COLORS: Record<FaceId, string> = {
  px: '#f4f6fb',
  nx: '#eef1f7',
  py: '#f8f9fc',
  ny: '#e9edf4',
  pz: '#f2f4f9',
  nz: '#eceff6',
};

function createFaceCanvas(id: FaceId, color?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = FACE_SIZE;
  c.height = FACE_SIZE;
  const ctx = c.getContext('2d')!;
  // 单色模式下把面底填白，由 material.color 统一着色得到纯净纯色；
  // 默认模式用浅灰底（各面略有区分，便于观察）。
  ctx.fillStyle = color ? '#ffffff' : FACE_BASE_COLORS[id];
  ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
  // 边框便于辨识面边界
  ctx.strokeStyle = color ? 'rgba(0,0,0,0.18)' : '#c4ccda';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, FACE_SIZE - 6, FACE_SIZE - 6);
  return c;
}

/** 共享 BoxGeometry：所有同尺寸立方体复用同一份，减少 GPU buffer 上传与内存。 */
const geometryCache = new Map<number, THREE.BoxGeometry>();
function getBoxGeometry(size: number): THREE.BoxGeometry {
  let g = geometryCache.get(size);
  if (!g) {
    g = new THREE.BoxGeometry(size, size, size);
    geometryCache.set(size, g);
  }
  return g;
}

export interface CreateCubeOpts {
  color?: string;
  layerId?: string;
}

/**
 * 创建带 6 个独立可绘制面的立方体，并返回数据对象。
 * 网格坐标 gridPos 为图层内本地坐标，最终世界位置由图层变换叠加得到。
 */
export function createCube(
  gridPos: GridPos,
  size: number,
  opts: CreateCubeOpts = {}
): Cube {
  const { color, layerId } = opts;
  const faces = {} as Record<FaceId, Face>;
  const materials: THREE.MeshStandardMaterial[] = [];

  for (const id of FACE_ORDER) {
    const canvas = createFaceCanvas(id, color);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const face: Face = { id, canvas, texture };
    faces[id] = face;
    materials.push(
      new THREE.MeshStandardMaterial({
        map: texture,
        color: color ? new THREE.Color(color) : new THREE.Color(0xffffff),
        roughness: 0.85,
        metalness: 0.0,
      })
    );
  }

  const geometry = getBoxGeometry(size);
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.userData.cubeId = nextCubeId();

  const cube: Cube = {
    id: mesh.userData.cubeId,
    gridPos: { ...gridPos },
    size,
    rotation: { x: 0, y: 0, z: 0 },
    faces,
    mesh,
    layerId: layerId ?? DEFAULT_LAYER_ID,
    color,
  };

  syncMeshTransform(cube);
  return cube;
}

/**
 * 把立方体的世界位置/旋转同步到 Mesh。
 * 不传 world 时使用立方体本地 gridPos/rotation（兼容旧调用与无图层场景）。
 */
export function syncMeshTransform(
  cube: Cube,
  world?: { pos: GridPos; rotation: Rotation }
): void {
  const pos = world?.pos ?? cube.gridPos;
  const rot = world?.rotation ?? cube.rotation;
  cube.mesh.position.set(
    pos.x * cube.size,
    pos.y * cube.size,
    pos.z * cube.size
  );
  cube.mesh.rotation.set(
    THREE.MathUtils.degToRad(rot.x),
    THREE.MathUtils.degToRad(rot.y),
    THREE.MathUtils.degToRad(rot.z)
  );
}

/** 设置/清除立方体统一底色（纯色作底色，保留逐面 2D 绘制）。 */
export function setCubeColor(cube: Cube, color?: string): void {
  cube.color = color;
  const c = color ? new THREE.Color(color) : new THREE.Color(0xffffff);
  for (const m of cube.mesh.material as THREE.MeshStandardMaterial[]) {
    m.color.copy(c);
  }
}

/** 应用图层的显示/隐藏与不透明度到该层内立方体。 */
export function applyLayerStyle(
  cube: Cube,
  visible: boolean,
  opacity: number
): void {
  cube.mesh.visible = visible;
  const transparent = opacity < 1 - 1e-3;
  const mats = cube.mesh.material as THREE.MeshStandardMaterial[];
  for (const m of mats) {
    const wasTransparent = m.transparent;
    m.transparent = transparent;
    m.opacity = opacity;
    m.depthWrite = !transparent;
    // opacity 是 uniform，每帧即可生效无需重编译；仅 transparent 状态真正翻转时才需重编译着色器
    if (wasTransparent !== transparent) m.needsUpdate = true;
  }
}

/** 标记某面纹理需要更新（2D 绘制提交后调用）。 */
export function markFaceDirty(cube: Cube, id: FaceId): void {
  cube.faces[id].texture.needsUpdate = true;
}

/** 高亮/取消高亮选中立方体（描边通过材质 emissive 实现）。 */
export function setCubeHighlight(cube: Cube | null, on: boolean): void {
  if (!cube) return;
  const mats = cube.mesh.material as THREE.MeshStandardMaterial[];
  for (const m of mats) {
    m.emissive.set(on ? 0x224488 : 0x000000);
    m.emissiveIntensity = on ? 0.6 : 1;
  }
}

/** 释放立方体占用的 GPU 资源（材质与纹理）。geometry 为共享单例，不在此释放。 */
export function disposeCube(cube: Cube): void {
  const mats = cube.mesh.material as THREE.MeshStandardMaterial[];
  for (const m of mats) {
    if (m.map) m.map.dispose();
    m.dispose();
  }
}

function loadImageToCanvas(canvas: HTMLCanvasElement, url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    img.src = url;
  });
}

/** 从序列化数据重建一个立方体（异步加载各面图片）。 */
export async function createCubeFromData(data: SerializedCube): Promise<Cube> {
  const cube = createCube(data.gridPos, data.size, {
    color: data.color,
    layerId: data.layerId ?? DEFAULT_LAYER_ID,
  });
  cube.id = data.id;
  cube.mesh.userData.cubeId = data.id;
  cube.rotation = { ...data.rotation };
  syncMeshTransform(cube);
  for (const f of FACE_ORDER) {
    const url = data.faces[f];
    if (!url) continue;
    await loadImageToCanvas(cube.faces[f].canvas, url);
    cube.faces[f].texture.needsUpdate = true;
  }
  return cube;
}

/**
 * 绕世界坐标轴 axis 旋转立方体 90° 的整数倍（屏幕相对旋转用）。
 * 通过四元数在世界空间叠加旋转，再把结果规整回 90° 倍数的欧拉角，
 * 确保 cube.rotation 始终为轴对齐整数值（堆叠计算依赖此约束）。
 */
export function rotateWorldAxis(cube: Cube, axis: THREE.Vector3, deg: number): void {
  const qDelta = new THREE.Quaternion().setFromAxisAngle(
    axis.clone().normalize(),
    THREE.MathUtils.degToRad(deg)
  );
  const e = new THREE.Euler(
    THREE.MathUtils.degToRad(cube.rotation.x),
    THREE.MathUtils.degToRad(cube.rotation.y),
    THREE.MathUtils.degToRad(cube.rotation.z)
  );
  const q = new THREE.Quaternion().setFromEuler(e);
  q.premultiply(qDelta); // 世界空间旋转

  const ne = new THREE.Euler().setFromQuaternion(q);
  const norm = (rad: number): number => {
    let v = Math.round(THREE.MathUtils.radToDeg(rad) / 90) * 90;
    v = (((v + 180) % 360) + 360) % 360 - 180; // 归一化到 [-180,180]
    return v;
  };
  cube.rotation.x = norm(ne.x);
  cube.rotation.y = norm(ne.y);
  cube.rotation.z = norm(ne.z);
}
