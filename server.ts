import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local' });

// Global process error handlers: prevents transient WebSocket/stream drops from crashing Node,
// while properly logging full diagnostic context and allowing controlled exit on fatal system faults.
process.on('unhandledRejection', (reason: any) => {
  const errMsg = reason?.message || String(reason);
  console.error('[Process Protection] ⚠️ Rejeição de Promise não tratada detectada:', errMsg);
  if (reason?.stack) {
    console.error('[Process Protection] Stack:', reason.stack);
  }
});

process.on('uncaughtException', (err: Error) => {
  console.error('[Process Protection] 🚨 Exceção não capturada crítica:', err?.message || err);
  if (err?.stack) {
    console.error('[Process Protection] Stack:', err.stack);
  }
  if (err?.message?.includes('out of memory') || err?.message?.includes('ENOMEM')) {
    console.error('[Process Protection] Falha irrecuperável de memória do sistema. Encerrando para reinício limpo...');
    process.exit(1);
  }
});

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import * as cheerio from 'cheerio';
import { extractArticleFromUrl, generateReportageScript } from './src/server/reportageService';
import { generateNarrativeVideoScript, searchRealWebMedia } from './src/server/narrativeService';
import { whatsappService } from './src/server/whatsappService';
import { geminiKeyManager } from './src/server/geminiKeyManager';
import { whatsappAssistantService } from './src/server/whatsappAssistantService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = 3000;

// GeminiKeyManager is used centrally for all Gemini operations via executeWithRotation

// Disk storage for permanent local preservation of generated audio
const DATA_DIR = path.resolve(__dirname, 'data', 'audios');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// In-memory cache for audio results (expires after 30 minutes)
interface AudioCacheEntry {
  buffer: Buffer;
  mimeType: string;
  createdAt: number;
}
const audioCache = new Map<string, AudioCacheEntry>();

// Cleanup cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of audioCache.entries()) {
    if (now - entry.createdAt > 30 * 60 * 1000) {
      audioCache.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Curated list of high-quality neural voices
const CURATED_VOICES = [
  // Portuguese - Brazil (Female)
  {
    id: 'pt-BR-FranciscaNeural',
    name: 'Francisca',
    gender: 'Feminino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Natural, expressiva e envolvente. Perfeita para histórias, artigos e audiobooks.',
    isDefault: true,
  },
  {
    id: 'pt-BR-ThalitaMultilingualNeural',
    name: 'Thalita',
    gender: 'Feminino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Suave, amigável e moderna. Ótima para podcasts e conteúdos descontraídos.',
  },

  // Portuguese - Brazil (Male) - Expanding Brazilian Male Voices as requested
  {
    id: 'pt-BR-AntonioNeural',
    name: 'Antônio',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz clássica, madura, firme e segura. Excelente para notícias, tutoriais e negócios.',
  },
  {
    id: 'en-US-AndrewMultilingualNeural',
    name: 'André',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz masculina jovem, dinâmica e natural. Ideal para vídeos, podcasts e narrativas contemporâneas.',
    voiceLocale: 'pt-BR',
  },
  {
    id: 'en-US-BrianMultilingualNeural',
    name: 'Bruno',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz encorpada, grave e com presença forte. Ótima para audiobooks, documentários e cinema.',
    voiceLocale: 'pt-BR',
  },
  {
    id: 'en-AU-WilliamMultilingualNeural',
    name: 'William',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz calorosa, calma e acolhedora. Perfeita para reflexões, histórias e leitura explicativa.',
    voiceLocale: 'pt-BR',
  },
  {
    id: 'fr-FR-RemyMultilingualNeural',
    name: 'Rodrigo',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz moderna, ágil e articulada. Ideal para apresentações e conteúdos didáticos.',
    voiceLocale: 'pt-BR',
  },
  {
    id: 'de-DE-FlorianMultilingualNeural',
    name: 'Fábio',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz serena, pausada e analítica. Perfeita para artigos longos e relatórios técnicos.',
    voiceLocale: 'pt-BR',
  },
  {
    id: 'it-IT-GiuseppeMultilingualNeural',
    name: 'Gustavo',
    gender: 'Masculino',
    lang: 'pt-BR',
    langLabel: 'Português (Brasil)',
    description: 'Voz comunicativa, enérgica e clara. Ótima para cursos online e treinamentos.',
    voiceLocale: 'pt-BR',
  },

  // Portuguese - Portugal
  {
    id: 'pt-PT-RaquelNeural',
    name: 'Raquel',
    gender: 'Feminino',
    lang: 'pt-PT',
    langLabel: 'Português (Portugal)',
    description: 'Clara e formal, com pronúncia nativa de Portugal.',
  },
  {
    id: 'pt-PT-DuarteNeural',
    name: 'Duarte',
    gender: 'Masculino',
    lang: 'pt-PT',
    langLabel: 'Português (Portugal)',
    description: 'Masculina profunda e pausada de Portugal.',
  },
  // English - US
  {
    id: 'en-US-JennyNeural',
    name: 'Jenny',
    gender: 'Feminino',
    lang: 'en-US',
    langLabel: 'Inglês (EUA)',
    description: 'Ultra-natural US English female voice for general content.',
  },
  {
    id: 'en-US-GuyNeural',
    name: 'Guy',
    gender: 'Masculino',
    lang: 'en-US',
    langLabel: 'Inglês (EUA)',
    description: 'Warm, natural US English male voice.',
  },
  {
    id: 'en-US-AriaNeural',
    name: 'Aria',
    gender: 'Feminino',
    lang: 'en-US',
    langLabel: 'Inglês (EUA)',
    description: 'Expressive and engaging US female narrator.',
  },
  // English - UK
  {
    id: 'en-GB-SoniaNeural',
    name: 'Sonia',
    gender: 'Feminino',
    lang: 'en-GB',
    langLabel: 'Inglês (Reino Unido)',
    description: 'Clear British English female voice.',
  },
  {
    id: 'en-GB-RyanNeural',
    name: 'Ryan',
    gender: 'Masculino',
    lang: 'en-GB',
    langLabel: 'Inglês (Reino Unido)',
    description: 'Natural British English male narrator.',
  },
  // Spanish
  {
    id: 'es-ES-ElviraNeural',
    name: 'Elvira',
    gender: 'Feminino',
    lang: 'es-ES',
    langLabel: 'Espanhol (Espanha)',
    description: 'Voz femenina natural de España.',
  },
  {
    id: 'es-ES-AlvaroNeural',
    name: 'Álvaro',
    gender: 'Masculino',
    lang: 'es-ES',
    langLabel: 'Espanhol (Espanha)',
    description: 'Voz masculina cálida de España.',
  },
  {
    id: 'es-MX-DaliaNeural',
    name: 'Dalia',
    gender: 'Feminino',
    lang: 'es-MX',
    langLabel: 'Espanhol (México)',
    description: 'Voz femenina latinoamericana.',
  },
];

function sanitizeTextForTts(raw: string, lang = 'pt-BR'): string {
  if (!raw) return '';

  let text = raw
    // Remove media search bracket tags and bracketed URLs (e.g. [Ayrton Senna 1991], [https://...], [busca: ...])
    .replace(/(?:rótulo\s+de\s+busca|rotulo\s+de\s+busca|busca|imagem|foto|img|search)?\s*\[\s*(?!pausa|ênfase|enfase|sussurro|lento|rápido|rapido|grave|agudo|forte|grito)(?:https?:\/\/[^\s\]]+|[^\]]+?)\s*\]/gi, ' ')
    // Convert [pausa ...] to natural acoustic pauses (ellipses create organic 0.5s - 1.5s speech pauses)
    .replace(/\[pausa(?::|\s+)?(\d*\.?\d*)\s*(s|ms)?\]/gi, (_m, val, unit) => {
      let ms = 1000;
      if (val) {
        const num = parseFloat(val);
        if (!isNaN(num)) ms = unit === 'ms' ? Math.round(num) : Math.round(num * 1000);
      }
      return ms >= 1200 ? '... ... ' : '... ';
    })
    // Convert expression tags into natural punctuation and vocal inflection
    .replace(/\[ênfase\](.*?)\[\/ênfase\]/gi, ' "$1" ')
    .replace(/\[enfase\](.*?)\[\/enfase\]/gi, ' "$1" ')
    .replace(/\[sussurro\](.*?)\[\/sussurro\]/gi, ' ($1) ')
    .replace(/\[r[aá]pido\](.*?)\[\/r[aá]pido\]/gi, ' $1 ')
    .replace(/\[lento\](.*?)\[\/lento\]/gi, ' $1... ')
    .replace(/\[grave\](.*?)\[\/grave\]/gi, ' $1 ')
    .replace(/\[agudo\](.*?)\[\/agudo\]/gi, ' $1 ')
    .replace(/\[(?:forte|grito)\](.*?)\[\/(?:forte|grito)\]/gi, ' $1! ');

  // Replace isolated & with words to prevent XML syntax error
  const andWord = lang.startsWith('en') ? ' and ' : lang.startsWith('es') ? ' y ' : ' e ';
  text = text.replace(/&(?!(amp|lt|gt|quot|apos);)/gi, andWord);

  // Replace < and > so no raw tags can break XML
  text = text
    .replace(/</g, lang.startsWith('en') ? ' less than ' : ' menor que ')
    .replace(/>/g, lang.startsWith('en') ? ' greater than ' : ' maior que ');

  // Remove any remaining XML/HTML tags to guarantee clean SSML compliance
  text = text.replace(/<\/?[^>]+(>|$)/g, ' ');

  // Remove control characters (except newline, tab)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // Normalize quotes
  text = text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  // Normalize spaces
  text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();

  return text;
}

/**
 * Intelligent text chunker: splits text up to 20,000 characters
 * into natural pieces between 250 and 450 characters respecting
 * punctuation boundaries (paragraphs, periods, question marks, commas).
 */
