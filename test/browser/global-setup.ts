import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../helpers/generate.js';
import { renderMatrix } from '../helpers/image.js';

export const FEED_PAYLOAD = 'cam2qr browser e2e';

/**
 * Renders a QR code into an uncompressed YUV4MPEG2 clip that Chromium's
 * --use-file-for-fake-video-capture flag plays as the camera feed.
 */
export default function globalSetup(): void {
  const width = 640;
  const height = 480;

  const symbol = renderMatrix(generate(FEED_PAYLOAD, { version: 2, level: 'M' }).matrix, {
    scale: 8,
    margin: 4,
  });

  // Compose the symbol centered on a light 640×480 luma plane.
  const luma = new Uint8Array(width * height).fill(230);
  const offsetX = (width - symbol.width) >> 1;
  const offsetY = (height - symbol.height) >> 1;
  for (let y = 0; y < symbol.height; y++) {
    for (let x = 0; x < symbol.width; x++) {
      luma[(offsetY + y) * width + (offsetX + x)] = symbol.data[(y * symbol.width + x) * 4]!;
    }
  }

  const chroma = new Uint8Array((width / 2) * (height / 2)).fill(128); // neutral U/V
  const header = `YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`;
  const frameHeader = 'FRAME\n';

  const frames = 30;
  const chunks: Uint8Array[] = [new TextEncoder().encode(header)];
  for (let i = 0; i < frames; i++) {
    chunks.push(new TextEncoder().encode(frameHeader), luma, chroma, chroma);
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const file = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    file.set(chunk, offset);
    offset += chunk.length;
  }

  const artifactsDir = join(dirname(fileURLToPath(import.meta.url)), '.artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(join(artifactsDir, 'qr-feed.y4m'), file);
}
