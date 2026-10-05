/** Modal focus ownership also prevents background scene shortcuts while drawing. */
export class Modal {
  readonly overlay = document.createElement('div');
  readonly panel = document.createElement('section');
  private readonly previous = document.activeElement as HTMLElement | null;
  private readonly backgrounds: { element: HTMLElement; inert: boolean }[] = [];
  private closed = false;

  constructor(className: string, title: string, private readonly cancel: () => void, private readonly history?: (redo: boolean) => void) {
    this.overlay.className = 'face-editor-overlay';
    this.panel.className = className;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-label', title);
    this.panel.tabIndex = -1;
    this.overlay.append(this.panel);
    this.overlay.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.cancel(); return; }
      const target = e.target as HTMLElement;
      const typing = target.matches('input:not([type=range]):not([type=color]), textarea');
      if (!typing && (e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
        e.preventDefault(); this.history?.(e.key.toLowerCase() === 'y' || e.shiftKey); return;
      }
      if (e.key === 'Tab') {
        const items = [...this.panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]')].filter(el => el.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (!first) { e.preventDefault(); this.panel.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === this.panel)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  mount(): void {
    for (const element of [...document.body.children]) {
      if (!(element instanceof HTMLElement) || element === this.overlay || element.tagName === 'SCRIPT') continue;
      this.backgrounds.push({ element, inert: element.inert }); element.inert = true;
    }
    document.body.append(this.overlay);
    this.panel.focus();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.overlay.remove();
    for (const item of this.backgrounds) item.element.inert = item.inert;
    if (this.previous?.isConnected) this.previous.focus();
  }
}
