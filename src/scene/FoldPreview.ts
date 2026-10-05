import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FACE_LABELS, FACE_ORDER, FaceId } from '../model/types';
import { NetLayout, NetState } from '../model/netVariants';
import { foldTransforms } from '../model/folding';
import { compositeFace } from '../draw/faceAppearance';
import { FaceCanvases } from '../draw/netCanvas';

export class FoldPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, .01, 100);
  private readonly controls: OrbitControls;
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly edges = new THREE.EdgesGeometry(this.geometry);
  private readonly edgeMaterial = new THREE.LineBasicMaterial({ color: 0x78849a });
  private readonly selectedMaterial = new THREE.LineBasicMaterial({ color: 0x2674ff, depthTest: false });
  private readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly outlines: THREE.LineSegments[] = [];
  private readonly labelGeometry = new THREE.PlaneGeometry(.18, .18);
  private readonly labels: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly textures = {} as Record<FaceId, THREE.CanvasTexture>;
  private readonly materials = {} as Record<FaceId, THREE.MeshBasicMaterial>;
  private readonly resize: ResizeObserver;
  private frame = 0;
  private disposed = false;
  private layout: NetLayout | null = null;
  private state: NetState | null = null;
  private progress = 1;
  private selected: FaceId | undefined;
  private showLabels = true;
  private readonly pointer = { x: 0, y: 0 };
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly host: HTMLElement, faces: FaceCanvases, private readonly onPick: (face: FaceId) => void, background?: string) {
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', '可旋转的三维折叠预览'); host.append(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.scene.background = new THREE.Color('#edf2f9');
    this.camera.position.set(4, 3, 6);
    this.controls = new OrbitControls(this.camera, canvas); this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.requestRender());
    for (const face of FACE_ORDER) {
      const composite = document.createElement('canvas'); composite.width = composite.height = 256;
      compositeFace(composite, faces[face], face, background);
      const texture = new THREE.CanvasTexture(composite); texture.colorSpace = THREE.SRGBColorSpace;
      this.textures[face] = texture;
      this.materials[face] = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    }
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.materials[FACE_ORDER[i]]); mesh.matrixAutoUpdate = false;
      const outline = new THREE.LineSegments(this.edges, this.edgeMaterial);
      outline.position.z = .002; mesh.add(outline);
      const labelCanvas = document.createElement('canvas'); labelCanvas.width = labelCanvas.height = 64;
      const ctx = labelCanvas.getContext('2d')!; ctx.fillStyle = '#244b79'; ctx.fillRect(4, 4, 56, 56); ctx.fillStyle = '#fff'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(FACE_LABELS[FACE_ORDER[i]], 32, 34);
      const labelTexture = new THREE.CanvasTexture(labelCanvas); labelTexture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Mesh(this.labelGeometry, new THREE.MeshBasicMaterial({ map: labelTexture, side: THREE.DoubleSide, transparent: true, depthWrite: false })); label.position.set(-.33, .33, .015); mesh.add(label);
      this.meshes.push(mesh); this.outlines.push(outline); this.labels.push(label); this.group.add(mesh);
    }
    this.scene.add(this.group);
    this.resize = new ResizeObserver(() => {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.requestRender();
    }); this.resize.observe(host);
    canvas.addEventListener('pointerdown', e => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; });
    canvas.addEventListener('pointerup', e => {
      if (Math.hypot(e.clientX - this.pointer.x, e.clientY - this.pointer.y) > 5) return;
      const r = canvas.getBoundingClientRect(); this.raycaster.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), this.camera);
      this.group.updateMatrixWorld(true);
      const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
      if (hit) this.onPick(hit.object.userData.face as FaceId);
    });
  }

  setLayout(layout: NetLayout, state: NetState): void { this.layout = layout; this.state = state; this.updateTransforms(); this.fit(); }
  setProgress(value: number): void { this.progress = value; this.updateTransforms(); }
  setSelected(face?: FaceId): void { this.selected = face; this.updateStyles(); }
  setLabels(value: boolean): void { this.showLabels = value; this.updateStyles(); }
  updateTextures(faces: FaceCanvases, background?: string): void {
    for (const face of FACE_ORDER) {
      const canvas = this.textures[face].image as HTMLCanvasElement;
      compositeFace(canvas, faces[face], face, background); this.textures[face].needsUpdate = true;
    }
    this.requestRender();
  }
  private updateTransforms(): void {
    if (!this.layout || !this.state) return;
    const transforms = foldTransforms(this.layout, this.state, this.progress);
    this.layout.cells.forEach((cell, i) => {
      const mesh = this.meshes[i]; mesh.material = this.materials[cell.face]; mesh.userData.face = cell.face;
      mesh.matrix.copy(transforms[i]).multiply(new THREE.Matrix4().makeRotationZ(cell.rot * Math.PI / 180)); mesh.matrixWorldNeedsUpdate = true;
      const labelCanvas = (this.labels[i].material.map!.image as HTMLCanvasElement), ctx = labelCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, 64, 64); ctx.fillStyle = '#244b79'; ctx.fillRect(4, 4, 56, 56); ctx.fillStyle = '#fff'; ctx.font = 'bold 42px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(FACE_LABELS[cell.face], 32, 34); this.labels[i].material.map!.needsUpdate = true;
    });
    this.updateStyles();
  }
  private updateStyles(): void {
    this.meshes.forEach((mesh, i) => { this.outlines[i].material = mesh.userData.face === this.selected ? this.selectedMaterial : this.edgeMaterial; this.labels[i].visible = this.showLabels; }); this.requestRender();
  }
  fit(): void {
    if (!this.layout || !this.state) return;
    // Fit the entire folding sweep once, so playing does not move the camera beneath the user.
    const bounds = new THREE.Box3();
    for (const t of [0, .2, .4, .6, .8, 1]) for (const matrix of foldTransforms(this.layout, this.state, t)) {
      for (const x of [-.5, .5]) for (const y of [-.5, .5]) bounds.expandByPoint(new THREE.Vector3(x, y, 0).applyMatrix4(matrix));
    }
    const center = bounds.getCenter(new THREE.Vector3()), radius = Math.max(.8, bounds.getSize(new THREE.Vector3()).length() / 2);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center); this.camera.position.copy(center).addScaledVector(direction, radius / Math.sin(THREE.MathUtils.degToRad(20)) * 1.15 / Math.min(1, this.camera.aspect)); this.controls.update(); this.requestRender();
  }
  fitCube(): void { this.controls.target.set(0, 0, 0); this.camera.position.set(2.7, 2.1, 3.5); this.controls.update(); this.requestRender(); }
  private requestRender(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; if (!this.disposed) this.renderer.render(this.scene, this.camera); });
  }
  dispose(): void {
    this.disposed = true; cancelAnimationFrame(this.frame); this.resize.disconnect(); this.controls.dispose();
    for (const f of FACE_ORDER) { this.textures[f].dispose(); this.materials[f].dispose(); }
    for (const label of this.labels) { label.material.map?.dispose(); label.material.dispose(); }
    this.geometry.dispose(); this.labelGeometry.dispose(); this.edges.dispose(); this.edgeMaterial.dispose(); this.selectedMaterial.dispose(); this.renderer.dispose(); this.host.replaceChildren();
  }
}
