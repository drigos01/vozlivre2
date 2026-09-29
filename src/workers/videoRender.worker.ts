// src/workers/videoRender.worker.ts
// Dedicated High-Performance Background Video Rendering Web Worker
// Completely offloads frame generation, canvas manipulation, audio FFT, and WebCodecs MP4 encoding
// Decoupled from the DOM and UI thread for maximum speed (100-200+ FPS) and zero UI freezing.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  SerializedEncodedChunk,
  serializeEncodedChunk,
  replayCheckpointToMuxer,
} from '../utils/safeguard';

export interface WorkerCropSettings {
  enabled: boolean;
  zoom: number;
  panX: number;
  panY: number;
}

export interface StartRenderPayload {
  width: number;
  height: number;
  fps: number;
  totalDuration: number;
  startTime: number;
  endTime: number;
  bgMode: 'user' | 'preset';
  userMediaType: 'image' | 'video' | null;
  selectedPreset: 'waves' | 'cyber' | 'particles' | 'minimal';
  motionEffect: string;
  motionIntensityValue: number;
  cropSettings: WorkerCropSettings;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  fitMode?: 'blur_capcut' | 'crop' | 'fit';
  blurIntensity?: number;
  blurDarken?: number;
  dropShadow?: boolean;
  showWaveform: boolean;
  waveformStyle: 'bars' | 'line' | 'none';
  waveformColor: 'white' | 'emerald' | 'cyan' | 'violet' | 'amber';
  showTitle: boolean;
  videoTitleText: string;
  titlePosition: 'top' | 'center' | 'bottom';
  showSubtitles?: boolean;
  subtitleStyle?: 'hormozi' | 'modern' | 'classic';
  subtitleHighlightColor?: string;
  subtitleText?: string;
  fontFamily?: 'sans' | 'impact' | 'serif' | 'mono';
  colorFilter?: 'none' | 'cinematic' | 'bw' | 'vintage' | 'vibrant';
  showWatermark?: boolean;
  audioSampleRate: number;
  audioChannel0: Float32Array;
  audioChannel1: Float32Array;
  imageBitmap?: ImageBitmap;
  videoFrameBitmaps?: ImageBitmap[];
  mediaWidth?: number;
  mediaHeight?: number;
  removeWatermark?: boolean;
  resumeCheckpoint?: {
    audioChunks?: SerializedEncodedChunk[];
    videoChunks?: SerializedEncodedChunk[];
    lastCompletedFrame?: number;
  };
}

// Helper: Unthrottled yielding in background worker thread (avoids Chrome 1000ms timer clamping)
function yieldInWorker(): Promise<void> {
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        ch.port2.close();
        resolve();
      };
      ch.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => queueMicrotask(resolve));
}

// Global cancellation flag for worker instance
let isCancelled = false;

// Helper: Precise mathematical crop calculation for canvas
function computeCropBox(
  sourceW: number,
  sourceH: number,
  targetRatio: number,
  zoom: number = 1.0,
  panX: number = 0,
  panY: number = 0
) {
  const safeW = sourceW > 0 ? sourceW : 1280;
  const safeH = sourceH > 0 ? sourceH : 720;
  const safeRatio = targetRatio > 0 ? targetRatio : 16 / 9;

  const sourceRatio = safeW / safeH;
  let baseCropW: number;
  let baseCropH: number;

  if (sourceRatio > safeRatio) {
    baseCropH = safeH;
    baseCropW = safeH * safeRatio;
  } else {
    baseCropW = safeW;
    baseCropH = safeW / safeRatio;
  }

  const effectiveZoom = Math.max(1.0, zoom);
  const cropW = baseCropW / effectiveZoom;
  const cropH = baseCropH / effectiveZoom;

  const maxShiftX = (safeW - cropW) / 2;
  const maxShiftY = (safeH - cropH) / 2;

  const offsetX = (panX / 50) * maxShiftX;
  const offsetY = (panY / 50) * maxShiftY;

  const sX = Math.max(0, Math.min(safeW - cropW, (safeW - cropW) / 2 + offsetX));
  const sY = Math.max(0, Math.min(safeH - cropH, (safeH - cropH) / 2 + offsetY));

  return { sX, sY, cropW, cropH };
}

function drawCroppedMedia(
  ctx: OffscreenCanvasRenderingContext2D,
  media: ImageBitmap,
  sourceW: number,
  sourceH: number,
  destW: number,
  destH: number,
  crop: WorkerCropSettings
) {
  if (sourceW <= 0 || sourceH <= 0 || destW <= 0 || destH <= 0) return;

  const targetRatio = destW / destH;
  const { sX, sY, cropW, cropH } = computeCropBox(
    sourceW,
    sourceH,
    targetRatio,
    crop?.enabled ? crop.zoom : 1.0,
    crop?.enabled ? crop.panX : 0,
    crop?.enabled ? crop.panY : 0
  );

  const safeSx = Math.max(0, Math.min(sourceW - 1, sX));
  const safeSy = Math.max(0, Math.min(sourceH - 1, sY));
  const safeCropW = Math.max(1, Math.min(cropW, sourceW - safeSx));
  const safeCropH = Math.max(1, Math.min(cropH, sourceH - safeSy));

  ctx.drawImage(media, safeSx, safeSy, safeCropW, safeCropH, 0, 0, destW, destH);
}

// Cached blurred background layer so static images don't re-run blur(25px) on every single frame
let cachedBlurBgCanvas: OffscreenCanvas | null = null;
let cachedBlurBgKey = '';

