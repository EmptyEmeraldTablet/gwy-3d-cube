import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Cube, FaceId, LOCAL_NORMALS } from '../model/types';
import { FACE_FRAMES } from '../model/netVariants';
import type { SavedView } from '../model/serialize';

export type StandardView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso';

/**
 * 负责 Three.js 场景的承载：场景、相机、渲染器、灯光、网格、轨道控制器与渲染循环。
 */
export class Viewer {
  readonly scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  controls: OrbitControls; // 可变：resetInteraction() 会重建以清除卡死的拖拽状态
  readonly canvas: HTMLCanvasElement;

  private readonly gridHelper: THREE.GridHelper;
  private readonly gridSize = 1; // 每格边长 = 立方体 size
  private gridExtent = 20; // 网格显示范围（格数半径）

  /** 旋转中心可视化标记（临时参考，不持久化）。 */
  private readonly centerMarker: THREE.AxesHelper;
  /** 操作预览线框组（悬停按钮时显示目标边界）。 */
  private readonly previewGroup: THREE.Group;
  private readonly previewEdges: THREE.EdgesGeometry;
  private readonly previewLineMat: THREE.LineBasicMaterial;

  /** 按需渲染脏标志：仅在场景/相机变化时为真，渲染后清零。 */
  private needsRender = true;
  /** 是否存在未结束的 OrbitControls 交互（用于检测拖拽卡死）。 */
  private pointerDown = false;
  private frame = 0;
  private running = false;
  private renderHook?: () => void;
  private readonly resizeObserver: ResizeObserver;
  private orthoHeight = 8;
  private readonly faceOutline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0x51a1ff, depthTest: false }));

  private readonly onResizeBound = () => this.onResize();
  private readonly onLostCaptureBound = () => this.onLostCapture();
  private readonly onWindowPointerUpBound = () => {
    // 在 OrbitControls 自身 pointerup 处理之后再检查（其 'end' 事件会同步清 pointerDown）
    queueMicrotask(() => {
      if (this.pointerDown) this.resetInteraction();
    });
  };
  private readonly onBlurBound = () => {
    if (this.pointerDown) this.resetInteraction();
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1d23);

    this.camera = new THREE.PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(6, 6, 8);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // preserveDrawingBuffer 默认 false：避免常态性能税。
      // takeScreenshot() 已在 toDataURL 前同步 render()，截图仍可正常工作。
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    // 灯光：环境光 + 两个方向光，保证各面可见
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(5, 10, 7);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-5, -3, -6);
    this.scene.add(fill);

    // 地面网格
    this.gridHelper = new THREE.GridHelper(
      this.gridExtent * 2,
      this.gridExtent * 2,
      0x4a7dff,
      0x333842
    );
    (this.gridHelper.material as THREE.Material).transparent = true;
    (this.gridHelper.material as THREE.Material).opacity = 0.6;
    this.scene.add(this.gridHelper);
    this.gridHelper.position.y = -.5;
    this.gridHelper.userData.guide = true;
    this.faceOutline.visible = false; this.faceOutline.renderOrder = 1000; this.faceOutline.userData.guide = true; this.scene.add(this.faceOutline);

    // 旋转中心标记：坐标轴，穿透立方体可见，默认隐藏
    this.centerMarker = new THREE.AxesHelper(0.6);
    this.centerMarker.renderOrder = 999;
    const cm = this.centerMarker.material as THREE.LineBasicMaterial;
    cm.depthTest = false;
    cm.transparent = true;
    this.centerMarker.visible = false;
    this.scene.add(this.centerMarker);
    this.centerMarker.userData.guide = true;

    // 操作预览线框：共享几何与材质，clear 时不释放，长期复用无泄漏
    this.previewEdges = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize)
    );
    this.previewLineMat = new THREE.LineBasicMaterial({ color: 0xffaa00 });
    this.previewGroup = new THREE.Group();
    this.previewGroup.visible = false;
    this.scene.add(this.previewGroup);
    this.previewGroup.userData.guide = true;

    this.controls = this.createControls();
    this.controls.target.set(0, 2, 0);
    this.controls.update();

    // 捕获被浏览器隐式释放（lostpointercapture）而 OrbitControls 未收到 pointerup 时自动恢复
    this.canvas.addEventListener('lostpointercapture', this.onLostCaptureBound);
    // 兜底：pointerup 未被 OrbitControls 处理（end 未派发）时恢复
    window.addEventListener('pointerup', this.onWindowPointerUpBound);
    // 窗口失焦时若仍处于拖拽，恢复
    window.addEventListener('blur', this.onBlurBound);
    window.addEventListener('resize', this.onResizeBound);
    this.resizeObserver = new ResizeObserver(this.onResizeBound); this.resizeObserver.observe(canvas);
  }

  /** 创建并配置 OrbitControls（构造器与 resetInteraction 共用）。 */
  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // 相机移动即置脏（含拖拽与阻尼惯性收敛过程）
    controls.addEventListener('change', () => {
      this.requestRender();
    });
    controls.addEventListener('start', () => {
      this.pointerDown = true;
    });
    controls.addEventListener('end', () => {
      this.pointerDown = false;
    });
    return controls;
  }

  /** 把网格坐标转换为世界坐标（格中心）。 */
  gridToWorld(gx: number, gy: number, gz: number): THREE.Vector3 {
    return new THREE.Vector3(gx * this.gridSize, gy * this.gridSize, gz * this.gridSize);
  }

  getGridSize(): number {
    return this.gridSize;
  }

  // ---------- 旋转中心标记 ----------

  /** 设置旋转中心标记的世界坐标。 */
  setCenterMarkerWorld(pos: THREE.Vector3): void {
    this.centerMarker.position.copy(pos);
    this.requestRender();
  }

  /** 显示/隐藏旋转中心标记。 */
  setCenterMarkerVisible(v: boolean): void {
    this.centerMarker.visible = v;
    this.requestRender();
  }

  // ---------- 操作预览线框 ----------

  /** 显示若干立方体目标位置的线框轮廓（橙色）。 */
  showPreviewCubes(items: { pos: THREE.Vector3; rot: THREE.Euler }[]): void {
    this.previewGroup.clear();
    for (const it of items) {
      const seg = new THREE.LineSegments(this.previewEdges, this.previewLineMat);
      seg.position.copy(it.pos);
      seg.rotation.copy(it.rot);
      this.previewGroup.add(seg);
    }
    this.previewGroup.visible = true;
    this.requestRender();
  }

  /** 清除预览线框。 */
  clearPreview(): void {
    this.previewGroup.clear();
    this.previewGroup.visible = false;
    this.requestRender();
  }

  /**
   * 返回当前相机视角下的屏幕坐标轴（世界坐标）：
   * up 为屏幕上方向，right 为屏幕右方向。
   * 用于让旋转操作相对于观察视角，更符合直觉。
   */
  getScreenAxes(): { up: THREE.Vector3; right: THREE.Vector3 } {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    return { up, right };
  }

  private onResize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    if (this.camera instanceof THREE.PerspectiveCamera) this.camera.aspect = w / h;
    else { this.camera.left = -this.orthoHeight * w / h / 2; this.camera.right = -this.camera.left; this.camera.top = this.orthoHeight / 2; this.camera.bottom = -this.camera.top; }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.requestRender();
  }

  /** 标记场景需要重绘（外部视觉变更后调用）。 */
  requestRender(): void {
    this.needsRender = true;
    if (this.running && !this.frame) this.frame = requestAnimationFrame(() => this.renderFrame());
  }

  /**
   * 强制释放可能卡死的拖拽状态：销毁并重建 OrbitControls，
   * 保留当前相机视角与控制目标。用于 Escape 指令与自动恢复。
   */
  resetInteraction(): void {
    const target = this.controls.target.clone();
    this.controls.dispose(); // 移除残留的 pointermove/pointerup 监听
    this.controls = this.createControls();
    this.controls.target.copy(target);
    this.controls.update();
    this.pointerDown = false;
    this.requestRender();
  }

  private onLostCapture(): void {
    // 指针捕获被隐式释放且 OrbitControls 未派发 end（pointerDown 仍为真）→ 视为卡死
    queueMicrotask(() => { if (this.pointerDown) this.resetInteraction(); });
  }

  /** 启动渲染循环（限帧 60 FPS，按需渲染）。 */
  start(renderHook?: () => void): void {
    this.running = true; this.renderHook = renderHook; this.requestRender();
  }

  private renderFrame(): void {
    this.frame = 0;
    if (!this.running) return;
    this.controls.update();
    if (this.needsRender) { this.needsRender = false; this.renderHook?.(); this.renderer.render(this.scene, this.camera); }
  }

  setProjection(mode: 'perspective' | 'orthographic'): void {
    if ((mode === 'perspective') === (this.camera instanceof THREE.PerspectiveCamera)) return;
    const old = this.camera, target = this.controls.target.clone();
    this.controls.dispose();
    this.camera = mode === 'perspective' ? new THREE.PerspectiveCamera(50, 1, .1, 1000) : new THREE.OrthographicCamera(-4, 4, 4, -4, .1, 1000);
    this.camera.position.copy(old.position); this.camera.up.copy(old.up); this.camera.quaternion.copy(old.quaternion);
    this.controls = this.createControls(); this.controls.target.copy(target); this.onResize(); this.fit();
  }

  setView(view: StandardView): void {
    const direction: Record<StandardView, [number, number, number]> = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], iso: [1, 1, 1] };
    this.camera.up.set(0, 1, 0);
    if (view === 'top') this.camera.up.set(0, 0, -1);
    if (view === 'bottom') this.camera.up.set(0, 0, 1);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(...direction[view]).multiplyScalar(8));
    this.resetInteraction(); this.fit();
  }

  fit(): void {
    const bounds = new THREE.Box3(); this.scene.updateMatrixWorld(true);
    this.scene.traverse(object => { if (object instanceof THREE.Mesh && object.userData.cubeId && object.visible) bounds.union(new THREE.Box3().setFromObject(object)); });
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const center = bounds.getCenter(new THREE.Vector3()), radius = Math.max(.8, bounds.getSize(new THREE.Vector3()).length() / 2);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const aspect = Math.max(.2, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    this.orthoHeight = radius * 2.5 / Math.min(aspect, 1);
    this.controls.target.copy(center); this.camera.position.copy(center).addScaledVector(direction, radius / Math.sin(THREE.MathUtils.degToRad(25)) * 1.3 / Math.min(aspect, 1));
    this.camera.far = Math.max(1000, this.camera.position.distanceTo(center) + radius * 3);
    this.camera.zoom = 1; this.controls.update(); this.onResize();
  }

  setFaceSelection(cube: Cube | null, face?: FaceId): void {
    this.faceOutline.visible = !!cube && !!face && cube.mesh.visible;
    if (cube && face) {
      const frame = FACE_FRAMES[face];
      const localQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(frame.right, frame.up, LOCAL_NORMALS[face]));
      this.faceOutline.quaternion.copy(cube.mesh.quaternion).multiply(localQ);
      this.faceOutline.position.copy(LOCAL_NORMALS[face]).multiplyScalar(cube.size * .503).applyQuaternion(cube.mesh.quaternion).add(cube.mesh.position);
      this.faceOutline.scale.setScalar(cube.size * .98);
    }
    this.requestRender();
  }

  setQuality(ratio: number): void { this.renderer.setPixelRatio(Math.min(devicePixelRatio, ratio)); this.onResize(); }

  saveView(): SavedView { return { projection: this.camera instanceof THREE.PerspectiveCamera ? 'perspective' : 'orthographic', position: this.camera.position.toArray(), target: this.controls.target.toArray(), up: this.camera.up.toArray(), zoom: this.camera.zoom, orthoHeight: this.orthoHeight }; }
  restoreView(view: SavedView): void {
    this.setProjection(view.projection); this.camera.position.fromArray(view.position); this.camera.up.fromArray(view.up); this.controls.target.fromArray(view.target); this.orthoHeight = view.orthoHeight; this.camera.zoom = view.zoom; this.resetInteraction(); this.onResize();
    this.camera.far = Math.max(1000, this.camera.position.distanceTo(this.controls.target) * 4); this.camera.updateProjectionMatrix();
    const input = document.querySelector<HTMLSelectElement>('[aria-label="相机投影"]'); if (input) input.value = view.projection;
  }

  /** 把屏幕坐标转换为归一化设备坐标。 */
  toNDC(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  /** 截图：返回当前画面的 PNG dataURL。 */
  takeScreenshot(): string {
    const guides: THREE.Object3D[] = []; this.scene.traverse(object => { if (object.userData.guide && object.visible) { guides.push(object); object.visible = false; } });
    this.renderer.render(this.scene, this.camera);
    const result = this.renderer.domElement.toDataURL('image/png');
    for (const guide of guides) guide.visible = true; this.requestRender(); return result;
  }

  dispose(): void {
    this.running = false; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.onResizeBound);
    window.removeEventListener('pointerup', this.onWindowPointerUpBound);
    window.removeEventListener('blur', this.onBlurBound);
    this.canvas.removeEventListener('lostpointercapture', this.onLostCaptureBound);
    this.controls.dispose();
    this.gridHelper.geometry.dispose();
    for (const material of Array.isArray(this.gridHelper.material) ? this.gridHelper.material : [this.gridHelper.material]) material.dispose();
    this.centerMarker.geometry.dispose(); (this.centerMarker.material as THREE.Material).dispose();
    this.previewEdges.dispose(); this.previewLineMat.dispose(); this.faceOutline.geometry.dispose(); (this.faceOutline.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
