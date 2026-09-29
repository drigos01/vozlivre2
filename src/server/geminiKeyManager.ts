import { GoogleGenAI } from '@google/genai';
import path from 'path';
import fs from 'fs';

export interface KeyStatus {
  id: string; // KEY_1, KEY_2, etc.
  key: string; // The secret key
  isAvailable: boolean;
  unavailableUntil?: number;
  lastErrorReason?: string;
  successCount: number;
  errorCount: number;
  lastUsedAt?: number;
}

export class GeminiKeyManager {
  private static instance: GeminiKeyManager;
  private keys: KeyStatus[] = [];
  private currentIndex = 0;
  private defaultCooldownMs = 90 * 1000; // 90 seconds cooldown on quota/rate-limit

  private constructor() {
    this.reloadKeys();
  }

  public static getInstance(): GeminiKeyManager {
    if (!GeminiKeyManager.instance) {
      GeminiKeyManager.instance = new GeminiKeyManager();
    }
    return GeminiKeyManager.instance;
  }

  private keysFilePath = path.resolve(process.cwd(), 'data', 'whatsapp', 'gemini_keys.json');

  /**
   * Discovers and registers all available keys from process.env and disk:
   * GEMINI_API_KEY, GEMINI_API_KEY_1, GEMINI_API_KEY_2, GEMINI_API_KEY_3...
   * Also supports comma-separated keys inside GEMINI_API_KEYS if provided,
   * and keys stored in data/whatsapp/gemini_keys.json
   */
  public reloadKeys(): void {
    const discoveredKeys: string[] = [];

    // 1. Primary default key
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
      discoveredKeys.push(process.env.GEMINI_API_KEY.trim());
    }

    // 2. Comma-separated list if provided
    if (process.env.GEMINI_API_KEYS) {
      const parts = process.env.GEMINI_API_KEYS.split(',').map((k) => k.trim()).filter(Boolean);
      for (const p of parts) {
        if (!discoveredKeys.includes(p)) {
          discoveredKeys.push(p);
        }
      }
    }

    // 3. Sequenced keys: GEMINI_API_KEY_1 through GEMINI_API_KEY_20
    for (let i = 1; i <= 20; i++) {
      const val = process.env[`GEMINI_API_KEY_${i}`];
      if (val && val.trim() && !discoveredKeys.includes(val.trim())) {
        discoveredKeys.push(val.trim());
      }
    }

    // 4. Stored keys from disk file
    try {
      if (fs.existsSync(this.keysFilePath)) {
        const stored = JSON.parse(fs.readFileSync(this.keysFilePath, 'utf-8'));
        if (Array.isArray(stored)) {
          for (const k of stored) {
            if (typeof k === 'string' && k.trim() && !discoveredKeys.includes(k.trim())) {
              discoveredKeys.push(k.trim());
            }
          }
        }
      }
    } catch {}

    // Preserve existing statistics if any
    const existingMap = new Map(this.keys.map((k) => [k.key, k]));

    this.keys = discoveredKeys.map((key, idx) => {
      const label = `KEY_${idx + 1}`;
      const existing = existingMap.get(key);
      if (existing) {
        return {
          ...existing,
          id: label,
        };
      }
      return {
        id: label,
        key,
        isAvailable: true,
        successCount: 0,
        errorCount: 0,
      };
    });

