import { parseContent, scanFrame } from './chunk-VQB7DEOH.js';

// src/camera/errors.ts
var CameraError = class _CameraError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.code = code;
    this.cause = cause;
    this.name = "CameraError";
  }
  /** Maps a getUserMedia rejection to a typed CameraError. */
  static from(error) {
    if (error instanceof _CameraError) return error;
    const name = error?.name ?? "";
    switch (name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
      case "SecurityError":
        return new _CameraError("permission-denied", "camera permission was denied", error);
      case "NotFoundError":
      case "DevicesNotFoundError":
      case "OverconstrainedError":
        return new _CameraError("camera-not-found", "no camera matches the constraints", error);
      case "NotReadableError":
      case "TrackStartError":
        return new _CameraError("camera-in-use", "camera is already in use or unreadable", error);
      default:
        return new _CameraError("stream-failed", "could not start the camera stream", error);
    }
  }
};

// src/camera/stream.ts
function buildConstraints(camera = {}) {
  const video = {
    width: { ideal: camera.resolution?.width ?? 1280 },
    height: { ideal: camera.resolution?.height ?? 720 }
  };
  if (camera.deviceId !== void 0) {
    video.deviceId = { exact: camera.deviceId };
  } else {
    video.facingMode = { ideal: camera.facing ?? "environment" };
  }
  return { video, audio: false };
}
function resolveMediaDevices(override) {
  if (override) return override;
  if (typeof navigator !== "undefined" && navigator.mediaDevices) return navigator.mediaDevices;
  return null;
}
async function startStream(camera = {}, mediaDevicesOverride) {
  const mediaDevices = resolveMediaDevices(mediaDevicesOverride);
  if (!mediaDevices?.getUserMedia) {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      throw new CameraError(
        "insecure-context",
        "camera access requires a secure context (HTTPS or localhost)"
      );
    }
    throw new CameraError("unsupported", "getUserMedia is not available in this environment");
  }
  try {
    return await mediaDevices.getUserMedia(buildConstraints(camera));
  } catch (error) {
    throw CameraError.from(error);
  }
}
function stopStream(stream) {
  for (const track of stream.getTracks()) track.stop();
}
async function listCameras(mediaDevicesOverride) {
  const mediaDevices = resolveMediaDevices(mediaDevicesOverride);
  if (!mediaDevices?.enumerateDevices) return [];
  const devices = await mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput").map((device, index) => ({
    id: device.deviceId,
    label: device.label || `Camera ${index + 1}`
  }));
}

// src/camera/capabilities.ts
function getTrackCapabilities(track) {
  const raw = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
  const zoom = raw.zoom;
  return {
    torch: raw.torch === true,
    zoom: zoom && typeof zoom.min === "number" && typeof zoom.max === "number" ? { min: zoom.min, max: zoom.max, step: zoom.step ?? 0.1 } : null
  };
}
async function applyTorch(track, on) {
  if (!getTrackCapabilities(track).torch) return false;
  await track.applyConstraints({ advanced: [{ torch: on }] });
  return true;
}
async function applyZoom(track, zoom) {
  const range = getTrackCapabilities(track).zoom;
  if (range === null) return false;
  const clamped = Math.min(range.max, Math.max(range.min, zoom));
  await track.applyConstraints({ advanced: [{ zoom: clamped }] });
  return true;
}

// src/camera/frame-grabber.ts
function createCanvasFrameSource(video) {
  let canvas = null;
  let context = null;
  function ensureContext(width, height) {
    if (!canvas) {
      canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
    }
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (!context) {
      context = canvas.getContext("2d", {
        willReadFrequently: true
      });
    }
    return context;
  }
  return {
    grab(region) {
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      if (!videoWidth || !videoHeight) return null;
      const crop = clampRegion(region, videoWidth, videoHeight);
      const ctx = ensureContext(crop.width, crop.height);
      if (!ctx) return null;
      ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return ctx.getImageData(0, 0, crop.width, crop.height);
    },
    destroy() {
      canvas = null;
      context = null;
    }
  };
}
function clampRegion(region, width, height) {
  if (!region) return { x: 0, y: 0, width, height };
  const x = Math.max(0, Math.min(Math.floor(region.x), width - 1));
  const y = Math.max(0, Math.min(Math.floor(region.y), height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.floor(region.width), width - x)),
    height: Math.max(1, Math.min(Math.floor(region.height), height - y))
  };
}

