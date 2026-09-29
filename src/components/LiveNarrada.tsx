import React, { useState, useEffect, useRef } from 'react';
import {
  Radio,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  SkipBack,
  Plus,
  Trash2,
  Edit3,
  RefreshCw,
  Download,
  Volume2,
  Film,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Layers,
  BookOpen,
  CheckCircle2,
  Clock,
  FileAudio,
  Check,
  X,
  Sliders,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  HelpCircle,
  Loader2,
  Wand2,
  FolderPlus,
  Share2,
  Maximize2,
  Minimize2,
  Grid,
  ExternalLink,
  Flame,
} from 'lucide-react';
import {
  NarratedStory,
  StorySegment,
  Voice,
  GeneratedAudio,
  ProsodySettings,
} from '../types';
import { CURATED_VOICES } from '../constants/voices';
import { SAMPLE_STORIES } from '../constants/sampleStories';
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
  getAllStoriesFromDB,
  saveStoryToDB,
  deleteStoryFromDB,
} from '../utils/db';

interface LiveNarradaProps {
  voices: Voice[];
  onSendToVideoEditor: (audio: GeneratedAudio) => void;
  onNavigateToConverter: () => void;
}

export const LiveNarrada: React.FC<LiveNarradaProps> = ({
  voices,
  onSendToVideoEditor,
}) => {
  // Stories state
  const [stories, setStories] = useState<NarratedStory[]>([]);
  const [activeStoryId, setActiveStoryId] = useState<string>('');
  const [isLoadingStories, setIsLoadingStories] = useState<boolean>(true);

  // View state: 'cards' (minimized floating cards overview) or 'story' (maximized story workspace)
  const [viewMode, setViewMode] = useState<'cards' | 'story'>('cards');
  // Full-screen / ultra-maximize toggle for story workspace
  const [isStoryExpanded, setIsStoryExpanded] = useState<boolean>(false);
  // Minimize/maximize toggles for sub-panels within the story workspace
  const [isPlayerMinimized, setIsPlayerMinimized] = useState<boolean>(false);
  const [isSegmentsMinimized, setIsSegmentsMinimized] = useState<boolean>(false);

  // Story Creation & Edit Modals
  const [isNewStoryModalOpen, setIsNewStoryModalOpen] = useState<boolean>(false);
  const [newStoryTitle, setNewStoryTitle] = useState<string>('');
  const [newStoryCategory, setNewStoryCategory] = useState<string>('Mistério & Ficção');
  const [newStoryDesc, setNewStoryDesc] = useState<string>('');
  const [newStoryVoiceId, setNewStoryVoiceId] = useState<string>(CURATED_VOICES[0].id);

  // Delete confirmation modal states (avoiding window.confirm iframe blockage)
  const [storyToDelete, setStoryToDelete] = useState<NarratedStory | null>(null);
  const [segmentToDelete, setSegmentToDelete] = useState<{ segmentId: string; title: string } | null>(null);

  // Segment Creation / Editing Modal
  const [editingSegment, setEditingSegment] = useState<StorySegment | null>(null);
  const [isSegmentModalOpen, setIsSegmentModalOpen] = useState<boolean>(false);
  const [segmentTitle, setSegmentTitle] = useState<string>('');
  const [segmentText, setSegmentText] = useState<string>('');
  const [segmentVoiceId, setSegmentVoiceId] = useState<string>(CURATED_VOICES[0].id);
  const [segmentRate, setSegmentRate] = useState<string>('+0%');
  const [segmentPitch, setSegmentPitch] = useState<string>('+0Hz');
  const [insertPosition, setInsertPosition] = useState<number>(-1); // -1 = at end

  // Live Sequencer Audio Player state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playingStoryId, setPlayingStoryId] = useState<string>('');
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState<number>(0);
  const [currentPartTime, setCurrentPartTime] = useState<number>(0);
  const [currentPartDuration, setCurrentPartDuration] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [pauseBetweenParts, setPauseBetweenParts] = useState<number>(0.5); // seconds
  const [autoPlayNext, setAutoPlayNext] = useState<boolean>(true);
  const [volume, setVolume] = useState<number>(1.0);

  // Generation queue state
  const [generatingSegmentId, setGeneratingSegmentId] = useState<string | null>(null);
  const [generatingStoryId, setGeneratingStoryId] = useState<string | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState<boolean>(false);
  const [isUnifyingAudio, setIsUnifyingAudio] = useState<boolean>(false);
  const [unifySuccess, setUnifySuccess] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Audio & Canvas references
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pauseTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Stories Ref to prevent stale closures during batch generation
  const storiesRef = useRef<NarratedStory[]>(stories);
  useEffect(() => {
    storiesRef.current = stories;
  }, [stories]);

  // Active Story helper
  const activeStory = stories.find((s) => s.id === activeStoryId) || stories[0] || null;
  // Currently playing story helper
  const playingStory = stories.find((s) => s.id === playingStoryId) || activeStory;

  // Load Stories from IndexedDB on Mount (or load samples if empty)
  useEffect(() => {
    async function loadInitialStories() {
      try {
        setIsLoadingStories(true);
        const stored = await getAllStoriesFromDB();
        if (stored && stored.length > 0) {
          // Normalize any stuck 'generating' segments to 'pending'
          const normalized = stored.map((st) => ({
            ...st,
            segments: st.segments.map((seg) => ({
              ...seg,
              status: seg.status === 'generating' ? (seg.audio ? 'ready' : 'pending') : seg.status,
            })),
          }));
          setStories(normalized);
          storiesRef.current = normalized;
          setActiveStoryId(normalized[0].id);
        } else {
          // Initialize with curated sample stories (UFO & Fazenda)
          for (const sample of SAMPLE_STORIES) {
            await saveStoryToDB(sample);
          }
          setStories(SAMPLE_STORIES);
          storiesRef.current = SAMPLE_STORIES;
          setActiveStoryId(SAMPLE_STORIES[0].id);
        }
      } catch (err) {
        console.error('Failed to load stories from IndexedDB:', err);
        setStories(SAMPLE_STORIES);
        storiesRef.current = SAMPLE_STORIES;
        setActiveStoryId(SAMPLE_STORIES[0].id);
      } finally {
        setIsLoadingStories(false);
      }
    }
    loadInitialStories();
  }, []);

  // Save current active story helper
  const persistStory = async (updatedStory: NarratedStory) => {
    storiesRef.current = storiesRef.current.map((s) =>
      s.id === updatedStory.id ? updatedStory : s
    );
    setStories((prev) =>
      prev.map((s) => (s.id === updatedStory.id ? updatedStory : s))
    );
    try {
      await saveStoryToDB(updatedStory);
    } catch (e) {
      console.error('Error persisting story:', e);
    }
  };

  // Show transient feedback message
  const showFeedback = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => {
      setFeedbackMessage((current) => (current === msg ? null : current));
    }, 4000);
  };

  // Waveform canvas visualizer
  useEffect(() => {
    let animId: number;
    const numBars = 36;
    const barWidth = 3;
    const gap = 3;

    const render = () => {
      const renderOnCtx = (canvas: HTMLCanvasElement | null) => {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const progress = currentPartDuration > 0 ? currentPartTime / currentPartDuration : 0;

        for (let i = 0; i < numBars; i++) {
          const x = i * (barWidth + gap);
          const barProgress = i / numBars;
          const isPast = barProgress <= progress;

          const timeFactor = isPlaying ? Date.now() / 200 : 0;
          const baseHeight = 5 + Math.sin(i * 0.45 + timeFactor) * 8 + Math.cos(i * 0.9) * 5;
          const height = Math.max(4, Math.min(canvas.height - 4, baseHeight));
          const y = (canvas.height - height) / 2;

          ctx.fillStyle = isPast
            ? '#34d399' // emerald
            : isPlaying
            ? 'rgba(52, 211, 153, 0.4)'
            : 'rgba(255, 255, 255, 0.2)';
          ctx.fillRect(x, y, barWidth, height);
        }
      };

      renderOnCtx(canvasRef.current);
      renderOnCtx(miniCanvasRef.current);

      if (isPlaying) {
        animId = requestAnimationFrame(render);
      }
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, currentPartTime, currentPartDuration]);

  // Audio Element Event Listeners
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTimeUpdate = () => {
      setCurrentPartTime(el.currentTime);
    };

    const onLoadedMetadata = () => {
      if (el.duration && !isNaN(el.duration) && isFinite(el.duration)) {
        setCurrentPartDuration(el.duration);
      }
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    const onEnded = () => {
      setIsPlaying(false);
      // Auto-advance to next segment if enabled and available
      const targetStory = stories.find((s) => s.id === playingStoryId) || activeStory;
      if (!targetStory) return;
      const nextIndex = currentPlayingIndex + 1;
      if (autoPlayNext && nextIndex < targetStory.segments.length) {
        const nextSegment = targetStory.segments[nextIndex];
        if (nextSegment.audio?.audioUrl) {
          if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
          pauseTimerRef.current = setTimeout(() => {
            playSegmentAtIndex(nextIndex, targetStory.id);
          }, Math.max(100, pauseBetweenParts * 1000));
        } else {
          showFeedback(`A Parte ${nextIndex + 1} ainda não tem áudio gerado.`);
        }
      } else if (autoPlayNext && nextIndex >= targetStory.segments.length) {
        showFeedback('A história chegou ao fim da transmissão ao vivo!');
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
  }, [stories, playingStoryId, activeStory, currentPlayingIndex, autoPlayNext, pauseBetweenParts]);

  // Play segment at specific index
  const playSegmentAtIndex = (index: number, storyId?: string) => {
    const targetId = storyId || activeStoryId;
    const targetStory = stories.find((s) => s.id === targetId) || activeStory;
    if (!targetStory) return;
    const seg = targetStory.segments[index];
    if (!seg || !seg.audio?.audioUrl) {
      showFeedback(`Parte ${index + 1} não possui áudio gerado ainda.`);
      return;
    }

    setPlayingStoryId(targetId);
    setCurrentPlayingIndex(index);
    if (audioRef.current) {
      audioRef.current.src = seg.audio.audioUrl;
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.volume = volume;
      audioRef.current.load();
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.warn('Audio play error:', err));
    }
  };

  // Toggle Play / Pause Live
  const togglePlayLive = (storyId?: string) => {
    const targetId = storyId || activeStoryId;
    const targetStory = stories.find((s) => s.id === targetId) || activeStory;
    if (!targetStory || targetStory.segments.length === 0) return;

    // If currently playing the same story, pause/resume
    if (isPlaying && (!storyId || storyId === playingStoryId)) {
      if (audioRef.current) audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    if (storyId && storyId !== playingStoryId) {
      // Switching to another story
      const firstReady = targetStory.segments.findIndex((s) => !!s.audio?.audioUrl);
      if (firstReady >= 0) {
        playSegmentAtIndex(firstReady, storyId);
      } else {
        showFeedback(`A história "${targetStory.title}" ainda não tem áudios gerados.`);
      }
      return;
    }

    // Resume same audio if element loaded
    if (audioRef.current && audioRef.current.src && !audioRef.current.ended) {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          playSegmentAtIndex(currentPlayingIndex, targetId);
        });
      return;
    }

    // Find first ready segment or start from currentPlayingIndex
    const currentSeg = targetStory.segments[currentPlayingIndex];
    if (currentSeg?.audio?.audioUrl) {
      playSegmentAtIndex(currentPlayingIndex, targetId);
    } else {
      const firstReadyIdx = targetStory.segments.findIndex((s) => !!s.audio?.audioUrl);
      if (firstReadyIdx >= 0) {
        playSegmentAtIndex(firstReadyIdx, targetId);
      } else {
        showFeedback('Nenhum áudio gerado ainda. Clique em "Gerar Áudio" nas partes.');
      }
    }
  };

  // Skip to previous or next segment
  const skipToPrevious = () => {
    const targetStory = stories.find((s) => s.id === playingStoryId) || activeStory;
    if (!targetStory) return;
    const prevIdx = Math.max(0, currentPlayingIndex - 1);
    playSegmentAtIndex(prevIdx, targetStory.id);
  };

  const skipToNext = () => {
    const targetStory = stories.find((s) => s.id === playingStoryId) || activeStory;
    if (!targetStory) return;
    const nextIdx = Math.min(targetStory.segments.length - 1, currentPlayingIndex + 1);
    playSegmentAtIndex(nextIdx, targetStory.id);
  };

  // Seek within active segment
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentPartTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  // Helper to synthesize audio for a segment with retry, timeout, and fallback
  const synthesizeSegmentAudio = async (seg: StorySegment, storyTitle: string): Promise<GeneratedAudio> => {
    let attempts = 0;
    let lastError: any = null;

    // Resolve voice string ID and voice object safely
    const voiceId = typeof seg.voice === 'string'
      ? seg.voice
      : (seg.voice?.id || 'pt-BR-FranciscaNeural');
    const voiceObj: Voice = typeof seg.voice === 'object' && seg.voice?.id
      ? seg.voice
      : (voices.find((v) => v.id === voiceId) || CURATED_VOICES.find((v) => v.id === voiceId) || CURATED_VOICES[0]);

    const rate = seg.settings?.rate || '+0%';
    const pitch = seg.settings?.pitch || '+0Hz';
    const volume = seg.settings?.volume || '+0%';

    while (attempts < 3) {
      try {
        attempts++;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const res = await fetch('/api/tts?stream=true', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: seg.text,
            voice: voiceId,
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
              text: seg.text,
              voice: voiceId,
              rate,
              pitch,
              volume,
            }),
            signal: AbortSignal.timeout(60000),
          });

          if (!fallbackRes.ok) {
            const errData = await fallbackRes.json().catch(() => null);
            throw new Error(errData?.error || `Erro HTTP ${fallbackRes.status}`);
          }

          const fallbackData = await fallbackRes.json();
          const audioFetch = await fetch(fallbackData.audioUrl, {
            signal: AbortSignal.timeout(60000),
          });
          const audioBlob = await audioFetch.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          const estDuration = estimateDurationSeconds(seg.text.length);

          return {
            id: fallbackData.id || crypto.randomUUID(),
            title: `${storyTitle} - ${seg.title}`,
            voice: voiceObj,
            textSnippet: seg.text.slice(0, 60),
            charCount: seg.text.length,
            durationSeconds: estDuration,
            createdAt: Date.now(),
            audioUrl,
            downloadUrl: audioUrl,
            blobUrl: audioUrl,
            blob: audioBlob,
            sizeBytes: audioBlob.size,
          };
        }

        const audioBlob = await res.blob();
        if (!audioBlob || audioBlob.size === 0) {
          throw new Error('Áudio gerado vazio.');
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        const audioId = res.headers.get('x-audio-id') || crypto.randomUUID();
        const estDuration = estimateDurationSeconds(seg.text.length);

        return {
          id: audioId,
          title: `${storyTitle} - ${seg.title}`,
          voice: voiceObj,
          textSnippet: seg.text.slice(0, 60),
          charCount: seg.text.length,
          durationSeconds: estDuration,
          createdAt: Date.now(),
          audioUrl,
          downloadUrl: audioUrl,
          blobUrl: audioUrl,
          blob: audioBlob,
          sizeBytes: audioBlob.size,
        };
      } catch (err: any) {
        lastError = err;
        console.warn(`Tentativa ${attempts} falhou para parte ${seg.title}:`, err);
        if (attempts < 3) {
          await new Promise((r) => setTimeout(r, 600 * attempts));
        }
      }
    }

    throw lastError || new Error('Falha ao sintetizar áudio após 3 tentativas.');
  };

  // Synthesize single segment
  const generateAudioForSegment = async (segmentId: string, storyId?: string) => {
    const targetId = storyId || activeStoryId;
    const targetStory = storiesRef.current.find((s) => s.id === targetId) || stories.find((s) => s.id === targetId) || activeStory;
    if (!targetStory) return;

    const seg = targetStory.segments.find((s) => s.id === segmentId);
    if (!seg || !seg.text.trim()) {
      showFeedback('O texto da parte não pode estar vazio.');
      return;
    }

    setGeneratingSegmentId(segmentId);

    // Update segment status to generating
    const updatedStoryWithGen: NarratedStory = {
      ...targetStory,
      segments: targetStory.segments.map((s) =>
        s.id === segmentId ? { ...s, status: 'generating' as const } : s
      ),
    };
    await persistStory(updatedStoryWithGen);

    try {
      const generatedAudio = await synthesizeSegmentAudio(seg, targetStory.title);
      const finalStory: NarratedStory = {
        ...targetStory,
        segments: targetStory.segments.map((s) =>
          s.id === segmentId
            ? {
                ...s,
                status: 'ready' as const,
                audio: generatedAudio,
                errorMessage: undefined,
              }
            : s
        ),
      };

      await persistStory(finalStory);
      showFeedback(`Áudio de "${seg.title}" gerado com sucesso!`);
    } catch (err: any) {
      console.error('TTS error on segment:', err);
      const failedStory: NarratedStory = {
        ...targetStory,
        segments: targetStory.segments.map((s) =>
          s.id === segmentId
            ? {
                ...s,
                status: 'error' as const,
                errorMessage: err?.message || 'Erro ao gerar',
              }
            : s
        ),
      };
      await persistStory(failedStory);
      showFeedback(`Erro ao gerar áudio da parte: ${err?.message || 'Falha na conexão'}`);
    } finally {
      setGeneratingSegmentId(null);
    }
  };

  // Generate all pending segments continuously for a specific story card
  const generateAllPendingForStory = async (storyId: string) => {
    const currentStory = storiesRef.current.find((s) => s.id === storyId) || stories.find((s) => s.id === storyId);
    if (!currentStory || generatingStoryId !== null) return;

    // A segment is ready if status is ready AND it has valid audio data
    const isSegmentReady = (s: StorySegment) =>
      s.status === 'ready' && !!s.audio && (!!s.audio.blobUrl || !!s.audio.audioUrl || !!s.audio.blob);

    const pendingSegments = currentStory.segments.filter((s) => !isSegmentReady(s));

    if (pendingSegments.length === 0) {
      showFeedback('Todos os áudios deste card já foram gerados!');
      return;
    }

    setGeneratingStoryId(storyId);
    setIsGeneratingAll(true);
    showFeedback(`Iniciando geração contínua de ${pendingSegments.length} partes do card "${currentStory.title}"...`);

    let runningStory = { ...currentStory };
    let successCount = 0;
    let failedCount = 0;

    try {
      for (let i = 0; i < pendingSegments.length; i++) {
        const seg = pendingSegments[i];
        if (!seg.text.trim()) continue;

        setGeneratingSegmentId(seg.id);
        showFeedback(`Gerando parte ${i + 1} de ${pendingSegments.length} do card "${runningStory.title}": "${seg.title}"...`);

        // 1. Mark segment generating
        runningStory = {
          ...runningStory,
          segments: runningStory.segments.map((s) =>
            s.id === seg.id ? { ...s, status: 'generating' as const } : s
          ),
        };
        await persistStory(runningStory);

        // 2. Synthesize with automatic retries and fallback
        try {
          const generatedAudio = await synthesizeSegmentAudio(seg, runningStory.title);
          runningStory = {
            ...runningStory,
            segments: runningStory.segments.map((s) =>
              s.id === seg.id
                ? {
                    ...s,
                    status: 'ready' as const,
                    audio: generatedAudio,
                    errorMessage: undefined,
                  }
                : s
            ),
          };
          await persistStory(runningStory);
          successCount++;
        } catch (err: any) {
          failedCount++;
          console.error(`Erro ao gerar parte ${seg.title}:`, err);
          // Crucial: mark this segment as error, but DO NOT STOP THE LOOP! Keep generating the remaining parts!
          runningStory = {
            ...runningStory,
            segments: runningStory.segments.map((s) =>
              s.id === seg.id
                ? {
                    ...s,
                    status: 'error' as const,
                    errorMessage: err?.message || 'Falha na geração',
                  }
                : s
            ),
          };
          await persistStory(runningStory);
        }

        // Brief delay between segments so WebSocket connections establish smoothly
        if (i < pendingSegments.length - 1) {
          await new Promise((r) => setTimeout(r, 350));
        }
      }
    } finally {
      setGeneratingStoryId(null);
      setIsGeneratingAll(false);
      setGeneratingSegmentId(null);
    }

    if (failedCount === 0 && successCount > 0) {
      showFeedback(`Sucesso! Todas as ${successCount} partes do card foram geradas.`);
    } else if (successCount > 0 && failedCount > 0) {
      showFeedback(`${successCount} partes geradas. ${failedCount} falharam e podem ser regeradas.`);
    } else if (failedCount > 0) {
      showFeedback('Houve falha ao gerar os áudios. Verifique o texto e tente novamente.');
    }
  };

  // Generate all pending for active story
  const generateAllPending = () => {
    if (activeStory) {
      generateAllPendingForStory(activeStory.id);
    }
  };

  // Move segment order up or down
  const moveSegment = async (index: number, direction: 'up' | 'down') => {
    if (!activeStory) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= activeStory.segments.length) return;

    const newSegments = [...activeStory.segments];
    const temp = newSegments[index];
    newSegments[index] = newSegments[targetIndex];
    newSegments[targetIndex] = temp;

    const reordered = newSegments.map((s, idx) => ({ ...s, order: idx }));
    const updatedStory: NarratedStory = {
      ...activeStory,
      segments: reordered,
    };
    await persistStory(updatedStory);
  };

  // Delete segment trigger (opens custom confirmation modal)
  const deleteSegment = (segmentId: string) => {
    if (!activeStory) return;
    const segToDelete = activeStory.segments.find((s) => s.id === segmentId);
    if (!segToDelete) return;
    setSegmentToDelete({ segmentId, title: segToDelete.title });
  };

  const executeDeleteSegment = async () => {
    if (!activeStory || !segmentToDelete) return;
    const filtered = activeStory.segments
      .filter((s) => s.id !== segmentToDelete.segmentId)
      .map((s, idx) => ({ ...s, order: idx }));

    const updatedStory: NarratedStory = {
      ...activeStory,
      segments: filtered,
    };
    await persistStory(updatedStory);
    setSegmentToDelete(null);
    showFeedback(`Parte excluída com sucesso.`);
  };

  // Open modal to create a new segment
  const openNewSegmentModal = (insertAtIdx = -1, storyId?: string) => {
    const targetId = storyId || activeStoryId;
    const targetStory = stories.find((s) => s.id === targetId) || activeStory;
    if (!targetStory) return;

    setActiveStoryId(targetId);
    setEditingSegment(null);
    setInsertPosition(insertAtIdx);

    const partNum = insertAtIdx >= 0 ? insertAtIdx + 1 : targetStory.segments.length + 1;
    setSegmentTitle(`Parte ${partNum}: `);
    setSegmentText('');
    setSegmentVoiceId(targetStory.defaultVoice.id);
    setSegmentRate(targetStory.defaultSettings.rate || '+0%');
    setSegmentPitch(targetStory.defaultSettings.pitch || '+0Hz');
    setIsSegmentModalOpen(true);
  };

  // Open modal to edit an existing segment
  const openEditSegmentModal = (seg: StorySegment) => {
    setEditingSegment(seg);
    setInsertPosition(-1);
    setSegmentTitle(seg.title);
    setSegmentText(seg.text);
    setSegmentVoiceId(seg.voice.id);
    setSegmentRate(seg.settings.rate || '+0%');
    setSegmentPitch(seg.settings.pitch || '+0Hz');
    setIsSegmentModalOpen(true);
  };

  // Save segment from modal
  const handleSaveSegmentModal = async (generateImmediately = false) => {
    if (!activeStory) return;
    if (!segmentText.trim()) {
      showFeedback('Por favor, informe o texto da parte.');
      return;
    }

    const matchedVoice = voices.find((v) => v.id === segmentVoiceId) || activeStory.defaultVoice;
    const settings: ProsodySettings = {
      rate: segmentRate,
      pitch: segmentPitch,
      volume: '+0%',
    };

    let targetSegmentId = '';

    if (editingSegment) {
      targetSegmentId = editingSegment.id;
      const textChanged = editingSegment.text !== segmentText.trim();
      const voiceChanged = editingSegment.voice.id !== segmentVoiceId;
      const settingsChanged =
        editingSegment.settings.rate !== segmentRate ||
        editingSegment.settings.pitch !== segmentPitch;

      const needRegen = textChanged || voiceChanged || settingsChanged;

      const updatedSegments = activeStory.segments.map((s) => {
        if (s.id === editingSegment.id) {
          return {
            ...s,
            title: segmentTitle.trim() || s.title,
            text: segmentText.trim(),
            voice: matchedVoice,
            settings,
            status: needRegen ? ('pending' as const) : s.status,
            audio: needRegen ? undefined : s.audio,
          };
        }
        return s;
      });

      const updatedStory = { ...activeStory, segments: updatedSegments };
      await persistStory(updatedStory);
      showFeedback(`Parte "${segmentTitle}" atualizada.`);
    } else {
      targetSegmentId = `seg-${Date.now()}`;
      const newPartNum =
        insertPosition >= 0 ? insertPosition + 1 : activeStory.segments.length + 1;
      const newSeg: StorySegment = {
        id: targetSegmentId,
        title: segmentTitle.trim() || `Parte ${newPartNum}`,
        text: segmentText.trim(),
        voice: matchedVoice,
        settings,
        status: 'pending',
        order: insertPosition >= 0 ? insertPosition : activeStory.segments.length,
      };

      let newSegmentsList = [...activeStory.segments];
      if (insertPosition >= 0) {
        newSegmentsList.splice(insertPosition, 0, newSeg);
      } else {
        newSegmentsList.push(newSeg);
      }

      newSegmentsList = newSegmentsList.map((s, idx) => ({ ...s, order: idx }));
      const updatedStory = { ...activeStory, segments: newSegmentsList };
      await persistStory(updatedStory);
      showFeedback(`Nova parte emendada na história com sucesso!`);
    }

    setIsSegmentModalOpen(false);

    if (generateImmediately && targetSegmentId) {
      generateAudioForSegment(targetSegmentId, activeStory.id);
    }
  };

  // Create New Story
  const handleCreateNewStory = async () => {
    if (!newStoryTitle.trim()) {
      showFeedback('Informe o título da nova história.');
      return;
    }

    const chosenVoice = voices.find((v) => v.id === newStoryVoiceId) || CURATED_VOICES[0];
    const newStory: NarratedStory = {
      id: `story-${Date.now()}`,
      title: newStoryTitle.trim(),
      description: newStoryDesc.trim() || 'História narrada em múltiplos capítulos sequenciais.',
      category: newStoryCategory,
      defaultVoice: chosenVoice,
      defaultSettings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      segments: [
        {
          id: `seg-${Date.now()}-1`,
          title: 'Parte 1: O Início',
          text: 'Comece a escrever o primeiro capítulo desta história fascinante...',
          voice: chosenVoice,
          settings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
          status: 'pending',
          order: 0,
        },
      ],
    };

    await persistStory(newStory);
    setActiveStoryId(newStory.id);
    setViewMode('story'); // Open freshly created story directly
    setIsNewStoryModalOpen(false);
    setNewStoryTitle('');
    setNewStoryDesc('');
    showFeedback(`História "${newStory.title}" criada com sucesso!`);
  };

  // Delete Story (opens custom confirmation modal)
  const handleDeleteStory = (storyId: string) => {
    const toDelete = stories.find((s) => s.id === storyId);
    if (!toDelete) return;
    setStoryToDelete(toDelete);
  };

  const executeDeleteStory = async () => {
    if (!storyToDelete) return;
    try {
      await deleteStoryFromDB(storyToDelete.id);
      const remaining = stories.filter((s) => s.id !== storyToDelete.id);
      if (remaining.length > 0) {
        setStories(remaining);
        setActiveStoryId(remaining[0].id);
      } else {
        const freshStory: NarratedStory = {
          id: `story-${Date.now()}`,
          title: 'Nova História',
          description: 'Crie seus capítulos ou áudios segmentados.',
          category: 'História',
          defaultVoice: voices[0] || CURATED_VOICES[0],
          defaultSettings: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          segments: [],
        };
        await saveStoryToDB(freshStory);
        setStories([freshStory]);
        setActiveStoryId(freshStory.id);
      }
      showFeedback(`História "${storyToDelete.title}" excluída com sucesso.`);
    } catch (e) {
      console.error('Error deleting story:', e);
      showFeedback('Erro ao excluir história.');
    } finally {
      setStoryToDelete(null);
    }
  };


  // Unify and Download Full Story Audio
  const handleUnifyFullStory = async (storyToUnify?: NarratedStory) => {
    const targetStory = storyToUnify || activeStory;
    if (!targetStory) return;
    const readySegments = targetStory.segments.filter((s) => !!s.audio?.blob);
    if (readySegments.length === 0) {
      showFeedback('Nenhum áudio gerado nesta história para unificar.');
      return;
    }

    try {
      setIsUnifyingAudio(true);
      showFeedback(`Concatenando ${readySegments.length} partes em áudio contínuo...`);

      const blobs = readySegments.map((s) => s.audio!.blob!);
      const { blob: unifiedWavBlob, duration } = await concatenateAudioBlobs(
        blobs,
        pauseBetweenParts
      );

      const filename = formatFilename(targetStory.title, 'historia-completa', 'wav');
      downloadBlob(unifiedWavBlob, filename);

      setUnifySuccess(true);
      setTimeout(() => setUnifySuccess(false), 3500);
      showFeedback(`História completa baixada com sucesso (${formatTime(duration)})!`);
    } catch (err: any) {
      console.error('Failed to concatenate audio blobs:', err);
      showFeedback(`Erro ao concatenar áudios: ${err?.message || 'Tente novamente'}`);
    } finally {
      setIsUnifyingAudio(false);
    }
  };

  // Send Unified Story to VideoVozLivre Editor
  const handleSendStoryToVideoEditor = async (storyToSend?: NarratedStory) => {
    const targetStory = storyToSend || activeStory;
    if (!targetStory) return;
    const readySegments = targetStory.segments.filter((s) => !!s.audio?.blob);
    if (readySegments.length === 0) {
      showFeedback('Gere pelo menos um áudio nesta história antes de criar o vídeo.');
      return;
    }

    try {
      setIsUnifyingAudio(true);
      showFeedback('Preparando áudio da história para o editor de vídeo...');

      const blobs = readySegments.map((s) => s.audio!.blob!);
      const { blob: unifiedWavBlob, duration } = await concatenateAudioBlobs(
        blobs,
        pauseBetweenParts
      );

      const url = URL.createObjectURL(unifiedWavBlob);
      const unifiedAudio: GeneratedAudio = {
        id: `story-unified-${targetStory.id}`,
        title: targetStory.title,
        voice: targetStory.defaultVoice,
        textSnippet: `${targetStory.title} (${readySegments.length} partes)`,
        charCount: targetStory.segments.reduce((acc, s) => acc + s.text.length, 0),
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
      console.error('Error preparing video audio:', err);
      showFeedback('Erro ao preparar áudio para vídeo.');
    } finally {
      setIsUnifyingAudio(false);
    }
  };

  // Metrics for active story
  const totalSegments = activeStory?.segments.length || 0;
  const readySegmentsCount = activeStory?.segments.filter((s) => s.status === 'ready').length || 0;
  const totalChars = activeStory?.segments.reduce((acc, s) => acc + s.text.length, 0) || 0;

  // Active playing segment
  const activePlayingSegment = playingStory?.segments[currentPlayingIndex] || null;

  return (
    <div className={`space-y-6 ${isStoryExpanded ? 'fixed inset-0 z-50 bg-neutral-950 p-4 sm:p-8 overflow-y-auto' : ''}`}>
      <audio ref={audioRef} preload="metadata" />

      {/* Transient Feedback Banner */}
      {feedbackMessage && (
        <div className="rounded-xl border border-emerald-800/80 bg-emerald-950/80 p-3.5 flex items-center justify-between gap-3 text-xs text-emerald-200 animate-in fade-in duration-200 shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="font-medium">{feedbackMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            className="text-emerald-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Header & Subhead with Floating View Toggles */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-neutral-900 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <span>Live Narrada</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-950 text-rose-300 border border-rose-800 tracking-wide uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping"></span>
                Autoplay Contínuo
              </span>
            </h1>
          </div>
          <p className="text-sm text-neutral-400 mt-1 max-w-2xl">
            Crie histórias longas com áudios que tocam um atrás do outro em transmissão contínua. Emende novos trechos onde quiser, reedite partes facilmente e organize tudo em cards flutuantes.
          </p>
        </div>

        {/* View Mode Switcher (Minimizar para Cards vs Maximizar História) */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center p-1 bg-neutral-900 border border-neutral-800 rounded-xl shadow-inner">
            <button
              type="button"
              onClick={() => {
                setViewMode('cards');
                setIsStoryExpanded(false);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'cards'
                  ? 'bg-white text-neutral-950 shadow-md'
                  : 'text-neutral-400 hover:text-white'
              }`}
              title="Exibir todas as histórias minimizadas em cards flutuantes"
            >
              <Grid className="h-3.5 w-3.5" />
              <span>Cards Flutuantes ({stories.length})</span>
            </button>

            {activeStory && (
              <button
                type="button"
                onClick={() => setViewMode('story')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === 'story'
                    ? 'bg-neutral-800 text-white shadow-md'
                    : 'text-neutral-400 hover:text-white'
                }`}
                title="Maximizar e editar a história selecionada"
              >
                <Layers className="h-3.5 w-3.5 text-rose-400" />
                <span className="truncate max-w-[130px]">{activeStory.title}</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsNewStoryModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Nova História</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          VIEW 1: FLOATING CARDS DECK (Todas as histórias minimizadas em cards flutuantes)
          ========================================================================= */}
      {viewMode === 'cards' && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse"></span>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Cards Flutuantes de Histórias ({stories.length})
              </h2>
            </div>
            <span className="text-xs text-neutral-500">
              Clique em um card para maximizar a história ou dê play direto
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4.5">
            {stories.map((story) => {
              const isStoryPlayingNow = isPlaying && playingStoryId === story.id;
              const readyCount = story.segments.filter((s) => s.status === 'ready').length;
              const totalStorySegments = story.segments.length;
              const totalStoryChars = story.segments.reduce((acc, s) => acc + s.text.length, 0);
              const estDuration = estimateDurationSeconds(totalStoryChars);
              const percentReady = totalStorySegments > 0 ? Math.round((readyCount / totalStorySegments) * 100) : 0;

              return (
                <div
                  key={story.id}
                  className={`group relative rounded-2xl border transition-all duration-300 p-5 flex flex-col justify-between backdrop-blur-md shadow-xl hover:shadow-2xl hover:-translate-y-1.5 cursor-pointer ${
                    isStoryPlayingNow
                      ? 'border-rose-500/80 bg-neutral-900/95 ring-1 ring-rose-500/40 shadow-rose-950/20'
                      : story.id === activeStoryId
                      ? 'border-neutral-700 bg-neutral-900/80'
                      : 'border-neutral-800/80 bg-neutral-900/40 hover:border-neutral-700 hover:bg-neutral-900/70'
                  }`}
                  onClick={() => {
                    setActiveStoryId(story.id);
                    setViewMode('story');
                  }}
                >
                  {/* Top Bar with Category Badge and Live Status */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700">
                        {story.category || 'História'}
                      </span>

                      {isStoryPlayingNow ? (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-300 bg-rose-950/80 border border-rose-800 px-2 py-0.5 rounded-full animate-pulse">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                          Tocando Live
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono text-neutral-500">
                          {readyCount}/{totalStorySegments} prontas
                        </span>
                      )}
                    </div>

                    {/* Story Title & Description */}
                    <div>
                      <h3 className="text-base font-bold text-white group-hover:text-rose-200 transition-colors line-clamp-1">
                        {story.title}
                      </h3>
                      <p className="text-xs text-neutral-400 mt-1 line-clamp-2 leading-relaxed">
                        {story.description}
                      </p>
                    </div>

                    {/* Segment Progress Bar */}
                    <div className="space-y-1 pt-1">
                      <div className="flex items-center justify-between text-[10px] text-neutral-400">
                        <span>Progresso da narrativa</span>
                        <span className="font-mono text-neutral-300">{percentReady}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            percentReady === 100
                              ? 'bg-emerald-400'
                              : percentReady > 0
                              ? 'bg-rose-400'
                              : 'bg-neutral-700'
                          }`}
                          style={{ width: `${percentReady}%` }}
                        />
                      </div>
                    </div>

                    {/* Metadata chips */}
                    <div className="flex items-center gap-2 text-[11px] text-neutral-400 flex-wrap pt-0.5">
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-3 w-3 text-neutral-500" />
                        <span>{totalStorySegments} {totalStorySegments === 1 ? 'parte' : 'partes'}</span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="h-3 w-3 text-neutral-500" />
                        <span>{formatTime(estDuration)}</span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Voz: <strong className="text-neutral-300">{story.defaultVoice.name}</strong></span>
                    </div>
                  </div>

                  {/* Card Actions Footer */}
                  <div
                    className="flex items-center justify-between gap-2 pt-4 mt-4 border-t border-neutral-800/80 flex-wrap"
                    onClick={(e) => e.stopPropagation()} // Prevent triggering card selection when clicking buttons
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Play Live Button */}
                      <button
                        type="button"
                        onClick={() => togglePlayLive(story.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer ${
                          isStoryPlayingNow
                            ? 'bg-rose-500 text-white hover:bg-rose-600'
                            : 'bg-white text-neutral-950 hover:bg-neutral-200'
                        }`}
                        title={isStoryPlayingNow ? 'Pausar live desta história' : 'Iniciar transmissão contínua desta história'}
                      >
                        {isStoryPlayingNow ? (
                          <>
                            <Pause className="h-3.5 w-3.5 fill-current" />
                            <span>Pausar</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Ouvir Live</span>
                          </>
                        )}
                      </button>

                      {/* Generate Pending Button directly on card */}
                      {readyCount < totalStorySegments && (
                        <button
                          type="button"
                          onClick={() => generateAllPendingForStory(story.id)}
                          disabled={generatingStoryId !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          title="Gerar continuamente todos os áudios pendentes deste card"
                        >
                          {generatingStoryId === story.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {generatingStoryId === story.id
                              ? 'Gerando...'
                              : `Gerar Pendentes (${totalStorySegments - readyCount})`}
                          </span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Fast Append Part */}
                      <button
                        type="button"
                        onClick={() => openNewSegmentModal(-1, story.id)}
                        className="p-1.5 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                        title="Emendar nova parte nesta história"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>

                      {/* Maximize Story */}
                      <button
                        type="button"
                        onClick={() => {
                          setActiveStoryId(story.id);
                          setViewMode('story');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                        title="Maximizar história e editar capítulos"
                      >
                        <Maximize2 className="h-3 w-3" />
                        <span className="hidden sm:inline">Maximizar</span>
                      </button>

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteStory(story.id);
                        }}
                        className="p-1.5 text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                        title="Excluir história"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Quick Card: Add New Story */}
            <div
              onClick={() => setIsNewStoryModalOpen(true)}
              className="rounded-2xl border-2 border-dashed border-neutral-800 hover:border-neutral-600 bg-neutral-900/20 hover:bg-neutral-900/40 p-6 flex flex-col items-center justify-center text-center gap-2.5 transition-all duration-200 cursor-pointer min-h-[220px] group"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-800 text-neutral-400 group-hover:text-white group-hover:bg-neutral-700 transition-colors">
                <FolderPlus className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white group-hover:text-rose-300 transition-colors">
                  Criar Outra História
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Adicione uma nova série ou narrativa segmentada
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 2: MAXIMIZED STORY WORKSPACE (História aberta com editor de capítulos e player)
          ========================================================================= */}
      {viewMode === 'story' && activeStory && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4 sm:p-6 space-y-5 animate-in fade-in duration-200 shadow-2xl">
          {/* Top Control Bar: Minimize to Cards / Story switcher / Fullscreen toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800/80 pb-4">
            <div className="flex items-center gap-3">
              {/* Back / Minimize to Cards Button */}
              <button
                type="button"
                onClick={() => {
                  setViewMode('cards');
                  setIsStoryExpanded(false);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-xl transition-all shadow-sm cursor-pointer"
                title="Minimizar história de volta para os cards flutuantes"
              >
                <Minimize2 className="h-3.5 w-3.5 text-rose-400" />
                <span>Minimizar para Cards</span>
              </button>

              <div className="h-4 w-px bg-neutral-800"></div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                    {activeStory.category || 'História'}
                  </span>
                  <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                    {activeStory.title}
                  </h2>
                </div>
                <p className="text-xs text-neutral-400 mt-1 max-w-xl">
                  {activeStory.description}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Generate All Pending */}
              {readySegmentsCount < totalSegments && (
                <button
                  type="button"
                  onClick={generateAllPending}
                  disabled={generatingStoryId !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-400 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  title="Sintetizar todos os áudios que ainda não foram gerados"
                >
                  {generatingStoryId === activeStory.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>{generatingStoryId === activeStory.id ? 'Sintetizando...' : 'Gerar Pendentes'}</span>
                </button>
              )}

              {/* Unify Full Audio Download */}
              <button
                type="button"
                onClick={() => handleUnifyFullStory(activeStory)}
                disabled={readySegmentsCount === 0 || isUnifyingAudio}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                title="Juntar todas as partes em um único arquivo de áudio contínuo"
              >
                {unifySuccess ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>{isUnifyingAudio ? 'Unificando...' : 'Baixar Completa'}</span>
              </button>

              {/* Send to VideoVozLivre */}
              <button
                type="button"
                onClick={() => handleSendStoryToVideoEditor(activeStory)}
                disabled={readySegmentsCount === 0 || isUnifyingAudio}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-violet-950/80 hover:bg-violet-900 border border-violet-700/80 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                title="Criar vídeo completo desta história unificada no VideoVozLivre"
              >
                <Film className="h-3.5 w-3.5 text-violet-300" />
                <span>Criar Vídeo</span>
              </button>

              {/* Fullscreen Expand Toggle */}
              <button
                type="button"
                onClick={() => setIsStoryExpanded(!isStoryExpanded)}
                className="p-1.5 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                title={isStoryExpanded ? 'Restaurar tamanho' : 'Maximizar em tela cheia'}
              >
                {isStoryExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>

              {/* Delete Story Button */}
              <button
                type="button"
                onClick={() => handleDeleteStory(activeStory.id)}
                className="p-1.5 text-neutral-400 hover:text-rose-400 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                title="Excluir esta história"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Master Live Sequencer Player Console (Can be collapsed / minimized) */}
          <div className="rounded-xl border border-neutral-700/80 bg-neutral-950 p-4 space-y-3.5 shadow-inner">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-neutral-900 text-rose-400 border border-neutral-800 font-bold flex items-center gap-1.5">
                  <Radio className="h-3 w-3 animate-pulse" />
                  <span>Console da Live</span>
                </span>
                <span className="text-xs text-neutral-400 truncate max-w-sm">
                  {activePlayingSegment
                    ? `Parte ${currentPlayingIndex + 1}: "${activePlayingSegment.title}"`
                    : 'Pronto para tocar'}
                </span>
              </div>

              {/* Minimize/Maximize Player Toggle */}
              <button
                type="button"
                onClick={() => setIsPlayerMinimized(!isPlayerMinimized)}
                className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white p-1 rounded transition-colors"
                title={isPlayerMinimized ? 'Maximizar console do player' : 'Minimizar player'}
              >
                <span>{isPlayerMinimized ? 'Expandir Player' : 'Recolher'}</span>
                {isPlayerMinimized ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
            </div>

            {!isPlayerMinimized && (
              <div className="space-y-3.5 pt-1">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {/* Master Play Button */}
                    <button
                      type="button"
                      onClick={() => togglePlayLive(activeStory.id)}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-950 hover:bg-neutral-200 transition-transform active:scale-95 shadow-md cursor-pointer shrink-0"
                      title={isPlaying ? 'Pausar Live' : 'Iniciar Live / Reproduzir História'}
                    >
                      {isPlaying ? (
                        <Pause className="h-5 w-5 fill-current" />
                      ) : (
                        <Play className="h-5 w-5 fill-current ml-0.5" />
                      )}
                    </button>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.2 rounded bg-neutral-900 text-emerald-400 border border-neutral-800">
                          {isPlaying ? 'Em Transmissão' : 'Pausado'}
                        </span>
                        <span className="text-xs text-neutral-300 font-semibold truncate">
                          {activePlayingSegment?.title || 'Selecione uma parte'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-neutral-400 mt-1">
                        <span>Voz: {activePlayingSegment?.voice.name || activeStory.defaultVoice.name}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-neutral-300">
                          {readySegmentsCount} de {totalSegments} partes prontas
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Live Settings & Controls */}
                  <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
                    {/* Skip buttons */}
                    <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-lg border border-neutral-800">
                      <button
                        type="button"
                        onClick={skipToPrevious}
                        disabled={currentPlayingIndex === 0}
                        className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-30 rounded"
                        title="Parte anterior"
                      >
                        <SkipBack className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={skipToNext}
                        disabled={currentPlayingIndex >= totalSegments - 1}
                        className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-30 rounded"
                        title="Próxima parte"
                      >
                        <SkipForward className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Autoplay Next Toggle */}
                    <button
                      type="button"
                      onClick={() => setAutoPlayNext(!autoPlayNext)}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 cursor-pointer ${
                        autoPlayNext
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                          : 'bg-neutral-900 text-neutral-400 border-neutral-800'
                      }`}
                      title="Quando uma parte terminar, a próxima inicia automaticamente"
                    >
                      <Radio className="h-3 w-3" />
                      <span>Autoplay Contínuo</span>
                    </button>

                    {/* Pause between parts selector */}
                    <div className="flex items-center gap-1 text-xs text-neutral-400 bg-neutral-900 border border-neutral-800 px-2 py-1 rounded-lg">
                      <span>Pausa:</span>
                      <select
                        value={pauseBetweenParts}
                        onChange={(e) => setPauseBetweenParts(parseFloat(e.target.value))}
                        className="bg-transparent text-white font-mono text-xs focus:outline-none cursor-pointer"
                        title="Intervalo de silêncio entre o final de uma parte e o início da próxima"
                      >
                        <option value={0}>0s (Direto)</option>
                        <option value={0.5}>0.5s</option>
                        <option value={1}>1.0s</option>
                        <option value={2}>2.0s</option>
                      </select>
                    </div>

                    {/* Playback speed */}
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

                {/* Visualizer & Progress bar for active part */}
                <div className="flex items-center gap-3 pt-1">
                  <canvas
                    ref={canvasRef}
                    width={144}
                    height={24}
                    className="w-28 sm:w-36 h-6 shrink-0 hidden sm:block"
                  />

                  <span className="text-xs font-mono text-neutral-400 tabular-nums shrink-0">
                    {formatTime(currentPartTime)}
                  </span>

                  <input
                    type="range"
                    min={0}
                    max={currentPartDuration || 100}
                    step={0.1}
                    value={currentPartTime}
                    onChange={handleSeek}
                    className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                  />

                  <span className="text-xs font-mono text-neutral-400 tabular-nums shrink-0">
                    {formatTime(currentPartDuration)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Segments / Chapters List (Order, Add, Edit, Regenerate, Delete) */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <span>Partes & Capítulos da História ({totalSegments})</span>
                </h3>
                <p className="text-xs text-neutral-400">
                  Os áudios tocam sequencialmente nesta ordem. Use as setas para reorganizar ou emende novos trechos onde desejar.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsSegmentsMinimized(!isSegmentsMinimized)}
                  className="px-2.5 py-1.5 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800 rounded-lg transition-colors cursor-pointer"
                  title={isSegmentsMinimized ? 'Expandir capítulos' : 'Minimizar capítulos'}
                >
                  {isSegmentsMinimized ? 'Expandir Partes' : 'Recolher Partes'}
                </button>

                <button
                  type="button"
                  onClick={() => openNewSegmentModal(-1, activeStory.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Adicionar no Final</span>
                </button>
              </div>
            </div>

            {/* Segments List Cards */}
            {!isSegmentsMinimized && (
              <div className="space-y-2.5">
                {activeStory.segments.map((seg, index) => {
                  const isCurrentPlaying = currentPlayingIndex === index && isPlaying && playingStoryId === activeStory.id;
                  const isGenerating = generatingSegmentId === seg.id;
                  const isReady = seg.status === 'ready' && !!seg.audio;

                  return (
                    <div
                      key={seg.id}
                      className={`rounded-xl border p-4 transition-all ${
                        isCurrentPlaying
                          ? 'border-emerald-500/80 bg-neutral-900/90 shadow-md ring-1 ring-emerald-500/30'
                          : 'border-neutral-800 bg-neutral-900/40 hover:border-neutral-700 hover:bg-neutral-900/70'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        {/* Left: Info, Number & Text */}
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-neutral-800 text-neutral-200 border border-neutral-700">
                              #{index + 1}
                            </span>
                            <h4 className="text-sm font-semibold text-white truncate">
                              {seg.title}
                            </h4>

                            {/* Status Pill */}
                            {isGenerating ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-cyan-400 bg-cyan-950/80 border border-cyan-800 px-2 py-0.5 rounded">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>Sintetizando...</span>
                              </span>
                            ) : isReady ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded">
                                <Check className="h-3 w-3" />
                                <span>Áudio Pronto ({formatTime(seg.audio?.durationSeconds || 0)})</span>
                              </span>
                            ) : seg.status === 'error' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 bg-rose-950/80 border border-rose-800 px-2 py-0.5 rounded">
                                <AlertCircle className="h-3 w-3" />
                                <span>Erro ao gerar</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 bg-amber-950/80 border border-amber-800 px-2 py-0.5 rounded">
                                <span>Pendente</span>
                              </span>
                            )}

                            {isCurrentPlaying && (
                              <span className="text-[11px] font-mono text-emerald-400 animate-pulse">
                                ▶ Tocando Agora
                              </span>
                            )}
                          </div>

                          {/* Text preview */}
                          <p className="text-xs text-neutral-300 line-clamp-2 leading-relaxed font-sans bg-neutral-950/50 p-2 rounded-lg border border-neutral-800/80">
                            {seg.text}
                          </p>

                          {/* Metadata row */}
                          <div className="flex items-center gap-2 text-[11px] text-neutral-400 flex-wrap">
                            <span>Voz: <strong className="text-neutral-200">{seg.voice.name}</strong></span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{seg.text.length} caracteres</span>
                            <span aria-hidden="true">·</span>
                            <span>Est. {formatTime(estimateDurationSeconds(seg.text.length))}</span>
                            {seg.settings.rate !== '+0%' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-neutral-300">Vel: {seg.settings.rate}</span>
                              </>
                            )}
                            {seg.settings.pitch !== '+0Hz' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-neutral-300">Tom: {seg.settings.pitch}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap self-end sm:self-center">
                          {/* Play Single Part */}
                          {isReady && (
                            <button
                              type="button"
                              onClick={() => playSegmentAtIndex(index, activeStory.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                              title="Ouvir esta parte individualmente"
                            >
                              <Play className="h-3 w-3 fill-current" />
                              <span>Ouvir</span>
                            </button>
                          )}

                          {/* Generate Single Part */}
                          {!isReady && (
                            <button
                              type="button"
                              onClick={() => generateAudioForSegment(seg.id, activeStory.id)}
                              disabled={isGenerating}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                              title="Sintetizar áudio desta parte"
                            >
                              {isGenerating ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Sparkles className="h-3 w-3" />
                              )}
                              <span>{isGenerating ? 'Gerando...' : 'Gerar Áudio'}</span>
                            </button>
                          )}

                          {/* Edit & Regenerate Button */}
                          <button
                            type="button"
                            onClick={() => openEditSegmentModal(seg)}
                            className="p-1.5 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                            title="Editar texto, voz ou regenerar este áudio caso algo tenha saído errado"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>

                          {/* Download Part MP3 */}
                          {isReady && seg.audio && (
                            <button
                              type="button"
                              onClick={() =>
                                downloadAudio(
                                  seg.audio!,
                                  formatFilename(
                                    `${activeStory.title}-${seg.title}`,
                                    `parte-${index + 1}`,
                                    'mp3'
                                  )
                                )
                              }
                              className="p-1.5 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                              title="Baixar MP3 desta parte"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {/* Insert part right after this one */}
                          <button
                            type="button"
                            onClick={() => openNewSegmentModal(index + 1, activeStory.id)}
                            className="p-1.5 text-neutral-400 hover:text-emerald-400 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                            title="Emendar nova parte imediatamente após esta"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>

                          {/* Move Up */}
                          <button
                            type="button"
                            onClick={() => moveSegment(index, 'up')}
                            disabled={index === 0}
                            className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-20 rounded-lg transition-colors cursor-pointer"
                            title="Mover para cima"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>

                          {/* Move Down */}
                          <button
                            type="button"
                            onClick={() => moveSegment(index, 'down')}
                            disabled={index === totalSegments - 1}
                            className="p-1.5 text-neutral-400 hover:text-white disabled:opacity-20 rounded-lg transition-colors cursor-pointer"
                            title="Mover para baixo"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>

                          {/* Delete Part */}
                          <button
                            type="button"
                            onClick={() => deleteSegment(seg.id)}
                            className="p-1.5 text-neutral-500 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                            title="Excluir esta parte"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          FLOATING DOCK MINI-PLAYER (Aparece fixo quando o usuário está na visão de cards
          mas uma história está transmitindo ao vivo)
          ========================================================================= */}
      {viewMode === 'cards' && isPlaying && playingStory && (
        <div className="fixed bottom-4 sm:bottom-6 left-4 right-4 max-w-4xl mx-auto z-40 animate-in slide-in-from-bottom-5 duration-300">
          <div className="bg-neutral-900/95 border border-rose-500/60 rounded-2xl p-3 sm:p-4 shadow-2xl backdrop-blur-xl flex items-center justify-between gap-4 ring-1 ring-rose-500/20">
            <div className="flex items-center gap-3 min-w-0">
              {/* Play / Pause button */}
              <button
                type="button"
                onClick={() => togglePlayLive(playingStory.id)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-950 hover:bg-neutral-200 transition-transform active:scale-95 shadow-md shrink-0 cursor-pointer"
              >
                {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
              </button>

              {/* Title & Part details */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping shrink-0"></span>
                  <strong className="text-xs sm:text-sm font-bold text-white truncate">
                    {playingStory.title}
                  </strong>
                </div>
                <div className="text-[11px] text-neutral-400 truncate flex items-center gap-1.5 mt-0.5">
                  <span className="text-rose-300 font-medium">
                    Parte {currentPlayingIndex + 1}: {activePlayingSegment?.title || ''}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{formatTime(currentPartTime)} / {formatTime(currentPartDuration)}</span>
                </div>
              </div>
            </div>

            {/* Right: Mini Waveform & Maximize Button */}
            <div className="flex items-center gap-3 shrink-0">
              <canvas
                ref={miniCanvasRef}
                width={120}
                height={20}
                className="w-24 h-5 hidden md:block"
              />

              <button
                type="button"
                onClick={() => {
                  setActiveStoryId(playingStory.id);
                  setViewMode('story');
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                title="Maximizar esta história"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Maximizar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add or Edit Segment */}
      {isSegmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm sm:text-base font-bold text-white">
                  {editingSegment
                    ? `Editar / Regenerar "${editingSegment.title}"`
                    : insertPosition >= 0
                    ? `Emendar Nova Parte na Posição #${insertPosition + 1}`
                    : 'Adicionar Nova Parte à História'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSegmentModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Title input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Título da Parte / Capítulo:
                </label>
                <input
                  type="text"
                  value={segmentTitle}
                  onChange={(e) => setSegmentTitle(e.target.value)}
                  placeholder="Ex: Parte 2: O Sinal de Rádio"
                  className="w-full bg-neutral-950 border border-neutral-800 px-3.5 py-2 text-sm text-white rounded-xl focus:outline-none focus:border-neutral-500"
                />
              </div>

              {/* Text input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-neutral-300">
                    Texto da Narração:
                  </label>
                  <span className="font-mono text-neutral-400">
                    {segmentText.length} caracteres (est. {formatTime(estimateDurationSeconds(segmentText.length))})
                  </span>
                </div>
                <textarea
                  value={segmentText}
                  onChange={(e) => setSegmentText(e.target.value)}
                  rows={6}
                  placeholder="Digite ou cole aqui o texto que será falado nesta parte da história..."
                  className="w-full bg-neutral-950 border border-neutral-800 p-3 text-sm text-white rounded-xl focus:outline-none focus:border-neutral-500 font-sans leading-relaxed resize-y"
                />
              </div>

              {/* Voice & Prosody selector */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                {/* Voice */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-400">Voz desta parte:</label>
                  <select
                    value={segmentVoiceId}
                    onChange={(e) => setSegmentVoiceId(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs text-white rounded-xl focus:outline-none focus:border-neutral-500 cursor-pointer"
                  >
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.langLabel} · {v.gender})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Speed */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-400">Velocidade:</label>
                  <select
                    value={segmentRate}
                    onChange={(e) => setSegmentRate(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs text-white rounded-xl focus:outline-none focus:border-neutral-500 cursor-pointer font-mono"
                  >
                    <option value="-25%">0.75x (Lenta)</option>
                    <option value="+0%">1.0x (Padrão)</option>
                    <option value="+15%">1.15x</option>
                    <option value="+25%">1.25x (Dinâmica)</option>
                    <option value="+50%">1.5x (Rápida)</option>
                  </select>
                </div>

                {/* Pitch */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-neutral-400">Tom da voz:</label>
                  <select
                    value={segmentPitch}
                    onChange={(e) => setSegmentPitch(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs text-white rounded-xl focus:outline-none focus:border-neutral-500 cursor-pointer"
                  >
                    <option value="-15Hz">Grave / Profundo</option>
                    <option value="+0Hz">Natural / Normal</option>
                    <option value="+15Hz">Agudo</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="border-t border-neutral-800 p-4 bg-neutral-950 flex flex-col sm:flex-row items-center justify-between gap-2.5">
              <span className="text-[11px] text-neutral-500">
                {editingSegment ? 'Regenerar recriará o áudio corrigido com a voz escolhida' : 'A parte será emendada na ordem correta da história'}
              </span>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setIsSegmentModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveSegmentModal(false)}
                  className="flex-1 sm:flex-none px-4 py-2 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                >
                  Salvar Rascunho
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveSegmentModal(true)}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-5 py-2 text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>Salvar & Gerar Áudio</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create New Story */}
      {isNewStoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <FolderPlus className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm sm:text-base font-bold text-white">
                  Criar Nova História
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsNewStoryModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Título da História / Série:
                </label>
                <input
                  type="text"
                  value={newStoryTitle}
                  onChange={(e) => setNewStoryTitle(e.target.value)}
                  placeholder="Ex: História Sobrenatural: A Mansão da Colina"
                  className="w-full bg-neutral-950 border border-neutral-800 px-3.5 py-2 text-sm text-white rounded-xl focus:outline-none focus:border-neutral-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Categoria / Tema:
                </label>
                <select
                  value={newStoryCategory}
                  onChange={(e) => setNewStoryCategory(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 px-3.5 py-2 text-xs text-white rounded-xl focus:outline-none focus:border-neutral-500 cursor-pointer"
                >
                  <option value="Mistério & Ficção">Mistério & Ficção (Ex: UFO, Alienígenas)</option>
                  <option value="Drama Rural & Memórias">Drama Rural (Ex: Fazenda, Histórias do Campo)</option>
                  <option value="Terror & Suspense">Terror & Suspense Sobrenatural</option>
                  <option value="Aventura & Exploração">Aventura & Exploração</option>
                  <option value="História Real & Documentário">História Real & Documentário</option>
                  <option value="Audiobook / Contos">Audiobook / Contos Curtos</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Sinopse / Breve Descrição:
                </label>
                <textarea
                  value={newStoryDesc}
                  onChange={(e) => setNewStoryDesc(e.target.value)}
                  rows={3}
                  placeholder="Descreva sobre o que é esta história..."
                  className="w-full bg-neutral-950 border border-neutral-800 p-3 text-xs text-white rounded-xl focus:outline-none focus:border-neutral-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-300">
                  Voz Principal Padrão:
                </label>
                <select
                  value={newStoryVoiceId}
                  onChange={(e) => setNewStoryVoiceId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs text-white rounded-xl focus:outline-none focus:border-neutral-500 cursor-pointer"
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.langLabel} · {v.gender})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border-t border-neutral-800 p-4 bg-neutral-950 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewStoryModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateNewStory}
                className="px-5 py-2 text-xs font-bold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
              >
                Criar História
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete Story */}
      {storyToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-rose-950/80 border border-rose-800 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Excluir História?</h3>
                <p className="text-xs text-neutral-400 mt-0.5">Esta ação é irreversível.</p>
              </div>
            </div>

            <p className="text-xs text-neutral-300 bg-neutral-950 p-3 rounded-xl border border-neutral-800 leading-relaxed">
              Tem certeza que deseja excluir permanentemente a história <strong className="text-white">"{storyToDelete.title}"</strong> e todas as suas {storyToDelete.segments.length} partes gravadas?
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStoryToDelete(null)}
                className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeDeleteStory}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Sim, Excluir História</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete Segment */}
      {segmentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-rose-950/80 border border-rose-800 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Excluir Parte?</h3>
                <p className="text-xs text-neutral-400 mt-0.5">Esta ação não pode ser desfeita.</p>
              </div>
            </div>

            <p className="text-xs text-neutral-300 bg-neutral-950 p-3 rounded-xl border border-neutral-800 leading-relaxed">
              Deseja remover <strong className="text-white">"{segmentToDelete.title}"</strong> desta história?
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSegmentToDelete(null)}
                className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeDeleteSegment}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Excluir Parte</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
