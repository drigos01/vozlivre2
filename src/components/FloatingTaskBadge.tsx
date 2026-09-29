import React from 'react';
import { Zap, Loader2, CheckCircle2, ChevronUp } from 'lucide-react';
import { AudioTask, VideoTask } from '../types';

interface FloatingTaskBadgeProps {
  audioTasks: AudioTask[];
  videoTasks: VideoTask[];
  onOpenTaskManager: () => void;
}

export const FloatingTaskBadge: React.FC<FloatingTaskBadgeProps> = ({
  audioTasks,
  videoTasks,
  onOpenTaskManager,
}) => {
  const activeAudio = audioTasks.filter((t) => t.status === 'processing' || t.status === 'queued');
  const activeVideo = videoTasks.filter((t) => t.status === 'rendering' || t.status === 'preparing' || t.status === 'queued');
  const totalActive = activeAudio.length + activeVideo.length;

  const completedAudio = audioTasks.filter((t) => t.status === 'completed');
  const completedVideo = videoTasks.filter((t) => t.status === 'completed');
  const totalCompleted = completedAudio.length + completedVideo.length;

  if (audioTasks.length === 0 && videoTasks.length === 0) {
    return null;
  }

  // Calculate average active progress
  const allActiveTasks = [...activeAudio, ...activeVideo];
  const avgProgress = allActiveTasks.length > 0
    ? Math.round(allActiveTasks.reduce((acc, t) => acc + (t.progress || 0), 0) / allActiveTasks.length)
    : 100;

  return (
    <div className="fixed bottom-5 right-5 z-40 animate-in fade-in slide-in-from-bottom-3 duration-200">
      <button
        type="button"
        onClick={onOpenTaskManager}
        className={`group flex items-center gap-3 px-3.5 py-2.5 rounded-full border shadow-xl backdrop-blur-md transition-all active:scale-95 cursor-pointer ${
          totalActive > 0
            ? 'bg-neutral-900/95 border-cyan-500/40 hover:border-cyan-400 text-white shadow-cyan-950/30'
            : 'bg-neutral-900/90 border-neutral-700/80 hover:border-neutral-600 text-neutral-300'
        }`}
      >
        <div className="flex items-center gap-2">
          {totalActive > 0 ? (
            <div className="relative flex items-center justify-center">
              <span className="absolute h-3 w-3 rounded-full bg-cyan-400 animate-ping opacity-75" />
              <div className="relative h-6 w-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </div>
            </div>
          ) : (
            <div className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
          )}

          <div className="text-left text-xs">
            {totalActive > 0 ? (
              <div className="flex items-center gap-1.5 font-bold">
                <span>{totalActive} em processamento</span>
                <span className="font-mono text-cyan-400">({avgProgress}%)</span>
              </div>
            ) : (
              <div className="font-semibold text-emerald-400">
                {totalCompleted} tarefa{totalCompleted > 1 ? 's' : ''} concluída{totalCompleted > 1 ? 's' : ''}
              </div>
            )}
            <div className="text-[10px] text-neutral-400 flex items-center gap-1">
              <span>{activeAudio.length} áudio{activeAudio.length > 1 ? 's' : ''}</span>
              <span>·</span>
              <span>{activeVideo.length} vídeo{activeVideo.length > 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>

        <ChevronUp className="h-4 w-4 text-neutral-400 group-hover:text-white transition-transform group-hover:-translate-y-0.5" />
      </button>
    </div>
  );
};
