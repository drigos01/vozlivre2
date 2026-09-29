import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Download,
  Volume2,
  Video,
  Image as ImageIcon,
  Check,
  AlertCircle,
  Loader2,
  Share2,
  Sliders,
  Layers,
  Clock,
  ExternalLink,
  ChevronRight,
  Maximize2,
  Edit3,
  FileText,
  VolumeX,
  Volume1,
  Radio,
  ArrowRight,
  Eye,
  RefreshCw,
  Film,
  Subtitles,
  CheckCircle2,
  BookOpen,
  Search,
  Upload,
  Plus,
  Trash2,
  X,
  Palette,
  ShieldCheck,
  Zap,
  Music,
  Activity,
  Bookmark,
} from 'lucide-react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  Voice,
  VideoAspectRatio,
  NarrativeScene,
  NarrativeStoryProject,
  GeneratedAudio,
  AudioTask,
  VideoTask,
} from '../types';
import { CURATED_VOICES } from '../constants/voices';
import { formatTime, downloadBlob, decodeAudioBlobOnce, getSharedAudioContext } from '../utils/audio';
import { QuickMediaReviewModal, ReviewableSceneMedia } from './QuickMediaReviewModal';
import {
  BG_MUSIC_PRESETS,
  SCENE_SFX_PRESETS,
  SceneSfxType,
  getPresetMusicBuffer,
  mixSpeechWithBackgroundMusic,
  audioBufferToWavBlob,
  getAnyMusicAudioBuffer,
  playSfxPreview,
  concatenateAudioBuffers,
} from '../utils/backgroundMusic';
import {
  saveCustomBgMusicToDB,
  getCustomBgMusicFromDB,
  deleteCustomBgMusicFromDB,
  StoredCreativeProject,
  saveCreativeProjectToDB,
  getAllCreativeProjectsFromDB,
  deleteCreativeProjectFromDB,
} from '../utils/db';
import {
  StudioPreferences,
  loadStudioPreferences,
  saveStudioPreferences,
  resolveVoice,
  StudioMotionEffect,
  StudioColorFilter,
  StudioWaveformStyle,
  StudioWaveformColor,
} from '../utils/studioPreferences';
import { StudioTaskQueue, StudioQueueItem } from './StudioTaskQueue';
import { StudioEffectsAndMusicPanel } from './StudioEffectsAndMusicPanel';
import {
  SerializedEncodedChunk,
  VideoRenderCheckpoint,
  serializeEncodedChunk,
  replayCheckpointToMuxer,
  saveRenderCheckpoint,
  getRenderCheckpoint,
  getRenderCheckpointSync,
  getLatestRenderCheckpoint,
  deleteRenderCheckpoint,
  saveActiveVideoSessionState,
  clearActiveVideoSessionState,
} from '../utils/safeguard';

/**
 * Cleans caption text: strictly removes any "Cena X:" prefix and all quotation marks
 * Per user instruction: "A legenda está mostrando 'cena 1: legenda' não quero essa contagem de cena só a legenda e sem """
 */
/**
 * Cleans caption text: strictly removes any "Cena X:" prefix, counter, and all quotation marks
 * Ex.: "Cena 1: O mistério começou" -> "O mistério começou"
 */
