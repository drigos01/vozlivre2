import React, { useState, useRef, useEffect } from 'react';
import {
  Film,
  Video,
  Upload,
  Play,
  Pause,
  RotateCcw,
  Download,
  Scissors,
  Repeat,
  Sparkles,
  Check,
  FileAudio,
  Image as ImageIcon,
  Layers,
  ChevronRight,
  Eye,
  Sliders,
  Volume2,
  Maximize2,
  Trash2,
  RefreshCw,
  Zap,
  Activity,
  Move,
  ZoomIn,
  ZoomOut,
  Smartphone,
  Monitor,
  Square,
  Flame,
  ShieldCheck,
  Gauge,
  AlertCircle,
  Crop,
  X,
  Crosshair,
  SlidersHorizontal,
  CheckCircle,
  Music,
  Volume1,
  VolumeX,
  UploadCloud,
  Search,
  FolderOpen,
} from 'lucide-react';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { GeneratedAudio, VideoAspectRatio, VideoClip, FitMode916, VideoTask } from '../types';
import { formatTime, formatBytes, getAudioDuration, formatFilename, downloadBlob, generateSrtFromText } from '../utils/audio';
import {
  saveAudioToDB,
  saveCustomBgMusicToDB,
  getCustomBgMusicFromDB,
} from '../utils/db';
import {
  saveRenderedVideoToDB,
  SerializedEncodedChunk,
  VideoRenderCheckpoint,
  saveRenderCheckpoint,
  getRenderCheckpoint,
  getRenderCheckpointSync,
  getLatestRenderCheckpoint,
  deleteRenderCheckpoint,
  saveActiveVideoSessionState,
  clearActiveVideoSessionState,
} from '../utils/safeguard';
import {
  BG_MUSIC_PRESETS,
  getPresetMusicBuffer,
  mixSpeechWithBackgroundMusic,
  BackgroundMusicTrack,
} from '../utils/backgroundMusic';

interface VideoVozLivreProps {
  currentAudio: GeneratedAudio | null;
  history: GeneratedAudio[];
  onSelectAudio: (audio: GeneratedAudio) => void;
  onNavigateToConverter: () => void;
  onNavigateToIANarrada?: () => void;
  onAudioUploaded?: (audio: GeneratedAudio) => void;
  videoTasks?: VideoTask[];
  onAddVideoTask?: (task: VideoTask) => void;
  onUpdateVideoTask?: (taskId: string, updates: Partial<VideoTask>) => void;
  onOpenTaskManager?: () => void;
  resumeTaskId?: string | null;
  onResumeHandled?: () => void;
}

export type BackgroundMode = 'user' | 'preset';
export type WaveformStyle = 'bars' | 'line' | 'none';
export type WaveformColor = 'white' | 'emerald' | 'cyan' | 'violet' | 'amber';
export type TitlePosition = 'top' | 'center' | 'bottom';
export type MotionEffect =
  | 'none'
  | 'zoom-in'
  | 'zoom-out'
  | 'pulse'
  | 'shake'
  | 'pan-left'
  | 'pan-right'
  | 'float';
export type MotionIntensity = 'subtle' | 'medium' | 'intense';
export type RenderEngine = 'safe' | 'fast';
export type MobileTab = 'preview' | 'media' | 'effects' | 'music' | 'waveform' | 'clips';

export interface MediaCropSettings {
  enabled: boolean;
  zoom: number; // 1.0 (100%) to 3.0 (300%)
  panX: number; // -50% to +50%
  panY: number; // -50% to +50%
  aspectPreset: 'auto' | '16:9' | '9:16' | '1:1' | '4:5' | 'free';
}

const DEFAULT_CROP_SETTINGS: MediaCropSettings = {
  enabled: false,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  aspectPreset: 'auto',
};

// Settings persistence key and interface
const STORAGE_KEY_SETTINGS = 'vozlivre_video_editor_settings_v4';

interface PersistedVideoSettings {
  aspectRatio?: VideoAspectRatio;
  fitMode916?: FitMode916;
  blurIntensity?: number;
  blurDarken?: number;
  blurDropShadow?: boolean;
  showWaveform?: boolean;
  waveformColor?: WaveformColor;
  waveformStyle?: WaveformStyle;
  showTitle?: boolean;
  titlePosition?: TitlePosition;
  motionEffect?: MotionEffect;
  motionIntensity?: MotionIntensity;
  motionIntensityValue?: number; // Continuous slider 10-200%
  selectedPreset?: 'waves' | 'cyber' | 'particles' | 'minimal';
  bgMode?: BackgroundMode;
  clipMode?: '30s' | '60s';
  renderEngine?: RenderEngine;
  cropSettings?: MediaCropSettings;
  cropSettingsByFormat?: Record<VideoAspectRatio, MediaCropSettings>;
  removeWatermark?: boolean;
  showWatermark?: boolean;
  fitMode11?: 'crop' | 'blur_capcut' | 'fit';
  enableBgMusic?: boolean;
  bgMusicTrackId?: string;
  bgMusicVolume?: number; // Continuous slider 0% to 100% (0.0 to 1.0)
}

// Yield control to the browser event loop so UI thread never locks.
// When document is hidden (user switched tabs / minimized app), bypass throttled macrotasks
// and use queueMicrotask so processing continues at maximum GPU speed without stalling!
const yieldToMain = (): Promise<void> => {
  if (typeof document !== 'undefined' && document.hidden) {
    return new Promise((resolve) => queueMicrotask(resolve));
  }

  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
    } else {
      setTimeout(resolve, 0);
    }
  });
};

// Detect Mobile / Touch / Smartphone
const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth <= 768
  );
};

const loadPersistedSettings = (): PersistedVideoSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to load video settings from localStorage:', e);
  }
  return {};
};

const savePersistedSettings = (settings: PersistedVideoSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save video settings to localStorage:', e);
  }
};

