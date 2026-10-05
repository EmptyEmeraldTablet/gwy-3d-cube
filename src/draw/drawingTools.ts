import { DrawTool, getDrawColor, getLineWidth, Painter } from './Painter';

export function drawingTools(painter: Painter, includeInspect = false): HTMLElement {
  const tools = document.createElement('div'); tools.className = 'tools drawing-tools';
  const primary = document.createElement('div'); primary.className = 'drawing-tool-row'; tools.append(primary);
  const options = document.createElement('div'); options.className = 'drawing-tool-options'; tools.append(options);
  const hint = document.createElement('span'); hint.className = 'drawing-tool-hint';
  const choices: [DrawTool, string][] = [['line', '线段'], ['rect', '矩形'], ['circle', '椭圆'], ['text', '文字'], ['eraser', '橡皮'], ['fill', '填充']];
  if (includeInspect) choices.unshift(['inspect', '选择面']);
  const selection = document.createElement('select'); selection.setAttribute('aria-label', '选区工具');
  for (const [value, text] of [['', '选区工具…'], ['select-rect', '矩形选区'], ['select-ellipse', '椭圆选区'], ['select-free', '套索选区']]) { const o = document.createElement('option'); o.value = value; o.textContent = text; selection.append(o); }
  const setTool = (tool: DrawTool) => {
    painter.setTool(tool);
    for (const b of tools.querySelectorAll<HTMLButtonElement>('[data-tool]')) { b.classList.toggle('active', b.dataset.tool === tool); b.setAttribute('aria-pressed', String(b.dataset.tool === tool)); }
    selection.value = tool.startsWith('select-') ? tool : ''; textLabel.hidden = tool !== 'text';
    hint.textContent = tool === 'inspect' ? '点击面选中，再选择绘图工具。' : tool === 'fill' ? '点击填充当前画板；有选区时只填选区。' : tool.startsWith('select-') ? '拖出选区后，绘图与填充都限定在选区内。' : tool === 'text' ? '输入文字后，点击画板放置。' : '拖动绘制；Ctrl+Z 撤销。';
  };
  for (const [tool, name] of choices) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = name; b.dataset.tool = tool; b.onclick = () => setTool(tool); primary.append(b); }
  selection.onchange = () => { if (selection.value) setTool(selection.value as DrawTool); }; primary.append(selection);
  const clear = document.createElement('button'); clear.className = 'btn'; clear.textContent = '取消选区'; clear.onclick = () => painter.clearSelection(); primary.append(clear);
  const label = (text: string, input: HTMLElement) => { const node = document.createElement('label'); node.className = 'field'; node.append(text, input); options.append(node); return node; };
  const color = document.createElement('input'); color.type = 'color'; color.value = getDrawColor(); color.oninput = () => painter.setDrawColor(color.value); label('画笔色', color);
  const width = document.createElement('input'); width.type = 'range'; width.min = '1'; width.max = '40'; width.value = String(getLineWidth()); width.className = 'width-slider';
  const widthValue = document.createElement('output'); widthValue.value = `${width.value}px`;
  width.oninput = () => { painter.setLineWidth(Number(width.value)); widthValue.value = `${width.value}px`; }; label('粗细', width).append(widthValue);
  const text = document.createElement('input'); text.type = 'text'; text.value = '文字'; text.className = 'text-input'; text.oninput = () => painter.setText(text.value); const textLabel = label('文字', text);
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; file.setAttribute('aria-label', '导入图案图片'); file.onchange = () => { if (file.files?.[0]) void painter.importImage(file.files[0]); file.value = ''; };
  const importButton = document.createElement('button'); importButton.className = 'btn'; importButton.textContent = '导入图片'; importButton.title = '等比放入当前画板；有选区时只绘入选区。'; importButton.onclick = () => file.click(); options.append(importButton, file, hint);
  setTool(painter.tool); return tools;
}
