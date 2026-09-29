/**
 * Background Music presets and audio mixing utility for VideoVozLivre.
 * Provides high-quality synthesized ambient instrumental loops (zero external network lag)
 * and seamless audio mixing using Web Audio API.
 */

export interface BackgroundMusicTrack {
  id: string;
  name: string;
  category: string;
  description: string;
  bpm: number;
}

export type SceneSfxType = 'none' | 'flash_cut' | 'whoosh' | 'impact' | 'suspense' | 'typewriter';

export interface SceneSfxPreset {
  id: SceneSfxType;
  name: string;
  description: string;
}

export const SCENE_SFX_PRESETS: SceneSfxPreset[] = [
  {
    id: 'flash_cut',
    name: '📸 Flash de Corte (Câmera + Flash)',
    description: 'Som de disparo de flash fotográfico nítido a cada corte de cena com transição luminosa.',
  },
  {
    id: 'whoosh',
    name: '💨 Whoosh Cinematográfico',
    description: 'Passagem de ar suave estilo edição dinâmica CapCut entre as cenas.',
  },
  {
    id: 'impact',
    name: '💥 Impacto Grave (Boom)',
    description: 'Sub-grave cinematográfico profundo na virada de cena.',
  },
  {
    id: 'suspense',
    name: '🎻 Pulso de Suspense',
    description: 'Acorde de tensão sutil nas transições para histórias de mistério.',
  },
  {
    id: 'typewriter',
    name: '⌨️ Clique Documentário',
    description: 'Toque mecânico de arquivo/máquina de escrever na troca de imagem.',
  },
  {
    id: 'none',
    name: '🔇 Sem Efeito no Corte',
    description: 'Transição silenciosa entre as cenas.',
  },
];

export const BG_MUSIC_PRESETS: BackgroundMusicTrack[] = [
  {
    id: 'news',
    name: 'Telejornal & Breaking News',
    category: 'Jornalismo / Urgente',
    description: 'Batida rítmica e moderna estilo telejornal de alta credibilidade.',
    bpm: 100,
  },
  {
    id: 'cinematic',
    name: 'Cinemático & Documentário',
    category: 'Cinema / Documentário',
    description: 'Harmonia profunda e imersiva para narrativas impactantes.',
    bpm: 68,
  },
  {
    id: 'lofi',
    name: 'Lo-Fi Chill & Podcast',
    category: 'Podcast / Relaxante',
    description: 'Batida calma com acordes aveludados, ideal para podcasts e conversas.',
    bpm: 72,
  },
  {
    id: 'acoustic',
    name: 'Acústico & Violão',
    category: 'Histórias / Reflexão',
    description: 'Arpejos acolhedores e quentes, perfeitos para histórias e reflexões.',
    bpm: 80,
  },
  {
    id: 'piano',
    name: 'Piano Inspirador',
    category: 'Vídeos / Didático',
    description: 'Piano sutil e moderno para conteúdos explicativos e motivacionais.',
    bpm: 76,
  },
  {
    id: 'ambient',
    name: 'Ambiente Calmo & Zen',
    category: 'Meditação / Narrativa',
    description: 'Sons atmosféricos suaves para manter a voz em destaque absoluto.',
    bpm: 60,
  },
];

// In-memory cache for synthesized preset audio blobs
const presetBlobCache = new Map<string, { blob: Blob; url: string; buffer: AudioBuffer }>();

/**
 * Synthesizes an ambient musical loop in Web Audio API.
 * 16-bar harmonic progression with smooth envelope and low-pass filtering.
 */
