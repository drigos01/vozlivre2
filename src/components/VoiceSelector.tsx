import React, { useState } from 'react';
import { Play, Pause, Check, Volume2, User, Sparkles } from 'lucide-react';
import { Voice } from '../types';

interface VoiceSelectorProps {
  voices: Voice[];
  selectedVoiceId: string;
  onSelectVoice: (voice: Voice) => void;
  isLoadingVoices?: boolean;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoice,
  isLoadingVoices = false,
}) => {
  const [filterCategory, setFilterCategory] = useState<string>('pt-BR-male');
  const [genderFilter, setGenderFilter] = useState<'all' | 'Masculino' | 'Feminino'>('all');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  // Available filter tabs
  const categoryTabs = [
    { id: 'pt-BR-male', label: 'Masculinas Brasil (7)', isHighlight: true },
    { id: 'pt-BR-female', label: 'Femininas Brasil (2)' },
    { id: 'all', label: 'Todas as Vozes' },
    { id: 'pt-PT', label: 'Portugal' },
    { id: 'en', label: 'Inglês' },
    { id: 'es', label: 'Espanhol' },
  ];

  const filteredVoices = voices.filter((v) => {
    // Category filtering
    if (filterCategory === 'pt-BR-male') {
      if (!(v.lang === 'pt-BR' && v.gender === 'Masculino')) return false;
    } else if (filterCategory === 'pt-BR-female') {
      if (!(v.lang === 'pt-BR' && v.gender === 'Feminino')) return false;
    } else if (filterCategory === 'pt-PT') {
      if (v.lang !== 'pt-PT') return false;
    } else if (filterCategory === 'en') {
      if (!v.lang.startsWith('en')) return false;
    } else if (filterCategory === 'es') {
      if (!v.lang.startsWith('es')) return false;
    }

    // Gender filter override (if not already selecting a gender-specific category)
    if (filterCategory === 'all' && genderFilter !== 'all') {
      if (v.gender !== genderFilter) return false;
    }

    return true;
  });

  const handlePreview = async (e: React.MouseEvent, voice: Voice) => {
    e.stopPropagation();

    // If already playing this voice, stop it
    if (playingVoiceId === voice.id && audioElement) {
      audioElement.pause();
      setPlayingVoiceId(null);
      return;
    }

    // Stop current audio if playing
    if (audioElement) {
      audioElement.pause();
    }

    try {
      setPlayingVoiceId(voice.id);

      const sampleText = voice.lang.startsWith('pt')
        ? `Olá! Eu sou o ${voice.name}. Minha fala é natural, fluida e perfeita para narrar seus conteúdos e histórias.`
        : voice.lang.startsWith('es')
        ? `¡Hola! Soy la voz de ${voice.name}. Mi habla es natural y fluida.`
        : `Hello! I am ${voice.name}. My voice is natural, clear, and ready for your projects.`;

      const response = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voice.id, sampleText }),
      });

      if (!response.ok) throw new Error('Falha ao obter amostra de voz');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      audio.onended = () => {
        setPlayingVoiceId(null);
      };
      audio.onerror = () => {
        setPlayingVoiceId(null);
      };

      setAudioElement(audio);
      await audio.play();
    } catch (err) {
      console.error('Error playing voice preview:', err);
      setPlayingVoiceId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Category Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-neutral-900 border border-neutral-800 rounded-lg">
          {categoryTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterCategory(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                filterCategory === tab.id
                  ? 'bg-neutral-800 text-white shadow-sm font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {tab.isHighlight && <User className="h-3 w-3 text-neutral-300" />}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {filterCategory === 'all' && (
          <div className="flex items-center gap-1 p-1 bg-neutral-900 border border-neutral-800 rounded-lg">
            {(['all', 'Masculino', 'Feminino'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGenderFilter(g)}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  genderFilter === g
                    ? 'bg-neutral-800 text-white font-medium'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {g === 'all' ? 'Todos' : g}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Voice Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredVoices.map((voice) => {
          const isSelected = voice.id === selectedVoiceId;
          const isPlaying = playingVoiceId === voice.id;
          const isBrazilianMale = voice.lang === 'pt-BR' && voice.gender === 'Masculino';

          return (
            <div
              key={voice.id}
              onClick={() => onSelectVoice(voice)}
              className={`group relative text-left p-4 rounded-xl border transition-all cursor-pointer ${
                isSelected
                  ? 'border-neutral-300 bg-neutral-900 shadow-md ring-1 ring-neutral-300/20'
                  : 'border-neutral-800/80 bg-neutral-900/40 hover:border-neutral-700 hover:bg-neutral-900/70'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white tracking-tight text-sm">
                      {voice.name}
                    </span>
                    {isSelected && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-neutral-950 text-[10px]">
                        <Check className="h-2.5 w-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>

                  {/* Clean unboxed metadata with typographic separators */}
                  <div className="flex items-center gap-1.5 text-xs text-neutral-400 mt-0.5">
                    <span>{voice.langLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className={isBrazilianMale ? 'text-neutral-200 font-medium' : ''}>
                      {voice.gender}
                    </span>
                  </div>
                </div>

                {/* Preview Button */}
                <button
                  type="button"
                  onClick={(e) => handlePreview(e, voice)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all shrink-0 ${
                    isPlaying
                      ? 'bg-white text-neutral-950 border-white'
                      : 'bg-neutral-800/80 border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-600'
                  }`}
                  title={isPlaying ? 'Pausar prévia' : `Ouvir amostra da voz ${voice.name}`}
                >
                  {isPlaying ? (
                    <Pause className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                  )}
                </button>
              </div>

              <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">
                {voice.description}
              </p>
            </div>
          );
        })}
      </div>

      {filteredVoices.length === 0 && !isLoadingVoices && (
        <div className="text-center py-8 text-neutral-500 text-sm">
          Nenhuma voz encontrada para o filtro selecionado.
        </div>
      )}
    </div>
  );
};
