# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

**cam2qr** — a zero-runtime-dependency TypeScript library for QR code scanning in the
browser. The full detect + decode pipeline is implemented independently from the
ISO/IEC 18004 spec in this repo (`Datawalke/cam2qr`, npm package `cam2qr`).

Read [CONTRIBUTING.md](./CONTRIBUTING.md) first — it covers setup, all commands, the
architecture map, conventions, and the testing approach, and it applies in full to agent
sessions. User-facing API docs live in [README.md](./README.md).

Non-negotiables, restated for emphasis:

- **Zero runtime dependencies.** `dependencies` stays empty; `react`/`vue`/`svelte` are
  optional peers only.
- **Never port or paraphrase code from other QR implementations** (zxing, jsQR, …). The
  pipeline is derived from the spec and textbook math; keep it that way.
- **Bundle-size budgets are enforced** (`pnpm size`); keep code tree-shakeable.
- **Preserve the error contract**: typed `DecodeError`/`CameraError`; `decode()` returns
  `null` for "no decodable code" and only throws on invalid input.
- **ESM imports use explicit `.js` extensions**; formatting is Biome (`pnpm lint:fix`).
- The package is live on npm. Releases are cut by bumping `package.json` and pushing a
  matching `v*` tag; the Release workflow publishes and creates the GitHub release. Keep
  `CHANGELOG.md` current.
- Run `pnpm ci` (typecheck + lint + test + build + size) before considering a change done.
- Do not create or modify files under `.github/workflows/` — automated sessions cannot
  push workflow changes.
