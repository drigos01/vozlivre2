/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * VozLivre Safeguard System (Sistema de Salvaguarda e Recuperação contra Perda de Processamento)
 * - Persistent storage lock (navigator.storage.persist)
 * - beforeunload accidental exit prevention
 * - Continuous draft autosave & instant recovery on battery death / tab close
 * - Interrupted task session recovery (audio & video queues)
 * - Permanent Video & Clip IndexedDB storage
 */

import { AudioTask, VideoTask, ProsodySettings, Voice, VideoAspectRatio } from '../types';

const DRAFT_STORAGE_KEY = 'vozlivre_safeguard_draft_v1';
const RECOVERY_STORAGE_KEY = 'vozlivre_safeguard_interrupted_session_v1';
const ACTIVE_VIDEO_SESSION_KEY = 'vozlivre_active_video_session_v1';
const VIDEOS_DB_NAME = 'vozlivre_rendered_videos_db';
const VIDEOS_STORE_NAME = 'videos';
const CHECKPOINTS_STORE_NAME = 'render_checkpoints';
const VIDEOS_DB_VERSION = 2;

export interface ActiveVideoSessionState {
  taskId: string;
  studioType: 'video_editor' | 'roteiro_criativo' | 'reportagem';
  title: string;
  aspectRatio: string;
  fitMode?: string;
  audioId?: string;
  audioTitle?: string;
  clipIndex?: number;
  progress?: number;
  progressPercent?: number;
  lastCompletedFrame: number;
  totalFrames: number;
  resumeTimeSec?: number;
  totalDurationSec?: number;
  errorMessage?: string;
  clipSegment?: any;
  startedAt?: number;
  updatedAt: number;
}

export function saveActiveVideoSessionState(state: ActiveVideoSessionState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_VIDEO_SESSION_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Failed to save active video session state:', err);
  }
}

export function getActiveVideoSessionState(): ActiveVideoSessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTIVE_VIDEO_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveVideoSessionState;
  } catch {
    return null;
  }
}

export function clearActiveVideoSessionState(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(ACTIVE_VIDEO_SESSION_KEY);
  } catch {}
}

export interface SerializedEncodedChunk {
  data: Uint8Array;
  type: 'key' | 'delta';
  timestamp: number;
  duration: number;
  decoderConfig?: {
    codec: string;
    description?: Uint8Array;
    codedWidth?: number;
    codedHeight?: number;
    sampleRate?: number;
    numberOfChannels?: number;
  };
}

export interface VideoRenderCheckpoint {
  taskId: string;
  studioType: 'video_editor' | 'roteiro_criativo' | 'reportagem';
  audioId?: string;
  title: string;
  aspectRatio: VideoAspectRatio;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  lastCompletedFrame: number;
  progressPercent: number;
  sampleRate?: number;
  audioSampleRate?: number;
  audioNumberOfChannels?: number;
  resumeTimeSec?: number;
  totalDurationSec?: number;
  audioChunks: SerializedEncodedChunk[];
  videoChunks: SerializedEncodedChunk[];
  videoDecoderConfig?: any;
  audioDecoderConfig?: any;
  recordedMediaChunks?: Blob[];
  recordedMimeType?: string;
  mediaRecorderChunks?: Blob[];
  mediaRecorderMimeType?: string;
  lastElapsedSec?: number;
  clipSegment?: any;
  jobSnapshot?: any;
  updatedAt: number;
}

const memoryCheckpoints = new Map<string, VideoRenderCheckpoint>();

/**
 * Safely serializes an EncodedVideoChunk or EncodedAudioChunk + metadata into a structured-cloneable object
 */