// CapCut / Reels Style Blur Background Drawer for 9:16 vertical videos
function drawMediaWithCapCutBlur(
  ctx: OffscreenCanvasRenderingContext2D,
  media: ImageBitmap,
  sourceW: number,
  sourceH: number,
  destW: number,
  destH: number,
  blurIntensity: number = 25,
  blurDarken: number = 0.3,
  dropShadow: boolean = true
) {
  if (sourceW <= 0 || sourceH <= 0 || destW <= 0 || destH <= 0) return;

  const blurKey = `${sourceW}x${sourceH}->${destW}x${destH}:${blurIntensity}:${blurDarken}:${dropShadow}`;
  if (!cachedBlurBgCanvas || cachedBlurBgKey !== blurKey) {
    cachedBlurBgCanvas = new OffscreenCanvas(destW, destH);
    cachedBlurBgKey = blurKey;
    const bCtx = cachedBlurBgCanvas.getContext('2d');
    if (bCtx) {
      // 1. Draw blurred cover background layer once into cache
      bCtx.save();
      const coverScale = Math.max(destW / sourceW, destH / sourceH) * 1.12;
      const bgW = sourceW * coverScale;
      const bgH = sourceH * coverScale;
      const bgX = (destW - bgW) / 2;
      const bgY = (destH - bgH) / 2;

      try {
        bCtx.filter = `blur(${Math.max(8, blurIntensity)}px) brightness(0.75)`;
      } catch {}
      bCtx.drawImage(media, bgX, bgY, bgW, bgH);
      bCtx.restore();

      // Dark overlay over blurred background so central video has high contrast
      if (blurDarken > 0) {
        bCtx.fillStyle = `rgba(0, 0, 0, ${blurDarken})`;
        bCtx.fillRect(0, 0, destW, destH);
      }

      // 2. Draw crisp center contain layer (preserves exact 16:9 aspect ratio, zero side cuts)
      const containScale = Math.min(destW / sourceW, destH / sourceH);
      const fgW = Math.round(sourceW * containScale);
      const fgH = Math.round(sourceH * containScale);
      const fgX = Math.round((destW - fgW) / 2);
      const fgY = Math.round((destH - fgH) / 2);

      bCtx.save();
      if (dropShadow) {
        bCtx.shadowColor = 'rgba(0, 0, 0, 0.75)';
        bCtx.shadowBlur = 24;
        bCtx.shadowOffsetY = 6;
      }
      bCtx.drawImage(media, fgX, fgY, fgW, fgH);
      bCtx.restore();
    }
  }

  ctx.drawImage(cachedBlurBgCanvas, 0, 0, destW, destH);
}

