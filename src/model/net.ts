import * as THREE from 'three';
import { FaceId, FACE_ORDER, LOCAL_NORMALS } from './types';

/** 展开图中一个面所在的格子与朝向（rot 为相对根面的 2D 旋转角，单位度）。 */
export interface NetCell {
  face: FaceId;
  col: number;
  row: number;
  rot: number; // 数学坐标系（y 向上）下的 2D 旋转角，90 的整数倍
}

/** 正方体展开图模板。 */
export interface NetTemplate {
  id: string;
  name: string;
  cols: number;
  rows: number;
  cells: NetCell[];
}

type Side = 'R' | 'L' | 'U' | 'D';

// ---------------------------------------------------------------------------
// 每个面在 BoxGeometry 局部坐标系下的纹理方向（由 BoxGeometry 的 UV 推导）。
// canvasRight3D：纹理 x+（右）对应的 3D 方向；canvasUp3D：纹理 y+（下）对应
// 的 3D 反方向，即屏幕“上”对应的 3D 方向。两者均与各自法线构成右手系。
// ---------------------------------------------------------------------------
const FRAME: Record<FaceId, { right: THREE.Vector3; up: THREE.Vector3 }> = {
  px: { right: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  nx: { right: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  py: { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, -1) },
  ny: { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
  pz: { right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  nz: { right: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
};

/** 给定面与其一个边方向，返回该方向在 3D 中“朝外跨过该边”所到达的相邻面。 */
function neighbor(f: FaceId, s: Side): FaceId {
  const fr = FRAME[f];
  let dir: THREE.Vector3;
  if (s === 'R') dir = fr.right.clone();
  else if (s === 'L') dir = fr.right.clone().negate();
  else if (s === 'U') dir = fr.up.clone();
  else dir = fr.up.clone().negate();
  // 跨过该边到达的相邻面，其法线方向 = 该 3D 方向
  for (const id of FACE_ORDER) {
    if (id === f) continue;
    if (LOCAL_NORMALS[id].distanceTo(dir) < 1e-6) return id;
  }
  throw new Error(`no neighbor for ${f} ${s}`);
}

const SIDES: Side[] = ['R', 'L', 'U', 'D'];

interface UnfoldFrame {
  right: THREE.Vector3; // 该面在展开平面内的“右”方向（3D）
  up: THREE.Vector3; // 该面在展开平面内的“上”方向（3D）
  rot: number; // 相对根面的 2D 旋转角
  q?: THREE.Quaternion; // 从立方体帧到展开帧的旋转（累积）
}

const DEG = 180 / Math.PI;
const round90 = (d: number) => Math.round(d / 90) * 90;

/** 折叠验证（一致性检查）：把展开图中每个子面的“展开后 3D 中心”沿真实 3D 铰链
 *  反向折回立方体。若 6 个面恰好折成 6 个互不重叠的立方体面中心，说明展开坐标与
 *  树结构自洽，确为合法展开。 */
export function foldCheck(
  root: FaceId,
  treeEdges: { parent: FaceId; child: FaceId; side: Side }[],
  pos3: Map<FaceId, THREE.Vector3>
): boolean {
  // 重建每个面的刚体变换（旋转 Q + 平移 t），用于正确反向折回
  const qMap = new Map<FaceId, THREE.Quaternion>();
  const tpMap = new Map<FaceId, THREE.Vector3>();
  qMap.set(root, new THREE.Quaternion());
  tpMap.set(root, new THREE.Vector3());
  const centers = new Map<FaceId, THREE.Vector3>();
  centers.set(root, LOCAL_NORMALS[root].clone().multiplyScalar(0.5)); // 立方体面中心
  for (const e of treeEdges) {
    const Qp = qMap.get(e.parent)!;
    const tp = tpMap.get(e.parent)!;
    const Np = LOCAL_NORMALS[e.parent];
    const Nc = LOCAL_NORMALS[e.child];
    const E = Np.clone().cross(Nc).normalize(); // 共享边（铰链）方向
    const M = Np.clone().add(Nc).multiplyScalar(0.5);
    // 展开时使用的旋转符号：使子面法线落于父面同侧
    let sign = 1;
    for (const s of [1, -1]) {
      const cn = Nc.clone().applyAxisAngle(E, (s * Math.PI) / 2);
      if (cn.dot(Np) > 0.9) {
        sign = s;
        break;
      }
    }
    // 逆向：unfolded = Qp*rotated + tp → rotated = Qp^{-1}*(unfolded - tp)
    const rotated = pos3
      .get(e.child)!
      .clone()
      .sub(tp)
      .applyQuaternion(Qp.clone().invert());
    // rotated = (CcCube - M) 绕铰链 +sign 旋转 + M → 反向得 CcCube
    const cubeChild = rotated.sub(M).applyAxisAngle(E, (-sign * Math.PI) / 2).add(M);
    centers.set(e.child, cubeChild);
    // 记录子面变换供其后代使用
    const R = new THREE.Quaternion().setFromAxisAngle(E, (sign * Math.PI) / 2);
    const Qc = Qp.clone().multiply(R);
    const tpc = pos3
      .get(e.child)!
      .clone()
      .sub(LOCAL_NORMALS[e.child].clone().multiplyScalar(0.5).applyQuaternion(Qc));
    qMap.set(e.child, Qc);
    tpMap.set(e.child, tpc);
  }
  const seen = new Set<string>();
  for (const [, fc] of centers) {
    const ax = Math.abs(fc.x);
    const ay = Math.abs(fc.y);
    const az = Math.abs(fc.z);
    const onAxis =
      (ax > 0.4 && ay < 0.1 && az < 0.1) ||
      (ay > 0.4 && ax < 0.1 && az < 0.1) ||
      (az > 0.4 && ax < 0.1 && ay < 0.1);
    if (!onAxis) return false;
    const key = `${Math.round(fc.x * 2)},${Math.round(fc.y * 2)},${Math.round(fc.z * 2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return seen.size === FACE_ORDER.length;
}



/** 形状规范化签名（平移到原点 + 8 种网格对称取最小），用于去重。 */
function shapeSig(cells: { c: number; r: number }[]): string {
  const minC = Math.min(...cells.map((p) => p.c));
  const minR = Math.min(...cells.map((p) => p.r));
  const base = cells.map((p) => ({ c: p.c - minC, r: p.r - minR }));
  const syms: string[] = [];
  for (let rot = 0; rot < 4; rot++) {
    for (const flip of [false, true]) {
      const t = base.map((p) => {
        let c = p.c;
        let r = p.r;
        for (let i = 0; i < rot; i++) {
          const nc = -r;
          const nr = c;
          c = nc;
          r = nr;
        }
        if (flip) c = -c;
        return { c, r };
      });
      const mc = Math.min(...t.map((p) => p.c));
      const mr = Math.min(...t.map((p) => p.r));
      syms.push(
        t
          .map((p) => `${p.c - mc},${p.r - mr}`)
          .sort()
          .join(';')
      );
    }
  }
  return syms.sort()[0];
}

// 立方体面邻接图（八面体）：每个面与除“对面”外的 4 个面相邻。
function buildAdjacency(): Map<FaceId, FaceId[]> {
  const adj = new Map<FaceId, FaceId[]>();
  for (const f of FACE_ORDER) {
    const list: FaceId[] = [];
    for (const s of SIDES) {
      const c = neighbor(f, s);
      if (!list.includes(c)) list.push(c);
    }
    adj.set(f, list);
  }
  return adj;
}

const FACE_INDEX: Record<FaceId, number> = FACE_ORDER.reduce(
  (m, f, i) => ((m[f] = i), m),
  {} as Record<FaceId, number>
);

function allGraphEdges(): { a: FaceId; b: FaceId }[] {
  const edges: { a: FaceId; b: FaceId }[] = [];
  const adj = buildAdjacency();
  for (const f of FACE_ORDER) {
    for (const c of adj.get(f)!) {
      if (FACE_INDEX[f] < FACE_INDEX[c]) edges.push({ a: f, b: c });
    }
  }
  return edges;
}

function sideFromTo(p: FaceId, c: FaceId): Side {
  for (const s of SIDES) if (neighbor(p, s) === c) return s;
  throw new Error(`no side from ${p} to ${c}`);
}

function isSpanningTree(edges: { a: FaceId; b: FaceId }[]): boolean {
  if (edges.length !== FACE_ORDER.length - 1) return false;
  const adj = new Map<FaceId, FaceId[]>();
  for (const f of FACE_ORDER) adj.set(f, []);
  for (const e of edges) {
    adj.get(e.a)!.push(e.b);
    adj.get(e.b)!.push(e.a);
  }
  const seen = new Set<FaceId>([FACE_ORDER[0]]);
  const q: FaceId[] = [FACE_ORDER[0]];
  while (q.length) {
    const p = q.shift()!;
    for (const c of adj.get(p)!) if (!seen.has(c)) { seen.add(c); q.push(c); }
  }
  return seen.size === FACE_ORDER.length;
}

function combinations(n: number, k: number): number[][] {
  const res: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) { res.push([...acc]); return; }
    for (let i = start; i < n; i++) rec(i + 1, [...acc, i]);
  };
  rec(0, []);
  return res;
}

// 给定一棵生成树（边集）与根，沿真实 3D 铰链把每个子面刚性展开到父面同侧，
// 由展开的 3D 坐标直接投影出 2D 网格位置（col,row）与每面纹理旋转角 rot。
function layoutFromEdges(
  root: FaceId,
  edges: { a: FaceId; b: FaceId }[]
): {
  cells: Map<FaceId, { col: number; row: number }>;
  frames: Map<FaceId, UnfoldFrame>;
  treeEdges: { parent: FaceId; child: FaceId; side: Side }[];
  pos3: Map<FaceId, THREE.Vector3>;
} | null {
  const eX = FRAME[root].right.clone();
  const eY = FRAME[root].up.clone();
  const Nroot = LOCAL_NORMALS[root].clone();
  const pos3 = new Map<FaceId, THREE.Vector3>(); // 展开后各面中心（世界坐标，均落于 Nroot 平面）
  const qMap = new Map<FaceId, THREE.Quaternion>();
  const cells = new Map<FaceId, { col: number; row: number }>();
  const occupied = new Set<string>();
  const treeEdges: { parent: FaceId; child: FaceId; side: Side }[] = [];
  pos3.set(root, Nroot.clone().multiplyScalar(0.5));
  qMap.set(root, new THREE.Quaternion());
  cells.set(root, { col: 0, row: 0 });
  occupied.add('0,0');
  const visited = new Set<FaceId>([root]);
  const queue: FaceId[] = [root];
  while (queue.length) {
    const p = queue.shift()!;
    const Qp = qMap.get(p)!;
    const Np = LOCAL_NORMALS[p];
    for (const e of edges) {
      let c: FaceId | null = null;
      if (e.a === p && !visited.has(e.b)) c = e.b;
      else if (e.b === p && !visited.has(e.a)) c = e.a;
      else continue;
      const Nc = LOCAL_NORMALS[c];
      const E = Np.clone().cross(Nc).normalize(); // 共享边（铰链）方向
      const M = Np.clone().add(Nc).multiplyScalar(0.5); // 立方体铰链中点
      const CcCube = Nc.clone().multiplyScalar(0.5); // 子面在立方体中的中心
      // 父面的刚体变换：cube → 已展开坐标系（旋转 Qp + 平移 t_p）
      const tp = pos3
        .get(p)!
        .clone()
        .sub(LOCAL_NORMALS[p].clone().multiplyScalar(0.5).applyQuaternion(Qp));
      // 选择展开旋转符号，使子面法线落于父面同侧（所有面共面且同侧）
      let Qc: THREE.Quaternion | null = null;
      let unfoldedCc: THREE.Vector3 | null = null;
      for (const sign of [1, -1]) {
        const R = new THREE.Quaternion().setFromAxisAngle(E, (sign * Math.PI) / 2);
        const cn = Nc.clone().applyQuaternion(R);
        if (cn.dot(Np) > 0.9) {
          Qc = Qp.clone().multiply(R);
          // 先绕“立方体铰链”把子面中心折平（假定父面在立方体原位），
          // 再用父面刚体变换映射到当前展开坐标系。
          const rotated = CcCube.clone().sub(M).applyAxisAngle(E, (sign * Math.PI) / 2).add(M);
          unfoldedCc = rotated.applyQuaternion(Qp).add(tp);
          break;
        }
      }
      if (!Qc || !unfoldedCc) return null;
      const rel = unfoldedCc.clone().sub(pos3.get(root)!);
      const col = Math.round(rel.dot(eX));
      const row = -Math.round(rel.dot(eY));
      const key = `${col},${row}`;
      if (occupied.has(key)) return null; // 2D 重叠 → 非法展开
      pos3.set(c, unfoldedCc);
      qMap.set(c, Qc);
      cells.set(c, { col, row });
      occupied.add(key);
      treeEdges.push({ parent: p, child: c, side: sideFromTo(p, c) });
      visited.add(c);
      queue.push(c);
    }
  }
  if (visited.size !== FACE_ORDER.length) return null;
  const frames = new Map<FaceId, UnfoldFrame>();
  for (const [f, Qc] of qMap) {
    const cr = FRAME[f].right.clone().applyQuaternion(Qc);
    const cu = FRAME[f].up.clone().applyQuaternion(Qc);
    const rot = round90(Math.atan2(cr.dot(eY), cr.dot(eX)) * DEG);
    frames.set(f, { right: cr, up: cu, rot, q: Qc });
  }
  return { cells, frames, treeEdges, pos3 };
}

function buildTemplates(): NetTemplate[] {
  const out: NetTemplate[] = [];
  const seenShapes = new Set<string>();
  const edges = allGraphEdges();
  const combos = combinations(edges.length, FACE_ORDER.length - 1);
  for (const combo of combos) {
    const tree = combo.map((i) => edges[i]);
    if (!isSpanningTree(tree)) continue;
    for (const root of FACE_ORDER) {
      const lay = layoutFromEdges(root, tree);
      if (!lay) continue;
      if (!foldCheck(root, lay.treeEdges, lay.pos3)) continue; // 必须能刚性折叠成立方体
      const sig = shapeSig([...lay.cells.values()].map((p) => ({ c: p.col, r: p.row })));
      if (seenShapes.has(sig)) continue;
      seenShapes.add(sig);
      const cells = FACE_ORDER.map((f) => {
        const p = lay.cells.get(f)!;
        return { face: f, col: p.col, row: p.row, rot: lay.frames.get(f)!.rot };
      });
      out.push({ id: `net-${out.length + 1}`, name: `展开图 ${out.length + 1}`, cols: 0, rows: 0, cells });
    }
  }
  // 归一化坐标（处理负数）并计算最终 cols/rows
  for (const t of out) {
    const minC = Math.min(...t.cells.map((c) => c.col));
    const minR = Math.min(...t.cells.map((c) => c.row));
    for (const c of t.cells) {
      c.col -= minC;
      c.row -= minR;
    }
    t.cols = Math.max(...t.cells.map((c) => c.col)) + 1;
    t.rows = Math.max(...t.cells.map((c) => c.row)) + 1;
  }
  return out;
}

export const NET_TEMPLATES: NetTemplate[] = buildTemplates();