export function serializeEncodedChunk(
  chunk: any,
  meta?: any,
  fallbackDurationUs: number = 33333
): SerializedEncodedChunk {
  const data = new Uint8Array(chunk.byteLength || 0);
  if (typeof chunk.copyTo === 'function' && chunk.byteLength > 0) {
    chunk.copyTo(data);
  }
  const rawDuration = chunk.duration;
  const duration =
    typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration >= 0
      ? rawDuration
      : fallbackDurationUs;

  let decoderConfig: SerializedEncodedChunk['decoderConfig'] | undefined;
  if (meta?.decoderConfig) {
    const dc = meta.decoderConfig;
    let descBytes: Uint8Array | undefined;
    if (dc.description) {
      if (dc.description instanceof Uint8Array) {
        descBytes = new Uint8Array(dc.description);
      } else if (ArrayBuffer.isView(dc.description)) {
        descBytes = new Uint8Array(
          dc.description.buffer.slice(
            dc.description.byteOffset,
            dc.description.byteOffset + dc.description.byteLength
          )
        );
      } else if (dc.description instanceof ArrayBuffer) {
        descBytes = new Uint8Array(dc.description.slice(0));
      }
    }
    decoderConfig = {
      codec: dc.codec,
      ...(descBytes ? { description: descBytes } : {}),
      ...(dc.codedWidth ? { codedWidth: dc.codedWidth } : {}),
      ...(dc.codedHeight ? { codedHeight: dc.codedHeight } : {}),
      ...(dc.sampleRate ? { sampleRate: dc.sampleRate } : {}),
      ...(dc.numberOfChannels ? { numberOfChannels: dc.numberOfChannels } : {}),
    };
  }

  return {
    data,
    type: chunk.type === 'key' ? 'key' : 'delta',
    timestamp: Math.max(0, Number(chunk.timestamp) || 0),
    duration,
    ...(decoderConfig ? { decoderConfig } : {}),
  };
}

/**
 * Replays previously encoded audio and video chunks into an mp4-muxer instance
 * so rendering can resume from the exact frame where it stopped/failed.
 */
export function replayCheckpointToMuxer(
  muxer: any,
  checkpoint: {
    audioChunks?: SerializedEncodedChunk[];
    videoChunks?: SerializedEncodedChunk[];
  }
): {
  replayedAudioChunks: number;
  replayedVideoFrames: number;
  lastVideoTimestamp: number;
} {
  let replayedAudioChunks = 0;
  let replayedVideoFrames = 0;
  let lastVideoTimestamp = -1;

  if (checkpoint.audioChunks && checkpoint.audioChunks.length > 0) {
    let lastAudioTs = -1;
    for (const ac of checkpoint.audioChunks) {
      if (!ac || !(ac.data instanceof Uint8Array) || ac.data.byteLength === 0) continue;
      const safeTs = ac.timestamp >= lastAudioTs ? ac.timestamp : lastAudioTs + 1;
      lastAudioTs = safeTs;
      muxer.addAudioChunkRaw(
        ac.data,
        ac.type === 'key' ? 'key' : 'delta',
        safeTs,
        Number.isFinite(ac.duration) && ac.duration >= 0 ? ac.duration : 0,
        ac.decoderConfig ? { decoderConfig: ac.decoderConfig } : undefined
      );
      replayedAudioChunks++;
    }
  }

  if (checkpoint.videoChunks && checkpoint.videoChunks.length > 0) {
    for (const vc of checkpoint.videoChunks) {
      if (!vc || !(vc.data instanceof Uint8Array) || vc.data.byteLength === 0) continue;
      const safeTs = vc.timestamp >= lastVideoTimestamp ? vc.timestamp : lastVideoTimestamp + 1;
      lastVideoTimestamp = safeTs;
      muxer.addVideoChunkRaw(
        vc.data,
        vc.type === 'key' ? 'key' : 'delta',
        safeTs,
        Number.isFinite(vc.duration) && vc.duration >= 0 ? vc.duration : 33333,
        vc.decoderConfig ? { decoderConfig: vc.decoderConfig } : undefined
      );
      replayedVideoFrames++;
    }
  }

  return { replayedAudioChunks, replayedVideoFrames, lastVideoTimestamp };
}

export interface EditorDraft {
  text: string;
  title: string;
  voiceId?: string;
  settings?: ProsodySettings;
  timestamp: number;
}

export interface InterruptedSession {
  timestamp: number;
  audioTasks: {
    id: string;
    title: string;
    text: string;
    voiceId: string;
    settings: ProsodySettings;
  }[];
  videoTasks: {
    id: string;
    title: string;
    aspectRatio: string;
    fitMode: string;
    audioTitle?: string;
    progress?: number;
    lastCompletedFrame?: number;
    totalFrames?: number;
    studioType?: 'video_editor' | 'roteiro_criativo' | 'reportagem';
    clipIndex?: number;
  }[];
}

export interface StoredRenderedVideo {
  id: string;
  title: string;
  aspectRatio: string;
  fitMode: string;
  durationSeconds?: number;
  sizeBytes: number;
  createdAt: number;
  videoBlob: Blob;
  downloadFilename: string;
}

