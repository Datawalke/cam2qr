# Changelog

## 1.1.1 — 2026-07-17

### Fixed

- **Camera stream leak when teardown raced startup.** `getUserMedia` is async; a
  `destroy()` (or `stop()`) issued while `start()` or `setCamera()` was still awaiting the
  camera left the freshly acquired stream running with no owner — the camera LED stayed
  on — and the late-resolving `start()` resurrected the destroyed scanner (recreating its
  decode pipeline and `visibilitychange` listener with no remaining teardown path). Stream
  acquisitions now carry a generation token that `stop()`, `destroy()`, and any newer
  acquisition invalidate: a superseded acquisition stops the stream it received and bails.
  This fired on every scanner mount under React StrictMode's dev double-mount, and in
  production whenever a user left the scanner screen shortly after opening it.
- A `getUserMedia` failure during `setCamera()` no longer strands the scanner in a phantom
  `scanning` state with no stream and no decode loop. It now tears down cleanly (emitting
  `stop`) and rejects with the typed `CameraError`; a later `start()` recovers.
- A `pause()` requested during the async startup window no longer lingers after `stop()`;
  the next `start()` comes up scanning as expected.

## 1.1.0 — 2026-07-16

### Changed

- **The scanner's `error` event — and the hook/composable/action `error` state — now emits
  `ScannerError = CameraError | DecodeError` instead of `CameraError` only.** Decode-runner
  faults (a frame failing to decode, the Web Worker crashing) previously surfaced as
  `CameraError` with code `stream-failed`; they are now `DecodeError`, so "camera died" and
  "a frame failed to decode" are distinguishable. **Breaking (minor):** consumers matching
  exhaustively on the camera `error.code` values must account for decode codes too — match
  on `error.name` or `instanceof` to tell the two flavors apart.

### Added

- `paused` option on the React hook, Vue composable, and Svelte action: suspend and resume
  decoding without releasing the camera — no black-flash or permission churn, unlike
  toggling `enabled`. Reactive and correct from the first render.

### Fixed

- `cam2qr/react`, `cam2qr/vue`, and `cam2qr/svelte` now resolve (module and types) under
  classic Node resolution — CRA 5 / webpack without `exports` support, Jest, TS < 5 —
  via directory `package.json` stubs; modern resolvers keep using the `exports` map.
- Importing the library no longer throws `ReferenceError: TextEncoder is not defined`
  under jsdom/Jest: the module-level `TextEncoder` is created lazily.
- A decode Worker that constructed but failed to load (404, CSP, offline) no longer
  rejects every scan forever; it falls back to inline decoding, retrying the in-flight
  scan — matching the native-detector fallback behavior.
- `pause()` no longer silently no-ops when called during the async camera startup window.

## 1.0.0 — 2026-07-12

Initial release.