export async function getPresetMusicBuffer(presetId: string): Promise<{ blob: Blob; url: string; buffer: AudioBuffer }> {
  if (presetBlobCache.has(presetId)) {
    return presetBlobCache.get(presetId)!;
  }

  const sampleRate = 44100;
  const duration = 16; // 16 seconds loop
  const totalSamples = sampleRate * duration;
  const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  // Master bus
  const masterGain = offlineCtx.createGain();
  masterGain.gain.value = 0.75;
  masterGain.connect(offlineCtx.destination);

  // Warm filter
  const filter = offlineCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = presetId === 'ambient' ? 1200 : presetId === 'lofi' ? 2200 : 3500;
  filter.Q.value = 1.0;
  filter.connect(masterGain);

  // Harmonic chord progressions (frequencies in Hz)
  let chords: number[][] = [];
  if (presetId === 'news') {
    // Modern dramatic rhythmic chords (C minor / Ab / Bb / G)
    chords = [
      [130.81, 155.56, 196.0, 261.63], // Cm
      [103.83, 155.56, 207.65, 261.63], // Ab
      [116.54, 174.61, 233.08, 293.66], // Bb
      [98.0, 146.83, 196.0, 246.94], // G
    ];
  } else if (presetId === 'cinematic') {
    // Deep orchestral progression (Am -> F -> C -> Em)
    chords = [
      [110.0, 164.81, 220.0, 261.63, 329.63], // Am
      [87.31, 130.81, 174.61, 220.0, 261.63], // F
      [130.81, 164.81, 196.0, 261.63, 329.63], // C
      [82.41, 123.47, 164.81, 196.0, 246.94], // Em
    ];
  } else if (presetId === 'lofi') {
    // Dm9 -> G13 -> Cmaj9 -> Am9
    chords = [
      [146.83, 220.0, 261.63, 329.63, 392.0], // Dm9
      [196.0, 246.94, 293.66, 329.63, 440.0], // G13
      [130.81, 196.0, 246.94, 293.66, 392.0], // Cmaj9
      [110.0, 164.81, 220.0, 261.63, 329.63], // Am9
    ];
  } else if (presetId === 'acoustic') {
    // G -> D/F# -> Em7 -> Cadd9
    chords = [
      [196.0, 246.94, 293.66, 392.0, 493.88], // G
      [185.0, 220.0, 293.66, 369.99, 440.0],  // D/F#
      [164.81, 246.94, 293.66, 329.63, 392.0], // Em7
      [130.81, 196.0, 261.63, 293.66, 392.0], // Cadd9
    ];
  } else if (presetId === 'piano') {
    // Fmaj7 -> G -> Em7 -> Am7
    chords = [
      [174.61, 220.0, 261.63, 329.63], // Fmaj7
      [196.0, 246.94, 293.66, 392.0],  // G
      [164.81, 196.0, 246.94, 329.63], // Em7
      [220.0, 261.63, 329.63, 392.0],  // Am7
    ];
  } else {
    // Ambient peaceful pads
    chords = [
      [130.81, 196.0, 261.63, 329.63, 392.0],
      [146.83, 220.0, 293.66, 369.99, 440.0],
      [164.81, 246.94, 329.63, 392.0, 493.88],
      [130.81, 164.81, 196.0, 261.63, 329.63],
    ];
  }

  const chordDuration = duration / chords.length;

  chords.forEach((chord, chordIdx) => {
    const chordStart = chordIdx * chordDuration;

    chord.forEach((freq, noteIdx) => {
      const osc = offlineCtx.createOscillator();
      const noteGain = offlineCtx.createGain();

      osc.type = presetId === 'lofi' ? 'triangle' : presetId === 'ambient' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, chordStart);

      // Gentle strum / arpeggio offset
      const noteStart = chordStart + noteIdx * 0.08;
      const noteEnd = chordStart + chordDuration;

      // Soft envelope
      noteGain.gain.setValueAtTime(0.0001, noteStart);
      noteGain.gain.exponentialRampToValueAtTime(0.08 / Math.sqrt(chord.length), noteStart + 0.4);
      noteGain.gain.exponentialRampToValueAtTime(0.04 / Math.sqrt(chord.length), noteStart + chordDuration * 0.7);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, noteEnd - 0.05);

      osc.connect(noteGain);
      noteGain.connect(filter);

      osc.start(noteStart);
      osc.stop(noteEnd);
    });
  });

  // Soft low-end bass foundation
  chords.forEach((chord, chordIdx) => {
    const rootFreq = chord[0] / 2;
    const chordStart = chordIdx * chordDuration;
    const bassOsc = offlineCtx.createOscillator();
    const bassGain = offlineCtx.createGain();

    bassOsc.type = 'sine';
    bassOsc.frequency.setValueAtTime(rootFreq, chordStart);

    bassGain.gain.setValueAtTime(0.0001, chordStart);
    bassGain.gain.linearRampToValueAtTime(0.12, chordStart + 0.3);
    bassGain.gain.linearRampToValueAtTime(0.08, chordStart + chordDuration - 0.2);
    bassGain.gain.linearRampToValueAtTime(0.0001, chordStart + chordDuration);

    bassOsc.connect(bassGain);
    bassGain.connect(filter);

    bassOsc.start(chordStart);
    bassOsc.stop(chordStart + chordDuration);
  });

  const renderedBuffer = await offlineCtx.startRendering();

  // Convert renderedBuffer to WAV Blob
  const wavBlob = audioBufferToWavBlob(renderedBuffer);
  const url = URL.createObjectURL(wavBlob);

  const result = { blob: wavBlob, url, buffer: renderedBuffer };
  presetBlobCache.set(presetId, result);
  return result;
}

