import React, { useState, useEffect } from 'react';
import { Volume2, Sparkles, Loader2, AlertCircle, ChevronDown, Check, CheckCircle2, RotateCcw, ArrowRight, Zap, X, Film, Play, Download } from 'lucide-react';
import { Header } from './components/Header';
import { TextEditor } from './components/TextEditor';
import { VoiceSelector } from './components/VoiceSelector';
import { VoiceSettings } from './components/VoiceSettings';
import { AudioPlayer } from './components/AudioPlayer';
import { HistoryList } from './components/HistoryList';
import { AboutSection } from './components/AboutSection';
import { VideoVozLivre } from './components/VideoVozLivre';
import { LiveNarrada } from './components/LiveNarrada';
import { DialogoNatural } from './components/DialogoNatural';
import { IANarrada } from './components/IANarrada';
import { TaskManager } from './components/TaskManager';
import { FloatingTaskBadge } from './components/FloatingTaskBadge';
import { Voice, GeneratedAudio, GenerationProgress, ProsodySettings, AudioTask, VideoTask } from './types';
import { estimateDurationSeconds, getAudioDuration } from './utils/audio';
import { CURATED_VOICES } from './constants/voices';
import {
  saveAudioToDB,
  getAllAudiosFromDB,
  deleteAudioFromDB,
  clearAllAudiosFromDB,
  updateAudioTitleInDB,
} from './utils/db';
import { SafeguardBanner } from './components/SafeguardBanner';
import {
  requestPersistentStorage,
  saveEditorDraft,
  getEditorDraft,
  clearEditorDraft,
  saveActiveSessionTasks,
  getInterruptedSession,
  clearInterruptedSession,
  InterruptedSession,
  getRenderCheckpoint,
  getRenderCheckpointSync,
  getLatestRenderCheckpoint,
  getActiveVideoSessionState,
} from './utils/safeguard';

