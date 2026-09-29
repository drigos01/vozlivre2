import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Users,
  Play,
  Pause,
  Plus,
  Trash2,
  Edit3,
  Download,
  Film,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Volume2,
  CheckCircle2,
  Clock,
  Check,
  X,
  Sliders,
  ChevronDown,
  AlertCircle,
  Loader2,
  Wand2,
  FolderPlus,
  Radio,
  FileText,
  UserPlus,
  Mic,
  Music,
  Share2,
  RefreshCw,
  FastForward,
  Rewind,
} from 'lucide-react';
import {
  PodcastDialogue,
  DialogueCharacter,
  DialogueLine,
  Voice,
  GeneratedAudio,
  ProsodySettings,
} from '../types';
import { CURATED_VOICES } from '../constants/voices';
import { SAMPLE_DIALOGUES } from '../constants/sampleDialogues';
import {
  formatTime,
  formatBytes,
  downloadAudio,
  downloadBlob,
  formatFilename,
  estimateDurationSeconds,
  concatenateAudioBlobs,
} from '../utils/audio';
import {
  getAllDialoguesFromDB,
  saveDialogueToDB,
  deleteDialogueFromDB,
} from '../utils/db';
import { VoiceSelector } from './VoiceSelector';

interface DialogoNaturalProps {
  voices: Voice[];
  onSendToVideoEditor: (audio: GeneratedAudio) => void;
  onNavigateToConverter: () => void;
}

const AVATAR_COLORS = [
  { id: 'cyan', bg: 'bg-cyan-950/80', text: 'text-cyan-300', border: 'border-cyan-700', activeRing: 'ring-cyan-400' },
  { id: 'rose', bg: 'bg-rose-950/80', text: 'text-rose-300', border: 'border-rose-700', activeRing: 'ring-rose-400' },
  { id: 'emerald', bg: 'bg-emerald-950/80', text: 'text-emerald-300', border: 'border-emerald-700', activeRing: 'ring-emerald-400' },
  { id: 'violet', bg: 'bg-violet-950/80', text: 'text-violet-300', border: 'border-violet-700', activeRing: 'ring-violet-400' },
  { id: 'amber', bg: 'bg-amber-950/80', text: 'text-amber-300', border: 'border-amber-700', activeRing: 'ring-amber-400' },
  { id: 'blue', bg: 'bg-blue-950/80', text: 'text-blue-300', border: 'border-blue-700', activeRing: 'ring-blue-400' },
];

