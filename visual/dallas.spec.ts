import { expect, test } from '@playwright/test';

test('city picker retains its reference-quality planning entry screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dallas', exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('city-picker.png', { fullPage: true, animations: 'disabled', caret: 'hide' });
});

test('Dallas workspace retains its planning chrome and controls', async ({ page }) => {
  // Remote raster tiles are intentionally excluded: gameplay geometry and UI are
  // local, while live OSM imagery would make a screenshot baseline nondeterministic.
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dallas', exact: true })).toBeVisible();
  const dallasCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Dallas', exact: true }) });
  await dallasCard.getByRole('button', { name: /start fresh/i }).click();
  await expect(page.locator('.game-shell')).toBeVisible();
  await expect(page.locator('.map-workspace')).toBeVisible();
  // Geometry itself is separately unit-tested. Hide the WebGL canvas here so a
  // GPU-dependent renderer cannot make the UI-layout baseline flaky.
  await expect(page).toHaveScreenshot('dallas-workspace.png', { fullPage: true, animations: 'disabled', caret: 'hide', style: '.map-workspace .map-stage { display: none !important; } .map-workspace { background: #dce7ef !important; }' });
});
