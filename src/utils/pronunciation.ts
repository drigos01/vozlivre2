/**
 * Pronunciation & Phonetic Dictionary utility for VozLivre.
 * Replaces difficult foreign words, tech terms, and acronyms with phonetic spellings
 * so neural voices speak them perfectly in Portuguese.
 */

export interface PronunciationRule {
  id: string;
  original: string;
  replacement: string;
  enabled: boolean;
  isDefault?: boolean;
}

const STORAGE_KEY = 'vozlivre_pronunciation_rules_v1';

export const DEFAULT_PRONUNCIATION_RULES: PronunciationRule[] = [
  { id: 'def-1', original: 'Wi-Fi', replacement: 'uai-fai', enabled: true, isDefault: true },
  { id: 'def-2', original: 'WhatsApp', replacement: 'uátizap', enabled: true, isDefault: true },
  { id: 'def-3', original: 'ChatGPT', replacement: 'Chat G P T', enabled: true, isDefault: true },
  { id: 'def-4', original: 'AI', replacement: 'inteligência artificial', enabled: false, isDefault: true },
  { id: 'def-5', original: 'Feedback', replacement: 'fidibék', enabled: true, isDefault: true },
  { id: 'def-6', original: 'Design', replacement: 'dezáine', enabled: true, isDefault: true },
  { id: 'def-7', original: 'Download', replacement: 'daunlôud', enabled: true, isDefault: true },
  { id: 'def-8', original: 'Podcast', replacement: 'pódicast', enabled: true, isDefault: true },
  { id: 'def-9', original: 'Online', replacement: 'on-láine', enabled: true, isDefault: true },
  { id: 'def-10', original: 'YouTube', replacement: 'Iutúbi', enabled: true, isDefault: true },
];

export function getPronunciationRules(): PronunciationRule[] {
  if (typeof window === 'undefined') return DEFAULT_PRONUNCIATION_RULES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRONUNCIATION_RULES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_PRONUNCIATION_RULES;
  } catch {
    return DEFAULT_PRONUNCIATION_RULES;
  }
}

export function savePronunciationRules(rules: PronunciationRule[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch (err) {
    console.warn('Failed to save pronunciation rules:', err);
  }
}

/**
 * Applies active pronunciation rules to a text string.
 */
export function applyPronunciation(text: string, rules?: PronunciationRule[]): string {
  if (!text) return '';
  const activeRules = (rules || getPronunciationRules()).filter((r) => r.enabled && r.original.trim());
  let result = text;

  for (const rule of activeRules) {
    try {
      const escaped = rule.original.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Case-insensitive word boundary replacement
      const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
      result = result.replace(regex, rule.replacement.trim());
    } catch {
      // ignore regex syntax issues
    }
  }

  return result;
}