/**
 * Request persistent browser storage so Chrome / Android never purges
 * VozLivre's audio/video database even when the device is low on storage.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        const granted = await navigator.storage.persist();
        return granted;
      }
      return true;
    } catch (e) {
      console.warn('Storage persist request warning:', e);
      return false;
    }
  }
  return false;
}

/**
 * Saves current editor text & title draft immediately to local storage.
 */
export function saveEditorDraft(
  text: string,
  title: string,
  voiceId?: string,
  settings?: ProsodySettings
): void {
  if (typeof window === 'undefined') return;
  try {
    if (!text && !title) {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    const draft: EditorDraft = {
      text,
      title,
      voiceId,
      settings,
      timestamp: Date.now(),
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch (err) {
    console.warn('Failed to save editor draft:', err);
  }
}

/**
 * Retrieves the saved editor draft.
 */
export function getEditorDraft(): EditorDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Clears editor draft.
 */
export function clearEditorDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {}
}

/**
 * Continuously records the snapshot of active tasks so that if the device
 * runs out of battery or Chrome crashes, the user can recover and resume.
 */
export function saveActiveSessionTasks(
  audioTasks: AudioTask[],
  videoTasks: VideoTask[],
  currentTextMap?: Record<string, string>
): void {
  if (typeof window === 'undefined') return;
  try {
    const activeAudios = audioTasks.filter(
      (t) => t.status === 'processing' || t.status === 'queued'
    );
    const activeVideos = videoTasks.filter(
      (t) =>
        t.status === 'rendering' ||
        t.status === 'preparing' ||
        t.status === 'queued' ||
        (t.status === 'error' && (t.progress || 0) > 0)
    );

    if (activeAudios.length === 0 && activeVideos.length === 0) {
      localStorage.removeItem(RECOVERY_STORAGE_KEY);
      return;
    }

    const payload: InterruptedSession = {
      timestamp: Date.now(),
      audioTasks: activeAudios.map((t) => ({
        id: t.id,
        title: t.title,
        text: currentTextMap?.[t.id] || t.textSnippet || '',
        voiceId: t.voice.id,
        settings: t.settings,
      })),
      videoTasks: activeVideos.map((t) => {
        const ckpt = memoryCheckpoints.get(t.id);
        const inferredStudio: 'video_editor' | 'roteiro_criativo' | 'reportagem' =
          ckpt?.studioType ||
          (t.id.startsWith('nar-')
            ? 'roteiro_criativo'
            : t.id.startsWith('rep-')
            ? 'reportagem'
            : 'video_editor');
        return {
          id: t.id,
          title: t.title,
          aspectRatio: t.aspectRatio,
          fitMode: t.fitMode,
          audioTitle: t.audioTitle,
          progress: ckpt?.progressPercent ?? t.progress ?? 0,
          lastCompletedFrame: ckpt?.lastCompletedFrame,
          totalFrames: ckpt?.totalFrames,
          studioType: inferredStudio,
          clipIndex: t.clipIndex,
        };
      }),
    };

    localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Failed to save session snapshot:', err);
  }
}

/**
 * Checks if there is an interrupted session from a previous crash or unexpected exit.
 */
export function getInterruptedSession(): InterruptedSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RECOVERY_STORAGE_KEY);
    if (!raw) return null;
    const session: InterruptedSession = JSON.parse(raw);
    // Ignore sessions older than 24 hours
    if (Date.now() - session.timestamp > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(RECOVERY_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Clears the interrupted session snapshot.
 */
export function clearInterruptedSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(RECOVERY_STORAGE_KEY);
  } catch {}
}

/* =========================================================================
   Permanent Rendered Video & Frame Checkpoint IndexedDB Store
   ========================================================================= */

function openVideosDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB não suportado.'));
      return;
    }

    const request = indexedDB.open(VIDEOS_DB_NAME, VIDEOS_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(VIDEOS_STORE_NAME)) {
        const store = db.createObjectStore(VIDEOS_STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(CHECKPOINTS_STORE_NAME)) {
        const ckptStore = db.createObjectStore(CHECKPOINTS_STORE_NAME, { keyPath: 'taskId' });
        ckptStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

/**
 * Saves a frame-accurate render checkpoint in memory (instant) and optionally in IndexedDB (persistent).
 */
export async function saveRenderCheckpoint(
  checkpoint: VideoRenderCheckpoint,
  persistToIDB: boolean = true
): Promise<void> {
  const stamped: VideoRenderCheckpoint = {
    ...checkpoint,
    updatedAt: Date.now(),
  };
  memoryCheckpoints.set(stamped.taskId, stamped);

  if (!persistToIDB) return;

  try {
    const db = await openVideosDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHECKPOINTS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(CHECKPOINTS_STORE_NAME);
      const req = store.put(stamped);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Checkpoint IDB save notice:', err);
  }
}

/**
 * Synchronously retrieves a render checkpoint from memory if available.
 */
export function getRenderCheckpointSync(taskId: string): VideoRenderCheckpoint | null {
  return memoryCheckpoints.get(taskId) || null;
}

/**
 * Retrieves a render checkpoint by taskId (checks fast memory map first, then IndexedDB).
 */
export async function getRenderCheckpoint(taskId: string): Promise<VideoRenderCheckpoint | null> {
  const mem = memoryCheckpoints.get(taskId);
  if (mem) return mem;

  try {
    const db = await openVideosDB();
    return await new Promise<VideoRenderCheckpoint | null>((resolve) => {
      const tx = db.transaction(CHECKPOINTS_STORE_NAME, 'readonly');
      const store = tx.objectStore(CHECKPOINTS_STORE_NAME);
      const req = store.get(taskId);
      req.onsuccess = () => {
        const found = (req.result as VideoRenderCheckpoint) || null;
        if (found) {
          memoryCheckpoints.set(taskId, found);
        }
        resolve(found);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Retrieves the most recently updated render checkpoint (optionally filtered by studioType).
 */
export async function getLatestRenderCheckpoint(
  studioType?: 'video_editor' | 'roteiro_criativo' | 'reportagem'
): Promise<VideoRenderCheckpoint | null> {
  // Check memory first
  let best: VideoRenderCheckpoint | null = null;
  for (const ckpt of memoryCheckpoints.values()) {
    if (studioType && ckpt.studioType !== studioType) continue;
    if (!best || ckpt.updatedAt > best.updatedAt) {
      best = ckpt;
    }
  }
  if (best) return best;

  try {
    const db = await openVideosDB();
    return await new Promise<VideoRenderCheckpoint | null>((resolve) => {
      const tx = db.transaction(CHECKPOINTS_STORE_NAME, 'readonly');
      const store = tx.objectStore(CHECKPOINTS_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all: VideoRenderCheckpoint[] = req.result || [];
        const filtered = studioType ? all.filter((c) => c.studioType === studioType) : all;
        filtered.sort((a, b) => b.updatedAt - a.updatedAt);
        const latest = filtered[0] || null;
        if (latest) {
          memoryCheckpoints.set(latest.taskId, latest);
        }
        resolve(latest);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Deletes a render checkpoint once the video has finished rendering 100% or is discarded.
 */
export async function deleteRenderCheckpoint(taskId: string): Promise<void> {
  memoryCheckpoints.delete(taskId);
  try {
    const db = await openVideosDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(CHECKPOINTS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(CHECKPOINTS_STORE_NAME);
      const req = store.delete(taskId);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch {}
}

/**
 * Saves rendered MP4 video or clip permanently to IndexedDB so device reboot /
 * accidental refresh NEVER loses the finished MP4 video!
 */
export async function saveRenderedVideoToDB(video: StoredRenderedVideo): Promise<void> {
  const db = await openVideosDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIDEOS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(VIDEOS_STORE_NAME);
    const req = store.put(video);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves all saved rendered videos from IndexedDB.
 */
export async function getAllRenderedVideosFromDB(): Promise<StoredRenderedVideo[]> {
  const db = await openVideosDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIDEOS_STORE_NAME, 'readonly');
    const store = tx.objectStore(VIDEOS_STORE_NAME);
    const index = store.index('createdAt');
    const req = index.getAll();

    req.onsuccess = () => {
      const results: StoredRenderedVideo[] = req.result || [];
      results.sort((a, b) => b.createdAt - a.createdAt);
      resolve(results);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Deletes a rendered video from IndexedDB.
 */
export async function deleteRenderedVideoFromDB(id: string): Promise<void> {
  const db = await openVideosDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VIDEOS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(VIDEOS_STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