function chunkText(text: string, maxLen = 420): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\t/g, ' ').trim();
  if (!clean) return [];

  // Split first by line breaks and strong punctuation
  const rawSegments = clean.split(/(?<=[.?!;:\n])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const seg of rawSegments) {
    const s = seg.trim();
    if (!s) continue;

    if (s.length > maxLen) {
      // Split long sentences by comma or space
      const subParts = s.split(/(?<=[,])\s+|\s+/);
      for (const part of subParts) {
        if (!part) continue;
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

/**
 * Synthesizes a single chunk with MsEdgeTTS with timeout and safety guarantees.
 */
async function synthesizeSingleChunk(
  text: string,
  voice: string,
  rate = '+0%',
  pitch = '+0Hz',
  volume = '+0%',
  overrideLocale?: string
): Promise<Buffer> {
  const safeVoice = (voice && typeof voice === 'string' && voice.trim()) ? voice.trim() : 'pt-BR-FranciscaNeural';
  const matchedVoice = CURATED_VOICES.find((v) => v.id === safeVoice);
  const voiceLocale = overrideLocale || matchedVoice?.voiceLocale || (safeVoice.startsWith('pt-') ? 'pt-BR' : undefined);
  const sanitized = sanitizeTextForTts(text, voiceLocale || (safeVoice.startsWith('pt-') ? 'pt-BR' : 'en'));

  if (!sanitized) {
    throw new Error('Texto vazio após higienização.');
  }

  const tts = new MsEdgeTTS();

  if (voiceLocale) {
    await tts.setMetadata(safeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { voiceLocale });
  } else {
    await tts.setMetadata(safeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  }

  return new Promise<Buffer>((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try { tts.close(); } catch {}
        reject(new Error('Timeout de comunicação na síntese de voz (25s excedido).'));
      }
    }, 25000);

    try {
      const { audioStream } = tts.toStream(sanitized, {
        rate: rate || '+0%',
        pitch: pitch || '+0Hz',
        volume: volume || '+0%',
      });

      const chunks: Buffer[] = [];
      audioStream.on('data', (d: Buffer) => chunks.push(d));
      audioStream.on('end', () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          try { tts.close(); } catch {}
          resolve(Buffer.concat(chunks));
        }
      });
      audioStream.on('error', (err) => {
        if (!finished) {
          const totalReceived = Buffer.concat(chunks).length;
          // If we received substantial audio data (>4KB) and the socket closed without turn.end,
          // the MP3 audio stream is intact and completely playable
          if (
            totalReceived > 4096 &&
            err?.message?.includes('no turn.end received')
          ) {
            finished = true;
            clearTimeout(timer);
            try { tts.close(); } catch {}
            resolve(Buffer.concat(chunks));
            return;
          }

          finished = true;
          clearTimeout(timer);
          try { tts.close(); } catch {}
          reject(err);
        }
      });
    } catch (e) {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        try { tts.close(); } catch {}
        reject(e);
      }
    }
  });
}

/**
 * Strips ID3v2 tag from subsequent MP3 buffers so concatenated streams remain valid.
 */
function stripId3Tag(buf: Buffer): Buffer {
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size =
      ((buf[6] & 0x7f) << 21) |
      ((buf[7] & 0x7f) << 14) |
      ((buf[8] & 0x7f) << 7) |
      (buf[9] & 0x7f);
    const tagLength = 10 + size;
    if (tagLength < buf.length) {
      return buf.subarray(tagLength);
    }
  }
  return buf;
}

/**
 * Synthesizes long text by chunking and processing in controlled parallel batches.
 * Texts up to 1600 characters are synthesized in a single pristine pass for optimal audio fidelity.
 */
async function synthesizeLongText(
  text: string,
  voice: string,
  rate = '+0%',
  pitch = '+0Hz',
  volume = '+0%',
  onProgress?: (completed: number, total: number) => void
): Promise<Buffer> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error('Nenhum texto válido fornecido para conversão.');
  }

  // Single-pass generation for news reportages and standard texts (zero concatenation artifacts)
  if (trimmedText.length <= 1600) {
    let attempts = 0;
    while (attempts < 3) {
      try {
        attempts++;
        const audioBuf = await synthesizeSingleChunk(trimmedText, voice, rate, pitch, volume);
        if (onProgress) onProgress(1, 1);
        return audioBuf;
      } catch (err) {
        if (attempts >= 3) throw err;
        await new Promise((r) => setTimeout(r, 450 * attempts));
      }
    }
  }

  const chunks = chunkText(trimmedText, 700);
  if (chunks.length === 0) {
    throw new Error('Nenhum texto válido fornecido para conversão.');
  }

  const results: Buffer[] = new Array(chunks.length);
  const concurrency = 4; // 4 parallel connections for fast generation without overwhelming
  let currentIndex = 0;
  let completedCount = 0;

  async function worker() {
    while (currentIndex < chunks.length) {
      const idx = currentIndex++;
      const chunk = chunks[idx];
      let attempts = 0;
      let success = false;

      while (!success && attempts < 4) {
        try {
          attempts++;
          let textForChunk = chunk;
          if (attempts >= 3) {
            // Simplify text to avoid any unexpected symbols or malformed inputs
            textForChunk = chunk
              .replace(/[^\p{L}\p{N}\s.,?!]/gu, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          }
          results[idx] = await synthesizeSingleChunk(textForChunk, voice, rate, pitch, volume);
          success = true;
          completedCount++;
          if (onProgress) {
            onProgress(completedCount, chunks.length);
          }
        } catch (err) {
          if (attempts >= 4) {
            throw err;
          }
          // Exponential backoff before retry with fresh connection
          await new Promise((r) => setTimeout(r, 450 * attempts));
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker());
  await Promise.all(workers);

  // Strip ID3 tags from chunks > 0 so concatenated stream is compliant with decoders
  const cleanedResults = results.map((buf, idx) => (idx === 0 ? buf : stripId3Tag(buf)));
  return Buffer.concat(cleanedResults);
}

// API Routes
app.get('/api/tts/status', (_req: Request, res: Response) => {
  let diskCount = 0;
  try {
    diskCount = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.mp3')).length;
  } catch {}

  res.json({
    status: 'ok',
    cachedAudios: audioCache.size,
    savedDiskAudios: diskCount,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: Date.now(),
  });
});

app.get('/api/voices', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    voices: CURATED_VOICES,
  });
});

// Single POST endpoint for instant generation or preview
app.post('/api/tts', async (req: Request, res: Response) => {
  try {
    const { text, voice, rate = '+0%', pitch = '+0Hz', volume = '+0%' } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Texto não informado ou vazio.' });
      return;
    }

    const safeVoice = (voice && typeof voice === 'string' && voice.trim()) ? voice.trim() : 'pt-BR-FranciscaNeural';

    if (text.length > 25000) {
      res.status(400).json({ error: 'Texto excede o limite máximo suportado de 25.000 caracteres.' });
      return;
    }

    const audioBuffer = await synthesizeLongText(text, safeVoice, rate, pitch, volume);
    const audioId = crypto.randomUUID();

    audioCache.set(audioId, {
      buffer: audioBuffer,
      mimeType: 'audio/mpeg',
      createdAt: Date.now(),
    });

    // Persist to local disk so audio is never lost
    try {
      fs.writeFileSync(path.join(DATA_DIR, `${audioId}.mp3`), audioBuffer);
    } catch (e) {
      console.error('Failed to write audio to disk:', e);
    }

    // If client requested direct binary audio stream
    if (req.headers.accept?.includes('audio/mpeg') || req.query.stream === 'true') {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('X-Audio-Id', audioId);
      res.send(audioBuffer);
      return;
    }

    res.json({
      status: 'ok',
      id: audioId,
      sizeBytes: audioBuffer.length,
      audioUrl: `/api/tts/audio/${audioId}`,
      downloadUrl: `/api/tts/audio/${audioId}?download=true`,
      chars: text.length,
    });
  } catch (err: any) {
    console.error('Error generating TTS:', err);
    res.status(500).json({
      error: 'Erro na geração de áudio. Tente novamente em alguns segundos.',
      details: err?.message || String(err),
    });
  }
});

// Job queue for SSE streaming of long texts
interface TtsJob {
  id: string;
  text: string;
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  createdAt: number;
}
const activeJobs = new Map<string, TtsJob>();

// Create a job for SSE streaming (supports massive 20,000 char texts safely via POST)
app.post('/api/tts/jobs', (req: Request, res: Response) => {
  const { text, voice = 'pt-BR-FranciscaNeural', rate = '+0%', pitch = '+0Hz', volume = '+0%' } = req.body;

  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Texto não informado ou vazio.' });
    return;
  }

  if (text.length > 25000) {
    res.status(400).json({ error: 'Texto excede o limite de 25.000 caracteres.' });
    return;
  }

  const jobId = crypto.randomUUID();
  activeJobs.set(jobId, {
    id: jobId,
    text,
    voice,
    rate,
    pitch,
    volume,
    createdAt: Date.now(),
  });

  const chunks = chunkText(text);

  res.json({
    status: 'ok',
    jobId,
    totalChunks: chunks.length,
    chars: text.length,
  });
});

// Stream SSE events for a created job
app.get('/api/tts/jobs/:id/events', async (req: Request, res: Response) => {
  const { id } = req.params;
  const job = activeJobs.get(id);

  if (!job) {
    res.status(404).send('Job não encontrado ou expirado.');
    return;
  }

  // Remove job from map once connected
  activeJobs.delete(id);

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const chunks = chunkText(job.text);
    sendEvent('init', {
      totalChunks: chunks.length,
      chars: job.text.length,
    });

    const audioBuffer = await synthesizeLongText(
      job.text,
      job.voice,
      job.rate,
      job.pitch,
      job.volume,
      (completed, total) => {
        sendEvent('progress', {
          completed,
          total,
          percent: Math.round((completed / total) * 100),
        });
      }
    );

    const audioId = crypto.randomUUID();
    audioCache.set(audioId, {
      buffer: audioBuffer,
      mimeType: 'audio/mpeg',
      createdAt: Date.now(),
    });

    // Persist to local disk so audio is never lost
    try {
      fs.writeFileSync(path.join(DATA_DIR, `${audioId}.mp3`), audioBuffer);
    } catch (e) {
      console.error('Failed to write audio to disk:', e);
    }

    sendEvent('done', {
      id: audioId,
      sizeBytes: audioBuffer.length,
      audioUrl: `/api/tts/audio/${audioId}`,
      downloadUrl: `/api/tts/audio/${audioId}?download=true`,
      chars: job.text.length,
    });
    res.end();
  } catch (err: any) {
    console.error('Job synthesis error:', err);
    sendEvent('error', { message: err?.message || 'Falha ao processar áudio' });
    res.end();
  }
});

