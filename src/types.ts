export interface Voice {
  id: string;
  name: string;
  gender: string;
  lang: string;
  langLabel: string;
  description: string;
  isDefault?: boolean;
  voiceLocale?: string;
}

export interface GeneratedAudio {
  id: string;
  title: string;
  voice: Voice;
  textSnippet: string;
  fullText?: string;
  charCount: number;
  durationSeconds: number;
  createdAt: number;
  audioUrl: string;
  downloadUrl: string;
  blobUrl?: string;
  blob?: Blob;
  sizeBytes?: number;
  isUploaded?: boolean;
}

export interface GenerationProgress {
  active: boolean;
  completedChunks: number;
  totalChunks: number;
  percent: number;
  statusText: string;
}

export interface ProsodySettings {
  rate: string; // e.g. "+0%", "+15%", "-20%"
  pitch: string; // e.g. "+0Hz", "+15Hz", "-15Hz"
  volume: string; // e.g. "+0%"
}

export type VideoAspectRatio = '9:16' | '16:9' | '1:1' | '4:5' | '21:9';
export type FitMode916 = 'blur_capcut' | 'crop' | 'fit';

export interface CapCutBlurSettings {
  enabled: boolean;
  blurIntensity: number; // e.g. 15, 25, 40
  darkenOverlay: number; // e.g. 0.3
  dropShadow: boolean;
}

export interface AudioTask {
  id: string;
  title: string;
  textSnippet: string;
  fullText?: string;
  charCount: number;
  voice: Voice;
  settings: ProsodySettings;
  status: 'queued' | 'processing' | 'completed' | 'error' | 'cancelled';
  progress: number;
  statusText: string;
  createdAt: number;
  completedAt?: number;
  resultAudio?: GeneratedAudio;
  errorMessage?: string;
  abortController?: AbortController;
}

export interface VideoTask {
  id: string;
  title: string;
  aspectRatio: VideoAspectRatio;
  fitMode: FitMode916;
  blurIntensity?: number;
  blurDarken?: number;
  status: 'queued' | 'preparing' | 'rendering' | 'completed' | 'error' | 'cancelled';
  progress: number;
  fps: number;
  statusText: string;
  createdAt: number;
  completedAt?: number;
  videoBlob?: Blob;
  videoUrl?: string;
  downloadFilename?: string;
  errorMessage?: string;
  error?: string;
  clipIndex?: number;
  audioTitle?: string;
  cancel?: () => void;
}

export interface VideoClip {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  label: string;
}

export interface StorySegment {
  id: string;
  title: string;
  text: string;
  voice: Voice;
  settings: ProsodySettings;
  status: 'pending' | 'generating' | 'ready' | 'error';
  errorMessage?: string;
  audio?: GeneratedAudio;
  order: number;
}

export interface NarratedStory {
  id: string;
  title: string;
  description: string;
  category?: string;
  defaultVoice: Voice;
  defaultSettings: ProsodySettings;
  segments: StorySegment[];
  createdAt: number;
  updatedAt: number;
}

export interface DialogueCharacter {
  id: string;
  name: string;
  voice: Voice;
  settings: ProsodySettings;
  avatarColor: string; // e.g. 'emerald', 'cyan', 'violet', 'amber', 'rose', 'blue'
  role?: string;
}

export interface DialogueLine {
  id: string;
  characterId: string;
  text: string;
  pauseAfterSeconds: number;
  status: 'pending' | 'generating' | 'ready' | 'error';
  errorMessage?: string;
  audio?: GeneratedAudio;
  order: number;
}

export interface PodcastDialogue {
  id: string;
  title: string;
  description: string;
  category?: string;
  characters: DialogueCharacter[];
  lines: DialogueLine[];
  unifiedAudio?: GeneratedAudio;
  createdAt: number;
  updatedAt: number;
}

export interface IANarradaMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  charCount?: number;
  wordCount?: number;
}

export interface IANarradaConversation {
  id: string;
  title: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
  messages: IANarradaMessage[];
  isFavorite?: boolean;
  includeVoiceTags?: boolean;
}

// ==========================================
// REPORTAGEM & MATÉRIA PARA VÍDEO COMPLETO
// ==========================================

export interface ExtractedMediaItem {
  id: string;
  type: 'image' | 'video';
  url: string;
  proxyUrl: string;
  thumbnailUrl?: string;
  caption?: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface ExtractedArticle {
  url: string;
  title: string;
  description: string;
  siteName: string;
  author?: string;
  publishedDate?: string;
  text: string;
  images: ExtractedMediaItem[];
  videos: ExtractedMediaItem[];
}

export interface ReportageScene {
  id: string;
  index: number;
  narrationSegment: string;
  mediaType: 'image' | 'video';
  mediaUrl: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  caption?: string;
  isMutedVideo: boolean; // Áudio do vídeo sempre silenciado para evitar sobreposição
  placement: 'headline_lead' | 'body_fact' | 'climax_video' | 'conclusion';
  allocatedDuration?: number;
}

export interface ReportageProject {
  id: string;
  sourceUrl: string;
  article: ExtractedArticle;
  headline: string;
  tickerText: string;
  leadSummary: string;
  fullNarration: string;
  scenes: ReportageScene[];
  selectedVoice: Voice;
  speed: string;
  aspectRatio: VideoAspectRatio;
  targetDurationSeconds?: number;
  generatedAudio?: GeneratedAudio;
  videoBlobUrl?: string;
  videoBlob?: Blob;
  status: 'idle' | 'extracting' | 'scripting' | 'synthesizing_audio' | 'rendering_video' | 'ready' | 'error';
  progressMessage?: string;
  progressPercent?: number;
  createdAt: number;
}

// ==========================================
// ROTEIRO CRIATIVO & HISTÓRIAS EM VÍDEO
// ==========================================

export interface NarrativeScene {
  id: string;
  index: number;
  narrationSegment: string;
  visualDescription: string;
  searchQuery: string;
  searchTag?: string; // Termo específico extraído do rótulo de busca []
  exactMediaUrl?: string; // URL da imagem exata fornecida dentro de []
  mediaType: 'image' | 'video';
  mediaUrl: string;
  thumbnailUrl?: string;
  originalUrl?: string;
  caption?: string;
  isMutedVideo?: boolean;
}

export interface NarrativeStoryProject {
  id: string;
  title: string;
  genre: string;
  tone: string;
  fullNarration: string;
  storyEntities?: string[];
  scenes: NarrativeScene[];
  targetDurationSeconds: number;
  selectedVoice: Voice;
  speed: string;
  aspectRatio: VideoAspectRatio;
  visualTheme?: 'cinematica' | 'fantasia' | 'misterio' | 'acolhedor' | 'documentario';
  generatedAudio?: GeneratedAudio;
  videoBlobUrl?: string;
  videoBlob?: Blob;
  downloadFilename?: string;
  status?: 'idle' | 'scripting' | 'synthesizing' | 'rendering' | 'ready' | 'error';
  progressMessage?: string;
  progressPercent?: number;
  createdAt?: number;
}


