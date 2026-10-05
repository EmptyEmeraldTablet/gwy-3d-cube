import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function save(page: Page) {
  const ready = page.waitForEvent('download'); await page.getByRole('button', { name: '保存', exact: true }).click();
  return JSON.parse(await readFile((await (await ready).path())!, 'utf8'));
}
async function stroke(page: Page, label: string) {
  const r = (await page.getByLabel(label, { exact: true }).boundingBox())!;
  await page.mouse.move(r.x + r.width * .3, r.y + r.height * .3); await page.mouse.down();
  await page.mouse.move(r.x + r.width * .6, r.y + r.height * .7, { steps: 5 }); await page.mouse.up();
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.getByRole('button', { name: '展开选中', exact: true })).toBeEnabled(); });

test('creation choices explain and follow different placement rules', async ({ page }) => {
  await expect(page.locator('.toolbar-context')).toContainText('添加：放到活动组的空闲格');
  await expect(page.getByRole('button', { name: '添加立方体', exact: true })).toContainText('放到空闲格');
  await expect(page.getByRole('button', { name: '贴面堆叠', exact: true })).toContainText('紧贴选中面');
  await page.getByLabel('标准视图').selectOption('top'); await page.locator('#scene').click();
  await expect(page.locator('.toolbar-context strong')).toContainText('面 E');
  await page.getByRole('button', { name: '贴面堆叠', exact: true }).focus();
  await expect(page.locator('#construction-help')).toContainText('沿选中面的外侧');
  await page.getByRole('button', { name: '贴面堆叠', exact: true }).click();
  await expect(page.locator('.scene-status')).toContainText('紧贴 cube-1 的面 E');
  await page.getByRole('button', { name: '添加立方体', exact: true }).click();
  await expect(page.locator('.scene-status')).toContainText('空闲格 (1, 0, 0)');
  const scene = await save(page);
  expect(scene.cubes.map((c: { gridPos: unknown }) => c.gridPos)).toEqual([{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }]);
  await page.screenshot({ path: 'test-results/ui-main-desktop.png' });
});

test('single-face detail and net drawing share one draft without overlapping dialogs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '编辑选中面', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.locator('.face-studio .editor-note')).toContainText('只修改面 B');
  await stroke(page, '面绘制画布'); await page.getByRole('button', { name: '完成', exact: true }).click();
  const baseline = await save(page);
  await page.getByRole('button', { name: '展开选中', exact: true }).click();
  const drawArea = (await page.getByLabel('可缩放绘图区', { exact: true }).boundingBox())!;
  expect(drawArea.width).toBeGreaterThan(950); expect(drawArea.height).toBeGreaterThan(580);
  await page.getByLabel('当前编辑面').selectOption('pz');
  await page.getByRole('button', { name: '放大编辑面 A', exact: true }).click();
  const canvas = page.getByLabel('展开图绘制画布', { exact: true });
  const original = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await expect(page.getByRole('button', { name: '线段', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await stroke(page, '展开图绘制画布');
  const painted = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL()); expect(painted).not.toBe(original);
  await page.keyboard.press('Control+z'); expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(original);
  await page.keyboard.press('Control+y'); expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(painted);
  await page.getByLabel('当前编辑面').selectOption('nz'); expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(painted);
  await page.getByLabel('当前编辑面').selectOption('pz');
  await page.getByRole('button', { name: '返回六面展开', exact: true }).click();
  await page.getByLabel('展开类型', { exact: true }).selectOption('net-7');
  await page.getByRole('button', { name: '放大编辑面 A', exact: true }).click();
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(painted);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('tab', { name: '折叠预览', exact: true }).click();
  await expect(page.getByLabel('可旋转的三维折叠预览')).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-single-face-in-net.png' });
  await page.getByRole('button', { name: '应用到立方体', exact: true }).click();
  const after = await save(page);
  for (const face of ['px', 'nx', 'py', 'ny', 'nz']) expect(after.cubes[0].faces[face]).toBe(baseline.cubes[0].faces[face]);
  expect(after.cubes[0].faces.pz).toBe(painted);
  await page.getByLabel('标准视图').selectOption('front'); await page.locator('#scene').click();
  await page.getByRole('button', { name: '编辑选中面', exact: true }).click();
  expect(await page.getByLabel('面绘制画布').evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(painted);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '↶ 撤销', exact: true }).click();
  expect((await save(page)).cubes[0].faces).toEqual(baseline.cubes[0].faces); expect(errors).toEqual([]);
});

