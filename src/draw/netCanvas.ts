import { FACE_LABELS, FACE_SIZE, FaceId } from '../model/types';
import { NetLayout } from '../model/netVariants';
import { faceBackground } from './faceAppearance';

export type FaceCanvases = Record<FaceId, HTMLCanvasElement>;

function turn(ctx: CanvasRenderingContext2D, degrees: number): void {
  const angle = degrees * Math.PI / 180;
  const cos = Math.round(Math.cos(angle)), sin = Math.round(Math.sin(angle));
  ctx.transform(cos, sin, -sin, cos, 0, 0);
}

/** Pixel data only. All guides live in a separate overlay. */
export function renderNet(faces: FaceCanvases, layout: NetLayout, canvas: HTMLCanvasElement, background?: { color?: string; patterns?: boolean }): void {
  canvas.width = layout.cols * FACE_SIZE; canvas.height = layout.rows * FACE_SIZE;
  const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
  for (const cell of layout.cells) {
    ctx.save(); ctx.translate((cell.col + .5) * FACE_SIZE, (cell.row + .5) * FACE_SIZE); turn(ctx, -cell.rot);
    if (background) { ctx.fillStyle = faceBackground(cell.face, background.color); ctx.fillRect(-FACE_SIZE / 2, -FACE_SIZE / 2, FACE_SIZE, FACE_SIZE); }
    if (background?.patterns !== false) ctx.drawImage(faces[cell.face], -FACE_SIZE / 2, -FACE_SIZE / 2); ctx.restore();
  }
}

export function netBackground(layout: NetLayout, color?: string): string {
  const canvas = document.createElement('canvas'); canvas.width = layout.cols * FACE_SIZE; canvas.height = layout.rows * FACE_SIZE;
  const ctx = canvas.getContext('2d')!;
  for (const cell of layout.cells) { ctx.fillStyle = faceBackground(cell.face, color); ctx.fillRect(cell.col * FACE_SIZE, cell.row * FACE_SIZE, FACE_SIZE, FACE_SIZE); }
  return `url(${canvas.toDataURL()})`;
}

/** Only call after an actual pixel edit, never for a layout-only transition. */
export function extractNet(canvas: HTMLCanvasElement, layout: NetLayout, faces: FaceCanvases): void {
  for (const cell of layout.cells) {
    const target = faces[cell.face], ctx = target.getContext('2d')!;
    ctx.clearRect(0, 0, FACE_SIZE, FACE_SIZE); ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.translate(FACE_SIZE / 2, FACE_SIZE / 2); turn(ctx, cell.rot);
    ctx.drawImage(canvas, cell.col * FACE_SIZE, cell.row * FACE_SIZE, FACE_SIZE, FACE_SIZE, -FACE_SIZE / 2, -FACE_SIZE / 2, FACE_SIZE, FACE_SIZE);
    ctx.restore();
  }
}

export function drawNetGuides(ctx: CanvasRenderingContext2D, layout: NetLayout, selected?: FaceId, labels = true, cuts = true, folds = true): void {
  const S = FACE_SIZE;
  for (const cell of layout.cells) {
    const x = cell.col * S, y = cell.row * S;
    ctx.save(); ctx.strokeStyle = cell.face === selected ? '#2369e8' : '#68758a'; ctx.lineWidth = cell.face === selected ? 6 : 2;
    if (cell.face === selected) ctx.strokeRect(x + 3, y + 3, S - 6, S - 6);
    if (cuts) {
      ctx.strokeStyle = '#68758a'; ctx.lineWidth = 3; ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!layout.cells.some(c => c.col === cell.col + dx && c.row === cell.row + dy)) {
        if (dx) { ctx.moveTo(x + (dx + 1) * S / 2, y); ctx.lineTo(x + (dx + 1) * S / 2, y + S); }
        else { ctx.moveTo(x, y + (dy + 1) * S / 2); ctx.lineTo(x + S, y + (dy + 1) * S / 2); }
      } ctx.stroke();
    }
    if (labels) {
      ctx.fillStyle = cell.face === selected ? '#2369e8' : '#34445e'; ctx.fillRect(x + 8, y + 8, 42, 34);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(FACE_LABELS[cell.face], x + 29, y + 25);
    }
    ctx.restore();
  }
  ctx.save(); ctx.setLineDash([10, 8]); ctx.lineWidth = 3; ctx.strokeStyle = '#cc7824';
  for (const edge of folds ? layout.edges : []) {
    const cell = layout.cells[edge.parent], cx = (cell.col + .5) * S + edge.dx * S / 2, cy = (cell.row + .5) * S - edge.dy * S / 2;
    ctx.beginPath();
    if (edge.dx) { ctx.moveTo(cx, cy - S / 2 + 3); ctx.lineTo(cx, cy + S / 2 - 3); }
    else { ctx.moveTo(cx - S / 2 + 3, cy); ctx.lineTo(cx + S / 2 - 3, cy); }
    ctx.stroke();
  }
  ctx.restore();
}
