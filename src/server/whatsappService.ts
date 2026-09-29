import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  WASocket,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { renderVideoForJob } from './serverVideoRenderer';
import { whatsappAssistantService } from './whatsappAssistantService';

export interface WhatsAppGroupInfo {
  id: string;
  subject: string;
  participantsCount: number;
  desc?: string;
}

export interface WhatsAppBotConfig {
  enabled: boolean;
  monitoredGroupIds: string[]; // Empty array or ['*'] if all groups, or specific group JIDs
  allowDirectMessages: boolean;
  autoDetectNewsLinks: boolean;
  requireCommandPrefix: boolean;
  defaultAspectRatio: '9:16' | '16:9' | '1:1';
  defaultVoiceId: string;
  defaultDurationSeconds: number;
  defaultShowSubtitles: boolean;
  defaultEnableBgMusic: boolean;
  defaultMusicStyle?: string;
  sendProgressUpdates: boolean;
}

export interface UserPreferences {
  voiceId?: string;
  voiceName?: string;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  durationSeconds?: number;
  showSubtitles?: boolean;
  enableBgMusic?: boolean;
  bgMusicPreset?: string;
  studioMode?: 'reportagem' | 'roteiro_criativo';
  updatedAt?: number;
}

export interface CustomMediaAttachment {
  url: string;
  localPath: string;
  mediaType: 'image' | 'video' | 'audio';
  filename: string;
  mimetype?: string;
  caption?: string;
  sizeBytes?: number;
}

export interface WhatsAppCommandParsed {
  studioMode: 'reportagem' | 'roteiro_criativo';
  inputMode: 'url' | 'full_prompt' | 'premise_ai';
  commandUsed: string;
  content: string;
  url?: string;
  aspectRatio: '9:16' | '16:9' | '1:1';
  voiceId: string;
  voiceName: string;
  durationSeconds: number;
  showSubtitles: boolean;
  enableBgMusic: boolean;
  bgMusicPreset?: string;
  customMedia?: CustomMediaAttachment;
}

export interface WhatsAppVideoJob {
  id: string;
  groupId: string;
  groupName: string;
  senderJid: string;
  senderName: string;
  rawMessage: string;
  messageKey?: any;
  parsed: WhatsAppCommandParsed;
  status: 'pending' | 'processing' | 'rendering' | 'sending_whatsapp' | 'completed' | 'error';
  progress: number;
  statusText: string;
  title?: string;
  videoFilePath?: string;
  videoDownloadUrl?: string;
  customMedia?: CustomMediaAttachment;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  sentToWhatsApp?: boolean;
}

const DATA_ROOT = path.resolve(process.cwd(), 'data', 'whatsapp');
const AUTH_DIR = path.join(DATA_ROOT, 'auth_info');
const VIDEOS_DIR = path.join(DATA_ROOT, 'videos');
const MEDIA_DIR = path.join(DATA_ROOT, 'media');
const CONFIG_PATH = path.join(DATA_ROOT, 'config.json');
const JOBS_PATH = path.join(DATA_ROOT, 'jobs.json');
const PREFS_PATH = path.join(DATA_ROOT, 'user_preferences.json');

