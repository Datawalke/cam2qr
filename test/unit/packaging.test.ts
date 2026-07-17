import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const pkg = readJson(join(root, 'package.json'));

/**
 * Regression for issue #1: `cam2qr/react` (and /vue, /svelte) were reachable
 * only through the `exports` map. Consumers on classic `moduleResolution:
 * node` (TS < 5, CRA/react-scripts, Jest 27's resolver) honor neither
 * `exports` nor `typesVersions`, so they could resolve neither the types nor
 * the module. Root directory stubs (`react/package.json`, …) give those legacy
 * resolvers a `main`/`module`/`types` to find, while modern resolvers keep
 * using `exports`.
 */
const ADAPTERS = [
  { subpath: 'react', named: 'useQrScanner' },
  { subpath: 'vue', named: 'useQrScanner' },
  { subpath: 'svelte', named: 'createQrScanner' },
] as const;

describe('package subpath resolution for legacy resolvers', () => {
  for (const { subpath, named } of ADAPTERS) {
    describe(`cam2qr/${subpath}`, () => {
      const stubPath = join(root, subpath, 'package.json');

      it('is published (listed in files) alongside the exports entry', () => {
        expect(pkg.files).toContain(`${subpath}/package.json`);
        const exports = pkg.exports as Record<string, unknown>;
        expect(exports[`./${subpath}`]).toBeDefined();
      });

      it('ships a directory stub with main/module/types for classic node resolution', () => {
        expect(existsSync(stubPath)).toBe(true);
        const stub = readJson(stubPath);
        // These are exactly the fields a classic node resolver reads when it
        // resolves the `cam2qr/<subpath>` directory (require → main, bundler
        // mainFields → module, tsc → types).
        expect(stub.main).toBe(`../dist/${subpath}.cjs`);
        expect(stub.module).toBe(`../dist/${subpath}.js`);
        expect(stub.types).toBe(`../dist/${subpath}.d.ts`);
      });

      it('exposes a typesVersions fallback pointing at the built d.ts', () => {
        const typesVersions = pkg.typesVersions as Record<string, Record<string, string[]>>;
        expect(typesVersions['*']?.[subpath]).toEqual([`dist/${subpath}.d.ts`]);
      });

      // The real proof the stub routes require() to the CJS build. Skipped when
      // dist has not been built yet (fresh CI runs tests before build).
      const built = existsSync(join(root, 'dist', `${subpath}.cjs`));
      it.skipIf(!built)('require() resolves through the directory stub to the CJS build', () => {
        const mod = require(join(root, subpath)) as Record<string, unknown>;
        expect(typeof mod[named]).toBe('function');
      });
    });
  }
});
