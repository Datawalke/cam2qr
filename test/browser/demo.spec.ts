import { expect, test } from '@playwright/test';
import { FEED_PAYLOAD } from './global-setup.js';

test('the demo app scans the fake camera feed', async ({ page }) => {
  await page.goto('http://localhost:5183/');

  await expect(page.locator('#status')).toHaveText(/scanning/, { timeout: 20_000 });
  await expect(page.locator('#result')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#result-text')).toHaveText(FEED_PAYLOAD);
  await expect(page.locator('#content-type')).toHaveText('text');
  await expect(page.locator('#meta')).toContainText('v2');
});
