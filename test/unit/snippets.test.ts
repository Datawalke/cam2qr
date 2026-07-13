import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// The "How it works" page renders source excerpts from site/snippets.js, which
// is generated from the `// #region snippet:` anchors in src/. This gate keeps
// the page from silently drifting when the anchored code changes.
describe('site source snippets', () => {
  it('site/snippets.js is up to date with the anchors in src/', () => {
    const result = spawnSync(process.execPath, ['scripts/extract-snippets.mjs', '--check'], {
      encoding: 'utf8',
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });
});
