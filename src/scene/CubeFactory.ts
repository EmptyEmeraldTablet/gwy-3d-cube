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
import { cloneNetPreferences } from '../model/netVariants';
import { compositeFace } from '../draw/faceAppearance';

function createFaceCanvas(color?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = FACE_SIZE;
  c.height = FACE_SIZE;
  const ctx = c.getContext('2d')!;
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
    const canvas = createFaceCanvas(color);
    const display = document.createElement('canvas'); display.width = display.height = FACE_SIZE;
    compositeFace(display, canvas, id, color);
    const texture = new THREE.CanvasTexture(display);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const face: Face = { id, canvas, texture };
    faces[id] = face;
    materials.push(
      new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
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
  for (const id of FACE_ORDER) markFaceDirty(cube, id);
}

/** 应用图层的显示/隐藏与不透明度到该层内立方体。 */
export function applyLayerStyle(
  cube: Cube,
  visible: boolean,
  opacity: number
): void {
  cube.mesh.visible = visible && opacity > 0;
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
  compositeFace(cube.faces[id].texture.image as HTMLCanvasElement, cube.faces[id].canvas, id, cube.color);
  cube.faces[id].texture.needsUpdate = true;
}

/** 释放立方体占用的 GPU 资源（材质与纹理）。geometry 为共享单例，不在此释放。 */
const disposedCubes = new WeakSet<Cube>();
export function disposeCube(cube: Cube): void {
  if (disposedCubes.has(cube)) return; disposedCubes.add(cube);
  const mats = cube.mesh.material as THREE.MeshStandardMaterial[];
  for (const m of mats) {
    if (m.map) m.map.dispose();
    m.dispose();
  }
}

function loadImageToCanvas(canvas: HTMLCanvasElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timeout = window.setTimeout(() => { img.onload = img.onerror = null; img.src = ''; reject(new Error('面图片加载超时')); }, 10000);
    img.onerror = () => { clearTimeout(timeout); reject(new Error('面图片无法解码')); };
    img.onload = () => {
      clearTimeout(timeout);
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
  cube.net = cloneNetPreferences(data.net);
  syncMeshTransform(cube);
  try {
    for (const f of FACE_ORDER) {
      const url = data.faces[f];
      if (!url) continue;
      await loadImageToCanvas(cube.faces[f].canvas, url);
      // Older files stored a full face image multiplied by material.color in linear RGB.
      if (data.legacyTint && data.color) {
        const ctx = cube.faces[f].canvas.getContext('2d')!, pixels = ctx.getImageData(0, 0, FACE_SIZE, FACE_SIZE);
        const tint = new THREE.Color(data.color), sample = new THREE.Color();
        for (let i = 0; i < pixels.data.length; i += 4) {
          sample.setRGB(pixels.data[i] / 255, pixels.data[i + 1] / 255, pixels.data[i + 2] / 255, THREE.SRGBColorSpace).multiply(tint).convertLinearToSRGB();
          pixels.data[i] = Math.round(sample.r * 255); pixels.data[i + 1] = Math.round(sample.g * 255); pixels.data[i + 2] = Math.round(sample.b * 255);
        }
        ctx.putImageData(pixels, 0, 0);
      }
      markFaceDirty(cube, f);
    }
  } catch (error) { disposeCube(cube); throw error; }
  return cube;
}