const sfxBufferCache = new Map<SceneSfxType, AudioBuffer>();

/**
 * Synthesizes crisp procedural SFX AudioBuffers (including camera flash cut, whoosh, impact, suspense, typewriter)
 */
export async function synthesizeSfxBuffer(sfxType: SceneSfxType): Promise<AudioBuffer | null> {
  if (!sfxType || sfxType === 'none') return null;
  if (sfxBufferCache.has(sfxType)) {
    return sfxBufferCache.get(sfxType)!;
  }

  const sampleRate = 44100;
  const duration = sfxType === 'impact' || sfxType === 'suspense' ? 0.75 : 0.42;
  const totalSamples = Math.ceil(sampleRate * duration);
  const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  // Create white noise buffer for transient/air components
  const noiseBuf = offlineCtx.createBuffer(2, totalSamples, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = noiseBuf.getChannelData(ch);
    for (let i = 0; i < totalSamples; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  if (sfxType === 'flash_cut') {
    // 1. First mechanical shutter click (t = 0.00s)
    const clickNoise1 = offlineCtx.createBufferSource();
    clickNoise1.buffer = noiseBuf;
    const bp1 = offlineCtx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.setValueAtTime(3400, 0);
    bp1.Q.setValueAtTime(2.5, 0);
    const gain1 = offlineCtx.createGain();
    gain1.gain.setValueAtTime(0.95, 0);
    gain1.gain.exponentialRampToValueAtTime(0.001, 0.025);
    clickNoise1.connect(bp1);
    bp1.connect(gain1);
    gain1.connect(offlineCtx.destination);
    clickNoise1.start(0);
    clickNoise1.stop(0.03);

    // 2. Second shutter curtain snap (t = 0.036s)
    const clickNoise2 = offlineCtx.createBufferSource();
    clickNoise2.buffer = noiseBuf;
    const bp2 = offlineCtx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.setValueAtTime(4600, 0.036);
    bp2.Q.setValueAtTime(3.0, 0.036);
    const gain2 = offlineCtx.createGain();
    gain2.gain.setValueAtTime(0.001, 0);
    gain2.gain.setValueAtTime(0.85, 0.036);
    gain2.gain.exponentialRampToValueAtTime(0.001, 0.065);
    clickNoise2.connect(bp2);
    bp2.connect(gain2);
    gain2.connect(offlineCtx.destination);
    clickNoise2.start(0);
    clickNoise2.stop(0.07);

    // 3. Flash xenon burst & airy shimmer tail
    const flashOsc = offlineCtx.createOscillator();
    flashOsc.type = 'triangle';
    flashOsc.frequency.setValueAtTime(2600, 0.012);
    flashOsc.frequency.exponentialRampToValueAtTime(280, 0.24);
    const flashOscGain = offlineCtx.createGain();
    flashOscGain.gain.setValueAtTime(0.001, 0);
    flashOscGain.gain.setValueAtTime(0.45, 0.012);
    flashOscGain.gain.exponentialRampToValueAtTime(0.0001, 0.26);
    flashOsc.connect(flashOscGain);
    flashOscGain.connect(offlineCtx.destination);
    flashOsc.start(0.012);
    flashOsc.stop(0.27);

    const flashAir = offlineCtx.createBufferSource();
    flashAir.buffer = noiseBuf;
    const hp = offlineCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1800, 0.02);
    const airGain = offlineCtx.createGain();
    airGain.gain.setValueAtTime(0.001, 0);
    airGain.gain.linearRampToValueAtTime(0.32, 0.028);
    airGain.gain.exponentialRampToValueAtTime(0.0001, 0.35);
    flashAir.connect(hp);
    hp.connect(airGain);
    airGain.connect(offlineCtx.destination);
    flashAir.start(0.015);
    flashAir.stop(0.36);
  } else if (sfxType === 'whoosh') {
    const whooshNoise = offlineCtx.createBufferSource();
    whooshNoise.buffer = noiseBuf;
    const bp = offlineCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(1.8, 0);
    bp.frequency.setValueAtTime(220, 0);
    bp.frequency.exponentialRampToValueAtTime(1600, 0.18);
    bp.frequency.exponentialRampToValueAtTime(180, 0.38);

    const wGain = offlineCtx.createGain();
    wGain.gain.setValueAtTime(0.001, 0);
    wGain.gain.linearRampToValueAtTime(0.75, 0.16);
    wGain.gain.exponentialRampToValueAtTime(0.0001, 0.39);

    whooshNoise.connect(bp);
    bp.connect(wGain);
    wGain.connect(offlineCtx.destination);
    whooshNoise.start(0);
    whooshNoise.stop(0.4);
  } else if (sfxType === 'impact') {
    const subOsc = offlineCtx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(145, 0);
    subOsc.frequency.exponentialRampToValueAtTime(34, 0.65);

    const subGain = offlineCtx.createGain();
    subGain.gain.setValueAtTime(0.9, 0);
    subGain.gain.exponentialRampToValueAtTime(0.0001, 0.7);
    subOsc.connect(subGain);
    subGain.connect(offlineCtx.destination);
    subOsc.start(0);
    subOsc.stop(0.72);

    const thumpNoise = offlineCtx.createBufferSource();
    thumpNoise.buffer = noiseBuf;
    const lp = offlineCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, 0);
    const tGain = offlineCtx.createGain();
    tGain.gain.setValueAtTime(0.5, 0);
    tGain.gain.exponentialRampToValueAtTime(0.001, 0.18);
    thumpNoise.connect(lp);
    lp.connect(tGain);
    tGain.connect(offlineCtx.destination);
    thumpNoise.start(0);
    thumpNoise.stop(0.2);
  } else if (sfxType === 'suspense') {
    const freqs = [220, 233.08, 440, 466.16];
    freqs.forEach((f) => {
      const osc = offlineCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, 0);
      const lp = offlineCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(400, 0);
      lp.frequency.exponentialRampToValueAtTime(2200, 0.35);
      lp.frequency.exponentialRampToValueAtTime(350, 0.7);
      const g = offlineCtx.createGain();
      g.gain.setValueAtTime(0.001, 0);
      g.gain.linearRampToValueAtTime(0.16, 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, 0.72);
      osc.connect(lp);
      lp.connect(g);
      g.connect(offlineCtx.destination);
      osc.start(0);
      osc.stop(0.73);
    });
  } else if (sfxType === 'typewriter') {
    [0, 0.075].forEach((offset, idx) => {
      const n = offlineCtx.createBufferSource();
      n.buffer = noiseBuf;
      const bp = offlineCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(idx === 0 ? 2900 : 3800, offset);
      bp.Q.setValueAtTime(3.2, offset);
      const g = offlineCtx.createGain();
      g.gain.setValueAtTime(0.001, 0);
      g.gain.setValueAtTime(0.8, offset);
      g.gain.exponentialRampToValueAtTime(0.001, offset + 0.022);
      n.connect(bp);
      bp.connect(g);
      g.connect(offlineCtx.destination);
      n.start(offset);
      n.stop(offset + 0.025);
    });
  }

  const rendered = await offlineCtx.startRendering();
  sfxBufferCache.set(sfxType, rendered);
  return rendered;
}

