# Benchmarks: cam2qr vs jsQR vs @zxing/library

Regenerate with `pnpm compare` (writes this file). Synthetic frames from the
test renderer, seeded and reproducible; decoded text must match the payload
exactly. 25 frames per scenario, version-2 symbols.

Environment: Node v25.9.0, Apple M1 Max.

## Detection rate

| Scenario | cam2qr | cam2qr (tryHarder) | jsQR | @zxing/library |
|---|---|---|---|---|
| clean render | 100% | 100% | 100% | 100% |
| rotated 30° | 100% | 100% | 100% | 100% |
| perspective (≤9% pull) | 100% | 100% | 100% | 100% |
| salt & pepper noise 2% | 64% | 100% | 60% | 20% |
| lighting gradient 0.35→1.0 | 100% | 100% | 100% | 96% |
| low contrast (110–165) | 100% | 100% | 48% | 96% |
| box blur r=1 | 100% | 100% | 100% | 96% |
| box blur r=2 | 100% | 100% | 100% | 100% |
| inverted | 100% | 100% | 100% | 0% |

## Decode speed (median ms/frame)

| Decoder | clean ~200×200 | 1280×720, one symbol |
|---|---|---|
| cam2qr | 0.39 | 5.08 |
| cam2qr (tryHarder) | 0.40 | 4.93 |
| jsQR | 1.99 | 25.93 |
| @zxing/library | 0.29 | 5.03 |
| cam2qr (maxDownscale 2 — scanner default) | 0.40 | 4.47 |

Notes: jsQR runs with `inversionAttempts: attemptBoth`; @zxing/library runs
its QR reader with `TRY_HARDER` and a hybrid binarizer. cam2qr rows show the
default configuration and `tryHarder` separately.
