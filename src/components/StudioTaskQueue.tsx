import React from 'react';
import {
  Film,
  Download,
  Play,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  X,
  Volume2,
  Video,
  Layers,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { VideoAspectRatio } from '../types';

export interface StudioQueueItem {
  id: string;
  title: string;
  sourceLabel?: string;
  aspectRatio: VideoAspectRatio;
  status: 'queued' | 'extracting' | 'scripting' | 'synthesizing' | 'rendering' | 'completed' | 'error' | 'cancelled';
  progress: number;
  statusText: string;
  createdAt: number;
  completedAt?: number;
  videoBlob?: Blob;
  videoUrl?: string;
  downloadFilename?: string;
  error?: string;
  voiceName?: string;
  lastCompletedFrame?: number;
  totalFrames?: number;
}

interface StudioTaskQueueProps {
  items: StudioQueueItem[];
  activeItemId?: string | null;
  onSelectToView?: (item: StudioQueueItem) => void;
  onDownload?: (item: StudioQueueItem) => void;
  onCancel?: (itemId: string) => void;
  onResume?: (itemId: string) => void;
  onClearCompleted?: () => void;
}

export const StudioTaskQueue: React.FC<StudioTaskQueueProps> = ({
  items,
  activeItemId,
  onSelectToView,
  onDownload,
  onCancel,
  onResume,
  onClearCompleted,
}) => {
  if (!items || items.length === 0) return null;

  const activeCount = items.filter(
    (i) => i.status !== 'completed' && i.status !== 'error' && i.status !== 'cancelled'
  ).length;
  const completedCount = items.filter((i) => i.status === 'completed').length;

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/90 p-4 sm:p-5 shadow-2xl space-y-3.5 backdrop-blur-sm animate-in fade-in">
      {/* Header with real-time summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Layers className="h-5 w-5 text-cyan-400" />
            {activeCount > 0 && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>Fila de Produção em Segundo Plano</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                {items.length} {items.length === 1 ? 'projeto' : 'projetos'}
              </span>
            </h3>
            <p className="text-[11px] text-neutral-400">
              {activeCount > 0
                ? `${activeCount} vídeo(s) renderizando sem bloquear o editor. Você pode criar e disparar novos vídeos à vontade.`
                : `${completedCount} vídeo(s) finalizados prontos para assistir ou baixar.`}
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 text-xs font-mono">
              <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
              <span>{activeCount} em produção</span>
            </div>
          )}
          {completedCount > 0 && onClearCompleted && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="text-[11px] text-neutral-400 hover:text-white px-2 py-1 rounded bg-neutral-800/60 hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              Limpar Concluídos
            </button>
          )}
        </div>
      </div>

      {/* List of queue items */}
      <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
        {items.map((item) => {
          const isFinished = item.status === 'completed';
          const isError = item.status === 'error';
          const isCancelled = item.status === 'cancelled';
          const isRendering = item.status === 'rendering';
          const isSynthesizing = item.status === 'synthesizing';
          const isScripting = item.status === 'scripting';
          const isExtracting = item.status === 'extracting';
          const isQueued = item.status === 'queued';
          const isBusy = !isFinished && !isError && !isCancelled;
          const isSelected = activeItemId === item.id;

          return (
            <div
              key={item.id}
              className={`rounded-xl border p-3.5 transition-all ${
                isSelected
                  ? 'border-cyan-500/80 bg-cyan-950/20 ring-1 ring-cyan-500/40 shadow-lg'
                  : isFinished
                  ? 'border-emerald-800/50 bg-neutral-950/80 hover:border-emerald-700/70'
                  : isError || isCancelled
                  ? 'border-amber-800/60 bg-amber-950/15'
                  : 'border-neutral-800 bg-neutral-950/90 shadow-md'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Left: Info & status badge */}
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 ${
                        isFinished
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : isError || isCancelled
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : isQueued
                          ? 'bg-neutral-800 text-neutral-300'
                          : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                      }`}
                    >
                      {isFinished && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                      {isBusy && <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />}
                      {(isError || isCancelled) && <AlertCircle className="h-3 w-3 text-amber-400" />}
                      {isFinished
                        ? '100% Pronto'
                        : isRendering
                        ? 'Renderizando MP4'
                        : isSynthesizing
                        ? 'Sintetizando Voz'
                        : isScripting
                        ? 'Redigindo Roteiro'
                        : isExtracting
                        ? 'Extraindo Conteúdo'
                        : isQueued
                        ? 'Na Fila'
                        : isCancelled
                        ? `Pausado em ${item.progress}%`
                        : isError
                        ? `Interrompido em ${item.progress}%`
                        : item.status}
                    </span>

                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                      {item.aspectRatio}
                    </span>

                    {item.voiceName && (
                      <span className="text-[10px] font-medium text-neutral-400 flex items-center gap-1">
                        <Volume2 className="h-3 w-3 text-cyan-400" />
                        <span>{item.voiceName}</span>
                      </span>
                    )}

                    {item.sourceLabel && (
                      <span className="text-[10px] text-neutral-500 truncate max-w-[220px]">
                        • {item.sourceLabel}
                      </span>
                    )}
                  </div>

                  <h4 className="text-xs sm:text-sm font-semibold text-white truncate">
                    {item.title}
                  </h4>

                  {/* Status text */}
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span className="truncate">{item.statusText || 'Processando em segundo plano...'}</span>
                    <span className="font-mono font-bold ml-2 text-cyan-300 shrink-0">
                      {item.progress}%
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 rounded-full ${
                        isFinished
                          ? 'bg-emerald-500'
                          : isError || isCancelled
                          ? 'bg-amber-500'
                          : 'bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 animate-pulse'
                      }`}
                      style={{ width: `${Math.max(4, Math.min(100, item.progress))}%` }}
                    />
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {(isError || isCancelled) && onResume && (
                    <button
                      type="button"
                      onClick={() => onResume(item.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 shadow-md shadow-amber-950/50 transition-all cursor-pointer"
                      title={`Retomar renderização exatamente de onde parou (${item.progress}%)`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Retomar Renderização ({item.progress}%)</span>
                    </button>
                  )}

                  {isFinished && onDownload && item.videoBlob && (
                    <button
                      type="button"
                      onClick={() => onDownload(item)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/50 transition-all cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Baixar Vídeo</span>
                    </button>
                  )}

                  {isFinished && onSelectToView && (
                    <button
                      type="button"
                      onClick={() => onSelectToView(item)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-500 text-neutral-950 border-cyan-400 font-bold'
                          : 'bg-neutral-800 text-neutral-200 border-neutral-700 hover:bg-neutral-700 hover:text-white'
                      }`}
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>{isSelected ? 'No Player' : 'Carregar no Editor'}</span>
                    </button>
                  )}

                  {isBusy && onCancel && (
                    <button
                      type="button"
                      onClick={() => onCancel(item.id)}
                      className="p-1.5 text-neutral-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                      title="Cancelar esta produção"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
