import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { decode } from '../../src/decode.js';

/**
 * Corpus regression suite: every image listed in the manifest must decode to
 * its expected payload (with tryHarder — a corpus image is by definition a
 * hard case). See test/fixtures/corpus/README.md for how images get added.
 */
const CORPUS_DIR = join(__dirname, '..', 'fixtures', 'corpus');

interface CorpusEntry {
  file: string;
  expected: string;
  tags: string[];
}

const manifest = JSON.parse(readFileSync(join(CORPUS_DIR, 'manifest.json'), 'utf8')) as {
  entries: CorpusEntry[];
};

describe('image corpus', () => {
  it('has at least one entry', () => {
    expect(manifest.entries.length).toBeGreaterThan(0);
  });

  for (const entry of manifest.entries) {
    it(`decodes ${entry.file} [${entry.tags.join(', ')}]`, () => {
      const png = PNG.sync.read(readFileSync(join(CORPUS_DIR, entry.file)));
      const result = decode(
        { data: png.data, width: png.width, height: png.height },
        { tryHarder: true },
      );
      expect(result, `${entry.file} did not decode`).not.toBeNull();
      expect(result!.text).toBe(entry.expected);
    });
  }
});
