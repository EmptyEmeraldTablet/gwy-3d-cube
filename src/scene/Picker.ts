import * as THREE from 'three';
import { Cube, FaceId, FACE_ORDER } from '../model/types';

export interface PickResult {
  cube: Cube;
  faceId: FaceId;
  /** 命中点（世界坐标），用于堆叠计算。 */
  point: THREE.Vector3;
}

/**
 * 射线拾取：给定屏幕 NDC 坐标，返回命中的立方体与具体面。
 * 面由 BoxGeometry 的 faceIndex 映射到 FaceId（材质组顺序固定）。
 */
export class Picker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly viewer: { camera: THREE.Camera; scene: THREE.Scene };
  private cubes: Cube[];

  constructor(
    viewer: { camera: THREE.Camera; scene: THREE.Scene },
    cubes: Cube[]
  ) {
    this.viewer = viewer;
    this.cubes = cubes;
  }

  setCubes(cubes: Cube[]): void {
    this.cubes = cubes;
  }

  pick(ndc: THREE.Vector2): PickResult | null {
    this.raycaster.setFromCamera(ndc, this.viewer.camera);
    const meshes = this.cubes.map((c) => c.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;

    const hit = hits[0];
    const mesh = hit.object as THREE.Mesh;
    const cube = this.cubes.find((c) => c.mesh === mesh);
    if (!cube) return null;

    const faceIndex = hit.face ? hit.face.materialIndex : Math.floor(hit.faceIndex! / 2);
    const faceId = FACE_ORDER[faceIndex] ?? FACE_ORDER[0];
    return {
      cube,
      faceId,
      point: hit.point.clone(),
    };
  }
}
