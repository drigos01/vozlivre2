import React, { useRef, useState, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Download,
  Volume2,
  VolumeX,
  Share2,
  Check,
  Music,
  Pencil,
  FileAudio,
  Film,
  Repeat,
} from 'lucide-react';
import {
  formatTime,
  formatBytes,
  audioBufferToWavBlob,
  downloadAudio,
  downloadBlob,
  formatFilename,
} from '../utils/audio';
import { GeneratedAudio } from '../types';

interface AudioPlayerProps {
  audio: GeneratedAudio;
  onUpdateTitle?: (audioId: string, newTitle: string) => void;
  onSendToVideoEditor?: (audio: GeneratedAudio) => void;
  onLoadTextToEditor?: (text: string, title?: string) => void;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audio,
  onUpdateTitle,
  onSendToVideoEditor,
  onLoadTextToEditor,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(audio.durationSeconds || 0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isDownloadingMp3, setIsDownloadingMp3] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [isConvertingWav, setIsConvertingWav] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [audioProfile, setAudioProfile] = useState<'normal' | 'podcast' | 'vintage' | 'echo' | 'cinema'>('normal');
  const [isLooping, setIsLooping] = useState(false);

  // Web Audio Equalizer / DSP Chain nodes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const bassFilterRef = useRef<BiquadFilterNode | null>(null);
  const midFilterRef = useRef<BiquadFilterNode | null>(null);
  const highFilterRef = useRef<BiquadFilterNode | null>(null);
  const bandpassFilterRef = useRef<BiquadFilterNode | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const bandpassGainRef = useRef<GainNode | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const delayGainRef = useRef<GainNode | null>(null);
  const delayFeedbackRef = useRef<GainNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);

  // Initialize Web Audio DSP chain once
  const initDspChain = () => {
    if (audioCtxRef.current || !audioRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaElementSource(audioRef.current);
      sourceNodeRef.current = source;

      // 1. Equalizer Filters
      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 120;
      bass.gain.value = 0;
      bassFilterRef.current = bass;

      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 2800;
      mid.Q.value = 1.0;
      mid.gain.value = 0;
      midFilterRef.current = mid;

      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 8000;
      high.gain.value = 0;
      highFilterRef.current = high;

      // 2. Vintage Phone Bandpass Filter (parallel path)
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 1300;
      bandpass.Q.value = 1.4;
      bandpassFilterRef.current = bandpass;

      const dryGain = ctx.createGain();
      dryGain.gain.value = 1.0;
      dryGainRef.current = dryGain;

      const bandpassGain = ctx.createGain();
      bandpassGain.gain.value = 0.0;
      bandpassGainRef.current = bandpassGain;

      // 3. Ambient Echo Delay
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.14;
      delayNodeRef.current = delay;

      const delayFeedback = ctx.createGain();
      delayFeedback.gain.value = 0.22;
      delayFeedbackRef.current = delayFeedback;

      const delayGain = ctx.createGain();
      delayGain.gain.value = 0.0;
      delayGainRef.current = delayGain;

      // 4. Dynamics Compressor
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      compressorRef.current = comp;

      // 5. Real-time Analyser for live frequency spectrum
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      // Wire Dry Path: Source -> Bass -> Mid -> High -> DryGain -> Compressor -> Destination & Analyser
      source.connect(bass);
      bass.connect(mid);
      mid.connect(high);
      high.connect(dryGain);
      dryGain.connect(comp);
      comp.connect(ctx.destination);
      comp.connect(analyser);

      // Wire Vintage Bandpass Path: Source -> Bandpass -> BandpassGain -> Destination
      source.connect(bandpass);
      bandpass.connect(bandpassGain);
      bandpassGain.connect(ctx.destination);

      // Wire Echo Delay Path: High -> Delay -> DelayGain -> Destination & Loopback
      high.connect(delay);
      delay.connect(delayFeedback);
      delayFeedback.connect(delay);
      delay.connect(delayGain);
      delayGain.connect(ctx.destination);
    } catch (e) {
      console.warn('Web Audio DSP not initialized:', e);
    }
  };

  const applyAudioProfile = (profile: 'normal' | 'podcast' | 'vintage' | 'echo' | 'cinema') => {
    initDspChain();
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    setAudioProfile(profile);

    const bass = bassFilterRef.current;
    const mid = midFilterRef.current;
    const high = highFilterRef.current;
    const dry = dryGainRef.current;
    const bp = bandpassGainRef.current;
    const delay = delayGainRef.current;
    const comp = compressorRef.current;

    if (!bass || !mid || !high || !dry || !bp || !delay || !comp) return;

    if (profile === 'podcast') {
      // Rádio / Podcast Pro: Bass boost 120Hz +5dB, Mid clarity +2.5dB, Smooth Compression
      bass.gain.value = 5.5;
      mid.gain.value = 2.5;
      high.gain.value = 1.0;
      dry.gain.value = 1.0;
      bp.gain.value = 0.0;
      delay.gain.value = 0.0;
      comp.threshold.value = -20;
      comp.ratio.value = 4;
    } else if (profile === 'vintage') {
      // Vintage Phone: mute dry, pass only narrow telephone band
      dry.gain.value = 0.0;
      bp.gain.value = 1.8;
      delay.gain.value = 0.0;
    } else if (profile === 'echo') {
      // Soft Ambient Echo
      bass.gain.value = 1.0;
      mid.gain.value = 0.0;
      high.gain.value = 0.0;
      dry.gain.value = 1.0;
      bp.gain.value = 0.0;
      delay.gain.value = 0.32;
    } else if (profile === 'cinema') {
      // Cinema Deep Bass: Deep sub-bass boost +8dB at 80Hz + punchy compression
      bass.frequency.value = 90;
      bass.gain.value = 8.0;
      mid.gain.value = 1.5;
      high.gain.value = 0.5;
      dry.gain.value = 1.0;
      bp.gain.value = 0.0;
      delay.gain.value = 0.0;
      comp.threshold.value = -16;
      comp.ratio.value = 6;
    } else {
      // Normal / Cristalino
      bass.gain.value = 0;
      mid.gain.value = 0;
      high.gain.value = 0;
      dry.gain.value = 1.0;
      bp.gain.value = 0.0;
      delay.gain.value = 0.0;
    }
  };

  // Custom audio name management
  const [audioTitle, setAudioTitle] = useState(audio.title || `audio-${audio.id.slice(0, 8)}`);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(audioTitle);

  // Sync state when audio changes
  useEffect(() => {
    const currentName = audio.title || `audio-${audio.id.slice(0, 8)}`;
    setAudioTitle(currentName);
    setTempTitle(currentName);
  }, [audio.id, audio.title]);

  const saveNewTitle = () => {
    const trimmed = tempTitle.trim() || `audio-${audio.id.slice(0, 8)}`;
    setAudioTitle(trimmed);
    setIsEditingTitle(false);
    if (onUpdateTitle) {
      onUpdateTitle(audio.id, trimmed);
    }
  };

  // Sync audio source
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.src = audio.audioUrl;
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.load();
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }, [audio.audioUrl]);

  // Audio event listeners
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onLoadedMetadata = () => {
      if (el.duration && !isNaN(el.duration) && isFinite(el.duration)) {
        setDuration(el.duration);
      }
    };

    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime);
    };

    const onEnded = () => {
      if (isLooping && el) {
        el.currentTime = 0;
        el.play().catch(() => {});
      } else {
        setIsPlaying(false);
      }
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);

    return () => {
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
    };
  }, [isLooping]);

  // Visualizer drawing with real Web Audio FFT frequency spectrum
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const numBars = 48;
    const barWidth = 3;
    const gap = 3;
    const freqData = new Uint8Array(64);

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const progress = duration > 0 ? currentTime / duration : 0;

      if (isPlaying && analyserRef.current) {
        analyserRef.current.getByteFrequencyData(freqData);
      }

      for (let i = 0; i < numBars; i++) {
        const x = i * (barWidth + gap);
        const barProgress = i / numBars;
        const isPast = barProgress <= progress;

        let height = 4;
        if (isPlaying && analyserRef.current) {
          const val = (freqData[i % freqData.length] || 0) / 255;
          height = Math.max(3, Math.min(canvas.height - 2, val * (canvas.height - 4) + 4));
        } else {
          const timeFactor = isPlaying ? Date.now() / 250 : 0;
          const baseHeight = 5 + Math.sin(i * 0.4 + timeFactor) * 6;
          height = Math.max(3, Math.min(canvas.height - 4, baseHeight));
        }

        const y = (canvas.height - height) / 2;

        ctx.fillStyle = isPast
          ? '#ffffff'
          : isPlaying
          ? 'rgba(255, 255, 255, 0.45)'
          : 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(x, y, barWidth, height);
      }

      if (isPlaying) {
        animId = requestAnimationFrame(render);
      }
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, currentTime, duration]);

  // Keyboard Shortcuts (Space: Play/Pause, Arrows: Seek, M: Mute, L: Loop)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isInput =
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          (active as HTMLElement).isContentEditable);
      if (isInput) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        skip(-5);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        skip(5);
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMute();
      } else if (e.key === 'l' || e.key === 'L') {
        setIsLooping((cur) => !cur);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isMuted, volume, duration]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    initDspChain();
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch((err) => console.error(err));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = parseFloat(e.target.value);
    setCurrentTime(targetTime);
    if (audioRef.current) {
      audioRef.current.currentTime = targetTime;
    }
  };

  const skip = (delta: number) => {
    if (!audioRef.current) return;
    const newTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + delta));
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const handleVolumeChange = (val: number) => {
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      audioRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    audioRef.current.muted = nextMuted;
  };

  const mp3Filename = formatFilename(audioTitle, `audio-${audio.id.slice(0, 8)}`, 'mp3');
  const wavFilename = formatFilename(audioTitle, `audio-${audio.id.slice(0, 8)}`, 'wav');

  const downloadMp3 = async () => {
    if (isDownloadingMp3) return;
    try {
      setIsDownloadingMp3(true);
      await downloadAudio(audio, mp3Filename);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (err) {
      console.error('Error downloading MP3:', err);
    } finally {
      setIsDownloadingMp3(false);
    }
  };

  const downloadWav = async () => {
    if (isConvertingWav) return;
    try {
      setIsConvertingWav(true);
      let arrayBuf: ArrayBuffer;
      if (audio.blob) {
        arrayBuf = await audio.blob.arrayBuffer();
      } else {
        const res = await fetch(audio.audioUrl);
        arrayBuf = await res.arrayBuffer();
      }
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedBuffer = await audioCtx.decodeAudioData(arrayBuf);
      const wavBlob = audioBufferToWavBlob(decodedBuffer);
      downloadBlob(wavBlob, wavFilename);
    } catch (err) {
      console.error('Failed to convert to WAV:', err);
      await downloadMp3();
    } finally {
      setIsConvertingWav(false);
    }
  };

  const copyAudioLink = () => {
    const fullUrl = `${window.location.origin}${audio.audioUrl}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-5 space-y-4 shadow-xl">
      <audio ref={audioRef} preload="metadata" />

      {/* Header Info & File Name Customization */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800 pb-3">
        <div className="space-y-1 min-w-0 flex-1">
          {/* Custom File Name Row */}
          <div className="flex items-center gap-2">
            <FileAudio className="h-4 w-4 text-neutral-400 shrink-0" />
            {isEditingTitle ? (
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <input
                  type="text"
                  value={tempTitle}
                  onChange={(e) => setTempTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveNewTitle()}
                  autoFocus
                  placeholder="Nome do arquivo..."
                  className="bg-neutral-800 border border-neutral-700 px-2.5 py-1 text-sm text-white rounded-md focus:outline-none focus:border-white w-full"
                />
                <button
                  type="button"
                  onClick={saveNewTitle}
                  className="px-2.5 py-1 text-xs bg-white text-neutral-950 font-semibold rounded-md hover:bg-neutral-200 transition-colors"
                >
                  Salvar
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 truncate">
                <h4
                  onClick={() => setIsEditingTitle(true)}
                  className="text-sm font-semibold text-white tracking-tight truncate cursor-pointer hover:text-neutral-200 transition-colors"
                  title="Clique para renomear este áudio"
                >
                  {audioTitle}
                </h4>
                <button
                  type="button"
                  onClick={() => setIsEditingTitle(true)}
                  className="p-1 text-neutral-400 hover:text-white rounded transition-colors"
                  title="Renomear nome do arquivo para download"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Clean unboxed metadata with download filename preview */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
            <span>Voz: {audio.voice.name}</span>
            <span aria-hidden="true">·</span>
            <span>{audio.voice.langLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{audio.charCount.toLocaleString('pt-BR')} caracteres</span>
            {audio.sizeBytes && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{formatBytes(audio.sizeBytes)}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="text-emerald-400 font-medium">Salvo localmente</span>
            <span aria-hidden="true">·</span>
            <span className="text-neutral-300 font-mono">
              Arquivo: <span className="text-white underline decoration-neutral-600">{mp3Filename}</span>
            </span>
          </div>
        </div>

        {/* Primary Download Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Puxar Texto de volta para o editor para novas alterações */}
          {onLoadTextToEditor && (
            <button
              type="button"
              onClick={() => onLoadTextToEditor(audio.fullText || audio.textSnippet, audio.title)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-cyan-300 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-800/80 rounded-lg transition-colors cursor-pointer shadow-sm"
              title="Puxar o texto original de volta para o editor para edições e nova geração"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Puxar Texto</span>
            </button>
          )}

          {/* Send to VideoVozLivre */}
          {onSendToVideoEditor && (
            <button
              type="button"
              onClick={() => onSendToVideoEditor(audio)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-violet-950/80 hover:bg-violet-900 border border-violet-700/80 rounded-lg transition-colors cursor-pointer"
              title="Puxar este áudio para o editor de vídeo VideoVozLivre"
            >
              <Film className="h-3.5 w-3.5 text-violet-300" />
              <span>Criar Vídeo</span>
            </button>
          )}

          {/* Download MP3 */}
          <button
            type="button"
            onClick={downloadMp3}
            disabled={isDownloadingMp3}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 active:scale-95 rounded-lg transition-all shadow-sm cursor-pointer disabled:opacity-50"
            title={`Baixar como "${mp3Filename}"`}
          >
            {downloadSuccess ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 stroke-[3]" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>{isDownloadingMp3 ? 'Preparando...' : downloadSuccess ? 'Baixado!' : 'Baixar MP3'}</span>
          </button>

          {/* Download WAV */}
          <button
            type="button"
            onClick={downloadWav}
            disabled={isConvertingWav}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            title={`Baixar como "${wavFilename}"`}
          >
            <Download className="h-3.5 w-3.5" />
            <span>{isConvertingWav ? 'Convertendo...' : 'Baixar WAV'}</span>
          </button>

          {/* Share / Copy link */}
          <button
            type="button"
            onClick={copyAudioLink}
            className="p-1.5 text-neutral-400 hover:text-white bg-neutral-800/80 border border-neutral-700/80 rounded-lg transition-colors cursor-pointer"
            title="Copiar link direto do áudio"
          >
            {copiedLink ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Visualizer & Scrubber Canvas */}
      <div className="flex items-center justify-between gap-4 py-1">
        <canvas
          ref={canvasRef}
          width={288}
          height={32}
          className="w-48 sm:w-64 h-8 shrink-0"
        />

        {/* Progress & Time */}
        <div className="flex-1 flex items-center gap-3">
          <span className="text-xs font-mono text-neutral-400 tabular-nums shrink-0">
            {formatTime(currentTime)}
          </span>

          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-white"
          />

          <span className="text-xs font-mono text-neutral-400 tabular-nums shrink-0">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Main Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {/* Left: Playback buttons */}
        <div className="flex items-center gap-2">
          {/* Skip -10s */}
          <button
            type="button"
            onClick={() => skip(-10)}
            className="p-2 text-neutral-400 hover:text-white rounded-lg transition-colors"
            title="Voltar 10 segundos"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          {/* Main Play/Pause Button */}
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-neutral-950 hover:bg-neutral-200 transition-transform active:scale-95 shadow-md cursor-pointer"
            title={isPlaying ? 'Pausar' : 'Reproduzir'}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5 fill-current" />
            ) : (
              <Play className="h-5 w-5 fill-current ml-0.5" />
            )}
          </button>

          {/* Skip +10s */}
          <button
            type="button"
            onClick={() => skip(10)}
            className="p-2 text-neutral-400 hover:text-white rounded-lg transition-colors"
            title="Avançar 10 segundos"
          >
            <RotateCw className="h-4 w-4" />
          </button>

          {/* Loop / Repeat Toggle */}
          <button
            type="button"
            onClick={() => setIsLooping((cur) => !cur)}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${
              isLooping
                ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-700/80 shadow-sm'
                : 'text-neutral-400 hover:text-white'
            }`}
            title={isLooping ? 'Repetição Contínua Ativada (tecla L)' : 'Repetir Áudio em Loop (tecla L)'}
          >
            <Repeat className="h-4 w-4" />
          </button>
        </div>

        {/* Center: Playback Speed selector */}
        <div className="flex items-center gap-1 bg-neutral-800/80 p-1 rounded-lg border border-neutral-700/60">
          {[0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => handleRateChange(rate)}
              className={`px-2 py-0.5 text-xs font-mono rounded transition-colors ${
                playbackRate === rate
                  ? 'bg-white text-neutral-950 font-bold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>

        {/* Right: Volume slider */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMute}
            className="text-neutral-400 hover:text-white transition-colors"
            title={isMuted ? 'Desmutar' : 'Mutar'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="w-16 sm:w-20 h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-white"
          />
        </div>
      </div>

      {/* Audio DSP Profile / Equalizer Strip */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-800/60 text-xs">
        <span className="text-[11px] text-neutral-400 flex items-center gap-1.5 font-medium shrink-0">
          <Music className="h-3.5 w-3.5 text-cyan-400" />
          <span>Perfil Acústico (DSP):</span>
        </span>

        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
          {[
            { id: 'normal', label: 'Cristalino' },
            { id: 'podcast', label: '🎙️ Rádio Pro' },
            { id: 'cinema', label: '🎬 Grave Cinema' },
            { id: 'vintage', label: '📻 Vintage' },
            { id: 'echo', label: '✨ Eco Suave' },
          ].map((prof) => (
            <button
              key={prof.id}
              type="button"
              onClick={() => applyAudioProfile(prof.id as any)}
              className={`px-2.5 py-1 text-[11px] rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer ${
                audioProfile === prof.id
                  ? 'bg-neutral-200 text-neutral-950 font-bold shadow-sm'
                  : 'bg-neutral-800/80 text-neutral-400 hover:text-white hover:bg-neutral-700'
              }`}
            >
              {prof.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