const STORAGE_KEY_VOICE = 'vozlivre_selected_voice_v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<'converter' | 'ia_narrada' | 'live_narrada' | 'dialogo_natural' | 'videovozlivre' | 'voices' | 'history' | 'about'>('converter');
  const [voices, setVoices] = useState<Voice[]>(CURATED_VOICES);
  const [selectedVoice, setSelectedVoice] = useState<Voice | null>(() => {
    try {
      const savedVoiceId = localStorage.getItem(STORAGE_KEY_VOICE);
      return CURATED_VOICES.find((v) => v.id === savedVoiceId) || CURATED_VOICES[0];
    } catch {
      return CURATED_VOICES[0];
    }
  });
  const [isVoicePickerOpen, setIsVoicePickerOpen] = useState(false);

  const [text, setText] = useState<string>('');
  const [audioTitle, setAudioTitle] = useState<string>('');
  const [settings, setSettings] = useState<ProsodySettings>({
    rate: '+0%',
    pitch: '+0Hz',
    volume: '+0%',
  });

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progress, setProgress] = useState<GenerationProgress>({
    active: false,
    completedChunks: 0,
    totalChunks: 0,
    percent: 0,
    statusText: '',
  });

  // Simultaneous Tasks Management
  const [audioTasks, setAudioTasks] = useState<AudioTask[]>([]);
  const [videoTasks, setVideoTasks] = useState<VideoTask[]>([]);
  const [isTaskManagerOpen, setIsTaskManagerOpen] = useState<boolean>(false);

  // Safeguard & Session Recovery State
  const [interruptedSession, setInterruptedSession] = useState<InterruptedSession | null>(null);
  const [isPersistentStorageActive, setIsPersistentStorageActive] = useState<boolean>(false);
  const [editorToast, setEditorToast] = useState<string | null>(null);
  const [resumeVideoTaskId, setResumeVideoTaskId] = useState<string | null>(null);
  const [requestedStudioMode, setRequestedStudioMode] = useState<'reportagem' | 'escrita' | 'whatsapp' | null>(null);
  const [isWhatsAppSubTabActive, setIsWhatsAppSubTabActive] = useState<boolean>(false);
  const taskTextMapRef = React.useRef<Record<string, string>>({});
  const isInitializedRef = React.useRef<boolean>(false);

  const handleLoadTextToEditor = (textToLoad: string, title?: string) => {
    if (!textToLoad) return;
    setText(textToLoad);
    if (title) {
      setAudioTitle(title);
    }
    setActiveTab('converter');
    setEditorToast('Texto recuperado com sucesso para a área de edição!');
    setTimeout(() => setEditorToast(null), 4000);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const [currentAudio, setCurrentAudio] = useState<GeneratedAudio | null>(null);
  const [videoEditorAudio, setVideoEditorAudio] = useState<GeneratedAudio | null>(null);
  const [history, setHistory] = useState<GeneratedAudio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [eventSourceRef, setEventSourceRef] = useState<EventSource | null>(null);

  // Initialize Safeguard: Persistent storage, draft recovery, and interrupted session check
  useEffect(() => {
    // 1. Request persistent disk storage against browser purge
    requestPersistentStorage().then((granted) => {
      setIsPersistentStorageActive(granted);
    });

    // 2. Check for interrupted session snapshot (e.g., battery death, crash, accidental close)
    const savedInterrupted = getInterruptedSession();
    if (savedInterrupted) {
      setInterruptedSession(savedInterrupted);
    } else {
      const activeVideoSession = getActiveVideoSessionState();
      if (activeVideoSession) {
        setInterruptedSession({
          timestamp: activeVideoSession.updatedAt || Date.now(),
          audioTasks: [],
          videoTasks: [
            {
              id: activeVideoSession.taskId,
              title: activeVideoSession.title,
              aspectRatio: activeVideoSession.aspectRatio,
              fitMode: activeVideoSession.fitMode || 'blur_capcut',
              progress: activeVideoSession.progressPercent ?? activeVideoSession.progress ?? 0,
              lastCompletedFrame: activeVideoSession.lastCompletedFrame,
              totalFrames: activeVideoSession.totalFrames,
              studioType: activeVideoSession.studioType,
            },
          ],
        });
      }
    }

    // 3. Restore draft text if editor is empty
    const draft = getEditorDraft();
    if (draft && draft.text) {
      setText((cur) => (cur ? cur : draft.text));
      if (draft.title) setAudioTitle((cur) => (cur ? cur : draft.title));
      if (draft.settings) setSettings(draft.settings);
    }
    isInitializedRef.current = true;
  }, []);

  // Autosave editor text draft continuously
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (text.trim() || audioTitle.trim()) {
      saveEditorDraft(text, audioTitle, selectedVoice?.id, settings);
    } else {
      clearEditorDraft();
    }
  }, [text, audioTitle, selectedVoice, settings]);

  // Continuously record active tasks for instant safeguard recovery
  useEffect(() => {
    saveActiveSessionTasks(audioTasks, videoTasks, taskTextMapRef.current);
  }, [audioTasks, videoTasks]);

  // Prevent accidental exit / loss of processing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasActiveAudio = audioTasks.some((t) => t.status === 'processing' || t.status === 'queued');
      const hasActiveVideo = videoTasks.some((t) => t.status === 'rendering' || t.status === 'preparing' || t.status === 'queued');
      const hasUnsavedWork = hasActiveAudio || hasActiveVideo || text.trim().length > 150;

      if (hasUnsavedWork) {
        e.preventDefault();
        e.returnValue = 'Você possui tarefas em andamento ou textos não salvos. Se sair agora, o processamento será interrompido.';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [audioTasks, videoTasks, text]);

  const handleResumeVideoTask = async (taskId: string) => {
    const cp = getRenderCheckpointSync(taskId) || (await getRenderCheckpoint(taskId));
    const studioType =
      cp?.studioType ||
      (taskId.startsWith('nar-')
        ? 'roteiro_criativo'
        : taskId.startsWith('rep-')
        ? 'reportagem'
        : 'video_editor');

    if (studioType === 'roteiro_criativo' || studioType === 'reportagem') {
      setActiveTab('ia_narrada');
      setResumeVideoTaskId(taskId);
    } else {
      setActiveTab('videovozlivre');
      setResumeVideoTaskId(taskId);
    }
  };

  const handleResumeSession = async () => {
    if (!interruptedSession) return;
    if (interruptedSession.videoTasks && interruptedSession.videoTasks.length > 0) {
      const firstVideo = interruptedSession.videoTasks[0];
      await handleResumeVideoTask(firstVideo.id);
    } else if (interruptedSession.audioTasks && interruptedSession.audioTasks.length > 0) {
      const firstTask = interruptedSession.audioTasks[0];
      if (firstTask.text) {
        setText(firstTask.text);
        if (firstTask.title) setAudioTitle(firstTask.title);
        if (firstTask.settings) setSettings(firstTask.settings);
      }
      setActiveTab('converter');
    }
    clearInterruptedSession();
    setInterruptedSession(null);
  };

  const handleDismissSession = () => {
    clearInterruptedSession();
    setInterruptedSession(null);
  };

  // Load voices from API
  useEffect(() => {
    async function fetchVoices() {
      try {
        const res = await fetch('/api/voices');
        const data = await res.json();
        if (data.voices && Array.isArray(data.voices)) {
          setVoices(data.voices);

          // Restore saved voice or pick default (Francisca)
          const savedVoiceId = localStorage.getItem(STORAGE_KEY_VOICE);
          const found = data.voices.find((v: Voice) => v.id === savedVoiceId);
          if (found) {
            setSelectedVoice(found);
          } else {
            const defaultVoice = data.voices.find((v: Voice) => v.isDefault) || data.voices[0];
            setSelectedVoice(defaultVoice);
          }
        }
      } catch (err) {
        console.error('Failed to load voices:', err);
      }
    }
    fetchVoices();
  }, []);

  // Load history permanently from IndexedDB (preserves raw audio files locally)
  useEffect(() => {
    async function loadSavedAudios() {
      try {
        const items = await getAllAudiosFromDB();
        if (items && items.length > 0) {
          const loaded: GeneratedAudio[] = items.map((item) => {
            const blobUrl = URL.createObjectURL(item.audioBlob);
            return {
              id: item.id,
              title: item.title,
              voice: item.voice,
              textSnippet: item.textSnippet,
              fullText: item.fullText || item.textSnippet,
              charCount: item.charCount,
              durationSeconds: item.durationSeconds,
              createdAt: item.createdAt,
              audioUrl: blobUrl,
              downloadUrl: blobUrl,
              blobUrl: blobUrl,
              blob: item.audioBlob,
              sizeBytes: item.sizeBytes,
              isUploaded: !!item.isUploaded || item.voice?.id === 'custom-upload' || item.voice?.id === 'user-upload',
            };
          });
          setHistory(loaded);
        }
      } catch (e) {
        console.error('Failed to load audio history from IndexedDB:', e);
      }
    }
    loadSavedAudios();
  }, []);

  const handleUploadAudio = async (file: File): Promise<GeneratedAudio> => {
    const objectUrl = URL.createObjectURL(file);
    const measuredDuration = await getAudioDuration(file);
    const title = file.name.replace(/\.[^/.]+$/, '').trim() || 'Áudio Enviado';
    const audioId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const newAudio: GeneratedAudio = {
      id: audioId,
      title,
      voice: {
        id: 'user-upload',
        name: 'Áudio do Usuário',
        gender: 'Neutro',
        lang: 'pt-BR',
        langLabel: 'Áudio Enviado',
        description: 'Arquivo de áudio importado pelo usuário',
      },
      textSnippet: file.name,
      charCount: 0,
      durationSeconds: measuredDuration,
      createdAt: Date.now(),
      audioUrl: objectUrl,
      downloadUrl: objectUrl,
      blobUrl: objectUrl,
      blob: file,
      sizeBytes: file.size,
      isUploaded: true,
    };

    try {
      await saveAudioToDB({
        id: audioId,
        title,
        voice: newAudio.voice,
        textSnippet: file.name,
        charCount: 0,
        durationSeconds: measuredDuration,
        createdAt: Date.now(),
        sizeBytes: file.size,
        audioBlob: file,
        isUploaded: true,
      });
    } catch (err) {
      console.error('Failed to save uploaded audio to IndexedDB:', err);
    }

    setHistory((prev) => [newAudio, ...prev.filter((i) => i.id !== audioId)]);
    setCurrentAudio(newAudio);
    return newAudio;
  };

  const handleSelectVoice = (voice: Voice) => {
    setSelectedVoice(voice);
    try {
      localStorage.setItem(STORAGE_KEY_VOICE, voice.id);
    } catch {}
    setIsVoicePickerOpen(false);
  };

  const handleSendToVideoEditor = (audio: GeneratedAudio) => {
    setVideoEditorAudio(audio);
    setActiveTab('videovozlivre');
    setError(null);
  };

  const handleUpdateAudioTitle = async (id: string, newTitle: string) => {
    try {
      await updateAudioTitleInDB(id, newTitle);
    } catch (e) {
      console.error('Failed to update title in DB:', e);
    }
    setHistory((prev) =>
      prev.map((item) => (item.id === id ? { ...item, title: newTitle } : item))
    );
    if (currentAudio?.id === id) {
      setCurrentAudio((prev) => (prev ? { ...prev, title: newTitle } : null));
    }
  };

  const handleDeleteAudio = async (id: string) => {
    try {
      await deleteAudioFromDB(id);
    } catch (e) {
      console.error('Failed to delete from IndexedDB:', e);
    }
    setHistory((prev) => prev.filter((i) => i.id !== id));
    if (currentAudio?.id === id) {
      setCurrentAudio(null);
    }
  };

  const handleClearHistory = async () => {
    try {
      await clearAllAudiosFromDB();
    } catch (e) {
      console.error('Failed to clear IndexedDB:', e);
    }
    setHistory([]);
  };

  // Cancel generation of active tasks
  const handleCancelAudioTask = (taskId: string) => {
    const task = audioTasks.find((t) => t.id === taskId);
    if (task && task.abortController) {
      task.abortController.abort();
    }
    setAudioTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: 'cancelled', statusText: 'Cancelado pelo usuário' } : t
      )
    );
  };

  const handleCancelVideoTask = (taskId: string) => {
    setVideoTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: 'cancelled', statusText: 'Cancelado pelo usuário' } : t
      )
    );
  };

  const handleClearCompletedTasks = () => {
    setAudioTasks((prev) => prev.filter((t) => t.status === 'processing' || t.status === 'queued'));
    setVideoTasks((prev) => prev.filter((t) => t.status === 'rendering' || t.status === 'preparing' || t.status === 'queued'));
  };

  const handleCancelGeneration = () => {
    audioTasks.forEach((t) => {
      if (t.status === 'processing' && t.abortController) {
        t.abortController.abort();
      }
    });
    setAudioTasks((prev) =>
      prev.map((t) =>
        t.status === 'processing' ? { ...t, status: 'cancelled', statusText: 'Cancelado' } : t
      )
    );
    setIsGenerating(false);
    setProgress({
      active: false,
      completedChunks: 0,
      totalChunks: 0,
      percent: 0,
      statusText: '',
    });
  };

  // Main Conversion Handler (Supports Multiple Simultaneous Audio Generations)
  const handleConvert = async () => {
    if (!text.trim()) {
      setError('Por favor, insira ou cole o texto que deseja converter em voz.');
      return;
    }

    if (text.length > 25000) {
      setError('O texto ultrapassa o limite máximo permitido de 25.000 caracteres.');
      return;
    }

    setError(null);

    const activeVoice = selectedVoice || voices[0] || {
      id: 'pt-BR-FranciscaNeural',
      name: 'Francisca',
      gender: 'Feminino',
      lang: 'pt-BR',
      langLabel: 'Português (Brasil)',
      description: 'Voz natural e expressiva',
    };

    const firstSnippet = text.trim().slice(0, 70).replace(/\n/g, ' ') + (text.length > 70 ? '...' : '');
    const determinedTitle =
      audioTitle.trim() ||
      text.trim().slice(0, 50).replace(/\n/g, ' ') ||
      `audio-${activeVoice.name.toLowerCase()}`;
    const textToSynthesize = text;
    const currentSettings = { ...settings };
    const taskId = `atask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    taskTextMapRef.current[taskId] = textToSynthesize;
    const abortCtrl = new AbortController();

    const newTask: AudioTask = {
      id: taskId,
      title: determinedTitle,
      textSnippet: firstSnippet,
      fullText: textToSynthesize,
      charCount: textToSynthesize.length,
      voice: activeVoice,
      settings: currentSettings,
      status: 'processing',
      progress: 5,
      statusText: `Sintetizando áudio neural com ${activeVoice.name}...`,
      createdAt: Date.now(),
      abortController: abortCtrl,
    };

    setAudioTasks((prev) => [newTask, ...prev]);

    // Limpa imediatamente o campo de texto e o título da área de conversão
    // para permitir colar ou digitar um novo texto para produção de imediato
    setText('');
    setAudioTitle('');
    clearEditorDraft();

    setIsGenerating(true);
    setProgress({
      active: true,
      completedChunks: 0,
      totalChunks: 1,
      percent: 5,
      statusText: `Sintetizando áudio neural com ${activeVoice.name}...`,
    });

    // Run synthesis asynchronously in background so multiple audio tasks process concurrently!
    (async () => {
      let curPercent = 10;
      const progressTimer = setInterval(() => {
        curPercent = Math.min(94, curPercent + 12);
        setAudioTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  progress: curPercent,
                  statusText: `Sintetizando áudio neural com ${activeVoice.name} (${curPercent}%)...`,
                }
              : t
          )
        );
        setProgress((p) => ({
          ...p,
          percent: curPercent,
          statusText: `Sintetizando áudio neural com ${activeVoice.name} (${curPercent}%)...`,
        }));
      }, 350);

      try {
        const res = await fetch('/api/tts?stream=true', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          signal: abortCtrl.signal,
          body: JSON.stringify({
            text: textToSynthesize,
            voice: activeVoice.id,
            rate: currentSettings.rate,
            pitch: currentSettings.pitch,
            volume: currentSettings.volume,
          }),
        });

        clearInterval(progressTimer);

        if (!res.ok) {
          let errMessage = 'Erro na síntese de áudio.';
          try {
            const errJson = await res.json();
            errMessage = errJson?.error || errMessage;
          } catch {
            errMessage = 'Serviço de voz temporariamente ocupado. Tente novamente.';
          }
          throw new Error(errMessage);
        }

        let audioBlob: Blob;
        const cType = res.headers.get('content-type') || '';
        if (cType.includes('audio/')) {
          audioBlob = await res.blob();
        } else {
          const jsonData = await res.json();
          if (jsonData.audioUrl) {
            const fileRes = await fetch(jsonData.audioUrl);
            audioBlob = await fileRes.blob();
          } else {
            throw new Error('Formato de resposta de áudio inválido.');
          }
        }

        const audioId = res.headers.get('x-audio-id') || crypto.randomUUID();
        const localAudioUrl = URL.createObjectURL(audioBlob);
        const estDuration = estimateDurationSeconds(textToSynthesize.length);

        const newAudio: GeneratedAudio = {
          id: audioId,
          title: determinedTitle,
          voice: activeVoice,
          textSnippet: firstSnippet,
          fullText: textToSynthesize,
          charCount: textToSynthesize.length,
          durationSeconds: estDuration,
          createdAt: Date.now(),
          audioUrl: localAudioUrl,
          downloadUrl: localAudioUrl,
          blobUrl: localAudioUrl,
          blob: audioBlob,
          sizeBytes: audioBlob.size,
        };

        try {
          await saveAudioToDB({
            id: audioId,
            title: determinedTitle,
            voice: activeVoice,
            textSnippet: firstSnippet,
            fullText: textToSynthesize,
            charCount: textToSynthesize.length,
            durationSeconds: estDuration,
            createdAt: Date.now(),
            sizeBytes: audioBlob.size,
            audioBlob,
          });
        } catch (dbErr) {
          console.error('Failed to save audio to IndexedDB:', dbErr);
        }

        setHistory((prev) => [newAudio, ...prev.filter((i) => i.id !== audioId)]);
        setCurrentAudio(newAudio);

        setAudioTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: 'completed',
                  progress: 100,
                  statusText: 'Áudio concluído com sucesso!',
                  completedAt: Date.now(),
                  resultAudio: newAudio,
                }
              : t
          )
        );

        setIsGenerating(false);
        setProgress({
          active: false,
          completedChunks: 1,
          totalChunks: 1,
          percent: 100,
          statusText: 'Áudio concluído com sucesso!',
        });
      } catch (err: any) {
        clearInterval(progressTimer);
        if (err.name === 'AbortError') {
          setAudioTasks((prev) =>
            prev.map((t) =>
              t.id === taskId ? { ...t, status: 'cancelled', statusText: 'Cancelado pelo usuário' } : t
            )
          );
        } else {
          setAudioTasks((prev) =>
            prev.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    status: 'error',
                    errorMessage: err?.message || 'Erro na síntese',
                    statusText: 'Erro na geração',
                  }
                : t
            )
          );
          setError(err?.message || 'Falha na conexão com o serviço de voz.');
        }
        setIsGenerating(false);
      }
    })();
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-neutral-800 selection:text-white">
      {/* 3-Zone Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab === 'ia_narrada') {
            setIsWhatsAppSubTabActive(false);
            setRequestedStudioMode('reportagem');
          }
          setError(null);
        }}
        onOpenWhatsAppTab={() => {
          setActiveTab('ia_narrada');
          setIsWhatsAppSubTabActive(true);
          setRequestedStudioMode('whatsapp');
          setError(null);
        }}
        isWhatsAppSubTabActive={isWhatsAppSubTabActive}
        historyCount={history.length}
        totalActiveTasks={
          audioTasks.filter((t) => t.status === 'processing' || t.status === 'queued').length +
          videoTasks.filter((t) => t.status === 'rendering' || t.status === 'preparing' || t.status === 'queued').length
        }
        onOpenTaskManager={() => setIsTaskManagerOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Safeguard & Session Recovery Banner */}
        <SafeguardBanner
          interruptedSession={interruptedSession}
          onResumeSession={handleResumeSession}
          onDismissSession={handleDismissSession}
          isPersistentStorageActive={isPersistentStorageActive}
        />

        {/* Error notification */}
        {error && (
          <div className="mb-6 rounded-xl border border-rose-900/50 bg-rose-950/40 p-4 flex items-start justify-between gap-3 text-sm text-rose-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-xs text-rose-400 hover:text-white"
            >
              Fechar
            </button>
          </div>
        )}

        {/* View 1: Converter */}
        {activeTab === 'converter' && (
          <div className="space-y-6">
            {editorToast && (
              <div className="flex items-center justify-between gap-3 p-3.5 bg-cyan-950/80 border border-cyan-500/40 rounded-xl text-cyan-200 text-xs font-medium animate-in fade-in duration-200 shadow-lg">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span>{editorToast}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setEditorToast(null)}
                  className="p-1 text-cyan-400 hover:text-white rounded cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Minimalist Hero Subhead */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-neutral-900 pb-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                  Texto em Voz Natural
                </h1>
                <p className="text-sm text-neutral-400 mt-1 max-w-xl">
                  Gere áudios longos de até 20.000 caracteres com entonação humana ultra-realista. 100% gratuito, sem limite de créditos e com download imediato em MP3 e WAV com o nome que você escolher.
                </p>
              </div>

              {/* Trust Tag */}
              <div className="flex items-center gap-2 text-xs text-neutral-400 shrink-0">
                <span className="font-mono text-neutral-300">20.000</span> caracteres
                <span aria-hidden="true">·</span>
                <span>Voz Neural Edge</span>
              </div>
            </div>

            {/* Selected Voice Card & Picker Trigger */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-800 text-neutral-100 shrink-0">
                    <Volume2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-neutral-400">Voz Selecionada:</span>
                      <strong className="text-sm font-semibold text-white">
                        {selectedVoice?.name || 'Carregando vozes...'}
                      </strong>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
                      <span>{selectedVoice?.langLabel || 'Português (Brasil)'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{selectedVoice?.gender || 'Feminino'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="hidden sm:inline text-neutral-400">
                        {selectedVoice?.description}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsVoicePickerOpen(!isVoicePickerOpen)}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
                >
                  <span>{isVoicePickerOpen ? 'Fechar Catálogo' : 'Trocar Voz'}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${isVoicePickerOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              {/* Expandable Voice Picker Accordion */}
              {isVoicePickerOpen && (
                <div className="mt-4 pt-4 border-t border-neutral-800">
                  <VoiceSelector
                    voices={voices}
                    selectedVoiceId={selectedVoice?.id || ''}
                    onSelectVoice={handleSelectVoice}
                  />
                </div>
              )}
            </div>

            {/* Text Editor with Char Counter & File Name input */}
            <TextEditor
              text={text}
              onChange={setText}
              audioTitle={audioTitle}
              onTitleChange={setAudioTitle}
              maxChars={20000}
              disabled={false}
              onSubmit={handleConvert}
            />

            {/* Voice Prosody Settings (Speed & Pitch) */}
            <VoiceSettings
              settings={settings}
              onChange={setSettings}
              disabled={false}
            />

            {/* Generation CTA & Simultaneous Processing Queue */}
            <div className="space-y-4 pt-2">
              <button
                type="button"
                onClick={handleConvert}
                disabled={!text.trim()}
                className="w-full py-3.5 px-6 rounded-xl font-semibold text-sm text-neutral-950 bg-white hover:bg-neutral-200 active:scale-[0.99] transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Sparkles className="h-4 w-4" />
                <span>
                  Converter em Áudio Natural
                  {audioTasks.filter((t) => t.status === 'processing').length > 0 && (
                    <span className="ml-1.5 text-xs text-neutral-600 font-normal">
                      (⚡ {audioTasks.filter((t) => t.status === 'processing').length} em paralelo)
                    </span>
                  )}
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>

              {/* Live Simultaneous Processing Queue Card */}
              {audioTasks.length > 0 && (
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4 space-y-3 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                      <h3 className="text-xs font-bold text-white tracking-wide uppercase">
                        Processamento Simultâneo de Áudio (
                        {audioTasks.filter((t) => t.status === 'processing').length} ativos / {audioTasks.length} total)
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsTaskManagerOpen(true)}
                      className="text-xs text-violet-400 hover:text-violet-300 font-medium underline cursor-pointer"
                    >
                      Central de Tarefas →
                    </button>
                  </div>

                  <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                    {audioTasks.map((task) => (
                      <div
                        key={task.id}
                        className={`rounded-lg border p-3 transition-colors ${
                          task.status === 'processing'
                            ? 'bg-neutral-950/80 border-violet-800/50'
                            : task.status === 'completed'
                            ? 'bg-neutral-950/50 border-emerald-900/40'
                            : 'bg-neutral-950/30 border-neutral-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-white truncate max-w-[220px] sm:max-w-md">
                                {task.title}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono">
                                {task.voice.name}
                              </span>
                              {task.status === 'processing' && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-violet-400 font-medium">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span>Processando agora</span>
                                </span>
                              )}
                              {task.status === 'completed' && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                                  <Check className="h-3 w-3" />
                                  <span>Pronto</span>
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-neutral-400 truncate mt-0.5">
                              {task.textSnippet}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {task.status === 'processing' && (
                              <button
                                type="button"
                                onClick={() => handleCancelAudioTask(task.id)}
                                className="text-[11px] text-neutral-400 hover:text-rose-400 transition-colors cursor-pointer"
                              >
                                Cancelar
                              </button>
                            )}
                            {task.status === 'completed' && task.resultAudio && (
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCurrentAudio(task.resultAudio!);
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded transition-colors cursor-pointer"
                                  title="Carregar no player"
                                >
                                  <Play className="h-3 w-3" />
                                  <span>Ouvir</span>
                                </button>
                                <a
                                  href={task.resultAudio.downloadUrl}
                                  download={`${task.title}.mp3`}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-800/60 rounded transition-colors cursor-pointer"
                                  title="Baixar MP3"
                                >
                                  <Download className="h-3 w-3" />
                                  <span>MP3</span>
                                </a>
                                <button
                                  type="button"
                                  onClick={() => handleSendToVideoEditor(task.resultAudio!)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-violet-300 bg-violet-950/60 hover:bg-violet-900/80 border border-violet-800/60 rounded transition-colors cursor-pointer"
                                  title="Enviar para VideoVozLivre (16:9 ou 9:16 com Desfoque CapCut)"
                                >
                                  <Film className="h-3 w-3" />
                                  <span>Vídeo</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Progress bar if processing */}
                        {task.status === 'processing' && (
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center justify-between text-[10px] text-neutral-400">
                              <span className="truncate">{task.statusText}</span>
                              <span className="font-mono font-bold text-violet-400">{task.progress}%</span>
                            </div>
                            <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-gradient-to-r from-violet-500 to-emerald-400 h-full transition-all duration-300 ease-out"
                                style={{ width: `${task.progress}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Audio Player (Appears when audio is ready) */}
            {currentAudio && (
              <div className="pt-2 animate-in fade-in duration-300">
                <AudioPlayer
                  audio={currentAudio}
                  onUpdateTitle={handleUpdateAudioTitle}
                  onSendToVideoEditor={handleSendToVideoEditor}
                  onLoadTextToEditor={handleLoadTextToEditor}
                />
              </div>
            )}
          </div>
        )}

        {/* View: IA Narrada (Matéria para Vídeo & Roteiro Criativo para Vídeo) - kept mounted so background video rendering continues uninterrupted */}
        <div className={activeTab === 'ia_narrada' ? 'block' : 'hidden'}>
          <IANarrada
            initialVoice={selectedVoice}
            onTransferToVoice={(transferredText, suggestedTitle) => {
              setText(transferredText);
              if (suggestedTitle) {
                setAudioTitle(suggestedTitle);
              }
              setActiveTab('converter');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onTransferToVideo={(audio) => {
              setVideoEditorAudio(audio);
              setActiveTab('videovozlivre');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onAddAudioTask={(task) => setAudioTasks((prev) => [task, ...prev])}
            onUpdateAudioTask={(id, updates) =>
              setAudioTasks((prev) =>
                prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
              )
            }
            onAddVideoTask={(task) => setVideoTasks((prev) => [task, ...prev])}
            onUpdateVideoTask={(id, updates) =>
              setVideoTasks((prev) =>
                prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
              )
            }
            onOpenTaskManager={() => setIsTaskManagerOpen(true)}
            resumeTaskId={
              resumeVideoTaskId && (resumeVideoTaskId.startsWith('nar-') || resumeVideoTaskId.startsWith('rep-'))
                ? resumeVideoTaskId
                : null
            }
            onResumeHandled={() => setResumeVideoTaskId(null)}
            requestedStudioMode={requestedStudioMode}
            onStudioModeHandled={() => setRequestedStudioMode(null)}
          />
        </div>

        {/* View: Live Narrada (Histórias Contínuas Interligadas) */}
        {activeTab === 'live_narrada' && (
          <LiveNarrada
            voices={voices}
            onSendToVideoEditor={(audio) => {
              setVideoEditorAudio(audio);
              setActiveTab('videovozlivre');
            }}
            onNavigateToConverter={() => setActiveTab('converter')}
          />
        )}

        {/* View: Diálogo Natural (Podcast com 2 ou mais Personagens) */}
        {activeTab === 'dialogo_natural' && (
          <DialogoNatural
            voices={voices}
            onSendToVideoEditor={(audio) => {
              setVideoEditorAudio(audio);
              setActiveTab('videovozlivre');
            }}
            onNavigateToConverter={() => setActiveTab('converter')}
          />
        )}

        {/* View 2: VideoVozLivre Editor */}
        {activeTab === 'videovozlivre' && (
          <VideoVozLivre
            currentAudio={videoEditorAudio || currentAudio || history[0] || null}
            history={history}
            onSelectAudio={(audio) => {
              setVideoEditorAudio(audio);
              setCurrentAudio(audio);
            }}
            onNavigateToConverter={() => setActiveTab('converter')}
            onAudioUploaded={(audio) => {
              setHistory((prev) => [audio, ...prev.filter((i) => i.id !== audio.id)]);
              setVideoEditorAudio(audio);
              setCurrentAudio(audio);
            }}
            videoTasks={videoTasks}
            onAddVideoTask={(task) => setVideoTasks((prev) => [task, ...prev])}
            onUpdateVideoTask={(id, updates) =>
              setVideoTasks((prev) =>
                prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
              )
            }
            onOpenTaskManager={() => setIsTaskManagerOpen(true)}
            onNavigateToIANarrada={() => setActiveTab('ia_narrada')}
            resumeTaskId={
              resumeVideoTaskId && !resumeVideoTaskId.startsWith('nar-') && !resumeVideoTaskId.startsWith('rep-')
                ? resumeVideoTaskId
                : null
            }
            onResumeHandled={() => setResumeVideoTaskId(null)}
          />
        )}

        {/* View 3: Full Voice Catalog */}
        {activeTab === 'voices' && (
          <div className="space-y-6">
            <div className="border-b border-neutral-900 pb-4">
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Catálogo de Vozes Neurais
              </h2>
              <p className="text-sm text-neutral-400 mt-1">
                Todas as vozes utilizam modelos neurais avançados com entonação humana natural e sem limites de créditos. Clique no botão de reprodução para ouvir uma demonstração de cada voz.
              </p>
            </div>

            <VoiceSelector
              voices={voices}
              selectedVoiceId={selectedVoice?.id || ''}
              onSelectVoice={(voice) => {
                handleSelectVoice(voice);
                setActiveTab('converter');
              }}
            />
          </div>
        )}

        {/* View 4: History */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            <HistoryList
              history={history}
              currentAudioId={currentAudio?.id}
              onSelectAudio={(item) => {
                setCurrentAudio(item);
                setActiveTab('converter');
              }}
              onDeleteAudio={handleDeleteAudio}
              onClearHistory={handleClearHistory}
              onUpdateTitle={handleUpdateAudioTitle}
              onSendToVideoEditor={handleSendToVideoEditor}
              onUploadAudio={handleUploadAudio}
              onLoadTextToEditor={handleLoadTextToEditor}
            />
          </div>
        )}

        {/* View 5: How It Works */}
        {activeTab === 'about' && (
          <AboutSection />
        )}
      </main>

      {/* Floating Simultaneous Task Monitor Badge */}
      <FloatingTaskBadge
        audioTasks={audioTasks}
        videoTasks={videoTasks}
        onOpenTaskManager={() => setIsTaskManagerOpen(true)}
      />

      {/* Task Manager Modal */}
      <TaskManager
        audioTasks={audioTasks}
        videoTasks={videoTasks}
        onCancelAudioTask={handleCancelAudioTask}
        onCancelVideoTask={handleCancelVideoTask}
        onResumeVideoTask={handleResumeVideoTask}
        onClearCompletedTasks={handleClearCompletedTasks}
        onPlayAudio={(audio) => {
          setCurrentAudio(audio);
          setActiveTab('converter');
        }}
        onSendToVideo={handleSendToVideoEditor}
        onLoadTextToEditor={handleLoadTextToEditor}
        isOpen={isTaskManagerOpen}
        onClose={() => setIsTaskManagerOpen(false)}
      />

      {/* Clean Minimalist Footer */}
      <footer className="w-full border-t border-neutral-900 bg-neutral-950 py-6 mt-12 text-xs text-neutral-500">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-300">VozLivre</span>
            <span aria-hidden="true">·</span>
            <span>Síntese de Voz Neural Livre e Ilimitada</span>
          </div>

          <div className="flex items-center gap-3">
            <span>Nomeação Personalizada de Arquivos</span>
            <span aria-hidden="true">·</span>
            <span>Até 20.000 caracteres</span>
            <span aria-hidden="true">·</span>
            <span>Zero Créditos / Grátis</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
