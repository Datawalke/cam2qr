# cam2qr

Zero-dependency TypeScript QR code scanning for the browser, camera included.

[![CI](https://github.com/Datawalke/cam2qr/actions/workflows/ci.yml/badge.svg)](https://github.com/Datawalke/cam2qr/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cam2qr)](https://www.npmjs.com/package/cam2qr)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The entire pipeline (adaptive binarization, finder-pattern location, perspective
correction, Reed-Solomon error correction, segment decoding) is implemented independently
from the ISO/IEC 18004 specification. Not a port or a wrapper of an existing scanner.
Full docs and a how-it-works deep dive live at [cam2qr.com](https://cam2qr.com).

- **Zero runtime dependencies.** One package, nothing else in your lockfile.
  13.4 kB brotli for the full camera scanner; 9.5 kB if you only import `decode()`.
- **Layered.** Use `decode(imageData)` as a pure function (works in Node), `QrScanner`
  for batteries-included camera scanning, or the `cam2qr/react`, `cam2qr/vue`, and
  `cam2qr/svelte` adapters.
- **Fast, off the main thread.** ~0.6 ms per clean frame; live scanning decodes in a
  module Web Worker by default with automatic main-thread fallback.
- **Robust.** Decodes 100% of every distortion sweep (noise, blur, rotation, perspective,
  low contrast, inversion) in the [public benchmark](./docs/benchmarks.md) against jsQR
  and @zxing/library.
- **Typed errors, rich results.** `CameraError.code` tells you *why* the camera failed;
  results carry corner points, version, EC level, corrected-codeword counts, raw bytes,
  segments, and a parsed-content classification (URL / WiFi / vCard / geo / tel / sms /
  email / GS1 element strings).

## Install

```sh
npm install cam2qr
```

## Live camera scanning

```ts
import { QrScanner } from 'cam2qr';

const scanner = new QrScanner(videoElement, {
  camera: { facing: 'environment' },
  onDecode(result) {
    console.log(result.text, result.content, result.cornerPoints);
  },
  onError(error) {
    if (error.code === 'permission-denied') showPermissionHelp();
  },
});

await scanner.start();          // asks for permission, begins scanning
scanner.setTorch(true);         // resolves false when unsupported, no throw
await scanner.setCamera({ facing: 'user' });
scanner.update({ tryHarder: true });
scanner.stop();                 // releases the camera
scanner.destroy();              // full teardown (worker, listeners)
```

### Scanner options (all optional)

| Option | Default | Meaning |
| --- | --- | --- |
| `camera.facing` | `'environment'` | `'environment'` (rear) or `'user'` (front) |
| `camera.deviceId` | – | exact camera from `listCameras()` (overrides `facing`) |
| `camera.resolution` | 1280×720 | ideal capture resolution |
| `maxScansPerSecond` | `15` | decode attempts per second (battery/CPU dial) |
| `scanRegion` | full frame | sub-rectangle (or `video => region`) to decode; a big CPU saver |
| `useWorker` | `true` | decode in a Web Worker when available |
| `useNativeDetector` | `false` | use the browser's `BarcodeDetector` when present, falling back to our engine when missing or failing; native results carry placeholder codec metadata (`version: 0`, `mask: -1`, zero `ecc`, EC level `'M'`) |
| `pauseOnHidden` | `true` | pause while the tab is hidden |
| `tryInverted` | `true` | also try light-on-dark codes |
| `tryHarder` | `false` | extra passes: more finder triples + a 2× low-pass (blur recovery) |
| `maxDownscale` | `2` | downscale huge frames by up to this factor before decoding |
| `dedupeWindowMs` | `1500` | quiet period before the same payload fires again (`0` = off; tracked per payload) |
| `stopOnDecode` | `false` | stop the camera after the first result |
| `multiple` | `false` | decode every code in the frame; each symbol fires its own `decode` event |
| `structuredAppend` | `'reassemble'` | join multi-symbol sequences into one decode event (parity-checked); `'individual'` fires each symbol separately |
| `onDecode` / `onError` | – | callbacks; `scanner.on('decode' \| 'detect' \| 'error' \| 'start' \| 'stop', …)` also works |
| `onDetect` | – | fires every scanned frame with located symbol candidates (or `null`); corner points arrive before/regardless of a successful decode, for live outline overlays |

Also on the instance: `pause()` / `resume()`, `setZoom(level)`, `getCapabilities()`,
`listCameras()` (exported standalone).

### Live outline overlays

`onDetect` reports corner points in video pixel coordinates. A canvas sized to
`videoWidth`×`videoHeight` and CSS-stretched exactly like the video can draw them directly
(see `demo/`); for overlays positioned in CSS pixels, `videoToElementCoordinates(points,
video)` maps them, accounting for `object-fit` letterboxing/cropping.

```ts
const scanner = new QrScanner(video, {
  onDetect(detections) {
    clearOverlay();
    for (const d of detections ?? []) drawPolygon(d.cornerPoints); // tracks while you aim
  },
  onDecode(result) {
    flashPolygon(result.cornerPoints); // confirmed decode
  },
});
```

### Error codes

`start()` rejects with a `CameraError` whose `code` is one of `permission-denied`,
`camera-not-found`, `camera-in-use`, `insecure-context` (camera needs HTTPS or localhost),
`unsupported`, `stream-failed`.

The `error` event carries either typed flavor, so you can tell a camera fault from a decode
fault: a **`CameraError`** for camera/stream problems (the codes above), or a
**`DecodeError`** when the decode runner itself fails — a frame that failed to decode or the
Web Worker crashing (`code: 'runner-failed'`). Match on `error.name`:

```ts
scanner.on('error', (error) => {
  if (error.name === 'CameraError' && error.code === 'permission-denied') showPermissionHelp();
  // DecodeError (e.g. 'runner-failed') means decoding hiccuped, not the camera —
  // the scanner keeps running (a failed worker transparently falls back inline).
});
```

## One-shot decoding

```ts
import { decode } from 'cam2qr';

const result = decode(imageData, { tryHarder: true }); // QrResult | null
```

Takes any `{ data, width, height }` RGBA buffer (a canvas `ImageData`, a decoded PNG in
Node, …). Options: `tryInverted`, `tryHarder`, `maxDownscale`, `parseContent`. `decode()`
returns `null` when no decodable code is present and only throws on genuinely invalid
input.

### Multiple codes per frame

```ts
import { decodeAll } from 'cam2qr';

const results = decodeAll(imageData); // QrResult[]: every decodable symbol, deduplicated
```

`decodeAll` always runs the full pass plan (all scales, plus the inverted pass), so it can
find a dark-on-light and a light-on-dark code in the same frame. On the scanner, set
`multiple: true` instead.

### Locate without decoding

```ts
import { detect } from 'cam2qr';

const candidates = detect(imageData); // Detection[]: { cornerPoints, moduleSize }
```

Cheaper than a decode and useful for framing feedback; candidates are plausibility-ranked
and may include finder-like decoys that would not survive a decode.

### The result

```ts
interface QrResult {
  text: string;                    // decoded, charset-aware (ECI/UTF-8/Shift-JIS kanji)
  bytes: Uint8Array;               // raw payload bytes
  content?: ParsedContent;         // url | wifi | vcard | geo | tel | sms | email | gs1 | text
  cornerPoints: [Point, Point, Point, Point]; // symbol outline in image pixels
  moduleSize: number;              // measured pixels per module
  version: number;                 // 1–40
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
  mask: number;
  segments: Segment[];             // per-mode payload breakdown (incl. kanji)
  ecc: { blocks: number; codewordsCorrected: number }; // damage signal
  structuredAppend?: { index: number; total: number; parity: number };
  fnc1?: { position: 'first' } | { position: 'second'; applicationIndicator: string };
}
```

GS1 symbols (FNC1 in first position) get their element strings split into application
identifiers: `content` becomes `{ type: 'gs1', elements: [{ ai: '01', value: '0401…' }, …] }`,
with GS separators and alphanumeric `%` escapes handled per spec.

Structured-append sequences (one payload split across up to 16 symbols) are reassembled by
the scanner by default: parts are withheld and a single `decode` event fires with the joined
payload once every symbol has been seen and the parity byte checks out. Show all symbols at
once with `multiple: true`, or pan across them within 30 s. `decode()`/`decodeAll()` stay
pure and return the parts with their `structuredAppend` headers.

## React

```tsx
import { useQrScanner } from 'cam2qr/react';

function Scanner() {
  const { videoRef, result, error, isScanning, scanner } = useQrScanner({
    onDecode: (r) => console.log(r.text),
  });
  return <video ref={videoRef} />;
}
```

The hook starts the camera when the video mounts, releases it on unmount, and re-renders on
results/errors. Pass `enabled: false` to keep the camera off; use `scanner` for imperative
control (torch, camera switching, `update()`).

Options are captured when the scanner is created — changing `camera` on a later render does
**not** switch cameras. Switch imperatively instead:

```tsx
scanner?.setCamera({ facing: 'user' }); // or { deviceId } from listCameras()
```

Pass `paused` to suspend and resume decoding **without releasing the camera** — no
black-flash or permission re-prompt, unlike toggling `enabled`. It is reactive and correct
from the first render, so `paused: true` starts the scanner suspended (the stream still warms
up) and flips live as the prop changes:

```tsx
const { videoRef } = useQrScanner({ paused: !isSheetOpen });
```

## Vue

```vue
<script setup>
import { useQrScanner } from 'cam2qr/vue';

const { videoRef, result, error, isScanning, scanner } = useQrScanner({
  onDecode: (r) => console.log(r.text),
});
</script>

<template>
  <video ref="videoRef"></video>
  <p v-if="result">{{ result.text }}</p>
</template>
```

Same lifecycle as the React hook, with refs instead of state. `enabled` accepts a `Ref` to
toggle the camera reactively; `paused` (also `boolean | Ref<boolean>`) suspends and resumes
decoding while keeping the camera stream warm — no black-flash, unlike `enabled`. Everything
is torn down when the component's scope disposes.

## Svelte

```svelte
<script>
  import { createQrScanner } from 'cam2qr/svelte';

  const { video, result, isScanning } = createQrScanner({
    onDecode: (r) => console.log(r.text),
  });
</script>

<video use:video></video>
{#if $result}<p>{$result.text}</p>{/if}
```

Readable stores plus an action (built on `svelte/store` only, so Svelte 3, 4, and 5 all
work). The camera starts when the `<video>` mounts and is released when it unmounts, so
you can gate the element with `{#if}` to toggle scanning. To suspend decoding *without*
releasing the camera, pass `paused` — a boolean, or a store to toggle reactively:

```svelte
<script>
  import { writable } from 'svelte/store';
  const paused = writable(false);
  const { video, result } = createQrScanner({ paused });
</script>

<video use:video></video>
<button on:click={() => paused.update((p) => !p)}>Toggle</button>
```

## Bundlers & legacy resolvers (CRA, TS < 5)

The subpath entries (`cam2qr/react`, `cam2qr/vue`, `cam2qr/svelte`) work out of the box with
modern bundlers and TypeScript's `bundler`/`node16`/`nodenext` resolution via the package
`exports` map. For toolchains still on classic `moduleResolution: node` — TypeScript < 5,
Create React App / react-scripts, older Jest/Metro resolvers — the package also ships
directory stubs (`react/package.json`, …) that point those resolvers at the same build, so
`import { useQrScanner } from 'cam2qr/react'` resolves its types and its module without any
`declare module` shim or Jest `moduleNameMapper`. No configuration is needed; the root
`decode`/`QrScanner` entry never depended on this.

## Node and other runtimes

`decode()`, `decodeAll()`, and `detect()` are pure functions over RGBA bytes with no DOM
or Node API usage, so they run in browsers, workers, Node, and Hermes. The camera layer is
browser-only by nature. For React Native, [docs/react-native.md](./docs/react-native.md)
sketches the adapter approach over `react-native-vision-camera`.

## Benchmarks

[docs/benchmarks.md](./docs/benchmarks.md) is regenerated by `pnpm compare`, which feeds
the same seeded synthetic frames to cam2qr, `jsQR`, and `@zxing/library` (both are
devDependencies used as measurement baselines only). Snapshot from the current run:
cam2qr with `tryHarder` decodes 100% of every distortion sweep (jsQR drops to 60% on
noise and 48% on low contrast; zxing to 20% on noise and 0% on inverted codes), at
~0.6 ms per clean small frame: ~5× faster than jsQR, on par with zxing. The harness
asserts cam2qr's detection-rate floors, so quality regressions fail CI.

There is also a regression corpus in [test/fixtures/corpus](./test/fixtures/corpus/),
where every image must decode, enforced by the main test suite. "Fails to scan" reports
become corpus images; see its README.

## How it's tested

Every decoder stage has unit tests (GF(256), Reed-Solomon with injected errors, BCH
format/version, masks, bitstream). Round-trip tests generate symbols with an external
generator and decode them across all 40 versions × 4 EC levels × 8 masks. A pure-TS
software renderer produces distorted images (rotation, perspective, noise, blur, lighting
gradients, inversion) for detection tests. The scanner loop is integration-tested against
fake camera hardware, and Playwright feeds a generated video to Chromium's fake camera to
verify the shipped bundle end to end.

## Demo

`pnpm demo` builds the library and serves a scanner page (Vite, port 5183) that runs
against the built artifacts: camera picker, torch, pause, tryHarder toggle, decode
outline overlay, and parsed-content display.

## Contributing

Bug reports with a sample image are especially valuable, since every "fails to scan"
report can become a permanent regression test. See [CONTRIBUTING.md](./CONTRIBUTING.md)
for setup, commands, architecture, and conventions.

## License

[MIT](./LICENSE)