// src/scanner/dedupe.ts
var Deduper = class {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.seen = /* @__PURE__ */ new Map();
  }
  setWindow(windowMs) {
    this.windowMs = windowMs;
  }
  shouldEmit(text, now) {
    if (this.windowMs <= 0) return true;
    const lastSeenAt = this.seen.get(text);
    this.seen.delete(text);
    this.seen.set(text, now);
    this.prune(now);
    return lastSeenAt === void 0 || now - lastSeenAt >= this.windowMs;
  }
  prune(now) {
    for (const [text, seenAt] of this.seen) {
      if (now - seenAt < this.windowMs) break;
      this.seen.delete(text);
    }
  }
  reset() {
    this.seen.clear();
  }
};

// src/scanner/native.ts
function tryCreateNativeRunner(fallback) {
  const Ctor = globalThis.BarcodeDetector;
  if (typeof Ctor !== "function") return null;
  let detector;
  try {
    detector = new Ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
  let fallbackRunner = null;
  return {
    async scan(image, options) {
      if (fallbackRunner) return fallbackRunner.scan(image, options);
      try {
        const detected = await detector.detect(toImageData(image));
        return toFrameScan(detected, options);
      } catch {
        fallbackRunner = fallback();
        return fallbackRunner.scan(image, options);
      }
    },
    destroy() {
      fallbackRunner?.destroy();
    }
  };
}
function toImageData(image) {
  const data = image.data instanceof Uint8ClampedArray ? image.data : new Uint8ClampedArray(image.data);
  return new ImageData(data, image.width, image.height);
}
function toFrameScan(detected, options) {
  const detections = [];
  const results = [];
  const limit = options.multiple === true ? detected.length : Math.min(detected.length, 1);
  for (const barcode of detected) {
    const cornerPoints = normalizeCorners(barcode.cornerPoints);
    if (!cornerPoints) continue;
    const moduleSize = estimateModuleSize(cornerPoints);
    detections.push({ cornerPoints, moduleSize });
    if (results.length >= limit) continue;
    const bytes = new TextEncoder().encode(barcode.rawValue);
    const result = {
      text: barcode.rawValue,
      bytes,
      cornerPoints,
      moduleSize,
      version: 0,
      errorCorrectionLevel: "M",
      mask: -1,
      segments: [{ mode: "byte", bytes, text: barcode.rawValue }],
      ecc: { blocks: 0, codewordsCorrected: 0 }
    };
    if (options.parseContent !== false) result.content = parseContent(result.text);
    results.push(result);
  }
  return { results, detections };
}
function normalizeCorners(points) {
  if (points.length !== 4) return null;
  return [
    { x: points[0].x, y: points[0].y },
    { x: points[1].x, y: points[1].y },
    { x: points[2].x, y: points[2].y },
    { x: points[3].x, y: points[3].y }
  ];
}
function estimateModuleSize(corners) {
  const top = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  const left = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
  return (top + left) / 2 / 25;
}

// src/scanner/runner.ts
function createDecodeRunner(useWorker, useNativeDetector = false) {
  const engine = () => createEngineRunner(useWorker);
  if (useNativeDetector) {
    const native = tryCreateNativeRunner(engine);
    if (native) return native;
  }
  return engine();
}
function createEngineRunner(useWorker) {
  if (useWorker) {
    const worker = tryCreateWorker();
    if (worker) return createWorkerRunner(worker);
  }
  return {
    scan: (image, options) => Promise.resolve(scanFrame(image, options)),
    destroy() {
    }
  };
}
function tryCreateWorker() {
  try {
    if (typeof Worker === "undefined") return null;
    return new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}
function createWorkerRunner(worker) {
  let nextId = 0;
  const pending = /* @__PURE__ */ new Map();
  worker.onmessage = (event) => {
    const { id, results, detections, error } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error !== void 0) entry.reject(new Error(error));
    else entry.resolve({ results: results ?? [], detections: detections ?? [] });
  };
  worker.onerror = () => {
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) entry.reject(new Error("decode worker crashed"));
  };
  return {
    scan(image, options) {
      const id = nextId++;
      const buffer = new Uint8ClampedArray(image.data).buffer;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, buffer, width: image.width, height: image.height, options }, [
          buffer
        ]);
      });
    },
    destroy() {
      worker.terminate();
      pending.clear();
    }
  };
}

