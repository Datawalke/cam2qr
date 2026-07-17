import { describe, expect, it } from 'vitest';
import { generate } from '../helpers/generate.js';
import { renderMatrix } from '../helpers/image.js';

/**
 * Regression for issue #2: a module-level `new TextEncoder()` used to run on
 * import, throwing `ReferenceError` in environments lacking the global
 * (jsdom/Jest, some SSR/edge/RN) before any function was even called. This
 * file deliberately does not statically import the library so the dynamic
 * import below evaluates it fresh with the global removed.
 */
describe('module load without TextEncoder', () => {
  it('imports the entry point when TextEncoder is undefined and decodes byte-mode symbols', async () => {
    // Render the fixture while the global is still present (generation is not
    // under test) so only the library import + decode run without it.
    const frame = renderMatrix(generate('https://cam2qr.com').matrix, { scale: 6, margin: 4 });

    const original = globalThis.TextEncoder;
    // biome-ignore lint/performance/noDelete: removing a genuine global to reproduce the environment
    delete (globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder;
    try {
      const mod = await import('../../src/index.js');
      expect(typeof mod.decode).toBe('function');

      // A byte-mode symbol (a URL) decodes without ever needing TextEncoder —
      // the common camera-decode path stays clean when the global is absent.
      expect(mod.decode(frame)?.text).toBe('https://cam2qr.com');
    } finally {
      globalThis.TextEncoder = original;
    }
  });
});
