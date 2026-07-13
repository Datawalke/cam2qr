import { type CameraError, type Detection, type QrResult, QrScanner, listCameras } from 'cam2qr';

const video = document.querySelector<HTMLVideoElement>('#video')!;
const overlay = document.querySelector<HTMLCanvasElement>('#overlay')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const cameraSelect = document.querySelector<HTMLSelectElement>('#camera-select')!;
const torchButton = document.querySelector<HTMLButtonElement>('#torch')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const tryHarderInput = document.querySelector<HTMLInputElement>('#try-harder')!;
const resultPanel = document.querySelector<HTMLDivElement>('#result')!;
const contentType = document.querySelector<HTMLSpanElement>('#content-type')!;
const meta = document.querySelector<HTMLSpanElement>('#meta')!;
const resultText = document.querySelector<HTMLPreElement>('#result-text')!;
const copyButton = document.querySelector<HTMLButtonElement>('#copy')!;

let torchOn = false;
let paused = false;
let clearOutlineTimer = 0;
let holdingDecodeOutline = false;

const scanner = new QrScanner(video, {
  onDecode: showResult,
  onDetect: drawDetections,
  onError: (error) => setStatus(`error — ${error.code}`),
});

function setStatus(text: string): void {
  status.textContent = text;
}

function overlayContext(): CanvasRenderingContext2D {
  if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
  if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight;
  const context = overlay.getContext('2d')!;
  context.clearRect(0, 0, overlay.width, overlay.height);
  return context;
}

function strokeCorners(
  context: CanvasRenderingContext2D,
  cornerPoints: readonly { x: number; y: number }[],
  lineWidth: number,
): void {
  context.lineWidth = lineWidth;
  context.beginPath();
  const [first, ...rest] = cornerPoints;
  context.moveTo(first!.x, first!.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  context.closePath();
  context.stroke();
}

/** Live tracking: faint outlines follow candidates even before they decode. */
function drawDetections(detections: Detection[] | null): void {
  if (holdingDecodeOutline) return;
  const context = overlayContext();
  if (!detections) return;
  context.strokeStyle = 'rgba(255, 196, 0, 0.9)';
  for (const detection of detections) {
    strokeCorners(context, detection.cornerPoints, Math.max(2, detection.moduleSize / 3));
  }
}

function drawOutline(result: QrResult): void {
  const context = overlayContext();
  context.strokeStyle = '#2ea043';
  strokeCorners(context, result.cornerPoints, Math.max(3, result.moduleSize / 2));

  holdingDecodeOutline = true;
  clearTimeout(clearOutlineTimer);
  clearOutlineTimer = window.setTimeout(() => {
    holdingDecodeOutline = false;
    context.clearRect(0, 0, overlay.width, overlay.height);
  }, 600);
}

function showResult(result: QrResult): void {
  drawOutline(result);
  resultPanel.hidden = false;
  contentType.textContent = result.content?.type ?? 'text';
  const corrected =
    result.ecc.codewordsCorrected > 0 ? ` · ${result.ecc.codewordsCorrected} corrected` : '';
  meta.textContent = `v${result.version} · EC ${result.errorCorrectionLevel}${corrected}`;
  resultText.textContent = describeContent(result);
  setStatus('scanning…');
  if (navigator.vibrate) navigator.vibrate(80);
}

function describeContent(result: QrResult): string {
  const content = result.content;
  if (!content) return result.text;
  switch (content.type) {
    case 'wifi':
      return `WiFi network: ${content.ssid}\nsecurity: ${content.security ?? 'unknown'}${content.password ? `\npassword: ${content.password}` : ''}`;
    case 'geo':
      return `Location: ${content.latitude}, ${content.longitude}`;
    case 'vcard':
      return `Contact: ${content.name ?? '?'}${content.org ? ` (${content.org})` : ''}${content.tel ? `\ntel: ${content.tel}` : ''}${content.email ? `\nemail: ${content.email}` : ''}`;
    default:
      return result.text;
  }
}

copyButton.addEventListener('click', () => {
  const original = copyButton.textContent;
  navigator.clipboard
    .writeText(resultText.textContent ?? '')
    .then(() => {
      copyButton.textContent = 'Copied!';
      setTimeout(() => {
        copyButton.textContent = original;
      }, 1200);
    })
    .catch(() => {});
});

pauseButton.addEventListener('click', () => {
  paused = !paused;
  if (paused) {
    scanner.pause();
    pauseButton.textContent = '▶ Resume';
    setStatus('paused');
  } else {
    scanner.resume();
    pauseButton.textContent = '⏸ Pause';
    setStatus('scanning…');
  }
});

tryHarderInput.addEventListener('change', () => {
  scanner.update({ tryHarder: tryHarderInput.checked });
});

torchButton.addEventListener('click', () => {
  void scanner.setTorch(!torchOn).then((applied) => {
    if (applied) {
      torchOn = !torchOn;
      torchButton.textContent = torchOn ? '💡 Torch off' : '💡 Torch';
    }
  });
});

cameraSelect.addEventListener('change', () => {
  void scanner
    .setCamera({ deviceId: cameraSelect.value })
    .then(refreshCapabilities)
    .catch((error: CameraError) => setStatus(`error — ${error.code}`));
});

function refreshCapabilities(): void {
  torchButton.hidden = !scanner.getCapabilities().torch;
}

async function refreshCameraList(): Promise<void> {
  const cameras = await listCameras();
  cameraSelect.innerHTML = '';
  for (const camera of cameras) {
    const option = document.createElement('option');
    option.value = camera.id;
    option.textContent = camera.label;
    cameraSelect.append(option);
  }
  cameraSelect.hidden = cameras.length < 2;
}

scanner
  .start()
  .then(() => {
    setStatus('scanning…');
    refreshCapabilities();
    return refreshCameraList();
  })
  .catch((error: CameraError) => {
    setStatus(
      error.code === 'permission-denied'
        ? 'camera permission denied — allow access and reload'
        : `camera error — ${error.code}`,
    );
  });