// Audio streaming & download endpoint with disk backup
app.get('/api/tts/audio/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const download = req.query.download === 'true';

  let buffer: Buffer | undefined;
  let mimeType = 'audio/mpeg';

  const entry = audioCache.get(id);
  if (entry) {
    buffer = entry.buffer;
    mimeType = entry.mimeType;
  } else {
    // Check disk storage
    const diskPath = path.join(DATA_DIR, `${id}.mp3`);
    if (fs.existsSync(diskPath)) {
      try {
        buffer = fs.readFileSync(diskPath);
        audioCache.set(id, { buffer, mimeType, createdAt: Date.now() });
      } catch (err) {
        console.error('Failed to read from disk:', err);
      }
    }
  }

  if (!buffer) {
    res.status(404).send('Áudio não encontrado ou expirado.');
    return;
  }

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  if (download) {
    const filename = `vozlivre-${id.slice(0, 8)}.mp3`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }

  res.send(buffer);
});

// Direct text preview for voice samples
app.post('/api/tts/preview', async (req: Request, res: Response) => {
  try {
    const { voice = 'pt-BR-FranciscaNeural', sampleText } = req.body;
    const textToSay = sampleText || 'Olá, esta é uma demonstração da minha voz natural com síntese de alta qualidade.';
    const buffer = await synthesizeSingleChunk(textToSay, voice);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: 'Erro ao gerar amostra.', details: err?.message });
  }
});

// Helper to assemble system instruction for IA Narrada
function buildNarratorSystemInstruction(
  category?: string,
  lengthOption?: string,
  includeVoiceTags?: boolean,
  customInstructions?: string,
  customPromptStructure?: string
): string {
  let prompt = `Você é a IA Narrada do VozLivre, um modelo de inteligência artificial de texto totalmente gratuito e de altíssimo nível, especializado em criar histórias épicas, contos, crônicas, roteiros cinematográficos, narrações investigativas estilo YouTube/documentário e textos longos com extrema riqueza de detalhes em língua portuguesa (ou no idioma em que for solicitado).

DIRETRIZES FUNDAMENTAIS:
1. QUALIDADE NARRATIVA: Escreva com cadência expressiva, ritmo cativante, ganchos envolventes e excelente profundidade literária ou explicativa. O texto deve soar orgânico, emocionante e cinematográfico quando lido em voz alta.
2. DISPONIBILIDADE TOTALMENTE GRATUITA: Você é 100% livre e sem restrições de créditos. Nunca mencione planos pagos, assinaturas ou limites.
3. CAPACIDADE PARA TEXTOS GRANDES E PEDIDOS DE ALTA EXTENSÃO:
Quando o usuário solicitar uma quantidade específica de caracteres (como 5.000, 10.000, 15.000 caracteres) ou um texto longo / épico, você DEVE atender com generosidade e densidade narrativa.
Desenvolva a narrativa em múltiplos blocos, capítulos e parágrafos detalhados, explorando cenários, teorias, ambientação sonora, tensão crescente, investigações aprofundadas e detalhes vívidos sem resumir nem cortar prematuramente.`;

  if (category === 'roteiro') {
    prompt += `\n4. FORMATO PADRÃO: Estruture como roteiro de locução / narração para vídeo ou podcast, com ganchos envolventes, ritmo dinâmico e tom direto ao ouvinte.`;
  } else if (category === 'conto') {
    prompt += `\n4. FORMATO PADRÃO: Estruture como conto literário com introdução imersiva, desenvolvimento envolvente, clímax dramático e desfecho marcante.`;
  } else if (category === 'artigo') {
    prompt += `\n4. FORMATO PADRÃO: Estruture como artigo opinativo ou ensaio narrativo com clareza, argumentos fortes e conclusões provocativas.`;
  } else if (category === 'noticia') {
    prompt += `\n4. FORMATO PADRÃO: Estruture como crônica jornalística ou reportagem investigativa narrativa com fatos vívidos e narração fluida.`;
  }

  // Ensino da IA e Estrutura Personalizada definida pelo usuário
  if (customInstructions && customInstructions.trim()) {
    prompt += `\n\n=== REGRAS DE ENSINO E COMPORTAMENTO (CONFIGURADAS PELO USUÁRIO) ===
Siga rigorosamente as instruções a seguir como prioridade máxima de tom, estilo e regras de resposta:
${customInstructions.trim()}`;
  }

  if (customPromptStructure && customPromptStructure.trim()) {
    prompt += `\n\n=== ESTRUTURA OBRIGATÓRIA DE ENTREGA DO TEXTO (ENSINADA PELO USUÁRIO) ===
Você DEVE estruturar o texto exatamente de acordo com esta organização e formato:
${customPromptStructure.trim()}`;
  }

  if (includeVoiceTags) {
    prompt += `\n\nMARCADORES DE LOCUÇÃO (ATIVADOS):
Como este texto será convertido em áudio natural pela ferramenta de voz, incorpore estrategicamente marcadores naturais de locução nos momentos adequados:
- [pausa 500ms] para quebras leves de respiração
- [pausa 1s] para transições de parágrafo ou suspense
- [pausa 2s] para pausas dramáticas de grande impacto
- [ênfase]frase ou palavra[/ênfase] para destacar termos de forte emoção
- [sussurro]frase[/sussurro] para momentos íntimos, mistérios ou pensamentos
- [lento]frase[/lento] para momentos solenes
- [rápido]frase[/rápido] para momentos de adrenalina
Use esses marcadores com equilíbrio artístico para que a fala resultante soe humana e cinematográfica.`;
  }

  if (lengthOption === 'short') {
    prompt += `\n\nEXTENSÃO: Mantenha o texto objetivo e conciso (em torno de 600 a 1.000 caracteres).`;
  } else if (lengthOption === 'medium') {
    prompt += `\n\nEXTENSÃO: Desenvolva um texto de extensão média, bem equilibrado (em torno de 2.000 a 3.500 caracteres).`;
  } else if (lengthOption === 'long') {
    prompt += `\n\nEXTENSÃO: O usuário solicitou um TEXTO LONGO. Desenvolva com profundidade, múltiplos parágrafos ricos e narrativa detalhada (em torno de 5.000 a 8.000 caracteres).`;
  } else if (lengthOption === 'epic') {
    prompt += `\n\nEXTENSÃO: O usuário solicitou um TEXTO MUITO LONGO / ÉPICO. Seja exaustivo, explore minuciosamente a trama, personagens ou argumentos, gerando um texto extenso e denso (8.000 a 15.000+ caracteres), pronto para narração longa.`;
  }

  return prompt;
}

// Helper to strictly sanitize and normalize multi-turn chat contents for Gemini API
function normalizeGeminiContents(rawHistory: any[], newPrompt: string) {
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  if (Array.isArray(rawHistory)) {
    for (const item of rawHistory) {
      const text = typeof item.content === 'string' ? item.content.trim() : '';
      // Skip empty messages or error placeholder text
      if (!text || text.startsWith('Desculpe, ocorreu uma instabilidade') || text.startsWith('Ocorreu um erro')) {
        continue;
      }

      const role: 'user' | 'model' = (item.role === 'assistant' || item.role === 'model') ? 'model' : 'user';

      if (contents.length === 0) {
        if (role === 'user') {
          contents.push({ role: 'user', parts: [{ text }] });
        }
      } else {
        const last = contents[contents.length - 1];
        if (last.role === role) {
          last.parts[0].text += '\n\n' + text;
        } else {
          contents.push({ role, parts: [{ text }] });
        }
      }
    }
  }

  const promptText = newPrompt.trim();
  if (promptText) {
    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: promptText }] });
    } else {
      const last = contents[contents.length - 1];
      if (last.role === 'user') {
        // Prevent duplicate appending if the prompt was already the last user message
        if (!last.parts[0].text.trim().endsWith(promptText)) {
          last.parts[0].text += '\n\n' + promptText;
        }
      } else {
        contents.push({ role: 'user', parts: [{ text: promptText }] });
      }
    }
  }

  return contents;
}