    console.log(`[GeminiKeyManager] Carregadas ${this.keys.length} chave(s) Gemini no pool central.`);
  }

  /**
   * Adds a new key to the central pool and persists to disk
   */
  public addKey(newKey: string): { success: boolean; label?: string; message: string } {
    if (!newKey || typeof newKey !== 'string' || newKey.trim().length < 10) {
      return { success: false, message: 'Chave Gemini inválida.' };
    }
    const cleanKey = newKey.trim();
    if (this.keys.some((k) => k.key === cleanKey)) {
      return { success: false, message: 'Esta chave já está presente no pool.' };
    }

    try {
      const dir = path.dirname(this.keysFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let diskList: string[] = [];
      if (fs.existsSync(this.keysFilePath)) {
        diskList = JSON.parse(fs.readFileSync(this.keysFilePath, 'utf-8'));
      }
      diskList.push(cleanKey);
      fs.writeFileSync(this.keysFilePath, JSON.stringify(diskList, null, 2), 'utf-8');
      this.reloadKeys();
      const added = this.keys.find((k) => k.key === cleanKey);
      return { success: true, label: added?.id, message: `Chave ${added?.id} adicionada ao pool com sucesso!` };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Erro ao salvar chave.' };
    }
  }

  /**
   * Gets the list of key status with full secrets redacted (only IDs and state)
   */
  public getPoolStatus(): Array<Omit<KeyStatus, 'key'>> {
    const now = Date.now();
    return this.keys.map((k) => ({
      id: k.id,
      isAvailable: k.isAvailable || (k.unavailableUntil ? now > k.unavailableUntil : true),
      unavailableUntil: k.unavailableUntil,
      lastErrorReason: k.lastErrorReason,
      successCount: k.successCount,
      errorCount: k.errorCount,
      lastUsedAt: k.lastUsedAt,
    }));
  }

  /**
   * Returns whether an error is rate-limit, quota or resource exhaustion
   */
  public isQuotaOrRateLimitError(err: any): boolean {
    if (!err) return false;
    const msg = (err?.message || err?.statusText || String(err)).toLowerCase();
    const status = err?.status || err?.statusCode || 0;

    return (
      status === 429 ||
      status === 503 ||
      msg.includes('429') ||
      msg.includes('quota') ||
      msg.includes('resource_exhausted') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests') ||
      msg.includes('temporarily unavailable') ||
      msg.includes('overloaded') ||
      msg.includes('high demand')
    );
  }

  /**
   * Marks a key as temporarily unavailable due to quota or rate limit
   */
  public markKeyUnavailable(keyId: string, reason: string, cooldownMs?: number): void {
    const target = this.keys.find((k) => k.id === keyId);
    if (!target) return;

    const isTransient503 = reason.includes('503') || reason.includes('high demand') || reason.includes('UNAVAILABLE') || reason.includes('overloaded');
    // Safe production cooldown: 25s for transient 503/high-demand spikes, 90s for quota 429
    const baseCooldown = isTransient503 ? 25 * 1000 : this.defaultCooldownMs;
    const cooldown = cooldownMs || baseCooldown;
    target.isAvailable = false;
    target.unavailableUntil = Date.now() + cooldown;
    target.lastErrorReason = reason;
    target.errorCount++;

    console.warn(
      `[GeminiKeyManager] ⚠️ ${target.id} marcada como INDISPONÍVEL por ${Math.round(
        cooldown / 1000
      )}s. Motivo: ${reason}`
    );
  }

  /**
   * Selects an available key with circular round-robin priority.
   * If all are in cooldown, returns null (never forces immediate reuse of a cooling-down key).
   */
  private selectNextAvailableKey(): KeyStatus | null {
    if (this.keys.length === 0) return null;

    const now = Date.now();

    // Check if any previously cooled down keys can now be revived
    for (const k of this.keys) {
      if (!k.isAvailable && k.unavailableUntil && now >= k.unavailableUntil) {
        k.isAvailable = true;
        k.unavailableUntil = undefined;
        console.log(`[GeminiKeyManager] 🔄 ${k.id} recuperou disponibilidade e voltou ao pool.`);
      }
    }

    // Round-robin search starting from currentIndex
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const candidate = this.keys[idx];
      if (candidate.isAvailable) {
        this.currentIndex = (idx + 1) % this.keys.length;
        candidate.lastUsedAt = now;
        return candidate;
      }
    }

    return null;
  }

  /**
   * Instantiates a GoogleGenAI client for the given key string
   */
  public createGenAIClient(apiKey: string): GoogleGenAI {
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  /**
   * Executes an operation with automatic key rotation and retry on quota/rate-limits
   * If a key fails with quota/rate-limit, it is marked unavailable and the operation
   * is automatically retried with the next key in line without losing user progress!
   */
  public async executeWithRotation<T>(
    operation: (ai: GoogleGenAI, keyLabel: string) => Promise<T>,
    options?: { maxAttempts?: number; taskName?: string }
  ): Promise<T> {
    if (this.keys.length === 0) {
      this.reloadKeys();
      if (this.keys.length === 0) {
        throw new Error('Nenhuma chave GEMINI_API_KEY configurada no servidor.');
      }
    }

    const taskName = options?.taskName || 'Gemini Task';
    // Bounded max attempts: at least 2, up to available keys count, capped at 5 to prevent retry loops
    const maxAttempts = options?.maxAttempts || Math.min(Math.max(2, this.keys.length), 5);
    let attempts = 0;
    let lastError: any = null;

    while (attempts < maxAttempts) {
      attempts++;
      const currentKey = this.selectNextAvailableKey();
      if (!currentKey) {
        throw new Error('Nenhuma chave Gemini disponível no momento. Todas estão em cooldown temporário.');
      }

      const client = this.createGenAIClient(currentKey.key);

      try {
        const result = await operation(client, currentKey.id);
        currentKey.successCount++;
        return result;
      } catch (err: any) {
        lastError = err;
        const isQuota = this.isQuotaOrRateLimitError(err);
        const reason = err?.message || 'Erro de execução';

        if (isQuota) {
          this.markKeyUnavailable(currentKey.id, reason.slice(0, 160));
          console.warn(
            `[GeminiKeyManager] 🔁 Alternando automaticamente para próxima chave após limite em ${currentKey.id} para [${taskName}] (Tentativa ${attempts}/${maxAttempts})...`
          );
          // Progressive backoff before next rotation attempt to prevent service hammering
          const backoffDelay = Math.min(600 * attempts, 3000);
          await new Promise((r) => setTimeout(r, backoffDelay));
          continue;
        } else {
          // Non-quota error (syntax, bad model param, etc.)
          currentKey.errorCount++;
          throw err;
        }
      }
    }

    throw lastError || new Error(`Falha após ${attempts} tentativas em [${taskName}]. Chaves temporariamente esgotadas.`);
  }

  /**
   * Returns the primary GoogleGenAI client for backwards compatibility
   */
  public getPrimaryClient(): GoogleGenAI {
    const key = this.keys[0]?.key || process.env.GEMINI_API_KEY || '';
    return this.createGenAIClient(key);
  }
}

export const geminiKeyManager = GeminiKeyManager.getInstance();