test('zoomed rotated painting lands on the intended source face; view navigation adds no ink', async ({ page }) => {
  const before = await save(page);
  await page.getByRole('button', { name: '展开选中', exact: true }).click();
  await page.getByRole('button', { name: '整图旋转 90°', exact: true }).click();
  const zoom = Number((await page.getByLabel('画板缩放比例').textContent())!.replace('%', ''));
  await page.getByRole('button', { name: '放大画板', exact: true }).click();
  expect(Number((await page.getByLabel('画板缩放比例').textContent())!.replace('%', ''))).toBeGreaterThan(zoom);
  const canvas = page.getByLabel('展开图绘制画布'); const pixels = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.getByRole('button', { name: '拖动画板', exact: true }).click();
  const area = (await page.getByLabel('可缩放绘图区').boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2); await page.mouse.down(); await page.mouse.move(area.x + area.width / 2 + 90, area.y + area.height / 2 - 60, { steps: 6 }); await page.mouse.up();
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(pixels);
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await expect(page.getByRole('button', { name: '拖动画板', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('textbox', { name: '文字', exact: true }).fill('R');
  const point = await page.evaluate(async () => {
    const { netLayout } = await import('/src/model/netVariants.ts');
    const val = (name: string) => (document.querySelector(`[aria-label="${name}"]`) as HTMLSelectElement).value;
    const layout = netLayout({ templateId: val('展开类型'), referenceFace: val('参考面'), referenceTurn: Number(val('参考面方向')), viewTurn: 1 } as never);
    const c = document.querySelector('[aria-label="展开图绘制画布"]') as HTMLCanvasElement, root = layout.cells[layout.root], r = c.getBoundingClientRect();
    // One clockwise quarter turn: screen right is source up, screen down is source right.
    const sourceX = (root.col + .5) * 256, sourceY = (root.row + .5) * 256;
    return { x: r.x + r.width / 2 - (sourceY - c.height / 2) / c.height * r.width, y: r.y + r.height / 2 + (sourceX - c.width / 2) / c.width * r.height, face: root.face };
  });
  await page.mouse.click(point.x, point.y);
  await page.getByRole('button', { name: '应用到立方体', exact: true }).click();
  const after = await save(page);
  for (const face of Object.keys(before.cubes[0].faces)) expect(after.cubes[0].faces[face] !== before.cubes[0].faces[face]).toBe(face === point.face);
});

test('mobile editing keeps canvas, sidebar return and commit actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/ui-main-mobile.png' });
  await page.getByRole('button', { name: '展开选中', exact: true }).click();
  await expect(page.locator('[data-action="toggle-sidebar"]')).toHaveAttribute('aria-expanded', 'false');
  const area = (await page.getByLabel('可缩放绘图区').boundingBox())!; expect(area.width).toBeGreaterThan(340); expect(area.height).toBeGreaterThan(240);
  await page.getByRole('button', { name: '展开布局 / 预览', exact: true }).click();
  await page.getByLabel('展开类型', { exact: true }).selectOption('net-11');
  await page.getByRole('button', { name: '返回画板', exact: true }).click();
  await page.getByRole('button', { name: '放大编辑面 B', exact: true }).click();
  await stroke(page, '展开图绘制画布');
  const apply = page.getByRole('button', { name: '应用到立方体', exact: true });
  const bounds = (await apply.boundingBox())!; expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: 'test-results/ui-net-mobile.png' });
  await apply.click(); expect((await save(page)).cubes[0].net.current.templateId).toBe('net-11');
});
