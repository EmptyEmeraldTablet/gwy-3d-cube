import { Cube, FACE_ORDER, FACE_SIZE, FaceId, FACE_LABELS } from '../model/types';
import { NET_TEMPLATES } from '../model/net';
import { NetState, cloneNetPreferences, netLayout, netVariants, quarter, rollNet, stateFromTemplate, switchNetType } from '../model/netVariants';
import { Painter } from './Painter';
import { drawingTools } from './drawingTools';
import { EditSession } from './EditSession';
import { drawNetGuides, extractNet, FaceCanvases, renderNet, netBackground } from './netCanvas';
import { restoreCanvas } from '../core/History';
import { markFaceDirty } from '../scene/CubeFactory';
import { Modal } from '../ui/Modal';
import { FoldPreview } from '../scene/FoldPreview';

interface OpenOptions { onMerge: (cube: Cube) => void; onCancel: () => void; }
interface SessionState { layout: NetState; drawing?: NetState; bookmarks: NetState[]; trail: NetState[]; inkRevision: number; }

export class NetEditor {
  private active = false;

  open(cube: Cube, opts: OpenOptions): void {
    if (this.active) return;
    this.active = true;
    const previous = cloneNetPreferences(cube.net);
    const initial = previous?.drawing ?? previous?.current ?? stateFromTemplate(NET_TEMPLATES[0]);
    const session = new EditSession<SessionState>(FACE_ORDER.map(f => cube.faces[f].canvas), { layout: initial, drawing: previous?.drawing, bookmarks: previous?.bookmarks ?? [], trail: [], inkRevision: 0 });
    const faces = Object.fromEntries(FACE_ORDER.map((f, i) => [f, session.canvases[i]])) as FaceCanvases;
    let layout = netLayout(session.state.layout), selected: FaceId = session.state.layout.referenceFace;
    let painter: Painter, preview: FoldPreview | null = null, animation = 0, closed = false, showLabels = true;
    let resize: ResizeObserver;
    const close = () => { closed = true; cancelAnimationFrame(animation); resize.disconnect(); painter.end(); preview?.dispose(); session.dispose(); modal.close(); this.active = false; };
    const cancel = () => { opts.onCancel(); close(); };
    const history = (redo: boolean) => { painter.cancelStroke(); if (redo ? session.redo() : session.undo()) repaint(); };
    const modal = new Modal('net-editor', '正方体展开与整体变换', cancel, history);
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
    const button = (name: string, action: () => void, parent: HTMLElement, key?: string) => { const b = el('button', 'btn', name); if (key) b.dataset.action = key; b.addEventListener('click', action); parent.append(b); return b; };
    const header = el('header', 'editor-heading');
    header.append(el('div', '', '展开与整体变换'), el('span', 'editor-subtitle', cube.id));
    button('关闭', cancel, header, 'close');
    const note = el('p', 'editor-note', '切换具体展开时，六面的图案与空间关系保持不变。橙色虚线是折叠边，蓝框是当前面。');
    const typeStrip = el('div', 'net-type-strip'); typeStrip.setAttribute('aria-label', '11 种展开类型');
    const transform = el('div', 'net-transform');
    const typeSelect = el('select'); typeSelect.setAttribute('aria-label', '展开类型'); typeSelect.dataset.role = 'template';
    for (const template of NET_TEMPLATES) { const option = el('option', '', template.name); option.value = template.id; typeSelect.append(option); }
    transform.append(el('span', 'group-label', '展开类型'), typeSelect);
    typeSelect.addEventListener('change', () => changeLayout(switchNetType(session.state.layout, typeSelect.value)));
    const variantLabel = el('span', 'variant-label'); transform.append(variantLabel);
    button('上一个具体展开', () => cycle(-1), transform, 'previous-variant');
    button('下一个具体展开', () => cycle(1), transform, 'next-variant');
    const rolls = el('div', 'net-transform'); rolls.append(el('span', 'group-label', '整体变换'));
    button('← 整体左转', () => changeLayout(rollNet(session.state.layout, 'up', 1)), rolls, 'roll-left');
    button('整体右转 →', () => changeLayout(rollNet(session.state.layout, 'up', -1)), rolls, 'roll-right');
    button('↑ 整体上翻', () => changeLayout(rollNet(session.state.layout, 'right', -1)), rolls, 'roll-up');
    button('整体下翻 ↓', () => changeLayout(rollNet(session.state.layout, 'right', 1)), rolls, 'roll-down');
    const reference = el('select'); reference.setAttribute('aria-label', '参考面');
    for (const face of FACE_ORDER) { const option = el('option', '', `参考面 ${FACE_LABELS[face]}`); option.value = face; reference.append(option); }
    reference.addEventListener('change', () => changeLayout({ ...session.state.layout, referenceFace: reference.value as FaceId }));
    const direction = el('select'); direction.setAttribute('aria-label', '参考面方向');
    for (let i = 0; i < 4; i++) { const option = el('option', '', `方向 ${i * 90}°`); option.value = String(i); direction.append(option); }
    direction.addEventListener('change', () => changeLayout({ ...session.state.layout, referenceTurn: Number(direction.value) })); rolls.append(reference, direction);
    const returns = el('div', 'net-transform');
    const back = button('返回上一个展开', () => {
      const target = session.state.trail.pop(); if (!target) return;
      painter.cancelStroke(); session.state.layout = target; session.checkpoint(); repaint();
    }, returns, 'back-layout');
    button('回到绘制布局', () => changeLayout(session.state.drawing ?? initial), returns, 'restore-layout');
    if (previous?.current) button('上次应用布局', () => changeLayout(previous.current), returns, 'last-applied-layout');
    button('整图旋转 90°', () => changeLayout({ ...session.state.layout, viewTurn: quarter(session.state.layout.viewTurn + 1) }), returns, 'rotate-view');
    button('复位查看方向', () => changeLayout({ ...session.state.layout, viewTurn: 0 }), returns, 'reset-view');
    button('保存布局书签', () => {
      if (!session.state.bookmarks.some(s => JSON.stringify(s) === JSON.stringify(session.state.layout))) {
        session.state.bookmarks.push({ ...session.state.layout }); session.state.bookmarks = session.state.bookmarks.slice(-12); session.checkpoint(); updateControls();
      }
    }, returns, 'bookmark');
    const bookmarks = el('select'); bookmarks.setAttribute('aria-label', '布局书签'); bookmarks.addEventListener('change', () => { const state = session.state.bookmarks[Number(bookmarks.value)]; if (state) changeLayout({ ...state }); }); returns.append(bookmarks);
    const candidates = el('details', 'net-candidates'); candidates.append(el('summary', '', '浏览全部 24 个具体展开'));
    const candidateGrid = el('div', 'candidate-grid'); candidates.append(candidateGrid);
    candidates.addEventListener('toggle', () => { if (candidates.open) updateCandidates(); });
    const workspace = el('div', 'net-workspace');
    const left = el('section', 'net-flat-panel'); left.append(el('h4', '', '二维展开'));
    const wrap = el('div', 'canvas-wrap net-canvas-wrap');
    const stage = el('div', 'net-canvas-stage'), canvas = el('canvas'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', '展开图绘制画布'); stage.append(canvas); wrap.append(stage); left.append(wrap);
    const right = el('section', 'net-fold-panel'); right.append(el('h4', '', '三维对应 · 拖动旋转，点击选面'));
    const previewHost = el('div', 'fold-preview'); right.append(previewHost);
    const foldControls = el('div', 'fold-controls');
    const progress = el('input'); progress.type = 'range'; progress.min = '0'; progress.max = '100'; progress.value = '100'; progress.setAttribute('aria-label', '折叠进度');
    const foldValue = el('output', '', '已折叠'); foldControls.append(el('span', '', '展开'), progress, el('span', '', '折叠'), foldValue);
    const setProgress = (value: number) => { progress.value = String(value); foldValue.value = `${Math.round(value)}%`; preview?.setProgress(value / 100); };
    progress.addEventListener('input', () => { cancelAnimationFrame(animation); animation = 0; play.textContent = '播放折叠'; setProgress(Number(progress.value)); });
    const play = button('播放折叠', () => {
      if (animation) { cancelAnimationFrame(animation); animation = 0; play.textContent = '播放折叠'; return; }
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setProgress(100); return; }
      preview?.fit(); const start = performance.now(); play.textContent = '暂停';
      const frame = (now: number) => { if (closed) return; const t = Math.min(1, (now - start) / 3500); setProgress(t * 100); if (t < 1) animation = requestAnimationFrame(frame); else { animation = 0; play.textContent = '播放折叠'; } };
      animation = requestAnimationFrame(frame);
    }, foldControls, 'play-fold');
    button('完全展开', () => { cancelAnimationFrame(animation); animation = 0; play.textContent = '播放折叠'; setProgress(0); preview?.fit(); }, foldControls, 'unfold');
    button('回到立方体', () => { cancelAnimationFrame(animation); animation = 0; play.textContent = '播放折叠'; setProgress(100); preview?.fitCube(); }, foldControls, 'fold');
    right.append(foldControls); workspace.append(left, right);
    const status = el('p', 'editor-status'); status.setAttribute('role', 'status');
    const faceAt = (point: { x: number; y: number }) => layout.cells.find(c => Math.floor(point.x / FACE_SIZE) === c.col && Math.floor(point.y / FACE_SIZE) === c.row)?.face;
    const selectFace = (face: FaceId) => { selected = face; preview?.setSelected(face); painter.requestOverlay(); status.textContent = `当前面 ${FACE_LABELS[face]} · 参考面 ${FACE_LABELS[session.state.layout.referenceFace]} · 图案相对立体的方向保持不变`; };
    painter = new Painter(canvas, {
      validPoint: p => !!faceAt(p),
      pick: p => { const face = faceAt(p); if (face) selectFace(face); },
      mask: ctx => { for (const cell of layout.cells) ctx.rect(cell.col * FACE_SIZE, cell.row * FACE_SIZE, FACE_SIZE, FACE_SIZE); },
      decorate: ctx => drawNetGuides(ctx, layout, selected, showLabels),
      changed: () => {
        extractNet(canvas, layout, faces); session.state.inkRevision++; session.state.drawing = { ...session.state.layout }; session.checkpoint(true);
        preview?.updateTextures(faces, cube.color); updateControls(); if (candidates.open) updateCandidates();
      },
      error: message => { status.textContent = message; },
    }); painter.setTool('inspect');
    const tools = drawingTools(painter, true);
    const actions = el('div', 'actions');
    const undo = button('撤销', () => history(false), actions, 'undo'); const redo = button('重做', () => history(true), actions, 'redo');
    const labelToggle = el('label', 'field'); const labels = el('input'); labels.type = 'checkbox'; labels.checked = true; labels.addEventListener('change', () => { showLabels = labels.checked; painter.requestOverlay(); preview?.setLabels(showLabels); }); labelToggle.append(labels, '显示面名'); actions.append(labelToggle);
    const exportOptions = el('details', 'net-candidates'); exportOptions.append(el('summary', '', '展开图导出选项'));
    const exportToggle = (name: string) => { const label = el('label', 'field'); const input = el('input'); input.type = 'checkbox'; input.checked = true; label.append(input, name); exportOptions.append(label); return input; };
    const exportPatterns = exportToggle('导出图案'), exportLabels = exportToggle('导出面名'), exportCuts = exportToggle('导出切边'), exportFolds = exportToggle('导出折线');
    button('导出展开图', () => {
      const output = document.createElement('canvas');
      renderNet(faces, layout, output, { color: cube.color, patterns: exportPatterns.checked });
      drawNetGuides(output.getContext('2d')!, layout, undefined, exportLabels.checked, exportCuts.checked, exportFolds.checked);
      const rotated = document.createElement('canvas'), odd = session.state.layout.viewTurn % 2;
      rotated.width = odd ? output.height : output.width; rotated.height = odd ? output.width : output.height;
      const ctx = rotated.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, rotated.width, rotated.height);
      ctx.translate(rotated.width / 2, rotated.height / 2); ctx.rotate(session.state.layout.viewTurn * Math.PI / 2); ctx.drawImage(output, -output.width / 2, -output.height / 2);
      const link = el('a'); link.href = rotated.toDataURL('image/png'); link.download = `展开图-${cube.id}.png`; link.click();
    }, actions, 'export-net');
    button('取消', cancel, actions, 'cancel');
    const apply = button('应用到立方体', () => {
      painter.cancelStroke();
      if (session.state.inkRevision > 0) FACE_ORDER.forEach((face, i) => { restoreCanvas(cube.faces[face].canvas, session.canvases[i]); markFaceDirty(cube, face); });
      cube.net = { version: 1, current: { ...session.state.layout }, drawing: session.state.drawing ? { ...session.state.drawing } : undefined, bookmarks: session.state.bookmarks.map(s => ({ ...s })) };
      opts.onMerge(cube); close();
    }, actions, 'merge'); apply.classList.add('active');

