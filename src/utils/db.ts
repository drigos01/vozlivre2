import { GeneratedAudio } from '../types';

const DB_NAME = 'vozlivre_audio_store';
const STORE_NAME = 'audios';
const DB_VERSION = 1;

export interface StoredAudioItem {
  id: string;
  title: string;
  voice: any;
  textSnippet: string;
  fullText?: string;
  charCount: number;
  durationSeconds: number;
  createdAt: number;
  sizeBytes: number;
  audioBlob: Blob;
  isUploaded?: boolean;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB não suportado neste navegador.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
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
 * Saves an audio item with its binary Blob to IndexedDB permanently.
 */
export async function saveAudioToDB(item: StoredAudioItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(item);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves all saved audio items from IndexedDB.
 */
export async function getAllAudiosFromDB(): Promise<StoredAudioItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const req = index.getAll();

    req.onsuccess = () => {
      // Sort newest first
      const results: StoredAudioItem[] = req.result || [];
      results.sort((a, b) => b.createdAt - a.createdAt);
      resolve(results);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves a single audio item with its blob by ID.
 */
export async function getAudioFromDB(id: string): Promise<StoredAudioItem | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Updates the title of an audio item in IndexedDB.
 */
export async function updateAudioTitleInDB(id: string, newTitle: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.title = newTitle;
        const putReq = store.put(item);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      } else {
        resolve();
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Deletes a single audio item from IndexedDB.
 */
export async function deleteAudioFromDB(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clears all audio items from IndexedDB.
 */
export async function clearAllAudiosFromDB(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* =========================================================================
   Live Narrada - IndexedDB Story Storage
   ========================================================================= */

const STORIES_DB_NAME = 'vozlivre_stories_db';
const STORIES_STORE_NAME = 'stories';
const STORIES_DB_VERSION = 1;

function openStoriesDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB não suportado.'));
      return;
    }

    const request = indexedDB.open(STORIES_DB_NAME, STORIES_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORIES_STORE_NAME)) {
        const store = db.createObjectStore(STORIES_STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
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

import { NarratedStory } from '../types';

export async function saveStoryToDB(story: NarratedStory): Promise<void> {
  const db = await openStoriesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORIES_STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORIES_STORE_NAME);

    // Deep clone/prepare segments to ensure serializability with Blobs
    const serializedStory = {
      ...story,
      updatedAt: Date.now(),
      segments: story.segments.map((seg) => ({
        ...seg,
        audio: seg.audio
          ? {
              id: seg.audio.id,
              title: seg.audio.title,
              voice: seg.audio.voice,
              textSnippet: seg.audio.textSnippet,
              charCount: seg.audio.charCount,
              durationSeconds: seg.audio.durationSeconds,
              createdAt: seg.audio.createdAt,
              sizeBytes: seg.audio.sizeBytes,
              blob: seg.audio.blob, // Blob is preserved natively in IndexedDB
            }
          : undefined,
      })),
    };

    const req = store.put(serializedStory);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllStoriesFromDB(): Promise<NarratedStory[]> {
  const db = await openStoriesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORIES_STORE_NAME, 'readonly');
    const store = tx.objectStore(STORIES_STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const rawStories: NarratedStory[] = req.result || [];
      // Re-hydrate blob URLs
      const hydrated = rawStories.map((story) => ({
        ...story,
        segments: story.segments.map((seg) => {
          if (seg.audio && seg.audio.blob) {
            const url = URL.createObjectURL(seg.audio.blob);
            return {
              ...seg,
              audio: {
                ...seg.audio,
                audioUrl: url,
                downloadUrl: url,
                blobUrl: url,
              },
            };
          }
          return seg;
        }),
      }));
      // Sort newest updated first
      hydrated.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(hydrated);
    };

    req.onerror = () => reject(req.error);
  });
}

export async function deleteStoryFromDB(id: string): Promise<void> {
  const db = await openStoriesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORIES_STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORIES_STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* =========================================================================
   Diálogo Natural - IndexedDB Dialogue / Podcast Storage
   ========================================================================= */

const DIALOGUES_DB_NAME = 'vozlivre_dialogues_db';
const DIALOGUES_STORE_NAME = 'dialogues';
const DIALOGUES_DB_VERSION = 1;

function openDialoguesDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB não suportado.'));
      return;
    }

    const request = indexedDB.open(DIALOGUES_DB_NAME, DIALOGUES_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(DIALOGUES_STORE_NAME)) {
        const store = db.createObjectStore(DIALOGUES_STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
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

import { PodcastDialogue } from '../types';

export async function saveDialogueToDB(dialogue: PodcastDialogue): Promise<void> {
  const db = await openDialoguesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DIALOGUES_STORE_NAME, 'readwrite');
    const store = tx.objectStore(DIALOGUES_STORE_NAME);

    const serializedDialogue = {
      ...dialogue,
      updatedAt: Date.now(),
      lines: dialogue.lines.map((l) => ({
        ...l,
        audio: l.audio
          ? {
              id: l.audio.id,
              title: l.audio.title,
              voice: l.audio.voice,
              textSnippet: l.audio.textSnippet,
              charCount: l.audio.charCount,
              durationSeconds: l.audio.durationSeconds,
              createdAt: l.audio.createdAt,
              sizeBytes: l.audio.sizeBytes,
              blob: l.audio.blob,
            }
          : undefined,
      })),
      unifiedAudio: dialogue.unifiedAudio
        ? {
            id: dialogue.unifiedAudio.id,
            title: dialogue.unifiedAudio.title,
            voice: dialogue.unifiedAudio.voice,
            textSnippet: dialogue.unifiedAudio.textSnippet,
            charCount: dialogue.unifiedAudio.charCount,
            durationSeconds: dialogue.unifiedAudio.durationSeconds,
            createdAt: dialogue.unifiedAudio.createdAt,
            sizeBytes: dialogue.unifiedAudio.sizeBytes,
            blob: dialogue.unifiedAudio.blob,
          }
        : undefined,
    };

    const req = store.put(serializedDialogue);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllDialoguesFromDB(): Promise<PodcastDialogue[]> {
  const db = await openDialoguesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DIALOGUES_STORE_NAME, 'readonly');
    const store = tx.objectStore(DIALOGUES_STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const rawDialogues: PodcastDialogue[] = req.result || [];
      const hydrated = rawDialogues.map((dlg) => ({
        ...dlg,
        lines: dlg.lines.map((l) => {
          if (l.audio && l.audio.blob) {
            const url = URL.createObjectURL(l.audio.blob);
            return {
              ...l,
              audio: {
                ...l.audio,
                audioUrl: url,
                downloadUrl: url,
                blobUrl: url,
              },
            };
          }
          return l;
        }),
        unifiedAudio:
          dlg.unifiedAudio && dlg.unifiedAudio.blob
            ? {
                ...dlg.unifiedAudio,
                audioUrl: URL.createObjectURL(dlg.unifiedAudio.blob),
                downloadUrl: URL.createObjectURL(dlg.unifiedAudio.blob),
                blobUrl: URL.createObjectURL(dlg.unifiedAudio.blob),
              }
            : undefined,
      }));
      hydrated.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(hydrated);
    };

    req.onerror = () => reject(req.error);
  });
}

export async function deleteDialogueFromDB(id: string): Promise<void> {
  const db = await openDialoguesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DIALOGUES_STORE_NAME, 'readwrite');
    const store = tx.objectStore(DIALOGUES_STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* =========================================================================
   Custom Background Music Persistence
   ========================================================================= */

const BG_MUSIC_DB_NAME = 'vozlivre_bg_music_db';
const BG_MUSIC_STORE_NAME = 'custom_music';
const BG_MUSIC_DB_VERSION = 1;

export interface StoredBgMusicItem {
  id: string;
  name: string;
  blob: Blob;
  sizeBytes: number;
  savedAt: number;
}

function openBgMusicDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB não suportado.'));
      return;
    }

    const request = indexedDB.open(BG_MUSIC_DB_NAME, BG_MUSIC_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(BG_MUSIC_STORE_NAME)) {
        db.createObjectStore(BG_MUSIC_STORE_NAME, { keyPath: 'id' });
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

export async function saveCustomBgMusicToDB(file: Blob, name: string): Promise<StoredBgMusicItem> {
  const db = await openBgMusicDB();
  const item: StoredBgMusicItem = {
    id: 'current_custom_bg_music',
    name,
    blob: file,
    sizeBytes: file.size,
    savedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BG_MUSIC_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BG_MUSIC_STORE_NAME);
    const req = store.put(item);

    req.onsuccess = () => resolve(item);
    req.onerror = () => reject(req.error);
  });
}

export async function getCustomBgMusicFromDB(): Promise<StoredBgMusicItem | null> {
  const db = await openBgMusicDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BG_MUSIC_STORE_NAME, 'readonly');
    const store = tx.objectStore(BG_MUSIC_STORE_NAME);
    const req = store.get('current_custom_bg_music');

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCustomBgMusicFromDB(): Promise<void> {
  const db = await openBgMusicDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BG_MUSIC_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BG_MUSIC_STORE_NAME);
    const req = store.delete('current_custom_bg_music');

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* =========================================================================
   Roteiro Criativo - Persistent Projects History in IndexedDB
   ========================================================================= */

const CREATIVE_PROJECTS_DB_NAME = 'vozlivre_creative_projects_db';
const CREATIVE_PROJECTS_STORE_NAME = 'creative_projects';
const CREATIVE_PROJECTS_DB_VERSION = 1;

export interface StoredCreativeProject {
  id: string;
  title: string;
  storyText?: string;
  premiseText?: string;
  fullNarration: string;
  storyEntities: string[];
  scenes: any[];
  aspectRatio: '16:9' | '9:16';
  voiceId: string;
  voiceName: string;
  durationSeconds: number;
  audioBlob?: Blob;
  createdAt: number;
  updatedAt: number;
}

function openCreativeProjectsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB não suportado.'));
      return;
    }

    const request = indexedDB.open(CREATIVE_PROJECTS_DB_NAME, CREATIVE_PROJECTS_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(CREATIVE_PROJECTS_STORE_NAME)) {
        const store = db.createObjectStore(CREATIVE_PROJECTS_STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
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

export async function saveCreativeProjectToDB(project: StoredCreativeProject): Promise<void> {
  const db = await openCreativeProjectsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CREATIVE_PROJECTS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CREATIVE_PROJECTS_STORE_NAME);
    const req = store.put({ ...project, updatedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllCreativeProjectsFromDB(): Promise<StoredCreativeProject[]> {
  const db = await openCreativeProjectsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CREATIVE_PROJECTS_STORE_NAME, 'readonly');
    const store = tx.objectStore(CREATIVE_PROJECTS_STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const list: StoredCreativeProject[] = req.result || [];
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCreativeProjectFromDB(id: string): Promise<void> {
  const db = await openCreativeProjectsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CREATIVE_PROJECTS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CREATIVE_PROJECTS_STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}