/**
 * Plays a live preview of the selected scene transition SFX
 */
export async function playSfxPreview(sfxType: SceneSfxType, volume: number = 0.6): Promise<void> {
  if (!sfxType || sfxType === 'none') return;
  const buf = await synthesizeSfxBuffer(sfxType);
  if (!buf) return;
  const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (actx.state === 'suspended') await actx.resume().catch(() => {});
  const src = actx.createBufferSource();
  src.buffer = buf;
  const g = actx.createGain();
  g.gain.value = Math.max(0.05, Math.min(1.0, volume));
  src.connect(g);
  g.connect(actx.destination);
  src.onended = () => actx.close().catch(() => {});
  src.start(0);
}

/**
 * Concatenates multiple AudioBuffers sequentially (used for Multi-Voice narration & dialogue segments)
 */
export async function concatenateAudioBuffers(
  buffers: AudioBuffer[],
  pauseBetweenSec: number = 0.14
): Promise<AudioBuffer> {
  const valid = buffers.filter((b) => b && b.length > 0);
  if (valid.length === 0) {
    const emptyCtx = new OfflineAudioContext(2, 4410, 44100);
    return emptyCtx.startRendering();
  }
  if (valid.length === 1) return valid[0];

  const sampleRate = 44100;
  const totalDuration =
    valid.reduce((acc, b) => acc + b.duration, 0) + Math.max(0, valid.length - 1) * pauseBetweenSec;
  const totalSamples = Math.max(1, Math.ceil(totalDuration * sampleRate));
  const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  let cursor = 0;
  for (let i = 0; i < valid.length; i++) {
    const src = offlineCtx.createBufferSource();
    src.buffer = valid[i];
    src.connect(offlineCtx.destination);
    src.start(cursor);
    cursor += valid[i].duration + pauseBetweenSec;
  }

  return offlineCtx.startRendering();
}

