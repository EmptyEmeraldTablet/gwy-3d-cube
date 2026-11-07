import { test, expect } from '@playwright/test';

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
  { width: 390, height: 844 },
]) {
  test(`layer panel keeps rows and controls reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('button', { name: '展开选中', exact: true })).toBeEnabled();
    if (viewport.width <= 900) await page.getByRole('button', { name: '组件组', exact: true }).click();

    const panel = page.locator('.layer-panel');
    const list = page.locator('.lp-list');
    const rows = list.locator('.lp-row');
    const header = page.locator('.lp-header');
    const controls = page.locator('.lp-transform');
    await expect(rows).toHaveCount(1);
    const rowHeight = (await rows.first().boundingBox())!.height;
    expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(rowHeight);
    await expect(rows.first()).toBeInViewport({ ratio: 1 });
    const headerY = (await header.boundingBox())!.y;

    for (let i = 0; i < 9; i++) await page.getByRole('button', { name: '+ 新增图层', exact: true }).click();
    await expect(rows).toHaveCount(10);
    // Short and narrow windows show two complete rows; laptop windows show at least three.
    const visibleRows = viewport.width > 900 && viewport.height >= 720 ? 3 : 2;
    expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(rowHeight * visibleRows + 6 * (visibleRows - 1));
    await expect(rows.first()).toBeInViewport({ ratio: 1 });
    await list.hover(); await page.mouse.wheel(0, 2000);
    await expect(rows.last()).toBeInViewport({ ratio: 1 });
    expect((await header.boundingBox())!.y).toBe(headerY);
    const listY = (await list.boundingBox())!.y;

    await controls.hover(); await page.mouse.wheel(0, 2000);
    await expect(page.locator('.lp-merge')).toBeInViewport({ ratio: 1 });
    const scrollBefore = await controls.evaluate(el => el.scrollTop);
    await page.getByRole('button', { name: '重置原点', exact: true }).click();
    expect(await controls.evaluate(el => el.scrollTop)).toBe(scrollBefore);
    await expect(rows.last()).toBeInViewport({ ratio: 1 });
    await rows.last().locator('.lp-name').click();
    await expect(rows.last()).toHaveClass(/active/);
    await expect(rows.last()).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: '+ 新增图层', exact: true }).click();
    await expect(rows.first()).toHaveClass(/active/);
    await expect(rows.first()).toBeInViewport({ ratio: 1 });
    expect((await list.boundingBox())!.y).toBe(listY);
    expect((await header.boundingBox())!.y).toBe(headerY);
    const bounds = (await panel.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: `test-results/layers-${viewport.width}x${viewport.height}.png` });
  });
}