export const VideoVozLivre: React.FC<VideoVozLivreProps> = ({
  currentAudio,
  history,
  onSelectAudio,
  onNavigateToConverter,
  onNavigateToIANarrada,
  onAudioUploaded,
  videoTasks,
  onAddVideoTask,
  onUpdateVideoTask,
  onOpenTaskManager,
  resumeTaskId,
  onResumeHandled,
}) => {
  // Mobile detection
  const isMobile = isMobileDevice();

  // Load saved user preferences
  const initialSettings = useRef(loadPersistedSettings()).current;

  // Audio state
  const [selectedAudio, setSelectedAudio] = useState<GeneratedAudio | null>(currentAudio);
  const [audioDuration, setAudioDuration] = useState<number>(currentAudio?.durationSeconds || 0);

  // Audio Library Modal and Upload state
  const [uploadSuccessAudio, setUploadSuccessAudio] = useState<GeneratedAudio | null>(null);
  const [isAudioLibraryModalOpen, setIsAudioLibraryModalOpen] = useState<boolean>(false);
  const [librarySearch, setLibrarySearch] = useState<string>('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'uploaded' | 'generated'>('all');
  const [previewPlayingId, setPreviewPlayingId] = useState<string | null>(null);
  const [isVideoPreviewModalOpen, setIsVideoPreviewModalOpen] = useState<boolean>(false);
  const [renderedVideoToWatch, setRenderedVideoToWatch] = useState<{ url: string; title: string; filename?: string } | null>(null);
  const libraryAudioRef = useRef<HTMLAudioElement | null>(null);
  const modalCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Restore saved custom background music from IndexedDB on mount
  useEffect(() => {
    async function loadSavedCustomMusic() {
      try {
        const saved = await getCustomBgMusicFromDB();
        if (saved && saved.blob) {
          const url = URL.createObjectURL(saved.blob);
          setCustomMusicBlob(saved.blob);
          setCustomMusicUrl(url);
          setCustomMusicName(saved.name);
        }
      } catch (err) {
        console.warn('Erro ao carregar música salva:', err);
      }
    }
    loadSavedCustomMusic();
  }, []);

  // Background Media State (persisted bgMode and selectedPreset)
  const [bgMode, setBgMode] = useState<BackgroundMode>(initialSettings.bgMode || 'preset');
  const [userMediaUrl, setUserMediaUrl] = useState<string | null>(null);
  const [userMediaType, setUserMediaType] = useState<'video' | 'image' | null>(null);
  const [userMediaDuration, setUserMediaDuration] = useState<number>(0);
  const [userMediaFileName, setUserMediaFileName] = useState<string>('');
  const [userMediaWidth, setUserMediaWidth] = useState<number>(1280);
  const [userMediaHeight, setUserMediaHeight] = useState<number>(720);
  const [selectedPreset, setSelectedPreset] = useState<'waves' | 'cyber' | 'particles' | 'minimal'>(
    initialSettings.selectedPreset || 'waves'
  );

  // Video Settings: Default 16:9 as requested, persisted
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(
    initialSettings.aspectRatio || '16:9'
  );

  // Format-specific default crops
  const DEFAULT_FORMAT_CROPS: Record<VideoAspectRatio, MediaCropSettings> = {
    '16:9': { enabled: false, zoom: 1.0, panX: 0, panY: 0, aspectPreset: '16:9' },
    '9:16': { enabled: false, zoom: 1.0, panX: 0, panY: 0, aspectPreset: '9:16' },
    '1:1': { enabled: false, zoom: 1.0, panX: 0, panY: 0, aspectPreset: '1:1' },
    '4:5': { enabled: false, zoom: 1.0, panX: 0, panY: 0, aspectPreset: '4:5' },
    '21:9': { enabled: false, zoom: 1.0, panX: 0, panY: 0, aspectPreset: 'auto' },
  };

  // Crop / Recorte Settings separated independently per format
  const [cropsByFormat, setCropsByFormat] = useState<Record<VideoAspectRatio, MediaCropSettings>>(() => {
    const loaded = initialSettings.cropSettingsByFormat;
    const initial: Record<VideoAspectRatio, MediaCropSettings> = {
      '16:9': { ...DEFAULT_FORMAT_CROPS['16:9'] },
      '9:16': { ...DEFAULT_FORMAT_CROPS['9:16'] },
      '1:1': { ...DEFAULT_FORMAT_CROPS['1:1'] },
      '4:5': { ...DEFAULT_FORMAT_CROPS['4:5'] },
      '21:9': { ...DEFAULT_FORMAT_CROPS['21:9'] },
    };
    if (loaded) {
      if (loaded['16:9']) initial['16:9'] = { ...DEFAULT_FORMAT_CROPS['16:9'], ...loaded['16:9'] };
      if (loaded['9:16']) initial['9:16'] = { ...DEFAULT_FORMAT_CROPS['9:16'], ...loaded['9:16'] };
      if (loaded['1:1']) initial['1:1'] = { ...DEFAULT_FORMAT_CROPS['1:1'], ...loaded['1:1'] };
      if (loaded['4:5']) initial['4:5'] = { ...DEFAULT_FORMAT_CROPS['4:5'], ...loaded['4:5'] };
      if (loaded['21:9']) initial['21:9'] = { ...DEFAULT_FORMAT_CROPS['21:9'], ...loaded['21:9'] };
    } else if (initialSettings.cropSettings) {
      const fmt = initialSettings.aspectRatio || '16:9';
      initial[fmt] = { ...DEFAULT_FORMAT_CROPS[fmt], ...initialSettings.cropSettings };
    }
    return initial;
  });

  // Current active crop for the selected aspect ratio
  const cropSettings: MediaCropSettings =
    cropsByFormat[aspectRatio] || DEFAULT_FORMAT_CROPS[aspectRatio];

  // Helper updater for the current format
  const setCropSettings = (
    updater: MediaCropSettings | ((prev: MediaCropSettings) => MediaCropSettings)
  ) => {
    setCropsByFormat((prevMap) => {
      const current = prevMap[aspectRatio] || DEFAULT_FORMAT_CROPS[aspectRatio];
      const updated = typeof updater === 'function' ? updater(current) : updater;
      return {
        ...prevMap,
        [aspectRatio]: updated,
      };
    });
  };

  // Helper updater for a specific format
  const setFormatCrop = (
    fmt: VideoAspectRatio,
    updater: MediaCropSettings | ((prev: MediaCropSettings) => MediaCropSettings)
  ) => {
    setCropsByFormat((prevMap) => {
      const current = prevMap[fmt] || DEFAULT_FORMAT_CROPS[fmt];
      const updated = typeof updater === 'function' ? updater(current) : updater;
      return {
        ...prevMap,
        [fmt]: updated,
      };
    });
  };

  const [isCropModalOpen, setIsCropModalOpen] = useState<boolean>(false);

  // CapCut Blur settings for 9:16 vertical videos
  const [fitMode916, setFitMode916] = useState<FitMode916>(
    initialSettings.fitMode916 || 'blur_capcut'
  );
  // Fit mode for 1:1 square videos (defaults to 'crop')
  const [fitMode11, setFitMode11] = useState<'crop' | 'blur_capcut' | 'fit'>(
    initialSettings.fitMode11 || 'crop'
  );
  const [blurIntensity, setBlurIntensity] = useState<number>(
    initialSettings.blurIntensity !== undefined ? initialSettings.blurIntensity : 25
  );
  const [blurDarken, setBlurDarken] = useState<number>(
    initialSettings.blurDarken !== undefined ? initialSettings.blurDarken : 0.3
  );
  const [blurDropShadow, setBlurDropShadow] = useState<boolean>(
    initialSettings.blurDropShadow !== undefined ? initialSettings.blurDropShadow : true
  );

  // Watermark removal option (stays saved in localStorage whether active or deactivated)
  const [removeWatermark, setRemoveWatermark] = useState<boolean>(
    initialSettings.removeWatermark !== undefined
      ? initialSettings.removeWatermark
      : initialSettings.showWatermark !== undefined
      ? !initialSettings.showWatermark
      : false
  );

  // Local fallback for video tasks if not provided from parent
  const [localVideoTasks, setLocalVideoTasks] = useState<VideoTask[]>([]);
  const allVideoTasks = videoTasks || localVideoTasks;

  const [showWaveform, setShowWaveform] = useState<boolean>(
    initialSettings.showWaveform !== undefined ? initialSettings.showWaveform : true
  );
  const [waveformColor, setWaveformColor] = useState<WaveformColor>(
    initialSettings.waveformColor || 'cyan'
  );
  const [waveformStyle, setWaveformStyle] = useState<WaveformStyle>(
    initialSettings.waveformStyle || 'bars'
  );

  // Title Settings: Disabled by default as requested, persisted
  const [showTitle, setShowTitle] = useState<boolean>(
    initialSettings.showTitle !== undefined ? initialSettings.showTitle : false
  );
  const [videoTitleText, setVideoTitleText] = useState<string>(
    currentAudio?.title || 'VozLivre Vídeo'
  );
  const [titlePosition, setTitlePosition] = useState<TitlePosition>(
    initialSettings.titlePosition || 'bottom'
  );

  // Motion Effects Settings, persisted
  const [motionEffect, setMotionEffect] = useState<MotionEffect>(
    initialSettings.motionEffect || 'zoom-in'
  );
  // Continuous Motion Intensity Value (10% to 200%)
  const [motionIntensityValue, setMotionIntensityValue] = useState<number>(
    initialSettings.motionIntensityValue !== undefined ? initialSettings.motionIntensityValue : 100
  );

  // Render Engine: 'fast' (GPU hardware acceleration via WebCodecs like CapCut/Kwaicut)
  const [renderEngine, setRenderEngine] = useState<RenderEngine>('fast');

  // Crop Studio View Tab: 'full' (100% of media visible + framing box) or 'result' (final video frame)
  const [cropPreviewTab, setCropPreviewTab] = useState<'full' | 'result'>('full');
  const cropResultCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingCropRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ clientX: number; clientY: number; startPanX: number; startPanY: number }>({
    clientX: 0,
    clientY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  // Clips State, persisted
  const [clipMode, setClipMode] = useState<'30s' | '60s'>(
    initialSettings.clipMode || '30s'
  );
  const [isExportingClipIndex, setIsExportingClipIndex] = useState<number | null>(null);

  // Mobile active tab
  const [mobileTab, setMobileTab] = useState<MobileTab>('media');

  // Background Music state (persisted: enableBgMusic, bgMusicTrackId, bgMusicVolume)
  const [enableBgMusic, setEnableBgMusic] = useState<boolean>(
    initialSettings.enableBgMusic !== undefined ? initialSettings.enableBgMusic : false
  );
  const [bgMusicTrackId, setBgMusicTrackId] = useState<string>(
    initialSettings.bgMusicTrackId || 'lofi'
  );
  // Continuous slider volume 0.00 to 1.00 (default 25% or 0.25)
  const [bgMusicVolume, setBgMusicVolume] = useState<number>(
    initialSettings.bgMusicVolume !== undefined ? initialSettings.bgMusicVolume : 0.25
  );
  const [customMusicUrl, setCustomMusicUrl] = useState<string | null>(null);
  const [customMusicName, setCustomMusicName] = useState<string>('');
  const [customMusicBlob, setCustomMusicBlob] = useState<Blob | null>(null);

  // Playback & Preview State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [previewClipRange, setPreviewClipRange] = useState<{ start: number; end: number } | null>(null);

  // Rendering State
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [renderProgress, setRenderProgress] = useState<number>(0);
  const [renderFps, setRenderFps] = useState<number>(0);
  const [renderedVideoBlob, setRenderedVideoBlob] = useState<Blob | null>(null);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const [renderStatusText, setRenderStatusText] = useState<string>('');
  const [isWorkerActive, setIsWorkerActive] = useState<boolean>(false);

  // References
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const hiddenAudioRef = useRef<HTMLAudioElement>(null);
  const bgMusicAudioRef = useRef<HTMLAudioElement>(null);
  const bgMusicFileInputRef = useRef<HTMLInputElement>(null);
  const hiddenImageRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioDataRef = useRef<any>(null);
  const cancelRenderRef = useRef<boolean>(false);
  const renderWorkerRef = useRef<Worker | null>(null);
  const tickerWorkerRef = useRef<Worker | null>(null);
  const renderProgressRef = useRef<number>(0);
  const renderStatusRef = useRef<string>('');
  const isRenderingRef = useRef<boolean>(false);
  const videoQueueRef = useRef<{ taskId: string; clipSegment?: VideoClip }[]>([]);
  const isQueueProcessingRef = useRef<boolean>(false);
  const activeRenderTaskIdRef = useRef<string | null>(null);
  const [resumableTaskInfo, setResumableTaskInfo] = useState<{
    taskId: string;
    title: string;
    progressPercent: number;
    lastCompletedFrame: number;
    totalFrames: number;
    clipSegment?: VideoClip;
    reason?: string;
  } | null>(null);

  // High-performance texture & audio buffer cache (eliminates re-decoding lag across multiple videos/clips)
  const cachedVideoUrlRef = useRef<string | null>(null);
  const cachedVideoFramesRef = useRef<ImageBitmap[]>([]);
  const cachedAudioUrlRef = useRef<string | null>(null);
  const cachedDecodedAudioRef = useRef<AudioBuffer | null>(null);

  // Clear texture cache if user media URL changes
  useEffect(() => {
    cachedVideoUrlRef.current = null;
    cachedVideoFramesRef.current.forEach((b) => {
      try { b.close(); } catch {}
    });
    cachedVideoFramesRef.current = [];
  }, [userMediaUrl]);

  // Clear audio cache if current audio changes
  useEffect(() => {
    cachedAudioUrlRef.current = null;
    cachedDecodedAudioRef.current = null;
  }, [selectedAudio?.id]);

  useEffect(() => {
    isRenderingRef.current = isRendering;
  }, [isRendering]);

  // Synchronize progress and force instant state update when user returns from background tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isRenderingRef.current) {
        setRenderProgress(renderProgressRef.current);
        setRenderStatusText(renderStatusRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Automatically persist user settings on any change (including format-specific crops, watermark & background music)
  useEffect(() => {
    savePersistedSettings({
      aspectRatio,
      fitMode916,
      fitMode11,
      blurIntensity,
      blurDarken,
      blurDropShadow,
      showWaveform,
      waveformColor,
      waveformStyle,
      showTitle,
      titlePosition,
      motionEffect,
      motionIntensityValue,
      selectedPreset,
      bgMode,
      clipMode,
      renderEngine,
      cropSettings,
      cropSettingsByFormat: cropsByFormat,
      removeWatermark,
      showWatermark: !removeWatermark,
      enableBgMusic,
      bgMusicTrackId,
      bgMusicVolume,
    });
  }, [
    aspectRatio,
    fitMode916,
    fitMode11,
    blurIntensity,
    blurDarken,
    blurDropShadow,
    showWaveform,
    waveformColor,
    waveformStyle,
    showTitle,
    titlePosition,
    motionEffect,
    motionIntensityValue,
    selectedPreset,
    bgMode,
    clipMode,
    renderEngine,
    cropSettings,
    cropsByFormat,
    removeWatermark,
    enableBgMusic,
    bgMusicTrackId,
    bgMusicVolume,
  ]);

  // Prepare and synchronize background music audio element
  useEffect(() => {
    let active = true;

    async function setupBgMusic() {
      if (!enableBgMusic) {
        if (bgMusicAudioRef.current) {
          bgMusicAudioRef.current.pause();
        }
        return;
      }

      try {
        if (bgMusicTrackId === 'custom' && customMusicUrl) {
          if (bgMusicAudioRef.current) {
            bgMusicAudioRef.current.src = customMusicUrl;
            bgMusicAudioRef.current.loop = true;
            bgMusicAudioRef.current.volume = Math.max(0, Math.min(1.0, bgMusicVolume));
            if (isPlaying) {
              bgMusicAudioRef.current.play().catch(() => {});
            }
          }
        } else {
          const track = await getPresetMusicBuffer(bgMusicTrackId);
          if (active && bgMusicAudioRef.current) {
            bgMusicAudioRef.current.src = track.url;
            bgMusicAudioRef.current.loop = true;
            bgMusicAudioRef.current.volume = Math.max(0, Math.min(1.0, bgMusicVolume));
            if (isPlaying) {
              bgMusicAudioRef.current.play().catch(() => {});
            }
          }
        }
      } catch (err) {
        console.warn('Erro ao configurar música de fundo:', err);
      }
    }

    setupBgMusic();

    return () => {
      active = false;
    };
  }, [enableBgMusic, bgMusicTrackId, customMusicUrl]);

  // Real-time volume update to background audio element
  useEffect(() => {
    if (bgMusicAudioRef.current) {
      bgMusicAudioRef.current.volume = Math.max(0, Math.min(1.0, bgMusicVolume));
    }
  }, [bgMusicVolume]);

  // Update selected audio when prop changes
  useEffect(() => {
    if (currentAudio) {
      setSelectedAudio(currentAudio);
      setAudioDuration(currentAudio.durationSeconds || 0);
      setVideoTitleText(currentAudio.title || 'VozLivre Vídeo');
    }
  }, [currentAudio]);

  // Dimensions based on aspect ratio
  const getCanvasDimensions = () => {
    switch (aspectRatio) {
      case '9:16':
        return { width: 720, height: 1280 };
      case '1:1':
        return { width: 720, height: 720 };
      case '16:9':
      default:
        return { width: 1280, height: 720 };
    }
  };

  // Audio duration detection from audio element
  const handleAudioLoadedMetadata = () => {
    if (hiddenAudioRef.current && hiddenAudioRef.current.duration) {
      const dur = hiddenAudioRef.current.duration;
      if (!isNaN(dur) && isFinite(dur) && dur > 0) {
        setAudioDuration(dur);
      }
    }
  };

  // Handle User Media File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUserMediaFileName(file.name);
    const objectUrl = URL.createObjectURL(file);

    if (file.type.startsWith('video/')) {
      setUserMediaType('video');
      setUserMediaUrl(objectUrl);
      setBgMode('user');

      const tempVideo = document.createElement('video');
      tempVideo.src = objectUrl;
      tempVideo.onloadedmetadata = () => {
        setUserMediaDuration(tempVideo.duration || 0);
        setUserMediaWidth(tempVideo.videoWidth || 1280);
        setUserMediaHeight(tempVideo.videoHeight || 720);
      };
    } else if (file.type.startsWith('image/')) {
      setUserMediaType('image');
      setUserMediaUrl(objectUrl);
      setUserMediaDuration(0);
      setBgMode('user');

      const tempImg = new Image();
      tempImg.src = objectUrl;
      tempImg.onload = () => {
        setUserMediaWidth(tempImg.naturalWidth || 1280);
        setUserMediaHeight(tempImg.naturalHeight || 720);
      };
    }
  };

  // Handle Custom Audio File Upload
  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const objectUrl = URL.createObjectURL(file);
    const measuredDuration = await getAudioDuration(file);
    const title = file.name.replace(/\.[^/.]+$/, '').trim() || 'Áudio Enviado';
    const audioId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const customAudio: GeneratedAudio = {
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

    // Save permanently to IndexedDB
    try {
      await saveAudioToDB({
        id: audioId,
        title,
        voice: customAudio.voice,
        textSnippet: file.name,
        charCount: 0,
        durationSeconds: measuredDuration,
        createdAt: Date.now(),
        sizeBytes: file.size,
        audioBlob: file,
        isUploaded: true,
      });
    } catch (dbErr) {
      console.error('Failed to save user audio to IndexedDB:', dbErr);
    }

    setSelectedAudio(customAudio);
    setAudioDuration(measuredDuration);
    setVideoTitleText(customAudio.title);
    onSelectAudio(customAudio);
    onAudioUploaded?.(customAudio);

    setUploadSuccessAudio(customAudio);
    setTimeout(() => {
      setUploadSuccessAudio((prev) => (prev?.id === customAudio.id ? null : prev));
    }, 5000);
  };

  // Handle Custom Background Music Upload
  const handleCustomMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const objectUrl = URL.createObjectURL(file);
    setCustomMusicBlob(file);
    setCustomMusicUrl(objectUrl);
    setCustomMusicName(file.name);
    setBgMusicTrackId('custom');
    setEnableBgMusic(true);

    try {
      await saveCustomBgMusicToDB(file, file.name);
    } catch (err) {
      console.warn('Erro ao salvar música personalizada no IndexedDB:', err);
    }
  };

  // Calculate looping count
  const loopCount =
    userMediaType === 'video' && userMediaDuration > 0 && audioDuration > 0
      ? Math.ceil(audioDuration / userMediaDuration)
      : 1;

  // Setup Web Audio Analyser for reactive waveform
  useEffect(() => {
    const audioEl = hiddenAudioRef.current;
    if (!audioEl) return;

    let ctx: AudioContext | null = null;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      const source = ctx.createMediaElementSource(audioEl);
      source.connect(analyser);
      analyser.connect(ctx.destination);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      audioDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
      // Ignore if already connected
    }

    return () => {
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
    };
  }, [selectedAudio?.audioUrl]);

  // Motion Transform Calculator
  const applyMotionTransform = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    w: number,
    h: number,
    time: number,
    effect: MotionEffect,
    intensityVal: number,
    freqData?: any
  ) => {
    if (effect === 'none') return;

    const mult = intensityVal / 100;
    let scale = 1.0;
    let transX = 0;
    let transY = 0;
    let rot = 0;

    if (effect === 'zoom-in') {
      // Continuous sinusoidal breathing motion:
      // Gently zooms in, reaches limit, decelerates smoothly to 0 velocity, and transitions into gradual zoom-out!
      const cycle = (Math.sin(time * 0.00035 - Math.PI / 2) + 1) / 2;
      scale = 1.0 + cycle * 0.15 * mult;
      transX = Math.sin(time * 0.0002) * (w * 0.01) * mult;
    } else if (effect === 'zoom-out') {
      const cycle = (Math.sin(time * 0.00035 - Math.PI / 2) + 1) / 2;
      scale = 1.15 - cycle * 0.15 * mult;
      transX = -Math.sin(time * 0.0002) * (w * 0.01) * mult;
    } else if (effect === 'pulse') {
      let bounce = 0;
      if (freqData && freqData.length > 0) {
        bounce = (freqData[2] / 255) * 0.12;
      } else {
        bounce = (Math.sin(time * 0.003) * 0.5 + 0.5) * 0.06;
      }
      scale = 1.0 + bounce * mult;
    } else if (effect === 'shake') {
      const shakeSpeed = time * 0.015;
      transX = (Math.sin(shakeSpeed * 1.3) * 4 + Math.cos(shakeSpeed * 2.1) * 2) * mult;
      transY = (Math.cos(shakeSpeed * 1.5) * 3 + Math.sin(shakeSpeed * 2.3) * 2) * mult;
      rot = (Math.sin(shakeSpeed * 0.8) * 0.008) * mult;
      scale = 1.05;
    } else if (effect === 'pan-left') {
      // Continuous horizontal sweep with smooth sinusoidal turnaround:
      const cycle = Math.sin(time * 0.0003);
      transX = -cycle * (w * 0.05) * mult;
      scale = 1.08 + (Math.sin(time * 0.0002) * 0.5 + 0.5) * 0.04 * mult;
    } else if (effect === 'pan-right') {
      const cycle = Math.sin(time * 0.0003);
      transX = cycle * (w * 0.05) * mult;
      scale = 1.08 + (Math.sin(time * 0.0002) * 0.5 + 0.5) * 0.04 * mult;
    } else if (effect === 'float') {
      transX = Math.sin(time * 0.0008) * 8 * mult;
      transY = Math.cos(time * 0.0006) * 6 * mult;
      rot = Math.sin(time * 0.0004) * 0.004 * mult;
      scale = 1.06;
    }

    ctx.translate(w / 2 + transX, h / 2 + transY);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h / 2);
  };

  /**
   * Helper: Precise mathematical crop calculation for canvas and preview overlays.
   * Guarantees that the cropped sub-rectangle matches destW / destH aspect ratio
   * with ZERO distortion, zero stretching, and stays bounded within source dimensions.
   */
  const computeCropBox = (
    sourceW: number,
    sourceH: number,
    targetRatio: number,
    zoom: number = 1.0,
    panX: number = 0,
    panY: number = 0
  ) => {
    const safeW = sourceW > 0 ? sourceW : 1280;
    const safeH = sourceH > 0 ? sourceH : 720;
    const safeRatio = targetRatio > 0 ? targetRatio : 16 / 9;

    const sourceRatio = safeW / safeH;
    let baseCropW: number;
    let baseCropH: number;

    if (sourceRatio > safeRatio) {
      // Source is wider than target format: fit height, compute width
      baseCropH = safeH;
      baseCropW = safeH * safeRatio;
    } else {
      // Source is taller than target format: fit width, compute height
      baseCropW = safeW;
      baseCropH = safeW / safeRatio;
    }

    const effectiveZoom = Math.max(1.0, zoom);
    const cropW = baseCropW / effectiveZoom;
    const cropH = baseCropH / effectiveZoom;

    const maxShiftX = (safeW - cropW) / 2;
    const maxShiftY = (safeH - cropH) / 2;

    const offsetX = (panX / 50) * maxShiftX;
    const offsetY = (panY / 50) * maxShiftY;

    const sX = Math.max(0, Math.min(safeW - cropW, (safeW - cropW) / 2 + offsetX));
    const sY = Math.max(0, Math.min(safeH - cropH, (safeH - cropH) / 2 + offsetY));

    return {
      sX,
      sY,
      cropW,
      cropH,
      leftPct: (sX / safeW) * 100,
      topPct: (sY / safeH) * 100,
      widthPct: (cropW / safeW) * 100,
      heightPct: (cropH / safeH) * 100,
    };
  };

  /**
   * Helper: Draw cropped media with precision zoom & pan offsets
   * Allows cropping a specific area/part of the background image or video
   */
  const drawCroppedMedia = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    media: CanvasImageSource,
    sourceW: number,
    sourceH: number,
    destW: number,
    destH: number,
    crop: MediaCropSettings
  ) => {
    if (sourceW <= 0 || sourceH <= 0 || destW <= 0 || destH <= 0) return;

    const targetRatio = destW / destH;
    const { sX, sY, cropW, cropH } = computeCropBox(
      sourceW,
      sourceH,
      targetRatio,
      crop.enabled ? crop.zoom : 1.0,
      crop.enabled ? crop.panX : 0,
      crop.enabled ? crop.panY : 0
    );

    const safeSx = Math.max(0, Math.min(sourceW - 1, sX));
    const safeSy = Math.max(0, Math.min(sourceH - 1, sY));
    const safeCropW = Math.max(1, Math.min(cropW, sourceW - safeSx));
    const safeCropH = Math.max(1, Math.min(cropH, sourceH - safeSy));

    ctx.drawImage(media, safeSx, safeSy, safeCropW, safeCropH, 0, 0, destW, destH);
  };

  /**
   * CapCut Blur Background for 9:16 Vertical Videos (Reels, TikTok, Shorts):
   * Scales the media to cover the full 9:16 canvas with a heavy gaussian blur,
   * then centers the crisp 16:9 media (contain) with drop shadow,
   * filling the top and bottom dark bars with matching blurred video/image!
   */
  const drawMediaWithCapCutBlur = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    media: CanvasImageSource,
    sourceW: number,
    sourceH: number,
    destW: number,
    destH: number,
    blurIntensityVal: number = 25,
    blurDarkenVal: number = 0.3,
    dropShadowVal: boolean = true
  ) => {
    if (sourceW <= 0 || sourceH <= 0 || destW <= 0 || destH <= 0) return;

    // 1. Draw blurred cover background layer
    ctx.save();
    const coverScale = Math.max(destW / sourceW, destH / sourceH) * 1.12;
    const bgW = sourceW * coverScale;
    const bgH = sourceH * coverScale;
    const bgX = (destW - bgW) / 2;
    const bgY = (destH - bgH) / 2;

    try {
      ctx.filter = `blur(${Math.max(8, blurIntensityVal)}px) brightness(0.75)`;
    } catch {}
    ctx.drawImage(media, bgX, bgY, bgW, bgH);
    ctx.restore();

    // Dark overlay over blurred background so central video has high contrast
    if (blurDarkenVal > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${blurDarkenVal})`;
      ctx.fillRect(0, 0, destW, destH);
    }

    // 2. Draw crisp center contain layer (preserves exact 16:9 aspect ratio, zero side cuts)
    const containScale = Math.min(destW / sourceW, destH / sourceH);
    const fgW = Math.round(sourceW * containScale);
    const fgH = Math.round(sourceH * containScale);
    const fgX = Math.round((destW - fgW) / 2);
    const fgY = Math.round((destH - fgH) / 2);

    ctx.save();
    if (dropShadowVal) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
    }
    ctx.drawImage(media, fgX, fgY, fgW, fgH);
    ctx.restore();
  };

  // 1-Click Action: Turn any processed 16:9 video into 9:16 with CapCut Blur
  const handleConvertTo916CapCut = () => {
    setAspectRatio('9:16');
    setFitMode916('blur_capcut');
    if (renderedVideoUrl) {
      setBgMode('user');
      setUserMediaType('video');
      setUserMediaUrl(renderedVideoUrl);
      setUserMediaFileName(`${videoTitleText || 'video'}-16x9.mp4`);
    }
  };

  // Interactive crop drag handlers (mouse + touch) for intuitive framing adjustments
  const handleCropDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    isDraggingCropRef.current = true;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = {
      clientX,
      clientY,
      startPanX: cropSettings.panX,
      startPanY: cropSettings.panY,
    };
  };

  const handleCropDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDraggingCropRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const dx = clientX - dragStartRef.current.clientX;
    const dy = clientY - dragStartRef.current.clientY;

    const panDeltaX = Math.round((dx / 160) * 50);
    const panDeltaY = Math.round((dy / 160) * 50);

    const newPanX = Math.max(-50, Math.min(50, dragStartRef.current.startPanX + panDeltaX));
    const newPanY = Math.max(-50, Math.min(50, dragStartRef.current.startPanY + panDeltaY));

    setCropSettings((prev) => ({
      ...prev,
      enabled: true,
      panX: newPanX,
      panY: newPanY,
    }));
  };

  const handleCropDragEnd = () => {
    isDraggingCropRef.current = false;
  };

  // Render crop framing result preview canvas
  useEffect(() => {
    if (!isCropModalOpen || cropPreviewTab !== 'result') return;
    const canvas = cropResultCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const targetRatio = aspectRatio === '9:16' ? 9 / 16 : aspectRatio === '1:1' ? 1 : 16 / 9;
    const baseWidth = 480;
    const baseHeight = Math.round(baseWidth / targetRatio);

    canvas.width = baseWidth;
    canvas.height = baseHeight;

    const mediaEl = userMediaType === 'video' ? hiddenVideoRef.current : hiddenImageRef.current;
    if (mediaEl) {
      const sw =
        userMediaType === 'video'
          ? hiddenVideoRef.current?.videoWidth || userMediaWidth || 1280
          : hiddenImageRef.current?.naturalWidth || userMediaWidth || 1280;
      const sh =
        userMediaType === 'video'
          ? hiddenVideoRef.current?.videoHeight || userMediaHeight || 720
          : hiddenImageRef.current?.naturalHeight || userMediaHeight || 720;

      drawCroppedMedia(ctx, mediaEl, sw, sh, baseWidth, baseHeight, cropSettings);
    }
  }, [
    isCropModalOpen,
    cropPreviewTab,
    cropSettings,
    aspectRatio,
    userMediaUrl,
    userMediaType,
    userMediaWidth,
    userMediaHeight,
  ]);

  // Main Canvas Rendering Function for live preview
  const drawFrame = (time: number, customFreqData?: any) => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = getCanvasDimensions();
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    // Get reactive audio frequency
    let freqData = customFreqData;
    if (!freqData && analyserRef.current && audioDataRef.current && isPlaying) {
      analyserRef.current.getByteFrequencyData(audioDataRef.current as any);
      freqData = audioDataRef.current;
    }

    // Always draw procedural background as rock-solid base so canvas is NEVER black
    drawProceduralBackground(ctx, width, height, time, selectedPreset);

    // 1. Draw Background with Motion Effect applied
    ctx.save();
    applyMotionTransform(ctx, width, height, time, motionEffect, motionIntensityValue, freqData);

    if (bgMode === 'user' && userMediaUrl) {
      const isBlurCapCut =
        (aspectRatio === '9:16' && fitMode916 === 'blur_capcut' && !cropSettings.enabled) ||
        (aspectRatio === '1:1' && fitMode11 === 'blur_capcut' && !cropSettings.enabled);

      if (userMediaType === 'video' && hiddenVideoRef.current) {
        const video = hiddenVideoRef.current;
        if (video.readyState >= 1 && video.videoWidth > 0) {
          if (isBlurCapCut) {
            drawMediaWithCapCutBlur(
              ctx,
              video,
              video.videoWidth,
              video.videoHeight,
              width,
              height,
              blurIntensity,
              blurDarken,
              blurDropShadow
            );
          } else {
            drawCroppedMedia(
              ctx,
              video,
              video.videoWidth,
              video.videoHeight,
              width,
              height,
              cropSettings
            );
          }
        }
      } else if (userMediaType === 'image' && hiddenImageRef.current) {
        const img = hiddenImageRef.current;
        if (img.complete && img.naturalWidth > 0) {
          if (isBlurCapCut) {
            drawMediaWithCapCutBlur(
              ctx,
              img,
              img.naturalWidth,
              img.naturalHeight,
              width,
              height,
              blurIntensity,
              blurDarken,
              blurDropShadow
            );
          } else {
            drawCroppedMedia(
              ctx,
              img,
              img.naturalWidth,
              img.naturalHeight,
              width,
              height,
              cropSettings
            );
          }
        }
      }
    }
    ctx.restore();

    // 2. Cinematic Vignette Gradient Overlay
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
    gradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.1)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // 3. Waveform Overlay (Only if enabled)
    if (showWaveform) {
      drawWaveformOverlay(ctx, width, height, time, freqData);
    }

    // 4. Title Overlay (Only if enabled)
    if (showTitle && videoTitleText.trim()) {
      drawTitleOverlay(ctx, width, height);
    }

    // 5. Subtle Branding Watermark (Only if not removed by user)
    if (!removeWatermark) {
      ctx.save();
      ctx.font = '500 14px sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.textAlign = 'right';
      ctx.fillText('VozLivre Video', width - 24, height - 24);
      ctx.restore();
    }

    // Mirror to Pop-up Modal Canvas if open
    const modalCanvas = modalCanvasRef.current;
    if (modalCanvas && isVideoPreviewModalOpen) {
      const mctx = modalCanvas.getContext('2d');
      if (mctx) {
        if (modalCanvas.width !== width || modalCanvas.height !== height) {
          modalCanvas.width = width;
          modalCanvas.height = height;
        }
        mctx.drawImage(canvas, 0, 0);
      }
    }
  };

  // Procedural Background Drawings
  const drawProceduralBackground = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    w: number,
    h: number,
    time: number,
    preset: string
  ) => {
    const t = time * 0.0015;

    if (preset === 'cyber') {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#0f051d');
      grad.addColorStop(0.5, '#190a38');
      grad.addColorStop(1, '#050a24');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)';
      ctx.lineWidth = 1.5;
      const step = 45;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + Math.sin(t + x * 0.01) * 30, h);
        ctx.stroke();
      }
    } else if (preset === 'particles') {
      ctx.fillStyle = '#050811';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 40; i++) {
        const px = (Math.sin(i * 99 + t * 0.3) * 0.5 + 0.5) * w;
        const py = (Math.cos(i * 33 + t * 0.2) * 0.5 + 0.5) * h;
        const radius = (Math.sin(i + t) * 0.5 + 0.5) * 4 + 1.5;

        ctx.fillStyle = i % 2 === 0 ? 'rgba(56, 189, 248, 0.4)' : 'rgba(167, 139, 250, 0.35)';
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (preset === 'minimal') {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, Math.max(w, h));
      grad.addColorStop(0, '#1c1c22');
      grad.addColorStop(0.6, '#0f0f12');
      grad.addColorStop(1, '#050507');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#090d16');
      grad.addColorStop(0.5, '#0d1527');
      grad.addColorStop(1, '#05070c');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.lineWidth = 3;
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.strokeStyle =
          j === 0
            ? 'rgba(6, 182, 212, 0.25)'
            : j === 1
            ? 'rgba(59, 130, 246, 0.2)'
            : 'rgba(139, 92, 246, 0.15)';
        for (let x = 0; x < w; x += 15) {
          const y =
            h * 0.5 +
            Math.sin(x * 0.005 + t + j * 1.2) * (h * 0.12) +
            Math.cos(x * 0.008 - t) * 30;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  };

  // Waveform Drawer
  const drawWaveformOverlay = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    w: number,
    h: number,
    time: number,
    freqData?: any
  ) => {
    let colorHex = '#ffffff';
    if (waveformColor === 'emerald') colorHex = '#10b981';
    else if (waveformColor === 'cyan') colorHex = '#06b6d4';
    else if (waveformColor === 'violet') colorHex = '#8b5cf6';
    else if (waveformColor === 'amber') colorHex = '#f59e0b';

    const centerY = titlePosition === 'bottom' && showTitle ? h * 0.65 : h * 0.5;
    const barCount = 36;
    const totalWidth = w * 0.75;
    const startX = (w - totalWidth) / 2;
    const barWidth = (totalWidth / barCount) * 0.65;
    const gap = totalWidth / barCount;

    if (waveformStyle === 'bars') {
      ctx.fillStyle = colorHex;
      for (let i = 0; i < barCount; i++) {
        let amp = 0.2;
        if (freqData && freqData.length > 0) {
          const val = freqData[i % freqData.length] / 255;
          amp = Math.max(0.1, val);
        } else if (isPlaying) {
          amp = 0.2 + Math.abs(Math.sin(time * 0.005 + i * 0.35)) * 0.65;
        } else {
          amp = 0.15 + Math.sin(i * 0.4) * 0.1;
        }

        const barHeight = Math.max(8, amp * (h * 0.18));
        const x = startX + i * gap;
        const y = centerY - barHeight / 2;

        ctx.beginPath();
        if (typeof (ctx as any).roundRect === 'function') {
          (ctx as any).roundRect(x, y, barWidth, barHeight, 4);
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }
    } else if (waveformStyle === 'line') {
      ctx.strokeStyle = colorHex;
      ctx.lineWidth = 4;
      ctx.beginPath();

      for (let i = 0; i < barCount; i++) {
        let amp = 0.1;
        if (freqData && freqData.length > 0) {
          amp = freqData[i % freqData.length] / 255;
        } else if (isPlaying) {
          amp = 0.2 + Math.sin(time * 0.006 + i * 0.4) * 0.5;
        }
        const x = startX + i * gap;
        const y = centerY + Math.sin(i * 0.5) * (amp * 60);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  };

  // Title Drawer
  const drawTitleOverlay = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    w: number,
    h: number
  ) => {
    ctx.save();
    let textY = h * 0.85;
    if (titlePosition === 'top') textY = h * 0.15;
    if (titlePosition === 'center') textY = h * 0.45;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;

    const fontSize = Math.max(22, Math.min(38, Math.floor(w * 0.05)));
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`;

    const maxWidth = w * 0.85;
    const words = videoTitleText.split(' ');
    let line = '';
    const lines: string[] = [];

    for (const word of words) {
      const testLine = line + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line.length > 0) {
        lines.push(line.trim());
        line = word + ' ';
      } else {
        line = testLine;
      }
    }
    if (line.trim()) lines.push(line.trim());

    const lineHeight = fontSize * 1.3;
    const startY = textY - ((lines.length - 1) * lineHeight) / 2;

    lines.forEach((l, idx) => {
      ctx.fillText(l, w / 2, startY + idx * lineHeight);
    });

    ctx.restore();
  };

  // Animation Loop for Canvas Preview
  useEffect(() => {
    let prevTimestamp: number | null = null;

    const renderLoop = (timestamp: number) => {
      if (prevTimestamp === null) prevTimestamp = timestamp;
      const deltaSec = (timestamp - prevTimestamp) / 1000;
      prevTimestamp = timestamp;

      // If playing without speech audio, advance currentTime smoothly
      if (isPlaying && (!selectedAudio || !hiddenAudioRef.current)) {
        setCurrentTime((prev) => {
          const maxDur = userMediaDuration || 30;
          const next = prev + deltaSec;
          return next >= maxDur ? 0 : next;
        });
      }

      drawFrame(timestamp);

      if (previewClipRange && hiddenAudioRef.current) {
        if (hiddenAudioRef.current.currentTime >= previewClipRange.end) {
          hiddenAudioRef.current.pause();
          hiddenAudioRef.current.currentTime = previewClipRange.start;
          setIsPlaying(false);
          setPreviewClipRange(null);
        }
      }

      animFrameIdRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameIdRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [
    bgMode,
    userMediaUrl,
    userMediaType,
    selectedPreset,
    aspectRatio,
    showWaveform,
    waveformColor,
    waveformStyle,
    showTitle,
    videoTitleText,
    titlePosition,
    motionEffect,
    motionIntensityValue,
    isPlaying,
    previewClipRange,
    cropSettings,
    selectedAudio,
    userMediaDuration,
  ]);

  // Video and Background Music loop synchronization with Audio
  const togglePlayPause = () => {
    const audio = hiddenAudioRef.current;
    const video = hiddenVideoRef.current;
    const bgMusic = bgMusicAudioRef.current;

    if (isPlaying) {
      if (audio) audio.pause();
      if (video) video.pause();
      if (bgMusic) bgMusic.pause();
      setIsPlaying(false);
      return;
    }

    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }

    const startMediaPlayback = () => {
      // 1. Play Video background if user video
      if (video && userMediaType === 'video') {
        const curTime = audio && audio.duration ? audio.currentTime : currentTime;
        video.currentTime = curTime % (video.duration || 1);
        video.play().catch((err) => console.warn('Video preview play note:', err));
      }

      // 2. Play Background Music if enabled
      if (enableBgMusic && bgMusic && bgMusicVolume > 0.01) {
        bgMusic.volume = Math.max(0, Math.min(1.0, bgMusicVolume));
        const dur = bgMusic.duration || 16;
        const curTime = audio && audio.duration ? audio.currentTime : currentTime;
        bgMusic.currentTime = curTime % dur;
        bgMusic.play().catch((err) => console.warn('Bg music preview play note:', err));
      }

      setIsPlaying(true);
    };

    if (audio && audio.src && selectedAudio) {
      audio
        .play()
        .then(() => {
          startMediaPlayback();
        })
        .catch((err) => {
          console.warn('Audio play notice, starting video/music anyway:', err);
          startMediaPlayback();
        });
    } else {
      startMediaPlayback();
    }
  };

  // Seek handler
  const handleSeek = (time: number) => {
    const audio = hiddenAudioRef.current;
    const video = hiddenVideoRef.current;

    if (audio) {
      audio.currentTime = time;
      setCurrentTime(time);
    }
    if (video && video.duration) {
      video.currentTime = time % video.duration;
    }
    if (bgMusicAudioRef.current && bgMusicAudioRef.current.duration) {
      bgMusicAudioRef.current.currentTime = time % bgMusicAudioRef.current.duration;
    }
  };

  // Sync current time from audio
  const handleAudioTimeUpdate = () => {
    if (hiddenAudioRef.current) {
      const cur = hiddenAudioRef.current.currentTime;
      setCurrentTime(cur);

      if (hiddenVideoRef.current && hiddenVideoRef.current.duration) {
        const expectedVideoTime = cur % hiddenVideoRef.current.duration;
        if (Math.abs(hiddenVideoRef.current.currentTime - expectedVideoTime) > 0.3) {
          hiddenVideoRef.current.currentTime = expectedVideoTime;
        }
      }
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    if (hiddenVideoRef.current) hiddenVideoRef.current.pause();
    if (bgMusicAudioRef.current) {
      bgMusicAudioRef.current.pause();
      bgMusicAudioRef.current.currentTime = 0;
    }
    setCurrentTime(0);
  };

  const handlePreviewClip = (clip: VideoClip) => {
    const audio = hiddenAudioRef.current;
    const video = hiddenVideoRef.current;
    if (!audio) return;

    setPreviewClipRange({ start: clip.startTime, end: clip.endTime });
    audio.currentTime = clip.startTime;
    if (video && video.duration) {
      video.currentTime = clip.startTime % video.duration;
    }
    if (bgMusicAudioRef.current && bgMusicAudioRef.current.duration) {
      bgMusicAudioRef.current.currentTime = clip.startTime % bgMusicAudioRef.current.duration;
    }
    audio.play().then(() => {
      if (video) video.play().catch(() => {});
      if (enableBgMusic && bgMusicAudioRef.current && bgMusicVolume > 0.01) {
        bgMusicAudioRef.current.volume = bgMusicVolume;
        bgMusicAudioRef.current.play().catch(() => {});
      }
      setIsPlaying(true);
    });
  };

  /**
   * High-Efficiency Background Video Processing Pipeline:
   * - Uses OffscreenCanvas and Web Worker to offload heavy calculations.
   * - Non-blocking micro-task scheduler (yieldToMain) guarantees that the UI NEVER freezes.
   * - Zero memory leaks and smooth background processing.
   */
  const executeSingleRender = async (taskId: string, clipSegment?: VideoClip) => {
    if (!selectedAudio || audioDuration <= 0) return;

    cancelRenderRef.current = false;
    setIsRendering(true);
    setRenderProgress(0);
    setRenderFps(0);
    setRenderStatusText('Iniciando processamento em segundo plano...');
    activeRenderTaskIdRef.current = taskId;
    cancelRenderRef.current = false;

    const existingCheckpoint =
      getRenderCheckpointSync(taskId) || (await getRenderCheckpoint(taskId));
    const initialProgress = existingCheckpoint?.progressPercent || 5;

    if (existingCheckpoint && existingCheckpoint.lastCompletedFrame >= 0) {
      setRenderProgress(initialProgress);
      renderProgressRef.current = initialProgress;
      setRenderStatusText(
        `Retomando renderização exatamente do frame ${existingCheckpoint.lastCompletedFrame + 1}/${existingCheckpoint.totalFrames} (${initialProgress}%)...`
      );
    }

    if (onUpdateVideoTask) {
      onUpdateVideoTask(taskId, {
        status: 'preparing',
        progress: initialProgress,
        statusText:
          existingCheckpoint && existingCheckpoint.lastCompletedFrame >= 0
            ? `Retomando do frame ${existingCheckpoint.lastCompletedFrame + 1}/${existingCheckpoint.totalFrames} (${initialProgress}%)...`
            : 'Preparando texturas com aceleração gráfica...',
      });
    }

    const startTime = clipSegment ? clipSegment.startTime : 0;
    const endTime = clipSegment ? clipSegment.endTime : audioDuration;
    const totalDuration = endTime - startTime;

    const { width, height } = getCanvasDimensions();

    // 1. OffscreenCanvas allocation:
    // When available, OffscreenCanvas renders completely decoupled from the DOM!
    let renderCanvas: OffscreenCanvas | HTMLCanvasElement;
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
    if (hasOffscreen) {
      try {
        renderCanvas = new OffscreenCanvas(width, height);
      } catch {
        renderCanvas = document.createElement('canvas');
        renderCanvas.width = width;
        renderCanvas.height = height;
      }
    } else {
      renderCanvas = document.createElement('canvas');
      renderCanvas.width = width;
      renderCanvas.height = height;
    }

    const ctx = renderCanvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
    }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

    if (!ctx) {
      setIsRendering(false);
      return;
    }

    // 2. Preload image in memory if in image mode
    let preloadedImage: HTMLImageElement | null = null;
    if (bgMode === 'user' && userMediaType === 'image' && userMediaUrl) {
      setRenderStatusText('Carregando imagem em alta resolução...');
      preloadedImage = new Image();
      preloadedImage.crossOrigin = 'anonymous';
      preloadedImage.src = userMediaUrl;
      await new Promise<void>((resolve) => {
        if (preloadedImage!.complete && preloadedImage!.naturalWidth > 0) return resolve();
        preloadedImage!.onload = () => resolve();
        preloadedImage!.onerror = () => resolve();
        setTimeout(resolve, 800);
      });
    }

    // Preload video in memory if in video mode
    let preloadedVideo: HTMLVideoElement | null = null;
    let videoDurationSec = userMediaDuration || 0;

    if (bgMode === 'user' && userMediaType === 'video' && userMediaUrl) {
      setRenderStatusText('Preparando e duplicando vídeo de fundo para reprodução contínua...');
      preloadedVideo = document.createElement('video');
      preloadedVideo.src = userMediaUrl;
      preloadedVideo.muted = true;
      preloadedVideo.loop = true; // Crucial: sets video element to loop continuously
      preloadedVideo.playsInline = true;
      preloadedVideo.crossOrigin = 'anonymous';
      preloadedVideo.preload = 'auto';

      await new Promise<void>((resolve) => {
        if (preloadedVideo!.readyState >= 2 && preloadedVideo!.duration > 0) {
          videoDurationSec = preloadedVideo!.duration;
          return resolve();
        }
        preloadedVideo!.onloadedmetadata = () => {
          if (preloadedVideo!.duration > 0) videoDurationSec = preloadedVideo!.duration;
        };
        preloadedVideo!.onloadeddata = () => {
          if (preloadedVideo!.duration > 0) videoDurationSec = preloadedVideo!.duration;
          resolve();
        };
        preloadedVideo!.onerror = () => resolve();
        setTimeout(resolve, 1200);
      });

      if (!videoDurationSec || isNaN(videoDurationSec) || videoDurationSec <= 0) {
        videoDurationSec = preloadedVideo.duration || userMediaDuration || 10;
      }
    }

    // Check if WebCodecs VideoEncoder and AudioEncoder are available
    const hasWebCodecs =
      typeof window !== 'undefined' &&
      typeof (window as any).VideoEncoder === 'function' &&
      typeof (window as any).VideoFrame === 'function' &&
      typeof (window as any).AudioEncoder === 'function';

    // Fast GPU Engine: enabled by default for maximum rendering speed unless user explicitly chose 'safe'
    const shouldUseSafeEngine = renderEngine === 'safe' || !hasWebCodecs;

    if (!shouldUseSafeEngine) {
      // DEDICATED WEB WORKER RENDERING PIPELINE:
      // Offloads 100% of frame generation, canvas manipulation, audio FFT, and MP4 encoding to a background thread!
      // The UI thread remains completely free and responsive at 60 FPS with zero freezing.
      try {
        let decodedAudio: AudioBuffer | null = null;
        if (cachedAudioUrlRef.current === selectedAudio.audioUrl && cachedDecodedAudioRef.current) {
          decodedAudio = cachedDecodedAudioRef.current;
        } else {
          setRenderStatusText('Decodificando áudio via Web Audio...');
          const audioRes = await fetch(selectedAudio.audioUrl);
          const audioBlob = await audioRes.blob();
          const audioBuf = await audioBlob.arrayBuffer();
          const offlineCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          decodedAudio = await offlineCtx.decodeAudioData(audioBuf);
          offlineCtx.close().catch(() => {});
          cachedAudioUrlRef.current = selectedAudio.audioUrl;
          cachedDecodedAudioRef.current = decodedAudio;
        }

        if (decodedAudio) {
          // Guarantee 44100 Hz stereo audio for universal AAC encoder compliance
          let finalAudio = decodedAudio;
          const targetSampleRate = 44100;
          if (decodedAudio.sampleRate !== 44100 && decodedAudio.sampleRate !== 48000) {
            try {
              const resampleCtx = new OfflineAudioContext(
                2,
                Math.ceil(decodedAudio.duration * targetSampleRate),
                targetSampleRate
              );
              const source = resampleCtx.createBufferSource();
              source.buffer = decodedAudio;
              source.connect(resampleCtx.destination);
              source.start(0);
              finalAudio = await resampleCtx.startRendering();
            } catch (resampleErr) {
              console.warn('Audio resample fallback:', resampleErr);
            }
          }

          // Mix background music into finalAudio if enabled
          if (enableBgMusic && bgMusicVolume > 0.01) {
            setRenderStatusText('Mixando voz e música de fundo no áudio...');
            try {
              let musicBuffer: AudioBuffer | null = null;
              if (bgMusicTrackId === 'custom' && customMusicBlob) {
                const buf = await customMusicBlob.arrayBuffer();
                const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                musicBuffer = await tempCtx.decodeAudioData(buf);
                tempCtx.close().catch(() => {});
              } else {
                const track = await getPresetMusicBuffer(bgMusicTrackId);
                musicBuffer = track.buffer;
              }

              if (musicBuffer) {
                finalAudio = await mixSpeechWithBackgroundMusic(
                  finalAudio,
                  musicBuffer,
                  bgMusicVolume,
                  videoDurationSec || finalAudio.duration
                );
              }
            } catch (mixErr) {
              console.warn('Erro ao mixar música de fundo no áudio:', mixErr);
            }
          }

          // Prepare image bitmap if in image mode
          let imageBitmap: ImageBitmap | undefined;
          if (
            bgMode === 'user' &&
            userMediaType === 'image' &&
            preloadedImage &&
            preloadedImage.complete &&
            preloadedImage.naturalWidth > 0
          ) {
            setRenderStatusText('Transferindo textura gráfica para o Web Worker...');
            imageBitmap = await createImageBitmap(preloadedImage);
          }

          // Prepare video frames if in video mode with seamless continuous duplication/looping
          const videoFrameBitmaps: ImageBitmap[] = [];
          if (
            bgMode === 'user' &&
            userMediaType === 'video' &&
            userMediaUrl
          ) {
            if (cachedVideoUrlRef.current === userMediaUrl && cachedVideoFramesRef.current.length > 0) {
              setRenderStatusText('Reutilizando texturas otimizadas em cache (instantâneo)...');
              for (const cachedBmp of cachedVideoFramesRef.current) {
                try {
                  const clone = await createImageBitmap(cachedBmp);
                  videoFrameBitmaps.push(clone);
                } catch {}
              }
            } else if (preloadedVideo && preloadedVideo.readyState >= 1) {
              setRenderStatusText('Preparando reprodução contínua em tela cheia do vídeo...');
              const dur = Math.max(0.5, videoDurationSec || preloadedVideo.duration || 5);
              // Extract smooth 15fps frames (up to 90 frames) at crisp HD resolution so video plays fluidly in full screen
              const targetFrames = Math.min(90, Math.max(30, Math.round(dur * 15)));
              const step = dur / targetFrames;
              const newlyExtractedBitmaps: ImageBitmap[] = [];

              for (let i = 0; i < targetFrames; i++) {
                if (cancelRenderRef.current) break;
                const targetTime = (i * step) % dur;
                const vid = preloadedVideo as HTMLVideoElement;
                vid.currentTime = targetTime;

                await new Promise<void>((resolve) => {
                  let resolved = false;
                  const onSeek = () => {
                    if (resolved) return;
                    resolved = true;
                    preloadedVideo!.removeEventListener('seeked', onSeek);
                    resolve();
                  };
                  preloadedVideo!.addEventListener('seeked', onSeek, { once: true });
                  setTimeout(onSeek, 85);
                });

                try {
                  const bmp = await createImageBitmap(preloadedVideo, {
                    resizeWidth: Math.min(width, 720),
                    resizeHeight: Math.min(height, 1280),
                    resizeQuality: 'medium',
                  });
                  newlyExtractedBitmaps.push(bmp);
                  const clone = await createImageBitmap(bmp);
                  videoFrameBitmaps.push(clone);
                } catch {
                  // Ignore frame error
                }

                if (i % 5 === 0) {
                  const p = Math.round((i / targetFrames) * 100);
                  setRenderStatusText(`Otimizando texturas de vídeo (${p}%)...`);
                }
              }

              // Always make sure at least one bitmap exists if extraction didn't yield frames
              if (videoFrameBitmaps.length === 0) {
                try {
                  const fallbackBmp = await createImageBitmap(preloadedVideo, {
                    resizeWidth: Math.min(width, 480),
                    resizeHeight: Math.min(height, 854),
                    resizeQuality: 'medium',
                  });
                  newlyExtractedBitmaps.push(fallbackBmp);
                  const clone = await createImageBitmap(fallbackBmp);
                  videoFrameBitmaps.push(clone);
                } catch {}
              }

              cachedVideoUrlRef.current = userMediaUrl;
              cachedVideoFramesRef.current = newlyExtractedBitmaps;
            }
          }

          setIsWorkerActive(true);
          setRenderStatusText('Iniciando Web Worker dedicado em background...');

          const worker = new Worker(
            new URL('../workers/videoRender.worker.ts', import.meta.url),
            { type: 'module' }
          );
          renderWorkerRef.current = worker;

          const ch0 = finalAudio.getChannelData(0);
          const ch1 = finalAudio.numberOfChannels > 1
            ? finalAudio.getChannelData(1)
            : new Float32Array(ch0);

          const totalFramesEst = Math.max(1, Math.ceil(totalDuration * 30));
          const checkpointAudioChunks: SerializedEncodedChunk[] = existingCheckpoint?.audioChunks
            ? [...existingCheckpoint.audioChunks]
            : [];
          const checkpointVideoChunks: SerializedEncodedChunk[] = existingCheckpoint?.videoChunks
            ? [...existingCheckpoint.videoChunks]
            : [];
          let savedAudioDecoderConfig: any = existingCheckpoint?.audioDecoderConfig;
          let savedVideoDecoderConfig: any = existingCheckpoint?.videoDecoderConfig;
          let lastCompletedFrameTracker = existingCheckpoint?.lastCompletedFrame ?? -1;

          const persistWorkerCheckpoint = async (lastFrame: number, errReason?: string) => {
            const pct = Math.min(99, Math.round(((lastFrame + 1) / totalFramesEst) * 100));
            const cp: VideoRenderCheckpoint = {
              taskId,
              studioType: 'video_editor',
              title: clipSegment
                ? `${videoTitleText || selectedAudio.title} (Parte ${clipSegment.index + 1})`
                : `${videoTitleText || selectedAudio.title}`,
              aspectRatio,
              width,
              height,
              fps: 30,
              totalFrames: totalFramesEst,
              lastCompletedFrame: lastFrame,
              progressPercent: pct,
              resumeTimeSec: startTime + (lastFrame + 1) / 30,
              totalDurationSec: totalDuration,
              audioSampleRate: finalAudio.sampleRate,
              audioNumberOfChannels: 2,
              audioChunks: checkpointAudioChunks,
              videoChunks: checkpointVideoChunks,
              videoDecoderConfig: savedVideoDecoderConfig,
              audioDecoderConfig: savedAudioDecoderConfig,
              clipSegment,
              jobSnapshot: {
                audioId: selectedAudio.id,
                clipSegment,
                aspectRatio,
                fitMode916,
              },
              updatedAt: Date.now(),
            };
            await saveRenderCheckpoint(cp);
            saveActiveVideoSessionState({
              taskId,
              audioId: selectedAudio.id,
              title: cp.title,
              aspectRatio,
              fitMode: fitMode916,
              progressPercent: pct,
              startedAt: Date.now(),
              updatedAt: Date.now(),
              studioType: 'video_editor',
              lastCompletedFrame: lastFrame,
              totalFrames: totalFramesEst,
              resumeTimeSec: cp.resumeTimeSec,
              totalDurationSec: totalDuration,
              errorMessage: errReason,
              clipSegment,
            });
          };

          const renderPromise = new Promise<Blob>((resolve, reject) => {
            worker.onmessage = (e) => {
              const { type, payload } = e.data;
              if (type === 'AUDIO_CHECKPOINT') {
                if (payload.audioChunks?.length) {
                  checkpointAudioChunks.length = 0;
                  checkpointAudioChunks.push(...payload.audioChunks);
                }
                if (payload.audioDecoderConfig) {
                  savedAudioDecoderConfig = payload.audioDecoderConfig;
                }
              } else if (type === 'VIDEO_CHECKPOINT') {
                if (payload.videoChunks?.length) {
                  checkpointVideoChunks.push(...payload.videoChunks);
                }
                if (payload.videoDecoderConfig) {
                  savedVideoDecoderConfig = payload.videoDecoderConfig;
                }
                if (typeof payload.lastCompletedFrame === 'number') {
                  lastCompletedFrameTracker = payload.lastCompletedFrame;
                  persistWorkerCheckpoint(payload.lastCompletedFrame).catch(() => {});
                }
              } else if (type === 'PROGRESS') {
                const { percent, fps, currentFrame, totalFrames } = payload;
                if (typeof currentFrame === 'number') {
                  lastCompletedFrameTracker = currentFrame;
                }
                const frameInfo =
                  typeof currentFrame === 'number' && typeof totalFrames === 'number'
                    ? ` · frame ${currentFrame}/${totalFrames}`
                    : '';
                const statusStr = clipSegment
                  ? `Renderizando Parte ${clipSegment.index + 1} em Web Worker GPU (${fps} fps, ${percent}%${frameInfo})...`
                  : `Renderizando em Web Worker GPU (${fps} fps, ${percent}%${frameInfo})...`;

                renderProgressRef.current = percent;
                renderStatusRef.current = statusStr;
                setRenderProgress(percent);
                setRenderFps(fps);
                setRenderStatusText(statusStr);

                if (onUpdateVideoTask) {
                  onUpdateVideoTask(taskId, {
                    status: 'rendering',
                    progress: percent,
                    fps,
                    statusText: statusStr,
                  });
                } else {
                  setLocalVideoTasks((prev) =>
                    prev.map((t) =>
                      t.id === taskId
                        ? { ...t, status: 'rendering', progress: percent, fps, statusText: statusStr }
                        : t
                    )
                  );
                }

                if (typeof document !== 'undefined') {
                  document.title = `(${percent}%) Renderizando... - VideoVozLivre`;
                }
              } else if (type === 'COMPLETE') {
                const { buffer } = payload;
                const finalBlob = new Blob([buffer], { type: 'video/mp4' });
                resolve(finalBlob);
              } else if (type === 'ERROR') {
                const failFrame =
                  typeof payload.lastCompletedFrame === 'number' && payload.lastCompletedFrame >= 0
                    ? payload.lastCompletedFrame
                    : lastCompletedFrameTracker;
                if (failFrame >= 0) {
                  persistWorkerCheckpoint(failFrame, payload.message).catch(() => {});
                  const pct = Math.min(99, Math.round(((failFrame + 1) / totalFramesEst) * 100));
                  setResumableTaskInfo({
                    taskId,
                    title: clipSegment
                      ? `${videoTitleText || selectedAudio.title} (Parte ${clipSegment.index + 1})`
                      : `${videoTitleText || selectedAudio.title}`,
                    progressPercent: pct,
                    lastCompletedFrame: failFrame,
                    totalFrames: totalFramesEst,
                    clipSegment,
                    reason: payload.message,
                  });
                }
                if (onUpdateVideoTask) {
                  onUpdateVideoTask(taskId, {
                    status: 'error',
                    errorMessage: payload.message,
                    statusText:
                      failFrame >= 0
                        ? `Interrompido no frame ${failFrame + 1}/${totalFramesEst} — pronto para retomar`
                        : 'Erro na renderização',
                  });
                }
                reject(new Error(payload.message));
              }
            };

            worker.onerror = (err) => {
              if (lastCompletedFrameTracker >= 0) {
                persistWorkerCheckpoint(lastCompletedFrameTracker, err.message).catch(() => {});
                const pct = Math.min(99, Math.round(((lastCompletedFrameTracker + 1) / totalFramesEst) * 100));
                setResumableTaskInfo({
                  taskId,
                  title: clipSegment
                    ? `${videoTitleText || selectedAudio.title} (Parte ${clipSegment.index + 1})`
                    : `${videoTitleText || selectedAudio.title}`,
                  progressPercent: pct,
                  lastCompletedFrame: lastCompletedFrameTracker,
                  totalFrames: totalFramesEst,
                  clipSegment,
                  reason: err.message || 'Erro no Web Worker',
                });
              }
              if (onUpdateVideoTask) {
                onUpdateVideoTask(taskId, {
                  status: 'error',
                  errorMessage: err.message || 'Erro no Web Worker',
                  statusText:
                    lastCompletedFrameTracker >= 0
                      ? `Interrompido no frame ${lastCompletedFrameTracker + 1}/${totalFramesEst} — pronto para retomar`
                      : 'Erro no Web Worker',
                });
              }
              reject(err);
            };
          });

          const transferables: Transferable[] = [];
          if (imageBitmap) transferables.push(imageBitmap);
          if (videoFrameBitmaps.length > 0) {
            transferables.push(...videoFrameBitmaps);
          }

          worker.postMessage(
            {
              type: 'START_RENDER',
              payload: {
                width,
                height,
                fps: 30,
                totalDuration,
                startTime,
                endTime,
                bgMode,
                userMediaType,
                selectedPreset,
                motionEffect,
                motionIntensityValue,
                cropSettings: {
                  enabled: cropSettings.enabled,
                  zoom: cropSettings.zoom,
                  panX: cropSettings.panX,
                  panY: cropSettings.panY,
                },
                aspectRatio,
                fitMode:
                  aspectRatio === '9:16'
                    ? (cropSettings.enabled ? 'crop' : fitMode916)
                    : (cropSettings.enabled ? 'crop' : (fitMode11 || 'crop')),
                blurIntensity,
                blurDarken,
                dropShadow: blurDropShadow,
                removeWatermark,
                showWatermark: !removeWatermark,
                showWaveform,
                waveformStyle,
                waveformColor,
                showTitle,
                videoTitleText,
                titlePosition,
                audioSampleRate: finalAudio.sampleRate,
                audioChannel0: ch0,
                audioChannel1: ch1,
                imageBitmap,
                videoFrameBitmaps,
                videoDurationSec: Math.max(0.5, videoDurationSec || preloadedVideo?.duration || 5),
                mediaWidth: userMediaWidth,
                mediaHeight: userMediaHeight,
                resumeCheckpoint:
                  existingCheckpoint &&
                  existingCheckpoint.lastCompletedFrame >= 0 &&
                  existingCheckpoint.videoChunks?.length > 0 &&
                  existingCheckpoint.width === width &&
                  existingCheckpoint.height === height
                    ? {
                        lastCompletedFrame: existingCheckpoint.lastCompletedFrame,
                        audioChunks: existingCheckpoint.audioChunks,
                        videoChunks: existingCheckpoint.videoChunks,
                        videoDecoderConfig: existingCheckpoint.videoDecoderConfig,
                        audioDecoderConfig: existingCheckpoint.audioDecoderConfig,
                      }
                    : undefined,
              },
            },
            transferables
          );

          const finalBlob = await renderPromise;
          worker.terminate();
          renderWorkerRef.current = null;
          setIsWorkerActive(false);
          await deleteRenderCheckpoint(taskId);
          clearActiveVideoSessionState();
          setResumableTaskInfo(null);

          // Clean up GPU memory immediately
          videoFrameBitmaps.forEach((b) => {
            try { b.close(); } catch {}
          });
          if (imageBitmap) {
            try { imageBitmap.close(); } catch {}
          }

          const finalUrl = URL.createObjectURL(finalBlob);

          if (onUpdateVideoTask) {
            onUpdateVideoTask(taskId, {
              status: 'completed',
              progress: 100,
              videoBlob: finalBlob,
              videoUrl: finalUrl,
              statusText: 'Vídeo MP4 concluído com sucesso!',
              completedAt: Date.now(),
            });
          } else {
            setLocalVideoTasks((prev) =>
              prev.map((t) =>
                t.id === taskId
                  ? {
                      ...t,
                      status: 'completed',
                      progress: 100,
                      videoBlob: finalBlob,
                      videoUrl: finalUrl,
                      statusText: 'Vídeo MP4 concluído com sucesso!',
                      completedAt: Date.now(),
                    }
                  : t
              )
            );
          }

          if (clipSegment) {
            const filename = `${formatFilename(videoTitleText || 'video')}-parte-${clipSegment.index + 1}.mp4`;
            const a = document.createElement('a');
            a.href = finalUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setIsExportingClipIndex(null);
          } else {
            setRenderedVideoBlob(finalBlob);
            setRenderedVideoUrl(finalUrl);
          }

          // Safeguard: Save permanently to IndexedDB so battery death / accidental exit NEVER loses the video!
          try {
            const saveFilename = clipSegment
              ? `${formatFilename(videoTitleText || 'video')}-parte-${clipSegment.index + 1}.mp4`
              : `${formatFilename(videoTitleText || 'video')}-${aspectRatio === '9:16' ? '9x16' : '16x9'}.mp4`;
            await saveRenderedVideoToDB({
              id: taskId,
              title: clipSegment
                ? `${videoTitleText || selectedAudio.title} (Parte ${clipSegment.index + 1})`
                : `${videoTitleText || selectedAudio.title}`,
              aspectRatio,
              fitMode: fitMode916,
              durationSeconds: clipSegment ? clipSegment.duration : audioDuration,
              sizeBytes: finalBlob.size,
              createdAt: Date.now(),
              videoBlob: finalBlob,
              downloadFilename: saveFilename,
            });
          } catch (safeguardErr) {
            console.warn('Safeguard video auto-save warning:', safeguardErr);
          }

          renderProgressRef.current = 100;
          renderStatusRef.current = 'Vídeo renderizado com sucesso via Web Worker!';
          if (videoQueueRef.current.length <= 1) {
            setIsRendering(false);
          }
          setRenderProgress(100);
          setRenderStatusText('Vídeo renderizado com sucesso via Web Worker!');
          if (typeof document !== 'undefined') {
            document.title = '✅ (100%) Vídeo Concluído! - VideoVozLivre';
            setTimeout(() => {
              document.title = 'VozLivre - Sintetizador de Voz Natural com IA';
            }, 5000);
          }
          return;
        }
      } catch (err: any) {
        if (renderWorkerRef.current) {
          renderWorkerRef.current.terminate();
          renderWorkerRef.current = null;
        }
        setIsWorkerActive(false);
        const cpAfterFail = getRenderCheckpointSync(taskId);
        // If frames were already encoded in WebCodecs or user cancelled, preserve checkpoint so Retomar Renderização resumes from the exact frame instead of restarting from 0 in MediaRecorder!
        if ((cpAfterFail && cpAfterFail.lastCompletedFrame >= 0) || cancelRenderRef.current) {
          setIsRendering(false);
          return;
        }
        console.warn('Web Worker GPU engine failed at frame 0, falling back to safe MediaRecorder:', err);
      }
    }

    // =========================================================================
    // SAFE BACKGROUND STREAM PIPELINE (UNIVERSAL, ZERO LAG, NEVER CRASHES)
    // - Non-blocking frame capture using MediaRecorder + Web Audio
    // - UI thread remains 100% responsive and never freezes
    // - Uses cropSettings & motionIntensityValue seamlessly
    // =========================================================================
    setRenderStatusText('Processando áudio e vídeo em segundo plano...');

    const resumeStartTime: number =
      existingCheckpoint &&
      typeof existingCheckpoint.resumeTimeSec === 'number' &&
      existingCheckpoint.resumeTimeSec > startTime &&
      existingCheckpoint.resumeTimeSec < endTime &&
      existingCheckpoint.mediaRecorderChunks?.length
        ? existingCheckpoint.resumeTimeSec
        : startTime;

    const renderAudio = new Audio(selectedAudio.audioUrl);
    renderAudio.currentTime = resumeStartTime;
    renderAudio.crossOrigin = 'anonymous';

    // Video element setup for natural playback without violent seeking
    let renderVideoEl: HTMLVideoElement | null = null;
    if (bgMode === 'user' && userMediaType === 'video' && userMediaUrl) {
      renderVideoEl = document.createElement('video');
      renderVideoEl.src = userMediaUrl;
      renderVideoEl.muted = true;
      renderVideoEl.loop = true;
      renderVideoEl.playsInline = true;
      renderVideoEl.crossOrigin = 'anonymous';
      renderVideoEl.currentTime = startTime % (userMediaDuration || 1);
      await renderVideoEl.play().catch(() => {});
    }

    const actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (actx.state === 'suspended') {
      await actx.resume().catch(() => {});
    }

    const dest = actx.createMediaStreamDestination();
    const audioSource = actx.createMediaElementSource(renderAudio);
    audioSource.connect(dest);

    let renderBgMusicEl: HTMLAudioElement | null = null;
    if (enableBgMusic && bgMusicVolume > 0.01) {
      try {
        let musicSrc = '';
        if (bgMusicTrackId === 'custom' && customMusicUrl) {
          musicSrc = customMusicUrl;
        } else {
          const track = await getPresetMusicBuffer(bgMusicTrackId);
          musicSrc = track.url;
        }
        if (musicSrc) {
          renderBgMusicEl = new Audio(musicSrc);
          renderBgMusicEl.loop = true;
          renderBgMusicEl.crossOrigin = 'anonymous';
          const musicSource = actx.createMediaElementSource(renderBgMusicEl);
          const musicGain = actx.createGain();
          musicGain.gain.value = bgMusicVolume;
          musicSource.connect(musicGain);
          musicGain.connect(dest);
        }
      } catch (err) {
        console.warn('Erro ao conectar música de fundo na gravação segura:', err);
      }
    }

    // Get capture stream from the canvas
    const streamCanvas = renderCanvas instanceof HTMLCanvasElement
      ? renderCanvas
      : document.createElement('canvas');
    if (!(renderCanvas instanceof HTMLCanvasElement)) {
      streamCanvas.width = width;
      streamCanvas.height = height;
    }

    const streamCanvasCtx = streamCanvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
    });

    const canvasStream = (streamCanvas as any).captureStream
      ? (streamCanvas as any).captureStream(30)
      : null;

    if (!canvasStream) {
      setIsRendering(false);
      setRenderStatusText('Erro: captureStream não suportado neste navegador');
      return;
    }

    const combinedTracks = [
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ];
    const combinedStream = new MediaStream(combinedTracks);

    const mimeTypes = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ];
    let selectedMime = 'video/webm';
    for (const m of mimeTypes) {
      if (MediaRecorder.isTypeSupported(m)) {
        selectedMime = m;
        break;
      }
    }

    const recorder = new MediaRecorder(combinedStream, {
      mimeType: selectedMime,
      videoBitsPerSecond: isMobile ? 3_000_000 : 4_500_000,
    });

    const recordedChunks: Blob[] =
      existingCheckpoint?.mediaRecorderChunks?.length && resumeStartTime > startTime
        ? [...existingCheckpoint.mediaRecorderChunks]
        : [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
        const curAudioTime = renderAudio.currentTime;
        const curElapsed = Math.max(0, curAudioTime - startTime);
        const pct = Math.min(99, Math.floor((curElapsed / Math.max(1, totalDuration)) * 100));
        const curFrame = Math.floor(curElapsed * 30);
        const totalFramesEst = Math.max(1, Math.ceil(totalDuration * 30));
        saveRenderCheckpoint({
          taskId,
          studioType: 'video_editor',
          title: clipSegment
            ? `${videoTitleText || selectedAudio.title} (Parte ${clipSegment.index + 1})`
            : `${videoTitleText || selectedAudio.title}`,
          aspectRatio,
          width,
          height,
          fps: 30,
          totalFrames: totalFramesEst,
          lastCompletedFrame: curFrame,
          progressPercent: pct,
          resumeTimeSec: curAudioTime,
          totalDurationSec: totalDuration,
          audioSampleRate: 44100,
          audioNumberOfChannels: 2,
          audioChunks: [],
          videoChunks: [],
          mediaRecorderChunks: [...recordedChunks],
          mediaRecorderMimeType: selectedMime,
          clipSegment,
          jobSnapshot: {
            audioId: selectedAudio.id,
            clipSegment,
            aspectRatio,
            fitMode916,
          },
          updatedAt: Date.now(),
        }).catch(() => {});
      }
    };

    let renderAnimId: number | null = null;

    // Start background ticker worker to eliminate Chrome background tab throttling (1000ms clamp)
    try {
      const ticker = new Worker(
        new URL('../workers/renderHelper.worker.ts', import.meta.url),
        { type: 'module' }
      );
      tickerWorkerRef.current = ticker;
      ticker.postMessage({ type: 'START_TICKER', intervalMs: 33 });
      ticker.onmessage = (e) => {
        if (e.data?.type === 'TICK' && typeof document !== 'undefined' && document.hidden) {
          loop();
        }
      };
    } catch {
      // Ignore worker failure
    }

    const stopRecording = () => {
      if (tickerWorkerRef.current) {
        tickerWorkerRef.current.postMessage({ type: 'STOP_TICKER' });
        tickerWorkerRef.current.terminate();
        tickerWorkerRef.current = null;
      }
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      if (renderAnimId) {
        cancelAnimationFrame(renderAnimId);
        clearTimeout(renderAnimId);
      }
      renderAudio.pause();
      if (renderVideoEl) renderVideoEl.pause();
      if (renderBgMusicEl) renderBgMusicEl.pause();
      actx.close().catch(() => {});
    };

    recorder.onstop = () => {
      const finalBlob = new Blob(recordedChunks, { type: 'video/mp4' });
      const finalUrl = URL.createObjectURL(finalBlob);

      if (clipSegment) {
        const filename = `${formatFilename(videoTitleText || 'video')}-parte-${clipSegment.index + 1}.mp4`;
        const a = document.createElement('a');
        a.href = finalUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setIsExportingClipIndex(null);
      } else {
        setRenderedVideoBlob(finalBlob);
        setRenderedVideoUrl(finalUrl);
      }

      renderProgressRef.current = 100;
      renderStatusRef.current = 'Renderização concluída com sucesso!';
      setIsRendering(false);
      setRenderProgress(100);
      setRenderStatusText('Renderização concluída com sucesso!');
      if (typeof document !== 'undefined') {
        document.title = '✅ (100%) Vídeo Concluído! - VideoVozLivre';
        setTimeout(() => {
          document.title = 'VozLivre - Sintetizador de Voz Natural com IA';
        }, 5000);
      }
    };

    recorder.start(500);
    await renderAudio.play();
    if (renderBgMusicEl) {
      renderBgMusicEl.currentTime = startTime % (renderBgMusicEl.duration || 16);
      renderBgMusicEl.play().catch(() => {});
    }

    const renderStartTime = performance.now();

    const loop = () => {
      if (cancelRenderRef.current) {
        stopRecording();
        setIsRendering(false);
        return;
      }

      const currentAudioTime = renderAudio.currentTime;
      const elapsed = currentAudioTime - startTime;
      const progress = Math.min(99, Math.floor((elapsed / totalDuration) * 100));
      const remainingSec = Math.max(0, Math.ceil(totalDuration - elapsed));

      const statusText = clipSegment
        ? `Renderizando Parte ${clipSegment.index + 1}: ${remainingSec}s restantes (${progress}%)...`
        : `Processando em segundo plano: ${remainingSec}s restantes (${progress}%)...`;

      renderProgressRef.current = progress;
      renderStatusRef.current = statusText;
      setRenderProgress(progress);
      setRenderStatusText(statusText);

      if (typeof document !== 'undefined') {
        document.title = `(${progress}%) Processando... - VideoVozLivre`;
      }

      const time = performance.now() - renderStartTime;

      // 1. Draw procedural background first as rock-solid base (NEVER black!)
      drawProceduralBackground(ctx, width, height, time, selectedPreset);

      // 2. Draw user media with motion transform and crop
      ctx.save();
      applyMotionTransform(ctx, width, height, time, motionEffect, motionIntensityValue);

      if (bgMode === 'user' && userMediaUrl) {
        const isBlurCapCut =
          (aspectRatio === '9:16' && fitMode916 === 'blur_capcut' && !cropSettings.enabled) ||
          (aspectRatio === '1:1' && fitMode11 === 'blur_capcut' && !cropSettings.enabled);

        if (
          userMediaType === 'video' &&
          renderVideoEl &&
          renderVideoEl.readyState >= 1 &&
          renderVideoEl.videoWidth > 0
        ) {
          // CONTINUOUS DUPLICATION & LOOPING:
          // Keep video element playing and synchronized via modulo duration (never freeze on last frame!)
          const vidDur = Math.max(0.5, videoDurationSec || renderVideoEl.duration || 1);
          const expectedVideoTime = (currentAudioTime - startTime) % vidDur;
          if (renderVideoEl.paused || renderVideoEl.ended) {
            renderVideoEl.currentTime = expectedVideoTime;
            renderVideoEl.play().catch(() => {});
          } else if (Math.abs(renderVideoEl.currentTime - expectedVideoTime) > 0.4) {
            renderVideoEl.currentTime = expectedVideoTime;
          }

          if (isBlurCapCut || (!cropSettings.enabled && (aspectRatio === '9:16' || aspectRatio === '1:1'))) {
            drawMediaWithCapCutBlur(
              ctx,
              renderVideoEl,
              renderVideoEl.videoWidth,
              renderVideoEl.videoHeight,
              width,
              height,
              blurIntensity,
              blurDarken,
              blurDropShadow
            );
          } else {
            drawCroppedMedia(
              ctx,
              renderVideoEl,
              renderVideoEl.videoWidth,
              renderVideoEl.videoHeight,
              width,
              height,
              cropSettings
            );
          }
        } else if (
          userMediaType === 'image' &&
          preloadedImage &&
          preloadedImage.complete &&
          preloadedImage.naturalWidth > 0
        ) {
          if (isBlurCapCut || (!cropSettings.enabled && (aspectRatio === '9:16' || aspectRatio === '1:1'))) {
            drawMediaWithCapCutBlur(
              ctx,
              preloadedImage,
              preloadedImage.naturalWidth,
              preloadedImage.naturalHeight,
              width,
              height,
              blurIntensity,
              blurDarken,
              blurDropShadow
            );
          } else {
            drawCroppedMedia(
              ctx,
              preloadedImage,
              preloadedImage.naturalWidth,
              preloadedImage.naturalHeight,
              width,
              height,
              cropSettings
            );
          }
        }
      }
      ctx.restore();

      // 3. Vignette
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
      grad.addColorStop(0.3, 'rgba(0, 0, 0, 0.1)');
      grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.15)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // 4. Waveform & Title
      if (showWaveform) drawWaveformOverlay(ctx, width, height, time);
      if (showTitle && videoTitleText.trim()) drawTitleOverlay(ctx, width, height);

      // 5. Watermark (Only if not removed by user)
      if (!removeWatermark) {
        ctx.save();
        ctx.font = '500 14px sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.textAlign = 'right';
        ctx.fillText('VozLivre Video', width - 24, height - 24);
        ctx.restore();
      }

      // If renderCanvas was OffscreenCanvas, copy to streamCanvas
      if (streamCanvasCtx && renderCanvas !== streamCanvas) {
        streamCanvasCtx.drawImage(renderCanvas as any, 0, 0);
      }

      if (currentAudioTime >= endTime || renderAudio.ended) {
        stopRecording();
      } else {
        if (typeof document !== 'undefined' && document.hidden) {
          // When hidden, background tickerWorker drives loop() every 33ms without browser clamping!
        } else {
          renderAnimId = requestAnimationFrame(loop);
        }
      }
    };

    renderAnimId = requestAnimationFrame(loop);
  };

  const processNextInQueue = async () => {
    if (isQueueProcessingRef.current) return;
    if (videoQueueRef.current.length === 0) {
      setIsRendering(false);
      setIsWorkerActive(false);
      return;
    }

    isQueueProcessingRef.current = true;
    const currentJob = videoQueueRef.current[0];
    if (!currentJob) {
      isQueueProcessingRef.current = false;
      return;
    }

    try {
      await executeSingleRender(currentJob.taskId, currentJob.clipSegment);
    } catch (err) {
      console.error('Render queue item error:', err);
    } finally {
      // Remove finished or failed task from the queue
      videoQueueRef.current = videoQueueRef.current.filter((j) => j.taskId !== currentJob.taskId);
      isQueueProcessingRef.current = false;
      if (videoQueueRef.current.length > 0) {
        setTimeout(() => {
          processNextInQueue();
        }, 100);
      } else {
        setIsRendering(false);
        setIsWorkerActive(false);
      }
    }
  };

  const renderVideo = (clipSegment?: VideoClip) => {
    if (!selectedAudio || audioDuration <= 0) return;

    const taskId = `vtask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const currentTaskTitle = clipSegment
      ? `${videoTitleText || selectedAudio.title} (Parte ${clipSegment.index + 1})`
      : `${videoTitleText || selectedAudio.title}`;

    const currentFilename = clipSegment
      ? `${formatFilename(videoTitleText || 'video')}-parte-${clipSegment.index + 1}.mp4`
      : `${formatFilename(videoTitleText || 'video')}-${aspectRatio === '9:16' ? '9x16' : '16x9'}.mp4`;

    const isBusy = isQueueProcessingRef.current;

    const newTask: VideoTask = {
      id: taskId,
      title: currentTaskTitle,
      aspectRatio,
      fitMode: fitMode916,
      blurIntensity,
      blurDarken,
      status: isBusy ? 'queued' : 'preparing',
      progress: isBusy ? 0 : 5,
      fps: 0,
      statusText: isBusy
        ? `Na fila (posição ${videoQueueRef.current.length + 1}) - inicia a seguir`
        : 'Preparando texturas com aceleração gráfica...',
      createdAt: Date.now(),
      clipIndex: clipSegment ? clipSegment.index : undefined,
      audioTitle: selectedAudio.title,
      downloadFilename: currentFilename,
    };

    if (onAddVideoTask) {
      onAddVideoTask(newTask);
    } else {
      setLocalVideoTasks((prev) => [newTask, ...prev]);
    }

    videoQueueRef.current.push({ taskId, clipSegment });

    if (!isQueueProcessingRef.current) {
      processNextInQueue();
    }
  };

    const cancelRendering = () => {
    cancelRenderRef.current = true;
    const activeId = activeRenderTaskIdRef.current || videoQueueRef.current[0]?.taskId;
    if (activeId) {
      const cp = getRenderCheckpointSync(activeId);
      const totalEst = cp?.totalFrames || Math.max(1, Math.ceil(audioDuration * 30));
      const lastFrame =
        cp?.lastCompletedFrame !== undefined && cp.lastCompletedFrame >= 0
          ? cp.lastCompletedFrame
          : Math.floor((renderProgressRef.current / 100) * totalEst);
      setResumableTaskInfo({
        taskId: activeId,
        title: cp?.title || videoTitleText || selectedAudio?.title || 'Vídeo',
        progressPercent: cp?.progressPercent || renderProgressRef.current || 10,
        lastCompletedFrame: lastFrame,
        totalFrames: totalEst,
        clipSegment: cp?.clipSegment || videoQueueRef.current[0]?.clipSegment,
        reason: 'Renderização pausada/interrompida pelo usuário',
      });
    }
    if (renderWorkerRef.current) {
      renderWorkerRef.current.terminate();
      renderWorkerRef.current = null;
    }
    if (tickerWorkerRef.current) {
      tickerWorkerRef.current.postMessage({ type: 'STOP_TICKER' });
      tickerWorkerRef.current.terminate();
      tickerWorkerRef.current = null;
    }
    videoQueueRef.current.forEach((job) => {
      const cp = getRenderCheckpointSync(job.taskId);
      const frameNote =
        cp && cp.lastCompletedFrame >= 0
          ? ` (Parou no frame ${cp.lastCompletedFrame + 1}/${cp.totalFrames} · ${cp.progressPercent}%)`
          : '';
      if (onUpdateVideoTask) {
        onUpdateVideoTask(job.taskId, {
          status: 'cancelled',
          statusText: `Interrompido${frameNote} — pronto para retomar de onde parou`,
        });
      }
    });
    videoQueueRef.current = [];
    isQueueProcessingRef.current = false;
    setIsWorkerActive(false);
    setIsRendering(false);
    setRenderStatusText('Renderização interrompida — pronta para retomar do ponto que parou');
  };

  /**
   * Resumes an interrupted or failed video render from the exact checkpoint frame / timestamp
   */
  const resumeVideoRender = async (targetTaskId?: string) => {
    const idToResume = targetTaskId || resumableTaskInfo?.taskId || activeRenderTaskIdRef.current;
    if (!idToResume) {
      renderVideo();
      return;
    }

    const cp = getRenderCheckpointSync(idToResume) || (await getRenderCheckpoint(idToResume));
    const clipSeg = cp?.clipSegment || resumableTaskInfo?.clipSegment;
    const resumePct = cp?.progressPercent || resumableTaskInfo?.progressPercent || 10;

    cancelRenderRef.current = false;
    setResumableTaskInfo(null);
    setIsRendering(true);
    setRenderProgress(resumePct);
    renderProgressRef.current = resumePct;

    const statusMsg =
      cp && cp.lastCompletedFrame >= 0
        ? `Retomando renderização do frame ${cp.lastCompletedFrame + 1}/${cp.totalFrames} (${resumePct}%)...`
        : `Retomando renderização a partir de ${resumePct}%...`;
    setRenderStatusText(statusMsg);

    if (onUpdateVideoTask) {
      onUpdateVideoTask(idToResume, {
        status: 'rendering',
        progress: resumePct,
        statusText: statusMsg,
        errorMessage: undefined,
      });
    } else {
      setLocalVideoTasks((prev) =>
        prev.map((t) =>
          t.id === idToResume
            ? { ...t, status: 'rendering', progress: resumePct, statusText: statusMsg, errorMessage: undefined }
            : t
        )
      );
    }

    if (!videoQueueRef.current.some((j) => j.taskId === idToResume)) {
      videoQueueRef.current.unshift({ taskId: idToResume, clipSegment: clipSeg });
    }

    if (!isQueueProcessingRef.current) {
      processNextInQueue();
    }
  };

  // Check on mount if there is an interrupted video_editor checkpoint in IndexedDB, and handle external resumeTaskId
  useEffect(() => {
    getLatestRenderCheckpoint('video_editor')
      .then((cp) => {
        if (cp && cp.lastCompletedFrame >= 0) {
          setResumableTaskInfo({
            taskId: cp.taskId,
            title: cp.title || 'Vídeo em Progresso',
            progressPercent: cp.progressPercent || 50,
            lastCompletedFrame: cp.lastCompletedFrame,
            totalFrames: cp.totalFrames,
            clipSegment: cp.clipSegment,
            reason: 'Sessão anterior interrompida',
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (resumeTaskId) {
      resumeVideoRender(resumeTaskId);
      if (onResumeHandled) onResumeHandled();
    }
  }, [resumeTaskId]);

  const formatFilename = (name: string) => {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
  };

  const downloadFullVideo = () => {
    if (!renderedVideoUrl) return;
    const filename = `${formatFilename(videoTitleText || 'videovozlivre')}.mp4`;
    const a = document.createElement('a');
    a.href = renderedVideoUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const calculateClips = (): VideoClip[] => {
    const clipLength = clipMode === '30s' ? 30 : 60;
    const total = audioDuration || 0;
    if (total <= 0) return [];

    const clips: VideoClip[] = [];
    let start = 0;
    let idx = 0;

    while (start < total) {
      const end = Math.min(start + clipLength, total);
      const dur = end - start;
      clips.push({
        index: idx,
        startTime: start,
        endTime: end,
        duration: dur,
        label: `Parte ${idx + 1} (${formatTime(start)} - ${formatTime(end)})`,
      });
      start = end;
      idx++;
    }

    return clips;
  };

  const clipsList = calculateClips();

  // Reset crop helper
  const handleResetCrop = () => {
    setCropSettings({
      enabled: false,
      zoom: 1.0,
      panX: 0,
      panY: 0,
      aspectPreset: 'auto',
    });
  };

  return (
    <div className="mx-auto max-w-6xl px-3 sm:px-6 py-4 sm:py-8 space-y-6">
      {/* 
        DOM elements for live preview synchronization:
        Placed inline with tiny size and opacity zero to stay in render tree without freezing hardware decoders.
      */}
      <div
        className="absolute opacity-0 pointer-events-none w-1 h-1 overflow-hidden"
        aria-hidden="true"
      >
        {selectedAudio && (
          <audio
            ref={hiddenAudioRef}
            src={selectedAudio.audioUrl}
            onLoadedMetadata={handleAudioLoadedMetadata}
            onTimeUpdate={handleAudioTimeUpdate}
            onEnded={handleAudioEnded}
            preload="auto"
          />
        )}
        {userMediaType === 'video' && userMediaUrl && (
          <video
            ref={hiddenVideoRef}
            src={userMediaUrl}
            loop
            muted
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth > 0 && v.videoHeight > 0) {
                setUserMediaWidth(v.videoWidth);
                setUserMediaHeight(v.videoHeight);
              }
            }}
          />
        )}
        {userMediaType === 'image' && userMediaUrl && (
          <img
            ref={hiddenImageRef}
            src={userMediaUrl}
            alt="Mídia de Fundo"
            crossOrigin="anonymous"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setUserMediaWidth(img.naturalWidth);
                setUserMediaHeight(img.naturalHeight);
              }
            }}
          />
        )}
        <audio
          ref={bgMusicAudioRef}
          preload="auto"
          loop
          crossOrigin="anonymous"
        />
        <input
          ref={bgMusicFileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleCustomMusicUpload}
        />
      </div>

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-neutral-300" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              VideoVozLivre
            </h1>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 bg-violet-950 text-violet-300 border border-violet-800 rounded">
              Editor Pro
            </span>
          </div>
          <p className="text-xs sm:text-sm text-neutral-400 mt-1 max-w-xl">
            Processamento de vídeo em segundo plano com OffscreenCanvas e Web Workers: duplica o vídeo em loop contínuo com recorte de área e exportação sem travamentos.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="file"
            ref={audioFileInputRef}
            onChange={handleAudioFileUpload}
            accept="audio/mp3,audio/wav,audio/*"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => audioFileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-300 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Enviar Áudio</span>
          </button>

          <button
            type="button"
            onClick={onNavigateToConverter}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer"
          >
            <Volume2 className="h-3.5 w-3.5" />
            <span>Gerar Nova Voz</span>
          </button>
        </div>
      </div>

      {/* Upload confirmation banner */}
      {uploadSuccessAudio && (
        <div className="rounded-xl border border-emerald-800/80 bg-emerald-950/60 p-3.5 flex items-center justify-between text-xs text-emerald-200 shadow-md">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>
              Áudio <strong>"{uploadSuccessAudio.title}"</strong> salvo com sucesso na sua biblioteca local! Pronto para criar seu vídeo.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setUploadSuccessAudio(null)}
            className="text-emerald-400 hover:text-white text-xs cursor-pointer font-medium ml-2"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Source Audio Card */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3.5 sm:p-4">
        {selectedAudio ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <FileAudio className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="text-sm font-semibold text-white tracking-tight truncate max-w-xs sm:max-w-md">
                  {selectedAudio.title}
                </span>
                {selectedAudio.isUploaded ||
                selectedAudio.voice?.id === 'custom-upload' ||
                selectedAudio.voice?.id === 'user-upload' ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                    <UploadCloud className="h-3 w-3" />
                    <span>Áudio Salvo</span>
                  </span>
                ) : (
                  <span className="text-xs text-neutral-400 font-mono">
                    ({selectedAudio.voice.name})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-400 flex-wrap">
                <span>
                  Duração:{' '}
                  <strong className="text-white font-mono">{formatTime(audioDuration)}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>{selectedAudio.voice.langLabel}</span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-400 flex items-center gap-1 font-medium">
                  <Check className="h-3 w-3" />
                  <span>Salvo na Biblioteca</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              {/* Button to open Audio Library Modal */}
              <button
                type="button"
                onClick={() => setIsAudioLibraryModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer shadow-sm"
                title="Abrir biblioteca com todos os áudios salvos"
              >
                <FolderOpen className="h-3.5 w-3.5 text-neutral-300" />
                <span>Biblioteca ({history.length})</span>
              </button>

              {history.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <select
                    value={selectedAudio.id}
                    onChange={(e) => {
                      const found = history.find((h) => h.id === e.target.value);
                      if (found) {
                        onSelectAudio(found);
                        setSelectedAudio(found);
                        setAudioDuration(found.durationSeconds || 0);
                        setVideoTitleText(found.title);
                      }
                    }}
                    className="bg-neutral-800 border border-neutral-700 text-xs text-neutral-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-neutral-500 max-w-[170px] sm:max-w-[200px] truncate"
                    title="Alternar entre áudios salvos"
                  >
                    {history.map((h) => {
                      const isUp =
                        h.isUploaded ||
                        h.voice?.id === 'custom-upload' ||
                        h.voice?.id === 'user-upload';
                      return (
                        <option key={h.id} value={h.id}>
                          {isUp ? '📁 ' : '🎙️ '}
                          {h.title} ({formatTime(h.durationSeconds)})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={() => audioFileInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors cursor-pointer"
                title="Enviar outro áudio do computador"
              >
                <Upload className="h-3 w-3" />
                <span className="hidden sm:inline">+ Enviar</span>
              </button>

              {/* Export SRT Subtitles button */}
              {selectedAudio.textSnippet && (
                <button
                  type="button"
                  onClick={() => {
                    const srt = generateSrtFromText(
                      selectedAudio.textSnippet,
                      audioDuration || selectedAudio.durationSeconds || 10
                    );
                    if (srt) {
                      const srtBlob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
                      const srtName = `${formatFilename(selectedAudio.title || 'legenda')}.srt`;
                      downloadBlob(srtBlob, srtName);
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-cyan-300 hover:text-cyan-200 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-800/80 rounded-lg transition-colors cursor-pointer"
                  title="Exportar arquivo de legenda .SRT sincronizado para YouTube / CapCut / Premiere"
                >
                  <Download className="h-3 w-3" />
                  <span className="hidden sm:inline">Legenda .SRT</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-1 text-xs sm:text-sm">
            <span className="text-neutral-300">
              Nenhum áudio selecionado. Envie um áudio do computador ou escolha da biblioteca.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => audioFileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Enviar Áudio</span>
              </button>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsAudioLibraryModalOpen(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>Ver Salvos ({history.length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={onNavigateToConverter}
                className="text-xs font-medium text-neutral-400 hover:text-white hover:underline cursor-pointer"
              >
                Ir ao Conversor →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick Access Banner to News & Reportage Auto Video */}
      {onNavigateToIANarrada && (
        <div className="rounded-xl border border-red-900/60 bg-gradient-to-r from-red-950/40 via-neutral-900 to-rose-950/30 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-md">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
              <Film className="h-4 w-4" />
            </div>
            <div>
              <span className="font-bold text-white block">Quer criar um vídeo completo a partir de um Link de Notícia?</span>
              <span className="text-neutral-400 text-[11px]">Cole a URL da matéria (G1, BBC, UOL, etc.) e o sistema extrai fotos, vídeos com som silenciado e gera a narração sozinho.</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onNavigateToIANarrada}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold transition-all shadow-sm shrink-0 cursor-pointer self-start sm:self-auto"
          >
            <span>Criar da Matéria ↗</span>
          </button>
        </div>
      )}

      {/* Main Container */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Right Column / Top on Mobile: Interactive Canvas Preview Stage */}
        <div className="lg:col-span-7 space-y-4 lg:order-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/90 p-3 sm:p-4 space-y-3 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-neutral-300" />
                <span>Prévia ao Vivo ({aspectRatio})</span>
                {cropSettings.enabled && (
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-1.5 py-0.5 rounded font-mono">
                    Corte {Math.round(cropSettings.zoom * 100)}%
                  </span>
                )}
              </span>
              <span className="text-xs font-mono text-neutral-300">
                {formatTime(currentTime)} / {formatTime(audioDuration)}
              </span>
            </div>

            {/* Stage Viewport */}
            <div className="relative flex items-center justify-center bg-neutral-950 rounded-lg overflow-hidden border border-neutral-800 h-[260px] sm:h-[340px] md:h-[420px]">
              <canvas
                ref={previewCanvasRef}
                className="max-h-full max-w-full object-contain shadow-inner"
              />
            </div>

            {/* Scrubber & Controls */}
            <div className="space-y-2">
              <input
                type="range"
                min={0}
                max={audioDuration || 100}
                step={0.1}
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-white"
              />

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={togglePlayPause}
                    className="flex h-11 w-11 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-white text-neutral-950 hover:bg-neutral-200 transition-transform active:scale-95 shadow-md cursor-pointer shrink-0"
                    title={isPlaying ? 'Pausar' : 'Reproduzir'}
                  >
                    {isPlaying ? (
                      <Pause className="h-4 w-4 fill-current" />
                    ) : (
                      <Play className="h-4 w-4 fill-current ml-0.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSeek(0)}
                    className="p-2.5 sm:p-2 text-neutral-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                    title="Reiniciar prévia"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>

                  <span className="text-xs text-neutral-400">
                    {isPlaying ? 'Reproduzindo...' : 'Prévia pausada'}
                  </span>
                </div>

                {/* Master Render Button */}
                <button
                  type="button"
                  onClick={() => renderVideo()}
                  disabled={!selectedAudio || audioDuration <= 0}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 active:scale-95 rounded-lg transition-all shadow-md cursor-pointer disabled:opacity-50"
                >
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span>
                    {allVideoTasks.filter((t) => t.status === 'rendering' || t.status === 'preparing').length > 0
                      ? `+ Renderizar Mais um Vídeo Simultâneo (${allVideoTasks.filter((t) => t.status === 'rendering' || t.status === 'preparing').length} ativo)`
                      : 'Renderizar Vídeo (.mp4)'}
                  </span>
                </button>
              </div>
            </div>

            {/* Rendering Progress Card */}
            {(isRendering || allVideoTasks.some((t) => t.status === 'rendering' || t.status === 'preparing')) && (
              <div className="rounded-lg bg-neutral-950 border border-violet-900/40 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-1.5 truncate max-w-[280px]">
                    <Activity className="h-3.5 w-3.5 text-emerald-400 shrink-0 animate-pulse" />
                    <span className="truncate">{renderStatusText}</span>
                  </span>
                  <div className="flex items-center gap-2 font-mono">
                    {renderFps > 0 && (
                      <span className="text-[11px] text-neutral-400 font-mono">({renderFps} FPS)</span>
                    )}
                    <span className="text-emerald-400 font-bold">{renderProgress}%</span>
                  </div>
                </div>
                <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-violet-500 to-emerald-400 h-full transition-all duration-300"
                    style={{ width: `${renderProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between pt-1 text-[11px] text-neutral-400 flex-wrap gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    <span>
                      {allVideoTasks.filter((t) => t.status === 'rendering' || t.status === 'preparing').length} vídeo(s) renderizando em paralelo
                    </span>
                  </span>
                  <div className="flex items-center gap-3">
                    {onOpenTaskManager && (
                      <button
                        type="button"
                        onClick={onOpenTaskManager}
                        className="text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer underline underline-offset-2"
                      >
                        Central de Tarefas →
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={cancelRendering}
                      className="text-rose-400 hover:text-rose-300 font-medium cursor-pointer"
                    >
                      Pausar / Interromper
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Resumable Interrupted Render Banner */}
            {!isRendering && resumableTaskInfo && (
              <div className="rounded-xl bg-amber-950/40 border border-amber-700/70 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                    <RotateCcw className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>
                      Renderização pausada em {resumableTaskInfo.progressPercent}% (Frame{' '}
                      {resumableTaskInfo.lastCompletedFrame + 1} de {resumableTaskInfo.totalFrames})
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-300">
                    Os frames até {resumableTaskInfo.progressPercent}% estão salvos no checkpoint. Clique abaixo para continuar exatamente de onde parou.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => resumeVideoRender(resumableTaskInfo.taskId)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-neutral-950 text-xs font-bold transition-all cursor-pointer shadow-md"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Retomar Renderização ({resumableTaskInfo.progressPercent}%)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      deleteRenderCheckpoint(resumableTaskInfo.taskId).catch(() => {});
                      setResumableTaskInfo(null);
                    }}
                    className="px-2.5 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white text-xs cursor-pointer"
                    title="Descartar checkpoint"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Master Video Download Card */}
          {renderedVideoUrl && (
            <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-4 space-y-3 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-emerald-400 shrink-0" />
                  <h4 className="text-sm font-semibold text-white">Vídeo Renderizado com Sucesso!</h4>
                </div>
                <span className="text-xs font-mono text-neutral-400">
                  {renderedVideoBlob && formatBytes(renderedVideoBlob.size)}
                </span>
              </div>
              <p className="text-xs text-neutral-300">
                Seu vídeo em formato <strong>{aspectRatio}</strong> está pronto com mídia de fundo duplicada em loop, enquadramento recortado e áudio sincronizado.
              </p>
              <div className="flex items-center gap-3 pt-1 flex-wrap">
                <button
                  type="button"
                  onClick={downloadFullVideo}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-neutral-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors cursor-pointer shadow-sm"
                >
                  <Download className="h-4 w-4" />
                  <span>Baixar Vídeo Completo (.mp4)</span>
                </button>

                {aspectRatio === '16:9' && (
                  <button
                    type="button"
                    onClick={handleConvertTo916CapCut}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-violet-200 bg-violet-950/80 hover:bg-violet-900 border border-violet-700/60 rounded-lg transition-colors cursor-pointer shadow-sm"
                    title="Coloca este vídeo 16:9 no centro com fundo desfocado estilo CapCut"
                  >
                    <Smartphone className="h-4 w-4 text-violet-400" />
                    <span>🎬 Converter para 9:16 com Desfoque CapCut</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Section: Clips Generator */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Scissors className="h-4 w-4 text-neutral-300" />
                  <h3 className="text-sm font-semibold text-white">
                    Clips em Partes (Shorts / Reels / TikTok)
                  </h3>
                </div>
                <p className="text-xs text-neutral-400">
                  Corta o vídeo em partes de 30s ou 1min. Baixe apenas a parte específica que você desejar.
                </p>
              </div>

              {renderedVideoUrl && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      clipsList.forEach((clip) => renderVideo(clip));
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-200 bg-violet-950/80 hover:bg-violet-900 border border-violet-700/60 rounded-lg transition-colors cursor-pointer shadow-sm"
                  >
                    <Zap className="h-3.5 w-3.5 text-violet-400" />
                    <span>⚡ Exportar Todos Simultaneamente ({clipsList.length})</span>
                  </button>

                  <div className="flex items-center gap-1 bg-neutral-800 p-0.5 rounded-lg text-xs font-medium border border-neutral-700">
                    <button
                      type="button"
                      onClick={() => setClipMode('30s')}
                      className={`px-3 py-1 rounded-md transition-colors ${
                        clipMode === '30s'
                          ? 'bg-white text-neutral-950 font-semibold'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      30 Segundos
                    </button>
                    <button
                      type="button"
                      onClick={() => setClipMode('60s')}
                      className={`px-3 py-1 rounded-md transition-colors ${
                        clipMode === '60s'
                          ? 'bg-white text-neutral-950 font-semibold'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      1 Minuto (60s)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {!renderedVideoUrl ? (
              <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-5 text-center space-y-2">
                <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-neutral-400">
                  <Film className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-neutral-300">
                  Recurso liberado após renderizar o vídeo
                </h4>
                <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                  Para baixar clips avulsos de forma imediata sem precisar processar o áudio todo novamente, clique em "Renderizar Vídeo (.mp4)" acima.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-neutral-400">
                  Total de partes geradas:{' '}
                  <strong className="text-white">{clipsList.length} clips</strong> (
                  {clipMode === '30s' ? '30s cada' : '60s cada'})
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {clipsList.map((clip) => (
                    <div
                      key={clip.index}
                      className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 flex flex-col justify-between gap-2.5 hover:border-neutral-700 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-white">{clip.label}</span>
                        <span className="text-[11px] font-mono text-neutral-400">
                          {Math.round(clip.duration)}s
                        </span>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handlePreviewClip(clip)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-300 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-md transition-colors cursor-pointer"
                        >
                          <Eye className="h-3 w-3" />
                          <span>Prévia</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setIsExportingClipIndex(clip.index);
                            renderVideo(clip);
                          }}
                          disabled={isRendering}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Download className="h-3 w-3" />
                          <span>
                            {isExportingClipIndex === clip.index ? 'Baixando...' : 'Baixar .mp4'}
                          </span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Left Column / Below Preview on Mobile: Settings & Customization */}
        <div className="lg:col-span-5 space-y-4 lg:order-1">
          {/* Mobile Tabs Bar for clean navigation on small screens */}
          <div className="lg:hidden flex items-center justify-between gap-1 bg-neutral-900/90 p-1 rounded-xl border border-neutral-800 text-xs overflow-x-auto">
            <button
              type="button"
              onClick={() => setMobileTab('media')}
              className={`flex-1 min-h-[38px] px-2 py-1.5 rounded-lg font-medium transition-colors text-center whitespace-nowrap ${
                mobileTab === 'media'
                  ? 'bg-white text-neutral-950 font-semibold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              1. Mídia & Corte
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('effects')}
              className={`flex-1 min-h-[38px] px-2 py-1.5 rounded-lg font-medium transition-colors text-center whitespace-nowrap ${
                mobileTab === 'effects'
                  ? 'bg-white text-neutral-950 font-semibold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              2. Formato
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('music')}
              className={`flex-1 min-h-[38px] px-2 py-1.5 rounded-lg font-medium transition-colors text-center whitespace-nowrap ${
                mobileTab === 'music'
                  ? 'bg-white text-neutral-950 font-semibold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              3. Música
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('waveform')}
              className={`flex-1 min-h-[38px] px-2 py-1.5 rounded-lg font-medium transition-colors text-center whitespace-nowrap ${
                mobileTab === 'waveform'
                  ? 'bg-white text-neutral-950 font-semibold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              4. Onda
            </button>
          </div>

          {/* Section 1: Background Media & Crop */}
          <div
            className={`rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3.5 ${
              mobileTab !== 'media' ? 'hidden lg:block' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Layers className="h-4 w-4 text-neutral-400" />
                <span>Vídeo ou Imagem de Fundo</span>
              </h3>

              <div className="flex items-center gap-1 bg-neutral-800/80 p-0.5 rounded-lg text-xs font-medium border border-neutral-700">
                <button
                  type="button"
                  onClick={() => setBgMode('preset')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    bgMode === 'preset'
                      ? 'bg-white text-neutral-950 font-semibold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Cenários
                </button>
                <button
                  type="button"
                  onClick={() => setBgMode('user')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    bgMode === 'user'
                      ? 'bg-white text-neutral-950 font-semibold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Meu Arquivo
                </button>
              </div>
            </div>

            {bgMode === 'user' ? (
              <div className="space-y-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="video/mp4,video/webm,video/quicktime,video/*,image/png,image/jpeg,image/webp,image/*"
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-neutral-700 hover:border-neutral-500 rounded-xl p-5 text-center cursor-pointer transition-colors bg-neutral-950/40"
                >
                  <Upload className="h-6 w-6 mx-auto text-neutral-400 mb-2" />
                  <p className="text-xs font-medium text-white mb-1 truncate px-2">
                    {userMediaFileName || 'Clique para escolher seu vídeo ou imagem'}
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    MP4, WebM, MOV, JPG, PNG
                  </p>
                </div>

                {userMediaUrl && (
                  <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Crop className="h-4 w-4 text-emerald-400" />
                        <div>
                          <div className="text-xs font-semibold text-white flex items-center gap-2">
                            <span>Recorte de Área</span>
                            <span className="text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 px-1.5 py-0.2 rounded">
                              {aspectRatio}
                            </span>
                          </div>
                          <div className="text-[10px] text-neutral-400">
                            {cropSettings.enabled
                              ? `Corte Ativo no ${aspectRatio}: Zoom ${Math.round(cropSettings.zoom * 100)}%`
                              : `Sem corte no ${aspectRatio} (Enquadramento padrão)`}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="relative inline-flex items-center cursor-pointer" title={`Ativar/Desativar corte no ${aspectRatio}`}>
                          <input
                            type="checkbox"
                            checked={cropSettings.enabled}
                            onChange={(e) => {
                              const enabled = e.target.checked;
                              setCropSettings((prev) => ({ ...prev, enabled }));
                              if (enabled) {
                                if (aspectRatio === '9:16') setFitMode916('crop');
                                if (aspectRatio === '1:1') setFitMode11('crop');
                              } else {
                                if (aspectRatio === '9:16') setFitMode916('blur_capcut');
                                if (aspectRatio === '1:1') setFitMode11('crop');
                              }
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-8 h-4 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>

                        <button
                          type="button"
                          onClick={() => setIsCropModalOpen(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-neutral-950 bg-white hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer"
                        >
                          <Crop className="h-3.5 w-3.5" />
                          <span>{cropSettings.enabled ? 'Editar Corte' : 'Cortar Área'}</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-neutral-800/80 text-[11px] text-neutral-400">
                      {cropSettings.enabled ? (
                        <span>
                          X: {cropSettings.panX}% · Y: {cropSettings.panY}% · Zoom:{' '}
                          {Math.round(cropSettings.zoom * 100)}%
                        </span>
                      ) : (
                        <span className="text-[10px] text-neutral-500">
                          Configuração de corte independente salva para cada formato (16:9, 9:16, 1:1).
                        </span>
                      )}
                      {cropSettings.enabled && (
                        <button
                          type="button"
                          onClick={handleResetCrop}
                          className="text-neutral-400 hover:text-white underline cursor-pointer"
                        >
                          Redefinir
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {userMediaType === 'video' && userMediaDuration > 0 && (
                  <div className="rounded-lg bg-neutral-950 border border-neutral-800 p-3 text-xs space-y-1 text-neutral-300">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                      <Repeat className="h-3.5 w-3.5" />
                      <span>Duplicação em Loop Contínuo</span>
                    </div>
                    <p className="text-neutral-400">
                      Vídeo de <strong className="text-white">{formatTime(userMediaDuration)}</strong> duplicado{' '}
                      <strong className="text-white">{loopCount}x</strong> para preencher o áudio ({formatTime(audioDuration)}).
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'waves', label: 'Ondas Dark', desc: 'Ondas fluidas suaves' },
                  { id: 'cyber', label: 'Cyber Grid', desc: 'Linhas neon rítmicas' },
                  { id: 'particles', label: 'Cosmos', desc: 'Partículas estelares' },
                  { id: 'minimal', label: 'Estúdio Dark', desc: 'Gradiente minimalista' },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedPreset(preset.id as any)}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      selectedPreset === preset.id
                        ? 'border-white bg-neutral-800 text-white shadow-sm'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:border-neutral-700 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-semibold text-white mb-0.5">{preset.label}</div>
                    <div className="text-[10px] text-neutral-500 leading-tight">{preset.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Format & Motion Effects with Intensity Slider */}
          <div
            className={`rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-4 ${
              mobileTab !== 'effects' ? 'hidden lg:block' : ''
            }`}
          >
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Maximize2 className="h-4 w-4 text-neutral-400" />
              <span>Formato & Proporção</span>
            </h3>

            {/* Aspect Ratio Selector: 16:9 default */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: '16:9', label: '16:9', sub: 'Horizontal (YouTube, TV)', icon: Monitor },
                { id: '9:16', label: '9:16', sub: 'Vertical (Shorts, Reels)', icon: Smartphone },
                { id: '1:1', label: '1:1', sub: 'Quadrado (Feed)', icon: Square },
              ].map((fmt) => {
                const IconComponent = fmt.icon;
                return (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setAspectRatio(fmt.id as VideoAspectRatio)}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                      aspectRatio === fmt.id
                        ? 'border-white bg-neutral-800 text-white'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:border-neutral-700 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <IconComponent className="h-3.5 w-3.5" />
                      <span>{fmt.label}</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 leading-tight mt-1">{fmt.sub}</div>
                  </button>
                );
              })}
            </div>

            {/* CapCut Blur Configuration Panel for 9:16 (Shorts / Reels / TikTok) */}
            {aspectRatio === '9:16' && (
              <div className="rounded-xl border border-violet-500/40 bg-gradient-to-b from-violet-950/40 via-neutral-900/80 to-neutral-950 p-3.5 space-y-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-500/20 text-violet-300 font-bold text-xs">
                      ✨
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                        <span>Fundo Desfocado (Estilo CapCut)</span>
                      </h4>
                      <p className="text-[11px] text-neutral-400">
                        Preenche as áreas escuras acima e abaixo com o vídeo desfocado
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-violet-900/60 text-violet-300 border border-violet-700/60 font-mono">
                    9:16
                  </span>
                </div>

                {/* 3 Fit Modes */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setFitMode916('blur_capcut');
                      setFormatCrop('9:16', (prev) => ({ ...prev, enabled: false }));
                    }}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      fitMode916 === 'blur_capcut' && !cropsByFormat['9:16']?.enabled
                        ? 'border-violet-400 bg-violet-900/40 text-white shadow-sm'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-bold text-white flex items-center gap-1">
                      <span>✨ Desfoque</span>
                    </div>
                    <div className="text-[10px] text-violet-300/80 mt-0.5 leading-tight">
                      16:9 completo no centro
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFitMode916('crop');
                      setFormatCrop('9:16', (prev) => ({ ...prev, enabled: true }));
                    }}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      cropsByFormat['9:16']?.enabled || fitMode916 === 'crop'
                        ? 'border-white bg-neutral-800 text-white'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-semibold text-white">🔍 Cortar / Zoom</div>
                    <div className="text-[10px] text-neutral-500 mt-0.5 leading-tight">
                      Corta laterais
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFitMode916('fit');
                      setFormatCrop('9:16', (prev) => ({ ...prev, enabled: false }));
                    }}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      fitMode916 === 'fit' && !cropsByFormat['9:16']?.enabled
                        ? 'border-white bg-neutral-800 text-white'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-semibold text-white">⬛ Barras Escuras</div>
                    <div className="text-[10px] text-neutral-500 mt-0.5 leading-tight">
                      Letterbox clássico
                    </div>
                  </button>
                </div>

                {fitMode916 === 'blur_capcut' && (
                  <div className="space-y-2.5 pt-2 border-t border-neutral-800/80 text-xs">
                    {/* Blur Intensity selector */}
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-400 text-[11px]">Intensidade do Desfoque:</span>
                      <div className="flex items-center gap-1">
                        {[
                          { label: 'Suave', val: 15 },
                          { label: 'CapCut (25px)', val: 25 },
                          { label: 'Intenso', val: 40 },
                        ].map((b) => (
                          <button
                            key={b.val}
                            type="button"
                            onClick={() => setBlurIntensity(b.val)}
                            className={`px-2 py-0.5 text-[10px] rounded border transition-colors cursor-pointer ${
                              blurIntensity === b.val
                                ? 'bg-violet-400 text-neutral-950 font-bold border-violet-400'
                                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
                            }`}
                          >
                            {b.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Darkening Overlay selector */}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-neutral-400">Escurecimento do Fundo:</span>
                      <div className="flex items-center gap-1">
                        {[
                          { label: '20%', val: 0.2 },
                          { label: '30%', val: 0.3 },
                          { label: '45%', val: 0.45 },
                        ].map((d) => (
                          <button
                            key={d.val}
                            type="button"
                            onClick={() => setBlurDarken(d.val)}
                            className={`px-2 py-0.5 text-[10px] rounded border transition-colors cursor-pointer ${
                              blurDarken === d.val
                                ? 'bg-neutral-200 text-neutral-950 font-bold border-neutral-200'
                                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
                            }`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Drop shadow on center video */}
                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <span className="text-neutral-400">Sombra no Vídeo Central:</span>
                      <button
                        type="button"
                        onClick={() => setBlurDropShadow(!blurDropShadow)}
                        className={`px-2.5 py-0.5 text-[10px] rounded border transition-colors cursor-pointer font-medium ${
                          blurDropShadow
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : 'bg-neutral-900 text-neutral-400 border-neutral-800'
                        }`}
                      >
                        {blurDropShadow ? '✓ Sombra Ativa' : 'Desativada'}
                      </button>
                    </div>

                    {renderedVideoUrl && (
                      <button
                        type="button"
                        onClick={handleConvertTo916CapCut}
                        className="w-full mt-1.5 py-1.5 px-3 rounded-lg bg-violet-950 hover:bg-violet-900 border border-violet-700/60 text-violet-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Repeat className="h-3.5 w-3.5 text-violet-400" />
                        <span>Usar vídeo 16:9 processado no centro com desfoque</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 1:1 Square Framing & Crop Configuration Panel */}
            {aspectRatio === '1:1' && (
              <div className="rounded-xl border border-cyan-500/40 bg-gradient-to-b from-cyan-950/40 via-neutral-900/80 to-neutral-950 p-3.5 space-y-3 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/20 text-cyan-300 font-bold text-xs">
                      ⏹️
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                        <span>Enquadramento Quadrado (1:1 Feed)</span>
                      </h4>
                      <p className="text-[11px] text-neutral-400">
                        {cropsByFormat['1:1']?.enabled
                          ? 'Corte 1:1 Ativo: o centro da imagem cobre toda a tela quadrada'
                          : 'Imagem completa sem corte com barras laterais / fundo desfocado'}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-900/60 text-cyan-300 border border-cyan-700/60 font-mono">
                    1:1
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setFitMode11('crop');
                      setFormatCrop('1:1', (prev) => ({ ...prev, enabled: true }));
                    }}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      cropsByFormat['1:1']?.enabled
                        ? 'border-cyan-400 bg-cyan-900/40 text-white shadow-sm'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-bold text-white flex items-center gap-1">
                      <span>🔍 Cortar 1:1</span>
                    </div>
                    <div className="text-[10px] text-cyan-300/80 mt-0.5 leading-tight">
                      Cobre todo o quadrado
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFitMode11('blur_capcut');
                      setFormatCrop('1:1', (prev) => ({ ...prev, enabled: false }));
                    }}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      !cropsByFormat['1:1']?.enabled && fitMode11 === 'blur_capcut'
                        ? 'border-white bg-neutral-800 text-white'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-semibold text-white">✨ Desfoque</div>
                    <div className="text-[10px] text-neutral-400 mt-0.5 leading-tight">
                      Sem cortes nas laterais
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFitMode11('fit');
                      setFormatCrop('1:1', (prev) => ({ ...prev, enabled: false }));
                    }}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      !cropsByFormat['1:1']?.enabled && fitMode11 === 'fit'
                        ? 'border-white bg-neutral-800 text-white'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-semibold text-white">⬛ Barras</div>
                    <div className="text-[10px] text-neutral-400 mt-0.5 leading-tight">
                      Letterbox clássico
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Motion Effects Section with Continuous Intensity Slider */}
            <div className="border-t border-neutral-800 pt-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-semibold text-white">Efeitos de Movimento & Câmera</span>
                </div>
                <span className="text-xs font-mono font-bold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/80">
                  {motionIntensityValue}%
                </span>
              </div>

              {/* Intensity Slider Bar */}
              <div className="space-y-1.5 bg-neutral-950/70 p-3 rounded-lg border border-neutral-800">
                <div className="flex items-center justify-between text-[11px] text-neutral-400">
                  <span className="flex items-center gap-1">
                    <Gauge className="h-3.5 w-3.5 text-amber-400" />
                    <span>Barra de Intensidade do Efeito:</span>
                  </span>
                  <span className="font-semibold text-white">{motionIntensityValue}%</span>
                </div>

                <input
                  type="range"
                  min={10}
                  max={200}
                  step={5}
                  value={motionIntensityValue}
                  onChange={(e) => setMotionIntensityValue(parseInt(e.target.value, 10))}
                  className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                />

                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {[
                    { label: 'Sutil', val: 40 },
                    { label: 'Médio', val: 100 },
                    { label: 'Forte', val: 150 },
                    { label: 'Extremo', val: 200 },
                  ].map((p) => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setMotionIntensityValue(p.val)}
                      className={`py-1 text-[10px] rounded border transition-colors cursor-pointer ${
                        motionIntensityValue === p.val
                          ? 'bg-amber-400 text-neutral-950 font-bold border-amber-400'
                          : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Motion Effect Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'zoom-in', label: 'Zoom In', desc: 'Aproximação suave' },
                  { id: 'zoom-out', label: 'Zoom Out', desc: 'Afastamento lento' },
                  { id: 'pulse', label: 'Pulso / Batida', desc: 'Pulsar dinâmico' },
                  { id: 'shake', label: 'Tremer / Shake', desc: 'Vibração de câmera' },
                  { id: 'pan-left', label: 'Deslizar Esq.', desc: 'Panorâmica contínua' },
                  { id: 'pan-right', label: 'Deslizar Dir.', desc: 'Panorâmica contínua' },
                  { id: 'float', label: 'Flutuação', desc: 'Balanço orgânico' },
                  { id: 'none', label: 'Estático', desc: 'Sem movimento' },
                ].map((eff) => (
                  <button
                    key={eff.id}
                    type="button"
                    onClick={() => setMotionEffect(eff.id as MotionEffect)}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      motionEffect === eff.id
                        ? 'border-white bg-neutral-800 text-white shadow-sm'
                        : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:border-neutral-700 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-semibold">{eff.label}</div>
                    <div className="text-[10px] text-neutral-500 leading-tight mt-0.5">
                      {eff.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Render Engine Selector */}
            <div className="border-t border-neutral-800 pt-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <Zap className="h-4 w-4 text-amber-400" />
                  <span>Velocidade de Renderização & Aceleração</span>
                </div>
                {renderEngine === 'fast' && (
                  <span className="text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded font-semibold flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    <span>Turbo GPU (120-200 FPS)</span>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRenderEngine('fast')}
                  className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                    renderEngine === 'fast'
                      ? 'border-amber-400 bg-amber-950/20 text-white shadow-sm ring-1 ring-amber-400/40'
                      : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    <span>⚡ Turbo GPU (Ultra Rápido)</span>
                  </div>
                  <div className="text-[10px] text-neutral-300 mt-1 leading-tight">
                    Estilo CapCut/Kwaicut: exporta mesmo vídeos longos em até 30s usando WebCodecs em segundo plano.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setRenderEngine('safe')}
                  className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                    renderEngine === 'safe'
                      ? 'border-neutral-600 bg-neutral-900 text-white shadow-sm'
                      : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>🛡️ Modo Compatibilidade (1x)</span>
                  </div>
                  <div className="text-[10px] text-neutral-400 mt-1 leading-tight">
                    Fallback em tempo real para aparelhos muito antigos que não suportam WebCodecs.
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Section: Música de Fundo (Trilha Sonora) & Barra de Volume Persistente */}
          <div
            className={`rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-4 ${
              mobileTab !== 'music' ? 'hidden lg:block' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Music className="h-4 w-4 text-emerald-400" />
                <span>Música de Fundo (Trilha Sonora)</span>
              </h3>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableBgMusic}
                  onChange={(e) => setEnableBgMusic(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>

            <p className="text-xs text-neutral-400">
              Adicione uma música suave de fundo para dar emoção ao seu vídeo. O volume configurado fica salvo automaticamente para seus próximos vídeos.
            </p>

            {enableBgMusic && (
              <div className="space-y-4 pt-1">
                {/* Volume Slider Bar with Persistent Value */}
                <div className="space-y-2 bg-neutral-950/80 p-3.5 rounded-xl border border-neutral-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {bgMusicVolume === 0 ? (
                        <VolumeX className="h-4 w-4 text-neutral-500" />
                      ) : bgMusicVolume < 0.4 ? (
                        <Volume1 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Volume2 className="h-4 w-4 text-emerald-400" />
                      )}
                      <span className="text-xs font-semibold text-white">
                        Barra de Volume da Música de Fundo:
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded">
                      {Math.round(bgMusicVolume * 100)}%
                    </span>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(bgMusicVolume * 100)}
                    onChange={(e) => {
                      const newVol = parseInt(e.target.value, 10) / 100;
                      setBgMusicVolume(newVol);
                      if (bgMusicAudioRef.current) {
                        bgMusicAudioRef.current.volume = newVol;
                      }
                    }}
                    className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                  />

                  <div className="flex items-center justify-between text-[11px] text-neutral-400 pt-0.5">
                    <span>Mudo (0%)</span>
                    <span className="text-emerald-300 font-medium">Recomendado (15% - 30%)</span>
                    <span>Máximo (100%)</span>
                  </div>

                  <p className="text-[11px] text-neutral-400 bg-neutral-900/60 p-2 rounded-lg border border-neutral-800/80 flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span>
                      A voz principal permanece em <strong>100%</strong> e a música em{' '}
                      <strong>{Math.round(bgMusicVolume * 100)}%</strong>. Essa configuração de volume fica salva automaticamente.
                    </span>
                  </p>
                </div>

                {/* Preset Tracks */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-300">Escolha a Trilha Sonora:</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {BG_MUSIC_PRESETS.map((track) => (
                      <button
                        key={track.id}
                        type="button"
                        onClick={() => setBgMusicTrackId(track.id)}
                        className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                          bgMusicTrackId === track.id
                            ? 'border-emerald-500 bg-emerald-950/40 text-white shadow-sm ring-1 ring-emerald-500/50'
                            : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:border-neutral-700 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-semibold text-white">{track.name}</span>
                          <span className="text-[10px] font-mono text-emerald-400">{track.bpm} BPM</span>
                        </div>
                        <div className="text-[10px] text-neutral-500 leading-tight">{track.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Track Upload */}
                <div className="space-y-2 border-t border-neutral-800/80 pt-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-neutral-300">Ou envie sua própria música:</label>
                    <button
                      type="button"
                      onClick={() => bgMusicFileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-lg transition-colors cursor-pointer"
                    >
                      <Upload className="h-3 w-3" />
                      <span>{customMusicName ? 'Substituir Música' : 'Enviar Áudio (MP3/WAV)'}</span>
                    </button>
                  </div>

                  {customMusicName && (
                    <div
                      onClick={() => setBgMusicTrackId('custom')}
                      className={`p-2.5 rounded-lg border flex items-center justify-between cursor-pointer ${
                        bgMusicTrackId === 'custom'
                          ? 'border-emerald-500 bg-emerald-950/40 text-white ring-1 ring-emerald-500/50'
                          : 'border-neutral-800 bg-neutral-950/60 text-neutral-400 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileAudio className="h-4 w-4 text-emerald-400 shrink-0" />
                        <div className="truncate">
                          <div className="text-xs font-semibold text-white truncate">{customMusicName}</div>
                          <div className="text-[10px] text-emerald-400">Música personalizada selecionada</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                        Ativa
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Visualizer & Title Overlay */}
          <div
            className={`rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-4 ${
              mobileTab !== 'waveform' ? 'hidden lg:block' : ''
            }`}
          >
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sliders className="h-4 w-4 text-neutral-400" />
              <span>Onda Sonora & Título</span>
            </h3>

            {/* Waveform Options */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-300">Exibir Ondas Sonoras</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showWaveform}
                    onChange={(e) => setShowWaveform(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              {showWaveform && (
                <div className="space-y-3 pt-2">
                  <div className="space-y-1.5">
                    <label className="text-xs text-neutral-400">Estilo da Onda:</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setWaveformStyle('bars')}
                        className={`p-2 text-xs rounded-lg border text-center transition-colors cursor-pointer ${
                          waveformStyle === 'bars'
                            ? 'border-white bg-neutral-800 text-white font-semibold'
                            : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-white'
                        }`}
                      >
                        Barras Dinâmicas
                      </button>
                      <button
                        type="button"
                        onClick={() => setWaveformStyle('line')}
                        className={`p-2 text-xs rounded-lg border text-center transition-colors cursor-pointer ${
                          waveformStyle === 'line'
                            ? 'border-white bg-neutral-800 text-white font-semibold'
                            : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-white'
                        }`}
                      >
                        Linha Contínua
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-neutral-400">Cor do Espectro:</label>
                    <div className="flex items-center gap-2">
                      {[
                        { id: 'cyan', label: 'Ciano', bg: 'bg-cyan-500' },
                        { id: 'emerald', label: 'Esmeralda', bg: 'bg-emerald-500' },
                        { id: 'violet', label: 'Violeta', bg: 'bg-purple-500' },
                        { id: 'amber', label: 'Âmbar', bg: 'bg-amber-500' },
                        { id: 'white', label: 'Branco', bg: 'bg-white' },
                      ].map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setWaveformColor(c.id as WaveformColor)}
                          className={`h-7 w-7 rounded-full flex items-center justify-center transition-transform cursor-pointer ${
                            c.bg
                          } ${waveformColor === c.id ? 'ring-2 ring-white ring-offset-2 ring-offset-neutral-950 scale-110' : 'opacity-70 hover:opacity-100'}`}
                          title={c.label}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Title Overlay Options */}
            <div className="border-t border-neutral-800 pt-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-300">Título na Tela</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showTitle}
                    onChange={(e) => setShowTitle(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              {showTitle && (
                <div className="space-y-3 pt-2">
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-400">Texto do Título:</label>
                    <input
                      type="text"
                      value={videoTitleText}
                      onChange={(e) => setVideoTitleText(e.target.value)}
                      placeholder="Ex: O Segredo da Sabedoria"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-neutral-400">Posição:</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'top', label: 'Topo' },
                        { id: 'center', label: 'Centro' },
                        { id: 'bottom', label: 'Rodapé' },
                      ].map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setTitlePosition(p.id as TitlePosition)}
                          className={`p-2 text-xs rounded-lg border text-center transition-colors cursor-pointer ${
                            titlePosition === p.id
                              ? 'border-white bg-neutral-800 text-white font-semibold'
                              : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-white'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {/* Option to Remove Logo / Watermark from the site (Persisted whether active or deactivated) */}
              <div className="border-t border-neutral-800 pt-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">Marca d'água do Site</span>
                      {removeWatermark ? (
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                          ✓ Removida (Vídeo Limpo)
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
                          Ativada (Com Logo)
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      {removeWatermark
                        ? 'Opção salva: os vídeos serão gerados sem nenhuma logomarca ou marca d’água.'
                        : 'Exibe a logo "VozLivre Video" no canto inferior direito. Ative a opção para remover.'}
                    </p>
                  </div>

                  <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                    <input
                      type="checkbox"
                      checked={removeWatermark}
                      onChange={(e) => setRemoveWatermark(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-neutral-500">
                    {removeWatermark ? '🛡️ Vídeo profissional 100% limpo sem marca d’água' : '💡 Clique no botão para remover a logo dos vídeos'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRemoveWatermark(!removeWatermark)}
                    className={`text-[10px] font-medium px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      removeWatermark
                        ? 'border-emerald-700 bg-emerald-950/60 text-emerald-300'
                        : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-white'
                    }`}
                  >
                    {removeWatermark ? 'Restaurar Marca d’água' : 'Remover Marca d’água'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 
        ========================================================================
        INTERACTIVE CROP STUDIO MODAL:
        Allows cropping a specific portion/area of the uploaded video or image
        with live rule-of-thirds grid, zoom slider, pan sliders, and aspect presets!
        ========================================================================
      */}
      {isCropModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl p-4 sm:p-6 space-y-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div className="flex items-center gap-2">
                <Crop className="h-5 w-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">
                  Cortar & Enquadrar Área da Mídia
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCropModalOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* View Mode Switcher */}
            <div className="flex items-center justify-between gap-2 bg-neutral-950 p-1.5 rounded-xl border border-neutral-800">
              <button
                type="button"
                onClick={() => setCropPreviewTab('full')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  cropPreviewTab === 'full'
                    ? 'bg-neutral-800 text-white shadow-sm border border-neutral-700'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Maximize2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>🔍 Visão Completa (Ver 100% da Imagem + Molde)</span>
              </button>
              <button
                type="button"
                onClick={() => setCropPreviewTab('result')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  cropPreviewTab === 'result'
                    ? 'bg-neutral-800 text-white shadow-sm border border-neutral-700'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Film className="h-3.5 w-3.5 text-cyan-400" />
                <span>🎬 Resultado Enquadrado ({aspectRatio})</span>
              </button>
            </div>

            {/* Interactive Visual Crop Preview Box */}
            <div className="space-y-2">
              {cropPreviewTab === 'full' ? (
                // MODE 1: Full Image View - 100% of media is visible, nothing cut off!
                // SVG mask darkens the outside portion and emerald box shows the exact framing.
                <div
                  className="relative w-full min-h-[250px] sm:min-h-[320px] bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800 flex items-center justify-center p-3 select-none touch-none cursor-move"
                  onMouseDown={handleCropDragStart}
                  onMouseMove={handleCropDragMove}
                  onMouseUp={handleCropDragEnd}
                  onTouchStart={handleCropDragStart}
                  onTouchMove={handleCropDragMove}
                  onTouchEnd={handleCropDragEnd}
                >
                  {userMediaUrl && (
                    <div
                      className="relative inline-block max-w-full max-h-[280px] sm:max-h-[320px]"
                      style={{
                        aspectRatio: `${userMediaWidth || 16} / ${userMediaHeight || 9}`,
                      }}
                    >
                      {userMediaType === 'video' ? (
                        <video
                          src={userMediaUrl}
                          muted
                          autoPlay
                          loop
                          playsInline
                          className="w-full h-full object-contain block rounded pointer-events-none select-none"
                        />
                      ) : (
                        <img
                          src={userMediaUrl}
                          alt="Imagem Original Completa"
                          className="w-full h-full object-contain block rounded pointer-events-none select-none"
                        />
                      )}

                      {(() => {
                        const targetRatio =
                          aspectRatio === '9:16' ? 9 / 16 : aspectRatio === '1:1' ? 1 : 16 / 9;
                        const cropBox = computeCropBox(
                          userMediaWidth || 1280,
                          userMediaHeight || 720,
                          targetRatio,
                          cropSettings.zoom,
                          cropSettings.panX,
                          cropSettings.panY
                        );

                        return (
                          <>
                            {/* SVG Cutout Mask: dims outer parts, keeps crop window 100% clear */}
                            <svg
                              className="absolute inset-0 w-full h-full pointer-events-none z-10"
                              preserveAspectRatio="none"
                            >
                              <defs>
                                <mask id="cropHoleMask">
                                  <rect width="100%" height="100%" fill="white" />
                                  <rect
                                    x={`${cropBox.leftPct}%`}
                                    y={`${cropBox.topPct}%`}
                                    width={`${cropBox.widthPct}%`}
                                    height={`${cropBox.heightPct}%`}
                                    fill="black"
                                  />
                                </mask>
                              </defs>
                              <rect
                                width="100%"
                                height="100%"
                                fill="rgba(0, 0, 0, 0.65)"
                                mask="url(#cropHoleMask)"
                              />
                            </svg>

                            {/* Glowing Crop Viewport Overlay */}
                            <div
                              className="absolute border-2 border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.6)] z-20 pointer-events-none transition-all duration-75 flex flex-col justify-between"
                              style={{
                                left: `${cropBox.leftPct}%`,
                                top: `${cropBox.topPct}%`,
                                width: `${cropBox.widthPct}%`,
                                height: `${cropBox.heightPct}%`,
                              }}
                            >
                              {/* 3x3 Rule of Thirds Grid inside crop box */}
                              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                                <div className="border-r border-b border-emerald-400/30" />
                                <div className="border-r border-b border-emerald-400/30" />
                                <div className="border-b border-emerald-400/30" />
                                <div className="border-r border-b border-emerald-400/30" />
                                <div className="border-r border-b border-emerald-400/30 flex items-center justify-center">
                                  <Crosshair className="h-4 w-4 text-emerald-400/60" />
                                </div>
                                <div className="border-b border-emerald-400/30" />
                                <div className="border-r border-emerald-400/30" />
                                <div className="border-r border-emerald-400/30" />
                                <div />
                              </div>

                              {/* Format Badge & Drag Hint */}
                              <div className="relative z-10 m-1 flex items-center gap-1 bg-black/85 backdrop-blur-sm border border-emerald-400/50 text-[10px] font-bold text-emerald-300 px-1.5 py-0.5 rounded shadow-sm w-fit">
                                <span>{aspectRatio}</span>
                              </div>

                              <div className="relative z-10 m-1 text-right">
                                <span className="bg-black/85 backdrop-blur-sm border border-emerald-400/40 text-[9px] font-medium text-emerald-300 px-1.5 py-0.5 rounded shadow-sm">
                                  Arraste para mover
                                </span>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                // MODE 2: Framed Result View - shows final cropped canvas
                <div
                  className="relative w-full h-[250px] sm:h-[320px] bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800 flex items-center justify-center p-3 select-none touch-none cursor-move"
                  onMouseDown={handleCropDragStart}
                  onMouseMove={handleCropDragMove}
                  onMouseUp={handleCropDragEnd}
                  onTouchStart={handleCropDragStart}
                  onTouchMove={handleCropDragMove}
                  onTouchEnd={handleCropDragEnd}
                >
                  <div
                    className="relative h-full max-w-full overflow-hidden rounded-lg border border-neutral-700 shadow-2xl flex items-center justify-center bg-black"
                    style={{
                      aspectRatio:
                        aspectRatio === '9:16' ? '9/16' : aspectRatio === '1:1' ? '1/1' : '16/9',
                    }}
                  >
                    <canvas
                      ref={cropResultCanvasRef}
                      className="w-full h-full object-contain block pointer-events-none select-none"
                    />

                    {/* Rule of Thirds Overlay */}
                    <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 border border-emerald-400/30">
                      <div className="border-r border-b border-emerald-400/20" />
                      <div className="border-r border-b border-emerald-400/20" />
                      <div className="border-b border-emerald-400/20" />
                      <div className="border-r border-emerald-400/20" />
                      <div className="border-r border-emerald-400/20 flex items-center justify-center">
                        <Crosshair className="h-5 w-5 text-emerald-400/40" />
                      </div>
                      <div className="border-b border-emerald-400/20" />
                      <div className="border-r border-emerald-400/20" />
                      <div className="border-r border-emerald-400/20" />
                      <div />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] text-neutral-400 px-1 gap-1">
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>
                    {cropPreviewTab === 'full'
                      ? '100% da imagem visível acima. As partes escuras serão cortadas.'
                      : 'Prévia do vídeo final enquadrado na proporção ' + aspectRatio}
                  </span>
                </span>
                <span className="text-neutral-500 text-[10px]">
                  💡 Toque e arraste com o dedo ou mouse para mover o corte
                </span>
              </div>
            </div>

            {/* Crop Controls */}
            <div className="space-y-4 bg-neutral-950 p-4 rounded-xl border border-neutral-800">
              {/* Zoom Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <ZoomIn className="h-4 w-4 text-emerald-400" />
                    <span>Zoom da Área (Escala do Corte):</span>
                  </span>
                  <span className="font-mono font-bold text-emerald-400">
                    {Math.round(cropSettings.zoom * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={100}
                  max={300}
                  step={5}
                  value={Math.round(cropSettings.zoom * 100)}
                  onChange={(e) =>
                    setCropSettings((prev) => ({
                      ...prev,
                      enabled: true,
                      zoom: parseFloat(e.target.value) / 100,
                    }))
                  }
                  className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                />
              </div>

              {/* Horizontal Pan X */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Move className="h-4 w-4 text-cyan-400" />
                    <span>Posição Horizontal (Pan X):</span>
                  </span>
                  <span className="font-mono font-bold text-cyan-400">
                    {cropSettings.panX > 0 ? `+${cropSettings.panX}%` : `${cropSettings.panX}%`}
                  </span>
                </div>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={1}
                  value={cropSettings.panX}
                  onChange={(e) =>
                    setCropSettings((prev) => ({
                      ...prev,
                      enabled: true,
                      panX: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <button
                    type="button"
                    onClick={() => setCropSettings((prev) => ({ ...prev, enabled: true, panX: -50 }))}
                    className="hover:text-white underline cursor-pointer"
                  >
                    ← Esquerda (-50%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropSettings((prev) => ({ ...prev, enabled: true, panX: 0 }))}
                    className="hover:text-white font-semibold underline cursor-pointer"
                  >
                    Centro (0)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropSettings((prev) => ({ ...prev, enabled: true, panX: 50 }))}
                    className="hover:text-white underline cursor-pointer"
                  >
                    Direita (+50%) →
                  </button>
                </div>
              </div>

              {/* Vertical Pan Y */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Move className="h-4 w-4 text-purple-400" />
                    <span>Posição Vertical (Pan Y):</span>
                  </span>
                  <span className="font-mono font-bold text-purple-400">
                    {cropSettings.panY > 0 ? `+${cropSettings.panY}%` : `${cropSettings.panY}%`}
                  </span>
                </div>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={1}
                  value={cropSettings.panY}
                  onChange={(e) =>
                    setCropSettings((prev) => ({
                      ...prev,
                      enabled: true,
                      panY: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                />
                <div className="flex justify-between text-[10px] text-neutral-500">
                  <button
                    type="button"
                    onClick={() => setCropSettings((prev) => ({ ...prev, enabled: true, panY: -50 }))}
                    className="hover:text-white underline cursor-pointer"
                  >
                    ↑ Topo / Rosto (-50%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropSettings((prev) => ({ ...prev, enabled: true, panY: 0 }))}
                    className="hover:text-white font-semibold underline cursor-pointer"
                  >
                    Centro (0)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCropSettings((prev) => ({ ...prev, enabled: true, panY: 50 }))}
                    className="hover:text-white underline cursor-pointer"
                  >
                    Rodapé (+50%) ↓
                  </button>
                </div>
              </div>

              {/* Quick Framing Presets */}
              <div className="pt-2 border-t border-neutral-800 space-y-2">
                <div className="text-[11px] text-neutral-400 font-medium">Atalhos de Enquadramento:</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { label: '🎯 Centralizar', x: 0, y: 0 },
                    { label: '👤 Topo (Rosto)', x: 0, y: -50 },
                    { label: '⬇️ Rodapé', x: 0, y: 50 },
                    { label: '⬅️ Esquerda', x: -50, y: 0 },
                    { label: '➡️ Direita', x: 50, y: 0 },
                    { label: '🔎 Zoom 125%', zoom: 1.25 },
                    { label: '🔍 Zoom 150%', zoom: 1.5 },
                    { label: '🔬 Zoom 200%', zoom: 2.0 },
                  ].map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        setCropSettings((prev) => ({
                          ...prev,
                          enabled: true,
                          panX: preset.x !== undefined ? preset.x : prev.panX,
                          panY: preset.y !== undefined ? preset.y : prev.panY,
                          zoom: preset.zoom !== undefined ? preset.zoom : prev.zoom,
                        }))
                      }
                      className="px-2.5 py-1 text-[11px] font-medium bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 rounded-md text-neutral-300 hover:text-white transition-colors cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={handleResetCrop}
                className="w-full sm:w-auto px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
              >
                Redefinir (Sem Corte)
              </button>

              <button
                type="button"
                onClick={() => {
                  setCropSettings((prev) => ({ ...prev, enabled: true }));
                  setIsCropModalOpen(false);
                }}
                className="w-full sm:w-auto px-6 py-2 text-xs font-semibold text-neutral-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors shadow-lg cursor-pointer"
              >
                Aplicar e Salvar Corte
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          AUDIO LIBRARY MODAL:
          Allows browsing, previewing, and selecting from all saved audios
          (both uploaded files and generated voices) with search and upload.
          ======================================================================== */}
      {isAudioLibraryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-neutral-800 flex items-center justify-between shrink-0 bg-neutral-900/90">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-violet-950/80 border border-violet-800/80 text-violet-300">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Meus Áudios Salvos
                  </h3>
                  <p className="text-xs text-neutral-400">
                    {history.length} {history.length === 1 ? 'áudio salvo' : 'áudios salvos'} na sua biblioteca local
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAudioLibraryModalOpen(false);
                  if (libraryAudioRef.current) libraryAudioRef.current.pause();
                  setPreviewPlayingId(null);
                }}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Hidden audio for previewing */}
            <audio
              ref={libraryAudioRef}
              onEnded={() => setPreviewPlayingId(null)}
              className="hidden"
            />

            {/* Upload Zone & Search */}
            <div className="p-4 border-b border-neutral-800 bg-neutral-950/40 space-y-3 shrink-0">
              <div
                onClick={() => {
                  audioFileInputRef.current?.click();
                }}
                className="border-2 border-dashed border-neutral-700 hover:border-emerald-500/80 bg-neutral-900/60 hover:bg-emerald-950/20 rounded-xl p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-neutral-800 text-neutral-300 group-hover:bg-emerald-500 group-hover:text-neutral-950 transition-colors">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white group-hover:text-emerald-300 transition-colors">
                      Enviar Novo Áudio do seu Computador
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      MP3, WAV, OGG, M4A — Fica salvo permanentemente na sua biblioteca
                    </div>
                  </div>
                </div>
                <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white text-neutral-950 hover:bg-neutral-200 transition-colors shrink-0">
                  Escolher Arquivo
                </span>
              </div>

              {/* Search & Tabs */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <div className="relative flex-1">
                  <Search className="h-3.5 w-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="Buscar áudio por nome..."
                    className="w-full bg-neutral-800/80 border border-neutral-700 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
                  />
                  {librarySearch && (
                    <button
                      type="button"
                      onClick={() => setLibrarySearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setLibraryFilter('all')}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                      libraryFilter === 'all'
                        ? 'bg-neutral-800 text-white font-medium'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Todos ({history.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryFilter('uploaded')}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                      libraryFilter === 'uploaded'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 font-medium'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <UploadCloud className="h-3 w-3" />
                    <span>Uploads ({history.filter(h => h.isUploaded || h.voice?.id === 'custom-upload' || h.voice?.id === 'user-upload').length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryFilter('generated')}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                      libraryFilter === 'generated'
                        ? 'bg-neutral-800 text-white font-medium'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Vozes ({history.filter(h => !(h.isUploaded || h.voice?.id === 'custom-upload' || h.voice?.id === 'user-upload')).length})
                  </button>
                </div>
              </div>
            </div>

            {/* List of Audios */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {(() => {
                const filtered = history.filter((item) => {
                  const isUp =
                    item.isUploaded ||
                    item.voice?.id === 'custom-upload' ||
                    item.voice?.id === 'user-upload';
                  if (libraryFilter === 'uploaded' && !isUp) return false;
                  if (libraryFilter === 'generated' && isUp) return false;
                  if (librarySearch.trim()) {
                    const q = librarySearch.toLowerCase();
                    return (
                      (item.title && item.title.toLowerCase().includes(q)) ||
                      (item.textSnippet && item.textSnippet.toLowerCase().includes(q))
                    );
                  }
                  return true;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-10 text-neutral-400 text-xs">
                      Nenhum áudio encontrado para este filtro.
                    </div>
                  );
                }

                return filtered.map((item) => {
                  const isSelected = selectedAudio?.id === item.id;
                  const isUp =
                    item.isUploaded ||
                    item.voice?.id === 'custom-upload' ||
                    item.voice?.id === 'user-upload';
                  const isPlayingThis = previewPlayingId === item.id;

                  return (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                        isSelected
                          ? 'border-emerald-600/80 bg-emerald-950/20'
                          : 'border-neutral-800/80 bg-neutral-950/60 hover:bg-neutral-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Preview play button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (isPlayingThis) {
                              libraryAudioRef.current?.pause();
                              setPreviewPlayingId(null);
                            } else {
                              if (libraryAudioRef.current) {
                                const src = item.blob ? URL.createObjectURL(item.blob) : item.audioUrl;
                                libraryAudioRef.current.src = src;
                                libraryAudioRef.current.play().catch(() => {});
                                setPreviewPlayingId(item.id);
                              }
                            }
                          }}
                          className={`p-2 rounded-lg transition-colors cursor-pointer shrink-0 ${
                            isPlayingThis
                              ? 'bg-emerald-500 text-neutral-950'
                              : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white'
                          }`}
                          title={isPlayingThis ? 'Pausar prévia' : 'Ouvir prévia'}
                        >
                          {isPlayingThis ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4 fill-current" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-white truncate max-w-xs sm:max-w-md">
                              {item.title || 'Áudio sem título'}
                            </span>
                            {isUp ? (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                                <UploadCloud className="h-2.5 w-2.5" />
                                <span>Upload</span>
                              </span>
                            ) : (
                              <span className="text-[10px] text-neutral-400 font-mono">
                                ({item.voice.name})
                              </span>
                            )}
                            {isSelected && (
                              <span className="text-[10px] font-bold text-emerald-400 font-mono">
                                [Atual no Vídeo]
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                            <span>Duração: <strong className="text-neutral-200 font-mono">{formatTime(item.durationSeconds || 0)}</strong></span>
                            {item.sizeBytes && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{formatBytes(item.sizeBytes)}</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span>{new Date(item.createdAt).toLocaleDateString('pt-BR')}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => {
                            if (libraryAudioRef.current) libraryAudioRef.current.pause();
                            setPreviewPlayingId(null);
                            onSelectAudio(item);
                            setSelectedAudio(item);
                            setAudioDuration(item.durationSeconds || 0);
                            setVideoTitleText(item.title);
                            setIsAudioLibraryModalOpen(false);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                              : 'bg-emerald-400 hover:bg-emerald-300 text-neutral-950 shadow-md'
                          }`}
                        >
                          {isSelected ? 'Já Selecionado' : 'Usar no Vídeo'}
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 border-t border-neutral-800 bg-neutral-900/90 flex items-center justify-between text-xs text-neutral-400 shrink-0">
              <span className="flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                <span>Todos os áudios ficam salvos no seu navegador para uso imediato.</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsAudioLibraryModalOpen(false);
                  if (libraryAudioRef.current) libraryAudioRef.current.pause();
                  setPreviewPlayingId(null);
                }}
                className="px-3 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg cursor-pointer"
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