// Procedural Background Drawings
function drawProceduralBackground(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  preset: string
) {
  const t = time * 0.0015;

  if (preset === 'cyber') {
    // Cyber Neon Grid
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, w, h);

    const horizon = h * 0.65;
    const grad = ctx.createLinearGradient(0, 0, 0, horizon);
    grad.addColorStop(0, '#090a18');
    grad.addColorStop(1, '#180e29');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, horizon);

    ctx.save();
    ctx.strokeStyle = 'rgba(236, 72, 153, 0.4)';
    ctx.lineWidth = 1.5;
    for (let i = -w * 0.5; i <= w * 1.5; i += 70) {
      ctx.beginPath();
      ctx.moveTo(w / 2, horizon);
      ctx.lineTo(i + Math.sin(t * 0.5) * 40, h);
      ctx.stroke();
    }
    const offset = (t * 80) % 40;
    for (let y = horizon; y <= h; y += 12 + (y - horizon) * 0.15) {
      const actualY = y + offset * ((y - horizon) / (h - horizon));
      if (actualY <= h) {
        ctx.beginPath();
        ctx.moveTo(0, actualY);
        ctx.lineTo(w, actualY);
        ctx.stroke();
      }
    }
    ctx.restore();
  } else if (preset === 'particles') {
    // Cosmos Starfield
    ctx.fillStyle = '#030308';
    ctx.fillRect(0, 0, w, h);

    const nebula = ctx.createRadialGradient(
      w * 0.5 + Math.sin(t * 0.4) * 120,
      h * 0.4 + Math.cos(t * 0.3) * 80,
      30,
      w * 0.5,
      h * 0.5,
      w * 0.65
    );
    nebula.addColorStop(0, 'rgba(124, 58, 237, 0.35)');
    nebula.addColorStop(0.5, 'rgba(59, 130, 246, 0.15)');
    nebula.addColorStop(1, 'transparent');
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, w, h);

    // Stars
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 45; i++) {
      const px = ((i * 137.5) % w);
      const py = ((i * 269.3 + t * 25) % h);
      const size = (i % 3) * 0.8 + 0.8;
      const alpha = Math.sin(t * 2 + i) * 0.4 + 0.6;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  } else if (preset === 'minimal') {
    // Studio Dark Gradient
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.75);
    bgGrad.addColorStop(0, '#1c1c24');
    bgGrad.addColorStop(0.6, '#0f0f13');
    bgGrad.addColorStop(1, '#050507');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Waves Preset (Default)
    ctx.fillStyle = '#060810';
    ctx.fillRect(0, 0, w, h);

    for (let layer = 0; layer < 3; layer++) {
      const waveGrad = ctx.createLinearGradient(0, 0, w, 0);
      if (layer === 0) {
        waveGrad.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
        waveGrad.addColorStop(1, 'rgba(59, 130, 246, 0.25)');
      } else if (layer === 1) {
        waveGrad.addColorStop(0, 'rgba(139, 92, 246, 0.2)');
        waveGrad.addColorStop(1, 'rgba(236, 72, 153, 0.2)');
      } else {
        waveGrad.addColorStop(0, 'rgba(16, 185, 129, 0.2)');
        waveGrad.addColorStop(1, 'rgba(6, 182, 212, 0.2)');
      }

      ctx.fillStyle = waveGrad;
      ctx.beginPath();
      ctx.moveTo(0, h);

      const waveSpeed = t * (0.8 + layer * 0.4);
      const waveFreq = 0.003 + layer * 0.001;
      const amp = 35 + layer * 15;
      const baseHeight = h * (0.55 + layer * 0.1);

      for (let x = 0; x <= w; x += 15) {
        const y = baseHeight + Math.sin(x * waveFreq + waveSpeed) * amp + Math.cos(x * 0.001 - waveSpeed * 0.5) * 15;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// Camera Motion Transform Calculator
function applyMotionTransform(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  effect: string,
  intensityVal: number,
  freqData?: Uint8Array
) {
  if (effect === 'none') return;

  const mult = intensityVal / 100;
  let scale = 1.0;
  let transX = 0;
  let transY = 0;
  let rot = 0;

  if (effect === 'zoom-in') {
    const cycle = (time % 8000) / 8000;
    scale = 1.0 + cycle * 0.18 * mult;
  } else if (effect === 'zoom-out') {
    const cycle = (time % 8000) / 8000;
    scale = 1.18 - cycle * 0.18 * mult;
  } else if (effect === 'pulse') {
    let bounce = 0;
    if (freqData && freqData.length > 0) {
      bounce = (freqData[2] / 255) * 0.15;
    } else {
      bounce = (Math.sin(time * 0.007) * 0.5 + 0.5) * 0.08;
    }
    scale = 1.0 + bounce * mult;
  } else if (effect === 'shake') {
    const shakeSpeed = time * 0.04;
    transX = (Math.sin(shakeSpeed * 1.3) * 6 + Math.cos(shakeSpeed * 2.1) * 3) * mult;
    transY = (Math.cos(shakeSpeed * 1.5) * 5 + Math.sin(shakeSpeed * 2.3) * 3) * mult;
    rot = (Math.sin(shakeSpeed * 0.8) * 0.01) * mult;
    scale = 1.06;
  } else if (effect === 'pan-left') {
    const cycle = (time % 10000) / 10000;
    transX = (0.5 - cycle) * (w * 0.1) * mult;
    scale = 1.1;
  } else if (effect === 'pan-right') {
    const cycle = (time % 10000) / 10000;
    transX = (cycle - 0.5) * (w * 0.1) * mult;
    scale = 1.1;
  } else if (effect === 'float') {
    transX = Math.sin(time * 0.002) * 12 * mult;
    transY = Math.cos(time * 0.0016) * 10 * mult;
    rot = Math.sin(time * 0.001) * 0.006 * mult;
    scale = 1.08;
  }

  ctx.translate(w / 2 + transX, h / 2 + transY);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.translate(-w / 2, -h / 2);
}

// Waveform Overlay
function drawWaveformOverlay(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  freqData: Uint8Array,
  style: 'bars' | 'line' | 'none',
  colorScheme: 'white' | 'emerald' | 'cyan' | 'violet' | 'amber'
) {
  if (style === 'none') return;

  const centerY = h * 0.74;
  const barCount = 36;
  const spacing = w / (barCount * 1.6);
  const startX = (w - barCount * spacing) / 2;

  ctx.save();

  let strokeOrFill = '#06b6d4';
  if (colorScheme === 'emerald') strokeOrFill = '#10b981';
  else if (colorScheme === 'violet') strokeOrFill = '#8b5cf6';
  else if (colorScheme === 'amber') strokeOrFill = '#f59e0b';
  else if (colorScheme === 'white') strokeOrFill = '#ffffff';

  ctx.fillStyle = strokeOrFill;
  ctx.strokeStyle = strokeOrFill;

  if (style === 'bars') {
    const barWidth = Math.max(3, spacing * 0.55);
    for (let i = 0; i < barCount; i++) {
      const freqIdx = Math.floor((i / barCount) * Math.min(32, freqData.length));
      const val = freqData[freqIdx] || 0;
      const wave = Math.sin(time * 0.005 + i * 0.25) * 8;
      const height = Math.max(6, (val / 255) * 85 + wave);

      const x = startX + i * spacing;
      ctx.beginPath();
      // Round top and bottom bar (instantaneous rendering without shadowBlur)
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, centerY - height / 2, barWidth, height, 4);
      } else {
        ctx.rect(x, centerY - height / 2, barWidth, height);
      }
      ctx.fill();
    }
  } else if (style === 'line') {
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    for (let i = 0; i <= barCount; i++) {
      const freqIdx = Math.floor((i / barCount) * Math.min(32, freqData.length));
      const val = freqData[freqIdx] || 0;
      const wave = Math.sin(time * 0.006 + i * 0.3) * 10;
      const offset = ((val / 255) * 60 + wave) * (i % 2 === 0 ? 1 : -1);
      const x = (i / barCount) * w;
      const y = centerY + offset;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, centerY);
    ctx.stroke();
  }

  ctx.restore();
}

// Title Overlay
function drawTitleOverlay(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  text: string,
  pos: 'top' | 'center' | 'bottom'
) {
  if (!text.trim()) return;

  ctx.save();
  let y = h * 0.88;
  if (pos === 'top') y = h * 0.12;
  else if (pos === 'center') y = h * 0.48;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const fontSize = Math.max(16, Math.min(32, Math.floor(w * 0.038)));
  ctx.font = `bold ${fontSize}px sans-serif`;

  const textWidth = ctx.measureText(text).width;
  const paddingX = 24;
  const paddingY = 12;

  // Background pill
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(
      w / 2 - textWidth / 2 - paddingX,
      y - fontSize / 2 - paddingY,
      textWidth + paddingX * 2,
      fontSize + paddingY * 2,
      12
    );
    ctx.fill();
  } else {
    ctx.fillRect(
      w / 2 - textWidth / 2 - paddingX,
      y - fontSize / 2 - paddingY,
      textWidth + paddingX * 2,
      fontSize + paddingY * 2
    );
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, w / 2, y);
  ctx.restore();
}

