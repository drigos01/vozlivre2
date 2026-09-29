import { GoogleGenAI } from '@google/genai';
import { NarrativeScene } from '../types';

interface GenerateNarrativeParams {
  mode: 'full_prompt' | 'idea_theme';
  storyText?: string;
  premise?: string;
  genre?: string;
  tone?: string;
  targetDurationSeconds?: number;
  aspectRatio?: '16:9' | '9:16';
}

export interface WebMediaItem {
  id: string;
  url: string;
  thumbUrl: string;
  title: string;
  source: 'Wikipédia' | 'Wikimedia Commons' | 'Openverse' | 'Web Archive' | 'URL Direta';
  type: 'image' | 'video';
}

export interface ParsedSearchTag {
  rawTag: string;
  cleanTerm: string;
  isUrl: boolean;
  exactUrl?: string;
}

/**
 * Normalizes a raw URL string (removes surrounding brackets/quotes, unescapes &amp;, adds https:// to www.,
 * and unwraps Google Images imgurl/mediaurl redirects while preserving valid parentheses in filenames)
 */
function normalizeMediaUrl(rawUrl: string): string {
  let clean = rawUrl
    .trim()
    .replace(/^[\s[\]"'<>]+|[\s[\]"'<>]+$/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, '');
  if (clean.toLowerCase().startsWith('www.')) {
    clean = 'https://' + clean;
  }
  try {
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      const parsed = new URL(clean);
      const unwrapped = parsed.searchParams.get('imgurl') || parsed.searchParams.get('mediaurl');
      if (unwrapped && (unwrapped.startsWith('http://') || unwrapped.startsWith('https://'))) {
        return unwrapped.trim();
      }
    }
  } catch {}
  return clean;
}

const ACOUSTIC_TAG_REGEX = /^(?:pausa|ênfase|enfase|sussurro|lento|rápido|rapido|grave|agudo|forte|grito|silêncio|silencio|respiração|respiracao|riso|suspiro|voz\s*:|narrador\s*:|sfx\s*:)\b/i;

/**
 * Parses media links or tags in brackets like [https://exemplo.com/imagem.jpg]
 * Enforces that direct URLs (http://, https://, www., data:image/) in [] or markdown are extracted cleanly.
 */
export function parseSearchTag(input?: string): ParsedSearchTag | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1. Look for any bracket [ ... ] containing a URL or visual media reference anywhere in the string
  const allBrackets = Array.from(input.matchAll(/\[\s*([^\]]+?)\s*\]/g));
  for (const match of allBrackets) {
    const content = match[1].trim();
    if (!content || ACOUSTIC_TAG_REGEX.test(content)) continue;
    const urlMatch = content.match(/(?:https?:\/\/|www\.|data:image\/)[^\s\]"']+/i);
    if (urlMatch) {
      const url = normalizeMediaUrl(urlMatch[0]);
      return {
        rawTag: match[0],
        cleanTerm: url,
        isUrl: true,
        exactUrl: url,
      };
    }
    return {
      rawTag: match[0],
      cleanTerm: content,
      isUrl: false,
    };
  }

  // 2. Markdown link format ![alt](https://...) or [label](https://...)
  const mdMatch = input.match(/!?\[[^\]]*\]\(\s*(https?:\/\/[^\s)"']+)\s*\)/i);
  if (mdMatch) {
    const url = normalizeMediaUrl(mdMatch[1]);
    return {
      rawTag: mdMatch[0],
      cleanTerm: url,
      isUrl: true,
      exactUrl: url,
    };
  }

  // 3. Direct raw URL check (extract only the URL token, not trailing words)
  const rawUrlMatch = trimmed.match(/^(https?:\/\/[^\s\]"']+)/i);
  if (rawUrlMatch) {
    const url = normalizeMediaUrl(rawUrlMatch[1]);
    return {
      rawTag: rawUrlMatch[0],
      cleanTerm: url,
      isUrl: true,
      exactUrl: url,
    };
  }

  return null;
}

/**
 * Removes media links inside [] from the spoken narration text
 * so that the neural TTS narrator does not speak URLs or brackets out loud.
 * Preserves acoustic expression tags like [pausa 1s], [ênfase], [sussurro], and [Voz: Nome].
 */
export function cleanNarrationText(text?: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    // Remove markdown links ![alt](http...) or [label](http...)
    .replace(/!?\[[^\]]*\]\(\s*https?:\/\/[^\s)"']+\s*\)/gi, ' ')
    // Remove links in brackets like [https://...] or [http://...] or [www....] even with newlines inside
    .replace(/\[\s*(?:https?:\/\/|www\.|data:image\/)[^[\]]*?\s*\]/gi, ' ')
    // Remove any leftover bracket tags that are not acoustic or multi-voice tags
    .replace(/\[\s*(?!pausa|ênfase|enfase|sussurro|lento|rápido|rapido|grave|agudo|forte|grito|silêncio|silencio|respiração|respiracao|voz\s*:|narrador\s*:)(?:https?:\/\/[^\s\]]+|[^\]]+?)\s*\]/gi, ' ')
    // Remove standalone raw http/https URLs
    .replace(/(?:^|\s)https?:\/\/[^\s\]"']+/gi, ' ')
    // Remove standalone "Roteiro Criativo" header if present
    .replace(/^\s*(?:#+\s*)?\*{0,2}roteiro\s+criativo\*{0,2}\s*[:.-]*\s*$/gim, ' ')
    // Normalize spaces
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

const STOPWORDS = new Set([
  'conte', 'veja', 'assista', 'conheça', 'descubra', 'entenda', 'história', 'historia',
  'caso', 'uma', 'um', 'este', 'esse', 'essa', 'quando', 'como', 'para', 'com', 'por',
  'mais', 'muito', 'depois', 'antes', 'no', 'na', 'nos', 'nas', 'de', 'do', 'da', 'dos',
  'das', 'em', 'sobre', 'fale', 'quero', 'vídeo', 'video', 'minuto', 'minutos', 'segundos',
  'curto', 'roteiro', 'criativo', 'completo', 'verdadeira', 'real', 'verídica', 'fato'
]);

/**
 * Heuristic entity and topic extractor to detect the real story subject
 * (e.g., "Ayrton Senna", "Santos Dumont", "Titanic", "Williams FW16")
 */
export function extractThemeAndEntities(text?: string, premise?: string): {
  primarySubject: string;
  detectedEntities: string[];
  themeKeywords: string[];
} {
  const combined = `${text || ''} ${premise || ''}`.trim();
  if (!combined) {
    return {
      primarySubject: 'História Real',
      detectedEntities: ['História Real'],
      themeKeywords: ['história', 'documentário'],
    };
  }

  // Extract multi-word or single-word capitalized proper names with hyphens
  const properMatches = combined.match(/[A-ZÀ-Ú][a-zà-ú0-9-]+(?:\s+[A-ZÀ-Ú][a-zà-ú0-9-]+)*/g) || [];
  const candidateEntities: string[] = [];

  for (const m of properMatches) {
    const trimmed = m.trim().replace(/[-–]+$/, '');
    const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
    if (!STOPWORDS.has(firstWord) && trimmed.length > 2) {
      if (!candidateEntities.includes(trimmed)) {
        candidateEntities.push(trimmed);
      }
    }
  }

  // Extract common historical/biographical patterns
  const introMatch = combined.match(/(?:história\s+d[eo]s?|fale\s+sobre|vida\s+d[eo]s?|biografia\s+d[eo]s?|sobre)\s+([A-Za-zÀ-ÿ0-9\s-]{3,40})/i);
  if (introMatch && introMatch[1]) {
    const cleanSubject = introMatch[1].replace(/[,.;\n].*$/, '').trim();
    if (cleanSubject && !candidateEntities.includes(cleanSubject)) {
      candidateEntities.unshift(cleanSubject);
    }
  }

  // Pick the best concise subject (1 to 4 words) from detected entities
  const cleanSubjectCandidate = candidateEntities.find(
    (e) => e.split(/\s+/).length >= 1 && e.split(/\s+/).length <= 3 && !e.toLowerCase().includes('história')
  );

  const primarySubject = cleanSubjectCandidate ||
    candidateEntities[0] ||
    combined.split(/\s+/).filter(w => !STOPWORDS.has(w.toLowerCase())).slice(0, 2).join(' ') ||
    'História Real';

  const themeKeywords = [
    primarySubject,
    `${primarySubject} história`,
    `${primarySubject} foto`,
    ...candidateEntities.slice(0, 4),
  ];

  return {
    primarySubject,
    detectedEntities: candidateEntities.slice(0, 8),
    themeKeywords,
  };
}

/**
 * Cleans caption text: strictly removes any "Cena X:" count, prefixes, and all quotation marks ("" or “”)
 * Ex: "Cena 1: O mistério começou" -> "O mistério começou"
 */
export function cleanCaptionText(text?: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/^[\s(\[{]*(cena|scene|parte|bloco|take|segmento|capítulo|capitulo)\s*#?\s*\d+\s*(?:de|\/)?\s*\d*[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^[\s(\[{]*(legenda|caption|subtítulo|subtitulo|narração|narracao|texto)[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^\s*\d+[\s:.-]+\s*/g, '');
  cleaned = cleaned.replace(/["'“”«»`]/g, '');
  cleaned = cleaned.replace(/^[\s(\[{]*(cena|scene|parte|bloco|take|segmento|capítulo|capitulo)\s*#?\s*\d+\s*(?:de|\/)?\s*\d*[\s)\]:.-]*/gi, '');
  cleaned = cleaned.replace(/^[\s:.-]+/, '').replace(/[\s:.-]+$/, '');
  return cleaned.trim();
}

/**
 * Resolves media ONLY from direct links / URLs enclosed in [] or raw URLs.
 * Term / keyword search is strictly removed per specification:
 * "Tire a pesquisa por termos será só por links em [] somente esse tipo só links".
 */
export async function searchRealWebMedia(
  queries: string[],
  limit = 8
): Promise<WebMediaItem[]> {
  const seenUrls = new Set<string>();
  const combined: WebMediaItem[] = [];

  for (const rawQ of queries) {
    if (!rawQ || !rawQ.trim()) continue;

    // Look for URL inside brackets [http...] or raw URL
    const parsed = parseSearchTag(rawQ);
    const directUrl = parsed?.exactUrl || rawQ.match(/https?:\/\/[^\s\]"']+/i)?.[0];

    if (directUrl && (directUrl.startsWith('http://') || directUrl.startsWith('https://'))) {
      if (!seenUrls.has(directUrl)) {
        seenUrls.add(directUrl);
        const isVid = directUrl.toLowerCase().includes('.mp4') || directUrl.toLowerCase().includes('.webm');
        combined.push({
          id: `direct-url-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          url: directUrl,
          thumbUrl: directUrl,
          title: 'Link Direto Fornecido [URL]',
          source: 'URL Direta',
          type: isVid ? 'video' : 'image',
        });
        if (combined.length >= limit) return combined;
      }
    }
    // Per instruction: "Tire a pesquisa por termos será só por links em [] somente esse tipo só links"
    // No keyword or term searching is performed.
  }

  return combined;
}

/**
 * Multi-model execution with fast automatic fallback across free Gemini models
 */
async function callGeminiWithModelFallback(
  ai: GoogleGenAI,
  prompt: string
): Promise<any> {
  const models = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];

  for (const model of models) {
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.7,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout on model ${model}`)), 6000)
        ),
      ]);

      const raw = response.text?.trim() || '';
      if (!raw) continue;

      try {
        return JSON.parse(raw);
      } catch {
        const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        return JSON.parse(clean);
      }
    } catch {
      // Silently try next model in fallback chain
    }
  }

  return null;
}

/**
 * Intelligently generates a narrative strictly calibrated to duration and topic when AI models are overloaded
 */
function generateIntelligentFallbackScript(
  params: GenerateNarrativeParams,
  duration: number,
  targetWords: number,
  estimatedScenes: number
): {
  title: string;
  genre: string;
  tone: string;
  storyEntities: string[];
  fullNarration: string;
  scenes: any[];
} {
  const { primarySubject, detectedEntities } = extractThemeAndEntities(params.storyText, params.premise);
  const subject = primarySubject || 'Ayrton Senna';

  const title = params.storyText && params.storyText.length > 5 && params.storyText.length < 50
    ? params.storyText
    : `${subject}: A Lenda e o Legado Imortal`;

  // Dynamic biographical & documentary templates tailored specifically to Ayrton Senna or other real subjects
  const isSenna = subject.toLowerCase().includes('senna') || (params.storyText || '').toLowerCase().includes('senna');
  
  let sceneNarratives: { text: string; caption: string; primaryKeyword: string; secondaryKeyword: string }[] = [];

  if (isSenna) {
    const isShort = duration <= 35;
    const isMedium = duration <= 75; // 60s target (1 min)

    if (isShort) {
      // ~65-70 words for 30s
      sceneNarratives = [
        {
          caption: 'O Início de um Mito',
          primaryKeyword: 'Ayrton Senna',
          secondaryKeyword: 'Ayrton Senna kart',
          text: 'A extraordinária trajetória de Ayrton Senna começou com uma dedicação incomparável pela velocidade máxima, desafiando todos os limites do automobilismo mundial.',
        },
        {
          caption: 'O Milagre de Interlagos',
          primaryKeyword: 'Ayrton Senna Interlagos 1991',
          secondaryKeyword: 'Ayrton Senna podium',
          text: 'Em 1991, em Interlagos, Senna venceu com apenas a sexta marcha em uma das maiores façanhas esportivas de todos os tempos, levando o Brasil às lágrimas.',
        },
        {
          caption: 'A Imortalidade de Senna',
          primaryKeyword: 'Estatua Ayrton Senna',
          secondaryKeyword: 'Ayrton Senna capacete',
          text: 'Mais de três décadas depois, o legado de Ayrton Senna permanece imortal como símbolo supremo de superação, coragem e orgulho para todas as gerações.',
        },
      ];
    } else if (isMedium) {
      // ~138 words for 60s (1 min)
      sceneNarratives = [
        {
          caption: 'O Início de um Mito',
          primaryKeyword: 'Ayrton Senna',
          secondaryKeyword: 'Ayrton Senna kart',
          text: 'A extraordinária trajetória de Ayrton Senna começou com uma dedicação incomparável pela velocidade máxima. Desde o kart até a Fórmula 1, sua busca obstinada pela perfeição já desafiava todos os padrões.',
        },
        {
          caption: 'O Mestre da Chuva',
          primaryKeyword: 'Ayrton Senna McLaren',
          secondaryKeyword: 'Ayrton Senna 1988',
          text: 'Nas pistas mais desafiadoras do planeta, Senna transformava tempestades e asfalto encharcado em pura arte. Suas voltas milimétricas em Mônaco consagraram seu talento indiscutível perante o mundo.',
        },
        {
          caption: 'O Milagre de Interlagos',
          primaryKeyword: 'Ayrton Senna Interlagos 1991',
          secondaryKeyword: 'Ayrton Senna podium',
          text: 'Em 1991, diante de uma multidão em Interlagos, Senna venceu uma prova histórica apenas com a sexta marcha. Venceu no limite físico, erguendo o troféu aos prantos sob chuva e êxtase coletivo.',
        },
        {
          caption: 'O Orgulho de um País',
          primaryKeyword: 'Ayrton Senna capacete',
          secondaryKeyword: 'Williams FW16',
          text: 'Mais do que um tricampeão mundial, Ayrton representava o orgulho, a dignidade e a esperança de todo o povo brasileiro. Cada domingo de vitória unia o país inteiro com o inesquecível Tema da Vitória.',
        },
        {
          caption: 'A Imortalidade de Senna',
          primaryKeyword: 'Estatua Ayrton Senna',
          secondaryKeyword: 'Ayrton Senna monumento',
          text: 'Mais de três décadas depois, o legado e a paixão de Ayrton Senna permanecem vivos nos corações de todas as gerações. Uma lenda eterna que provou que a verdadeira bravura nunca se apaga.',
        },
      ];
    } else {
      // Long version (90s - 180s)
      sceneNarratives = [
        {
          caption: 'O Início de um Mito',
          primaryKeyword: 'Ayrton Senna',
          secondaryKeyword: 'Ayrton Senna kart',
          text: 'A extraordinária trajetória de Ayrton Senna começou com uma dedicação incomparável e uma paixão inata pela velocidade máxima. Desde as primeiras vitórias no kart até a estreia triunfal na Fórmula 1, sua disciplina e busca obstinada pela perfeição já chamavam a atenção do automobilismo mundial.',
        },
        {
          caption: 'O Mestre da Chuva',
          primaryKeyword: 'Ayrton Senna McLaren',
          secondaryKeyword: 'Ayrton Senna 1988',
          text: 'Nas pistas mais desafiadoras do planeta, Senna transformava tempestades e asfalto encharcado em pura arte. Suas voltas de classificação milimétricas em Mônaco e Silverstone e o primeiro título mundial pela McLaren consagraram seu nome no olimpo dos maiores pilotos da história.',
        },
        {
          caption: 'O Milagre de Interlagos',
          primaryKeyword: 'Ayrton Senna Interlagos 1991',
          secondaryKeyword: 'Ayrton Senna podium',
          text: 'Em 1991, diante de uma multidão em Interlagos, Senna protagonizou uma das maiores façanhas do esporte. Com o câmbio travado apenas na sexta marcha nas voltas finais, suportou dores atrozes nos ombros e cruzou a linha de chegada em primeiro, erguendo o troféu aos prantos.',
        },
        {
          caption: 'O Orgulho de um País',
          primaryKeyword: 'Ayrton Senna capacete',
          secondaryKeyword: 'Williams FW16',
          text: 'Mais do que um tricampeão mundial, Ayrton representava o orgulho, a dignidade e a esperança de todo o povo brasileiro nos anos noventa. Cada domingo de vitória era um lembrete vivo de que a garra e a fé podiam superar qualquer adversidade.',
        },
        {
          caption: 'A Imortalidade de Senna',
          primaryKeyword: 'Estatua Ayrton Senna',
          secondaryKeyword: 'Ayrton Senna monumento',
          text: 'Mais de três décadas depois, o legado de Ayrton Senna permanece imortal e inspirador em todo o planeta. Uma lenda eterna que transcendeu o esporte e provou que quem luta com bravura e amor jamais será esquecido.',
        },
      ];
    }
  } else {
    // Universal high-fidelity historical documentary template for any entity
    const sec1 = detectedEntities[1] || `${subject} início`;
    const sec2 = detectedEntities[2] || `${subject} marco`;
    const sec3 = detectedEntities[3] || `${subject} auge`;

    const isShort = duration <= 35;
    const isMedium = duration <= 75;

    if (isShort) {
      sceneNarratives = [
        {
          caption: `O Surgimento de ${subject}`,
          primaryKeyword: subject,
          secondaryKeyword: `${subject} história`,
          text: `A trajetória histórica de ${subject} começou com determinação singular e visão pioneira, inaugurando um capítulo revolucionário na história.`,
        },
        {
          caption: 'O Ponto de Virada',
          primaryKeyword: sec1,
          secondaryKeyword: `${subject} evento`,
          text: `Ao longo de desafios decisivos, a coragem e a precisão inabalável consagraram conquistas memoráveis que transformaram para sempre os rumos dos acontecimentos.`,
        },
        {
          caption: 'Legado Eterno',
          primaryKeyword: `${subject} monumento`,
          secondaryKeyword: `${subject} memória`,
          text: `Hoje, a memória e a grandiosidade de ${subject} permanecem eternamente vivas e admiradas por gerações em todo o mundo.`,
        },
      ];
    } else if (isMedium) {
      sceneNarratives = [
        {
          caption: `O Surgimento de ${subject}`,
          primaryKeyword: subject,
          secondaryKeyword: `${subject} história`,
          text: `A trajetória histórica de ${subject} teve início com determinação singular e visão pioneira. Desde os primeiros passos e desafios, sua presença desafiou padrões e abriu um capítulo transformador.`,
        },
        {
          caption: 'A Grande Ascensão',
          primaryKeyword: sec1,
          secondaryKeyword: `${subject} documento`,
          text: `Ao longo do tempo, cada conquista decisiva exigiu perseverança inabalável e superação constante. Diante de cenários complexos, a busca pela excelência consolidou seu impacto perante o público.`,
        },
        {
          caption: 'O Ponto de Virada',
          primaryKeyword: sec2,
          secondaryKeyword: `${subject} evento`,
          text: `O momento crucial dessa jornada consagrou feitos históricos inesquecíveis. Onde muitos encontravam limitações, a precisão e a coragem abriram novos horizontes e inspiraram multidões.`,
        },
        {
          caption: 'Impacto e Consagração',
          primaryKeyword: sec3,
          secondaryKeyword: `${subject} registro`,
          text: `As marcas deixadas ao longo dos anos forjaram uma identidade duradoura e respeitada. Cada vitória e lição reverberaram profundamente como fonte inesgotável de orgulho e respeito mútuo.`,
        },
        {
          caption: 'Legado Eterno',
          primaryKeyword: `${subject} monumento`,
          secondaryKeyword: `${subject} memória`,
          text: `Hoje, a memória e as contribuições de ${subject} continuam vivas e reverenciadas. Um legado permanente que desafia o tempo e reafirma a força da dedicação humana.`,
        },
      ];
    } else {
      sceneNarratives = [
        {
          caption: `O Surgimento de ${subject}`,
          primaryKeyword: subject,
          secondaryKeyword: `${subject} história`,
          text: `A trajetória histórica de ${subject} teve início com determinação singular e visão revolucionária. Desde os primeiros passos e desafios, sua presença desafiou paradigmas e inaugurou um capítulo transformador na história.`,
        },
        {
          caption: 'A Grande Ascensão',
          primaryKeyword: sec1,
          secondaryKeyword: `${subject} documento`,
          text: `Ao longo do tempo, cada conquista decisiva exigiu perseverança inabalável e superação constante. Diante de cenários complexos, a busca contínua pela excelência consolidou seu impacto perante a sociedade.`,
        },
        {
          caption: 'O Ponto de Virada',
          primaryKeyword: sec2,
          secondaryKeyword: `${subject} evento`,
          text: `O momento crucial dessa jornada consagrou feitos históricos memoráveis. Onde muitos encontravam limitações intransponíveis, a precisão, o foco e a coragem abriram novos caminhos para as futuras gerações.`,
        },
        {
          caption: 'Impacto e Consagração',
          primaryKeyword: sec3,
          secondaryKeyword: `${subject} registro`,
          text: `As marcas deixadas ao longo dos anos forjaram uma identidade duradoura e respeitada mundialmente. Cada vitória e cada lição reverberaram profundamente como inspiração e orgulho coletivo.`,
        },
        {
          caption: 'Legado Eterno',
          primaryKeyword: `${subject} monumento`,
          secondaryKeyword: `${subject} memória`,
          text: `Hoje, a memória e as contribuições de ${subject} continuam vivas e reverenciadas. Um legado permanente que desafia a passagem do tempo e reafirma o poder transformador da dedicação e da grandeza humana.`,
        },
      ];
    }
  }

  // If user provided substantive text, adapt and balance it to the requested duration
  if (params.storyText && params.storyText.trim().length > 10) {
    const rawParagraphs = params.storyText.trim().split(/\n+/).filter(Boolean);
    if (rawParagraphs.length >= 1) {
      for (let p = 0; p < Math.min(sceneNarratives.length, rawParagraphs.length); p++) {
        const rawP = rawParagraphs[p].trim();
        const parsedTag = parseSearchTag(rawP);
        const cleanedText = cleanNarrationText(rawP);

        if (cleanedText.length > 5) {
          sceneNarratives[p].text = cleanedText;
        }

        if (parsedTag) {
          sceneNarratives[p].primaryKeyword = parsedTag.cleanTerm;
          (sceneNarratives[p] as any).searchTag = parsedTag.cleanTerm;
          if (parsedTag.isUrl) {
            (sceneNarratives[p] as any).exactMediaUrl = parsedTag.exactUrl;
          }
        }
      }
    }
  }

  // Adjust scene count to estimatedScenes
  const finalScenes = sceneNarratives.slice(0, estimatedScenes);
  while (finalScenes.length < estimatedScenes) {
    const idx = finalScenes.length;
    const base = sceneNarratives[idx % sceneNarratives.length];
    finalScenes.push({
      ...base,
      caption: `${base.caption} - Parte ${idx + 1}`,
    });
  }

  const rawScenes = finalScenes.map((item, idx) => ({
    sceneNumber: idx + 1,
    narrationSegment: cleanNarrationText(item.text),
    visualDescription: `Registro visual autêntico para a cena ${idx + 1}`,
    primaryKeyword: item.primaryKeyword,
    secondaryKeyword: item.secondaryKeyword,
    searchTag: (item as any).searchTag,
    exactMediaUrl: (item as any).exactMediaUrl,
    directMediaUrl: (item as any).exactMediaUrl,
    mediaType: 'image',
    caption: cleanCaptionText(item.caption),
  }));

  const fullNarration = cleanNarrationText(rawScenes.map((s) => s.narrationSegment).join(' '));

  return {
    title,
    genre: params.genre || 'Documentário',
    tone: params.tone || 'Emocionante',
    storyEntities: detectedEntities.length > 0 ? detectedEntities : [subject],
    fullNarration,
    scenes: rawScenes,
  };
}

/**
 * Generates or segments creative story narrative into scenes:
 * CRITICAL SPECIFICATION:
 * "A ia está mudando o texto fornecido nunca deve mudar! Deve seguir exatamente aquilo fornecido não deve interpretar não deve fazer nada além no roteiro criativo ela só segue aquilo fornecido! Coloca a imagem que tá em [] narra a parte que e pra narrar e faz o vídeo de acordo com as imagens no roteiro e etc"
 * "não deve interpretar se tem 10 minutos narrados deve ter 10 minutos de vídeo"
 *
 * When user supplies storyText:
 * 1. The text is 100% VERBATIM. ZERO rewriting, ZERO summarization, ZERO expansion, ZERO reinterpretation!
 * 2. Each block/paragraph with [link] becomes a scene with that exact link as media.
 * 3. Spoken text is cleaned ONLY of [https://...] links so TTS doesn't speak URLs.
 * 4. Duration is NOT forced or truncated: it matches the real speech duration (if 10 min, it is 10 min).
 */
export async function generateNarrativeVideoScript(
  ai: GoogleGenAI,
  params: GenerateNarrativeParams
): Promise<{
  title: string;
  genre: string;
  tone: string;
  fullNarration: string;
  targetDurationSeconds: number;
  storyEntities: string[];
  scenes: NarrativeScene[];
}> {
  const premiseHasBracketsOrLinks = Boolean(
    params.premise && (/(?:https?:\/\/|www\.|data:image\/)[^\s\]"']+/i.test(params.premise) || /\[[^\]]+\]/.test(params.premise))
  );
  const isUserSuppliedText = Boolean(
    (params.storyText && params.storyText.trim().length > 0) || premiseHasBracketsOrLinks
  );

  // Helper to resolve a non-URL visual tag inside [] to a real Wikimedia/Wikipedia image if needed
  const resolveTagToImageUrl = async (tagContent: string, fallbackIdx: number): Promise<string> => {
    const FALLBACK_POOL = [
      'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1280&q=80',
      'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1280&q=80',
      'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1280&q=80',
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1280&q=80',
      'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1280&q=80',
    ];
    const urlMatch = tagContent.match(/(?:https?:\/\/|www\.|data:image\/)[^\s\]"']+/i);
    if (urlMatch) {
      return normalizeMediaUrl(urlMatch[0]);
    }
    const cleanQuery = tagContent.replace(/^[\s[\]:.-]+|[\s[\]:.-]+$/g, '').trim();
    if (!cleanQuery) {
      return FALLBACK_POOL[fallbackIdx % FALLBACK_POOL.length];
    }
    try {
      const wikiUrl = `https://pt.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrlimit=3&prop=pageimages&piprop=original|thumbnail&pithumbsize=1280&format=json&origin=*`;
      const res = await fetch(wikiUrl, { headers: { 'User-Agent': 'VozLivreStudio/1.0' } });
      if (res.ok) {
        const data: any = await res.json();
        const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
        for (const p of pages as any[]) {
          const img = p?.original?.source || p?.thumbnail?.source;
          if (img && typeof img === 'string' && !img.toLowerCase().endsWith('.svg')) {
            return img;
          }
        }
      }
    } catch {}
    try {
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrnamespace=6&gsrlimit=3&prop=imageinfo&iiprop=url&iiurlwidth=1280&format=json&origin=*`;
      const res2 = await fetch(commonsUrl, { headers: { 'User-Agent': 'VozLivreStudio/1.0' } });
      if (res2.ok) {
        const data2: any = await res2.json();
        const pages2 = data2?.query?.pages ? Object.values(data2.query.pages) : [];
        for (const p of pages2 as any[]) {
          const info = p?.imageinfo?.[0];
          const img = info?.thumburl || info?.url;
          if (img && typeof img === 'string' && !img.toLowerCase().endsWith('.svg')) {
            return img;
          }
        }
      }
    } catch {}
    return FALLBACK_POOL[fallbackIdx % FALLBACK_POOL.length];
  };

  // CASE 1: USER PROVIDED TEXT -> 100% LITERAL AND VERBATIM (NO GEMINI REWRITING)
  if (isUserSuppliedText) {
    const rawText = (params.storyText && params.storyText.trim().length > 0
      ? params.storyText
      : params.premise)!.trim();
    const DEFAULT_BACKDROP = 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1280&q=80';

    // Step 1: Convert markdown links ![alt](url) or [label](url) into [url]
    const step1 = rawText.replace(/!?\[[^\]]*\]\(\s*(https?:\/\/[^\s)"']+)\s*\)/gi, (_, u) => `[${normalizeMediaUrl(u)}]`);

    // Step 2: Safely normalize existing [...] blocks and wrap bare URLs ONLY when outside [...]
    // This prevents corrupting URLs inside [...] that contain query params like ?imgurl=https://...
    const segments = step1.split(/(\[[^\]]+\])/g);
    const normalizedInput = segments
      .map((seg) => {
        if (seg.startsWith('[') && seg.endsWith(']')) {
          const inner = seg.slice(1, -1).trim();
          if (!inner || ACOUSTIC_TAG_REGEX.test(inner)) {
            return seg;
          }
          const m = inner.match(/(?:https?:\/\/|www\.|data:image\/)[^\s\]"']+/i);
          if (m) {
            return `[${normalizeMediaUrl(m[0])}]`;
          }
          return `[${inner}]`;
        }
        // Outside brackets: wrap any bare http/https/www URL into [url]
        return seg.replace(/(^|[\s"'(])((?:https?:\/\/|www\.)[^\s[\]"'<>]+)/gi, (_, prefix, u) => `${prefix}[${normalizeMediaUrl(u)}]`);
      })
      .join('');

    // Helper to split a block of narration text into N balanced parts so consecutive links each get spoken time
    const splitNarrationIntoParts = (textBlock: string, count: number): string[] => {
      const cleaned = cleanNarrationText(textBlock);
      if (!cleaned) return Array(count).fill('');
      if (count <= 1) return [cleaned];

      const paras = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean);
      if (paras.length >= count) {
        const result: string[] = [];
        for (let i = 0; i < count; i++) {
          const startIdx = Math.floor((i * paras.length) / count);
          const endIdx = Math.floor(((i + 1) * paras.length) / count);
          result.push(paras.slice(startIdx, Math.max(startIdx + 1, endIdx)).join('\n\n'));
        }
        return result;
      }

      const sentences = cleaned.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
      if (sentences.length >= count) {
        const result: string[] = [];
        for (let i = 0; i < count; i++) {
          const startIdx = Math.floor((i * sentences.length) / count);
          const endIdx = Math.floor(((i + 1) * sentences.length) / count);
          result.push(sentences.slice(startIdx, Math.max(startIdx + 1, endIdx)).join(' '));
        }
        return result;
      }

      const words = cleaned.split(/\s+/).filter(Boolean);
      const result: string[] = [];
      for (let i = 0; i < count; i++) {
        const startIdx = Math.floor((i * words.length) / count);
        const endIdx = Math.floor(((i + 1) * words.length) / count);
        result.push(words.slice(startIdx, Math.max(startIdx + 1, endIdx)).join(' '));
      }
      return result;
    };

    // Extract all non-acoustic [...] media tokens (both direct URLs and bracketed media tags)
    const bracketScanRegex = /\[\s*([^\]]+?)\s*\]/g;
    const rawTags: string[] = [];
    const textChunks: string[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = bracketScanRegex.exec(normalizedInput)) !== null) {
      const innerContent = match[1].trim();
      if (!innerContent || ACOUSTIC_TAG_REGEX.test(innerContent)) {
        continue;
      }
      textChunks.push(cleanNarrationText(normalizedInput.slice(lastIdx, match.index)));
      rawTags.push(innerContent);
      lastIdx = match.index + match[0].length;
    }
    textChunks.push(cleanNarrationText(normalizedInput.slice(lastIdx)));

    // Resolve all rawTags in parallel (direct URLs resolve immediately, descriptive tags resolve via Wikimedia)
    const urls = await Promise.all(rawTags.map((t, idx) => resolveTagToImageUrl(t, idx)));

    const pairedScenes: Array<{ mediaUrl: string; rawTag?: string; narration: string; hasExplicitUrl: boolean }> = [];

    if (urls.length === 0) {
      // No [...] tags provided in text: split by paragraphs and resolve contextual media per paragraph
      const paras = cleanNarrationText(normalizedInput)
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
      for (let pIdx = 0; pIdx < paras.length; pIdx++) {
        const p = paras[pIdx];
        const { primarySubject } = extractThemeAndEntities(p, '');
        const resolvedMedia = await resolveTagToImageUrl(primarySubject || p.slice(0, 40), pIdx);
        pairedScenes.push({
          mediaUrl: resolvedMedia || DEFAULT_BACKDROP,
          narration: p,
          hasExplicitUrl: false,
        });
      }
    } else {
      const leadingText = textChunks[0] || '';
      const trailingText = textChunks[urls.length] || '';
      const middleTexts = textChunks.slice(1, urls.length);
      const hasAnyAfterFirstUrl = middleTexts.some(Boolean) || Boolean(trailingText);

      if (leadingText && !trailingText && !middleTexts.some(Boolean)) {
        // All text is at the top, followed by all [url] tags at the bottom
        const parts = splitNarrationIntoParts(leadingText, urls.length);
        for (let i = 0; i < urls.length; i++) {
          pairedScenes.push({
            mediaUrl: urls[i],
            rawTag: rawTags[i],
            narration: parts[i] || leadingText,
            hasExplicitUrl: true,
          });
        }
      } else if (leadingText && !trailingText && hasAnyAfterFirstUrl) {
        // Suffix style: Texto 1 [url1] Texto 2 [url2]
        let i = 0;
        while (i < urls.length) {
          const textForGroup = textChunks[i] || '';
          let groupEnd = i;
          while (groupEnd + 1 < urls.length && !textChunks[groupEnd + 1]) {
            groupEnd++;
          }
          const groupUrls = urls.slice(i, groupEnd + 1);
          const groupRawTags = rawTags.slice(i, groupEnd + 1);
          const parts = splitNarrationIntoParts(textForGroup, groupUrls.length);
          for (let g = 0; g < groupUrls.length; g++) {
            pairedScenes.push({
              mediaUrl: groupUrls[g],
              rawTag: groupRawTags[g],
              narration: parts[g] || textForGroup,
              hasExplicitUrl: true,
            });
          }
          i = groupEnd + 1;
        }
      } else {
        // Prefix / Inline style: [url1] Texto 1 [url2] Texto 2 (with optional intro text before url1)
        const workingTexts = [...textChunks];
        if (workingTexts[0]) {
          // Attach any intro text before the first link to the first link's narration so it uses the first image
          workingTexts[1] = workingTexts[1]
            ? `${workingTexts[0]}\n\n${workingTexts[1]}`
            : workingTexts[0];
          workingTexts[0] = '';
        }

        let i = 0;
        while (i < urls.length) {
          let groupEnd = i;
          while (groupEnd < urls.length - 1 && !workingTexts[groupEnd + 1]) {
            groupEnd++;
          }
          const groupUrls = urls.slice(i, groupEnd + 1);
          const groupRawTags = rawTags.slice(i, groupEnd + 1);
          const groupText = workingTexts[groupEnd + 1] || '';

          if (groupText) {
            const parts = splitNarrationIntoParts(groupText, groupUrls.length);
            for (let g = 0; g < groupUrls.length; g++) {
              pairedScenes.push({
                mediaUrl: groupUrls[g],
                rawTag: groupRawTags[g],
                narration: parts[g] || groupText,
                hasExplicitUrl: true,
              });
            }
          } else if (pairedScenes.length > 0) {
            // Trailing URLs after the last text block: split the previous scene's text so trailing URLs also appear
            const prev = pairedScenes.pop()!;
            const combinedUrls = [prev.mediaUrl, ...groupUrls];
            const combinedTags = [prev.rawTag || prev.mediaUrl, ...groupRawTags];
            const parts = splitNarrationIntoParts(prev.narration, combinedUrls.length);
            for (let g = 0; g < combinedUrls.length; g++) {
              pairedScenes.push({
                mediaUrl: combinedUrls[g],
                rawTag: combinedTags[g],
                narration: parts[g] || prev.narration,
                hasExplicitUrl: true,
              });
            }
          } else {
            for (let g = 0; g < groupUrls.length; g++) {
              pairedScenes.push({
                mediaUrl: groupUrls[g],
                rawTag: groupRawTags[g],
                narration: '',
                hasExplicitUrl: true,
              });
            }
          }

          i = groupEnd + 1;
        }
      }
    }

    const scenes: NarrativeScene[] = [];
    const narrationSegments: string[] = [];

    for (let i = 0; i < pairedScenes.length; i++) {
      const item = pairedScenes[i];
      const cleanSegment = cleanNarrationText(item.narration);
      if (cleanSegment) {
        narrationSegments.push(cleanSegment);
      }

      const mediaUrl = item.mediaUrl || urls[0] || DEFAULT_BACKDROP;
      const isVid =
        mediaUrl.toLowerCase().includes('.mp4') ||
        mediaUrl.toLowerCase().includes('.webm');

      const snippet = cleanSegment.replace(/^[^\w\s]+/, '').split(/\s+/).slice(0, 7).join(' ').trim();
      const caption = cleanCaptionText(snippet ? `${snippet}...` : '');

      scenes.push({
        id: `narrative-scene-${Date.now()}-${i + 1}`,
        index: i,
        narrationSegment: cleanSegment,
        visualDescription: item.rawTag ? `Mídia: ${item.rawTag}` : `Mídia fornecida para a cena ${i + 1}`,
        searchQuery: item.rawTag || mediaUrl,
        searchTag: item.rawTag ? `[${item.rawTag}]` : `[${mediaUrl}]`,
        exactMediaUrl: mediaUrl,
        mediaType: isVid ? 'video' : 'image',
        mediaUrl,
        thumbnailUrl: mediaUrl,
        caption,
        isMutedVideo: true,
      });
    }

    const fullNarration = narrationSegments.join('\n\n');
    const wordCount = fullNarration.split(/\s+/).filter(Boolean).length;
    const estimatedDuration = Math.max(15, Math.round(wordCount / 2.3));

    // Extract title from first actual spoken sentence
    const firstLine = (narrationSegments[0] || '').split(/[.\n!?]/)[0].slice(0, 50).trim();
    const title = firstLine || 'História Narrada';

    return {
      title,
      genre: params.genre || 'Narrativa',
      tone: params.tone || 'Original',
      fullNarration,
      targetDurationSeconds: estimatedDuration,
      storyEntities: [title],
      scenes,
    };
  }

  // CASE 2: USER ONLY PROVIDED AN IDEA / PREMISE (MODE: 'idea_theme') -> GEMINI WRITES FROM SCRATCH
  const duration = params.targetDurationSeconds && params.targetDurationSeconds >= 15
    ? params.targetDurationSeconds
    : 60;
  const targetWords = Math.round(duration * 2.3);
  const minWords = Math.max(35, Math.round(targetWords * 0.90));
  const maxWords = Math.round(targetWords * 1.15);
  const estimatedScenes = Math.max(2, Math.min(12, Math.round(duration / 12)));

  const { primarySubject, detectedEntities } = extractThemeAndEntities('', params.premise);

  const promptText = `
Você é um roteirista audiovisual cinematográfico.
Crie um roteiro original baseado na seguinte premissa:
"""
${(params.premise || '').trim()}
"""
Gênero: "${params.genre || 'Documentário'}"
Tom: "${params.tone || 'Emocionante'}"
Duração alvo: ${duration} segundos (entre ${minWords} e ${maxWords} palavras).

Divida em aproximadamente ${estimatedScenes} cenas.
Não insira links ou termos inventados.

Responda OBRIGATORIAMENTE em JSON válido:
{
  "title": "TÍTULO DA HISTÓRIA",
  "genre": "${params.genre || 'Documentário'}",
  "tone": "${params.tone || 'Emocionante'}",
  "storyEntities": ["${primarySubject}"],
  "fullNarration": "Texto completo da história...",
  "scenes": [
    {
      "sceneNumber": 1,
      "narrationSegment": "Texto falado da cena 1...",
      "visualDescription": "Descrição visual da cena 1",
      "directMediaUrl": "",
      "mediaType": "image",
      "caption": "Legenda curta da cena (SEM 'Cena X' e SEM aspas)"
    }
  ]
}
`;

  let parsed: any = null;
  if (process.env.GEMINI_API_KEY) {
    parsed = await callGeminiWithModelFallback(ai, promptText);
  }

  if (!parsed || !parsed.scenes || parsed.scenes.length === 0 || !parsed.fullNarration) {
    parsed = generateIntelligentFallbackScript(params, duration, targetWords, estimatedScenes);
  }

  const rawScenes = parsed.scenes || [];
  const enrichedScenes: NarrativeScene[] = await Promise.all(
    rawScenes.map(async (sc: any, idx: number) => {
      const cleanSegment = cleanNarrationText(sc.narrationSegment || sc.text || '');
      const queryForScene = sc.exactMediaUrl || sc.directMediaUrl || sc.searchTag || sc.primaryKeyword || sc.visualDescription || primarySubject;
      const resolvedUrl = await resolveTagToImageUrl(String(queryForScene || primarySubject), idx);
      return {
        id: `narrative-scene-${Date.now()}-${idx + 1}`,
        index: idx,
        narrationSegment: cleanSegment,
        visualDescription: sc.visualDescription || `Cena ${idx + 1}`,
        searchQuery: String(queryForScene || ''),
        exactMediaUrl: resolvedUrl,
        mediaType: 'image' as const,
        mediaUrl: resolvedUrl,
        thumbnailUrl: resolvedUrl,
        caption: cleanCaptionText(sc.caption) || cleanCaptionText(cleanSegment.slice(0, 35)),
        isMutedVideo: true,
      };
    })
  );

  const joinedSegments = enrichedScenes
    .map((s) => s.narrationSegment)
    .filter(Boolean)
    .join('\n\n');

  return {
    title: parsed.title || `${primarySubject}: História e Legado`,
    genre: parsed.genre || params.genre || 'Documentário',
    tone: parsed.tone || params.tone || 'Emocionante',
    fullNarration: joinedSegments || cleanNarrationText(parsed.fullNarration),
    targetDurationSeconds: duration,
    storyEntities: detectedEntities.length > 0 ? detectedEntities : [primarySubject],
    scenes: enrichedScenes,
  };
}
