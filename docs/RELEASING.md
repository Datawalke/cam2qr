# Releasing cam2qr

Releases are tag-driven: pushing a `v*` tag runs `.github/workflows/release.yml`, which
runs the full test gate, publishes to npm with a provenance attestation, and creates a
GitHub Release with generated notes.

## One-time setup (before the first release)

1. On npmjs.com, create a **granular access token** with read/write packages permission
   that is allowed to create new packages (the first publish creates `cam2qr`).
2. In the GitHub repo: Settings → Secrets and variables → Actions → add the token as
   `NPM_TOKEN`.
3. After the first publish exists on npm, optionally switch the package to
   **trusted publishing** (npm package Settings → Trusted Publisher → GitHub Actions,
   repo `Datawalke/cam2qr`, workflow `release.yml`), then delete `NPM_TOKEN` and the
   `NODE_AUTH_TOKEN` line from the workflow.

## Cutting a release

1. Make sure `main` is green in CI.
2. In one commit:
   - remove `"private": true` from `package.json` (first release only),
   - set the new `"version"`.
3. Tag and push:

   ```sh
   git commit -am "Release v1.0.0"
   git tag v1.0.0
   git push && git push --tags
   ```

4. Watch the Release workflow. It refuses to publish if the tag does not match
   `package.json`'s version or if the package is still marked private.
5. Check the result: `npm view cam2qr` and the GitHub Releases page.

Local publishing also works (`npm publish` after `npm login`, with `prepublishOnly`
running the full gate first), but provenance attestation only happens from CI, so prefer
the workflow.
