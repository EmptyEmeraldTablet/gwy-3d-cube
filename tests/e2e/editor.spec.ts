import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function save(page: Page) {
  const ready = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const download = await ready;
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}
async function stroke(page: Page, label: string) {
  const box = (await page.getByLabel(label, { exact: true }).boundingBox())!;
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .7, { steps: 8 });
  await page.mouse.up();
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.getByRole('button', { name: '展开选中', exact: true })).toBeEnabled(); });

test('264-state engine is accessible and layout-only operations preserve all source pixels', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const before = await save(page);
  await page.getByRole('button', { name: '展开选中', exact: true }).click();
  const initial = await page.locator('.variant-label').textContent();
  for (let i = 0; i < 24; i++) await page.getByRole('button', { name: '下一个具体展开', exact: true }).click();
  await expect(page.locator('.variant-label')).toHaveText(initial!);
  await page.getByLabel('展开类型', { exact: true }).selectOption('net-7');
  const reference = await page.getByLabel('参考面', { exact: true }).inputValue();
  await page.getByLabel('展开类型', { exact: true }).selectOption('net-3');
  await expect(page.getByLabel('参考面', { exact: true })).toHaveValue(reference);
  await page.getByRole('button', { name: '返回上一个展开', exact: true }).click();
  await expect(page.getByLabel('展开类型', { exact: true })).toHaveValue('net-7');
  await page.getByRole('button', { name: '保存布局书签', exact: true }).click();
  await page.screenshot({ path: 'test-results/net-editor.png', fullPage: true });
  await page.getByRole('button', { name: '应用到立方体', exact: true }).click();
  const after = await save(page);
  expect(after.cubes[0].faces).toEqual(before.cubes[0].faces);
  expect(after.cubes[0].net.current.templateId).toBe('net-7');
  expect(after.cubes[0].net.bookmarks).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('face cancellation and local undo never change the underlying scene', async ({ page }) => {
  const before = await save(page);
  await page.getByRole('button', { name: '编辑选中面', exact: true }).click();
  await stroke(page, '面绘制画布');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: '重做笔画', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await save(page);
  expect(after.cubes).toEqual(before.cubes);
});

test('drawn net survives type changes and restores its directed layout after file reload', async ({ page }) => {
  await page.getByRole('button', { name: '展开选中', exact: true }).click();
  await page.getByLabel('展开类型', { exact: true }).selectOption('net-7');
  await page.getByRole('button', { name: '线段', exact: true }).click();
  // Fill is masked to the six valid cells and provides a robust draft across layouts.
  await page.getByRole('button', { name: '填充', exact: true }).click();
  const point = await page.evaluate(async () => {
    const { netLayout } = await import('/src/model/netVariants.ts');
    const state = { templateId: 'net-7', referenceFace: (document.querySelector('[aria-label="参考面"]') as HTMLSelectElement).value, referenceTurn: Number((document.querySelector('[aria-label="参考面方向"]') as HTMLSelectElement).value), viewTurn: 0 };
    const l = netLayout(state as never), c = l.cells[l.root];
    const canvas = document.querySelector('[aria-label="展开图绘制画布"]')!;
    const r = canvas.getBoundingClientRect(); return { x: r.x + (c.col + .5) / l.cols * r.width, y: r.y + (c.row + .5) / l.rows * r.height };
  });
  await page.mouse.click(point.x, point.y);
  await page.getByLabel('展开类型', { exact: true }).selectOption('net-3');
  await page.getByRole('button', { name: '回到绘制布局', exact: true }).click();
  await expect(page.getByLabel('展开类型', { exact: true })).toHaveValue('net-7');
  await page.getByRole('button', { name: '应用到立方体', exact: true }).click();
  const saved = await save(page);
  expect(saved.cubes[0].net.drawing.templateId).toBe('net-7');
  await page.locator('.toolbar input[type=file]').setInputFiles({ name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await expect(page.locator('.scene-status')).toContainText('已读取');
  await page.getByLabel('标准视图').selectOption('front');
  await page.locator('#scene').click();
  await page.getByRole('button', { name: '展开选中', exact: true }).click();
  await expect(page.getByLabel('展开类型', { exact: true })).toHaveValue('net-7');
  await page.getByLabel('展开类型', { exact: true }).selectOption('net-3');
  await page.getByRole('button', { name: '回到绘制布局', exact: true }).click();
  await expect(page.getByLabel('展开类型', { exact: true })).toHaveValue('net-7');
  await page.keyboard.press('Escape');
  const loaded = await save(page);
  expect(loaded.cubes[0].faces).toEqual(saved.cubes[0].faces);
  expect(loaded.cubes[0].net).toEqual(saved.cubes[0].net);
});

test('invalid imports preserve current work and report errors', async ({ page }) => {
  const before = await save(page);
  await page.locator('.toolbar input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2}') });
  await expect(page.locator('.scene-status')).toContainText('读取失败，原作品已保留');
  expect((await save(page)).cubes).toEqual(before.cubes);
  const broken = structuredClone(before); broken.cubes[0].faces.px = 'data:image/png;base64,AAAA';
  await page.locator('.toolbar input[type=file]').setInputFiles({ name: 'bad-image.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(broken)) });
  await expect(page.locator('.scene-status')).toContainText('面图片无法解码');
  expect((await save(page)).cubes).toEqual(before.cubes);
});

test('narrow editor remains scrollable and can be closed by keyboard', async ({ page }) => {
  await page.getByRole('button', { name: '展开选中', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '下一个具体展开', exact: true }).click();
  await page.getByRole('button', { name: '应用到立方体', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/net-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('pointer cancellation rolls back an unfinished stroke and modal focus stays contained', async ({ page }) => {
  await page.getByRole('button', { name: '编辑选中面', exact: true }).click();
  const canvas = page.getByLabel('面绘制画布', { exact: true });
  const before = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .3); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .6, { steps: 4 });
  await canvas.dispatchEvent('pointercancel'); await page.mouse.up();
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).toBe(before);
  await expect(page.getByRole('button', { name: '撤销笔画', exact: true })).toBeDisabled();
  for (let i = 0; i < 22; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape');
});