// Helper to run asynchronous tasks with timeout protection
async function runWithTimeout<T>(fn: () => Promise<T>, ms: number = 90000): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo limite de ${ms / 1000}s excedido na conexão com a IA.`)), ms);
  });
  return Promise.race([fn(), timeoutPromise]).finally(() => clearTimeout(timer));
}

// Endpoint 1: IA Narrada Generate (Standard JSON with multi-model fallback)
app.post('/api/ia-narrada/generate', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { prompt, history, category, lengthOption, includeVoiceTags, customInstructions, customPromptStructure, preferredEngine } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'O comando ou texto inicial é obrigatório.' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'Chave GEMINI_API_KEY não configurada no servidor. Configure a chave no painel de segredos.',
      });
    }

    const systemInstruction = buildNarratorSystemInstruction(
      category,
      lengthOption,
      includeVoiceTags,
      customInstructions,
      customPromptStructure
    );
    const contents = normalizeGeminiContents(history, prompt);

    let text = '';
    let modelsToTry = [
      'gemma-4-26b-a4b-it',
      'gemini-3.6-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash',
      'gemini-flash-latest',
    ];

    if (preferredEngine === 'gemini') {
      modelsToTry = [
        'gemini-3.6-flash',
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
        'gemma-4-26b-a4b-it',
        'gemini-flash-latest',
      ];
    } else if (preferredEngine === 'gemma') {
      modelsToTry = [
        'gemma-4-26b-a4b-it',
        'gemma-4-31b-it',
        'gemini-3.6-flash',
      ];
    }

    let lastError: any = null;

    for (const m of modelsToTry) {
      try {
        const response = await runWithTimeout(async () => {
          return await geminiKeyManager.executeWithRotation(
            async (aiClient) =>
              aiClient.models.generateContent({
                model: m,
                contents,
                config: {
                  systemInstruction,
                  temperature: 0.85,
                  ...(m === 'gemini-3.8-flash' ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
                },
              }),
            { taskName: `IA Narrada Generate (${m})` }
          );
        }, 90000);

        if (response.text && response.text.trim()) {
          text = response.text;
          break;
        }
      } catch (err: any) {
        lastError = err;
      }
    }

    if (!text.trim()) {
      const isOverload = lastError?.message?.includes('high demand') || lastError?.message?.includes('503') || lastError?.message?.includes('RESOURCE_EXHAUSTED');
      return res.status(isOverload ? 503 : 500).json({
        error: isOverload
          ? 'Os servidores da IA estão com alta demanda temporária no momento. Por favor, tente novamente em alguns segundos.'
          : 'A IA não conseguiu gerar a resposta neste instante. Tente novamente.',
        details: lastError?.message || 'Empty response',
      });
    }

    return res.json({
      text,
      charCount: text.length,
      wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
    });
  } catch (err: any) {
    console.error('Error in /api/ia-narrada/generate:', err);
    return res.status(500).json({
      error: 'Erro na geração de narrativa com a IA.',
      details: err?.message || String(err),
    });
  }
});

// Endpoint 2: IA Narrada Stream (SSE with automatic non-stream fallback)
app.post('/api/ia-narrada/stream', async (req: Request, res: Response) => {
  let keepaliveInterval: NodeJS.Timeout | null = null;
  try {
    const { prompt, history, category, lengthOption, includeVoiceTags, customInstructions, customPromptStructure } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'O comando ou texto inicial é obrigatório.' });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error: 'Chave GEMINI_API_KEY não configurada no servidor.',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    // Keepalive ping ensures streaming connection is active through any reverse proxy
    res.write(': keepalive\n\n');
    keepaliveInterval = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {}
    }, 3000);

    const systemInstruction = buildNarratorSystemInstruction(
      category,
      lengthOption,
      includeVoiceTags,
      customInstructions,
      customPromptStructure
    );
    const contents = normalizeGeminiContents(history, prompt);

    let fullGeneratedText = '';
    let streamSuccess = false;
    const preferredEngine = req.body.preferredEngine || 'auto';

    let streamModels = [
      'gemma-4-26b-a4b-it',
      'gemini-3.6-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.8-flash',
      'gemini-flash-latest',
    ];

    if (preferredEngine === 'gemini') {
      streamModels = [
        'gemini-3.6-flash',
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
        'gemma-4-26b-a4b-it',
        'gemini-flash-latest',
      ];
    } else if (preferredEngine === 'gemma') {
      streamModels = [
        'gemma-4-26b-a4b-it',
        'gemma-4-31b-it',
        'gemini-3.6-flash',
      ];
    }

    for (const modelName of streamModels) {
      if (streamSuccess || fullGeneratedText.trim().length > 100) break;

      try {
        await runWithTimeout(async () => {
          return await geminiKeyManager.executeWithRotation(
            async (aiClient) => {
              if (fullGeneratedText.trim().length > 50) return;

              const streamResponse = await aiClient.models.generateContentStream({
                model: modelName,
                contents,
                config: {
                  systemInstruction,
                  temperature: 0.85,
                  ...(modelName === 'gemini-3.8-flash' ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
                },
              });

              let currentAttemptText = '';
              for await (const chunk of streamResponse) {
                let chunkText = chunk.text || '';
                if (!chunkText && chunk.candidates?.[0]?.content?.parts) {
                  for (const p of chunk.candidates[0].content.parts) {
                    if (!p.thought && p.text) {
                      chunkText += p.text;
                    }
                  }
                }
                if (chunkText) {
                  currentAttemptText += chunkText;
                  fullGeneratedText += chunkText;
                  res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
                }
              }
              if (currentAttemptText.trim().length > 0) {
                streamSuccess = true;
              }
            },
            { taskName: `IA Narrada Stream (${modelName})` }
          );
        }, 90000);

        if (streamSuccess) {
          break;
        }
      } catch {
        // If some text was already streamed to client, break to avoid duplicating text
        if (fullGeneratedText.trim().length > 50) {
          break;
        }
      }
    }

    // If stream produced no text (proxy drop, buffering, or error), execute fallback
    if (!fullGeneratedText.trim()) {
      for (const modelName of streamModels) {
        try {
          const fbRes = await runWithTimeout(async () => {
            return await geminiKeyManager.executeWithRotation(
              async (aiClient) => {
                return await aiClient.models.generateContent({
                  model: modelName,
                  contents,
                  config: {
                    systemInstruction,
                    temperature: 0.85,
                    ...(modelName === 'gemini-3.8-flash' ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
                  },
                });
              },
              { taskName: `IA Narrada Stream Fallback (${modelName})` }
            );
          }, 90000);

          const fbText = fbRes.text || '';
          if (fbText.trim()) {
            fullGeneratedText = fbText;
            res.write(`data: ${JSON.stringify({ text: fbText })}\n\n`);
            break;
          }
        } catch {
          // Try next fallback model silently
        }
      }
    }

    if (keepaliveInterval) clearInterval(keepaliveInterval);

    if (!fullGeneratedText.trim()) {
      res.write(`data: ${JSON.stringify({ error: 'Os servidores da IA estão com alta demanda no momento. Clique em Gerar Novamente em alguns segundos.' })}\n\n`);
    } else {
      res.write('data: [DONE]\n\n');
    }
    res.end();
  } catch (err: any) {
    if (keepaliveInterval) clearInterval(keepaliveInterval);
    console.error('Error in /api/ia-narrada/stream top-level:', err);
    res.write(`data: ${JSON.stringify({ error: err?.message || 'Falha no processamento da narrativa.' })}\n\n`);
    res.end();
  }
});

// =========================================================================
// SISTEMA DE REPORTAGEM & MATÉRIA PARA VÍDEO COMPLETO (IA JORNALÍSTICA)
// =========================================================================

// In-memory LRU cache for extracted articles (15 min TTL)
const articleExtractCache = new Map<string, { data: any; createdAt: number }>();
const mediaSearchCache = new Map<string, { results: any[]; createdAt: number }>();

// 1. Extração de Conteúdo, Fotos e Vídeos da Matéria/Reportagem
app.post('/api/article/extract', async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'URL inválida. Forneça um link iniciando com http:// ou https://' });
  }

  const trimmedUrl = url.trim();
  const cachedArticle = articleExtractCache.get(trimmedUrl);
  if (cachedArticle && Date.now() - cachedArticle.createdAt < 15 * 60 * 1000) {
    return res.json(cachedArticle.data);
  }

  try {
    const article = await extractArticleFromUrl(trimmedUrl);
    if (articleExtractCache.size > 100) {
      const oldestKey = articleExtractCache.keys().next().value;
      if (oldestKey) articleExtractCache.delete(oldestKey);
    }
    articleExtractCache.set(trimmedUrl, { data: article, createdAt: Date.now() });
    return res.json(article);
  } catch (err: any) {
    console.error('Error in /api/article/extract:', err);
    return res.status(500).json({
      error: `Falha ao extrair conteúdo da página: ${err?.message || 'Erro de conexão'}`,
    });
  }
});

// In-memory cache for media proxy
const mediaProxyCache = new Map<string, { buffer: Buffer; contentType: string; createdAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of mediaProxyCache.entries()) {
    if (now - v.createdAt > 3600 * 1000) {
      mediaProxyCache.delete(k);
    }
  }
}, 600 * 1000);

app.options('/api/proxy-media', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.status(200).end();
});

// 2. Proxy de Mídia (Imagens e Vídeos com CORS liberado para o Canvas de Vídeo)
app.get(['/api/proxy-media', '/api/narrative/proxy-image', '/api/reportage/proxy-media'], async (req: Request, res: Response) => {
  let rawTargetUrl = (req.query.url as string || '').trim();
  rawTargetUrl = rawTargetUrl
    .replace(/^[\s[\]()"'<>]+|[\s[\]()"'<>]+$/g, '')
    .replace(/&amp;/gi, '&')
    .trim();

  if (rawTargetUrl.toLowerCase().startsWith('www.')) {
    rawTargetUrl = 'https://' + rawTargetUrl;
  }

  if (!rawTargetUrl || !rawTargetUrl.startsWith('http')) {
    return res.status(400).send('URL de mídia inválida.');
  }

  let targetUrl = rawTargetUrl;
  let customReferer: string | undefined;

  // Normalize special URLs (Google Images imgres, Google Drive, Dropbox, Wikimedia File pages, Imgur, YouTube)
  try {
    const parsedInitial = new URL(targetUrl);
    const imgUrlParam = parsedInitial.searchParams.get('imgurl') || parsedInitial.searchParams.get('mediaurl');
    const imgRefParam = parsedInitial.searchParams.get('imgrefurl');
    if (imgRefParam && imgRefParam.startsWith('http')) {
      customReferer = imgRefParam;
    }
    if (imgUrlParam && imgUrlParam.startsWith('http')) {
      targetUrl = imgUrlParam;
    }
  } catch {}

  const driveMatch = targetUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (driveMatch && driveMatch[1]) {
    targetUrl = `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
  }

  if (targetUrl.includes('dropbox.com') && targetUrl.includes('dl=0')) {
    targetUrl = targetUrl.replace('dl=0', 'raw=1');
  }

  const wikiFileMatch = targetUrl.match(/(?:#\/media\/|\/wiki\/)(?:File|Ficheiro|Arquivo|Imagen):([^?#]+)/i);
  if (wikiFileMatch && wikiFileMatch[1]) {
    const cleanWikiFile = decodeURIComponent(wikiFileMatch[1]).trim();
    targetUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(cleanWikiFile)}`;
  }

  const imgurPageMatch = targetUrl.match(/^https?:\/\/(?:m\.)?imgur\.com\/([a-zA-Z0-9]{5,12})$/i);
  if (imgurPageMatch && imgurPageMatch[1]) {
    targetUrl = `https://i.imgur.com/${imgurPageMatch[1]}.jpg`;
  }

  // Resolve direct playable MP4/WebM streams for YouTube, Vimeo, or Globoplay URLs
  const resolvePlayableVideoStream = async (inputUrl: string): Promise<string | null> => {
    // 1. YouTube video stream resolution
    const ytMatch = inputUrl.match(/(?:embed\/|v\/|watch\?(?:[^"'\s]*&)?v=|youtu\.be\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/i);
    if (ytMatch && ytMatch[1] && !inputUrl.includes('ytimg.com')) {
      const ytId = ytMatch[1];

      // Try YouTube Innertube API (ANDROID / IOS clients return direct progressive MP4 streams)
      const clients = [
        {
          clientName: 'ANDROID',
          clientVersion: '19.09.37',
          androidSdkVersion: 30,
          userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
        },
        {
          clientName: 'IOS',
          clientVersion: '19.09.3',
          deviceModel: 'iPhone14,3',
          userAgent: 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
        },
      ];

      for (const client of clients) {
        try {
          const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': client.userAgent,
            },
            body: JSON.stringify({
              videoId: ytId,
              context: {
                client: {
                  clientName: client.clientName,
                  clientVersion: client.clientVersion,
                  hl: 'pt',
                  gl: 'BR',
                  ...(client.androidSdkVersion ? { androidSdkVersion: client.androidSdkVersion } : {}),
                  ...(client.deviceModel ? { deviceModel: client.deviceModel } : {}),
                },
              },
              contentCheckOk: true,
              racyCheckOk: true,
            }),
            signal: AbortSignal.timeout(4500),
          });
          if (r.ok) {
            const data: any = await r.json();
            const formats = [
              ...(data?.streamingData?.formats || []),
              ...(data?.streamingData?.adaptiveFormats || []),
            ];
            const mp4Formats = formats.filter(
              (f: any) => f?.url && typeof f.mimeType === 'string' && f.mimeType.includes('video/mp4')
            );
            if (mp4Formats.length > 0) {
              // Prefer 720p/480p progressive MP4 for fast loading
              mp4Formats.sort((a: any, b: any) => {
                const hA = a.height || 0;
                const hB = b.height || 0;
                const scoreA = hA >= 360 && hA <= 720 ? 1000 + hA : hA;
                const scoreB = hB >= 360 && hB <= 720 ? 1000 + hB : hB;
                return scoreB - scoreA;
              });
              return mp4Formats[0].url;
            }
          }
        } catch {}
      }

      // Fallback to Piped / Invidious public stream APIs
      const pipedEndpoints = [
        `https://pipedapi.kavin.rocks/streams/${ytId}`,
        `https://api.piped.private.coffee/streams/${ytId}`,
        `https://inv.tux.pizza/api/v1/videos/${ytId}`,
      ];
      for (const ep of pipedEndpoints) {
        try {
          const r = await fetch(ep, { signal: AbortSignal.timeout(4000) });
          if (r.ok) {
            const data: any = await r.json();
            const streams = data?.videoStreams || data?.formatStreams || [];
            const mp4 = streams.find(
              (s: any) => s?.url && (s.format === 'MPEG_4' || (s.type || s.mimeType || '').includes('video/mp4'))
            );
            if (mp4?.url) return mp4.url;
          }
        } catch {}
      }
    }

    // 2. Vimeo video stream resolution
    const vimeoMatch = inputUrl.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d+)/i);
    if (vimeoMatch && vimeoMatch[1]) {
      try {
        const r = await fetch(`https://player.vimeo.com/video/${vimeoMatch[1]}/config`, {
          signal: AbortSignal.timeout(5000),
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (r.ok) {
          const cfg: any = await r.json();
          const prog = cfg?.request?.files?.progressive;
          if (Array.isArray(prog) && prog.length > 0) {
            prog.sort((a: any, b: any) => (b.height || 0) - (a.height || 0));
            const best = prog.find((p: any) => (p.height || 0) <= 720 && p.url) || prog[0];
            if (best?.url) return best.url;
          }
        }
      } catch {}
    }

    // 3. Globoplay / G1 video stream resolution (globoplay.globo.com/v/<id> or v.glbimg.com/.../<id>_...)
    const globoMatch =
      inputUrl.match(/globoplay\.globo\.com\/v\/(\d+)/i) ||
      inputUrl.match(/v\.glbimg\.com\/.*\/(\d{6,10})[_-]/i);
    if (globoMatch && globoMatch[1]) {
      const gId = globoMatch[1];
      try {
        const r = await fetch(`https://api.globovideos.com/videos/${gId}/playlist`, {
          signal: AbortSignal.timeout(4500),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://g1.globo.com/',
            'Origin': 'https://g1.globo.com',
          },
        });
        if (r.ok) {
          const data: any = await r.json();
          const resources = data?.videos?.[0]?.resources || [];
          const mp4Res = resources.find(
            (resItem: any) =>
              typeof resItem?.url === 'string' &&
              resItem.url.includes('.mp4') &&
              !resItem.url.includes(inputUrl)
          );
          if (mp4Res?.url) return mp4Res.url;
        }
      } catch {}
    }

    return null;
  };

  const resolvedVideoStream = await resolvePlayableVideoStream(targetUrl);
  if (resolvedVideoStream) {
    targetUrl = resolvedVideoStream;
  } else {
    // Only fallback to YouTube thumbnail if stream resolution failed and caller didn't request strict video
    const ytMatch = targetUrl.match(/(?:embed\/|v\/|watch\?v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/i);
    if (ytMatch && ytMatch[1] && !targetUrl.includes('ytimg.com') && req.query.video !== '1') {
      targetUrl = `https://img.youtube.com/vi/${ytMatch[1]}/maxresdefault.jpg`;
    }
  }

  const sendBufferWithRangeSupport = (buf: Buffer, cType: string) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', cType);

    const range = req.headers.range;
    if (range && cType.startsWith('video/')) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : buf.length - 1;
      if (!isNaN(start) && !isNaN(end) && start >= 0 && end < buf.length && start <= end) {
        const chunkLen = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
        res.setHeader('Content-Length', chunkLen);
        return res.send(buf.subarray(start, end + 1));
      }
    }

    res.setHeader('Content-Length', buf.length);
    return res.send(buf);
  };

  const cached = mediaProxyCache.get(rawTargetUrl) || mediaProxyCache.get(targetUrl);
  if (cached) {
    return sendBufferWithRangeSupport(cached.buffer, cached.contentType);
  }

  const fetchUpstreamWithRetry = async (urlToFetch: string, refUrl?: string): Promise<globalThis.Response | null> => {
    const isWikimedia = /wikimedia\.org|wikipedia\.org/i.test(urlToFetch);
    let originReferer = refUrl;
    if (!originReferer) {
      if (/glbimg\.com|globo\.com/i.test(urlToFetch)) {
        originReferer = 'https://g1.globo.com/';
      } else {
        try {
          originReferer = new URL(urlToFetch).origin + '/';
        } catch {}
      }
    }

    const attemptFetch = async (urlCandidate: string, headers: Record<string, string>): Promise<globalThis.Response | null> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      try {
        return await fetch(urlCandidate, {
          signal: controller.signal,
          headers,
          redirect: 'follow',
        });
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    };

    const acceptHeader = 'video/mp4,video/webm,video/*;q=0.95,image/jpeg,image/png,image/webp,image/gif,image/*;q=0.9,*/*;q=0.7';

    if (isWikimedia) {
      const res1 = await attemptFetch(urlToFetch, {
        'User-Agent': 'VozLivreStudio/1.0 (https://vozlivre.app; contact@vozlivre.app) Mozilla/5.0',
        'Accept': acceptHeader,
      });
      if (res1 && res1.ok) return res1;
    }

    const resPrimary = await attemptFetch(urlToFetch, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': acceptHeader,
      ...(originReferer ? { 'Referer': originReferer } : {}),
    });
    if (resPrimary && resPrimary.ok) return resPrimary;

    // Retry without Referer and with friendly bot User-Agent if blocked by hotlink/WAF rules
    const resFallback = await attemptFetch(urlToFetch, {
      'User-Agent': 'VozLivreStudio/1.0 (https://vozlivre.app; contact@vozlivre.app)',
      'Accept': acceptHeader,
    });
    if (resFallback && resFallback.ok) return resFallback;

    // If https://v.glbimg.com failed TLS/connection, try http://v.glbimg.com or official Globo video frame thumbnail
    const globoIdMatch = urlToFetch.match(/(?:v\.glbimg\.com\/.*\/|globoplay\.globo\.com\/v\/|video\.glbimg\.com\/.*\/)(\d{6,10})/i);
    if (globoIdMatch && globoIdMatch[1]) {
      const gId = globoIdMatch[1];
      if (urlToFetch.startsWith('https://v.glbimg.com/')) {
        const resHttpGlobo = await attemptFetch(urlToFetch.replace(/^https:\/\//i, 'http://'), {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://g1.globo.com/',
        });
        if (resHttpGlobo && resHttpGlobo.ok) return resHttpGlobo;
      }
      if (req.query.video !== '1') {
        const thumbCandidates = [
          `https://s02.video.glbimg.com/x720/${gId}.jpg`,
          `https://s01.video.glbimg.com/x720/${gId}.jpg`,
        ];
        for (const tUrl of thumbCandidates) {
          const resThumb = await attemptFetch(tUrl, {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          });
          if (resThumb && resThumb.ok) return resThumb;
        }
      }
    }

    // Final fallback via wsrv.nl global image proxy for hotlink/WAF-protected image hosts
    if (!urlToFetch.toLowerCase().includes('.mp4') && !urlToFetch.toLowerCase().includes('.webm') && req.query.video !== '1') {
      const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(urlToFetch)}&output=jpg`;
      const resWsrv = await attemptFetch(wsrvUrl, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/jpeg,image/png,image/webp,image/*,*/*;q=0.8',
      });
      if (resWsrv && resWsrv.ok) return resWsrv;
    }
    return resPrimary || resFallback;
  };

  try {
    let upstream = await fetchUpstreamWithRetry(targetUrl, customReferer);

    // If maxresdefault failed for YouTube, fallback to hqdefault
    if ((!upstream || !upstream.ok) && targetUrl.includes('maxresdefault.jpg')) {
      const fallbackYt = targetUrl.replace('maxresdefault.jpg', 'hqdefault.jpg');
      upstream = await fetchUpstreamWithRetry(fallbackYt);
    }

    if (!upstream || !upstream.ok) {
      return res.status(upstream?.status || 404).send('Mídia indisponível na origem.');
    }

    let contentType = (upstream.headers.get('content-type') || '').toLowerCase();

    // If the URL points to an HTML page, first look for playable video streams (og:video, <video>, .mp4)
    // and then fallback to main image extraction!
    if (contentType.includes('text/html')) {
      const finalPageUrl = upstream.url || targetUrl;
      const html = await upstream.text();
      const $ = cheerio.load(html);

      // 1. Check for direct video stream in HTML first!
      let extractedVideoUrl: string | null = null;
      const videoMetaCandidates = [
        $('meta[property="og:video:secure_url"]').attr('content'),
        $('meta[property="og:video:url"]').attr('content'),
        $('meta[property="og:video"]').attr('content'),
        $('meta[name="twitter:player:stream"]').attr('content'),
        $('video').first().attr('src'),
        $('video source').first().attr('src'),
      ];
      for (const vc of videoMetaCandidates) {
        if (vc && vc.trim() && (vc.includes('.mp4') || vc.includes('.webm') || vc.includes('video'))) {
          extractedVideoUrl = vc.trim();
          break;
        }
      }

      if (!extractedVideoUrl) {
        const directMp4Match = html.match(/https?:\\?\/\\?\/[^"'\s<>\\]+\.(?:mp4|webm)(?:\?[^"'\s<>\\]*)?/i);
        if (directMp4Match && directMp4Match[0]) {
          extractedVideoUrl = directMp4Match[0].replace(/\\\//g, '/');
        }
      }

      if (extractedVideoUrl) {
        try {
          const resolvedVidUrl = new URL(extractedVideoUrl.replace(/&amp;/gi, '&'), finalPageUrl).toString();
          const vidUpstream = await fetchUpstreamWithRetry(resolvedVidUrl, finalPageUrl);
          if (vidUpstream && vidUpstream.ok) {
            const vidCt = (vidUpstream.headers.get('content-type') || '').toLowerCase();
            if (!vidCt.includes('text/html')) {
              upstream = vidUpstream;
              contentType = vidCt || (resolvedVidUrl.includes('.webm') ? 'video/webm' : 'video/mp4');
            }
          }
        } catch {}
      }

      // 2. If no video found in HTML (and caller didn't force video=1), extract primary image
      if (contentType.includes('text/html') && req.query.video !== '1') {
        let extractedImageUrl: string | null = null;

        try {
          const parsedFinal = new URL(finalPageUrl);
          const redirectedImgUrl = parsedFinal.searchParams.get('imgurl') || parsedFinal.searchParams.get('mediaurl');
          if (redirectedImgUrl && redirectedImgUrl.startsWith('http')) {
            extractedImageUrl = redirectedImgUrl;
          }
        } catch {}

        if (!extractedImageUrl) {
          const googleImgMatch = html.match(/imgurl=(https?(?:%3A%2F%2F|:\/\/)[^&"'\s<>]+)/i);
          if (googleImgMatch && googleImgMatch[1]) {
            try {
              extractedImageUrl = decodeURIComponent(googleImgMatch[1]);
            } catch {
              extractedImageUrl = googleImgMatch[1];
            }
          }
        }

        if (!extractedImageUrl) {
          const metaCandidates = [
            $('meta[property="og:image:secure_url"]').attr('content'),
            $('meta[property="og:image"]').attr('content'),
            $('meta[name="twitter:image:src"]').attr('content'),
            $('meta[name="twitter:image"]').attr('content'),
            $('meta[property="twitter:image"]').attr('content'),
            $('link[rel="image_src"]').attr('href'),
          ];
          for (const cand of metaCandidates) {
            if (cand && cand.trim()) {
              extractedImageUrl = cand.trim();
              break;
            }
          }

          if (!extractedImageUrl) {
            $('img').each((_, el) => {
              if (extractedImageUrl) return;
              const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original') || '';
              if (
                src &&
                !src.startsWith('data:image/svg') &&
                !src.toLowerCase().includes('logo') &&
                !src.toLowerCase().includes('icon') &&
                !src.toLowerCase().includes('avatar') &&
                !src.toLowerCase().includes('1x1')
              ) {
                extractedImageUrl = src.trim();
              }
            });
          }
        }

        if (extractedImageUrl) {
          try {
            const resolvedImgUrl = new URL(extractedImageUrl.replace(/&amp;/gi, '&'), finalPageUrl).toString();
            const imgUpstream = await fetchUpstreamWithRetry(resolvedImgUrl, finalPageUrl);
            if (imgUpstream && imgUpstream.ok) {
              const imgCt = (imgUpstream.headers.get('content-type') || '').toLowerCase();
              if (!imgCt.includes('text/html')) {
                upstream = imgUpstream;
                contentType = imgCt || 'image/jpeg';
              }
            }
          } catch {}
        }
      }
    }

    if (contentType.includes('text/html')) {
      return res.status(422).send('A URL fornecida é uma página HTML sem mídia direta identificada.');
    }

    const finalContentType =
      contentType ||
      (targetUrl.toLowerCase().includes('.mp4')
        ? 'video/mp4'
        : targetUrl.toLowerCase().includes('.webm')
        ? 'video/webm'
        : 'image/jpeg');

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length < 64) {
      return res.status(422).send('Arquivo de mídia vazio ou inválido.');
    }

    mediaProxyCache.set(rawTargetUrl, { buffer, contentType: finalContentType, createdAt: Date.now() });
    mediaProxyCache.set(targetUrl, { buffer, contentType: finalContentType, createdAt: Date.now() });

    return sendBufferWithRangeSupport(buffer, finalContentType);
  } catch {
    return res.status(404).send('Mídia externa indisponível no momento.');
  }
});

// 3. Geração de Roteiro e Cenas com IA Jornalística (Matéria para Vídeo)
app.post('/api/reportage/generate-script', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { article, targetDurationSeconds } = req.body;
    if (!article || !article.title) {
      return res.status(400).json({ error: 'Dados da matéria incompletos.' });
    }

    const scriptData = await geminiKeyManager.executeWithRotation(
      async (aiClient) => generateReportageScript(aiClient, article, targetDurationSeconds),
      { taskName: 'Web API Reportage Script' }
    );
    return res.json(scriptData);
  } catch (err: any) {
    console.error('Error in /api/reportage/generate-script:', err);
    return res.status(500).json({ error: 'Erro ao gerar roteiro da reportagem' });
  }
});

// 4. Geração de Roteiro Criativo e Cenas Narrativas em Vídeo (Histórias & Contos)
app.post('/api/narrative/generate-video-script', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { mode, storyText, premise, genre, tone, targetDurationSeconds, aspectRatio } = req.body;
    if (mode === 'full_prompt' && (!storyText || !storyText.trim())) {
      return res.status(400).json({ error: 'Por favor, forneça o texto completo da história.' });
    }
    if (mode === 'idea_theme' && (!premise || !premise.trim())) {
      return res.status(400).json({ error: 'Por favor, escreva a ideia ou premissa da história.' });
    }

    const narrativeResult = await geminiKeyManager.executeWithRotation(
      async (aiClient) =>
        generateNarrativeVideoScript(aiClient, {
          mode: mode || 'idea_theme',
          storyText,
          premise,
          genre,
          tone,
          targetDurationSeconds: Number(targetDurationSeconds) || 60,
          aspectRatio,
        }),
      { taskName: 'Web API Narrative Video Script' }
    );

    return res.json(narrativeResult);
  } catch (err: any) {
    console.error('Error in /api/narrative/generate-video-script:', err);
    return res.status(500).json({ error: err?.message || 'Erro ao gerar roteiro criativo para vídeo' });
  }
});

// 5. Mídia de Cenas Narrativas e Reportagens (suporta links diretos e busca por palavras-chave na Wikimedia/Web)
const handleNarrativeMediaSearch = async (req: Request, res: Response) => {
  const query = ((req.query.q as string) || (req.body?.query as string) || '').trim();

  if (!query) {
    return res.json({ query: '', results: [] });
  }

  const cacheKey = query.toLowerCase();
  const cached = mediaSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 15 * 60 * 1000) {
    return res.json({ query, results: cached.results });
  }

  try {
    const items = await searchRealWebMedia([query], 16);

    // If user typed a keyword rather than a direct URL, also search Wikimedia Commons for real photos
    if (items.length === 0 && !query.startsWith('http')) {
      try {
        const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&prop=imageinfo&iiprop=url|size|thumburl&iiurlwidth=640&format=json&gsrlimit=12`;
        const commRes = await fetch(commonsUrl, {
          headers: { 'User-Agent': 'VozLivreStudio/1.0 (https://vozlivre.app)' },
        });
        if (commRes.ok) {
          const commData = await commRes.json();
          const pages = commData?.query?.pages || {};
          for (const key of Object.keys(pages)) {
            const page = pages[key];
            const info = page.imageinfo?.[0];
            if (info?.url && !info.url.toLowerCase().endsWith('.svg') && !info.url.toLowerCase().endsWith('.pdf')) {
              const title = (page.title || '').replace(/^File:/i, '').replace(/\.[^/.]+$/, '');
              items.push({
                id: `commons-${page.pageid}`,
                url: info.thumburl || info.url,
                thumbUrl: info.thumburl || info.url,
                title: title || query,
                source: 'Wikimedia Commons',
                type: /\.(mp4|webm|ogv)$/i.test(info.url) ? 'video' : 'image',
              });
            }
          }
        }
      } catch {}
    }

    if (mediaSearchCache.size > 150) {
      const oldestKey = mediaSearchCache.keys().next().value;
      if (oldestKey) mediaSearchCache.delete(oldestKey);
    }
    mediaSearchCache.set(cacheKey, { results: items, createdAt: Date.now() });

    return res.json({ query, results: items });
  } catch (err: any) {
    console.warn('Narrative media search error:', err);
    return res.json({ query, results: [] });
  }
};

