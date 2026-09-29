import { IANarradaConversation } from '../types';

const DB_NAME = 'vozlivre_ia_narrada_db';
const STORE_NAME = 'conversations';
const DB_VERSION = 1;
const STORAGE_BACKUP_KEY = 'vozlivre_ia_narrada_backup_v1';

export const INITIAL_SAMPLE_CONVERSATION: IANarradaConversation = {
  id: 'conv-sample-farol',
  title: 'O Farol do Fim do Mundo',
  category: 'Ficção & Aventura',
  createdAt: Date.now() - 3600000,
  updatedAt: Date.now() - 3600000,
  isFavorite: true,
  messages: [
    {
      id: 'msg-user-sample',
      role: 'user',
      content: 'Crie uma história envolvente sobre o guardião solitário de um farol no Atlântico Sul que avista uma luz misteriosa vinda do fundo do oceano durante uma tempestade violenta. Use pausas e ênfases naturais para locução.',
      createdAt: Date.now() - 3600000,
      charCount: 226,
      wordCount: 36,
    },
    {
      id: 'msg-assistant-sample',
      role: 'assistant',
      content: `A tempestade no Atlântico Sul não rugia; ela devorava. [pausa 1s]

No topo da torre de granito cinzento, Bento ajustava as engrenagens de bronze do enorme espelho de Fresnel. Há vinte anos, aquele feixe giratório de luz amarela era a única fronteira entre os navios cargueiros e os recifes traiçoeiros do Cabo das Tormentas. [pausa 1.5s]

O vento fustigava as vidraças com tamanha fúria que o vidro vibrava em uma nota grave e constante. [ênfase]Mas não foi o mar revolto que fez as mãos calejadas de Bento paralisarem.[/ênfase] [pausa 1s]

A três milhas a leste, onde as cartas náuticas marcavam apenas abismos insondáveis de águas escuras, uma luminescência azulada brotou das ondas. Não era o reflexo de um raio, nem o sinal de socorro de uma embarcação. Era uma pulsação rítmica, [sussurro]quase como a respiração lenta de algo adormecido no fundo do oceano.[/sussurro] [pausa 1.5s]

Bento levou a luneta aos olhos trêmulos. A cada pulso luminoso, as ondas pareciam se acalmar em círculos concêntricos perfeitos, desafiando toda a física da tempestade. [pausa 1s]

Pela primeira vez em duas décadas de vigília solitária, o guardião compreendeu: aquela noite não seria sobre salvar homens do mar bravio. [ênfase]Seria sobre responder ao primeiro chamado.[/ênfase]`,
      createdAt: Date.now() - 3550000,
      charCount: 1198,
      wordCount: 184,
    },
  ],
};

function openIADB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB não suportado'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Loads all saved conversations from IndexedDB (with fallback to localStorage).
 */
export async function getAllConversationsFromDB(): Promise<IANarradaConversation[]> {
  try {
    const db = await openIADB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        let results = (req.result || []) as IANarradaConversation[];
        if (results.length === 0) {
          // Check localStorage backup
          try {
            const raw = localStorage.getItem(STORAGE_BACKUP_KEY);
            if (raw) {
              results = JSON.parse(raw);
            }
          } catch {}

          if (results.length === 0) {
            // Seed sample
            results = [INITIAL_SAMPLE_CONVERSATION];
            saveConversationToDB(INITIAL_SAMPLE_CONVERSATION).catch(() => {});
          }
        }

        // Sort descending by updatedAt
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(results);
      };

      req.onerror = () => {
        resolve(loadFromLocalStorageBackup());
      };
    });
  } catch (err) {
    console.warn('Fallback to localStorage for conversations:', err);
    return loadFromLocalStorageBackup();
  }
}

/**
 * Saves or updates a conversation in IndexedDB and syncs to localStorage backup.
 */
export async function saveConversationToDB(conv: IANarradaConversation): Promise<void> {
  // Sync to backup immediately
  try {
    const current = loadFromLocalStorageBackup();
    const existingIndex = current.findIndex((c) => c.id === conv.id);
    if (existingIndex >= 0) {
      current[existingIndex] = conv;
    } else {
      current.unshift(conv);
    }
    localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(current.slice(0, 50)));
  } catch {}

  try {
    const db = await openIADB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(conv);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to save in IndexedDB:', err);
  }
}

/**
 * Deletes a conversation by ID from IndexedDB and localStorage.
 */
export async function deleteConversationFromDB(id: string): Promise<void> {
  try {
    const current = loadFromLocalStorageBackup().filter((c) => c.id !== id);
    localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify(current));
  } catch {}

  try {
    const db = await openIADB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to delete in IndexedDB:', err);
  }
}

function loadFromLocalStorageBackup(): IANarradaConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_BACKUP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return [INITIAL_SAMPLE_CONVERSATION];
}
