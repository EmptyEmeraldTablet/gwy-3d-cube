import { Cube, FaceId, FACE_LABELS, Layer } from '../model/types';
import { projectCubes, Projection, ProjectionCell, PROJECTION_VIEWS, ProjectionView } from '../model/projection';
import { Modal } from './Modal';
import { Viewer } from '../scene/Viewer';
import { Picker } from '../scene/Picker';

export function openProjections(cubes: Cube[], layers: Layer[], selected: string | undefined, onSelect: (cube: Cube, face: FaceId) => void): void {
  let viewer: Viewer | undefined;
  const dismiss = () => { viewer?.dispose(); modal.close(); };
  const modal = new Modal('net-editor projection-panel', '正交三视图', dismiss);
  const title = document.createElement('h3'); title.textContent = '正交三视图';
  const note = document.createElement('p'); note.className = 'editor-note'; note.textContent = '三个方向使用相同单位比例。点击格子查看这条视线上全部单体；同一空间位置的跨组重叠只计一层深度。图案显示最靠近观察者的表面。';
  const controls = document.createElement('div'); controls.className = 'actions';
  const mode = document.createElement('select'); mode.setAttribute('aria-label', '投影显示');
  for (const [value, text] of [['outline', '轮廓'], ['patterns', '面图案'], ['depth', '深度层数']]) { const o = document.createElement('option'); o.value = value; o.textContent = text; mode.append(o); }
  const grid = document.createElement('div'); grid.className = 'projection-grid';
  const projections = (Object.keys(PROJECTION_VIEWS) as ProjectionView[]).map(view => projectCubes(cubes, layers, view));
  const unit = Math.min(64, 330 / Math.max(...projections.map(p => p.maxX - p.minX + 1)), 245 / Math.max(...projections.map(p => p.maxY - p.minY + 1)));
  const byId = new Map(cubes.map(c => [c.id, c]));
  const canvases: HTMLCanvasElement[] = [];
  const info = document.createElement('p'); info.className = 'editor-status'; info.setAttribute('role', 'status'); info.textContent = '轮廓格表示存在单体，不表示只有一个单体。';
  const sources = document.createElement('div'); sources.className = 'projection-sources';
  const previewHost = document.createElement('div'); previewHost.className = 'projection-scene';
  const previewCanvas = document.createElement('canvas'); previewCanvas.setAttribute('aria-label', '三视图对应立体'); previewHost.append(previewCanvas);
  const previewCubes = cubes.map(cube => ({ ...cube, mesh: cube.mesh.clone() }));
  function selectSource(cube: Cube, face: FaceId): void { selected = cube.id; onSelect(cube, face); viewer?.setFaceSelection(previewCubes.find(c => c.id === cube.id)!, face); render(); }
  const xy = (p: Projection, c: ProjectionCell) => ({ x: 180 + (c.x - (p.minX + p.maxX) / 2) * unit, y: 160 - (c.y - (p.minY + p.maxY) / 2) * unit });
  function render(): void {
    projections.forEach((p, i) => {
      const ctx = canvases[i].getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 360, 320);
      ctx.fillStyle = '#243b5b'; ctx.textAlign = 'center'; ctx.font = 'bold 17px sans-serif'; ctx.fillText(PROJECTION_VIEWS[p.view].name, 180, 24);
      ctx.font = '12px sans-serif'; ctx.fillText(PROJECTION_VIEWS[p.view].axes, 180, 45);
      if (!p.cells.length) ctx.fillText('没有可见单体', 180, 160);
      for (const cell of p.cells) {
        const { x, y } = xy(p, cell), source = cell.sources[0], cube = byId.get(source.cubeId)!;
        ctx.save(); ctx.translate(x, y); ctx.fillStyle = mode.value === 'depth' ? `hsl(215 55% ${Math.max(35, 90 - cell.depthCount * 10)}%)` : '#cadbf1'; ctx.fillRect(-unit / 2, -unit / 2, unit, unit);
        if (mode.value === 'patterns') { ctx.save(); ctx.transform(...source.imageMatrix, 0, 0); ctx.drawImage(cube.faces[source.face].texture.image as HTMLCanvasElement, -unit / 2, -unit / 2, unit, unit); ctx.restore(); }
        if (mode.value !== 'outline') { ctx.strokeStyle = '#71829b'; ctx.lineWidth = .8; ctx.strokeRect(-unit / 2, -unit / 2, unit, unit); }
        else { // Only the union boundary is solid; internal grids do not imply visible depth.
          ctx.strokeStyle = '#405d85'; ctx.lineWidth = 2; ctx.beginPath();
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!p.cells.some(c => c.x === cell.x + dx && c.y === cell.y + dy)) {
            if (dx) { ctx.moveTo(dx * unit / 2, -unit / 2); ctx.lineTo(dx * unit / 2, unit / 2); }
            else { ctx.moveTo(-unit / 2, -dy * unit / 2); ctx.lineTo(unit / 2, -dy * unit / 2); }
          } ctx.stroke();
        }
        if (mode.value === 'depth' && unit >= 10) { ctx.fillStyle = cell.depthCount > 3 ? '#fff' : '#193750'; ctx.font = `bold ${Math.min(22, unit * .55)}px sans-serif`; ctx.textBaseline = 'middle'; ctx.fillText(String(cell.depthCount), 0, 0); }
        if (cell.sources.some(s => s.cubeId === selected)) { ctx.strokeStyle = '#e06b19'; ctx.lineWidth = 3; ctx.strokeRect(-unit / 2 + 2, -unit / 2 + 2, unit - 4, unit - 4); }
        ctx.restore();
      }
      ctx.fillStyle = '#415d7c'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`1 格 = 1 单位 · ${p.cells.length} 个投影格`, 12, 307);
    });
  }
  projections.forEach(p => {
    const section = document.createElement('section'), canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 320; canvas.setAttribute('aria-label', PROJECTION_VIEWS[p.view].name);
    canvas.addEventListener('click', e => {
      const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 360, y = (e.clientY - r.top) / r.height * 320;
      const cell = p.cells.find(c => { const point = xy(p, c); return Math.abs(x - point.x) <= unit / 2 && Math.abs(y - point.y) <= unit / 2; }); if (!cell) return;
      info.textContent = `${PROJECTION_VIEWS[p.view].name} (${cell.x}, ${cell.y})：${cell.depthCount} 层深度，关联 ${cell.sources.length} 个单体（由近及远）。`; sources.replaceChildren();
      for (const source of cell.sources) { const button = document.createElement('button'); button.className = 'btn'; button.textContent = `${source.cubeId} · 面 ${FACE_LABELS[source.face]} · 深度 ${source.depth}`; button.onclick = () => selectSource(byId.get(source.cubeId)!, source.face); sources.append(button); }
      selectSource(byId.get(cell.sources[0].cubeId)!, cell.sources[0].face);
    }); section.append(canvas); canvases.push(canvas); grid.append(section);
  });
  mode.onchange = render;
  const exportButton = document.createElement('button'); exportButton.className = 'btn'; exportButton.textContent = '导出三视图';
  exportButton.onclick = () => {
    const previous = selected; selected = undefined; render();
    const out = document.createElement('canvas'); out.width = 1080; out.height = 350; const ctx = out.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1080, 350); canvases.forEach((c, i) => ctx.drawImage(c, i * 360, 0)); ctx.fillStyle = '#345'; ctx.font = '14px sans-serif'; ctx.fillText('正交投影 · 相同比例 · ' + mode.selectedOptions[0].text, 15, 340);
    const a = document.createElement('a'); a.href = out.toDataURL(); a.download = '三视图.png'; a.click(); selected = previous; render();
  };
  const close = document.createElement('button'); close.className = 'btn'; close.textContent = '关闭三视图'; close.onclick = dismiss; controls.append(mode, exportButton, close);
  modal.panel.append(title, note, previewHost, grid, info, sources, controls); modal.mount(); render();
  viewer = new Viewer(previewCanvas); previewCubes.forEach(c => viewer!.scene.add(c.mesh)); viewer.setProjection('orthographic'); viewer.setView('iso'); viewer.start();
  const picker = new Picker(viewer, previewCubes.filter(c => c.mesh.visible));
  previewCanvas.addEventListener('pointermove', event => {
    if (event.buttons) return;
    const hit = picker.pick(viewer!.toNDC(event.clientX, event.clientY));
    if (hit) { selected = hit.cube.id; viewer!.setFaceSelection(hit.cube, hit.faceId); info.textContent = `${hit.cube.id} · 面 ${FACE_LABELS[hit.faceId]}，橙框标出它在三个方向的投影。`; render(); }
  });
}