    function cycle(delta: number): void {
      const variants = netVariants(session.state.layout); const index = variants.findIndex(s => s.referenceFace === session.state.layout.referenceFace && s.referenceTurn === session.state.layout.referenceTurn);
      changeLayout(variants[(index + delta + 24) % 24]);
    }
    function changeLayout(next: NetState): void {
      painter.cancelStroke();
      if (JSON.stringify(next) === JSON.stringify(session.state.layout)) return;
      session.state.trail.push({ ...session.state.layout }); session.state.trail = session.state.trail.slice(-100);
      session.state.layout = { ...next }; session.checkpoint(); repaint();
    }
    function fitCanvas(): void {
      const width = Math.max(160, wrap.clientWidth - 24), height = Math.max(220, wrap.clientHeight - 24), odd = session.state.layout.viewTurn % 2;
      const scale = Math.min(width / (odd ? canvas.height : canvas.width), height / (odd ? canvas.width : canvas.height), 1);
      canvas.style.width = `${canvas.width * scale}px`; canvas.style.height = `${canvas.height * scale}px`;
      stage.style.width = canvas.style.width; stage.style.height = canvas.style.height;
      canvas.style.backgroundImage = netBackground(layout, cube.color); canvas.style.backgroundSize = '100% 100%';
      painter.setViewTransform(`rotate(${session.state.layout.viewTurn * 90}deg)`);
    }
    function miniature(target: HTMLCanvasElement, state: NetState, content: boolean): void {
      const l = netLayout(state), ctx = target.getContext('2d')!;
      ctx.clearRect(0, 0, target.width, target.height);
      const unit = Math.min((target.width - 8) / l.cols, (target.height - 8) / l.rows);
      for (const c of l.cells) {
        ctx.save(); ctx.translate(4 + (c.col + .5) * unit, 4 + (c.row + .5) * unit); ctx.fillStyle = content ? (cube.color ?? '#f2f4f9') : c.face === state.referenceFace ? '#d4e5ff' : '#fff'; ctx.fillRect(-unit / 2, -unit / 2, unit, unit);
        if (content) { ctx.rotate(-c.rot * Math.PI / 180); ctx.drawImage(faces[c.face], -unit / 2, -unit / 2, unit, unit); }
        ctx.restore(); ctx.strokeStyle = '#61728a'; ctx.strokeRect(4 + c.col * unit, 4 + c.row * unit, unit, unit);
        if (!content) { ctx.fillStyle = '#284a77'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(FACE_LABELS[c.face], 4 + (c.col + .5) * unit, 4 + (c.row + .65) * unit); }
      }
    }
    function updateCandidates(): void {
      candidateGrid.replaceChildren();
      netVariants(session.state.layout).forEach((state, index) => {
        const b = button(`${index + 1} · ${FACE_LABELS[state.referenceFace]} ${state.referenceTurn * 90}°`, () => changeLayout(state), candidateGrid);
        b.classList.add('candidate'); b.classList.toggle('active', state.referenceFace === session.state.layout.referenceFace && state.referenceTurn === session.state.layout.referenceTurn);
        const thumbnail = el('canvas'); thumbnail.width = 112; thumbnail.height = 92; miniature(thumbnail, state, true); b.prepend(thumbnail);
      });
    }
    function updateControls(): void {
      const s = session.state.layout; typeSelect.value = s.templateId; reference.value = s.referenceFace; direction.value = String(s.referenceTurn);
      variantLabel.textContent = `具体展开 ${FACE_ORDER.indexOf(s.referenceFace) * 4 + s.referenceTurn + 1} / 24`;
      undo.disabled = !session.canUndo(); redo.disabled = !session.canRedo(); back.disabled = !session.state.trail.length;
      bookmarks.replaceChildren(el('option', '', session.state.bookmarks.length ? '选择布局书签…' : '尚无布局书签')); bookmarks.firstElementChild!.setAttribute('value', '');
      session.state.bookmarks.forEach((state, i) => { const option = el('option', '', `${i + 1} · ${NET_TEMPLATES.find(t => t.id === state.templateId)!.name} · ${FACE_LABELS[state.referenceFace]} ${state.referenceTurn * 90}°`); option.value = String(i); bookmarks.append(option); });
      for (const b of typeStrip.querySelectorAll<HTMLButtonElement>('button')) { b.classList.toggle('active', b.dataset.template === s.templateId); b.setAttribute('aria-pressed', String(b.dataset.template === s.templateId)); miniature(b.querySelector('canvas')!, switchNetType(s, b.dataset.template!), false); }
    }
    function repaint(): void {
      layout = netLayout(session.state.layout); renderNet(faces, layout, canvas); painter.reload(); fitCanvas();
      preview?.setLayout(layout, session.state.layout); preview?.updateTextures(faces, cube.color); preview?.setProgress(Number(progress.value) / 100);
      if (Number(progress.value) === 100) preview?.fitCube();
      selectFace(selected); updateControls(); if (candidates.open) updateCandidates();
    }
    for (const template of NET_TEMPLATES) {
      const b = button(template.name, () => changeLayout(switchNetType(session.state.layout, template.id)), typeStrip); b.classList.add('net-type'); b.dataset.template = template.id;
      const thumbnail = el('canvas'); thumbnail.width = 86; thumbnail.height = 60; b.prepend(thumbnail);
    }
    modal.panel.append(header, note, typeStrip, transform, rolls, returns, candidates, tools, workspace, status, exportOptions, actions);
    modal.mount(); renderNet(faces, layout, canvas); painter.begin();
    try { preview = new FoldPreview(previewHost, faces, selectFace, cube.color); }
    catch { previewHost.textContent = '当前设备暂时无法创建三维预览，二维展开与编辑仍可使用。'; }
    resize = new ResizeObserver(fitCanvas); resize.observe(wrap);
    repaint();
  }
}
