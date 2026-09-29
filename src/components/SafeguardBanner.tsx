import React from 'react';
import { ShieldAlert, Zap, X, AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';
import { InterruptedSession } from '../utils/safeguard';

interface SafeguardBannerProps {
  interruptedSession: InterruptedSession | null;
  onResumeSession: () => void;
  onDismissSession: () => void;
  isPersistentStorageActive?: boolean;
}

export const SafeguardBanner: React.FC<SafeguardBannerProps> = ({
  interruptedSession,
  onResumeSession,
  onDismissSession,
  isPersistentStorageActive,
}) => {
  if (!interruptedSession) return null;

  const totalInterrupted =
    (interruptedSession.audioTasks?.length || 0) + (interruptedSession.videoTasks?.length || 0);

  if (totalInterrupted === 0) return null;

  const timeAgo = Math.round((Date.now() - interruptedSession.timestamp) / 60000);
  const timeText =
    timeAgo < 1 ? 'há poucos instantes' : timeAgo === 1 ? 'há 1 minuto' : `há ${timeAgo} minutos`;

  return (
    <div className="mb-6 rounded-2xl border border-amber-500/50 bg-gradient-to-r from-amber-950/60 via-neutral-900/90 to-amber-950/40 p-4 sm:p-5 shadow-2xl animate-in fade-in slide-in-from-top-3 duration-300">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 shrink-0 border border-amber-500/30">
            <ShieldAlert className="h-5 w-5" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
                <span>Salvaguarda de Sessão Ativa</span>
              </h3>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                {totalInterrupted} tarefa(s) recuperadas ({timeText})
              </span>
              {isPersistentStorageActive && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                  <ShieldCheck className="h-3 w-3" />
                  <span>Disco Seguro</span>
                </span>
              )}
            </div>

            <p className="text-xs text-neutral-300 max-w-2xl leading-relaxed">
              Identificamos que seu dispositivo foi desligado, a bateria descarregou ou a aba foi fechada durante o processamento.
              Nenhum dado foi perdido! Você pode retomar todas as tarefas agora mesmo.
            </p>

            {/* List preview of recovered tasks */}
            <div className="flex items-center gap-1.5 pt-1 flex-wrap">
              {interruptedSession.audioTasks?.map((t, idx) => (
                <span
                  key={t.id || idx}
                  className="inline-flex items-center gap-1 text-[10px] bg-neutral-900/80 text-neutral-300 px-2 py-0.5 rounded border border-neutral-700/60 font-mono truncate max-w-[200px]"
                >
                  <span>🎙️</span>
                  <span className="truncate">{t.title || 'Áudio Pendente'}</span>
                </span>
              ))}
              {interruptedSession.videoTasks?.map((t, idx) => (
                <span
                  key={t.id || idx}
                  className="inline-flex items-center gap-1 text-[10px] bg-neutral-900/80 text-amber-200 px-2 py-0.5 rounded border border-amber-700/60 font-mono truncate max-w-[280px]"
                >
                  <span>🎬</span>
                  <span className="truncate">
                    {t.title || 'Vídeo Pendente'}
                    {typeof t.progress === 'number' && t.progress > 0 ? ` (${t.progress}%)` : ''}
                    {typeof t.lastCompletedFrame === 'number' && t.lastCompletedFrame >= 0 && t.totalFrames
                      ? ` · Frame ${t.lastCompletedFrame + 1}/${t.totalFrames}`
                      : ''}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0 pt-2 sm:pt-0">
          <button
            type="button"
            onClick={onResumeSession}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs text-neutral-950 bg-amber-400 hover:bg-amber-300 active:scale-95 transition-all shadow-md cursor-pointer"
          >
            <Zap className="h-4 w-4" />
            <span>Retomar Renderização</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onDismissSession}
            className="inline-flex items-center justify-center p-2.5 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800/80 border border-neutral-800 transition-colors cursor-pointer"
            title="Dispensar sessão recuperada"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