export function cleanCaptionText(text?: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/\[\s*https?:\/\/[^\s\]]+?\s*\]/gi, ' ');
  cleaned = cleaned.replace(/https?:\/\/[^\s)\]]+/gi, ' ');
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/\[\s*(?:voz|narrador|sfx|pausa)[^\]]*\]/gi, ' ');
  cleaned = cleaned.replace(/^[\s(\[{]*(cena|scene|parte|bloco|take|segmento|capítulo|capitulo)\s*#?\s*\d+\s*(?:de|\/)?\s*\d*[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^[\s(\[{]*(legenda|caption|subtítulo|subtitulo|narração|narracao|texto)[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^\s*\d+\s*[:.)\-–—]+\s*/g, '');
  cleaned = cleaned.replace(/["'“”«»`]/g, '');
  cleaned = cleaned.replace(/^[\s(\[{]*(cena|scene|parte|bloco|take|segmento|capítulo|capitulo)\s*#?\s*\d+\s*(?:de|\/)?\s*\d*[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^[\s:.-]+/, '').replace(/[\s:.-]+$/, '');
  return cleaned.replace(/\s+/g, ' ').trim();
}

interface RoteiroCriativoVideoStudioProps {
  onTransferToVoice: (text: string, title?: string) => void;
  onTransferToVideo?: (audio: GeneratedAudio) => void;
  initialVoice?: Voice | null;
  onAddAudioTask?: (task: AudioTask) => void;
  onUpdateAudioTask?: (id: string, updates: Partial<AudioTask>) => void;
  onAddVideoTask?: (task: VideoTask) => void;
  onUpdateVideoTask?: (id: string, updates: Partial<VideoTask>) => void;
  onOpenTaskManager?: () => void;
  resumeTaskId?: string | null;
  onResumeHandled?: () => void;
}

export interface SubtitleWordTiming {
  word: string;
  startTime: number;
  endTime: number;
}

export interface SubtitlePhrase {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  speechEndTime?: number;
  wordTimings?: SubtitleWordTiming[];
}

const PRESET_STORY_PROMPTS = [
  {
    title: 'O Relojoeiro de Praga',
    category: 'Mistério & Tempo',
    text: '[https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1280&q=80] Na velha oficina coberta de poeira e engrenagens de latão, mestre Klaus encontrou um relógio de bolso que não marcava as horas.\n\n[https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1280&q=80] Quando a corda era girada no sentido anti-horário, a chuva que caía lá fora desacelerava no ar, suspensa em gotas brilhantes.\n\n[https://images.unsplash.com/photo-1495364141860-b0d03eccd065?w=1280&q=80] Ele logo compreendeu que o tempo não era um rio reto, mas um novelo que podia ser gentilmente desfiado.',
  },
  {
    title: 'A Última Biblioteca da Terra',
    category: 'Ficção Científica',
    text: '[https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1280&q=80] A três mil metros sob a superfície desértica, a guardiã Lyra acendia a última lâmpada de tungstênio do arquivo mundial.\n\n[https://images.unsplash.com/photo-1507842229450-79887b4092d0?w=1280&q=80] Entre prateleiras infinitas de papel envelhecido, repousava a memória de uma civilização que esqueceu como olhar para as estrelas.\n\n[https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1280&q=80] Ao folhear o diário de bordo da primeira viagem lunar, ouviu um sinal de rádio vindo de cima: a humanidade estava voltando para casa.',
  },
  {
    title: 'O Farol do Fim do Mundo',
    category: 'Conto Poético',
    text: '[https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1280&q=80] No penhasco mais solitário do continente, o farol de pedra cortava a névoa densa do Atlântico Norte.\n\n[https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=1280&q=80] O velho guarda não iluminava apenas o caminho dos navios cargueiros, mas contava histórias às gaivotas sobre cidades submersas.\n\n[https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1280&q=80] Toda noite de tempestade, o mar devolvia uma concha dourada com um novo verso.',
  },
  {
    title: 'A Floresta que Lembrava',
    category: 'Fantasia & Natureza',
    text: '[https://images.unsplash.com/photo-1448375240586-882707db888b?w=1280&q=80] Diziam que os cedros milenares da serra guardavam as memórias de todos os que caminhavam entre suas raízes.\n\n[https://images.unsplash.com/photo-1511497584788-87676104235f?w=1280&q=80] Quando uma criança perdida tocou a casca úmida de musgo, as folhas sussurraram o caminho de volta na voz suave de sua avó.\n\n[https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=1280&q=80] Naquela floresta, ninguém estava verdadeiramente sozinho enquanto houvesse vento nos galhos.',
  },
];

const PRESET_PREMISES = [
  {
    genre: 'Mistério & Suspense',
    premise: 'Um fotógrafo revela fotos antigas de uma vila abandonada e percebe uma figura que se aproxima da câmera a cada negativo sucessivo.',
    tone: 'Sombrio & Enigmático',
  },
  {
    genre: 'Ficção Científica',
    premise: 'Uma astronauta solitária em uma estação orbital descobre que as transmissões de rádio que ela recebe vêm da Terra de duzentos anos no futuro.',
    tone: 'Cinematográfico & Reflexivo',
  },
  {
    genre: 'Fábula & Sabedoria',
    premise: 'Um velho tecelão ensina ao imperador que o tecido mais resistente do mundo é costurado com paciência e silêncio.',
    tone: 'Acolhedor & Poético',
  },
  {
    genre: 'Aventura & Fantasia',
    premise: 'Uma expedição descobre um templo esquecido no coração da Amazônia onde as constelações são refletidas em piscinas de mercúrio puro.',
    tone: 'Épico & Misterioso',
  },
];

const STORY_GENRES = [
  'Conto de Mistério & Suspense',
  'Ficção Científica & Espaço',
  'Fábula & Reflexão Filosófica',
  'História Épica & Aventura',
  'Conto Infantil & Fantasia',
  'Drama Humano & Emoção',
  'Crônica Cotidiana & Poesia',
  'Terror & Sobrenatural',
];

const STORY_TONES = [
  'Cinematográfico & Envolvente',
  'Poético & Reflexivo',
  'Enigmático & Tenso',
  'Acolhedor & Sereno',
  'Sombrio & Dramático',
  'Épico & Triunfante',
];

/**
 * Estimates spoken phonetic duration weight for Portuguese/Latin text based on syllable (vowel cluster) count,
 * spoken number expansion (digits take multiple syllables when spoken by TTS), nasal diphthongs, and word onset.
 */
export function estimatePhoneticWeight(text: string): number {
  const clean = text.trim();
  if (!clean) return 0.1;

  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0.1;

  let totalWeight = 0;
  for (const rawToken of tokens) {
    const token = rawToken.replace(/[.,!?;:—–()[\]"'“”«»]/g, '');
    if (!token) continue;

    // Account for numbers spoken aloud in Portuguese by TTS (e.g. "2024" -> "dois mil e vinte e quatro" ~ 9 syllables)
    const digitMatches = token.match(/\d+/g);
    let numberSyllables = 0;
    if (digitMatches) {
      for (const d of digitMatches) {
        const len = d.length;
        if (len === 1) numberSyllables += 2.1;
        else if (len === 2) numberSyllables += 4.2;
        else if (len === 3) numberSyllables += 6.4;
        else if (len === 4) numberSyllables += 9.2;
        else numberSyllables += len * 2.3;
      }
    }

    let symbolSyllables = 0;
    if (rawToken.includes('%')) symbolSyllables += 3.0; // "por cento"
    if (/r\$|\$|€|£/i.test(rawToken)) symbolSyllables += 2.4; // "reais" / "dólares"

    const alphaPart = token.replace(/\d+/g, '');
    const vowelClusters = (alphaPart.match(/[aeiouáéíóúâêôãõàü]+/gi) || []).length;
    const nasalBonus = (alphaPart.match(/[ãõ]|ão|ões|ães|[aeiou][mn](?![aeiou])/gi) || []).length * 0.18;
    const alphaSyllables = alphaPart.length > 0 ? Math.max(1, vowelClusters) + nasalBonus : 0;

    const wordSyllables = numberSyllables + symbolSyllables + alphaSyllables;
    // Base articulation onset per word (+0.34) + syllable weight + slight character duration
    totalWeight += Math.max(0.8, wordSyllables * 1.15 + 0.34 + alphaPart.length * 0.035);
  }

  return Math.max(0.2, totalWeight);
}

/**
 * Natural pause duration (in seconds) inserted by neural TTS at punctuation marks.
 */
function getPunctuationPauseSeconds(punct: string): number {
  if (!punct) return 0;
  if (punct.includes('\n')) return 0.46;
  if (/[.!?…]/.test(punct)) return 0.38;
  if (/[;:—–]/.test(punct)) return 0.24;
  if (punct.includes(',')) return 0.15;
  return 0.06;
}

/**
 * Splits a clause into balanced 2-4 word phrases so there are no jarring 1-word flashes.
 */
function splitClauseIntoBalancedPhrases(clauseText: string, trailingPunct: string): string[] {
  const words = clauseText.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[][] = [];
  if (words.length <= 3) {
    chunks.push(words);
  } else if (words.length === 4) {
    if (clauseText.length <= 22) {
      chunks.push(words);
    } else {
      chunks.push(words.slice(0, 2), words.slice(2, 4));
    }
  } else {
    let i = 0;
    while (i < words.length) {
      const remaining = words.length - i;
      if (remaining === 4) {
        chunks.push(words.slice(i, i + 2), words.slice(i + 2, i + 4));
        break;
      } else if (remaining <= 3) {
        chunks.push(words.slice(i));
        break;
      } else {
        chunks.push(words.slice(i, i + 3));
        i += 3;
      }
    }
  }

  const result: string[] = [];
  for (let c = 0; c < chunks.length; c++) {
    const isLast = c === chunks.length - 1;
    const attachPunct = isLast && trailingPunct && !['.', '\n'].includes(trailingPunct.trim())
      ? trailingPunct.trim().slice(0, 1)
      : '';
    const sanitized = cleanCaptionText(chunks[c].join(' ') + attachPunct);
    if (sanitized) {
      result.push(sanitized);
    }
  }
  return result;
}

interface ClauseDescriptor {
  sceneIndex: number;
  phrases: string[];
  phraseWeights: number[];
  phraseWordWeights: number[][];
  phraseWords: string[][];
  totalWeight: number;
  pauseAfterSec: number;
}

/**
 * Builds acoustically synchronized subtitle phrases (for both CapCut word-by-word and Normal full-phrase modes)
 * and scene time windows.
 * Uses the decoded pure-voice AudioBuffer (when available) to detect exact speech start/end,
 * syllable energy distribution, and real TTS breath pauses at punctuation marks, eliminating cumulative drift.
 */
export function buildSynchronizedNarrativeTimeline(
  narration: string,
  sceneList: NarrativeScene[],
  totalDuration: number,
  speechBuffer?: AudioBuffer | null
): {
  subtitles: SubtitlePhrase[];
  sceneWindows: Array<{ start: number; end: number }>;
} {
  if (totalDuration <= 0) {
    return { subtitles: [], sceneWindows: [] };
  }

  const sanitizeSegmentForSync = (raw: string): string =>
    (raw || '')
      .replace(/\[\s*https?:\/\/[^\s\]]+?\s*\]/gi, ' ')
      .replace(/https?:\/\/[^\s)\]]+/gi, ' ')
      .replace(/\[\s*(?:voz|narrador|sfx)\s*:[^\]]*\]/gi, ' ')
      .replace(/\[pausa.*?\]/gi, '. ')
      .replace(/[ \t]+/g, ' ')
      .trim();

  const cleanedFullNarration = cleanCaptionText(sanitizeSegmentForSync(narration || ''));
  const joinedSceneNarration = (sceneList || [])
    .map((sc) => cleanCaptionText(sanitizeSegmentForSync(sc.narrationSegment || '')))
    .filter(Boolean)
    .join(' ');

  // If user edited fullNarration directly so it differs from sceneList segments, align to the actual spoken narration
  let effectiveScenes: Array<{ narrationSegment: string }> = [];
  if (sceneList && sceneList.length > 0) {
    const lenDiff = Math.abs(cleanedFullNarration.length - joinedSceneNarration.length);
    if (
      cleanedFullNarration.length > 0 &&
      lenDiff > Math.max(25, joinedSceneNarration.length * 0.18)
    ) {
      // Split edited narration proportionally across the existing scene count so subtitles match the spoken audio 100%
      const sentences = sanitizeSegmentForSync(narration)
        .split(/(?<=[.!?…\n])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const nScenes = sceneList.length;
      if (sentences.length >= nScenes) {
        effectiveScenes = Array.from({ length: nScenes }, (_, idx) => {
          const sStart = Math.floor((idx * sentences.length) / nScenes);
          const sEnd = Math.floor(((idx + 1) * sentences.length) / nScenes);
          return { narrationSegment: sentences.slice(sStart, Math.max(sStart + 1, sEnd)).join(' ') };
        });
      } else {
        effectiveScenes = [{ narrationSegment: narration }];
      }
    } else {
      effectiveScenes = sceneList;
    }
  } else if (narration) {
    effectiveScenes = [{ narrationSegment: narration }];
  }

  const clauses: ClauseDescriptor[] = [];

  effectiveScenes.forEach((sc, sIdx) => {
    const rawSeg = sanitizeSegmentForSync(sc.narrationSegment || '');
    const cleanedSeg = cleanCaptionText(rawSeg);
    if (!cleanedSeg) return;

    const parts = cleanedSeg.split(/([.,!?;:—–\n]+)/);
    for (let i = 0; i < parts.length; i += 2) {
      const cText = (parts[i] || '').trim();
      const punct = parts[i + 1] || '';
      if (!cText) continue;

      const isLastInScene = i + 2 >= parts.length;
      const effectivePunct = isLastInScene && !punct.includes('\n') ? `${punct}\n` : punct;
      const phrases = splitClauseIntoBalancedPhrases(cText, punct);
      if (phrases.length === 0) continue;

      const phraseWords = phrases.map((p) => p.split(/\s+/).filter(Boolean));
      const phraseWordWeights = phraseWords.map((wList) =>
        wList.map((w) => estimatePhoneticWeight(w))
      );
      const phraseWeights = phraseWordWeights.map((wWeights) =>
        Math.max(0.2, wWeights.reduce((a, b) => a + b, 0))
      );
      const totalWeight = phraseWeights.reduce((a, b) => a + b, 0);
      const pauseAfterSec = getPunctuationPauseSeconds(effectivePunct);

      clauses.push({
        sceneIndex: sIdx,
        phrases,
        phraseWeights,
        phraseWordWeights,
        phraseWords,
        totalWeight,
        pauseAfterSec,
      });
    }
  });

  if (clauses.length === 0) {
    const fallbackWin = effectiveScenes.map((_, idx) => ({
      start: (idx / Math.max(1, effectiveScenes.length)) * totalDuration,
      end: ((idx + 1) / Math.max(1, effectiveScenes.length)) * totalDuration,
    }));
    return { subtitles: [], sceneWindows: fallbackWin };
  }

  // Last clause doesn't need an inter-clause pause after it
  clauses[clauses.length - 1].pauseAfterSec = 0;

  // Analyze pure TTS speech AudioBuffer if available for exact voice bounds, syllable energy & silence gap snapping
  const dt = 0.01; // 10ms frame resolution
  let voiceStartSec = Math.min(0.12, totalDuration * 0.02);
  let voiceEndSec = Math.max(voiceStartSec + 0.2, totalDuration - Math.min(0.2, totalDuration * 0.03));
  let silenceGaps: Array<{
    start: number;
    end: number;
    dur: number;
    center: number;
    voicedBefore: number;
    voicedFraction: number;
  }> = [];
  let voicedCum: Float32Array | null = null;
  let totalVoicedUnits = 0;

  if (speechBuffer && speechBuffer.length > 0 && speechBuffer.sampleRate > 0) {
    try {
      const sr = speechBuffer.sampleRate;
      const ch0 = speechBuffer.getChannelData(0);
      const samplesPerFrame = Math.max(1, Math.floor(sr * dt));
      const numFrames = Math.floor(ch0.length / samplesPerFrame);

      if (numFrames > 10) {
        const rawRms = new Float32Array(numFrames);
        let peakRms = 0;
        for (let f = 0; f < numFrames; f++) {
          const offset = f * samplesPerFrame;
          let sumSq = 0;
          for (let s = 0; s < samplesPerFrame; s++) {
            const v = ch0[offset + s];
            sumSq += v * v;
          }
          const r = Math.sqrt(sumSq / samplesPerFrame);
          rawRms[f] = r;
          if (r > peakRms) peakRms = r;
        }

        // 30ms smoothing
        const smoothRms = new Float32Array(numFrames);
        const isSpeaking = new Uint8Array(numFrames);
        const thresh = Math.max(0.003, peakRms * 0.036);
        let voicedRmsSum = 0;
        let voicedFrameCount = 0;

        for (let f = 0; f < numFrames; f++) {
          const prev = f > 0 ? rawRms[f - 1] : rawRms[f];
          const next = f < numFrames - 1 ? rawRms[f + 1] : rawRms[f];
          const smooth = (prev + rawRms[f] * 2 + next) / 4;
          smoothRms[f] = smooth;
          if (smooth >= thresh) {
            isSpeaking[f] = 1;
            voicedRmsSum += smooth;
            voicedFrameCount++;
          }
        }

        const meanVoicedRms = voicedFrameCount > 0 ? voicedRmsSum / voicedFrameCount : Math.max(0.01, peakRms * 0.3);

        // Bridge short plosive consonant dips <= 70ms (7 frames) so stop consonants (/p/, /t/, /k/) stay inside words
        let gapRun = 0;
        for (let f = 0; f < numFrames; f++) {
          if (isSpeaking[f] === 0) {
            gapRun++;
          } else {
            if (gapRun > 0 && gapRun <= 7 && f - gapRun > 0) {
              for (let k = f - gapRun; k < f; k++) isSpeaking[k] = 1;
            }
            gapRun = 0;
          }
        }

        let firstFrame = 0;
        while (firstFrame < numFrames && isSpeaking[firstFrame] === 0) firstFrame++;
        let lastFrame = numFrames - 1;
        while (lastFrame > firstFrame && isSpeaking[lastFrame] === 0) lastFrame--;

        if (lastFrame > firstFrame + 5) {
          voiceStartSec = Math.max(0, firstFrame * dt - 0.01);
          voiceEndSec = Math.min(totalDuration, (lastFrame + 1) * dt + 0.015);

          // Build syllable-energy-aware cumulative speech curve
          voicedCum = new Float32Array(numFrames + 1);
          let acc = 0;
          for (let f = 0; f < numFrames; f++) {
            voicedCum[f] = acc;
            if (f >= firstFrame && f <= lastFrame && isSpeaking[f] === 1) {
              const energyWeight = 0.78 + 0.22 * Math.min(1.4, smoothRms[f] / Math.max(1e-4, meanVoicedRms));
              acc += dt * energyWeight;
            }
          }
          voicedCum[numFrames] = acc;
          totalVoicedUnits = acc;

          // Collect real prosodic silence pauses >= 80ms inside [firstFrame, lastFrame]
          let f = firstFrame;
          while (f <= lastFrame) {
            if (isSpeaking[f] === 0) {
              const gStart = f;
              while (f <= lastFrame && isSpeaking[f] === 0) f++;
              const gEnd = f;
              const gDur = (gEnd - gStart) * dt;
              if (gDur >= 0.08) {
                const startSec = gStart * dt;
                const endSec = gEnd * dt;
                const vBefore = voicedCum[gStart];
                silenceGaps.push({
                  start: startSec,
                  end: endSec,
                  dur: gDur,
                  center: (startSec + endSec) / 2,
                  voicedBefore: vBefore,
                  voicedFraction: totalVoicedUnits > 0 ? vBefore / totalVoicedUnits : 0,
                });
              }
            } else {
              f++;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Acoustic speech analysis fallback:', e);
    }
  }

  const totalSpokenWeight = Math.max(0.01, clauses.reduce((acc, c) => acc + c.totalWeight, 0));
  const totalPauseWeight = clauses.reduce((acc, c) => acc + c.pauseAfterSec, 0);

  // Compute expected wall-clock & voiced-fraction targets for every clause (used both for anchor verification and fallback)
  const activeSpan = Math.max(0.5, voiceEndSec - voiceStartSec);
  const measuredSilenceSum = silenceGaps.reduce((acc, g) => acc + g.dur, 0);
  const targetTotalPauseSec =
    voicedCum && totalVoicedUnits > 0.3
      ? Math.min(activeSpan * 0.42, Math.max(measuredSilenceSum, Math.min(totalPauseWeight, activeSpan * 0.28)))
      : Math.min(activeSpan * 0.34, totalPauseWeight);
  const pauseScale = totalPauseWeight > 0.01 ? targetTotalPauseSec / totalPauseWeight : 0;
  const effectiveSpeakSpan = Math.max(0.25, activeSpan - totalPauseWeight * pauseScale);

  const expectedClauseStart: number[] = [];
  const expectedClauseEnd: number[] = [];
  const expectedClauseVoicedEndFrac: number[] = [];
  let expCursor = voiceStartSec;
  let cumSpokenW = 0;

  for (let c = 0; c < clauses.length; c++) {
    const cl = clauses[c];
    const isLast = c === clauses.length - 1;
    const speakDur = (cl.totalWeight / totalSpokenWeight) * effectiveSpeakSpan;
    const pauseDur = isLast ? 0 : cl.pauseAfterSec * pauseScale;
    const cStart = expCursor;
    const cEnd = isLast ? voiceEndSec : Math.min(voiceEndSec, cStart + speakDur);
    expectedClauseStart.push(cStart);
    expectedClauseEnd.push(cEnd);
    cumSpokenW += cl.totalWeight;
    expectedClauseVoicedEndFrac.push(cumSpokenW / totalSpokenWeight);
    expCursor = Math.min(voiceEndSec, cEnd + pauseDur);
  }

  const subtitles: SubtitlePhrase[] = [];
  const clauseWindows: Array<{ start: number; end: number }> = new Array(clauses.length);
  let globalPhraseIdx = 0;

  if (voicedCum && totalVoicedUnits > 0.3) {
    const numFrames = voicedCum.length - 1;

    const voicedToStartTime = (vTarget: number): number => {
      if (vTarget <= 0) return voiceStartSec;
      if (vTarget >= totalVoicedUnits) return voiceEndSec;
      let lo = 0;
      let hi = numFrames;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (voicedCum![mid] <= vTarget + 1e-4) lo = mid + 1;
        else hi = mid;
      }
      return Math.min(voiceEndSec, Math.max(voiceStartSec, (lo - 1) * dt));
    };

    const voicedToEndTime = (vTarget: number): number => {
      if (vTarget <= 0) return voiceStartSec;
      if (vTarget >= totalVoicedUnits) return voiceEndSec;
      let lo = 0;
      let hi = numFrames;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (voicedCum![mid] < vTarget - 1e-4) lo = mid + 1;
        else hi = mid;
      }
      return Math.min(voiceEndSec, Math.max(voiceStartSec, lo * dt));
    };

    // Step 1: Anchor clauses with punctuation pauses to real acoustic silence gaps
    // while strictly enforcing realistic speech rate ratios so no clause ever snaps to a wrong gap
    const anchoredGapForClause = new Int32Array(clauses.length).fill(-1);
    let lastAnchoredClause = -1;
    let lastAnchoredGap = -1;

    for (let c = 0; c < clauses.length - 1; c++) {
      const cl = clauses[c];
      if (cl.pauseAfterSec < 0.1) continue;

      const expFrac = expectedClauseVoicedEndFrac[c];
      const expWall = expectedClauseEnd[c];
      const prevExpFrac = lastAnchoredClause >= 0 ? expectedClauseVoicedEndFrac[lastAnchoredClause] : 0;
      const prevGapFrac = lastAnchoredGap >= 0 ? silenceGaps[lastAnchoredGap].voicedFraction : 0;
      const deltaExpFrac = Math.max(0.005, expFrac - prevExpFrac);

      const maxFracTol = cl.pauseAfterSec >= 0.35 ? 0.085 : 0.06;
      const maxWallTol = cl.pauseAfterSec >= 0.35 ? 0.75 : 0.5;

      let bestGapIdx = -1;
      let bestScore = Infinity;

      for (let g = lastAnchoredGap + 1; g < silenceGaps.length; g++) {
        const gap = silenceGaps[g];
        const deltaGapFrac = gap.voicedFraction - prevGapFrac;
        if (deltaGapFrac <= deltaExpFrac * 0.55) continue;
        if (deltaGapFrac > deltaExpFrac * 1.65 && deltaExpFrac > 0.03) break;
        if (1 - gap.voicedFraction < (1 - expFrac) * 0.45) continue;

        const fracDiff = Math.abs(gap.voicedFraction - expFrac);
        const wallDiff = Math.abs(gap.start - expWall);

        if (fracDiff <= maxFracTol || wallDiff <= maxWallTol) {
          // Prefer gaps whose duration matches the expected punctuation pause and whose position matches expected voiced fraction
          const durBonus = Math.min(0.25, gap.dur) * 0.15;
          const score = fracDiff * 2.5 + (wallDiff / Math.max(1, activeSpan)) - durBonus;
          if (score < bestScore) {
            bestScore = score;
            bestGapIdx = g;
          }
        }
      }

      if (bestGapIdx >= 0) {
        anchoredGapForClause[c] = bestGapIdx;
        lastAnchoredClause = c;
        lastAnchoredGap = bestGapIdx;
      }
    }

    // Step 2: Process spans between anchored clauses and compute exact voiced targets for every clause, phrase, and word
    const clauseVoicedStart = new Float32Array(clauses.length);
    const clauseVoicedEnd = new Float32Array(clauses.length);

    let spanStartClause = 0;
    while (spanStartClause < clauses.length) {
      let spanEndClause = spanStartClause;
      while (
        spanEndClause < clauses.length - 1 &&
        anchoredGapForClause[spanEndClause] < 0
      ) {
        spanEndClause++;
      }

      const vSpanStart =
        spanStartClause === 0
          ? 0
          : clauseVoicedEnd[spanStartClause - 1];
      const anchorGapIdx = anchoredGapForClause[spanEndClause];
      const vSpanEnd =
        anchorGapIdx >= 0
          ? silenceGaps[anchorGapIdx].voicedBefore
          : totalVoicedUnits;

      let spanWeight = 0;
      for (let k = spanStartClause; k <= spanEndClause; k++) {
        spanWeight += clauses[k].totalWeight;
      }
      spanWeight = Math.max(0.01, spanWeight);

      let vCursor = vSpanStart;
      for (let k = spanStartClause; k <= spanEndClause; k++) {
        const isSpanLast = k === spanEndClause;
        const wShare = clauses[k].totalWeight / spanWeight;
        let vEnd = isSpanLast ? vSpanEnd : vCursor + (vSpanEnd - vSpanStart) * wShare;

        // If an un-anchored clause boundary falls very close to a real micro-pause, snap to it cleanly
        if (!isSpanLast && silenceGaps.length > 0) {
          const tol = Math.min(0.14 * (totalVoicedUnits / Math.max(1, activeSpan)), (vEnd - vCursor) * 0.4);
          for (let g = 0; g < silenceGaps.length; g++) {
            const gv = silenceGaps[g].voicedBefore;
            if (gv > vCursor + (vEnd - vCursor) * 0.5 && gv < vSpanEnd - 0.05 && Math.abs(gv - vEnd) <= tol) {
              vEnd = gv;
              break;
            }
          }
        }

        clauseVoicedStart[k] = vCursor;
        clauseVoicedEnd[k] = vEnd;
        vCursor = vEnd;
      }

      spanStartClause = spanEndClause + 1;
    }

    // Step 3: Map each clause and each phrase/word directly through voicedCum so silence pauses never skew phrase or word timing
    for (let c = 0; c < clauses.length; c++) {
      const cl = clauses[c];
      const isLastClause = c === clauses.length - 1;
      const cVStart = clauseVoicedStart[c];
      const cVEnd = clauseVoicedEnd[c];
      const cVSpan = Math.max(0.01, cVEnd - cVStart);

      const cStart = c === 0 ? voiceStartSec : voicedToStartTime(cVStart);
      const cEnd = isLastClause
        ? voiceEndSec
        : anchoredGapForClause[c] >= 0
        ? silenceGaps[anchoredGapForClause[c]].start
        : Math.max(cStart + 0.08, voicedToEndTime(cVEnd));

      clauseWindows[c] = { start: cStart, end: Math.max(cStart + 0.08, cEnd) };

      let pVCursor = cVStart;
      for (let p = 0; p < cl.phrases.length; p++) {
        const isLastInClause = p === cl.phrases.length - 1;
        const pWeightRatio = cl.phraseWeights[p] / Math.max(0.01, cl.totalWeight);
        let pVEnd = isLastInClause ? cVEnd : pVCursor + cVSpan * pWeightRatio;

        // Snap intermediate phrase boundary to a local breath pause if one occurred right between these phrases
        if (!isLastInClause && silenceGaps.length > 0) {
          const pVTol = Math.min(0.11 * (totalVoicedUnits / Math.max(1, activeSpan)), (pVEnd - pVCursor) * 0.38);
          for (let g = 0; g < silenceGaps.length; g++) {
            const gv = silenceGaps[g].voicedBefore;
            if (gv > pVCursor + (pVEnd - pVCursor) * 0.55 && gv < cVEnd - 0.04 && Math.abs(gv - pVEnd) <= pVTol) {
              pVEnd = gv;
              break;
            }
          }
        }

        const pStart =
          c === 0 && p === 0
            ? voiceStartSec
            : voicedToStartTime(pVCursor);
        const pSpeechEnd =
          isLastClause && isLastInClause
            ? voiceEndSec
            : isLastInClause && anchoredGapForClause[c] >= 0
            ? silenceGaps[anchoredGapForClause[c]].start
            : Math.max(pStart + 0.06, voicedToEndTime(pVEnd));

        // Compute exact per-word acoustic timings inside this phrase
        const words = cl.phraseWords[p];
        const wordWeights = cl.phraseWordWeights[p];
        const totalPhraseWordW = Math.max(0.01, wordWeights.reduce((a, b) => a + b, 0));
        const wordTimings: SubtitleWordTiming[] = [];
        const pVoicedSpan = Math.max(0.005, pVEnd - pVCursor);

        let wVCursor = pVCursor;
        let prevWordEnd = pStart;
        for (let wIdx = 0; wIdx < words.length; wIdx++) {
          const isLastWord = wIdx === words.length - 1;
          const wRatio = wordWeights[wIdx] / totalPhraseWordW;
          const wVEnd = isLastWord ? pVEnd : wVCursor + pVoicedSpan * wRatio;
          const wStart = wIdx === 0 ? pStart : Math.max(prevWordEnd, voicedToStartTime(wVCursor));
          const wEnd = isLastWord
            ? pSpeechEnd
            : Math.min(pSpeechEnd, Math.max(wStart + 0.03, voicedToEndTime(wVEnd)));
          wordTimings.push({
            word: words[wIdx],
            startTime: wStart,
            endTime: Math.max(wStart + 0.02, wEnd),
          });
          wVCursor = wVEnd;
          prevWordEnd = Math.max(wStart + 0.02, wEnd);
        }

        subtitles.push({
          id: `narrative-sub-${globalPhraseIdx++}`,
          text: cl.phrases[p],
          startTime: pStart,
          endTime: Math.max(pStart + 0.06, pSpeechEnd),
          speechEndTime: Math.max(pStart + 0.06, pSpeechEnd),
          wordTimings,
        });

        pVCursor = pVEnd;
      }
    }

    // Ensure strictly monotonic non-overlapping subtitle bounds with tight transition across short micro-pauses
    for (let i = 0; i < subtitles.length; i++) {
      const cur = subtitles[i];
      const next = i < subtitles.length - 1 ? subtitles[i + 1] : null;
      if (next) {
        if (next.startTime < cur.startTime + 0.05) {
          next.startTime = cur.startTime + 0.05;
        }
        const gapToNext = next.startTime - cur.endTime;
        if (gapToNext > 0 && gapToNext <= 0.09) {
          // Bridge imperceptible micro-gaps <= 90ms so Normal/CapCut box doesn't blink between adjacent words
          cur.endTime = next.startTime;
        } else if (gapToNext > 0.09) {
          // For real breath pauses, hold at most 40ms after speech ends so subtitle cleanly respects the pause
          cur.endTime = Math.min(next.startTime - 0.015, (cur.speechEndTime ?? cur.endTime) + 0.04);
        } else if (cur.endTime > next.startTime) {
          cur.endTime = next.startTime;
          cur.speechEndTime = Math.min(cur.speechEndTime ?? cur.endTime, cur.endTime);
        }
      }
    }
  } else {
    // Fallback when AudioBuffer is unavailable: phonetic syllable + punctuation pause model
    for (let c = 0; c < clauses.length; c++) {
      const cl = clauses[c];
      const cStart = expectedClauseStart[c];
      const cEnd = expectedClauseEnd[c];
      clauseWindows[c] = { start: cStart, end: Math.max(cStart + 0.1, cEnd) };

      const clauseSpeakSpan = Math.max(0.1, cEnd - cStart);
      let pCursor = cStart;

      for (let p = 0; p < cl.phrases.length; p++) {
        const isLastInClause = p === cl.phrases.length - 1;
        const wRatio = cl.phraseWeights[p] / Math.max(0.01, cl.totalWeight);
        const pDur = clauseSpeakSpan * wRatio;
        const pStart = pCursor;
        const pSpeechEnd = isLastInClause ? cEnd : pStart + pDur;
        const nextClauseStart = c < clauses.length - 1 ? expectedClauseStart[c + 1] : totalDuration;
        const pEnd =
          isLastInClause && nextClauseStart > pSpeechEnd
            ? Math.min(nextClauseStart - 0.015, pSpeechEnd + 0.04)
            : pSpeechEnd;

        const words = cl.phraseWords[p];
        const wordWeights = cl.phraseWordWeights[p];
        const totalPhraseWordW = Math.max(0.01, wordWeights.reduce((a, b) => a + b, 0));
        const wordTimings: SubtitleWordTiming[] = [];
        let wCursor = pStart;
        const pSpan = Math.max(0.05, pSpeechEnd - pStart);

        for (let wIdx = 0; wIdx < words.length; wIdx++) {
          const isLastWord = wIdx === words.length - 1;
          const wwRatio = wordWeights[wIdx] / totalPhraseWordW;
          const wEnd = isLastWord ? pSpeechEnd : wCursor + pSpan * wwRatio;
          wordTimings.push({
            word: words[wIdx],
            startTime: wCursor,
            endTime: Math.max(wCursor + 0.02, wEnd),
          });
          wCursor = wEnd;
        }

        subtitles.push({
          id: `narrative-sub-${globalPhraseIdx++}`,
          text: cl.phrases[p],
          startTime: pStart,
          endTime: Math.max(pStart + 0.06, pEnd),
          speechEndTime: Math.max(pStart + 0.06, pSpeechEnd),
          wordTimings,
        });

        pCursor = pSpeechEnd;
      }
    }
  }

  // Compute sceneWindows aligned with each scene's clauses
  const sceneWindows: Array<{ start: number; end: number }> = [];
  const numScenes = effectiveScenes.length;
  const hasMissingClauseScene = effectiveScenes.some(
    (_, sIdx) => !clauses.some((c) => c.sceneIndex === sIdx)
  );

  if (hasMissingClauseScene) {
    // Proportional time distribution when one or more scenes have no separate clause text
    const weights = effectiveScenes.map((sc) =>
      Math.max(25, (sc.narrationSegment || '').trim().length)
    );
    const totalW = weights.reduce((a, b) => a + b, 0);
    let cursor = 0;
    for (let s = 0; s < numScenes; s++) {
      const dur = (weights[s] / Math.max(1, totalW)) * totalDuration;
      const start = cursor;
      const end = s === numScenes - 1 ? totalDuration : start + dur;
      sceneWindows.push({ start, end });
      cursor = end;
    }
  } else {
    for (let s = 0; s < numScenes; s++) {
      const firstClauseIdx = clauses.findIndex((c) => c.sceneIndex === s);
      let lastClauseIdx = -1;
      for (let k = clauses.length - 1; k >= 0; k--) {
        if (clauses[k].sceneIndex === s) {
          lastClauseIdx = k;
          break;
        }
      }

      if (firstClauseIdx >= 0 && lastClauseIdx >= 0) {
        const sStart = s === 0 ? 0 : clauseWindows[firstClauseIdx].start;
        const sEnd =
          s === numScenes - 1
            ? totalDuration
            : lastClauseIdx + 1 < clauseWindows.length
            ? clauseWindows[lastClauseIdx + 1].start
            : clauseWindows[lastClauseIdx].end;
        sceneWindows.push({ start: sStart, end: Math.max(sStart + 0.2, sEnd) });
      } else {
        const prevEnd = s > 0 ? sceneWindows[s - 1].end : 0;
        const fallbackEnd = ((s + 1) / numScenes) * totalDuration;
        sceneWindows.push({ start: prevEnd, end: Math.max(prevEnd + 0.2, fallbackEnd) });
      }
    }

    // Ensure contiguous coverage from 0 to totalDuration for scene windows
    if (sceneWindows.length > 0) {
      sceneWindows[0].start = 0;
      for (let s = 0; s < sceneWindows.length - 1; s++) {
        const boundary = sceneWindows[s + 1].start;
        sceneWindows[s].end = boundary;
      }
      sceneWindows[sceneWindows.length - 1].end = totalDuration;
    }
  }

  return { subtitles, sceneWindows };
}

/**
 * Splits narration into rhythmic dynamic subtitles
 */
export function buildNarrativeSubtitles(
  narration: string,
  totalDuration: number,
  speechBuffer?: AudioBuffer | null,
  sceneList?: NarrativeScene[]
): SubtitlePhrase[] {
  return buildSynchronizedNarrativeTimeline(narration, sceneList || [], totalDuration, speechBuffer).subtitles;
}

const backdropLayerCache = new Map<string, HTMLCanvasElement>();

/**
 * Draws cinematic backdrop based on visual theme (cached per resolution & theme for zero per-frame gradient overhead)
 */
function drawCinematicBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: 'cinematica' | 'fantasia' | 'misterio' | 'acolhedor' | 'documentario'
) {
  const key = `${w}x${h}:${theme}`;
  let cached = backdropLayerCache.get(key);
  if (!cached) {
    cached = document.createElement('canvas');
    cached.width = w;
    cached.height = h;
    const cCtx = cached.getContext('2d');
    if (cCtx) {
      const grad = cCtx.createRadialGradient(w / 2, h * 0.45, 10, w / 2, h * 0.5, Math.max(w, h));
      if (theme === 'fantasia') {
        grad.addColorStop(0, '#1c1033');
        grad.addColorStop(0.5, '#0d071a');
        grad.addColorStop(1, '#040208');
      } else if (theme === 'misterio') {
        grad.addColorStop(0, '#062227');
        grad.addColorStop(0.5, '#031215');
        grad.addColorStop(1, '#010507');
      } else if (theme === 'acolhedor') {
        grad.addColorStop(0, '#27170a');
        grad.addColorStop(0.5, '#130a04');
        grad.addColorStop(1, '#050201');
      } else if (theme === 'documentario') {
        grad.addColorStop(0, '#141416');
        grad.addColorStop(0.5, '#0a0a0c');
        grad.addColorStop(1, '#020202');
      } else {
        grad.addColorStop(0, '#1c1917');
        grad.addColorStop(0.5, '#0c0a09');
        grad.addColorStop(1, '#020202');
      }

      cCtx.fillStyle = grad;
      cCtx.fillRect(0, 0, w, h);

      cCtx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
      cCtx.lineWidth = 1;
      const step = 40;
      for (let y = 0; y < h; y += step) {
        cCtx.beginPath();
        cCtx.moveTo(0, y);
        cCtx.lineTo(w, y);
        cCtx.stroke();
      }
    }
    if (backdropLayerCache.size > 16) {
      const firstKey = backdropLayerCache.keys().next().value;
      if (firstKey) backdropLayerCache.delete(firstKey);
    }
    backdropLayerCache.set(key, cached);
  }
  ctx.drawImage(cached, 0, 0, w, h);
}

interface CachedSubtitleLayout {
  fontSize: number;
  textToDraw: string;
  textWidth: number;
  words: string[];
  wordWidths: number[];
  spaceWidth: number;
  fullLineW: number;
}
const subtitleLayoutCache = new Map<string, CachedSubtitleLayout>();

/**
 * Draws CapCut dynamic phrase subtitle for narrative
 */
function drawNarrativeSubtitle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  phraseText: string,
  aspectRatio: VideoAspectRatio,
  subtitleStyle: 'capcut_yellow' | 'classic_white' | 'cinematic_serif',
  subtitlePosition: 'bottom' | 'center' | 'top' = 'bottom',
  wordByWordHighlight: boolean = true,
  phraseProgress: number = 0,
  frameTime?: number,
  wordTimings?: SubtitleWordTiming[]
) {
  if (!phraseText) return;

  const cleanedPhrase = cleanCaptionText(phraseText);
  if (!cleanedPhrase) return;

  const isVertical = aspectRatio === '9:16';
  ctx.save();

  const applyFont = (size: number) => {
    if (subtitleStyle === 'cinematic_serif') {
      ctx.font = `600 ${size}px Georgia, serif`;
    } else {
      ctx.font = `900 ${size}px system-ui, -apple-system, sans-serif`;
    }
  };

  const cacheKey = `${w}x${h}:${aspectRatio}:${subtitleStyle}:${cleanedPhrase}`;
  let layout = subtitleLayoutCache.get(cacheKey);
  if (!layout) {
    let fSize = isVertical ? Math.round(w * 0.052) : Math.round(h * 0.046);
    applyFont(fSize);
    const tDraw = subtitleStyle === 'cinematic_serif' ? cleanedPhrase : cleanedPhrase.toUpperCase();
    let tWidth = ctx.measureText(tDraw).width;
    const maxTextWidth = w * 0.82;
    if (tWidth > maxTextWidth && tWidth > 0) {
      fSize = Math.max(16, Math.floor(fSize * (maxTextWidth / tWidth)));
      applyFont(fSize);
      tWidth = ctx.measureText(tDraw).width;
    }
    const wds = tDraw.split(/\s+/).filter(Boolean);
    const spW = ctx.measureText(' ').width;
    const wdWidths = wds.map((wd) => ctx.measureText(wd).width);
    const flW = wdWidths.reduce((a, b) => a + b, 0) + Math.max(0, wds.length - 1) * spW;
    layout = {
      fontSize: fSize,
      textToDraw: tDraw,
      textWidth: tWidth,
      words: wds,
      wordWidths: wdWidths,
      spaceWidth: spW,
      fullLineW: flW,
    };
    if (subtitleLayoutCache.size > 300) {
      const oldest = subtitleLayoutCache.keys().next().value;
      if (oldest) subtitleLayoutCache.delete(oldest);
    }
    subtitleLayoutCache.set(cacheKey, layout);
  }

  const { fontSize, textToDraw, textWidth, words, wordWidths, spaceWidth, fullLineW } = layout;
  applyFont(fontSize);
  ctx.textBaseline = 'middle';

  let centerY = isVertical ? h * 0.72 : h * 0.78;
  if (subtitlePosition === 'top') {
    centerY = isVertical ? h * 0.16 : h * 0.14;
  } else if (subtitlePosition === 'center') {
    centerY = h * 0.52;
  }

  const padX = Math.round(fontSize * 0.7);
  const padY = Math.round(fontSize * 0.4);
  const pillW = Math.min(w * 0.94, textWidth + padX * 2);
  const pillH = fontSize + padY * 2;
  const pillX = (w - pillW) / 2;
  const pillY = centerY - pillH / 2;

  // Background pill
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pillX, pillY, pillW, pillH, Math.round(pillH * 0.28));
  } else {
    ctx.rect(pillX, pillY, pillW, pillH);
  }
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (wordByWordHighlight && words.length > 1) {
    let activeWordIdx = 0;

    if (typeof frameTime === 'number' && wordTimings && wordTimings.length === words.length) {
      activeWordIdx = wordTimings.length - 1;
      for (let i = 0; i < wordTimings.length; i++) {
        if (frameTime < wordTimings[i].endTime) {
          activeWordIdx = i;
          break;
        }
      }
    } else {
      // Phonetic-weighted word-by-word highlight fallback
      const clampedProg = Math.max(0, Math.min(0.999, phraseProgress));
      const weights = words.map((wd) => estimatePhoneticWeight(wd));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const targetWeight = clampedProg * totalWeight;

      let accumW = 0;
      for (let i = 0; i < words.length; i++) {
        if (targetWeight < accumW + weights[i]) {
          activeWordIdx = i;
          break;
        }
        accumW += weights[i];
        activeWordIdx = i;
      }
    }

    let cursorX = (w - fullLineW) / 2;

    ctx.textAlign = 'left';
    for (let i = 0; i < words.length; i++) {
      const wd = words[i];
      const wW = wordWidths[i];
      const isSpokenNow = i === activeWordIdx;

      if (isSpokenNow) {
        // Highlight badge behind active word
        const hlPadX = Math.max(4, Math.round(fontSize * 0.18));
        const hlPadY = Math.max(3, Math.round(fontSize * 0.14));
        ctx.save();
        ctx.fillStyle = subtitleStyle === 'capcut_yellow' ? '#facc15' : '#22d3ee';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(cursorX - hlPadX, centerY - fontSize / 2 - hlPadY, wW + hlPadX * 2, fontSize + hlPadY * 2, 6);
        } else {
          ctx.rect(cursorX - hlPadX, centerY - fontSize / 2 - hlPadY, wW + hlPadX * 2, fontSize + hlPadY * 2);
        }
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#09090b';
        ctx.fillText(wd, cursorX, centerY);
      } else {
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.15));
        ctx.strokeStyle = '#000000';
        ctx.strokeText(wd, cursorX, centerY);

        ctx.fillStyle = i < activeWordIdx
          ? (subtitleStyle === 'capcut_yellow' ? '#fde047' : '#e2e8f0')
          : '#ffffff';
        ctx.fillText(wd, cursorX, centerY);
      }

      cursorX += wW + spaceWidth;
    }
  } else {
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.15));
    ctx.strokeStyle = '#000000';
    ctx.strokeText(textToDraw, w / 2, centerY);

    if (subtitleStyle === 'capcut_yellow') {
      ctx.fillStyle = '#facc15';
    } else if (subtitleStyle === 'cinematic_serif') {
      ctx.fillStyle = '#f5f5f4';
    } else {
      ctx.fillStyle = '#ffffff';
    }
    ctx.fillText(textToDraw, w / 2, centerY);
  }

  ctx.restore();
}

/**
 * Returns exact canvas width and height for each video aspect ratio
 */
export function getVideoDimensions(aspectRatio: VideoAspectRatio): { width: number; height: number } {
  switch (aspectRatio) {
    case '9:16':
      return { width: 720, height: 1280 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '4:5':
      return { width: 864, height: 1080 };
    case '21:9':
      return { width: 1280, height: 548 };
    case '16:9':
    default:
      return { width: 1280, height: 720 };
  }
}

/**
 * Draws animated audio waveform overlay matching VideoVozLivre
 */
function drawWaveformOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  style: 'bars' | 'line',
  color: 'white' | 'emerald' | 'cyan' | 'violet' | 'amber'
) {
  let colorHex = '#ffffff';
  if (color === 'emerald') colorHex = '#10b981';
  else if (color === 'cyan') colorHex = '#06b6d4';
  else if (color === 'violet') colorHex = '#8b5cf6';
  else if (color === 'amber') colorHex = '#f59e0b';

  const centerY = h * 0.78;
  const barCount = 36;
  const totalWidth = w * 0.72;
  const startX = (w - totalWidth) / 2;
  const barWidth = (totalWidth / barCount) * 0.65;
  const gap = totalWidth / barCount;

  if (style === 'bars') {
    ctx.fillStyle = colorHex;
    for (let i = 0; i < barCount; i++) {
      const amp = 0.18 + Math.abs(Math.sin(time * 5 + i * 0.38)) * 0.62;
      const barHeight = Math.max(6, amp * (h * 0.11));
      const x = startX + i * gap;
      const y = centerY - barHeight / 2;

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, barWidth, barHeight, 3);
      } else {
        ctx.rect(x, y, barWidth, barHeight);
      }
      ctx.fill();
    }
  } else if (style === 'line') {
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 3;
    ctx.beginPath();

    for (let i = 0; i < barCount; i++) {
      const amp = 0.2 + Math.sin(time * 5 + i * 0.45) * 0.5;
      const x = startX + i * gap;
      const y = centerY + Math.sin(i * 0.5) * (amp * 28);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export interface MediaDrawable {
  source: CanvasImageSource;
  width: number;
  height: number;
  url: string;
}

export interface NarrativeProductionJob {
  id: string;
  storyTitle: string;
  storyTextSnippet: string;
  createdAt: number;
  completedAt?: number;
  status: 'scripting' | 'synthesizing' | 'rendering' | 'ready' | 'error';
  progress: number;
  statusMessage: string;
  errorMessage?: string;
  aspectRatio: VideoAspectRatio;
  voiceName: string;
  duration?: number;
  renderedVideoBlob?: Blob;
  renderedVideoUrl?: string;
  renderedVideoFilename?: string;
  audioBlob?: Blob;
  audioUrl?: string;
  scenes?: NarrativeScene[];
}

const STORAGE_KEY_CREATIVE_CONFIG = 'vozlivre_creative_studio_saved_config_v3';

export const RoteiroCriativoVideoStudio: React.FC<RoteiroCriativoVideoStudioProps> = ({
  onTransferToVoice,
  onTransferToVideo,
  initialVoice,
  onAddAudioTask,
  onUpdateAudioTask,
  onAddVideoTask,
  onUpdateVideoTask,
  onOpenTaskManager,
  resumeTaskId,
  onResumeHandled,
}) => {
  // Input Mode: 'full_prompt' (Fornecer História Pronta) | 'idea_theme' (Pedir Tema / Premissa) | 'batch_mode' (Fila em Lote)
  const [inputMode, setInputMode] = useState<'full_prompt' | 'idea_theme' | 'batch_mode'>('full_prompt');

  // Input states
  const [storyText, setStoryText] = useState<string>('');
  const [premiseText, setPremiseText] = useState<string>('');
  const [batchScriptsText, setBatchScriptsText] = useState<string>('');
  const [genre, setGenre] = useState<string>(STORY_GENRES[0]);
  const [tone, setTone] = useState<string>(STORY_TONES[0]);

  // Video Duration Control with LocalStorage Persistence
  const [targetDurationSeconds, setTargetDurationSeconds] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('vozlirve_creative_video_duration');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 15 && parsed <= 600) return parsed;
      }
    } catch {}
    return 60; // 60s default (1 min)
  });
  const [durationSavedFeedback, setDurationSavedFeedback] = useState<boolean>(false);

  // Save duration to localStorage whenever it changes
  const handleUpdateDuration = (newSeconds: number) => {
    const clamped = Math.max(15, Math.min(600, newSeconds));
    setTargetDurationSeconds(clamped);
    try {
      localStorage.setItem('vozlirve_creative_video_duration', clamped.toString());
      setDurationSavedFeedback(true);
      setTimeout(() => setDurationSavedFeedback(false), 2000);
    } catch {}
  };

  // Voice & Video Settings
  const [selectedVoice, setSelectedVoice] = useState<Voice>(() => {
    return initialVoice || CURATED_VOICES[0];
  });
  const [enableMultiVoice, setEnableMultiVoice] = useState<boolean>(false);
  const [secondaryVoice, setSecondaryVoice] = useState<Voice>(() => {
    return CURATED_VOICES[1] || CURATED_VOICES[0];
  });
  const [speed, setSpeed] = useState<string>('+0%');
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [visualTheme, setVisualTheme] = useState<'cinematica' | 'fantasia' | 'misterio' | 'acolhedor' | 'documentario'>('cinematica');
  const [subtitleStyle, setSubtitleStyle] = useState<'capcut_yellow' | 'classic_white' | 'cinematic_serif'>('capcut_yellow');
  const [showSubtitles, setShowSubtitles] = useState<boolean>(true);
  const [subtitlePosition, setSubtitlePosition] = useState<'bottom' | 'center' | 'top'>('bottom');
  const [wordByWordHighlight, setWordByWordHighlight] = useState<boolean>(true);

  // Effects matching VideoVozLivre:
  // Motion Effect & Intensity
  const [motionEffect, setMotionEffect] = useState<
    'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pulse' | 'shake' | 'float' | 'none'
  >('zoom-in');
  const [motionIntensity, setMotionIntensity] = useState<'subtle' | 'medium' | 'intense'>('medium');

  // Background Music, Intelligent Auto-Ducking & Scene Transition SFX (including Flash Cut)
  const [enableBgMusic, setEnableBgMusic] = useState<boolean>(false);
  const [bgMusicTrackId, setBgMusicTrackId] = useState<string>('acoustic');
  const [bgMusicVolume, setBgMusicVolume] = useState<number>(0.15); // 15% default for clear speech
  const [autoDucking, setAutoDucking] = useState<boolean>(true);
  const [sceneSfxType, setSceneSfxType] = useState<SceneSfxType>('flash_cut');
  const [sceneSfxVolume, setSceneSfxVolume] = useState<number>(0.55);
  const [customMusicUrl, setCustomMusicUrl] = useState<string | null>(null);
  const [customMusicName, setCustomMusicName] = useState<string>('');
  const [customMusicBlob, setCustomMusicBlob] = useState<Blob | null>(null);
  const customMusicInputRef = useRef<HTMLInputElement>(null);
  const customMusicAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingMusicPreview, setIsPlayingMusicPreview] = useState<boolean>(false);

  // Persistent Saved Projects History in IndexedDB
  const [savedProjects, setSavedProjects] = useState<StoredCreativeProject[]>([]);

  // Waveform Visualizer
  const [showWaveform, setShowWaveform] = useState<boolean>(false);
  const [waveformStyle, setWaveformStyle] = useState<'bars' | 'line'>('bars');
  const [waveformColor, setWaveformColor] = useState<'white' | 'emerald' | 'cyan' | 'violet' | 'amber'>('cyan');

  // Gallery View Mode for Multiple Images / Scenes (compact cards vs detailed list)
  const [galleryViewMode, setGalleryViewMode] = useState<'cards' | 'expanded'>('cards');

  // Simultaneous Background Video Productions Queue:
  // User request: "Agora quando apertar ao apertar em gerar vídeo em gerar vídeo narrativo completo deve colocar ele pra gerará em segundo plano e liberar o sistema pra poder reutilização do roteiro criativo deixando ele limpo."
  const [jobs, setJobs] = useState<NarrativeProductionJob[]>([]);
  const [queueItems, setQueueItems] = useState<StudioQueueItem[]>([]);
  const queueOrderRef = useRef<string[]>([]);
  const isQueueRunningRef = useRef<boolean>(false);
  const activeJobDataMapRef = useRef<Map<string, any>>(new Map());
  const cancelledJobsRef = useRef<Set<string>>(new Set());
  const lastFailedJobIdRef = useRef<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);

  // Quick Media Verification Modal State (pops up when generating video so user can verify/replace media)
  const [quickReviewModalState, setQuickReviewModalState] = useState<{
    isOpen: boolean;
    jobId: string;
    title: string;
    scenes: ReviewableSceneMedia[];
    audioStatusText: string;
    isAudioReady: boolean;
  } | null>(null);
  const quickReviewResolverRef = useRef<((confirmedScenes: ReviewableSceneMedia[]) => void) | null>(null);

  const openQuickMediaReview = async (
    title: string,
    sceneList: NarrativeScene[]
  ): Promise<NarrativeScene[] | null> => {
    const safeList = Array.isArray(sceneList) ? sceneList : [];
    const reviewableScenes: ReviewableSceneMedia[] = safeList.map((sc, idx) => ({
      id: sc.id || `scene-${idx}`,
      index: idx,
      narrationSegment: sc.narrationSegment,
      caption: sc.caption,
      searchQuery: sc.searchTag || sc.caption,
      mediaType: sc.mediaType === 'video' ? 'video' : 'image',
      mediaUrl: sc.mediaUrl,
      originalUrl: sc.exactMediaUrl || sc.mediaUrl,
      thumbnailUrl: sc.thumbnailUrl || sc.mediaUrl,
      candidateUrls: (sc as any).candidateUrls || [],
      visualSource: sc.visualSource,
    }));

    const confirmedMedia = await new Promise<ReviewableSceneMedia[]>((resolve) => {
      quickReviewResolverRef.current = resolve;
      setQuickReviewModalState({
        isOpen: true,
        jobId: `manual-review-${Date.now()}`,
        title: title || 'Roteiro Criativo',
        scenes: reviewableScenes,
        audioStatusText: 'Verifique ou substitua qualquer imagem ou vídeo das cenas abaixo.',
        isAudioReady: true,
      });
    });

    setQuickReviewModalState(null);
    quickReviewResolverRef.current = null;

    return safeList.map((sc, idx) => {
      const updated = confirmedMedia.find((m) => m.id === sc.id) || confirmedMedia[idx];
      if (!updated) return sc;
      return {
        ...sc,
        mediaType: updated.mediaType,
        mediaUrl: updated.mediaUrl,
        exactMediaUrl: updated.originalUrl || updated.mediaUrl,
        thumbnailUrl: updated.thumbnailUrl || updated.mediaUrl,
        visualSource: (updated.visualSource as any) || sc.visualSource,
      };
    });
  };

  // Config Save Feedback
  const [configSavedFeedback, setConfigSavedFeedback] = useState<boolean>(false);

  // Load saved configuration from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CREATIVE_CONFIG);
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg.voiceId) {
          const found = CURATED_VOICES.find((v) => v.id === cfg.voiceId);
          if (found) setSelectedVoice(found);
        }
        if (cfg.aspectRatio) setAspectRatio(cfg.aspectRatio);
        if (cfg.motionEffect) setMotionEffect(cfg.motionEffect);
        if (cfg.motionIntensity) setMotionIntensity(cfg.motionIntensity);
        if (typeof cfg.enableBgMusic === 'boolean') setEnableBgMusic(cfg.enableBgMusic);
        if (cfg.bgMusicTrackId) setBgMusicTrackId(cfg.bgMusicTrackId);
        if (typeof cfg.bgMusicVolume === 'number') setBgMusicVolume(cfg.bgMusicVolume);
        if (typeof cfg.showWaveform === 'boolean') setShowWaveform(cfg.showWaveform);
        if (cfg.waveformStyle) setWaveformStyle(cfg.waveformStyle);
        if (cfg.waveformColor) setWaveformColor(cfg.waveformColor);
        if (cfg.visualTheme) setVisualTheme(cfg.visualTheme);
        if (cfg.subtitleStyle) setSubtitleStyle(cfg.subtitleStyle);
        if (typeof cfg.showSubtitles === 'boolean') setShowSubtitles(cfg.showSubtitles);
        if (cfg.subtitlePosition) setSubtitlePosition(cfg.subtitlePosition);
        if (typeof cfg.wordByWordHighlight === 'boolean') setWordByWordHighlight(cfg.wordByWordHighlight);
        if (typeof cfg.autoDucking === 'boolean') setAutoDucking(cfg.autoDucking);
        if (cfg.sceneSfxType) setSceneSfxType(cfg.sceneSfxType);
        if (typeof cfg.sceneSfxVolume === 'number') setSceneSfxVolume(cfg.sceneSfxVolume);
        if (typeof cfg.enableMultiVoice === 'boolean') setEnableMultiVoice(cfg.enableMultiVoice);
        if (cfg.secondaryVoiceId) {
          const secFound = CURATED_VOICES.find((v) => v.id === cfg.secondaryVoiceId);
          if (secFound) setSecondaryVoice(secFound);
        }
        if (cfg.speed) setSpeed(cfg.speed);
        if (cfg.galleryViewMode) setGalleryViewMode(cfg.galleryViewMode);
      }
    } catch {}

    // Load custom device music from IndexedDB if saved
    getCustomBgMusicFromDB().then((item) => {
      if (item && item.blob) {
        const url = URL.createObjectURL(item.blob);
        setCustomMusicBlob(item.blob);
        setCustomMusicName(item.name);
        setCustomMusicUrl(url);
      }
    }).catch(() => {});

    // Load saved creative projects history from IndexedDB
    getAllCreativeProjectsFromDB()
      .then((items) => setSavedProjects(items))
      .catch(() => {});
  }, []);

  // Save configuration helper (persists voice, effects, music, format)
  const handleSaveConfiguration = (customMsg?: string) => {
    try {
      const cfg = {
        voiceId: selectedVoice.id,
        secondaryVoiceId: secondaryVoice.id,
        enableMultiVoice,
        aspectRatio,
        motionEffect,
        motionIntensity,
        enableBgMusic,
        bgMusicTrackId,
        bgMusicVolume,
        autoDucking,
        sceneSfxType,
        sceneSfxVolume,
        customMusicName,
        showWaveform,
        waveformStyle,
        waveformColor,
        visualTheme,
        subtitleStyle,
        showSubtitles,
        subtitlePosition,
        wordByWordHighlight,
        speed,
        galleryViewMode,
      };
      localStorage.setItem(STORAGE_KEY_CREATIVE_CONFIG, JSON.stringify(cfg));
      setConfigSavedFeedback(true);
      setTimeout(() => setConfigSavedFeedback(false), 2500);
    } catch {}
  };

  // Upload Custom Music from Device (Matching VideoVozLivre)
  const handleCustomMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const name = file.name.replace(/\.[^/.]+$/, '');
      await saveCustomBgMusicToDB(file, name);
      const url = URL.createObjectURL(file);
      setCustomMusicBlob(file);
      setCustomMusicName(name);
      setCustomMusicUrl(url);
      setBgMusicTrackId('custom');
      setEnableBgMusic(true);
      handleSaveConfiguration();
    } catch (err) {
      console.error('Erro ao salvar música do dispositivo:', err);
    } finally {
      if (customMusicInputRef.current) {
        customMusicInputRef.current.value = '';
      }
    }
  };

  // Remove Custom Music from Device
  const handleRemoveCustomMusic = async () => {
    try {
      if (isPlayingMusicPreview && customMusicAudioRef.current) {
        customMusicAudioRef.current.pause();
        setIsPlayingMusicPreview(false);
      }
      await deleteCustomBgMusicFromDB();
      setCustomMusicBlob(null);
      setCustomMusicName('');
      setCustomMusicUrl(null);
      if (bgMusicTrackId === 'custom') {
        setBgMusicTrackId('acoustic');
      }
      handleSaveConfiguration();
    } catch (err) {
      console.warn('Erro ao remover música customizada:', err);
    }
  };

  // Toggle Background Music Preview
  const handleToggleMusicPreview = async () => {
    if (isPlayingMusicPreview) {
      if (customMusicAudioRef.current) {
        customMusicAudioRef.current.pause();
      }
      setIsPlayingMusicPreview(false);
      return;
    }

    try {
      let playUrl: string | null = null;
      if (bgMusicTrackId === 'custom' && customMusicUrl) {
        playUrl = customMusicUrl;
      } else {
        const preset = await getPresetMusicBuffer(bgMusicTrackId === 'custom' ? 'acoustic' : bgMusicTrackId);
        playUrl = preset.url;
      }

      if (playUrl) {
        if (!customMusicAudioRef.current) {
          customMusicAudioRef.current = new Audio();
        }
        customMusicAudioRef.current.src = playUrl;
        customMusicAudioRef.current.volume = Math.max(0.05, Math.min(1.0, bgMusicVolume * 1.5));
        customMusicAudioRef.current.onended = () => setIsPlayingMusicPreview(false);
        await customMusicAudioRef.current.play();
        setIsPlayingMusicPreview(true);
      }
    } catch (e) {
      console.warn('Erro ao tocar prévia da música:', e);
      setIsPlayingMusicPreview(false);
    }
  };

  // Pipeline Status & Progress
  const [status, setStatus] = useState<
    'idle' | 'scripting' | 'synthesizing' | 'rendering' | 'ready' | 'error'
  >('idle');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dual Processing Live Gauges (Synchronous audio & video tasks tracker)
  const [audioTaskProgress, setAudioTaskProgress] = useState<number>(0);
  const [audioTaskStatus, setAudioTaskStatus] = useState<string>('idle');
  const [videoTaskProgress, setVideoTaskProgress] = useState<number>(0);
  const [videoTaskStatus, setVideoTaskStatus] = useState<string>('idle');
  const currentAudioTaskIdRef = useRef<string | null>(null);
  const currentVideoTaskIdRef = useRef<string | null>(null);

  // Script & Scenes Data
  const [storyTitle, setStoryTitle] = useState<string>('');
  const [fullNarration, setFullNarration] = useState<string>('');
  const [storyEntities, setStoryEntities] = useState<string[]>([]);
  const [scenes, setScenes] = useState<NarrativeScene[]>([]);
  const [activeSceneIndex, setActiveSceneIndex] = useState<number>(0);

  // Audio & Video outputs
  const [generatedAudio, setGeneratedAudio] = useState<GeneratedAudio | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [renderedVideoBlob, setRenderedVideoBlob] = useState<Blob | null>(null);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const [renderedVideoFilename, setRenderedVideoFilename] = useState<string>('');
  const [playerViewMode, setPlayerViewMode] = useState<'interactive' | 'exported'>('interactive');

  // Media Search Modal (for swapping any scene's image or video)
  const [isMediaSearchModalOpen, setIsMediaSearchModalOpen] = useState<boolean>(false);
  const [mediaSearchTargetSceneIndex, setMediaSearchTargetSceneIndex] = useState<number>(0);
  const [mediaSearchQuery, setMediaSearchQuery] = useState<string>('');
  const [mediaSearchResults, setMediaSearchResults] = useState<Array<{ id: string; url: string; thumbUrl: string; title: string; source?: string; type: 'image' | 'video' }>>([]);
  const [isSearchingMedia, setIsSearchingMedia] = useState<boolean>(false);
  const [customMediaUrlInput, setCustomMediaUrlInput] = useState<string>('');

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaBitmapsRef = useRef<Map<string, MediaDrawable>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastSpeechBufferRef = useRef<AudioBuffer | null>(null);

  // Precomputed dynamic subtitle phrases
  const subtitlePhrases = useMemo(() => {
    return buildNarrativeSubtitles(fullNarration, duration, lastSpeechBufferRef.current, scenes);
  }, [fullNarration, duration, scenes]);

  // Sync selected voice from props if changed
  useEffect(() => {
    if (initialVoice) {
      setSelectedVoice(initialVoice);
    }
  }, [initialVoice]);

  // Load media drawables into memory for canvas rendering
  const normalizeSceneMediaUrl = (u?: string): string => {
    if (!u) return '';
    let c = u.trim().replace(/^[\s[\]"'<>]+|[\s[\]"'<>]+$/g, '').replace(/&amp;/gi, '&').trim();
    if (c.toLowerCase().startsWith('www.')) c = 'https://' + c;
    return c;
  };

  const preloadSceneBitmaps = async (sceneList: NarrativeScene[]): Promise<Map<string, MediaDrawable>> => {
    const localMap = new Map<string, MediaDrawable>();

    const urlsToLoad = new Set<string>();
    for (const sc of sceneList) {
      if (sc.mediaUrl) urlsToLoad.add(normalizeSceneMediaUrl(sc.mediaUrl));
      if (sc.exactMediaUrl) urlsToLoad.add(normalizeSceneMediaUrl(sc.exactMediaUrl));
      if (sc.thumbnailUrl) urlsToLoad.add(normalizeSceneMediaUrl(sc.thumbnailUrl));
    }

    const drawImgToOffscreenCanvas = (img: HTMLImageElement, targetUrl: string): MediaDrawable | null => {
      const natW = img.naturalWidth || img.width || 1280;
      const natH = img.naturalHeight || img.height || 720;
      try {
        const maxDim = 1920;
        const scale = Math.min(1, maxDim / Math.max(natW, natH, 1));
        const cW = Math.max(1, Math.round(natW * scale));
        const cH = Math.max(1, Math.round(natH * scale));
        const offCanvas = document.createElement('canvas');
        offCanvas.width = cW;
        offCanvas.height = cH;
        const offCtx = offCanvas.getContext('2d');
        if (offCtx) {
          offCtx.drawImage(img, 0, 0, cW, cH);
          offCtx.getImageData(0, 0, 1, 1);

          // Pre-build a soft blurred backdrop canvas so CapCut blur surround is fast & works on all browsers
          const blurCanvas = document.createElement('canvas');
          blurCanvas.width = 320;
          blurCanvas.height = 320;
          const bCtx = blurCanvas.getContext('2d');
          if (bCtx) {
            bCtx.imageSmoothingEnabled = true;
            try {
              bCtx.filter = 'blur(14px) brightness(0.75)';
            } catch {}
            bCtx.drawImage(offCanvas, 0, 0, 320, 320);
          }

          return {
            source: offCanvas,
            width: cW,
            height: cH,
            url: targetUrl,
            ...(bCtx ? { blurredSource: blurCanvas } : {}),
          } as MediaDrawable;
        }
      } catch {
        return null;
      }
      return { source: img, width: natW, height: natH, url: targetUrl };
    };

    const loadImageViaFetchBlob = async (candidateSrc: string, targetUrl: string, timeoutMs: number): Promise<MediaDrawable | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(candidateSrc, { signal: controller.signal });
        if (!res.ok) return null;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) return null;
        const blob = await res.blob();
        if (blob.size < 64) return null;
        const blobUrl = URL.createObjectURL(blob);
        return await new Promise<MediaDrawable | null>((resolve) => {
          const img = new Image();
          const t = setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
            resolve(null);
          }, 6000);
          img.onload = () => {
            clearTimeout(t);
            const drawable = drawImgToOffscreenCanvas(img, targetUrl);
            URL.revokeObjectURL(blobUrl);
            resolve(drawable);
          };
          img.onerror = () => {
            clearTimeout(t);
            URL.revokeObjectURL(blobUrl);
            resolve(null);
          };
          img.src = blobUrl;
        });
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    const loadImageFromCandidate = (candidateSrc: string, targetUrl: string, timeoutMs: number): Promise<MediaDrawable | null> => {
      return new Promise<MediaDrawable | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        let resolved = false;
        const t = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(null);
          }
        }, timeoutMs);

        img.onload = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(t);
            resolve(drawImgToOffscreenCanvas(img, targetUrl));
          }
        };

        img.onerror = () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(t);
            resolve(null);
          }
        };

        img.src = candidateSrc;
      });
    };

    const loadSingle = async (rawUrl: string): Promise<MediaDrawable | null> => {
      const url = normalizeSceneMediaUrl(rawUrl);
      if (!url) return null;
      if (mediaBitmapsRef.current.has(url)) {
        const existing = mediaBitmapsRef.current.get(url)!;
        if (existing && existing.source) return existing;
      }

      const lowerUrl = url.toLowerCase();
      const isVideo =
        lowerUrl.includes('.mp4') ||
        lowerUrl.includes('.webm') ||
        lowerUrl.includes('video=1') ||
        lowerUrl.includes('youtube.com/watch') ||
        lowerUrl.includes('youtu.be/') ||
        lowerUrl.includes('vimeo.com/');
      if (isVideo) {
        const loadedVideo = await new Promise<MediaDrawable | null>((resolve) => {
          const video = document.createElement('video');
          video.crossOrigin = 'anonymous';
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          video.preload = 'auto';

          let resolved = false;
          const t = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve(null);
            }
          }, 11000);

          const onReady = () => {
            if (!resolved && video.videoWidth > 0) {
              resolved = true;
              clearTimeout(t);
              video.play().catch(() => {});
              resolve({
                source: video,
                width: video.videoWidth || 1280,
                height: video.videoHeight || 720,
                url,
              });
            }
          };

          video.onloadeddata = onReady;
          video.oncanplay = onReady;
          video.onerror = () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(t);
              resolve(null);
            }
          };
          const proxySrc = url.startsWith('http') ? `/api/proxy-media?video=1&url=${encodeURIComponent(url)}` : url;
          video.src = proxySrc;
          video.load();
        });
        if (loadedVideo) return loadedVideo;
      }

      // Multi-stage resilient image loading:
      // 1. Same-origin Blob via /api/proxy-media (100% immune to CORS canvas taint)
      // 2. Direct Image via /api/proxy-media
      // 3. Global CORS image CDN proxy (wsrv.nl)
      // 4. Direct browser load with crossOrigin='anonymous'
      if (url.startsWith('http')) {
        const proxyEndpoint = `/api/proxy-media?url=${encodeURIComponent(url)}`;
        const wsrvEndpoint = `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=1280&output=jpg`;

        const viaBlob = await loadImageViaFetchBlob(proxyEndpoint, url, 12000);
        if (viaBlob) return viaBlob;

        const viaProxyImg = await loadImageFromCandidate(proxyEndpoint, url, 10000);
        if (viaProxyImg) return viaProxyImg;

        const viaWsrvBlob = await loadImageViaFetchBlob(wsrvEndpoint, url, 10000);
        if (viaWsrvBlob) return viaWsrvBlob;

        const viaWsrvImg = await loadImageFromCandidate(wsrvEndpoint, url, 8000);
        if (viaWsrvImg) return viaWsrvImg;

        const viaDirect = await loadImageFromCandidate(url, url, 8000);
        if (viaDirect) return viaDirect;
      } else {
        const directLocal = await loadImageFromCandidate(url, url, 8000);
        if (directLocal) return directLocal;
      }

      return null;
    };

    const results = await Promise.allSettled(Array.from(urlsToLoad).filter(Boolean).map(loadSingle));
    let firstValidDrawable: MediaDrawable | null = null;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        mediaBitmapsRef.current.set(r.value.url, r.value);
        localMap.set(r.value.url, r.value);
        if (!firstValidDrawable) firstValidDrawable = r.value;
      }
    }

    // If all external URLs failed to load, load a guaranteed fallback image so the video is never a gray screen
    if (!firstValidDrawable && sceneList.length > 0) {
      const guaranteedBackupUrl = 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1280&q=80';
      const backupDrawable = await loadSingle(guaranteedBackupUrl);
      if (backupDrawable) {
        firstValidDrawable = backupDrawable;
        mediaBitmapsRef.current.set(guaranteedBackupUrl, backupDrawable);
        localMap.set(guaranteedBackupUrl, backupDrawable);
      }
    }

    let lastValidSceneDrawable: MediaDrawable | null = firstValidDrawable;
    for (let idx = 0; idx < sceneList.length; idx++) {
      const sc = sceneList[idx];
      const normMedia = normalizeSceneMediaUrl(sc.mediaUrl);
      const normExact = normalizeSceneMediaUrl(sc.exactMediaUrl);
      const normThumb = normalizeSceneMediaUrl(sc.thumbnailUrl);
      const match =
        localMap.get(normMedia) ||
        (normExact ? localMap.get(normExact) : undefined) ||
        (normThumb ? localMap.get(normThumb) : undefined) ||
        mediaBitmapsRef.current.get(sc.mediaUrl) ||
        mediaBitmapsRef.current.get(normMedia) ||
        (normExact ? mediaBitmapsRef.current.get(normExact) : undefined) ||
        (sc.thumbnailUrl ? mediaBitmapsRef.current.get(sc.thumbnailUrl) : undefined) ||
        (normThumb ? mediaBitmapsRef.current.get(normThumb) : undefined) ||
        lastValidSceneDrawable;

      if (match) {
        lastValidSceneDrawable = match;
        const indexKey = `scene-idx-${idx}`;
        mediaBitmapsRef.current.set(sc.id, match);
        mediaBitmapsRef.current.set(indexKey, match);
        localMap.set(sc.id, match);
        localMap.set(indexKey, match);
        if (sc.mediaUrl) {
          mediaBitmapsRef.current.set(sc.mediaUrl, match);
          localMap.set(sc.mediaUrl, match);
        }
        if (normMedia) {
          mediaBitmapsRef.current.set(normMedia, match);
          localMap.set(normMedia, match);
        }
        if (sc.exactMediaUrl) {
          mediaBitmapsRef.current.set(sc.exactMediaUrl, match);
          localMap.set(sc.exactMediaUrl, match);
        }
        if (normExact) {
          mediaBitmapsRef.current.set(normExact, match);
          localMap.set(normExact, match);
        }
      }
    }

    return localMap;
  };

  // TTS Fetch (returns pure speech AudioBuffer for exact acoustic subtitle synchronization)
  const fetchTtsAudio = async (
    text: string,
    voiceId: string,
    spd: string
  ): Promise<{ blob: Blob; url: string; duration: number; speechBuffer: AudioBuffer | null }> => {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        voice: voiceId,
        rate: spd,
        pitch: '+0Hz',
        volume: '+0%',
      }),
    });

    if (!res.ok) {
      throw new Error(`Falha na síntese de voz neural (${res.status}).`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    // Precise audio duration calculation and AudioBuffer extraction via shared AudioContext & WeakMap cache
    let audioDuration = targetDurationSeconds;
    let decodedSpeechBuffer: AudioBuffer | null = null;
    try {
      const decoded = await decodeAudioBlobOnce(blob);
      audioDuration = decoded.duration;
      decodedSpeechBuffer = decoded;
    } catch {
      // fallback to audio element
      const tempAudio = new Audio(url);
      await new Promise((r) => {
        tempAudio.onloadedmetadata = () => {
          if (tempAudio.duration && isFinite(tempAudio.duration)) {
            audioDuration = tempAudio.duration;
          }
          r(null);
        };
        tempAudio.onerror = () => r(null);
        setTimeout(r, 1500);
      });
    }

    return { blob, url, duration: audioDuration, speechBuffer: decodedSpeechBuffer };
  };

  /**
   * Multi-Voice TTS Synthesizer:
   * Supports inline `[Voz: Nome]` tags AND automatic 2nd neural voice for dialogue quotes (`"..."` / `“...”` / `— `)
   */
  const fetchMultiVoiceTtsAudio = async (
    rawNarration: string,
    primaryVoice: Voice,
    spd: string,
    useMultiVoice: boolean,
    dialogueVoice?: Voice
  ): Promise<{ blob: Blob; url: string; duration: number; speechBuffer: AudioBuffer | null }> => {
    const hasInlineVoiceTags = /\[\s*(?:voz|narrador)\s*:\s*([^\]]+)\]/i.test(rawNarration);
    const hasDialogueQuotes = useMultiVoice && dialogueVoice && (/["“”][^"“”]{3,}["“”]/.test(rawNarration) || /(?:^|\n)\s*[—–-]\s+[^\n]+/.test(rawNarration));

    if (!hasInlineVoiceTags && !hasDialogueQuotes) {
      const cleanedSingle = rawNarration.replace(/\[\s*(?:voz|narrador|sfx)\s*:[^\]]*\]/gi, '').trim();
      return fetchTtsAudio(cleanedSingle || rawNarration, primaryVoice.id, spd);
    }

    interface VoiceSegment {
      text: string;
      voiceId: string;
    }

    const segments: VoiceSegment[] = [];
    const resolveVoiceIdByName = (nameQuery: string): string => {
      const q = nameQuery.trim().toLowerCase();
      if (q === 'narrador' || q === 'principal') return primaryVoice.id;
      if (q === 'secundaria' || q === 'secundária' || q === 'dialogo' || q === 'diálogo') {
        return dialogueVoice?.id || primaryVoice.id;
      }
      const match = CURATED_VOICES.find(
        (v) => v.name.toLowerCase().includes(q) || v.id.toLowerCase().includes(q)
      );
      return match ? match.id : dialogueVoice?.id || primaryVoice.id;
    };

    if (hasInlineVoiceTags) {
      const parts = rawNarration.split(/(\[\s*(?:voz|narrador)\s*:\s*[^\]]+\])/gi);
      let currentVoiceId = primaryVoice.id;
      for (const part of parts) {
        const tagMatch = part.match(/^\[\s*(?:voz|narrador)\s*:\s*([^\]]+)\]$/i);
        if (tagMatch) {
          currentVoiceId = resolveVoiceIdByName(tagMatch[1]);
        } else {
          const cleanPart = part.replace(/\[\s*sfx\s*:[^\]]*\]/gi, '').trim();
          if (cleanPart.length > 0) {
            segments.push({ text: cleanPart, voiceId: currentVoiceId });
          }
        }
      }
    } else if (hasDialogueQuotes && dialogueVoice) {
      // Split by quoted dialogue ("..." or “...”) so dialogueVoice reads quotes and primaryVoice reads narration
      const quoteParts = rawNarration.split(/(["“][^"”]{3,}["”])/g);
      for (const part of quoteParts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const isQuote = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('“') && trimmed.endsWith('”'));
        const cleanText = trimmed.replace(/^["“]|["”]$/g, '').trim();
        if (cleanText) {
          segments.push({
            text: cleanText,
            voiceId: isQuote ? dialogueVoice.id : primaryVoice.id,
          });
        }
      }
    }

    if (segments.length <= 1) {
      const cleanedSingle = rawNarration.replace(/\[\s*(?:voz|narrador|sfx)\s*:[^\]]*\]/gi, '').trim();
      return fetchTtsAudio(cleanedSingle || rawNarration, segments[0]?.voiceId || primaryVoice.id, spd);
    }

    // Parallel batch synthesis for multi-voice segments (up to 3 concurrent requests)
    const segResults: Array<{ speechBuffer: AudioBuffer | null }> = new Array(segments.length);
    let segIdx = 0;
    const workers = Array.from({ length: Math.min(3, segments.length) }, async () => {
      while (segIdx < segments.length) {
        const cur = segIdx++;
        segResults[cur] = await fetchTtsAudio(segments[cur].text, segments[cur].voiceId, spd);
      }
    });
    await Promise.all(workers);

    const buffers: AudioBuffer[] = segResults
      .map((r) => r?.speechBuffer)
      .filter((b): b is AudioBuffer => Boolean(b));

    if (buffers.length === 0) {
      const cleanedSingle = rawNarration.replace(/\[\s*(?:voz|narrador|sfx)\s*:[^\]]*\]/gi, '').trim();
      return fetchTtsAudio(cleanedSingle || rawNarration, primaryVoice.id, spd);
    }

    const combinedBuffer = await concatenateAudioBuffers(buffers, 0.14);
    const wavBlob = audioBufferToWavBlob(combinedBuffer);
    const wavUrl = URL.createObjectURL(wavBlob);
    return {
      blob: wavBlob,
      url: wavUrl,
      duration: combinedBuffer.duration,
      speechBuffer: combinedBuffer,
    };
  };

  /**
   * Exports synchronized subtitles as a standard .SRT file
   */
  const handleDownloadSrt = () => {
    const phrases = buildNarrativeSubtitles(fullNarration, duration || targetDurationSeconds, lastSpeechBufferRef.current, scenes);
    if (!phrases.length) return;

    const formatSrtTime = (sec: number) => {
      const safe = Math.max(0, sec);
      const hrs = Math.floor(safe / 3600);
      const mins = Math.floor((safe % 3600) / 60);
      const secs = Math.floor(safe % 60);
      const ms = Math.round((safe - Math.floor(safe)) * 1000);
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(Math.min(999, ms)).padStart(3, '0')}`;
    };

    const srtContent = phrases
      .map((p, idx) => `${idx + 1}\n${formatSrtTime(p.startTime)} --> ${formatSrtTime(p.endTime)}\n${cleanCaptionText(p.text)}\n`)
      .join('\n');

    const srtBlob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const cleanTitle = (storyTitle || 'historia-narrada').toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30);
    downloadBlob(srtBlob, `${cleanTitle}-legendas.srt`);
  };

  /**
   * Generates and downloads a High-Resolution Cover (Thumbnail HD) PNG from the story's scenes
   */
  const handleDownloadThumbnail = async (sceneIndex: number = 0) => {
    const targetList = scenes.length > 0 ? scenes : [];
    const { width, height } = getVideoDimensions(aspectRatio);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const map = await preloadSceneBitmaps(targetList);
    drawCinematicBackdrop(ctx, width, height, visualTheme);

    const sc = targetList[sceneIndex] || targetList[0];
    const drawable =
      (sc && (map.get(`scene-idx-${sceneIndex}`) || map.get(sc.id) || map.get(normalizeSceneMediaUrl(sc.mediaUrl)))) ||
      map.values().next().value;

    if (drawable && drawable.source) {
      const sourceW = Math.max(1, drawable.width || 1280);
      const sourceH = Math.max(1, drawable.height || 720);
      const bgSource: CanvasImageSource = (drawable as any).blurredSource || drawable.source;

      ctx.save();
      const coverScale = Math.max(width / sourceW, height / sourceH) * 1.14;
      const bgW = sourceW * coverScale;
      const bgH = sourceH * coverScale;
      try {
        ctx.filter = 'blur(25px) brightness(0.72)';
      } catch {}
      ctx.drawImage(bgSource, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);
      ctx.restore();

      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fillRect(0, 0, width, height);

      const containScale = Math.min(width / sourceW, height / sourceH);
      const fgW = Math.round(sourceW * containScale);
      const fgH = Math.round(sourceH * containScale);
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 28;
      ctx.drawImage(drawable.source, Math.round((width - fgW) / 2), Math.round((height - fgH) / 2), fgW, fgH);
      ctx.restore();
    }

    // Dramatic bottom gradient for Thumbnail Title
    const grad = ctx.createLinearGradient(0, height * 0.45, 0, height);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.88)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, height * 0.45, width, height * 0.55);

    const thumbTitle = (storyTitle || 'História Narrada').toUpperCase();
    const fontSize = aspectRatio === '9:16' ? Math.round(width * 0.068) : Math.round(height * 0.068);
    ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(4, Math.round(fontSize * 0.16));
    ctx.strokeStyle = '#000000';
    ctx.strokeText(thumbTitle.slice(0, 38), width / 2, height * 0.84);
    ctx.fillStyle = '#facc15';
    ctx.fillText(thumbTitle.slice(0, 38), width / 2, height * 0.84);

    canvas.toBlob((blob) => {
      if (blob) {
        const cleanTitle = (storyTitle || 'historia-narrada').toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30);
        downloadBlob(blob, `${cleanTitle}-capa-hd.png`);
      }
    }, 'image/png');
  };

  /**
   * Loads a saved project from IndexedDB history back into the editor
   */
  const handleLoadSavedProject = async (proj: StoredCreativeProject) => {
    setStoryTitle(proj.title);
    if (proj.storyText) setStoryText(proj.storyText);
    if (proj.premiseText) setPremiseText(proj.premiseText);
    setFullNarration(proj.fullNarration);
    setStoryEntities(proj.storyEntities || []);
    setScenes(proj.scenes || []);
    if (proj.aspectRatio) setAspectRatio(proj.aspectRatio);
    const vFound = CURATED_VOICES.find((v) => v.id === proj.voiceId);
    if (vFound) setSelectedVoice(vFound);
    setDuration(proj.durationSeconds || 60);
    if (proj.audioBlob) {
      const aUrl = URL.createObjectURL(proj.audioBlob);
      try {
        const ab = await proj.audioBlob.slice(0).arrayBuffer();
        const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
        lastSpeechBufferRef.current = await actx.decodeAudioData(ab);
        actx.close().catch(() => {});
      } catch {}
      setGeneratedAudio({
        id: proj.id,
        title: proj.title,
        voice: vFound || selectedVoice,
        textSnippet: proj.fullNarration.slice(0, 140),
        fullText: proj.fullNarration,
        charCount: proj.fullNarration.length,
        durationSeconds: proj.durationSeconds,
        createdAt: proj.createdAt,
        audioUrl: aUrl,
        downloadUrl: aUrl,
        blob: proj.audioBlob,
        blobUrl: aUrl,
      });
    }
    await preloadSceneBitmaps(proj.scenes || []);
    setStatus('ready');
    setQueueNotice(`✓ Projeto "${proj.title}" carregado do Histórico no Editor!`);
    setTimeout(() => setQueueNotice(null), 4500);
  };

  const handleDeleteSavedProject = async (id: string) => {
    await deleteCreativeProjectFromDB(id).catch(() => {});
    setSavedProjects((prev) => prev.filter((p) => p.id !== id));
  };

  /**
   * Universal Frame Renderer for Narrative Story
   * Receives explicit timeline & configuration parameters to prevent any stale closure bugs.
   */
  const renderNarrativeFrame = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frameTime: number,
    totalDuration: number,
    sceneList: NarrativeScene[],
    activeSubtitles: SubtitlePhrase[],
    activeSceneWindows: Array<{ start: number; end: number }>,
    titleToRender: string,
    shouldShowSubtitles: boolean,
    styleOfSubtitles: 'capcut_yellow' | 'classic_white' | 'cinematic_serif',
    renderConfigOverride?: {
      aspectRatio: VideoAspectRatio;
      visualTheme: 'cinematica' | 'fantasia' | 'misterio' | 'acolhedor' | 'documentario';
      motionEffect: 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pulse' | 'shake' | 'float' | 'none';
      motionIntensity: 'subtle' | 'medium' | 'intense';
      showWaveform: boolean;
      waveformStyle: 'bars' | 'line';
      waveformColor: 'white' | 'emerald' | 'cyan' | 'violet' | 'amber';
      subtitlePosition?: 'bottom' | 'center' | 'top';
      wordByWordHighlight?: boolean;
      sceneSfxType?: SceneSfxType;
    },
    explicitBitmapMap?: Map<string, MediaDrawable>
  ) => {
    const activeTheme = renderConfigOverride?.visualTheme ?? visualTheme;
    const activeAspect = renderConfigOverride?.aspectRatio ?? aspectRatio;
    const activeMotionEffect = renderConfigOverride?.motionEffect ?? motionEffect;
    const activeMotionIntensity = renderConfigOverride?.motionIntensity ?? motionIntensity;
    const activeShowWaveform = renderConfigOverride?.showWaveform ?? showWaveform;
    const activeWaveformStyle = renderConfigOverride?.waveformStyle ?? waveformStyle;
    const activeWaveformColor = renderConfigOverride?.waveformColor ?? waveformColor;
    const activeSubPosition = renderConfigOverride?.subtitlePosition ?? subtitlePosition;
    const activeWordHighlight = renderConfigOverride?.wordByWordHighlight ?? wordByWordHighlight;
    const activeSfxType = renderConfigOverride?.sceneSfxType ?? sceneSfxType;

    // 1. Draw atmospheric background
    drawCinematicBackdrop(ctx, w, h, activeTheme);

    // Use acoustically synchronized sceneWindows (or proportional fallback if empty)
    let sceneWindows = activeSceneWindows;
    if (!sceneWindows || sceneWindows.length !== sceneList.length) {
      const totalChars = sceneList.reduce((acc, s) => acc + Math.max(15, (s.narrationSegment || '').length), 0);
      let accum = 0;
      sceneWindows = sceneList.map((s) => {
        const dur = (Math.max(15, (s.narrationSegment || '').length) / Math.max(1, totalChars)) * totalDuration;
        const start = accum;
        const end = start + dur;
        accum = end;
        return { start, end };
      });
    }

    const foundIdx = sceneWindows.findIndex((win) => frameTime >= win.start && frameTime < win.end);
    const sceneIdx = foundIdx >= 0 ? foundIdx : (frameTime >= totalDuration ? sceneList.length - 1 : 0);
    const activeScene = sceneList[sceneIdx];

    // 2. Draw Active Media with Selected Motion Effect (Ken Burns zoom/pan/pulse)
    const lookupDrawable = (key?: string): MediaDrawable | undefined => {
      if (!key) return undefined;
      return explicitBitmapMap?.get(key) || mediaBitmapsRef.current.get(key);
    };

    const resolveSceneDrawable = (sc?: NarrativeScene, idx?: number): MediaDrawable | undefined => {
      if (!sc) return undefined;
      const normMedia = normalizeSceneMediaUrl(sc.mediaUrl);
      const normExact = normalizeSceneMediaUrl(sc.exactMediaUrl);
      const normThumb = normalizeSceneMediaUrl(sc.thumbnailUrl);
      const direct =
        (idx !== undefined ? lookupDrawable(`scene-idx-${idx}`) : undefined) ||
        lookupDrawable(sc.id) ||
        lookupDrawable(sc.mediaUrl) ||
        lookupDrawable(normMedia) ||
        lookupDrawable(sc.exactMediaUrl) ||
        lookupDrawable(normExact) ||
        lookupDrawable(sc.thumbnailUrl) ||
        lookupDrawable(normThumb);
      if (direct && direct.source) return direct;

      // Fallback to any loaded scene drawable so the frame never turns gray
      for (let i = 0; i < sceneList.length; i++) {
        const other = sceneList[i];
        const otherNorm = normalizeSceneMediaUrl(other.mediaUrl);
        const alt =
          lookupDrawable(`scene-idx-${i}`) ||
          lookupDrawable(other.id) ||
          lookupDrawable(other.mediaUrl) ||
          lookupDrawable(otherNorm) ||
          lookupDrawable(other.exactMediaUrl);
        if (alt && alt.source) return alt;
      }
      const firstExplicit = explicitBitmapMap?.values().next().value;
      if (firstExplicit && firstExplicit.source) return firstExplicit;
      const firstInMap = mediaBitmapsRef.current.values().next().value;
      return firstInMap && firstInMap.source ? firstInMap : undefined;
    };

    if (activeScene) {
      const drawable = resolveSceneDrawable(activeScene, sceneIdx);

      if (drawable && drawable.source) {
        ctx.save();
        const win = sceneWindows[sceneIdx] || { start: 0, end: totalDuration / Math.max(1, sceneList.length) };

        let zoom = 1.0;
        let panX = 0;
        let panY = 0;
        const intensityMult = activeMotionIntensity === 'subtle' ? 0.6 : activeMotionIntensity === 'intense' ? 1.4 : 1.0;

        // Continuous sinusoidal breathing motion
        const motionSpeed = 0.35;
        const zoomCycle = (Math.sin(frameTime * motionSpeed - Math.PI / 2) + 1) / 2;
        const panCycle = Math.sin(frameTime * (motionSpeed * 0.75));

        if (activeMotionEffect === 'zoom-in') {
          zoom = 1.0 + zoomCycle * 0.12 * intensityMult;
          panX = panCycle * (w * 0.012) * intensityMult;
        } else if (activeMotionEffect === 'zoom-out') {
          zoom = 1.12 - zoomCycle * 0.12 * intensityMult;
          panX = -panCycle * (w * 0.012) * intensityMult;
        } else if (activeMotionEffect === 'pan-left') {
          panX = -panCycle * (w * 0.045) * intensityMult;
          zoom = 1.06 + zoomCycle * 0.03 * intensityMult;
        } else if (activeMotionEffect === 'pan-right') {
          panX = panCycle * (w * 0.045) * intensityMult;
          zoom = 1.06 + zoomCycle * 0.03 * intensityMult;
        } else if (activeMotionEffect === 'pulse') {
          zoom = 1.02 + Math.sin(frameTime * 1.5) * 0.035 * intensityMult;
        } else if (activeMotionEffect === 'shake') {
          const t = frameTime * 8;
          panX = (Math.sin(t * 1.3) * 2.5 + Math.cos(t * 2.1) * 1.5) * intensityMult;
          panY = (Math.cos(t * 1.5) * 2 + Math.sin(t * 2.3) * 1.2) * intensityMult;
          zoom = 1.04;
        } else if (activeMotionEffect === 'float') {
          panX = Math.sin(frameTime * 0.4) * 8 * intensityMult;
          panY = Math.cos(frameTime * 0.3) * 6 * intensityMult;
          zoom = 1.05 + zoomCycle * 0.03 * intensityMult;
        } else {
          zoom = 1.0;
        }

        // Helper: renders full-screen continuous video when source is HTMLVideoElement, or CapCut blurred surround for photos
        const drawSceneWithCapCutBlur = (targetDrawable: MediaDrawable, alphaVal: number = 1.0) => {
          const sourceW = Math.max(1, targetDrawable.width || 1280);
          const sourceH = Math.max(1, targetDrawable.height || 720);
          const isVideoEl =
            Boolean(targetDrawable.source) &&
            typeof (targetDrawable.source as any).play === 'function' &&
            typeof (targetDrawable.source as any).currentTime === 'number';

          if (isVideoEl) {
            const v = targetDrawable.source as HTMLVideoElement;
            v.muted = true;
            v.loop = true;
            v.playsInline = true;
            if (!(v as any).__offlineSeeking) {
              if (v.paused && v.readyState >= 2) {
                v.play().catch(() => {});
              }
              if (v.duration && v.duration > 0) {
                const expectedTime = frameTime % v.duration;
                if (Math.abs(v.currentTime - expectedTime) > 1.35) {
                  try {
                    v.currentTime = expectedTime;
                  } catch {}
                }
              }
            }

            // Full-screen continuous background video playback
            ctx.save();
            ctx.globalAlpha = alphaVal;
            const fullCoverScale = Math.max(w / sourceW, h / sourceH) * (1.01 + (zoom - 1.0) * 0.25);
            const vidW = sourceW * fullCoverScale;
            const vidH = sourceH * fullCoverScale;
            const vidX = (w - vidW) / 2 + panX * 0.25;
            const vidY = (h - vidH) / 2 + panY * 0.25;
            ctx.drawImage(v, vidX, vidY, vidW, vidH);
            ctx.restore();
            return;
          }

          // Pre-bake blurred background canvas once per drawable to avoid per-frame ctx.filter = 'blur(25px)' overhead
          let preBlurredCanvas: HTMLCanvasElement | undefined = (targetDrawable as any).__preBlurredCanvas;
          if (!preBlurredCanvas && targetDrawable.source) {
            try {
              const blurC = document.createElement('canvas');
              blurC.width = 360;
              blurC.height = Math.max(200, Math.round((360 * sourceH) / sourceW));
              const bCtx = blurC.getContext('2d');
              if (bCtx) {
                bCtx.filter = 'blur(14px) brightness(0.75)';
                bCtx.drawImage(targetDrawable.source, -16, -16, blurC.width + 32, blurC.height + 32);
                preBlurredCanvas = blurC;
                (targetDrawable as any).__preBlurredCanvas = blurC;
              }
            } catch {}
          }
          const bgSource: CanvasImageSource =
            preBlurredCanvas || (targetDrawable as any).blurredSource || targetDrawable.source;

          ctx.save();
          ctx.globalAlpha = alphaVal;

          // 1. Blurred background layer filling the entire video frame (em volta da foto)
          ctx.save();
          const coverScale = Math.max(w / sourceW, h / sourceH) * (1.14 * zoom);
          const bgW = sourceW * coverScale;
          const bgH = sourceH * coverScale;
          const bgX = (w - bgW) / 2 + panX * 0.5;
          const bgY = (h - bgH) / 2 + panY * 0.5;
          if (!preBlurredCanvas && !(targetDrawable as any).blurredSource) {
            try {
              ctx.filter = 'blur(25px) brightness(0.75)';
            } catch {}
          }
          ctx.drawImage(bgSource, bgX, bgY, bgW, bgH);
          ctx.restore();

          // Darken overlay over blurred surround so the complete photo in the center has crisp contrast
          ctx.save();
          ctx.globalAlpha = alphaVal * 0.3;
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, w, h);
          ctx.restore();

          // 2. Complete foreground photo fitted 100% inside the video area (zero border cuts)
          const containScale = Math.min(w / sourceW, h / sourceH);
          const aspectDiff = Math.abs(sourceW / sourceH - w / h);
          const isLargerThanScreen = sourceW > w || sourceH > h || aspectDiff > 0.01;
          // When an image is larger than the screen with the exact same aspect ratio, keep a clean margin so the blur surround is visible around it
          const fitFactor = aspectDiff < 0.02 && isLargerThanScreen ? 0.92 : 1.0;
          // Gentle breathing motion that never exceeds 1.0 of fitFactor so the photo is never cropped by the screen borders
          const safeMotionScale =
            activeMotionEffect === 'none'
              ? fitFactor
              : fitFactor * (0.95 + Math.min(0.05, (zoom - 1.0) * 0.4));

          const fgW = Math.round(sourceW * containScale * safeMotionScale);
          const fgH = Math.round(sourceH * containScale * safeMotionScale);
          const maxShiftX = Math.max(0, (w - fgW) / 2);
          const maxShiftY = Math.max(0, (h - fgH) / 2);
          const clampedPanX = Math.max(-maxShiftX, Math.min(maxShiftX, panX * 0.35));
          const clampedPanY = Math.max(-maxShiftY, Math.min(maxShiftY, panY * 0.35));
          const fgX = Math.round((w - fgW) / 2 + clampedPanX);
          const fgY = Math.round((h - fgH) / 2 + clampedPanY);

          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
          ctx.shadowBlur = 24;
          ctx.shadowOffsetY = 6;
          ctx.drawImage(targetDrawable.source, fgX, fgY, fgW, fgH);
          ctx.restore();

          ctx.restore();
        };

        drawSceneWithCapCutBlur(drawable, 1.0);

        // Smooth Crossfade Dissolve to next scene (imperceptible transition)
        const CROSSFADE_SEC = 0.75;
        const timeUntilNext = win.end - frameTime;
        if (timeUntilNext < CROSSFADE_SEC && sceneIdx < sceneList.length - 1) {
          const nextScene = sceneList[sceneIdx + 1];
          const nextDrawable = resolveSceneDrawable(nextScene, sceneIdx + 1);
          if (nextDrawable && nextDrawable.source) {
            const rawAlpha = (CROSSFADE_SEC - timeUntilNext) / CROSSFADE_SEC;
            const crossAlpha = (1 - Math.cos(rawAlpha * Math.PI)) / 2;
            drawSceneWithCapCutBlur(nextDrawable, crossAlpha);
          }
        }

        // Subtle cinematic edge vignette (keeps image bright and clear)
        const vigGrad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.8);
        vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
        vigGrad.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = vigGrad;
        ctx.fillRect(0, 0, w, h);

        // Camera Flash Cut visual effect when 'flash_cut' SFX is active at scene transition
        if (activeSfxType === 'flash_cut' && sceneIdx > 0) {
          const timeSinceCut = frameTime - win.start;
          const FLASH_DUR = 0.22;
          if (timeSinceCut >= 0 && timeSinceCut < FLASH_DUR) {
            const flashAlpha = Math.pow(1 - timeSinceCut / FLASH_DUR, 2) * 0.78;
            ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha.toFixed(3)})`;
            ctx.fillRect(0, 0, w, h);
          }
        }

        ctx.restore();
      }
    }

    // 3. Audio Waveform Overlay (if enabled)
    if (activeShowWaveform) {
      drawWaveformOverlay(ctx, w, h, frameTime, activeWaveformStyle, activeWaveformColor);
    }

    // 4. Acoustically Synchronized Dynamic Subtitles (CapCut Word-by-Word Karaoke & Normal Full Phrase)
    if (shouldShowSubtitles && activeSubtitles.length > 0) {
      const activePhrase = activeSubtitles.find((p) => frameTime >= p.startTime && frameTime < p.endTime);
      if (activePhrase) {
        const effectiveEnd = activePhrase.speechEndTime ?? activePhrase.endTime;
        const phraseDur = Math.max(0.05, effectiveEnd - activePhrase.startTime);
        const phraseProg = Math.max(0, Math.min(1, (frameTime - activePhrase.startTime) / phraseDur));
        drawNarrativeSubtitle(
          ctx,
          w,
          h,
          activePhrase.text,
          activeAspect,
          styleOfSubtitles,
          activeSubPosition,
          activeWordHighlight,
          phraseProg,
          frameTime,
          activePhrase.wordTimings
        );
      }
    }
  };

  /**
   * Renders the complete MP4 video with WebCodecs hardware encoder or MediaRecorder fallback
   */
  const renderCompleteNarrativeVideo = async (
    audioBlob: Blob,
    audioBlobUrl: string,
    narrationText: string,
    sceneList: NarrativeScene[],
    audioDurationSec: number,
    speechBufferForSync?: AudioBuffer | null,
    explicitTitle?: string,
    jobConfig?: {
      jobId?: string;
      videoTaskId?: string;
      aspectRatio: VideoAspectRatio;
      visualTheme: 'cinematica' | 'fantasia' | 'misterio' | 'acolhedor' | 'documentario';
      motionEffect: 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pulse' | 'shake' | 'float' | 'none';
      motionIntensity: 'subtle' | 'medium' | 'intense';
      showWaveform: boolean;
      waveformStyle: 'bars' | 'line';
      waveformColor: 'white' | 'emerald' | 'cyan' | 'violet' | 'amber';
      showSubtitles: boolean;
      subtitleStyle: 'capcut_yellow' | 'classic_white' | 'cinematic_serif';
      subtitlePosition?: 'bottom' | 'center' | 'top';
      wordByWordHighlight?: boolean;
      sceneSfxType?: SceneSfxType;
    },
    preloadedBitmapMap?: Map<string, MediaDrawable>
  ): Promise<{ blob: Blob; url: string; filename: string }> => {
    const activeAspect = jobConfig?.aspectRatio ?? aspectRatio;
    const { width, height } = getVideoDimensions(activeAspect);
    const fps = 30;
    const totalFrames = Math.ceil(audioDurationSec * fps);
    const currentTitle = explicitTitle !== undefined ? explicitTitle : storyTitle;
    const cleanTitle = (currentTitle || 'historia-narrada').toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30);
    const filename = `${cleanTitle}-${activeAspect.replace(':', 'x')}.mp4`;

    // Ensure all scene bitmaps are loaded in memory before rendering frames
    const activeBitmapMap = preloadedBitmapMap && preloadedBitmapMap.size > 0
      ? preloadedBitmapMap
      : await preloadSceneBitmaps(sceneList);

    // Build acoustically synchronized subtitles & scene windows right before rendering (zero stale state!)
    const { subtitles: syncedSubtitles, sceneWindows: syncedSceneWindows } = buildSynchronizedNarrativeTimeline(
      narrationText,
      sceneList,
      audioDurationSec,
      speechBufferForSync
    );

    const shouldShowSubs = jobConfig?.showSubtitles ?? showSubtitles;
    const currentSubStyle = jobConfig?.subtitleStyle ?? subtitleStyle;
    const targetVideoTaskId = jobConfig?.videoTaskId || currentVideoTaskIdRef.current;
    const activeJobKey = jobConfig?.jobId || targetVideoTaskId || `nar-job-${Date.now()}`;

    const existingCheckpoint =
      getRenderCheckpointSync(activeJobKey) || (await getRenderCheckpoint(activeJobKey));

    let canUseWebCodecs = false;
    try {
      if (typeof (window as any).VideoEncoder === 'function' && typeof (window as any).AudioEncoder === 'function') {
        const vSup = await (window as any).VideoEncoder.isConfigSupported({
          codec: 'avc1.4d002a',
          width,
          height,
          bitrate: 2_500_000,
        });
        const aSup = await (window as any).AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2',
          numberOfChannels: 2,
          sampleRate: 44100,
          bitrate: 128_000,
        });
        if (vSup?.supported && aSup?.supported) canUseWebCodecs = true;
      }
    } catch {
      canUseWebCodecs = false;
    }

    // Engine A: Hardware/Software WebCodecs with Frame-Accurate Checkpoint & Resume
    if (canUseWebCodecs) {
      let currentFrameIdx = 0;
      let sampleRate = 44100;
      const checkpointAudioChunks: SerializedEncodedChunk[] = existingCheckpoint?.audioChunks
        ? [...existingCheckpoint.audioChunks]
        : [];
      const checkpointVideoChunks: SerializedEncodedChunk[] = existingCheckpoint?.videoChunks
        ? [...existingCheckpoint.videoChunks]
        : [];
      let savedAudioDecoderConfig: any = existingCheckpoint?.audioDecoderConfig;
      let savedVideoDecoderConfig: any = existingCheckpoint?.videoDecoderConfig;

      const persistFrameCheckpoint = async (lastFrame: number, errMsg?: string) => {
        const pct = Math.min(99, Math.round(60 + ((lastFrame + 1) / Math.max(1, totalFrames)) * 38));
        const jobSnap = activeJobDataMapRef.current.get(activeJobKey);
        const cp: VideoRenderCheckpoint = {
          taskId: activeJobKey,
          studioType: 'roteiro_criativo',
          title: currentTitle || 'História Narrada',
          aspectRatio: activeAspect,
          width,
          height,
          fps,
          totalFrames,
          lastCompletedFrame: lastFrame,
          progressPercent: pct,
          resumeTimeSec: (lastFrame + 1) / fps,
          totalDurationSec: audioDurationSec,
          audioSampleRate: sampleRate,
          audioNumberOfChannels: 2,
          audioChunks: checkpointAudioChunks,
          videoChunks: checkpointVideoChunks,
          videoDecoderConfig: savedVideoDecoderConfig,
          audioDecoderConfig: savedAudioDecoderConfig,
          jobSnapshot: jobSnap,
          updatedAt: Date.now(),
        };
        await saveRenderCheckpoint(cp);
        saveActiveVideoSessionState({
          taskId: activeJobKey,
          audioId: jobSnap?.audioTaskId || `${activeJobKey}-audio`,
          title: currentTitle || 'História Narrada',
          aspectRatio: activeAspect,
          fitMode: 'blur_capcut',
          progressPercent: pct,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          studioType: 'roteiro_criativo',
          lastCompletedFrame: lastFrame,
          totalFrames,
          resumeTimeSec: (lastFrame + 1) / fps,
          totalDurationSec: audioDurationSec,
          errorMessage: errMsg,
        });
      };

      try {
        const decodedAudio = await decodeAudioBlobOnce(audioBlob);

        sampleRate = decodedAudio.sampleRate || 44100;
        const ch0 = decodedAudio.getChannelData(0);
        const ch1 = decodedAudio.numberOfChannels > 1 ? decodedAudio.getChannelData(1) : ch0;

        const muxer = new Muxer({
          target: new ArrayBufferTarget(),
          video: { codec: 'avc', width, height },
          audio: { codec: 'aac', numberOfChannels: 2, sampleRate },
          fastStart: 'in-memory',
          firstTimestampBehavior: 'offset',
        });

        let startFrame = 0;
        if (
          existingCheckpoint &&
          existingCheckpoint.lastCompletedFrame >= 0 &&
          existingCheckpoint.videoChunks &&
          existingCheckpoint.videoChunks.length > 0 &&
          existingCheckpoint.width === width &&
          existingCheckpoint.height === height
        ) {
          replayCheckpointToMuxer(muxer, existingCheckpoint);
          startFrame = Math.min(totalFrames - 1, existingCheckpoint.lastCompletedFrame + 1);
          currentFrameIdx = startFrame;

          const resumePct = Math.min(99, Math.round(60 + (startFrame / Math.max(1, totalFrames)) * 38));
          const resumeFramePct = Math.min(99, Math.round((startFrame / Math.max(1, totalFrames)) * 100));
          setProgressPercent(resumePct);
          setVideoTaskProgress(resumePct);
          setStatusMessage(`Retomando renderização exatamente do frame ${startFrame}/${totalFrames} (${resumeFramePct}%)...`);
          if (jobConfig?.jobId) {
            updateQueueItem(jobConfig.jobId, {
              progress: resumePct,
              statusText: `Retomando renderização do frame ${startFrame}/${totalFrames} (${resumeFramePct}%)...`,
            });
          }
          if (targetVideoTaskId && onUpdateVideoTask) {
            onUpdateVideoTask(targetVideoTaskId, {
              progress: resumePct,
              statusText: `Retomando MP4 (${resumeFramePct}%)...`,
            });
          }
        } else {
          // Encode audio only if not already in checkpoint
          checkpointAudioChunks.length = 0;
          checkpointVideoChunks.length = 0;

          const audioEncoder = new (window as any).AudioEncoder({
            output: (chunk: any, meta: any) => {
              if (meta?.decoderConfig) {
                savedAudioDecoderConfig = meta.decoderConfig;
              }
              muxer.addAudioChunk(chunk, meta);
              checkpointAudioChunks.push(serializeEncodedChunk(chunk, meta));
            },
            error: (e: any) => console.error('AudioEncoder error:', e),
          });

          audioEncoder.configure({
            codec: 'mp4a.40.2',
            numberOfChannels: 2,
            sampleRate,
            bitrate: 128_000,
          });

          const chunkSize = 8192;
          const planarBuffer = new Float32Array(chunkSize * 2);
          for (let offset = 0; offset < ch0.length; offset += chunkSize) {
            while (audioEncoder.encodeQueueSize > 4) {
              await new Promise((r) => setTimeout(r, 10));
            }
            const curSize = Math.min(chunkSize, ch0.length - offset);
            for (let i = 0; i < curSize; i++) {
              planarBuffer[i] = ch0[offset + i] || 0;
              planarBuffer[curSize + i] = ch1[offset + i] || 0;
            }
            const audioData = new (window as any).AudioData({
              format: 'f32-planar',
              sampleRate,
              numberOfFrames: curSize,
              numberOfChannels: 2,
              timestamp: Math.round((offset / sampleRate) * 1_000_000),
              data: planarBuffer.subarray(0, curSize * 2),
            });
            audioEncoder.encode(audioData);
            audioData.close();
          }
          await audioEncoder.flush();
        }

        let encoderError: any = null;
        const createConfiguredVideoEncoder = (preferSoftware: boolean) => {
          const enc = new (window as any).VideoEncoder({
            output: (chunk: any, meta: any) => {
              if (meta?.decoderConfig) {
                savedVideoDecoderConfig = meta.decoderConfig;
              }
              muxer.addVideoChunk(chunk, meta);
              checkpointVideoChunks.push(serializeEncodedChunk(chunk, meta));
            },
            error: (e: any) => {
              console.warn('VideoEncoder error at frame', currentFrameIdx, e);
              encoderError = e;
            },
          });

          enc.configure({
            codec: 'avc1.4d002a',
            width,
            height,
            bitrate: 2_500_000,
            framerate: fps,
            hardwareAcceleration: preferSoftware ? 'prefer-software' : 'no-preference',
          });
          return enc;
        };

        let videoEncoder = createConfiguredVideoEncoder(false);

        const renderCanvas = document.createElement('canvas');
        renderCanvas.width = width;
        renderCanvas.height = height;
        const rCtx = renderCanvas.getContext('2d')!;

        for (let i = startFrame; i < totalFrames; i++) {
          currentFrameIdx = i;

          if (cancelledJobsRef.current.has(activeJobKey)) {
            try {
              if (videoEncoder.state === 'configured') await videoEncoder.flush();
            } catch {}
            await persistFrameCheckpoint(Math.max(0, i - 1), 'Renderização pausada/interrompida');
            throw new Error(`Renderização interrompida no frame ${i} de ${totalFrames}. Clique em Retomar Renderização para continuar deste ponto.`);
          }

          // Self-heal encoder if hardware encoder faulted mid-stream
          if (encoderError || videoEncoder.state !== 'configured') {
            console.warn(`Self-healing VideoEncoder at frame ${i} using software fallback...`);
            encoderError = null;
            try {
              if (videoEncoder.state !== 'closed') videoEncoder.close();
            } catch {}
            videoEncoder = createConfiguredVideoEncoder(true);
          }

          while (videoEncoder.encodeQueueSize > 2) {
            await new Promise((resolve) => setTimeout(resolve, 12));
            if (encoderError) break;
          }

          const frameTime = i / fps;

          // If active scene uses an HTMLVideoElement, await seeked to exact frameTime before drawing to Canvas
          const winIdx = syncedSceneWindows.findIndex((win) => frameTime >= win.start && frameTime < win.end);
          const curScIdx = winIdx >= 0 ? winIdx : 0;
          const curSc = sceneList[curScIdx];
          if (curSc) {
            const dNow =
              activeBitmapMap.get(`scene-idx-${curScIdx}`) ||
              activeBitmapMap.get(curSc.id) ||
              activeBitmapMap.get(normalizeSceneMediaUrl(curSc.mediaUrl)) ||
              mediaBitmapsRef.current.get(normalizeSceneMediaUrl(curSc.mediaUrl));
            const vEl = dNow?.source as HTMLVideoElement | undefined;
            if (vEl && typeof vEl.play === 'function' && vEl.duration > 0) {
              (vEl as any).__offlineSeeking = true;
              if (!vEl.paused) vEl.pause();
              const targetVidTime = frameTime % vEl.duration;
              if (Math.abs(vEl.currentTime - targetVidTime) > 0.02) {
                await new Promise<void>((resolveSeek) => {
                  let doneSeek = false;
                  const finish = () => {
                    if (doneSeek) return;
                    doneSeek = true;
                    vEl.removeEventListener('seeked', finish);
                    resolveSeek();
                  };
                  vEl.addEventListener('seeked', finish, { once: true });
                  setTimeout(finish, 90);
                  try {
                    vEl.currentTime = targetVidTime;
                  } catch {
                    finish();
                  }
                });
              }
            }
          }

          renderNarrativeFrame(
            rCtx,
            width,
            height,
            frameTime,
            audioDurationSec,
            sceneList,
            syncedSubtitles,
            syncedSceneWindows,
            currentTitle,
            shouldShowSubs,
            currentSubStyle,
            jobConfig,
            activeBitmapMap
          );

          const videoFrame = new (window as any).VideoFrame(renderCanvas, {
            timestamp: Math.round(frameTime * 1_000_000),
          });
          try {
            videoEncoder.encode(videoFrame, { keyFrame: i === startFrame || i % 36 === 0 });
          } catch (encodeErr) {
            // Re-try immediately on software encoder from exact frame i without losing progress
            videoEncoder = createConfiguredVideoEncoder(true);
            videoEncoder.encode(videoFrame, { keyFrame: true });
          } finally {
            videoFrame.close();
          }

          if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));

          if (i === totalFrames - 1) {
            await persistFrameCheckpoint(i);
          } else if (i > 0 && i % 45 === 0) {
            persistFrameCheckpoint(i).catch(() => {});
          }

          if (i % 10 === 0) {
            const p = Math.round(60 + (i / totalFrames) * 38);
            const pctFrames = Math.round((i / totalFrames) * 100);
            setProgressPercent(p);
            setVideoTaskProgress(p);
            setStatusMessage(`Renderizando frames do vídeo cinematográfico (${pctFrames}%)...`);
            if (jobConfig?.jobId) {
              updateQueueItem(jobConfig.jobId, {
                progress: p,
                statusText: `Renderizando frames MP4 em segundo plano (${pctFrames}% · frame ${i}/${totalFrames})...`,
              });
            }
            if (targetVideoTaskId && onUpdateVideoTask) {
              onUpdateVideoTask(targetVideoTaskId, {
                progress: p,
                statusText: `Renderizando MP4 (${pctFrames}%)...`,
              });
            }
          }
        }

        await videoEncoder.flush();
        muxer.finalize();

        await deleteRenderCheckpoint(activeJobKey);
        clearActiveVideoSessionState();

        const { buffer } = muxer.target;
        const finalBlob = new Blob([buffer], { type: 'video/mp4' });
        const finalUrl = URL.createObjectURL(finalBlob);

        return { blob: finalBlob, url: finalUrl, filename };
      } catch (err: any) {
        await persistFrameCheckpoint(Math.max(0, currentFrameIdx - 1), err?.message);
        // If we already encoded frames or were cancelled/interrupted, throw so the user can resume from the exact frame instead of restarting from 0 in MediaRecorder!
        if (checkpointVideoChunks.length > 0 || cancelledJobsRef.current.has(activeJobKey)) {
          throw err;
        }
        console.warn('WebCodecs narrative failed at frame 0, switching to MediaRecorder fallback:', err);
      } finally {
        for (const d of activeBitmapMap.values()) {
          if (d?.source && typeof (d.source as any).play === 'function') {
            (d.source as any).__offlineSeeking = false;
          }
        }
      }
    }

    // Engine B: MediaRecorder Fallback
    const streamCanvas = document.createElement('canvas');
    streamCanvas.width = width;
    streamCanvas.height = height;
    const sCtx = streamCanvas.getContext('2d')!;

    const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (actx.state === 'suspended') await actx.resume().catch(() => {});
    const dest = actx.createMediaStreamDestination();

    let renderAudioEl = new Audio(audioBlobUrl);
    renderAudioEl.crossOrigin = 'anonymous';
    renderAudioEl.currentTime = 0;
    renderAudioEl.volume = 1;
    const mediaSource = actx.createMediaElementSource(renderAudioEl);
    mediaSource.connect(dest);

    const canvasStream = (streamCanvas as any).captureStream ? streamCanvas.captureStream(fps) : null;
    if (!canvasStream) throw new Error('Dispositivo não suporta gravação de vídeo.');

    const combinedTracks = [
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ];
    const combinedStream = new MediaStream(combinedTracks);

    let mimeType = 'video/mp4';
    if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')) {
      mimeType = 'video/mp4;codecs=avc1,mp4a.40.2';
    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
      mimeType = 'video/mp4';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
      mimeType = 'video/webm;codecs=vp9,opus';
    } else {
      mimeType = 'video/webm';
    }

    const recorder = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: 2_500_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const recordingPromise = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = reject;
    });

    recorder.start(250);
    renderAudioEl.play().catch(() => {});

    const startTime = performance.now();
    let animId: number;

    const renderLoop = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      renderNarrativeFrame(
        sCtx,
        width,
        height,
        elapsed,
        audioDurationSec,
        sceneList,
        syncedSubtitles,
        syncedSceneWindows,
        currentTitle,
        shouldShowSubs,
        currentSubStyle,
        jobConfig,
        activeBitmapMap
      );

      const percent = Math.min(99, Math.round(60 + (elapsed / audioDurationSec) * 38));
      const pctFrames = Math.min(99, Math.round((elapsed / audioDurationSec) * 100));
      setProgressPercent(percent);
      setVideoTaskProgress(percent);
      setStatusMessage(`Gravando vídeo narrativo com locução (${pctFrames}%)...`);
      if (jobConfig?.jobId) {
        updateQueueItem(jobConfig.jobId, {
          progress: percent,
          statusText: `Gravando vídeo MP4 em segundo plano (${pctFrames}%)...`,
        });
      }
      if (targetVideoTaskId && onUpdateVideoTask) {
        onUpdateVideoTask(targetVideoTaskId, {
          progress: percent,
          statusText: `Gravando vídeo MP4 (${pctFrames}%)...`,
        });
      }

      if (elapsed < audioDurationSec) {
        animId = requestAnimationFrame(renderLoop);
      }
    };

    animId = requestAnimationFrame(renderLoop);

    await new Promise<void>((res) => {
      renderAudioEl.onended = () => res();
      setTimeout(res, (audioDurationSec + 0.5) * 1000);
    });

    cancelAnimationFrame(animId);
    if (recorder.state !== 'inactive') recorder.stop();
    renderAudioEl.pause();
    actx.close().catch(() => {});

    const recordedBlob = await recordingPromise;
    const recordedUrl = URL.createObjectURL(recordedBlob);

    return {
      blob: recordedBlob,
      url: recordedUrl,
      filename: mimeType.includes('webm') ? filename.replace(/\.mp4$/, '.webm') : filename,
    };
  };

  /**
   * Queue helpers for Background Production
   */
  const updateQueueItem = (id: string, updates: Partial<StudioQueueItem>) => {
    setQueueItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
    const jobData = activeJobDataMapRef.current.get(id);
    if (jobData?.whatsappJobId && updates.status !== 'completed') {
      const waStatus =
        updates.status === 'error' || updates.status === 'cancelled'
          ? 'error'
          : updates.status === 'rendering'
          ? 'rendering'
          : 'processing';
      fetch(`/api/whatsapp/jobs/${jobData.whatsappJobId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: waStatus,
          progress: updates.progress,
          statusText: updates.statusText,
          title: updates.title,
          error: updates.error,
        }),
      }).catch(() => {});
    }
  };

  const handleCancelQueueItem = (itemId: string) => {
    cancelledJobsRef.current.add(itemId);
    queueOrderRef.current = queueOrderRef.current.filter((id) => id !== itemId);
    updateQueueItem(itemId, {
      status: 'cancelled',
      statusText: 'Interrompido — clique em Retomar Renderização para continuar de onde parou',
    });
    if (onUpdateVideoTask) {
      onUpdateVideoTask(itemId, {
        status: 'cancelled',
        statusText: 'Interrompido — pronto para retomar do ponto que parou',
      });
    }
  };

  /**
   * Resumes a failed or interrupted narrative job from the exact stage and frame where it stopped
   */
  const handleResumeQueueItem = async (itemId: string) => {
    cancelledJobsRef.current.delete(itemId);
    if (lastFailedJobIdRef.current === itemId) {
      lastFailedJobIdRef.current = null;
      setErrorMessage(null);
    }

    // Load persisted checkpoint from IndexedDB if not in memory map
    const cp = getRenderCheckpointSync(itemId) || (await getRenderCheckpoint(itemId));
    const existingData = activeJobDataMapRef.current.get(itemId);
    if (!existingData && cp?.jobSnapshot) {
      activeJobDataMapRef.current.set(itemId, cp.jobSnapshot);
    }

    const jobData = activeJobDataMapRef.current.get(itemId);
    if (!jobData) {
      setErrorMessage('Não foi possível localizar os dados desta tarefa para retomar.');
      return;
    }

    const resumeProgress = cp?.progressPercent || jobData.lastProgress || 15;
    const resumeFrameInfo =
      cp && cp.lastCompletedFrame >= 0
        ? `a partir do frame ${cp.lastCompletedFrame + 1}/${cp.totalFrames} (${resumeProgress}%)`
        : jobData.cachedAudioBlob
        ? `a partir da renderização de vídeo (${resumeProgress}%)`
        : jobData.preloadedScenes?.length
        ? `a partir da locução neural (${resumeProgress}%)`
        : 'do ponto em que parou';

    setQueueItems((prev) => {
      const exists = prev.some((i) => i.id === itemId);
      if (exists) {
        return prev.map((i) =>
          i.id === itemId
            ? {
                ...i,
                status: 'rendering',
                progress: resumeProgress,
                statusText: `Retomando renderização ${resumeFrameInfo}...`,
                error: undefined,
              }
            : i
        );
      }
      return [
        {
          id: itemId,
          title: cp?.title || jobData.preloadedTitle || jobData.initialTitle || 'História Narrada',
          sourceLabel: 'Retomado',
          aspectRatio: cp?.aspectRatio || jobData.renderConfig?.aspectRatio || aspectRatio,
          status: 'rendering',
          progress: resumeProgress,
          statusText: `Retomando renderização ${resumeFrameInfo}...`,
          createdAt: Date.now(),
          voiceName: jobData.voice?.name || selectedVoice.name,
        },
        ...prev,
      ];
    });

    if (onUpdateVideoTask) {
      onUpdateVideoTask(itemId, {
        status: 'rendering',
        progress: resumeProgress,
        statusText: `Retomando ${resumeFrameInfo}...`,
        error: undefined,
      });
    }

    if (!queueOrderRef.current.includes(itemId)) {
      queueOrderRef.current.unshift(itemId);
    }

    if (!isQueueRunningRef.current) {
      runBackgroundQueue();
    }
  };

  // Check on mount if there is an interrupted roteiro_criativo checkpoint in IndexedDB, and handle external resumeTaskId
  useEffect(() => {
    getLatestRenderCheckpoint('roteiro_criativo')
      .then((cp) => {
        if (cp && cp.jobSnapshot) {
          activeJobDataMapRef.current.set(cp.taskId, cp.jobSnapshot);
          setQueueItems((prev) => {
            if (prev.some((i) => i.id === cp.taskId)) return prev;
            return [
              {
                id: cp.taskId,
                title: cp.title || cp.jobSnapshot.preloadedTitle || 'História Narrada',
                sourceLabel: 'Recuperado',
                aspectRatio: cp.aspectRatio || '16:9',
                status: 'error',
                progress: cp.progressPercent || 60,
                statusText: `Interrompido em ${cp.progressPercent || 60}% (frame ${cp.lastCompletedFrame + 1}/${cp.totalFrames}) — pronto para retomar`,
                createdAt: cp.updatedAt || Date.now(),
                voiceName: cp.jobSnapshot.voice?.name || 'Voz Neural',
              },
              ...prev,
            ];
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (resumeTaskId) {
      handleResumeQueueItem(resumeTaskId);
      if (onResumeHandled) onResumeHandled();
    }
  }, [resumeTaskId]);

  /**
   * Clears and resets the Roteiro Criativo workspace so it is 100% clean for immediate reuse
   */
  const handleClearCreativeWorkspace = () => {
    setStoryText('');
    setPremiseText('');
    setStoryTitle('');
    setFullNarration('');
    setStoryEntities([]);
    setScenes([]);
    setRenderedVideoBlob(null);
    setRenderedVideoUrl(null);
    setRenderedVideoFilename('');
    setGeneratedAudio(null);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setStatus('idle');
    setErrorMessage(null);
    setActiveJobId(null);
  };

  /**
   * Loads a completed background job into the editor/player when the user clicks "Carregar no Editor"
   */
  const handleSelectQueueItemToView = (item: StudioQueueItem) => {
    const jobData = activeJobDataMapRef.current.get(item.id);
    if (!jobData) return;

    setActiveJobId(item.id);
    if (jobData.storyTitle) setStoryTitle(jobData.storyTitle);
    if (jobData.fullNarration) setFullNarration(jobData.fullNarration);
    if (jobData.storyEntities) setStoryEntities(jobData.storyEntities);
    if (jobData.scenes) setScenes(jobData.scenes);
    if (jobData.speechBuffer) lastSpeechBufferRef.current = jobData.speechBuffer;
    if (jobData.audioObj) {
      setGeneratedAudio(jobData.audioObj);
      setDuration(jobData.audioObj.durationSeconds);
    }
    if (item.videoBlob && item.videoUrl) {
      setRenderedVideoBlob(item.videoBlob);
      setRenderedVideoUrl(item.videoUrl);
      setRenderedVideoFilename(item.downloadFilename || 'historia-narrada.mp4');
      setPlayerViewMode('exported');
    }
    setStatus('ready');
  };

  /**
   * Background Queue Runner: processes narrative video jobs in the background without blocking or dirtying the clean form
   */
  const runBackgroundQueue = async () => {
    if (isQueueRunningRef.current || queueOrderRef.current.length === 0) return;
    isQueueRunningRef.current = true;

    while (queueOrderRef.current.length > 0) {
      const currentJobId = queueOrderRef.current[0];
      const jobParams = activeJobDataMapRef.current.get(currentJobId);

      if (!jobParams) {
        queueOrderRef.current.shift();
        continue;
      }

      const audioTaskId = jobParams.audioTaskId || `${currentJobId}-audio`;
      const videoTaskId = currentJobId;
      currentAudioTaskIdRef.current = audioTaskId;
      currentVideoTaskIdRef.current = videoTaskId;

      try {
        let targetTitle = jobParams.preloadedTitle || jobParams.initialTitle || 'História Narrada';
        let effectiveNarration = jobParams.preloadedNarration || '';
        let targetScenes: NarrativeScene[] = jobParams.preloadedScenes || [];
        let detectedEntities: string[] = jobParams.preloadedEntities || [];

        // Step 1: Generate or Segment Script via Gemini Backend (skipped on resume if already completed!)
        if (!targetScenes.length || !effectiveNarration) {
          setAudioTaskStatus('processing');
          setAudioTaskProgress(15);
          setVideoTaskStatus('preparing');
          setVideoTaskProgress(10);
          setProgressPercent(15);

          updateQueueItem(currentJobId, {
            status: 'scripting',
            progress: 18,
            statusText: 'IA criando roteiro narrativo e selecionando ilustrações...',
          });
          setStatusMessage('IA criando roteiro narrativo cinematográfico em segundo plano...');
          if (onUpdateVideoTask) {
            onUpdateVideoTask(videoTaskId, {
              status: 'preparing',
              progress: 18,
              statusText: 'Criando roteiro com IA...',
            });
          }

          const scriptRes = await fetch('/api/narrative/generate-video-script', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: jobParams.inputMode,
              storyText: jobParams.storyText,
              premise: jobParams.premiseText,
              genre: jobParams.genre,
              tone: jobParams.tone,
              targetDurationSeconds: jobParams.targetDurationSeconds,
              aspectRatio: jobParams.renderConfig.aspectRatio,
            }),
          });

          if (!scriptRes.ok) {
            const errJson = await scriptRes.json().catch(() => ({}));
            throw new Error(errJson.error || 'Erro ao gerar roteiro criativo');
          }

          const scriptData = await scriptRes.json();
          targetScenes = scriptData.scenes || [];
          if (jobParams.customMedia && targetScenes.length > 0) {
            targetScenes[0].mediaUrl = jobParams.customMedia.url;
            targetScenes[0].exactMediaUrl = jobParams.customMedia.url;
            targetScenes[0].mediaType = jobParams.customMedia.mediaType;
            targetScenes[0].thumbnailUrl = jobParams.customMedia.url;
            targetScenes[0].visualSource = 'custom';
            if (targetScenes[0].caption) {
              targetScenes[0].caption = `${targetScenes[0].caption} (Mídia enviada via WhatsApp)`;
            }
          }
          const joinedFromScenes = targetScenes.map((s) => s.narrationSegment).filter(Boolean).join('\n\n');
          effectiveNarration = joinedFromScenes || scriptData.fullNarration;
          targetTitle = scriptData.title || targetTitle;
          detectedEntities = scriptData.storyEntities || [];

          // Immediately checkpoint Step 1 so a failure in Step 2 or Step 4 never re-runs script generation!
          const updatedAfterStep1 = {
            ...jobParams,
            preloadedTitle: targetTitle,
            preloadedNarration: effectiveNarration,
            preloadedScenes: targetScenes,
            preloadedEntities: detectedEntities,
            lastProgress: 38,
          };
          activeJobDataMapRef.current.set(currentJobId, updatedAfterStep1);
          Object.assign(jobParams, updatedAfterStep1);
        }

        // Step 2 & Step 3 in Parallel: Start Neural TTS Synthesis AND Open Quick Media Review Modal Simultaneously!
        let finalAudioBlob: Blob = jobParams.cachedAudioBlob;
        let finalAudioUrl: string = jobParams.cachedAudioUrl;
        let finalAudioDuration: number = jobParams.cachedAudioDuration;
        let speechBufferForSync: AudioBuffer | null = jobParams.cachedSpeechBuffer || null;
        let audioObj: GeneratedAudio = jobParams.audioObj;

        // Launch background TTS synthesis immediately as a parallel promise while user inspects/verifies media
        const synthesizeAudioPipeline = async () => {
          if (finalAudioBlob && finalAudioDuration) {
            if (!finalAudioUrl) finalAudioUrl = URL.createObjectURL(finalAudioBlob);
            return;
          }

          updateQueueItem(currentJobId, {
            title: targetTitle,
            status: 'synthesizing',
            progress: 42,
            statusText: `Sintetizando locução na voz neural ${jobParams.voice.name}...`,
          });
          setAudioTaskProgress(50);
          setProgressPercent(42);
          setStatusMessage(`Sintetizando locução na voz neural ${jobParams.voice.name}...`);

          if (onUpdateAudioTask) {
            onUpdateAudioTask(audioTaskId, {
              title: `Locução: ${targetTitle}`,
              status: 'processing',
              progress: 50,
              statusText: `Sintetizando voz de ${jobParams.voice.name}...`,
            });
          }
          if (onUpdateVideoTask) {
            onUpdateVideoTask(videoTaskId, {
              title: `Vídeo: ${targetTitle} (${jobParams.renderConfig.aspectRatio})`,
              status: 'preparing',
              progress: 40,
              statusText: 'Sintetizando locução e verificando mídias...',
            });
          }

          const ttsAudio = await fetchMultiVoiceTtsAudio(
            effectiveNarration,
            jobParams.voice,
            jobParams.speed,
            Boolean(jobParams.enableMultiVoice),
            jobParams.secondaryVoice
          );
          lastSpeechBufferRef.current = ttsAudio.speechBuffer;
          speechBufferForSync = ttsAudio.speechBuffer;

          finalAudioBlob = ttsAudio.blob;
          finalAudioUrl = ttsAudio.url;
          finalAudioDuration = ttsAudio.duration;

          const activeSfx: SceneSfxType = jobParams.sceneSfxType ?? 'none';
          const hasBgMusic = Boolean(jobParams.enableBgMusic && jobParams.bgMusicVolume > 0.01);
          const hasSceneSfx = Boolean(activeSfx !== 'none' && (jobParams.sceneSfxVolume ?? 0.55) > 0.01 && targetScenes.length > 1);

          if (hasBgMusic || hasSceneSfx) {
            try {
              const mixMsg = hasBgMusic
                ? jobParams.bgMusicTrackId === 'custom' && jobParams.customMusicName
                  ? `Mixando música "${jobParams.customMusicName}", auto-ducking e efeitos de corte...`
                  : 'Mixando trilha sonora com auto-ducking e efeitos sonoros de corte...'
                : 'Aplicando efeitos sonoros de transição de cena (Flash / Corte)...';
              updateQueueItem(currentJobId, { statusText: mixMsg });
              setStatusMessage(mixMsg);

              let speechBuf = ttsAudio.speechBuffer;
              if (!speechBuf) {
                speechBuf = await decodeAudioBlobOnce(ttsAudio.blob);
              }

              const musicBuffer = hasBgMusic
                ? await getAnyMusicAudioBuffer(jobParams.bgMusicTrackId, jobParams.customMusicBlob)
                : null;

              if (speechBuf) {
                const { sceneWindows: cutWindows } = buildSynchronizedNarrativeTimeline(
                  effectiveNarration,
                  targetScenes,
                  speechBuf.duration,
                  speechBuf
                );
                const sceneCutTimes = cutWindows.slice(1).map((w) => w.start);

                const mixedBuf = await mixSpeechWithBackgroundMusic(
                  speechBuf,
                  musicBuffer,
                  hasBgMusic ? jobParams.bgMusicVolume : 0,
                  speechBuf.duration,
                  {
                    autoDucking: jobParams.autoDucking ?? true,
                    sceneSfxType: activeSfx,
                    sceneSfxVolume: jobParams.sceneSfxVolume ?? 0.55,
                    sceneCutTimes,
                  }
                );
                const mixedWavBlob = audioBufferToWavBlob(mixedBuf);
                finalAudioBlob = mixedWavBlob;
                finalAudioUrl = URL.createObjectURL(mixedWavBlob);
                finalAudioDuration = mixedBuf.duration;
              }
            } catch (mixErr) {
              console.warn('Falha na mixagem de áudio/SFX:', mixErr);
            }
          }

          audioObj = {
            id: `narrative-audio-res-${Date.now()}`,
            title: targetTitle,
            voice: jobParams.voice,
            textSnippet: effectiveNarration.slice(0, 160),
            fullText: effectiveNarration,
            charCount: effectiveNarration.length,
            durationSeconds: finalAudioDuration,
            createdAt: Date.now(),
            audioUrl: finalAudioUrl,
            downloadUrl: finalAudioUrl,
            blob: finalAudioBlob,
            blobUrl: finalAudioUrl,
          };

          setQuickReviewModalState((prev) =>
            prev && prev.jobId === currentJobId
              ? {
                  ...prev,
                  audioStatusText: `✓ Locução na voz ${jobParams.voice.name} pronta! Confirme as mídias para finalizar o MP4.`,
                  isAudioReady: true,
                }
              : prev
          );
        };

        const audioPipelinePromise = synthesizeAudioPipeline();
        // Start preloading initial scene bitmaps in background simultaneously
        preloadSceneBitmaps(targetScenes).catch(() => {});

        // Show Quick Media Review Pop-up so user can verify found images/videos, replace broken ones, or paste links
        if (!jobParams.mediaVerified && !jobParams.isBatchItem && targetScenes.length > 0) {
          const reviewableScenes: ReviewableSceneMedia[] = targetScenes.map((sc, idx) => ({
            id: sc.id || `scene-${idx}`,
            index: idx,
            narrationSegment: sc.narrationSegment,
            caption: sc.caption,
            searchQuery: sc.searchTag || sc.caption,
            mediaType: sc.mediaType === 'video' ? 'video' : 'image',
            mediaUrl: sc.mediaUrl,
            originalUrl: sc.exactMediaUrl || sc.mediaUrl,
            thumbnailUrl: sc.thumbnailUrl || sc.mediaUrl,
            candidateUrls: (sc as any).candidateUrls || [],
            visualSource: sc.visualSource,
          }));

          const confirmedMedia = await new Promise<ReviewableSceneMedia[]>((resolve) => {
            quickReviewResolverRef.current = resolve;
            setQuickReviewModalState({
              isOpen: true,
              jobId: currentJobId,
              title: targetTitle,
              scenes: reviewableScenes,
              audioStatusText:
                finalAudioBlob && finalAudioDuration
                  ? `✓ Locução pronta! Confira as imagens e vídeos abaixo.`
                  : `🎙️ Sintetizando locução na voz ${jobParams.voice.name} em paralelo enquanto você confere as mídias...`,
              isAudioReady: Boolean(finalAudioBlob && finalAudioDuration),
            });
          });

          setQuickReviewModalState(null);
          quickReviewResolverRef.current = null;

          // Apply any media changes made by user in the Quick Review Pop-up
          targetScenes = targetScenes.map((sc, idx) => {
            const updated = confirmedMedia.find((m) => m.id === sc.id) || confirmedMedia[idx];
            if (!updated) return sc;
            return {
              ...sc,
              mediaType: updated.mediaType,
              mediaUrl: updated.mediaUrl,
              exactMediaUrl: updated.originalUrl || updated.mediaUrl,
              thumbnailUrl: updated.thumbnailUrl || updated.mediaUrl,
              visualSource: (updated.visualSource as any) || sc.visualSource,
            };
          });
          jobParams.mediaVerified = true;
          jobParams.preloadedScenes = targetScenes;
        }

        // Wait for parallel TTS pipeline to complete
        await audioPipelinePromise;

        // Checkpoint Step 2 so resuming a video render failure never re-synthesizes TTS audio!
        const updatedAfterStep2 = {
          ...jobParams,
          preloadedTitle: targetTitle,
          preloadedNarration: effectiveNarration,
          preloadedScenes: targetScenes,
          preloadedEntities: detectedEntities,
          cachedAudioBlob: finalAudioBlob,
          cachedAudioUrl: finalAudioUrl,
          cachedAudioDuration: finalAudioDuration,
          cachedSpeechBuffer: speechBufferForSync,
          audioObj,
          mediaVerified: true,
          lastProgress: 60,
        };
        activeJobDataMapRef.current.set(currentJobId, updatedAfterStep2);
        Object.assign(jobParams, updatedAfterStep2);

        setAudioTaskProgress(100);
        setAudioTaskStatus('completed');
        if (onUpdateAudioTask) {
          onUpdateAudioTask(audioTaskId, {
            status: 'completed',
            progress: 100,
            statusText: 'Locução concluída',
            resultAudio: audioObj,
            completedAt: Date.now(),
          });
        }

        // Step 3: Preload Media Bitmaps
        const existingCp = getRenderCheckpointSync(currentJobId) || (await getRenderCheckpoint(currentJobId));
        const startPct = existingCp?.progressPercent || 58;
        updateQueueItem(currentJobId, {
          status: 'rendering',
          progress: startPct,
          statusText:
            existingCp && existingCp.lastCompletedFrame >= 0
              ? `Recarregando mídias para retomar do frame ${existingCp.lastCompletedFrame + 1}/${existingCp.totalFrames}...`
              : 'Carregando mídias em alta resolução...',
        });
        const jobBitmapMap = await preloadSceneBitmaps(targetScenes);

        // Step 4: Video MP4 Rendering (with frame-accurate resume if checkpoint exists)
        setVideoTaskStatus('rendering');
        setVideoTaskProgress(Math.max(60, startPct));
        setProgressPercent(Math.max(60, startPct));
        const renderMsg =
          existingCp && existingCp.lastCompletedFrame >= 0
            ? `Retomando renderização MP4 do frame ${existingCp.lastCompletedFrame + 1}/${existingCp.totalFrames} (${startPct}%)...`
            : jobParams.renderConfig.showSubtitles
            ? 'Renderizando MP4 em segundo plano com legendas sincronizadas...'
            : 'Renderizando MP4 em segundo plano (legendas desativadas)...';
        updateQueueItem(currentJobId, {
          status: 'rendering',
          progress: Math.max(62, startPct),
          statusText: renderMsg,
        });
        setStatusMessage(renderMsg);
        if (onUpdateVideoTask) {
          onUpdateVideoTask(videoTaskId, {
            status: 'rendering',
            progress: Math.max(62, startPct),
            statusText: renderMsg,
          });
        }

        const finalVideoResult = await renderCompleteNarrativeVideo(
          finalAudioBlob,
          finalAudioUrl,
          effectiveNarration,
          targetScenes,
          finalAudioDuration,
          speechBufferForSync,
          targetTitle,
          {
            jobId: currentJobId,
            videoTaskId,
            ...jobParams.renderConfig,
          },
          jobBitmapMap
        );

        // Store completed job results in memory map so user can download or load into editor anytime
        activeJobDataMapRef.current.set(currentJobId, {
          ...jobParams,
          storyTitle: targetTitle,
          fullNarration: effectiveNarration,
          storyEntities: detectedEntities,
          scenes: targetScenes,
          speechBuffer: speechBufferForSync,
          audioObj,
          videoBlob: finalVideoResult.blob,
          videoUrl: finalVideoResult.url,
          filename: finalVideoResult.filename,
        });

        // Auto-populate the studio preview player with the finished video so the user immediately sees the rendered result with images
        setActiveJobId(currentJobId);
        setStoryTitle(targetTitle);
        setFullNarration(effectiveNarration);
        setStoryEntities(detectedEntities);
        setScenes(targetScenes);
        if (speechBufferForSync) lastSpeechBufferRef.current = speechBufferForSync;
        if (audioObj) {
          setGeneratedAudio(audioObj);
          setDuration(audioObj.durationSeconds);
        }
        setRenderedVideoBlob(finalVideoResult.blob);
        setRenderedVideoUrl(finalVideoResult.url);
        setRenderedVideoFilename(finalVideoResult.filename);
        setPlayerViewMode('exported');
        setStatus('ready');

        updateQueueItem(currentJobId, {
          title: targetTitle,
          status: 'completed',
          progress: 100,
          statusText: 'Vídeo MP4 100% pronto para baixar!',
          videoBlob: finalVideoResult.blob,
          videoUrl: finalVideoResult.url,
          downloadFilename: finalVideoResult.filename,
          completedAt: Date.now(),
        });

        setVideoTaskProgress(100);
        setVideoTaskStatus('completed');
        setProgressPercent(100);
        setStatusMessage(`Vídeo "${targetTitle}" concluído em segundo plano e pronto para download!`);

        // Persist project to IndexedDB History (Item 4)
        saveCreativeProjectToDB({
          id: currentJobId,
          title: targetTitle,
          storyText: jobParams.storyText || effectiveNarration,
          premiseText: jobParams.premiseText || '',
          fullNarration: effectiveNarration,
          storyEntities: detectedEntities,
          scenes: targetScenes,
          aspectRatio: jobParams.renderConfig.aspectRatio,
          voiceId: jobParams.voice.id,
          voiceName: jobParams.voice.name,
          durationSeconds: finalAudioDuration,
          createdAt: Date.now(),
          audioBlob: finalAudioBlob,
        })
          .then(() => getAllCreativeProjectsFromDB())
          .then((list) => setSavedProjects(list))
          .catch(() => {});

        if (onUpdateVideoTask) {
          onUpdateVideoTask(videoTaskId, {
            status: 'completed',
            progress: 100,
            statusText: 'Vídeo MP4 pronto para download',
            videoBlob: finalVideoResult.blob,
            videoUrl: finalVideoResult.url,
            downloadFilename: finalVideoResult.filename,
            completedAt: Date.now(),
          });
        }

        // If this job was triggered via WhatsApp Automation, upload MP4 and send back to WhatsApp group/user!
        if (jobParams.whatsappJobId && finalVideoResult.blob) {
          updateQueueItem(currentJobId, {
            statusText: 'Enviando vídeo MP4 concluído de volta para o WhatsApp...',
          });
          try {
            await fetch(`/api/whatsapp/jobs/${jobParams.whatsappJobId}/complete`, {
              method: 'POST',
              headers: {
                'Content-Type': 'video/mp4',
                'x-video-title': encodeURIComponent(targetTitle || 'História Narrada'),
                'x-video-caption': encodeURIComponent(effectiveNarration.slice(0, 240)),
                'x-video-filename': encodeURIComponent(finalVideoResult.filename || 'historia-narrada.mp4'),
              },
              body: finalVideoResult.blob,
            });
            updateQueueItem(currentJobId, {
              statusText: '✅ Vídeo MP4 concluído e enviado de volta no WhatsApp!',
            });
          } catch (waErr) {
            console.warn('Erro ao enviar vídeo concluído para WhatsApp:', waErr);
          }
        }
      } catch (err: any) {
        console.error('Background narrative job failed:', err);
        lastFailedJobIdRef.current = currentJobId;
        const cp = getRenderCheckpointSync(currentJobId);
        const failFrameNote =
          cp && cp.lastCompletedFrame >= 0
            ? ` (Parou no frame ${cp.lastCompletedFrame + 1}/${cp.totalFrames} · ${cp.progressPercent}%)`
            : '';
        const isCancelled = cancelledJobsRef.current.has(currentJobId);
        updateQueueItem(currentJobId, {
          status: isCancelled ? 'cancelled' : 'error',
          statusText:
            (isCancelled ? 'Pausado/Interrompido' : 'Erro: ' + (err.message || 'Falha na produção do vídeo')) +
            failFrameNote,
          error: err.message,
        });
        if (onUpdateAudioTask && !jobParams.cachedAudioBlob) {
          onUpdateAudioTask(audioTaskId, { status: 'error', statusText: 'Erro na síntese' });
        }
        if (onUpdateVideoTask) {
          onUpdateVideoTask(videoTaskId, {
            status: isCancelled ? 'cancelled' : 'error',
            statusText: `Interrompido${failFrameNote} — clique em Retomar Renderização`,
            error: err.message,
          });
        }
      } finally {
        queueOrderRef.current.shift();
      }
    }

    isQueueRunningRef.current = false;
  };

  /**
   * Re-renders video in background using the current scenes and updated settings, freeing the editor immediately
   */
  const handleRegenerateWithCurrentScenes = async () => {
    if (scenes.length === 0 || !fullNarration.trim()) {
      return handleStartWorkflow();
    }

    const jobId = `nar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const audioTaskId = `${jobId}-audio`;
    const activeTitle = storyTitle || 'História Narrada (Ajustada)';

    const newJob: StudioQueueItem = {
      id: jobId,
      title: activeTitle,
      sourceLabel: `${scenes.length} cenas · Ajustado`,
      aspectRatio,
      status: 'queued',
      progress: 10,
      statusText: 'Atualização enviada para produção em segundo plano...',
      createdAt: Date.now(),
      voiceName: selectedVoice.name,
    };

    setQueueItems((prev) => [newJob, ...prev]);
    queueOrderRef.current.push(jobId);

    if (onAddAudioTask) {
      onAddAudioTask({
        id: audioTaskId,
        title: `Locução: ${activeTitle}`,
        textSnippet: fullNarration.slice(0, 120),
        charCount: fullNarration.length,
        voice: selectedVoice,
        settings: { rate: speed, pitch: '+0Hz', volume: '+0%' },
        status: 'queued',
        progress: 10,
        statusText: 'Na fila em segundo plano...',
        createdAt: Date.now(),
      });
    }

    if (onAddVideoTask) {
      onAddVideoTask({
        id: jobId,
        title: `Vídeo: ${activeTitle} (${aspectRatio})`,
        aspectRatio,
        fitMode: 'blur_capcut',
        status: 'queued',
        progress: 10,
        fps: 30,
        statusText: 'Na fila em segundo plano...',
        createdAt: Date.now(),
      });
    }

    activeJobDataMapRef.current.set(jobId, {
      audioTaskId,
      initialTitle: activeTitle,
      preloadedTitle: activeTitle,
      preloadedNarration: fullNarration,
      preloadedScenes: [...scenes],
      preloadedEntities: [...storyEntities],
      inputMode,
      storyText,
      premiseText,
      genre,
      tone,
      targetDurationSeconds,
      voice: selectedVoice,
      enableMultiVoice,
      secondaryVoice,
      speed,
      enableBgMusic,
      bgMusicTrackId,
      bgMusicVolume,
      autoDucking,
      sceneSfxType,
      sceneSfxVolume,
      customMusicBlob,
      customMusicName,
      renderConfig: {
        aspectRatio,
        visualTheme,
        motionEffect,
        motionIntensity,
        showWaveform,
        waveformStyle,
        waveformColor,
        showSubtitles,
        subtitleStyle,
        subtitlePosition,
        wordByWordHighlight,
        sceneSfxType,
      },
    });

    // Clean the Roteiro Criativo workspace immediately so user can reuse it cleanly
    handleClearCreativeWorkspace();
    setQueueNotice('✓ Vídeo enviado para geração em segundo plano! O Roteiro Criativo foi limpo e está livre para novo uso.');
    setTimeout(() => setQueueNotice(null), 6000);

    if (!isQueueRunningRef.current) {
      runBackgroundQueue();
    }
  };

  /**
   * Main 1-Click Action ("Gerar Vídeo Narrativo Completo"):
   * Supports Single Story, Premise, or Batch Queue Mode (multiple scripts separated by ---)
   */
  const handleStartWorkflow = async () => {
    if (inputMode === 'batch_mode') {
      const scripts = batchScriptsText
        .split(/\n\s*---+\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (scripts.length === 0) {
        setErrorMessage('Por favor, cole pelo menos um roteiro no modo em lote (separe múltiplos roteiros com ---).');
        return;
      }
      setErrorMessage(null);

      const newQueueBatch: StudioQueueItem[] = [];
      for (let i = 0; i < scripts.length; i++) {
        const scriptItem = scripts[i];
        const jobId = `nar-batch-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`;
        const audioTaskId = `${jobId}-audio`;
        const cleanSnippet = scriptItem.replace(/\[https?:\/\/[^\]]+\]/gi, '').replace(/\[[^\]]+\]/g, '').trim();
        const itemTitle = cleanSnippet
          ? `Lote #${i + 1}: ${cleanSnippet.slice(0, 34)}${cleanSnippet.length > 34 ? '...' : ''}`
          : `Roteiro em Lote #${i + 1}`;

        newQueueBatch.push({
          id: jobId,
          title: itemTitle,
          sourceLabel: `Lote (${i + 1}/${scripts.length})`,
          aspectRatio,
          status: 'queued',
          progress: 5,
          statusText: `Aguardando na fila em lote (${i + 1}/${scripts.length})...`,
          createdAt: Date.now() + i,
          voiceName: selectedVoice.name,
        });

        queueOrderRef.current.push(jobId);

        if (onAddAudioTask) {
          onAddAudioTask({
            id: audioTaskId,
            title: `Locução: ${itemTitle}`,
            textSnippet: cleanSnippet.slice(0, 120),
            charCount: scriptItem.length,
            voice: selectedVoice,
            settings: { rate: speed, pitch: '+0Hz', volume: '+0%' },
            status: 'queued',
            progress: 5,
            statusText: 'Na fila em lote...',
            createdAt: Date.now() + i,
          });
        }
        if (onAddVideoTask) {
          onAddVideoTask({
            id: jobId,
            title: `Vídeo: ${itemTitle} (${aspectRatio})`,
            aspectRatio,
            fitMode: 'blur_capcut',
            status: 'queued',
            progress: 5,
            fps: 30,
            statusText: 'Na fila em lote...',
            createdAt: Date.now() + i,
          });
        }

        activeJobDataMapRef.current.set(jobId, {
          audioTaskId,
          initialTitle: itemTitle,
          isBatchItem: true,
          inputMode: 'full_prompt',
          storyText: scriptItem,
          premiseText: '',
          genre,
          tone,
          targetDurationSeconds,
          voice: selectedVoice,
          enableMultiVoice,
          secondaryVoice,
          speed,
          enableBgMusic,
          bgMusicTrackId,
          bgMusicVolume,
          autoDucking,
          sceneSfxType,
          sceneSfxVolume,
          customMusicBlob,
          customMusicName,
          renderConfig: {
            aspectRatio,
            visualTheme,
            motionEffect,
            motionIntensity,
            showWaveform,
            waveformStyle,
            waveformColor,
            showSubtitles,
            subtitleStyle,
            subtitlePosition,
            wordByWordHighlight,
            sceneSfxType,
          },
        });
      }

      setQueueItems((prev) => [...newQueueBatch, ...prev]);
      setBatchScriptsText('');
      handleClearCreativeWorkspace();
      setQueueNotice(`✓ ${scripts.length} roteiro(s) adicionados à fila em lote para produção automática em segundo plano!`);
      setTimeout(() => setQueueNotice(null), 6000);

      if (!isQueueRunningRef.current) {
        runBackgroundQueue();
      }
      return;
    }

    if (inputMode === 'full_prompt' && !storyText.trim()) {
      setErrorMessage('Por favor, cole ou digite a história completa antes de gerar o vídeo.');
      return;
    }
    if (inputMode === 'idea_theme' && !premiseText.trim()) {
      setErrorMessage('Por favor, escreva a ideia ou premissa da história.');
      return;
    }

    setErrorMessage(null);

    const jobId = `nar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const audioTaskId = `${jobId}-audio`;
    const rawSnippet = (inputMode === 'full_prompt' ? storyText : premiseText).trim();
    const cleanSnippet = rawSnippet.replace(/\[https?:\/\/[^\]]+\]/gi, '').trim();
    const initialTitle =
      storyTitle.trim() ||
      (cleanSnippet ? cleanSnippet.slice(0, 42) + (cleanSnippet.length > 42 ? '...' : '') : 'História Narrada');

    const newJob: StudioQueueItem = {
      id: jobId,
      title: initialTitle,
      sourceLabel: inputMode === 'full_prompt' ? 'Roteiro Completo' : `Tema: ${genre}`,
      aspectRatio,
      status: 'queued',
      progress: 5,
      statusText: 'Iniciando produção em segundo plano...',
      createdAt: Date.now(),
      voiceName: selectedVoice.name,
    };

    setQueueItems((prev) => [newJob, ...prev]);
    queueOrderRef.current.push(jobId);

    if (onAddAudioTask) {
      onAddAudioTask({
        id: audioTaskId,
        title: `Locução: ${initialTitle}`,
        textSnippet: cleanSnippet.slice(0, 120),
        charCount: rawSnippet.length,
        voice: selectedVoice,
        settings: { rate: speed, pitch: '+0Hz', volume: '+0%' },
        status: 'queued',
        progress: 5,
        statusText: 'Preparando roteiro narrativo em segundo plano...',
        createdAt: Date.now(),
      });
    }

    if (onAddVideoTask) {
      onAddVideoTask({
        id: jobId,
        title: `Vídeo: ${initialTitle} (${aspectRatio})`,
        aspectRatio,
        fitMode: 'blur_capcut',
        status: 'queued',
        progress: 5,
        fps: 30,
        statusText: 'Produzindo em segundo plano...',
        createdAt: Date.now(),
      });
    }

    // Snapshot all current inputs & settings for this background job
    activeJobDataMapRef.current.set(jobId, {
      audioTaskId,
      initialTitle,
      inputMode,
      storyText: storyText.trim(),
      premiseText: premiseText.trim(),
      genre,
      tone,
      targetDurationSeconds,
      voice: selectedVoice,
      enableMultiVoice,
      secondaryVoice,
      speed,
      enableBgMusic,
      bgMusicTrackId,
      bgMusicVolume,
      autoDucking,
      sceneSfxType,
      sceneSfxVolume,
      customMusicBlob,
      customMusicName,
      renderConfig: {
        aspectRatio,
        visualTheme,
        motionEffect,
        motionIntensity,
        showWaveform,
        waveformStyle,
        waveformColor,
        showSubtitles,
        subtitleStyle,
        subtitlePosition,
        wordByWordHighlight,
        sceneSfxType,
      },
    });

    // Immediately clean the Roteiro Criativo form and workspace so it is 100% free for reuse!
    handleClearCreativeWorkspace();
    setQueueNotice('✓ Vídeo enviado para geração em segundo plano! O Roteiro Criativo foi limpo e já está livre para você criar outro vídeo.');
    setTimeout(() => setQueueNotice(null), 6000);

    // Trigger background worker if not already running
    if (!isQueueRunningRef.current) {
      runBackgroundQueue();
    }
  };

  // Listen for automated WhatsApp creative video jobs
  useEffect(() => {
    const handleWhatsAppCreative = (e: Event) => {
      const customEv = e as CustomEvent;
      const waJob = customEv.detail;
      if (!waJob || !waJob.parsed?.content) return;

      const jobId = `nar-wa-${waJob.id}`;
      if (activeJobDataMapRef.current.has(jobId)) return;

      const audioTaskId = `${jobId}-audio`;
      const rawContent = String(waJob.parsed.content).trim();
      const isPremise = waJob.parsed.inputMode === 'premise_ai';
      const studioInputMode = isPremise ? 'idea_theme' : 'full_prompt';
      const cleanSnippet = rawContent.replace(/\[https?:\/\/[^\]]+\]/gi, '').trim();
      const initialTitle = `WhatsApp · ${cleanSnippet.slice(0, 36)}${cleanSnippet.length > 36 ? '...' : ''}`;

      const matchedVoice =
        CURATED_VOICES.find((v) => v.id === waJob.parsed.voiceId) || selectedVoice;
      const jobAspectRatio: VideoAspectRatio = waJob.parsed.aspectRatio || aspectRatio;
      const jobDuration = waJob.parsed.durationSeconds || targetDurationSeconds;
      const jobSubtitles = waJob.parsed.showSubtitles ?? showSubtitles;
      const jobBgMusic = waJob.parsed.enableBgMusic ?? enableBgMusic;

      const newJob: StudioQueueItem = {
        id: jobId,
        title: initialTitle,
        sourceLabel: `WhatsApp (${waJob.groupName || 'Grupo'})`,
        aspectRatio: jobAspectRatio,
        status: 'queued',
        progress: 8,
        statusText: 'Recebido via WhatsApp — iniciando produção automática...',
        createdAt: Date.now(),
        voiceName: matchedVoice.name,
      };

      setQueueItems((prev) => [newJob, ...prev]);
      queueOrderRef.current.push(jobId);

      if (onAddAudioTask) {
        onAddAudioTask({
          id: audioTaskId,
          title: `Locução WhatsApp: ${initialTitle}`,
          textSnippet: cleanSnippet.slice(0, 120),
          charCount: rawContent.length,
          voice: matchedVoice,
          settings: { rate: speed, pitch: '+0Hz', volume: '+0%' },
          status: 'queued',
          progress: 8,
          statusText: 'Aguardando na fila do WhatsApp...',
          createdAt: Date.now(),
        });
      }

      if (onAddVideoTask) {
        onAddVideoTask({
          id: jobId,
          title: `Vídeo: ${initialTitle} (${jobAspectRatio})`,
          aspectRatio: jobAspectRatio,
          fitMode: 'blur_capcut',
          status: 'queued',
          progress: 8,
          fps: 30,
          statusText: 'Automação WhatsApp em andamento...',
          createdAt: Date.now(),
        });
      }

      activeJobDataMapRef.current.set(jobId, {
        whatsappJobId: waJob.id,
        mediaVerified: true, // Hands-free mode for WhatsApp automation
        isBatchItem: true,
        audioTaskId,
        initialTitle,
        inputMode: studioInputMode,
        storyText: isPremise ? '' : rawContent,
        premiseText: isPremise ? rawContent : '',
        genre,
        tone,
        targetDurationSeconds: jobDuration,
        voice: matchedVoice,
        enableMultiVoice,
        secondaryVoice,
        speed,
        enableBgMusic: jobBgMusic,
        bgMusicTrackId,
        bgMusicVolume,
        autoDucking,
        sceneSfxType,
        sceneSfxVolume,
        customMusicBlob,
        customMusicName,
        renderConfig: {
          aspectRatio: jobAspectRatio,
          visualTheme,
          motionEffect,
          motionIntensity,
          showWaveform,
          waveformStyle,
          waveformColor,
          showSubtitles: jobSubtitles,
          subtitleStyle,
          subtitlePosition,
          wordByWordHighlight,
          sceneSfxType,
        },
        customMedia: (waJob as any).customMedia || (waJob as any).parsed?.customMedia,
      });

      if (!isQueueRunningRef.current) {
        runBackgroundQueue();
      }
    };

    window.addEventListener('whatsapp-enqueue-creative', handleWhatsAppCreative);
    return () => window.removeEventListener('whatsapp-enqueue-creative', handleWhatsAppCreative);
  }, [
    selectedVoice,
    enableMultiVoice,
    secondaryVoice,
    speed,
    aspectRatio,
    visualTheme,
    motionEffect,
    motionIntensity,
    showWaveform,
    waveformStyle,
    waveformColor,
    showSubtitles,
    subtitleStyle,
    subtitlePosition,
    wordByWordHighlight,
    sceneSfxType,
    sceneSfxVolume,
    enableBgMusic,
    bgMusicTrackId,
    bgMusicVolume,
    autoDucking,
    customMusicBlob,
    customMusicName,
    genre,
    tone,
    targetDurationSeconds,
  ]);

  // Search additional media for a specific scene (strictly links in [] or direct URLs)
  const handleOpenMediaSearch = (sceneIndex: number) => {
    setMediaSearchTargetSceneIndex(sceneIndex);
    const sc = scenes[sceneIndex];
    const initialQuery = sc?.searchTag || sc?.exactMediaUrl || sc?.mediaUrl || '';
    setMediaSearchQuery(initialQuery);
    setMediaSearchResults([]);
    setIsMediaSearchModalOpen(true);
    if (initialQuery && (initialQuery.includes('http') || initialQuery.includes('['))) {
      triggerMediaSearch(initialQuery);
    }
  };

  const triggerMediaSearch = async (q: string) => {
    if (!q.trim()) return;
    setIsSearchingMedia(true);

    // Look for URL directly or inside brackets [http...]
    const urlMatch = q.match(/https?:\/\/[^\s\]"']+/i);
    if (urlMatch) {
      const directUrl = urlMatch[0];
      const isVid = directUrl.toLowerCase().includes('.mp4') || directUrl.toLowerCase().includes('.webm');
      setMediaSearchResults([
        {
          id: `direct-${Date.now()}`,
          url: directUrl,
          thumbUrl: directUrl,
          title: 'Link Direto Fornecido [URL]',
          source: 'URL Direta' as any,
          type: isVid ? 'video' : 'image',
        },
      ]);
      setIsSearchingMedia(false);
      return;
    }

    // Per instruction: "Tire a pesquisa por termos será só por links em [] somente esse tipo só links"
    // If not a URL, do not search third party web terms.
    setMediaSearchResults([]);
    setIsSearchingMedia(false);
  };

  const handleApplyMediaToSceneWithIndex = (sceneIndex: number, url: string, type: 'image' | 'video') => {
    setScenes((prev) => {
      const updated = prev.map((sc, idx) =>
        idx === sceneIndex
          ? {
              ...sc,
              mediaUrl: url,
              thumbnailUrl: url,
              exactMediaUrl: url.startsWith('http') ? url : undefined,
              searchTag: `[${url}]`,
              searchQuery: url,
              mediaType: type,
            }
          : sc
      );
      preloadSceneBitmaps(updated);
      return updated;
    });
  };

  const handleApplyMediaToScene = (url: string, type: 'image' | 'video') => {
    handleApplyMediaToSceneWithIndex(mediaSearchTargetSceneIndex, url, type);
    setIsMediaSearchModalOpen(false);
  };

  const handleUpdateSceneSearchTag = (sceneIndex: number, newTag: string) => {
    setScenes((prev) =>
      prev.map((sc, idx) => {
        if (idx !== sceneIndex) return sc;
        const clean = newTag.trim();
        const urlMatch = clean.match(/https?:\/\/[^\s\]"']+/i);
        const directUrl = urlMatch ? urlMatch[0] : undefined;
        return {
          ...sc,
          searchTag: newTag,
          searchQuery: directUrl || newTag,
          exactMediaUrl: directUrl,
        };
      })
    );
  };

  const handleExecuteSceneSearchTag = async (sceneIndex: number) => {
    const sc = scenes[sceneIndex];
    if (!sc) return;
    const rawTag = (sc.searchTag || sc.searchQuery || '').trim();
    if (!rawTag) return;

    // Check if it is a direct URL or contains URL inside []
    const urlMatch = rawTag.match(/https?:\/\/[^\s\]"']+/i);
    if (urlMatch) {
      const directUrl = urlMatch[0];
      const isVid = directUrl.toLowerCase().includes('.mp4') || directUrl.toLowerCase().includes('.webm');
      handleApplyMediaToSceneWithIndex(sceneIndex, directUrl, isVid ? 'video' : 'image');
      return;
    }

    // If user typed something that is not a link, alert that only links in [] are accepted
    alert('A pesquisa é feita exclusivamente por links em [ ]! Insira um link direto como [https://site.com/imagem.jpg].');
  };

  // Audio Playback Handler
  const togglePlayAudio = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch((e) => console.warn(e));
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-amber-950/40 via-neutral-900/80 to-purple-950/40 border border-neutral-800 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300">
                <BookOpen className="h-5 w-5" />
              </span>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                <span>Roteiro Criativo para Vídeo</span>
                <span className="text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800">
                  Histórias & Contos
                </span>
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-neutral-300 mt-1.5 max-w-3xl leading-relaxed">
              Transforme histórias completas ou ideias resumidas em vídeos cinematográficos. A IA divide a narrativa em cenas, busca ilustrações e filmagens contextuais em alta resolução, gera a locução neural e sincroniza legendas dinâmicas estilo CapCut.
            </p>
          </div>

          {/* Quick Task Monitor Shortcut */}
          {onOpenTaskManager && (
            <button
              type="button"
              onClick={onOpenTaskManager}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-neutral-300 bg-neutral-800/80 hover:bg-neutral-700/80 border border-neutral-700 rounded-xl transition-all cursor-pointer shrink-0"
              title="Abrir painel de processamento simultâneo"
            >
              <Zap className="h-4 w-4 text-amber-400" />
              <span>Tarefas Simultâneas</span>
            </button>
          )}
        </div>
      </div>

      {/* Feedback Notice when video is sent to background and workspace is cleaned */}
      {queueNotice && (
        <div className="p-3.5 bg-emerald-950/80 border border-emerald-500/80 rounded-xl text-emerald-200 text-xs font-bold flex items-center justify-between gap-2 animate-in fade-in shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{queueNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setQueueNotice(null)}
            className="text-emerald-300 hover:text-white px-1.5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Background Production Queue (Allows generating multiple narrative videos while Roteiro Criativo stays clean & free) */}
      <StudioTaskQueue
        items={queueItems}
        activeItemId={activeJobId}
        onSelectToView={handleSelectQueueItemToView}
        onDownload={(item) => {
          if (item.videoBlob) {
            downloadBlob(item.videoBlob, item.downloadFilename || 'historia-narrada.mp4');
          }
        }}
        onCancel={handleCancelQueueItem}
        onResume={handleResumeQueueItem}
        onClearCompleted={() => setQueueItems((prev) => prev.filter((i) => i.status !== 'completed'))}
      />

      {/* Mode Switcher: Fornecer História Pronta vs Criar a partir de Tema/Premissa vs Fila em Lote */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-neutral-950/90 p-1.5 rounded-2xl border border-neutral-800">
        <button
          type="button"
          onClick={() => setInputMode('full_prompt')}
          className={`flex items-center justify-center gap-2 p-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            inputMode === 'full_prompt'
              ? 'bg-neutral-800 text-white shadow-md border border-neutral-700'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
          }`}
        >
          <FileText className="h-4 w-4 text-cyan-400" />
          <span>1. História Pronta (Roteiro Completo)</span>
        </button>

        <button
          type="button"
          onClick={() => setInputMode('idea_theme')}
          className={`flex items-center justify-center gap-2 p-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            inputMode === 'idea_theme'
              ? 'bg-neutral-800 text-white shadow-md border border-neutral-700'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
          }`}
        >
          <Sparkles className="h-4 w-4 text-amber-400" />
          <span>2. Pedir Tema (Premissa Resumida)</span>
        </button>

        <button
          type="button"
          onClick={() => setInputMode('batch_mode')}
          className={`flex items-center justify-center gap-2 p-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            inputMode === 'batch_mode'
              ? 'bg-neutral-800 text-white shadow-md border border-neutral-700'
              : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
          }`}
        >
          <Layers className="h-4 w-4 text-emerald-400" />
          <span>3. Fila em Lote (Vários Roteiros ---)</span>
        </button>
      </div>

      {/* Main Input Configuration Form */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-6">
        {/* MODE 1: Full Story Input */}
        {inputMode === 'full_prompt' && (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                <span>Cole ou Digite a sua História / Narrativa Completa</span>
                <span className="text-[10px] text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded-full border border-cyan-800">
                  Texto Preservado
                </span>
              </label>
              <span className="text-xs text-neutral-400">
                A IA manterá sua história e buscará mídias contextuais para ilustrar cada cena.
              </span>
            </div>

            <div className="flex items-start gap-2.5 p-3 bg-cyan-950/40 border border-cyan-800/60 rounded-xl text-xs text-cyan-200 leading-relaxed">
              <Sparkles className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white">Links de Mídia [ ]:</strong> Para cada cena, a imagem ou vídeo é definida <strong>exclusivamente por links diretos</strong> entre colchetes <code className="bg-neutral-900 px-1.5 py-0.5 rounded text-cyan-300 font-mono">[https://exemplo.com/foto.jpg]</code>. Pesquisa por termos de texto foi desativada: somente links diretos em [] são aceitos.
              </div>
            </div>

            <textarea
              rows={6}
              value={storyText}
              onChange={(e) => setStoryText(e.target.value)}
              placeholder="Exemplo com links diretos [URL]:&#10;[https://upload.wikimedia.org/.../senna.jpg] Ayrton Senna venceu em Interlagos com apenas a sexta marcha em uma das maiores façanhas do esporte.&#10;[https://images.unsplash.com/.../podium.jpg] A torcida brasileira explodiu em celebração inesquecível.&#10;[https://upload.wikimedia.org/.../car.jpg] A velocidade sempre foi a sua maior devoção nas pistas."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3.5 text-xs sm:text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/50 transition-all font-mono leading-relaxed"
            />

            {/* Quick Templates Chips */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-neutral-400">Testar com exemplos de histórias:</span>
              <div className="flex flex-wrap gap-2">
                {PRESET_STORY_PROMPTS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setStoryText(p.text);
                      setStoryTitle(p.title);
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700/60 transition-all cursor-pointer"
                  >
                    📖 {p.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* MODE 2: Premise / Idea Theme Input */}
        {inputMode === 'idea_theme' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                <span>Premissa ou Ideia Central Resumida</span>
                <span className="text-[10px] text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded-full border border-amber-800">
                  IA Escreve a História
                </span>
              </label>
              <textarea
                rows={3}
                value={premiseText}
                onChange={(e) => setPremiseText(e.target.value)}
                placeholder="Exemplo: Um explorador descobre uma cidade de cristal suspensa nas nuvens e percebe que as nuvens são formadas pelas lembranças dos oceanos da Terra..."
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3.5 text-xs sm:text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/50 transition-all leading-relaxed"
              />
            </div>

            {/* Genre and Tone Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">Gênero da Narrativa</label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  {STORY_GENRES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">Tom da Narração</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  {STORY_TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Preset Premise Chips */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-semibold text-neutral-400">Sugestões de premissas rápidas:</span>
              <div className="flex flex-wrap gap-2">
                {PRESET_PREMISES.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setPremiseText(p.premise);
                      setGenre(p.genre);
                      setTone(p.tone);
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700/60 transition-all cursor-pointer"
                  >
                    💡 {p.genre}: {p.premise.slice(0, 42)}...
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* MODE 3: Batch Scripts Queue Input (Item 4) */}
        {inputMode === 'batch_mode' && (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                <span>Fila de Produção em Lote (Múltiplos Roteiros de Uma Vez)</span>
                <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800">
                  Separar com ---
                </span>
              </label>
              <span className="text-xs text-neutral-400">
                Separe cada roteiro com uma linha contendo <code className="text-emerald-300 font-mono">---</code>
              </span>
            </div>

            <textarea
              rows={7}
              value={batchScriptsText}
              onChange={(e) => setBatchScriptsText(e.target.value)}
              placeholder={`[https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1280&q=80] Primeiro roteiro completo aqui com suas cenas e links.\n---\n[https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1280&q=80] Segundo roteiro completo que será gerado automaticamente na sequência.\n---\n[https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1280&q=80] Terceiro roteiro da fila em lote.`}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3.5 text-xs sm:text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-emerald-500/80 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono leading-relaxed"
            />

            <div className="flex items-center justify-between text-[11px] text-neutral-400">
              <span>
                Roteiros identificados no lote:{' '}
                <strong className="text-emerald-400">
                  {batchScriptsText.split(/\n\s*---+\s*\n/).map((s) => s.trim()).filter(Boolean).length}
                </strong>
              </span>
              <button
                type="button"
                onClick={() =>
                  setBatchScriptsText(
                    `${PRESET_STORY_PROMPTS[0]?.text || ''}\n---\n${PRESET_STORY_PROMPTS[1]?.text || ''}`
                  )
                }
                className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-emerald-300 border border-neutral-700 cursor-pointer"
              >
                Preencher Exemplo de Lote (2 Roteiros)
              </button>
            </div>
          </div>
        )}

        {/* DURATION CONFIGURATION */}
        <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-400" />
              <label className="text-xs sm:text-sm font-bold text-white">
                {inputMode === 'full_prompt' ? 'Duração do Vídeo (Fiel ao Texto)' : 'Quantidade de Tempo do Vídeo (Duração Alvo)'}
              </label>
              {durationSavedFeedback && (
                <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800 animate-in fade-in">
                  ✓ Configuração salva
                </span>
              )}
            </div>
            <span className="text-xs text-neutral-400">
              {inputMode === 'full_prompt'
                ? 'Vídeo acompanha 100% o tempo da narração completa do seu texto'
                : 'Ajuste manual com salvamento automático de configurações'}
            </span>
          </div>

          {inputMode === 'full_prompt' ? (
            <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-xl text-xs text-amber-200 leading-relaxed flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white">Tempo Fiel ao Texto Narrado:</strong> O vídeo terá <strong>exatamente a duração da locução do seu texto</strong>. Não há corte, resumo ou compressão: se o texto narrado tiver 3 minutos ou 10 minutos, o vídeo terá 3 minutos ou 10 minutos completos, com cada imagem sincronizada ao seu respectivo parágrafo.
              </div>
            </div>
          ) : (
            <>
              {/* Quick Duration Chips */}
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { sec: 30, label: '30s (Shorts/Reels)' },
                  { sec: 45, label: '45s' },
                  { sec: 60, label: '60s (1 min)' },
                  { sec: 90, label: '90s (1.5 min)' },
                  { sec: 120, label: '120s (2 min)' },
                  { sec: 180, label: '180s (3 min)' },
                  { sec: 300, label: '300s (5 min)' },
                ].map((item) => (
                  <button
                    key={item.sec}
                    type="button"
                    onClick={() => handleUpdateDuration(item.sec)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                      targetDurationSeconds === item.sec
                        ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-md font-bold'
                        : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-neutral-700 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Manual Slider & Numeric Minutes/Seconds Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center pt-1">
                <div className="sm:col-span-8 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-neutral-400">
                    <span>Slider de Tempo Contínuo:</span>
                    <span className="font-mono font-bold text-amber-300">
                      {Math.floor(targetDurationSeconds / 60)}m {targetDurationSeconds % 60}s ({targetDurationSeconds} segundos)
                    </span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={300}
                    step={5}
                    value={targetDurationSeconds}
                    onChange={(e) => handleUpdateDuration(parseInt(e.target.value, 10))}
                    className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
                    <span>15s</span>
                    <span>1 min</span>
                    <span>2 min</span>
                    <span>3 min</span>
                    <span>5 min</span>
                  </div>
                </div>

                {/* Direct Minutes / Seconds numeric inputs */}
                <div className="sm:col-span-4 flex items-center gap-2">
                  <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg p-2 flex items-center justify-between">
                    <span className="text-[11px] text-neutral-400 font-medium">Min:</span>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={Math.floor(targetDurationSeconds / 60)}
                      onChange={(e) => {
                        const m = Math.max(0, parseInt(e.target.value, 10) || 0);
                        const s = targetDurationSeconds % 60;
                        handleUpdateDuration(m * 60 + s);
                      }}
                      className="w-12 bg-neutral-950 text-right text-xs font-mono font-bold text-white rounded p-1 border border-neutral-800 focus:outline-none"
                    />
                  </div>

                  <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg p-2 flex items-center justify-between">
                    <span className="text-[11px] text-neutral-400 font-medium">Seg:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      step={5}
                      value={targetDurationSeconds % 60}
                      onChange={(e) => {
                        const s = Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0));
                        const m = Math.floor(targetDurationSeconds / 60);
                        handleUpdateDuration(m * 60 + s);
                      }}
                      className="w-12 bg-neutral-950 text-right text-xs font-mono font-bold text-white rounded p-1 border border-neutral-800 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* EFEITOS, FORMATO, MÚSICA & ONDA (Configurações herdadas do VideoVozLivre) */}
        <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800 pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-cyan-400" />
              <h3 className="text-xs sm:text-sm font-bold text-white">
                Efeitos, Formato, Música & Onda Sonora (Configuração do Vídeo)
              </h3>
              {configSavedFeedback && (
                <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-800 animate-in fade-in">
                  ✓ Configuração Salva!
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleSaveConfiguration()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-cyan-300 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-800 rounded-lg transition-all cursor-pointer shrink-0"
              title="Salvar esta configuração no navegador"
            >
              <Bookmark className="h-3.5 w-3.5" />
              <span>Salvar Essa Configuração</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Formato (Aspect Ratio) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
                <span>Formato de Tela</span>
                <span className="text-[10px] text-cyan-400 font-mono font-bold">{aspectRatio}</span>
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => {
                  const ar = e.target.value as VideoAspectRatio;
                  setAspectRatio(ar);
                  handleSaveConfiguration();
                }}
                className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
              >
                <option value="16:9">16:9 (Horizontal / TV / YouTube)</option>
                <option value="9:16">9:16 (Vertical / Shorts / Reels / TikTok)</option>
                <option value="1:1">1:1 (Quadrado / Feed Instagram)</option>
                <option value="4:5">4:5 (Retrato / Instagram Post)</option>
                <option value="21:9">21:9 (Cinemático Ultrawide)</option>
              </select>
            </div>

            {/* 2. Efeitos de Movimento de Imagem */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between">
                <span>Efeito de Movimento</span>
                <span className="text-[10px] text-amber-400 font-mono font-bold">Ken Burns</span>
              </label>
              <select
                value={motionEffect}
                onChange={(e) => {
                  setMotionEffect(e.target.value as any);
                  handleSaveConfiguration();
                }}
                className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 cursor-pointer"
              >
                <option value="zoom-in">Zoom In Suave (Ken Burns)</option>
                <option value="zoom-out">Afastamento Gradual (Zoom Out)</option>
                <option value="pan-left">Panorâmica para Esquerda</option>
                <option value="pan-right">Panorâmica para Direita</option>
                <option value="pulse">Pulso Dinâmico</option>
                <option value="none">Estático (Sem Movimento)</option>
              </select>
            </div>

            {/* 3. Voz Neural */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-300">Voz Neural</label>
              <select
                value={selectedVoice.id}
                onChange={(e) => {
                  const found = CURATED_VOICES.find((v) => v.id === e.target.value);
                  if (found) {
                    setSelectedVoice(found);
                    handleSaveConfiguration();
                  }
                }}
                className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
              >
                {CURATED_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.gender}) - {v.langLabel}
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Estilo Visual de Fundo */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-300">Estilo Visual</label>
              <select
                value={visualTheme}
                onChange={(e) => {
                  setVisualTheme(e.target.value as any);
                  handleSaveConfiguration();
                }}
                className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
              >
                <option value="cinematica">Cinematográfico (Carvão & Ouro)</option>
                <option value="fantasia">Noite Mágica (Violeta & Estrelas)</option>
                <option value="misterio">Névoa Profunda (Verde Ciano)</option>
                <option value="acolhedor">Nostalgia Quente (Âmbar & Sépia)</option>
                <option value="documentario">Documentário Minimalista</option>
              </select>
            </div>
          </div>

          {/* SOUND DESIGN DE TRANSIÇÃO (SOM DE FLASH PARA CORTE) & NARRAÇÃO MULTI-VOZ (Item 2) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-neutral-800/80">
            {/* Efeito Sonoro de Corte de Cena (com Som de Flash para Corte) */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-amber-400" />
                  <span>Efeito Sonoro de Corte entre Cenas (SFX)</span>
                </span>
                <button
                  type="button"
                  onClick={() => playSfxPreview(sceneSfxType, sceneSfxVolume)}
                  disabled={sceneSfxType === 'none'}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 border border-amber-500/40 text-amber-300 text-[10px] font-bold cursor-pointer transition-colors"
                  title="Testar som do efeito de corte"
                >
                  <Volume2 className="h-3 w-3" />
                  <span>Testar Som</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                <div className="sm:col-span-7">
                  <select
                    value={sceneSfxType}
                    onChange={(e) => {
                      const val = e.target.value as SceneSfxType;
                      setSceneSfxType(val);
                      if (val !== 'none') playSfxPreview(val, sceneSfxVolume);
                      handleSaveConfiguration();
                    }}
                    className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 focus:outline-none focus:border-amber-400 cursor-pointer"
                  >
                    {SCENE_SFX_PRESETS.map((sfx) => (
                      <option key={sfx.id} value={sfx.id}>
                        {sfx.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-5 flex items-center gap-2">
                  <span className="text-[10px] text-neutral-400 shrink-0">Vol:</span>
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={sceneSfxVolume}
                    onChange={(e) => {
                      setSceneSfxVolume(parseFloat(e.target.value));
                      handleSaveConfiguration();
                    }}
                    className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                  />
                  <span className="text-[10px] font-mono font-bold text-amber-300 w-8 text-right">
                    {Math.round(sceneSfxVolume * 100)}%
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-neutral-400 leading-tight">
                {sceneSfxType === 'flash_cut'
                  ? '📸 Aplica o som de Flash fotográfico + clarão visual suave a cada corte de imagem.'
                  : SCENE_SFX_PRESETS.find((s) => s.id === sceneSfxType)?.description}
              </p>
            </div>

            {/* Narração Multi-Voz (Narrador + Personagens / Diálogos) */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableMultiVoice}
                    onChange={(e) => {
                      setEnableMultiVoice(e.target.checked);
                      handleSaveConfiguration();
                    }}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-cyan-400 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Radio className="h-4 w-4 text-cyan-400" />
                    <span>Narração Multi-Voz (Diálogos & Tags [Voz: ...])</span>
                  </span>
                </label>
                <span className="text-[10px] text-cyan-300 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800 font-bold">
                  2 Vozes Neurais
                </span>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-neutral-400">2ª Voz (Falas entre &quot;aspas&quot; ou [Voz: Secundária]):</label>
                <select
                  value={secondaryVoice.id}
                  onChange={(e) => {
                    const found = CURATED_VOICES.find((v) => v.id === e.target.value);
                    if (found) {
                      setSecondaryVoice(found);
                      handleSaveConfiguration();
                    }
                  }}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-cyan-200 focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  {CURATED_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.gender}) - {v.langLabel}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] text-neutral-400 leading-tight">
                Você também pode trocar de voz em qualquer trecho usando <code className="text-cyan-300 font-mono">[Voz: Antonio]</code> ou <code className="text-cyan-300 font-mono">[Voz: Francisca]</code>.
              </p>
            </div>
          </div>

          {/* LEGENDAS SINCRONIZADAS, MÚSICA DE FUNDO (COM IMPORTAÇÃO) E VISUALIZADOR DE ONDA (Linha 2) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-neutral-800/80">
            {/* A. Legendas Sincronizadas (Ativar / Desativar + Estilo) */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSubtitles}
                    onChange={(e) => {
                      setShowSubtitles(e.target.checked);
                      handleSaveConfiguration();
                    }}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-amber-400 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Subtitles className="h-4 w-4 text-amber-400" />
                    <span>Legendas Sincronizadas</span>
                  </span>
                </label>

                <div className="inline-flex rounded-lg bg-neutral-950 p-0.5 border border-neutral-800">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSubtitles(true);
                      handleSaveConfiguration();
                    }}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                      showSubtitles
                        ? 'bg-amber-400 text-neutral-950'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Ativar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSubtitles(false);
                      handleSaveConfiguration();
                    }}
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors cursor-pointer ${
                      !showSubtitles
                        ? 'bg-rose-500/90 text-white'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Desativar
                  </button>
                </div>
              </div>

              {showSubtitles ? (
                <div className="space-y-2.5 pt-1 animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <label className="text-[11px] text-neutral-400">Estilo Visual da Legenda (Sincronizada com a Voz):</label>
                    <select
                      value={subtitleStyle}
                      onChange={(e) => {
                        setSubtitleStyle(e.target.value as any);
                        handleSaveConfiguration();
                      }}
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 focus:outline-none focus:border-amber-400 cursor-pointer"
                    >
                      <option value="capcut_yellow">Estilo CapCut (Amarelo Dinâmico Sincronizado)</option>
                      <option value="classic_white">Normal (Clássico Branco Sincronizado)</option>
                      <option value="cinematic_serif">Normal Serifado (Cinematográfico Sincronizado)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-neutral-400">Posição na Tela:</label>
                      <select
                        value={subtitlePosition}
                        onChange={(e) => {
                          setSubtitlePosition(e.target.value as any);
                          handleSaveConfiguration();
                        }}
                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-400 cursor-pointer"
                      >
                        <option value="bottom">Inferior (Padrão)</option>
                        <option value="center">Centro (Reels/Shorts)</option>
                        <option value="top">Superior (Topo)</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-neutral-400">Modo de Sincronia:</label>
                      <button
                        type="button"
                        onClick={() => {
                          setWordByWordHighlight(!wordByWordHighlight);
                          handleSaveConfiguration();
                        }}
                        className={`w-full py-1 px-2 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${
                          wordByWordHighlight
                            ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                            : 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                        }`}
                      >
                        {wordByWordHighlight ? '✓ CapCut (Palavra a Palavra)' : '✓ Normal (Frase Sincronizada)'}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-emerald-300 bg-emerald-950/50 border border-emerald-800/60 rounded-lg px-2.5 py-1.5">
                    <span>✓ Sincronia exata com a voz (Estilo CapCut e Normal 100% sincronizados)</span>
                    {fullNarration && (
                      <button
                        type="button"
                        onClick={handleDownloadSrt}
                        className="text-amber-300 hover:text-amber-200 underline font-bold cursor-pointer ml-2"
                      >
                        Baixar .SRT
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="pt-1 animate-in fade-in duration-200">
                  <div className="text-[11px] text-neutral-400 bg-neutral-950/80 border border-neutral-800 rounded-lg p-2.5 leading-relaxed">
                    <span className="text-rose-300 font-semibold block mb-0.5">Legendas Desativadas</span>
                    O vídeo será gerado limpo, sem textos ou legendas sobrepostos às cenas.
                  </div>
                </div>
              )}

              {scenes.length > 0 && status === 'ready' && (
                <button
                  type="button"
                  onClick={handleRegenerateWithCurrentScenes}
                  className="w-full py-1.5 px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Atualizar Legendas no Vídeo</span>
                </button>
              )}
            </div>

            {/* B. Música de Fundo & Importar Música Própria */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableBgMusic}
                    onChange={(e) => {
                      setEnableBgMusic(e.target.checked);
                      handleSaveConfiguration();
                    }}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-cyan-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Music className="h-4 w-4 text-cyan-400" />
                    <span>Música de Fundo</span>
                  </span>
                </label>

                {/* Botão direto para importar música do dispositivo */}
                <label
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-200 text-[10px] font-bold cursor-pointer transition-colors"
                  title="Importar arquivo de música MP3, WAV, OGG ou M4A do seu computador ou celular"
                >
                  <Upload className="h-3 w-3 text-cyan-400" />
                  <span>Importar Música</span>
                  <input
                    ref={customMusicInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac"
                    onChange={handleCustomMusicUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {enableBgMusic ? (
                <div className="space-y-2.5 pt-1 animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-neutral-400">Trilha Sonora Selecionada:</label>
                      <button
                        type="button"
                        onClick={handleToggleMusicPreview}
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-300 hover:text-cyan-200 cursor-pointer"
                        title="Ouvir prévia da trilha sonora"
                      >
                        {isPlayingMusicPreview ? (
                          <>
                            <Pause className="h-3 w-3 text-amber-400" />
                            <span className="text-amber-300">Parar Prévia</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3" />
                            <span>Ouvir Prévia</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <select
                        value={bgMusicTrackId}
                        onChange={(e) => {
                          setBgMusicTrackId(e.target.value);
                          handleSaveConfiguration();
                        }}
                        className="flex-1 bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-cyan-200 focus:outline-none focus:border-cyan-400 cursor-pointer"
                      >
                        {customMusicName && (
                          <optgroup label="Música Importada do Seu Dispositivo">
                            <option value="custom">
                              📁 [Importada] {customMusicName}
                            </option>
                          </optgroup>
                        )}
                        <optgroup label="Trilhas Instrumentais do Estúdio">
                          {BG_MUSIC_PRESETS.map((m) => (
                            <option key={m.id} value={m.id}>
                              🎵 {m.name} — {m.category}
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      {bgMusicTrackId === 'custom' && customMusicName && (
                        <button
                          type="button"
                          onClick={handleRemoveCustomMusic}
                          className="p-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 cursor-pointer"
                          title="Remover música importada"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span>Volume da Música:</span>
                      <span className="font-mono text-cyan-300 font-bold">{Math.round(bgMusicVolume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.02}
                      max={0.50}
                      step={0.01}
                      value={bgMusicVolume}
                      onChange={(e) => {
                        setBgMusicVolume(parseFloat(e.target.value));
                        handleSaveConfiguration();
                      }}
                      className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                    <div className="flex justify-between text-[9px] text-neutral-500 font-mono">
                      <span>2% (Sutil)</span>
                      <span>15% (Ideal)</span>
                      <span>50% (Marcante)</span>
                    </div>

                    <label className="flex items-center gap-2 pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoDucking}
                        onChange={(e) => {
                          setAutoDucking(e.target.checked);
                          handleSaveConfiguration();
                        }}
                        className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-950 text-cyan-400 focus:ring-0 cursor-pointer"
                      />
                      <span className="text-[10px] text-cyan-200 font-medium">
                        Auto-Ducking Inteligente (reduz música na fala e sobe nas pausas)
                      </span>
                    </label>
                  </div>

                  {scenes.length > 0 && status === 'ready' && (
                    <button
                      type="button"
                      onClick={handleRegenerateWithCurrentScenes}
                      className="w-full py-1.5 px-2.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Aplicar Música no Vídeo</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="pt-1 space-y-2 animate-in fade-in duration-200">
                  <div className="text-[11px] text-neutral-400 bg-neutral-950/80 border border-neutral-800 rounded-lg p-2.5 leading-relaxed">
                    Ative para usar uma trilha instrumental ou clique em <strong className="text-cyan-300">Importar Música</strong> para enviar seu próprio MP3/WAV.
                  </div>
                </div>
              )}
            </div>

            {/* C. Visualizador de Onda Sonora (Waveform) */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showWaveform}
                    onChange={(e) => {
                      setShowWaveform(e.target.checked);
                      handleSaveConfiguration();
                    }}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-cyan-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-cyan-400" />
                    <span>Visualizador de Onda Sonora</span>
                  </span>
                </label>
                {showWaveform && (
                  <span className="text-[10px] text-cyan-300 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800 font-mono font-bold uppercase">
                    {waveformStyle} · {waveformColor}
                  </span>
                )}
              </div>

              {showWaveform && (
                <div className="grid grid-cols-2 gap-2 pt-1 animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <label className="text-[11px] text-neutral-400">Estilo da Onda:</label>
                    <select
                      value={waveformStyle}
                      onChange={(e) => {
                        setWaveformStyle(e.target.value as any);
                        handleSaveConfiguration();
                      }}
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
                    >
                      <option value="bars">Barras Dinâmicas</option>
                      <option value="line">Linha Oscilante</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-neutral-400">Cor da Onda:</label>
                    <select
                      value={waveformColor}
                      onChange={(e) => {
                        setWaveformColor(e.target.value as any);
                        handleSaveConfiguration();
                      }}
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
                    >
                      <option value="cyan">Ciano Neon</option>
                      <option value="emerald">Esmeralda</option>
                      <option value="violet">Violeta</option>
                      <option value="amber">Âmbar Dourado</option>
                      <option value="white">Branco Puro</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Button: Start 1-Click Background Production & Clean Workspace */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>Ao gerar o vídeo, ele vai para segundo plano e o Roteiro Criativo fica limpo e livre na hora.</span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
            {(storyText.trim() || premiseText.trim() || scenes.length > 0 || renderedVideoUrl) && (
              <button
                type="button"
                onClick={handleClearCreativeWorkspace}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-3 text-xs font-bold text-neutral-300 hover:text-white bg-neutral-800/90 hover:bg-neutral-700 border border-neutral-700 rounded-xl transition-all cursor-pointer"
                title="Limpar todo o roteiro criativo atual"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Limpar Roteiro</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleStartWorkflow}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3 text-sm font-bold text-neutral-950 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 rounded-xl transition-all shadow-lg shadow-amber-950/40 active:scale-95 cursor-pointer"
            >
              <Film className="h-4 w-4 text-neutral-950" />
              <span>Gerar Vídeo Narrativo Completo</span>
              {queueItems.some((i) => i.status !== 'completed' && i.status !== 'error' && i.status !== 'cancelled') && (
                <span className="px-2 py-0.5 text-[10px] rounded-full bg-neutral-950/90 text-amber-300 font-mono">
                  +{queueItems.filter((i) => i.status !== 'completed' && i.status !== 'error' && i.status !== 'cancelled').length} em 2º plano
                </span>
              )}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="rounded-xl bg-rose-950/50 border border-rose-800/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-rose-200">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">{errorMessage}</div>
            </div>
            {lastFailedJobIdRef.current && (
              <button
                type="button"
                onClick={() => lastFailedJobIdRef.current && handleResumeQueueItem(lastFailedJobIdRef.current)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold transition-all cursor-pointer shrink-0 shadow-md"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Retomar Renderização do Ponto que Parou</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* DUAL SIMULTANEOUS PROCESSING MONITOR (Active in background while editor remains clean & unlocked) */}
      {queueItems.some((i) => i.status !== 'completed' && i.status !== 'error' && i.status !== 'cancelled') && (
        <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-5 space-y-4 shadow-2xl animate-in fade-in duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="h-3 w-3 rounded-full bg-amber-400 animate-pulse" />
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Monitor de Processamento em Segundo Plano (Áudio & Vídeo)</span>
                <span className="text-[10px] text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800 uppercase font-mono">
                  Editor Livre
                </span>
              </h3>
            </div>
            <span className="text-xs font-mono font-bold text-amber-400">
              Progresso da Tarefa Atual: {progressPercent}%
            </span>
          </div>

          {/* Dual Gauges: Audio Pipeline & Video Pipeline */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Audio Processing Pipeline */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-cyan-400" />
                  <span className="text-xs font-bold text-white">Pipeline de Áudio Neural</span>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                  audioTaskStatus === 'completed'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : audioTaskStatus === 'processing'
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800 animate-pulse'
                    : 'bg-neutral-800 text-neutral-400'
                }`}>
                  {audioTaskStatus === 'completed' ? '✓ Áudio Pronto' : audioTaskStatus === 'processing' ? 'Sintetizando...' : 'Em Fila'}
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Locução Neural & Mixagem</span>
                  <span className="font-mono font-bold text-cyan-300">{audioTaskProgress}%</span>
                </div>
                <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full transition-all duration-300"
                    style={{ width: `${audioTaskProgress}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 2. Video Processing Pipeline */}
            <div className="bg-neutral-900/90 border border-neutral-800 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Film className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-bold text-white">Pipeline de Vídeo MP4 & Mídias</span>
                </div>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                  videoTaskStatus === 'completed'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : videoTaskStatus === 'rendering'
                    ? 'bg-amber-950 text-amber-300 border border-amber-800 animate-pulse'
                    : 'bg-neutral-800 text-neutral-400'
                }`}>
                  {videoTaskStatus === 'completed' ? '✓ Vídeo Pronto' : videoTaskStatus === 'rendering' ? 'Renderizando...' : 'Preparando'}
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-neutral-400">
                  <span>Renderização MP4 em 2º Plano</span>
                  <span className="font-mono font-bold text-amber-300">{videoTaskProgress}%</span>
                </div>
                <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-amber-500 to-yellow-400 h-full transition-all duration-300"
                    style={{ width: `${videoTaskProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-neutral-400 pt-1">
            <span className="truncate">{statusMessage}</span>
            <span className="text-[11px] text-emerald-400 font-semibold">Você pode continuar criando novos roteiros acima</span>
          </div>
        </div>
      )}

      {/* STORYBOARD & SCENE EDITOR (Inspect and replace images/videos for each scene) */}
      {scenes.length > 0 && (
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Storyboard Narrativo: {storyTitle || 'Cenas da História'} ({scenes.length} cenas)
                </h3>
              </div>
              <p className="text-xs text-neutral-400 mt-1">
                Cada cena possui seu trecho falado e sua mídia contextual. Clique em "Trocar Mídia" para buscar outras imagens ou vídeos.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  const updated = await openQuickMediaReview(
                    storyTitle || 'Roteiro Criativo',
                    scenes
                  );
                  if (updated) {
                    setScenes(updated);
                    await preloadSceneBitmaps(updated);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-cyan-300 bg-cyan-950/70 hover:bg-cyan-900/80 border border-cyan-800/80 rounded-lg transition-colors cursor-pointer"
                title="Abrir pop-up rápido para verificar todas as imagens e vídeos, detectar links quebrados ou buscar novas mídias"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Verificar / Trocar Mídias</span>
              </button>
              <button
                type="button"
                onClick={handleClearCreativeWorkspace}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                title="Limpar e fechar este projeto do editor"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Limpar Editor</span>
              </button>
              <button
                type="button"
                onClick={handleRegenerateWithCurrentScenes}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-300 bg-amber-950/70 hover:bg-amber-900/80 border border-amber-800/80 rounded-lg transition-colors cursor-pointer"
                title="Envia a re-renderização para segundo plano mantendo as cenas atuais e limpa o editor"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Regerar em 2º Plano</span>
              </button>
            </div>
          </div>

          {/* Real Story Entities Detected */}
          {storyEntities.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 p-3 bg-neutral-950/80 border border-neutral-800/90 rounded-xl text-xs">
              <span className="text-amber-400 font-bold flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5" />
                <span>Tópicos & Entidades Reais Identificados:</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {storyEntities.map((ent, eIdx) => (
                  <span
                    key={eIdx}
                    className="px-2 py-0.5 rounded-md bg-neutral-800 text-neutral-200 border border-neutral-700 font-medium text-[11px]"
                  >
                    {ent}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Scenes Gallery Grid (Compact, responsive, zero excessive vertical stack) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-96 overflow-y-auto pr-1">
            {scenes.map((scene, idx) => {
              const cleanCap = cleanCaptionText(scene.caption);
              const cleanNarration = cleanCaptionText(scene.narrationSegment.replace(/\[pausa.*?\]/gi, ''));
              return (
                <div
                  key={scene.id}
                  className="group relative bg-neutral-950/90 border border-neutral-800 hover:border-cyan-500/80 rounded-xl overflow-hidden flex flex-col justify-between p-2.5 space-y-2 transition-all hover:bg-neutral-900/60 hover:shadow-lg hover:shadow-cyan-950/20"
                >
                  <div className="space-y-1.5">
                    {/* Thumbnail / Media Preview */}
                    <div className="relative aspect-video rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800 group/thumb">
                      {scene.mediaUrl ? (
                        <>
                          <img
                            src={scene.thumbnailUrl || scene.mediaUrl}
                            alt=""
                            aria-hidden="true"
                            className="absolute inset-0 w-full h-full object-cover scale-110 blur-md brightness-75"
                          />
                          <img
                            src={scene.thumbnailUrl || scene.mediaUrl}
                            alt={cleanCap || 'Mídia da cena'}
                            className="relative z-10 w-full h-full object-contain drop-shadow-lg transition-transform group-hover/thumb:scale-105"
                          />
                        </>
                      ) : (
                        <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
                          Sem mídia
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => handleOpenMediaSearch(idx)}
                        className="absolute inset-0 bg-neutral-950/75 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center gap-1 text-[11px] font-bold text-white transition-opacity cursor-pointer"
                        title="Trocar imagem ou link da cena"
                      >
                        <ImageIcon className="h-3.5 w-3.5 text-cyan-400" />
                        <span>Trocar Link</span>
                      </button>

                      {scene.mediaType === 'video' && (
                        <span className="absolute bottom-1 right-1 bg-black/80 text-amber-300 text-[8px] font-bold px-1 rounded flex items-center gap-0.5">
                          🎬 Vídeo
                        </span>
                      )}
                    </div>

                    {/* Clean caption: strictly no 'Cena X:' and no quotes */}
                    <p className="text-[11px] font-medium text-neutral-200 line-clamp-2 leading-tight" title={cleanCap || cleanNarration}>
                      {cleanCap || cleanNarration.slice(0, 50)}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-1.5 border-t border-neutral-850 text-[10px]">
                    <span className="text-neutral-500 font-mono">
                      #{idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleOpenMediaSearch(idx)}
                      className="text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer"
                    >
                      Alterar ↗
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FINAL VIDEO & AUDIO PLAYER (Ready State) */}
      {(renderedVideoUrl || generatedAudio) && (
        <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-5 shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <h3 className="text-base sm:text-lg font-bold text-white">
                  Produção Concluída: {storyTitle || 'Vídeo Narrativo'}
                </h3>
              </div>
              <p className="text-xs text-neutral-400 mt-1">
                Duração real: {Math.round(duration)}s · Voz: {selectedVoice.name} · Resolução: {aspectRatio === '9:16' ? '720x1280 (9:16)' : '1280x720 (16:9)'}
              </p>
            </div>

            {/* Download Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {renderedVideoBlob && (
                <button
                  type="button"
                  onClick={() => downloadBlob(renderedVideoBlob, renderedVideoFilename || 'historia-video.mp4')}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-neutral-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>Baixar Vídeo MP4</span>
                </button>
              )}

              {scenes.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleDownloadThumbnail(0)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-amber-300 bg-amber-950/80 hover:bg-amber-900 border border-amber-800 rounded-xl transition-colors cursor-pointer"
                  title="Gerar e baixar imagem de Capa (Thumbnail HD) com desfoque e título"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>Baixar Capa HD</span>
                </button>
              )}

              {fullNarration && (
                <button
                  type="button"
                  onClick={handleDownloadSrt}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-cyan-300 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-800 rounded-xl transition-colors cursor-pointer"
                  title="Baixar arquivo de legendas sincronizadas (.SRT)"
                >
                  <Subtitles className="h-3.5 w-3.5" />
                  <span>Baixar .SRT</span>
                </button>
              )}

              {generatedAudio?.blob && (
                <button
                  type="button"
                  onClick={() => downloadBlob(generatedAudio.blob!, `${storyTitle || 'historia'}.mp3`)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-neutral-300 bg-neutral-800 hover:bg-neutral-700 rounded-xl transition-colors cursor-pointer"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Baixar MP3</span>
                </button>
              )}

              {onTransferToVideo && generatedAudio && (
                <button
                  type="button"
                  onClick={() => onTransferToVideo(generatedAudio)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-violet-300 bg-violet-950/70 hover:bg-violet-900/80 border border-violet-800 rounded-xl transition-colors cursor-pointer"
                  title="Editar no VideoVozLivre"
                >
                  <Film className="h-3.5 w-3.5" />
                  <span>Abrir no VideoVozLivre</span>
                </button>
              )}
            </div>
          </div>

          {/* Video Preview */}
          {renderedVideoUrl && (
            <div className="flex justify-center bg-black/60 rounded-xl p-3 border border-neutral-800 overflow-hidden">
              <video
                src={renderedVideoUrl}
                controls
                playsInline
                className={`rounded-lg max-h-[500px] object-contain shadow-2xl ${
                  aspectRatio === '9:16' ? 'aspect-[9/16]' : 'aspect-video w-full'
                }`}
              />
            </div>
          )}

          {/* Full Narration Text Box */}
          <div className="bg-neutral-950 rounded-xl p-4 border border-neutral-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-neutral-400">
              <span>Texto Completo da Narração:</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(fullNarration);
                  alert('Texto da história copiado!');
                }}
                className="text-amber-400 hover:text-amber-300 cursor-pointer"
              >
                Copiar Texto
              </button>
            </div>
            <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed max-h-36 overflow-y-auto">
              {fullNarration}
            </p>
          </div>
        </div>
      )}

      {/* PERSISTENT SAVED PROJECTS HISTORY (IndexedDB - Item 4) */}
      {savedProjects.length > 0 && (
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
            <div className="flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">
                Histórico Persistente de Projetos Salvos ({savedProjects.length})
              </h3>
            </div>
            <span className="text-[11px] text-neutral-400">
              Salvos no navegador (IndexedDB) — reabra e reedite mesmo após fechar a página
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto pr-1">
            {savedProjects.map((proj) => (
              <div
                key={proj.id}
                className="bg-neutral-950/90 border border-neutral-800 hover:border-amber-500/50 rounded-xl p-3 flex flex-col justify-between gap-2.5 transition-all"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white truncate">{proj.title}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-amber-300 shrink-0">
                      {proj.aspectRatio}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed">
                    {proj.fullNarration}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-neutral-800/80 text-[10px]">
                  <span className="text-neutral-500">
                    {proj.scenes?.length || 0} cenas · {proj.voiceName}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleLoadSavedProject(proj)}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold cursor-pointer"
                    >
                      Reabrir no Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSavedProject(proj.id)}
                      className="p-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 cursor-pointer"
                      title="Excluir do histórico"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Media Review Pop-up Modal (Averiguação Rápida de Imagens e Vídeos) */}
      {quickReviewModalState && (
        <QuickMediaReviewModal
          isOpen={quickReviewModalState.isOpen}
          studioTitle={quickReviewModalState.title}
          studioType="roteiro"
          initialScenes={quickReviewModalState.scenes}
          audioStatusText={quickReviewModalState.audioStatusText}
          isAudioReady={quickReviewModalState.isAudioReady}
          onConfirm={(updated) => {
            if (quickReviewResolverRef.current) {
              quickReviewResolverRef.current(updated);
            }
          }}
          onCancel={() => {
            if (quickReviewResolverRef.current) {
              quickReviewResolverRef.current(quickReviewModalState.scenes);
            }
          }}
        />
      )}

      {/* MEDIA URL / SWAP MODAL */}
      {isMediaSearchModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-xl w-full p-5 sm:p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-cyan-400" />
                  <span>Definir Link da Mídia para a Cena #{mediaSearchTargetSceneIndex + 1}</span>
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Somente links diretos em [ ] são aceitos (http:// ou https://) ou arquivo direto do seu PC.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsMediaSearchModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Direct URL Input */}
            <div className="space-y-2 bg-neutral-950/80 p-4 rounded-xl border border-neutral-800">
              <label className="text-xs font-bold text-white flex items-center gap-1.5">
                <span className="text-cyan-400 font-mono">[URL]</span>
                <span>Cole o Link Direto da Imagem ou Vídeo:</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={mediaSearchQuery}
                  onChange={(e) => setMediaSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const urlMatch = mediaSearchQuery.match(/https?:\/\/[^\s\]"']+/i);
                      if (urlMatch) {
                        const directUrl = urlMatch[0];
                        const isVid = directUrl.toLowerCase().includes('.mp4') || directUrl.toLowerCase().includes('.webm');
                        handleApplyMediaToScene(directUrl, isVid ? 'video' : 'image');
                      } else {
                        alert('Por favor, insira um link direto válido iniciando com https:// ou http://');
                      }
                    }
                  }}
                  placeholder="https://exemplo.com/minha-imagem.jpg ou [https://...]"
                  className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-3.5 py-2 text-xs text-cyan-200 placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    const urlMatch = mediaSearchQuery.match(/https?:\/\/[^\s\]"']+/i);
                    if (urlMatch) {
                      const directUrl = urlMatch[0];
                      const isVid = directUrl.toLowerCase().includes('.mp4') || directUrl.toLowerCase().includes('.webm');
                      handleApplyMediaToScene(directUrl, isVid ? 'video' : 'image');
                    } else {
                      alert('Por favor, insira um link direto válido iniciando com https:// ou http://');
                    }
                  }}
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-neutral-950 font-bold text-xs rounded-xl transition-colors cursor-pointer shrink-0"
                >
                  Aplicar Link
                </button>
              </div>
              <span className="text-[11px] text-neutral-500 block">
                Exemplos suportados: links diretos de fotos em JPG, PNG, WEBP ou vídeos MP4.
              </span>
            </div>

            {/* Direct File Upload */}
            <div className="bg-neutral-950/80 p-4 rounded-xl border border-neutral-800 space-y-2">
              <label className="text-xs font-bold text-white block">
                Ou selecione uma mídia do seu computador:
              </label>
              <label className="flex items-center justify-center gap-2 p-3 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 font-semibold text-xs rounded-xl cursor-pointer transition-colors border border-neutral-700">
                <Upload className="h-4 w-4 text-cyan-400" />
                <span>Upload de Foto ou Vídeo do Computador</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const localUrl = URL.createObjectURL(file);
                      const isVid = file.type.startsWith('video');
                      handleApplyMediaToScene(localUrl, isVid ? 'video' : 'image');
                    }
                  }}
                />
              </label>
            </div>

            {/* Current Scene Media Preview */}
            {scenes[mediaSearchTargetSceneIndex]?.mediaUrl && (
              <div className="space-y-1.5 pt-1 border-t border-neutral-800/80">
                <span className="text-[11px] font-semibold text-neutral-400 block">
                  Mídia atualmente selecionada para esta cena:
                </span>
                <div className="aspect-video max-h-48 rounded-lg overflow-hidden bg-black/60 border border-neutral-800 flex items-center justify-center">
                  <img
                    src={scenes[mediaSearchTargetSceneIndex]?.thumbnailUrl || scenes[mediaSearchTargetSceneIndex]?.mediaUrl}
                    alt="Preview atual"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <span className="text-[10px] text-neutral-500 font-mono truncate block">
                  {scenes[mediaSearchTargetSceneIndex]?.mediaUrl}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
