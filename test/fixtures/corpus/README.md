# Real-image corpus

Every image in this directory must decode — `test/corpus/corpus.test.ts` runs in the main
suite and fails CI when one stops decoding. Expected payloads live in
[manifest.json](./manifest.json).

## Adding an image

1. Drop the photo here (PNG; keep it under ~500 kB — downscale first, decoding survives it).
2. Add a manifest entry: `{ "file": "...", "expected": "<payload>", "tags": [...] }`.
3. `pnpm test test/corpus/corpus.test.ts`.

Grow this from real reports: every "fails to scan" issue should become a corpus image once
fixed (tag it with the issue number). Phone photos of screens, paper, curved surfaces,
glare, and low light are the most valuable.

The `synthetic` tag marks renderer-generated seed images that keep the harness exercised
until real photos land — they are **not** evidence of real-world robustness. Real photos
should replace them as the corpus grows; the seeds can then be deleted.
