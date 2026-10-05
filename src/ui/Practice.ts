import * as THREE from 'three';
import { Cube, FACE_LABELS, FACE_ORDER, FACE_SIZE, FaceId, LOCAL_NORMALS, createDefaultLayer } from '../model/types';
import { defaultNetState, netLayout } from '../model/netVariants';
import { projectCubes } from '../model/projection';
import { drawNetGuides, FaceCanvases, renderNet } from '../draw/netCanvas';
import { createCube, disposeCube } from '../scene/CubeFactory';
import { Viewer } from '../scene/Viewer';
import { FoldPreview } from '../scene/FoldPreview';
import { Modal } from './Modal';

const RECORD_KEY = 'spatial-practice-v1';
type RecordEntry = { task: number; correct: boolean; at: number };

/** Three small, reproducible exercises; answers come from geometry rather than UI labels. */
export function openPractice(): void {
  let task = 0, clean = () => {}, records: RecordEntry[] = [];
  try { const value = JSON.parse(localStorage.getItem(RECORD_KEY) ?? '[]'); if (Array.isArray(value)) records = value.filter(v => Number.isInteger(v?.task) && typeof v.correct === 'boolean').slice(-100); } catch { /* Practice remains available without storage. */ }
  const modal = new Modal('net-editor practice-panel', '空间几何练习', () => { clean(); modal.close(); });
  function show(): void {
    clean(); modal.panel.replaceChildren();
    const title = document.createElement('h3'); title.textContent = `${task + 1} / 3 · ${['看立体选视图', '看展开判断对面', '判断箭头朝向'][task]}`;
    const question = document.createElement('p'); question.className = 'editor-note';
    const workspace = document.createElement('div'); workspace.className = 'practice-workspace';
    const choices = document.createElement('div'); choices.className = 'practice-choices';
    const feedback = document.createElement('p'); feedback.className = 'editor-status'; feedback.setAttribute('role', 'status');
    const actions = document.createElement('div'); actions.className = 'actions';
    const progress = document.createElement('p'); progress.className = 'editor-note'; progress.textContent = `本机记录：${records.length} 次作答，${records.filter(r => r.correct).length} 次正确。`;
    const next = document.createElement('button'); next.className = 'btn'; next.textContent = task === 2 ? '重新练习' : '下一题'; next.onclick = () => { task = (task + 1) % 3; show(); };
    const close = document.createElement('button'); close.className = 'btn'; close.textContent = '结束练习'; close.onclick = () => { clean(); modal.close(); }; actions.append(next, close);
    let answered = false;
    const record = (correct: boolean, explanation: string) => {
      if (answered) return; answered = true; records.push({ task, correct, at: Date.now() }); records = records.slice(-100);
      feedback.textContent = `${correct ? '回答正确。' : '再对照几何关系看看。'}${explanation}`;
      try { localStorage.setItem(RECORD_KEY, JSON.stringify(records)); } catch { feedback.textContent += ' 本机存储不可用，本次仍可继续练习。'; }
      progress.textContent = `本机记录：${records.length} 次作答，${records.filter(r => r.correct).length} 次正确。`;
      for (const b of choices.querySelectorAll('button')) b.disabled = true;
    };
    modal.panel.append(title, question, workspace, choices, feedback, progress, actions);
    if (task === 0) {
      question.textContent = '从立体的前方（+Z）向后观察，哪个轮廓是正视图？可以拖动立体观察，注意同一条视线上的遮挡。';
      const host = document.createElement('div'); host.className = 'practice-scene'; const canvas = document.createElement('canvas'); host.append(canvas); workspace.append(host);
      const viewer = new Viewer(canvas), layer = createDefaultLayer();
      const cubes: Cube[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 0, 1], [1, 1, 1]].map(([x, y, z]) => createCube({ x, y, z }, 1));
      cubes.forEach(c => viewer.scene.add(c.mesh)); viewer.setProjection('orthographic'); viewer.setView('iso'); viewer.fit(); viewer.start();
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, .2, 3.1), 1.3, 0xffaa33, .3, .15); viewer.scene.add(arrow); viewer.requestRender();
      const correct = projectCubes(cubes, [layer], 'front').cells.map(c => `${c.x},${c.y}`);
      // Distractors represent missed occlusion and an omitted upper block.
      const options = [correct.filter(k => k !== '1,1'), [...correct, '2,1'], correct];
      const paint = (canvas: HTMLCanvasElement, cells: string[], differences = false) => { const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 180, 140); for (const key of new Set([...cells, ...(differences ? correct : [])])) { const [x, y] = key.split(',').map(Number); ctx.fillStyle = !differences || cells.includes(key) && correct.includes(key) ? '#bad4ef' : cells.includes(key) ? '#edb8a2' : '#b9dfbb'; ctx.fillRect(24 + x * 42, 75 - y * 42, 42, 42); ctx.strokeStyle = '#48658a'; ctx.strokeRect(24 + x * 42, 75 - y * 42, 42, 42); } };
      options.forEach((cells, i) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = `选项 ${i + 1}`; const c = document.createElement('canvas'); c.width = 180; c.height = 140; b.prepend(c); paint(c, cells); b.onclick = () => { record(i === 2, '6 个单体投成 5 个格：沿 Z 方向重合的单体合为一个投影格。绿色表示漏掉的格，橙色表示多出的格。一个正视图不能唯一确定立体。'); paint(c, cells, true); }; choices.append(b); });
      clean = () => { viewer.dispose(); cubes.forEach(disposeCube); arrow.line.geometry.dispose(); (arrow.line.material as THREE.Material).dispose(); arrow.cone.geometry.dispose(); (arrow.cone.material as THREE.Material).dispose(); };
    } else {
      const state = { ...defaultNetState(), referenceFace: 'px' as FaceId, referenceTurn: 1 }, layout = netLayout(state);
      const faces = Object.fromEntries(FACE_ORDER.map(face => { const c = document.createElement('canvas'); c.width = c.height = FACE_SIZE; const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE); ctx.fillStyle = '#24578d'; ctx.font = 'bold 76px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(task === 2 && face === 'py' ? '↑' : FACE_LABELS[face], 128, 157); if (face === 'py') { ctx.fillStyle = '#db7331'; ctx.fillRect(185, 185, 24, 24); } return [face, c]; })) as FaceCanvases;
      const flat = document.createElement('canvas'); flat.className = 'practice-net'; renderNet(faces, layout, flat); drawNetGuides(flat.getContext('2d')!, layout, task === 2 ? 'py' : 'pz'); workspace.append(flat);
      const host = document.createElement('div'); host.className = 'fold-preview'; workspace.append(host);
      const preview = new FoldPreview(host, faces, () => {}); preview.setLayout(layout, state); preview.setProgress(0); preview.fit();
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = '0'; slider.disabled = true; slider.setAttribute('aria-label', '验证折叠进度'); slider.oninput = () => preview.setProgress(Number(slider.value) / 100); actions.prepend(slider);
      question.textContent = task === 1 ? '展开图中，哪一面与面 A 相对？作答后拖动滑块折叠，验证两面的朝向。' : '闭合后的立方体以 A 为前、E 为上。面 E 的箭头最终指向前、后、左、右中的哪一侧？角标用于区分旋转与镜像。';
      const offered: FaceId[] = task === 1 ? FACE_ORDER.filter(f => f !== 'pz') : ['pz', 'nz', 'nx', 'px'];
      offered.forEach(face => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = task === 1 ? `面 ${FACE_LABELS[face]}` : ({ pz: '前（A）', nz: '后（C）', nx: '左（D）', px: '右（B）' } as Partial<Record<FaceId, string>>)[face]!;
        b.onclick = () => { const correct = task === 1 ? LOCAL_NORMALS[face].dot(LOCAL_NORMALS.pz) < -.99 : face === 'nz'; record(correct, task === 1 ? '面 A 与面 C 的法线相反，折回后相对。不能根据它们在平面上相隔几格判断。拖动下方滑块查看。' : '箭头指向后方 C：上表面 E 的图案上方向为 −Z。展开时看见的纸面上下方向会随铰链折叠改变；图案没有镜像。拖动下方滑块查看。'); slider.disabled = false; preview.setProgress(1); preview.fitCube(); slider.value = '100'; };
        choices.append(b);
      });
      clean = () => preview.dispose();
    }
  }
  modal.mount(); show();
}
