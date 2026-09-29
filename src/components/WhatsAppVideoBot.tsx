import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  QrCode,
  Smartphone,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  Users,
  Settings,
  Play,
  Download,
  Trash2,
  Copy,
  Check,
  Sparkles,
  Film,
  Terminal,
  Power,
  Share2,
  Image as ImageIcon,
  Video as VideoIcon,
  Sliders,
  HelpCircle,
  X,
  Volume2,
} from 'lucide-react';
import { CURATED_VOICES } from '../constants/voices';

interface WhatsAppGroupInfo {
  id: string;
  subject: string;
  participantsCount: number;
  desc?: string;
}

interface WhatsAppBotConfig {
  enabled: boolean;
  monitoredGroupIds: string[];
  allowDirectMessages: boolean;
  autoDetectNewsLinks: boolean;
  requireCommandPrefix: boolean;
  defaultAspectRatio: '9:16' | '16:9' | '1:1';
  defaultVoiceId: string;
  defaultDurationSeconds: number;
  defaultShowSubtitles: boolean;
  defaultEnableBgMusic: boolean;
  sendProgressUpdates: boolean;
}

interface WhatsAppCommandParsed {
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
  customMedia?: {
    url: string;
    mediaType: 'image' | 'video';
    filename: string;
    caption?: string;
  };
}

