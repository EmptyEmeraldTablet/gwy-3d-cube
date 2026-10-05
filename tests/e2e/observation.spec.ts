import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function save(page: Page) { const ready = page.waitForEvent('download'); await page.getByRole('button', { name: '保存', exact: true }).click(); return JSON.parse(await readFile((await (await ready).path())!, 'utf8')); }
test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.getByRole('button', { name: '展开选中', exact: true })).toBeEnabled(); });

test('asymmetric transparent pixels round trip through every net without tinting or mirroring', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { FACE_ORDER } = await import('/src/model/types.ts');
    const { NET_TEMPLATES } = await import('/src/model/net.ts');
    const { defaultNetState, netVariants, netLayout } = await import('/src/model/netVariants.ts');
    const { renderNet, extractNet } = await import('/src/draw/netCanvas.ts');
    const { createCube, disposeCube, markFaceDirty, setCubeColor, createCubeFromData } = await import('/src/scene/CubeFactory.ts');
    const { serializeScene, validateScene } = await import('/src/model/serialize.ts');
    const { createDefaultLayer } = await import('/src/model/types.ts');
    const cube = createCube({ x: 0, y: 0, z: 0 }, 1), layer = createDefaultLayer();
    for (const [i, f] of FACE_ORDER.entries()) { const ctx = cube.faces[f].canvas.getContext('2d')!; ctx.clearRect(0, 0, 256, 256); ctx.fillStyle = `rgb(${i * 40},80,170)`; ctx.fillRect(12, 25, 51, 113); ctx.fillStyle = 'rgba(255,20,40,0.4)'; ctx.fillRect(79, 41, 29, 81); ctx.font = 'bold 45px sans-serif'; ctx.fillText(`F${i}↗`, 95, 182); markFaceDirty(cube, f); }
    const faces = Object.fromEntries(FACE_ORDER.map(f => [f, cube.faces[f].canvas]));
    const reference = FACE_ORDER.map(f => faces[f].toDataURL()), canvas = document.createElement('canvas');
    let mismatch = '';
    for (const t of NET_TEMPLATES) for (const state of netVariants({ ...defaultNetState(), templateId: t.id })) { const layout = netLayout(state); renderNet(faces, layout, canvas); extractNet(canvas, layout, faces); if (FACE_ORDER.some((f, i) => faces[f].toDataURL() !== reference[i])) mismatch = JSON.stringify(state); }
    const before = Array.from((cube.faces.px.texture.image as HTMLCanvasElement).getContext('2d')!.getImageData(20, 30, 1, 1).data);
    setCubeColor(cube, '#e53935');
    const after = Array.from((cube.faces.px.texture.image as HTMLCanvasElement).getContext('2d')!.getImageData(20, 30, 1, 1).data);
    const background = Array.from((cube.faces.px.texture.image as HTMLCanvasElement).getContext('2d')!.getImageData(200, 220, 1, 1).data);
    const serialized = serializeScene([cube], [layer], layer.id, 1), loaded = await createCubeFromData(validateScene(serialized).cubes[0]);
    const same = FACE_ORDER.every((f, i) => loaded.faces[f].canvas.toDataURL() === reference[i]);
    disposeCube(cube); disposeCube(loaded); return { mismatch, before, after, background, same };
  });
  expect(result.mismatch).toBe(''); expect(result.after).toEqual(result.before); expect(result.background).toEqual([229, 57, 53, 255]); expect(result.same).toBe(true);
});

test('standard camera views leave geometry unchanged; projections show and export all three directions', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const before = await save(page);
  for (const view of ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso']) await page.getByLabel('标准视图').selectOption(view);
  const after = await save(page); expect(after.cubes).toEqual(before.cubes); expect(after.view.projection).toBe('orthographic');
  await page.getByRole('button', { name: '正交三视图', exact: true }).click();
  for (const label of ['正视图', '俯视图', '右视图']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  await page.getByLabel('正视图', { exact: true }).click();
  await expect(page.locator('.projection-sources')).toContainText('cube-1');
  await page.getByLabel('投影显示').selectOption('patterns');
  await page.screenshot({ path: 'test-results/projections.png' });
  const ready = page.waitForEvent('download'); await page.getByRole('button', { name: '导出三视图', exact: true }).click(); expect((await ready).suggestedFilename()).toBe('三视图.png');
  await page.keyboard.press('Escape'); expect(errors).toEqual([]);
});

test('completed work is recoverable from IndexedDB after reload', async ({ page }) => {
  await page.getByRole('button', { name: '添加立方体', exact: true }).click();
  const before = await save(page);
  await expect(page.locator('.save-status')).toContainText('已自动保存到本机');
  await page.reload(); await page.getByRole('button', { name: '恢复自动保存', exact: true }).click();
  await page.getByRole('button', { name: '恢复这份作品', exact: true }).click();
  await expect(page.locator('.scene-status')).toContainText('已读取 2 个单体');
  const after = await save(page); expect(after.cubes).toEqual(before.cubes);
});

test('three exercises verify geometry and remember local progress', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const before = await save(page);
  await page.getByRole('button', { name: '学习练习', exact: true }).click();
  await page.getByRole('button', { name: '选项 3', exact: true }).click();
  await expect(page.locator('.practice-panel .editor-status')).toContainText('回答正确');
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await page.getByRole('button', { name: '面 C', exact: true }).click();
  await expect(page.locator('.practice-panel .editor-status')).toContainText('回答正确');
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await page.getByRole('button', { name: '后（C）', exact: true }).click();
  await expect(page.locator('.practice-panel .editor-status')).toContainText('回答正确');
  await page.screenshot({ path: 'test-results/practice.png' });
  await page.getByRole('button', { name: '结束练习', exact: true }).click();
  expect((await save(page)).cubes).toEqual(before.cubes); expect(errors).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spatial-practice-v1')!).length)).toBe(3);
});

test('opacity is one undoable transaction and hidden selection is cleared', async ({ page }) => {
  const opacity = page.locator('.lp-opacity');
  await opacity.evaluate((input: HTMLInputElement) => { for (const value of ['80', '50', '20']) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); } input.dispatchEvent(new Event('change', { bubbles: true })); });
  expect((await save(page)).layers[0].opacity).toBe(.2);
  await page.getByRole('button', { name: '↶ 撤销', exact: true }).click(); expect((await save(page)).layers[0].opacity).toBe(1);
  await page.getByRole('button', { name: '↷ 重做', exact: true }).click(); expect((await save(page)).layers[0].opacity).toBe(.2);
  await page.getByRole('button', { name: '显', exact: true }).click();
  await expect(page.getByRole('button', { name: '展开选中', exact: true })).toBeDisabled();
});

test('narrow observation mode retains a usable viewport and edit controls remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '进入观察模式', exact: true }).click();
  const viewport = (await page.locator('#scene').boundingBox())!; expect(viewport.width).toBeGreaterThan(350); expect(viewport.height).toBeGreaterThan(400);
  await page.screenshot({ path: 'test-results/observation-mobile.png' });
  await page.getByRole('button', { name: '返回编辑模式', exact: true }).click();
  await page.getByRole('button', { name: '展开选中', exact: true }).click(); await page.keyboard.press('Escape');
});
