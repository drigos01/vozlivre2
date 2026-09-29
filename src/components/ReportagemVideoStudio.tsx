import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Link as LinkIcon,
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
  Radio,
  ArrowRight,
  Eye,
  RefreshCw,
  Film,
  Subtitles,
  CheckCircle2,
  FileCheck,
  Music,
  Trash2,
  Flame,
  Gauge,
  Volume1,
  Activity,
  Upload,
  X,
  Plus,
} from 'lucide-react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { Voice, VideoAspectRatio, ExtractedArticle, ReportageScene, GeneratedAudio, AudioTask, VideoTask } from '../types';
import { CURATED_VOICES } from '../constants/voices';
import { formatTime, downloadBlob, decodeAudioBlobOnce, getSharedAudioContext } from '../utils/audio';
import { QuickMediaReviewModal, ReviewableSceneMedia } from './QuickMediaReviewModal';
import {
  BG_MUSIC_PRESETS,
  getPresetMusicBuffer,
  mixSpeechWithBackgroundMusic,
  audioBufferToWavBlob,
  getAnyMusicAudioBuffer,
} from '../utils/backgroundMusic';
import {
  saveCustomBgMusicToDB,
  getCustomBgMusicFromDB,
  deleteCustomBgMusicFromDB,
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

interface ReportageVideoStudioProps {
  onTransferToVoice: (text: string, title?: string) => void;
  onTransferToVideo?: (audio: GeneratedAudio) => void;
  initialVoice?: Voice | null;
  onAddAudioTask?: (task: AudioTask) => void;
  onUpdateAudioTask?: (id: string, updates: Partial<AudioTask>) => void;
  onAddVideoTask?: (task: VideoTask) => void;
  onUpdateVideoTask?: (id: string, updates: Partial<VideoTask>) => void;
  onOpenTaskManager?: () => void;
  videoTasks?: VideoTask[];
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

const PRESET_ARTICLE_EXAMPLES = [
  {
    title: 'Descoberta Científica na Amazônia',
    site: 'G1 Ciência',
    url: 'https://g1.globo.com/natureza/amazonia/',
    snippet: 'Pesquisadores encontram novas espécies botânicas com propriedades medicinais raras.',
  },
  {
    title: 'Avanço Histórico na Energia Solar',
    site: 'BBC News Brasil',
    url: 'https://www.bbc.com/portuguese',
    snippet: 'Novos painéis de perovskita batem recorde mundial de eficiência energética.',
  },
  {
    title: 'Exploração Espacial e Novas Luas',
    site: 'TechMundo',
    url: 'https://www.tecmundo.com.br/ciencia',
    snippet: 'Telescópios revelam segredos inéditos sobre os oceanos subterrâneos do sistema solar.',
  },
];

/**
 * Cleans caption text: strictly removes any "Cena X:" prefix, counter, and all quotation marks
 * Ex.: "Cena 1: O mistério começou" -> "O mistério começou"
 */
export function cleanCaptionText(text?: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/^[\s(\[{]*(cena|scene|parte|bloco|take|segmento|capítulo|capitulo)\s*#?\s*\d+\s*(?:de|\/)?\s*\d*[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^[\s(\[{]*(legenda|caption|subtítulo|subtitulo|narração|narracao|texto)[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^\s*\d+\s*[:.)\]-]+\s*/g, '');
  cleaned = cleaned.replace(/["'“”«»`]/g, '');
  cleaned = cleaned.replace(/^[\s(\[{]*(cena|scene|parte|bloco|take|segmento|capítulo|capitulo)\s*#?\s*\d+\s*(?:de|\/)?\s*\d*[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^[\s:.-]+/, '').replace(/[\s:.-]+$/, '');
  return cleaned.trim();
}

function estimateReportagePhoneticWeight(text: string): number {
  if (!text) return 0.2;
  const cleaned = text.trim().toLowerCase();
  if (!cleaned) return 0.2;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0.2;

  let totalWeight = 0;
  for (const rawToken of words) {
    const token = rawToken.replace(/[^a-záéíóúâêôãõàüç0-9%$]/gi, '');
    if (!token) {
      totalWeight += 0.35;
      continue;
    }

    let numberSyllables = 0;
    const digitMatches = token.match(/\d+/g);
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
    if (rawToken.includes('%')) symbolSyllables += 3.0;
    if (/r\$|\$|€|£/i.test(rawToken)) symbolSyllables += 2.4;

    const alphaPart = token.replace(/\d+/g, '');
    const vowelClusters = (alphaPart.match(/[aeiouáéíóúâêôãõàü]+/gi) || []).length;
    const nasalBonus = (alphaPart.match(/[ãõ]|ão|ões|ães|[aeiou][mn](?![aeiou])/gi) || []).length * 0.18;
    const alphaSyllables = alphaPart.length > 0 ? Math.max(1, vowelClusters) + nasalBonus : 0;

    const wordSyllables = numberSyllables + symbolSyllables + alphaSyllables;
    totalWeight += Math.max(0.8, wordSyllables * 1.15 + 0.34 + alphaPart.length * 0.035);
  }

  return Math.max(0.2, totalWeight);
}

function getReportagePunctPauseSec(punct: string): number {
  if (!punct) return 0;
  if (punct.includes('\n')) return 0.44;
  if (/[.!?…]/.test(punct)) return 0.36;
  if (/[;:—–]/.test(punct)) return 0.22;
  if (punct.includes(',')) return 0.14;
  return 0.06;
}

/**
 * Splits narration into acoustically synchronized CapCut phrases (2-4 words per phrase).
 * Uses syllable/phonetic weights, punctuation pauses, and AudioBuffer energy/silence analysis when available.
 */
export function buildCapCutPhrases(
  narration: string,
  totalDuration: number,
  speechBuffer?: AudioBuffer | null
): SubtitlePhrase[] {
  if (!narration || totalDuration <= 0) return [];

  const clean = cleanCaptionText(
    narration
      .replace(/\[pausa.*?\]/gi, '. ')
      .replace(/[ \t]+/g, ' ')
  );
  if (!clean) return [];

  const rawClauses = clean.split(/([.,!?;:—–\n]+)/);
  interface ClauseInfo {
    phrases: string[];
    phraseWeights: number[];
    phraseWords: string[][];
    phraseWordWeights: number[][];
    totalWeight: number;
    pauseAfterSec: number;
  }
  const clauses: ClauseInfo[] = [];

  for (let i = 0; i < rawClauses.length; i += 2) {
    const clauseText = (rawClauses[i] || '').trim();
    const punct = rawClauses[i + 1] || '';
    if (!clauseText) continue;

    const words = clauseText.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const chunks: string[][] = [];
    if (words.length <= 3) {
      chunks.push(words);
    } else if (words.length === 4) {
      if (clauseText.length <= 22) chunks.push(words);
      else chunks.push(words.slice(0, 2), words.slice(2, 4));
    } else {
      let w = 0;
      while (w < words.length) {
        const rem = words.length - w;
        if (rem === 4) {
          chunks.push(words.slice(w, w + 2), words.slice(w + 2, w + 4));
          break;
        } else if (rem <= 3) {
          chunks.push(words.slice(w));
          break;
        } else {
          chunks.push(words.slice(w, w + 3));
          w += 3;
        }
      }
    }

    const cPhrases: string[] = [];
    for (let c = 0; c < chunks.length; c++) {
      const isLast = c === chunks.length - 1;
      const attach = isLast && punct && !['.', '\n'].includes(punct.trim()) ? punct.trim().slice(0, 1) : '';
      const sanitized = cleanCaptionText(chunks[c].join(' ') + attach);
      if (sanitized) cPhrases.push(sanitized);
    }
    if (cPhrases.length === 0) continue;

    const phraseWords = cPhrases.map((p) => p.split(/\s+/).filter(Boolean));
    const phraseWordWeights = phraseWords.map((wl) => wl.map((wd) => estimateReportagePhoneticWeight(wd)));
    const phraseWeights = phraseWordWeights.map((ww) => Math.max(0.2, ww.reduce((a, b) => a + b, 0)));
    const totalWeight = phraseWeights.reduce((a, b) => a + b, 0);

    clauses.push({
      phrases: cPhrases,
      phraseWeights,
      phraseWords,
      phraseWordWeights,
      totalWeight,
      pauseAfterSec: getReportagePunctPauseSec(punct),
    });
  }

  if (clauses.length === 0) return [];
  clauses[clauses.length - 1].pauseAfterSec = 0;

  const dt = 0.01;
  let voiceStartSec = Math.min(0.12, totalDuration * 0.02);
  let voiceEndSec = Math.max(voiceStartSec + 0.2, totalDuration - Math.min(0.2, totalDuration * 0.03));
  let voicedCum: Float32Array | null = null;
  let totalVoicedUnits = 0;
  const silenceGaps: Array<{ start: number; end: number; dur: number; voicedBefore: number; voicedFraction: number }> = [];

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
        const smoothRms = new Float32Array(numFrames);
        const isSpeaking = new Uint8Array(numFrames);
        const thresh = Math.max(0.003, peakRms * 0.036);
        let voicedRmsSum = 0;
        let voicedCount = 0;
        for (let f = 0; f < numFrames; f++) {
          const prev = f > 0 ? rawRms[f - 1] : rawRms[f];
          const next = f < numFrames - 1 ? rawRms[f + 1] : rawRms[f];
          const sm = (prev + rawRms[f] * 2 + next) / 4;
          smoothRms[f] = sm;
          if (sm >= thresh) {
            isSpeaking[f] = 1;
            voicedRmsSum += sm;
            voicedCount++;
          }
        }
        const meanRms = voicedCount > 0 ? voicedRmsSum / voicedCount : Math.max(0.01, peakRms * 0.3);
        let gapRun = 0;
        for (let f = 0; f < numFrames; f++) {
          if (isSpeaking[f] === 0) gapRun++;
          else {
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
          voicedCum = new Float32Array(numFrames + 1);
          let acc = 0;
          for (let f = 0; f < numFrames; f++) {
            voicedCum[f] = acc;
            if (f >= firstFrame && f <= lastFrame && isSpeaking[f] === 1) {
              const ew = 0.78 + 0.22 * Math.min(1.4, smoothRms[f] / Math.max(1e-4, meanRms));
              acc += dt * ew;
            }
          }
          voicedCum[numFrames] = acc;
          totalVoicedUnits = acc;

          let f = firstFrame;
          while (f <= lastFrame) {
            if (isSpeaking[f] === 0) {
              const gStart = f;
              while (f <= lastFrame && isSpeaking[f] === 0) f++;
              const gEnd = f;
              const gDur = (gEnd - gStart) * dt;
              if (gDur >= 0.08) {
                const vB = voicedCum[gStart];
                silenceGaps.push({
                  start: gStart * dt,
                  end: gEnd * dt,
                  dur: gDur,
                  voicedBefore: vB,
                  voicedFraction: totalVoicedUnits > 0 ? vB / totalVoicedUnits : 0,
                });
              }
            } else {
              f++;
            }
          }
        }
      }
    } catch {}
  }

  const totalSpokenWeight = Math.max(0.01, clauses.reduce((acc, c) => acc + c.totalWeight, 0));
  const totalPauseWeight = clauses.reduce((acc, c) => acc + c.pauseAfterSec, 0);
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
  const expectedClauseVoicedFrac: number[] = [];
  let expCursor = voiceStartSec;
  let cumW = 0;
  for (let c = 0; c < clauses.length; c++) {
    const cl = clauses[c];
    const isLast = c === clauses.length - 1;
    const speakDur = (cl.totalWeight / totalSpokenWeight) * effectiveSpeakSpan;
    const pauseDur = isLast ? 0 : cl.pauseAfterSec * pauseScale;
    const cStart = expCursor;
    const cEnd = isLast ? voiceEndSec : Math.min(voiceEndSec, cStart + speakDur);
    expectedClauseStart.push(cStart);
    expectedClauseEnd.push(cEnd);
    cumW += cl.totalWeight;
    expectedClauseVoicedFrac.push(cumW / totalSpokenWeight);
    expCursor = Math.min(voiceEndSec, cEnd + pauseDur);
  }

  const phrases: SubtitlePhrase[] = [];
  let phraseIdx = 0;

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

    const anchoredGap = new Int32Array(clauses.length).fill(-1);
    let lastAncC = -1;
    let lastAncG = -1;
    for (let c = 0; c < clauses.length - 1; c++) {
      const cl = clauses[c];
      if (cl.pauseAfterSec < 0.1) continue;
      const expFrac = expectedClauseVoicedFrac[c];
      const expWall = expectedClauseEnd[c];
      const prevExpFrac = lastAncC >= 0 ? expectedClauseVoicedFrac[lastAncC] : 0;
      const prevGapFrac = lastAncG >= 0 ? silenceGaps[lastAncG].voicedFraction : 0;
      const deltaExp = Math.max(0.005, expFrac - prevExpFrac);
      const maxFracTol = cl.pauseAfterSec >= 0.35 ? 0.085 : 0.06;
      const maxWallTol = cl.pauseAfterSec >= 0.35 ? 0.75 : 0.5;
      let bestG = -1;
      let bestScore = Infinity;
      for (let g = lastAncG + 1; g < silenceGaps.length; g++) {
        const gap = silenceGaps[g];
        const deltaGap = gap.voicedFraction - prevGapFrac;
        if (deltaGap <= deltaExp * 0.55) continue;
        if (deltaGap > deltaExp * 1.65 && deltaExp > 0.03) break;
        if (1 - gap.voicedFraction < (1 - expFrac) * 0.45) continue;
        const fDiff = Math.abs(gap.voicedFraction - expFrac);
        const wDiff = Math.abs(gap.start - expWall);
        if (fDiff <= maxFracTol || wDiff <= maxWallTol) {
          const score = fDiff * 2.5 + wDiff / Math.max(1, activeSpan) - Math.min(0.25, gap.dur) * 0.15;
          if (score < bestScore) {
            bestScore = score;
            bestG = g;
          }
        }
      }
      if (bestG >= 0) {
        anchoredGap[c] = bestG;
        lastAncC = c;
        lastAncG = bestG;
      }
    }

    const cVStart = new Float32Array(clauses.length);
    const cVEnd = new Float32Array(clauses.length);
    let sStart = 0;
    while (sStart < clauses.length) {
      let sEnd = sStart;
      while (sEnd < clauses.length - 1 && anchoredGap[sEnd] < 0) sEnd++;
      const v0 = sStart === 0 ? 0 : cVEnd[sStart - 1];
      const gIdx = anchoredGap[sEnd];
      const v1 = gIdx >= 0 ? silenceGaps[gIdx].voicedBefore : totalVoicedUnits;
      let sw = 0;
      for (let k = sStart; k <= sEnd; k++) sw += clauses[k].totalWeight;
      sw = Math.max(0.01, sw);
      let vc = v0;
      for (let k = sStart; k <= sEnd; k++) {
        const isLast = k === sEnd;
        const ve = isLast ? v1 : vc + (v1 - v0) * (clauses[k].totalWeight / sw);
        cVStart[k] = vc;
        cVEnd[k] = ve;
        vc = ve;
      }
      sStart = sEnd + 1;
    }

    for (let c = 0; c < clauses.length; c++) {
      const cl = clauses[c];
      const isLastClause = c === clauses.length - 1;
      const vStart = cVStart[c];
      const vEnd = cVEnd[c];
      const vSpan = Math.max(0.01, vEnd - vStart);
      let pVCursor = vStart;
      for (let p = 0; p < cl.phrases.length; p++) {
        const isLastInClause = p === cl.phrases.length - 1;
        const pRatio = cl.phraseWeights[p] / Math.max(0.01, cl.totalWeight);
        const pVEnd = isLastInClause ? vEnd : pVCursor + vSpan * pRatio;
        const pStart = c === 0 && p === 0 ? voiceStartSec : voicedToStartTime(pVCursor);
        const pSpeechEnd =
          isLastClause && isLastInClause
            ? voiceEndSec
            : isLastInClause && anchoredGap[c] >= 0
            ? silenceGaps[anchoredGap[c]].start
            : Math.max(pStart + 0.06, voicedToEndTime(pVEnd));

        const words = cl.phraseWords[p];
        const wordWeights = cl.phraseWordWeights[p];
        const totalWW = Math.max(0.01, wordWeights.reduce((a, b) => a + b, 0));
        const wordTimings: SubtitleWordTiming[] = [];
        const pVSpan = Math.max(0.005, pVEnd - pVCursor);
        let wVCursor = pVCursor;
        let prevWEnd = pStart;
        for (let wIdx = 0; wIdx < words.length; wIdx++) {
          const isLastW = wIdx === words.length - 1;
          const wVEnd = isLastW ? pVEnd : wVCursor + pVSpan * (wordWeights[wIdx] / totalWW);
          const wStart = wIdx === 0 ? pStart : Math.max(prevWEnd, voicedToStartTime(wVCursor));
          const wEnd = isLastW ? pSpeechEnd : Math.min(pSpeechEnd, Math.max(wStart + 0.03, voicedToEndTime(wVEnd)));
          wordTimings.push({ word: words[wIdx], startTime: wStart, endTime: Math.max(wStart + 0.02, wEnd) });
          wVCursor = wVEnd;
          prevWEnd = Math.max(wStart + 0.02, wEnd);
        }

        phrases.push({
          id: `capcut-phrase-${phraseIdx++}`,
          text: cl.phrases[p],
          startTime: pStart,
          endTime: Math.max(pStart + 0.06, pSpeechEnd),
          speechEndTime: Math.max(pStart + 0.06, pSpeechEnd),
          wordTimings,
        });
        pVCursor = pVEnd;
      }
    }

    for (let i = 0; i < phrases.length - 1; i++) {
      const cur = phrases[i];
      const next = phrases[i + 1];
      if (next.startTime < cur.startTime + 0.05) next.startTime = cur.startTime + 0.05;
      const gap = next.startTime - cur.endTime;
      if (gap > 0 && gap <= 0.09) cur.endTime = next.startTime;
      else if (gap > 0.09) cur.endTime = Math.min(next.startTime - 0.015, (cur.speechEndTime ?? cur.endTime) + 0.04);
      else if (cur.endTime > next.startTime) cur.endTime = next.startTime;
    }
  } else {
    for (let c = 0; c < clauses.length; c++) {
      const cl = clauses[c];
      const cStart = expectedClauseStart[c];
      const cEnd = expectedClauseEnd[c];
      const cSpan = Math.max(0.1, cEnd - cStart);
      let pCursor = cStart;
      for (let p = 0; p < cl.phrases.length; p++) {
        const isLastInClause = p === cl.phrases.length - 1;
        const pDur = cSpan * (cl.phraseWeights[p] / Math.max(0.01, cl.totalWeight));
        const pStart = pCursor;
        const pSpeechEnd = isLastInClause ? cEnd : pStart + pDur;
        const nextCStart = c < clauses.length - 1 ? expectedClauseStart[c + 1] : totalDuration;
        const pEnd =
          isLastInClause && nextCStart > pSpeechEnd
            ? Math.min(nextCStart - 0.015, pSpeechEnd + 0.04)
            : pSpeechEnd;

        const words = cl.phraseWords[p];
        const wordWeights = cl.phraseWordWeights[p];
        const totalWW = Math.max(0.01, wordWeights.reduce((a, b) => a + b, 0));
        const wordTimings: SubtitleWordTiming[] = [];
        let wCursor = pStart;
        const pSpan = Math.max(0.05, pSpeechEnd - pStart);
        for (let wIdx = 0; wIdx < words.length; wIdx++) {
          const isLastW = wIdx === words.length - 1;
          const wEnd = isLastW ? pSpeechEnd : wCursor + pSpan * (wordWeights[wIdx] / totalWW);
          wordTimings.push({ word: words[wIdx], startTime: wCursor, endTime: Math.max(wCursor + 0.02, wEnd) });
          wCursor = wEnd;
        }

        phrases.push({
          id: `capcut-phrase-${phraseIdx++}`,
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

  return phrases;
}

const studioBackdropCache = new Map<string, HTMLCanvasElement>();

/**
 * Draws television broadcast studio backdrop (deep radial navy gradient with studio light accents)
 * Cached on an offscreen canvas per resolution + newsStyle so it is blitted in O(1) per frame.
 */
function drawStudioBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  newsStyle: 'urgente' | 'especial' | 'investigacao'
) {
  const key = `${w}x${h}:${newsStyle}`;
  let cached = studioBackdropCache.get(key);
  if (!cached && typeof document !== 'undefined') {
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const oCtx = off.getContext('2d');
    if (oCtx) {
      const grad = oCtx.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h * 0.5, Math.max(w, h));
      if (newsStyle === 'urgente') {
        grad.addColorStop(0, '#270e13');
        grad.addColorStop(0.5, '#150608');
        grad.addColorStop(1, '#050203');
      } else if (newsStyle === 'especial') {
        grad.addColorStop(0, '#0c1e38');
        grad.addColorStop(0.5, '#071120');
        grad.addColorStop(1, '#02050b');
      } else {
        grad.addColorStop(0, '#06261c');
        grad.addColorStop(0.5, '#03140e');
        grad.addColorStop(1, '#010503');
      }
      oCtx.fillStyle = grad;
      oCtx.fillRect(0, 0, w, h);

      // Subtle studio scan lines / grid
      oCtx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      oCtx.lineWidth = 1;
      const gridStep = 45;
      oCtx.beginPath();
      for (let x = 0; x < w; x += gridStep) {
        oCtx.moveTo(x, 0);
        oCtx.lineTo(x, h);
      }
      oCtx.stroke();
      cached = off;
      if (studioBackdropCache.size > 12) {
        const firstKey = studioBackdropCache.keys().next().value;
        if (firstKey) studioBackdropCache.delete(firstKey);
      }
      studioBackdropCache.set(key, cached);
    }
  }
  if (cached) {
    ctx.drawImage(cached, 0, 0, w, h);
    return;
  }
}

interface CachedCapCutLayout {
  fontSize: number;
  textWidth: number;
  words: string[];
  spaceW: number;
  wordWidths: number[];
  fullLineW: number;
}

const capCutLayoutCache = new Map<string, CachedCapCutLayout>();

/**
 * Draws CapCut dynamic phrase subtitle on 2D context.
 * Vibrant yellow text, dark outline, sleek translucent pill backdrop, zero text-blocks.
 */
function drawCapCutSubtitle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  phraseText: string,
  aspectRatio: VideoAspectRatio,
  frameTime?: number,
  wordTimings?: SubtitleWordTiming[]
) {
  if (!phraseText) return;
  const cleaned = cleanCaptionText(phraseText);
  if (!cleaned) return;

  const isVertical = aspectRatio === '9:16';
  const uppercasePhrase = cleaned.toUpperCase();
  const cacheKey = `${w}x${h}:${aspectRatio}:${uppercasePhrase}`;

  ctx.save();
  ctx.textBaseline = 'middle';

  let layout = capCutLayoutCache.get(cacheKey);
  if (!layout) {
    let fontSize = isVertical ? Math.round(w * 0.054) : Math.round(h * 0.046);
    ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
    let textWidth = ctx.measureText(uppercasePhrase).width;
    const maxTextWidth = w * 0.82;
    if (textWidth > maxTextWidth && textWidth > 0) {
      fontSize = Math.max(16, Math.floor(fontSize * (maxTextWidth / textWidth)));
      ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
      textWidth = ctx.measureText(uppercasePhrase).width;
    }
    const words = uppercasePhrase.split(/\s+/).filter(Boolean);
    const spaceW = ctx.measureText(' ').width;
    const wordWidths = words.map((wd) => ctx.measureText(wd).width);
    const fullLineW = wordWidths.reduce((a, b) => a + b, 0) + Math.max(0, words.length - 1) * spaceW;

    layout = {
      fontSize,
      textWidth,
      words,
      spaceW,
      wordWidths,
      fullLineW,
    };
    if (capCutLayoutCache.size > 400) {
      const firstKey = capCutLayoutCache.keys().next().value;
      if (firstKey) capCutLayoutCache.delete(firstKey);
    }
    capCutLayoutCache.set(cacheKey, layout);
  } else {
    ctx.font = `900 ${layout.fontSize}px system-ui, -apple-system, sans-serif`;
  }

  const { fontSize, textWidth, words, spaceW, wordWidths, fullLineW } = layout;
  const centerY = isVertical ? h * 0.63 : h * 0.66;
  const padX = Math.round(fontSize * 0.7);
  const padY = Math.round(fontSize * 0.4);
  const pillW = Math.min(w * 0.94, textWidth + padX * 2);
  const pillH = fontSize + padY * 2;
  const pillX = (w - pillW) / 2;
  const pillY = centerY - pillH / 2;

  // 1. Dark translucent pill background with rounded corners
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pillX, pillY, pillW, pillH, Math.round(pillH * 0.3));
  } else {
    ctx.rect(pillX, pillY, pillW, pillH);
  }
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (words.length > 1 && typeof frameTime === 'number' && wordTimings && wordTimings.length === words.length) {
    let activeWordIdx = wordTimings.length - 1;
    for (let i = 0; i < wordTimings.length; i++) {
      if (frameTime < wordTimings[i].endTime) {
        activeWordIdx = i;
        break;
      }
    }

    let cursorX = (w - fullLineW) / 2;

    ctx.textAlign = 'left';
    for (let i = 0; i < words.length; i++) {
      const wd = words[i];
      const wW = wordWidths[i];
      if (i === activeWordIdx) {
        const hlPadX = Math.max(4, Math.round(fontSize * 0.18));
        const hlPadY = Math.max(3, Math.round(fontSize * 0.14));
        ctx.save();
        ctx.fillStyle = '#facc15';
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
        ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.16));
        ctx.strokeStyle = '#000000';
        ctx.strokeText(wd, cursorX, centerY);
        ctx.fillStyle = i < activeWordIdx ? '#fde047' : '#ffffff';
        ctx.fillText(wd, cursorX, centerY);
      }
      cursorX += wW + spaceW;
    }
  } else {
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.16));
    ctx.strokeStyle = '#000000';
    ctx.strokeText(uppercasePhrase, w / 2, centerY);

    ctx.fillStyle = '#facc15';
    ctx.fillText(uppercasePhrase, w / 2, centerY);
  }

  ctx.restore();
}

/**
 * Draws animated audio waveform visualizer overlay (bars or line)
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

  const centerY = h * 0.72;
  const barCount = 36;
  const totalWidth = w * 0.72;
  const startX = (w - totalWidth) / 2;
  const barWidth = (totalWidth / barCount) * 0.65;
  const gap = totalWidth / barCount;

  if (style === 'bars') {
    ctx.fillStyle = colorHex;
    for (let i = 0; i < barCount; i++) {
      const amp = 0.18 + Math.abs(Math.sin(time * 5 + i * 0.38)) * 0.62;
      const barHeight = Math.max(6, amp * (h * 0.08));
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
  } else {
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < barCount; i++) {
      const amp = Math.sin(time * 6 + i * 0.45) * (h * 0.04);
      const x = startX + i * gap;
      const y = centerY + amp;
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

/**
 * Safely extracts a valid CanvasImageSource and natural/video dimensions from any media representation
 * (MediaDrawable, HTMLImageElement, HTMLVideoElement, ImageBitmap, or Canvas).
 * NEVER returns undefined or un-drawable source.
 */
function extractCanvasSource(drawable: any): { source: CanvasImageSource; width: number; height: number } | null {
  if (!drawable) return null;
  const s = drawable.source || drawable;
  if (!s) return null;

  let w = 1280;
  let h = 720;
  if (typeof s.naturalWidth === 'number' && s.naturalWidth > 0) {
    w = s.naturalWidth;
    h = s.naturalHeight || 720;
  } else if (typeof s.videoWidth === 'number' && s.videoWidth > 0) {
    w = s.videoWidth;
    h = s.videoHeight || 720;
  } else if (typeof s.width === 'number' && s.width > 0) {
    w = s.width;
    h = s.height || 720;
  } else if (typeof drawable.width === 'number' && drawable.width > 0) {
    w = drawable.width;
    h = drawable.height || 720;
  }

  return { source: s, width: w, height: h };
}

function applyColorFilter(ctx: CanvasRenderingContext2D, w: number, h: number, filter: StudioColorFilter) {
  if (filter === 'cinematic') {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(0, 40, 60, 0.12)');
    grad.addColorStop(1, 'rgba(60, 30, 0, 0.10)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (filter === 'vignette') {
    const rad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    rad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    rad.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, w, h);
  } else if (filter === 'vintage') {
    ctx.fillStyle = 'rgba(180, 120, 50, 0.14)';
    ctx.fillRect(0, 0, w, h);
  } else if (filter === 'bw') {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  } else if (filter === 'warm') {
    ctx.fillStyle = 'rgba(255, 140, 20, 0.12)';
    ctx.fillRect(0, 0, w, h);
  } else if (filter === 'cool') {
    ctx.fillStyle = 'rgba(20, 100, 220, 0.12)';
    ctx.fillRect(0, 0, w, h);
  } else if (filter === 'cyberpunk') {
    const cyber = ctx.createLinearGradient(0, 0, w, h);
    cyber.addColorStop(0, 'rgba(236, 72, 153, 0.14)');
    cyber.addColorStop(1, 'rgba(6, 182, 212, 0.14)');
    ctx.fillStyle = cyber;
    ctx.fillRect(0, 0, w, h);
  }
}

/**
 * Universal Frame Renderer for Television Broadcast:
 * Draws studio background, Ken Burns image, muted video, lower third headline,
 * news ticker, and CapCut subtitles.
 */
function renderBroadcastFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frameTime: number,
  totalDuration: number,
  scenes: ReportageScene[],
  headlineText: string,
  tickerText: string,
  leadSummaryText: string,
  newsStyle: 'urgente' | 'especial' | 'investigacao',
  siteName: string,
  showSubtitles: boolean,
  phrases: SubtitlePhrase[],
  mediaBitmaps: Map<string, MediaDrawable>,
  aspectRatio: VideoAspectRatio,
  allDrawables?: MediaDrawable[],
  motionEffect: StudioMotionEffect = 'zoom-in',
  motionIntensity: number = 100,
  colorFilter: StudioColorFilter = 'cinematic',
  showWaveform: boolean = true,
  waveformStyle: StudioWaveformStyle = 'bars',
  waveformColor: StudioWaveformColor = 'cyan'
) {
  // 1. Draw rich broadcast studio backdrop
  drawStudioBackdrop(ctx, w, h, newsStyle);

  const sceneDuration = totalDuration / Math.max(1, scenes.length);
  const sceneIdx = Math.min(Math.floor(frameTime / sceneDuration), scenes.length - 1);
  const activeScene = scenes[sceneIdx];

  // 2. Draw Active Media (Image, Video Thumbnail, or Framed News Visual)
  let drawable: any = undefined;
  if (activeScene) {
    drawable =
      mediaBitmaps.get(activeScene.mediaUrl) ||
      (activeScene.thumbnailUrl ? mediaBitmaps.get(activeScene.thumbnailUrl) : undefined) ||
      (activeScene.originalUrl ? mediaBitmaps.get(activeScene.originalUrl) : undefined) ||
      mediaBitmaps.get(activeScene.id);
  }

  // If not found by exact key, search by substring / URL part
  if (!drawable && activeScene) {
    const searchKeys = [activeScene.mediaUrl, activeScene.thumbnailUrl, activeScene.originalUrl].filter(Boolean);
    for (const [k, v] of mediaBitmaps.entries()) {
      for (const sk of searchKeys) {
        if (sk && (k.includes(sk) || sk.includes(k))) {
          drawable = v;
          break;
        }
      }
      if (drawable) break;
    }
  }

  // Fallback to ANY loaded media drawable from the article so the background is NEVER blank!
  if (!drawable && allDrawables && allDrawables.length > 0) {
    drawable = allDrawables[sceneIdx % allDrawables.length];
  }
  if (!drawable && mediaBitmaps.size > 0) {
    drawable = Array.from(mediaBitmaps.values())[0];
  }

  // Helper to render media with ultra-smooth continuous Ken Burns motion
  const drawSceneMediaSmooth = (targetDrawable: any, alpha: number = 1.0) => {
    if (!targetDrawable) return;
    const media = extractCanvasSource(targetDrawable);
    if (!media || !media.source) return;

    const isVideoElement =
      typeof (media.source as any).play === 'function' &&
      typeof (media.source as any).currentTime === 'number';
    if (isVideoElement) {
      const v = media.source as HTMLVideoElement;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      // During live preview / MediaRecorder, let HTMLVideoElement play naturally without per-frame currentTime resets that freeze decoding
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
    }

    const isVertical = aspectRatio === '9:16';
    const isVideoScene = isVideoElement || activeScene?.mediaType === 'video';
    const mult = Math.max(0.1, Math.min(2.0, motionIntensity / 100));
    const motionSpeed = 0.35;
    let zoomCycle = (Math.sin(frameTime * motionSpeed - Math.PI / 2) + 1) / 2; // 0.0 -> 1.0 -> 0.0
    let panCycle = Math.sin(frameTime * (motionSpeed * 0.75)); // -1.0 -> 1.0 -> -1.0

    if (motionEffect === 'zoom-out') {
      zoomCycle = 1.0 - (Math.sin(frameTime * motionSpeed - Math.PI / 2) + 1) / 2;
    } else if (motionEffect === 'pan-left') {
      panCycle = -Math.sin(frameTime * motionSpeed);
      zoomCycle = (Math.sin(frameTime * 0.2 - Math.PI / 2) + 1) / 2 * 0.5;
    } else if (motionEffect === 'pan-right') {
      panCycle = Math.sin(frameTime * motionSpeed);
      zoomCycle = (Math.sin(frameTime * 0.2 - Math.PI / 2) + 1) / 2 * 0.5;
    } else if (motionEffect === 'subtle') {
      zoomCycle = (Math.sin(frameTime * 0.2 - Math.PI / 2) + 1) / 2 * 0.35;
      panCycle = Math.sin(frameTime * 0.15) * 0.35;
    } else if (motionEffect === 'pulse') {
      zoomCycle = Math.abs(Math.sin(frameTime * 1.6)) * 0.6;
    } else if (motionEffect === 'float') {
      zoomCycle = (Math.sin(frameTime * 0.3) + 1) / 2 * 0.45;
      panCycle = Math.cos(frameTime * 0.22) * 0.7;
    }

    zoomCycle *= mult;
    panCycle *= mult;

    const imgW = media.width;
    const imgH = media.height;
    const imgAspect = imgW / imgH;
    const cAspect = w / h;

    ctx.save();
    ctx.globalAlpha = alpha;

    try {
      if (isVideoScene || !isVertical) {
        // Full-screen background playback (100% full-bleed cover across the entire screen)
        const scale = isVideoElement ? 1.01 + zoomCycle * 0.02 : 1.03 + zoomCycle * 0.07;
        let dw = w * scale;
        let dh = h * scale;

        if (imgAspect > cAspect) {
          dh = h * scale;
          dw = dh * imgAspect;
        } else {
          dw = w * scale;
          dh = dw / imgAspect;
        }
        const panMultiplier = isVideoElement ? 0.008 : 0.02;
        const dx = (w - dw) / 2 + panCycle * (w * panMultiplier);
        const dy = (h - dh) / 2;
        ctx.drawImage(media.source, dx, dy, dw, dh);
      } else if (isVertical) {
        // 9:16 Vertical Video (TikTok / Shorts / Reels)
        // Layer 1: Ambient blurred background filling the full vertical screen
        ctx.save();
        const bgScale = 1.25 + zoomCycle * 0.06;
        let bgW = w * bgScale;
        let bgH = h * bgScale;
        if (imgAspect > cAspect) {
          bgH = h * bgScale;
          bgW = bgH * imgAspect;
        } else {
          bgW = w * bgScale;
          bgH = bgW / imgAspect;
        }
        const bgX = (w - bgW) / 2;
        const bgY = (h - bgH) / 2;
        ctx.globalAlpha = 0.42 * alpha;
        ctx.drawImage(media.source, bgX, bgY, bgW, bgH);
        ctx.restore();

        // Layer 2: Main crisp news image/frame prominently centered in the upper-middle area
        const maxFgW = w * 0.94;
        const maxFgH = h * 0.46;
        let fgW = maxFgW;
        let fgH = fgW / imgAspect;
        if (fgH > maxFgH) {
          fgH = maxFgH;
          fgW = fgH * imgAspect;
        }
        // Continuous gentle zoom & pan with zero-jump turnaround
        const fgZoom = 1.0 + zoomCycle * 0.05;
        fgW *= fgZoom;
        fgH *= fgZoom;

        const fgX = (w - fgW) / 2 + panCycle * (w * 0.015);
        const fgY = h * 0.12 + (maxFgH - fgH) / 2;

        // Draw drop shadow and rounded frame
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 8;

        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(fgX, fgY, fgW, fgH, 12);
        } else {
          ctx.rect(fgX, fgY, fgW, fgH);
        }
        ctx.clip();
        ctx.drawImage(media.source, fgX, fgY, fgW, fgH);
        ctx.restore();

        // Glowing subtle border around the news frame
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(fgX, fgY, fgW, fgH, 12);
        } else {
          ctx.rect(fgX, fgY, fgW, fgH);
        }
        ctx.stroke();
        ctx.restore();
      } else {
        // 16:9 Landscape / Horizontal Video (TV / YouTube)
        const scale = 1.03 + zoomCycle * 0.07;
        let dw = w * scale;
        let dh = h * scale;

        if (imgAspect > cAspect) {
          dh = h * scale;
          dw = dh * imgAspect;
        } else {
          dw = w * scale;
          dh = dw / imgAspect;
        }
        const dx = (w - dw) / 2 + panCycle * (w * 0.02);
        const dy = (h - dh) / 2;
        ctx.drawImage(media.source, dx, dy, dw, dh);
      }
    } catch (drawErr) {
      console.warn('Canvas drawImage notice:', drawErr);
    } finally {
      ctx.restore();
    }
  };

  // Draw current scene media
  if (drawable) {
    drawSceneMediaSmooth(drawable, 1.0);
  }

  // Smooth Crossfade Transition to Next Scene
  const CROSSFADE_SEC = 0.75;
  const currentSceneEnd = (sceneIdx + 1) * sceneDuration;
  const timeUntilNext = currentSceneEnd - frameTime;

  if (timeUntilNext < CROSSFADE_SEC && sceneIdx < scenes.length - 1) {
    const nextScene = scenes[sceneIdx + 1];
    let nextDrawable: any = undefined;
    if (nextScene) {
      nextDrawable =
        mediaBitmaps.get(nextScene.mediaUrl) ||
        (nextScene.thumbnailUrl ? mediaBitmaps.get(nextScene.thumbnailUrl) : undefined) ||
        (nextScene.originalUrl ? mediaBitmaps.get(nextScene.originalUrl) : undefined) ||
        mediaBitmaps.get(nextScene.id);
    }
    if (nextDrawable) {
      const rawAlpha = (CROSSFADE_SEC - timeUntilNext) / CROSSFADE_SEC;
      const crossAlpha = (1 - Math.cos(rawAlpha * Math.PI)) / 2;
      drawSceneMediaSmooth(nextDrawable, crossAlpha);
    }
  }

  // 2.5 Apply Color Filter Gradients
  applyColorFilter(ctx, w, h, colorFilter);

  // 2.6 Audio Waveform Visualizer Overlay
  if (showWaveform) {
    drawWaveformOverlay(ctx, w, h, frameTime, waveformStyle, waveformColor);
  }

  // 3. Cinematic Gradients
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0.65)');
  grad.addColorStop(0.2, 'rgba(0,0,0,0.15)');
  grad.addColorStop(0.65, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0.92)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 4. TV Broadcast Header Badge
  const isUrgente = newsStyle === 'urgente';
  const badgeText = isUrgente ? '🔴 PLANTÃO URGENTE' : '📰 REPORTAGEM ESPECIAL';
  const badgeBg = isUrgente ? '#dc2626' : '#2563eb';
  ctx.fillStyle = badgeBg;
  ctx.beginPath();
  ctx.roundRect(w * 0.06, h * 0.06, isUrgente ? 170 : 200, 32, 6);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillText(badgeText, w * 0.06 + 14, h * 0.06 + 21);

  if (siteName) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(`FONTE: ${siteName.toUpperCase()}`, w * 0.06 + (isUrgente ? 185 : 215), h * 0.06 + 21);
  }

  // If active scene is a video: show muted badge
  if (activeScene?.mediaType === 'video') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(w - 230, h * 0.06, 205, 28, 6);
    ctx.fill();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('📹 VÍDEO (SOM SILENCIADO)', w - 218, h * 0.06 + 18);
  }

  // 5. CapCut Dynamic Phrase Subtitle (Word-by-word dynamic, NO huge text-blocks!)
  if (showSubtitles && phrases.length > 0) {
    const activePhrase = phrases.find(
      (p) => frameTime >= p.startTime && frameTime < p.endTime
    );
    if (activePhrase && activePhrase.text) {
      drawCapCutSubtitle(ctx, w, h, activePhrase.text, aspectRatio, frameTime, activePhrase.wordTimings);
    }
  }

  // 6. Television Lower-Third Headline Banner
  const bh = 95;
  const by = h - bh - 38;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
  ctx.fillRect(0, by, w, bh);
  ctx.fillStyle = isUrgente ? '#ef4444' : '#38bdf8';
  ctx.fillRect(0, by, w, 4);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px system-ui, sans-serif';
  const cleanH = (headlineText || 'REPORTAGEM ESPECIAL').toUpperCase();
  ctx.fillText(cleanH.slice(0, 52), 24, by + 34);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px system-ui, sans-serif';
  const sceneCap = cleanCaptionText(activeScene?.caption || leadSummaryText || '');
  if (sceneCap) {
    ctx.fillText(sceneCap.slice(0, 68), 24, by + 62);
  }

  // 7. News Ticker at very bottom
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, h - 38, w, 38);
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText('NOTÍCIA:', 18, h - 15);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '500 13px system-ui, sans-serif';
  const tickerDisplay = tickerText || `${siteName || 'Notícias'}: ${headlineText}`;
  const tickerOffset = (frameTime * 45) % (w + 400);
  ctx.fillText(tickerDisplay, 95 - tickerOffset + 100, h - 15);

  // Progress bar at base
  if (totalDuration > 0) {
    const progressW = (frameTime / totalDuration) * w;
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, h - 3, progressW, 3);
  }
}

