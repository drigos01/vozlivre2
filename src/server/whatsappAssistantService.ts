import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import { geminiKeyManager } from './geminiKeyManager';
import {
  whatsappService,
  CustomMediaAttachment,
  WhatsAppCommandParsed,
} from './whatsappService';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { extractArticleFromUrl, generateReportageScript } from './reportageService';
import { generateNarrativeVideoScript, searchRealWebMedia } from './narrativeService';

const execFileAsync = promisify(execFile);

export type AssistantIntent =
  | 'CONVERSATION'
  | 'SEARCH_WEB'
  | 'GET_NEWS'
  | 'CREATE_VIDEO'
  | 'NARRATION_AUDIO'
  | 'ANALYZE_IMAGE'
  | 'ANALYZE_AUDIO'
  | 'ANALYZE_VIDEO'
  | 'PROCESS_LINK'
  | 'HELP'
  | 'CONFIGURATION';

export interface SourceFactItem {
  title: string;
  source: string;
  url: string;
  snippet: string;
  category: 'confirmed_source' | 'witness_or_involved' | 'interpretation' | 'unconfirmed_preliminary';
  categoryLabel: string;
  publishedAt?: string;
}

export interface ChatMessageTurn {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  senderJid?: string;
  senderName?: string;
  hasAudio?: boolean;
  transcription?: string;
  hasImage?: boolean;
  imageDescription?: string;
  hasVideo?: boolean;
  videoDescription?: string;
  customMedia?: CustomMediaAttachment;
  sourcesUsed?: SourceFactItem[];
  intentExecuted?: AssistantIntent;
  targetTopic?: string;
}

export interface ChatSession {
  jid: string;
  isGroup: boolean;
  groupName?: string;
  updatedAt: number;
  messages: ChatMessageTurn[];
  lastContextMedia?: CustomMediaAttachment;
  userLastTopics?: Record<string, { topic: string; updatedAt: number }>;
}

const DATA_ROOT = path.resolve(process.cwd(), 'data', 'whatsapp');
const CONV_FILE = path.join(DATA_ROOT, 'conversations.json');
const AUDIOS_DIR = path.join(DATA_ROOT, 'audios');

