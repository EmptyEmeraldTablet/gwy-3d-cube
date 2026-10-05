import { StandardView, Viewer } from '../scene/Viewer';

export function createViewBar(viewer: Viewer, actions: { projections: () => void; recover: () => void; practice: () => void }): void {
  const bar = document.createElement('nav'); bar.className = 'view-bar'; bar.setAttribute('aria-label', '观察工具');
  const label = document.createElement('strong'); label.textContent = '空间几何'; bar.append(label);
  const button = (text: string, action: () => void) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = text; b.onclick = action; bar.append(b); return b; };
  const mode = button('进入观察模式', () => { const observe = document.body.classList.toggle('observe-mode'); mode.textContent = observe ? '返回编辑模式' : '进入观察模式'; mode.setAttribute('aria-pressed', String(observe)); viewer.setCenterMarkerVisible(!observe); viewer.clearPreview(); measure(); requestAnimationFrame(() => viewer.fit()); });
  const view = document.createElement('select'); view.setAttribute('aria-label', '标准视图');
  for (const [id, text] of [['iso', '等轴方向'], ['front', '前视'], ['back', '后视'], ['left', '左视'], ['right', '右视'], ['top', '俯视'], ['bottom', '仰视']]) { const o = document.createElement('option'); o.value = id; o.textContent = text; view.append(o); }
  const projection = document.createElement('select'); projection.setAttribute('aria-label', '相机投影');
  for (const [id, text] of [['perspective', '透视观察'], ['orthographic', '正交观察']]) { const o = document.createElement('option'); o.value = id; o.textContent = text; projection.append(o); }
  view.onchange = () => { projection.value = 'orthographic'; viewer.setProjection('orthographic'); viewer.setView(view.value as StandardView); };
  projection.onchange = () => viewer.setProjection(projection.value as 'perspective' | 'orthographic'); bar.append(view, projection);
  button('适应窗口', () => viewer.fit()); button('正交三视图', actions.projections); button('学习练习', actions.practice);
  button('组件组', () => { document.body.classList.toggle(matchMedia('(max-width: 900px)').matches ? 'show-layers' : 'layers-collapsed'); measure(); }); button('恢复自动保存', actions.recover);
  const quality = document.createElement('select'); quality.setAttribute('aria-label', '画面质量');
  for (const [value, text] of [['1', '标准清晰度'], ['2', '高清']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; quality.append(option); } quality.onchange = () => viewer.setQuality(Number(quality.value)); bar.append(quality);
  const measure = () => { document.body.style.setProperty('--view-height', `${bar.offsetHeight}px`); document.body.style.setProperty('--tools-height', `${document.querySelector<HTMLElement>('.toolbar')!.offsetHeight}px`); };
  document.body.append(bar); const observer = new ResizeObserver(measure); observer.observe(bar); observer.observe(document.querySelector('.toolbar')!); measure();
}