export const ReportagemVideoStudio: React.FC<ReportageVideoStudioProps> = ({
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
  const initialPrefs = useMemo(() => loadStudioPreferences(), []);

  // Input State
  const [urlInput, setUrlInput] = useState<string>('');
  const [selectedVoice, setSelectedVoice] = useState<Voice>(() =>
    resolveVoice(initialVoice?.id || initialPrefs.lastVoiceId)
  );
  const [speed, setSpeed] = useState<string>(initialPrefs.speed || '+0%');
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(initialPrefs.aspectRatio || '9:16');
  const [newsStyle, setNewsStyle] = useState<'urgente' | 'especial' | 'investigacao'>(initialPrefs.newsStyle || 'urgente');

  // Video Duration Control with LocalStorage Persistence
  const [targetDurationSeconds, setTargetDurationSeconds] = useState<number>(initialPrefs.targetDurationSec || 60);
  const [durationSavedFeedback, setDurationSavedFeedback] = useState<boolean>(false);

  const handleUpdateDuration = (newSec: number) => {
    const clamped = Math.max(15, Math.min(300, newSec));
    setTargetDurationSeconds(clamped);
    setDurationSavedFeedback(true);
    setTimeout(() => setDurationSavedFeedback(false), 2000);
  };

  // Background Music state
  const [enableBgMusic, setEnableBgMusic] = useState<boolean>(
    typeof initialPrefs.enableBgMusic === 'boolean' ? initialPrefs.enableBgMusic : true
  );
  const [bgMusicTrackId, setBgMusicTrackId] = useState<string>(initialPrefs.bgMusicTrackId || 'news');
  const [bgMusicVolume, setBgMusicVolume] = useState<number>(
    typeof initialPrefs.bgMusicVolume === 'number' ? initialPrefs.bgMusicVolume : 0.18
  );
  const [customMusicName, setCustomMusicName] = useState<string>(initialPrefs.customMusicName || '');
  const [customMusicBlob, setCustomMusicBlob] = useState<Blob | null>(null);
  const [customMusicUrl, setCustomMusicUrl] = useState<string | null>(null);

  // Motion effects state
  const [motionEffect, setMotionEffect] = useState<StudioMotionEffect>(initialPrefs.motionEffect || 'zoom-in');
  const [motionIntensity, setMotionIntensity] = useState<number>(initialPrefs.motionIntensity || 100);

  // Color filters state
  const [colorFilter, setColorFilter] = useState<StudioColorFilter>(initialPrefs.colorFilter || 'cinematic');

  // Waveform visualizer state
  const [showWaveform, setShowWaveform] = useState<boolean>(
    typeof initialPrefs.showWaveform === 'boolean' ? initialPrefs.showWaveform : true
  );
  const [waveformStyle, setWaveformStyle] = useState<StudioWaveformStyle>(initialPrefs.waveformStyle || 'bars');
  const [waveformColor, setWaveformColor] = useState<StudioWaveformColor>(initialPrefs.waveformColor || 'cyan');

  // Subtitles Option
  const [showSubtitles, setShowSubtitles] = useState<boolean>(
    typeof initialPrefs.showSubtitles === 'boolean' ? initialPrefs.showSubtitles : true
  );

  // Multi-Video Background Queue State
  const [queueItems, setQueueItems] = useState<StudioQueueItem[]>([]);
  const queueOrderRef = useRef<string[]>([]);
  const isQueueRunningRef = useRef<boolean>(false);
  const activeJobDataMapRef = useRef<Map<string, any>>(new Map());
  const cancelledJobsRef = useRef<Set<string>>(new Set());
  const lastFailedJobIdRef = useRef<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // Auto-Save Preferences & Sync Voice across whole application!
  useEffect(() => {
    saveStudioPreferences({
      lastVoiceId: selectedVoice.id,
      speed,
      aspectRatio,
      newsStyle,
      targetDurationSec: targetDurationSeconds,
      motionEffect,
      motionIntensity,
      colorFilter,
      enableBgMusic,
      bgMusicTrackId,
      bgMusicVolume,
      customMusicName,
      showWaveform,
      waveformStyle,
      waveformColor,
      showSubtitles,
    });
  }, [
    selectedVoice.id,
    speed,
    aspectRatio,
    newsStyle,
    targetDurationSeconds,
    motionEffect,
    motionIntensity,
    colorFilter,
    enableBgMusic,
    bgMusicTrackId,
    bgMusicVolume,
    customMusicName,
    showWaveform,
    waveformStyle,
    waveformColor,
    showSubtitles,
  ]);

  // Load custom bg music from IndexedDB on mount
  useEffect(() => {
    getCustomBgMusicFromDB().then((item) => {
      if (item && item.blob) {
        setCustomMusicBlob(item.blob);
        setCustomMusicName(item.name);
        setCustomMusicUrl(URL.createObjectURL(item.blob));
      }
    });
  }, []);

  // Simultaneous Task Progress Tracking
  const [audioTaskProgress, setAudioTaskProgress] = useState<number>(0);
  const [audioTaskStatus, setAudioTaskStatus] = useState<string>('idle');
  const [videoTaskProgress, setVideoTaskProgress] = useState<number>(0);
  const [videoTaskStatus, setVideoTaskStatus] = useState<string>('idle');
  const currentAudioTaskIdRef = useRef<string | null>(null);
  const currentVideoTaskIdRef = useRef<string | null>(null);

  // Pipeline Status & Progress
  const [status, setStatus] = useState<
    'idle' | 'extracting' | 'scripting' | 'synthesizing' | 'rendering' | 'ready' | 'error'
  >('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Extracted Data & Generated Content
  const [article, setArticle] = useState<ExtractedArticle | null>(null);
  const [headline, setHeadline] = useState<string>('');
  const [tickerText, setTickerText] = useState<string>('');
  const [leadSummary, setLeadSummary] = useState<string>('');
  const [fullNarration, setFullNarration] = useState<string>('');
  const [scenes, setScenes] = useState<ReportageScene[]>([]);
  const [generatedAudio, setGeneratedAudio] = useState<GeneratedAudio | null>(null);

  // Completed Rendered Video Output (Guaranteed REAL video blob with audio & video streams!)
  const [renderedVideoBlob, setRenderedVideoBlob] = useState<Blob | null>(null);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const [renderedVideoFilename, setRenderedVideoFilename] = useState<string>('');

  // Active Player View Mode: 'interactive' (live canvas preview) | 'exported' (rendered MP4 video)
  const [playerViewMode, setPlayerViewMode] = useState<'interactive' | 'exported'>('interactive');

  // Playback & Preview State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [activeSceneIndex, setActiveSceneIndex] = useState<number>(0);
  const [isEditingScript, setIsEditingScript] = useState<boolean>(false);

  // Media & Canvas References
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const renderedVideoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaBitmapsRef = useRef<Map<string, MediaDrawable>>(new Map());
  const speechAudioBufferRef = useRef<AudioBuffer | null>(null);
  const [speechBufferVersion, setSpeechBufferVersion] = useState<number>(0);

  // Quick Media Review Modal State (Before Rendering Video)
  const [mediaReviewState, setMediaReviewState] = useState<{
    isOpen: boolean;
    title: string;
    scenes: ReviewableSceneMedia[];
    extraAlternatives: Array<{ url: string; thumbnailUrl?: string; mediaType: 'image' | 'video'; title?: string }>;
    resolve: (confirmedScenes: ReviewableSceneMedia[] | null) => void;
  } | null>(null);

  const openQuickMediaReview = (
    title: string,
    sceneList: ReportageScene[],
    extractedData?: ExtractedArticle | null
  ): Promise<ReportageScene[] | null> => {
    const extraAlts: Array<{ url: string; thumbnailUrl?: string; mediaType: 'image' | 'video'; title?: string }> = [];
    if (extractedData) {
      for (const img of extractedData.images || []) {
        const u = img.proxyUrl || img.url;
        if (u) {
          extraAlts.push({
            url: u,
            thumbnailUrl: u,
            mediaType: 'image',
            title: cleanCaptionText(img.caption || img.alt || 'Foto da matéria'),
          });
        }
      }
      for (const vid of extractedData.videos || []) {
        const u = vid.proxyUrl || vid.url;
        if (u) {
          extraAlts.push({
            url: u,
            thumbnailUrl: vid.thumbnailUrl || vid.proxyUrl,
            mediaType: 'video',
            title: cleanCaptionText(vid.caption || 'Vídeo da matéria'),
          });
        }
      }
    }

    const reviewable: ReviewableSceneMedia[] = sceneList.map((sc, idx) => ({
      id: sc.id || `rep-scene-${idx}`,
      index: idx,
      narrationText: cleanCaptionText(sc.narrationSegment || sc.caption || `Cena ${idx + 1}`),
      searchQuery: cleanCaptionText(sc.caption || sc.narrationSegment || title).slice(0, 60),
      mediaType: sc.mediaType === 'video' ? 'video' : 'image',
      mediaUrl: sc.mediaUrl || sc.thumbnailUrl || '',
      thumbnailUrl: sc.thumbnailUrl || sc.mediaUrl || '',
      originalUrl: sc.originalUrl,
      sourceTitle: cleanCaptionText(sc.caption || ''),
    }));

    return new Promise((resolve) => {
      setMediaReviewState({
        isOpen: true,
        title,
        scenes: reviewable,
        extraAlternatives: extraAlts,
        resolve: (updatedReviewable) => {
          setMediaReviewState(null);
          if (!updatedReviewable) {
            resolve(null);
            return;
          }
          const updatedScenes: ReportageScene[] = sceneList.map((orig, idx) => {
            const rev = updatedReviewable[idx];
            if (!rev) return orig;
            return {
              ...orig,
              mediaType: rev.mediaType,
              mediaUrl: rev.mediaUrl,
              thumbnailUrl: rev.thumbnailUrl || rev.mediaUrl,
              originalUrl: rev.originalUrl || rev.mediaUrl,
              isMutedVideo: rev.mediaType === 'video',
            };
          });
          resolve(updatedScenes);
        },
      });
    });
  };

  // CapCut Dynamic Subtitle Phrases acoustically synchronized with speech audio buffer
  const subtitlePhrases = useMemo<SubtitlePhrase[]>(() => {
    return buildCapCutPhrases(fullNarration, duration, speechAudioBufferRef.current);
  }, [fullNarration, duration, speechBufferVersion]);

  // Preload Image Bitmaps and Videos into memory cache (resilient, parallel, with fallbacks)
  const preloadMediaBitmaps = async (
    sceneList: ReportageScene[],
    articleData?: ExtractedArticle | null
  ) => {
    const urlsToLoad = new Set<string>();
    const knownVideoUrls = new Set<string>();

    for (const sc of sceneList) {
      if (sc.mediaUrl) {
        urlsToLoad.add(sc.mediaUrl);
        if (sc.mediaType === 'video') knownVideoUrls.add(sc.mediaUrl);
      }
      if (sc.thumbnailUrl) urlsToLoad.add(sc.thumbnailUrl);
      if (sc.originalUrl) {
        urlsToLoad.add(sc.originalUrl);
        if (sc.mediaType === 'video') knownVideoUrls.add(sc.originalUrl);
      }
    }

    if (articleData) {
      for (const img of articleData.images || []) {
        if (img.proxyUrl) urlsToLoad.add(img.proxyUrl);
        if (img.url) urlsToLoad.add(img.url);
      }
      for (const vid of articleData.videos || []) {
        if (vid.thumbnailUrl) urlsToLoad.add(vid.thumbnailUrl);
        if (vid.proxyUrl) {
          urlsToLoad.add(vid.proxyUrl);
          knownVideoUrls.add(vid.proxyUrl);
        }
        if (vid.url) {
          urlsToLoad.add(vid.url);
          knownVideoUrls.add(vid.url);
        }
      }
    }

    const loadSingleMedia = async (url: string): Promise<MediaDrawable | null> => {
      if (!url) return null;
      if (mediaBitmapsRef.current.has(url)) {
        return mediaBitmapsRef.current.get(url) || null;
      }

      // Check if this is a video URL (direct MP4/WebM, video proxy, or scene marked as video)
      const lower = url.toLowerCase();
      const isVideo =
        knownVideoUrls.has(url) ||
        lower.includes('.mp4') ||
        lower.includes('.webm') ||
        lower.includes('video=1') ||
        lower.includes('/video');
      if (isVideo) {
        const loadedVideoDrawable = await new Promise<MediaDrawable | null>((resolve) => {
          const video = document.createElement('video');
          video.crossOrigin = 'anonymous';
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          video.preload = 'auto';

          let resolved = false;
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve(null);
            }
          }, 11000);

          const onReady = () => {
            if (!resolved && video.videoWidth > 0) {
              resolved = true;
              clearTimeout(timer);
              video.play().catch(() => {});
              const drawable: MediaDrawable = {
                source: video,
                width: video.videoWidth || 1280,
                height: video.videoHeight || 720,
                url,
              };
              resolve(drawable);
            }
          };

          video.onloadeddata = onReady;
          video.oncanplay = onReady;

          video.onerror = () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve(null);
            }
          };

          const proxySrc = url.startsWith('http')
            ? `/api/proxy-media?video=1&url=${encodeURIComponent(url)}`
            : url;
          video.src = proxySrc;
          video.load();
        });

        if (loadedVideoDrawable) {
          return loadedVideoDrawable;
        }
        // If direct video stream could not be decoded as HTMLVideoElement, fall through to image loader so scene is never blank
      }

      // For images (photos from article, video thumbnails, posters, etc.)
      const tryLoadImage = (srcToTry: string, timeoutMs = 10000): Promise<MediaDrawable | null> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          let done = false;

          const timer = setTimeout(() => {
            if (!done) {
              done = true;
              resolve(null);
            }
          }, timeoutMs);

          img.onload = () => {
            if (!done) {
              done = true;
              clearTimeout(timer);
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
                  resolve({
                    source: offCanvas,
                    width: cW,
                    height: cH,
                    url,
                  });
                  return;
                }
              } catch {
                resolve(null);
                return;
              }

              resolve({
                source: img,
                width: natW,
                height: natH,
                url,
              });
            }
          };

          img.onerror = () => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve(null);
            }
          };

          img.src = srcToTry;
        });
      };

      // Always try proxied URL first for full CORS compliance, then wsrv.nl, then direct
      let primaryUrl = url;
      let wsrvUrl: string | null = null;
      let fallbackUrl: string | null = null;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        primaryUrl = `/api/proxy-media?url=${encodeURIComponent(url)}`;
        wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=1280&output=jpg`;
        fallbackUrl = url;
      }

      let result = await tryLoadImage(primaryUrl, 12000);
      if (!result && wsrvUrl) {
        result = await tryLoadImage(wsrvUrl, 10000);
      }
      if (!result && fallbackUrl) {
        result = await tryLoadImage(fallbackUrl, 8000);
      }
      return result;
    };

    const loadCandidates = Array.from(urlsToLoad);
    const results = await Promise.allSettled(loadCandidates.map(loadSingleMedia));

    for (const res of results) {
      if (res.status === 'fulfilled' && res.value) {
        const d = res.value;
        mediaBitmapsRef.current.set(d.url, d);
      }
    }

    // Map each scene to its drawable under multiple keys for instant lookup, strictly prioritizing HTMLVideoElement for video scenes!
    const isDrawableVideo = (d?: MediaDrawable) =>
      Boolean(d && d.source && typeof (d.source as any).play === 'function');

    const anyLoadedVideoDrawable = Array.from(mediaBitmapsRef.current.values()).find(isDrawableVideo);

    for (const sc of sceneList) {
      const byMedia = mediaBitmapsRef.current.get(sc.mediaUrl);
      const byOrig = sc.originalUrl ? mediaBitmapsRef.current.get(sc.originalUrl) : undefined;
      const byThumb = sc.thumbnailUrl ? mediaBitmapsRef.current.get(sc.thumbnailUrl) : undefined;

      let matched: MediaDrawable | undefined;
      if (sc.mediaType === 'video') {
        matched =
          (isDrawableVideo(byMedia) ? byMedia : undefined) ||
          (isDrawableVideo(byOrig) ? byOrig : undefined) ||
          anyLoadedVideoDrawable ||
          byMedia ||
          byOrig ||
          byThumb;
      } else {
        matched = byMedia || byThumb || byOrig;
      }

      if (matched) {
        mediaBitmapsRef.current.set(sc.id, matched);
        if (sc.mediaUrl) mediaBitmapsRef.current.set(sc.mediaUrl, matched);
      }
    }
  };

  /**
   * Helper that fetches the REAL binary audio from /api/tts.
   * Handles both stream binary and JSON metadata responses properly.
   */
  const fetchRealTtsAudio = async (
    text: string,
    voiceId: string,
    rate: string
  ): Promise<{ blob: Blob; url: string; duration: number }> => {
    const ttsRes = await fetch('/api/tts?stream=true', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        voice: voiceId,
        rate,
        pitch: '+0Hz',
        volume: '+0%',
      }),
    });

    if (!ttsRes.ok) {
      const errData = await ttsRes.json().catch(() => ({}));
      throw new Error(errData.error || 'Erro na síntese da locução neural.');
    }

    let finalAudioBlob: Blob;
    let finalAudioUrl: string;

    const ct = ttsRes.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const json = await ttsRes.json();
      if (json.error) throw new Error(json.error);
      if (!json.audioUrl) throw new Error('Servidor não retornou o link do áudio.');
      const downloadRes = await fetch(json.audioUrl);
      if (!downloadRes.ok) throw new Error('Falha ao baixar o áudio neural gerado.');
      finalAudioBlob = await downloadRes.blob();
      finalAudioUrl = json.audioUrl;
    } else {
      finalAudioBlob = await ttsRes.blob();
      finalAudioUrl = URL.createObjectURL(finalAudioBlob);
    }

    if (finalAudioBlob.size < 4096) {
      throw new Error('O arquivo de áudio gerado está vazio ou incompleto.');
    }

    // Decode pure speech buffer once using shared AudioContext singleton
    const decodedSpeechBuf = await decodeAudioBlobOnce(finalAudioBlob);

    const measuredDuration =
      decodedSpeechBuf && decodedSpeechBuf.duration > 0
        ? decodedSpeechBuf.duration
        : await new Promise<number>((resolve) => {
            const tempAudio = new Audio(finalAudioUrl);
            tempAudio.onloadedmetadata = () => resolve(tempAudio.duration || 30);
            tempAudio.onerror = () => resolve(30);
            setTimeout(() => resolve(30), 1200);
          });

    return {
      blob: finalAudioBlob,
      url: finalAudioUrl,
      duration: measuredDuration,
      speechBuffer: decodedSpeechBuf,
    };
  };

  /**
   * Dual-Engine Video Renderer (WebCodecs Muxer + MediaRecorder fallback):
   * Guarantees a REAL video file (.mp4 or .webm) with video frames and audio track.
   */
  const renderCompleteVideo = async (
    audioBlob: Blob,
    audioBlobUrl: string,
    scriptHeadline: string,
    scriptTicker: string,
    scriptLead: string,
    narrationText: string,
    sceneList: ReportageScene[],
    audioDurationSec: number,
    siteNameStr?: string,
    jobIdOverride?: string,
    speechBuf?: AudioBuffer | null
  ): Promise<{ blob: Blob; url: string; filename: string }> => {
    // Mobile & Desktop optimized HD dimensions (540x960 for 9:16 vertical)
    // Consumes 4x less GPU RAM and never crashes mobile Android Chrome
    const isVertical = aspectRatio === '9:16';
    const isSquare = aspectRatio === '1:1';
    const width = isVertical ? 540 : isSquare ? 540 : 960;
    const height = isVertical ? 960 : isSquare ? 540 : 540;
    const fps = 24; // 24 FPS broadcast telejournalism framerate
    const totalFrames = Math.max(24, Math.floor(audioDurationSec * fps));
    const phrases = buildCapCutPhrases(narrationText, audioDurationSec, speechBuf || speechAudioBufferRef.current);
    const filename = `reportagem-${(scriptHeadline || 'noticia').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}.mp4`;
    const activeJobKey = jobIdOverride || currentVideoTaskIdRef.current || `rep-job-${Date.now()}`;

    const existingCheckpoint =
      getRenderCheckpointSync(activeJobKey) || (await getRenderCheckpoint(activeJobKey));

    // 1. Check if WebCodecs with AAC audio is supported on this browser
    let canUseWebCodecs = false;
    try {
      if (
        typeof (window as any).VideoEncoder === 'function' &&
        typeof (window as any).AudioEncoder === 'function' &&
        typeof (window as any).VideoEncoder.isConfigSupported === 'function' &&
        typeof (window as any).AudioEncoder.isConfigSupported === 'function'
      ) {
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
        if (vSup?.supported && aSup?.supported) {
          canUseWebCodecs = true;
        }
      }
    } catch {
      canUseWebCodecs = false;
    }

    // Engine A: WebCodecs + MP4-Muxer with Frame-Accurate Checkpointing & Resume
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
          studioType: 'reportagem',
          title: scriptHeadline || 'Reportagem',
          aspectRatio,
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
          audioId: `${activeJobKey}-audio`,
          title: scriptHeadline || 'Reportagem',
          aspectRatio,
          fitMode: 'blur_capcut',
          progressPercent: pct,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          studioType: 'reportagem',
          lastCompletedFrame: lastFrame,
          totalFrames,
          resumeTimeSec: (lastFrame + 1) / fps,
          totalDurationSec: audioDurationSec,
          errorMessage: errMsg,
        });
      };

      try {
        const decodedAudio = (await decodeAudioBlobOnce(audioBlob)) || speechBuf || speechAudioBufferRef.current;
        if (!decodedAudio) {
          throw new Error('Não foi possível decodificar o buffer de áudio para codificação MP4.');
        }

        sampleRate = decodedAudio.sampleRate || 44100;
        const ch0 = decodedAudio.getChannelData(0);
        const ch1 = decodedAudio.numberOfChannels > 1 ? decodedAudio.getChannelData(1) : ch0;

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
            sampleRate,
          },
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
          setStatusMessage(`Retomando renderização do frame ${startFrame}/${totalFrames} (${resumeFramePct}%)...`);
          updateQueueItem(activeJobKey, {
            progress: resumePct,
            statusText: `Retomando renderização do frame ${startFrame}/${totalFrames} (${resumeFramePct}%)...`,
          });
          if (onUpdateVideoTask) {
            onUpdateVideoTask(activeJobKey, {
              progress: resumePct,
              statusText: `Retomando MP4 (${resumeFramePct}%)...`,
            });
          }
        } else {
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
        const rCtx = renderCanvas.getContext('2d', { alpha: false, desynchronized: true }) || renderCanvas.getContext('2d');
        if (!rCtx) throw new Error('Falha gráfica.');

        const cachedAllDrawables = Array.from(mediaBitmapsRef.current.values());

        for (let i = startFrame; i < totalFrames; i++) {
          currentFrameIdx = i;

          if (cancelledJobsRef.current.has(activeJobKey)) {
            try {
              if (videoEncoder.state === 'configured') await videoEncoder.flush();
            } catch {}
            await persistFrameCheckpoint(Math.max(0, i - 1), 'Renderização pausada/interrompida');
            throw new Error(`Renderização interrompida no frame ${i} de ${totalFrames}. Clique em Retomar Renderização para continuar deste ponto.`);
          }

          if (encoderError || videoEncoder.state !== 'configured') {
            encoderError = null;
            try {
              if (videoEncoder.state !== 'closed') videoEncoder.close();
            } catch {}
            videoEncoder = createConfiguredVideoEncoder(true);
          }

          while (videoEncoder.encodeQueueSize > 3) {
            await new Promise((resolve) => setTimeout(resolve, 6));
            if (encoderError) break;
          }

          const frameTime = i / fps;

          // Ensure any HTMLVideoElement active in this frame is awaited to seek to exact frameTime before drawing!
          const sceneDurationSec = audioDurationSec / Math.max(1, sceneList.length);
          const activeIdx = Math.min(Math.floor(frameTime / sceneDurationSec), sceneList.length - 1);
          const scNow = sceneList[activeIdx];
          if (scNow) {
            const dNow =
              mediaBitmapsRef.current.get(scNow.id) ||
              mediaBitmapsRef.current.get(scNow.mediaUrl) ||
              (scNow.originalUrl ? mediaBitmapsRef.current.get(scNow.originalUrl) : undefined);
            const vEl = dNow?.source as HTMLVideoElement | undefined;
            if (vEl && typeof vEl.play === 'function' && vEl.duration > 0) {
              (vEl as any).__offlineSeeking = true;
              if (!vEl.paused) vEl.pause();
              const targetVidTime = frameTime % vEl.duration;
              const delta = targetVidTime - vEl.currentTime;
              if (delta < -0.05 || delta > (1 / fps) * 1.6) {
                await new Promise<void>((resolveSeek) => {
                  let doneSeek = false;
                  const finish = () => {
                    if (doneSeek) return;
                    doneSeek = true;
                    vEl.removeEventListener('seeked', finish);
                    resolveSeek();
                  };
                  vEl.addEventListener('seeked', finish, { once: true });
                  setTimeout(finish, 35);
                  try {
                    vEl.currentTime = targetVidTime;
                  } catch {
                    finish();
                  }
                });
              }
            }
          }

          renderBroadcastFrame(
            rCtx,
            width,
            height,
            frameTime,
            audioDurationSec,
            sceneList,
            scriptHeadline,
            scriptTicker,
            scriptLead,
            newsStyle,
            siteNameStr || '',
            showSubtitles,
            phrases,
            mediaBitmapsRef.current,
            aspectRatio,
            cachedAllDrawables,
            motionEffect,
            motionIntensity,
            colorFilter,
            showWaveform,
            waveformStyle,
            waveformColor
          );

          const videoFrame = new (window as any).VideoFrame(renderCanvas, {
            timestamp: Math.round(frameTime * 1_000_000),
          });
          try {
            videoEncoder.encode(videoFrame, { keyFrame: i === startFrame || i % 36 === 0 });
          } catch {
            videoEncoder = createConfiguredVideoEncoder(true);
            videoEncoder.encode(videoFrame, { keyFrame: true });
          } finally {
            videoFrame.close();
          }

          if (i % 4 === 0) {
            await new Promise((r) => setTimeout(r, 0));
          }

          if (i === totalFrames - 1) {
            await persistFrameCheckpoint(i);
          } else if (i > 0 && i % 45 === 0) {
            persistFrameCheckpoint(i).catch(() => {});
          }

          if (i % 10 === 0) {
            const p = Math.round(60 + (i / totalFrames) * 38);
            const pctFrames = Math.round((i / totalFrames) * 100);
            setProgressPercent(p);
            setStatusMessage(`Renderizando vídeo MP4 final (${pctFrames}%)...`);
            updateQueueItem(activeJobKey, {
              progress: p,
              statusText: `Renderizando vídeo MP4 (${pctFrames}% · frame ${i}/${totalFrames})...`,
            });
            if (onUpdateVideoTask) {
              onUpdateVideoTask(activeJobKey, {
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
      } catch (webcodecsErr: any) {
        await persistFrameCheckpoint(Math.max(0, currentFrameIdx - 1), webcodecsErr?.message);
        if (checkpointVideoChunks.length > 0 || cancelledJobsRef.current.has(activeJobKey)) {
          throw webcodecsErr;
        }
        console.warn('WebCodecs failed at frame 0, switching to MediaRecorder fallback:', webcodecsErr);
      } finally {
        for (const d of mediaBitmapsRef.current.values()) {
          if (d?.source && typeof (d.source as any).play === 'function') {
            (d.source as any).__offlineSeeking = false;
          }
        }
      }
    }

    // Engine B: Universal MediaRecorder with Dual Audio Pipeline (AudioBuffer or HTMLAudioElement)
    const streamCanvas = document.createElement('canvas');
    streamCanvas.width = width;
    streamCanvas.height = height;
    const sCtx = streamCanvas.getContext('2d')!;

    const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (actx.state === 'suspended') {
      await actx.resume().catch(() => {});
    }

    const dest = actx.createMediaStreamDestination();
    let sourceNode: AudioBufferSourceNode | null = null;
    let renderAudioEl: HTMLAudioElement | null = null;

    // 1. Try decoding AudioBuffer with Web Audio
    try {
      const audioBuf = await audioBlob.arrayBuffer();
      const decodedAudio = await actx.decodeAudioData(audioBuf.slice(0));
      sourceNode = actx.createBufferSource();
      sourceNode.buffer = decodedAudio;
      sourceNode.connect(dest);
    } catch (decodeErr) {
      console.warn('AudioContext decode failed, using robust HTMLAudioElement fallback:', decodeErr);
      // 2. 100% Guaranteed Fallback: HTMLAudioElement with createMediaElementSource (NEVER throws Unable to decode audio data!)
      try {
        renderAudioEl = new Audio(audioBlobUrl);
        renderAudioEl.crossOrigin = 'anonymous';
        renderAudioEl.currentTime = 0;
        renderAudioEl.volume = 1;
        const mediaSource = actx.createMediaElementSource(renderAudioEl);
        mediaSource.connect(dest);
      } catch (mediaElemErr) {
        console.warn('createMediaElementSource notice:', mediaElemErr);
      }
    }

    const canvasStream = (streamCanvas as any).captureStream ? streamCanvas.captureStream(fps) : null;
    if (!canvasStream) {
      throw new Error('Gravação de vídeo não suportada neste dispositivo.');
    }

    const audioTracks = dest.stream.getAudioTracks();
    const combinedTracks = [
      ...canvasStream.getVideoTracks(),
      ...(audioTracks.length > 0 ? audioTracks : []),
    ];
    const combinedStream = new MediaStream(combinedTracks);

    let mimeType = 'video/mp4';
    if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')) {
      mimeType = 'video/mp4;codecs=avc1,mp4a.40.2';
    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
      mimeType = 'video/mp4';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
      mimeType = 'video/webm;codecs=vp9,opus';
    } else if (MediaRecorder.isTypeSupported('video/webm')) {
      mimeType = 'video/webm';
    }

    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 2_500_000,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const recordingPromise = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const finalBlob = new Blob(chunks, { type: mimeType });
        resolve(finalBlob);
      };
      recorder.onerror = reject;
    });

    recorder.start(250);
    if (sourceNode) {
      sourceNode.start(0);
    } else if (renderAudioEl) {
      renderAudioEl.play().catch((e) => console.warn('Audio play notice:', e));
    }

    const startTime = performance.now();
    let animId: number;

    const renderLoop = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      renderBroadcastFrame(
        sCtx,
        width,
        height,
        elapsed,
        audioDurationSec,
        sceneList,
        scriptHeadline,
        scriptTicker,
        scriptLead,
        newsStyle,
        siteNameStr || '',
        showSubtitles,
        phrases,
        mediaBitmapsRef.current,
        aspectRatio,
        Array.from(mediaBitmapsRef.current.values()),
        motionEffect,
        motionIntensity,
        colorFilter,
        showWaveform,
        waveformStyle,
        waveformColor
      );

      const percent = Math.min(99, Math.round(60 + (elapsed / audioDurationSec) * 38));
      setProgressPercent(percent);
      setStatusMessage(`Gravando vídeo com locução e legendas (${Math.round((elapsed / audioDurationSec) * 100)}%)...`);

      if (elapsed < audioDurationSec) {
        animId = requestAnimationFrame(renderLoop);
      }
    };

    animId = requestAnimationFrame(renderLoop);

    await new Promise<void>((res) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          res();
        }
      };
      if (sourceNode) {
        sourceNode.onended = done;
      }
      if (renderAudioEl) {
        renderAudioEl.onended = done;
      }
      setTimeout(done, (audioDurationSec + 0.5) * 1000);
    });

    cancelAnimationFrame(animId);
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    if (renderAudioEl) {
      renderAudioEl.pause();
    }
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
   * 1-Click Autonomous Process:
   * 1. Scrapes news link
   * 2. Natural script generation with Gemini
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

  const handleResumeQueueItem = async (itemId: string) => {
    cancelledJobsRef.current.delete(itemId);
    if (lastFailedJobIdRef.current === itemId) {
      lastFailedJobIdRef.current = null;
      setErrorMessage(null);
    }

    const cp = getRenderCheckpointSync(itemId) || (await getRenderCheckpoint(itemId));
    const existingData = activeJobDataMapRef.current.get(itemId);
    if (!existingData && cp?.jobSnapshot) {
      activeJobDataMapRef.current.set(itemId, cp.jobSnapshot);
    }

    const jobData = activeJobDataMapRef.current.get(itemId);
    if (!jobData) {
      setErrorMessage('Não foi possível localizar os dados desta reportagem para retomar.');
      return;
    }

    const resumeProgress = cp?.progressPercent || jobData.lastProgress || 15;
    const resumeFrameInfo =
      cp && cp.lastCompletedFrame >= 0
        ? `a partir do frame ${cp.lastCompletedFrame + 1}/${cp.totalFrames} (${resumeProgress}%)`
        : jobData.cachedAudioBlob
        ? `a partir da renderização de vídeo (${resumeProgress}%)`
        : jobData.scriptData
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
          title: cp?.title || jobData.scriptData?.headline || jobData.title || 'Reportagem',
          sourceLabel: 'Retomado',
          aspectRatio: cp?.aspectRatio || jobData.aspectRatio || aspectRatio,
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
      runQueue();
    }
  };

  useEffect(() => {
    getLatestRenderCheckpoint('reportagem')
      .then((cp) => {
        if (cp && cp.jobSnapshot) {
          activeJobDataMapRef.current.set(cp.taskId, cp.jobSnapshot);
          setQueueItems((prev) => {
            if (prev.some((i) => i.id === cp.taskId)) return prev;
            return [
              {
                id: cp.taskId,
                title: cp.title || cp.jobSnapshot.title || 'Reportagem',
                sourceLabel: 'Recuperado',
                aspectRatio: cp.aspectRatio || '9:16',
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

  const handleSelectQueueItemToView = (item: StudioQueueItem) => {
    const jobData = activeJobDataMapRef.current.get(item.id);
    if (!jobData) return;

    if (jobData.extractedData) setArticle(jobData.extractedData);
    if (jobData.scriptData) {
      setHeadline(jobData.scriptData.headline || '');
      setTickerText(jobData.scriptData.tickerText || '');
      setLeadSummary(jobData.scriptData.leadSummary || '');
      setFullNarration(jobData.scriptData.fullNarration || '');
    }
    if (jobData.scenes) setScenes(jobData.scenes);
    if (jobData.audioObj) {
      setGeneratedAudio(jobData.audioObj);
      setDuration(jobData.audioObj.durationSeconds);
    }
    if (item.videoBlob && item.videoUrl) {
      setRenderedVideoBlob(item.videoBlob);
      setRenderedVideoUrl(item.videoUrl);
      setRenderedVideoFilename(item.downloadFilename || 'reportagem.mp4');
      setPlayerViewMode('exported');
    }
    setStatus('ready');
    window.scrollTo({ top: 500, behavior: 'smooth' });
  };

  const runQueue = async () => {
    if (isQueueRunningRef.current || queueOrderRef.current.length === 0) return;
    isQueueRunningRef.current = true;

    while (queueOrderRef.current.length > 0) {
      const currentJobId = queueOrderRef.current[0];
      const jobParams = activeJobDataMapRef.current.get(currentJobId);

      if (!jobParams) {
        queueOrderRef.current.shift();
        continue;
      }

      currentAudioTaskIdRef.current = `${currentJobId}-audio`;
      currentVideoTaskIdRef.current = currentJobId;

      try {
        // Step 1: Scrape & Extract Article (skipped on resume if already extracted!)
        let extractedData: ExtractedArticle = jobParams.extractedData;
        if (!extractedData) {
          updateQueueItem(currentJobId, {
            status: 'extracting',
            progress: 15,
            statusText: 'Acessando matéria e extraindo fotos e vídeos...',
          });
          if (onUpdateVideoTask) {
            onUpdateVideoTask(currentJobId, { status: 'preparing', progress: 15, statusText: 'Extraindo conteúdo...' });
          }

          const extractRes = await fetch('/api/article/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: jobParams.url }),
          });

          if (!extractRes.ok) {
            const errData = await extractRes.json().catch(() => ({}));
            throw new Error(errData.error || `Erro ao carregar link (${extractRes.status})`);
          }

          extractedData = await extractRes.json();
          const afterStep1 = { ...jobParams, extractedData, lastProgress: 30 };
          activeJobDataMapRef.current.set(currentJobId, afterStep1);
          Object.assign(jobParams, afterStep1);
        }

        // Step 2: AI Natural Journalistic Script & Scene Generation (skipped on resume if already scripted!)
        let scriptData = jobParams.scriptData;
        if (!scriptData) {
          updateQueueItem(currentJobId, {
            title: extractedData.title || jobParams.title,
            status: 'scripting',
            progress: 35,
            statusText: 'IA redigindo roteiro televisivo e selecionando mídias...',
          });
          if (onUpdateVideoTask) {
            onUpdateVideoTask(currentJobId, {
              title: `Vídeo: ${extractedData.title}`,
              status: 'preparing',
              progress: 35,
              statusText: 'Roteirizando com IA...',
            });
          }

          const scriptRes = await fetch('/api/reportage/generate-script', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ article: extractedData, targetDurationSeconds: jobParams.targetDurationSeconds }),
          });

          if (!scriptRes.ok) {
            const errData = await scriptRes.json().catch(() => ({}));
            throw new Error(errData.error || 'Erro ao gerar roteiro com IA');
          }

          scriptData = await scriptRes.json();
          const afterStep2 = { ...jobParams, extractedData, scriptData, scenes: scriptData.scenes || [], lastProgress: 50 };
          activeJobDataMapRef.current.set(currentJobId, afterStep2);
          Object.assign(jobParams, afterStep2);
        }

        if (jobParams.customMedia && scriptData.scenes && scriptData.scenes.length > 0) {
          scriptData.scenes[0].mediaUrl = jobParams.customMedia.url;
          scriptData.scenes[0].exactMediaUrl = jobParams.customMedia.url;
          scriptData.scenes[0].mediaType = jobParams.customMedia.mediaType;
          scriptData.scenes[0].thumbnailUrl = jobParams.customMedia.url;
          scriptData.scenes[0].visualSource = 'custom';
        }

        // Start preloading initial media bitmaps and synthesizing neural TTS in parallel while user reviews media!
        const initialPreloadPromise = preloadMediaBitmaps(scriptData.scenes || [], extractedData);
        const parallelTtsPromise =
          !jobParams.cachedAudioBlob || !jobParams.cachedAudioDuration
            ? fetchRealTtsAudio(scriptData.fullNarration, jobParams.voice.id, jobParams.speed)
            : null;

        if (!jobParams.mediaVerifiedByUser && (scriptData.scenes || []).length > 0) {
          updateQueueItem(currentJobId, {
            statusText: 'Aguardando verificação rápida de imagens e vídeos...',
          });
          const reviewedScenes = await openQuickMediaReview(
            scriptData.headline || extractedData.title || 'Reportagem',
            scriptData.scenes || [],
            extractedData
          );
          if (!reviewedScenes) {
            handleCancelQueueItem(currentJobId);
            continue;
          }
          scriptData.scenes = reviewedScenes;
          jobParams.scenes = reviewedScenes;
          jobParams.mediaVerifiedByUser = true;
          activeJobDataMapRef.current.set(currentJobId, {
            ...jobParams,
            scriptData,
            scenes: reviewedScenes,
            mediaVerifiedByUser: true,
          });
        }

        // Step 3: Neural Voice Synthesis (TTS) & Music Mixing (skipped on resume if cachedAudioBlob exists!)
        let finalAudioBlob: Blob = jobParams.cachedAudioBlob;
        let finalAudioUrl: string = jobParams.cachedAudioUrl;
        let finalAudioDuration: number = jobParams.cachedAudioDuration;
        let audioObj: GeneratedAudio = jobParams.audioObj;

        if (!finalAudioBlob || !finalAudioDuration) {
          updateQueueItem(currentJobId, {
            status: 'synthesizing',
            progress: 55,
            statusText: `Sintetizando locução na voz ${jobParams.voice.name}...`,
          });
          if (onUpdateAudioTask) {
            onUpdateAudioTask(`${currentJobId}-audio`, {
              title: `Locução: ${scriptData.headline || extractedData.title}`,
              status: 'processing',
              progress: 55,
              statusText: 'Sintetizando locução...',
            });
          }

          const ttsAudio = parallelTtsPromise
            ? await parallelTtsPromise
            : await fetchRealTtsAudio(scriptData.fullNarration, jobParams.voice.id, jobParams.speed);
          if (ttsAudio.speechBuffer) {
            speechAudioBufferRef.current = ttsAudio.speechBuffer;
            setSpeechBufferVersion((v) => v + 1);
          }

          finalAudioBlob = ttsAudio.blob;
          finalAudioUrl = ttsAudio.url;
          finalAudioDuration = ttsAudio.duration;

          if (jobParams.enableBgMusic && jobParams.bgMusicVolume > 0.01) {
            try {
              updateQueueItem(currentJobId, {
                statusText: 'Mixando trilha sonora com locução neural...',
              });
              const speechBuf = ttsAudio.speechBuffer || (await decodeAudioBlobOnce(ttsAudio.blob));
              const musicBuf = await getAnyMusicAudioBuffer(jobParams.bgMusicTrackId, jobParams.customMusicBlob);
              if (speechBuf && musicBuf) {
                const mixedBuf = await mixSpeechWithBackgroundMusic(
                  speechBuf,
                  musicBuf,
                  jobParams.bgMusicVolume,
                  speechBuf.duration
                );
                const mixedWavBlob = audioBufferToWavBlob(mixedBuf);
                finalAudioBlob = mixedWavBlob;
                finalAudioUrl = URL.createObjectURL(mixedWavBlob);
                finalAudioDuration = mixedBuf.duration;
              }
            } catch (mixErr) {
              console.warn('Erro ao mixar trilha sonora de fundo:', mixErr);
            }
          }

          audioObj = {
            id: `reportage-audio-${Date.now()}`,
            title: scriptData.headline || extractedData.title,
            voice: jobParams.voice,
            textSnippet: scriptData.fullNarration.slice(0, 160),
            fullText: scriptData.fullNarration,
            charCount: scriptData.fullNarration.length,
            durationSeconds: finalAudioDuration,
            createdAt: Date.now(),
            audioUrl: finalAudioUrl,
            downloadUrl: finalAudioUrl,
            blob: finalAudioBlob,
            blobUrl: finalAudioUrl,
          };

          const afterStep3 = {
            ...jobParams,
            extractedData,
            scriptData,
            scenes: scriptData.scenes || [],
            cachedAudioBlob: finalAudioBlob,
            cachedAudioUrl: finalAudioUrl,
            cachedAudioDuration: finalAudioDuration,
            audioObj,
            lastProgress: 60,
          };
          activeJobDataMapRef.current.set(currentJobId, afterStep3);
          Object.assign(jobParams, afterStep3);
        } else if (!finalAudioUrl && finalAudioBlob) {
          finalAudioUrl = URL.createObjectURL(finalAudioBlob);
        }

        if (onUpdateAudioTask) {
          onUpdateAudioTask(`${currentJobId}-audio`, {
            status: 'completed',
            progress: 100,
            statusText: 'Locução concluída',
            resultAudio: audioObj,
            completedAt: Date.now(),
          });
        }

        // Ensure any newly chosen media from QuickMediaReviewModal is preloaded into bitmaps cache
        await initialPreloadPromise;
        await preloadMediaBitmaps(scriptData.scenes || [], extractedData);

        // Step 4: Render MP4 Video (with frame-accurate resume if checkpoint exists)
        const existingCp = getRenderCheckpointSync(currentJobId) || (await getRenderCheckpoint(currentJobId));
        const startPct = existingCp?.progressPercent || 75;
        updateQueueItem(currentJobId, {
          status: 'rendering',
          progress: startPct,
          statusText:
            existingCp && existingCp.lastCompletedFrame >= 0
              ? `Retomando renderização MP4 do frame ${existingCp.lastCompletedFrame + 1}/${existingCp.totalFrames} (${startPct}%)...`
              : 'Renderizando vídeo final MP4 com fotos, efeitos e legendas...',
        });
        if (onUpdateVideoTask) {
          onUpdateVideoTask(currentJobId, {
            status: 'rendering',
            progress: startPct,
            statusText:
              existingCp && existingCp.lastCompletedFrame >= 0
                ? `Retomando MP4 (${startPct}%)...`
                : 'Renderizando MP4...',
          });
        }

        const finalVideoResult = await renderCompleteVideo(
          finalAudioBlob,
          finalAudioUrl,
          scriptData.headline,
          scriptData.tickerText,
          scriptData.leadSummary,
          scriptData.fullNarration,
          scriptData.scenes || [],
          finalAudioDuration,
          extractedData.siteName,
          currentJobId,
          speechAudioBufferRef.current
        );

        // Save complete result in memory map
        activeJobDataMapRef.current.set(currentJobId, {
          ...jobParams,
          extractedData,
          scriptData,
          scenes: scriptData.scenes || [],
          audioObj,
          videoBlob: finalVideoResult.blob,
          videoUrl: finalVideoResult.url,
          filename: finalVideoResult.filename,
        });

        updateQueueItem(currentJobId, {
          status: 'completed',
          progress: 100,
          statusText: 'Vídeo 100% pronto para download!',
          videoBlob: finalVideoResult.blob,
          videoUrl: finalVideoResult.url,
          downloadFilename: finalVideoResult.filename,
          completedAt: Date.now(),
        });

        if (onUpdateVideoTask) {
          onUpdateVideoTask(currentJobId, {
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
                'x-video-title': encodeURIComponent(scriptData.headline || extractedData.title || 'Reportagem'),
                'x-video-caption': encodeURIComponent(scriptData.leadSummary || ''),
                'x-video-filename': encodeURIComponent(finalVideoResult.filename || 'reportagem.mp4'),
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

        // If no video is currently active in editor, load this completed project immediately
        if (!renderedVideoUrl || status !== 'ready') {
          setArticle(extractedData);
          setHeadline(scriptData.headline);
          setTickerText(scriptData.tickerText);
          setLeadSummary(scriptData.leadSummary);
          setFullNarration(scriptData.fullNarration);
          setScenes(scriptData.scenes || []);
          setGeneratedAudio(audioObj);
          setDuration(finalAudioDuration);
          setRenderedVideoBlob(finalVideoResult.blob);
          setRenderedVideoUrl(finalVideoResult.url);
          setRenderedVideoFilename(finalVideoResult.filename);
          setPlayerViewMode('exported');
          setStatus('ready');
          setStatusMessage('Vídeo de reportagem 100% concluído e pronto para download!');
        }
      } catch (err: any) {
        console.error('Falha no processamento da matéria:', err);
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
            (isCancelled ? 'Pausado/Interrompido' : 'Erro: ' + (err.message || 'Falha ao processar matéria')) +
            failFrameNote,
          error: err.message,
        });
        if (onUpdateVideoTask) {
          onUpdateVideoTask(currentJobId, {
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
   * Non-Blocking Autonomous Production Dispatcher:
   * Adds the request to the background queue so the user can immediately continue
   * typing another link, adjusting settings, and dispatching more videos!
   */
  const handleGenerateFullReportage = async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl || urlInput).trim();
    if (!targetUrl) {
      setErrorMessage('Por favor, insira o link da matéria ou reportagem.');
      return;
    }

    setErrorMessage(null);

    const jobId = `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let initialHost = 'Notícia Web';
    try {
      initialHost = new URL(targetUrl).hostname.replace('www.', '');
    } catch {}

    const initialTitle = `Reportagem (${initialHost})`;

    const newJob: StudioQueueItem = {
      id: jobId,
      title: initialTitle,
      sourceLabel: initialHost,
      aspectRatio,
      status: 'queued',
      progress: 5,
      statusText: 'Na fila de produção em segundo plano...',
      createdAt: Date.now(),
      voiceName: selectedVoice.name,
    };

    setQueueItems((prev) => [newJob, ...prev]);
    queueOrderRef.current.push(jobId);

    if (onAddVideoTask) {
      onAddVideoTask({
        id: jobId,
        title: initialTitle,
        aspectRatio,
        fitMode: 'blur_capcut',
        status: 'queued',
        progress: 5,
        fps: 24,
        statusText: 'Na fila de produção em segundo plano...',
        createdAt: Date.now(),
      });
    }

    if (onAddAudioTask) {
      onAddAudioTask({
        id: `${jobId}-audio`,
        title: `Locução: ${initialTitle}`,
        textSnippet: targetUrl,
        charCount: targetUrl.length,
        voice: selectedVoice,
        settings: { rate: speed, pitch: '+0Hz', volume: '+0%' },
        status: 'queued',
        progress: 5,
        statusText: 'Aguardando na fila...',
        createdAt: Date.now(),
      });
    }

    // Snapshot current project settings for this specific job
    activeJobDataMapRef.current.set(jobId, {
      url: targetUrl,
      title: initialTitle,
      voice: selectedVoice,
      speed,
      aspectRatio,
      newsStyle,
      targetDurationSeconds,
      motionEffect,
      motionIntensity,
      colorFilter,
      enableBgMusic,
      bgMusicTrackId,
      bgMusicVolume,
      customMusicBlob,
      showWaveform,
      waveformStyle,
      waveformColor,
      showSubtitles,
    });

    // Clear input so user is immediately ready to input another link!
    setUrlInput('');
    setFeedbackNotice('✓ Vídeo adicionado à fila de produção em segundo plano! O editor continua livre.');
    setTimeout(() => setFeedbackNotice(null), 5000);

    // Trigger queue runner if not already active
    if (!isQueueRunningRef.current) {
      runQueue();
    }
  };

  // Listen for automated WhatsApp reportage jobs
  useEffect(() => {
    const handleWhatsAppReportage = (e: Event) => {
      const customEv = e as CustomEvent;
      const waJob = customEv.detail;
      if (!waJob || !waJob.parsed?.url) return;

      const jobId = `rep-wa-${waJob.id}`;
      if (activeJobDataMapRef.current.has(jobId)) return;

      const targetUrl = waJob.parsed.url;
      let initialHost = 'WhatsApp';
      try {
        initialHost = new URL(targetUrl).hostname.replace('www.', '');
      } catch {}

      const initialTitle = `WhatsApp · Reportagem (${initialHost})`;
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

      if (onAddVideoTask) {
        onAddVideoTask({
          id: jobId,
          title: initialTitle,
          aspectRatio: jobAspectRatio,
          fitMode: 'blur_capcut',
          status: 'queued',
          progress: 8,
          fps: 24,
          statusText: 'Automação WhatsApp em andamento...',
          createdAt: Date.now(),
        });
      }

      if (onAddAudioTask) {
        onAddAudioTask({
          id: `${jobId}-audio`,
          title: `Locução WhatsApp: ${initialTitle}`,
          textSnippet: targetUrl,
          charCount: targetUrl.length,
          voice: matchedVoice,
          settings: { rate: speed, pitch: '+0Hz', volume: '+0%' },
          status: 'queued',
          progress: 8,
          statusText: 'Aguardando na fila do WhatsApp...',
          createdAt: Date.now(),
        });
      }

      activeJobDataMapRef.current.set(jobId, {
        whatsappJobId: waJob.id,
        mediaVerifiedByUser: true, // Hands-free mode for WhatsApp automation
        url: targetUrl,
        title: initialTitle,
        voice: matchedVoice,
        speed,
        aspectRatio: jobAspectRatio,
        newsStyle,
        targetDurationSeconds: jobDuration,
        motionEffect,
        motionIntensity,
        colorFilter,
        enableBgMusic: jobBgMusic,
        bgMusicTrackId,
        bgMusicVolume,
        customMusicBlob,
        showWaveform,
        waveformStyle,
        waveformColor,
        showSubtitles: jobSubtitles,
        customMedia: (waJob as any).customMedia || (waJob as any).parsed?.customMedia,
      });

      if (!isQueueRunningRef.current) {
        runQueue();
      }
    };

    window.addEventListener('whatsapp-enqueue-reportage', handleWhatsAppReportage);
    return () => window.removeEventListener('whatsapp-enqueue-reportage', handleWhatsAppReportage);
  }, [
    selectedVoice,
    speed,
    aspectRatio,
    newsStyle,
    targetDurationSeconds,
    motionEffect,
    motionIntensity,
    colorFilter,
    enableBgMusic,
    bgMusicTrackId,
    bgMusicVolume,
    customMusicBlob,
    showWaveform,
    waveformStyle,
    waveformColor,
    showSubtitles,
  ]);

  // Re-generate audio if user changes voice or speed
  const handleRegenerateAudioAndVideo = async () => {
    if (!fullNarration) return;
    try {
      setStatus('synthesizing');
      setStatusMessage(`Regerando áudio com a voz ${selectedVoice.name}...`);

      const ttsAudio = await fetchRealTtsAudio(fullNarration, selectedVoice.id, speed);
      if (ttsAudio.speechBuffer) {
        speechAudioBufferRef.current = ttsAudio.speechBuffer;
        setSpeechBufferVersion((v) => v + 1);
      }

      const audioObj: GeneratedAudio = {
        id: `reportage-audio-${Date.now()}`,
        title: headline || article?.title || 'Reportagem',
        voice: selectedVoice,
        textSnippet: fullNarration.slice(0, 160),
        fullText: fullNarration,
        charCount: fullNarration.length,
        durationSeconds: ttsAudio.duration,
        createdAt: Date.now(),
        audioUrl: ttsAudio.url,
        downloadUrl: ttsAudio.url,
        blob: ttsAudio.blob,
        blobUrl: ttsAudio.url,
      };

      setGeneratedAudio(audioObj);
      setDuration(ttsAudio.duration);

      // Re-render video
      setStatus('rendering');
      setProgressPercent(65);
      setStatusMessage('Renderizando novo vídeo completo com a voz atualizada...');

      await preloadMediaBitmaps(scenes, article);

      const finalVideoResult = await renderCompleteVideo(
        ttsAudio.blob,
        ttsAudio.url,
        headline,
        tickerText,
        leadSummary,
        fullNarration,
        scenes,
        ttsAudio.duration,
        article?.siteName,
        undefined,
        ttsAudio.speechBuffer
      );

      setRenderedVideoBlob(finalVideoResult.blob);
      setRenderedVideoUrl(finalVideoResult.url);
      setRenderedVideoFilename(finalVideoResult.filename);
      setPlayerViewMode('exported');

      setStatus('ready');
      setProgressPercent(100);
      setStatusMessage('Vídeo atualizado com sucesso e pronto para download!');
    } catch (e: any) {
      setStatus('error');
      setErrorMessage(e.message || 'Erro ao regerar vídeo com nova voz');
    }
  };

  // Audio Playback & Sync Logic for Interactive Live Preview
  const togglePlayPause = () => {
    if (playerViewMode === 'exported' && renderedVideoPlayerRef.current) {
      const v = renderedVideoPlayerRef.current;
      if (v.paused) {
        v.play().catch(() => {});
        setIsPlaying(true);
      } else {
        v.pause();
        setIsPlaying(false);
      }
      return;
    }

    if (!audioElementRef.current) return;
    if (isPlaying) {
      audioElementRef.current.pause();
      setIsPlaying(false);
    } else {
      audioElementRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((e) => console.warn('Audio play error:', e));
    }
  };

  const handleSeek = (time: number) => {
    if (playerViewMode === 'exported' && renderedVideoPlayerRef.current) {
      renderedVideoPlayerRef.current.currentTime = time;
      setCurrentTime(time);
      return;
    }
    if (!audioElementRef.current) return;
    audioElementRef.current.currentTime = time;
    setCurrentTime(time);
  };

  // Update active scene based on current audio time
  useEffect(() => {
    if (scenes.length === 0 || duration <= 0) return;
    const sceneDuration = duration / scenes.length;
    const currentIdx = Math.min(Math.floor(currentTime / sceneDuration), scenes.length - 1);
    if (currentIdx !== activeSceneIndex && currentIdx >= 0) {
      setActiveSceneIndex(currentIdx);
    }
  }, [currentTime, duration, scenes.length, activeSceneIndex]);

  // Keep media bitmaps fresh whenever scenes or article change
  useEffect(() => {
    if (scenes.length > 0) {
      preloadMediaBitmaps(scenes, article);
    }
  }, [scenes, article]);

  // Main Live Canvas Render Loop
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isDestroyed = false;

    const renderLoop = () => {
      if (isDestroyed) return;

      const w = canvas.width;
      const h = canvas.height;

      renderBroadcastFrame(
        ctx,
        w,
        h,
        currentTime,
        duration,
        scenes,
        headline,
        tickerText,
        leadSummary,
        newsStyle,
        article?.siteName || '',
        showSubtitles,
        subtitlePhrases,
        mediaBitmapsRef.current,
        aspectRatio,
        Array.from(mediaBitmapsRef.current.values()),
        motionEffect,
        motionIntensity,
        colorFilter,
        showWaveform,
        waveformStyle,
        waveformColor
      );

      animationFrameRef.current = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => {
      isDestroyed = true;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    activeSceneIndex,
    currentTime,
    duration,
    headline,
    tickerText,
    leadSummary,
    newsStyle,
    scenes,
    article,
    fullNarration,
    showSubtitles,
    subtitlePhrases,
    aspectRatio,
    motionEffect,
    motionIntensity,
    colorFilter,
    showWaveform,
    waveformStyle,
    waveformColor,
  ]);

  // Sync Video Element when active scene is video in interactive preview
  useEffect(() => {
    const activeScene = scenes[activeSceneIndex];
    if (activeScene && activeScene.mediaType === 'video' && activeScene.mediaUrl) {
      if (previewVideoRef.current) {
        previewVideoRef.current.src = activeScene.mediaUrl;
        previewVideoRef.current.muted = true; // Always muted!
        if (isPlaying && playerViewMode === 'interactive') {
          previewVideoRef.current.play().catch(() => {});
        }
      }
    } else if (previewVideoRef.current) {
      previewVideoRef.current.pause();
    }
  }, [activeSceneIndex, isPlaying, scenes, playerViewMode]);

  // Handle direct download of the completed video
  const handleDownloadCompletedVideo = () => {
    if (renderedVideoBlob && renderedVideoBlob.size > 20000 && renderedVideoBlob.type.startsWith('video/')) {
      downloadBlob(renderedVideoBlob, renderedVideoFilename || 'reportagem-completa.mp4');
      return;
    }
    if (generatedAudio?.blob) {
      downloadBlob(generatedAudio.blob, `locucao-${(headline || 'reportagem').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}.mp3`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden Audio Player for Interactive Preview Sync */}
      {generatedAudio && (
        <audio
          ref={audioElementRef}
          src={generatedAudio.audioUrl}
          onTimeUpdate={() => {
            if (audioElementRef.current) {
              setCurrentTime(audioElementRef.current.currentTime);
            }
          }}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* Hidden Video for Canvas Synchronization */}
      <video ref={previewVideoRef} className="hidden" playsInline muted loop />

      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-red-950/40 via-neutral-900 to-cyan-950/40 border border-neutral-800 p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Film className="w-48 h-48 text-cyan-400" />
        </div>

        <div className="relative z-10 max-w-3xl space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/80 border border-red-800/80 text-red-300 text-xs font-bold tracking-wide uppercase">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
            <span>Matéria da Web para Vídeo Completo Automático</span>
          </div>

          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Cole o Link da Matéria e Receba o Vídeo Completo Pronto para Baixar
          </h1>
          <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
            Cole o link da reportagem (G1, BBC, UOL, CNN, Folha, TechMundo...). O sistema extrai fotos e vídeos (com áudio silenciado para não sobrepor à voz), cria a narração jornalística natural com IA, sintetiza a locução na voz configurada e renderiza o vídeo completo automaticamente com legendas estilo CapCut.
          </p>
        </div>
      </div>

      {/* Feedback Notice */}
      {feedbackNotice && (
        <div className="p-3.5 bg-emerald-950/80 border border-emerald-500/80 rounded-xl text-emerald-200 text-xs font-bold flex items-center gap-2 animate-in fade-in shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{feedbackNotice}</span>
        </div>
      )}

      {/* Multi-Video Background Task Queue: Allows simultaneous processing without blocking creation! */}
      <StudioTaskQueue
        items={queueItems}
        onSelectToView={handleSelectQueueItemToView}
        onDownload={(item) => {
          if (item.videoBlob) {
            downloadBlob(item.videoBlob, item.downloadFilename || 'reportagem.mp4');
          }
        }}
        onCancel={handleCancelQueueItem}
        onResume={handleResumeQueueItem}
        onClearCompleted={() => setQueueItems((prev) => prev.filter((i) => i.status !== 'completed'))}
      />

      {/* Input Section & Autonomous Action Button */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/90 p-4 sm:p-6 space-y-4 shadow-xl">
        <label className="block text-xs font-bold uppercase tracking-wider text-neutral-300">
          Link da Matéria ou Reportagem na Web
        </label>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Cole o link da reportagem (ex: https://g1.globo.com/... ou https://bbc.com/...)"
              className="w-full pl-10 pr-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all font-mono text-xs sm:text-sm"
            />
          </div>

          <button
            type="button"
            onClick={() => handleGenerateFullReportage()}
            disabled={!urlInput.trim()}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-red-600 via-rose-600 to-red-700 hover:from-red-500 hover:to-red-600 active:scale-95 disabled:opacity-50 transition-all shadow-lg shadow-red-950/50 cursor-pointer shrink-0"
          >
            {queueItems.some((i) => i.status !== 'completed' && i.status !== 'error' && i.status !== 'cancelled') ? (
              <>
                <Plus className="h-4 w-4 text-amber-300" />
                <span>+ Adicionar Mais um Vídeo à Fila ({queueItems.filter((i) => i.status !== 'completed' && i.status !== 'error' && i.status !== 'cancelled').length} ativo)</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-amber-300" />
                <span>Gerar Vídeo em Segundo Plano</span>
              </>
            )}
          </button>
        </div>

        {/* Preset Article Quick Buttons */}
        <div className="space-y-1.5 pt-1">
          <span className="text-[11px] font-semibold text-neutral-400 flex items-center gap-1">
            <span>Ou teste rapidamente com um link de exemplo:</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {PRESET_ARTICLE_EXAMPLES.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setUrlInput(item.url);
                  handleGenerateFullReportage(item.url);
                }}
                className="text-left px-3 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-xs text-neutral-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <span className="font-semibold text-red-400">[{item.site}]</span>
                <span className="truncate max-w-[200px]">{item.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Video Target Duration Control with LocalStorage Persistence */}
        <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800/80 pb-2.5">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-red-400" />
              <label className="text-xs sm:text-sm font-bold text-white">
                Quantidade de Tempo do Vídeo (Duração Alvo)
              </label>
              {durationSavedFeedback && (
                <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800">
                  ✓ Configuração salva
                </span>
              )}
            </div>
            <span className="text-[11px] text-neutral-400 font-mono">
              Tempo Selecionado: {Math.floor(targetDurationSeconds / 60)}m {targetDurationSeconds % 60}s ({targetDurationSeconds}s)
            </span>
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { sec: 30, label: '30s (Shorts)' },
              { sec: 45, label: '45s' },
              { sec: 60, label: '60s (1 min)' },
              { sec: 90, label: '90s (1.5 min)' },
              { sec: 120, label: '120s (2 min)' },
              { sec: 180, label: '180s (3 min)' },
            ].map((p) => (
              <button
                key={p.sec}
                type="button"
                onClick={() => handleUpdateDuration(p.sec)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                  targetDurationSeconds === p.sec
                    ? 'bg-red-600 text-white border-red-500 font-bold shadow'
                    : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-neutral-700 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Manual Slider & Numeric Minutes/Seconds */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center pt-1">
            <div className="sm:col-span-8 space-y-1">
              <input
                type="range"
                min={15}
                max={300}
                step={5}
                value={targetDurationSeconds}
                onChange={(e) => handleUpdateDuration(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-red-500"
              />
              <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
                <span>15s</span>
                <span>1 min</span>
                <span>2 min</span>
                <span>3 min</span>
                <span>5 min</span>
              </div>
            </div>

            <div className="sm:col-span-4 flex items-center gap-2">
              <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg p-1.5 flex items-center justify-between">
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

              <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg p-1.5 flex items-center justify-between">
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
        </div>

        {/* Configurations Bar: Voice, Subtitles (CapCut style), Speed, Format, Style */}
        <div className="pt-3 border-t border-neutral-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {/* Voice Selector */}
          <div className="space-y-1">
            <span className="text-neutral-400 font-semibold flex items-center gap-1">
              <Volume2 className="h-3.5 w-3.5 text-cyan-400" />
              <span>Voz do Narrador:</span>
            </span>
            <select
              value={selectedVoice.id}
              onChange={(e) => {
                const found = CURATED_VOICES.find((v) => v.id === e.target.value);
                if (found) setSelectedVoice(found);
              }}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              {CURATED_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.gender} - {v.langLabel})
                </option>
              ))}
            </select>
          </div>

          {/* Subtitles Option: CapCut animated phrase vs Deactivated */}
          <div className="space-y-1">
            <span className="text-neutral-400 font-semibold flex items-center gap-1">
              <Subtitles className="h-3.5 w-3.5 text-amber-400" />
              <span>Legenda na Tela:</span>
            </span>
            <div className="grid grid-cols-2 gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
              <button
                type="button"
                onClick={() => setShowSubtitles(true)}
                className={`py-1 rounded text-center font-bold text-[11px] transition-colors flex items-center justify-center gap-1 cursor-pointer ${
                  showSubtitles
                    ? 'bg-amber-500 text-neutral-950 shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title="Ativada: estilo CapCut, frase por frase dinâmica na tela sem blocos de texto"
              >
                <Check className="h-3 w-3" />
                <span>Ativada (CapCut)</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSubtitles(false)}
                className={`py-1 rounded text-center font-bold text-[11px] transition-colors cursor-pointer ${
                  !showSubtitles
                    ? 'bg-neutral-800 text-white shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title="Desativar legendas no vídeo"
              >
                <span>Desativada</span>
              </button>
            </div>
          </div>

          {/* Speed Selector */}
          <div className="space-y-1">
            <span className="text-neutral-400 font-semibold flex items-center gap-1">
              <Sliders className="h-3.5 w-3.5 text-emerald-400" />
              <span>Velocidade de Locução:</span>
            </span>
            <select
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="-10%">0.9x (Pausada & Serena)</option>
              <option value="+0%">1.0x (Padrão Telejornal)</option>
              <option value="+10%">1.1x (Dinâmica & Ágil)</option>
              <option value="+20%">1.2x (Urgente & Rápida)</option>
            </select>
          </div>

          {/* Video Aspect Ratio */}
          <div className="space-y-1">
            <span className="text-neutral-400 font-semibold flex items-center gap-1">
              <Video className="h-3.5 w-3.5 text-violet-400" />
              <span>Formato do Vídeo:</span>
            </span>
            <div className="grid grid-cols-3 gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
              <button
                type="button"
                onClick={() => setAspectRatio('9:16')}
                className={`py-1 rounded text-center font-bold text-[11px] transition-colors cursor-pointer ${
                  aspectRatio === '9:16' ? 'bg-violet-900 text-violet-200' : 'text-neutral-400 hover:text-white'
                }`}
                title="Vertical para Reels, TikTok, Shorts"
              >
                9:16
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio('16:9')}
                className={`py-1 rounded text-center font-bold text-[11px] transition-colors cursor-pointer ${
                  aspectRatio === '16:9' ? 'bg-violet-900 text-violet-200' : 'text-neutral-400 hover:text-white'
                }`}
                title="Horizontal para YouTube e TV"
              >
                16:9
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio('1:1')}
                className={`py-1 rounded text-center font-bold text-[11px] transition-colors cursor-pointer ${
                  aspectRatio === '1:1' ? 'bg-violet-900 text-violet-200' : 'text-neutral-400 hover:text-white'
                }`}
                title="Quadrado para Feed"
              >
                1:1
              </button>
            </div>
          </div>

          {/* Television Style */}
          <div className="space-y-1">
            <span className="text-neutral-400 font-semibold flex items-center gap-1">
              <Radio className="h-3.5 w-3.5 text-red-400" />
              <span>Estilo da Tarja de TV:</span>
            </span>
            <select
              value={newsStyle}
              onChange={(e) => setNewsStyle(e.target.value as any)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-red-500 cursor-pointer"
            >
              <option value="urgente">🔴 Plantão Urgente (Vermelho)</option>
              <option value="especial">🔵 Reportagem Especial (Azul)</option>
              <option value="investigacao">🟢 Investigação / Ciência</option>
            </select>
          </div>
        </div>
      </div>

      {/* Background Music, Motion, Color Filters & Waveform Visualizer Panel (VideoVozLivre parity) */}
      <StudioEffectsAndMusicPanel
        enableBgMusic={enableBgMusic}
        onToggleEnableBgMusic={setEnableBgMusic}
        bgMusicTrackId={bgMusicTrackId}
        onChangeBgMusicTrackId={setBgMusicTrackId}
        bgMusicVolume={bgMusicVolume}
        onChangeBgMusicVolume={setBgMusicVolume}
        customMusicName={customMusicName}
        onCustomMusicUploaded={(blob, name, url) => {
          setCustomMusicBlob(blob);
          setCustomMusicName(name);
          setCustomMusicUrl(url);
          setBgMusicTrackId('custom');
          setEnableBgMusic(true);
        }}
        motionEffect={motionEffect}
        onChangeMotionEffect={setMotionEffect}
        motionIntensity={motionIntensity}
        onChangeMotionIntensity={setMotionIntensity}
        colorFilter={colorFilter}
        onChangeColorFilter={setColorFilter}
        showWaveform={showWaveform}
        onToggleShowWaveform={setShowWaveform}
        waveformStyle={waveformStyle}
        onChangeWaveformStyle={setWaveformStyle}
        waveformColor={waveformColor}
        onChangeWaveformColor={setWaveformColor}
      />

      {/* Progress & Live Simultaneous Pipeline Indicator */}
      {(status === 'extracting' || status === 'scripting' || status === 'synthesizing' || status === 'rendering') && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 space-y-4 animate-in fade-in shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">Monitor de Processamento Simultâneo (Áudio & Vídeo)</span>
                <span className="text-[10px] text-red-300 bg-red-950 px-2 py-0.5 rounded border border-red-800 font-mono font-bold uppercase">
                  Sem Bloqueios
                </span>
              </div>
            </div>
            <span className="text-xs font-mono font-bold text-amber-300">
              Progresso Geral: {progressPercent}%
            </span>
          </div>

          {/* Dual Pipelines */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Audio Pipeline */}
            <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Pipeline 1: Áudio Neural</span>
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
              <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full transition-all duration-300"
                  style={{ width: `${audioTaskProgress}%` }}
                />
              </div>
              <div className="text-[11px] text-neutral-400 flex justify-between">
                <span>Voz: {selectedVoice.name}</span>
                <span className="font-mono text-cyan-300">{audioTaskProgress}%</span>
              </div>
            </div>

            {/* Video Pipeline */}
            <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                  <Film className="h-3.5 w-3.5" />
                  <span>Pipeline 2: Renderização MP4</span>
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
              <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-amber-500 to-red-500 h-full transition-all duration-300"
                  style={{ width: `${videoTaskProgress}%` }}
                />
              </div>
              <div className="text-[11px] text-neutral-400 flex justify-between">
                <span>Formato: {aspectRatio} · Estilo: {newsStyle}</span>
                <span className="font-mono text-amber-300">{videoTaskProgress}%</span>
              </div>
            </div>
          </div>

          <div className="text-xs text-neutral-400 flex items-center justify-between pt-1">
            <span className="truncate">{statusMessage}</span>
            <span className="text-[11px] text-neutral-500">Hardware WebCodecs Ativo</span>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 flex items-center gap-3 text-xs text-rose-200 animate-in fade-in">
          <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
          <span className="flex-1">{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* SUCCESS BANNER & INSTANT DOWNLOAD CARD (Returned when video is complete!) */}
      {status === 'ready' && (
        <div className="rounded-2xl border border-emerald-600/60 bg-gradient-to-r from-emerald-950/60 via-neutral-900 to-cyan-950/50 p-5 sm:p-6 shadow-2xl space-y-4 animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950 border border-emerald-500/80 text-emerald-300 text-xs font-bold tracking-wide uppercase">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Vídeo Completo Gerado com Sucesso!</span>
              </div>
              <h2 className="text-lg sm:text-xl font-black text-white">
                Seu vídeo está pronto com tudo feito: locução, fotos, vídeos e legendas!
              </h2>
              <p className="text-xs text-neutral-300 max-w-2xl">
                O arquivo de vídeo renderizado com áudio e legendas sincronizadas já está disponível para assistir e baixar.
                {renderedVideoBlob && (
                  <span className="ml-1 text-emerald-300 font-semibold font-mono">
                    ({(renderedVideoBlob.size / 1024 / 1024).toFixed(1)} MB)
                  </span>
                )}
              </p>
            </div>

            {/* BIG DOWNLOAD BUTTON (DEVOLVENDO O VÍDEO COMPLETO JÁ PRA BAIXAR COM TUDO FEITO!) */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleDownloadCompletedVideo}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-black text-sm text-neutral-950 bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 active:scale-95 transition-all shadow-xl shadow-emerald-950/60 cursor-pointer"
              >
                <Download className="h-5 w-5 stroke-[2.5]" />
                <span>Baixar Vídeo Completo (.MP4)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Studio Display: Interactive Live Player, Subtitle Quick Toggle & Timeline */}
      {status === 'ready' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column / Video Player Stage (7 cols) */}
          <div className="lg:col-span-7 space-y-3">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-3 sm:p-4 space-y-3 shadow-2xl">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Film className="h-4 w-4 text-cyan-400" />
                  <span>Estúdio de Exibição</span>
                </span>

                <div className="flex items-center gap-2">
                  {/* Mode Switcher: Interactive Live Preview vs Rendered MP4 */}
                  {renderedVideoUrl && (
                    <div className="flex items-center bg-neutral-950 p-0.5 rounded-lg border border-neutral-800 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setPlayerViewMode('exported')}
                        className={`px-2 py-1 rounded font-bold transition-colors cursor-pointer ${
                          playerViewMode === 'exported'
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        🎬 Vídeo MP4
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlayerViewMode('interactive')}
                        className={`px-2 py-1 rounded font-bold transition-colors cursor-pointer ${
                          playerViewMode === 'interactive'
                            ? 'bg-cyan-600 text-white shadow-sm'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        🎨 Prévia Interativa
                      </button>
                    </div>
                  )}

                  {/* Quick Subtitle Toggle on the Player Bar */}
                  <button
                    type="button"
                    onClick={() => setShowSubtitles(!showSubtitles)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer border ${
                      showSubtitles
                        ? 'bg-amber-950/70 border-amber-600/80 text-amber-300'
                        : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-white'
                    }`}
                    title={showSubtitles ? 'Clique para ocultar as legendas' : 'Clique para ativar legendas estilo CapCut'}
                  >
                    <Subtitles className="h-3 w-3" />
                    <span>{showSubtitles ? 'Legendas CapCut: ON' : 'Legendas: OFF'}</span>
                  </button>

                  <span className="text-[11px] font-mono text-cyan-300 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                  <span className="text-[10px] uppercase font-bold text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded">
                    {aspectRatio}
                  </span>
                </div>
              </div>

              {/* Video Player Display: Rendered MP4 native player OR interactive Canvas Stage */}
              <div className="relative rounded-xl overflow-hidden bg-neutral-950 flex items-center justify-center border border-neutral-800 max-h-[520px]">
                {playerViewMode === 'exported' && renderedVideoUrl ? (
                  <video
                    ref={renderedVideoPlayerRef}
                    src={renderedVideoUrl}
                    controls
                    autoPlay
                    playsInline
                    className="max-h-[520px] w-full object-contain bg-black"
                    onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                    onEnded={() => setIsPlaying(false)}
                  />
                ) : (
                  <>
                    <canvas
                      ref={previewCanvasRef}
                      width={aspectRatio === '9:16' ? 540 : aspectRatio === '1:1' ? 600 : 960}
                      height={aspectRatio === '9:16' ? 960 : aspectRatio === '1:1' ? 600 : 540}
                      className="max-h-[520px] w-auto object-contain cursor-pointer"
                      onClick={togglePlayPause}
                    />

                    {/* Big Center Play Icon overlay if paused */}
                    {!isPlaying && (
                      <button
                        type="button"
                        onClick={togglePlayPause}
                        className="absolute inset-0 m-auto h-16 w-16 rounded-full bg-black/60 hover:bg-black/80 border border-white/20 text-white flex items-center justify-center backdrop-blur-sm transition-transform active:scale-90 cursor-pointer"
                      >
                        <Play className="h-8 w-8 ml-1" />
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Player Timeline & Controls */}
              <div className="space-y-2 pt-1">
                <input
                  type="range"
                  min={0}
                  max={duration || 10}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => handleSeek(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-neutral-800 rounded-lg"
                />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={togglePlayPause}
                      className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 active:scale-95 transition-all cursor-pointer font-bold"
                    >
                      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSeek(0)}
                      className="p-2 text-neutral-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                      title="Reiniciar do começo"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <span className="text-xs text-neutral-400 font-mono">
                      Cena {activeSceneIndex + 1} de {scenes.length}
                    </span>
                  </div>

                  {/* Direct Download Button */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDownloadCompletedVideo}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-neutral-950 bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 active:scale-95 transition-all shadow-md cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 stroke-[2.5]" />
                      <span>Baixar Vídeo (.MP4)</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Action Navigation Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-neutral-900 border border-neutral-800 text-xs">
              <span className="text-neutral-400">Usar conteúdo em outros módulos:</span>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => onTransferToVoice(fullNarration, headline || article?.title)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition-colors cursor-pointer"
                >
                  <Volume2 className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Abrir no Conversor de Voz</span>
                </button>
                {onTransferToVideo && generatedAudio && (
                  <button
                    type="button"
                    onClick={() => onTransferToVideo(generatedAudio)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-950 border border-violet-800 hover:bg-violet-900 text-violet-200 font-medium transition-colors cursor-pointer"
                  >
                    <Video className="h-3.5 w-3.5 text-violet-400" />
                    <span>Abrir no VideoVozLivre</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: News Script, Scene Timeline & Extracted Media Gallery (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Journalistic Script & Narration Editor */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
                <div className="flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Roteiro e Narração Natural
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditingScript(!isEditingScript)}
                  className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer"
                >
                  <Edit3 className="h-3 w-3" />
                  <span>{isEditingScript ? 'Concluir Edição' : 'Editar Texto'}</span>
                </button>
              </div>

              {isEditingScript ? (
                <div className="space-y-3">
                  <textarea
                    value={fullNarration}
                    onChange={(e) => setFullNarration(e.target.value)}
                    rows={7}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-cyan-500 leading-relaxed font-sans"
                    placeholder="Edite a locução da reportagem aqui..."
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleRegenerateAudioAndVideo}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500 text-neutral-950 hover:bg-cyan-400 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Atualizar Áudio e Vídeo</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-850 text-xs text-neutral-200 leading-relaxed max-h-48 overflow-y-auto space-y-2">
                  <p className="font-semibold text-white">{headline}</p>
                  <p className="text-neutral-300 whitespace-pre-wrap">{fullNarration}</p>
                </div>
              )}
            </div>

            {/* Visual Timeline of Scenes (Photos and Videos) */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
                <div className="flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-cyan-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Cenas & Mídias da Matéria ({scenes.length})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const updated = await openQuickMediaReview(
                        headline || article?.title || 'Reportagem',
                        scenes,
                        article
                      );
                      if (updated) {
                        setScenes(updated);
                        await preloadMediaBitmaps(updated, article);
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors cursor-pointer"
                  >
                    <Eye className="h-3 w-3" />
                    <span>Verificar / Trocar Mídias</span>
                  </button>
                  <span className="text-[10px] text-neutral-400 hidden sm:inline">
                    Clique para pular para a cena
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 max-h-96 overflow-y-auto pr-1">
                {scenes.map((scene, idx) => {
                  const isActive = idx === activeSceneIndex;
                  const cleanCap = cleanCaptionText(scene.caption);
                  const cleanNarration = cleanCaptionText(scene.narrationSegment.replace(/\[pausa.*?\]/gi, ''));
                  return (
                    <div
                      key={scene.id || idx}
                      onClick={() => {
                        const sceneDuration = duration / Math.max(1, scenes.length);
                        handleSeek(idx * sceneDuration);
                      }}
                      className={`group relative rounded-xl border transition-all cursor-pointer flex flex-col overflow-hidden bg-neutral-950/80 ${
                        isActive
                          ? 'border-cyan-400 ring-2 ring-cyan-500/50 shadow-lg shadow-cyan-950/40 bg-neutral-900'
                          : 'border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900/60'
                      }`}
                      title={cleanCap || cleanNarration}
                    >
                      {/* Media Thumbnail */}
                      <div className="relative aspect-video w-full rounded-t-xl overflow-hidden bg-neutral-900 shrink-0 border-b border-neutral-800/80">
                        {scene.thumbnailUrl || scene.mediaUrl ? (
                          <div className="relative h-full w-full">
                            <img
                              src={scene.thumbnailUrl || scene.mediaUrl}
                              alt={cleanCap || 'Foto'}
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                            {scene.mediaType === 'video' && (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                <Video className="h-5 w-5 text-cyan-300 drop-shadow" />
                              </div>
                            )}
                          </div>
                        ) : scene.mediaType === 'video' ? (
                          <div className="h-full w-full bg-slate-900 flex flex-col items-center justify-center text-cyan-400">
                            <Video className="h-5 w-5" />
                            <span className="text-[9px] font-bold text-cyan-300">VÍDEO</span>
                          </div>
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-neutral-600">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        )}

                        {/* Active Scene indicator */}
                        {isActive && (
                          <span className="absolute top-1 left-1 bg-cyan-500 text-neutral-950 text-[9px] font-black px-1.5 py-0.5 rounded shadow">
                            Ativa
                          </span>
                        )}

                        {/* Time indicator */}
                        <span className="absolute bottom-1 right-1 bg-black/80 text-white font-mono text-[9px] px-1 rounded">
                          {formatTime((duration / Math.max(1, scenes.length)) * idx)}
                        </span>

                        {/* Muted Audio Badge for videos as requested */}
                        {scene.mediaType === 'video' && (
                          <span
                            className="absolute bottom-1 left-1 bg-black/80 text-amber-300 p-0.5 rounded text-[8px] flex items-center"
                            title="Áudio do vídeo silenciado para não sobrepor à voz"
                          >
                            <VolumeX className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>

                      {/* Scene Clean Caption & Placement */}
                      <div className="p-2 space-y-1 flex-1 flex flex-col justify-between">
                        <p className="text-[11px] font-medium text-neutral-200 line-clamp-2 leading-tight">
                          {cleanCap || cleanNarration.slice(0, 50)}
                        </p>
                        <div className="flex items-center justify-between text-[9px] text-neutral-400 pt-1 border-t border-neutral-800/80">
                          <span className="truncate">
                            {scene.placement === 'headline_lead'
                              ? 'Abertura'
                              : scene.placement === 'climax_video'
                              ? 'Clímax'
                              : scene.placement === 'conclusion'
                              ? 'Encerramento'
                              : scene.mediaType === 'video'
                              ? 'Vídeo'
                              : 'Imagem'}
                          </span>
                          <span className="text-cyan-400 font-medium">Ver</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Extracted Media Gallery from the Original Article */}
            {article && ((article.images && article.images.length > 0) || (article.videos && article.videos.length > 0)) && (
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 space-y-3 shadow-xl">
                <div className="flex items-center justify-between border-b border-neutral-800 pb-2.5">
                  <div className="flex items-center gap-1.5">
                    <ImageIcon className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Galeria Extraída da Matéria
                    </span>
                  </div>
                  <span className="text-[10px] text-neutral-400">
                    {article.images.length} fotos · {article.videos.length} vídeos · Clique para aplicar na cena ativa
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5 max-h-48 overflow-y-auto pr-1">
                  {article.images.map((img, i) => (
                    <div
                      key={img.id || i}
                      onClick={() => {
                        // Apply this photo to the active scene without altering any other settings!
                        setScenes((prev) => {
                          const updated = [...prev];
                          if (updated[activeSceneIndex]) {
                            updated[activeSceneIndex] = {
                              ...updated[activeSceneIndex],
                              mediaUrl: img.proxyUrl || img.url,
                              thumbnailUrl: img.proxyUrl || img.url,
                              mediaType: 'image',
                            };
                          }
                          return updated;
                        });
                      }}
                      className="group relative rounded-lg overflow-hidden border border-neutral-800 hover:border-cyan-400 aspect-video bg-neutral-950 cursor-pointer transition-all hover:scale-105"
                      title={cleanCaptionText(img.caption || img.alt || 'Clique para usar esta foto na cena ativa')}
                    >
                      <img src={img.proxyUrl || img.url} alt="" className="h-full w-full object-cover" />
                      <span className="absolute bottom-1 left-1 text-[9px] bg-black/80 text-white px-1 rounded">
                        Foto {i + 1}
                      </span>
                      <span className="absolute inset-0 bg-cyan-950/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] font-bold text-cyan-200 transition-opacity">
                        Usar
                      </span>
                    </div>
                  ))}

                  {article.videos.map((vid, i) => (
                    <div
                      key={vid.id || i}
                      onClick={() => {
                        // Apply this video to the active scene without altering any other settings!
                        setScenes((prev) => {
                          const updated = [...prev];
                          if (updated[activeSceneIndex]) {
                            updated[activeSceneIndex] = {
                              ...updated[activeSceneIndex],
                              mediaUrl: vid.proxyUrl || vid.url,
                              thumbnailUrl: vid.thumbnailUrl || vid.proxyUrl,
                              mediaType: 'video',
                              isMutedVideo: true,
                            };
                          }
                          return updated;
                        });
                      }}
                      className="group relative rounded-lg overflow-hidden border border-cyan-800/80 hover:border-cyan-400 aspect-video bg-cyan-950/60 cursor-pointer transition-all hover:scale-105"
                      title={cleanCaptionText(vid.caption || 'Clique para usar este vídeo na cena ativa')}
                    >
                      {vid.thumbnailUrl || vid.proxyUrl ? (
                        <img src={vid.thumbnailUrl || vid.proxyUrl} alt="" className="h-full w-full object-cover" />
                      ) : null}
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center p-1">
                        <Video className="h-4 w-4 text-cyan-300 drop-shadow" />
                        <span className="text-[8px] font-bold text-white drop-shadow mt-0.5">Vídeo {i + 1}</span>
                      </div>
                      <span className="absolute bottom-1 right-1 text-[7px] bg-black/80 text-amber-300 px-1 rounded flex items-center gap-0.5">
                        <VolumeX className="h-2 w-2" /> Silenciado
                      </span>
                      <span className="absolute inset-0 bg-cyan-950/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] font-bold text-cyan-200 transition-opacity">
                        Usar
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {mediaReviewState && (
        <QuickMediaReviewModal
          isOpen={mediaReviewState.isOpen}
          studioTitle={mediaReviewState.title}
          studioBadge="Matéria para Vídeo · Verificação Rápida de Mídias"
          scenes={mediaReviewState.scenes}
          extraAlternatives={mediaReviewState.extraAlternatives}
          onConfirm={(updatedScenes) => mediaReviewState.resolve(updatedScenes)}
          onCancel={() => mediaReviewState.resolve(null)}
        />
      )}
    </div>
  );
};
