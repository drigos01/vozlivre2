import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { CURATED_VOICES } from '../constants/voices';

/**
 * Intelligent text chunker: splits text into natural pieces
 * between 250 and 450 characters respecting punctuation boundaries.
 */
export function chunkText(text: string, maxLen = 420): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\t/g, ' ').trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n+/);
  const sentences: string[] = [];

  for (const para of paragraphs) {
    const rawSentences = para.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [para];
    for (const s of rawSentences) {
      const trimmed = s.trim();
      if (trimmed) sentences.push(trimmed);
    }
  }

  const chunks: string[] = [];
  let current = '';

  for (const s of sentences) {
    if (s.length > maxLen) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      const commas = s.split(/(?<=[,;:—])\s+/);
      for (const part of commas) {
        if ((current + ' ' + part).trim().length > maxLen) {
          if (current.trim()) chunks.push(current.trim());
          current = part;
        } else {
          current = current ? `${current} ${part}` : part;
        }
      }
    } else if ((current + ' ' + s).trim().length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function sanitizeTextForTts(raw: string, lang = 'pt-BR'): string {
  if (!raw) return '';

  let text = raw
    .replace(/\[pausa(?::|\s+)?(\d*\.?\d*)\s*(s|ms)?\]/gi, (_m, val, unit) => {
      let ms = 1000;
      if (val) {
        const num = parseFloat(val);
        if (!isNaN(num)) ms = unit === 'ms' ? Math.round(num) : Math.round(num * 1000);
      }
      return ms >= 1200 ? '... ... ' : '... ';
    })
    .replace(/\[ênfase\](.*?)\[\/ênfase\]/gi, ' "$1" ')
    .replace(/\[enfase\](.*?)\[\/enfase\]/gi, ' "$1" ')
    .replace(/\[sussurro\](.*?)\[\/sussurro\]/gi, ' ($1) ')
    .replace(/\[r[aá]pido\](.*?)\[\/r[aá]pido\]/gi, ' $1 ')
    .replace(/\[lento\](.*?)\[\/lento\]/gi, ' $1... ')
    .replace(/\[grave\](.*?)\[\/grave\]/gi, ' $1 ')
    .replace(/\[agudo\](.*?)\[\/agudo\]/gi, ' $1 ')
    .replace(/\[(?:forte|grito)\](.*?)\[\/(?:forte|grito)\]/gi, ' $1! ');

  const andWord = lang.startsWith('en') ? ' and ' : lang.startsWith('es') ? ' y ' : ' e ';
  text = text.replace(/&(?!(amp|lt|gt|quot|apos);)/gi, andWord);

  text = text
    .replace(/</g, lang.startsWith('en') ? ' less than ' : ' menor que ')
    .replace(/>/g, lang.startsWith('en') ? ' greater than ' : ' maior que ');

  text = text.replace(/<\/?[^>]+(>|$)/g, ' ');
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  text = text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();

  return text;
}

/**
 * Synthesizes a single chunk with MsEdgeTTS.
 */
export async function synthesizeSingleChunk(
  text: string,
  voice: string,
  rate = '+0%',
  pitch = '+0Hz',
  volume = '+0%',
  overrideLocale?: string
): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  const matchedVoice = CURATED_VOICES.find((v) => v.id === voice);
  const voiceLocale =
    overrideLocale ||
    matchedVoice?.voiceLocale ||
    (voice.startsWith('pt-') ? 'pt-BR' : undefined);
  const sanitized = sanitizeTextForTts(text, voiceLocale || (voice.startsWith('pt-') ? 'pt-BR' : 'en'));

  if (voiceLocale) {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { voiceLocale });
  } else {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  }

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const { audioStream } = tts.toStream(sanitized, {
        rate: rate || '+0%',
        pitch: pitch || '+0Hz',
        volume: volume || '+0%',
      });

      const chunks: Buffer[] = [];
      audioStream.on('data', (d: Buffer) => chunks.push(d));
      audioStream.on('end', () => {
        try { tts.close(); } catch {}
        resolve(Buffer.concat(chunks));
      });
      audioStream.on('error', (err) => {
        const totalReceived = Buffer.concat(chunks).length;
        if (
          totalReceived > 4096 &&
          err?.message?.includes('no turn.end received')
        ) {
          try { tts.close(); } catch {}
          resolve(Buffer.concat(chunks));
          return;
        }

        try { tts.close(); } catch {}
        reject(err);
      });
    } catch (e) {
      try { tts.close(); } catch {}
      reject(e);
    }
  });
}

/**
 * Synthesizes long text by chunking and processing in controlled parallel batches.
 */
export async function synthesizeLongText(
  text: string,
  voice: string,
  rate = '+0%',
  pitch = '+0Hz',
  volume = '+0%',
  onProgress?: (completed: number, total: number) => void
): Promise<Buffer> {
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error('Nenhum texto válido fornecido para conversão.');
  }

  const results: Buffer[] = new Array(chunks.length);
  const concurrency = 4;
  let currentIndex = 0;
  let completedCount = 0;

  async function worker() {
    while (currentIndex < chunks.length) {
      const idx = currentIndex++;
      const chunk = chunks[idx];
      let attempts = 0;
      let success = false;

      while (!success && attempts < 3) {
        try {
          attempts++;
          results[idx] = await synthesizeSingleChunk(chunk, voice, rate, pitch, volume);
          success = true;
          completedCount++;
          if (onProgress) {
            onProgress(completedCount, chunks.length);
          }
        } catch (err) {
          if (attempts >= 3) {
            throw err;
          }
          await new Promise((r) => setTimeout(r, 300 * attempts));
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker());
  await Promise.all(workers);

  return Buffer.concat(results);
}