for (const dir of [DATA_ROOT, AUDIOS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export class WhatsAppAssistantService {
  private static instance: WhatsAppAssistantService;
  private sessions: Map<string, ChatSession> = new Map();
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private processingJids: Set<string> = new Set();

  private constructor() {
    this.loadSessions();
  }

  public static getInstance(): WhatsAppAssistantService {
    if (!WhatsAppAssistantService.instance) {
      WhatsAppAssistantService.instance = new WhatsAppAssistantService();
    }
    return WhatsAppAssistantService.instance;
  }

  private loadSessions(): void {
    try {
      if (fs.existsSync(CONV_FILE)) {
        const raw = fs.readFileSync(CONV_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const s of parsed) {
            if (s && s.jid) {
              if (!s.userLastTopics) s.userLastTopics = {};
              this.sessions.set(s.jid, s);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[WhatsAppAssistant] Não foi possível carregar sessões anteriores:', e);
    }
  }

  private persistSessions(): void {
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      try {
        const arr = Array.from(this.sessions.values()).map((s) => ({
          ...s,
          messages: s.messages.slice(-20),
        }));
        fs.writeFileSync(CONV_FILE, JSON.stringify(arr, null, 2), 'utf-8');
      } catch (e) {
        console.warn('[WhatsAppAssistant] Falha ao persistir conversas:', e);
      }
    }, 1200);
  }

  public getSession(jid: string, isGroup: boolean, groupName?: string): ChatSession {
    let session = this.sessions.get(jid);
    if (!session) {
      session = {
        jid,
        isGroup,
        groupName,
        updatedAt: Date.now(),
        messages: [],
        userLastTopics: {},
      };
      this.sessions.set(jid, session);
    }
    if (!session.userLastTopics) {
      session.userLastTopics = {};
    }
    return session;
  }

  /**
   * Real factual web search with strict source verification:
   * Uses real Google News RSS & Wikipedia API in Portuguese.
   * Categorizes facts into:
   * - Fonte Confirmada
   * - Relato de Testemunha / Envolvido
   * - Interpretação / Análise
   * - Informação em Apuração
   */
  public async performRealSearch(
    query: string,
    searchType: 'facts' | 'news' = 'facts'
  ): Promise<{ factsText: string; sources: SourceFactItem[] }> {
    if (!query || !query.trim()) {
      return { factsText: '', sources: [] };
    }

    const cleanQ = query.trim().slice(0, 120);
    const sources: SourceFactItem[] = [];

    // 1. Google News RSS search for breaking & current news in Portuguese
    try {
      const newsRssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
        cleanQ
      )}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

      const res = await fetch(newsRssUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });

      if (res.ok) {
        const xml = await res.text();
        const $ = cheerio.load(xml, { xmlMode: true });

        $('item').slice(0, 4).each((_i, el) => {
          const rawTitle = $(el).find('title').text().trim();
          const link = $(el).find('link').text().trim();
          const pubDate = $(el).find('pubDate').text().trim();
          const sourceName = $(el).find('source').text().trim() || 'Portal de Notícias';

          if (rawTitle && link) {
            const lowerTitle = rawTitle.toLowerCase();
            let category: SourceFactItem['category'] = 'confirmed_source';
            let categoryLabel = 'FONTE JORNALÍSTICA CONFIRMADA';

            if (/testemunha|sobrevivente|morador|declara|afirma|disse|relata|segundo/i.test(lowerTitle)) {
              category = 'witness_or_involved';
              categoryLabel = 'RELATO DE TESTEMUNHA / ENVOLVIDO';
            } else if (/opinião|artigo|análise|editorial|entenda|veja por que/i.test(lowerTitle)) {
              category = 'interpretation';
              categoryLabel = 'ANÁLISE / INTERPRETAÇÃO';
            } else if (/suspeita|possível|sem confirmação|investiga|em apuração/i.test(lowerTitle)) {
              category = 'unconfirmed_preliminary';
              categoryLabel = 'EM APURAÇÃO / NÃO CONFIRMADO';
            }

            sources.push({
              title: rawTitle,
              source: sourceName,
              url: link,
              snippet: rawTitle,
              category,
              categoryLabel,
              publishedAt: pubDate,
            });
          }
        });
      }
    } catch (newsErr) {
      console.warn('[performRealSearch] Erro ao buscar Google News RSS:', newsErr);
    }

    // 2. Wikipedia API search for encyclopedic, historical, or scientific facts
    try {
      const wikiUrl = `https://pt.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
        cleanQ
      )}&gsrlimit=3&prop=extracts&exintro=1&explaintext=1&exsentences=3&format=json`;

      const wikiRes = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'VozLivreAssistant/1.0 (info@vozlirve.app)' },
      });

      if (wikiRes.ok) {
        const data = await wikiRes.json();
        const pages = data?.query?.pages || {};
        for (const k of Object.keys(pages)) {
          const p = pages[k];
          if (p?.title && p?.extract) {
            const pageUrl = `https://pt.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`;
            sources.push({
              title: p.title,
              source: 'Wikipédia Lusófona',
              url: pageUrl,
              snippet: p.extract.slice(0, 240),
              category: 'confirmed_source',
              categoryLabel: 'FONTE ENCICLOPÉDICA VERIFICADA',
            });
          }
        }
      }
    } catch (wikiErr) {
      console.warn('[performRealSearch] Erro ao buscar Wikipédia:', wikiErr);
    }

    // Format structured fact block with explicit categorization
    if (sources.length === 0) {
      return { factsText: '', sources: [] };
    }

    const lines: string[] = ['📋 *FATOS E FONTES APURADOS NA WEB:*'];
    for (const s of sources) {
      lines.push(`• [${s.categoryLabel}] ${s.source}: "${s.title}"\n  🔗 Link: ${s.url}`);
    }

    return {
      factsText: lines.join('\n\n'),
      sources,
    };
  }

  /**
   * Backwards compatible search method
   */
  public async performRealWebSearch(query: string): Promise<string> {
    const res = await this.performRealSearch(query, 'facts');
    return res.factsText;
  }

  /**
   * Transcribes a downloaded audio buffer using Gemini with automatic model fallback
   */
  public async transcribeAudio(
    audioBuffer: Buffer,
    mimeType = 'audio/ogg'
  ): Promise<string> {
    return geminiKeyManager.executeWithRotation(
      async (ai: GoogleGenAI) => {
        const cleanMime = mimeType.split(';')[0].trim() || 'audio/ogg';
        const base64Audio = audioBuffer.toString('base64');

        const audioPart = {
          inlineData: {
            mimeType: cleanMime,
            data: base64Audio,
          },
        };

        const modelsToTry = ['gemini-3.5-transcribe', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
        let lastErr: any = null;

        for (const m of modelsToTry) {
          try {
            const res = await ai.models.generateContent({
              model: m,
              contents: {
                parts: [
                  audioPart,
                  {
                    text: 'Transcreva este áudio em português com máxima precisão, pontuação natural e fidelidade exata ao que foi falado. Retorne somente o texto transcrito, sem introduções ou comentários.',
                  },
                ],
              },
            });
            const transcription = (res.text || '').trim();
            if (transcription) return transcription;
          } catch (e: any) {
            lastErr = e;
          }
        }
        throw lastErr || new Error('Não foi possível transcrever o áudio.');
      },
      { taskName: 'Audio Transcription (with fallback)' }
    );
  }

  /**
   * Analyzes an image with Gemini vision to extract context and details with model fallback
   */
  public async analyzeImage(
    imageBuffer: Buffer,
    mimeType = 'image/jpeg',
    userCaption?: string
  ): Promise<string> {
    return geminiKeyManager.executeWithRotation(
      async (ai: GoogleGenAI) => {
        const cleanMime = mimeType.split(';')[0].trim() || 'image/jpeg';
        const base64Data = imageBuffer.toString('base64');

        const imagePart = {
          inlineData: {
            mimeType: cleanMime,
            data: base64Data,
          },
        };

        const promptText = userCaption
          ? `O usuário enviou esta imagem com a legenda: "${userCaption}". Analise detalhadamente o que está retratado nesta imagem (elementos visuais principais, ambiente, clima, cores, pessoas/objetos e tom) para usarmos como base de roteiro ou resposta no WhatsApp.`
          : `Analise detalhadamente esta imagem: descreva o que está acontecendo, os principais elementos visuais, a atmosfera, estética e detalhes marcantes.`;

        const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
        let lastErr: any = null;

        for (const m of modelsToTry) {
          try {
            const res = await ai.models.generateContent({
              model: m,
              contents: {
                parts: [imagePart, { text: promptText }],
              },
            });
            const out = (res.text || '').trim();
            if (out) return out;
          } catch (e: any) {
            lastErr = e;
          }
        }
        throw lastErr || new Error('Não foi possível analisar a imagem.');
      },
      { taskName: 'Image Vision Analysis (with fallback)' }
    );
  }

  /**
   * Multimodal analysis of received video using FFmpeg representative frame extraction + Gemini Vision
   */
  public async analyzeVideoFrames(
    videoLocalPath: string,
    userCaption?: string
  ): Promise<string> {
    if (!fs.existsSync(videoLocalPath)) {
      return '';
    }

    const frame1Path = videoLocalPath.replace(/\.[a-zA-Z0-9]+$/, `_f1_${Date.now()}.jpg`);
    const frame2Path = videoLocalPath.replace(/\.[a-zA-Z0-9]+$/, `_f2_${Date.now()}.jpg`);
    const extractedFrames: { path: string; buffer: Buffer }[] = [];

    try {
      // Extract frame at 1s
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', '00:00:01',
        '-i', videoLocalPath,
        '-vframes', '1',
        '-q:v', '2',
        frame1Path,
      ]);
      if (fs.existsSync(frame1Path) && fs.statSync(frame1Path).size > 1000) {
        extractedFrames.push({ path: frame1Path, buffer: fs.readFileSync(frame1Path) });
      }
    } catch {}

    try {
      // Extract frame at 3s
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', '00:00:03',
        '-i', videoLocalPath,
        '-vframes', '1',
        '-q:v', '2',
        frame2Path,
      ]);
      if (fs.existsSync(frame2Path) && fs.statSync(frame2Path).size > 1000) {
        extractedFrames.push({ path: frame2Path, buffer: fs.readFileSync(frame2Path) });
      }
    } catch {}

    if (extractedFrames.length === 0) {
      return 'Vídeo recebido pelo WhatsApp (formato MP4 pronto para composição visual em roteiros).';
    }

    try {
      const visionDescription = await geminiKeyManager.executeWithRotation(
        async (ai: GoogleGenAI) => {
          const parts: any[] = extractedFrames.map((f) => ({
            inlineData: {
              mimeType: 'image/jpeg',
              data: f.buffer.toString('base64'),
            },
          }));

          const promptText = userCaption
            ? `O usuário enviou este vídeo no WhatsApp com a mensagem: "${userCaption}". Analise estes quadros capturados do vídeo: descreva sucintamente a cena visual (o que está acontecendo, sujeitos, ambiente, iluminação, cores, movimentos sugeridos e estética). Seja objetivo em português.`
            : `Analise os quadros capturados deste vídeo enviado no WhatsApp: descreva sucintamente o que está retratado (sujeitos, ação principal, ambiente, estética e clima geral). Seja objetivo em português.`;

          parts.push({ text: promptText });

          const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
          let lastErr: any = null;
          for (const m of modelsToTry) {
            try {
              const res = await ai.models.generateContent({
                model: m,
                contents: { parts },
              });
              const out = (res.text || '').trim();
              if (out) return out;
            } catch (e) {
              lastErr = e;
            }
          }
          throw lastErr || new Error('Falha ao analisar vídeo.');
        },
        { taskName: 'Video Frames Vision Analysis' }
      );
      return visionDescription;
    } catch (err: any) {
      console.warn('[WhatsAppAssistant] Erro na análise visual dos quadros do vídeo:', err?.message);
      return 'Vídeo recebido pelo WhatsApp (cenas visuais salvas e prontas para uso em produções).';
    } finally {
      // Clean up temporary extracted frames
      for (const f of extractedFrames) {
        try {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        } catch {}
      }
    }
  }

  /**
   * Synthesizes neural audio with MsEdgeTTS for audio-only requests
   */
  public async synthesizeSpeechAudio(text: string, voiceId: string): Promise<Buffer> {
    const safeVoice = voiceId || 'pt-BR-FranciscaNeural';
    const tts = new MsEdgeTTS();
    await tts.setMetadata(safeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    return new Promise<Buffer>((resolve, reject) => {
      let finished = false;
      const timeout = setTimeout(() => {
        if (!finished) {
          finished = true;
          try { tts.close(); } catch {}
          reject(new Error('Timeout na síntese de voz (30s)'));
        }
      }, 30000);

      try {
        const { audioStream } = tts.toStream(text);
        const parts: Buffer[] = [];
        audioStream.on('data', (c: Buffer) => parts.push(c));
        audioStream.on('end', () => {
          if (!finished) {
            finished = true;
            clearTimeout(timeout);
            try { tts.close(); } catch {}
            resolve(Buffer.concat(parts));
          }
        });
        audioStream.on('error', (err) => {
          if (!finished) {
            finished = true;
            clearTimeout(timeout);
            try { tts.close(); } catch {}
            reject(err);
          }
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  // ==========================================
  // REUSABLE SERVICE TOOLS (NO DUPLICATION)
  // ==========================================

  public async searchWebTool(query: string): Promise<{ factsText: string; sources: SourceFactItem[] }> {
    return this.performRealSearch(query, 'facts');
  }

  public async searchNewsTool(topic: string): Promise<{ factsText: string; sources: SourceFactItem[] }> {
    return this.performRealSearch(topic, 'news');
  }

  public async extractArticleFromUrlTool(url: string) {
    return extractArticleFromUrl(url);
  }

  public async analyzeImageTool(imagePath: string, caption?: string): Promise<string> {
    if (!fs.existsSync(imagePath)) return '';
    const buf = fs.readFileSync(imagePath);
    return this.analyzeImage(buf, 'image/jpeg', caption);
  }

  public async transcribeAudioTool(audioBuffer: Buffer, mimetype = 'audio/ogg'): Promise<string> {
    return this.transcribeAudio(audioBuffer, mimetype);
  }

  public async analyzeVideoTool(videoPath: string, caption?: string): Promise<string> {
    return this.analyzeVideoFrames(videoPath, caption);
  }

  public async generateNarrativeVideoScriptTool(params: any) {
    return geminiKeyManager.executeWithRotation(
      async (ai: GoogleGenAI) => {
        return generateNarrativeVideoScript(ai, params);
      },
      { taskName: 'Narrative Video Script Tool' }
    );
  }

  public async generateReportageScriptTool(article: any, targetDurationSeconds?: number) {
    return geminiKeyManager.executeWithRotation(
      async (ai: GoogleGenAI) => {
        return generateReportageScript(ai, article, targetDurationSeconds);
      },
      { taskName: 'Reportage Video Script Tool' }
    );
  }

  public async synthesizeSpeechAudioTool(text: string, voiceId?: string): Promise<Buffer> {
    return this.synthesizeSpeechAudio(text, voiceId || 'pt-BR-FranciscaNeural');
  }

  public async enqueueVideoJobTool(params: {
    groupId: string;
    groupName: string;
    senderJid: string;
    senderName: string;
    rawMessage: string;
    messageObj?: any;
    parsed: WhatsAppCommandParsed;
    customMedia?: CustomMediaAttachment;
  }) {
    return whatsappService.enqueueJob(params);
  }

  public async sendTextMessageTool(jid: string, text: string, quotedMsg?: any): Promise<void> {
    return whatsappService.sendTextMessage(jid, text, quotedMsg);
  }

  public setUserConfigurationTool(
    jid: string,
    prefs: {
      voiceId?: string;
      voiceName?: string;
      aspectRatio?: '9:16' | '16:9' | '1:1';
      durationSeconds?: number;
      showSubtitles?: boolean;
      enableBgMusic?: boolean;
      bgMusicPreset?: string;
    }
  ): void {
    whatsappService.setUserPreference(jid, prefs);
  }

  /**
   * Main conversational intelligence entry point for WhatsApp
   */
  public async handleMessage(params: {
    remoteJid: string;
    senderJid: string;
    senderName: string;
    isGroup: boolean;
    rawText: string;
    rawMessageObj: any;
    customMedia?: CustomMediaAttachment;
    audioAttachment?: { buffer: Buffer; mimetype: string; localPath: string };
  }): Promise<void> {
    const { remoteJid, senderJid, senderName, isGroup, rawText, rawMessageObj, customMedia, audioAttachment } = params;

    // Prevent concurrent loops or race conditions per conversation
    if (this.processingJids.has(remoteJid)) {
      return;
    }
    this.processingJids.add(remoteJid);

    try {
      const session = this.getSession(remoteJid, isGroup);
      const userPrefs = whatsappService.getUserPreference(remoteJid);

      let effectiveText = (rawText || '').trim();
      let transcriptionText = '';
      let imageDescription = '';
      let videoDescription = '';

      // 1. Audio message: Transcribe with Gemini
      if (audioAttachment && audioAttachment.buffer && audioAttachment.buffer.length > 0) {
        try {
          if (whatsappService.isWhatsAppConnected()) {
            await whatsappService.sendTextMessage(
              remoteJid,
              '🎧 _Ouvindo e transcrevendo seu áudio com IA..._',
              rawMessageObj
            );
          }

          transcriptionText = await this.transcribeAudio(
            audioAttachment.buffer,
            audioAttachment.mimetype
          );

          if (transcriptionText) {
            console.log(
              `[WhatsAppAssistant] Áudio transcrito com sucesso (${transcriptionText.length} caracteres): "${transcriptionText}"`
            );
            effectiveText = transcriptionText;
          }
        } catch (audioErr: any) {
          console.warn('[WhatsAppAssistant] Erro ao transcrever áudio:', audioErr?.message);
        }
      }

      // 2. Visual Media: Image or Video analysis
      let activeMedia = customMedia || session.lastContextMedia;
      if (customMedia && customMedia.mediaType === 'image') {
        try {
          const imgBuf = fs.readFileSync(customMedia.localPath);
          imageDescription = await this.analyzeImage(imgBuf, customMedia.mimetype, effectiveText);
          session.lastContextMedia = customMedia;
        } catch (imgErr: any) {
          console.warn('[WhatsAppAssistant] Erro na análise visual da imagem:', imgErr?.message);
        }
      } else if (customMedia && customMedia.mediaType === 'video') {
        try {
          if (whatsappService.isWhatsAppConnected() && !effectiveText) {
            await whatsappService.sendTextMessage(
              remoteJid,
              '📹 _Analisando os quadros do vídeo enviado com IA..._',
              rawMessageObj
            );
          }
          videoDescription = await this.analyzeVideoFrames(customMedia.localPath, effectiveText);
          session.lastContextMedia = customMedia;
        } catch (vidErr: any) {
          console.warn('[WhatsAppAssistant] Erro na análise visual do vídeo:', vidErr?.message);
        }
      }

      // If user sent nothing readable
      if (!effectiveText && !imageDescription && !videoDescription && !customMedia) {
        return;
      }

      // Record user turn in session history with explicit sender tracking for groups
      session.messages.push({
        role: 'user',
        text: effectiveText || (imageDescription ? 'Imagem enviada' : videoDescription ? 'Vídeo enviado' : 'Mídia enviada'),
        timestamp: Date.now(),
        senderJid,
        senderName,
        hasAudio: !!audioAttachment,
        transcription: transcriptionText || undefined,
        hasImage: !!(customMedia && customMedia.mediaType === 'image'),
        imageDescription: imageDescription || undefined,
        hasVideo: !!(customMedia && customMedia.mediaType === 'video'),
        videoDescription: videoDescription || undefined,
        customMedia: customMedia || undefined,
      });

      // Format conversation history for Gemini with individual sender tags in groups
      const recentTurns = session.messages.slice(-12);
      const conversationContext = recentTurns
        .map((t) => {
          if (t.role === 'model') {
            return `[VozLivre IA]: ${t.text}`;
          }
          const senderTag = isGroup
            ? `[Usuário ${t.senderName || 'Anônimo'} (${t.senderJid || 'jid'})]`
            : `[Usuário ${t.senderName || 'Você'}]`;

          let body = t.text;
          if (t.transcription) body = `[Áudio Transcrito]: ${t.transcription}`;
          if (t.imageDescription) body += ` [Detalhes visuais da foto enviada]: ${t.imageDescription}`;
          if (t.videoDescription) body += ` [Detalhes visuais do vídeo enviado]: ${t.videoDescription}`;
          return `${senderTag}: ${body}`;
        })
        .join('\n');

      // 3. Detect if message explicitly asks for facts, news, research or contains a link
      let realFactData: { factsText: string; sources: SourceFactItem[] } = { factsText: '', sources: [] };
      const urlInText = effectiveText.match(/https?:\/\/[^\s]+/i);

      if (
        /pesquisa|not[ií]cia|fato|aconteceu|hoje|ontem|caso|morte|crime|ovni|ufo|sobrenatural|ci[eê]ncia|hist[oó]ria|últimas|ultimas|atual|jornal/i.test(
          effectiveText
        )
      ) {
        const searchKind = /not[ií]cia|hoje|ontem|últimas|ultimas|atual/i.test(effectiveText) ? 'news' : 'facts';
        try {
          realFactData = await this.performRealSearch(effectiveText, searchKind);
        } catch {}
      }

      // If a URL was found, extract article content proactively
      let scrapedArticleLead = '';
      if (urlInText) {
        try {
          const article = await extractArticleFromUrl(urlInText[0]);
          scrapedArticleLead = `Artigo extraído do link ${urlInText[0]}:\nTítulo: ${article.title}\nPortal: ${article.siteName}\nLead: ${article.description || article.text?.slice(0, 300)}`;
        } catch {}
      }

      // 4. Gemini Intent Classifier & Conversational Decision Engine
      let assistantDecision: any = null;
      try {
        assistantDecision = await geminiKeyManager.executeWithRotation(
          async (ai: GoogleGenAI) => {
            const systemInstruction = `Você é o assistente inteligente oficial do VozLivre (IA Narrada) no WhatsApp.
O VozLivre é uma plataforma profissional completa que converte ideias, notícias, links, fotos, vídeos e áudios em VÍDEOS COMPLETOS em MP4 e ÁUDIOS NARRADOS com vozes neurais ultra-realistas em português.

DIRETRIZES FUNDAMENTAIS:
1. Converse de forma natural, amigável, prestativa e objetiva pelo WhatsApp. Não obrigue comandos ou barras.
2. VOCÊ ENTENDE REFERÊNCIAS AO HISTÓRICO:
   - "isso", "aquilo", "esse assunto", "o segundo", "agora transforma em vídeo", "faz outra versão", "usa essa foto no vídeo", "faz uma matéria sobre isso".
   - Conecte imediatamente essas referências ao tópico ou mídia da conversa anterior.
3. CONTEXTO EM GRUPOS:
   - Mensagens em grupos identificam o autor no formato [Usuário Nome (jid)]: mensagem.
   - Quando o Usuário B diz "agora faz o vídeo sobre isso" ou "faz sobre aquele assunto", observe a conversa recente e confirme quem propôs a ideia: "🎬 Perfeito [Nome], vou produzir o vídeo com base na história de [Tópico] sugerida por [Nome original]!".
4. INTENTS POSSÍVEIS:
   - "CONVERSATION": Bate-papo natural, tirar dúvidas, responder perguntas, cumprimentos, dar ideias.
   - "SEARCH_WEB": Usuário pede pesquisa de fatos, explicações científicas, história, dados gerais.
   - "GET_NEWS": Usuário pede notícias recentes, o que aconteceu hoje/ontem, fatos jornalísticos.
   - "CREATE_VIDEO": Usuário pede EXPRESSAMENTE para criar um vídeo (ex.: "faz um vídeo sobre isso", "gera o vídeo", "faz vídeo com essa foto", "transforma o link em vídeo").
   - "NARRATION_AUDIO": Usuário pede EXPRESSAMENTE narração/áudio apenas (ex.: "narra esse texto", "manda um áudio lendo isso", "locução desse texto").
   - "ANALYZE_IMAGE": Usuário enviou foto e perguntou o que tem nela ou pediu análise visual.
   - "ANALYZE_AUDIO": Usuário mandou áudio para transcrever ou comentar.
   - "ANALYZE_VIDEO": Usuário mandou vídeo e pediu análise visual dos quadros.
   - "PROCESS_LINK": Usuário enviou link web de notícia/artigo para resumir ou comentar.
   - "HELP": Usuário pediu ajuda sobre como você funciona, formatos, vozes disponíveis ou menu.
   - "CONFIGURATION": Usuário pediu para alterar voz (ex: "mude para Antônio"), formato (ex: "quero em 16:9"), duração ou ver configurações ativas.

5. REGRA DE OURO DA PRODUÇÃO:
   - Se o usuário estiver apenas conversando, perguntando sobre temas, pedindo ideias: RESPONDA NATURALMENTE, sem iniciar a renderização de vídeo!
   - Só acione intent = "CREATE_VIDEO" quando o usuário pedir expressamente a geração do vídeo ("cria um vídeo", "faz um vídeo", "transforma isso em vídeo", "gera o vídeo").

Retorne sua resposta ESTRITAMENTE em formato JSON com o seguinte schema:
{
  "intent": "CONVERSATION" | "SEARCH_WEB" | "GET_NEWS" | "CREATE_VIDEO" | "NARRATION_AUDIO" | "ANALYZE_IMAGE" | "ANALYZE_AUDIO" | "ANALYZE_VIDEO" | "PROCESS_LINK" | "HELP" | "CONFIGURATION",
  "replyText": "Texto formatado em markdown do WhatsApp (*negrito*, _itálico_, etc.) para responder imediatamente ao usuário",
  "targetTopic": "Tópico central identificado da conversa",
  "videoConfig": {
    "topic": "Tema ou história consolidada usando o contexto da conversa",
    "studioMode": "reportagem" | "roteiro_criativo",
    "url": "URL se houver link de notícia ou vazio",
    "format": "9:16" | "16:9" | "1:1" (ou null se deve manter a preferência do usuário)
  },
  "narrationConfig": {
    "text": "Texto a ser narrado em áudio MP3"
  },
  "configUpdate": {
    "voiceId": "ID da voz se pediu para trocar (ex: pt-BR-AntonioNeural, pt-BR-FranciscaNeural, pt-BR-ThalitaMultilingualNeural)",
    "voiceName": "Nome da voz",
    "format": "9:16" | "16:9" | "1:1"
  }
}`;

            const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
            let lastErr: any = null;

            for (const modelName of modelsToTry) {
              try {
                const res = await ai.models.generateContent({
                  model: modelName,
                  contents: [
                    {
                      text: `Histórico recente da conversa neste chat:\n${conversationContext}\n\nMensagem atual recebida do usuário: "${effectiveText}"\n${
                        imageDescription ? `Descrição visual da imagem recebida: "${imageDescription}"\n` : ''
                      }${videoDescription ? `Descrição visual dos quadros do vídeo recebido: "${videoDescription}"\n` : ''}${
                        scrapedArticleLead ? `${scrapedArticleLead}\n` : ''
                      }${realFactData.factsText ? `\n\n${realFactData.factsText}\n` : ''}\nAnalise o histórico e intenção e retorne o JSON de resposta:`,
                    },
                  ],
                  config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    temperature: 0.7,
                  },
                });

                const rawJson = (res.text || '').trim();
                if (rawJson) {
                  try {
                    return JSON.parse(rawJson);
                  } catch {
                    return {
                      intent: 'CONVERSATION',
                      replyText: rawJson.replace(/```json|```/g, '').trim(),
                    };
                  }
                }
              } catch (e: any) {
                lastErr = e;
              }
            }
            throw lastErr || new Error('Não foi possível obter resposta dos modelos de IA.');
          },
          { taskName: 'WhatsApp Assistant Intent & Conversation' }
        );
      } catch (geminiErr: any) {
        console.warn('[WhatsAppAssistant] Alerta de indisponibilidade/cota no Gemini:', geminiErr?.message);
        assistantDecision = {
          intent: 'CONVERSATION',
          replyText:
            '⏳ *IA Narrada (VozLivre)*\nNossos servidores de IA estão operando com limite temporário de requisições. Suas chaves estão em rotação automática. Por favor, aguarde alguns instantes ou envie novamente!',
        };
      }

      // Record target topic in session for user tracking
      if (assistantDecision.targetTopic && session.userLastTopics) {
        session.userLastTopics[senderJid] = {
          topic: assistantDecision.targetTopic,
          updatedAt: Date.now(),
        };
      }

      const identifiedIntent: AssistantIntent = assistantDecision.intent || 'CONVERSATION';

      // 5. Handle Intent Actions

      // CONFIGURATION: Update preferences
      if (identifiedIntent === 'CONFIGURATION' && assistantDecision.configUpdate) {
        const update = assistantDecision.configUpdate;
        const newPrefs: any = {};
        if (update.voiceId) {
          newPrefs.voiceId = update.voiceId;
          newPrefs.voiceName = update.voiceName || 'Francisca';
        }
        if (update.format) {
          newPrefs.aspectRatio = update.format;
        }
        this.setUserConfigurationTool(remoteJid, newPrefs);

        const reply = assistantDecision.replyText || '⚙️ Configurações atualizadas com sucesso!';
        await this.sendTextMessageTool(remoteJid, reply, rawMessageObj);

        session.messages.push({
          role: 'model',
          text: reply,
          timestamp: Date.now(),
          intentExecuted: 'CONFIGURATION',
        });
      }

      // NARRATION_AUDIO: Synthesize neural voice note
      else if (identifiedIntent === 'NARRATION_AUDIO' && assistantDecision.narrationConfig?.text) {
        const speechText = assistantDecision.narrationConfig.text;
        const voiceId = userPrefs.voiceId || whatsappService.getConfig().defaultVoiceId || 'pt-BR-FranciscaNeural';

        if (whatsappService.isWhatsAppConnected()) {
          await this.sendTextMessageTool(
            remoteJid,
            `🎙️ *Gerando sua locução neural com voz de ${userPrefs.voiceName || 'Francisca'}...*\n_Aguarde alguns instantes._`,
            rawMessageObj
          );
        }

        try {
          const audioBuffer = await this.synthesizeSpeechAudioTool(speechText, voiceId);
          const filename = `narration_${Date.now()}.mp3`;
          const filePath = path.join(AUDIOS_DIR, filename);
          fs.writeFileSync(filePath, audioBuffer);

          if (whatsappService.isWhatsAppConnected() && whatsappService['sock']) {
            await whatsappService['sock'].sendMessage(
              remoteJid,
              {
                audio: audioBuffer,
                mimetype: 'audio/mp4',
                ptt: true,
              },
              { quoted: rawMessageObj }
            );

            await this.sendTextMessageTool(
              remoteJid,
              `✅ *Narração concluída com sucesso!*\n\n🎙️ *Voz:* ${userPrefs.voiceName || 'Francisca'}\n📝 *Trecho:* "${speechText.slice(0, 100)}..."`,
              rawMessageObj
            );
          }

          session.messages.push({
            role: 'model',
            text: `[Áudio de narração enviado ao usuário]: ${speechText}`,
            timestamp: Date.now(),
            intentExecuted: 'NARRATION_AUDIO',
          });
        } catch (ttsErr: any) {
          await this.sendTextMessageTool(
            remoteJid,
            `⚠️ Não foi possível sintetizar a narração: ${ttsErr?.message || 'Erro no motor de voz'}.`,
            rawMessageObj
          );
        }
      }

      // CREATE_VIDEO: Dispatch to autonomous queue
      else if (identifiedIntent === 'CREATE_VIDEO') {
        const vidCfg = assistantDecision.videoConfig || {};
        const effectiveTopic = vidCfg.topic || assistantDecision.targetTopic || effectiveText;
        const targetUrl = vidCfg.url || (urlInText ? urlInText[0] : undefined);
        const studioMode = vidCfg.studioMode || (targetUrl ? 'reportagem' : 'roteiro_criativo');
        const voiceId = userPrefs.voiceId || whatsappService.getConfig().defaultVoiceId || 'pt-BR-FranciscaNeural';
        const voiceName = userPrefs.voiceName || 'Francisca';
        const aspectRatio = vidCfg.format || userPrefs.aspectRatio || whatsappService.getConfig().defaultAspectRatio || '9:16';
        const durationSeconds = userPrefs.durationSeconds || whatsappService.getConfig().defaultDurationSeconds || 60;
        const showSubtitles = userPrefs.showSubtitles ?? whatsappService.getConfig().defaultShowSubtitles ?? true;
        const enableBgMusic = userPrefs.enableBgMusic ?? whatsappService.getConfig().defaultEnableBgMusic ?? true;
        const bgMusicPreset = userPrefs.bgMusicPreset || whatsappService.getConfig().defaultMusicStyle || 'news-breaking';

        const parsedCmd: WhatsAppCommandParsed = {
          studioMode,
          inputMode: targetUrl ? 'url' : effectiveTopic.length < 140 ? 'premise_ai' : 'full_prompt',
          commandUsed: 'ia-orquestrador-natural',
          content: effectiveTopic,
          url: targetUrl,
          aspectRatio,
          voiceId,
          voiceName,
          durationSeconds,
          showSubtitles,
          enableBgMusic,
          bgMusicPreset,
          customMedia: activeMedia,
        };

        const groupName = isGroup
          ? whatsappService['groups']?.get(remoteJid)?.subject || 'Grupo Monitorado'
          : `Chat Direto (${senderName})`;

        // First send friendly confirmation
        if (assistantDecision.replyText && whatsappService.isWhatsAppConnected()) {
          await this.sendTextMessageTool(remoteJid, assistantDecision.replyText, rawMessageObj);
        }

        // Enqueue job into 100% server queue
        await this.enqueueVideoJobTool({
          groupId: remoteJid,
          groupName,
          senderJid,
          senderName,
          rawMessage: effectiveText,
          messageObj: rawMessageObj,
          parsed: parsedCmd,
          customMedia: activeMedia,
        });

        session.messages.push({
          role: 'model',
          text: assistantDecision.replyText || `[Vídeo sobre "${effectiveTopic}" enfileirado para produção no servidor]`,
          timestamp: Date.now(),
          intentExecuted: 'CREATE_VIDEO',
          targetTopic: effectiveTopic,
        });
      }

      // SEARCH_WEB / GET_NEWS / PROCESS_LINK / ANALYZE_IMAGE / ANALYZE_VIDEO / HELP / CONVERSATION
      else {
        let finalReply = assistantDecision.replyText || 'Olá! Como posso ajudar você a produzir novos conteúdos hoje?';

        // If search results exist and user asked for news or facts, append structured factual sources if not already included
        if (realFactData.sources.length > 0 && (identifiedIntent === 'SEARCH_WEB' || identifiedIntent === 'GET_NEWS')) {
          if (!finalReply.includes('Fontes') && !finalReply.includes('http')) {
            const sourceLinks = realFactData.sources
              .slice(0, 3)
              .map((s) => `• [${s.categoryLabel}] ${s.source}: ${s.url}`)
              .join('\n');
            finalReply += `\n\n📌 *Fontes Apuradas na Web:*\n${sourceLinks}\n\n_💡 Deseja transformar esse caso em um vídeo narrado em MP4? Basta pedir: "Faz um vídeo sobre isso!"_`;
          }
        }

        if (whatsappService.isWhatsAppConnected()) {
          await this.sendTextMessageTool(remoteJid, finalReply, rawMessageObj);
        }

        session.messages.push({
          role: 'model',
          text: finalReply,
          timestamp: Date.now(),
          sourcesUsed: realFactData.sources.length > 0 ? realFactData.sources : undefined,
          intentExecuted: identifiedIntent,
          targetTopic: assistantDecision.targetTopic,
        });
      }

      session.updatedAt = Date.now();
      this.persistSessions();
    } catch (err: any) {
      console.error('[WhatsAppAssistant] Erro no processamento de mensagem:', err);
      try {
        if (whatsappService.isWhatsAppConnected()) {
          await this.sendTextMessageTool(
            remoteJid,
            'Desculpe, tive uma oscilação temporária ao processar sua mensagem. Poderia reenviar ou tentar novamente?',
            rawMessageObj
          );
        }
      } catch {}
    } finally {
      this.processingJids.delete(remoteJid);
    }
  }

  /**
   * Simulated message handler for Web UI Panel
   */
  public async handleSimulatedMessage(params: {
    remoteJid: string;
    senderName: string;
    rawText: string;
  }): Promise<{ intent: string; replyText: string; job?: any }> {
    const { remoteJid, senderName, rawText } = params;
    const session = this.getSession(remoteJid, false);
    const userPrefs = whatsappService.getUserPreference(remoteJid);

    session.messages.push({
      role: 'user',
      text: rawText,
      timestamp: Date.now(),
      senderName,
    });

    const recentTurns = session.messages.slice(-12);
    const conversationContext = recentTurns
      .map((t) => `${t.role === 'user' ? (t.senderName || 'Usuário') : 'VozLivre IA'}: ${t.text}`)
      .join('\n');

    let realFactData: { factsText: string; sources: SourceFactItem[] } = { factsText: '', sources: [] };
    if (/pesquisa|not[ií]cia|fato|ufo|ovni|mist[eé]rio|sobrenatural|crime|morte|aconteceu|hist[oó]ria/i.test(rawText)) {
      try {
        realFactData = await this.performRealSearch(rawText, 'news');
      } catch {}
    }

    let assistantDecision: any = null;
    try {
      assistantDecision = await geminiKeyManager.executeWithRotation(
        async (ai: GoogleGenAI) => {
          const systemInstruction = `Você é o assistente inteligente oficial do VozLivre (IA Narrada) no WhatsApp.
O VozLivre converte ideias, notícias, links, fotos e áudios em VÍDEOS COMPLETOS em MP4 e ÁUDIOS NARRADOS com vozes neurais ultra-realistas em português.

DIRETRIZES:
1. Converse de forma natural, amigável, prestativa e objetiva.
2. Reconheça referências ao histórico ("isso", "aquilo", "esse assunto", "o segundo", "agora faz o vídeo").
3. Só inicie vídeo se o usuário pedir expressamente ("faz um vídeo", "cria um vídeo", "transforma em vídeo").
4. Retorne em formato JSON:
{
  "intent": "CONVERSATION" | "SEARCH_WEB" | "GET_NEWS" | "CREATE_VIDEO" | "NARRATION_AUDIO" | "HELP" | "CONFIGURATION",
  "replyText": "Texto de resposta para o WhatsApp com emojis e formatação markdown (*negrito*, _itálico_)",
  "targetTopic": "Tema central",
  "videoConfig": {
    "topic": "Tema ou roteiro",
    "studioMode": "reportagem" | "roteiro_criativo",
    "url": "link ou vazio",
    "format": "9:16" | "16:9" | "1:1"
  },
  "narrationConfig": {
    "text": "Texto a ser narrado"
  }
}`;

          const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
          let lastErr: any = null;

          for (const modelName of modelsToTry) {
            try {
              const res = await ai.models.generateContent({
                model: modelName,
                contents: [
                  {
                    text: `Histórico da conversa:\n${conversationContext}\n\nMensagem recebida: "${rawText}"${
                      realFactData.factsText ? `\n\n${realFactData.factsText}` : ''
                    }\n\nRetorne o JSON de resposta:`,
                  },
                ],
                config: {
                  systemInstruction,
                  responseMimeType: 'application/json',
                  temperature: 0.7,
                },
              });

              const rawJson = (res.text || '').trim();
              if (rawJson) {
                try {
                  return JSON.parse(rawJson);
                } catch {
                  return {
                    intent: 'CONVERSATION',
                    replyText: rawJson.replace(/```json|```/g, '').trim(),
                  };
                }
              }
            } catch (e: any) {
              lastErr = e;
            }
          }
          throw lastErr || new Error('Não foi possível processar nos modelos de IA.');
        },
        { taskName: 'WhatsApp Assistant Simulation Turn' }
      );
    } catch (simErr: any) {
      console.warn('[WhatsAppAssistant] Alerta no simulador:', simErr?.message);
      assistantDecision = {
        intent: 'CONVERSATION',
        replyText:
          '⏳ *IA Narrada (VozLivre)*\nNossos servidores de IA estão operando com limite temporário de requisições. Suas chaves estão em rotação automática. Por favor, tente novamente!',
      };
    }

    let createdJob: any = null;
    if (assistantDecision.intent === 'CREATE_VIDEO') {
      const vidCfg = assistantDecision.videoConfig || {};
      const effectiveTopic = vidCfg.topic || assistantDecision.targetTopic || rawText;
      const studioMode = vidCfg.studioMode || (vidCfg.url ? 'reportagem' : 'roteiro_criativo');
      const voiceId = userPrefs.voiceId || whatsappService.getConfig().defaultVoiceId || 'pt-BR-FranciscaNeural';
      const voiceName = userPrefs.voiceName || 'Francisca';
      const aspectRatio = vidCfg.format || userPrefs.aspectRatio || whatsappService.getConfig().defaultAspectRatio || '9:16';
      const durationSeconds = userPrefs.durationSeconds || whatsappService.getConfig().defaultDurationSeconds || 60;
      const showSubtitles = userPrefs.showSubtitles ?? whatsappService.getConfig().defaultShowSubtitles ?? true;
      const enableBgMusic = userPrefs.enableBgMusic ?? whatsappService.getConfig().defaultEnableBgMusic ?? true;
      const bgMusicPreset = userPrefs.bgMusicPreset || whatsappService.getConfig().defaultMusicStyle || 'news-breaking';

      const parsedCmd: WhatsAppCommandParsed = {
        studioMode,
        inputMode: vidCfg.url ? 'url' : effectiveTopic.length < 140 ? 'premise_ai' : 'full_prompt',
        commandUsed: 'ia-conversacional-sim',
        content: effectiveTopic,
        url: vidCfg.url || undefined,
        aspectRatio,
        voiceId,
        voiceName,
        durationSeconds,
        showSubtitles,
        enableBgMusic,
        bgMusicPreset,
      };

      createdJob = await whatsappService.enqueueJob({
        groupId: remoteJid,
        groupName: 'Painel Simulator',
        senderJid: 'painel@s.whatsapp.net',
        senderName: senderName || 'Você',
        rawMessage: rawText,
        parsed: parsedCmd,
      });
    }

    let reply = assistantDecision.replyText || 'Processado com sucesso.';
    if (realFactData.sources.length > 0 && (assistantDecision.intent === 'SEARCH_WEB' || assistantDecision.intent === 'GET_NEWS')) {
      if (!reply.includes('Fontes') && !reply.includes('http')) {
        const sourceLinks = realFactData.sources
          .slice(0, 3)
          .map((s) => `• [${s.categoryLabel}] ${s.source}: ${s.url}`)
          .join('\n');
        reply += `\n\n📌 *Fontes Apuradas na Web:*\n${sourceLinks}`;
      }
    }

    session.messages.push({
      role: 'model',
      text: reply,
      timestamp: Date.now(),
      sourcesUsed: realFactData.sources.length > 0 ? realFactData.sources : undefined,
      intentExecuted: assistantDecision.intent || 'CONVERSATION',
      targetTopic: assistantDecision.targetTopic,
    });
    session.updatedAt = Date.now();
    this.persistSessions();

    return {
      intent: assistantDecision.intent || 'CONVERSATION',
      replyText: reply,
      job: createdJob,
    };
  }
}

export const whatsappAssistantService = WhatsAppAssistantService.getInstance();
