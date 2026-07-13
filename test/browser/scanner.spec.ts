import { expect, test } from '@playwright/test';
import { FEED_PAYLOAD } from './global-setup.js';

interface ScanResult {
  text: string;
  version: number;
  cornerPoints: Array<{ x: number; y: number }>;
  moduleSize: number;
}

declare global {
  interface Window {
    __scanResult?: ScanResult;
    __scanError?: string;
    __workerCount: number;
  }
}

test('QrScanner decodes the fake camera feed in a worker', async ({ page }) => {
  await page.goto('/test/browser/page.html');

  await page.waitForFunction(() => window.__scanResult || window.__scanError, undefined, {
    timeout: 20_000,
  });
  const error = await page.evaluate(() => window.__scanError);
  expect(error, error ?? '').toBeUndefined();

  const result = (await page.evaluate(() => window.__scanResult)) as ScanResult;
  expect(result.text).toBe(FEED_PAYLOAD);
  expect(result.version).toBe(2);
  expect(result.cornerPoints).toHaveLength(4);
  expect(result.moduleSize).toBeGreaterThan(4);

  // The decode must have gone through the module worker, not the fallback.
  expect(await page.evaluate(() => window.__workerCount)).toBeGreaterThanOrEqual(1);

  // The camera must actually be released after stop().
  const videoActive = await page.evaluate(() => {
    const video = document.getElementById('video') as HTMLVideoElement;
    return video.srcObject !== null;
  });
  expect(videoActive).toBe(false);
});