// src/scanner/structured-append.ts
var DEFAULT_PART_TTL_MS = 3e4;
var StructuredAppendAssembler = class {
  constructor(ttlMs = DEFAULT_PART_TTL_MS) {
    this.ttlMs = ttlMs;
    this.sequences = /* @__PURE__ */ new Map();
  }
  /**
   * Records one symbol carrying a structured-append header. Returns the
   * joined result when its sequence is complete and parity-valid, else null.
   */
  add(result, now) {
    const header = result.structuredAppend;
    if (!header || header.total < 2 || header.index >= header.total) return null;
    this.expire(now);
    const key = `${header.total}:${header.parity}`;
    let sequence = this.sequences.get(key);
    if (!sequence) {
      sequence = { parts: /* @__PURE__ */ new Map(), lastSeenAt: now };
      this.sequences.set(key, sequence);
    }
    sequence.parts.set(header.index, result);
    sequence.lastSeenAt = now;
    return joinParts(sequence.parts, header);
  }
  reset() {
    this.sequences.clear();
  }
  expire(now) {
    for (const [key, sequence] of this.sequences) {
      if (now - sequence.lastSeenAt > this.ttlMs) this.sequences.delete(key);
    }
  }
};
function joinParts(parts, header) {
  const ordered = [];
  for (let i = 0; i < header.total; i++) {
    const part = parts.get(i);
    if (!part) return null;
    ordered.push(part);
  }
  let totalBytes = 0;
  for (const part of ordered) totalBytes += part.bytes.length;
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  let parity = 0;
  for (const part of ordered) {
    bytes.set(part.bytes, offset);
    offset += part.bytes.length;
    for (const byte of part.bytes) parity ^= byte;
  }
  if (parity !== header.parity) return null;
  const text = ordered.map((part) => part.text).join("");
  const last = ordered[ordered.length - 1];
  return {
    ...last,
    text,
    bytes,
    segments: ordered.flatMap((part) => part.segments),
    ecc: {
      blocks: ordered.reduce((sum, part) => sum + part.ecc.blocks, 0),
      codewordsCorrected: ordered.reduce((sum, part) => sum + part.ecc.codewordsCorrected, 0)
    },
    content: parseContent(text, { gs1: last.fnc1?.position === "first" })
  };
}

