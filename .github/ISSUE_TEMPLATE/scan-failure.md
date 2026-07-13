---
name: Scan failure
about: A QR code that cam2qr fails to decode
title: ''
labels: scan-failure
assignees: ''
---

**The image** (required — this is the difference between a guess and a permanent fix)

Attach the image or a frame grab of the code that fails. Once fixed, it becomes a
regression test in the image corpus so it can never break again.

**Expected payload**

What the code should decode to, if you know it.

**How you ran it**

- [ ] `QrScanner` (live camera)
- [ ] `decode()` / `decodeAll()` on an image
- Options used (e.g. `tryHarder`, `tryInverted`):

**Environment**

Browser + version, OS, device:
