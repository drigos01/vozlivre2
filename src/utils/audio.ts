/**
 * Accurately determines duration in seconds of an audio Blob or URL using HTML5 Audio element.
 */
export async function getAudioDuration(source: Blob | string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const audio = new Audio();
      const isBlob = source instanceof Blob;
      const url = isBlob ? URL.createObjectURL(source) : source;
      audio.preload = 'metadata';

      let resolved = false;
      const done = (val: number) => {
        if (resolved) return;
        resolved = true;
        if (isBlob) {
          try {
            URL.revokeObjectURL(url);
          } catch {}
        }
        resolve(isFinite(val) && val > 0 ? Math.round(val * 10) / 10 : 0);
      };

      const timer = setTimeout(() => {
        done(audio.duration || 0);
      }, 5000);

      audio.onloadedmetadata = () => {
        clearTimeout(timer);
        done(audio.duration || 0);
      };

      audio.onerror = () => {
        clearTimeout(timer);
        done(0);
      };

      audio.src = url;
    } catch {
      resolve(0);
    }
  });
}

/**
 * Utility functions for audio manipulation, formatting, and downloads.
 */

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Estimates reading/audio duration in seconds from character count.
 * Average Portuguese speech rate is approx 140 words/min or 850 chars/min.
 */
export function estimateDurationSeconds(charCount: number, rateMultiplier = 1.0): number {
  if (!charCount || charCount <= 0) return 0;
  const words = Math.max(1, Math.round(charCount / 5.5));
  const minutes = words / (135 * rateMultiplier);
  return Math.max(1, Math.round(minutes * 60));
}

/**
 * Cleans and formats a custom file name safely for downloads.
 */
export function formatFilename(name: string | undefined, fallback: string, ext: string): string {
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  if (!name || !name.trim()) {
    return `${fallback}${cleanExt}`;
  }
  // Sanitize illegal filesystem characters: \ / : * ? " < > |
  let sanitized = name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ');

  // Remove existing extension if typed by user
  if (sanitized.toLowerCase().endsWith(cleanExt.toLowerCase())) {
    sanitized = sanitized.slice(0, -cleanExt.length);
  }

  return `${sanitized.trim() || fallback}${cleanExt}`;
}

/**
 * Downloads a Blob directly with browser verification.
 * Creates a clean object URL to ensure cross-origin/iframe compatibility.
 */
export function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = filename;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
      URL.revokeObjectURL(blobUrl);
    }, 10000);
    return true;
  } catch (err) {
    console.error('downloadBlob error:', err);
    return false;
  }
}

/**
 * Downloads audio file by either utilizing existing Blob or fetching and creating one.
 */
export async function downloadAudio(
  audio: { blob?: Blob; blobUrl?: string; audioUrl: string },
  filename: string
): Promise<void> {
  try {
    if (audio.blob) {
      downloadBlob(audio.blob, filename);
      return;
    }

    // If no blob in memory, fetch it as Blob
    const res = await fetch(audio.audioUrl);
    if (!res.ok) throw new Error('Não foi possível carregar o arquivo de áudio.');
    const blob = await res.blob();
    downloadBlob(blob, filename);
  } catch (err) {
    console.error('downloadAudio error:', err);
    // Last resort fallback: open direct download URL
    const a = document.createElement('a');
    a.href = audio.audioUrl.includes('?') ? `${audio.audioUrl}&download=true` : `${audio.audioUrl}?download=true`;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 1000);
  }
}

/**
 * Converts an AudioBuffer to a WAV Blob for high-quality lossless download.
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));
  const channels: Float32Array[] = [];
  const sampleRate = buffer.sampleRate;
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) {
    out.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    out.setUint32(pos, data, true);
    pos += 4;
  }

  // RIFF identifier
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  // fmt sub-chunk
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(sampleRate);
  setUint32(sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit precision

  // data sub-chunk
  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // write interleaved data
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      out.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([out], { type: 'audio/wav' });
}

let sharedDecodeAudioContext: AudioContext | null = null;

/**
 * Returns a shared singleton AudioContext for decoding audio buffers without
 * exhausting the browser's hardware AudioContext limit.
 */
export function getSharedAudioContext(): AudioContext {
  if (!sharedDecodeAudioContext || sharedDecodeAudioContext.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    sharedDecodeAudioContext = new AudioCtx();
  }
  if (sharedDecodeAudioContext.state === 'suspended') {
    sharedDecodeAudioContext.resume().catch(() => {});
  }
  return sharedDecodeAudioContext;
}

const decodedBlobWeakCache = new WeakMap<Blob, AudioBuffer>();

/**
 * Decodes an audio Blob once and caches the resulting AudioBuffer in a WeakMap
 * so the same Blob is never decoded multiple times across TTS, mixer, and video encoder.
 */
export async function decodeAudioBlobOnce(blob: Blob): Promise<AudioBuffer> {
  const cached = decodedBlobWeakCache.get(blob);
  if (cached) return cached;
  const ctx = getSharedAudioContext();
  const ab = await blob.arrayBuffer();
  const decoded = await ctx.decodeAudioData(ab.slice(0));
  decodedBlobWeakCache.set(blob, decoded);
  return decoded;
}

/**
 * Concatenates multiple audio blobs in sequence into a unified WAV audio blob.
 * Decodes all segments into AudioBuffers and splices them seamlessly.
 */
export async function concatenateAudioBlobs(
  blobs: Blob[],
  pauseBetweenSeconds = 0.5
): Promise<{ blob: Blob; duration: number; audioBuffer?: AudioBuffer }> {
  if (!blobs || blobs.length === 0) {
    throw new Error('Nenhum áudio para concatenar.');
  }

  const audioCtx = getSharedAudioContext();
  const decodedBuffers: AudioBuffer[] = [];

  for (const b of blobs) {
    try {
      const decoded = await decodeAudioBlobOnce(b);
      decodedBuffers.push(decoded);
    } catch (err) {
      console.warn('Failed to decode audio segment during concatenation:', err);
    }
  }

  if (decodedBuffers.length === 0) {
    throw new Error('Não foi possível decodificar os áudios selecionados.');
  }

  const sampleRate = decodedBuffers[0].sampleRate;
  const numChannels = Math.max(...decodedBuffers.map((b) => b.numberOfChannels));
  const pauseSamples = Math.floor(pauseBetweenSeconds * sampleRate);

  // Total samples across all segments plus pauses between them
  let totalLength = 0;
  decodedBuffers.forEach((buf, idx) => {
    totalLength += buf.length;
    if (idx < decodedBuffers.length - 1) {
      totalLength += pauseSamples;
    }
  });

  const merged = audioCtx.createBuffer(numChannels, totalLength, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = merged.getChannelData(channel);
    let offset = 0;

    decodedBuffers.forEach((buf, idx) => {
      const srcChannel = channel < buf.numberOfChannels ? buf.getChannelData(channel) : buf.getChannelData(0);
      channelData.set(srcChannel, offset);
      offset += buf.length;

      // Add silence pause if not the last segment
      if (idx < decodedBuffers.length - 1) {
        offset += pauseSamples;
      }
    });
  }

  const wavBlob = audioBufferToWavBlob(merged);
  decodedBlobWeakCache.set(wavBlob, merged);
  return { blob: wavBlob, duration: merged.duration, audioBuffer: merged };
}

/**
 * Generates an .SRT subtitle file from raw text and total audio duration,
 * synchronized with Portuguese phonetic syllable weights and punctuation pauses.
 */
export function generateSrtFromText(text: string, durationSeconds: number): string {
  if (!text || durationSeconds <= 0) return '';
  const cleaned = text
    .replace(/\[pausa.*?\]/gi, '. ')
    .replace(/\[\s*(?:voz|narrador|sfx)\s*:[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const parts = cleaned.split(/([.,!?;:—–\n]+)/);
  const segments: Array<{ text: string; weight: number; pauseAfter: number }> = [];

  const estimateWeight = (str: string): number => {
    const words = str.toLowerCase().split(/\s+/).filter(Boolean);
    let w = 0;
    for (const tok of words) {
      const cleanTok = tok.replace(/[^a-záéíóúâêôãõàüç0-9%$]/gi, '');
      if (!cleanTok) continue;
      let numSyl = 0;
      const digits = cleanTok.match(/\d+/g);
      if (digits) {
        for (const d of digits) {
          numSyl += d.length === 1 ? 2.1 : d.length === 2 ? 4.2 : d.length * 2.3;
        }
      }
      const alpha = cleanTok.replace(/\d+/g, '');
      const vowels = (alpha.match(/[aeiouáéíóúâêôãõàü]+/gi) || []).length;
      const alphaSyl = alpha.length > 0 ? Math.max(1, vowels) : 0;
      w += Math.max(0.8, (numSyl + alphaSyl) * 1.15 + 0.34 + alpha.length * 0.035);
    }
    return Math.max(0.3, w);
  };

  for (let i = 0; i < parts.length; i += 2) {
    const segText = (parts[i] || '').trim();
    const punct = parts[i + 1] || '';
    if (!segText) continue;
    const fullClause = `${segText}${punct.trim()}`;
    const pause = /[.!?…]/.test(punct) ? 0.36 : /[;:—–]/.test(punct) ? 0.22 : punct.includes(',') ? 0.14 : 0.06;
    segments.push({
      text: fullClause,
      weight: estimateWeight(segText),
      pauseAfter: pause,
    });
  }

  if (segments.length === 0) return '';
  segments[segments.length - 1].pauseAfter = 0;

  const totalW = Math.max(0.01, segments.reduce((acc, s) => acc + s.weight, 0));
  const totalP = segments.reduce((acc, s) => acc + s.pauseAfter, 0);
  const pauseScale = totalP > 0 ? Math.min(durationSeconds * 0.3, totalP) / totalP : 0;
  const speakSpan = Math.max(0.2, durationSeconds - totalP * pauseScale);

  const formatSrtTime = (seconds: number) => {
    const clamped = Math.max(0, seconds);
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    const s = Math.floor(clamped % 60);
    const ms = Math.floor((clamped % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };

  let cursor = 0;
  let srtContent = '';

  segments.forEach((seg, idx) => {
    const isLast = idx === segments.length - 1;
    const dur = (seg.weight / totalW) * speakSpan;
    const pause = isLast ? 0 : seg.pauseAfter * pauseScale;
    const startTime = cursor;
    const endTime = isLast ? durationSeconds : Math.min(durationSeconds, startTime + dur);
    cursor = Math.min(durationSeconds, endTime + pause);

    srtContent += `${idx + 1}\n`;
    srtContent += `${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n`;
    srtContent += `${seg.text}\n\n`;
  });

  return srtContent.trim();
}