// src/scanner/scanner.ts
var QrScanner = class {
  constructor(video, options = {}, internals = {}) {
    this.assembler = new StructuredAppendAssembler();
    this.listeners = /* @__PURE__ */ new Map();
    this.state = "idle";
    this.stream = null;
    this.frameSource = null;
    this.runner = null;
    this.cancelTick = null;
    this.lastDecodeAt = Number.NEGATIVE_INFINITY;
    this.decoding = false;
    this.hiddenPause = false;
    this.onVisibilityChange = () => {
      if (!this.options.pauseOnHidden || typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        if (this.state === "scanning") {
          this.hiddenPause = true;
          this.pause();
        }
      } else if (this.hiddenPause) {
        this.hiddenPause = false;
        this.resume();
      }
    };
    this.video = video;
    this.options = {
      camera: options.camera ?? {},
      maxScansPerSecond: options.maxScansPerSecond ?? 15,
      scanRegion: options.scanRegion,
      useWorker: options.useWorker ?? true,
      useNativeDetector: options.useNativeDetector ?? false,
      pauseOnHidden: options.pauseOnHidden ?? true,
      tryInverted: options.tryInverted ?? true,
      tryHarder: options.tryHarder ?? false,
      maxDownscale: options.maxDownscale ?? 2,
      dedupeWindowMs: options.dedupeWindowMs ?? 1500,
      stopOnDecode: options.stopOnDecode ?? false,
      multiple: options.multiple ?? false,
      structuredAppend: options.structuredAppend ?? "reassemble"
    };
    this.internals = {
      mediaDevices: internals.mediaDevices ?? void 0,
      createFrameSource: internals.createFrameSource ?? createCanvasFrameSource,
      createRunner: internals.createRunner ?? createDecodeRunner,
      now: internals.now ?? (() => Date.now()),
      schedule: internals.schedule ?? defaultSchedule
    };
    this.deduper = new Deduper(this.options.dedupeWindowMs);
    if (options.onDecode) this.on("decode", options.onDecode);
    if (options.onDetect) this.on("detect", options.onDetect);
    if (options.onError) this.on("error", options.onError);
  }
  /** Requests the camera, attaches it to the video, and starts scanning. */
  async start() {
    if (this.state === "destroyed") throw new Error("scanner was destroyed");
    if (this.state === "scanning" || this.state === "starting") return;
    if (this.state === "paused" && this.stream) {
      this.resume();
      return;
    }
    this.state = "starting";
    try {
      this.stream = await startStream(this.options.camera, this.internals.mediaDevices);
      await this.attachStream();
    } catch (error) {
      this.state = "idle";
      this.releaseStream();
      throw CameraError.from(error);
    }
    this.frameSource ?? (this.frameSource = this.internals.createFrameSource(this.video));
    this.runner ?? (this.runner = this.internals.createRunner(
      this.options.useWorker,
      this.options.useNativeDetector
    ));
    if (this.options.pauseOnHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.state = "scanning";
    this.deduper.reset();
    this.assembler.reset();
    this.emit("start", void 0);
    this.scheduleNext();
  }
  /** Stops scanning and releases the camera. */
  stop() {
    if (this.state === "idle" || this.state === "destroyed") return;
    this.cancelLoop();
    this.releaseStream();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.state = "idle";
    this.emit("stop", void 0);
  }
  /** Suspends decoding but keeps the camera stream alive. */
  pause() {
    if (this.state !== "scanning") return;
    this.cancelLoop();
    this.state = "paused";
  }
  /** Resumes decoding after pause(). */
  resume() {
    if (this.state !== "paused") return;
    this.state = "scanning";
    this.scheduleNext();
  }
  /** Full teardown; the instance cannot be reused afterwards. */
  destroy() {
    this.stop();
    this.runner?.destroy();
    this.runner = null;
    this.frameSource?.destroy();
    this.frameSource = null;
    this.listeners.clear();
    this.state = "destroyed";
  }
  /** Switches cameras (facing mode or explicit device) without stopping. */
  async setCamera(camera) {
    if (this.state === "destroyed") throw new Error("scanner was destroyed");
    this.options.camera = camera;
    if (!this.stream) return;
    const wasScanning = this.state === "scanning";
    this.cancelLoop();
    this.releaseStream();
    this.stream = await startStream(camera, this.internals.mediaDevices);
    await this.attachStream();
    if (wasScanning) {
      this.state = "scanning";
      this.scheduleNext();
    }
  }
  /** True if the torch was toggled; false when unsupported. */
  async setTorch(on) {
    const track = this.videoTrack();
    return track ? applyTorch(track, on) : false;
  }
  /** True if zoom was applied (clamped to range); false when unsupported. */
  async setZoom(zoom) {
    const track = this.videoTrack();
    return track ? applyZoom(track, zoom) : false;
  }
  getCapabilities() {
    const track = this.videoTrack();
    return track ? getTrackCapabilities(track) : { torch: false, zoom: null };
  }
  /** Adjusts runtime options without restarting the camera. */
  update(options) {
    if (options.maxScansPerSecond !== void 0) {
      this.options.maxScansPerSecond = options.maxScansPerSecond;
    }
    if ("scanRegion" in options) this.options.scanRegion = options.scanRegion;
    if (options.tryInverted !== void 0) this.options.tryInverted = options.tryInverted;
    if (options.tryHarder !== void 0) this.options.tryHarder = options.tryHarder;
    if (options.maxDownscale !== void 0) this.options.maxDownscale = options.maxDownscale;
    if (options.dedupeWindowMs !== void 0) {
      this.options.dedupeWindowMs = options.dedupeWindowMs;
      this.deduper.setWindow(options.dedupeWindowMs);
    }
    if (options.stopOnDecode !== void 0) this.options.stopOnDecode = options.stopOnDecode;
    if (options.multiple !== void 0) this.options.multiple = options.multiple;
    if (options.structuredAppend !== void 0) {
      this.options.structuredAppend = options.structuredAppend;
    }
  }
  on(event, listener) {
    let set = this.listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }
  off(event, listener) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      listener(payload);
    }
  }
  async attachStream() {
    this.video.muted = true;
    if (typeof this.video.setAttribute === "function") {
      this.video.setAttribute("playsinline", "");
    }
    this.video.srcObject = this.stream;
    await this.video.play();
  }
  releaseStream() {
    if (this.stream) {
      stopStream(this.stream);
      this.stream = null;
    }
    this.video.srcObject = null;
  }
  videoTrack() {
    return this.stream?.getVideoTracks()[0] ?? null;
  }
  cancelLoop() {
    this.cancelTick?.();
    this.cancelTick = null;
  }
  scheduleNext() {
    if (this.state !== "scanning") return;
    this.cancelTick = this.internals.schedule(this.video, () => {
      void this.tick();
    });
  }
  async tick() {
    if (this.state !== "scanning") return;
    const now = this.internals.now();
    const interval = 1e3 / this.options.maxScansPerSecond;
    if (this.decoding || now - this.lastDecodeAt < interval) {
      this.scheduleNext();
      return;
    }
    const region = this.resolveRegion();
    const frame = this.frameSource?.grab(region) ?? null;
    if (!frame) {
      this.scheduleNext();
      return;
    }
    this.lastDecodeAt = now;
    this.decoding = true;
    try {
      const scan = await this.runner.scan(frame, {
        tryInverted: this.options.tryInverted,
        tryHarder: this.options.tryHarder,
        maxDownscale: this.options.maxDownscale,
        multiple: this.options.multiple
      });
      if (this.state === "scanning") {
        if (region) {
          for (const item of [...scan.results, ...scan.detections]) {
            for (const point of item.cornerPoints) {
              point.x += region.x;
              point.y += region.y;
            }
          }
        }
        this.emit("detect", scan.detections.length > 0 ? scan.detections : null);
        for (const result of scan.results) {
          const emitted = result.structuredAppend && this.options.structuredAppend === "reassemble" ? this.assembler.add(result, this.internals.now()) : result;
          if (!emitted) continue;
          if (!this.deduper.shouldEmit(emitted.text, this.internals.now())) continue;
          this.emit("decode", emitted);
          if (this.options.stopOnDecode) {
            this.decoding = false;
            this.stop();
            return;
          }
        }
      }
    } catch (error) {
      this.emit("error", CameraError.from(error));
    } finally {
      this.decoding = false;
    }
    this.scheduleNext();
  }
  resolveRegion() {
    const { scanRegion } = this.options;
    if (!scanRegion) return void 0;
    return typeof scanRegion === "function" ? scanRegion(this.video) : scanRegion;
  }
};
function defaultSchedule(video, callback) {
  const withRvfc = video;
  if (typeof withRvfc.requestVideoFrameCallback === "function") {
    const id2 = withRvfc.requestVideoFrameCallback(callback);
    return () => withRvfc.cancelVideoFrameCallback?.(id2);
  }
  if (typeof requestAnimationFrame === "function") {
    const id2 = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id2);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

export { CameraError, QrScanner, listCameras };
//# sourceMappingURL=chunk-MYLBZOJV.js.map
//# sourceMappingURL=chunk-MYLBZOJV.js.map