export interface MixAudioOptions {
  autoDucking?: boolean;
  sfxType?: SceneSfxType;
  sfxVolume?: number;
  sfxTimestamps?: number[];
}

/**
 * Mixes speech AudioBuffer with background music AudioBuffer + optional Auto-Ducking and Scene Transition SFX.
 * - Speech is preserved at 100% volume.
 * - With `autoDucking`, background music automatically ducks when the narrator speaks and swells during pauses.
 * - With `sfxType` and `sfxTimestamps`, scene transition sound effects (e.g., Flash Cut) are mixed at exact scene cuts.
 */
export async function mixSpeechWithBackgroundMusic(
  speechBuffer: AudioBuffer,
  musicBuffer: AudioBuffer | null,
  musicVolume: number,
  targetDuration?: number,
  options?: MixAudioOptions
): Promise<AudioBuffer> {
  const finalDuration = targetDuration || speechBuffer.duration;
  const sampleRate = 44100;
  const totalSamples = Math.ceil(finalDuration * sampleRate);
  const hasMusic = Boolean(musicBuffer && musicVolume > 0.01);
  const hasSfx = Boolean(
    options?.sfxType &&
      options.sfxType !== 'none' &&
      options.sfxTimestamps &&
      options.sfxTimestamps.length > 0 &&
      (options.sfxVolume ?? 0.5) > 0.01
  );

  if (!hasMusic && !hasSfx) {
    if (speechBuffer.sampleRate === sampleRate && Math.abs(speechBuffer.duration - finalDuration) < 0.05) {
      return speechBuffer;
    }
    const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = speechBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    return offlineCtx.startRendering();
  }

  const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  // 1. Speech track (Primary, 100% gain)
  const speechSource = offlineCtx.createBufferSource();
  speechSource.buffer = speechBuffer;
  const speechGain = offlineCtx.createGain();
  speechGain.gain.value = 1.0;
  speechSource.connect(speechGain);
  speechGain.connect(offlineCtx.destination);
  speechSource.start(0);

  // 2. Background music track (Looped, with optional Intelligent Auto-Ducking envelope)
  if (hasMusic && musicBuffer) {
    const musicSource = offlineCtx.createBufferSource();
    musicSource.buffer = musicBuffer;
    musicSource.loop = true;
    const musicGain = offlineCtx.createGain();
    const baseVol = Math.max(0, Math.min(1.0, musicVolume));

    if (options?.autoDucking !== false) {
      // Analyze speech RMS in 80ms windows to duck music during active speech and swell during pauses
      const chData = speechBuffer.getChannelData(0);
      const spRate = speechBuffer.sampleRate || 44100;
      const winSec = 0.08;
      const winSamples = Math.max(1, Math.floor(spRate * winSec));
      const numWindows = Math.ceil(chData.length / winSamples);

      const duckedVol = baseVol * 0.42;
      const swellVol = Math.min(1.0, baseVol * 1.35);

      musicGain.gain.setValueAtTime(baseVol, 0);
      let currentTarget = baseVol;

      for (let w = 0; w < numWindows; w++) {
        const startIdx = w * winSamples;
        const endIdx = Math.min(chData.length, startIdx + winSamples);
        let sumSq = 0;
        for (let i = startIdx; i < endIdx; i += 4) {
          const v = chData[i];
          sumSq += v * v;
        }
        const count = Math.max(1, Math.ceil((endIdx - startIdx) / 4));
        const rms = Math.sqrt(sumSq / count);
        const tSec = Math.min(finalDuration, (w + 1) * winSec);
        const target = rms > 0.016 ? duckedVol : swellVol;
        // Smooth interpolation
        currentTarget = currentTarget * 0.65 + target * 0.35;
        musicGain.gain.linearRampToValueAtTime(currentTarget, tSec);
      }
    } else {
      musicGain.gain.value = baseVol;
    }

    musicSource.connect(musicGain);
    musicGain.connect(offlineCtx.destination);
    musicSource.start(0);
  }

  // 3. Scene Transition SFX (e.g., Flash Cut, Whoosh, Impact) at exact scene cut timestamps
  if (hasSfx && options?.sfxType && options.sfxTimestamps) {
    const sfxBuf = await synthesizeSfxBuffer(options.sfxType);
    if (sfxBuf) {
      const sfxVol = Math.max(0.05, Math.min(1.0, options.sfxVolume ?? 0.55));
      for (const ts of options.sfxTimestamps) {
        const startAt = Math.max(0, Math.min(finalDuration - 0.05, ts - 0.03));
        const sfxSource = offlineCtx.createBufferSource();
        sfxSource.buffer = sfxBuf;
        const sfxGain = offlineCtx.createGain();
        sfxGain.gain.value = sfxVol;
        sfxSource.connect(sfxGain);
        sfxGain.connect(offlineCtx.destination);
        sfxSource.start(startAt);
      }
    }
  }

  return offlineCtx.startRendering();
}

