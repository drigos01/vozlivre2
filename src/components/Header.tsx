import React from 'react';
import { Volume2, Sparkles, History, HelpCircle, Film, Radio, MessageSquare, Zap, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  activeTab: 'converter' | 'ia_narrada' | 'live_narrada' | 'dialogo_natural' | 'videovozlivre' | 'voices' | 'history' | 'about';
  setActiveTab: (tab: 'converter' | 'ia_narrada' | 'live_narrada' | 'dialogo_natural' | 'videovozlivre' | 'voices' | 'history' | 'about') => void;
  onOpenWhatsAppTab?: () => void;
  isWhatsAppSubTabActive?: boolean;
  historyCount: number;
  totalActiveTasks?: number;
  onOpenTaskManager?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenWhatsAppTab,
  isWhatsAppSubTabActive = false,
  historyCount,
  totalActiveTasks = 0,
  onOpenTaskManager,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Zone 1: Single text element brand wordmark */}
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-100">
            <Volume2 className="h-5 w-5 text-neutral-200" />
          </div>
          <button
            onClick={() => setActiveTab('converter')}
            className="text-lg font-semibold tracking-tight text-white hover:text-neutral-200 transition-colors"
          >
            VozLivre
          </button>
        </div>

        {/* Zone 2: Navigation links */}
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-neutral-400">
          <button
            onClick={() => setActiveTab('converter')}
            className={`transition-colors pb-1 ${
              activeTab === 'converter'
                ? 'text-white border-b-2 border-white font-semibold'
                : 'hover:text-neutral-200'
            }`}
          >
            Conversor
          </button>
          <button
            onClick={() => setActiveTab('ia_narrada')}
            className={`transition-colors pb-1 flex items-center gap-1.5 ${
              activeTab === 'ia_narrada' && !isWhatsAppSubTabActive
                ? 'text-white border-b-2 border-white font-semibold'
                : 'hover:text-neutral-200'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>Vídeo IA</span>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.2 bg-amber-950 text-amber-300 border border-amber-800 rounded">
              Histórias & Matérias
            </span>
          </button>
          {onOpenWhatsAppTab && (
            <button
              onClick={onOpenWhatsAppTab}
              className={`transition-colors pb-1 flex items-center gap-1.5 ${
                activeTab === 'ia_narrada' && isWhatsAppSubTabActive
                  ? 'text-emerald-400 border-b-2 border-emerald-400 font-semibold'
                  : 'hover:text-emerald-300'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 text-emerald-400" />
              <span>WhatsApp</span>
            </button>
          )}
          <button
            onClick={() => setActiveTab('live_narrada')}
            className={`transition-colors pb-1 flex items-center gap-1.5 ${
              activeTab === 'live_narrada'
                ? 'text-white border-b-2 border-white font-semibold'
                : 'hover:text-neutral-200'
            }`}
          >
            <span>Live Narrada</span>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.2 bg-rose-950 text-rose-300 border border-rose-800 rounded flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>
              Histórias
            </span>
          </button>
          <button
            onClick={() => setActiveTab('dialogo_natural')}
            className={`transition-colors pb-1 flex items-center gap-1.5 ${
              activeTab === 'dialogo_natural'
                ? 'text-white border-b-2 border-white font-semibold'
                : 'hover:text-neutral-200'
            }`}
          >
            <span>Diálogo Natural</span>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.2 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
              Podcast
            </span>
          </button>
          <button
            onClick={() => setActiveTab('videovozlivre')}
            className={`transition-colors pb-1 flex items-center gap-1.5 ${
              activeTab === 'videovozlivre'
                ? 'text-white border-b-2 border-white font-semibold'
                : 'hover:text-neutral-200'
            }`}
          >
            <span>VideoVozLivre</span>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.2 bg-violet-950 text-violet-300 border border-violet-800 rounded">
              Vídeo
            </span>
          </button>
          <button
            onClick={() => setActiveTab('voices')}
            className={`transition-colors pb-1 ${
              activeTab === 'voices'
                ? 'text-white border-b-2 border-white font-semibold'
                : 'hover:text-neutral-200'
            }`}
          >
            Vozes Neurais
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`transition-colors pb-1 flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'text-white border-b-2 border-white font-semibold'
                : 'hover:text-neutral-200'
            }`}
          >
            <span>Histórico</span>
            {historyCount > 0 && (
              <span className="font-mono text-xs text-neutral-400">({historyCount})</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`transition-colors pb-1 ${
              activeTab === 'about'
                ? 'text-white border-b-2 border-white font-semibold'
                : 'hover:text-neutral-200'
            }`}
          >
            Como Funciona
          </button>
        </nav>

        {/* Zone 3: Primary indicator and action */}
        <div className="flex items-center gap-2.5">
          {totalActiveTasks > 0 && onOpenTaskManager && (
            <button
              type="button"
              onClick={onOpenTaskManager}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-cyan-950 text-cyan-300 border border-cyan-700/60 rounded-full hover:bg-cyan-900 transition-colors animate-pulse cursor-pointer shadow-sm shadow-cyan-950/40"
              title="Abrir Central de Processamentos"
            >
              <Zap className="h-3.5 w-3.5 text-cyan-400" />
              <span>{totalActiveTasks} Ativo{totalActiveTasks > 1 ? 's' : ''}</span>
            </button>
          )}

          <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            <span>Uso Ilimitado</span>
            <span aria-hidden="true">·</span>
            <span>Zero Créditos</span>
          </div>

          <div className="md:hidden flex items-center gap-1">
            <button
              onClick={() => setActiveTab('converter')}
              className={`p-2 rounded-lg text-sm ${activeTab === 'converter' ? 'bg-neutral-800 text-white' : 'text-neutral-400'}`}
              title="Conversor"
            >
              <Volume2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setActiveTab('ia_narrada')}
              className={`p-2 rounded-lg text-sm ${activeTab === 'ia_narrada' ? 'bg-neutral-800 text-cyan-400' : 'text-neutral-400'}`}
              title="IA Narrada"
            >
              <Sparkles className="h-4 w-4" />
            </button>
            <button
              onClick={() => setActiveTab('live_narrada')}
              className={`p-2 rounded-lg text-sm ${activeTab === 'live_narrada' ? 'bg-neutral-800 text-rose-400' : 'text-neutral-400'}`}
              title="Live Narrada"
            >
              <Radio className="h-4 w-4" />
            </button>
            <button
              onClick={() => setActiveTab('dialogo_natural')}
              className={`p-2 rounded-lg text-sm ${activeTab === 'dialogo_natural' ? 'bg-neutral-800 text-cyan-400' : 'text-neutral-400'}`}
              title="Diálogo Natural"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <button
              onClick={() => setActiveTab('videovozlivre')}
              className={`p-2 rounded-lg text-sm ${activeTab === 'videovozlivre' ? 'bg-neutral-800 text-white' : 'text-neutral-400'}`}
              title="VideoVozLivre"
            >
              <Film className="h-4 w-4" />
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`p-2 rounded-lg text-sm ${activeTab === 'history' ? 'bg-neutral-800 text-white' : 'text-neutral-400'}`}
              title="Histórico"
            >
              <History className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
