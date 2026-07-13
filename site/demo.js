/* cam2qr site — live demo. Imports the same-origin copy of the shipped ESM bundle
   (see scripts/sync-site-lib.mjs) so the module worker loads without a bundler. */

import { QrScanner, listCameras } from './lib/cam2qr/index.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const startPanel = document.getElementById('start-panel');
const startButton = document.getElementById('start');
const status = document.getElementById('status');
const controls = document.getElementById('controls');
const cameraSelect = document.getElementById('camera-select');
const torchButton = document.getElementById('torch');
const pauseButton = document.getElementById('pause');
const stopButton = document.getElementById('stop');
const tryHarderInput = document.getElementById('try-harder');
const resultPanel = document.getElementById('result');
const contentType = document.getElementById('content-type');
const meta = document.getElementById('meta');
const resultText = document.getElementById('result-text');
const copyButton = document.getElementById('copy');

let torchOn = false;
let paused = false;
let clearOutlineTimer = 0;
let holdingDecodeOutline = false;

const scanner = new QrScanner(video, {
  onDecode: showResult,
  onDetect: drawDetections,
  onError: (error) => setStatus(`error — ${error.code}`),
});

function setStatus(text) {
  status.hidden = !text;
  status.textContent = text;
}

function overlayContext() {
  if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
  if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight;
  const context = overlay.getContext('2d');
  context.clearRect(0, 0, overlay.width, overlay.height);
  return context;
}

function strokeCorners(context, cornerPoints, lineWidth) {
  context.lineWidth = lineWidth;
  context.beginPath();
  const [first, ...rest] = cornerPoints;
  context.moveTo(first.x, first.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  context.closePath();
  context.stroke();
}

/* Live tracking: faint outlines follow candidates even before they decode. */
function drawDetections(detections) {
  if (holdingDecodeOutline) return;
  const context = overlayContext();
  if (!detections) return;
  context.strokeStyle = 'rgba(255, 196, 0, 0.9)';
  for (const detection of detections) {
    strokeCorners(context, detection.cornerPoints, Math.max(2, detection.moduleSize / 3));
  }
}

function drawOutline(result) {
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

function showResult(result) {
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

function describeContent(result) {
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
  scanner.setTorch(!torchOn).then((applied) => {
    if (applied) {
      torchOn = !torchOn;
      torchButton.textContent = torchOn ? '💡 Torch off' : '💡 Torch';
    }
  });
});

cameraSelect.addEventListener('change', () => {
  scanner
    .setCamera({ deviceId: cameraSelect.value })
    .then(refreshCapabilities)
    .catch((error) => setStatus(`error — ${error.code}`));
});

function refreshCapabilities() {
  torchButton.hidden = !scanner.getCapabilities().torch;
}

async function refreshCameraList() {
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

startButton.addEventListener('click', () => {
  startButton.disabled = true;
  setStatus('starting camera…');
  scanner
    .start()
    .then(() => {
      startPanel.hidden = true;
      controls.hidden = false;
      setStatus('scanning…');
      refreshCapabilities();
      return refreshCameraList();
    })
    .catch((error) => {
      startButton.disabled = false;
      setStatus(
        error.code === 'permission-denied'
          ? 'camera permission denied — allow access and try again'
          : error.code === 'insecure-context'
            ? 'camera needs HTTPS (or localhost)'
            : `camera error — ${error.code}`,
      );
    });
});

stopButton.addEventListener('click', () => {
  scanner.stop();
  paused = false;
  pauseButton.textContent = '⏸ Pause';
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
  controls.hidden = true;
  startPanel.hidden = false;
  startButton.disabled = false;
  setStatus('');
});
