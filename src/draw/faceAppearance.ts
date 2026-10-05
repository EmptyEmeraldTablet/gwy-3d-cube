import { FaceId } from '../model/types';

const DEFAULTS: Record<FaceId, string> = { px: '#f4f6fb', nx: '#eef1f7', py: '#f8f9fc', ny: '#e9edf4', pz: '#f2f4f9', nz: '#eceff6' };
export function faceBackground(face: FaceId, color?: string): string { return color ?? DEFAULTS[face]; }

/** Background and ink are composed for display only. Editing always uses transparent ink. */
export function compositeFace(target: HTMLCanvasElement, ink: HTMLCanvasElement, face: FaceId, color?: string): void {
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.fillStyle = faceBackground(face, color); ctx.fillRect(0, 0, target.width, target.height);
  ctx.drawImage(ink, 0, 0, target.width, target.height);
}
