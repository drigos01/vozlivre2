import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// Curated voices list for locale fallback
const CURATED_VOICES = [
  { id: 'pt-BR-FranciscaNeural', name: 'Francisca', lang: 'pt-BR', voiceLocale: 'pt-BR' },
  { id: 'pt-BR-ThalitaMultilingualNeural', name: 'Thalita', lang: 'pt-BR', voiceLocale: 'pt-BR' },
  { id: 'pt-BR-AntonioNeural', name: 'Antônio', lang: 'pt-BR', voiceLocale: 'pt-BR' },
  { id: 'en-US-AndrewMultilingualNeural', name: 'André', lang: 'pt-BR', voiceLocale: 'pt-BR' },
  { id: 'en-US-BrianMultilingualNeural', name: 'Bruno', lang: 'pt-BR', voiceLocale: 'pt-BR' },
  { id: 'en-AU-WilliamMultilingualNeural', name: 'William', lang: 'pt-BR', voiceLocale: 'pt-BR' },
  { id: 'fr-FR-RemyMultilingualNeural', name: 'Rodrigo', lang: 'pt-BR', voiceLocale: 'pt-BR' },
  { id: 'de-DE-FlorianMultilingualNeural', name: 'Fábio', lang: 'pt-BR', voiceLocale: 'pt-BR' },
  { id: 'it-IT-GiuseppeMultilingualNeural', name: 'Gustavo', lang: 'pt-BR', voiceLocale: 'pt-BR' },
  { id: 'pt-PT-RaquelNeural', name: 'Raquel', lang: 'pt-PT', voiceLocale: 'pt-PT' },
  { id: 'pt-PT-DuarteNeural', name: 'Duarte', lang: 'pt-PT', voiceLocale: 'pt-PT' },
  { id: 'en-US-JennyNeural', name: 'Jenny', lang: 'en-US', voiceLocale: 'en-US' },
  { id: 'en-US-GuyNeural', name: 'Guy', lang: 'en-US', voiceLocale: 'en-US' },
  { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US', voiceLocale: 'en-US' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', lang: 'en-GB', voiceLocale: 'en-GB' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', lang: 'en-GB', voiceLocale: 'en-GB' },
  { id: 'es-ES-ElviraNeural', name: 'Elvira', lang: 'es-ES', voiceLocale: 'es-ES' },
  { id: 'es-ES-AlvaroNeural', name: 'Álvaro', lang: 'es-ES', voiceLocale: 'es-ES' },
  { id: 'es-MX-DaliaNeural', name: 'Dalia', lang: 'es-MX', voiceLocale: 'es-MX' },
];

function chunkText(text, maxLen = 420) {
  const clean = text.replace(/\r\n/g, '\n').replace(/\t/g, ' ').trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n+/);
  const sentences = [];

  for (const para of paragraphs) {
    const rawSentences = para.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [para];
    for (const s of rawSentences) {
      const trimmed = s.trim();
      if (trimmed) sentences.push(trimmed);
    }
  }

  const chunks = [];
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

function sanitizeTextForTts(raw, lang = 'pt-BR') {
  if (!raw) return '';

  let text = raw
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

async function synthesizeChunk(text, voice, rate = '+0%', pitch = '+0Hz', volume = '+0%') {
  const tts = new MsEdgeTTS();
  const matchedVoice = CURATED_VOICES.find((v) => v.id === voice);
  const voiceLocale = matchedVoice?.voiceLocale || (voice.startsWith('pt-') ? 'pt-BR' : undefined);
  const sanitized = sanitizeTextForTts(text, voiceLocale || (voice.startsWith('pt-') ? 'pt-BR' : 'en'));

  if (!sanitized) {
    throw new Error('Texto vazio após higienização.');
  }

  if (voiceLocale) {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { voiceLocale });
  } else {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  }

  return new Promise((resolve, reject) => {
    try {
      const { audioStream } = tts.toStream(sanitized, {
        rate: rate || '+0%',
        pitch: pitch || '+0Hz',
        volume: volume || '+0%',
      });

      const chunks = [];
      audioStream.on('data', (d) => chunks.push(d));
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

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {}
    }

    const { text, voice = 'pt-BR-FranciscaNeural', rate = '+0%', pitch = '+0Hz', volume = '+0%' } =
      body || {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Texto não informado ou vazio.' });
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return res.status(400).json({ error: 'Nenhum texto válido para conversão.' });
    }

    const results = new Array(chunks.length);
    const concurrency = 3;
    let currentIndex = 0;

    async function worker() {
      while (currentIndex < chunks.length) {
        const idx = currentIndex++;
        const chunk = chunks[idx];
        let attempts = 0;
        let success = false;

        while (!success && attempts < 3) {
          try {
            attempts++;
            results[idx] = await synthesizeChunk(chunk, voice, rate, pitch, volume);
            success = true;
          } catch (err) {
            if (attempts >= 3) throw err;
            await new Promise((r) => setTimeout(r, 300 * attempts));
          }
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker());
    await Promise.all(workers);

    const fullBuffer = Buffer.concat(results);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', fullBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(fullBuffer);
  } catch (err) {
    console.error('Error in /api/tts:', err);
    return res.status(500).json({
      error: 'Erro na geração de áudio.',
      details: err?.message || String(err),
    });
  }
}
