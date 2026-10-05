import * as THREE from 'three';
import { FACE_ORDER, FaceId, LOCAL_NORMALS } from './types';
import { NET_TEMPLATES, NetCell, NetTemplate } from './net';

export interface NetState {
  templateId: string;
  referenceFace: FaceId;
  referenceTurn: number;
  viewTurn: number;
}

export interface NetPreferences {
  version: 1;
  current: NetState;
  drawing?: NetState;
  bookmarks: NetState[];
}

export const FACE_FRAMES: Record<FaceId, { right: THREE.Vector3; up: THREE.Vector3 }> = {
  px: { right: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  nx: { right: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  py: { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, -1) },
  ny: { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
  pz: { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  nz: { right: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
};

export interface NetEdge {
  parent: number;
  child: number;
  dx: number;
  dy: number; // plane coordinates, up positive
}

export interface NetLayout extends NetTemplate {
  root: number;
  edges: NetEdge[];
}

export const quarter = (value: number): number => ((Math.round(value) % 4) + 4) % 4;
export const defaultNetState = (): NetState => ({ templateId: NET_TEMPLATES[0].id, referenceFace: 'pz', referenceTurn: 0, viewTurn: 0 });

export function netTemplate(id: string): NetTemplate {
  const template = NET_TEMPLATES.find(t => t.id === id);
  if (!template) throw new Error('未知的展开类型');
  return template;
}

/** A stable, central slot is the reference for every shape. Face + directed edge fully specify its frame. */
export function rootCell(template: NetTemplate): number {
  const degree = (c: NetCell) => template.cells.filter(other => Math.abs(c.col - other.col) + Math.abs(c.row - other.row) === 1).length;
  return template.cells.map((cell, index) => ({ cell, index, degree: degree(cell) }))
    .sort((a, b) => b.degree - a.degree || a.cell.row - b.cell.row || a.cell.col - b.cell.col)[0].index;
}

export function referenceFrame(state: NetState): { right: THREE.Vector3; up: THREE.Vector3; normal: THREE.Vector3 } {
  const frame = FACE_FRAMES[state.referenceFace];
  const angle = quarter(state.referenceTurn) * Math.PI / 2;
  return {
    right: frame.right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.up, -Math.sin(angle)).round(),
    up: frame.right.clone().multiplyScalar(Math.sin(angle)).addScaledVector(frame.up, Math.cos(angle)).round(),
    normal: LOCAL_NORMALS[state.referenceFace].clone(),
  };
}

/** Fold a fixed grid into an oriented cube, deriving both face identity and its UV frame together. */
export function netLayout(state: NetState): NetLayout {
  const template = netTemplate(state.templateId);
  const root = rootCell(template);
  const frames = new Map<number, ReturnType<typeof referenceFrame>>([[root, referenceFrame(state)]]);
  const queue = [root];
  const edges: NetEdge[] = [];
  for (let i = 0; i < queue.length; i++) {
    const parent = queue[i], p = template.cells[parent], frame = frames.get(parent)!;
    for (let child = 0; child < template.cells.length; child++) {
      if (frames.has(child)) continue;
      const c = template.cells[child], dx = c.col - p.col, dy = p.row - c.row;
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
      const axis = dx ? frame.up : frame.right;
      const q = new THREE.Quaternion().setFromAxisAngle(axis, (dx || -dy) * Math.PI / 2);
      frames.set(child, {
        right: frame.right.clone().applyQuaternion(q).round(),
        up: frame.up.clone().applyQuaternion(q).round(),
        normal: frame.normal.clone().applyQuaternion(q).round(),
      });
      edges.push({ parent, child, dx, dy });
      queue.push(child);
    }
  }
  if (frames.size !== 6) throw new Error('展开图不连通');
  const cells = template.cells.map((cell, index) => {
    const frame = frames.get(index)!;
    const face = FACE_ORDER.find(f => LOCAL_NORMALS[f].equals(frame.normal));
    if (!face) throw new Error('展开面方向无效');
    const native = FACE_FRAMES[face];
    const rot = quarter(Math.atan2(native.right.dot(frame.up), native.right.dot(frame.right)) / (Math.PI / 2)) * 90;
    return { ...cell, face, rot };
  });
  if (new Set(cells.map(c => c.face)).size !== 6) throw new Error('展开面重叠');
  return { ...template, cells, root, edges };
}

export function netVariants(state: NetState): NetState[] {
  return FACE_ORDER.flatMap(referenceFace => [0, 1, 2, 3].map(referenceTurn => ({ ...state, referenceFace, referenceTurn })));
}

export function rollNet(state: NetState, axis: 'up' | 'right', delta: 1 | -1): NetState {
  const frame = referenceFrame(state);
  const q = new THREE.Quaternion().setFromAxisAngle(frame[axis], delta * Math.PI / 2);
  const normal = frame.normal.applyQuaternion(q).round();
  const right = frame.right.applyQuaternion(q).round();
  const up = frame.up.applyQuaternion(q).round();
  const referenceFace = FACE_ORDER.find(f => LOCAL_NORMALS[f].equals(normal))!;
  const native = FACE_FRAMES[referenceFace];
  const referenceTurn = quarter(Math.atan2(native.right.dot(up), native.right.dot(right)) / (Math.PI / 2));
  return { ...state, referenceFace, referenceTurn };
}

export function switchNetType(state: NetState, templateId: string): NetState {
  netTemplate(templateId);
  return { ...state, templateId };
}

/** Preserve existing face/UV assignments when opening a legacy template. */
export function stateFromTemplate(template: NetTemplate): NetState {
  const root = template.cells[rootCell(template)];
  return { templateId: template.id, referenceFace: root.face, referenceTurn: quarter(root.rot / 90), viewTurn: 0 };
}

export function validNetState(value: unknown): value is NetState {
  if (!value || typeof value !== 'object') return false;
  const s = value as NetState;
  return NET_TEMPLATES.some(t => t.id === s.templateId) && FACE_ORDER.includes(s.referenceFace)
    && [0, 1, 2, 3].includes(s.referenceTurn) && [0, 1, 2, 3].includes(s.viewTurn);
}

export function cloneNetPreferences(value: NetPreferences | undefined): NetPreferences | undefined {
  return value ? JSON.parse(JSON.stringify(value)) as NetPreferences : undefined;
}