export interface WhatsAppVideoJob {
  id: string;
  groupId: string;
  groupName: string;
  senderJid: string;
  senderName: string;
  rawMessage: string;
  parsed: WhatsAppCommandParsed;
  status: 'pending' | 'processing' | 'rendering' | 'sending_whatsapp' | 'completed' | 'error';
  progress: number;
  statusText: string;
  title?: string;
  videoDownloadUrl?: string;
  customMedia?: {
    url: string;
    mediaType: 'image' | 'video';
    filename: string;
    caption?: string;
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  sentToWhatsApp?: boolean;
}

interface WhatsAppVideoBotProps {
  onSwitchStudioMode?: (mode: 'reportagem' | 'escrita' | 'whatsapp') => void;
}

const COMMAND_EXAMPLES = [
  {
    cmd: '/funções',
    badge: 'Central de Funções',
    category: 'Geral',
    description: 'Envia o menu completo com todos os comandos, atalhos, configurações e modo de uso de fotos/vídeos.',
    example: '/funções',
  },
  {
    cmd: '/vozes',
    badge: 'Catálogo de Vozes',
    category: 'Áudio & Voz',
    description: 'Lista todas as vozes neurais com nomes, estilos e instruções de como selecionar cada uma.',
    example: '/vozes',
  },
  {
    cmd: '/voz <nome>',
    badge: 'Troca Dinâmica de Voz',
    category: 'Áudio & Voz',
    description: 'Muda a voz padrão do chat de forma permanente (ex: Antônio, Francisca, Bruno, Thalita, André).',
    example: '/voz antonio',
  },
  {
    cmd: '/formato <proporção>',
    badge: 'Formato do Vídeo',
    category: 'Vídeo',
    description: 'Altera o formato padrão para 9:16 (Vertical/Reels), 16:9 (Horizontal/YouTube) ou 1:1 (Quadrado/Feed).',
    example: '/formato 16:9',
  },
  {
    cmd: '/duracao <segundos>',
    badge: 'Tempo Alvo',
    category: 'Configuração',
    description: 'Define a duração aproximada do vídeo em segundos (ex: 35s, 60s, 90s, 120s ou 180s).',
    example: '/duracao 90',
  },
  {
    cmd: '/musica <estilo|off>',
    badge: 'Trilha Sonora',
    category: 'Áudio & Voz',
    description: 'Escolhe o estilo da música de fundo (lofi, cinematic, news, acoustic, piano) ou desativa com /musica off.',
    example: '/musica lofi',
  },
  {
    cmd: '/legenda <on|off>',
    badge: 'Legendas Dinâmicas',
    category: 'Vídeo',
    description: 'Ativa ou desativa a sobreposição de legendas sincronizadas palavra por palavra.',
    example: '/legenda on',
  },
  {
    cmd: '/config',
    badge: 'Minhas Configurações',
    category: 'Configuração',
    description: 'Mostra todas as preferências ativas deste chat (voz, formato, duração, música e legendas). Use /config reset para restaurar.',
    example: '/config',
  },
  {
    cmd: '📸 Enviar Foto/Vídeo',
    badge: 'Mídia Customizada',
    category: 'Mídia',
    description: 'Envie uma foto ou vídeo com /video na legenda (ou responda a qualquer mídia) para incluí-la diretamente no vídeo!',
    example: '/video Conte uma história misteriosa sobre este local #16:9',
  },
  {
    cmd: '/materia <link>',
    badge: 'Matéria para Vídeo',
    category: 'Criação',
    description: 'Extrai fotos, texto e informações de notícias (G1, UOL, CNN, etc.) e produz a reportagem narrada.',
    example: '/materia https://g1.globo.com/tecnologia/ #9:16 #voz:antonio',
  },
  {
    cmd: '/video <história>',
    badge: 'Roteiro Completo',
    category: 'Criação',
    description: 'Transforma sua história ou texto em vídeo narrado com trilha sonora e imagens sincronizadas.',
    example: '/video Os segredos guardados na biblioteca de Alexandria e seu impacto na humanidade #16:9 #voz:bruno',
  },
  {
    cmd: '/ideia <tema>',
    badge: 'Ideia com IA',
    category: 'Criação',
    description: 'A IA cria uma história inédita a partir de um tema curto e renderiza o vídeo MP4 pronto.',
    example: '/ideia As 5 invenções da antiguidade que parecem tecnologia moderna #duracao:60s #voz:francisca',
  },
  {
    cmd: '/status',
    badge: 'Consulta da Fila',
    category: 'Geral',
    description: 'Responde no WhatsApp com o progresso de cada vídeo sendo processado no momento.',
    example: '/status',
  },
];

export const WhatsAppVideoBot: React.FC<WhatsAppVideoBotProps> = ({ onSwitchStudioMode }) => {
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'qr_ready' | 'connected'>('disconnected');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [connectedUser, setConnectedUser] = useState<{ id: string; name?: string; phone?: string } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [groups, setGroups] = useState<WhatsAppGroupInfo[]>([]);
  const [config, setConfig] = useState<WhatsAppBotConfig>({
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
    sendProgressUpdates: true,
  });
  const [jobs, setJobs] = useState<WhatsAppVideoJob[]>([]);

  // UI local states
  const [authMethod, setAuthMethod] = useState<'qr' | 'pairing'>('qr');
  const [phoneInput, setPhoneInput] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isRefreshingGroups, setIsRefreshingGroups] = useState<boolean>(false);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [testMessage, setTestMessage] = useState<string>('');
  const [testTargetGroupId, setTestTargetGroupId] = useState<string>('');
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [resendingJobId, setResendingJobId] = useState<string | null>(null);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('Todas');
  const [simulatedReply, setSimulatedReply] = useState<{ text: string; cmd?: string } | null>(null);

  // Track which WhatsApp job IDs have already been dispatched to IA Narrada in this browser session
  const dispatchedJobIdsRef = useRef<Set<string>>(new Set());

  const showToast = (msg: string) => {
    setFeedbackBanner(msg);
    setTimeout(() => setFeedbackBanner(null), 5000);
  };

  // Poll WhatsApp status & automatically dispatch pending jobs to IA Narrada studios
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp/status');
      if (!res.ok) return;
      const data = await res.json();

      setConnectionState(data.connectionState || 'disconnected');
      setQrCodeDataUrl(data.qrCodeDataUrl || null);
      setPairingCode(data.pairingCode || null);
      setConnectedUser(data.connectedUser || null);
      setLastError(data.lastError || null);
      if (Array.isArray(data.groups)) {
        setGroups(data.groups);
      }
      if (data.config) {
        setConfig(data.config);
      }
      if (Array.isArray(data.jobs)) {
        setJobs(data.jobs);
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleConnect = async () => {
    setIsConnecting(true);
    setLastError(null);
    try {
      const body = authMethod === 'pairing' ? { phoneNumber: phoneInput } : {};
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao conectar');
      }
      await fetchStatus();
    } catch (err: any) {
      setLastError(err.message || 'Falha ao conectar');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/whatsapp/disconnect', { method: 'POST' });
      await fetchStatus();
      showToast('WhatsApp desconectado com sucesso.');
    } catch {}
  };

