import { Face, FACE_LABELS } from '../model/types';
import { restoreCanvas } from '../core/History';
import { Modal } from '../ui/Modal';
import { EditSession } from './EditSession';
import { Painter } from './Painter';
import { drawingTools } from './drawingTools';

interface OpenOptions { background?: string; onCommit: (face: Face) => void; onCancel: () => void; }

export class FaceEditor {
  private active = false;
  open(face: Face, opts: OpenOptions): void {
    if (this.active) return;
    this.active = true;
    const session = new EditSession([face.canvas], {});
    let painter: Painter;
    const close = () => { painter.end(); modal.close(); session.dispose(); this.active = false; };
    const cancel = () => { opts.onCancel(); close(); };
    const changeHistory = (redo: boolean) => {
      painter.cancelStroke();
      if (redo ? session.redo() : session.undo()) { painter.reload(); refresh(); }
    };
    const modal = new Modal('face-editor', `编辑面 ${FACE_LABELS[face.id]}`, cancel, changeHistory);
    const title = document.createElement('h3'); title.textContent = `编辑面 ${FACE_LABELS[face.id]}`;
    const note = document.createElement('p'); note.className = 'editor-note'; note.textContent = '在草稿中绘制；完成后应用。Ctrl+Z 撤销笔画，Esc 取消整次编辑。';
    const wrap = document.createElement('div'); wrap.className = 'canvas-wrap';
    const draft = session.canvases[0]; draft.tabIndex = 0; draft.setAttribute('aria-label', '面绘制画布'); wrap.append(draft);
    draft.style.backgroundColor = opts.background ?? '#fff';
    const status = document.createElement('p'); status.className = 'editor-status'; status.setAttribute('role', 'status');
    painter = new Painter(draft, { changed: () => { session.checkpoint(true); refresh(); }, error: message => { status.textContent = message; } });
    const actions = document.createElement('div'); actions.className = 'actions';
    const button = (name: string, action: () => void) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = name; b.addEventListener('click', action); actions.append(b); return b; };
    const undo = button('撤销笔画', () => changeHistory(false));
    const redo = button('重做笔画', () => changeHistory(true));
    button('旋转图案 90°', () => painter.rotateContent(90));
    button('取消', cancel);
    const done = button('完成', () => { painter.cancelStroke(); restoreCanvas(face.canvas, draft); opts.onCommit(face); close(); }); done.classList.add('active');
    const refresh = () => { undo.disabled = !session.canUndo(); redo.disabled = !session.canRedo(); };
    modal.panel.append(title, note, drawingTools(painter), wrap, status, actions);
    modal.mount(); painter.begin(); refresh();
  }
}