// Subtitle Processing & Animated Karaoke Overlay
interface SubtitleWord {
  word: string;
  start: number;
  end: number;
  phraseIdx: number;
}

function estimateWorkerWordWeight(rawWord: string): number {
  const token = (rawWord || '').toLowerCase().replace(/[^a-záéíóúâêôãõàüç0-9%$]/gi, '');
  if (!token) return 0.4;
  let numSyl = 0;
  const digits = token.match(/\d+/g);
  if (digits) {
    for (const d of digits) {
      if (d.length === 1) numSyl += 2.1;
      else if (d.length === 2) numSyl += 4.2;
      else if (d.length === 3) numSyl += 6.4;
      else numSyl += d.length * 2.3;
    }
  }
  const alpha = token.replace(/\d+/g, '');
  const vowels = (alpha.match(/[aeiouáéíóúâêôãõàü]+/gi) || []).length;
  const alphaSyl = alpha.length > 0 ? Math.max(1, vowels) : 0;
  return Math.max(0.8, (numSyl + alphaSyl) * 1.15 + 0.34 + alpha.length * 0.035);
}

function parseSubtitles(
  text: string,
  duration: number,
  startOffset: number,
  audioChannel0?: Float32Array,
  sampleRate?: number
): SubtitleWord[] {
  if (!text || duration <= 0) return [];
  const cleaned = text
    .replace(/\[pausa.*?\]/gi, '. ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return [];

  const weights = rawTokens.map((w) => estimateWorkerWordWeight(w));
  const pausesAfter = rawTokens.map((w, idx) => {
    if (idx === rawTokens.length - 1) return 0;
    if (/[.!?…]$/.test(w)) return 0.34;
    if (/[;:—–]$/.test(w)) return 0.2;
    if (/,$/.test(w)) return 0.12;
    return 0;
  });

  // Group into natural 3-word phrases that respect sentence punctuation boundaries
  const phraseIndices: number[] = new Array(rawTokens.length).fill(0);
  let currentPhraseIdx = 0;
  let wordsInCurrentPhrase = 0;
  for (let i = 0; i < rawTokens.length; i++) {
    phraseIndices[i] = currentPhraseIdx;
    wordsInCurrentPhrase++;
    if (wordsInCurrentPhrase >= 3 || pausesAfter[i] >= 0.12) {
      currentPhraseIdx++;
      wordsInCurrentPhrase = 0;
    }
  }

  let voiceStart = startOffset;
  let voiceEnd = startOffset + duration;
  const dt = 0.01;
  let voicedCum: Float32Array | null = null;
  let totalVoiced = 0;

  if (audioChannel0 && sampleRate && sampleRate > 0 && audioChannel0.length > sampleRate * 0.2) {
    const startSample = Math.max(0, Math.floor(startOffset * sampleRate));
    const endSample = Math.min(audioChannel0.length, Math.floor((startOffset + duration) * sampleRate));
    const totalSamples = endSample - startSample;
    const samplesPerFrame = Math.max(1, Math.floor(sampleRate * dt));
    const numFrames = Math.floor(totalSamples / samplesPerFrame);

    if (numFrames > 10) {
      const rms = new Float32Array(numFrames);
      let peak = 0;
      for (let f = 0; f < numFrames; f++) {
        const base = startSample + f * samplesPerFrame;
        let sumSq = 0;
        for (let s = 0; s < samplesPerFrame; s++) {
          const v = audioChannel0[base + s] || 0;
          sumSq += v * v;
        }
        const r = Math.sqrt(sumSq / samplesPerFrame);
        rms[f] = r;
        if (r > peak) peak = r;
      }
      const thresh = Math.max(0.003, peak * 0.036);
      const isSpk = new Uint8Array(numFrames);
      for (let f = 0; f < numFrames; f++) {
        if (rms[f] >= thresh) isSpk[f] = 1;
      }
      let gap = 0;
      for (let f = 0; f < numFrames; f++) {
        if (isSpk[f] === 0) gap++;
        else {
          if (gap > 0 && gap <= 7 && f - gap > 0) {
            for (let k = f - gap; k < f; k++) isSpk[k] = 1;
          }
          gap = 0;
        }
      }
      let firstF = 0;
      while (firstF < numFrames && isSpk[firstF] === 0) firstF++;
      let lastF = numFrames - 1;
      while (lastF > firstF && isSpk[lastF] === 0) lastF--;
      if (lastF > firstF + 5) {
        voiceStart = startOffset + Math.max(0, firstF * dt - 0.01);
        voiceEnd = startOffset + Math.min(duration, (lastF + 1) * dt + 0.015);
        voicedCum = new Float32Array(numFrames + 1);
        let acc = 0;
        for (let f = 0; f < numFrames; f++) {
          voicedCum[f] = acc;
          if (f >= firstF && f <= lastF && isSpk[f] === 1) {
            acc += dt;
          }
        }
        voicedCum[numFrames] = acc;
        totalVoiced = acc;
      }
    }
  }

  const totalW = Math.max(0.01, weights.reduce((a, b) => a + b, 0));

  if (voicedCum && totalVoiced > 0.25) {
    const numFrames = voicedCum.length - 1;
    const mapVoicedToSec = (vTarget: number): number => {
      if (vTarget <= 0) return voiceStart;
      if (vTarget >= totalVoiced) return voiceEnd;
      let lo = 0;
      let hi = numFrames;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (voicedCum![mid] < vTarget) lo = mid + 1;
        else hi = mid;
      }
      return Math.min(voiceEnd, Math.max(voiceStart, startOffset + lo * dt));
    };

    const result: SubtitleWord[] = [];
    let cumW = 0;
    let prevEnd = voiceStart;
    for (let i = 0; i < rawTokens.length; i++) {
      const wStart = i === 0 ? voiceStart : Math.max(prevEnd, mapVoicedToSec((cumW / totalW) * totalVoiced));
      cumW += weights[i];
      const wEnd =
        i === rawTokens.length - 1
          ? voiceEnd
          : Math.max(wStart + 0.04, mapVoicedToSec((cumW / totalW) * totalVoiced));
      result.push({
        word: rawTokens[i],
        start: wStart,
        end: wEnd,
        phraseIdx: phraseIndices[i],
      });
      prevEnd = wEnd;
    }
    return result;
  }

  const totalPauseSec = pausesAfter.reduce((a, b) => a + b, 0);
  const span = Math.max(0.2, voiceEnd - voiceStart);
  const pauseScale = totalPauseSec > 0 ? Math.min(span * 0.3, totalPauseSec) / totalPauseSec : 0;
  const speakSpan = Math.max(0.15, span - totalPauseSec * pauseScale);

  let cursor = voiceStart;
  return rawTokens.map((w, i) => {
    const dur = (weights[i] / totalW) * speakSpan;
    const pause = pausesAfter[i] * pauseScale;
    const s = cursor;
    const e = i === rawTokens.length - 1 ? voiceEnd : Math.min(voiceEnd, s + dur);
    cursor = Math.min(voiceEnd, e + pause);
    return {
      word: w,
      start: s,
      end: Math.max(s + 0.04, e),
      phraseIdx: phraseIndices[i],
    };
  });
}