export const DialogoNatural: React.FC<DialogoNaturalProps> = ({
  voices,
  onSendToVideoEditor,
}) => {
  // Dialogues state
  const [dialogues, setDialogues] = useState<PodcastDialogue[]>([]);
  const [activeDialogueId, setActiveDialogueId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Modals state
  const [isNewDialogueModalOpen, setIsNewDialogueModalOpen] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>('');
  const [newCategory, setNewCategory] = useState<string>('Tecnologia & Inovação');
  const [newDesc, setNewDesc] = useState<string>('');

  // Character Modal state
  const [isCharModalOpen, setIsCharModalOpen] = useState<boolean>(false);
  const [editingChar, setEditingChar] = useState<DialogueCharacter | null>(null);
  const [charName, setCharName] = useState<string>('');
  const [charVoiceId, setCharVoiceId] = useState<string>(CURATED_VOICES[0].id);
  const [charRole, setCharRole] = useState<string>('Apresentador');
  const [charColor, setCharColor] = useState<string>('cyan');
  const [charRate, setCharRate] = useState<string>('+0%');
  const [charPitch, setCharPitch] = useState<string>('+0Hz');

  // Script Line Modal state
  const [isLineModalOpen, setIsLineModalOpen] = useState<boolean>(false);
  const [editingLine, setEditingLine] = useState<DialogueLine | null>(null);
  const [lineCharId, setLineCharId] = useState<string>('');
  const [lineText, setLineText] = useState<string>('');
  const [linePause, setLinePause] = useState<number>(0.4);
  const [lineInsertIndex, setLineInsertIndex] = useState<number>(-1);

  // Script Importer Modal state (Paste whole script)
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [rawScriptText, setRawScriptText] = useState<string>('');

  // Delete confirmations
  const [dialogueToDelete, setDialogueToDelete] = useState<PodcastDialogue | null>(null);
  const [lineToDelete, setLineToDelete] = useState<DialogueLine | null>(null);
  const [charToDelete, setCharToDelete] = useState<DialogueCharacter | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentPlayingLineIndex, setCurrentPlayingLineIndex] = useState<number>(0);
  const [currentLineTime, setCurrentLineTime] = useState<number>(0);
  const [currentLineDuration, setCurrentLineDuration] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [volume, setVolume] = useState<number>(1.0);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [hasUserSelectedLine, setHasUserSelectedLine] = useState<boolean>(false);

  // Generation status
  const [generatingLineId, setGeneratingLineId] = useState<string | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState<boolean>(false);
  const [isUnifyingPodcast, setIsUnifyingPodcast] = useState<boolean>(false);
  const [unifiedSuccess, setUnifiedSuccess] = useState<boolean>(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);
  const [charForVoiceModal, setCharForVoiceModal] = useState<DialogueCharacter | null>(null);

  const allVoices = voices && voices.length > 0 ? voices : CURATED_VOICES;

  // References
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pauseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const activeDialogue = dialogues.find((d) => d.id === activeDialogueId) || dialogues[0] || null;
  const activeDialogueRef = useRef<PodcastDialogue | null>(null);

  useEffect(() => {
    activeDialogueRef.current = activeDialogue;
  }, [activeDialogue]);

  // Load dialogues from IndexedDB or initial samples
  useEffect(() => {
    async function loadDialogues() {
      try {
        setIsLoading(true);
        const stored = await getAllDialoguesFromDB();
        if (stored && stored.length > 0) {
          // Normalize any lines stuck in 'generating' back to 'pending'
          const normalized = stored.map((dlg) => ({
            ...dlg,
            lines: dlg.lines.map((l) => ({
              ...l,
              status: l.status === 'generating' ? (l.audio ? 'ready' : 'pending') : l.status,
            })),
          }));
          setDialogues(normalized);
          setActiveDialogueId(normalized[0].id);
        } else {
          for (const sample of SAMPLE_DIALOGUES) {
            await saveDialogueToDB(sample);
          }
          setDialogues(SAMPLE_DIALOGUES);
          setActiveDialogueId(SAMPLE_DIALOGUES[0].id);
        }
      } catch (err) {
        console.error('Failed to load dialogues from IndexedDB:', err);
        setDialogues(SAMPLE_DIALOGUES);
        setActiveDialogueId(SAMPLE_DIALOGUES[0].id);
      } finally {
        setIsLoading(false);
      }
    }
    loadDialogues();
  }, []);

  const persistDialogue = async (updated: PodcastDialogue) => {
    activeDialogueRef.current = updated;
    setDialogues((prev) =>
      prev.map((d) => (d.id === updated.id ? updated : d))
    );
    try {
      await saveDialogueToDB(updated);
    } catch (e) {
      console.error('Error persisting dialogue:', e);
    }
  };

  const showFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => {
      setFeedbackMsg((curr) => (curr === msg ? null : curr));
    }, 4000);
  };

  // Preview voice sample playback
  const handlePreviewVoice = async (voice: Voice) => {
    if (previewVoiceId === voice.id && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setPreviewVoiceId(null);
      return;
    }

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
    }

    try {
      setPreviewVoiceId(voice.id);
      const sampleText = voice.lang.startsWith('pt')
        ? `Olá! Eu sou ${voice.name}, com voz neural humana e expressiva para podcasts.`
        : `Hello! I am ${voice.name}, ready for your natural podcast.`;

      const res = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voice.id, sampleText }),
      });

      if (!res.ok) throw new Error('Falha ao obter amostra de voz.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => setPreviewVoiceId(null);
      audio.onerror = () => setPreviewVoiceId(null);
      previewAudioRef.current = audio;
      await audio.play();
    } catch (e) {
      console.error('Error playing voice preview:', e);
      setPreviewVoiceId(null);
    }
  };

  // Canvas visualizer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const numBars = 32;
    const barWidth = 3;
    const gap = 3;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const progress = currentLineDuration > 0 ? currentLineTime / currentLineDuration : 0;

      for (let i = 0; i < numBars; i++) {
        const x = i * (barWidth + gap);
        const barProgress = i / numBars;
        const isPast = barProgress <= progress;

        const timeFactor = isPlaying ? Date.now() / 200 : 0;
        const baseHeight = 5 + Math.sin(i * 0.5 + timeFactor) * 8 + Math.cos(i * 0.9) * 5;
        const height = Math.max(4, Math.min(canvas.height - 4, baseHeight));
        const y = (canvas.height - height) / 2;

        ctx.fillStyle = isPast
          ? '#06b6d4' // cyan
          : isPlaying
          ? 'rgba(6, 182, 212, 0.4)'
          : 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(x, y, barWidth, height);
      }

      if (isPlaying) {
        animId = requestAnimationFrame(render);
      }
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, currentLineTime, currentLineDuration]);

  // Audio element listeners
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTimeUpdate = () => setCurrentLineTime(el.currentTime);
    const onLoadedMetadata = () => {
      if (el.duration && !isNaN(el.duration) && isFinite(el.duration)) {
        setCurrentLineDuration(el.duration);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    const onEnded = () => {
      setIsPlaying(false);
      const baseDialogue = activeDialogueRef.current || activeDialogue;
      if (!baseDialogue) return;

      const nextIdx = currentPlayingLineIndex + 1;
      if (nextIdx < baseDialogue.lines.length) {
        const currentLine = baseDialogue.lines[currentPlayingLineIndex];
        const pauseSec = currentLine?.pauseAfterSeconds !== undefined ? currentLine.pauseAfterSeconds : 0.4;

        if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = setTimeout(() => {
          const nextLine = baseDialogue.lines[nextIdx];
          if (nextLine?.audio?.audioUrl) {
            playLineAtIndex(nextIdx);
          } else {
            // Find next ready line in hierarchy if intermediate line hasn't been generated
            const followingReady = baseDialogue.lines.findIndex(
              (l, idx) => idx > currentPlayingLineIndex && l.status === 'ready' && !!l.audio?.audioUrl
            );
            if (followingReady >= 0) {
              playLineAtIndex(followingReady);
            } else {
              showFeedback('Todas as falas prontas da sequência foram reproduzidas!');
            }
          }
        }, Math.max(80, pauseSec * 1000));
      } else {
        showFeedback('Fim do diálogo!');
        setHasUserSelectedLine(false);
      }
    };

    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);

    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, [activeDialogue, currentPlayingLineIndex]);

  // Play line at index
  const playLineAtIndex = (index: number) => {
    if (!activeDialogue) return;
    const line = activeDialogue.lines[index];
    const url = line?.audio?.audioUrl || line?.audio?.blobUrl || (line?.audio?.blob ? URL.createObjectURL(line.audio.blob) : '');
    if (!line || !url) {
      showFeedback(`A fala #${index + 1} ainda não possui áudio gerado.`);
      return;
    }

    // Ensure audioUrl is valid
    if (line.audio && !line.audio.audioUrl) {
      line.audio.audioUrl = url;
    }

    setCurrentPlayingLineIndex(index);
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.volume = volume;
      audioRef.current.load();
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.warn('Audio play error:', err));
    }
  };

  // Toggle Podcast Play / Pause
  // Quando não tiver selecionado nenhuma voz, inicia a partir da primeira voz que tiver gerado e estiver em primeiro na hierarquia!
  const togglePlayPodcast = () => {
    const baseDialogue = activeDialogueRef.current || activeDialogue;
    if (!baseDialogue || baseDialogue.lines.length === 0) return;

    // 1. Se estiver tocando, pausa
    if (isPlaying) {
      if (audioRef.current) audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    // 2. Se o usuário selecionou uma voz/personagem específico para começar:
    if (selectedCharacterId) {
      const charLineIdx = baseDialogue.lines.findIndex(
        (l) => l.characterId === selectedCharacterId && l.status === 'ready' && (!!l.audio?.audioUrl || !!l.audio?.blobUrl || !!l.audio?.blob)
      );
      if (charLineIdx >= 0) {
        playLineAtIndex(charLineIdx);
        return;
      } else {
        const charObj = baseDialogue.characters.find((c) => c.id === selectedCharacterId);
        showFeedback(`O personagem "${charObj?.name || 'selecionado'}" ainda não possui áudios gerados.`);
      }
    }

    // 3. Se estava pausado no meio da reprodução da mesma fala (e não finalizada), retoma
    if (
      audioRef.current &&
      audioRef.current.src &&
      !audioRef.current.ended &&
      audioRef.current.currentTime > 0 &&
      currentPlayingLineIndex >= 0 &&
      baseDialogue.lines[currentPlayingLineIndex]?.status === 'ready'
    ) {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          playLineAtIndex(currentPlayingLineIndex);
        });
      return;
    }

    // 4. REGRA PRINCIPAL: Quando NÃO tiver selecionado nenhuma voz:
    // Inicia a partir da PRIMEIRA voz que tiver gerado e estiver em PRIMEIRO na hierarquia!
    const firstReadyIndex = baseDialogue.lines.findIndex(
      (l) => l.status === 'ready' && (!!l.audio?.audioUrl || !!l.audio?.blobUrl || !!l.audio?.blob)
    );

    if (firstReadyIndex >= 0) {
      playLineAtIndex(firstReadyIndex);
    } else {
      showFeedback('Nenhum áudio gerado ainda. Clique em "Gerar Todas as Falas" para sintetizar o podcast.');
    }
  };

  // Robust voice resolution helper
  const resolveCharacterVoice = (char?: DialogueCharacter): Voice => {
    if (!char) return allVoices[0] || CURATED_VOICES[0];
    const charVoiceId = char.voice?.id || (char.voice as any);
    const found =
      allVoices.find((v) => v.id === charVoiceId) ||
      CURATED_VOICES.find((v) => v.id === charVoiceId) ||
      allVoices.find((v) => v.name?.toLowerCase() === char.voice?.name?.toLowerCase()) ||
      allVoices[0] ||
      CURATED_VOICES[0];
    return found;
  };

  // Helper to synthesize a single line audio with retry, timeout and fallback
  const synthesizeLineAudio = async (line: DialogueLine, currentDlg: PodcastDialogue): Promise<GeneratedAudio> => {
    const character = currentDlg.characters.find((c) => c.id === line.characterId) || currentDlg.characters[0];
    const voice = resolveCharacterVoice(character);
    const rate = character?.settings?.rate || '+0%';
    const pitch = character?.settings?.pitch || '+0Hz';
    const volume = character?.settings?.volume || '+0%';

    let attempts = 0;
    let lastError: any = null;

    while (attempts < 3) {
      try {
        attempts++;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const res = await fetch('/api/tts?stream=true', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: line.text,
            voice: voice.id,
            rate,
            pitch,
            volume,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          // Fallback to standard POST /api/tts
          const fallbackRes = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: line.text,
              voice: voice.id,
              rate,
              pitch,
              volume,
            }),
            signal: AbortSignal.timeout(20000),
          });

          if (!fallbackRes.ok) {
            const errData = await fallbackRes.json().catch(() => null);
            throw new Error(errData?.error || `Erro HTTP ${fallbackRes.status}`);
          }

          const fallbackData = await fallbackRes.json();
          const audioFetch = await fetch(fallbackData.audioUrl, {
            signal: AbortSignal.timeout(20000),
          });
          const blob = await audioFetch.blob();
          const audioUrl = URL.createObjectURL(blob);
          const estDuration = estimateDurationSeconds(line.text.length);

          return {
            id: fallbackData.id || crypto.randomUUID(),
            title: `${character?.name || 'Personagem'}: ${line.text.slice(0, 30)}`,
            voice,
            textSnippet: line.text.slice(0, 60),
            charCount: line.text.length,
            durationSeconds: estDuration,
            createdAt: Date.now(),
            audioUrl,
            downloadUrl: audioUrl,
            blobUrl: audioUrl,
            blob,
            sizeBytes: blob.size,
          };
        }

        const blob = await res.blob();
        if (!blob || blob.size === 0) {
          throw new Error('Áudio gerado vazio.');
        }

        const audioUrl = URL.createObjectURL(blob);
        const audioId = res.headers.get('x-audio-id') || crypto.randomUUID();
        const estDuration = estimateDurationSeconds(line.text.length);

        return {
          id: audioId,
          title: `${character?.name || 'Personagem'}: ${line.text.slice(0, 30)}`,
          voice,
          textSnippet: line.text.slice(0, 60),
          charCount: line.text.length,
          durationSeconds: estDuration,
          createdAt: Date.now(),
          audioUrl,
          downloadUrl: audioUrl,
          blobUrl: audioUrl,
          blob,
          sizeBytes: blob.size,
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`Tentativa ${attempts} falhou para fala:`, err);
        if (attempts < 3) {
          await new Promise((r) => setTimeout(r, 600 * attempts));
        }
      }
    }

    throw lastError || new Error('Falha ao sintetizar áudio após 3 tentativas.');
  };

  // Synthesize single line
  const generateAudioForLine = async (lineId: string) => {
    const baseDialogue = activeDialogueRef.current || activeDialogue;
    if (!baseDialogue) return;

    const targetIdx = baseDialogue.lines.findIndex((l) => l.id === lineId);
    if (targetIdx === -1) return;

    const targetLine = baseDialogue.lines[targetIdx];
    if (!targetLine.text.trim()) {
      showFeedback('Texto da fala está vazio.');
      return;
    }

    setGeneratingLineId(lineId);

    let current = {
      ...baseDialogue,
      lines: baseDialogue.lines.map((l, i) =>
        i === targetIdx ? { ...l, status: 'generating' as const } : l
      ),
    };
    await persistDialogue(current);

    try {
      const audio = await synthesizeLineAudio(targetLine, current);
      current = {
        ...current,
        lines: current.lines.map((l, i) =>
          i === targetIdx ? { ...l, status: 'ready' as const, audio, errorMessage: undefined } : l
        ),
      };
      await persistDialogue(current);
      showFeedback('Áudio da fala gerado com sucesso!');
    } catch (err: any) {
      console.error('TTS error on line:', err);
      current = {
        ...current,
        lines: current.lines.map((l, i) =>
          i === targetIdx ? { ...l, status: 'error' as const, errorMessage: err?.message || 'Erro' } : l
        ),
      };
      await persistDialogue(current);
      showFeedback(`Erro ao gerar fala: ${err?.message || 'Tente novamente'}`);
    } finally {
      setGeneratingLineId(null);
    }
  };

  // Generate all pending lines in conversation sequentially without closure issues
  const generateAllPendingLines = async () => {
    const baseDialogue = activeDialogueRef.current || activeDialogue;
    if (!baseDialogue || isGeneratingAll) return;

    const pendingIndices: number[] = [];
    baseDialogue.lines.forEach((l, idx) => {
      if (l.status !== 'ready' || !l.audio || !l.audio.blobUrl) {
        pendingIndices.push(idx);
      }
    });

    if (pendingIndices.length === 0) {
      showFeedback('Todas as falas deste podcast já foram geradas!');
      return;
    }

    setIsGeneratingAll(true);
    showFeedback(`Iniciando geração de ${pendingIndices.length} falas do podcast...`);

    let runningDialogue = { ...baseDialogue };
    let successCount = 0;
    let failedCount = 0;

    try {
      for (let step = 0; step < pendingIndices.length; step++) {
        const idx = pendingIndices[step];
        const targetLine = runningDialogue.lines[idx];
        if (!targetLine || !targetLine.text.trim()) continue;

        const speakerChar = runningDialogue.characters.find((c) => c.id === targetLine.characterId) || runningDialogue.characters[0];

        setGeneratingLineId(targetLine.id);
        showFeedback(`Sintetizando fala ${step + 1} de ${pendingIndices.length} (${speakerChar?.name || 'Personagem'}): "${targetLine.text.slice(0, 25)}..."`);

        // 1. Mark line as generating
        runningDialogue = {
          ...runningDialogue,
          lines: runningDialogue.lines.map((l, i) =>
            i === idx ? { ...l, status: 'generating' as const } : l
          ),
        };
        await persistDialogue(runningDialogue);

        // 2. Synthesize audio
        try {
          const audio = await synthesizeLineAudio(targetLine, runningDialogue);
          runningDialogue = {
            ...runningDialogue,
            lines: runningDialogue.lines.map((l, i) =>
              i === idx ? { ...l, status: 'ready' as const, audio, errorMessage: undefined } : l
            ),
          };
          await persistDialogue(runningDialogue);
          successCount++;
        } catch (err: any) {
          failedCount++;
          console.error(`Erro ao gerar fala #${idx + 1}:`, err);
          // Crucial: mark this line as error, but DO NOT STOP THE LOOP! Keep generating the remaining lines!
          runningDialogue = {
            ...runningDialogue,
            lines: runningDialogue.lines.map((l, i) =>
              i === idx ? { ...l, status: 'error' as const, errorMessage: err?.message || 'Falha na geração' } : l
            ),
          };
          await persistDialogue(runningDialogue);
        }
      }
    } finally {
      setGeneratingLineId(null);
      setIsGeneratingAll(false);
    }

    if (failedCount === 0 && successCount > 0) {
      showFeedback(`Todas as ${successCount} falas foram geradas com sucesso!`);
    } else if (successCount > 0 && failedCount > 0) {
      showFeedback(`${successCount} falas geradas. ${failedCount} falharam e podem ser regeradas.`);
    } else if (failedCount > 0) {
      showFeedback('Houve falha ao gerar as falas. Verifique a conexão e tente novamente.');
    }
  };

  // Quick voice change on character card directly
  const handleQuickChangeVoice = async (charId: string, newVoiceId: string) => {
    const baseDialogue = activeDialogueRef.current || activeDialogue;
    if (!baseDialogue) return;

    const newVoice = voices.find((v) => v.id === newVoiceId) || CURATED_VOICES.find((v) => v.id === newVoiceId) || voices[0];
    const targetChar = baseDialogue.characters.find((c) => c.id === charId);
    if (!targetChar) return;

    const hasGeneratedLines = baseDialogue.lines.some((l) => l.characterId === charId && l.status === 'ready');

    const updatedChars = baseDialogue.characters.map((c) =>
      c.id === charId ? { ...c, voice: newVoice } : c
    );

    // If lines had audio, mark them pending so they can be regenerated with the new voice
    const updatedLines = baseDialogue.lines.map((l) =>
      l.characterId === charId ? { ...l, status: 'pending' as const, audio: undefined } : l
    );

    const updated = {
      ...baseDialogue,
      characters: updatedChars,
      lines: updatedLines,
    };
    await persistDialogue(updated);
    showFeedback(`Voz de "${targetChar.name}" alterada para ${newVoice.name}.${hasGeneratedLines ? ' As falas dele agora podem ser regeradas com a nova voz.' : ''}`);
  };

  // Move line order
  const moveLine = async (index: number, direction: 'up' | 'down') => {
    if (!activeDialogue) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= activeDialogue.lines.length) return;

    const newLines = [...activeDialogue.lines];
    const temp = newLines[index];
    newLines[index] = newLines[targetIdx];
    newLines[targetIdx] = temp;

    const reordered = newLines.map((l, idx) => ({ ...l, order: idx }));
    await persistDialogue({ ...activeDialogue, lines: reordered });
  };

  // Execute Line Deletion
  const executeDeleteLine = async () => {
    if (!activeDialogue || !lineToDelete) return;
    const filtered = activeDialogue.lines
      .filter((l) => l.id !== lineToDelete.id)
      .map((l, idx) => ({ ...l, order: idx }));

    await persistDialogue({ ...activeDialogue, lines: filtered });
    setLineToDelete(null);
    showFeedback('Fala removida.');
  };

  // Execute Character Deletion
  const executeDeleteCharacter = async () => {
    if (!activeDialogue || !charToDelete) return;
    if (activeDialogue.characters.length <= 1) {
      showFeedback('O podcast precisa ter pelo menos 1 personagem ativo.');
      setCharToDelete(null);
      return;
    }

    const filteredChars = activeDialogue.characters.filter((c) => c.id !== charToDelete.id);
    const fallbackCharId = filteredChars[0].id;
    // Reassign lines that belonged to deleted character
    const remappedLines = activeDialogue.lines.map((l) =>
      l.characterId === charToDelete.id ? { ...l, characterId: fallbackCharId, status: 'pending' as const, audio: undefined } : l
    );

    await persistDialogue({
      ...activeDialogue,
      characters: filteredChars,
      lines: remappedLines,
    });
    setCharToDelete(null);
    showFeedback(`Personagem "${charToDelete.name}" removido.`);
  };

  // Execute Dialogue Deletion
  const executeDeleteDialogue = async () => {
    if (!dialogueToDelete) return;
    try {
      await deleteDialogueFromDB(dialogueToDelete.id);
      const remaining = dialogues.filter((d) => d.id !== dialogueToDelete.id);
      if (remaining.length > 0) {
        setDialogues(remaining);
        setActiveDialogueId(remaining[0].id);
      } else {
        const freshDialogue: PodcastDialogue = {
          id: `podcast-${Date.now()}`,
          title: 'Novo Podcast',
          description: 'Conversa natural entre personagens.',
          category: 'Geral',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          characters: [
            {
              id: 'char-host',
              name: 'Apresentador',
              voice: voices[0] || CURATED_VOICES[0],
              settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
              avatarColor: 'cyan',
              role: 'Host',
            },
            {
              id: 'char-guest',
              name: 'Convidado',
              voice: voices[1] || CURATED_VOICES[1],
              settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
              avatarColor: 'rose',
              role: 'Convidado',
            },
          ],
          lines: [],
        };
        await saveDialogueToDB(freshDialogue);
        setDialogues([freshDialogue]);
        setActiveDialogueId(freshDialogue.id);
      }
      showFeedback(`Podcast "${dialogueToDelete.title}" excluído com sucesso.`);
    } catch (e) {
      console.error('Error deleting dialogue:', e);
      showFeedback('Erro ao excluir podcast.');
    } finally {
      setDialogueToDelete(null);
    }
  };

  // Character Modal Save
  const handleSaveCharacter = async () => {
    if (!activeDialogue) return;
    if (!charName.trim()) {
      showFeedback('Informe o nome do personagem.');
      return;
    }

    const matchedVoice = voices.find((v) => v.id === charVoiceId) || CURATED_VOICES.find((v) => v.id === charVoiceId) || voices[0] || CURATED_VOICES[0];
    const settings: ProsodySettings = {
      rate: charRate,
      pitch: charPitch,
      volume: '+0%',
    };

    if (editingChar) {
      const voiceChanged = editingChar.voice.id !== charVoiceId || editingChar.settings.rate !== charRate || editingChar.settings.pitch !== charPitch;

      const updatedChars = activeDialogue.characters.map((c) =>
        c.id === editingChar.id
          ? {
              ...c,
              name: charName.trim(),
              voice: matchedVoice,
              settings,
              role: charRole.trim() || 'Participante',
              avatarColor: charColor,
            }
          : c
      );

      // If voice changed, mark its lines as pending so they can be regenerated with the new voice
      const updatedLines = voiceChanged
        ? activeDialogue.lines.map((l) =>
            l.characterId === editingChar.id ? { ...l, status: 'pending' as const, audio: undefined } : l
          )
        : activeDialogue.lines;

      await persistDialogue({ ...activeDialogue, characters: updatedChars, lines: updatedLines });
      showFeedback(`Personagem "${charName}" atualizado com a voz ${matchedVoice.name}!${voiceChanged ? ' As falas dele agora podem ser regeradas.' : ''}`);
    } else {
      // Add new character
      const newChar: DialogueCharacter = {
        id: `char-${Date.now()}`,
        name: charName.trim(),
        voice: matchedVoice,
        settings,
        role: charRole.trim() || 'Convidado',
        avatarColor: charColor,
      };
      await persistDialogue({
        ...activeDialogue,
        characters: [...activeDialogue.characters, newChar],
      });
      showFeedback(`Novo personagem "${charName}" adicionado com a voz ${matchedVoice.name}!`);
    }

    setIsCharModalOpen(false);
  };

  // Line Modal Save
  const handleSaveLine = async (generateNow = false) => {
    if (!activeDialogue) return;
    if (!lineText.trim()) {
      showFeedback('Por favor, informe a fala do personagem.');
      return;
    }

    let targetLineId = '';

    if (editingLine) {
      targetLineId = editingLine.id;
      const textChanged = editingLine.text !== lineText.trim();
      const charChanged = editingLine.characterId !== lineCharId;
      const needRegen = textChanged || charChanged;

      const updatedLines = activeDialogue.lines.map((l) =>
        l.id === editingLine.id
          ? {
              ...l,
              characterId: lineCharId,
              text: lineText.trim(),
              pauseAfterSeconds: linePause,
              status: needRegen ? ('pending' as const) : l.status,
              audio: needRegen ? undefined : l.audio,
            }
          : l
      );
      await persistDialogue({ ...activeDialogue, lines: updatedLines });
      showFeedback('Fala atualizada.');
    } else {
      targetLineId = `line-${Date.now()}`;
      const newLine: DialogueLine = {
        id: targetLineId,
        characterId: lineCharId || activeDialogue.characters[0]?.id || '',
        text: lineText.trim(),
        pauseAfterSeconds: linePause,
        status: 'pending',
        order: lineInsertIndex >= 0 ? lineInsertIndex : activeDialogue.lines.length,
      };

      let newLinesList = [...activeDialogue.lines];
      if (lineInsertIndex >= 0) {
        newLinesList.splice(lineInsertIndex, 0, newLine);
      } else {
        newLinesList.push(newLine);
      }
      newLinesList = newLinesList.map((l, idx) => ({ ...l, order: idx }));
      await persistDialogue({ ...activeDialogue, lines: newLinesList });
      showFeedback('Nova fala inserida na conversa!');
    }

    setIsLineModalOpen(false);

    if (generateNow && targetLineId) {
      generateAudioForLine(targetLineId);
    }
  };

  // Smart Script Parser (Import "Name: Line" formatted script)
  const handleImportSmartScript = async () => {
    if (!activeDialogue || !rawScriptText.trim()) return;

    const linesRaw = rawScriptText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsedLines: { speakerName: string; speech: string }[] = [];

    for (const raw of linesRaw) {
      // Match pattern "Nome: Fala" or "[Nome] Fala"
      const match = raw.match(/^([A-Za-zÀ-ÿ0-9\s]{2,20})[:\-—]\s*(.+)$/);
      if (match) {
        parsedLines.push({
          speakerName: match[1].trim(),
          speech: match[2].trim(),
        });
      } else if (parsedLines.length > 0) {
        // Multi-line continuation of previous speaker
        parsedLines[parsedLines.length - 1].speech += ' ' + raw;
      }
    }

    if (parsedLines.length === 0) {
      showFeedback('Nenhum diálogo no formato "Nome: Fala" identificado. Verifique o texto colado.');
      return;
    }

    // Identify or auto-create characters from names
    let updatedCharacters = [...activeDialogue.characters];
    const newDialogueLines: DialogueLine[] = [];

    for (const item of parsedLines) {
      let matchedChar = updatedCharacters.find(
        (c) => c.name.toLowerCase() === item.speakerName.toLowerCase()
      );

      if (!matchedChar) {
        // Auto create character with an unused voice and color
        const usedVoiceIds = new Set(updatedCharacters.map((c) => c.voice.id));
        const availableVoice = voices.find((v) => !usedVoiceIds.has(v.id)) || voices[updatedCharacters.length % voices.length];
        const color = AVATAR_COLORS[updatedCharacters.length % AVATAR_COLORS.length].id;

        matchedChar = {
          id: `char-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: item.speakerName,
          voice: availableVoice,
          settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
          role: 'Participante',
          avatarColor: color,
        };
        updatedCharacters.push(matchedChar);
      }

      newDialogueLines.push({
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        characterId: matchedChar.id,
        text: item.speech,
        pauseAfterSeconds: 0.4,
        status: 'pending',
        order: newDialogueLines.length,
      });
    }

    const finalDialogue: PodcastDialogue = {
      ...activeDialogue,
      characters: updatedCharacters,
      lines: newDialogueLines,
    };

    await persistDialogue(finalDialogue);
    setIsImportModalOpen(false);
    setRawScriptText('');
    showFeedback(`${parsedLines.length} falas importadas com sucesso!`);
  };

  // Create New Podcast Dialogue
  const handleCreateNewDialogue = async () => {
    if (!newTitle.trim()) {
      showFeedback('Informe o título do podcast.');
      return;
    }

    const newDialogue: PodcastDialogue = {
      id: `dialogue-${Date.now()}`,
      title: newTitle.trim(),
      description: newDesc.trim() || 'Diálogo natural entre múltiplos participantes estilo podcast.',
      category: newCategory,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      characters: [
        {
          id: `char-c1-${Date.now()}`,
          name: 'Carlos',
          voice: CURATED_VOICES.find((v) => v.id === 'pt-BR-AntonioNeural') || CURATED_VOICES[2],
          settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
          avatarColor: 'cyan',
          role: 'Apresentador',
        },
        {
          id: `char-c2-${Date.now()}`,
          name: 'Mariana',
          voice: CURATED_VOICES[0],
          settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
          avatarColor: 'rose',
          role: 'Convidada',
        },
      ],
      lines: [
        {
          id: `line-1-${Date.now()}`,
          characterId: `char-c1-${Date.now()}`,
          text: 'Olá pessoal! Sejam muito bem-vindos a este novo episódio do nosso podcast.',
          pauseAfterSeconds: 0.4,
          status: 'pending',
          order: 0,
        },
        {
          id: `line-2-${Date.now()}`,
          characterId: `char-c2-${Date.now()}`,
          text: 'Oi Carlos! É um prazer estar aqui hoje com você para bater esse papo.',
          pauseAfterSeconds: 0.4,
          status: 'pending',
          order: 1,
        },
      ],
    };

    await persistDialogue(newDialogue);
    setActiveDialogueId(newDialogue.id);
    setIsNewDialogueModalOpen(false);
    setNewTitle('');
    setNewDesc('');
    showFeedback(`Podcast "${newDialogue.title}" criado com sucesso!`);
  };

  // Concatenate and download unified podcast audio
  const handleUnifyPodcast = async () => {
    if (!activeDialogue) return;
    const readyLines = activeDialogue.lines.filter((l) => !!l.audio?.blob);
    if (readyLines.length === 0) {
      showFeedback('Gere os áudios das falas primeiro para montar o podcast.');
      return;
    }

    try {
      setIsUnifyingPodcast(true);
      showFeedback(`Concatenando ${readyLines.length} falas com pausas naturais...`);

      const blobs = readyLines.map((l) => l.audio!.blob!);
      const { blob: unifiedWavBlob, duration } = await concatenateAudioBlobs(blobs, 0.4);

      const filename = formatFilename(activeDialogue.title, 'podcast-completo', 'wav');
      downloadBlob(unifiedWavBlob, filename);

      setUnifiedSuccess(true);
      setTimeout(() => setUnifiedSuccess(false), 3500);
      showFeedback(`Podcast baixado com sucesso em WAV de alta qualidade (${formatTime(duration)})!`);
    } catch (err: any) {
      console.error('Error concatenating podcast:', err);
      showFeedback('Erro ao concatenar áudio do podcast.');
    } finally {
      setIsUnifyingPodcast(false);
    }
  };

  // Send unified podcast to VideoVozLivre
  const handleSendPodcastToVideo = async () => {
    if (!activeDialogue) return;
    const readyLines = activeDialogue.lines.filter((l) => !!l.audio?.blob);
    if (readyLines.length === 0) {
      showFeedback('Gere os áudios das falas primeiro para criar o vídeo.');
      return;
    }

    try {
      setIsUnifyingPodcast(true);
      showFeedback('Preparando áudio do podcast para o editor de vídeo...');

      const blobs = readyLines.map((l) => l.audio!.blob!);
      const { blob: unifiedWavBlob, duration } = await concatenateAudioBlobs(blobs, 0.4);

      const url = URL.createObjectURL(unifiedWavBlob);
      const unifiedAudio: GeneratedAudio = {
        id: `podcast-unified-${activeDialogue.id}`,
        title: activeDialogue.title,
        voice: activeDialogue.characters[0]?.voice || CURATED_VOICES[0],
        textSnippet: `${activeDialogue.title} (${readyLines.length} falas entre ${activeDialogue.characters.map((c) => c.name).join(', ')})`,
        charCount: activeDialogue.lines.reduce((acc, l) => acc + l.text.length, 0),
        durationSeconds: duration,
        createdAt: Date.now(),
        audioUrl: url,
        downloadUrl: url,
        blobUrl: url,
        blob: unifiedWavBlob,
        sizeBytes: unifiedWavBlob.size,
      };

      onSendToVideoEditor(unifiedAudio);
    } catch (err: any) {
      console.error('Error preparing podcast video audio:', err);
      showFeedback('Erro ao preparar áudio para vídeo.');
    } finally {
      setIsUnifyingPodcast(false);
    }
  };

  // Helper colors
  const getColorClasses = (colorId: string) => {
    return AVATAR_COLORS.find((c) => c.id === colorId) || AVATAR_COLORS[0];
  };

  // Current speaker and hierarchy helpers
  const currentPlayingLine = activeDialogue?.lines[currentPlayingLineIndex] || null;
  const currentSpeaker = activeDialogue?.characters.find((c) => c.id === currentPlayingLine?.characterId) || null;

  // First ready line in hierarchy (primeira voz que tiver áudio gerado na ordem do roteiro)
  const firstReadyLineIndex =
    activeDialogue?.lines.findIndex((l) => l.status === 'ready' && !!l.audio?.audioUrl) ?? -1;
  const firstReadyLine = firstReadyLineIndex >= 0 ? activeDialogue?.lines[firstReadyLineIndex] : null;
  const firstReadySpeaker = firstReadyLine
    ? activeDialogue?.characters.find((c) => c.id === firstReadyLine.characterId)
    : null;

  const selectedCharacter = selectedCharacterId
    ? activeDialogue?.characters.find((c) => c.id === selectedCharacterId)
    : null;

  const totalLines = activeDialogue?.lines.length || 0;
  const readyLinesCount = activeDialogue?.lines.filter((l) => l.status === 'ready').length || 0;
  const totalDialogueChars = activeDialogue?.lines.reduce((acc, l) => acc + l.text.length, 0) || 0;
  const estimatedTotalTime = estimateDurationSeconds(totalDialogueChars);

  return (
    <div className="space-y-6">
      <audio ref={audioRef} preload="metadata" />

      {/* Feedback message banner */}
      {feedbackMsg && (
        <div className="rounded-xl border border-cyan-800/80 bg-cyan-950/80 p-3.5 flex items-center justify-between gap-3 text-xs text-cyan-200 animate-in fade-in duration-200 shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" />
            <span className="font-medium">{feedbackMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="text-cyan-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Header and Subhead */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-neutral-900 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <span>Diálogo Natural</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800 tracking-wide uppercase">
              <Mic className="h-3 w-3" />
              Estilo Podcast
            </span>
          </h1>
          <p className="text-sm text-neutral-400 mt-1 max-w-2xl">
            Crie conversas dinâmicas e fluidas entre dois ou mais personagens com vozes neurais independentes. Cole roteiros prontos ou adicione falas alternadas com pausas de respiração humana real.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-xl transition-all cursor-pointer"
            title="Colar um roteiro de conversa completo formatado como 'Nome: Fala'"
          >
            <FileText className="h-4 w-4 text-cyan-400" />
            <span>Colar Roteiro Completo</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewDialogueModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Novo Podcast</span>
          </button>
        </div>
      </div>

      {/* Podcast Switcher Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <span className="text-xs text-neutral-400 shrink-0 font-medium mr-1 flex items-center gap-1.5">
          <Radio className="h-3.5 w-3.5 text-cyan-400" />
          <span>Podcasts / Diálogos:</span>
        </span>
        {dialogues.map((dlg) => {
          const isSelected = dlg.id === activeDialogueId;
          const readyCount = dlg.lines.filter((l) => l.status === 'ready').length;

          return (
            <button
              key={dlg.id}
              type="button"
              onClick={() => {
                setActiveDialogueId(dlg.id);
                setCurrentPlayingLineIndex(0);
                setSelectedCharacterId(null);
                setHasUserSelectedLine(false);
                if (audioRef.current) {
                  audioRef.current.pause();
                  setIsPlaying(false);
                }
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap flex items-center gap-2 border cursor-pointer ${
                isSelected
                  ? 'bg-neutral-800 text-white border-neutral-600 shadow-md ring-1 ring-cyan-500/20'
                  : 'bg-neutral-900/60 text-neutral-400 border-neutral-800 hover:border-neutral-700 hover:text-neutral-200'
              }`}
            >
              <span>{dlg.title}</span>
              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-neutral-950 text-neutral-400 border border-neutral-800">
                {readyCount}/{dlg.lines.length} falas
              </span>
            </button>
          );
        })}
      </div>

      {activeDialogue && (
        <div className="space-y-6">
          {/* Top Card: Podcast Details & Characters Management */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-5 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                    {activeDialogue.category || 'Podcast'}
                  </span>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    {activeDialogue.title}
                  </h2>
                </div>
                <p className="text-xs text-neutral-400 mt-1 max-w-2xl">
                  {activeDialogue.description}
                </p>
              </div>

              {/* Master Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {readyLinesCount < totalLines && (
                  <button
                    type="button"
                    onClick={generateAllPendingLines}
                    disabled={isGeneratingAll}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-cyan-400 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    title="Sintetizar áudio de todas as falas que ainda faltam"
                  >
                    {isGeneratingAll ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    <span>{isGeneratingAll ? 'Sintetizando...' : 'Gerar Todas as Falas'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleUnifyPodcast}
                  disabled={readyLinesCount === 0 || isUnifyingPodcast}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                  title="Juntar todas as falas em um único podcast completo e baixar"
                >
                  {unifiedSuccess ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Download className="h-3.5 w-3.5" />}
                  <span>{isUnifyingPodcast ? 'Unificando...' : 'Baixar Podcast Completo'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSendPodcastToVideo}
                  disabled={readyLinesCount === 0 || isUnifyingPodcast}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-violet-950/80 hover:bg-violet-900 border border-violet-700/80 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                  title="Enviar áudio do podcast para o editor de vídeo VideoVozLivre"
                >
                  <Film className="h-3.5 w-3.5 text-violet-300" />
                  <span>Criar Vídeo do Podcast</span>
                </button>

                {/* Delete Podcast Button */}
                <button
                  type="button"
                  onClick={() => setDialogueToDelete(activeDialogue)}
                  className="p-1.5 text-neutral-400 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                  title="Excluir este podcast"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Characters Bar (Múltiplos personagens configuráveis) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Personagens & Vozes Neurais ({activeDialogue.characters.length}):</span>
                  </span>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    Adicione quantos participantes desejar ou troque a voz de cada um diretamente no card.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEditingChar(null);
                    setCharName('');
                    // Auto-select an unused voice if available
                    const usedIds = new Set(activeDialogue.characters.map((c) => c.voice.id));
                    const unused = voices.find((v) => !usedIds.has(v.id)) || voices[activeDialogue.characters.length % voices.length] || CURATED_VOICES[0];
                    setCharVoiceId(unused.id);
                    setCharRole('Convidado');
                    setCharColor(AVATAR_COLORS[activeDialogue.characters.length % AVATAR_COLORS.length].id);
                    setCharRate('+0%');
                    setCharPitch('+0Hz');
                    setIsCharModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-neutral-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-all shadow-sm active:scale-95 cursor-pointer"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>+ Adicionar Personagem</span>
                </button>
              </div>

              {/* Character Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
                {activeDialogue.characters.map((char) => {
                  const color = getColorClasses(char.avatarColor);
                  const isCurrentlySpeaking = isPlaying && currentSpeaker?.id === char.id;
                  const charVoice = resolveCharacterVoice(char);
                  const isPreviewingThis = previewVoiceId === charVoice.id;

                  return (
                    <div
                      key={char.id}
                      className={`rounded-2xl border p-3.5 flex flex-col justify-between gap-3 transition-all ${
                        isCurrentlySpeaking
                          ? `${color.bg} ${color.border} ring-2 ${color.activeRing} shadow-lg scale-[1.02]`
                          : 'bg-neutral-950/70 border-neutral-800 hover:border-neutral-700 shadow-md'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 border ${color.bg} ${color.text} ${color.border}`}
                          >
                            {char.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-xs font-bold text-white truncate">{char.name}</h4>
                              {isCurrentlySpeaking && (
                                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping"></span>
                              )}
                            </div>
                            <span className="text-[10px] text-neutral-400 truncate block">
                              {char.role || 'Participante'}
                            </span>
                          </div>
                        </div>

                        {/* Top corner actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handlePreviewVoice(charVoice)}
                            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                              isPreviewingThis
                                ? 'bg-cyan-900 text-cyan-200 border-cyan-700 animate-pulse'
                                : 'text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border-neutral-800'
                            }`}
                            title="Ouvir demonstração desta voz"
                          >
                            <Volume2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingChar(char);
                              setCharName(char.name);
                              setCharVoiceId(charVoice.id);
                              setCharRole(char.role || 'Participante');
                              setCharColor(char.avatarColor || 'cyan');
                              setCharRate(char.settings.rate || '+0%');
                              setCharPitch(char.settings.pitch || '+0Hz');
                              setIsCharModalOpen(true);
                            }}
                            className="p-1.5 text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors cursor-pointer"
                            title="Editar personagem e voz no catálogo completo"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          {activeDialogue.characters.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setCharToDelete(char)}
                              className="p-1.5 text-neutral-500 hover:text-rose-400 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors cursor-pointer"
                              title="Remover personagem do podcast"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Quick Voice Actions & Selector on Card */}
                      <div className="pt-2 border-t border-neutral-800/80 space-y-2">
                        <div className="flex items-center justify-between text-[10px] text-neutral-400">
                          <span>Voz Neural:</span>
                          <button
                            type="button"
                            onClick={() => setCharForVoiceModal(char)}
                            className="text-cyan-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                            title="Abrir catálogo completo de vozes neurais"
                          >
                            <Volume2 className="h-3 w-3" />
                            <span>Alterar Voz</span>
                          </button>
                        </div>

                        <select
                          value={charVoice.id}
                          onChange={(e) => handleQuickChangeVoice(char.id, e.target.value)}
                          className="w-full bg-neutral-900 border border-neutral-700/80 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 cursor-pointer font-sans"
                        >
                          <optgroup label="Masculinas Brasil (7)">
                            {allVoices
                              .filter((v) => v.lang === 'pt-BR' && v.gender === 'Masculino')
                              .map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name} (Brasil · Masculino)
                                </option>
                              ))}
                          </optgroup>
                          <optgroup label="Femininas Brasil (2)">
                            {allVoices
                              .filter((v) => v.lang === 'pt-BR' && v.gender === 'Feminino')
                              .map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name} (Brasil · Feminino)
                                </option>
                              ))}
                          </optgroup>
                          <optgroup label="Portugal">
                            {allVoices
                              .filter((v) => v.lang === 'pt-PT')
                              .map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name} ({v.langLabel} · {v.gender})
                                </option>
                              ))}
                          </optgroup>
                          <optgroup label="Outros Idiomas (Inglês & Espanhol)">
                            {allVoices
                              .filter((v) => !v.lang.startsWith('pt'))
                              .map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name} ({v.langLabel} · {v.gender})
                                </option>
                              ))}
                          </optgroup>
                        </select>

                        {/* Quick Play Selection Toggle Button */}
                        <button
                          type="button"
                          onClick={() => setSelectedCharacterId(selectedCharacterId === char.id ? null : char.id)}
                          className={`w-full py-1 px-2 rounded-md text-[11px] font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer border ${
                            selectedCharacterId === char.id
                              ? 'bg-blue-600 text-white border-blue-500'
                              : 'bg-neutral-900 text-neutral-400 hover:text-white border-neutral-800'
                          }`}
                        >
                          <Play className="h-2.5 w-2.5 fill-current" />
                          <span>
                            {selectedCharacterId === char.id
                              ? 'Voz Selecionada para Início'
                              : 'Iniciar Podcast Desta Voz'}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Master Podcast Player Console */}
          <div className="rounded-xl border border-neutral-700/80 bg-neutral-950 p-4 space-y-3.5 shadow-inner">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {/* Vibrant Blue Play Button */}
                <button
                  type="button"
                  onClick={togglePlayPodcast}
                  className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-lg shadow-blue-600/30 active:scale-95 cursor-pointer shrink-0"
                  title={
                    isPlaying
                      ? 'Pausar Podcast'
                      : !selectedCharacterId
                      ? `Iniciar na 1ª voz gerada na hierarquia (${firstReadySpeaker?.name || 'Aguardando'})`
                      : `Iniciar no personagem ${selectedCharacter?.name}`
                  }
                >
                  {isPlaying ? (
                    <Pause className="h-6 w-6 fill-current" />
                  ) : (
                    <Play className="h-6 w-6 fill-current ml-0.5" />
                  )}
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.2 rounded bg-neutral-900 text-blue-400 border border-neutral-800 font-bold">
                      {isPlaying ? 'Em Reprodução' : 'Pausado'}
                    </span>
                    {currentSpeaker && (
                      <span className="text-xs text-white font-bold flex items-center gap-1.5">
                        <span className="text-blue-300">Falando:</span> {currentSpeaker.name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-300 truncate max-w-md mt-1">
                    {currentPlayingLine?.text ? `"${currentPlayingLine.text}"` : 'Pronto para iniciar podcast'}
                  </p>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    {!selectedCharacterId ? (
                      <span className="text-blue-300 font-medium">
                        Sem voz selecionada · O play azul iniciará na 1ª voz gerada na hierarquia ({firstReadySpeaker ? `"${firstReadySpeaker.name}", fala #${firstReadyLineIndex + 1}` : 'nenhuma voz gerada ainda'})
                      </span>
                    ) : (
                      <span className="text-cyan-300 font-medium">
                        Voz selecionada: "{selectedCharacter?.name}" · Clique no botão para alternar
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Player Controls */}
              <div className="flex items-center gap-2 self-end sm:self-center">
                <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-lg border border-neutral-800">
                  <button
                    type="button"
                    onClick={() => playLineAtIndex(Math.max(0, currentPlayingLineIndex - 1))}
                    disabled={currentPlayingLineIndex === 0}
                    className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-30 rounded"
                    title="Fala anterior"
                  >
                    <Rewind className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => playLineAtIndex(Math.min(totalLines - 1, currentPlayingLineIndex + 1))}
                    disabled={currentPlayingLineIndex >= totalLines - 1}
                    className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-30 rounded"
                    title="Próxima fala"
                  >
                    <FastForward className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 p-0.5 rounded-lg">
                  {[1.0, 1.25, 1.5].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => {
                        setPlaybackRate(rate);
                        if (audioRef.current) audioRef.current.playbackRate = rate;
                      }}
                      className={`px-2 py-0.5 text-xs font-mono rounded ${
                        playbackRate === rate
                          ? 'bg-white text-neutral-950 font-bold'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Voice Hierarchy Filter Bar */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-neutral-900 text-xs">
              <span className="text-[11px] text-neutral-400 font-semibold flex items-center gap-1 mr-1">
                <Users className="h-3 w-3 text-blue-400" />
                <span>Iniciar a partir de:</span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedCharacterId(null)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  !selectedCharacterId
                    ? 'bg-blue-600 text-white border-blue-500 shadow-sm font-semibold'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
                }`}
              >
                1ª voz na hierarquia (Sem voz selecionada)
              </button>
              {activeDialogue.characters.map((c) => {
                const isSel = selectedCharacterId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCharacterId(isSel ? null : c.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer flex items-center gap-1.5 ${
                      isSel
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm font-semibold'
                        : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
                    }`}
                  >
                    <span>{c.name}</span>
                    <span className="text-[10px] opacity-75 font-mono">({c.voice.name})</span>
                  </button>
                );
              })}
            </div>

            {/* Visualizer & scrubber */}
            <div className="flex items-center gap-3 pt-1">
              <canvas
                ref={canvasRef}
                width={130}
                height={22}
                className="w-28 sm:w-32 h-6 shrink-0 hidden sm:block"
              />

              <span className="text-xs font-mono text-neutral-400 tabular-nums shrink-0">
                {formatTime(currentLineTime)}
              </span>

              <input
                type="range"
                min={0}
                max={currentLineDuration || 100}
                step={0.1}
                value={currentLineTime}
                onChange={(e) => {
                  const t = parseFloat(e.target.value);
                  setCurrentLineTime(t);
                  if (audioRef.current) audioRef.current.currentTime = t;
                }}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />

              <span className="text-xs font-mono text-neutral-400 tabular-nums shrink-0">
                {formatTime(currentLineDuration)}
              </span>
            </div>
          </div>

          {/* Dialogue Timeline / Speech Bubbles */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-cyan-400" />
                  <span>Roteiro do Diálogo ({totalLines} falas)</span>
                </h3>
                <p className="text-xs text-neutral-400">
                  Falas ordenadas da conversa. Cada fala é dita pelo personagem correspondente com sua voz e pausas configuradas.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditingLine(null);
                  setLineCharId(activeDialogue.characters[0]?.id || '');
                  setLineText('');
                  setLinePause(0.4);
                  setLineInsertIndex(-1);
                  setIsLineModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Adicionar Fala</span>
              </button>
            </div>

            {/* Conversation Bubbles List */}
            <div className="space-y-3">
              {activeDialogue.lines.map((line, index) => {
                const char = activeDialogue.characters.find((c) => c.id === line.characterId) || activeDialogue.characters[0];
                const color = getColorClasses(char?.avatarColor || 'cyan');
                const isLinePlaying = isPlaying && currentPlayingLineIndex === index;
                const isGenerating = generatingLineId === line.id;
                const isReady = line.status === 'ready' && !!line.audio;

                return (
                  <div
                    key={line.id}
                    className={`rounded-2xl border p-4 transition-all duration-200 ${
                      isLinePlaying
                        ? `${color.bg} ${color.border} ring-2 ${color.activeRing} shadow-xl scale-[1.01]`
                        : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      {/* Left: Speaker Avatar, Name, Speech */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div
                          className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-xs shrink-0 border ${color.bg} ${color.text} ${color.border}`}
                        >
                          {char?.name.slice(0, 2).toUpperCase() || 'P'}
                        </div>

                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-white">{char?.name || 'Personagem'}</span>
                            <span className="text-[10px] text-neutral-400 font-mono">
                              ({char?.voice.name})
                            </span>
                            <span className="text-[10px] text-neutral-500">#{index + 1}</span>

                            {/* Status */}
                            {isGenerating ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>Sintetizando...</span>
                              </span>
                            ) : isReady ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                                <Check className="h-3 w-3" />
                                <span>Áudio Pronto ({formatTime(line.audio?.durationSeconds || 0)})</span>
                              </span>
                            ) : line.status === 'error' ? (
                              <span className="text-[10px] text-rose-400 bg-rose-950 px-2 py-0.5 rounded border border-rose-800">
                                Erro
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-400 bg-amber-950 px-2 py-0.5 rounded border border-amber-800">
                                Pendente
                              </span>
                            )}

                            {isLinePlaying && (
                              <span className="text-[10px] font-mono text-cyan-300 font-bold animate-pulse">
                                ▶ Falando Agora
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-neutral-200 leading-relaxed font-sans bg-neutral-950/60 p-2.5 rounded-xl border border-neutral-800/80">
                            {line.text}
                          </p>

                          <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                            <span className="font-mono">{line.text.length} caracteres</span>
                            <span aria-hidden="true">·</span>
                            <span>Pausa após fala: <strong className="text-neutral-300 font-mono">{line.pauseAfterSeconds}s</strong></span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center flex-wrap">
                        {isReady && (
                          <button
                            type="button"
                            onClick={() => playLineAtIndex(index)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                            title="Ouvir esta fala"
                          >
                            <Play className="h-3 w-3 fill-current" />
                            <span>Ouvir</span>
                          </button>
                        )}

                        {!isReady && (
                          <button
                            type="button"
                            onClick={() => generateAudioForLine(line.id)}
                            disabled={isGenerating}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title="Sintetizar áudio desta fala"
                          >
                            {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                            <span>Gerar Áudio</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setEditingLine(line);
                            setLineCharId(line.characterId);
                            setLineText(line.text);
                            setLinePause(line.pauseAfterSeconds);
                            setLineInsertIndex(-1);
                            setIsLineModalOpen(true);
                          }}
                          className="p-1.5 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                          title="Editar texto, trocar personagem ou regenerar áudio"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>

                        {/* Insert next line */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLine(null);
                            // Alternate character automatically for quick dialog building!
                            const nextChar = activeDialogue.characters.find((c) => c.id !== line.characterId) || activeDialogue.characters[0];
                            setLineCharId(nextChar?.id || '');
                            setLineText('');
                            setLinePause(0.4);
                            setLineInsertIndex(index + 1);
                            setIsLineModalOpen(true);
                          }}
                          className="p-1.5 text-neutral-400 hover:text-cyan-400 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                          title="Inserir fala logo após esta"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => moveLine(index, 'up')}
                          disabled={index === 0}
                          className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-20 rounded-lg transition-colors cursor-pointer"
                          title="Mover para cima"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => moveLine(index, 'down')}
                          disabled={index === totalLines - 1}
                          className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-20 rounded-lg transition-colors cursor-pointer"
                          title="Mover para baixo"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setLineToDelete(line)}
                          className="p-1.5 text-neutral-500 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                          title="Excluir fala"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add or Edit Line */}
      {isLineModalOpen && activeDialogue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Mic className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm sm:text-base font-bold text-white">
                  {editingLine ? 'Editar Fala do Diálogo' : 'Adicionar Fala à Conversa'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsLineModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Speaker Select */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Quem fala esta frase?
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {activeDialogue.characters.map((c) => {
                    const isSelected = (lineCharId || activeDialogue.characters[0]?.id) === c.id;
                    const color = getColorClasses(c.avatarColor);

                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setLineCharId(c.id)}
                        className={`p-2 rounded-xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                          isSelected
                            ? `${color.bg} ${color.border} ring-2 ${color.activeRing}`
                            : 'bg-neutral-950 border-neutral-800 hover:border-neutral-700'
                        }`}
                      >
                        <div
                          className={`h-7 w-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${color.bg} ${color.text} border ${color.border}`}
                        >
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <strong className="text-xs text-white block truncate">{c.name}</strong>
                          <span className="text-[10px] text-neutral-400 truncate block font-mono">
                            {c.voice.name}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Speech Text */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Texto da fala:
                </label>
                <textarea
                  value={lineText}
                  onChange={(e) => setLineText(e.target.value)}
                  rows={4}
                  placeholder="Escreva a resposta ou fala deste personagem na conversa..."
                  className="w-full bg-neutral-950 border border-neutral-800 p-3 text-sm text-white rounded-xl focus:outline-none focus:border-cyan-500 font-sans leading-relaxed"
                />
              </div>

              {/* Pause after line */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-neutral-300">
                    Pausa de respiração após a fala:
                  </label>
                  <span className="font-mono text-cyan-400 font-bold">{linePause} segundos</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {[0.2, 0.4, 0.6, 0.8, 1.2].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setLinePause(p)}
                      className={`flex-1 py-1.5 text-xs font-mono rounded-lg border transition-colors ${
                        linePause === p
                          ? 'bg-cyan-950 text-cyan-300 border-cyan-700 font-bold'
                          : 'bg-neutral-950 text-neutral-400 border-neutral-800 hover:text-white'
                      }`}
                    >
                      {p}s
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-800 p-4 bg-neutral-950 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsLineModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleSaveLine(false)}
                className="px-4 py-2 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
              >
                Salvar Rascunho
              </button>
              <button
                type="button"
                onClick={() => handleSaveLine(true)}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Sparkles className="h-4 w-4" />
                <span>Salvar & Gerar Áudio</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add or Edit Character with Full Voice Catalog */}
      {isCharModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden max-h-[92vh]">
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm sm:text-base font-bold text-white">
                  {editingChar ? `Editar Personagem: ${editingChar.name}` : 'Adicionar Novo Personagem'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCharModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300">Nome do Personagem:</label>
                  <input
                    type="text"
                    value={charName}
                    onChange={(e) => setCharName(e.target.value)}
                    placeholder="Ex: Carlos, Mariana, Doutor Lucas, Narrador..."
                    className="w-full bg-neutral-950 border border-neutral-800 px-3.5 py-2 text-sm text-white rounded-xl focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-neutral-300">Papel / Função no Podcast:</label>
                  <input
                    type="text"
                    value={charRole}
                    onChange={(e) => setCharRole(e.target.value)}
                    placeholder="Ex: Host, Especialista em IA, Comentarista, Convidado..."
                    className="w-full bg-neutral-950 border border-neutral-800 px-3.5 py-2 text-xs text-white rounded-xl focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Color badge */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">Cor do Avatar:</label>
                <div className="flex items-center gap-2">
                  {AVATAR_COLORS.map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => setCharColor(col.id)}
                      className={`h-7 w-7 rounded-full border transition-transform cursor-pointer ${col.bg} ${col.border} ${
                        charColor === col.id ? 'scale-125 ring-2 ring-white' : 'opacity-60 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Full Voice Selector from Text-to-Speech tab */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-neutral-300 flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Catálogo Completo de Vozes Neurais:</span>
                  </label>
                  <span className="text-cyan-400 font-mono text-[11px]">
                    Selecionada: <strong>{voices.find((v) => v.id === charVoiceId)?.name || 'Francisca'}</strong>
                  </span>
                </div>
                <div className="border border-neutral-800 rounded-xl p-3 bg-neutral-950/70 max-h-[300px] overflow-y-auto">
                  <VoiceSelector
                    voices={voices}
                    selectedVoiceId={charVoiceId}
                    onSelectVoice={(v) => setCharVoiceId(v.id)}
                  />
                </div>
              </div>

              {/* Speed & Pitch */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-400">Velocidade da fala:</label>
                  <select
                    value={charRate}
                    onChange={(e) => setCharRate(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-white rounded-xl focus:outline-none cursor-pointer"
                  >
                    <option value="-25%">0.75x (Mais Lenta)</option>
                    <option value="+0%">1.0x (Padrão Natural)</option>
                    <option value="+15%">1.15x</option>
                    <option value="+25%">1.25x (Dinâmica)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-400">Tom de voz (Pitch):</label>
                  <select
                    value={charPitch}
                    onChange={(e) => setCharPitch(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 px-2.5 py-1.5 text-xs text-white rounded-xl focus:outline-none cursor-pointer"
                  >
                    <option value="-15Hz">Grave / Encorpado</option>
                    <option value="+0Hz">Natural / Equilibrado</option>
                    <option value="+15Hz">Agudo / Leve</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-800 p-4 bg-neutral-950 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCharModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveCharacter}
                className="px-5 py-2 text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
              >
                {editingChar ? 'Salvar Alterações' : 'Adicionar ao Podcast'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Smart Script Importer (Paste "Name: Line") */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Colar Roteiro de Conversa Completo
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto">
              <p className="text-xs text-neutral-400 leading-relaxed">
                Cole o roteiro com o nome do personagem antes de cada fala (ex: <strong className="text-white">Carlos: Fala aqui...</strong>). O sistema detectará automaticamente os participantes e gerará o diálogo dividido em turnos!
              </p>

              <textarea
                value={rawScriptText}
                onChange={(e) => setRawScriptText(e.target.value)}
                rows={9}
                placeholder={`Carlos: Olá pessoal! Sejam bem-vindos a mais um episódio.\nMariana: Oi Carlos! Muito feliz em participar dessa conversa hoje.\nCarlos: Vamos debater como a síntese neural avançou tanto nos últimos meses.`}
                className="w-full bg-neutral-950 border border-neutral-800 p-3.5 text-xs text-white rounded-xl focus:outline-none focus:border-cyan-500 font-mono leading-relaxed"
              />

              <div className="flex items-center justify-between text-[11px] text-neutral-500">
                <span>Formato suportado: "Nome: Mensagem" em linhas consecutivas</span>
                <button
                  type="button"
                  onClick={() =>
                    setRawScriptText(
                      `Carlos: Olá a todos! Sejam muito bem-vindos ao podcast Diálogo Natural.\nMariana: Oi Carlos! Prazer enorme estar aqui com você hoje.\nCarlos: Hoje vamos demonstrar como duas pessoas conversam de forma ultra-realista e fluida.\nMariana: E o mais incrível é que cada personagem tem sua própria voz neural e entonação perfeita!`
                    )
                  }
                  className="text-cyan-400 hover:underline cursor-pointer"
                >
                  Inserir exemplo pronto
                </button>
              </div>
            </div>

            <div className="border-t border-neutral-800 p-4 bg-neutral-950 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleImportSmartScript}
                disabled={!rawScriptText.trim()}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-40"
              >
                <Wand2 className="h-4 w-4" />
                <span>Processar & Importar Diálogo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create New Dialogue */}
      {isNewDialogueModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <FolderPlus className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm sm:text-base font-bold text-white">Criar Novo Podcast / Diálogo</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsNewDialogueModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">Título do Podcast / Conversa:</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ex: Café & Negócios: Episódio 01"
                  className="w-full bg-neutral-950 border border-neutral-800 px-3.5 py-2 text-sm text-white rounded-xl focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">Tema / Categoria:</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs text-white rounded-xl focus:outline-none focus:border-cyan-500 cursor-pointer"
                >
                  <option value="Tecnologia & Inovação">Tecnologia & Inovação</option>
                  <option value="Mistério & Suspense">Mistério & Suspense</option>
                  <option value="Negócios & Mídia">Negócios & Mídia</option>
                  <option value="Filosofia & Cotidiano">Filosofia & Cotidiano</option>
                  <option value="Educação & Ciência">Educação & Ciência</option>
                  <option value="Comédia & Entrevista">Comédia & Entrevista</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">Sinopse da Conversa:</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={3}
                  placeholder="Sobre o que os personagens vão conversar neste episódio..."
                  className="w-full bg-neutral-950 border border-neutral-800 p-3 text-xs text-white rounded-xl focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="border-t border-neutral-800 p-4 bg-neutral-950 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewDialogueModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateNewDialogue}
                className="px-5 py-2 text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
              >
                Criar Diálogo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Delete Dialogue */}
      {dialogueToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-rose-950/80 border border-rose-800 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Excluir Podcast?</h3>
                <p className="text-xs text-neutral-400 mt-0.5">Esta ação não pode ser desfeita.</p>
              </div>
            </div>

            <p className="text-xs text-neutral-300 bg-neutral-950 p-3 rounded-xl border border-neutral-800 leading-relaxed">
              Tem certeza que deseja excluir <strong className="text-white">"{dialogueToDelete.title}"</strong> com todas as suas {dialogueToDelete.lines.length} falas gravadas?
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDialogueToDelete(null)}
                className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeDeleteDialogue}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Sim, Excluir Podcast</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Delete Line */}
      {lineToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-rose-950/80 border border-rose-800 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Excluir Fala?</h3>
                <p className="text-xs text-neutral-400 mt-0.5">A frase será removida da conversa.</p>
              </div>
            </div>

            <p className="text-xs text-neutral-300 bg-neutral-950 p-3 rounded-xl border border-neutral-800 leading-relaxed">
              Deseja remover a fala: <strong className="text-white">"{lineToDelete.text.slice(0, 70)}..."</strong>?
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setLineToDelete(null)}
                className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeDeleteLine}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Excluir Fala</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Delete Character */}
      {charToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-rose-950/80 border border-rose-800 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Remover Personagem?</h3>
                <p className="text-xs text-neutral-400 mt-0.5">As falas atribuídas a ele serão transferidas.</p>
              </div>
            </div>

            <p className="text-xs text-neutral-300 bg-neutral-950 p-3 rounded-xl border border-neutral-800 leading-relaxed">
              Deseja remover <strong className="text-white">"{charToDelete.name}"</strong>?
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCharToDelete(null)}
                className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeDeleteCharacter}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remover Personagem</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal: Fast Voice Picker for Character */}
      {charForVoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden max-h-[92vh]">
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3.5 bg-neutral-950">
              <div className="flex items-center gap-2">
                <Volume2 className="h-5 w-5 text-cyan-400" />
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Trocar Voz Neural de "{charForVoiceModal.name}"
                  </h3>
                  <p className="text-[11px] text-neutral-400">
                    Voz atual: <span className="text-cyan-300 font-semibold">{charForVoiceModal.voice.name} ({charForVoiceModal.voice.gender})</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCharForVoiceModal(null)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
              <p className="text-xs text-neutral-300 leading-relaxed bg-neutral-950/80 p-3 rounded-xl border border-neutral-800">
                Selecione qualquer uma das <strong>19 vozes neurais</strong> com entonação humana natural. Você pode ouvir uma prévia antes de escolher. Ao clicar, a voz deste participante será atualizada imediatamente no roteiro.
              </p>

              <VoiceSelector
                voices={allVoices}
                selectedVoiceId={charForVoiceModal.voice.id}
                onSelectVoice={(selectedV) => {
                  handleQuickChangeVoice(charForVoiceModal.id, selectedV.id);
                  setCharForVoiceModal(null);
                }}
              />
            </div>

            <div className="border-t border-neutral-800 px-5 py-3 bg-neutral-950 flex items-center justify-between text-xs text-neutral-400">
              <span>Todas as vozes usam modelos neurais expressivos sem limite de créditos.</span>
              <button
                type="button"
                onClick={() => setCharForVoiceModal(null)}
                className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white font-medium cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
