# React Native support

**Planned as a separate adapter package, with zero changes required in cam2qr's core.**
The work is an adapter, not a port — this document records the feasibility analysis and
the adapter design.

## Portability audit

| Layer | RN-safe? | Notes |
|---|---|---|
| `core/`, `detect/`, `content/` | ✓ as-is | Pure TypeScript over typed arrays; no DOM, no Node APIs. `decode()`/`decodeAll()`/`detect()` take any `{ data, width, height }` RGBA buffer and run under Hermes today. |
| `TextDecoder` usage (`segments.ts`) | ✓ with caveat | Hermes ships `TextDecoder` (UTF-8 always; full label support varies by RN version). The existing try/catch fallback in `decodeBytes`/`decodeShiftJis` degrades gracefully — exotic ECI charsets and Kanji decode as the fallback heuristic or throw the typed `unsupported-mode` error rather than crashing. |
| `camera/` | ✗ by design | Built on `getUserMedia`/`<video>`/canvas. Not portable and not meant to be — this is exactly why the pure layer exists. |
| `scanner/` | ✗ mostly | `QrScanner` needs an `HTMLVideoElement`; the worker runner needs `new Worker(new URL(...))`. The `Deduper` and `StructuredAppendAssembler` are pure and reusable. |

## What a `cam2qr-react-native` package would contain

1. **Frame source**: a [react-native-vision-camera](https://react-native-vision-camera.com)
   frame processor that converts the native frame to RGBA (vision-camera exposes
   `toArrayBuffer()`; most devices deliver YUV, so a small YUV→gray or YUV→RGBA conversion
   runs first — or better, feed the Y plane directly as grayscale by bypassing
   `toGrayscale`, which would need a `grayscale input` fast path in `decode()`; today an
   RGBA expansion of the Y plane works without core changes).
2. **Scan loop**: a `useFrameProcessor` worklet throttled like `maxScansPerSecond`, calling
   `decode()` synchronously inside the worklet (Hermes worklets run off the UI thread — the
   worker-offload problem the web scanner solves with a module worker is solved by
   vision-camera's threading model instead).
3. **A `useQrScanner` hook** mirroring `cam2qr/react`: same result/error/isScanning surface,
   with `Deduper` (and optionally `StructuredAppendAssembler`) reused from cam2qr.

## Risks / open questions

- **Worklet copy cost**: moving a full frame buffer out of the worklet is expensive;
  decode should run inside the worklet and only results should cross the bridge.
  vision-camera v4 supports this pattern.
- **Performance headroom**: 0.5–1 ms/frame on desktop suggests comfortable mid-range phone
  budgets, but this is unmeasured on Hermes — first task of the adapter is running
  `pnpm bench`'s scenarios under Hermes.
- **Y-plane fast path**: worth adding a `GrayImage` input overload to `decode()` when the
  adapter lands (avoids a synthetic RGBA expansion). Small, additive, not needed up front.

## Decision

Ship it as its own package (`cam2qr-react-native`) so cam2qr keeps zero runtime
dependencies and no RN toolchain in CI. Blocked only on prioritization, not on
architecture.
