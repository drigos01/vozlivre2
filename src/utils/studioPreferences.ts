import { VideoAspectRatio, Voice } from '../types';
import { CURATED_VOICES } from '../constants/voices';

export type StudioMotionEffect = 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'subtle' | 'pulse' | 'float';
export type StudioColorFilter = 'normal' | 'cinematic' | 'vignette' | 'vintage' | 'bw' | 'warm' | 'cool' | 'cyberpunk';
export type StudioWaveformStyle = 'bars' | 'line';
export type StudioWaveformColor = 'white' | 'emerald' | 'cyan' | 'violet' | 'amber';

export interface StudioPreferences {
  lastVoiceId: string;
  speed: string; // e.g. '+0%', '+10%'
  aspectRatio: VideoAspectRatio; // '9:16' | '16:9' | '1:1'
  targetDurationSec: number;
  motionEffect: StudioMotionEffect;
  motionIntensity: number; // 10 to 200 (%)
  colorFilter: StudioColorFilter;
  enableBgMusic: boolean;
  bgMusicTrackId: string; // 'news', 'cinematic', 'lofi', 'acoustic', 'piano', 'ambient', 'custom'
  bgMusicVolume: number; // 0.0 to 1.0 (default 0.15)
  customMusicName: string;
  showWaveform: boolean;
  waveformStyle: StudioWaveformStyle;
  waveformColor: StudioWaveformColor;
  showSubtitles: boolean;
  subtitleStyle: 'capcut' | 'clean';
  newsStyle: 'urgente' | 'especial' | 'investigacao';
}

const STORAGE_KEY_PREFS = 'vozlivre_studio_preferences_v2';
const STORAGE_KEY_VOICE = 'vozlivre_selected_voice_v1';

export const DEFAULT_STUDIO_PREFERENCES: StudioPreferences = {
  lastVoiceId: 'pt-BR-FranciscaNeural',
  speed: '+0%',
  aspectRatio: '9:16',
  targetDurationSec: 60,
  motionEffect: 'zoom-in',
  motionIntensity: 100,
  colorFilter: 'cinematic',
  enableBgMusic: true,
  bgMusicTrackId: 'news',
  bgMusicVolume: 0.18,
  customMusicName: '',
  showWaveform: true,
  waveformStyle: 'bars',
  waveformColor: 'cyan',
  showSubtitles: true,
  subtitleStyle: 'capcut',
  newsStyle: 'urgente',
};

/**
 * Loads persisted studio preferences from localStorage, falling back to sensible defaults.
 */
export function loadStudioPreferences(): StudioPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFS);
    if (!raw) {
      // Fallback check: check if voice was saved in general app key
      const savedVoiceId = localStorage.getItem(STORAGE_KEY_VOICE);
      return savedVoiceId
        ? { ...DEFAULT_STUDIO_PREFERENCES, lastVoiceId: savedVoiceId }
        : DEFAULT_STUDIO_PREFERENCES;
    }
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STUDIO_PREFERENCES,
      ...parsed,
    };
  } catch (err) {
    console.warn('Erro ao carregar preferências do estúdio:', err);
    return DEFAULT_STUDIO_PREFERENCES;
  }
}

/**
 * Automatically persists studio preferences and keeps lastVoiceId in sync across app.
 */
export function saveStudioPreferences(updates: Partial<StudioPreferences>): StudioPreferences {
  try {
    const current = loadStudioPreferences();
    const updated: StudioPreferences = {
      ...current,
      ...updates,
    };
    localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(updated));

    if (updates.lastVoiceId) {
      localStorage.setItem(STORAGE_KEY_VOICE, updates.lastVoiceId);
    }
    return updated;
  } catch (err) {
    console.warn('Erro ao salvar preferências do estúdio:', err);
    return { ...DEFAULT_STUDIO_PREFERENCES, ...updates };
  }
}

/**
 * Helper to resolve Voice object from voice ID with fallback
 */
export function resolveVoice(voiceId?: string): Voice {
  if (voiceId) {
    const found = CURATED_VOICES.find((v) => v.id === voiceId || v.id.includes(voiceId));
    if (found) return found;
  }
  return CURATED_VOICES.find((v) => v.id.includes('Francisca')) || CURATED_VOICES[0];
}
