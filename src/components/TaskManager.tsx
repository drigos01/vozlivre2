import React, { useState } from 'react';
import {
  Volume2,
  Film,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  Play,
  Pause,
  Download,
  Trash2,
  ChevronDown,
  ChevronUp,
  Layers,
  Zap,
  Clock,
  ArrowRight,
  RotateCcw,
  Maximize2,
  Eye,
} from 'lucide-react';
import { AudioTask, VideoTask, GeneratedAudio } from '../types';
import { formatTime, formatBytes } from '../utils/audio';

interface TaskManagerProps {
  audioTasks: AudioTask[];
  videoTasks: VideoTask[];
  onCancelAudioTask: (id: string) => void;
  onCancelVideoTask: (id: string) => void;
  onResumeVideoTask?: (id: string) => void;
  onClearCompletedTasks: () => void;
  onPlayAudio?: (audio: GeneratedAudio) => void;
  onSendToVideo?: (audio: GeneratedAudio) => void;
  onLoadTextToEditor?: (text: string, title?: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const TaskManager: React.FC<TaskManagerProps> = ({
  audioTasks,
  videoTasks,
  onCancelAudioTask,
  onCancelVideoTask,
  onResumeVideoTask,
  onClearCompletedTasks,
  onPlayAudio,
  onSendToVideo,
  onLoadTextToEditor,
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'audio' | 'video'>('all');
  const [previewVideo, setPreviewVideo] = useState<VideoTask | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const activeAudioCount = audioTasks.filter((t) => t.status === 'processing' || t.status === 'queued').length;
  const activeVideoCount = videoTasks.filter((t) => t.status === 'rendering' || t.status === 'preparing' || t.status === 'queued').length;
  const totalActive = activeAudioCount + activeVideoCount;

  const completedAudioCount = audioTasks.filter((t) => t.status === 'completed').length;
  const completedVideoCount = videoTasks.filter((t) => t.status === 'completed').length;
  const totalCompleted = completedAudioCount + completedVideoCount;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800/80 bg-neutral-950/60">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  Central de Processamentos Simultâneos
                </h3>
                {totalActive > 0 && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {totalActive} ativo{totalActive > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400">
                Gere múltiplos áudios e renderize vídeos ao mesmo tempo em paralelo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {totalCompleted > 0 && (
              <button
                type="button"
                onClick={onClearCompletedTasks}
                className="px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
              >
                Limpar Concluídos
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-neutral-800 bg-neutral-950/30 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'all'
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Todos ({audioTasks.length + videoTasks.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audio')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'audio'
                ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Volume2 className="h-3.5 w-3.5" />
            <span>Áudios ({audioTasks.length})</span>
            {activeAudioCount > 0 && (
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('video')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'video'
                ? 'bg-violet-950/80 text-violet-300 border border-violet-800/60'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            <span>Vídeos ({videoTasks.length})</span>
            {activeVideoCount > 0 && (
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
            )}
          </button>
        </div>

        {/* Task Lists Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {audioTasks.length === 0 && videoTasks.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-neutral-800/50 flex items-center justify-center text-neutral-500 mb-3">
                <Zap className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-neutral-300">Nenhum processamento ativo no momento</p>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto mt-1">
                Quando você iniciar a criação de áudios ou vídeos, eles aparecerão aqui processando simultaneamente em paralelo.
              </p>
            </div>
          ) : null}

          {/* Audio Tasks Section */}
          {(activeTab === 'all' || activeTab === 'audio') && audioTasks.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold text-neutral-400 px-1">
                <span className="flex items-center gap-1.5 text-cyan-400">
                  <Volume2 className="h-3.5 w-3.5" />
                  Processamentos de Áudio ({audioTasks.length})
                </span>
                <span className="text-[11px] text-neutral-500 font-mono">
                  {activeAudioCount} em andamento
                </span>
              </div>

              {audioTasks.map((task) => (
                <div
                  key={task.id}
                  className={`p-3.5 rounded-xl border transition-all ${
                    task.status === 'processing'
                      ? 'bg-cyan-950/20 border-cyan-500/30'
                      : task.status === 'completed'
                      ? 'bg-neutral-800/40 border-neutral-700/60'
                      : task.status === 'error'
                      ? 'bg-rose-950/20 border-rose-800/40'
                      : 'bg-neutral-900 border-neutral-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white truncate">
                          {task.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-medium">
                          {task.voice.name}
                        </span>
                        {task.status === 'processing' && (
                          <span className="flex items-center gap-1 text-[10px] text-cyan-400 font-mono">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            {task.progress}%
                          </span>
                        )}
                        {task.status === 'completed' && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                            <CheckCircle2 className="h-3 w-3" />
                            Pronto
                          </span>
                        )}
                        {task.status === 'error' && (
                          <span className="flex items-center gap-1 text-[10px] text-rose-400 font-medium">
                            <AlertCircle className="h-3 w-3" />
                            Erro
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-neutral-400 truncate mt-0.5">
                        {task.textSnippet || 'Síntese de voz'}
                      </p>

                      {/* Progress bar for processing tasks */}
                      {task.status === 'processing' && (
                        <div className="mt-2.5 space-y-1">
                          <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300 rounded-full"
                              style={{ width: `${Math.max(5, task.progress)}%` }}
                            />
                          </div>
                          <div className="flex justify-between items-center text-[10px] text-neutral-400">
                            <span>{task.statusText}</span>
                            <span className="font-mono">{task.progress}%</span>
                          </div>
                        </div>
                      )}

                      {task.status === 'error' && (
                        <p className="text-[11px] text-rose-300 mt-1">
                          {task.errorMessage || 'Falha na geração do áudio.'}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                      {task.status === 'processing' && (
                        <button
                          type="button"
                          onClick={() => onCancelAudioTask(task.id)}
                          className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded border border-rose-900/50 transition-colors cursor-pointer"
                          title="Cancelar este áudio"
                        >
                          Cancelar
                        </button>
                      )}

                      {task.status === 'completed' && task.resultAudio && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              if (playingAudioId === task.id) {
                                setPlayingAudioId(null);
                              } else {
                                setPlayingAudioId(task.id);
                                if (onPlayAudio) onPlayAudio(task.resultAudio!);
                              }
                            }}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              playingAudioId === task.id
                                ? 'bg-cyan-500 text-neutral-950 font-bold'
                                : 'text-neutral-300 hover:text-white hover:bg-neutral-700'
                            }`}
                            title={playingAudioId === task.id ? 'Pausar áudio' : 'Reproduzir áudio'}
                          >
                            {playingAudioId === task.id ? (
                              <Pause className="h-4 w-4 fill-current" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </button>

                          {/* Puxar texto de volta para o editor */}
                          {onLoadTextToEditor && (
                            <button
                              type="button"
                              onClick={() => {
                                onLoadTextToEditor(task.fullText || task.resultAudio?.fullText || task.textSnippet, task.title);
                                onClose();
                              }}
                              className="p-1.5 text-cyan-400 hover:text-cyan-200 hover:bg-cyan-950/60 rounded-lg border border-cyan-800/60 transition-colors cursor-pointer"
                              title="Puxar o texto que gerou este áudio de volta ao editor para novas edições"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}

                          <a
                            href={task.resultAudio.downloadUrl || task.resultAudio.audioUrl}
                            download={`${task.resultAudio.title || 'audio'}.mp3`}
                            className="p-1.5 text-neutral-300 hover:text-emerald-400 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
                            title="Baixar MP3"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                          {onSendToVideo && (
                            <button
                              type="button"
                              onClick={() => {
                                onSendToVideo(task.resultAudio!);
                                onClose();
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-violet-300 bg-violet-950/60 hover:bg-violet-900 border border-violet-800 rounded-lg transition-colors cursor-pointer"
                              title="Enviar para VideoVozLivre"
                            >
                              <Film className="h-3 w-3" />
                              <span>Vídeo</span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Inline audio playback when playing */}
                  {playingAudioId === task.id && task.resultAudio && (
                    <div className="mt-2.5 pt-2 border-t border-neutral-800">
                      <audio
                        src={task.resultAudio.audioUrl}
                        controls
                        autoPlay
                        onEnded={() => setPlayingAudioId(null)}
                        className="w-full h-8"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Video Tasks Section */}
          {(activeTab === 'all' || activeTab === 'video') && videoTasks.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold text-neutral-400 px-1">
                <span className="flex items-center gap-1.5 text-violet-400">
                  <Film className="h-3.5 w-3.5" />
                  Renderizações de Vídeo ({videoTasks.length})
                </span>
                <span className="text-[11px] text-neutral-500 font-mono">
                  {activeVideoCount} renderizando
                </span>
              </div>

              {videoTasks.map((task) => (
                <div
                  key={task.id}
                  className={`p-3.5 rounded-xl border transition-all ${
                    task.status === 'rendering' || task.status === 'preparing'
                      ? 'bg-violet-950/20 border-violet-500/30'
                      : task.status === 'completed'
                      ? 'bg-neutral-800/40 border-neutral-700/60'
                      : task.status === 'error'
                      ? 'bg-rose-950/20 border-rose-800/40'
                      : 'bg-neutral-900 border-neutral-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-white truncate">
                          {task.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono font-medium">
                          {task.aspectRatio}
                        </span>
                        {task.fitMode === 'blur_capcut' && task.aspectRatio === '9:16' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-900/60 text-violet-300 font-medium border border-violet-700/50">
                            ✨ Desfoque CapCut
                          </span>
                        )}
                        {(task.status === 'rendering' || task.status === 'preparing') && (
                          <span className="flex items-center gap-1 text-[10px] text-violet-400 font-mono">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            {task.progress}% {task.fps > 0 ? `(${task.fps} FPS)` : ''}
                          </span>
                        )}
                        {task.status === 'completed' && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                            <CheckCircle2 className="h-3 w-3" />
                            Vídeo MP4 Pronto
                          </span>
                        )}
                        {task.status === 'error' && (
                          <span className="flex items-center gap-1 text-[10px] text-rose-400 font-medium">
                            <AlertCircle className="h-3 w-3" />
                            Erro
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-neutral-400 truncate mt-0.5">
                        {task.audioTitle ? `Áudio: ${task.audioTitle}` : 'Renderização WebCodecs MP4'}
                      </p>

                      {/* Progress bar for rendering or interrupted tasks */}
                      {(task.status === 'rendering' ||
                        task.status === 'preparing' ||
                        ((task.status === 'error' || task.status === 'cancelled') && task.progress > 0)) && (
                        <div className="mt-2.5 space-y-1">
                          <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 rounded-full ${
                                task.status === 'error' || task.status === 'cancelled'
                                  ? 'bg-amber-500'
                                  : 'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-emerald-400'
                              }`}
                              style={{ width: `${Math.max(5, task.progress)}%` }}
                            />
                          </div>
                          <div className="flex justify-between items-center text-[10px] text-neutral-400">
                            <span>{task.statusText}</span>
                            <span className="font-mono">
                              {task.progress}% {task.fps > 0 ? `· ${task.fps} fps` : ''}
                            </span>
                          </div>
                        </div>
                      )}

                      {task.status === 'error' && (
                        <p className="text-[11px] text-rose-300 mt-1">
                          {task.errorMessage || 'Falha na renderização do vídeo.'}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                      {(task.status === 'rendering' || task.status === 'preparing') && (
                        <button
                          type="button"
                          onClick={() => onCancelVideoTask(task.id)}
                          className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded border border-rose-900/50 transition-colors cursor-pointer"
                          title="Pausar/Cancelar esta renderização"
                        >
                          Pausar
                        </button>
                      )}

                      {(task.status === 'error' || task.status === 'cancelled') && onResumeVideoTask && (
                        <button
                          type="button"
                          onClick={() => {
                            onResumeVideoTask(task.id);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-neutral-950 bg-amber-400 hover:bg-amber-300 active:scale-95 rounded-lg transition-all cursor-pointer shadow-md"
                          title="Retomar renderização exatamente do ponto em que parou"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Retomar Renderização</span>
                        </button>
                      )}

                      {task.status === 'completed' && task.videoUrl && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewVideo(task)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 active:scale-95 rounded-lg transition-all cursor-pointer shadow-md"
                            title="Abrir pop-up do vídeo para assistir com áudio e música"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Assistir Vídeo</span>
                          </button>
                          <a
                            href={task.videoUrl}
                            download={task.downloadFilename || `${task.title}.mp4`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
                            title="Baixar vídeo MP4"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-950/70 flex items-center justify-between text-xs text-neutral-400">
          <span>Processamento paralelo em segundo plano</span>
          <span className="font-mono">Hardware Acelerado</span>
        </div>
      </div>

      {/* Pop-up do Vídeo - Reprodução e Prévia com Vídeo, Áudio e Música */}
      {previewVideo && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative w-full max-w-2xl bg-neutral-900 border border-neutral-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-950 border-b border-neutral-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/20 text-violet-400">
                  <Film className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-white truncate max-w-sm sm:max-w-md">
                    {previewVideo.title}
                  </h4>
                  <div className="flex items-center gap-2 text-[10px] text-neutral-400">
                    <span className="font-mono">{previewVideo.aspectRatio}</span>
                    <span>·</span>
                    <span className="text-emerald-400 font-medium">MP4 com Áudio e Música</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewVideo(null)}
                className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                title="Fechar pop-up do vídeo"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Video Player */}
            <div className="p-4 sm:p-6 flex items-center justify-center bg-black/90 min-h-[300px] overflow-hidden">
              {previewVideo.videoUrl ? (
                <video
                  src={previewVideo.videoUrl}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[55vh] max-w-full rounded-xl shadow-2xl object-contain border border-neutral-800"
                />
              ) : (
                <div className="text-center py-12 text-neutral-400">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-violet-400" />
                  <p className="text-sm">Vídeo em renderização ({previewVideo.progress}%)...</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-neutral-950 border-t border-neutral-800 text-xs">
              <span className="text-neutral-400 truncate max-w-xs">
                {previewVideo.audioTitle ? `Áudio: ${previewVideo.audioTitle}` : 'Vídeo com áudio e música'}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {previewVideo.videoUrl && (
                  <a
                    href={previewVideo.videoUrl}
                    download={previewVideo.downloadFilename || `${previewVideo.title}.mp4`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-neutral-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors cursor-pointer shadow-sm"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Baixar MP4</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewVideo(null)}
                  className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
