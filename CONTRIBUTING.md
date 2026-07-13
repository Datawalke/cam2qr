# Contributing to cam2qr

Thanks for helping out. This document covers everything you need to work on the library:
setup, commands, how the code is organized, and the conventions that keep it small and
dependency-free.

## Setup

Requires Node >= 20 and [pnpm](https://pnpm.io) (the repo pins `pnpm@10.12.1` via
`packageManager`, so `corepack enable` is enough).

```sh
pnpm install
pnpm test        # quick sanity check
```

## Commands

```sh
pnpm test          # Vitest: unit + roundtrip + scanner + adapter + detect tests (Node, no browser)
pnpm test:watch    # Vitest watch mode
pnpm test:browser  # Playwright E2E — builds first, runs against dist in real Chromium
pnpm typecheck     # tsc --noEmit
pnpm lint          # biome check src test demo
pnpm lint:fix      # biome check --write ...
pnpm build         # tsup → dist/ (esm + cjs + .d.ts)
pnpm bench         # vitest bench — decode speed
pnpm compare       # cam2qr vs jsQR vs @zxing/library → regenerates docs/benchmarks.md
pnpm size          # size-limit bundle-size budget check
pnpm demo          # build + serve the demo scanner page (Vite, port 5183)
pnpm ci            # typecheck && lint && test && build && size
```

Run a single test file with `pnpm test <path>` (e.g. `pnpm test test/unit/gf256.test.ts`).
Run `pnpm ci` before opening a pull request — it is the same gate CI runs
(see [.github/workflows/ci.yml](./.github/workflows/ci.yml)).

## Architecture

Three layers, each usable on its own — this layering is deliberate, keep it intact:

1. **`decode(imageData, options)`** ([src/decode.ts](./src/decode.ts)) — a pure function
   over any `{ data, width, height }` RGBA buffer. Works in Node. No DOM, no camera.
2. **`QrScanner`** ([src/scanner/scanner.ts](./src/scanner/scanner.ts)) — batteries-included
   live camera scanning (permissions, torch, camera switching, dedupe, worker offload).
3. **Framework adapters** — `cam2qr/react` ([src/react.ts](./src/react.ts)),
   `cam2qr/vue` ([src/vue.ts](./src/vue.ts)), `cam2qr/svelte` ([src/svelte.ts](./src/svelte.ts)).

Directory map under `src/`:

- `core/` — the spec-level codec: `gf256` (GF(256)), `reed-solomon`, `bch`, `format`,
  `version`, `mask`, `bitstream`, `codewords`, `segments`, `bit-matrix`, `decode-matrix`,
  `function-pattern`. Pure, no I/O. This is where the QR standard lives.
- `detect/` — image → bit matrix: `grayscale`, `binarizer` (adaptive), `finder`,
  `alignment`, `perspective`, `detector`, `downscale`, `bit-image`.
- `content/` — `parse.ts` classifies decoded text (url / wifi / vcard / geo / tel / sms /
  email / gs1 / text) into `ParsedContent`.
- `camera/` — DOM/media layer: `stream` (getUserMedia + `listCameras`), `frame-grabber`,
  `capabilities` (torch/zoom), typed `errors` (`CameraError.code`).
- `scanner/` — `scanner` (public class), `runner` (worker vs main-thread decode loop),
  `dedupe`, `structured-append`, `coords`, `native` (`BarcodeDetector` fast path).
- `worker.ts` — Web Worker entry; runs the full pipeline off the main thread, transferable
  buffers in, results out keyed by request id. Built to `dist/worker.js`.
- `index.ts` — the single public export surface. When adding public API, export it here and
  keep types in `types.ts` / errors in `errors.ts`.

Pipeline for one frame: grayscale → (optional downscale) → binarize → detect finder patterns
→ perspective-correct to a `BitMatrix` → read format/version → unmask → deinterleave
codewords → Reed–Solomon correct → decode segments → parse content.

## Conventions

- **Zero runtime dependencies is a hard constraint.** `dependencies` in `package.json` must
  stay empty; `react`, `vue`, and `svelte` are optional peer deps only. Do not add a runtime
  dependency to solve a problem the in-repo pipeline is meant to cover.
- **Independent implementation.** The detect/decode pipeline is implemented from the
  ISO/IEC 18004 specification and standard textbook mathematics. Do not port or paraphrase
  code from other QR implementations (zxing, jsQR, etc.).
- **Bundle size is budgeted.** `pnpm size` enforces limits for every entry point. Keep the
  code tree-shakeable (`sideEffects: false`).
- **ESM-first with explicit `.js` import extensions** in TypeScript source (e.g.
  `import { decode } from './decode.js'`) — required by the module resolution setup.
- **Formatting/linting is Biome** ([biome.json](./biome.json)): single quotes, trailing
  commas, 2-space indent, 100-col width. Run `pnpm lint:fix` rather than hand-formatting.
- **Errors are typed.** Decode failures use `DecodeError` (with a `DecodeErrorCode`); camera
  failures use `CameraError` (with a `CameraErrorCode`). `decode()` returns `null` for
  "no decodable code" and only throws on genuinely invalid input. Preserve this contract.

## Testing

Every decoder stage has unit tests. Roundtrip tests use the **external `qrcode` package for
generation only** (never for decoding — decoding is what we're testing) across all 40
versions × 4 EC levels × 8 masks. Detection is tested against a pure-TS software renderer
that produces distorted images (rotation, perspective, noise, blur, lighting gradients,
inversion). `test/browser/` feeds a generated YUV4MPEG2 clip to Chromium's fake camera to
verify the shipped bundle end to end.

When changing pipeline behavior, add or adjust tests in the matching `test/` subdirectory
and keep the roundtrip matrix passing. Browser tests require a build first (the script
handles it).

### The image corpus

[test/fixtures/corpus](./test/fixtures/corpus/) holds real-world images that must always
decode; the main suite enforces this. If you are fixing a "fails to scan" bug, add the
offending image to the corpus (see its README) so the fix can never silently regress.

## Reporting bugs

For scan failures, please attach the image (or a frame grab) that fails — it is the
difference between a guess and a permanent regression test. For camera/scanner issues,
include browser, OS, and the `CameraError.code` if one was raised.