app.get('/api/narrative/search-media', handleNarrativeMediaSearch);
app.post('/api/narrative/search-media', handleNarrativeMediaSearch);



// Browser Proxy Endpoint - Enables real web browsing inside IA Narrada
app.get('/api/browser/proxy', async (req: Request, res: Response) => {
  const targetUrl = (req.query.url as string || '').trim();
  if (!targetUrl) {
    return res.status(400).send('URL do site não informada.');
  }

  try {
    let normalized = targetUrl;
    if (normalized.toLowerCase().includes('dolla.ai') || normalized.toLowerCase().includes('dola.ai')) {
      normalized = 'https://dola.ai';
    } else if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(normalized);
    } catch {
      return res.status(400).send('Formato de URL inválido.');
    }

    // Security check: restrict local / private network SSRF
    const host = parsedUrl.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('172.16.') ||
      host.endsWith('.local')
    ) {
      return res.status(403).send('Acesso a endereços da rede local restrito.');
    }

    const upstreamRes = await fetch(parsedUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
    });

    const finalUrl = upstreamRes.url || parsedUrl.toString();
    const contentType = upstreamRes.headers.get('content-type') || 'text/html; charset=utf-8';

    // If upstream returns 4xx / 5xx, provide a friendly fallback rather than broken document
    if (!upstreamRes.ok && upstreamRes.status !== 304) {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${parsedUrl.hostname} - VozLivre</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; }
              .card { background: #18181b; border: 1px solid #27272a; border-radius: 16px; max-width: 440px; width: 100%; padding: 24px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
              h2 { font-size: 17px; margin-bottom: 8px; color: #38bdf8; font-weight: 700; }
              p { font-size: 13px; color: #a1a1aa; line-height: 1.5; margin-bottom: 20px; }
              .btn-row { display: flex; flex-direction: column; gap: 10px; }
              .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: #0284c7; color: white; padding: 12px 18px; border-radius: 12px; font-size: 13px; font-weight: 600; text-decoration: none; cursor: pointer; border: none; }
              .btn:hover { background: #0369a1; }
              .btn-sec { background: #27272a; color: #e4e4e7; }
              .btn-sec:hover { background: #3f3f46; }
              .url-box { font-family: monospace; font-size: 11px; background: #000; padding: 10px; border-radius: 8px; color: #38bdf8; word-break: break-all; margin-bottom: 16px; border: 1px solid #27272a; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>🌐 Abrir ${parsedUrl.hostname}</h2>
              <p>Este website solicita abertura direta ou em janela pop-up devido a políticas de segurança de quadro:</p>
              <div class="url-box">${finalUrl}</div>
              <div class="btn-row">
                <button onclick="window.open('${finalUrl}', 'VozLivreSite', 'width=980,height=750,location=yes,scrollbars=yes')" class="btn">
                  🗗 Abrir em Janela Pop-up ↗
                </button>
                <a href="${finalUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sec">
                  Abrir em Nova Aba ↗
                </a>
              </div>
            </div>
          </body>
        </html>
      `);
    }

    // Remove restrictive security headers that prevent iframe loading
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('frame-options');
    res.removeHeader('cross-origin-opener-policy');
    res.removeHeader('cross-origin-embedder-policy');
    res.setHeader('Content-Type', contentType);

    // If HTML, inject base tag and link navigation rewrites
    if (contentType.includes('text/html')) {
      let html = await upstreamRes.text();

      // Remove anti-framing display:none tags that make Google and other pages blank
      html = html.replace(/<style>\s*table,div,span,p\s*\{\s*display:\s*none;?\s*\}\s*<\/style>/gi, '');
      html = html.replace(/<meta[^>]*http-equiv=["']refresh["'][^>]*>/gi, '');

      const injection = `
        <base href="${finalUrl}">
        <style>
          /* Subtle banner at top of proxied site */
          #vozlirve-browser-banner {
            position: sticky;
            top: 0;
            left: 0;
            right: 0;
            background: rgba(15, 23, 42, 0.92);
            color: #94a3b8;
            font-size: 11px;
            font-family: system-ui, -apple-system, sans-serif;
            padding: 4px 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            z-index: 2147483647;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            backdrop-filter: blur(8px);
          }
          #vozlirve-browser-banner a {
            color: #38bdf8;
            text-decoration: underline;
          }
        </style>
        <div id="vozlirve-browser-banner">
          <span>🌐 Navegador VozLivre: <strong>${finalUrl.slice(0, 70)}</strong></span>
          <a href="${finalUrl}" target="_blank" rel="noopener noreferrer">Abrir Externa ↗</a>
        </div>
        <script>
          (function() {
            try {
              window.parent.postMessage({
                type: 'VOZ_LIVRE_BROWSER_URL_CHANGE',
                url: "${finalUrl}",
                title: document.title || "${parsedUrl.hostname}"
              }, '*');
            } catch(e) {}

            document.addEventListener('click', function(e) {
              var el = e.target;
              while (el && el.tagName !== 'A') {
                el = el.parentElement;
              }
              if (el && el.href && !el.href.startsWith('javascript:') && !el.href.startsWith('#')) {
                // If it's the external banner link, let it open normally
                if (el.getAttribute('target') === '_blank') return;
                e.preventDefault();
                window.location.href = '/api/browser/proxy?url=' + encodeURIComponent(el.href);
              }
            }, true);

            document.addEventListener('submit', function(e) {
              var form = e.target;
              if (form.method && form.method.toLowerCase() === 'get') {
                e.preventDefault();
                var action = form.action || "${finalUrl}";
                var formData = new FormData(form);
                var params = new URLSearchParams();
                formData.forEach(function(val, key) {
                  params.append(key, val);
                });
                var sep = action.indexOf('?') !== -1 ? '&' : '?';
                window.location.href = '/api/browser/proxy?url=' + encodeURIComponent(action + sep + params.toString());
              }
            }, true);
          })();
        </script>
      `;

      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${injection}`);
      } else if (html.includes('<html>')) {
        html = html.replace('<html>', `<html><head>${injection}</head>`);
      } else {
        html = injection + html;
      }

      return res.send(html);
    } else {
      // Direct binary media (images, videos, audio, CSS, JS)
      const arrayBuffer = await upstreamRes.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }
  } catch (err: any) {
    console.error('Browser proxy error for URL:', targetUrl, err?.message);
    return res.status(502).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Aviso do Navegador</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
            .card { background: #18181b; border: 1px solid #27272a; border-radius: 16px; max-width: 480px; padding: 32px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
            h2 { font-size: 18px; margin-bottom: 8px; color: #f43f5e; }
            p { font-size: 13px; color: #a1a1aa; line-height: 1.5; margin-bottom: 20px; }
            .btn { display: inline-flex; align-items: center; gap: 8px; background: #0284c7; color: white; padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 600; text-decoration: none; transition: background 0.2s; }
            .btn:hover { background: #0369a1; }
            .url-box { font-family: monospace; font-size: 11px; background: #000; padding: 8px 12px; border-radius: 8px; color: #38bdf8; word-break: break-all; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>⚠️ Carregamento Restrito pelo Site</h2>
            <p>Este website possui proteção de acesso externo direto que impede o proxy. Você pode abri-lo diretamente em uma nova aba:</p>
            <div class="url-box">${targetUrl}</div>
            <a href="${targetUrl.startsWith('http') ? targetUrl : 'https://' + targetUrl}" target="_blank" rel="noopener noreferrer" class="btn">
              Abrir Site em Nova Aba ↗
            </a>
          </div>
        </body>
      </html>
    `);
  }
});

// Search Media & Articles API for instant search in the browser
app.get('/api/browser/search-media', async (req: Request, res: Response) => {
  const query = (req.query.q as string || '').trim();
  const type = (req.query.type as string || 'all').toLowerCase(); // 'all' | 'images' | 'videos' | 'articles'

  if (!query) {
    return res.json({ query: '', results: [] });
  }

  try {
    const results: Array<{
      id: string;
      title: string;
      snippet: string;
      url: string;
      thumbnail?: string;
      mediaType: 'image' | 'video' | 'article';
      source: string;
    }> = [];

    // 1. Search Wikipedia articles (Portuguese & multilingual)
    try {
      const wikiUrl = `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=6`;
      const wikiRes = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'VozLivreBrowser/1.0 (test@example.com)' },
      });
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        const items = wikiData?.query?.search || [];
        for (const item of items) {
          const cleanSnippet = (item.snippet || '').replace(/<[^>]*>/g, '');
          results.push({
            id: `wiki-${item.pageid}`,
            title: item.title,
            snippet: cleanSnippet,
            url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
            mediaType: 'article',
            source: 'Wikipédia',
          });
        }
      }
    } catch (wikiErr) {
      console.warn('Wiki search failed:', wikiErr);
    }

    // 2. Search Wikimedia Commons for real Images
    if (type === 'all' || type === 'images') {
      try {
        const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&prop=imageinfo&iiprop=url|size|thumburl&iiurlwidth=400&format=json&gsrlimit=8`;
        const commRes = await fetch(commonsUrl, {
          headers: { 'User-Agent': 'VozLivreBrowser/1.0 (test@example.com)' },
        });
        if (commRes.ok) {
          const commData = await commRes.json();
          const pages = commData?.query?.pages || {};
          for (const key of Object.keys(pages)) {
            const page = pages[key];
            const info = page.imageinfo?.[0];
            if (info?.url) {
              const title = (page.title || '').replace(/^File:/i, '').replace(/\.[^/.]+$/, '');
              results.push({
                id: `img-${page.pageid}`,
                title: title || 'Imagem Wikimedia',
                snippet: `Dimensões: ${info.width || ''}x${info.height || ''}`,
                url: info.url,
                thumbnail: info.thumburl || info.url,
                mediaType: 'image',
                source: 'Wikimedia Commons',
              });
            }
          }
        }
      } catch (commErr) {
        console.warn('Commons image search failed:', commErr);
      }
    }

    // 3. YouTube Video embeds / search references
    if (type === 'all' || type === 'videos') {
      results.push({
        id: `yt-search-${Date.now()}`,
        title: `Vídeos no YouTube sobre "${query}"`,
        snippet: 'Pesquisa ao vivo de vídeos e documentários relacionados ao tema.',
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        thumbnail: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=400&auto=format&fit=crop&q=60',
        mediaType: 'video',
        source: 'YouTube',
      });
    }

    return res.json({ query, results });
  } catch (err: any) {
    console.error('Error in /api/browser/search-media:', err);
    return res.status(500).json({ error: 'Erro ao buscar mídia web' });
  }
});

// Google Instant Suggestions API
app.get('/api/browser/suggest', async (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  if (!q) {
    return res.json({ query: '', suggestions: [] });
  }

  try {
    const suggestUrl = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}&hl=pt-BR`;
    const resp = await fetch(suggestUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    if (resp.ok) {
      const data = await resp.json();
      const suggestions = Array.isArray(data?.[1]) ? data[1] : [];
      return res.json({ query: q, suggestions });
    }
    return res.json({ query: q, suggestions: [] });
  } catch (err: any) {
    console.warn('Suggest error:', err?.message);
    return res.json({ query: q, suggestions: [] });
  }
});

// Comprehensive Real Web Search with Direct Clickable Results
app.get('/api/browser/search-web', async (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  if (!q) {
    return res.json({ query: '', results: [] });
  }

  try {
    const results: Array<{
      title: string;
      url: string;
      snippet: string;
      source: string;
      favicon?: string;
    }> = [];

    // 1. Query Wikipedia opensearch & extracts
    try {
      const wikiUrl = `https://pt.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=6&prop=extracts|pageimages&exintro=1&explaintext=1&exsentences=2&piprop=thumbnail&pithumbsize=160&format=json`;
      const wikiRes = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'VozLivreBrowser/1.0 (info@vozlirve.app)' },
      });
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        const pages = wikiData?.query?.pages || {};
        for (const k of Object.keys(pages)) {
          const p = pages[k];
          if (p?.title) {
            results.push({
              title: p.title,
              url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
              snippet: p.extract || 'Artigo enciclopédico com referências e dados aprofundados.',
              source: 'Wikipédia',
              favicon: 'https://pt.wikipedia.org/static/favicon/wikipedia.ico',
            });
          }
        }
      }
    } catch (wikiErr) {
      console.warn('Wiki web search failed:', wikiErr);
    }

    // 2. High-profile Brazilian & global portals matching the search
    const cleanQ = q.toLowerCase();
    const portalDirects = [
      {
        name: 'G1 Notícias',
        match: 'noticia|notícias|brasil|mundo|hoje|governo|politica|economia',
        url: `https://g1.globo.com/busca/?q=${encodeURIComponent(q)}`,
        snippet: 'Acompanhe as últimas notícias do Brasil e do mundo no portal G1.',
        favicon: 'https://s2-g1.glbimg.com/favicon.ico',
      },
      {
        name: 'TecMundo',
        match: 'tecnologia|ia|ia |celular|inteligencia artificial|game|software|app',
        url: `https://www.tecmundo.com.br/busca?q=${encodeURIComponent(q)}`,
        snippet: 'Notícias, análises e tendências sobre tecnologia e inovação.',
        favicon: 'https://www.tecmundo.com.br/favicon.ico',
      },
      {
        name: 'Brasil Escola',
        match: 'historia|história|mitologia|guerra|ciencia|física|quimica|biologia|geografia|filosofia',
        url: `https://brasilescola.uol.com.br/busca?q=${encodeURIComponent(q)}`,
        snippet: 'Artigos educativos completos, resumos didáticos e fontes de estudo.',
        favicon: 'https://brasilescola.uol.com.br/favicon.ico',
      },
      {
        name: 'YouTube',
        match: 'video|vídeo|trailer|musica|música|som|documentario|aula|podcast',
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
        snippet: 'Vídeos, documentários, músicas e produções audiovisuais.',
        favicon: 'https://www.youtube.com/s/desktop/favicon.ico',
      },
    ];

    for (const p of portalDirects) {
      if (new RegExp(p.match, 'i').test(cleanQ)) {
        results.push({
          title: `${p.name}: Busca sobre "${q}"`,
          url: p.url,
          snippet: p.snippet,
          source: p.name,
          favicon: p.favicon,
        });
      }
    }

    // Direct Dolla AI (Dola AI) integration
    if (cleanQ.includes('dolla') || cleanQ.includes('dola')) {
      results.unshift({
        title: 'Dolla AI (Dola AI) - Assistente Inteligente, Calendário & Ideias',
        url: 'https://dola.ai',
        snippet: 'Acesse o Dolla AI para escrita, resumos, ideias, geração de arte e organização.',
        source: 'Dolla AI Oficial',
        favicon: 'https://dola.ai/favicon.ico',
      });
    }

    // 3. Fallback entry for Google Search itself
    results.unshift({
      title: `Google: Resultados de pesquisa para "${q}"`,
      url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
      snippet: 'Visualizar todos os resultados completos de pesquisa na web através do Google.',
      source: 'Google',
      favicon: 'https://www.google.com/favicon.ico',
    });

    return res.json({ query: q, results });
  } catch (err: any) {
    console.error('Error in /api/browser/search-web:', err);
    return res.status(500).json({ error: 'Erro ao buscar web' });
  }
});