function drawSubtitleOverlay(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  timeSec: number,
  words: SubtitleWord[],
  style: 'hormozi' | 'modern' | 'classic' = 'hormozi',
  highlightColor: string = '#facc15',
  fontFamily: 'sans' | 'impact' | 'serif' | 'mono' = 'sans',
  aspectRatio: string = '16:9'
) {
  if (!words || words.length === 0) return;

  // Find active word or hold within a brief inter-word micro-gap inside the same phrase
  let activeIdx = words.findIndex((wItem) => timeSec >= wItem.start && timeSec < wItem.end);
  if (activeIdx < 0) {
    for (let i = 0; i < words.length - 1; i++) {
      if (
        timeSec >= words[i].end &&
        timeSec < words[i + 1].start &&
        timeSec - words[i].end <= 0.12 &&
        words[i].phraseIdx === words[i + 1].phraseIdx
      ) {
        activeIdx = i;
        break;
      }
    }
  }
  if (activeIdx < 0) return;

  const activePhraseIdx = words[activeIdx].phraseIdx;
  const chunkWords = words.filter((wItem) => wItem.phraseIdx === activePhraseIdx);

  ctx.save();

  // Position based on aspect ratio
  const centerY = aspectRatio === '9:16' ? h * 0.62 : h * 0.78;
  const fontFace =
    fontFamily === 'impact'
      ? 'Impact, "Bebas Neue", sans-serif'
      : fontFamily === 'serif'
      ? 'Outfit, Georgia, serif'
      : fontFamily === 'mono'
      ? '"JetBrains Mono", monospace'
      : 'Plus Jakarta Sans, system-ui, sans-serif';

  const baseFontSize = Math.max(18, Math.min(46, Math.floor(w * (style === 'hormozi' ? 0.052 : 0.038))));
  ctx.font = `bold ${baseFontSize}px ${fontFace}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Measure full chunk width with spaces
  let phraseText = '';
  chunkWords.forEach((item, idx) => {
    const textToShow = style === 'hormozi' ? item.word.toUpperCase() : item.word;
    phraseText += (idx > 0 ? ' ' : '') + textToShow;
  });

  const phraseWidth = ctx.measureText(phraseText).width;
  const padX = 22;
  const padY = 12;

  // Background box
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(w / 2 - phraseWidth / 2 - padX, centerY - baseFontSize / 2 - padY, phraseWidth + padX * 2, baseFontSize + padY * 2, 12);
    ctx.fill();
  } else {
    ctx.fillRect(w / 2 - phraseWidth / 2 - padX, centerY - baseFontSize / 2 - padY, phraseWidth + padX * 2, baseFontSize + padY * 2);
  }

  // Draw each word individually to highlight active word
  let currentX = w / 2 - phraseWidth / 2;
  ctx.textAlign = 'left';

  chunkWords.forEach((item) => {
    const isCurrent = timeSec >= item.start && timeSec < item.end;
    const wordText = (style === 'hormozi' ? item.word.toUpperCase() : item.word) + ' ';

    if (isCurrent) {
      ctx.fillStyle = highlightColor;
      ctx.shadowColor = highlightColor;
      ctx.shadowBlur = 14;
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.shadowBlur = 0;
    }

    ctx.fillText(wordText, currentX, centerY);
    currentX += ctx.measureText(wordText).width;
  });

  ctx.restore();
}

// Main Render Executor inside Web Worker
async function executeRender(payload: StartRenderPayload) {
  isCancelled = false;

  const {
    width,
    height,
    fps,
    totalDuration,
    startTime,
    endTime,
    bgMode,
    userMediaType,
    selectedPreset,
    motionEffect,
    motionIntensityValue,
    cropSettings,
    aspectRatio = '16:9',
    fitMode = 'blur_capcut',
    blurIntensity = 25,
    blurDarken = 0.3,
    dropShadow = true,
    showWaveform,
    waveformStyle,
    waveformColor,
    showTitle,
    videoTitleText,
    titlePosition,
    showSubtitles = false,
    subtitleStyle = 'hormozi',
    subtitleHighlightColor = '#facc15',
    subtitleText = '',
    fontFamily = 'sans',
    colorFilter = 'none',
    audioSampleRate,
    audioChannel0,
    audioChannel1,
    imageBitmap,
    videoFrameBitmaps,
    videoDurationSec = 5,
    mediaWidth = 1280,
    mediaHeight = 720,
    removeWatermark = false,
    showWatermark = true,
  } = payload;

  const totalFrames = Math.floor(totalDuration * fps);
  const subtitleWords =
    showSubtitles && subtitleText
      ? parseSubtitles(subtitleText, totalDuration, startTime, audioChannel0, audioSampleRate)
      : [];

  // Allocate OffscreenCanvas in Worker
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', {
    alpha: false,
    desynchronized: true,
  }) as OffscreenCanvasRenderingContext2D;

  if (!ctx) {
    throw new Error('Failed to get OffscreenCanvas 2D context in worker');
  }

  // Reset per-render caches
  cachedBlurBgCanvas = null;
  cachedBlurBgKey = '';

  // Pre-build vignette gradient once per render instead of per frame
  const vignetteGrad = ctx.createLinearGradient(0, 0, 0, height);
  vignetteGrad.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
  vignetteGrad.addColorStop(0.3, 'rgba(0, 0, 0, 0.1)');
  vignetteGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.15)');
  vignetteGrad.addColorStop(1, 'rgba(0, 0, 0, 0.65)');

  // Pre-calculate audio FFT frequency bands for all frames on the worker thread
  const precomputedFreqs: Uint8Array[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const frameTime = startTime + f / fps;
    const sampleIndex = Math.floor(frameTime * audioSampleRate);
    const mockFreq = new Uint8Array(32);
    for (let k = 0; k < 32; k++) {
      const s = audioChannel0[sampleIndex + k * 8] || 0;
      mockFreq[k] = Math.min(255, Math.abs(s) * 360);
    }
    precomputedFreqs.push(mockFreq);
  }

  // Setup MP4 Muxer with AAC audio and H.264 video
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    audio: {
      codec: 'aac',
      numberOfChannels: 2,
      sampleRate: audioSampleRate,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  const resumeCheckpoint = payload.resumeCheckpoint;
  const hasSavedAudioChunks =
    resumeCheckpoint?.audioChunks && resumeCheckpoint.audioChunks.length > 0;

  let audioEncoder: any = null;
  if (hasSavedAudioChunks) {
    replayCheckpointToMuxer(muxer, { audioChunks: resumeCheckpoint!.audioChunks, videoChunks: [] });
  } else {
    const serializedAudioChunks: SerializedEncodedChunk[] = [];
    audioEncoder = new (self as any).AudioEncoder({
      output: (chunk: any, meta: any) => {
        muxer.addAudioChunk(chunk, meta);
        serializedAudioChunks.push(serializeEncodedChunk(chunk, meta, 0));
      },
      error: (e: any) => console.error('Worker AudioEncoder error:', e),
    });

    audioEncoder.configure({
      codec: 'mp4a.40.2',
      numberOfChannels: 2,
      sampleRate: audioSampleRate,
      bitrate: 128_000,
    });

    // Encode full audio range
    const startSample = Math.floor(startTime * audioSampleRate);
    const endSample = Math.min(audioChannel0.length, Math.floor(endTime * audioSampleRate));
    const totalSamples = endSample - startSample;

    const chunkSize = 8192;
    const planarBuffer = new Float32Array(chunkSize * 2);

    for (let offset = 0; offset < totalSamples; offset += chunkSize) {
      if (isCancelled) return;
      const currentChunkSize = Math.min(chunkSize, totalSamples - offset);

      for (let i = 0; i < currentChunkSize; i++) {
        planarBuffer[i] = audioChannel0[startSample + offset + i] || 0;
        planarBuffer[currentChunkSize + i] = audioChannel1[startSample + offset + i] || 0;
      }

      const audioData = new (self as any).AudioData({
        format: 'f32-planar',
        sampleRate: audioSampleRate,
        numberOfFrames: currentChunkSize,
        numberOfChannels: 2,
        timestamp: Math.round((offset / audioSampleRate) * 1_000_000),
        data: planarBuffer.subarray(0, currentChunkSize * 2),
      });

      audioEncoder.encode(audioData);
      audioData.close();
    }
    await audioEncoder.flush();

    self.postMessage({
      type: 'AUDIO_CHECKPOINT',
      payload: {
        audioChunks: serializedAudioChunks,
        sampleRate: audioSampleRate,
      },
    });
  }

  // Replay any already-encoded video frames from checkpoint so rendering resumes from exact frame!
  let startFrame = 0;
  let lastVideoTimestamp = -1;
  if (resumeCheckpoint?.videoChunks && resumeCheckpoint.videoChunks.length > 0) {
    const replayRes = replayCheckpointToMuxer(muxer, {
      audioChunks: [],
      videoChunks: resumeCheckpoint.videoChunks,
    });
    startFrame = Math.min(totalFrames, replayRes.replayedVideoFrames);
    lastVideoTimestamp = replayRes.lastVideoTimestamp;
  }

  let selectedCodec = 'avc1.4d002a';
  if (typeof (self as any).VideoEncoder.isConfigSupported === 'function') {
    const candidateCodecs = ['avc1.4d002a', 'avc1.42001f', 'avc1.420028', 'avc1.640028'];
    for (const c of candidateCodecs) {
      try {
        const support = await (self as any).VideoEncoder.isConfigSupported({
          codec: c,
          width,
          height,
          bitrate: 4_500_000,
        });
        if (support && support.supported) {
          selectedCodec = c;
          break;
        }
      } catch {
        // continue testing
      }
    }
  }

  let videoEncoderError: any = null;
  let pendingCheckpointVideoChunks: SerializedEncodedChunk[] = [];
  let totalEncodedVideoCount = startFrame;
  const frameDurationUs = Math.round(1_000_000 / fps);

  const flushCheckpointToMain = (currentFrameIndex: number) => {
    if (pendingCheckpointVideoChunks.length === 0) return;
    const chunksToSend = pendingCheckpointVideoChunks;
    pendingCheckpointVideoChunks = [];
    const pct = Math.min(99, Math.floor((currentFrameIndex / Math.max(1, totalFrames)) * 100));
    self.postMessage({
      type: 'VIDEO_CHECKPOINT',
      payload: {
        newVideoChunks: chunksToSend,
        lastCompletedFrame: totalEncodedVideoCount,
        totalFrames,
        percent: pct,
      },
    });
  };

  const createVideoEncoderInstance = (preferSoftware = false) => {
    videoEncoderError = null;
    const enc = new (self as any).VideoEncoder({
      output: (chunk: any, meta: any) => {
        const serialized = serializeEncodedChunk(chunk, meta, frameDurationUs);
        const safeTs =
          serialized.timestamp > lastVideoTimestamp
            ? serialized.timestamp
            : lastVideoTimestamp + 1;
        lastVideoTimestamp = safeTs;
        serialized.timestamp = safeTs;

        muxer.addVideoChunkRaw(
          serialized.data,
          serialized.type,
          safeTs,
          serialized.duration,
          serialized.decoderConfig ? { decoderConfig: serialized.decoderConfig } : undefined
        );
        pendingCheckpointVideoChunks.push(serialized);
        totalEncodedVideoCount++;
      },
      error: (e: any) => {
        console.error('Worker VideoEncoder error:', e);
        videoEncoderError = e;
      },
    });

    let configured = false;
    if (!preferSoftware) {
      try {
        enc.configure({
          codec: selectedCodec,
          width,
          height,
          bitrate: 3_500_000,
          hardwareAcceleration: 'prefer-hardware',
          latencyMode: 'realtime',
        });
        configured = true;
      } catch {}
    }
    if (!configured) {
      try {
        enc.configure({
          codec: selectedCodec,
          width,
          height,
          bitrate: 3_500_000,
          hardwareAcceleration: preferSoftware ? 'prefer-software' : 'no-preference',
          latencyMode: 'realtime',
        });
      } catch {
        enc.configure({
          codec: selectedCodec,
          width,
          height,
          bitrate: 3_500_000,
        });
      }
    }
    return enc;
  };

  let videoEncoder = createVideoEncoderInstance(false);

  const renderStartTime = performance.now();
  let frameCount = 0;

  if (startFrame > 0) {
    const resumePct = Math.min(99, Math.floor((startFrame / Math.max(1, totalFrames)) * 100));
    self.postMessage({
      type: 'PROGRESS',
      payload: {
        frame: startFrame,
        totalFrames,
        percent: resumePct,
        fps: 60,
        resumedFromFrame: startFrame,
      },
    });
  }

  for (let f = startFrame; f < totalFrames; f++) {
    if (isCancelled) {
      try {
        await Promise.race([videoEncoder.flush(), new Promise((r) => setTimeout(r, 300))]);
      } catch {}
      flushCheckpointToMain(f);
      try { videoEncoder.close(); } catch {}
      try { if (audioEncoder) audioEncoder.close(); } catch {}
      self.postMessage({
        type: 'CANCELLED',
        payload: {
          lastCompletedFrame: totalEncodedVideoCount,
          totalFrames,
        },
      });
      return;
    }

    // Strict low-memory queue yielding with stall & self-healing guard
    let queueWaitTicks = 0;
    while (videoEncoder.state === 'configured' && videoEncoder.encodeQueueSize > 2) {
      if (videoEncoderError) break;
      if (isCancelled) break;
      await yieldInWorker();
      queueWaitTicks++;
      if (queueWaitTicks > 200) {
        console.warn('Worker VideoEncoder queue drain stall, proceeding with frame', f);
        break;
      }
    }

    // Self-heal if hardware encoder closed or threw an error mid-stream
    if (videoEncoderError || videoEncoder.state !== 'configured') {
      console.warn(`Worker VideoEncoder self-healing at frame ${f}, switching to software/fresh encoder`);
      try { videoEncoder.close(); } catch {}
      videoEncoder = createVideoEncoderInstance(true);
    }

    const frameTime = startTime + f / fps;
    const timeMs = frameTime * 1000;
    const mockFreq = precomputedFreqs[f] || new Uint8Array(32);

    // 1. Background base (only compute procedural sine-wave algorithms when preset is active)
    if (bgMode === 'preset') {
      drawProceduralBackground(ctx, width, height, timeMs, selectedPreset);
    } else {
      ctx.fillStyle = '#030508';
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Camera motion transform
    ctx.save();
    applyMotionTransform(
      ctx,
      width,
      height,
      timeMs,
      motionEffect,
      motionIntensityValue,
      mockFreq
    );

    // 3. Draw media (image or video frames)
    if (bgMode === 'user') {
      const isBlurCapCut =
        (aspectRatio === '9:16' && fitMode === 'blur_capcut' && !cropSettings?.enabled) ||
        (aspectRatio === '1:1' && fitMode === 'blur_capcut' && !cropSettings?.enabled);

      if (userMediaType === 'image' && imageBitmap) {
        if (isBlurCapCut) {
          drawMediaWithCapCutBlur(
            ctx,
            imageBitmap,
            imageBitmap.width || mediaWidth,
            imageBitmap.height || mediaHeight,
            width,
            height,
            blurIntensity,
            blurDarken,
            dropShadow
          );
        } else {
          drawCroppedMedia(
            ctx,
            imageBitmap,
            imageBitmap.width || mediaWidth,
            imageBitmap.height || mediaHeight,
            width,
            height,
            cropSettings
          );
        }
      } else if (userMediaType === 'video') {
        if (videoFrameBitmaps && videoFrameBitmaps.length > 0) {
          // Map elapsed time proportionally to the actual video duration so the video plays smoothly at natural speed in continuous loop
          const safeVidDur = Math.max(0.5, Number(videoDurationSec) || videoFrameBitmaps.length / 15);
          const elapsedSec = f / fps;
          const loopSec = elapsedSec % safeVidDur;
          const vidIdx = Math.min(
            videoFrameBitmaps.length - 1,
            Math.floor((loopSec / safeVidDur) * videoFrameBitmaps.length)
          );
          const currentFrameBitmap = videoFrameBitmaps[vidIdx];
          if (currentFrameBitmap) {
            // Render video rolling in full screen (cover)
            drawCroppedMedia(
              ctx,
              currentFrameBitmap,
              currentFrameBitmap.width || mediaWidth,
              currentFrameBitmap.height || mediaHeight,
              width,
              height,
              cropSettings
            );
          }
        } else if (imageBitmap) {
          if (isBlurCapCut) {
            drawMediaWithCapCutBlur(
              ctx,
              imageBitmap,
              imageBitmap.width || mediaWidth,
              imageBitmap.height || mediaHeight,
              width,
              height,
              blurIntensity,
              blurDarken,
              dropShadow
            );
          } else {
            drawCroppedMedia(
              ctx,
              imageBitmap,
              imageBitmap.width || mediaWidth,
              imageBitmap.height || mediaHeight,
              width,
              height,
              cropSettings
            );
          }
        }
      }
    }
    ctx.restore();

    // 4. Cinematic vignette gradient (pre-built once outside loop)
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, width, height);

    // 5. Waveform overlay
    if (showWaveform) {
      drawWaveformOverlay(ctx, width, height, timeMs, mockFreq, waveformStyle, waveformColor);
    }

    // 6. Title overlay
    if (showTitle && videoTitleText.trim()) {
      drawTitleOverlay(ctx, width, height, videoTitleText, titlePosition);
    }

    // 7. Dynamic Synchronized Subtitles (Hormozi / TikTok / CapCut style)
    if (showSubtitles && subtitleWords.length > 0) {
      drawSubtitleOverlay(
        ctx,
        width,
        height,
        frameTime,
        subtitleWords,
        subtitleStyle,
        subtitleHighlightColor,
        fontFamily,
        aspectRatio
      );
    }

    // 8. Watermark (Only if not removed by user)
    const shouldDrawWatermark =
      removeWatermark !== undefined
        ? !removeWatermark
        : showWatermark !== false;

    if (shouldDrawWatermark) {
      ctx.save();
      ctx.font = '500 14px sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.textAlign = 'right';
      ctx.fillText('VozLivre Video', width - 24, height - 24);
      ctx.restore();
    }

    // Create VideoFrame from OffscreenCanvas and encode immediately
    const videoFrame = new (self as any).VideoFrame(canvas, {
      timestamp: Math.round((f / fps) * 1_000_000),
      duration: frameDurationUs,
    });
    const forceKeyFrame = f === startFrame || f % 45 === 0;
    try {
      videoEncoder.encode(videoFrame, { keyFrame: forceKeyFrame });
    } catch (encErr) {
      console.warn(`Worker encode recovery at frame ${f}:`, encErr);
      try { videoEncoder.close(); } catch {}
      videoEncoder = createVideoEncoderInstance(true);
      videoEncoder.encode(videoFrame, { keyFrame: true });
    } finally {
      videoFrame.close();
    }

    frameCount++;

    if (f % 45 === 0) {
      flushCheckpointToMain(f);
    }

    // Post progress smoothly every 6 frames or last frame
    if (f % 6 === 0 || f === totalFrames - 1) {
      const elapsedSec = (performance.now() - renderStartTime) / 1000;
      const currentFps = Math.round(frameCount / Math.max(0.1, elapsedSec));
      const percent = Math.min(99, Math.floor((f / totalFrames) * 100));

      self.postMessage({
        type: 'PROGRESS',
        payload: {
          frame: f,
          totalFrames,
          percent,
          fps: currentFps,
        },
      });
    }
  }

  try {
    await videoEncoder.flush();
    flushCheckpointToMain(totalFrames);
    muxer.finalize();
  } finally {
    try { videoEncoder.close(); } catch {}
    try { if (audioEncoder) audioEncoder.close(); } catch {}
  }

  // Free GPU memory from bitmaps
  if (videoFrameBitmaps && videoFrameBitmaps.length > 0) {
    for (const b of videoFrameBitmaps) {
      try { b.close(); } catch {}
    }
  }
  if (imageBitmap) {
    try { imageBitmap.close(); } catch {}
  }

  const finalBuffer = muxer.target.buffer;

  // Transfer final buffer back to main thread with ZERO copy!
  (self as any).postMessage(
    {
      type: 'COMPLETE',
      payload: {
        buffer: finalBuffer,
      },
    },
    [finalBuffer]
  );
}

// Worker message router
self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'CANCEL') {
    isCancelled = true;
    return;
  }

  if (type === 'START_RENDER') {
    isCancelled = false;
    try {
      await executeRender(payload);
    } catch (err: any) {
      console.error('VideoRender Worker error:', err);
      self.postMessage({
        type: 'ERROR',
        payload: {
          message: err?.message || String(err),
        },
      });
    }
  }
};

export {};