for (const dir of [DATA_ROOT, AUTH_DIR, VIDEOS_DIR, MEDIA_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const VOICE_CATALOG: Record<string, { id: string; name: string; gender: string; lang: string; desc: string }> = {
  francisca: {
    id: 'pt-BR-FranciscaNeural',
    name: 'Francisca',
    gender: 'Feminino',
    lang: 'pt-BR',
    desc: 'Natural, expressiva e envolvente (Histórias e Audiobooks)',
  },
  thalita: {
    id: 'pt-BR-ThalitaMultilingualNeural',
    name: 'Thalita',
    gender: 'Feminino',
    lang: 'pt-BR',
    desc: 'Suave, amigável e moderna (Podcasts e Geral)',
  },
  antonio: {
    id: 'pt-BR-AntonioNeural',
    name: 'Antônio',
    gender: 'Masculino',
    lang: 'pt-BR',
    desc: 'Voz clássica, madura, firme e segura (Notícias e Negócios)',
  },
  andre: {
    id: 'en-US-AndrewMultilingualNeural',
    name: 'André',
    gender: 'Masculino',
    lang: 'pt-BR',
    desc: 'Jovem, dinâmico e natural (YouTube e Narrativas)',
  },
  bruno: {
    id: 'en-US-BrianMultilingualNeural',
    name: 'Bruno',
    gender: 'Masculino',
    lang: 'pt-BR',
    desc: 'Grave, encorpado e com presença forte (Documentários)',
  },
  william: {
    id: 'en-AU-WilliamMultilingualNeural',
    name: 'William',
    gender: 'Masculino',
    lang: 'pt-BR',
    desc: 'Calmo, reflexivo e acolhedor (Histórias reflexivas)',
  },
  rodrigo: {
    id: 'fr-FR-RemyMultilingualNeural',
    name: 'Rodrigo',
    gender: 'Masculino',
    lang: 'pt-BR',
    desc: 'Moderno, ágil e articulado (Apresentações e Tutoriais)',
  },
  fabio: {
    id: 'de-DE-FlorianMultilingualNeural',
    name: 'Fábio',
    gender: 'Masculino',
    lang: 'pt-BR',
    desc: 'Sereno, pausado e analítico (Artigos longos e Relatórios)',
  },
  gustavo: {
    id: 'it-IT-GiuseppeMultilingualNeural',
    name: 'Gustavo',
    gender: 'Masculino',
    lang: 'pt-BR',
    desc: 'Comunicativo, enérgico e claro (Cursos e Conteúdo Dinâmico)',
  },
  raquel: {
    id: 'pt-PT-RaquelNeural',
    name: 'Raquel (Portugal)',
    gender: 'Feminino',
    lang: 'pt-PT',
    desc: 'Português de Portugal clássico e elegante',
  },
  duarte: {
    id: 'pt-PT-DuarteNeural',
    name: 'Duarte (Portugal)',
    gender: 'Masculino',
    lang: 'pt-PT',
    desc: 'Português de Portugal firme e jornalístico',
  },
  ava: {
    id: 'en-US-AvaMultilingualNeural',
    name: 'Ava',
    gender: 'Feminino',
    lang: 'Multilingual',
    desc: 'Internacional, brilhante e expressiva',
  },
};

const DEFAULT_CONFIG: WhatsAppBotConfig = {
  enabled: true,
  monitoredGroupIds: [],
  allowDirectMessages: true,
  autoDetectNewsLinks: true,
  requireCommandPrefix: true,
  defaultAspectRatio: '9:16',
  defaultVoiceId: 'pt-BR-FranciscaNeural',
  defaultDurationSeconds: 60,
  defaultShowSubtitles: true,
  defaultEnableBgMusic: true,
  defaultMusicStyle: 'news-breaking',
  sendProgressUpdates: true,
};

class WhatsAppAutomationService {
  private sock: WASocket | null = null;
  private connectionState: 'disconnected' | 'connecting' | 'qr_ready' | 'connected' = 'disconnected';
  private qrCodeDataUrl: string | null = null;
  private pairingCode: string | null = null;
  private connectedUser: { id: string; name?: string; phone?: string } | null = null;
  private lastError: string | null = null;
  private groups: Map<string, WhatsAppGroupInfo> = new Map();
  private config: WhatsAppBotConfig = { ...DEFAULT_CONFIG };
  private userPreferences: Map<string, UserPreferences> = new Map();
  private jobs: WhatsAppVideoJob[] = [];
  private rawMessagesMap: Map<string, any> = new Map();
  private isInitializing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private cachedWaVersion: [number, number, number] | null = null;

  // Server-side autonomous queue processor
  private processingQueue: string[] = [];
  private isRenderingQueue = false;

  // Deduplication cache for incoming message IDs (prevents duplicate handling on reconnect)
  private processedMessageIds: Map<string, number> = new Map();

  constructor() {
    this.loadConfig();
    this.loadPreferences();
    this.loadJobs();

    // 100% SERVER AUTONOMY: Auto-connect Baileys on server boot if saved session exists
    if (this.hasSavedSession()) {
      console.log('[WhatsAppBot] Sessão salva em disco encontrada. Conectando Baileys no servidor...');
      this.connect(undefined, false).catch((err) => {
        console.warn('[WhatsAppBot] Erro ao reconectar sessão no boot:', err);
      });
    }

    // Resume any pending or interrupted jobs autonomously on the server
    for (const j of this.jobs) {
      if (j.status === 'pending' || j.status === 'processing' || j.status === 'rendering') {
        this.processingQueue.push(j.id);
      }
    }
    if (this.processingQueue.length > 0) {
      setTimeout(() => this.processNextInQueue(), 2500);
    }
  }

  private async getLiveWaWebVersion(): Promise<[number, number, number]> {
    if (this.cachedWaVersion) {
      return this.cachedWaVersion;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('https://web.whatsapp.com/sw.js', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const text = await res.text();
        const match =
          text.match(/"client_revision"\s*:\s*(\d+)/) ||
          text.match(/client_revision\s*:\s*(\d+)/);
        if (match && match[1]) {
          const rev = parseInt(match[1], 10);
          if (rev > 1020000000) {
            this.cachedWaVersion = [2, 3000, rev];
            return this.cachedWaVersion;
          }
        }
      }
    } catch {}
    return [2, 3000, 1048745628];
  }

  public hasSavedSession(): boolean {
    try {
      const credsPath = path.join(AUTH_DIR, 'creds.json');
      if (!fs.existsSync(credsPath)) return false;
      const raw = fs.readFileSync(credsPath, 'utf-8');
      if (!raw || raw.trim().length === 0) return false;
      const creds = JSON.parse(raw);
      return Boolean(creds && (creds.registered === true || creds.me));
    } catch {
      return false;
    }
  }

  private loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        this.config = { ...DEFAULT_CONFIG, ...raw };
      }
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  public saveConfig(updates: Partial<WhatsAppBotConfig>): WhatsAppBotConfig {
    this.config = { ...this.config, ...updates };
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Failed to save WhatsApp config:', e);
    }
    return this.config;
  }

  private loadPreferences() {
    try {
      if (fs.existsSync(PREFS_PATH)) {
        const raw = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));
        if (raw && typeof raw === 'object') {
          for (const [jid, pref] of Object.entries(raw)) {
            this.userPreferences.set(jid, pref as UserPreferences);
          }
        }
      }
    } catch {
      this.userPreferences.clear();
    }
  }

  private persistPreferences() {
    try {
      const obj: Record<string, UserPreferences> = {};
      for (const [k, v] of this.userPreferences.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(PREFS_PATH, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Failed to save user preferences:', e);
    }
  }

  public getUserPreference(jid: string): UserPreferences {
    return this.userPreferences.get(jid) || {};
  }

  public setUserPreference(jid: string, updates: Partial<UserPreferences>): UserPreferences {
    const existing = this.getUserPreference(jid);
    const updated: UserPreferences = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };
    this.userPreferences.set(jid, updated);
    this.persistPreferences();
    return updated;
  }

  public resetUserPreference(jid: string): void {
    this.userPreferences.delete(jid);
    this.persistPreferences();
  }

  private loadJobs() {
    try {
      if (fs.existsSync(JOBS_PATH)) {
        const raw = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf-8'));
        if (Array.isArray(raw)) {
          this.jobs = raw.slice(0, 100);
        }
      }
    } catch {
      this.jobs = [];
    }
  }

  private persistJobs() {
    try {
      fs.writeFileSync(JOBS_PATH, JSON.stringify(this.jobs.slice(0, 100), null, 2), 'utf-8');
    } catch (e) {
      console.warn('Failed to save WhatsApp jobs:', e);
    }
  }

  public getStatus() {
    return {
      connectionState: this.connectionState,
      qrCodeDataUrl: this.qrCodeDataUrl,
      pairingCode: this.pairingCode,
      connectedUser: this.connectedUser,
      lastError: this.lastError,
      groups: Array.from(this.groups.values()),
      config: this.config,
      jobs: this.jobs,
      isServerRendering: this.isRenderingQueue,
      queueLength: this.processingQueue.length,
      availableVoices: Object.entries(VOICE_CATALOG).map(([key, v]) => ({
        key,
        id: v.id,
        name: v.name,
        gender: v.gender,
        lang: v.lang,
        desc: v.desc,
      })),
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    // Exponential backoff: 2s, 3s, 5s, 8s, up to 15s max
    const delay = Math.min(15000, Math.round(2000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 5))));
    this.reconnectAttempts++;
    console.log(`[WhatsAppBot] Agendando reconexão automática em ${delay / 1000}s (tentativa ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      if (this.connectionState !== 'connected') {
        this.connect(undefined, false).catch(() => {});
      }
    }, delay);
  }

  public async connect(phoneNumberForPairing?: string, isManualRequest = true): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.ev.removeAllListeners('messages.upsert');
        this.sock.ev.removeAllListeners('groups.upsert');
        this.sock.end(undefined);
      } catch {}
      this.sock = null;
      if (isManualRequest) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    this.isInitializing = true;
    this.lastError = null;
    this.connectionState = 'connecting';
    if (isManualRequest) {
      this.qrCodeDataUrl = null;
      this.pairingCode = null;
    }

    let cleanPhone = (phoneNumberForPairing || '').replace(/\D/g, '');
    if (cleanPhone.length === 10 || cleanPhone.length === 11) {
      cleanPhone = `55${cleanPhone}`;
    }

    if (phoneNumberForPairing && cleanPhone.length < 10) {
      this.isInitializing = false;
      this.connectionState = 'disconnected';
      this.lastError = 'Digite um número de telefone válido com DDD (ex: 5511999998888 ou 11999998888).';
      return;
    }

    // Only clear auth folder if manual request AND no saved session exists
    if (isManualRequest && !this.hasSavedSession()) {
      this.clearAuthFolder();
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const version = await this.getLiveWaWebVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }) as any,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        qrTimeout: 45000,
      });

      this.sock = sock;
      let pairingRequested = false;

      let resolveInitialReady: (() => void) | null = null;
      const initialReadyPromise = new Promise<void>((resolve) => {
        resolveInitialReady = resolve;
        setTimeout(resolve, 8500);
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        if (this.sock !== sock) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, {
              margin: 2,
              width: 320,
              color: { dark: '#000000', light: '#ffffff' },
            });
            this.connectionState = 'qr_ready';
          } catch {}

          if (cleanPhone && !pairingRequested && !sock.authState.creds.registered) {
            pairingRequested = true;
            try {
              let rawCode: string | undefined;
              try {
                rawCode = await sock.requestPairingCode(cleanPhone);
              } catch {
                await new Promise((r) => setTimeout(r, 600));
                rawCode = await sock.requestPairingCode(cleanPhone);
              }
              if (rawCode) {
                const formatted =
                  rawCode.length === 8 ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}` : rawCode;
                this.pairingCode = formatted;
                this.connectionState = 'qr_ready';
                this.lastError = null;
              }
            } catch (err: any) {
              this.lastError = `Não foi possível gerar o código para +${cleanPhone}: ${
                err?.message || 'Verifique o número com DDI+DDD (ex: 5511999998888)'
              }`;
            }
          }

          if (resolveInitialReady) {
            resolveInitialReady();
            resolveInitialReady = null;
          }
        }

        if (connection === 'open') {
          this.connectionState = 'connected';
          this.qrCodeDataUrl = null;
          this.pairingCode = null;
          this.lastError = null;
          this.reconnectAttempts = 0;

          const userJid = sock.user?.id || '';
          const phone = userJid.split(':')[0].split('@')[0];
          this.connectedUser = {
            id: userJid,
            name: sock.user?.name || 'WhatsApp Conectado',
            phone,
          };
          console.log(`[WhatsAppBot] WhatsApp conectado com sucesso no servidor! Conta: +${phone}`);

          if (resolveInitialReady) {
            resolveInitialReady();
            resolveInitialReady = null;
          }

          await this.refreshGroups();
        } else if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const errMessage = (lastDisconnect?.error as any)?.message || '';
          console.warn(`[WhatsAppBot] Conexão fechada. Código: ${statusCode}, Mensagem: ${errMessage}`);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('[WhatsAppBot] Sessão encerrada/desconectada pelo aparelho.');
            this.connectionState = 'disconnected';
            this.connectedUser = null;
            this.qrCodeDataUrl = null;
            this.pairingCode = null;
            this.clearAuthFolder();
          } else {
            // Reconnect automatically on any other drop (network, stream 515, timeout, server restart)
            this.connectionState = 'connecting';
            this.scheduleReconnect();
          }

          if (resolveInitialReady) {
            resolveInitialReady();
            resolveInitialReady = null;
          }
        }
      });

      sock.ev.on('groups.upsert', (newGroups) => {
        for (const g of newGroups) {
          this.groups.set(g.id, {
            id: g.id,
            subject: g.subject || 'Grupo sem nome',
            participantsCount: g.participants?.length || 0,
            desc: g.desc,
          });
        }
      });

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          await this.handleIncomingWhatsAppMessage(msg);
        }
      });

      if (isManualRequest) {
        await initialReadyPromise;
      }
    } catch (err: any) {
      this.connectionState = 'disconnected';
      this.lastError = err?.message || 'Falha ao iniciar conexão com WhatsApp';
      this.scheduleReconnect();
    } finally {
      this.isInitializing = false;
    }
  }

  public async refreshGroups(): Promise<WhatsAppGroupInfo[]> {
    if (!this.sock || this.connectionState !== 'connected') {
      return Array.from(this.groups.values());
    }
    try {
      const participating = await this.sock.groupFetchAllParticipating();
      this.groups.clear();
      for (const [id, meta] of Object.entries(participating)) {
        this.groups.set(id, {
          id,
          subject: meta.subject || 'Grupo',
          participantsCount: meta.participants?.length || 0,
          desc: meta.desc,
        });
      }
    } catch (e) {
      console.warn('Failed to refresh groups:', e);
    }
    return Array.from(this.groups.values());
  }

  public async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      try {
        await this.sock.logout('Desconectado manualmente pelo usuário');
      } catch {}
      try {
        this.sock.end(undefined);
      } catch {}
      this.sock = null;
    }
    this.connectionState = 'disconnected';
    this.connectedUser = null;
    this.qrCodeDataUrl = null;
    this.pairingCode = null;
    this.clearAuthFolder();
  }

  public isWhatsAppConnected(): boolean {
    return this.connectionState === 'connected' && !!this.sock;
  }

  public getConfig(): WhatsAppBotConfig {
    return this.config;
  }

  public async sendTextMessage(jid: string, text: string, quotedMsg?: any): Promise<void> {
    if (!this.sock || this.connectionState !== 'connected') return;
    try {
      await this.sock.sendMessage(jid, { text }, quotedMsg ? { quoted: quotedMsg } : undefined);
    } catch (err) {
      console.warn(`[WhatsAppBot] Erro ao enviar mensagem para ${jid}:`, err);
    }
  }

  private clearAuthFolder() {
    try {
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
    } catch (e) {
      console.warn('Could not clear auth folder:', e);
    }
  }

  public matchVoice(input: string): { id: string; name: string } | null {
    if (!input) return null;
    const clean = input
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    for (const [key, v] of Object.entries(VOICE_CATALOG)) {
      const vNameClean = v.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (clean === key || clean === vNameClean || v.id.toLowerCase().includes(clean)) {
        return { id: v.id, name: v.name };
      }
    }
    return null;
  }

  public parseCommandMessage(
    rawText: string,
    context?: { jid?: string; customMedia?: CustomMediaAttachment }
  ): {
    type:
      | 'ignore'
      | 'help'
      | 'voices_list'
      | 'set_voice'
      | 'set_format'
      | 'set_duration'
      | 'set_music'
      | 'set_subtitles'
      | 'set_style'
      | 'get_config'
      | 'reset_config'
      | 'status'
      | 'job';
    parsed?: WhatsAppCommandParsed;
    actionValue?: any;
    replyText?: string;
  } {
    const text = (rawText || '').trim();
    if (!text && !context?.customMedia) return { type: 'ignore' };

    const lower = text.toLowerCase();
    const userPrefs = context?.jid ? this.getUserPreference(context.jid) : {};

    // 1. HELP / FUNCTIONS COMMAND
    if (
      /^(?:!|\/)?(funcoes|funções|funcao|função|ajuda|help|comandos|menu)\b/i.test(lower) ||
      lower === 'funcoes' ||
      lower === 'funções' ||
      lower === 'ajuda'
    ) {
      return { type: 'help', replyText: this.buildFunctionsMenuText(context?.jid) };
    }

    // 2. VOICES LIST COMMAND
    if (/^(?:!|\/)?(vozes|lista-vozes|voices)\b/i.test(lower) || lower === 'vozes') {
      return { type: 'voices_list', replyText: this.buildVoicesListText() };
    }

    // 3. SET VOICE COMMAND (/voz antonio, /voz thalita, etc.)
    const setVoiceMatch = text.match(/^(?:!|\/)?voz\s+([a-zA-Z0-9_\-áéíóúãõçÁÉÍÓÚÃÕÇ\s]+)$/i);
    if (setVoiceMatch && setVoiceMatch[1]) {
      const query = setVoiceMatch[1].trim();
      const matched = this.matchVoice(query);
      if (matched) {
        return {
          type: 'set_voice',
          actionValue: matched,
          replyText: [
            `🎙️ *Voz Alterada com Sucesso!*`,
            ``,
            `• Nova voz padrão: *${matched.name}*`,
            `• Código ID: \`${matched.id}\``,
            ``,
            `✅ Todos os novos vídeos gerados neste chat usarão esta voz neural automaticamente.`,
            `💡 Para ver todas as outras vozes, digite \`/vozes\`.`,
          ].join('\n'),
        };
      } else {
        return {
          type: 'set_voice',
          replyText: `⚠️ Voz "${query}" não encontrada. Digite \`/vozes\` para ver as vozes disponíveis (ex: \`/voz antonio\`, \`/voz francisca\`, \`/voz bruno\`).`,
        };
      }
    }

    // 4. SET FORMAT COMMAND (/formato 16:9, /formato 9:16, /formato 1:1, /formato horizontal, /formato vertical, /formato quadrado)
    const setFormatMatch = text.match(/^(?:!|\/)?(?:formato|aspecto|ratio)\s+(.+)$/i);
    if (setFormatMatch && setFormatMatch[1]) {
      const fQuery = setFormatMatch[1].trim().toLowerCase();
      let newFormat: '9:16' | '16:9' | '1:1' | null = null;
      let label = '';
      if (/16:?9|horizontal|youtube|paisagem|widescreen/i.test(fQuery)) {
        newFormat = '16:9';
        label = '16:9 Horizontal (YouTube, TV e Telas)';
      } else if (/9:?16|vertical|reels|shorts|tiktok|stories/i.test(fQuery)) {
        newFormat = '9:16';
        label = '9:16 Vertical (Reels, TikTok, Shorts e Stories)';
      } else if (/1:?1|quadrado|square|feed|instagram/i.test(fQuery)) {
        newFormat = '1:1';
        label = '1:1 Quadrado (Feed Instagram, LinkedIn e Posts)';
      }

      if (newFormat) {
        return {
          type: 'set_format',
          actionValue: newFormat,
          replyText: [
            `📐 *Formato de Vídeo Atualizado!*`,
            ``,
            `• Novo formato: *${newFormat}*`,
            `• Aplicação: ${label}`,
            ``,
            `✅ Seus próximos vídeos serão renderizados nesta proporção.`,
          ].join('\n'),
        };
      } else {
        return {
          type: 'set_format',
          replyText: `⚠️ Formato não reconhecido. Use: \`/formato 9:16\` (Vertical), \`/formato 16:9\` (Horizontal) ou \`/formato 1:1\` (Quadrado/Feed).`,
        };
      }
    }

    // 5. SET DURATION COMMAND (/duracao 60, /tempo 90s, /duracao 2m)
    const setDurMatch = text.match(/^(?:!|\/)?(?:duracao|duração|tempo)\s+(\d+)\s*(s|seg|min|m)?$/i);
    if (setDurMatch && setDurMatch[1]) {
      const val = parseInt(setDurMatch[1], 10);
      const unit = (setDurMatch[2] || 's').toLowerCase();
      const secs = unit.startsWith('m') ? val * 60 : val;
      const clamped = Math.max(15, Math.min(900, secs));
      return {
        type: 'set_duration',
        actionValue: clamped,
        replyText: [
          `⏱️ *Duração de Vídeo Configurada!*`,
          ``,
          `• Duração alvo: *${clamped} segundos* (~${Math.round((clamped / 60) * 10) / 10} minutos)`,
          ``,
          `✅ As próximas histórias geradas por IA respeitarão esta estimativa de duração.`,
        ].join('\n'),
      };
    }

    // 6. SET BACKGROUND MUSIC COMMAND (/musica lofi, /musica off, /musica cinematic, etc.)
    const setMusicMatch = text.match(/^(?:!|\/)?(?:musica|música|trilha)\s+(.+)$/i);
    if (setMusicMatch && setMusicMatch[1]) {
      const mQuery = setMusicMatch[1].trim().toLowerCase();
      if (/off|nao|não|desativar|desligar|sem/i.test(mQuery)) {
        return {
          type: 'set_music',
          actionValue: { enabled: false, preset: 'none' },
          replyText: `🎵 *Música de Fundo Desativada!*\n\nOs próximos vídeos serão gerados apenas com a locução neural cristalina, sem trilha.`,
        };
      } else {
        let preset = 'news-breaking';
        let label = 'Jornalística Dinâmica';
        if (/lofi|chill|relax/i.test(mQuery)) {
          preset = 'lofi-chill';
          label = 'Lo-Fi Chill & Calma';
        } else if (/cinematic|cinema|epica|épica|filme/i.test(mQuery)) {
          preset = 'cinematic-dramatic';
          label = 'Cinematográfica Dramática';
        } else if (/acoustic|acustico|acústico|violao|violão/i.test(mQuery)) {
          preset = 'acoustic-warm';
          label = 'Acústica Acolhedora';
        } else if (/piano|emocionante|suave/i.test(mQuery)) {
          preset = 'piano-emotional';
          label = 'Piano Emocional';
        } else if (/ambient|ambiente|zen/i.test(mQuery)) {
          preset = 'ambient-calm';
          label = 'Ambiente Calmante';
        }

        return {
          type: 'set_music',
          actionValue: { enabled: true, preset },
          replyText: [
            `🎵 *Trilha Sonora Atualizada!*`,
            ``,
            `• Estilo ativo: *${label}* (\`${preset}\`)`,
            `• Auto-Ducking: Ativado`,
            ``,
            `Para desligar quando quiser: \`/musica off\`.`,
          ].join('\n'),
        };
      }
    }

    // 7. SET SUBTITLES COMMAND (/legenda on, /legenda off, /legendas sim, /legendas nao)
    const setSubMatch = text.match(/^(?:!|\/)?(?:legenda|legendas|subtitles)\s+(on|off|sim|nao|não|true|false)$/i);
    if (setSubMatch && setSubMatch[1]) {
      const enabled = /on|sim|true/i.test(setSubMatch[1]);
      return {
        type: 'set_subtitles',
        actionValue: enabled,
        replyText: enabled
          ? `📝 *Legendas Ativadas!*\n\nTodos os novos vídeos terão legendas sincronizadas com a locução.`
          : `📝 *Legendas Desativadas!*\n\nOs novos vídeos serão renderizados sem legendas sobrepostas.`,
      };
    }

    // 8. SHOW CONFIG / PREFERENCES COMMAND (/config, /meusdados, /preferencias)
    if (/^(?:!|\/)?(config|configuracoes|configurações|preferencias|preferências|meusdados)\b/i.test(lower)) {
      if (/reset/i.test(lower)) {
        return {
          type: 'reset_config',
          replyText: `🔄 *Configurações Restauradas!*\n\nSuas preferências foram redefinidas para os padrões do servidor. Digite \`/funções\` para ver todas as opções.`,
        };
      }
      return {
        type: 'get_config',
        replyText: this.buildUserConfigSummaryText(context?.jid),
      };
    }

    // 9. STATUS / QUEUE COMMAND
    if (/^(?:!|\/)?(status|fila|andamento)\b/i.test(lower) || lower === 'status' || lower === 'fila') {
      return { type: 'status' };
    }

    // 10. RESOLVE EFFECTIVE ATTRIBUTES (INHERITED PREFERENCES + INLINE FLAGS)
    let aspectRatio: '9:16' | '16:9' | '1:1' =
      userPrefs.aspectRatio || this.config.defaultAspectRatio || '9:16';
    if (/#(16:9|horizontal|youtube|paisagem)\b/i.test(text) || /--(?:formato|aspecto)\s+16:9/i.test(text)) {
      aspectRatio = '16:9';
    } else if (/#(9:16|vertical|reels|shorts|tiktok)\b/i.test(text) || /--(?:formato|aspecto)\s+9:16/i.test(text)) {
      aspectRatio = '9:16';
    } else if (/#(1:1|quadrado|feed|square)\b/i.test(text) || /--(?:formato|aspecto)\s+1:1/i.test(text)) {
      aspectRatio = '1:1';
    }

    let voiceObj: { id: string; name: string } = {
      id: userPrefs.voiceId || this.config.defaultVoiceId || 'pt-BR-FranciscaNeural',
      name: userPrefs.voiceName || 'Francisca',
    };

    const inlineVoiceMatch = text.match(/#voz:([a-zA-Z0-9_\-áéíóúãõç]+)/i) || text.match(/--voz\s+([a-zA-Z0-9_\-]+)/i);
    if (inlineVoiceMatch && inlineVoiceMatch[1]) {
      const match = this.matchVoice(inlineVoiceMatch[1]);
      if (match) voiceObj = match;
    }

    let durationSeconds = userPrefs.durationSeconds || this.config.defaultDurationSeconds || 60;
    const durMatch =
      text.match(/#(?:duracao|tempo):?(\d+)(s|m|min)?/i) ||
      text.match(/#(\d+)(s|min)\b/i) ||
      text.match(/--tempo\s+(\d+)/i);
    if (durMatch && durMatch[1]) {
      const val = parseInt(durMatch[1], 10);
      const unit = (durMatch[2] || 's').toLowerCase();
      const secs = unit.startsWith('m') ? val * 60 : val;
      durationSeconds = Math.max(15, Math.min(900, secs));
    }

    let showSubtitles = userPrefs.showSubtitles ?? this.config.defaultShowSubtitles ?? true;
    if (/#legenda:(nao|não|off|false)\b/i.test(text)) showSubtitles = false;
    if (/#legenda:(sim|on|true)\b/i.test(text)) showSubtitles = true;

    let enableBgMusic = userPrefs.enableBgMusic ?? this.config.defaultEnableBgMusic ?? true;
    let bgMusicPreset = userPrefs.bgMusicPreset || this.config.defaultMusicStyle || 'news-breaking';
    if (/#musica:(nao|não|off|false)\b/i.test(text)) enableBgMusic = false;
    if (/#musica:(sim|on|true)\b/i.test(text)) enableBgMusic = true;
    const inlineMusicPresetMatch = text.match(/#musica:([a-zA-Z0-9_\-]+)/i);
    if (inlineMusicPresetMatch && inlineMusicPresetMatch[1]) {
      bgMusicPreset = inlineMusicPresetMatch[1].toLowerCase();
      enableBgMusic = true;
    }

    const cleanBody = text
      .replace(/#(16:9|9:16|1:1|horizontal|vertical|quadrado|feed|youtube|paisagem|reels|shorts|tiktok)\b/gi, '')
      .replace(/#voz:[a-zA-Z0-9_\-áéíóúãõç]+/gi, '')
      .replace(/#(?:duracao|tempo):?\d+(?:s|m|min)?/gi, '')
      .replace(/#\d+(?:s|min)\b/gi, '')
      .replace(/#legenda:(?:sim|nao|não|on|off|true|false)\b/gi, '')
      .replace(/#musica:(?:sim|nao|não|on|off|true|false|[a-zA-Z0-9_\-]+)\b/gi, '')
      .replace(/--(?:voz|formato|tempo)\s+[^\s]+/gi, '')
      .trim();

    // 11. EXPLICIT NEWS/REPORTAGE COMMAND: /materia, /noticia, /reportagem
    const newsCmdMatch = cleanBody.match(/^(!|\/)(materia|matéria|noticia|notícia|reportagem)\s*(.*)/is);
    if (newsCmdMatch) {
      const rest = (newsCmdMatch[3] || '').trim();
      const urlMatch = rest.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        return {
          type: 'job',
          parsed: {
            studioMode: 'reportagem',
            inputMode: 'url',
            commandUsed: `/${newsCmdMatch[2].toLowerCase()}`,
            content: urlMatch[0],
            url: urlMatch[0],
            aspectRatio,
            voiceId: voiceObj.id,
            voiceName: voiceObj.name,
            durationSeconds,
            showSubtitles,
            enableBgMusic,
            bgMusicPreset,
            customMedia: context?.customMedia,
          },
        };
      }
    }

    // 12. EXPLICIT CREATIVE IDEA COMMAND: /ideia, /tema, /criar
    const ideaCmdMatch = cleanBody.match(/^(!|\/)(ideia|tema|criar)\s+(.+)/is);
    if (ideaCmdMatch && ideaCmdMatch[3].trim().length >= 4) {
      return {
        type: 'job',
        parsed: {
          studioMode: 'roteiro_criativo',
          inputMode: 'premise_ai',
          commandUsed: `/${ideaCmdMatch[2].toLowerCase()}`,
          content: ideaCmdMatch[3].trim(),
          aspectRatio,
          voiceId: voiceObj.id,
          voiceName: voiceObj.name,
          durationSeconds,
          showSubtitles,
          enableBgMusic,
          bgMusicPreset,
          customMedia: context?.customMedia,
        },
      };
    }

    // 13. EXPLICIT SCRIPT / STORY / VIDEO COMMAND: /roteiro, /video, /historia, /narrar
    const scriptCmdMatch = cleanBody.match(
      /^(!|\/)(roteiro|video|vídeo|historia|história|narrar|ainarrado)\s*(.*)/is
    );
    if (scriptCmdMatch) {
      const payload = (scriptCmdMatch[3] || '').trim();
      const urlMatch = payload.match(/^https?:\/\/[^\s]+$/i);
      if (urlMatch) {
        return {
          type: 'job',
          parsed: {
            studioMode: 'reportagem',
            inputMode: 'url',
            commandUsed: `/${scriptCmdMatch[2].toLowerCase()}`,
            content: urlMatch[0],
            url: urlMatch[0],
            aspectRatio,
            voiceId: voiceObj.id,
            voiceName: voiceObj.name,
            durationSeconds,
            showSubtitles,
            enableBgMusic,
            bgMusicPreset,
            customMedia: context?.customMedia,
          },
        };
      }

      const effectiveContent = payload || (context?.customMedia ? 'Vídeo narrado com base na mídia enviada' : '');
      if (effectiveContent.length >= 4 || context?.customMedia) {
        return {
          type: 'job',
          parsed: {
            studioMode: 'roteiro_criativo',
            inputMode: effectiveContent.length < 140 ? 'premise_ai' : 'full_prompt',
            commandUsed: `/${scriptCmdMatch[2].toLowerCase()}`,
            content: effectiveContent,
            aspectRatio,
            voiceId: voiceObj.id,
            voiceName: voiceObj.name,
            durationSeconds,
            showSubtitles,
            enableBgMusic,
            bgMusicPreset,
            customMedia: context?.customMedia,
          },
        };
      }
    }

    // 14. AUTO-DETECT STANDALONE URL
    if (this.config.autoDetectNewsLinks) {
      const urlMatch = cleanBody.match(/https?:\/\/[^\s]+/i);
      if (urlMatch && cleanBody.length < 350) {
        return {
          type: 'job',
          parsed: {
            studioMode: 'reportagem',
            inputMode: 'url',
            commandUsed: 'auto-link',
            content: urlMatch[0],
            url: urlMatch[0],
            aspectRatio,
            voiceId: voiceObj.id,
            voiceName: voiceObj.name,
            durationSeconds,
            showSubtitles,
            enableBgMusic,
            bgMusicPreset,
            customMedia: context?.customMedia,
          },
        };
      }
    }

    // 15. If a media attachment was sent with a non-empty caption that is at least 10 chars, treat as video request
    if (context?.customMedia && cleanBody.length >= 10) {
      return {
        type: 'job',
        parsed: {
          studioMode: 'roteiro_criativo',
          inputMode: cleanBody.length < 140 ? 'premise_ai' : 'full_prompt',
          commandUsed: 'midia-com-legenda',
          content: cleanBody,
          aspectRatio,
          voiceId: voiceObj.id,
          voiceName: voiceObj.name,
          durationSeconds,
          showSubtitles,
          enableBgMusic,
          bgMusicPreset,
          customMedia: context?.customMedia,
        },
      };
    }

    // 16. If requireCommandPrefix is false, treat any long message (>25 chars) as script
    if (!this.config.requireCommandPrefix && cleanBody.length >= 25) {
      return {
        type: 'job',
        parsed: {
          studioMode: 'roteiro_criativo',
          inputMode: cleanBody.length < 140 ? 'premise_ai' : 'full_prompt',
          commandUsed: 'mensagem-direta',
          content: cleanBody,
          aspectRatio,
          voiceId: voiceObj.id,
          voiceName: voiceObj.name,
          durationSeconds,
          showSubtitles,
          enableBgMusic,
          bgMusicPreset,
          customMedia: context?.customMedia,
        },
      };
    }

    return { type: 'ignore' };
  }

  public buildFunctionsMenuText(jid?: string): string {
    const prefs = jid ? this.getUserPreference(jid) : {};
    const curVoice = prefs.voiceName || 'Francisca';
    const curFormat = prefs.aspectRatio || this.config.defaultAspectRatio || '9:16';
    const curDuration = prefs.durationSeconds || this.config.defaultDurationSeconds || 60;
    const curSubs = (prefs.showSubtitles ?? this.config.defaultShowSubtitles) ? 'Sim' : 'Não';
    const curMusic = (prefs.enableBgMusic ?? this.config.defaultEnableBgMusic) ? 'Sim' : 'Não';

    return [
      `🤖 *CENTRAL DE FUNÇÕES & COMANDOS — IA NARRADA*`,
      `Transforme textos, links, fotos e ideias em vídeos MP4 prontos com locução neural e legendas!`,
      ``,
      `══════════════════════`,
      `🎬 *1. CRIAÇÃO DE VÍDEOS:*`,
      `• \`/video <texto ou história>\` → Gera o vídeo completo com locução e cenas sincronizadas.`,
      `• \`/roteiro <história>\` → Cria o roteiro narrado cinematográfico.`,
      `• \`/ideia <tema>\` → A IA escreve o roteiro a partir de um tema e produz o vídeo.`,
      `• \`/materia <link>\` → Extrai fotos e matéria de sites (G1, UOL, CNN...) e gera reportagem.`,
      ``,
      `📸 *2. ENVIAR FOTOS & VÍDEOS:*`,
      `• *Envie uma foto ou vídeo* com o comando na legenda (ex: \`/video Crie uma história de mistério\`)!`,
      `• Ou *responda (quote)* a qualquer foto/vídeo anterior digitando \`/video [seu tema]\`.`,
      `• A mídia enviada é automaticamente incorporada e destacada no vídeo final!`,
      ``,
      `🎙️ *3. VOZES NEURAIS ULTRA-REALISTAS:*`,
      `• \`/voz antonio\` → Ativa voz masculina firme e jornalística.`,
      `• \`/voz francisca\` → Ativa voz feminina suave e envolvente.`,
      `• \`/voz thalita\` → Ativa voz feminina moderna para podcasts.`,
      `• \`/voz bruno\` → Ativa voz grave e encorpada (cinema/documentários).`,
      `• \`/vozes\` → Lista todas as 12 vozes disponíveis com amostras.`,
      ``,
      `📐 *4. FORMATO DO VÍDEO (DINÂMICO):*`,
      `• \`/formato 9:16\` → Vertical (Reels, TikTok, Shorts e Stories).`,
      `• \`/formato 16:9\` → Horizontal (YouTube, TV e Widescreen).`,
      `• \`/formato 1:1\` → Quadrado (Feed Instagram, LinkedIn e Posts).`,
      ``,
      `⏱️ *5. DURAÇÃO, MÚSICA & LEGENDAS:*`,
      `• \`/duracao 60\` → Define duração estimada em segundos (15s a 900s).`,
      `• \`/musica lofi\` ou \`/musica cinematic\` → Define o estilo de fundo.`,
      `• \`/musica off\` → Desliga a trilha sonora (apenas locução).`,
      `• \`/legenda on\` ou \`/legenda off\` → Ativa ou desativa legendas.`,
      ``,
      `⚡ *6. PARÂMETROS RÁPIDOS NA MESMA MENSAGEM:*`,
      `Você pode combinar tudo em um único comando:`,
      `ex: \`/video Os mistérios do universo #16:9 #voz:antonio #duracao:90s #musica:cinematic\``,
      ``,
      `📊 *7. CONSULTAS & CONFIGURAÇÕES:*`,
      `• \`/config\` → Ver suas preferências ativas neste chat.`,
      `• \`/config reset\` → Restaurar opções padrão do servidor.`,
      `• \`/status\` → Ver andamento da fila de renderização.`,
      ``,
      `📌 *Seu Perfil Atual:* Voz: *${curVoice}* · Formato: *${curFormat}* · Duração: *${curDuration}s* · Legendas: *${curSubs}* · Música: *${curMusic}*`,
    ].join('\n');
  }

  public buildVoicesListText(): string {
    const list = Object.entries(VOICE_CATALOG).map(([key, v], idx) => {
      const icon = v.gender === 'Feminino' ? '👩' : '👨';
      return `${idx + 1}. ${icon} */voz ${key}* (${v.name})\n   ↳ ${v.desc}`;
    });

    return [
      `🎙️ *CATÁLOGO DE VOZES NEURAIS DISPONÍVEIS*`,
      `Escolha qualquer voz digitando \`/voz [nome]\` (ex: \`/voz antonio\`):`,
      ``,
      list.join('\n\n'),
      ``,
      `💡 A voz escolhida fica salva como padrão para este chat automaticamente!`,
    ].join('\n');
  }

  public buildUserConfigSummaryText(jid?: string): string {
    const prefs = jid ? this.getUserPreference(jid) : {};
    const curVoice = prefs.voiceName || 'Francisca (Padrão)';
    const curVoiceId = prefs.voiceId || this.config.defaultVoiceId;
    const curFormat = prefs.aspectRatio || this.config.defaultAspectRatio || '9:16';
    const curDuration = prefs.durationSeconds || this.config.defaultDurationSeconds || 60;
    const curSubs = (prefs.showSubtitles ?? this.config.defaultShowSubtitles) ? 'Ativadas' : 'Desativadas';
    const curMusic = (prefs.enableBgMusic ?? this.config.defaultEnableBgMusic)
      ? `Ativada (${prefs.bgMusicPreset || this.config.defaultMusicStyle || 'news-breaking'})`
      : 'Desativada (off)';

    return [
      `⚙️ *CONFIGURAÇÕES ATIVAS DESTE CHAT*`,
      ``,
      `• 🎙️ *Voz Ativa:* ${curVoice} (\`${curVoiceId}\`)`,
      `• 📐 *Formato do Vídeo:* ${curFormat} (${curFormat === '9:16' ? 'Vertical/Reels' : curFormat === '16:9' ? 'Horizontal/YouTube' : 'Quadrado/Feed'})`,
      `• ⏱️ *Duração Alvo:* ~${curDuration} segundos`,
      `• 📝 *Legendas:* ${curSubs}`,
      `• 🎵 *Trilha Sonora:* ${curMusic}`,
      ``,
      `💡 *Como alterar:*`,
      `• Trocar voz: \`/voz antonio\` ou \`/vozes\``,
      `• Trocar formato: \`/formato 16:9\`, \`/formato 9:16\` ou \`/formato 1:1\``,
      `• Mudar duração: \`/duracao 90\``,
      `• Ligar/desligar legendas: \`/legenda on\` ou \`/legenda off\``,
      `• Trilha sonora: \`/musica lofi\` ou \`/musica off\``,
      `• Restaurar padrões: \`/config reset\``,
    ].join('\n');
  }

  private extractTextFromMessage(msg: any): string {
    const m = msg?.message;
    if (!m) return '';
    return (
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.documentMessage?.caption ||
      m.ephemeralMessage?.message?.extendedTextMessage?.text ||
      m.ephemeralMessage?.message?.conversation ||
      m.ephemeralMessage?.message?.imageMessage?.caption ||
      m.ephemeralMessage?.message?.videoMessage?.caption ||
      ''
    );
  }

  private async tryDownloadAttachmentFromMessage(msg: any): Promise<CustomMediaAttachment | undefined> {
    try {
      const m = msg?.message;
      if (!m) return undefined;

      let targetMsg: any = null;
      let mediaType: 'image' | 'video' | 'audio' = 'image';
      let mimeType = '';
      let caption = '';

      if (m.imageMessage) {
        targetMsg = msg;
        mediaType = 'image';
        mimeType = m.imageMessage.mimetype || 'image/jpeg';
        caption = m.imageMessage.caption || '';
      } else if (m.videoMessage) {
        targetMsg = msg;
        mediaType = 'video';
        mimeType = m.videoMessage.mimetype || 'video/mp4';
        caption = m.videoMessage.caption || '';
      } else if (m.audioMessage) {
        targetMsg = msg;
        mediaType = 'audio';
        mimeType = m.audioMessage.mimetype || 'audio/ogg; codecs=opus';
        caption = '';
      } else if (m.documentMessage && (m.documentMessage.mimetype?.startsWith('image/') || m.documentMessage.mimetype?.startsWith('video/') || m.documentMessage.mimetype?.startsWith('audio/'))) {
        targetMsg = msg;
        mediaType = m.documentMessage.mimetype.startsWith('video/') ? 'video' : m.documentMessage.mimetype.startsWith('audio/') ? 'audio' : 'image';
        mimeType = m.documentMessage.mimetype;
        caption = m.documentMessage.caption || '';
      } else if (m.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
        const q = m.extendedTextMessage.contextInfo;
        targetMsg = {
          key: {
            remoteJid: msg.key.remoteJid,
            id: q.stanzaId,
            participant: q.participant,
          },
          message: {
            imageMessage: q.quotedMessage.imageMessage,
          },
        };
        mediaType = 'image';
        mimeType = q.quotedMessage.imageMessage.mimetype || 'image/jpeg';
        caption = q.quotedMessage.imageMessage.caption || '';
      } else if (m.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage) {
        const q = m.extendedTextMessage.contextInfo;
        targetMsg = {
          key: {
            remoteJid: msg.key.remoteJid,
            id: q.stanzaId,
            participant: q.participant,
          },
          message: {
            videoMessage: q.quotedMessage.videoMessage,
          },
        };
        mediaType = 'video';
        mimeType = q.quotedMessage.videoMessage.mimetype || 'video/mp4';
        caption = q.quotedMessage.videoMessage.caption || '';
      } else if (m.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage) {
        const q = m.extendedTextMessage.contextInfo;
        targetMsg = {
          key: {
            remoteJid: msg.key.remoteJid,
            id: q.stanzaId,
            participant: q.participant,
          },
          message: {
            audioMessage: q.quotedMessage.audioMessage,
          },
        };
        mediaType = 'audio';
        mimeType = q.quotedMessage.audioMessage.mimetype || 'audio/ogg; codecs=opus';
        caption = '';
      }

      if (!targetMsg) return undefined;

      const buffer = await downloadMediaMessage(
        targetMsg,
        'buffer',
        {},
        {
          logger: pino({ level: 'silent' }) as any,
          reuploadRequest: (this.sock?.updateMediaMessage as any) || (() => Promise.reject()),
        }
      );

      if (buffer && buffer.length > 0) {
        const ext =
          mediaType === 'video'
            ? 'mp4'
            : mediaType === 'audio'
            ? mimeType.includes('mp4')
              ? 'm4a'
              : mimeType.includes('wav')
              ? 'wav'
              : 'ogg'
            : mimeType.includes('png')
            ? 'png'
            : 'jpg';
        const filename = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const localPath = path.join(MEDIA_DIR, filename);
        fs.writeFileSync(localPath, buffer);

        return {
          url: `/api/whatsapp/media/${filename}`,
          localPath,
          mediaType,
          filename,
          mimetype: mimeType,
          caption,
          sizeBytes: buffer.length,
        };
      }
    } catch (e) {
      console.warn('Failed to download incoming WhatsApp media:', e);
    }
    return undefined;
  }

  private async handleIncomingWhatsAppMessage(msg: any) {
    if (!this.config.enabled) return;
    const remoteJid: string = msg?.key?.remoteJid || '';
    if (!remoteJid || remoteJid === 'status@broadcast') return;

    // Deduplicate incoming messages by msg.key.id (prevents re-processing on WhatsApp reconnect)
    const messageId: string | undefined = msg?.key?.id;
    if (messageId) {
      const now = Date.now();
      if (this.processedMessageIds.has(messageId)) {
        return; // Message already processed, skip
      }
      this.processedMessageIds.set(messageId, now);
      if (this.processedMessageIds.size > 2000) {
        for (const [id, ts] of this.processedMessageIds.entries()) {
          if (now - ts > 10 * 60 * 1000) {
            this.processedMessageIds.delete(id);
          }
        }
      }
    }

    const isGroup = remoteJid.endsWith('@g.us');
    if (isGroup) {
      if (!this.groups.has(remoteJid)) {
        this.groups.set(remoteJid, {
          id: remoteJid,
          subject: `Grupo (${remoteJid.slice(0, 8)}...)`,
          participantsCount: 0,
        });
      }
      if (
        this.config.monitoredGroupIds.length > 0 &&
        !this.config.monitoredGroupIds.includes('*') &&
        !this.config.monitoredGroupIds.includes(remoteJid)
      ) {
        return;
      }
    } else if (!this.config.allowDirectMessages) {
      return;
    }

    const rawText = this.extractTextFromMessage(msg);

    // Prevent loop from bot's own replies
    if (
      rawText.startsWith('🎬 *IA Narrada') ||
      rawText.startsWith('🤖 *CENTRAL DE FUNÇÕES') ||
      rawText.startsWith('🎙️ *CATÁLOGO DE VOZES') ||
      rawText.startsWith('⚙️ *CONFIGURAÇÕES ATIVAS') ||
      rawText.startsWith('📊 *Status da Fila') ||
      rawText.startsWith('✅ *Vídeo Concluído') ||
      rawText.startsWith('📸 *Mídia Recebida')
    ) {
      return;
    }

    // Try downloading attached or quoted image/video
    const customMedia = await this.tryDownloadAttachmentFromMessage(msg);

    // If an audio voice note or audio file was received, route directly to the assistant for real transcription & understanding
    if (customMedia && customMedia.mediaType === 'audio') {
      const senderJid = msg.key?.participant || msg.key?.remoteJid || '';
      const senderName = msg.pushName || senderJid.split('@')[0] || 'Usuário';

      let audioAttachment: { buffer: Buffer; mimetype: string; localPath: string } | undefined;
      try {
        audioAttachment = {
          buffer: fs.readFileSync(customMedia.localPath),
          mimetype: customMedia.mimetype || 'audio/ogg',
          localPath: customMedia.localPath,
        };
      } catch {}

      await whatsappAssistantService.handleMessage({
        remoteJid,
        senderJid,
        senderName,
        isGroup,
        rawText,
        rawMessageObj: msg,
        customMedia: undefined,
        audioAttachment,
      });
      return;
    }

    // If an image or video was received without any accompanying text/caption
    if (customMedia && (!rawText || rawText.trim().length === 0)) {
      const senderJid = msg.key?.participant || msg.key?.remoteJid || '';
      const senderName = msg.pushName || senderJid.split('@')[0] || 'Usuário';

      // Pass to assistant to inspect visual content and guide user naturally
      await whatsappAssistantService.handleMessage({
        remoteJid,
        senderJid,
        senderName,
        isGroup,
        rawText: '',
        rawMessageObj: msg,
        customMedia,
      });
      return;
    }

    const analysis = this.parseCommandMessage(rawText, { jid: remoteJid, customMedia });
    if (analysis.type === 'ignore') {
      // Natural language conversation, question, research, or request without rigid slash command
      const senderJid = msg.key?.participant || msg.key?.remoteJid || '';
      const senderName = msg.pushName || senderJid.split('@')[0] || 'Usuário';

      await whatsappAssistantService.handleMessage({
        remoteJid,
        senderJid,
        senderName,
        isGroup,
        rawText,
        rawMessageObj: msg,
        customMedia,
      });
      return;
    }

    // Handle replies / config mutations
    if (
      analysis.type === 'help' ||
      analysis.type === 'voices_list' ||
      analysis.type === 'get_config' ||
      analysis.type === 'reset_config'
    ) {
      if (analysis.type === 'reset_config') {
        this.resetUserPreference(remoteJid);
      }
      if (this.sock && this.connectionState === 'connected' && analysis.replyText) {
        try {
          await this.sock.sendMessage(remoteJid, { text: analysis.replyText }, { quoted: msg });
        } catch {}
      }
      return;
    }

    if (analysis.type === 'set_voice') {
      if (analysis.actionValue) {
        this.setUserPreference(remoteJid, {
          voiceId: analysis.actionValue.id,
          voiceName: analysis.actionValue.name,
        });
      }
      if (this.sock && this.connectionState === 'connected' && analysis.replyText) {
        try {
          await this.sock.sendMessage(remoteJid, { text: analysis.replyText }, { quoted: msg });
        } catch {}
      }
      return;
    }

    if (analysis.type === 'set_format') {
      if (analysis.actionValue) {
        this.setUserPreference(remoteJid, { aspectRatio: analysis.actionValue });
      }
      if (this.sock && this.connectionState === 'connected' && analysis.replyText) {
        try {
          await this.sock.sendMessage(remoteJid, { text: analysis.replyText }, { quoted: msg });
        } catch {}
      }
      return;
    }

    if (analysis.type === 'set_duration') {
      if (analysis.actionValue) {
        this.setUserPreference(remoteJid, { durationSeconds: analysis.actionValue });
      }
      if (this.sock && this.connectionState === 'connected' && analysis.replyText) {
        try {
          await this.sock.sendMessage(remoteJid, { text: analysis.replyText }, { quoted: msg });
        } catch {}
      }
      return;
    }

    if (analysis.type === 'set_music') {
      if (analysis.actionValue) {
        this.setUserPreference(remoteJid, {
          enableBgMusic: analysis.actionValue.enabled,
          bgMusicPreset: analysis.actionValue.preset,
        });
      }
      if (this.sock && this.connectionState === 'connected' && analysis.replyText) {
        try {
          await this.sock.sendMessage(remoteJid, { text: analysis.replyText }, { quoted: msg });
        } catch {}
      }
      return;
    }

    if (analysis.type === 'set_subtitles') {
      if (typeof analysis.actionValue === 'boolean') {
        this.setUserPreference(remoteJid, { showSubtitles: analysis.actionValue });
      }
      if (this.sock && this.connectionState === 'connected' && analysis.replyText) {
        try {
          await this.sock.sendMessage(remoteJid, { text: analysis.replyText }, { quoted: msg });
        } catch {}
      }
      return;
    }

    if (analysis.type === 'status') {
      await this.sendStatusReply(remoteJid, msg);
      return;
    }

    if (analysis.type === 'job' && analysis.parsed) {
      const senderJid = msg.key?.participant || msg.key?.remoteJid || '';
      const senderName = msg.pushName || senderJid.split('@')[0] || 'Usuário';
      const groupName = isGroup
        ? this.groups.get(remoteJid)?.subject || 'Grupo Monitorado'
        : `Chat Direto (${senderName})`;

      await this.enqueueJob({
        groupId: remoteJid,
        groupName,
        senderJid,
        senderName,
        rawMessage: rawText,
        messageObj: msg,
        parsed: analysis.parsed,
        customMedia,
      });
    }
  }

  public async enqueueJob(params: {
    groupId: string;
    groupName: string;
    senderJid: string;
    senderName: string;
    rawMessage: string;
    messageObj?: any;
    parsed: WhatsAppCommandParsed;
    customMedia?: CustomMediaAttachment;
  }): Promise<WhatsAppVideoJob> {
    const jobId = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const effectiveCustomMedia = params.customMedia || params.parsed.customMedia;

    const job: WhatsAppVideoJob = {
      id: jobId,
      groupId: params.groupId,
      groupName: params.groupName,
      senderJid: params.senderJid,
      senderName: params.senderName,
      rawMessage: params.rawMessage,
      messageKey: params.messageObj?.key,
      parsed: {
        ...params.parsed,
        customMedia: effectiveCustomMedia,
      },
      customMedia: effectiveCustomMedia,
      status: 'pending',
      progress: 5,
      statusText: effectiveCustomMedia
        ? `Mídia (${effectiveCustomMedia.mediaType}) recebida e enfileirada no servidor...`
        : 'Comando recebido do WhatsApp — enfileirado para produção no servidor...',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (params.messageObj) {
      this.rawMessagesMap.set(jobId, params.messageObj);
    }

    this.jobs.unshift(job);
    this.persistJobs();

    // Send immediate acknowledgment back to WhatsApp
    if (this.sock && this.connectionState === 'connected' && this.config.sendProgressUpdates) {
      const modeLabel =
        params.parsed.studioMode === 'reportagem'
          ? '📰 Matéria Jornalística para Vídeo'
          : params.parsed.inputMode === 'premise_ai'
          ? '💡 Ideia Criativa para Vídeo (IA)'
          : '🎬 Roteiro Narrado para Vídeo';

      const formatLabel =
        params.parsed.aspectRatio === '9:16'
          ? '9:16 (Vertical/Reels)'
          : params.parsed.aspectRatio === '16:9'
          ? '16:9 (Horizontal/YouTube)'
          : '1:1 (Quadrado/Feed)';

      const mediaLabel = effectiveCustomMedia
        ? `• *Mídia Incorporada:* Sim (${effectiveCustomMedia.mediaType === 'video' ? 'Vídeo enviado' : 'Foto enviada'})\n`
        : '';

      const ackText = [
        `🎬 *IA Narrada (VozLivre)* — Pedido Recebido!`,
        ``,
        `• *Modo:* ${modeLabel}`,
        `• *Comando:* ${params.parsed.commandUsed}`,
        `• *Formato:* ${formatLabel}`,
        `• *Voz Neural:* ${params.parsed.voiceName}`,
        `• *Duração Alvo:* ~${params.parsed.durationSeconds}s`,
        mediaLabel,
        `⏳ _Produção iniciada 100% no servidor (FFmpeg + IA Neural). O vídeo será entregue em alta qualidade aqui assim que for concluído!_`,
      ]
        .filter(Boolean)
        .join('\n');

      try {
        await this.sock.sendMessage(
          params.groupId,
          { text: ackText },
          params.messageObj ? { quoted: params.messageObj } : undefined
        );
      } catch (e) {
        console.warn('Failed to send WhatsApp ack message:', e);
      }
    }

    // 100% SERVER AUTONOMY: Push to autonomous background render queue
    this.processingQueue.push(job.id);
    this.processNextInQueue();

    return job;
  }

  /**
   * Autonomous Server-Side Video Processing Engine
   * Executes in Node.js on the server even when no browser is open
   */
  private async processNextInQueue(): Promise<void> {
    if (this.isRenderingQueue || this.processingQueue.length === 0) {
      return;
    }

    this.isRenderingQueue = true;
    const jobId = this.processingQueue.shift();
    if (!jobId) {
      this.isRenderingQueue = false;
      return;
    }

    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.status === 'completed' || job.status === 'error') {
      this.isRenderingQueue = false;
      setImmediate(() => this.processNextInQueue());
      return;
    }

    console.log(`[WhatsAppBot] Iniciando renderização autônoma no servidor para o Job ${job.id} (${job.parsed.commandUsed})...`);

    this.updateJobProgress(job.id, {
      status: 'processing',
      progress: 10,
      statusText: 'Iniciando produção autônoma do vídeo no servidor...',
    });

    try {
      const renderResult = await renderVideoForJob(job, (progress, statusText) => {
        const mappedStatus = progress >= 95 ? 'sending_whatsapp' : progress >= 75 ? 'rendering' : 'processing';
        this.updateJobProgress(job.id, {
          status: mappedStatus,
          progress,
          statusText,
        });
      });

      console.log(`[WhatsAppBot] Vídeo gerado no servidor com sucesso (${renderResult.videoSizeBytes} bytes)! Enviando para o WhatsApp...`);

      await this.completeJobAndSendVideo(job.id, renderResult.videoFilePath, {
        title: renderResult.title,
        filename: renderResult.filename,
        appBaseUrl: process.env.APP_URL,
        videoSizeBytes: renderResult.videoSizeBytes,
      });

      console.log(`[WhatsAppBot] Job ${job.id} finalizado e entregue com sucesso!`);
    } catch (renderErr: any) {
      console.error(`[WhatsAppBot] Erro na renderização do vídeo no servidor para o Job ${job.id}:`, renderErr);
      const isQuota =
        renderErr?.message?.includes('cooldown') ||
        renderErr?.message?.includes('429') ||
        renderErr?.message?.includes('quota') ||
        renderErr?.message?.includes('RESOURCE_EXHAUSTED');

      if (isQuota) {
        console.warn(`[WhatsAppBot] Limite de quota atingido nas chaves. Mantendo Job ${job.id} na fila para retentativa automática...`);
        this.updateJobProgress(job.id, {
          status: 'pending',
          statusText: 'Cota temporariamente atingida nas chaves de IA. Aguardando liberação para retentativa automática...',
        });
        this.processingQueue.push(job.id);
        setTimeout(() => this.processNextInQueue(), 45000);
        this.isRenderingQueue = false;
        return;
      }

      this.updateJobProgress(job.id, {
        status: 'error',
        error: renderErr?.message || 'Erro durante a renderização do vídeo no servidor.',
        statusText: 'Falha na produção do vídeo no servidor.',
      });

      if (this.sock && this.connectionState === 'connected' && job.groupId && !job.groupId.startsWith('sim-')) {
        try {
          const quoted = this.rawMessagesMap.get(job.id);
          await this.sock.sendMessage(
            job.groupId,
            {
              text: `⚠️ *Não foi possível gerar o vídeo:* ${renderErr?.message || 'Erro ao processar as mídias ou sintetizar a voz.'}\n\nPor favor, tente novamente com outro tema ou link!`,
            },
            quoted ? { quoted } : undefined
          );
        } catch {}
      }
    } finally {
      this.isRenderingQueue = false;
      setImmediate(() => this.processNextInQueue());
    }
  }

  private async sendStatusReply(jid: string, quotedMsg?: any) {
    if (!this.sock || this.connectionState !== 'connected') return;
    const active = this.jobs.filter((j) => j.status === 'pending' || j.status === 'processing' || j.status === 'rendering');
    const completedCount = this.jobs.filter((j) => j.status === 'completed').length;

    const lines = [
      `📊 *Status da Fila — IA Narrada*`,
      `• Em processamento no servidor: *${active.length}*`,
      `• Concluídos com sucesso: *${completedCount}*`,
    ];

    if (active.length > 0) {
      lines.push(``);
      for (const j of active.slice(0, 5)) {
        lines.push(`⏳ *${j.title || j.parsed.content.slice(0, 36)}* — ${j.progress}% (${j.statusText})`);
      }
    }

    try {
      await this.sock.sendMessage(jid, { text: lines.join('\n') }, quotedMsg ? { quoted: quotedMsg } : undefined);
    } catch {}
  }

  public updateJobProgress(
    jobId: string,
    updates: Partial<Pick<WhatsAppVideoJob, 'status' | 'progress' | 'statusText' | 'title' | 'error'>>
  ): WhatsAppVideoJob | null {
    const idx = this.jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) return null;

    this.jobs[idx] = {
      ...this.jobs[idx],
      ...updates,
      updatedAt: Date.now(),
    };
    this.persistJobs();
    return this.jobs[idx];
  }

  public async completeJobAndSendVideo(
    jobId: string,
    videoSource: Buffer | string,
    metadata: { title?: string; caption?: string; filename?: string; appBaseUrl?: string; videoSizeBytes?: number }
  ): Promise<WhatsAppVideoJob | null> {
    const idx = this.jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) return null;

    const job = this.jobs[idx];
    const safeFilename = `${jobId}.mp4`;
    const filePath = path.join(VIDEOS_DIR, safeFilename);

    let fileSize = metadata.videoSizeBytes || 0;
    if (typeof videoSource === 'string') {
      if (videoSource !== filePath && fs.existsSync(videoSource)) {
        fs.copyFileSync(videoSource, filePath);
      }
      if (!fileSize && fs.existsSync(filePath)) {
        fileSize = fs.statSync(filePath).size;
      }
    } else if (Buffer.isBuffer(videoSource)) {
      fs.writeFileSync(filePath, videoSource);
      fileSize = videoSource.length;
    }

    const videoTitle = metadata.title || job.title || 'Vídeo IA Narrada';
    job.title = videoTitle;
    job.videoFilePath = filePath;
    job.videoDownloadUrl = `/api/whatsapp/jobs/${jobId}/video`;
    job.status = 'sending_whatsapp';
    job.progress = 98;
    job.statusText = 'Enviando vídeo MP4 finalizado para o WhatsApp...';
    job.updatedAt = Date.now();
    this.persistJobs();

    const sizeMb = (fileSize / (1024 * 1024)).toFixed(1);
    const isLargeFile = fileSize > 40 * 1024 * 1024; // > 40MB send as Document

    let sentOk = false;
    if (this.sock && this.connectionState === 'connected' && job.groupId && !job.groupId.startsWith('sim-')) {
      const sendStart = Date.now();
      try {
        const quoted = this.rawMessagesMap.get(jobId);
        const formatLabel =
          job.parsed.aspectRatio === '9:16'
            ? '9:16 Vertical'
            : job.parsed.aspectRatio === '16:9'
            ? '16:9 Horizontal'
            : '1:1 Quadrado';

        const downloadLink = metadata.appBaseUrl
          ? `${metadata.appBaseUrl}/api/whatsapp/jobs/${jobId}/video`
          : `/api/whatsapp/jobs/${jobId}/video`;

        const captionText = [
          `✅ *Vídeo Concluído — IA Narrada!*`,
          `🎬 *${videoTitle}*`,
          `🎙️ Voz: ${job.parsed.voiceName} · Formato: ${formatLabel} · Tamanho: ${sizeMb} MB`,
          metadata.caption ? `\n${metadata.caption.slice(0, 280)}` : '',
          ``,
          `📥 *Link direto para download HD:* ${downloadLink}`,
        ]
          .filter(Boolean)
          .join('\n');

        const fileName = metadata.filename || `${videoTitle.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 36)}.mp4`;

        // Stream directly from disk without holding 30MB+ buffer in memory
        if (isLargeFile) {
          try {
            await this.sock.sendMessage(
              job.groupId,
              {
                document: { url: filePath },
                mimetype: 'video/mp4',
                fileName,
                caption: captionText,
              },
              quoted ? { quoted } : undefined
            );
            sentOk = true;
          } catch (streamErr) {
            console.warn('[WhatsAppBot] Fallback para envio com buffer (document):', streamErr);
            const buf = fs.readFileSync(filePath);
            await this.sock.sendMessage(
              job.groupId,
              {
                document: buf,
                mimetype: 'video/mp4',
                fileName,
                caption: captionText,
              },
              quoted ? { quoted } : undefined
            );
            sentOk = true;
          }
        } else {
          try {
            await this.sock.sendMessage(
              job.groupId,
              {
                video: { url: filePath },
                mimetype: 'video/mp4',
                fileName,
                caption: captionText,
              },
              quoted ? { quoted } : undefined
            );
            sentOk = true;
          } catch (streamErr) {
            console.warn('[WhatsAppBot] Fallback para envio com buffer (video):', streamErr);
            const buf = fs.readFileSync(filePath);
            await this.sock.sendMessage(
              job.groupId,
              {
                video: buf,
                mimetype: 'video/mp4',
                fileName,
                caption: captionText,
              },
              quoted ? { quoted } : undefined
            );
            sentOk = true;
          }
        }
        console.log(`[WhatsAppBot] [Perf] Envio para o WhatsApp concluído em ${Date.now() - sendStart}ms`);
      } catch (sendErr: any) {
        console.warn('Error sending video back to WhatsApp:', sendErr);
        job.error = `Vídeo gerado, mas houve falha no envio ao WhatsApp: ${sendErr?.message || 'Erro de rede'}`;
      }
    }

    job.status = 'completed';
    job.progress = 100;
    job.completedAt = Date.now();
    job.updatedAt = Date.now();
    job.sentToWhatsApp = sentOk;
    job.statusText = sentOk
      ? `✅ Vídeo MP4 (${sizeMb} MB) enviado de volta no WhatsApp com sucesso!`
      : `✅ Vídeo MP4 (${sizeMb} MB) concluído e salvo (pronto para envio/download)!`;

    this.persistJobs();
    return job;
  }

  public async resendJobVideoToWhatsApp(jobId: string, targetGroupId?: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || !job.videoFilePath || !fs.existsSync(job.videoFilePath)) {
      throw new Error('Arquivo de vídeo não encontrado para este pedido.');
    }
    if (!this.sock || this.connectionState !== 'connected') {
      throw new Error('WhatsApp não está conectado no momento.');
    }

    const destinationJid = targetGroupId || job.groupId;
    if (!destinationJid || destinationJid.startsWith('sim-')) {
      throw new Error('Selecione um grupo válido do WhatsApp para enviar o vídeo.');
    }

    const fileSize = fs.statSync(job.videoFilePath).size;
    const sizeMb = (fileSize / (1024 * 1024)).toFixed(1);
    const isLargeFile = fileSize > 40 * 1024 * 1024;
    const formatLabel =
      job.parsed.aspectRatio === '9:16'
        ? '9:16 Vertical'
        : job.parsed.aspectRatio === '16:9'
        ? '16:9 Horizontal'
        : '1:1 Quadrado';

    const captionText = [
      `✅ *Vídeo Concluído — IA Narrada!*`,
      `🎬 *${job.title || 'Vídeo Narrado'}*`,
      `🎙️ Voz: ${job.parsed.voiceName} · Formato: ${formatLabel} · Tamanho: ${sizeMb} MB`,
    ].join('\n');

    const fileName = `${(job.title || 'video-ia-narrada').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 36)}.mp4`;

    if (isLargeFile) {
      try {
        await this.sock.sendMessage(destinationJid, {
          document: { url: job.videoFilePath },
          mimetype: 'video/mp4',
          fileName,
          caption: captionText,
        });
      } catch {
        const videoBuffer = fs.readFileSync(job.videoFilePath);
        await this.sock.sendMessage(destinationJid, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName,
          caption: captionText,
        });
      }
    } else {
      try {
        await this.sock.sendMessage(destinationJid, {
          video: { url: job.videoFilePath },
          mimetype: 'video/mp4',
          fileName,
          caption: captionText,
        });
      } catch {
        const videoBuffer = fs.readFileSync(job.videoFilePath);
        await this.sock.sendMessage(destinationJid, {
          video: videoBuffer,
          mimetype: 'video/mp4',
          fileName,
          caption: captionText,
        });
      }
    }

    job.sentToWhatsApp = true;
    job.statusText = '✅ Vídeo MP4 enviado no WhatsApp com sucesso!';
    job.updatedAt = Date.now();
    this.persistJobs();
    return true;
  }

  public deleteJob(jobId: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) return false;
    const job = this.jobs[idx];
    if (job.videoFilePath && fs.existsSync(job.videoFilePath)) {
      try {
        fs.unlinkSync(job.videoFilePath);
      } catch {}
    }
    this.jobs.splice(idx, 1);
    this.persistJobs();
    return true;
  }

  public getJobVideoPath(jobId: string): string | null {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job?.videoFilePath && fs.existsSync(job.videoFilePath)) {
      return job.videoFilePath;
    }
    return null;
  }

  public getMediaFilePath(filename: string): string | null {
    const safeName = path.basename(filename);
    const target = path.join(MEDIA_DIR, safeName);
    if (fs.existsSync(target)) {
      return target;
    }
    return null;
  }
}

export const whatsappService = new WhatsAppAutomationService();