// ============================================================================
// WHATSAPP AUTOMATION API ROUTES (IA Narrada Group Bot)
// ============================================================================

app.get('/api/whatsapp/status', (_req: Request, res: Response) => {
  return res.json(whatsappService.getStatus());
});

app.post('/api/whatsapp/connect', async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body || {};
    await whatsappService.connect(phoneNumber);
    return res.json(whatsappService.getStatus());
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erro ao conectar WhatsApp' });
  }
});

app.post('/api/whatsapp/disconnect', async (_req: Request, res: Response) => {
  try {
    await whatsappService.disconnect();
    return res.json(whatsappService.getStatus());
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erro ao desconectar WhatsApp' });
  }
});

app.post('/api/whatsapp/refresh-groups', async (_req: Request, res: Response) => {
  try {
    const groups = await whatsappService.refreshGroups();
    return res.json({ groups });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erro ao atualizar grupos' });
  }
});

app.post('/api/whatsapp/config', (req: Request, res: Response) => {
  try {
    const updated = whatsappService.saveConfig(req.body || {});
    return res.json({ config: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erro ao salvar configuração' });
  }
});

app.post('/api/whatsapp/simulate-message', async (req: Request, res: Response) => {
  try {
    const { message, groupId, groupName, senderName } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Mensagem de comando inválida.' });
    }

    const targetJid = groupId || 'sim-group@g.us';
    const analysis = whatsappService.parseCommandMessage(message, { jid: targetJid });

    // Handle interactive informational & setting commands
    if (
      analysis.type === 'help' ||
      analysis.type === 'voices_list' ||
      analysis.type === 'get_config' ||
      analysis.type === 'reset_config'
    ) {
      if (analysis.type === 'reset_config') {
        whatsappService.resetUserPreference(targetJid);
      }
      return res.json({ isCommand: true, commandType: analysis.type, replyText: analysis.replyText });
    }

    if (analysis.type === 'set_voice') {
      if (analysis.actionValue) {
        whatsappService.setUserPreference(targetJid, {
          voiceId: analysis.actionValue.id,
          voiceName: analysis.actionValue.name,
        });
      }
      return res.json({ isCommand: true, commandType: 'set_voice', replyText: analysis.replyText });
    }

    if (analysis.type === 'set_format') {
      if (analysis.actionValue) {
        whatsappService.setUserPreference(targetJid, { aspectRatio: analysis.actionValue });
      }
      return res.json({ isCommand: true, commandType: 'set_format', replyText: analysis.replyText });
    }

    if (analysis.type === 'set_duration') {
      if (analysis.actionValue) {
        whatsappService.setUserPreference(targetJid, { durationSeconds: analysis.actionValue });
      }
      return res.json({ isCommand: true, commandType: 'set_duration', replyText: analysis.replyText });
    }

    if (analysis.type === 'set_music') {
      if (analysis.actionValue) {
        whatsappService.setUserPreference(targetJid, {
          enableBgMusic: analysis.actionValue.enabled,
          bgMusicPreset: analysis.actionValue.preset,
        });
      }
      return res.json({ isCommand: true, commandType: 'set_music', replyText: analysis.replyText });
    }

    if (analysis.type === 'set_subtitles') {
      if (typeof analysis.actionValue === 'boolean') {
        whatsappService.setUserPreference(targetJid, { showSubtitles: analysis.actionValue });
      }
      return res.json({ isCommand: true, commandType: 'set_subtitles', replyText: analysis.replyText });
    }

    if (analysis.type === 'status') {
      const status = whatsappService.getStatus();
      const active = status.jobs.filter((j) => j.status === 'pending' || j.status === 'processing' || j.status === 'rendering');
      const lines = [
        `📊 *Status da Fila — IA Narrada*`,
        `• Em processamento agora: *${active.length}*`,
        `• Concluídos com sucesso: *${status.jobs.filter((j) => j.status === 'completed').length}*`,
      ];
      if (active.length > 0) {
        lines.push('');
        for (const j of active.slice(0, 5)) {
          lines.push(`⏳ *${j.title || j.parsed.content.slice(0, 36)}* — ${j.progress}% (${j.statusText})`);
        }
      }
      return res.json({ isCommand: true, commandType: 'status', replyText: lines.join('\n') });
    }

    if (analysis.type !== 'job' || !analysis.parsed) {
      // Natural language conversation / question / request for the Gemini Assistant!
      const simResult = await whatsappAssistantService.handleSimulatedMessage({
        remoteJid: targetJid,
        senderName: senderName || 'Você',
        rawText: message,
      });

      return res.json({
        isAssistant: true,
        intent: simResult.intent,
        replyText: simResult.replyText,
        isJob: !!simResult.job,
        job: simResult.job,
      });
    }

    const job = await whatsappService.enqueueJob({
      groupId: targetJid,
      groupName: groupName || 'Grupo de Teste / Painel',
      senderJid: 'painel@s.whatsapp.net',
      senderName: senderName || 'Você (Painel)',
      rawMessage: message,
      parsed: analysis.parsed,
    });

    return res.json({ isJob: true, job });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erro ao processar comando' });
  }
});

// Endpoint to view central Gemini Key Manager status (keys redacted for security)
app.get('/api/gemini/keys-status', (_req: Request, res: Response) => {
  try {
    const status = geminiKeyManager.getPoolStatus();
    return res.json({
      totalKeys: status.length,
      availableKeys: status.filter((k) => k.isAvailable).length,
      keys: status,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erro ao consultar status das chaves' });
  }
});

app.post('/api/whatsapp/jobs/:id/progress', (req: Request, res: Response) => {
  const { id } = req.params;
  const updated = whatsappService.updateJobProgress(id, req.body || {});
  if (!updated) {
    return res.status(404).json({ error: 'Job não encontrado' });
  }
  return res.json({ job: updated });
});

app.post(
  '/api/whatsapp/jobs/:id/complete',
  express.raw({ type: '*/*', limit: '250mb' }),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const videoBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
      if (!videoBuffer || videoBuffer.length === 0) {
        return res.status(400).json({ error: 'Buffer de vídeo MP4 vazio' });
      }

      const title = req.headers['x-video-title']
        ? decodeURIComponent(String(req.headers['x-video-title']))
        : undefined;
      const caption = req.headers['x-video-caption']
        ? decodeURIComponent(String(req.headers['x-video-caption']))
        : undefined;
      const filename = req.headers['x-video-filename']
        ? decodeURIComponent(String(req.headers['x-video-filename']))
        : undefined;

      const appBaseUrl =
        process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

      const completedJob = await whatsappService.completeJobAndSendVideo(id, videoBuffer, {
        title,
        caption,
        filename,
        appBaseUrl,
      });

      if (!completedJob) {
        return res.status(404).json({ error: 'Job não encontrado' });
      }
      return res.json({ job: completedJob });
    } catch (err: any) {
      console.error('Error completing WhatsApp video job:', err);
      return res.status(500).json({ error: err?.message || 'Falha ao finalizar e enviar vídeo' });
    }
  }
);

app.post('/api/whatsapp/jobs/:id/resend', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { targetGroupId } = req.body || {};
    await whatsappService.resendJobVideoToWhatsApp(id, targetGroupId);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Falha ao reenviar vídeo no WhatsApp' });
  }
});

app.delete('/api/whatsapp/jobs/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  whatsappService.deleteJob(id);
  return res.json({ ok: true });
});

app.get('/api/whatsapp/jobs/:id/video', (req: Request, res: Response) => {
  const { id } = req.params;
  const videoPath = whatsappService.getJobVideoPath(id);
  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Vídeo não encontrado' });
  }

  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(videoPath).pipe(res);
  }
});

app.get('/api/whatsapp/media/:filename', (req: Request, res: Response) => {
  const { filename } = req.params;
  const filePath = whatsappService.getMediaFilePath(filename);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Mídia não encontrada' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === '.mp4'
      ? 'video/mp4'
      : ext === '.png'
      ? 'image/png'
      : ext === '.webp'
      ? 'image/webp'
      : 'image/jpeg';

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (mimeType.startsWith('video/') && range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Vite Integration
async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT} in ${isProd ? 'production' : 'development'} mode`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