  const handleRefreshGroups = async () => {
    setIsRefreshingGroups(true);
    try {
      const res = await fetch('/api/whatsapp/refresh-groups', { method: 'POST' });
      const data = await res.json();
      if (Array.isArray(data.groups)) {
        setGroups(data.groups);
        showToast(`${data.groups.length} grupo(s) sincronizado(s) do seu WhatsApp!`);
      }
    } catch {
    } finally {
      setIsRefreshingGroups(false);
    }
  };

  const handleUpdateConfig = async (updates: Partial<WhatsAppBotConfig>) => {
    const optimistic = { ...config, ...updates };
    setConfig(optimistic);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.config) setConfig(data.config);
      showToast('Configurações de automação do WhatsApp salvas!');
    } catch {}
  };

  const handleToggleMonitoredGroup = (groupId: string) => {
    const current = config.monitoredGroupIds || [];
    const exists = current.includes(groupId);
    const next = exists ? current.filter((id) => id !== groupId) : [...current, groupId];
    handleUpdateConfig({ monitoredGroupIds: next });
  };

  const handleSendTestCommand = async (customCmd?: string) => {
    const msgToSend = (customCmd ?? testMessage).trim();
    if (!msgToSend) return;

    setIsSendingTest(true);
    try {
      const selectedGroupId =
        testTargetGroupId ||
        config.monitoredGroupIds[0] ||
        (groups[0]?.id ?? 'sim-group@g.us');
      const selectedGroupObj = groups.find((g) => g.id === selectedGroupId);

      const res = await fetch('/api/whatsapp/simulate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msgToSend,
          groupId: selectedGroupId,
          groupName: selectedGroupObj?.subject || 'Grupo de Teste (Painel)',
          senderName: connectedUser?.name || 'Você (Painel)',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Comando inválido');
      }

      if (data.isCommand && data.replyText) {
        setSimulatedReply({ text: data.replyText, cmd: msgToSend });
        showToast('💬 Resposta do bot simulada com sucesso!');
      } else if (data.isJob && data.job) {
        showToast('🎬 Pedido de vídeo enfileirado! O estúdio IA Narrada já iniciou a produção automática.');
        setSimulatedReply(null);
      }

      if (!customCmd) setTestMessage('');
      await fetchStatus();
    } catch (err: any) {
      setLastError(err.message || 'Erro ao disparar comando');
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleResendVideo = async (job: WhatsAppVideoJob) => {
    setResendingJobId(job.id);
    try {
      const targetGroup =
        job.groupId && !job.groupId.startsWith('sim-')
          ? job.groupId
          : config.monitoredGroupIds[0] || groups[0]?.id;
      const res = await fetch(`/api/whatsapp/jobs/${job.id}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetGroupId: targetGroup }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao reenviar');
      }
      showToast('Vídeo reenviado ao grupo no WhatsApp com sucesso!');
      await fetchStatus();
    } catch (err: any) {
      showToast(err.message || 'Erro ao reenviar vídeo');
    } finally {
      setResendingJobId(null);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      await fetch(`/api/whatsapp/jobs/${jobId}`, { method: 'DELETE' });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      showToast('Item removido da lista.');
    } catch {}
  };

  const filteredGroups = groups.filter((g) =>
    g.subject.toLowerCase().includes(groupFilter.toLowerCase())
  );

  const categories = ['Todas', 'Geral', 'Criação', 'Áudio & Voz', 'Vídeo', 'Mídia', 'Configuração'];
  const displayedExamples = COMMAND_EXAMPLES.filter((item) =>
    activeCategoryFilter === 'Todas' ? true : item.category === activeCategoryFilter
  );

  return (
    <div className="space-y-6">
      {/* Toast Banner */}
      {feedbackBanner && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-500 text-neutral-950 font-bold text-xs shadow-2xl animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedbackBanner}</span>
        </div>
      )}

      {/* Top Hero Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-950/70 via-neutral-900 to-teal-950/60 border border-emerald-900/40 p-6 shadow-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Automação Total WhatsApp Bot · Baileys Socket</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Bot do WhatsApp para Produção Autônoma de Vídeos
            </h1>
            <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
              Conecte qualquer número de WhatsApp para escutar comandos como <code className="text-emerald-400 font-mono">/funções</code>, <code className="text-emerald-400 font-mono">/materia</code>, <code className="text-emerald-400 font-mono">/video</code> ou <code className="text-emerald-400 font-mono">/voz antonio</code>. Usuários podem enviar fotos e vídeos que são incorporados dinamicamente no vídeo final entregue em alta qualidade.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-neutral-950/80 border border-neutral-800 text-xs">
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  connectionState === 'connected'
                    ? 'bg-emerald-400 animate-pulse'
                    : connectionState === 'connecting' || connectionState === 'qr_ready'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-neutral-600'
                }`}
              />
              <span className="font-semibold text-neutral-200">
                {connectionState === 'connected'
                  ? `Conectado: ${connectedUser?.name || connectedUser?.phone || 'WhatsApp'}`
                  : connectionState === 'qr_ready'
                  ? 'Aguardando Leitura do QR Code'
                  : connectionState === 'connecting'
                  ? 'Iniciando Conexão...'
                  : 'Desconectado'}
              </span>
            </div>

            {connectionState === 'connected' ? (
              <button
                type="button"
                onClick={handleDisconnect}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Power className="h-3.5 w-3.5" />
                <span>Desconectar</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={isConnecting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-bold shadow-lg shadow-emerald-950/50 transition-all cursor-pointer"
              >
                <QrCode className="h-4 w-4" />
                <span>Conectar WhatsApp</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Connection Box & Group Monitoring Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (5 cols): WhatsApp Connection & Authentication */}
        <div className="lg:col-span-5 bg-neutral-900/90 border border-neutral-800 rounded-2xl p-5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
            <div className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white tracking-tight">
                Conexão com Aparelho
              </h2>
            </div>
            <span
              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                connectionState === 'connected'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-neutral-800 text-neutral-400'
              }`}
            >
              {connectionState === 'connected' ? 'Ativo' : 'Offline'}
            </span>
          </div>

          {lastError && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-900/60 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{lastError}</span>
            </div>
          )}

          {connectionState === 'connected' ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Sessão Autenticada e Pronta</span>
                </div>
                <div className="text-xs text-neutral-300 space-y-1">
                  <div>
                    <span className="text-neutral-500">Nome: </span>
                    <strong className="text-white">{connectedUser?.name || 'WhatsApp'}</strong>
                  </div>
                  <div>
                    <span className="text-neutral-500">Telefone: </span>
                    <span className="font-mono text-neutral-200">+{connectedUser?.phone || '–'}</span>
                  </div>
                  <div>
                    <span className="text-neutral-500">JID: </span>
                    <span className="font-mono text-[10px] text-neutral-400 break-all">{connectedUser?.id}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefreshGroups}
                  disabled={isRefreshingGroups}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-200 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingGroups ? 'animate-spin' : ''}`} />
                  <span>Sincronizar Grupos</span>
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-neutral-800 hover:bg-rose-950 hover:text-rose-300 text-xs font-semibold text-neutral-300 transition-colors cursor-pointer"
                >
                  <Power className="h-3.5 w-3.5" />
                  <span>Desconectar</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="flex rounded-xl bg-neutral-950 p-1 border border-neutral-800">
                <button
                  type="button"
                  onClick={() => setAuthMethod('qr')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    authMethod === 'qr'
                      ? 'bg-neutral-800 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <QrCode className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Conectar via QR Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMethod('pairing')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    authMethod === 'pairing'
                      ? 'bg-neutral-800 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Smartphone className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Código por Número</span>
                </button>
              </div>

              {authMethod === 'pairing' && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-neutral-300">
                    Número do WhatsApp (com DDD)
                  </label>
                  <input
                    type="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleConnect();
                      }
                    }}
                    placeholder="Ex: 11988887777 ou 5511988887777"
                    className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3.5 py-2.5 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              )}

              {/* Display QR Code if ready */}
              {qrCodeDataUrl && authMethod === 'qr' && (
                <div className="flex flex-col items-center justify-center bg-white rounded-2xl p-4 space-y-2 shadow-inner">
                  <img
                    src={qrCodeDataUrl}
                    alt="QR Code do WhatsApp"
                    className="w-56 h-56 object-contain"
                  />
                  <p className="text-[11px] font-semibold text-neutral-800 text-center">
                    Abra o WhatsApp → Aparelhos Conectados → Conectar um Aparelho
                  </p>
                </div>
              )}

              {/* Pairing Code */}
              {pairingCode && authMethod === 'pairing' && (
                <div className="rounded-xl bg-neutral-950 border border-cyan-800/80 p-4 text-center space-y-2.5">
                  <div className="text-xs text-cyan-300 font-semibold">
                    Digite este código no seu WhatsApp:
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    <div className="text-2xl sm:text-3xl font-mono font-extrabold tracking-widest text-white bg-neutral-900 px-4 py-2 rounded-xl border border-neutral-800">
                      {pairingCode}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(pairingCode.replace('-', ''));
                        showToast('Código copiado para a área de transferência!');
                      }}
                      className="p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors cursor-pointer"
                      title="Copiar código"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleConnect}
                disabled={isConnecting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-xs sm:text-sm font-bold text-white shadow-lg shadow-emerald-950/50 transition-all cursor-pointer"
              >
                {isConnecting || connectionState === 'connecting' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Conectando com WhatsApp...</span>
                  </>
                ) : (
                  <>
                    <QrCode className="h-4 w-4" />
                    <span>
                      {qrCodeDataUrl
                        ? 'Atualizar QR Code'
                        : authMethod === 'pairing'
                        ? 'Gerar Código de Pareamento'
                        : 'Gerar QR Code para Conectar'}
                    </span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Right Column (7 cols): Monitored Groups & Default Configurations */}
        <div className="lg:col-span-7 bg-neutral-900/90 border border-neutral-800 rounded-2xl p-5 space-y-5 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800 pb-4">
            <div className="flex items-center gap-2.5">
              <Users className="h-5 w-5 text-emerald-400" />
              <div>
                <h2 className="text-base font-bold text-white tracking-tight">
                  Grupo(s) Monitorados & Regras Padrão
                </h2>
                <p className="text-xs text-neutral-400">
                  O bot aceita comandos de grupos específicos ou de qualquer conversa
                </p>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => handleUpdateConfig({ enabled: e.target.checked })}
                className="rounded border-neutral-700 bg-neutral-950 text-emerald-500 focus:ring-emerald-500"
              />
              <span className="text-xs font-semibold text-neutral-200">
                Automação Ativa
              </span>
            </label>
          </div>

          {/* Group Selector List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-neutral-300">
                Grupos Selecionados ({config.monitoredGroupIds.length === 0 ? 'Todos os grupos autorizados' : `${config.monitoredGroupIds.length} grupo(s)`})
              </span>
              {config.monitoredGroupIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleUpdateConfig({ monitoredGroupIds: [] })}
                  className="text-[11px] text-neutral-400 hover:text-white underline cursor-pointer"
                >
                  Liberar para qualquer grupo
                </button>
              )}
            </div>

            {groups.length > 0 ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  placeholder="Filtrar grupos pelo nome..."
                  className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-neutral-700"
                />
                <div className="max-h-44 overflow-y-auto divide-y divide-neutral-800/70 rounded-xl border border-neutral-800 bg-neutral-950">
                  {filteredGroups.map((grp) => {
                    const isSelected = config.monitoredGroupIds.includes(grp.id);
                    return (
                      <label
                        key={grp.id}
                        className={`flex items-center justify-between px-3.5 py-2.5 text-xs cursor-pointer transition-colors ${
                          isSelected ? 'bg-emerald-950/30 text-white' : 'text-neutral-300 hover:bg-neutral-900'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleMonitoredGroup(grp.id)}
                            className="rounded border-neutral-700 bg-neutral-900 text-emerald-500"
                          />
                          <span className="font-medium truncate">{grp.subject}</span>
                        </div>
                        <span className="text-[11px] text-neutral-500 shrink-0 ml-2">
                          {grp.participantsCount > 0 ? `${grp.participantsCount} membros` : 'Grupo'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-neutral-950 border border-neutral-800/80 p-3.5 text-xs text-neutral-400 flex items-center justify-between gap-3">
                <span>
                  {connectionState === 'connected'
                    ? 'Clique em "Sincronizar Grupos" para carregar seus grupos ou envie um comando no grupo para detectá-lo automaticamente.'
                    : 'Conecte seu WhatsApp ao lado para sincronizar os grupos da sua conta.'}
                </span>
                {connectionState === 'connected' && (
                  <button
                    type="button"
                    onClick={handleRefreshGroups}
                    className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-semibold shrink-0 cursor-pointer"
                  >
                    Listar Grupos
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Default Parameters for WhatsApp Videos */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-neutral-400">
                Formato Padrão do Vídeo
              </label>
              <select
                value={config.defaultAspectRatio}
                onChange={(e) =>
                  handleUpdateConfig({ defaultAspectRatio: e.target.value as '9:16' | '16:9' | '1:1' })
                }
                className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-600"
              >
                <option value="9:16">9:16 Vertical (Reels / Shorts / TikTok)</option>
                <option value="16:9">16:9 Horizontal (YouTube / TV)</option>
                <option value="1:1">1:1 Quadrado (Feed Instagram / Posts)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-neutral-400">
                Voz Neural Padrão
              </label>
              <select
                value={config.defaultVoiceId}
                onChange={(e) => handleUpdateConfig({ defaultVoiceId: e.target.value })}
                className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-600"
              >
                {CURATED_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.gender})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-neutral-400">
                Duração Alvo Padrão
              </label>
              <select
                value={config.defaultDurationSeconds}
                onChange={(e) =>
                  handleUpdateConfig({ defaultDurationSeconds: parseInt(e.target.value, 10) })
                }
                className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-600"
              >
                <option value={35}>~35 segundos (Rápido)</option>
                <option value={60}>~1 minuto (Padrão)</option>
                <option value={90}>~1m 30s (Completo)</option>
                <option value={120}>~2 minutos (Aprofundado)</option>
                <option value={180}>~3 minutos (Documentário)</option>
              </select>
            </div>
          </div>

          {/* Behavior checkboxes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-xs text-neutral-300">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.autoDetectNewsLinks}
                onChange={(e) => handleUpdateConfig({ autoDetectNewsLinks: e.target.checked })}
                className="rounded border-neutral-700 bg-neutral-950 text-emerald-500"
              />
              <span>Detectar links de notícias automaticamente</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.defaultShowSubtitles}
                onChange={(e) => handleUpdateConfig({ defaultShowSubtitles: e.target.checked })}
                className="rounded border-neutral-700 bg-neutral-950 text-emerald-500"
              />
              <span>Legendas dinâmicas sincronizadas</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.defaultEnableBgMusic}
                onChange={(e) => handleUpdateConfig({ defaultEnableBgMusic: e.target.checked })}
                className="rounded border-neutral-700 bg-neutral-950 text-emerald-500"
              />
              <span>Trilha sonora com auto-ducking</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.sendProgressUpdates}
                onChange={(e) => handleUpdateConfig({ sendProgressUpdates: e.target.checked })}
                className="rounded border-neutral-700 bg-neutral-950 text-emerald-500"
              />
              <span>Avisar no chat quando o pedido for aceito</span>
            </label>
          </div>
        </div>
      </div>

      {/* Interactive Simulated WhatsApp Bubble (when testing commands like /funções, /config, /voz) */}
      {simulatedReply && (
        <div className="rounded-2xl bg-neutral-900 border border-emerald-800/80 p-5 space-y-3 shadow-2xl animate-in fade-in">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
              <MessageSquare className="h-4 w-4" />
              <span>Resposta Simulada do Bot no WhatsApp (Comando: {simulatedReply.cmd})</span>
            </div>
            <button
              type="button"
              onClick={() => setSimulatedReply(null)}
              className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-200 font-mono whitespace-pre-wrap leading-relaxed shadow-inner max-h-80 overflow-y-auto">
            {simulatedReply.text}
          </div>
        </div>
      )}

      {/* Central de Funções & Comandos Dinâmicos Reference */}
      <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-5 space-y-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Terminal className="h-5 w-5 text-emerald-400" />
            <div>
              <h3 className="text-base font-bold text-white">
                Central de Funções & Comandos Dinâmicos (/funções)
              </h3>
              <p className="text-xs text-neutral-400">
                Todos os comandos podem ser enviados diretamente no WhatsApp ou testados agora pelo painel
              </p>
            </div>
          </div>

          {/* Category filter tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategoryFilter(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activeCategoryFilter === cat
                    ? 'bg-emerald-600 text-white font-bold'
                    : 'bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {displayedExamples.map((item) => (
            <div
              key={item.cmd}
              className="rounded-xl bg-neutral-950 border border-neutral-800/90 p-4 flex flex-col justify-between gap-3 hover:border-neutral-700 transition-colors"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs sm:text-sm font-bold text-emerald-400 font-mono">
                    {item.cmd}
                  </code>
                  <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-neutral-900 text-neutral-400 border border-neutral-800">
                    {item.badge}
                  </span>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  {item.description}
                </p>
              </div>

              <div className="space-y-2 pt-1 border-t border-neutral-900">
                <div className="rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-[11px] font-mono text-neutral-200 break-all select-all">
                  {item.example}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(item.example);
                      setCopiedCmd(item.cmd);
                      setTimeout(() => setCopiedCmd(null), 2000);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] font-semibold text-neutral-200 transition-colors cursor-pointer"
                  >
                    {copiedCmd === item.cmd ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span>Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copiar</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSendTestCommand(item.example)}
                    disabled={isSendingTest}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800/70 text-[11px] font-semibold text-emerald-300 transition-colors cursor-pointer"
                  >
                    <Play className="h-3 w-3" />
                    <span>Testar Agora</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Direct Interactive Command Input */}
        <div className="pt-3 border-t border-neutral-800/80 space-y-2">
          <label className="block text-xs font-semibold text-neutral-300">
            Simulador de Mensagem / Teste de Comando:
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            {groups.length > 0 && (
              <select
                value={testTargetGroupId}
                onChange={(e) => setTestTargetGroupId(e.target.value)}
                className="sm:w-56 rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-600"
              >
                <option value="">Grupo de Teste Padrão</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.subject}
                  </option>
                ))}
              </select>
            )}
            <input
              type="text"
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendTestCommand();
                }
              }}
              placeholder="Digite qualquer comando (ex: /funções, /vozes, /voz antonio, /formato 1:1, /duracao 90, /video História do café #16:9)..."
              className="flex-1 rounded-xl bg-neutral-950 border border-neutral-800 px-3.5 py-2.5 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-emerald-600"
            />
            <button
              type="button"
              onClick={() => handleSendTestCommand()}
              disabled={isSendingTest || !testMessage.trim()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-bold text-white transition-colors cursor-pointer shrink-0"
            >
              {isSendingTest ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span>Executar</span>
            </button>
          </div>
        </div>
      </div>

      {/* Live Video Production Queue & Delivered Videos */}
      <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Film className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-base font-bold text-white">
                Fila de Processamento & Vídeos Entregues ao WhatsApp ({jobs.length})
              </h3>
              <p className="text-xs text-neutral-400">
                Acompanhe a renderização em tempo real e os vídeos MP4 enviados de volta aos chats
              </p>
            </div>
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="rounded-xl bg-neutral-950 border border-neutral-800/80 p-8 text-center space-y-2">
            <MessageSquare className="h-8 w-8 text-neutral-600 mx-auto" />
            <div className="text-sm font-semibold text-neutral-300">
              Nenhum vídeo na fila no momento
            </div>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              Envie comandos como <code className="text-emerald-400">/video</code> ou <code className="text-emerald-400">/materia</code> no WhatsApp (ou use o simulador acima) para iniciar a produção automatizada.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const isCompleted = job.status === 'completed';
              const isError = job.status === 'error';
              const isActive = !isCompleted && !isError;
              const hasCustomMedia = Boolean(job.customMedia || job.parsed?.customMedia);

              return (
                <div
                  key={job.id}
                  className="rounded-xl bg-neutral-950 border border-neutral-800 p-4 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                        <span className="font-semibold text-emerald-400">
                          {job.parsed.studioMode === 'reportagem'
                            ? '📰 Matéria para Vídeo'
                            : '✨ Roteiro Criativo'}
                        </span>
                        <span>·</span>
                        <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 font-mono text-[11px] text-white">
                          {job.parsed.aspectRatio || '9:16'}
                        </span>
                        <span>·</span>
                        <span>Voz: {job.parsed.voiceName}</span>
                        {hasCustomMedia && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-[10px] text-cyan-300 font-semibold">
                            {job.customMedia?.mediaType === 'video' ? (
                              <VideoIcon className="h-3 w-3" />
                            ) : (
                              <ImageIcon className="h-3 w-3" />
                            )}
                            <span>Mídia Própria Anexada</span>
                          </span>
                        )}
                        <span>·</span>
                        <span>{job.groupName}</span>
                      </div>

                      <div className="text-sm font-bold text-white truncate">
                        {job.title || job.parsed.content}
                      </div>

                      <div className="text-xs text-neutral-400 font-mono truncate">
                        Comando: {job.rawMessage}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isActive && onSwitchStudioMode && (
                        <button
                          type="button"
                          onClick={() =>
                            onSwitchStudioMode(
                              job.parsed.studioMode === 'reportagem' ? 'reportagem' : 'escrita'
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-200 transition-colors cursor-pointer"
                        >
                          Ver no Estúdio
                        </button>
                      )}

                      {isCompleted && job.videoDownloadUrl && (
                        <>
                          <a
                            href={job.videoDownloadUrl}
                            download={`${(job.title || 'video-whatsapp').slice(0, 40)}.mp4`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 text-xs font-semibold text-emerald-300 transition-colors cursor-pointer"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Baixar MP4</span>
                          </a>

                          <button
                            type="button"
                            onClick={() => handleResendVideo(job)}
                            disabled={resendingJobId === job.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-white transition-colors cursor-pointer"
                            title="Reenviar este vídeo para o WhatsApp"
                          >
                            {resendingJobId === job.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Share2 className="h-3.5 w-3.5 text-emerald-400" />
                            )}
                            <span>Reenviar no WhatsApp</span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDeleteJob(job.id)}
                        className="p-1.5 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-neutral-900 transition-colors cursor-pointer"
                        title="Remover do histórico"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar & Status */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={
                          isError
                            ? 'text-rose-400 font-medium'
                            : isCompleted
                            ? 'text-emerald-400 font-medium'
                            : 'text-cyan-300 font-medium'
                        }
                      >
                        {job.error || job.statusText}
                      </span>
                      <span className="font-mono font-bold text-neutral-300">
                        {job.progress}%
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-neutral-900 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isError
                            ? 'bg-rose-600'
                            : isCompleted
                            ? 'bg-emerald-500'
                            : 'bg-gradient-to-r from-emerald-500 to-cyan-400'
                        }`}
                        style={{ width: `${Math.max(4, Math.min(100, job.progress))}%` }}
                      />
                    </div>
                  </div>

                  {/* Inline Video Preview when completed */}
                  {isCompleted && job.videoDownloadUrl && (
                    <div className="pt-2">
                      <video
                        src={job.videoDownloadUrl}
                        controls
                        className="max-h-64 rounded-xl border border-neutral-800 bg-black"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