/**
 * Convert an AudioBuffer to a WAV format Blob
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const totalSamples = buffer.length;
  const byteRate = sampleRate * blockAlign;
  const dataSize = totalSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const dataView = new DataView(arrayBuffer);

  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      dataView.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF Chunk
  writeString(0, 'RIFF');
  dataView.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  dataView.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  dataView.setUint16(20, format, true);
  dataView.setUint16(22, numChannels, true);
  dataView.setUint32(24, sampleRate, true);
  dataView.setUint32(28, byteRate, true);
  dataView.setUint16(32, blockAlign, true);
  dataView.setUint16(34, bitDepth, true);

  // data sub-chunk
  writeString(36, 'data');
  dataView.setUint32(40, dataSize, true);

  // Interleave channel data
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < totalSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = channels[ch][i];
      // Clamp sample to [-1, 1]
      sample = Math.max(-1, Math.min(1, sample));
      // Scale to 16-bit signed integer
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      dataView.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Loads and decodes an AudioBuffer for any music track (preset or custom uploaded Blob)
 */
export async function getAnyMusicAudioBuffer(
  trackId: string,
  customBlob?: Blob | null
): Promise<AudioBuffer | null> {
  if (trackId === 'custom' && customBlob) {
    const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (actx.state === 'suspended') await actx.resume().catch(() => {});
    try {
      const arr = await customBlob.arrayBuffer();
      const decoded = await actx.decodeAudioData(arr.slice(0));
      return decoded;
    } catch (err) {
      console.warn('Erro ao decodificar áudio customizado:', err);
      return null;
    } finally {
      actx.close().catch(() => {});
    }
  }

  try {
    const preset = await getPresetMusicBuffer(trackId);
    return preset.buffer;
  } catch (err) {
    console.warn('Erro ao obter preset musical:', err);
    return null;
  }
}
