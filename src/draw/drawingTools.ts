import { DrawTool, getDrawColor, getLineWidth, Painter } from './Painter';

export function drawingTools(painter: Painter, includeInspect = false): HTMLElement {
  const tools = document.createElement('div'); tools.className = 'tools drawing-tools';
  const choices: [DrawTool, string][] = [['line', '线段'], ['rect', '矩形'], ['circle', '椭圆'], ['text', '文字'], ['eraser', '橡皮'], ['select-rect', '矩形选区'], ['select-ellipse', '椭圆选区'], ['select-free', '套索'], ['fill', '填充']];
  if (includeInspect) choices.unshift(['inspect', '选择面']);
  for (const [tool, name] of choices) {
    const button = document.createElement('button'); button.className = 'btn'; button.textContent = name; button.dataset.tool = tool;
    const active = painter.tool === tool; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => {
      painter.setTool(tool);
      for (const b of tools.querySelectorAll<HTMLButtonElement>('[data-tool]')) { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }
    }); tools.append(button);
  }
  const label = (text: string, input: HTMLElement) => { const node = document.createElement('label'); node.className = 'field'; node.append(text, input); tools.append(node); };
  const color = document.createElement('input'); color.type = 'color'; color.value = getDrawColor(); color.addEventListener('input', () => painter.setDrawColor(color.value)); label('画笔色', color);
  const width = document.createElement('input'); width.type = 'range'; width.min = '1'; width.max = '40'; width.value = String(getLineWidth()); width.className = 'width-slider'; width.addEventListener('input', () => painter.setLineWidth(Number(width.value))); label('粗细', width);
  const text = document.createElement('input'); text.type = 'text'; text.value = '文字'; text.className = 'text-input'; text.addEventListener('input', () => painter.setText(text.value)); label('文字', text);
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.addEventListener('change', () => { if (file.files?.[0]) void painter.importImage(file.files[0]); file.value = ''; }); label('等比导图', file);
  const clear = document.createElement('button'); clear.className = 'btn'; clear.textContent = '取消选区'; clear.addEventListener('click', () => painter.clearSelection()); tools.append(clear);
  return tools;
}
