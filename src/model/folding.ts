import * as THREE from 'three';
import { NetLayout, NetState, referenceFrame } from './netVariants';

/** Rigid hinge transforms, expressed in the original labelled cube's coordinate frame. */
export function foldTransforms(layout: NetLayout, state: NetState, progress: number, sequential = true): THREE.Matrix4[] {
  const t = THREE.MathUtils.clamp(progress, 0, 1), frame = referenceFrame(state);
  const matrices = Array.from({ length: 6 }, () => new THREE.Matrix4());
  matrices[layout.root].makeBasis(frame.right, frame.up, frame.normal).setPosition(frame.normal.clone().multiplyScalar(.5));
  layout.edges.forEach((edge, index) => {
    // Fold descendants first so each step turns one rigid, already-connected branch.
    const step = layout.edges.length - 1 - index;
    const amount = sequential ? THREE.MathUtils.clamp(t * layout.edges.length - step, 0, 1) : t;
    const h = new THREE.Vector3(edge.dx / 2, edge.dy / 2, 0);
    const rotation = edge.dx ? new THREE.Matrix4().makeRotationY(edge.dx * amount * Math.PI / 2) : new THREE.Matrix4().makeRotationX(-edge.dy * amount * Math.PI / 2);
    const local = new THREE.Matrix4().makeTranslation(h.x, h.y, 0).multiply(rotation).multiply(new THREE.Matrix4().makeTranslation(h.x, h.y, 0));
    matrices[edge.child].copy(matrices[edge.parent]).multiply(local);
  });
  return matrices;
}
